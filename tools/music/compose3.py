"""Long chapter tracks as loop + variations. The normal loop is the "<id>-short"
track itself; this writes each long track's variation passes and cycle into audio.js.
"""
import re, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from compose import fill
import compose2
from compose2 import shift, midi, thirds_below, loop

P = pathlib.Path(r"C:\Users\jackk\BlockedV2\static\js\audio.js")
SPECS = {t["id"]: t for t in compose2.T}

CYCLES = {
    "default": ["normal", "normal", "changeup", "normal", "normal", "grand", "normal", "breakdown"],
    "davy-jones": ["normal", "changeup", "normal", "grand", "normal", "breakdown"],
}
VOLUMES = {"grand": 0.8, "breakdown": 1.35, "changeup": 1.0}
TRACK_VOLUMES = {"sea-legs": {"grand": 0.58, "breakdown": 0.95}, "pressure": {"grand": 0.82, "breakdown": 1.25},
                 "locks-keys": {"grand": 0.72}, "gunpowder": {"grand": 0.75}, "crossfire": {"grand": 0.72}, "davy-jones": {"grand": 0.88, "breakdown": 1.5}}


def short_track(src, tid):
    m = re.search(r'\n        "%s-short": \{\n(.*?)\n        \},\n' % tid, src, re.S)
    body = m.group(1)
    bs = int(re.search(r"barSteps: (\d+)", body).group(1))
    chans = {}
    for ch, arr in re.findall(r"\n\s+(\w+): \[(.*?)\],", body, re.S):
        chans[ch] = re.findall(r'"([^"]*)"', arr)
    meta = {k: re.search(r'%s: "([^"]*)"' % k, body).group(1) for k in ("mood",)}
    meta["volume"] = float(re.search(r"volume: ([\d.]+)", body).group(1))
    meta["bpm"] = int(re.search(r"bpm: (\d+)", body).group(1))
    meta["spb"] = int(re.search(r"stepsPerBeat: (\d+)", body).group(1))
    return bs, chans, meta


