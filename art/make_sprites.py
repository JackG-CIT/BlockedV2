"""Draws all of Blocked's pixel art and writes it to static/img as SVG files.

Every sprite is a grid of palette letters ('.' is transparent). To change the
art, edit a grid or a colour below, run `python art/make_sprites.py`, and
refresh the game. It also writes art/preview.png, a zoomed-in sheet of every
sprite so you can check them at a glance.
"""
import os
import struct
import zlib

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "static", "img")

# One shared palette keeps every sprite looking like part of the same set.
PALETTE = {
    "K": "#1d1a1f",  # outline / black
    "W": "#f5efe0",  # cream white
    "e": "#d6cbb0",  # sail shade
    # deck planks
    "d": "#e2ad6a", "a": "#c68e4c", "b": "#ad763a", "c": "#74461d",
    # wood (crates, chest, ship)
    "L": "#d99a4e", "M": "#a86a32", "D": "#6e4119", "n": "#4b2b12",
    # stone
    "h": "#a3a7b0", "s": "#7c808b", "k": "#5a5e68", "o": "#383a42",
    # iron
    "i": "#8b91a0", "I": "#4f5461", "G": "#26282e",
    # gold / brass
    "H": "#fff3c4", "Y": "#f6c84c", "y": "#c9902a", "g": "#8a5f14",
    # red
    "R": "#d33b36", "r": "#962127",
    # skin
    "S": "#f2c39d", "z": "#d39a72",
    # fuse cord
    "p": "#efe2c0", "q": "#2b2118",
    # fire
    "O": "#ff8a1e", "F": "#ffd84a",
    # sea
    "w": "#17508a", "v": "#1f64a8", "u": "#3f8ad4", "f": "#cfeaff",
    # green (checkmark)
    "E": "#5cc05a", "X": "#2f7a33",
}


# ---------------------------------------------------------------- helpers
def grid(rows):
    width = len(rows[0])
    for i, row in enumerate(rows):
        assert len(row) == width, f"row {i} is {len(row)} wide, expected {width}: {row!r}"
        for ch in row:
            assert ch == "." or ch in PALETTE, f"unknown colour {ch!r} in row {i}"
    return [list(r) for r in rows]


def blank(w, h, ch="."):
    return [[ch] * w for _ in range(h)]


def rect(g, x0, y0, x1, y1, ch):
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            if 0 <= y < len(g) and 0 <= x < len(g[0]):
                g[y][x] = ch


def outline(g, fill_ch="K"):
    """Adds a 1px outline around every non-transparent pixel (grows the art)."""
    h, w = len(g), len(g[0])
    out = [row[:] for row in g]
    for y in range(h):
        for x in range(w):
            if g[y][x] != ".":
                continue
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    yy, xx = y + dy, x + dx
                    if 0 <= yy < h and 0 <= xx < w and g[yy][xx] != ".":
                        out[y][x] = fill_ch
    return out


# ---------------------------------------------------------------- tiles
FLOOR = grid([
    "dddddddcdddddddd",
    "aaaaaaacaaaaaaaa",
    "abaaaaacaaabaaaa",
    "cccccccccccccccc",
    "dddcdddddddddddd",
    "aaacaaaaaabaaaaa",
    "aaacaaaaaaaaaaba",
    "cccccccccccccccc",
    "dddddddddddcdddd",
    "aabaaaaaaaacaaaa",
    "aaaaaaabaaacaaaa",
    "cccccccccccccccc",
    "dddddcdddddddddd",
    "aaaaacaaaaaaabaa",
    "abaaacaaaaaaaaaa",
    "cccccccccccccccc",
])


def make_wall():
    g = blank(16, 16, "s")
    for y in range(16):
        course, row = divmod(y, 4)
        offset = 0 if course % 2 == 0 else 4
        for x in range(16):
            if row == 3 or (x - offset) % 8 == 7:
                g[y][x] = "o"
            elif row == 0:
                g[y][x] = "h"
            elif row == 2:
                g[y][x] = "k"
    for x, y in [(2, 1), (10, 5), (5, 9), (13, 13)]:
        g[y][x] = "k"
    return g


