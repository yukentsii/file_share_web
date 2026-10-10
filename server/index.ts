import express from 'express';
import cors from 'cors';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn, ChildProcess } from 'node:child_process';
import dotenv from 'dotenv';
import {
  createFileRecord,
  getFileByCode,
  getFileById,
  getAllFiles,
  recordDownload,
  updateFileLimit,
  deleteFileRecord,
  getStats,
  generateCode,
  FileRecord,
  createUser,
  verifyUserCredentials,
  getAllUsers,
  getUserById,
  updateUser,
  deleteUser,
  createRefreshToken,
  verifyAndRotateRefreshToken,
  revokeRefreshToken,
  revokeAllUserTokens,
} from './db.js';

dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '16261', 10);
const ADMIN_PASSWORD = (process.env.ADMIN_PASSWORD || 'admin').trim();
const ADMIN_TOKEN = (process.env.ADMIN_SECRET || 'transfer-admin-token-secret-key-2026').trim();
const JWT_SECRET = (process.env.JWT_SECRET || 'transfer-jwt-secret-key-2026-safe-production').trim();

function parseCookies(req: express.Request): Record<string, string> {
  const list: Record<string, string> = {};
  const cookieHeader = req.headers.cookie;
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

function base64UrlEncode(str: string): string {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str: string): string {
  let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (base64.length % 4) base64 += '=';
  return Buffer.from(base64, 'base64').toString('utf8');
}

function signAccessToken(user: { id: string; username: string; role: string }): string {
  const header = JSON.stringify({ alg: 'HS256', typ: 'JWT' });
  const payload = JSON.stringify({
    sub: user.id,
    username: user.username,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + 15 * 60, // 15 minutes
  });

  const encodedHeader = base64UrlEncode(header);
  const encodedPayload = base64UrlEncode(payload);
  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${encodedHeader}.${encodedPayload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function verifyAccessToken(token: string): { id: string; username: string; role: string } | null {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [header, payload, signature] = parts;
  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  if (signature !== expectedSig) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload));
    if (data.exp && data.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }
    return { id: data.sub, username: data.username, role: data.role };
  } catch {
    return null;
  }
}

interface AuthRequest extends express.Request {
  user?: { id: string; username: string; role: string };
}

function requireUserAuth(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ success: false, error: 'Unauthorized. Please sign in.' });
    return;
  }

  const token = authHeader.slice(7).trim();
  const user = verifyAccessToken(token);
  if (!user) {
    res.status(401).json({ success: false, error: 'Session expired or invalid. Please refresh.' });
    return;
  }

  (req as AuthRequest).user = user;
  next();
}

const UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve(process.cwd(), 'uploads');
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

const TEMP_VIDEO_DIR = path.resolve(UPLOAD_DIR, 'temp_videos');
if (!fs.existsSync(TEMP_VIDEO_DIR)) {
  fs.mkdirSync(TEMP_VIDEO_DIR, { recursive: true });
}

// In-memory active video download jobs with live progress tracking
interface VideoJob {
  jobId: string;
  url: string;
  quality: string;
  title: string;
  status: 'starting' | 'downloading' | 'processing' | 'ready' | 'error' | 'cancelled';
  percent: number;
  speed: string;
  eta: string;
  totalSize: string;
  stage: string;
  error?: string;
  downloadUrl?: string;
  fileName?: string;
  filePath?: string;
  child?: ChildProcess;
  createdAt: number;
}
const videoJobs = new Map<string, VideoJob>();

