import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';

const DB_PATH = process.env.DB_PATH || path.resolve(process.cwd(), 'database.db');
const db = new Database(DB_PATH);

// Enable WAL mode for high concurrency
db.pragma('journal_mode = WAL');

// Initialize schema
db.exec(`
  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    original_name TEXT NOT NULL,
    ext TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    formatted_size TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    file_path TEXT NOT NULL,
    uploaded_at TEXT NOT NULL,
    max_downloads INTEGER,
    used_downloads INTEGER DEFAULT 0,
    status TEXT DEFAULT 'active',
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT UNIQUE NOT NULL COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role TEXT DEFAULT 'user',
    status TEXT DEFAULT 'active',
    created_at INTEGER NOT NULL,
    last_login INTEGER
  );

  CREATE TABLE IF NOT EXISTS refresh_tokens (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );
`);

export interface FileRecord {
  id: string;
  code: string;
  original_name: string;
  ext: string;
  size_bytes: number;
  formatted_size: string;
  mime_type: string;
  file_path: string;
  uploaded_at: string;
  max_downloads: number | null;
  used_downloads: number;
  status: 'active' | 'expired';
  created_at: number;
}

export interface UserRecord {
  id: string;
  username: string;
  password_hash: string;
  salt: string;
  role: string;
  status: 'active' | 'disabled';
  created_at: number;
  last_login: number | null;
}

export interface UserSummary {
  id: string;
  username: string;
  role: string;
  status: 'active' | 'disabled';
  created_at: number;
  last_login: number | null;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}

