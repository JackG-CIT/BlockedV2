import os
import psycopg2
from flask import Flask, render_template, redirect, url_for, request, flash, jsonify
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt

app = Flask(__name__)
app.config['SECRET_KEY'] = 'some_secret_key'  # Use environment variable in production

login_manager = LoginManager(app)
login_manager.login_view = 'login'
bcrypt = Bcrypt(app)

# ----------------- DATABASE CONNECTION -----------------
def get_db_connection():
    conn = psycopg2.connect(
        host='drhscit.org', 
        database='gardnejk1db',
        user='gardnejk1', 
        password='7164'
    )
    return conn

# ----------------- USER CLASS -----------------
class User(UserMixin):
    def __init__(self, id, username, firstname, lastname, email, is_admin, password):
        self.id = id
        self.username = username
        self.firstname = firstname
        self.lastname = lastname
        self.email = email
        self.is_admin = is_admin
        self.password = password

@login_manager.user_loader
def load_user(user_id):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('SELECT id, username, first_name, last_name, email, password, is_admin '
                'FROM BlockedUsers WHERE id = %s', (user_id,))
    user = cur.fetchone()
    cur.close()
    conn.close()
    if user:
        return User(id=user[0], username=user[1], firstname=user[2], lastname=user[3],
                    email=user[4], password=user[5], is_admin=user[6])
    return None

# ----------------- LOGIN/LOGOUT -----------------
@app.route('/login', methods=('GET', 'POST'))
def login():
    if request.method == 'POST':
        username = request.form['username']
        password = request.form['password']

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute('SELECT id, username, first_name, last_name, email, password, is_admin '
                    'FROM BlockedUsers WHERE username = %s', (username,))
        user = cur.fetchone()
        cur.close()
        conn.close()

        if user and bcrypt.check_password_hash(user[5], password):
            user_obj = User(id=user[0], username=user[1], firstname=user[2], lastname=user[3],
                            email=user[4], password=user[5], is_admin=user[6])
            login_user(user_obj)
            nxt = request.args.get('next')
            return redirect(nxt or url_for('index'))
        else:
            flash('Login Unsuccessful. Please check username and password', 'danger')
    return render_template('login.html')

@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))

# ----------------- PLAY LEVEL -----------------
@app.route('/playLevel/<int:levelID>')
@login_required
def playLevel(levelID):
    conn = get_db_connection()
    cur = conn.cursor()

    # Get level info
    cur.execute('SELECT id, level_name, notes, width, height FROM BlockedLevels WHERE id = %s', (levelID,))
    level = cur.fetchone()

    # Get all tiles for this level
    cur.execute(
        'SELECT tile_type, x, y, direction, aX, aY FROM BlockedLevelTiles WHERE level_id = %s',
        (levelID,)
    )
    tiles = cur.fetchall()  # Each row: (tile_type, x, y, direction, aX, aY)

    # Compute user stats for this level
    cur.execute(
        'SELECT finish_time, total_moves FROM blockedusertolevel '
        'WHERE user_id = %s AND level_id = %s',
        (current_user.id, levelID)
    )
    completions = cur.fetchall()  # list of (finish_time, total_moves)

    if completions:
        count = len(completions)
        best_time = min(ft for ft, _ in completions)
        best_moves = min(mv for _, mv in completions)
        avg_time = sum(ft for ft, _ in completions) / count
        avg_moves = sum(mv for _, mv in completions) / count
    else:
        count = 0
        best_time = best_moves = avg_time = avg_moves = None

    cur.close()
    conn.close()

    # Convert tiles to dict for template
    tile_dict = {(t[1], t[2]): t for t in tiles}

    return render_template(
        'play.html',
        level=level,
        tile_dict=tile_dict,
        level_width=level[3],
        level_height=level[4],
        user_stats={
            "count": count,
            "best_time": best_time,
            "best_moves": best_moves,
            "avg_time": avg_time,
            "avg_moves": avg_moves
        }
    )


# ----------------- INDEX -----------------
@app.route('/')
@login_required
def index():
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('SELECT * FROM BlockedLevels ORDER BY id')
    data = cur.fetchall()
    cur.close()
    conn.close()
    return render_template('index.html', data=data)