def median(xs):
    xs = sorted(xs)
    return xs[len(xs) // 2]


def toks(bar):
    for t in bar.split():
        what, _, n = t.partition(":")
        yield what, int(n or 1)


def score(bar):
    if "+" in bar:
        return 0
    s = [n for w, n in toks(bar) if w != "r"]
    return sum(s) + len(s)


def has_notes(bar):
    return any(w != "r" for w, _ in toks(bar)) and "+" not in bar


def notes(bars):
    return [midi(w) for b in bars for w, _ in toks(b) if w != "r"] or [72]


def light_drums(bar):
    MAP = {"B": "F", "S": "s", "K": "k", "T": "F", "C": None, "H": "h"}
    out = []
    for w, n in toks(bar):
        if w != "r":
            hits = []
            for h in w.split("+"):
                h2 = MAP.get(h, h)
                if h2 and h2 not in hits:
                    hits.append(h2)
            w = "+".join(hits) if hits else "r"
        out.append("%s:%d" % (w, n))
    return " ".join(out)


def build(tid):
    src = P.read_text(encoding="utf-8")
    BS, ch, meta = short_track(src, tid)
    spec = SPECS[tid]
    chords = spec["A"]["chords"] + spec["B"]["chords"]
    assert len(chords) == 16
    six8 = BS == 12
    rest = "r:%d" % BS
    lead = ch.get("lead", [rest] * 16)
    brass = ch.get("brass", [rest] * 16)
    lead, brass = loop(lead, 16), loop(brass, 16)

    # Which part carries the tune in each half (bars 1-8, 9-16)?
    tune, source = [], []
    for h in (0, 8):
        L, B = lead[h:h + 8], brass[h:h + 8]
        use_lead = sum(map(score, L)) >= sum(map(score, B))
        main, other = (L, B) if use_lead else (B, L)
        half, from_main = [], []
        for i in range(8):
            if has_notes(main[i]):
                half.append(main[i]); from_main.append(True)
            elif has_notes(other[i]):
                half.append(other[i]); from_main.append(False)
            else:
                half.append(rest); from_main.append(False)
        # Put a horn tune up into the fiddle's range (only the bars that came from the horns).
        mains = [b for b, f in zip(half, from_main) if f]
        if not use_lead and mains and median(notes(mains)) + 12 <= 84 and max(notes(mains)) + 12 <= 91:
            fiddle = [shift([b], 1)[0] if f else b for b, f in zip(half, from_main)]
        else:
            fiddle = half
        tune.append((use_lead, half, fiddle))

    fiddle = tune[0][2] + tune[1][2]
    # Grand: horns double the tune below the fiddle, big drums, deep bass.
    horns = []
    for use_lead, half, fid in tune:
        if use_lead:
            horns += shift(half, -1) if median(notes(half)) - 12 >= 58 else half
        else:
            horns += [rest] * 8   # the horns already have it
    if six8:
        big = ["B+C:6 B:6"] + ["B:6 B:6"] * 7 + ["B+C:6 B:6"] + ["B:6 B:6"] * 6 + ["B:6 S:1 S:1 S:1 S:1 S:1 S:1"]
        fill_bar = "r:6 S:1 S:1 S:1 S:1 S:2"
    else:
        big = ["B+C:4 r:4 B:4 r:4"] + ["B:4 r:4 B:4 r:4"] * 7 + ["B+C:4 r:4 B:4 r:4"] + ["B:4 r:4 B:4 r:4"] * 6 + ["B:4 r:4 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1"]
        fill_bar = "r:8 S:1 S:1 S:1 S:1 S:2 S:2"
    grand = {"lead": fiddle, "brass2": horns, "drums2": big}
    if "sub" not in ch:
        grand["sub"] = [fill("{r}:%d" % BS, c) for c in chords]

    # Breakdown: just the fiddle tune, a plucked bass (and the bells in Locks and Keys), light drums.
    keep = {"lead", "drums", "pizz"} | ({"bell"} if tid == "locks-keys" else set())
    mute = [c for c in ch if c not in keep]
    pluck = "{o}:2 r:2 {p}:2 {o}:2 r:2 {p}:2" if six8 else "{o}:2 r:2 {p}:2 r:2 {o}:2 r:2 {p}:2 r:2"
    drums = loop(ch["drums"], 16)
    breakdown = {"lead": fiddle, "drums": [light_drums(b) for b in drums], "drums2": [rest] * 15 + [fill_bar]}
    if "pizz" not in ch:
        breakdown["pizz"] = [fill(pluck, c) for c in chords]

    # Change-up: a second fiddle joins (harmony a third below, or doubling a horn tune), with drum fills.
    second = []
    for i, (use_lead, half, fid) in enumerate(tune):
        cs = chords[i * 8:i * 8 + 8]
        if use_lead:
            second += thirds_below(half, spec["scale"], spec.get("flats", False), cs, 3 if six8 else 4)
        else:
            second += fid
    crash_bar = "C:%d" % BS
    changeup = {"lead2": second, "drums2": [rest] * 7 + [fill_bar, crash_bar] + [rest] * 6 + [fill_bar]}

    return BS, meta, {"changeup": ({}, changeup), "grand": ({}, grand), "breakdown": (mute, breakdown)}


def emit(tid):
    BS, meta, variations = build(tid)
    spec = SPECS[tid]
    cycle = CYCLES.get(tid, CYCLES["default"])
    loop_secs = 16 * BS * 60 / meta["bpm"] / meta["spb"]
    total = loop_secs * len(cycle)
    L = []
    L.append("        // %s" % spec["comment"].split(". ")[0] + ". The short loop over and over, with a variation every few times round.")
    L.append("        // One loop is %d s; the whole cycle is about %d:%02d before it repeats." % (loop_secs, total // 60, total % 60))
    L.append('        "%s": {' % tid)
    L.append('            title: "%s", group: "chapter", volume: %s,' % (spec["title"], meta["volume"]))
    L.append('            mood: "%s",' % meta["mood"])
    L.append("            bpm: %d, stepsPerBeat: %d, barSteps: %d," % (meta["bpm"], meta["spb"], BS))
    L.append('            // The normal loop is the "%s-short" track (same notes).' % tid)
    L.append('            loop: "%s-short",' % tid)
    L.append("            // The order the passes play in, then it starts again. Each pass is one time round the loop.")
    L.append("            cycle: [%s]," % ", ".join('"%s"' % c for c in cycle))
    L.append("            // Each variation changes some parts of the normal loop: `mute` silences parts,")
    L.append("            // `channels` replaces or adds parts, `volume` sets that pass's level.")
    L.append("            variations: {")
    desc = {
        "changeup": "Change-up: a second fiddle joins in, with drum fills.",
        "grand": "Grand: the horns double the tune, big taiko and cymbals, deep bass.",
        "breakdown": "Breakdown: just the fiddle, a plucked bass and light drums, then a fill back in.",
    }
    for name in ("changeup", "grand", "breakdown"):
        mute, chans = variations[name]
        L.append("                // %s" % desc[name])
        L.append("                %s: {" % name)
        L.append("                    volume: %s," % TRACK_VOLUMES.get(tid, {}).get(name, VOLUMES[name]))
        if mute:
            L.append("                    mute: [%s]," % ", ".join('"%s"' % m for m in mute))
        L.append("                    channels: {")
        for c, bars in chans.items():
            assert len(bars) == 16, (tid, name, c)
            L.append("                        %s: [" % c)
            longest = max(len(b) for b in bars)
            per = 4 if longest < 34 else 2 if longest < 70 else 1
            for i in range(0, 16, per):
                L.append("                            " + " ".join('"%s",' % b for b in bars[i:i + per]))
            L.append("                        ],")
        L.append("                    },")
        L.append("                },")
    L.append("            },")
    L.append("        },")
    return "\n".join(L), loop_secs, total, cycle


if __name__ == "__main__":
    src = P.read_text(encoding="utf-8")
    for tid in ["sea-legs", "pressure", "locks-keys", "gunpowder", "crossfire", "davy-jones"]:
        text, loop_secs, total, cycle = emit(tid)
        m = re.search(r'(        // [^\n]*\n)+        "%s": \{\n.*?\n        \},\n' % tid, src, re.S)
        src = src[:m.start()] + text + "\n" + src[m.end():]
        print("%-12s loop %4.1fs  cycle %d passes = %d:%02d  %s" % (tid, loop_secs, len(cycle), total // 60, total % 60, " ".join(cycle)))
    P.write_text(src, encoding="utf-8")