def make_crate():
    g = blank(16, 16, "K")
    rect(g, 1, 1, 14, 14, "L")
    rect(g, 13, 2, 14, 14, "M")
    rect(g, 2, 13, 14, 14, "M")
    rect(g, 3, 3, 12, 12, "D")
    rect(g, 4, 4, 12, 12, "M")
    for y in range(4, 13):
        g[y][8] = "D"
    for i in range(10):  # diagonal brace, bottom-left to top-right
        x, y = 3 + i, 12 - i
        g[y][x] = "L"
        if x + 1 <= 12:
            g[y][x + 1] = "L"
        if y + 1 <= 12 and x + 1 <= 12:
            g[y + 1][x + 1] = "D"
    for x, y in [(2, 2), (13, 2), (2, 13), (13, 13)]:
        g[y][x] = "n"
    return g


def make_plate(pressed):
    g = blank(16, 16, ".")
    rect(g, 2, 2, 13, 13, "K")
    fill, hi, lo = ("y", "g", "Y") if pressed else ("Y", "H", "y")
    rect(g, 3, 3, 12, 12, fill)
    for i in range(3, 13):
        g[3][i] = g[i][3] = hi
        g[12][i] = g[i][12] = lo
    mark = "g" if pressed else "y"
    for x, y in [(5, 5), (10, 5), (5, 10), (10, 10)]:  # rivets
        g[y][x] = mark
    for i in range(4):  # little X in the middle
        g[6 + i][6 + i] = mark
        g[6 + i][9 - i] = mark
    return g


def make_gate(is_open):
    """A gate is a wall a plate can lower. Shut, it's stone like any wall (so
    it clearly stops cannon fire) with a brass frame and the plate's X mark.
    Open, it's deck with brass corner brackets showing where it will rise."""
    if is_open:
        g = [row[:] for row in FLOOR]
        for cx, cy, sx, sy in [(0, 0, 1, 1), (15, 0, -1, 1), (0, 15, 1, -1), (15, 15, -1, -1)]:
            for i in range(4):
                g[cy][cx + sx * i] = "o"
                g[cy + sy * i][cx] = "o"
            g[cy + sy][cx + sx] = "g"
        for i in range(4):
            g[6 + i][6 + i] = "g"
            g[6 + i][9 - i] = "g"
        return g
    g = make_wall()
    for i in range(16):
        g[0][i] = g[15][i] = g[i][0] = g[i][15] = "y"
    for x, y in [(0, 0), (15, 0), (0, 15), (15, 15)]:
        g[y][x] = "g"
    rect(g, 5, 5, 10, 10, "g")
    rect(g, 6, 6, 9, 9, "o")
    for i in range(4):
        g[6 + i][6 + i] = "Y"
        g[6 + i][9 - i] = "Y"
    return g


CANNON = grid([
    ".....KKKKKK.....",
    ".....KiiiIK.....",
    ".....KKKKKK.....",
    "......KiIK......",
    "......KiIK......",
    ".....KiiIIK.....",
    ".....KiiIIK.....",
    "..KKKKiiIIKKKK..",
    ".KGGDKiiIIKDGGK.",
    ".KGGDKiiIIKDGGK.",
    ".KKKMKiiIIKMKKK.",
    "..KMMKiIIIKMMK..",
    "..KMMMKKKKMMMK..",
    ".KGGMMMKKMMMGGK.",
    ".KGGDDDDDDDDGGK.",
    ".KKKKKKKKKKKKKK.",
])

CHEST = grid([
    "................",
    "...KKKKKKKKKK...",
    "..KLLLLYYLLLLK..",
    ".KLHMMMYYMMMMLK.",
    ".KMMMMMYYMMMMMK.",
    ".KYYYYYYYYYYYYK.",
    ".KyyyyyKKyyyyyK.",
    ".KMMMMKYYKMMMMK.",
    ".KMMMMKyyKMMMMK.",
    ".KMMMMMKKMMMMMK.",
    ".KYMMMMYYMMMMYK.",
    ".KYDDDDYYDDDDYK.",
    ".KYDDDDYYDDDDYK.",
    ".KyyyyyyyyyyyyK.",
    "..KKKKKKKKKKKK..",
    "................",
])