# ----------------- ADD USER -----------------
@app.route('/addUser', methods=('GET', 'POST'))
def addUser():
    if request.method == 'POST':
        username = request.form['username']
        first = request.form['first']
        last = request.form['last']
        email = request.form['email']
        password = request.form['password']
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
        is_admin = request.form.get('is_admin', False)

        conn = get_db_connection()
        cur = conn.cursor()
        cur.execute("INSERT INTO BlockedUsers (username, first_name, last_name, email, password, is_admin) "
                    "VALUES (%s, %s, %s, %s, %s, %s) RETURNING id",
                    (username, first, last, email, hashed_password, is_admin))
        userid = cur.fetchone()[0]
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for('index'))
    return render_template('addUser.html')

# ----------------- CREATE LEVEL -----------------
@app.route('/create', methods=('GET', 'POST'))
@login_required
def create():
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == 'POST':
        import json
        name = request.form['levelName']
        note = request.form['levelNote']
        width = int(request.form['levelWidth'])
        height = int(request.form['levelHeight'])
        data_json = request.form['data']

        cur.execute(
            'INSERT INTO BlockedLevels (level_name, notes, created_by, width, height) '
            'VALUES (%s, %s, %s, %s, %s) RETURNING id',
            (name, note, current_user.id, width+2, height+2)
        )
        levelID = cur.fetchone()[0]
        conn.commit()

        board = json.loads(data_json)
        for y, row in enumerate(board):
            for x, cell in enumerate(row):
                if cell['type'] is None or cell['type'].lower() == "empty":
                    continue
                cur.execute(
                    'INSERT INTO BlockedLevelTiles (level_id, tile_type, x, y, direction, aX, aY) '
                    'VALUES (%s, %s, %s, %s, %s, %s, %s)',
                    (
                        levelID,
                        cell['type'],
                        x,
                        y,
                        cell.get('direction'),
                        cell.get('aX'),
                        cell.get('aY')
                    )
                )
        conn.commit()
        cur.close()
        conn.close()
        return redirect(url_for('index'))

    cur.execute('SELECT * FROM BlockedLevels')
    levels = cur.fetchall()
    cur.close()
    conn.close()
    return render_template('create.html', levels=levels)

# ----------------- BEAT LEVEL -----------------
@app.route('/beatLevel/<int:levelID>', methods=['POST', 'GET'])
@login_required
def beatLevel(levelID):
    """
    Marks a level as completed by the current user, using GET query params or POST JSON.
    Redirects back to the main page after completion.
    """
    finish_time = request.values.get('finish_time', type=int)  # seconds
    total_moves = request.values.get('total_moves', type=int)
    if finish_time is None:
        finish_time = 0
    if total_moves is None:
        total_moves = 0

    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute(
        'INSERT INTO blockedusertolevel (user_id, level_id, finish_time, total_moves) '
        'VALUES (%s, %s, %s, %s)',
        (current_user.id, levelID, finish_time, total_moves)
    )
    conn.commit()
    cur.close()
    conn.close()

    # Redirect back to index (or could redirect to next level)
    return redirect(url_for('index'))


# ----------------- OTHER ROUTES (edit, delete) -----------------
@app.route('/editLevel/<int:levelID>', methods=('GET', 'POST'))
@login_required
def editLevel(levelID):
    conn = get_db_connection()
    cur = conn.cursor()
    if request.method == 'POST':
        name = request.form['levelName']
        note = request.form['levelNote']
        cur.execute('UPDATE BlockedLevels SET level_name=%s, notes=%s, created_by=%s WHERE id=%s',
                    (name, note, current_user.id, levelID))
        conn.commit()
    cur.execute('SELECT * FROM BlockedLevels WHERE id = %s', (levelID,))
    level = cur.fetchone()
    cur.execute('SELECT * FROM BlockedLevels')
    levels = cur.fetchall()
    cur.close()
    conn.close()
    return render_template('edit.html', curlevel=level, levels=levels)

@app.route('/deleteLevel/<int:levelID>')
@login_required
def deleteLevel(levelID):
    conn = get_db_connection()
    cur = conn.cursor()
    cur.execute('DELETE FROM BlockedLevels WHERE id = %s', (levelID,))
    conn.commit()
    cur.close()
    conn.close()
    return redirect(url_for('index'))

# ----------------- RUN APP -----------------
if __name__ == '__main__':
    app.run(debug=True)
