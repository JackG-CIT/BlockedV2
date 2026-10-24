"""Plays chapter 1 of the voyage end to end on the website (headless Edge), with
solver moves, against a copy of the database. Usage: chapter_test.py <db copy> <sols.json>"""
import json, os, sqlite3, subprocess, sys, time
from playwright.sync_api import sync_playwright
db_path, sols_path = sys.argv[1], sys.argv[2]
cfg = json.load(open(sols_path))
env = dict(os.environ, SQLITE_PATH=db_path, DATABASE_URL='', FLASK_DEBUG='0')
root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
srv = subprocess.Popen([os.path.join(root, '.venv', 'Scripts', 'python'), '-m', 'flask', '--app', 'app', 'run', '--port', '5081'],
                       cwd=root, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(3)
base = 'http://127.0.0.1:5081'
KEYS = {'U': 'ArrowUp', 'D': 'ArrowDown', 'L': 'ArrowLeft', 'R': 'ArrowRight'}
try:
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
        pg.goto(base + '/login')
        fr = pg.frames[1]
        fr.fill('#username', 'chaptertester'); fr.fill('#password', 'testpass123'); fr.click('button[type=submit]')
        time.sleep(1.5)
        frame = lambda: pg.frames[1]
        def here():
            try: return frame().evaluate('location.pathname + location.search')
            except Exception: return ''
        frame().goto(base + f"/play/{cfg['ids'][0]}"); time.sleep(1.5)
        started = None
        for n, lid in enumerate(cfg['ids'][:5], 1):
            fr = frame()
            assert here().split('?')[0].endswith(f'/play/{lid}'), (here(), lid)
            pos = pg.evaluate('BlockedSound.position')
            if n == 1: started = pos['started']
            exits = fr.evaluate("[...document.querySelectorAll('#gameBoard .sp.door, #gameBoard .sp.hatch, #gameBoard .sp.chest')].map(e => e.className.replace('sp ', ''))")
            skulls = fr.locator('.difficulty .skull').count()
            diff = fr.inner_text('.difficulty') if fr.locator('.difficulty').count() else ''
            fr.click('h1')
            for ch in cfg['sols'][str(lid)]:
                fr.press('body', KEYS[ch]); time.sleep(0.025)
            time.sleep(0.5)
            tally = fr.evaluate("!document.getElementById('tally').classList.contains('hidden')")
            popup = fr.evaluate("!document.getElementById('winModal').classList.contains('hidden')")
            same_song = pos['name'] == pg.evaluate('BlockedSound.position')['name'] and (n == 5 or pos['started'] == started)
            print(f"room {n}: music={pos['name']} room={pos.get('room')} song kept={same_song} | exit={exits} | skulls={skulls} '{diff.strip()}' | tally={tally} popup={popup}")
            if n < 5:
                t0 = time.time()
                while time.time() - t0 < 8 and not here().split('?')[0].endswith(f"/play/{cfg['ids'][n]}"):
                    time.sleep(0.1)
                time.sleep(1.2)
        print('page errors:', errs or 'none')
        b.close()
finally:
    srv.terminate()
db = sqlite3.connect(db_path)
uid = db.execute("SELECT id FROM blocked_users WHERE username='chaptertester'").fetchone()[0]
print('completions saved per room:', db.execute(f"SELECT level_id, COUNT(*) FROM blocked_completions WHERE user_id={uid} GROUP BY level_id").fetchall())