# Mid-chapter rooms end at a door (in a wall) or a trapdoor (in the floor);
# the chest is saved for the last room of each chapter. Both glow gold so the
# goal is easy to spot (the glow pulse itself is CSS).
DOOR = grid([
    "ookkkkkkkkkkkkoo",
    "okshhhKKKKhhhsko",
    "khhhKKHHHHKKhhsk",
    "khhKHHHHHHHHKhsk",
    "kKKHHYYYYYYHHKsk",
    "KnDKHYYYYYYYHKKk",
    "KnLKYYYYYYYYYYKk",
    "KnLKYYYYYYYYYYKk",
    "KnLKYYYYYYYYYYKk",
    "KnYKYYYYYYYYYYKk",
    "KnLKYYYYYYYYYYKk",
    "KnLKYYYYYYYYYYKk",
    "KnDKyYYYYYYYYyKk",
    "KKKKyyHHHHHHyyKk",
    "okkKKKKKKKKKKKKo",
    "ookkkkkkkkkkkkoo",
])

HATCH = grid([
    "..KKKKKKKKKKKK..",
    ".KLLLLLLLLLLLLK.",
    ".KMMMMMMMMMMMMK.",
    ".KIIiIIIIIIiIIK.",
    ".KDDDDDDDDDDDDK.",
    ".KKKKKKKKKKKKKK.",
    "KnnnnnnnnnnnnnnK",
    "KnYYYYYYYYYYYYnK",
    "KnYGLGGGGGGLGYnK",
    "KnYGLLLLLLLLGYnK",
    "KnYGLGGGGGGLGYnK",
    "KnYGLLLLLLLLGYnK",
    "KnYGLGGGGGGLGYnK",
    "KnyyyyyyyyyyyynK",
    "KnnnnnnnnnnnnnnK",
    ".KKKKKKKKKKKKKK.",
])

# Difficulty rating icon (half a skull is the left half, clipped in CSS).
SKULL = grid([
    "................",
    "....KKKKKKKK....",
    "...KWWWWWWWWK...",
    "..KWWWWWWWWWWK..",
    "..KWWWWWWWWWeK..",
    "..KWKKKWWKKKeK..",
    "..KWKKKWWKKKeK..",
    "..KWKKKWWKKKeK..",
    "..KWWWWKKWWWeK..",
    "...KWWWKKWWeK...",
    "....KWWWWWeK....",
    "....KWKWKWKK....",
    "....KWKWKWKK....",
    ".....KKKKKK.....",
    "................",
    "................",
])

PIRATE = grid([
    "....KKKKKKKK....",
    "...KRRRRRRRRK...",
    "..KRRRWRRRRRRK..",
    "..KRRRRRRRRRrK..",
    "..KSSSSSSSSSSKr.",
    "..KSKKKSSSKSSK.r",
    "..KSKKKSSSSSSK..",
    "..KSSSSSSSSSSK..",
    "...KSSzKKzSSK...",
    "....KKKKKKKK....",
    "...KWRWRWRWRK...",
    "..KSKWRWRWRKSK..",
    "..KSKRWRWRWKSK..",
    "...KKnnnnnnKK...",
    "....KnnKKnnK....",
    "....KKK..KKK....",
])

FUSE_COIL = [
    "................",
    "................",
    "................",
    "............K...",
    "...........q....",
    "..........q.....",
    ".....qqqqqq.....",
    "....qppppppq....",
    "...qpqqqqqqpq...",
    "...qpq....qpq...",
    "...qpq.qq.qpq...",
    "...qpq....qpq...",
    "...qpqqqqqqpq...",
    "....qppppppq....",
    ".....qqqqqq.....",
    "................",
]
FUSE = grid(FUSE_COIL)
FUSE_LIT = grid([
    "................",
    "...........F.F..",
    "............O...",
    "...........OWO..",
    "...........qO...",
] + FUSE_COIL[5:])


