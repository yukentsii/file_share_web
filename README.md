# File Share Web

A minimalist, high-performance file transfer and video downloading web application built with **React 19**, **Node.js (Express 5)**, and **SQLite (`better-sqlite3`)**.

---

## Features

### File Sharing
- **Minimalist Interface:** Clean, distraction-free aesthetic with automatic dark/light theme support and lowercase typography.
- **Code-Based & Direct Links:** Share files with a 6-character code (e.g., `7K9-X2M`) or direct URL (`/d/:code`).
- **Download Limits:** Set custom or unlimited download caps per file.
- **Streaming Uploads:** Powered by Multer for efficient chunked streaming directly to disk (supports large files up to 20 GB).
- **Public Downloads:** Visitors can look up and download shared files without needing an account.
- **Physical Disk Sync:** Automatically detects and purges records if files are removed from the disk.

### Video Downloader (`/video`)
- **Multi-Platform Support:** Paste video links from popular streaming and social media platforms.
- **Resolution & Format Selection:** Choose between 1080p, 720p, 480p, 360p, or audio-only (MP3).
- **Live Size & Progress Estimation:** Shows estimated file sizes before downloading, followed by real-time progress bars, speed, and ETA.

### Security & Authentication
- **Dual-Token System:**
  - **Access Token (15 Minutes):** Short-lived HMAC-SHA256 JWT used to authorize file uploads and video downloading.
  - **Refresh Token (30 Days):** Long-lived 256-bit secure random token stored as SHA-256 hashes in SQLite.
- **Automatic Token Rotation:** Refresh tokens are single-use; each refresh issues a new token pair and revokes the old one to prevent token theft and replay attacks.
- **Persistent Auto-Login:** Silently restores user sessions on visit without requiring frequent password re-entry.
- **Native Password Hashing:** Uses Node.js native `crypto.scrypt` with per-user 16-byte random salts and constant-time comparisons (`crypto.timingSafeEqual`).

### Admin Dashboard (`/admin`)
- **File Management:** Real-time storage stats, active transfer tracking, limit adjustments, and file deletion.
- **User Management:** Create new user accounts, reset passwords, toggle user status (`active` / `disabled`), and delete users.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | React 19, TypeScript, Vite, Tailwind CSS |
| **Backend** | Node.js (v20+), Express 5, Multer, `node:crypto` |
| **Database** | SQLite 3 in WAL mode via `better-sqlite3` |
| **Video Processing** | `yt-dlp`, `ffmpeg` |
| **Bundling** | Vite (Client), ESBuild (Server) |

---

## Getting Started

### Prerequisites
- **Node.js** (v20 LTS or higher)
- **yt-dlp** and **ffmpeg** (required for the video downloader engine)
  ```bash
  # Ubuntu/Debian
  sudo apt install ffmpeg
  sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
  sudo chmod a+rx /usr/local/bin/yt-dlp
  ```

### 1. Clone & Install
```bash
git clone https://github.com/yukentsii/file_share_web.git
cd file_share_web
npm install
```

### 2. Configure Environment
Copy the example environment file and set your secrets:
```bash
cp .env.example .env
```

Edit `.env`:
```env
PORT=16261
ADMIN_PASSWORD=your_secure_admin_password
ADMIN_SECRET=your_random_admin_secret
JWT_SECRET=your_random_jwt_secret
```

### 3. Build & Run

#### Development
```bash
npm run dev
```

#### Production Build
```bash
# Builds both Vite client (dist/) and ESBuild server bundle (dist-server/)
npm run build

# Start the unified server
npm start
```

The application will run on `http://localhost:16261`.

---

## Production Deployment (Systemd & Nginx)

### Systemd Service
Create `/etc/systemd/system/fileshare.service`:
```ini
[Unit]
Description=File Share Web App
After=network.target

[Service]
User=www-data
Group=www-data
WorkingDirectory=/var/www/file_share_web
Environment="NODE_ENV=production"
Environment="PORT=16261"
ExecStart=/usr/bin/node /var/www/file_share_web/dist-server/index.js
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now fileshare.service
```

### Nginx Reverse Proxy
```nginx
server {
    server_name yourdomain.com;
    client_max_body_size 20G;

    location / {
        proxy_pass http://127.0.0.1:16261;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## License
MIT License