// Clean up stale video downloads every 5 minutes (files older than 20 mins)
setInterval(() => {
  const now = Date.now();
  for (const [jobId, job] of videoJobs.entries()) {
    if (now - job.createdAt > 20 * 60 * 1000) {
      if (job.child && !job.child.killed) {
        try {
          job.child.kill('SIGKILL');
        } catch {}
      }
      try {
        if (job.filePath && fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      } catch {}
      videoJobs.delete(jobId);
    }
  }
  try {
    if (fs.existsSync(TEMP_VIDEO_DIR)) {
      const files = fs.readdirSync(TEMP_VIDEO_DIR);
      for (const f of files) {
        const p = path.join(TEMP_VIDEO_DIR, f);
        const stat = fs.statSync(p);
        if (now - stat.mtimeMs > 20 * 60 * 1000) {
          fs.unlinkSync(p);
        }
      }
    }
  } catch {}
}, 5 * 60 * 1000);

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${crypto.randomBytes(6).toString('hex')}`;
    const safeExt = path.extname(file.originalname).slice(1) || 'bin';
    cb(null, `${uniqueSuffix}.${safeExt}`);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: 20 * 1024 * 1024 * 1024, // 20 GB max upload limit
  },
});

app.use(cors());
app.use(express.json());

// Helper to format file record for frontend
function formatFileResponse(file: FileRecord) {
  return {
    id: file.id,
    name: path.parse(file.original_name).name,
    originalName: file.original_name,
    ext: file.ext,
    size: file.formatted_size,
    sizeBytes: file.size_bytes,
    uploadedAt: file.uploaded_at,
    maxDownloads: file.max_downloads,
    usedDownloads: file.used_downloads,
    status: file.status,
    code: file.code,
  };
}

// ─── API Routes ─────────────────────────────────────────────────────────────

// ─── Authentication Routes ──────────────────────────────────────────────────

// 1. Login with username & password
app.post('/api/auth/login', (req, res): void => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ success: false, error: 'Username and password required' });
      return;
    }

    const result = verifyUserCredentials(username, password);
    if (!result.success || !result.user) {
      res.status(401).json({ success: false, error: result.error || 'Invalid credentials' });
      return;
    }

    const userSummary = { id: result.user.id, username: result.user.username, role: result.user.role };
    const accessToken = signAccessToken(userSummary);
    const refreshToken = createRefreshToken(result.user.id, 30);

    res.cookie('transfer_refresh_token', refreshToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      accessToken,
      refreshToken,
      user: userSummary,
    });
  } catch (err: any) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Server error during login' });
  }
});

// 2. Refresh Access Token (Auto-login / Otologin with Refresh Token Rotation)
app.post('/api/auth/refresh', (req, res): void => {
  try {
    const cookies = parseCookies(req);
    const rawToken = req.body?.refreshToken || cookies.transfer_refresh_token;

    if (!rawToken) {
      res.status(401).json({ success: false, error: 'No refresh token provided' });
      return;
    }

    const rotated = verifyAndRotateRefreshToken(rawToken);
    if (!rotated.success || !rotated.user || !rotated.newRawToken) {
      res.clearCookie('transfer_refresh_token', { path: '/' });
      res.status(401).json({ success: false, error: rotated.error || 'Invalid refresh token' });
      return;
    }

    const userSummary = { id: rotated.user.id, username: rotated.user.username, role: rotated.user.role };
    const newAccessToken = signAccessToken(userSummary);

    res.cookie('transfer_refresh_token', rotated.newRawToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60 * 1000,
    });

    res.json({
      success: true,
      accessToken: newAccessToken,
      refreshToken: rotated.newRawToken,
      user: userSummary,
    });
  } catch (err: any) {
    console.error('Refresh error:', err);
    res.status(500).json({ success: false, error: 'Server error refreshing token' });
  }
});

// 3. Logout
app.post('/api/auth/logout', (req, res): void => {
  try {
    const cookies = parseCookies(req);
    const rawToken = req.body?.refreshToken || cookies.transfer_refresh_token;
    if (rawToken) {
      revokeRefreshToken(rawToken);
    }
    res.clearCookie('transfer_refresh_token', { path: '/' });
    res.json({ success: true });
  } catch (err: any) {
    console.error('Logout error:', err);
    res.status(500).json({ success: false, error: 'Server error logging out' });
  }
});

// 4. Me endpoint
app.get('/api/auth/me', requireUserAuth, (req, res): void => {
  const user = (req as AuthRequest).user;
  res.json({ success: true, user });
});

// Upload endpoint
app.post('/api/upload', requireUserAuth, upload.single('file'), (req, res): void => {
  try {
    if (!req.file) {
      res.status(400).json({ success: false, error: 'No file provided' });
      return;
    }

    const { maxDownloads } = req.body;
    let parsedLimit: number | null = null;
    if (maxDownloads !== undefined && maxDownloads !== null && maxDownloads !== '' && maxDownloads !== 'unlimited') {
      const num = parseInt(maxDownloads, 10);
      if (!isNaN(num) && num > 0) {
        parsedLimit = num;
      }
    }

    // Fix UTF-8 encoding for filename if received with latin1 encoding
    let originalName = req.file.originalname;
    try {
      originalName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    } catch {
      // ignore fallback
    }

    let ext = path.extname(originalName).replace('.', '').toLowerCase();
    if (!ext) ext = 'bin';

    // Generate unique share code
    let code = generateCode();
    let attempts = 0;
    while (getFileByCode(code) && attempts < 10) {
      code = generateCode();
      attempts++;
    }

    const id = crypto.randomUUID();
    const record = createFileRecord({
      id,
      code,
      original_name: originalName,
      ext,
      size_bytes: req.file.size,
      mime_type: req.file.mimetype || 'application/octet-stream',
      file_path: req.file.path,
      max_downloads: parsedLimit,
    });

    res.json({
      success: true,
      code: record.code,
      file: formatFileResponse(record),
    });
  } catch (err: any) {
    console.error('Upload error:', err);
    res.status(500).json({ success: false, error: err.message || 'Failed to process upload' });
  }
});

// Lookup file by code
app.get('/api/files/:code', (req, res): void => {
  try {
    const code = req.params.code;
    const file = getFileByCode(code);

    if (!file) {
      res.status(404).json({ success: false, error: 'File not found or invalid code' });
      return;
    }

    if (file.status === 'expired' || (file.max_downloads !== null && file.used_downloads >= file.max_downloads)) {
      res.status(410).json({
        success: false,
        error: 'This file has reached its download limit or has expired',
        file: formatFileResponse(file),
      });
      return;
    }

    res.json({
      success: true,
      file: formatFileResponse(file),
    });
  } catch (err: any) {
    console.error('Lookup error:', err);
    res.status(500).json({ success: false, error: 'Server error looking up file' });
  }
});

// Download file endpoint
app.get('/api/files/:code/download', (req, res): void => {
  try {
    const code = req.params.code;
    const result = recordDownload(code);

    if (!result.success || !result.file) {
      res.status(404).send(result.error || 'File not available');
      return;
    }

    const file = result.file;
    if (!fs.existsSync(file.file_path)) {
      res.status(404).send('File missing from disk');
      return;
    }

    res.download(file.file_path, file.original_name, (err) => {
      if (err) {
        console.error('Error during file transfer:', err);
      }
    });
  } catch (err: any) {
    console.error('Download error:', err);
    res.status(500).send('Server error during download');
  }
});

// ─── Admin Endpoints ────────────────────────────────────────────────────────

// Admin Login
app.post('/api/admin/login', (req, res): void => {
  const { password } = req.body;
  if (password === ADMIN_PASSWORD) {
    res.json({ success: true, token: ADMIN_TOKEN });
  } else {
    res.status(401).json({ success: false, error: 'Incorrect password' });
  }
});

// Middleware for Admin Auth
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction): void {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader === `Bearer ${ADMIN_TOKEN}`) {
    next();
  } else {
    res.status(403).json({ success: false, error: 'Unauthorized' });
  }
}

// Get all files & stats
app.get('/api/admin/files', requireAdmin, (_req, res): void => {
  try {
    const all = getAllFiles();
    const stats = getStats();
    res.json({
      success: true,
      files: all.map(formatFileResponse),
      stats,
    });
  } catch (err: any) {
    console.error('Admin list error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch files' });
  }
});

// Update download limit
app.patch('/api/admin/files/:id/limit', requireAdmin, (req, res): void => {
  try {
    const id = req.params.id;
    const { maxDownloads } = req.body;
    const updated = updateFileLimit(id, maxDownloads);
    if (!updated) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.json({ success: true, file: formatFileResponse(updated) });
  } catch (err: any) {
    console.error('Admin update limit error:', err);
    res.status(500).json({ success: false, error: 'Failed to update limit' });
  }
});

// Delete file
app.delete('/api/admin/files/:id', requireAdmin, (req, res): void => {
  try {
    const id = req.params.id;
    const deleted = deleteFileRecord(id);
    if (!deleted) {
      res.status(404).json({ success: false, error: 'File not found' });
      return;
    }
    res.json({ success: true, deleted: formatFileResponse(deleted) });
  } catch (err: any) {
    console.error('Admin delete error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete file' });
  }
});

// ─── Admin User Management Endpoints ────────────────────────────────────────

// List all users
app.get('/api/admin/users', requireAdmin, (_req, res): void => {
  try {
    const users = getAllUsers();
    res.json({ success: true, users });
  } catch (err: any) {
    console.error('Admin users error:', err);
    res.status(500).json({ success: false, error: 'Failed to fetch users' });
  }
});

// Create new user
app.post('/api/admin/users', requireAdmin, (req, res): void => {
  try {
    const { username, password, role } = req.body;
    if (!username || !password) {
      res.status(400).json({ success: false, error: 'Username and password required' });
      return;
    }
    const result = createUser(username, password, role || 'user');
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, user: result.user });
  } catch (err: any) {
    console.error('Admin create user error:', err);
    res.status(500).json({ success: false, error: 'Failed to create user' });
  }
});

// Update user (reset password, toggle status)
app.patch('/api/admin/users/:id', requireAdmin, (req, res): void => {
  try {
    const id = req.params.id;
    const { password, status, role } = req.body;
    const result = updateUser(id, { password, status, role });
    if (!result.success) {
      res.status(400).json({ success: false, error: result.error });
      return;
    }
    res.json({ success: true, user: result.user });
  } catch (err: any) {
    console.error('Admin update user error:', err);
    res.status(500).json({ success: false, error: 'Failed to update user' });
  }
});

// Delete user
app.delete('/api/admin/users/:id', requireAdmin, (req, res): void => {
  try {
    const id = req.params.id;
    const ok = deleteUser(id);
    if (!ok) {
      res.status(404).json({ success: false, error: 'User not found' });
      return;
    }
    res.json({ success: true });
  } catch (err: any) {
    console.error('Admin delete user error:', err);
    res.status(500).json({ success: false, error: 'Failed to delete user' });
  }
});

// ─── Video Downloader Endpoints ─────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (!sec || isNaN(sec) || sec <= 0) return '0:00';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const remSec = s % 60;
  const secStr = remSec < 10 ? `0${remSec}` : `${remSec}`;
  if (h > 0) {
    const minStr = m < 10 ? `0${m}` : `${m}`;
    return `${h}:${minStr}:${secStr}`;
  }
  return `${m}:${secStr}`;
}

function sanitizeFilename(title: string): string {
  return (
    title
      .replace(/[/\\?%*:|"<>]/g, '_')
      .replace(/[\x00-\x1f\x80-\x9f]/g, '')
      .trim()
      .slice(0, 100) || 'video'
  );
}

// 1. Fetch video metadata & available quality options
app.post('/api/video/info', requireUserAuth, (req, res): void => {
  const { url } = req.body;
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    res.status(400).json({ success: false, error: 'Please enter a valid video link (HTTP/HTTPS)' });
    return;
  }

  const cleanUrl = url.trim();
  const child = spawn('yt-dlp', ['-j', '--no-playlist', '--skip-download', '--socket-timeout', '15', cleanUrl]);
  let stdout = '';
  let stderr = '';

  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  child.on('close', (code) => {
    if (code !== 0) {
      console.error('yt-dlp info failed:', stderr);
      res.status(400).json({
        success: false,
        error: 'Unable to extract video. The video may be private, age-restricted, or the platform is unsupported.',
      });
      return;
    }

    try {
      const data = JSON.parse(stdout);
      const formats = Array.isArray(data.formats) ? data.formats : [];
      const heights = new Set<number>();
      for (const f of formats) {
        if (typeof f.height === 'number' && f.height > 0) {
          heights.add(f.height);
        }
      }
      const maxHeight = Math.max(0, ...Array.from(heights));

      function formatBytesEst(b: number): string {
        if (!b || b <= 0) return '';
        if (b >= 1e9) return `~${(b / 1e9).toFixed(1)} gb`;
        if (b >= 1e6) return `~${(b / 1e6).toFixed(0)} mb`;
        if (b >= 1e3) return `~${(b / 1e3).toFixed(0)} kb`;
        return `~${Math.round(b)} b`;
      }

      const duration = data.duration || 0;

      // Best audio size estimation
      const audioFormats = formats.filter((f: any) => !f.height && (f.filesize || f.filesize_approx || f.abr));
      let bestAudioBytes = 0;
      for (const a of audioFormats) {
        const s = a.filesize || a.filesize_approx || (a.abr && duration ? (a.abr * 1000 / 8) * duration : 0);
        if (s > bestAudioBytes) bestAudioBytes = s;
      }
      if (!bestAudioBytes && duration) {
        bestAudioBytes = (128 * 1000 / 8) * duration;
      }

      function getEstForHeight(targetH: number, fallbackKbps: number): string {
        let matching = formats.filter((f: any) => f.height === targetH);
        if (matching.length === 0 && targetH === 1080) {
          matching = formats.filter((f: any) => f.height && f.height > 720 && f.height <= 1080);
        } else if (matching.length === 0 && targetH === 720) {
          matching = formats.filter((f: any) => f.height && f.height > 480 && f.height <= 720);
        } else if (matching.length === 0 && targetH === 480) {
          matching = formats.filter((f: any) => f.height && f.height > 360 && f.height <= 480);
        }

        let bestVBytes = 0;
        let isMuxed = false;
        for (const v of matching) {
          const s = v.filesize || v.filesize_approx || ((v.vbr || v.tbr) && duration ? ((v.vbr || v.tbr) * 1000 / 8) * duration : 0);
          if (s > bestVBytes) {
            bestVBytes = s;
            if (v.acodec && v.acodec !== 'none') isMuxed = true;
          }
        }

        let total = 0;
        if (bestVBytes > 0) {
          total = isMuxed ? bestVBytes : (bestVBytes + bestAudioBytes);
        } else if (duration > 0) {
          total = ((fallbackKbps + 128) * 1000 / 8) * duration;
        }
        return formatBytesEst(total);
      }

      let bestOverallBytes = 0;
      for (const f of formats) {
        const s = f.filesize || f.filesize_approx || (f.tbr && duration ? (f.tbr * 1000 / 8) * duration : 0);
        if (s > bestOverallBytes) bestOverallBytes = s;
      }
      const sizeBest = formatBytesEst(bestOverallBytes || (duration ? 2500 * 1000 / 8 * duration : 0));

      const size1080p = getEstForHeight(1080, 3500);
      const size720p = getEstForHeight(720, 1800);
      const size480p = getEstForHeight(480, 800);
      const sizeAudio = formatBytesEst(bestAudioBytes);

      const qualities: Array<{ id: string; label: string; ext: string; estSize: string; desc: string }> = [];

      if (maxHeight >= 1080 || heights.has(1080)) {
        qualities.push({
          id: '1080p',
          label: '1080p full hd',
          ext: 'mp4',
          estSize: size1080p,
          desc: 'highest resolution mp4',
        });
      }
      if (maxHeight >= 720 || heights.has(720)) {
        qualities.push({
          id: '720p',
          label: '720p hd',
          ext: 'mp4',
          estSize: size720p,
          desc: 'crisp hd quality mp4',
        });
      }
      if (maxHeight >= 480 || heights.has(480) || qualities.length === 0) {
        qualities.push({
          id: '480p',
          label: '480p sd',
          ext: 'mp4',
          estSize: size480p,
          desc: 'standard definition mp4',
        });
      }
      if (qualities.length === 0 || maxHeight === 0) {
        qualities.unshift({
          id: 'best',
          label: 'best video',
          ext: 'mp4',
          estSize: sizeBest,
          desc: 'original source video',
        });
      }
      // Always provide audio extraction option
      qualities.push({
        id: 'mp3',
        label: 'audio only',
        ext: 'mp3',
        estSize: sizeAudio,
        desc: 'extracted mp3 audio',
      });

      res.json({
        success: true,
        video: {
          title: data.title || 'untitled video',
          thumbnail: data.thumbnail || '',
          duration: data.duration || 0,
          durationFormatted: formatDuration(data.duration || 0),
          uploader: data.uploader || data.channel || data.creator || '',
          extractor: (data.extractor_key || data.extractor || 'web').toLowerCase(),
          qualities,
        },
      });
    } catch (err) {
      console.error('JSON parse error:', err);
      res.status(500).json({ success: false, error: 'Failed to parse video metadata' });
    }
  });
});

// 2. Start asynchronous video download job with live progress parsing
app.post('/api/video/start', requireUserAuth, (req, res): void => {
  const { url, quality, title } = req.body;
  if (!url || typeof url !== 'string' || !/^https?:\/\//i.test(url.trim())) {
    res.status(400).json({ success: false, error: 'Invalid URL' });
    return;
  }

  const jobId = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  const outputTemplate = path.join(TEMP_VIDEO_DIR, `${jobId}.%(ext)s`);

  let formatArgs: string[] = [];
  if (quality === 'mp3') {
    formatArgs = ['-x', '--audio-format', 'mp3', '--audio-quality', '0'];
  } else if (quality === '1080p') {
    formatArgs = [
      '-f',
      'bv*[height<=1080][ext=mp4]+ba[ext=m4a]/bv*[height<=1080]+ba/b[height<=1080]/best',
      '--merge-output-format',
      'mp4',
    ];
  } else if (quality === '720p') {
    formatArgs = [
      '-f',
      'bv*[height<=720][ext=mp4]+ba[ext=m4a]/bv*[height<=720]+ba/b[height<=720]/best',
      '--merge-output-format',
      'mp4',
    ];
  } else if (quality === '480p') {
    formatArgs = [
      '-f',
      'bv*[height<=480][ext=mp4]+ba[ext=m4a]/bv*[height<=480]+ba/b[height<=480]/best',
      '--merge-output-format',
      'mp4',
    ];
  } else {
    formatArgs = ['-f', 'bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b', '--merge-output-format', 'mp4'];
  }

  const cleanUrl = url.trim();
  const child = spawn('yt-dlp', ['--newline', ...formatArgs, '-o', outputTemplate, '--no-playlist', cleanUrl]);

  const job: VideoJob = {
    jobId,
    url: cleanUrl,
    quality: quality || 'best',
    title: title || 'video',
    status: 'starting',
    percent: 0,
    speed: '',
    eta: '',
    totalSize: '',
    stage: 'starting download...',
    child,
    createdAt: Date.now(),
  };

  videoJobs.set(jobId, job);

  // Parse stdout for live progress
  child.stdout.on('data', (chunk) => {
    const str = chunk.toString();
    const lines = str.split('\n');
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Match [download]  42.5% of ~1.12GiB at 14.23MiB/s ETA 00:45
      const match = line.match(/\[download\]\s+([\d\.]+)%\s+of\s+~?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)/);
      if (match) {
        job.status = 'downloading';
        job.percent = Math.min(99, parseFloat(match[1]));
        job.totalSize = match[2];
        job.speed = match[3];
        job.eta = match[4];
        job.stage = 'downloading media...';
        continue;
      }

      // Match 100% of ...
      if (line.includes('[download]') && line.includes('100%')) {
        job.percent = 99;
        job.stage = 'finishing download...';
      }

      // Processing / merging stages
      if (line.includes('[Merger]')) {
        job.status = 'processing';
        job.percent = 99;
        job.stage = 'merging audio & video streams...';
      } else if (line.includes('[ExtractAudio]')) {
        job.status = 'processing';
        job.percent = 99;
        job.stage = 'converting audio to mp3...';
      }
    }
  });

  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  // Timeout guard: 30 minutes for large videos
  const timer = setTimeout(() => {
    if (job.status !== 'ready' && job.status !== 'cancelled') {
      child.kill('SIGKILL');
      job.status = 'error';
      job.error = 'Download timed out after 30 minutes.';
    }
  }, 30 * 60 * 1000);

  child.on('close', (code) => {
    clearTimeout(timer);
    if (job.status === 'cancelled') return;

    if (code !== 0) {
      console.error('yt-dlp download failed:', stderr);
      job.status = 'error';
      job.error = 'Failed to download or convert video.';
      return;
    }

    try {
      const files = fs.readdirSync(TEMP_VIDEO_DIR);
      const target = files.find((f) => f.startsWith(`${jobId}.`));
      if (!target) {
        job.status = 'error';
        job.error = 'Converted file was not found on server.';
        return;
      }

      const actualExt = path.extname(target).slice(1) || (quality === 'mp3' ? 'mp3' : 'mp4');
      const safeBase = sanitizeFilename(title || 'video');
      const downloadFileName = `${safeBase}.${actualExt}`;
      const filePath = path.join(TEMP_VIDEO_DIR, target);

      job.status = 'ready';
      job.percent = 100;
      job.stage = 'ready';
      job.fileName = downloadFileName;
      job.filePath = filePath;
      job.downloadUrl = `/api/video/file/${jobId}`;
    } catch (err: any) {
      console.error('Post-download error:', err);
      job.status = 'error';
      job.error = 'Failed to process downloaded file.';
    }
  });

  res.json({
    success: true,
    jobId,
  });
});

// 3. Poll job status
app.get('/api/video/status/:jobId', (req, res): void => {
  const { jobId } = req.params;
  const job = videoJobs.get(jobId);

  if (!job) {
    res.status(404).json({ success: false, error: 'Job not found or expired' });
    return;
  }

  res.json({
    success: true,
    status: job.status,
    percent: job.percent,
    speed: job.speed,
    eta: job.eta,
    totalSize: job.totalSize,
    stage: job.stage,
    error: job.error,
    downloadUrl: job.downloadUrl,
    fileName: job.fileName,
  });
});

// 4. Cancel active video download
app.post('/api/video/cancel/:jobId', (req, res): void => {
  const { jobId } = req.params;
  const job = videoJobs.get(jobId);

  if (job) {
    job.status = 'cancelled';
    if (job.child && !job.child.killed) {
      try {
        job.child.kill('SIGKILL');
      } catch {}
    }
    try {
      const files = fs.readdirSync(TEMP_VIDEO_DIR);
      for (const f of files) {
        if (f.startsWith(jobId)) {
          fs.unlinkSync(path.join(TEMP_VIDEO_DIR, f));
        }
      }
    } catch {}
    videoJobs.delete(jobId);
  }

  res.json({ success: true, message: 'download cancelled' });
});

// 5. Serve and stream the prepared file to browser with immediate cleanup
app.get('/api/video/file/:jobId', (req, res): void => {
  const { jobId } = req.params;
  const job = videoJobs.get(jobId);
  if (!job || !job.filePath || !fs.existsSync(job.filePath)) {
    res.status(404).send('File expired or not found. Please try downloading again.');
    return;
  }

  res.download(job.filePath, job.fileName || 'video.mp4', (err) => {
    if (err && !res.headersSent) {
      console.error('Video transfer error:', err);
    }
    setTimeout(() => {
      try {
        if (job.filePath && fs.existsSync(job.filePath)) fs.unlinkSync(job.filePath);
      } catch {}
      videoJobs.delete(jobId);
    }, 3000);
  });
});

// ─── Frontend Static Files & SPA Routing ────────────────────────────────────

const DIST_DIR = path.resolve(process.cwd(), 'dist');
if (fs.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR));
}

// Catch-all fallback for SPA routes (e.g., /d/:code, /admin, /video, etc.)
app.use((_req, res) => {
  const indexHtml = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexHtml)) {
    res.sendFile(indexHtml);
  } else {
    res.send('Minimalist File Sharing UI Server is running. Frontend build not found.');
  }
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on http://0.0.0.0:${PORT}`);
});
