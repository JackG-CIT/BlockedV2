import os
import re
import threading
from urllib.parse import urlparse

import click
from dotenv import load_dotenv
from flask import Flask, render_template, redirect, url_for, request, flash, jsonify, abort
from markupsafe import Markup
from flask_login import LoginManager, UserMixin, login_user, login_required, logout_user, current_user
from flask_bcrypt import Bcrypt

load_dotenv()

import db  # noqa: E402  (reads DATABASE_URL, so it has to come after load_dotenv)

app = Flask(__name__)
app.config['SECRET_KEY'] = os.environ.get('SECRET_KEY', 'dev-only-secret-change-me')

login_manager = LoginManager(app)
login_manager.login_view = 'login'
login_manager.login_message = 'Log in to set sail.'
login_manager.login_message_category = 'error'
bcrypt = Bcrypt(app)
db.init_app(app)

TILE_TYPES = ('player', 'wall', 'box', 'pressureplate', 'cannon', 'fuse', 'exit')
DIRECTIONS = ('up', 'down', 'left', 'right')
MIN_SIZE, MAX_SIZE = 3, 30
USERNAME_RE = re.compile(r'^[A-Za-z0-9_]{3,20}$')


@app.context_processor
def template_helpers():
    def asset(filename):
        """Static URL with the file's modified time attached, so browsers never use stale CSS/JS."""
        try:
            version = int(os.path.getmtime(os.path.join(app.static_folder, filename)))
        except OSError:
            version = 0
        return url_for('static', filename=filename, v=version)

    # Songs you've dropped into static/audio replace the built-in synth music.
    music_files = {}
    for song in MUSIC_SLOTS + ('voyage', 'deep'):
        for ext in ('mp3', 'ogg', 'm4a', 'wav'):
            if os.path.exists(os.path.join(app.static_folder, 'audio', f'{song}.{ext}')):
                music_files[song] = asset(f'audio/{song}.{ext}')
                break
    import rating
    return {'asset': asset, 'music_files': music_files, 'difficulty_name': rating.name,
            'skulls': skull_icons}


@app.template_filter('duration')
def duration(ms):
    if ms is None:
        return '-'
    seconds = ms / 1000
    if seconds < 60:
        return f'{seconds:.1f}s'
    return f'{int(seconds // 60)}:{seconds % 60:04.1f}'


# ----------------- USER CLASS -----------------
class User(UserMixin):
    def __init__(self, row):
        self.id = row['id']
        self.username = row['username']
        self.email = row['email']
        self.is_admin = bool(row['is_admin'])


@login_manager.user_loader
def load_user(user_id):
    row = db.query('SELECT id, username, email, is_admin FROM blocked_users WHERE id = ?',
                   (int(user_id),), one=True)
    return User(row) if row else None


def safe_next(target):
    """Only follow ?next= links that stay on this site."""
    if target and target.startswith('/') and not target.startswith('//') and not urlparse(target).netloc:
        return target
    return url_for('index')


# ----------------- LEVEL HELPERS -----------------
LEVEL_COLUMNS = ('l.id, l.name, l.notes, l.width, l.height, l.created_by, l.published, '
                 'l.in_campaign, l.position, l.difficulty, l.par_moves, l.transition_line, l.solution, '
                 'u.username AS author')


def fetch_levels(where='1 = 1', args=(), order='l.id'):
    return db.query(f'SELECT {LEVEL_COLUMNS} FROM blocked_levels l '
                    f'LEFT JOIN blocked_users u ON u.id = l.created_by '
                    f'WHERE {where} ORDER BY {order}', args)


def tiles_for(level_ids):
    """Returns {level_id: [tile, ...]} in the format the game engine reads."""
    out = {level_id: [] for level_id in level_ids}
    if not level_ids:
        return out
    marks = ', '.join('?' * len(level_ids))
    rows = db.query(f'SELECT level_id, tile_type, x, y, direction, ax, ay FROM blocked_tiles '
                    f'WHERE level_id IN ({marks}) ORDER BY y, x', tuple(level_ids))
    for r in rows:
        out[r['level_id']].append({'type': r['tile_type'], 'x': r['x'], 'y': r['y'],
                                   'direction': r['direction'], 'aX': r['ax'], 'aY': r['ay']})
    return out


def get_level(level_id):
    rows = fetch_levels('l.id = ?', (level_id,))
    if not rows:
        return None
    level = rows[0]
    level['tiles'] = tiles_for([level_id])[level_id]
    return level


def can_edit(level):
    return current_user.is_authenticated and (current_user.is_admin or level['created_by'] == current_user.id)