LOCK = grid([
    "................",
    ".....KKKKKK.....",
    "....KiiiiiIK....",
    "...KiK....KIK...",
    "...KiK....KIK...",
    "...KiK....KIK...",
    "..KKKKKKKKKKKK..",
    "..KYYYYYYYYYyK..",
    "..KYHHYYYYYYyK..",
    "..KYYYYKKYYYyK..",
    "..KYYYYKKYYYyK..",
    "..KYYYYYKYYYyK..",
    "..KYYYYYYYYYyK..",
    "..KyyyyyyyyyyK..",
    "..KKKKKKKKKKKK..",
    "................",
])

CHECK = grid([
    "................",
    "................",
    "............KKK.",
    "...........KEEK.",
    "..........KEEXK.",
    ".........KEEXK..",
    "..KKK...KEEXK...",
    ".KEEEK.KEEXK....",
    ".KXEEEKEEXK.....",
    "..KXEEEEXK......",
    "...KXEEXK.......",
    "....KXXK........",
    ".....KK.........",
    "................",
    "................",
    "................",
])


def make_sea():
    g = blank(16, 16, "v")
    for x, y, length in [(1, 3, 5), (9, 7, 4), (3, 11, 4), (11, 14, 3)]:
        for i in range(length):
            g[y][(x + i) % 16] = "u"
        g[y - 1][(x + 1) % 16] = "f"
        g[y + 1][(x + length) % 16] = "w"
    for x, y in [(7, 1), (14, 4), (0, 9), (8, 12)]:
        g[y][x] = "w"
    return g