export function generateCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const a = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  const b = Array.from({ length: 3 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${a}-${b}`;
}

export function createFileRecord(data: {
  id: string;
  code: string;
  original_name: string;
  ext: string;
  size_bytes: number;
  mime_type: string;
  file_path: string;
  max_downloads: number | null;
}): FileRecord {
  const now = new Date();
  const uploaded_at = now.toISOString().replace('T', ' ').substring(0, 16);
  const formatted_size = formatBytes(data.size_bytes);
  const created_at = Date.now();

  const stmt = db.prepare(`
    INSERT INTO files (
      id, code, original_name, ext, size_bytes, formatted_size,
      mime_type, file_path, uploaded_at, max_downloads, used_downloads, status, created_at
    ) VALUES (
      @id, @code, @original_name, @ext, @size_bytes, @formatted_size,
      @mime_type, @file_path, @uploaded_at, @max_downloads, 0, 'active', @created_at
    )
  `);

  const record: FileRecord = {
    id: data.id,
    code: data.code.toUpperCase(),
    original_name: data.original_name,
    ext: data.ext,
    size_bytes: data.size_bytes,
    formatted_size,
    mime_type: data.mime_type,
    file_path: data.file_path,
    uploaded_at,
    max_downloads: data.max_downloads,
    used_downloads: 0,
    status: 'active',
    created_at,
  };

  stmt.run(record);
  return record;
}

export function syncFilesWithDisk(): void {
  try {
    const stmt = db.prepare('SELECT id, file_path FROM files');
    const files = stmt.all() as { id: string; file_path: string }[];
    const deleteStmt = db.prepare('DELETE FROM files WHERE id = ?');

    for (const f of files) {
      if (!fs.existsSync(f.file_path)) {
        console.log(`[Auto-Sync] Physical file deleted from disk, removing record: ${f.id} (${f.file_path})`);
        deleteStmt.run(f.id);
      }
    }
  } catch (err) {
    console.error('Error syncing files with disk:', err);
  }
}

export function getFileByCode(code: string): FileRecord | undefined {
  const normalized = code.toUpperCase().trim();
  const stmt = db.prepare('SELECT * FROM files WHERE code = ?');
  const file = stmt.get(normalized) as FileRecord | undefined;
  if (file && !fs.existsSync(file.file_path)) {
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    return undefined;
  }
  return file;
}

export function getFileById(id: string): FileRecord | undefined {
  const stmt = db.prepare('SELECT * FROM files WHERE id = ?');
  const file = stmt.get(id) as FileRecord | undefined;
  if (file && !fs.existsSync(file.file_path)) {
    db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
    return undefined;
  }
  return file;
}

export function getAllFiles(): FileRecord[] {
  syncFilesWithDisk();
  const stmt = db.prepare('SELECT * FROM files ORDER BY created_at DESC');
  return stmt.all() as FileRecord[];
}

export function recordDownload(code: string): { success: boolean; file?: FileRecord; error?: string } {
  const file = getFileByCode(code);
  if (!file) {
    return { success: false, error: 'File not found' };
  }

  if (file.status === 'expired') {
    return { success: false, error: 'File is expired or reached download limit', file };
  }

  const nextUsed = file.used_downloads + 1;
  const isExpired = file.max_downloads !== null && nextUsed >= file.max_downloads;
  const nextStatus = isExpired ? 'expired' : 'active';

  const stmt = db.prepare(`
    UPDATE files
    SET used_downloads = ?, status = ?
    WHERE id = ?
  `);
  stmt.run(nextUsed, nextStatus, file.id);

  return {
    success: true,
    file: {
      ...file,
      used_downloads: nextUsed,
      status: nextStatus,
    },
  };
}

export function updateFileLimit(id: string, max_downloads: number | null): FileRecord | undefined {
  const file = getFileById(id);
  if (!file) return undefined;

  let newStatus: 'active' | 'expired' = 'active';
  if (max_downloads !== null && file.used_downloads >= max_downloads) {
    newStatus = 'expired';
  }

  const stmt = db.prepare(`
    UPDATE files
    SET max_downloads = ?, status = ?
    WHERE id = ?
  `);
  stmt.run(max_downloads, newStatus, id);

  return getFileById(id);
}

export function deleteFileRecord(id: string): FileRecord | undefined {
  const file = getFileById(id);
  if (!file) return undefined;

  // Delete physical file if exists
  try {
    if (fs.existsSync(file.file_path)) {
      fs.unlinkSync(file.file_path);
    }
  } catch (err) {
    console.error(`Failed to delete file from disk: ${file.file_path}`, err);
  }

  const stmt = db.prepare('DELETE FROM files WHERE id = ?');
  stmt.run(id);
  return file;
}

export function getStats(): { totalFiles: number; totalSizeBytes: number; activeTransfers: number } {
  syncFilesWithDisk();
  const all = getAllFiles();
  const totalFiles = all.length;
  const totalSizeBytes = all.reduce((sum, f) => sum + f.size_bytes, 0);
  const activeTransfers = all.filter((f) => f.status === 'active').length;

  return { totalFiles, totalSizeBytes, activeTransfers };
}

// ─── User Authentication & Token Helpers ─────────────────────────────────────

function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function createUser(
  username: string,
  passwordRaw: string,
  role: string = 'user'
): { success: boolean; user?: UserSummary; error?: string } {
  const cleanUsername = username.trim().toLowerCase();
  if (!cleanUsername || cleanUsername.length < 3) {
    return { success: false, error: 'Username must be at least 3 characters' };
  }
  if (!passwordRaw || passwordRaw.length < 4) {
    return { success: false, error: 'Password must be at least 4 characters' };
  }

  // Check if username already exists
  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(cleanUsername);
  if (existing) {
    return { success: false, error: 'Username already exists' };
  }

  const id = crypto.randomUUID();
  const salt = crypto.randomBytes(16).toString('hex');
  const password_hash = hashPassword(passwordRaw, salt);
  const created_at = Date.now();

  const stmt = db.prepare(`
    INSERT INTO users (id, username, password_hash, salt, role, status, created_at, last_login)
    VALUES (?, ?, ?, ?, ?, 'active', ?, NULL)
  `);
  stmt.run(id, cleanUsername, password_hash, salt, role, created_at);

  return {
    success: true,
    user: {
      id,
      username: cleanUsername,
      role,
      status: 'active',
      created_at,
      last_login: null,
    },
  };
}

export function verifyUserCredentials(
  username: string,
  passwordRaw: string
): { success: boolean; user?: UserRecord; error?: string } {
  const cleanUsername = username.trim().toLowerCase();
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(cleanUsername) as UserRecord | undefined;
  if (!user) {
    return { success: false, error: 'Invalid username or password' };
  }

  if (user.status !== 'active') {
    return { success: false, error: 'Account has been disabled' };
  }

  const hash = hashPassword(passwordRaw, user.salt);
  if (!crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.password_hash, 'hex'))) {
    return { success: false, error: 'Invalid username or password' };
  }

  // Update last_login
  const now = Date.now();
  db.prepare('UPDATE users SET last_login = ? WHERE id = ?').run(now, user.id);
  user.last_login = now;

  return { success: true, user };
}

export function getAllUsers(): UserSummary[] {
  const stmt = db.prepare('SELECT id, username, role, status, created_at, last_login FROM users ORDER BY created_at ASC');
  return stmt.all() as UserSummary[];
}

export function getUserById(id: string): UserSummary | undefined {
  const stmt = db.prepare('SELECT id, username, role, status, created_at, last_login FROM users WHERE id = ?');
  return stmt.get(id) as UserSummary | undefined;
}

export function updateUser(
  id: string,
  updates: { password?: string; status?: 'active' | 'disabled'; role?: string }
): { success: boolean; user?: UserSummary; error?: string } {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRecord | undefined;
  if (!user) {
    return { success: false, error: 'User not found' };
  }

  if (updates.password) {
    if (updates.password.length < 4) {
      return { success: false, error: 'Password must be at least 4 characters' };
    }
    const newSalt = crypto.randomBytes(16).toString('hex');
    const newHash = hashPassword(updates.password, newSalt);
    db.prepare('UPDATE users SET password_hash = ?, salt = ? WHERE id = ?').run(newHash, newSalt, id);
    // Invalidate all tokens for this user when password changes
    revokeAllUserTokens(id);
  }

  if (updates.status) {
    db.prepare('UPDATE users SET status = ? WHERE id = ?').run(updates.status, id);
    if (updates.status === 'disabled') {
      revokeAllUserTokens(id);
    }
  }

  if (updates.role) {
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(updates.role, id);
  }

  return {
    success: true,
    user: getUserById(id),
  };
}

export function deleteUser(id: string): boolean {
  revokeAllUserTokens(id);
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(id);
  return result.changes > 0;
}

// ─── Refresh Token Management ────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function createRefreshToken(userId: string, durationDays: number = 30): string {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const id = crypto.randomUUID();
  const created_at = Date.now();
  const expires_at = created_at + durationDays * 24 * 60 * 60 * 1000;

  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, userId, tokenHash, expires_at, created_at);

  return rawToken;
}

export function verifyAndRotateRefreshToken(rawToken: string): {
  success: boolean;
  user?: UserSummary;
  newRawToken?: string;
  error?: string;
} {
  if (!rawToken || typeof rawToken !== 'string') {
    return { success: false, error: 'Token missing' };
  }

  const tokenHash = hashToken(rawToken);
  const record = db.prepare('SELECT * FROM refresh_tokens WHERE token_hash = ?').get(tokenHash) as
    | { id: string; user_id: string; expires_at: number }
    | undefined;

  if (!record) {
    return { success: false, error: 'Invalid or revoked refresh token' };
  }

  // Delete used refresh token immediately (Token Rotation)
  db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(record.id);

  if (Date.now() > record.expires_at) {
    return { success: false, error: 'Refresh token expired' };
  }

  const user = getUserById(record.user_id);
  if (!user || user.status !== 'active') {
    return { success: false, error: 'User inactive or not found' };
  }

  // Issue new rotated refresh token
  const newRawToken = createRefreshToken(user.id);
  return { success: true, user, newRawToken };
}

export function revokeRefreshToken(rawToken: string): void {
  if (!rawToken) return;
  const tokenHash = hashToken(rawToken);
  db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(tokenHash);
}

export function revokeAllUserTokens(userId: string): void {
  db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(userId);
}

export default db;