def can_see(level):
    return bool(level['published']) or can_edit(level)


def campaign():
    """The main voyage: published campaign levels in play order."""
    return fetch_levels('l.published = 1 AND l.in_campaign = 1', order='l.position, l.id')


def progress_for(user_id):
    rows = db.query('SELECT level_id, COUNT(*) AS runs, MIN(finish_ms) AS best_ms, MIN(total_moves) AS best_moves '
                    'FROM blocked_completions WHERE user_id = ? GROUP BY level_id', (user_id,))
    return {r['level_id']: r for r in rows}


def unlocked_ids(voyage, progress):
    """A voyage level is open if it's the first, you've cleared it, or you've cleared the one before."""
    if current_user.is_admin:
        return {lv['id'] for lv in voyage}
    open_ids, previous_cleared = set(), True
    for lv in voyage:
        cleared = lv['id'] in progress
        if previous_cleared or cleared:
            open_ids.add(lv['id'])
        previous_cleared = cleared
    return open_ids


def level_stats(user_id, level_id):
    rows = db.query('SELECT finish_ms, total_moves FROM blocked_completions WHERE user_id = ? AND level_id = ?',
                    (user_id, level_id))
    if not rows:
        return {'count': 0}
    count = len(rows)
    return {
        'count': count,
        'best_ms': min(r['finish_ms'] for r in rows),
        'best_moves': min(r['total_moves'] for r in rows),
        'avg_ms': sum(r['finish_ms'] for r in rows) / count,
        'avg_moves': sum(r['total_moves'] for r in rows) / count,
    }


def leaderboard(level_id, limit=10):
    return db.query('SELECT u.username, MIN(c.finish_ms) AS best_ms, MIN(c.total_moves) AS best_moves, '
                    'COUNT(*) AS runs FROM blocked_completions c JOIN blocked_users u ON u.id = c.user_id '
                    'WHERE c.level_id = ? GROUP BY u.id, u.username ORDER BY best_ms, best_moves LIMIT ?',
                    (level_id, limit))


# Music slots the pages ask for. static/js/audio.js maps each slot to a track
# (its PLAYLIST), and static/audio/<slot>.mp3 replaces the synth if present.
MUSIC_SLOTS = ('lobby', 'chapter1', 'chapter2', 'chapter3', 'chapter4', 'chapter5', 'chapter6',
               'boss1', 'boss2', 'boss3', 'boss4', 'boss5', 'boss6', 'finale', 'boss', 'milestone')
CHAPTER_SIZE = 5


def skull_icons(difficulty, empty=True):
    """Skull icons for a rating in half-skull steps (1 = half a skull, 10 = five)."""
    full, half = divmod(difficulty, 2)
    out = '<i class="skull"></i>' * full + ('<i class="skull half"></i>' if half else '')
    if empty:
        out += '<i class="skull dim"></i>' * (5 - full - half)
    return Markup(f'<span class="skulls" aria-hidden="true">{out}</span>')


def chapter_titles():
    try:
        from seed_levels import CHAPTERS
    except ImportError:
        CHAPTERS = []
    return CHAPTERS


def chapters_of(voyage):
    """Splits the voyage into chapters of five: [(number, title, first_index, levels)]."""
    titles = chapter_titles()
    out = []
    for start in range(0, len(voyage), CHAPTER_SIZE):
        n = start // CHAPTER_SIZE
        title = titles[n] if n < len(titles) else 'Uncharted Waters'
        out.append((n + 1, title, start, voyage[start:start + CHAPTER_SIZE]))
    return out


