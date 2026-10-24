"""Render /sounds through Flask's test client and drive it in headless Edge."""
import sys, os, mimetypes
sys.path.insert(0, r"C:\Users\jackk\BlockedV2")
os.chdir(r"C:\Users\jackk\BlockedV2")
from app import app
from playwright.sync_api import sync_playwright

client = app.test_client()

def handle(route):
    url = route.request.url.replace("http://test.local", "")
    r = client.get(url)
    route.fulfill(status=r.status_code, body=r.data, content_type=r.headers.get("Content-Type"))

out = sys.argv[1]
with sync_playwright() as p:
    b = p.chromium.launch(channel="msedge", args=["--autoplay-policy=no-user-gesture-required"])
    for w, name in ((1200, "wide"), (375, "phone")):
        pg = b.new_page(viewport={"width": w, "height": 900})
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.on("console", lambda m: m.type == "error" and errs.append(m.text))
        pg.route("http://test.local/**", handle)
        pg.goto("http://test.local/sounds")
        pg.mouse.click(5, 5)
        pg.click(".track button >> nth=3")
        pg.wait_for_timeout(1500)
        print(name, pg.inner_text("#nowPlaying"))
        card = pg.locator(".track", has_text="pressure").first
        card.get_by_role("button", name="Hear grand").click()
        pg.wait_for_timeout(2500)
        print(name, pg.inner_text("#nowPlaying"), pg.evaluate("BlockedSound.position"))
        print(name, "room buttons left:", pg.locator(".rooms").count(), "| cycle lines:", pg.locator(".cycle").count())
        pg.select_option("#slots select >> nth=0", "black-flag")
        pg.wait_for_timeout(2500)
        print(name, "after preview:", pg.inner_text("#nowPlaying"), pg.evaluate("BlockedSound.resolve('lobby')"))
        print(name, "scrollWidth", pg.evaluate("document.documentElement.scrollWidth"), "of", w)
        pg.screenshot(path=os.path.join(r"C:\Users\jackk\AppData\Local\Temp\claude\C--Users-jackk\12676325-6980-4d9e-a616-8c236abd1105\scratchpad", f"sounds_{name}.png"), full_page=True)
        pg.click("#resetSlots")
        pg.click("#stopMusic")
        pg.wait_for_timeout(1200)
        print(name, pg.inner_text("#nowPlaying"), "lobby->", pg.evaluate("BlockedSound.resolve('lobby')"))
        print(name, "errors:", errs or "none")
        pg.close()
    b.close()
