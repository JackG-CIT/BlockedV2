import os, subprocess, sys, time, statistics
from playwright.sync_api import sync_playwright
S = sys.argv[1]
env = dict(os.environ, SQLITE_PATH=os.path.join(S, 'smoke.db'), DATABASE_URL='', FLASK_DEBUG='0')
srv = subprocess.Popen([r'.venv\Scripts\python', '-m', 'flask', '--app', 'app', 'run', '--port', '5077'],
                       cwd=r'C:\Users\jackk\BlockedV2', env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(3)
base = 'http://127.0.0.1:5077'
try:
    with sync_playwright() as p:
        b = p.chromium.launch(channel='msedge', args=['--autoplay-policy=no-user-gesture-required'])
        pg = b.new_page()
        errs = []
        pg.on('pageerror', lambda e: errs.append(str(e)))
        pg.goto(base + '/login')
        print('shell on top:', pg.evaluate('!!window.BLOCKED_SHELL'), '| frame:', pg.frames[1].url)
        fr = pg.frames[1]
        fr.fill('#username', 'tester'); fr.fill('#password', 'testpass123')
        fr.click('button[type=submit]')
        fr.wait_for_load_state(); time.sleep(1)
        pg.evaluate('window.__marker = 42')
        print('after login, address bar:', pg.url, '| playing:', pg.evaluate('BlockedSound.playing'))
        time.sleep(3)
        # go to level 1 and sample the music level the whole time
        peaks = []
        fr = pg.frames[1]
        fr.evaluate("document.querySelector('a.stretched[href*=\"/play/1\"]').click()")
        t0 = time.time()
        while time.time() - t0 < 3:
            peaks.append(pg.evaluate('BlockedSound.peak()')); time.sleep(0.03)
        quiet = sum(p < 0.01 for p in peaks) / len(peaks)
        print('level 1 address bar:', pg.url, '| marker kept (no reload):', pg.evaluate('window.__marker') == 42,
              '| playing:', pg.evaluate('BlockedSound.playing'), f'| silent samples during change: {quiet:.0%}')
        fr = pg.frames[1]
        fr.click('body')
        for ch in 'RRRDDLLDDRRRRRRUUURRDDDD' if False else '':
            pass
        sol = sys.argv[2]
        keys = {'U': 'ArrowUp', 'D': 'ArrowDown', 'L': 'ArrowLeft', 'R': 'ArrowRight'}
        for ch in sol:
            fr.press('body', keys[ch]); time.sleep(0.03)
        time.sleep(0.5)
        print('win screen shown:', fr.evaluate("!document.getElementById('winModal').classList.contains('hidden')"))
        fr.press('body', ' ')
        time.sleep(2)
        print('after Space, address bar:', pg.url, '| top location:', pg.evaluate('location.pathname'), '| frame:', pg.frames[1].url, '| marker kept:', pg.evaluate('window.__marker') == 42,
              '| title:', pg.title())
        print('page errors:', errs or 'none')
        b.close()
finally:
    srv.terminate()
