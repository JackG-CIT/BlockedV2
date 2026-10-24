"""Loop/variation, boss tracks, slots and long-music switch tests in headless Edge.
usage: python vartest.py audio.js [peaks|logic|all]
"""
import sys, pathlib
from playwright.sync_api import sync_playwright

js = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
mode = sys.argv[2] if len(sys.argv) > 2 else "all"
PAGE = "<html><body><script>%s</script></body></html>" % js
SHELL = "<html><body><script>window.BLOCKED_SHELL = true;</script><script>%s</script><iframe id=f src='/inner'></iframe></body></html>" % js

with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
    pg.route("http://test.local/**", lambda r: r.fulfill(status=200, content_type="text/html", body=SHELL if r.request.url.endswith("/shell") else PAGE))
    pg.goto("http://test.local/")
    pg.mouse.click(5, 5)
    cycles = pg.evaluate("BlockedSound.cycles")
    tracks = {t["id"]: t for t in pg.evaluate("BlockedSound.tracks")}

    def measure(ms):
        peaks = []
        for _ in range(ms // 50):
            pg.wait_for_timeout(50)
            peaks.append(pg.evaluate("BlockedSound.peak()"))
        return max(peaks)

    def stop():
        pg.evaluate("BlockedSound.stopMusic()")
        pg.wait_for_timeout(1300)

    if mode in ("peaks", "all"):
        for tid, cyc in cycles.items():
            res = {}
            for i, name in enumerate(cyc):
                if name in res:
                    continue
                stop()
                pg.evaluate(f"BlockedSound.audition('{tid}', {i})")
                pg.wait_for_timeout(600)
                pos = pg.evaluate("BlockedSound.position")
                assert pos["pass"] == i and pos["passName"] == name, (tid, i, pos)
                res[name] = measure(5000)
            print("%-16s %s" % (tid, "  ".join("%s %.2f" % kv for kv in res.items())), flush=True)
        for tid in [t for t in tracks if tracks[t]["group"] in ("short", "boss")]:
            stop()
            pg.evaluate(f"sessionStorage.clear(); BlockedSound.music('{tid}')")
            pg.wait_for_timeout(1500)
            print("%-16s full %.2f" % (tid, measure(6000)), flush=True)

    if mode in ("logic", "all"):
        # Variation passes arrive on their own at the right loop counts.
        tid = "pressure"
        t = tracks[tid]
        loop_ms = 16 * t["barSteps"] * 60000 / t["bpm"] / t["stepsPerBeat"]
        n = len(cycles[tid])
        for boundary in (2, 5, 7, n):  # into changeup, grand, breakdown, then wrap to normal
            stop()
            pg.evaluate("""([id, ms]) => {
                sessionStorage.setItem("blocked-song", JSON.stringify({ name: id, started: Date.now() - ms, leftAt: Date.now() }));
                BlockedSound.music(id);
            }""", [tid, boundary * loop_ms - 2500])
            pg.wait_for_timeout(700)
            before = pg.evaluate("BlockedSound.position")
            pg.wait_for_timeout(3000)
            after = pg.evaluate("BlockedSound.position")
            print("loop %d boundary: pass %d (%s) -> pass %d (%s), same start: %s" % (
                boundary, before["pass"], before["passName"], after["pass"], after["passName"], before["started"] == after["started"]), flush=True)
        # Slots
        stop()
        for slot in pg.evaluate("BlockedSound.slots") + ["boss", "deep", "voyage"]:
            print("slot %-9s -> %s" % (slot, pg.evaluate(f"BlockedSound.resolve('{slot}')")))
        # Room option is ignored; same track keeps playing.
        pg.evaluate("sessionStorage.clear(); BlockedSound.music('chapter2', { room: 1 })")
        pg.wait_for_timeout(2500)
        a = pg.evaluate("BlockedSound.position")
        pg.evaluate("BlockedSound.music('chapter2', { room: 3 })")
        pg.wait_for_timeout(2000)
        b2 = pg.evaluate("BlockedSound.position")
        print("room 1 -> 3 on chapter2: same track keeps going:", a["started"] == b2["started"], b2["name"])
        # Long chapter music off, then on: crossfades on a bar line to the other version.
        pg.evaluate("BlockedSound.set('longMusic', false)")
        p1 = pg.evaluate("BlockedSound.playing")
        pg.wait_for_timeout(3500)
        print("long music off:", p1, "->", pg.evaluate("BlockedSound.playing"), "| chapter2 resolves to", pg.evaluate("BlockedSound.resolve('chapter2')"),
              "| boss2 resolves to", pg.evaluate("BlockedSound.resolve('boss2')"))
        pk = measure(2000)
        pg.evaluate("BlockedSound.set('longMusic', true)")
        pg.wait_for_timeout(3500)
        print("long music on:", pg.evaluate("BlockedSound.playing"), "peak while short %.2f" % pk)
        pg.evaluate("BlockedSound.music('boss3')")
        pg.wait_for_timeout(3500)
        print("boss3:", pg.evaluate("BlockedSound.position"))
        # Framed page through the shell proxy.
        pg2 = b.new_page()
        e2 = []
        pg2.on("pageerror", lambda e: e2.append(str(e)))
        pg2.route("http://test.local/**", lambda r: r.fulfill(status=200, content_type="text/html", body=SHELL if r.request.url.endswith("/shell") else PAGE))
        pg2.goto("http://test.local/shell")
        pg2.wait_for_timeout(500)
        pg2.mouse.click(5, 5)
        inner = [f for f in pg2.frames if f.url.endswith("/inner")][0]
        inner.evaluate("BlockedSound.music('chapter4', { room: 2 })")
        pg2.wait_for_timeout(1500)
        print("framed music(chapter4, {room: 2}) ->", pg2.evaluate("BlockedSound.position"), "errors:", e2 or "none")
    print("errors:", errs or "none")
    b.close()
