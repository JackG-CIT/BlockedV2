import os, subprocess, sys, time, json, sqlite3
from playwright.sync_api import sync_playwright
S = sys.argv[1]
cfg = json.load(open(os.path.join(S, 'flowsols.json')))
env = dict(os.environ, SQLITE_PATH=os.path.join(S, 'smoke.db'), DATABASE_URL='', FLASK_DEBUG='0')
srv = subprocess.Popen([r'.venv\Scripts\python', '-m', 'flask', '--app', 'app', 'run', '--port', '5078'],
                       cwd=r'C:\Users\jackk\BlockedV2', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(3)
base = 'http://127.0.0.1:5078'
KEYS = {'U': 'ArrowUp', 'D': 'ArrowDown', 'L': 'ArrowLeft', 'R': 'ArrowRight'}
try:
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(base + '/login')
        fr = pg.frames[1]
        fr.fill('#username', 'flowtester'); fr.fill('#password', 'testpass123'); fr.click('button[type=submit]')
        time.sleep(1.5)
        pg.evaluate('window.__marker = 7')
        frame = lambda: pg.frames[1]
        frame().goto(base + f"/play/{cfg['ids'][0]}")
        time.sleep(1.5)
        quiet_total = samples = 0
        for n, lid in enumerate(cfg['ids'][:5], 1):
            fr = frame()
            assert fr.url.split('?')[0].endswith(f'/play/{lid}'), (fr.url, lid)
            track = pg.evaluate('BlockedSound.playing')
            fr.click('h1')
            for ch in cfg['sols'][str(lid)]:
                fr.press('body', KEYS[ch]); time.sleep(0.03)
            time.sleep(0.4)
            tally = fr.evaluate("!document.getElementById('tally').classList.contains('hidden')")
            popup = fr.evaluate("!document.getElementById('winModal').classList.contains('hidden')")
            print(f"room {n} ({fr.url.split('5078')[1]}): track={track} tally={tally} popup={popup}")
            if n < 5:
                t0 = time.time()
                while time.time() - t0 < 4.5:   # the walk-on: sample the music the whole time
                    pk = pg.evaluate('BlockedSound.peak()'); samples += 1; quiet_total += pk < 0.005
                    time.sleep(0.05)
                    if frame().url.split('?')[0].endswith(f"/play/{cfg['ids'][n]}") and time.time() - t0 > 1: break
                time.sleep(1.2)
        print('shell never reloaded:', pg.evaluate('window.__marker') == 7, f'| silent music samples during walk-ons: {quiet_total}/{samples}')
        # replay a cleared room from the home page: popup with Back to the chapter
        frame().goto(base + f"/play/{cfg['ids'][1]}"); time.sleep(1.2)
        fr = frame(); fr.click('h1')
        for ch in cfg['sols'][str(cfg['ids'][1])]:
            fr.press('body', KEYS[ch]); time.sleep(0.03)
        time.sleep(0.6)
        print('replay of a cleared room -> popup:', fr.evaluate("!document.getElementById('winModal').classList.contains('hidden')"),
              '| chapter link:', fr.evaluate("[...document.querySelectorAll('#winModal a')].map(a => a.textContent.trim())"))
        print('page errors:', errs or 'none')
        b.close()
finally:
    srv.terminate()
db = sqlite3.connect(os.path.join(S, 'smoke.db'))
uid = db.execute("SELECT id FROM blocked_users WHERE username='flowtester'").fetchone()[0]
print('saved completions per room:', db.execute(f"SELECT level_id, COUNT(*) FROM blocked_completions WHERE user_id={uid} GROUP BY level_id").fetchall())
