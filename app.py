"""
Club Manager - Web Version with Password Protection
"""

from flask import Flask, render_template, request, jsonify, redirect, url_for, session
import sqlite3
import os
from datetime import datetime
from functools import wraps

app = Flask(__name__)
app.secret_key = 'clubmanager_secret_key_2024'
APP_PASSWORD = '123qwe'
DB_PATH = os.path.join(os.path.dirname(__file__), 'club_manager.db')


def login_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        if not session.get('logged_in'):
            if request.is_json:
                return jsonify({'error': 'Unauthorized'}), 401
            return redirect('/login')
        return f(*args, **kwargs)
    return decorated


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    with get_db() as conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS settings (
                key   TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS game_tables (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                name        TEXT NOT NULL,
                table_type  TEXT NOT NULL CHECK(table_type IN ('billiard','table_tennis')),
                hourly_rate REAL,
                created_at  TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS products (
                id         INTEGER PRIMARY KEY AUTOINCREMENT,
                name       TEXT NOT NULL UNIQUE,
                price      REAL NOT NULL DEFAULT 0.0,
                created_at TEXT DEFAULT (datetime('now'))
            );
            CREATE TABLE IF NOT EXISTS sessions (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                table_id         INTEGER NOT NULL,
                status           TEXT NOT NULL DEFAULT 'active'
                                     CHECK(status IN ('active','paused','finished')),
                start_time       TEXT NOT NULL,
                end_time         TEXT,
                paused_duration  REAL NOT NULL DEFAULT 0.0,
                pause_start      TEXT,
                hourly_rate      REAL NOT NULL,
                FOREIGN KEY (table_id) REFERENCES game_tables(id) ON DELETE CASCADE
            );
            CREATE TABLE IF NOT EXISTS session_products (
                id           INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id   INTEGER NOT NULL,
                product_name TEXT NOT NULL,
                unit_price   REAL NOT NULL,
                quantity     INTEGER NOT NULL DEFAULT 1,
                subtotal     REAL NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
        """)
        defaults = [
            ('billiard_hourly_rate', '10.0'),
            ('table_tennis_hourly_rate', '5.0'),
            ('currency', 'USD'),
        ]
        for key, value in defaults:
            conn.execute("INSERT OR IGNORE INTO settings (key,value) VALUES (?,?)", (key, value))
        conn.commit()


def calculate_totals(session):
    now = datetime.now()
    paused_duration = session['paused_duration'] or 0.0
    if session['status'] == 'finished' and session['end_time']:
        end = datetime.fromisoformat(session['end_time'])
    else:
        end = now
    if session['status'] == 'paused' and session['pause_start']:
        pause_start = datetime.fromisoformat(session['pause_start'])
        paused_duration += (now - pause_start).total_seconds()
    start = datetime.fromisoformat(session['start_time'])
    elapsed = max(0.0, (end - start).total_seconds() - paused_duration)
    time_cost = (elapsed / 3600.0) * session['hourly_rate']
    with get_db() as conn:
        row = conn.execute(
            "SELECT COALESCE(SUM(subtotal),0) as total FROM session_products WHERE session_id=?",
            (session['id'],)
        ).fetchone()
        products_cost = row['total']
    return {
        'elapsed_seconds': elapsed,
        'time_cost': round(time_cost, 2),
        'products_cost': round(products_cost, 2),
        'total': round(time_cost + products_cost, 2),
    }


# ── AUTH ──

@app.route('/login', methods=['GET', 'POST'])
def login():
    error = ''
    if request.method == 'POST':
        pwd = request.form.get('password', '')
        if pwd == APP_PASSWORD:
            session['logged_in'] = True
            return redirect('/')
        else:
            error = 'Неверный пароль!'
    return render_template('login.html', error=error)


@app.route('/logout')
def logout():
    session.clear()
    return redirect('/login')


# ── PAGES ──

@app.route('/')
@login_required
def index():
    return render_template('index.html')


# ── API SETTINGS ──

@app.route('/api/settings', methods=['GET'])
@login_required
def get_settings():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM settings").fetchall()
        return jsonify({r['key']: r['value'] for r in rows})


@app.route('/api/settings', methods=['POST'])
@login_required
def save_settings():
    data = request.json
    with get_db() as conn:
        for key, value in data.items():
            conn.execute("INSERT OR REPLACE INTO settings (key,value) VALUES (?,?)", (key, value))
        conn.commit()
    return jsonify({'ok': True})


# ── API TABLES ──

@app.route('/api/tables', methods=['GET'])
@login_required
def get_tables():
    table_type = request.args.get('type')
    with get_db() as conn:
        if table_type:
            rows = conn.execute("SELECT * FROM game_tables WHERE table_type=? ORDER BY id", (table_type,)).fetchall()
        else:
            rows = conn.execute("SELECT * FROM game_tables ORDER BY table_type, id").fetchall()
        tables = []
        for r in rows:
            t = dict(r)
            s = conn.execute("SELECT * FROM sessions WHERE table_id=? AND status IN ('active','paused')", (t['id'],)).fetchone()
            if s:
                t['session'] = dict(s)
                t['totals'] = calculate_totals(dict(s))
                t['status'] = s['status']
            else:
                t['session'] = None
                t['totals'] = None
                t['status'] = 'free'
            tables.append(t)
    return jsonify(tables)


@app.route('/api/tables', methods=['POST'])
@login_required
def add_table():
    data = request.json
    name = data.get('name', '').strip()
    table_type = data.get('table_type')
    hourly_rate = data.get('hourly_rate') or None
    if not name:
        return jsonify({'error': 'Name is required'}), 400
    with get_db() as conn:
        exists = conn.execute("SELECT id FROM game_tables WHERE name=? AND table_type=?", (name, table_type)).fetchone()
        if exists:
            return jsonify({'error': 'Table name already exists'}), 400
        cur = conn.execute("INSERT INTO game_tables (name, table_type, hourly_rate) VALUES (?,?,?)", (name, table_type, hourly_rate))
        conn.commit()
        return jsonify({'id': cur.lastrowid})


@app.route('/api/tables/<int:tid>', methods=['PUT'])
@login_required
def update_table(tid):
    data = request.json
    with get_db() as conn:
        conn.execute("UPDATE game_tables SET name=?, hourly_rate=? WHERE id=?", (data['name'], data.get('hourly_rate'), tid))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/tables/<int:tid>', methods=['DELETE'])
@login_required
def delete_table(tid):
    with get_db() as conn:
        active = conn.execute("SELECT id FROM sessions WHERE table_id=? AND status IN ('active','paused')", (tid,)).fetchone()
        if active:
            return jsonify({'error': 'Table has active session'}), 400
        conn.execute("DELETE FROM game_tables WHERE id=?", (tid,))
        conn.commit()
    return jsonify({'ok': True})


# ── API SESSIONS ──

@app.route('/api/sessions/start', methods=['POST'])
@login_required
def start_session():
    data = request.json
    table_id = data['table_id']
    with get_db() as conn:
        table = conn.execute("SELECT * FROM game_tables WHERE id=?", (table_id,)).fetchone()
        if not table:
            return jsonify({'error': 'Table not found'}), 404
        active = conn.execute("SELECT id FROM sessions WHERE table_id=? AND status IN ('active','paused')", (table_id,)).fetchone()
        if active:
            return jsonify({'error': 'Session already active'}), 400
        rate = table['hourly_rate']
        if rate is None:
            key = f"{table['table_type']}_hourly_rate"
            setting = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
            rate = float(setting['value']) if setting else 0.0
        now = datetime.now().isoformat()
        cur = conn.execute("INSERT INTO sessions (table_id, status, start_time, hourly_rate) VALUES (?,?,?,?)", (table_id, 'active', now, rate))
        conn.commit()
        return jsonify({'session_id': cur.lastrowid})


@app.route('/api/sessions/<int:sid>/pause', methods=['POST'])
@login_required
def pause_session(sid):
    now = datetime.now().isoformat()
    with get_db() as conn:
        conn.execute("UPDATE sessions SET status='paused', pause_start=? WHERE id=?", (now, sid))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/sessions/<int:sid>/resume', methods=['POST'])
@login_required
def resume_session(sid):
    now = datetime.now()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        if row and row['pause_start']:
            pause_start = datetime.fromisoformat(row['pause_start'])
            extra = (now - pause_start).total_seconds()
            new_paused = (row['paused_duration'] or 0) + extra
            conn.execute("UPDATE sessions SET status='active', pause_start=NULL, paused_duration=? WHERE id=?", (new_paused, sid))
            conn.commit()
    return jsonify({'ok': True})


@app.route('/api/sessions/<int:sid>/end', methods=['POST'])
@login_required
def end_session(sid):
    now = datetime.now()
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        paused_duration = row['paused_duration'] or 0
        if row['status'] == 'paused' and row['pause_start']:
            pause_start = datetime.fromisoformat(row['pause_start'])
            paused_duration += (now - pause_start).total_seconds()
        conn.execute("UPDATE sessions SET status='finished', end_time=?, paused_duration=?, pause_start=NULL WHERE id=?", (now.isoformat(), paused_duration, sid))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/sessions/<int:sid>/reset', methods=['POST'])
@login_required
def reset_session(sid):
    with get_db() as conn:
        conn.execute("DELETE FROM sessions WHERE id=?", (sid,))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/sessions/<int:sid>/totals', methods=['GET'])
@login_required
def session_totals(sid):
    with get_db() as conn:
        row = conn.execute("SELECT * FROM sessions WHERE id=?", (sid,)).fetchone()
        if not row:
            return jsonify({'error': 'Not found'}), 404
        return jsonify(calculate_totals(dict(row)))


@app.route('/api/sessions/history', methods=['GET'])
@login_required
def session_history():
    table_type = request.args.get('type', '')
    with get_db() as conn:
        if table_type:
            rows = conn.execute("""
                SELECT s.*, g.name as table_name, g.table_type
                FROM sessions s JOIN game_tables g ON g.id=s.table_id
                WHERE s.status='finished' AND g.table_type=?
                ORDER BY s.start_time DESC
            """, (table_type,)).fetchall()
        else:
            rows = conn.execute("""
                SELECT s.*, g.name as table_name, g.table_type
                FROM sessions s JOIN game_tables g ON g.id=s.table_id
                WHERE s.status='finished'
                ORDER BY s.start_time DESC
            """).fetchall()
        result = []
        for r in rows:
            s = dict(r)
            s['totals'] = calculate_totals(s)
            result.append(s)
    return jsonify(result)


# ── API SESSION PRODUCTS ──

@app.route('/api/sessions/<int:sid>/products', methods=['GET'])
@login_required
def get_session_products(sid):
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM session_products WHERE session_id=? ORDER BY id", (sid,)).fetchall()
        return jsonify([dict(r) for r in rows])


@app.route('/api/sessions/<int:sid>/products', methods=['POST'])
@login_required
def add_session_product(sid):
    data = request.json
    subtotal = data['unit_price'] * data['quantity']
    with get_db() as conn:
        cur = conn.execute("INSERT INTO session_products (session_id,product_name,unit_price,quantity,subtotal) VALUES (?,?,?,?,?)",
                           (sid, data['product_name'], data['unit_price'], data['quantity'], subtotal))
        conn.commit()
        return jsonify({'id': cur.lastrowid})


@app.route('/api/session_products/<int:item_id>', methods=['PUT'])
@login_required
def update_session_product(item_id):
    data = request.json
    qty = data['quantity']
    with get_db() as conn:
        row = conn.execute("SELECT unit_price FROM session_products WHERE id=?", (item_id,)).fetchone()
        if row:
            subtotal = row['unit_price'] * qty
            conn.execute("UPDATE session_products SET quantity=?, subtotal=? WHERE id=?", (qty, subtotal, item_id))
            conn.commit()
    return jsonify({'ok': True})


@app.route('/api/session_products/<int:item_id>', methods=['DELETE'])
@login_required
def delete_session_product(item_id):
    with get_db() as conn:
        conn.execute("DELETE FROM session_products WHERE id=?", (item_id,))
        conn.commit()
    return jsonify({'ok': True})


# ── API PRODUCTS ──

@app.route('/api/products', methods=['GET'])
@login_required
def get_products():
    with get_db() as conn:
        rows = conn.execute("SELECT * FROM products ORDER BY name").fetchall()
        return jsonify([dict(r) for r in rows])


@app.route('/api/products', methods=['POST'])
@login_required
def add_product():
    data = request.json
    name = data.get('name', '').strip()
    price = data.get('price', 0)
    if not name:
        return jsonify({'error': 'Name required'}), 400
    with get_db() as conn:
        exists = conn.execute("SELECT id FROM products WHERE name=?", (name,)).fetchone()
        if exists:
            return jsonify({'error': 'Product already exists'}), 400
        cur = conn.execute("INSERT INTO products (name,price) VALUES (?,?)", (name, price))
        conn.commit()
        return jsonify({'id': cur.lastrowid})


@app.route('/api/products/<int:pid>', methods=['PUT'])
@login_required
def update_product(pid):
    data = request.json
    with get_db() as conn:
        conn.execute("UPDATE products SET name=?, price=? WHERE id=?", (data['name'], data['price'], pid))
        conn.commit()
    return jsonify({'ok': True})


@app.route('/api/products/<int:pid>', methods=['DELETE'])
@login_required
def delete_product(pid):
    with get_db() as conn:
        conn.execute("DELETE FROM products WHERE id=?", (pid,))
        conn.commit()
    return jsonify({'ok': True})


if __name__ == '__main__':
    init_db()
    print("\n" + "="*50)
    print("  Club Manager Web запущен!")
    print("  Открой в браузере: http://localhost:5000")
    print("="*50 + "\n")
    app.run(host='0.0.0.0', port=5000, debug=False)
