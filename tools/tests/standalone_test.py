"""Plays the standalone build (dist/standalone) in headless Edge from a local static server."""
import functools, http.server, json, os, sys, threading, time
from playwright.sync_api import sync_playwright

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'dist', 'standalone')
OUT = sys.argv[1] if len(sys.argv) > 1 else '.'
handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
handler.log_message = lambda *a: None
srv = http.server.ThreadingHTTPServer(('127.0.0.1', 5090), handler)
threading.Thread(target=srv.serve_forever, daemon=True).start()
BASE = 'http://127.0.0.1:5090/'
KEYS = {'U': 'ArrowUp', 'D': 'ArrowDown', 'L': 'ArrowLeft', 'R': 'ArrowRight'}

with sync_playwright() as p:
    b = p.chromium.launch(channel='msedge', args=['--autoplay-policy=no-user-gesture-required'])
    ctx = b.new_context(viewport={'width': 1280, 'height': 800})
    pg = ctx.new_page()
    errs, outside = [], []
    pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.on('console', lambda m: errs.append('console: ' + m.text) if m.type == 'error' else None)
    ctx.on('request', lambda r: None if r.url.startswith(BASE) or r.url.startswith('data:') else outside.append(r.url))
    pg.goto(BASE + 'index.html')
    time.sleep(1)
    levels = pg.evaluate('BLOCKED_DATA.levels.map(l => ({id: l.id, name: l.name, room: l.room, solution: l.solution, mech: l.mechanics}))')
    print('levels:', len(levels), '| title button:', pg.inner_text('#continueBtn'))

    def solve_current(sol):
        for ch in sol:
            pg.keyboard.press(KEYS[ch]); time.sleep(0.02)
        time.sleep(0.4)

    pg.click('#continueBtn'); time.sleep(0.6)
    print('tutorial shown first time:', pg.is_visible('#infoModal'), '|', pg.inner_text('#infoTitle'))
    while pg.is_visible('#infoModal'):
        pg.keyboard.press('Space'); time.sleep(0.3)
    for n in range(5):
        lv = levels[n]
        name = pg.inner_text('#pName')
        exit_imgs = pg.evaluate("[...document.querySelectorAll('#gameBoard .sp.door, #gameBoard .sp.hatch, #gameBoard .sp.chest')].map(e => e.className)")
        solve_current(lv['solution'])
        tally = pg.is_visible('#tally'); popup = pg.is_visible('#winModal')
        print(f"room {n + 1} {name!r}: exit={exit_imgs} tally={tally} popup={popup} skulls={pg.locator('#pDifficulty .skull').count()}")
        if tally:
            time.sleep(3.2)
            while pg.is_visible('#infoModal'):
                pg.keyboard.press('Space'); time.sleep(0.3)
    print('progress after chapter 1:', pg.evaluate('Object.keys(BlockedStandalone.progress()).length'))

    # reload: progress persists
    pg.reload(); time.sleep(1)
    print('after reload:', pg.inner_text('#continueBtn'), '|', pg.inner_text('#titleProgress'))

    # hints on the biggest level follow its stored route
    big = max(range(len(levels)), key=lambda i: len(levels[i]['solution'] or ''))
    pg.evaluate("""() => { const p = {}; BLOCKED_DATA.levels.forEach(l => p[l.id] = {count: 1, best_ms: 1000, best_moves: 1});
                     localStorage.setItem('blocked-sa-progress', JSON.stringify(p));
                     localStorage.setItem('blocked-sa-seen', JSON.stringify({controls:1,plates:1,squeeze:1,cannons:1,loaded:1,doors:1})); }""")
    pg.reload(); time.sleep(1)
    pg.evaluate(f'BlockedStandalone.playVoyage({big}, {{}})'); time.sleep(1)
    pg.keyboard.press('h'); time.sleep(4)
    print(f"hint on biggest level ({levels[big]['name']}, {len(levels[big]['solution'])}-move route):", pg.inner_text('#hintText'))
    pg.keyboard.press('h'); time.sleep(1)
    print('  second press:', pg.inner_text('#hintText'))

    # editor: import a level, play it
    pg.click('[data-go=workshop]'); time.sleep(0.5)
    pg.click('#importBtn')
    lv0 = pg.evaluate("JSON.stringify({name: 'Imported', width: BLOCKED_DATA.levels[6].width, height: BLOCKED_DATA.levels[6].height, tiles: BLOCKED_DATA.levels[6].tiles})")
    pg.fill('#shareText', lv0); pg.click('#shareOk'); time.sleep(0.5)
    print('my levels after import:', pg.locator('#myLevels .level-card').count())
    pg.click('#myLevels [data-act=edit]'); time.sleep(0.6)
    print('editor open:', pg.is_visible('#editTable'), '| tools:', pg.locator('#tools .tool').count())
    pg.click('#saveBtn'); time.sleep(0.3)
    print('save:', pg.inner_text('#saveState'))
    pg.click('#editorPlayBtn'); time.sleep(0.6)
    solve_current(levels[6]['solution'])
    print('played own level, popup:', pg.is_visible('#winModal'), '|', pg.inner_text('#winTitle'))

    # small screen
    pg.set_viewport_size({'width': 390, 'height': 760})
    pg.evaluate('BlockedStandalone.playVoyage(3, {})'); time.sleep(1)
    pg.screenshot(path=os.path.join(OUT, 'standalone_phone.png'))
    width_ok = pg.evaluate('document.documentElement.scrollWidth <= window.innerWidth + 1')
    print('phone: no sideways scroll:', width_ok)
    pg.set_viewport_size({'width': 1366, 'height': 768})
    pg.evaluate('BlockedStandalone.show("chapters")'); time.sleep(0.6)
    pg.screenshot(path=os.path.join(OUT, 'standalone_chapters.png'))
    print('requests outside the folder:', outside or 'none')
    print('page errors:', errs or 'none')
    b.close()
srv.shutdown()
