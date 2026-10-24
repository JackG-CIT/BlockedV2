"""Builds the standalone version of the game: `flask --app app export-standalone`.

Writes dist/standalone/ (a folder of static files that runs anywhere, with no
server, accounts or network requests) and dist/blocked-standalone.zip.

The standalone build reuses the website's game code unchanged (engine.js,
solver.js, hints.js, audio.js, editor.js, soundmenu.js, the sprites and
style.css) plus a little glue in static/standalone/. The voyage comes from
seed_levels.py, with a stored solution for every level so hints work even on
levels too big to solve in the browser.
"""
import json
import os
import re
import shutil
import zipfile

import seed_levels
from seed_levels import LEVELS, parse
from solver import Level, solve

ROOT = os.path.dirname(os.path.abspath(__file__))
DIST = os.path.join(ROOT, 'dist')
OUT = os.path.join(DIST, 'standalone')
CHAPTER_SIZE = 5

SHARED_JS = ['engine.js', 'solver.js', 'hints.js', 'audio.js', 'editor.js', 'soundmenu.js']
STANDALONE_JS = ['standalone.js', 'portal.js']


def slug(name):
    return re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')


def mechanics(width, height, tiles, solution):
    """Which mechanics a level uses, for the first-time "how it works" popups.
    The squeeze and loaded fuses are found by replaying the solution."""
    kinds = {t['type'] for t in tiles}
    found = []
    if 'pressureplate' in kinds:
        found.append('plates')
    if 'fuse' in kinds:
        found.append('cannons')
    level = Level(width, height, tiles)
    fuses = {f for f, _ in level.fuses}
    state = level.start
    squeeze = loaded = False
    for d in solution or '':
        player, boxes, _ = state
        dx, dy = {'U': (0, -1), 'D': (0, 1), 'L': (-1, 0), 'R': (1, 0)}[d]
        nxt = (player[0] + dx, player[1] + dy)
        expected = set(boxes)
        if nxt in boxes:
            expected = (expected - {nxt}) | {(nxt[0] + dx, nxt[1] + dy)}
        state = level.move(state, d)
        if state is None:
            break
        after = state[1]
        # Same number of crates but one somewhere it wasn't pushed: a gate squeezed it.
        if len(after) == len(expected) and set(after) != expected:
            squeeze = True
        if fuses & set(after):
            loaded = True
    if squeeze:
        found.append('squeeze')
    if loaded:
        found.append('loaded')
    return found


def level_data():
    out = []
    for i, spec in enumerate(LEVELS):
        width, height, tiles = parse(spec)
        solution = spec.get('solution')
        if not solution:
            result = solve(Level(width, height, tiles), max_states=2_000_000)
            solution = result.get('solution')
        room = i % CHAPTER_SIZE + 1
        out.append({
            'id': slug(spec['name']),
            'name': spec['name'],
            'notes': spec.get('notes', ''),
            'chapter': i // CHAPTER_SIZE + 1,
            'room': room,
            'width': width,
            'height': height,
            'tiles': tiles,
            'difficulty': spec.get('difficulty'),
            'par': spec.get('par'),
            'transition': spec.get('transition'),
            'solution': solution,
            'mechanics': mechanics(width, height, tiles, solution) + (['doors'] if room < CHAPTER_SIZE else []),
        })
    return out


def export(app, limits):
    """Builds dist/standalone and the zip. Returns (folder, zip path, zip size)."""
    from flask import render_template
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    for sub in ('js', 'css', 'img', 'fonts'):
        os.makedirs(os.path.join(OUT, sub))
    static = app.static_folder
    for name in SHARED_JS:
        shutil.copy(os.path.join(static, 'js', name), os.path.join(OUT, 'js', name))
    for name in STANDALONE_JS:
        shutil.copy(os.path.join(static, 'standalone', name), os.path.join(OUT, 'js', name))
    shutil.copy(os.path.join(static, 'css', 'style.css'), os.path.join(OUT, 'css', 'style.css'))
    shutil.copy(os.path.join(static, 'standalone', 'standalone.css'), os.path.join(OUT, 'css', 'standalone.css'))
    for name in os.listdir(os.path.join(static, 'img')):
        if name.endswith('.svg'):
            shutil.copy(os.path.join(static, 'img', name), os.path.join(OUT, 'img', name))
    for name in os.listdir(os.path.join(static, 'fonts')):
        shutil.copy(os.path.join(static, 'fonts', name), os.path.join(OUT, 'fonts', name))

    chapters = getattr(seed_levels, 'CHAPTERS', [])
    chapters = chapters + [f'Chapter {n + 1}' for n in range(len(chapters), -(-len(LEVELS) // CHAPTER_SIZE))]
    data = {'chapters': chapters, 'chapterSize': CHAPTER_SIZE, 'limits': limits, 'levels': level_data()}
    with open(os.path.join(OUT, 'js', 'levels.js'), 'w', encoding='utf-8') as f:
        f.write('// The voyage, written by `flask --app app export-standalone` from seed_levels.py.\n')
        f.write('window.BLOCKED_DATA = ' + json.dumps(data, separators=(',', ':')) + ';\n')
    with app.test_request_context():
        html = render_template('standalone.html', limits=limits)
    with open(os.path.join(OUT, 'index.html'), 'w', encoding='utf-8') as f:
        f.write(html)

    zip_path = os.path.join(DIST, 'blocked-standalone.zip')
    with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for folder, _, files in os.walk(OUT):
            for name in files:
                full = os.path.join(folder, name)
                z.write(full, os.path.relpath(full, OUT))
    return OUT, zip_path, os.path.getsize(zip_path)
