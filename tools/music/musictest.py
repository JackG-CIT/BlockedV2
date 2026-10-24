"""Play every track (start of the A section and of the B section) in headless Edge and report peaks.

usage: python musictest.py audio.js [track ...]
"""
import sys, json, pathlib
from playwright.sync_api import sync_playwright

js = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
only = sys.argv[2:]
HTML = "<html><body><script>%s</script></body></html>" % js.replace("</script>", "<\\/script>")

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.route("http://test.local/**", lambda r: r.fulfill(status=200, content_type="text/html", body=HTML))
    pg.goto("http://test.local/")
    pg.mouse.click(5, 5)
    tracks = pg.evaluate("BlockedSound.tracks")
    playlist = pg.evaluate("BlockedSound.playlist")

    def measure(ms):
        peaks = []
        for _ in range(ms // 50):
            pg.wait_for_timeout(50)
            peaks.append(pg.evaluate("BlockedSound.peak()"))
        return max(peaks)

    results = {}
    for t in tracks:
        if only and t["id"] not in only:
            continue
        out = []
        for section in (0, 8):  # bar 1 and bar 9
            pg.evaluate("BlockedSound.stopMusic()")
            pg.wait_for_timeout(1500)
            # Pretend the last page started this track `section` bars ago, so it resumes there.
            pg.evaluate("""([id, bars]) => {
                const t = BlockedSound.tracks.find(t => t.id === id);
                const ms = t.barSteps * 60000 / t.bpm / t.stepsPerBeat * bars;
                sessionStorage.setItem("blocked-song", JSON.stringify({ name: id, started: Date.now() - ms + 300, leftAt: Date.now() }));
                BlockedSound.music(id);
            }""", [t["id"], section])
            pg.wait_for_timeout(1200)
            assert pg.evaluate("BlockedSound.playing") == t["id"], (t["id"], pg.evaluate("BlockedSound.playing"))
            out.append(measure(5000))
        results[t["id"]] = out
        print("%-14s %-24s A %.2f  B %.2f  max %.2f" % (t["id"], t["title"], out[0], out[1], max(out)), flush=True)

    # Slots and old names resolve to the right track; same track doesn't restart.
    pg.evaluate("BlockedSound.stopMusic()")
    pg.wait_for_timeout(500)
    for slot in list(playlist) + ["voyage", "deep"]:
        pg.evaluate(f"BlockedSound.music('{slot}')")
        pg.wait_for_timeout(300)
        print("slot %-10s -> %s" % (slot, pg.evaluate("BlockedSound.playing")))
    pg.evaluate("BlockedSound.music('chapter1')")
    pg.wait_for_timeout(3000)
    before = pg.evaluate("BlockedSound.playing")
    pg.evaluate("BlockedSound.music('voyage')")
    pg.wait_for_timeout(200)
    print("chapter1 then voyage (same track) keeps playing:", before, "->", pg.evaluate("BlockedSound.playing"))
    print("errors:", errs or "none")
    b.close()
