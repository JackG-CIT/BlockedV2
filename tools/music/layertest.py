"""Layer tests in headless Edge.

- every chapter track at rooms 1-4 (peak measured over 6 s from bar 5, the start of A, and from the C section)
- room 1 -> 2 -> 4 -> 1 on the same track doesn't restart it
- a framed page (like templates/shell.html) passes music(slot, {room}) through the proxy
usage: python layertest.py audio.js [track ...]
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

js = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
only = sys.argv[2:]
PAGE = "<html><body><script>%s</script></body></html>" % js
SHELL = "<html><body><script>window.BLOCKED_SHELL = true;</script><script>%s</script><iframe id=f src='/inner'></iframe></body></html>" % js


def route(r):
    url = r.request.url
    body = SHELL if url.endswith("/shell") else PAGE
    r.fulfill(status=200, content_type="text/html", body=body)


with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.route("http://test.local/**", route)
    pg.goto("http://test.local/")
    pg.mouse.click(5, 5)
    layers = pg.evaluate("BlockedSound.layers")
    tracks = {t["id"]: t for t in pg.evaluate("BlockedSound.tracks")}

    def measure(ms):
        peaks = []
        for _ in range(ms // 50):
            pg.wait_for_timeout(50)
            peaks.append(pg.evaluate("BlockedSound.peak()"))
        return max(peaks)

    def play_at(track, bar, room):
        pg.evaluate("BlockedSound.stopMusic()")
        pg.wait_for_timeout(1300)
        pg.evaluate("""([id, bars, room]) => {
            const t = BlockedSound.tracks.find(t => t.id === id);
            const ms = t.barSteps * 60000 / t.bpm / t.stepsPerBeat * bars;
            sessionStorage.setItem("blocked-song", JSON.stringify({ name: id, started: Date.now() - ms + 300, leftAt: Date.now() }));
            BlockedSound.music(id, { room });
        }""", [track, bar, room])
        pg.wait_for_timeout(900)

    for tid in layers:
        if only and tid not in only:
            continue
        six8 = tracks[tid]["barSteps"] == 12
        c_bar = 36 if six8 else 28   # start of the C section
        row = []
        for room in (1, 2, 3, 4):
            pk = 0
            for bar in (4, c_bar):
                play_at(tid, bar, room)
                assert pg.evaluate("BlockedSound.room") == room
                pk = max(pk, measure(5000))
            row.append(pk)
        print("%-12s rooms 1-4 peaks: %s" % (tid, "  ".join("%.2f" % x for x in row)), flush=True)

    # Same track, new room: keeps going.
    pg.evaluate("BlockedSound.stopMusic()")
    pg.wait_for_timeout(1300)
    pg.evaluate("sessionStorage.clear(); BlockedSound.music('chapter2', { room: 1 })")
    pg.wait_for_timeout(2500)
    a = pg.evaluate("BlockedSound.position")
    for room in (2, 4, 1):
        pg.evaluate(f"BlockedSound.music('chapter2', {{ room: {room} }})")
        pg.wait_for_timeout(3000)
        bpos = pg.evaluate("BlockedSound.position")
        print("room ->", room, bpos, "same start:", bpos["started"] == a["started"], "step moved on:", bpos["step"] != a["step"])
        a2 = a
        a = bpos
        assert bpos["started"] == a2["started"] and bpos["room"] == room
    pg.evaluate("BlockedSound.music('boss')")
    pg.wait_for_timeout(3000)
    print("boss:", pg.evaluate("BlockedSound.position"))
    print("errors (main):", errs or "none")

    # Framed page -> shell proxy
    pg2 = b.new_page()
    errs2 = []
    pg2.on("pageerror", lambda e: errs2.append(str(e)))
    pg2.route("http://test.local/**", route)
    pg2.goto("http://test.local/shell")
    pg2.wait_for_timeout(500)
    frame = pg2.frame_locator("#f")
    pg2.mouse.click(5, 5)
    inner = [f for f in pg2.frames if f.url.endswith("/inner")][0]
    inner.evaluate("BlockedSound.music('chapter3', { room: 2 })")
    pg2.wait_for_timeout(1500)
    print("shell after framed music(chapter3, room 2):", pg2.evaluate("BlockedSound.position"))
    s1 = pg2.evaluate("BlockedSound.position")
    inner.evaluate("BlockedSound.music('chapter3', { room: 3 })")
    pg2.wait_for_timeout(2500)
    s2 = pg2.evaluate("BlockedSound.position")
    print("shell after room 3:", s2, "same start:", s1["started"] == s2["started"])
    print("framed sees layers:", sorted(inner.evaluate("Object.keys(BlockedSound.layers)")))
    print("errors (shell):", errs2 or "none")
    b.close()
