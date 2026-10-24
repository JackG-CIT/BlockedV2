"""Puts the hard levels (tools/hard_levels.py) somewhere you can playtest them,
without touching the live database:

  1. copies blocked.db to blocked.drafts.db and adds every hard level there as an
     unpublished draft owned by the first captain (they show under "Your drafts");
  2. writes tools/hard_levels_import.txt: one line per level that the standalone
     build's "Import a level" button accepts.

    cd tools
    ..\\.venv\\Scripts\\python drafts.py

Then play them on the site with the copy:
    $env:SQLITE_PATH = "blocked.drafts.db"; ..\\.venv\\Scripts\\python ..\\app.py
"""
import json
import os
import shutil
import sqlite3
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.join(HERE, '..')
sys.path.insert(0, ROOT)
sys.path.insert(0, HERE)
from seed_levels import parse
from hard_levels import HARD


def main():
    live = os.path.join(ROOT, 'blocked.db')
    copy = os.path.join(ROOT, 'blocked.drafts.db')
    shutil.copy(live, copy)
    # Bring the copy's tables up to date (newer columns like difficulty and solution).
    os.environ['SQLITE_PATH'] = copy
    os.environ['DATABASE_URL'] = ''
    import db as dbmod
    dbmod.create_tables()
    db = sqlite3.connect(copy)
    owner = db.execute('SELECT id FROM blocked_users WHERE is_admin = 1 ORDER BY id').fetchone()[0]
    lines = []
    for lv in HARD:
        width, height, tiles = parse(lv)
        cur = db.execute('INSERT INTO blocked_levels (name, notes, width, height, created_by, published, in_campaign, '
                         'position, difficulty, par_moves, solution) VALUES (?, ?, ?, ?, ?, 0, 0, 0, ?, ?, ?)',
                         (lv['name'], lv['notes'], width, height, owner, lv['difficulty'], lv.get('par'), lv['solution']))
        for t in tiles:
            db.execute('INSERT INTO blocked_tiles (level_id, tile_type, x, y, direction, ax, ay) VALUES (?, ?, ?, ?, ?, ?, ?)',
                       (cur.lastrowid, t['type'], t['x'], t['y'], t['direction'], t['aX'], t['aY']))
        lines.append(json.dumps({'name': lv['name'], 'notes': lv['notes'], 'width': width, 'height': height, 'tiles': tiles},
                                separators=(',', ':')))
    db.commit()
    db.close()
    with open(os.path.join(HERE, 'hard_levels_import.txt'), 'w', encoding='utf-8') as f:
        f.write('\n'.join(lines) + '\n')
    print(f'{len(HARD)} hard levels added as drafts to {copy}; import lines in tools/hard_levels_import.txt')


if __name__ == '__main__':
    main()