# ---------------------------------------------------------------- logo
GLYPHS = {
    "B": ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
    "L": ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
    "O": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
    "C": [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
    "K": ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
    "E": ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
    "D": ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
}


def make_logo(word="BLOCKED"):
    gw, gh, gap = 5, 7, 2
    w = len(word) * gw + (len(word) - 1) * gap + 4
    h = gh + 5
    g = blank(w, h)
    for i, letter in enumerate(word):
        ox = 2 + i * (gw + gap)
        for y, row in enumerate(GLYPHS[letter]):
            for x, ch in enumerate(row):
                if ch == "#":
                    g[2 + y][ox + x] = "H" if y < 2 else ("y" if y == gh - 1 else "Y")
    g = outline(g, "K")
    shadow = blank(w, h)  # 1px drop shadow down-right, drawn under the letters
    for y in range(h - 1):
        for x in range(w - 1):
            if g[y][x] != ".":
                shadow[y + 1][x + 1] = "n"
    for y in range(h):
        for x in range(w):
            if g[y][x] == ".":
                g[y][x] = shadow[y][x]
    return g


# ---------------------------------------------------------------- hero ship
def make_ship():
    w, h = 76, 58
    g = blank(w, h)

    def sail(x0, y0, x1, y1):
        rect(g, x0, y0, x1, y1, "W")
        mid = (y0 + y1) // 2
        rect(g, x0, mid, x1, mid + 1, "R")
        for y in range(y0, y1 + 1):
            g[y][x1] = "e"
            g[y][x1 - 1] = "e" if y % 2 else g[y][x1 - 1]
        rect(g, x0 - 2, y0 - 1, x1 + 2, y0 - 1, "D")  # yard arm

    # masts
    rect(g, 27, 6, 28, 42, "D")
    rect(g, 46, 12, 47, 42, "D")
    # sails (main mast, then fore mast)
    sail(19, 10, 36, 19)
    sail(16, 23, 39, 34)
    sail(39, 15, 54, 23)
    sail(37, 27, 56, 36)
    # crow's nest + jolly roger
    rect(g, 25, 6, 30, 7, "M")
    rect(g, 29, 0, 37, 5, "K")
    for x, y in [(32, 1), (33, 1), (34, 1), (32, 2), (34, 2), (33, 3), (31, 4), (35, 4)]:
        g[y][x] = "W"
    # bowsprit
    for i in range(14):
        x, y = 61 + i, 40 - i // 2
        if x < w:
            g[y][x] = "D"
    # stern castle
    rect(g, 4, 31, 22, 40, "M")
    rect(g, 4, 30, 22, 30, "D")
    for x in range(4, 23, 3):
        g[29][x] = "D"
    rect(g, 4, 28, 22, 28, "D")
    for wx in (8, 13, 18):
        rect(g, wx, 34, wx + 1, 35, "Y")
    # hull
    top, bottom = 40, 51
    for y in range(top, bottom + 1):
        t = (y - top) / (bottom - top)
        left = int(4 + t * 10)
        right = int(66 - t * 12)
        rect(g, left, y, right, y, "D" if (y - top) % 3 == 2 else "M")
    rect(g, 4, 42, 66, 42, "Y")  # gold trim
    for px in (20, 28, 36, 44, 52):
        rect(g, px, 45, px + 2, 47, "K")
        rect(g, px, 44, px + 2, 44, "y")
    # raised bow
    for y in range(36, 41):
        rect(g, 60 + (40 - y) // 2, y, 67 - (40 - y) // 3, y, "M")
    g = outline(g, "K")
    # foam where hull meets water
    for x in range(10, 60):
        if g[53][x] == "." and x % 3 != 0:
            g[53][x] = "f"
        if g[54][x] == "." and x % 5 == 1:
            g[54][x] = "f"
    for x in range(2, 72):
        if x % 7 in (0, 1, 2) and g[56][x] == ".":
            g[56][x] = "u"
    return g


# ---------------------------------------------------------------- output
def to_svg(g):
    h, w = len(g), len(g[0])
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" '
             f'width="{w * 4}" height="{h * 4}" shape-rendering="crispEdges">']
    for y, row in enumerate(g):
        x = 0
        while x < w:
            ch = row[x]
            run = 1
            while x + run < w and row[x + run] == ch:
                run += 1
            if ch != ".":
                parts.append(f'<rect x="{x}" y="{y}" width="{run}" height="1" fill="{PALETTE[ch]}"/>')
            x += run
    parts.append("</svg>")
    return "".join(parts)


def write_png(path, pixels, w, h):
    raw = b"".join(b"\x00" + bytes(c for px in pixels[y] for c in px) for y in range(h))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def preview(sprites, path, scale=6):
    """Lays every sprite out on one sheet over a deck background."""
    pad = 4
    w = sum(len(g[0]) for g in sprites.values()) + pad * (len(sprites) + 1)
    h = max(len(g) for g in sprites.values()) + pad * 2
    bg = tuple(int(PALETTE["w"][i:i + 2], 16) for i in (1, 3, 5)) + (255,)
    sheet = [[bg] * w for _ in range(h)]
    x0 = pad
    for g in sprites.values():
        for y, row in enumerate(g):
            for x, ch in enumerate(row):
                if ch != ".":
                    c = PALETTE[ch]
                    sheet[pad + y][x0 + x] = tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)
        x0 += len(g[0]) + pad
    big = [[px for px in row for _ in range(scale)] for row in sheet for _ in range(scale)]
    write_png(path, big, w * scale, h * scale)


def main():
    os.makedirs(OUT, exist_ok=True)
    tiles = {
        "floor": FLOOR,
        "wall": make_wall(),
        "crate": make_crate(),
        "plate": make_plate(False),
        "plate-pressed": make_plate(True),
        "gate": make_gate(False),
        "gate-open": make_gate(True),
        "cannon": CANNON,
        "fuse": FUSE,
        "fuse-lit": FUSE_LIT,
        "chest": CHEST,
        "door": DOOR,
        "hatch": HATCH,
        "skull": SKULL,
        "pirate": PIRATE,
        "sea": make_sea(),
        "lock": LOCK,
        "check": CHECK,
    }
    big = {"logo": make_logo(), "ship": make_ship()}
    for name, g in {**tiles, **big}.items():
        with open(os.path.join(OUT, name + ".svg"), "w", encoding="utf-8") as f:
            f.write(to_svg(g))
    preview(tiles, os.path.join(HERE, "preview.png"))
    preview(big, os.path.join(HERE, "preview-big.png"), scale=4)
    print(f"wrote {len(tiles) + len(big)} sprites to {os.path.normpath(OUT)}")


if __name__ == "__main__":
    main()
