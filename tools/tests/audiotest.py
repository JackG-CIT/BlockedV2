import sys, pathlib
from playwright.sync_api import sync_playwright
js = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--autoplay-policy=no-user-gesture-required"])
    pg = b.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.set_content("<html><body></body></html>")
    pg.add_script_tag(content=js)
    pg.mouse.click(5, 5)
    for song in ["lobby", "voyage", "deep"]:
        pg.evaluate(f"BlockedSound.music('{song}')")
        pg.wait_for_timeout(5000)
        peaks = [pg.evaluate("BlockedSound.peak()") for _ in range(20) if not pg.wait_for_timeout(100)]
        print(song, "playing:", pg.evaluate("BlockedSound.playing"), "max peak %.2f" % max(peaks))
    pg.evaluate("BlockedSound.set('music', 0)")
    pg.wait_for_timeout(800)
    for fx in ["step", "push", "bump"]:
        pg.evaluate(f"BlockedSound.play('{fx}')")
        peaks = [pg.evaluate("BlockedSound.peak()") for _ in range(8) if not pg.wait_for_timeout(15)]
        print(fx, "peak %.2f" % max(peaks))
        pg.wait_for_timeout(400)
    print("errors:", errs or "none")
    b.close()
