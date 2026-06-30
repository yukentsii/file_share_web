# file_share_web

a small file sharing website for private use

This is a lightweight, clean, and simple file-sharing web application built with **Flask** and **SQLite**. It's designed for private/local network use (e.g., sharing files quickly between devices in your house or office).

## Features

- **Simple Login:** Non-admin users can sign in with just a nickname (no passwords to remember for quick sharing).
- **Admin Panel:** Admins can manage users, view server storage, and delete files/users.
- **Chunked Uploads:** Supports large files by uploading them in chunks.
- **Auto-Cleanup:** Automatically cleans up orphaned upload parts on startup.
- **Storage Management:** Older files are cleaned up automatically when storage exceeds configured limit.

## Tech Stack

- **Backend:** Python (Flask, SQLite)
- **Frontend:** Plain HTML, CSS, JavaScript

---

## Getting Started

### 1. Install Dependencies
Make sure you have Python 3 installed. Then, install the required packages:

```bash
pip install Flask werkzeug
```

### 2. Run the Application
Start the Flask server:

```bash
python app.py
```

The application will start on `http://127.0.0.1:16261`.

### 3. Log In

- **Standard Users:** Can log in from the home page using a nickname created by the admin.
- **Admin Panel:** Head to `http://127.0.0.1:16261/admin/login`.
  - **Default Email:** `admin@example.com`
  - **Default Password:** `admin123`
  
> [!IMPORTANT]
> Be sure to change the default admin credentials and `app.secret_key` in `app.py` before exposing the application to a wider network.
