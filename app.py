import os
import sqlite3
import glob
import time
import datetime
from flask import Flask, render_template, request, redirect, url_for, session, flash, Response, jsonify
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash, check_password_hash

app = Flask(__name__)
app.secret_key = 'super_secret_key_change_this_to_something_random'
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

MASTER_ADMIN_EMAIL = "admin@example.com"

def cleanup_orphaned_parts():
    orphaned_files = glob.glob(os.path.join(UPLOAD_FOLDER, '*.part'))
    for file in orphaned_files:
        try: os.remove(file)
        except: pass

def init_db():
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, nickname TEXT, email TEXT UNIQUE, password TEXT, is_admin INTEGER DEFAULT 0)''')
    c.execute('''CREATE TABLE IF NOT EXISTS files (id INTEGER PRIMARY KEY, sender TEXT, receiver TEXT, filename TEXT, filepath TEXT, size INTEGER, timestamp REAL, status TEXT)''')
    
    # Check if the master admin account exists; it should have been created by the migration script
    c.execute("SELECT * FROM users WHERE email=?", (MASTER_ADMIN_EMAIL.lower(),))
    if not c.fetchone():
        try:
            hashed_pw = generate_password_hash("admin123")
            c.execute("INSERT INTO users (nickname, email, password, is_admin) VALUES (?, ?, ?, 1)", ('Admin', MASTER_ADMIN_EMAIL.lower(), hashed_pw))
        except sqlite3.IntegrityError:
            pass
            
    conn.commit()
    conn.close()

cleanup_orphaned_parts()
init_db()

def is_admin():
    return session.get('is_admin_verified', False)

@app.before_request
def validate_session():
    # If the user has a session, ensure they still exist in the database
    if 'nickname' in session:
        import sqlite3
        conn = sqlite3.connect('database.db')
        c = conn.cursor()
        c.execute("SELECT id FROM users WHERE nickname=?", (session['nickname'],))
        row = c.fetchone()
        conn.close()
        
        # If user was revoked (deleted) from DB, clear their invalid session
        if not row:
            session.clear()

@app.route('/', methods=['GET', 'POST'])
def login():
    if 'nickname' in session: return redirect(url_for('dashboard'))
    
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        
        conn = sqlite3.connect('database.db')
        c = conn.cursor()
        c.execute("SELECT nickname, email FROM users WHERE nickname=?", (username,))
        user = c.fetchone()
        conn.close()
        
        if user:
            session['nickname'] = user[0]
            session['email'] = user[1]
            session['is_admin_verified'] = False
            return redirect(url_for('dashboard'))
        else:
            flash("Invalid username.")
            return redirect(url_for('login'))
            
    return render_template('index.html')

@app.route('/admin/login', methods=['GET', 'POST'])
def admin_login():
    if session.get('is_admin_verified'):
        return redirect(url_for('admin_panel'))
        
    if request.method == 'POST':
        email = request.form.get('email', '').strip().lower()
        password = request.form.get('password', '').strip()
        
        conn = sqlite3.connect('database.db')
        c = conn.cursor()
        c.execute("SELECT nickname, password, is_admin FROM users WHERE email=?", (email,))
        user = c.fetchone()
        conn.close()
        
        if user and user[2] == 1 and check_password_hash(user[1], password):
            session['email'] = email
            session['nickname'] = user[0]
            session['is_admin_verified'] = True
            return redirect(url_for('admin_panel'))
        else:
            flash("Invalid admin email or password.")
            return redirect(url_for('admin_login'))
            
    return render_template('admin_login.html')

@app.route('/dashboard')
def dashboard():
    if 'nickname' not in session: return redirect(url_for('login'))
        
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute("SELECT nickname FROM users WHERE nickname != ? ORDER BY nickname ASC", (session['nickname'],))
    all_users = [row[0] for row in c.fetchall()]
    conn.close()
    
    return render_template('dashboard.html', nickname=session['nickname'], is_admin=is_admin(), all_users=all_users)

@app.route('/api/files')
def api_files():
    if 'nickname' not in session: return jsonify({"error": "Unauthorized"}), 403
    
    # Handle dynamic sorting
    sort_by = request.args.get('sort', 'date')
    order_clause = "ORDER BY size DESC" if sort_by == 'size' else "ORDER BY timestamp DESC"
        
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute(f"SELECT id, sender, filename, size, timestamp, status FROM files WHERE receiver=? {order_clause}", (session['nickname'],))
    files = c.fetchall()
    conn.close()
    
    pending = []
    history = []
    
    for f in files:
        file_obj = {
            "id": f[0], "sender": f[1], "filename": f[2], "size": f[3],
            "date": datetime.datetime.fromtimestamp(f[4]).strftime('%Y-%m-%d %H:%M')
        }
        if f[5] == 'pending': pending.append(file_obj)
        else: history.append(file_obj)
            
    return jsonify({"pending": pending, "history": history})

@app.route('/upload_chunk', methods=['POST'])
def upload_chunk():
    if 'nickname' not in session: return "Unauthorized", 403

    file = request.files['file']
    filename = secure_filename(request.form['filename'])
    chunk_index = int(request.form['chunk_index'])
    total_chunks = int(request.form['total_chunks'])
    receiver = request.form['receiver']

    final_filename = f"{session['nickname']}_{filename}"
    filepath = os.path.join(UPLOAD_FOLDER, final_filename)
    temp_filepath = filepath + '.part'

    with open(temp_filepath, 'ab') as f: f.write(file.read())

    if chunk_index == total_chunks - 1:
        os.rename(temp_filepath, filepath) 
        file_size = os.path.getsize(filepath)
        
        conn = sqlite3.connect('database.db')
        c = conn.cursor()
        MAX_STORAGE = 10737418240 
        c.execute("SELECT id, filepath, size FROM files WHERE receiver=? ORDER BY timestamp ASC", (receiver,))
        user_files = c.fetchall()
        
        current_used = sum(f[2] for f in user_files)
        
        for fid, fpath, fsize in user_files:
            if current_used + file_size <= MAX_STORAGE: break
            if os.path.exists(fpath): os.remove(fpath)
            c.execute("DELETE FROM files WHERE id=?", (fid,))
            current_used -= fsize
            
        timestamp = time.time()
        c.execute("INSERT INTO files (sender, receiver, filename, filepath, size, timestamp, status) VALUES (?, ?, ?, ?, ?, ?, 'pending')", 
                  (session['nickname'], receiver, filename, filepath, file_size, timestamp))
        conn.commit()
        conn.close()
        return "Upload complete", 200
    return f"Chunk {chunk_index} received", 200

@app.route('/download/<int:file_id>')
def download(file_id):
    if 'nickname' not in session: return redirect(url_for('login'))
    
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute("SELECT filepath, filename FROM files WHERE id=? AND receiver=?", (file_id, session['nickname']))
    file_data = c.fetchone()
    
    if file_data:
        filepath, filename = file_data
        c.execute("UPDATE files SET status='downloaded' WHERE id=?", (file_id,))
        conn.commit()
        conn.close()
        
        if not os.path.exists(filepath): return redirect(url_for('dashboard'))
        file_size = os.path.getsize(filepath)

        def generate():
            with open(filepath, 'rb') as f:
                while True:
                    chunk = f.read(8192)
                    if not chunk: break
                    yield chunk
        headers = { "Content-Disposition": f"attachment; filename={filename}", "Content-Length": str(file_size) }
        return Response(generate(), headers=headers)
    
    conn.close()
    return redirect(url_for('dashboard'))

@app.route('/reject/<int:file_id>')
def reject(file_id):
    if 'nickname' not in session: return redirect(url_for('login'))
    conn = sqlite3.connect('database.db')
    c = conn.cursor()
    c.execute("SELECT filepath FROM files WHERE id=? AND receiver=?", (file_id, session['nickname']))
    file_data = c.fetchone()
    if file_data:
        if os.path.exists(file_data[0]): os.remove(file_data[0])
        c.execute("DELETE FROM files WHERE id=?", (file_id,))
        conn.commit()
    conn.close()
    return redirect(url_for('dashboard'))

@app.route('/admin', methods=['GET', 'POST'])
def admin_panel():
    if not is_admin(): return redirect(url_for('admin_login'))
        
    conn = sqlite3.connect('database.db')
    c = conn.cursor()

    if request.method == 'POST':
        action = request.form.get('action')
        if action == 'add_user':
            nickname = request.form.get('nickname', '').strip()
            is_admin_flag = 1 if request.form.get('is_admin') else 0
            
            # Check if nickname already exists
            c.execute("SELECT id FROM users WHERE nickname=?", (nickname,))
            if c.fetchone():
                flash("Error: Nickname already exists.")
            else:
                if is_admin_flag:
                    email = request.form.get('email', '').strip().lower()
                    password = request.form.get('password', '').strip()
                    hashed_pw = generate_password_hash(password)
                    try:
                        c.execute("INSERT INTO users (nickname, email, password, is_admin) VALUES (?, ?, ?, 1)", (nickname, email, hashed_pw))
                        conn.commit()
                        flash(f"Admin User '{nickname}' added successfully.")
                    except sqlite3.IntegrityError:
                        flash("Error: Email already exists.")
                else:
                    try:
                        c.execute("INSERT INTO users (nickname, is_admin) VALUES (?, 0)", (nickname,))
                        conn.commit()
                        flash(f"User '{nickname}' added successfully.")
                    except sqlite3.IntegrityError:
                        flash("Error: Nickname already exists.")
        elif action == 'delete_user':
            user_id = request.form.get('user_id')
            c.execute("DELETE FROM users WHERE id=?", (user_id,))
            conn.commit()
            flash("User deleted.")
        elif action == 'delete_file':
            file_id = request.form.get('file_id')
            c.execute("SELECT filepath FROM files WHERE id=?", (file_id,))
            file_data = c.fetchone()
            if file_data and os.path.exists(file_data[0]):
                os.remove(file_data[0])
            c.execute("DELETE FROM files WHERE id=?", (file_id,))
            conn.commit()
            flash("File deleted from server.")
            
        return redirect(url_for('admin_panel', sort=request.args.get('sort', 'date')))

    # Sorting logic
    sort_by = request.args.get('sort', 'date')
    order_clause = "ORDER BY size DESC" if sort_by == 'size' else "ORDER BY timestamp DESC"

    c.execute("SELECT id, nickname, email, is_admin FROM users")
    users = c.fetchall()
    c.execute(f"SELECT id, sender, receiver, filename, size, timestamp, status FROM files {order_clause}")
    pending_files = c.fetchall()
    
    # FIX: Calculate storage per user so Chart.js doesn't crash the template
    c.execute("SELECT receiver, SUM(size) FROM files GROUP BY receiver")
    storage_data = {row[0]: row[1] for row in c.fetchall()}
    
    conn.close()
    return render_template('admin.html', users=users, files=pending_files, storage=storage_data, current_sort=sort_by)

@app.route('/logout')
def logout():
    session.clear()
    return redirect(url_for('login'))

if __name__ == '__main__':
    # Make sure this matches your deployment setup
    app.run(host='127.0.0.1', port=16261, debug=False)