def music_slot(index, total):
    """The voyage comes in chapters of five. Each chapter's last level gets that
    chapter's grand boss version (boss1-boss6); the voyage's final level gets the finale."""
    chapter = min(index // CHAPTER_SIZE + 1, 6)
    if index == total - 1:
        return 'finale'
    if (index + 1) % CHAPTER_SIZE == 0:
        return f'boss{chapter}'
    return f'chapter{chapter}'


def engine_level(level):
    """Just the parts of a level the game engine needs."""
    return {'id': level['id'], 'name': level['name'], 'width': level['width'],
            'height': level['height'], 'tiles': level['tiles']}


# ----------------- MUSIC SHELL -----------------
@app.before_request
def music_shell():
    """A page opened straight in the browser gets a small shell page instead,
    which plays the music and shows the real page in a frame. Moving around the
    site then only changes the frame, so the music never stops. Browsers say
    whether a request is for the whole tab or a frame (Sec-Fetch-Dest); ones that
    don't say get the plain page."""
    if (request.method == 'GET' and request.headers.get('Sec-Fetch-Dest') == 'document'
            and request.endpoint not in (None, 'static') and not request.path.startswith('/api/')):
        return render_template('shell.html', src=request.full_path.rstrip('?'))


# ----------------- LOGIN/LOGOUT/REGISTER -----------------
@app.route('/login', methods=('GET', 'POST'))
def login():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        password = request.form.get('password', '')
        row = db.query('SELECT id, username, email, is_admin, password FROM blocked_users '
                       'WHERE LOWER(username) = LOWER(?)', (username,), one=True)
        if row and bcrypt.check_password_hash(row['password'], password):
            login_user(User(row), remember=bool(request.form.get('remember')))
            return redirect(safe_next(request.args.get('next')))
        flash("That username and password don't match.", 'error')
    return render_template('auth.html', mode='login')


@app.route('/register', methods=('GET', 'POST'))
def register():
    if current_user.is_authenticated:
        return redirect(url_for('index'))
    if request.method == 'POST':
        username = request.form.get('username', '').strip()
        email = request.form.get('email', '').strip() or None
        password = request.form.get('password', '')
        confirm = request.form.get('confirm', '')

        errors = []
        if not USERNAME_RE.match(username):
            errors.append('Usernames are 3-20 letters, numbers or underscores.')
        elif db.query('SELECT id FROM blocked_users WHERE LOWER(username) = LOWER(?)', (username,), one=True):
            errors.append('That username is taken.')
        if len(password) < 6:
            errors.append('Passwords need at least 6 characters.')
        elif password != confirm:
            errors.append("The two passwords don't match.")
        if errors:
            for e in errors:
                flash(e, 'error')
            return render_template('auth.html', mode='register', username=username, email=email or '')

        first_user = db.query('SELECT COUNT(*) AS n FROM blocked_users', one=True)['n'] == 0
        hashed = bcrypt.generate_password_hash(password).decode('utf-8')
        user_id = db.insert('INSERT INTO blocked_users (username, email, password, is_admin) VALUES (?, ?, ?, ?)',
                            (username, email, hashed, 1 if first_user else 0))
        db.commit()
        login_user(load_user(user_id))
        if first_user:
            flash("Welcome aboard, Captain! You're the first sailor, so you're the admin and can build the main voyage.", 'ok')
        else:
            flash(f'Welcome aboard, {username}!', 'ok')
        return redirect(url_for('index'))
    return render_template('auth.html', mode='register')


@app.route('/logout')
def logout():
    logout_user()
    return redirect(url_for('login'))


# ----------------- INDEX -----------------
@app.route('/')
def index():
    if not current_user.is_authenticated:
        return render_template('index.html', guest=True)

    progress = progress_for(current_user.id)
    voyage = campaign()
    open_ids = unlocked_ids(voyage, progress)
    community = fetch_levels('l.published = 1 AND l.in_campaign = 0', order='l.id DESC')
    drafts = fetch_levels('l.published = 0 AND l.created_by = ?', (current_user.id,), order='l.id DESC')

    # Locked levels don't send their layouts, so there's nothing to peek at.
    shown = [lv for lv in voyage if lv['id'] in open_ids] + community + drafts
    tiles = tiles_for([lv['id'] for lv in shown])
    previews = {lv['id']: {'width': lv['width'], 'height': lv['height'], 'tiles': tiles[lv['id']]} for lv in shown}

    return render_template('index.html', guest=False, voyage=voyage, chapters=chapters_of(voyage),
                           open_ids=open_ids, community=community,
                           drafts=drafts, progress=progress, previews=previews,
                           cleared=sum(1 for lv in voyage if lv['id'] in progress), can_edit=can_edit)


# ----------------- PLAY LEVEL -----------------
@app.route('/play/<int:level_id>')
@login_required
def play(level_id):
    level = get_level(level_id)
    if not level or not can_see(level):
        abort(404)

    next_url, place, music = None, None, 'voyage'
    room, flow, auto_advance, chapter_url = 0, False, False, None
    if level['in_campaign'] and level['published']:
        voyage = campaign()
        progress = progress_for(current_user.id)
        if level_id not in unlocked_ids(voyage, progress):
            flash('That level is still locked. Clear the one before it first.', 'error')
            return redirect(url_for('index'))
        ids = [lv['id'] for lv in voyage]
        i = ids.index(level_id)
        chapter = chapters_of(voyage)[i // CHAPTER_SIZE]
        test = ' · Chapter test' if (i + 1) % CHAPTER_SIZE == 0 else ''
        place = f'Chapter {chapter[0]}: {chapter[1]} · Level {i + 1} of {len(ids)}{test}'
        music = music_slot(i, len(ids))
        room = i % CHAPTER_SIZE + 1              # 1-5 within the chapter; 5 is the boss room
        chapter_url = url_for('index') + f'#chapter-{chapter[0]}'
        # Playing through the chapter (arrived from the room before, or not cleared
        # yet) walks straight on to the next room. Replaying a cleared room from the
        # home page gets the normal win popup instead.
        flow = request.args.get('flow') == '1' or level_id not in progress
        if i + 1 < len(ids):
            next_url = url_for('play', level_id=ids[i + 1], **({'flow': 1} if flow else {}))
        auto_advance = flow and room < CHAPTER_SIZE and next_url is not None

    payload = {
        'level': engine_level(level),
        'par': level['par_moves'],
        'stats': level_stats(current_user.id, level_id),
        'leaderboard': leaderboard(level_id),
        'completeUrl': url_for('complete_level', level_id=level_id),
        'nextUrl': next_url,
        'homeUrl': url_for('index'),
        'chapterUrl': chapter_url,
        'room': room,
        'autoAdvance': auto_advance,
        'entering': request.args.get('flow') == '1',   # walked in from the room before
        'transitionLine': level['transition_line'],
        'route': level['solution'],   # a known solution: hints follow it on big levels
        # Mid-chapter rooms end at a door or trapdoor; the chest waits at the chapter's end.
        'exitStyle': 'door' if 1 <= room < CHAPTER_SIZE else 'chest',
    }
    # The music layers build up room by room (1-4); boss rooms and other pages play in full.
    music_room = room if 1 <= room < CHAPTER_SIZE else 0
    return render_template('play.html', level=level, place=place, payload=payload, music=music,
                           music_room=music_room, can_edit=can_edit(level))


# ----------------- BEAT LEVEL -----------------
@app.route('/api/levels/<int:level_id>/complete', methods=['POST'])
@login_required
def complete_level(level_id):
    """Records a finished run and sends back the player's updated stats."""
    level = get_level(level_id)
    if not level or not can_see(level):
        return jsonify(ok=False, error='Level not found.'), 404
    data = request.get_json(silent=True) or {}
    try:
        moves = int(data.get('moves'))
        time_ms = int(data.get('time_ms'))
    except (TypeError, ValueError):
        return jsonify(ok=False, error='Bad result.'), 400
    if moves < 1 or time_ms < 0:
        return jsonify(ok=False, error='Bad result.'), 400

    before = level_stats(current_user.id, level_id)
    db.insert('INSERT INTO blocked_completions (user_id, level_id, finish_ms, total_moves) VALUES (?, ?, ?, ?)',
              (current_user.id, level_id, time_ms, moves))
    db.commit()
    first = before['count'] == 0
    return jsonify(
        ok=True,
        stats=level_stats(current_user.id, level_id),
        leaderboard=leaderboard(level_id),
        newBestTime=first or time_ms < before['best_ms'],
        newBestMoves=first or moves < before['best_moves'],
    )


# ----------------- CREATE / EDIT LEVEL -----------------
def render_editor(level):
    next_position = (db.query('SELECT MAX(position) AS p FROM blocked_levels WHERE in_campaign = 1',
                              one=True)['p'] or 0) + 1
    payload = {
        'level': level,
        'isAdmin': current_user.is_admin,
        'saveUrl': url_for('update_level', level_id=level['id']) if level else url_for('create_level'),
        'createUrl': url_for('create_level'),
        'playUrl': url_for('play', level_id=level['id']) if level else None,
        'nextPosition': next_position,
        'limits': {'min': MIN_SIZE, 'max': MAX_SIZE},
        'flow': flow_neighbours(level),
        'exitStyle': editor_exit_style(level),
    }
    return render_template('editor.html', level=level, payload=payload)


def editor_exit_style(level):
    """Voyage rooms 1-4 of a chapter end at a door or trapdoor; everything else at a chest."""
    if not level or not level['in_campaign']:
        return 'chest'
    ids = [lv['id'] for lv in campaign()]
    if level['id'] not in ids:
        return 'chest'
    return 'door' if ids.index(level['id']) % CHAPTER_SIZE < CHAPTER_SIZE - 1 else 'chest'


def flow_neighbours(level):
    """For a voyage room: the previous room's exit side and the next room's
    entrance side in the same chapter, so the editor can warn if they don't line up."""
    if not level or not level['in_campaign']:
        return None
    import flow
    voyage = campaign()
    ids = [lv['id'] for lv in voyage]
    if level['id'] not in ids:
        return None
    i = ids.index(level['id'])
    out = {}
    if i % CHAPTER_SIZE != 0:
        prev = voyage[i - 1]
        out['prevName'] = prev['name']
        out['prevExit'] = sorted(flow.exit_sides(prev['width'], prev['height'], tiles_for([prev['id']])[prev['id']]))
    if (i + 1) % CHAPTER_SIZE != 0 and i + 1 < len(voyage):
        nxt = voyage[i + 1]
        out['nextName'] = nxt['name']
        out['nextEntrance'] = sorted(flow.entrance_sides(nxt['width'], nxt['height'], tiles_for([nxt['id']])[nxt['id']]))
    return out


@app.route('/create')
@login_required
def create():
    return render_editor(None)


@app.route('/edit/<int:level_id>')
@login_required
def edit(level_id):
    level = get_level(level_id)
    if not level:
        abort(404)
    if not can_edit(level):
        abort(403)
    return render_editor(level)


def _int_or_none(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def clean_level(data):
    """Checks a level sent by the editor. Returns (level, errors)."""
    errors = []
    name = str(data.get('name') or '').strip()[:80]
    notes = str(data.get('notes') or '').strip()[:500]
    width, height = _int_or_none(data.get('width')), _int_or_none(data.get('height'))
    if not name:
        errors.append('Give the level a name.')
    if width is None or height is None or not (MIN_SIZE <= width <= MAX_SIZE and MIN_SIZE <= height <= MAX_SIZE):
        errors.append(f'Width and height must be between {MIN_SIZE} and {MAX_SIZE}.')
        return None, errors

    tiles, seen = [], {}
    for t in data.get('tiles') or []:
        if not isinstance(t, dict):
            continue
        tile_type = str(t.get('type') or '').lower()
        x, y = _int_or_none(t.get('x')), _int_or_none(t.get('y'))
        if tile_type not in TILE_TYPES or x is None or y is None:
            continue
        if not (0 <= x < width and 0 <= y < height):
            continue
        # One tile per square, except that a crate or the pirate may start on
        # top of a plate or fuse.
        layer = 'floor' if tile_type in ('pressureplate', 'fuse') else 'top'
        here = seen.get((x, y))
        if here and (layer in here or not ({'box', 'player'} & ({tile_type} | set(here.values())))):
            continue
        seen.setdefault((x, y), {})[layer] = tile_type
        tile = {'type': tile_type, 'x': x, 'y': y, 'direction': None, 'aX': None, 'aY': None}
        if tile_type == 'cannon':
            tile['direction'] = t.get('direction') if t.get('direction') in DIRECTIONS else 'up'
        if tile_type in ('pressureplate', 'fuse'):
            tile['aX'], tile['aY'] = _int_or_none(t.get('aX')), _int_or_none(t.get('aY'))
        tiles.append(tile)

    published = bool(data.get('published'))
    if published:
        if sum(t['type'] == 'player' for t in tiles) != 1:
            errors.append('A published level needs exactly one pirate (the player start).')
        if not any(t['type'] == 'exit' for t in tiles):
            errors.append('A published level needs at least one treasure chest (the exit).')

    return {'name': name, 'notes': notes, 'width': width, 'height': height,
            'tiles': tiles, 'published': published}, errors


def layout_key(width, height, tiles):
    return (width, height, sorted((t['type'], t['x'], t['y'], t['direction'] or '',
                                   -1 if t['aX'] is None else t['aX'],
                                   -1 if t['aY'] is None else t['aY']) for t in tiles))


def write_tiles(level_id, tiles):
    for t in tiles:
        db.execute('INSERT INTO blocked_tiles (level_id, tile_type, x, y, direction, ax, ay) '
                   'VALUES (?, ?, ?, ?, ?, ?, ?)',
                   (level_id, t['type'], t['x'], t['y'], t['direction'], t['aX'], t['aY']))


def rate_later(level_id, width, height, tiles):
    """Works out a level's difficulty in the background (the solver can take a
    few seconds) and stores it. Until then the level shows no rating."""
    def work():
        import rating
        try:
            result = rating.rate(width, height, tiles)
        except Exception:  # a rating is a nice-to-have; never break saving over it
            app.logger.exception('Rating level %s failed', level_id)
            return
        with app.app_context():
            db.execute('UPDATE blocked_levels SET difficulty = ?, par_moves = ?, solution = ? WHERE id = ?',
                       (result['difficulty'], result['par'], result['solution'], level_id))
            db.commit()
    threading.Thread(target=work, daemon=True).start()


def campaign_fields(data, existing=None):
    """Only admins choose what's in the main voyage and its order."""
    if not current_user.is_admin:
        if existing:
            return existing['in_campaign'], existing['position']
        return 0, 0
    position = _int_or_none(data.get('position'))
    return (1 if data.get('in_campaign') else 0), (position if position is not None else 0)


@app.route('/api/levels', methods=['POST'])
@login_required
def create_level():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(ok=False, errors=['Expected JSON.']), 400
    level, errors = clean_level(data)
    if errors:
        return jsonify(ok=False, errors=errors), 400

    in_campaign, position = campaign_fields(data)
    level_id = db.insert('INSERT INTO blocked_levels (name, notes, width, height, created_by, published, '
                         'in_campaign, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                         (level['name'], level['notes'], level['width'], level['height'], current_user.id,
                          1 if level['published'] else 0, in_campaign, position))
    write_tiles(level_id, level['tiles'])
    db.commit()
    rate_later(level_id, level['width'], level['height'], level['tiles'])
    return jsonify(ok=True, id=level_id, editUrl=url_for('edit', level_id=level_id),
                   playUrl=url_for('play', level_id=level_id))


@app.route('/api/levels/<int:level_id>', methods=['POST'])
@login_required
def update_level(level_id):
    existing = get_level(level_id)
    if not existing:
        return jsonify(ok=False, errors=['Level not found.']), 404
    if not can_edit(existing):
        return jsonify(ok=False, errors=["You can't edit this level."]), 403
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify(ok=False, errors=['Expected JSON.']), 400
    level, errors = clean_level(data)
    if errors:
        return jsonify(ok=False, errors=errors), 400

    in_campaign, position = campaign_fields(data, existing)
    layout_changed = (layout_key(existing['width'], existing['height'], existing['tiles'])
                      != layout_key(level['width'], level['height'], level['tiles']))
    db.execute('UPDATE blocked_levels SET name = ?, notes = ?, width = ?, height = ?, published = ?, '
               'in_campaign = ?, position = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
               (level['name'], level['notes'], level['width'], level['height'],
                1 if level['published'] else 0, in_campaign, position, level_id))
    records_cleared = False
    if layout_changed:
        # Old times were set on a different puzzle, so they no longer count.
        had = db.query('SELECT COUNT(*) AS n FROM blocked_completions WHERE level_id = ?', (level_id,), one=True)['n']
        records_cleared = had > 0
        db.execute('DELETE FROM blocked_tiles WHERE level_id = ?', (level_id,))
        db.execute('DELETE FROM blocked_completions WHERE level_id = ?', (level_id,))
        db.execute('UPDATE blocked_levels SET difficulty = NULL, par_moves = NULL, solution = NULL WHERE id = ?',
                   (level_id,))
        write_tiles(level_id, level['tiles'])
    db.commit()
    if layout_changed:
        rate_later(level_id, level['width'], level['height'], level['tiles'])
    return jsonify(ok=True, id=level_id, recordsCleared=records_cleared,
                   playUrl=url_for('play', level_id=level_id))


@app.route('/levels/<int:level_id>/delete', methods=['POST'])
@login_required
def delete_level(level_id):
    level = get_level(level_id)
    if not level:
        abort(404)
    if not can_edit(level):
        abort(403)
    db.execute('DELETE FROM blocked_completions WHERE level_id = ?', (level_id,))
    db.execute('DELETE FROM blocked_tiles WHERE level_id = ?', (level_id,))
    db.execute('DELETE FROM blocked_levels WHERE id = ?', (level_id,))
    db.commit()
    flash(f'"{level["name"]}" was sent to Davy Jones\' locker.', 'ok')
    return redirect(url_for('index'))


# ----------------- SOUND TEST -----------------
@app.route('/sounds')
def sounds():
    return render_template('sounds.html')


# ----------------- CREW (ADMIN) -----------------
@app.route('/crew')
@login_required
def crew():
    if not current_user.is_admin:
        abort(403)
    users = db.query('SELECT u.id, u.username, u.is_admin, '
                     '(SELECT COUNT(*) FROM blocked_levels l WHERE l.created_by = u.id) AS levels, '
                     '(SELECT COUNT(DISTINCT c.level_id) FROM blocked_completions c WHERE c.user_id = u.id) AS cleared '
                     'FROM blocked_users u ORDER BY u.is_admin DESC, LOWER(u.username)')
    return render_template('crew.html', users=users)


@app.route('/crew/<int:user_id>/admin', methods=['POST'])
@login_required
def set_admin(user_id):
    if not current_user.is_admin:
        abort(403)
    make = request.form.get('make') == '1'
    user = db.query('SELECT id, username FROM blocked_users WHERE id = ?', (user_id,), one=True)
    if not user:
        abort(404)
    if not make and user_id == current_user.id:
        flash("You can't take away your own captain's hat. Another captain has to do it.", 'error')
        return redirect(url_for('crew'))
    db.execute('UPDATE blocked_users SET is_admin = ? WHERE id = ?', (1 if make else 0, user_id))
    db.commit()
    flash(f"{user['username']} is now {'a captain' if make else 'a regular crew member'}.", 'ok')
    return redirect(url_for('crew'))


# ----------------- ERRORS -----------------
@app.errorhandler(403)
def forbidden(e):
    return render_template('error.html', code=403, message="That's not your ship to steer."), 403


@app.errorhandler(404)
def not_found(e):
    return render_template('error.html', code=404, message='Nothing here but open water.'), 404


# ----------------- COMMAND LINE -----------------
@app.cli.command('make-admin')
@click.argument('username')
def make_admin(username):
    """Gives USERNAME admin rights (lets them build the main voyage)."""
    with app.app_context():
        row = db.query('SELECT id FROM blocked_users WHERE LOWER(username) = LOWER(?)', (username,), one=True)
        if not row:
            raise click.ClickException(f'No user called {username}.')
        db.execute('UPDATE blocked_users SET is_admin = 1 WHERE id = ?', (row['id'],))
        db.commit()
    click.echo(f'{username} is now an admin.')


@app.cli.command('solve')
@click.argument('level_id')
def solve_level(level_id):
    """Checks a level can be beaten. LEVEL_ID is a level's number, or "all"."""
    from solver import Level, solve, describe
    with app.app_context():
        if level_id == 'all':
            levels = fetch_levels(order='l.in_campaign DESC, l.position, l.id')
        else:
            levels = fetch_levels('l.id = ?', (int(level_id),))
        if not levels:
            raise click.ClickException('No such level.')
        tiles = tiles_for([lv['id'] for lv in levels])
        for lv in levels:
            click.echo(f"#{lv['id']} {lv['name']}: " + describe(solve(Level(lv['width'], lv['height'], tiles[lv['id']]))))


def store_seed_rating(level_id, spec, width, height, tiles):
    """Seed levels carry ratings worked out offline (big levels take the solver
    too long to rate here); any without one are rated now."""
    if 'difficulty' in spec:
        result = {'difficulty': spec['difficulty'], 'par': spec.get('par'), 'solution': spec.get('solution')}
    else:
        import rating
        result = rating.rate(width, height, tiles)
    db.execute('UPDATE blocked_levels SET difficulty = ?, par_moves = ?, transition_line = ?, solution = ? WHERE id = ?',
               (result['difficulty'], result['par'], spec.get('transition'), result['solution'], level_id))


@app.cli.command('rate')
@click.argument('level_id')
@click.option('--max-states', default=400_000, show_default=True,
              help='How far the solver may search. Bigger levels need more (and take longer).')
def rate_levels(level_id, max_states):
    """Re-rates difficulty. LEVEL_ID is a level's number, or "all"."""
    import rating
    with app.app_context():
        levels = fetch_levels() if level_id == 'all' else fetch_levels('l.id = ?', (int(level_id),))
        if not levels:
            raise click.ClickException('No such level.')
        tiles = tiles_for([lv['id'] for lv in levels])
        for lv in levels:
            result = rating.rate(lv['width'], lv['height'], tiles[lv['id']], max_states=max_states)
            if result['score'] is None and lv['difficulty']:
                click.echo(f"#{lv['id']} {lv['name']}: too big to rate here; kept its rating "
                           f"({lv['difficulty'] / 2:g} skulls). Try --max-states, or rate it with tools/.")
                continue
            db.execute('UPDATE blocked_levels SET difficulty = ?, par_moves = ?, solution = COALESCE(?, solution) '
                       'WHERE id = ?', (result['difficulty'], result['par'], result['solution'], lv['id']))
            db.commit()
            par = f", par {result['par']}" if result['par'] else ''
            click.echo(f"#{lv['id']} {lv['name']}: {result['difficulty'] / 2:g} skulls "
                       f"({rating.name(result['difficulty'])}{par})")


@app.cli.command('export-standalone')
def export_standalone_cmd():
    """Builds the standalone (no server) version into dist/standalone and dist/blocked-standalone.zip."""
    import export_standalone
    folder, zip_path, size = export_standalone.export(app, {'min': MIN_SIZE, 'max': MAX_SIZE})
    click.echo(f'Wrote {folder}')
    click.echo(f'Zipped to {zip_path} ({size / 1024:.0f} KB)')


@app.cli.command('check-flow')
@click.option('--verify', is_flag=True, help='Re-solve each suggested mirror/rotation (slow for big rooms).')
def check_flow(verify):
    """Checks each room's exit lines up with the next room's entrance."""
    import flow
    with app.app_context():
        voyage = campaign()
        tiles = tiles_for([lv['id'] for lv in voyage])
        rooms = [dict(lv, tiles=tiles[lv['id']]) for lv in voyage]
        problems = flow.check(rooms, CHAPTER_SIZE, verify=verify)
    if not problems:
        click.echo('Every room lines up with the next one.')
        return
    for p in problems:
        if not p['exit']:
            click.echo(f"note: '{p['room']}' ends at a trapdoor inside the room, so there is no wall side to line up "
                       f"('{p['next']}' starts nearest its {' / '.join(p['entrance'])}).")
            continue
        click.echo(f"'{p['room']}' exits on the {' / '.join(p['exit'])}, but '{p['next']}' starts nearest "
                   f"its {' / '.join(p['entrance'])} (it should enter from the "
                   f"{' / '.join(flow.OPPOSITE[s] for s in p['exit'])}).")
        for fix in p['fixes']:
            notes = []
            if 'keeps_next' in fix:
                notes.append('the room after still lines up' if fix['keeps_next'] else 'but then the room after it no longer lines up')
            if 'verified' in fix:
                notes.append(fix['verified'])
            click.echo(f"    fix: {fix['change']}" + (f" ({'; '.join(notes)})" if notes else ''))
        if not p['fixes']:
            click.echo('    no mirror or rotation fixes it; move the pirate start or the chest instead.')
    click.echo(f"{sum(1 for p in problems if p['exit'])} mismatch(es). Mirrors and rotations change how the squeeze plays out, "
               "so re-check a turned room with --verify (or the solver) before using it.")


@app.cli.command('seed')
@click.option('--refresh', is_flag=True,
              help='Also rewrite voyage levels already in the database to match seed_levels.py.')
def seed(refresh):
    """Adds the voyage levels from seed_levels.py."""
    from seed_levels import LEVELS, parse
    with app.app_context():
        owner = db.query('SELECT id FROM blocked_users WHERE is_admin = 1 ORDER BY id', one=True)
        if not owner:
            raise click.ClickException('Register an account first (the first account becomes the admin).')
        start = (db.query('SELECT MAX(position) AS p FROM blocked_levels WHERE in_campaign = 1', one=True)['p'] or 0)
        added = updated = 0
        for i, spec in enumerate(LEVELS, start=1):
            width, height, tiles = parse(spec)
            existing = None
            # A level renamed in seed_levels.py lists its old names under 'was'.
            for name in (spec['name'], *spec.get('was', ())):
                existing = existing or db.query('SELECT id FROM blocked_levels WHERE name = ?', (name,), one=True)
            if existing:
                if not refresh:
                    continue
                current = get_level(existing['id'])
                if layout_key(current['width'], current['height'], current['tiles']) != layout_key(width, height, tiles):
                    db.execute('DELETE FROM blocked_tiles WHERE level_id = ?', (existing['id'],))
                    db.execute('DELETE FROM blocked_completions WHERE level_id = ?', (existing['id'],))
                    write_tiles(existing['id'], tiles)
                # --refresh also puts the voyage back in seed_levels.py's order.
                db.execute('UPDATE blocked_levels SET name = ?, notes = ?, width = ?, height = ?, '
                           'in_campaign = 1, position = ? WHERE id = ?',
                           (spec['name'], spec['notes'], width, height, i, existing['id']))
                store_seed_rating(existing['id'], spec, width, height, tiles)
                updated += 1
                continue
            level_id = db.insert('INSERT INTO blocked_levels (name, notes, width, height, created_by, published, '
                                 'in_campaign, position) VALUES (?, ?, ?, ?, ?, 1, 1, ?)',
                                 (spec['name'], spec['notes'], width, height, owner['id'],
                                  i if refresh else start + i))
            write_tiles(level_id, tiles)
            store_seed_rating(level_id, spec, width, height, tiles)
            added += 1
        db.commit()
    click.echo(f'Added {added} level(s)' + (f', refreshed {updated}.' if refresh else '.'))


# ----------------- RUN APP -----------------
if __name__ == '__main__':
    app.run(debug=os.environ.get('FLASK_DEBUG', '1') == '1')
