"""Long-form chapter tracks with room layers. Writes them into audio.js in place.

Each chapter track is assembled from sections (intro, A, B, A2, C, build, ...).
Templates like {x} are filled per bar from the chord (see compose.py).
"""
import re, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from compose import fill, PC, chord

NAMES_SHARP = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]
NAMES_FLAT = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"]
TOK = re.compile(r"^([A-G])([#b]?)(-?\d)$")


def midi(n):
    m = TOK.match(n)
    return PC[m.group(1)] + {"": 0, "#": 1, "b": -1}[m.group(2)] + (int(m.group(3)) + 1) * 12


def map_notes(bar, fn):
    out = []
    for tok in bar.split():
        what, _, n = tok.partition(":")
        if what != "r":
            what = "+".join(fn(p) for p in what.split("+"))
        out.append(what + (":" + n if n else ""))
    return " ".join(out)


def shift(bars, octaves):
    def f(n):
        m = TOK.match(n)
        return m.group(1) + m.group(2) + str(int(m.group(3)) + octaves)
    return [map_notes(b, f) for b in bars]


def notes_of(bars):
    return [midi(p) for b in bars for tok in b.split() for p in tok.split(":")[0].split("+") if tok.split(":")[0] != "r"]


def thirds_below(bars, scale, flats, chords=None, long=4):
    """Second fiddle: each note a diatonic third lower (chromatic notes a minor third).
    Long notes that would clash with the bar's chord snap to a chord tone below instead."""
    names = NAMES_FLAT if flats else NAMES_SHARP
    pcs = [PC[s[0]] + (1 if s[1:] == "#" else -1 if s[1:] == "b" else 0) for s in scale]
    pcs = [p % 12 for p in pcs]

    def spell(new, prefer=None):
        pc = new % 12
        name = prefer.get(pc) if prefer and pc in prefer else (scale[pcs.index(pc)] if pc in pcs else names[pc])
        letter = name[0]
        acc = 1 if name[1:] == "#" else -1 if name[1:] == "b" else 0
        return name + str((new - PC[letter] - acc) // 12 - 1)

    out = []
    for bi, bar in enumerate(bars):
        tones = {}
        if chords:
            for n in chord(chords[bi])["v"]:
                nm = n.name()
                tones[n.midi % 12] = nm[:-1] if not nm[-2].isdigit() and nm[-2] != "-" else nm[:-1]
        toks = []
        for tok in bar.split():
            what, _, n = tok.partition(":")
            steps = int(n or 1)
            if what != "r":
                parts = []
                for p in what.split("+"):
                    m = midi(p)
                    if m % 12 in pcs:
                        i = pcs.index(m % 12)
                        new = m - ((m - pcs[(i - 2) % 7]) % 12)
                        if new == m:
                            new -= 12
                    else:
                        new = m - 3
                    if tones and steps >= long and new % 12 not in tones:
                        below = [m - d for d in range(3, 10) if (m - d) % 12 in tones]
                        if below:
                            new = below[0]
                    parts.append(spell(new, tones))
                what = "+".join(parts)
            toks.append(what + (":" + n if n else ""))
        out.append(" ".join(toks))
    return out


def crash(bar):
    toks = bar.split()
    what, _, n = toks[0].partition(":")
    toks[0] = ("C" if what == "r" else what + "+C") + (":" + n if n else "")
    return " ".join(toks)


def loop(pattern, n):
    return [pattern[i % len(pattern)] for i in range(n)]


def build_track(t):
    six8 = t["barSteps"] == 12
    BS = t["barSteps"]
    rest = "r:%d" % BS
    A, B, C = t["A"], t["B"], t["C"]
    accomp = t["accomp"]
    lead2_on = "lead2" in t["layers"]
    scale, flats = t["scale"], t.get("flats", False)

    def a2_lead(bars):
        ns = notes_of(bars)
        if min(ns) - 12 >= 55:
            return shift(bars, -1)
        if max(ns) + 12 <= 88:
            return shift(bars, 1)
        return bars

    def brass_double(bars):
        ns = notes_of(bars)
        return shift(bars, -1) if min(ns) - 12 >= 50 else bars

    stab = t["stab"]
    LONG = 3 if six8 else 4
    if six8:
        intro_pick = "r:6 {4}:2 {5}:2 {6}:2"
        build_lead = ["{1}:2 {2}:2 {3}:2 {4}:2 {3}:2 {2}:2", "{2}:2 {3}:2 {4}:2 {5}:2 {4}:2 {3}:2",
                      "{3}:2 {4}:2 {5}:2 {6}:2 {5}:2 {4}:2", "{4}:2 {5}:2 {6}:2 {7}:6"]
        tag_lead = ["{6}:4 {5}:2 {4}:6", "{5}:4 {4}:2 {6}:6", "{4}:4 {5}:2 {6}:6", "{5}:2 {4}:2 {3}:8"]
        fill_bar = "r:6 S:1 S:1 S:1 S:1 S:2"
        build_drums = ["S:2 S:2 S:2 S:2 S:2 S:2", "S:2 S:2 S:2 S:2 S:2 S:2", "S:1 " * 11 + "S:1", "S:1 S:1 S:1 S:1 S:1 S:1 B:2 B:2 B:2"]
        build_brass = "{x}:6 {x}:6"
    else:
        intro_pick = "r:8 {4}:2 {5}:2 {6}:4"
        build_lead = ["{1}:2 {2}:2 {3}:2 {4}:2 {3}:2 {2}:2 {3}:2 {4}:2", "{2}:2 {3}:2 {4}:2 {5}:2 {4}:2 {3}:2 {4}:2 {5}:2",
                      "{3}:2 {4}:2 {5}:2 {6}:2 {5}:2 {4}:2 {5}:2 {6}:2", "{4}:2 {5}:2 {6}:2 {7}:2 {6}:2 {5}:2 {6}:4"]
        tag_lead = ["{6}:6 {5}:2 {4}:8", "{5}:6 {4}:2 {6}:8", "{4}:6 {5}:2 {6}:8", "{5}:4 {4}:4 {3}:8"]
        fill_bar = "r:8 S:1 S:1 S:1 S:1 S:2 S:2"
        build_drums = ["S:2 " * 7 + "S:2", "S:2 " * 7 + "S:2", "S:1 " * 15 + "S:1", "S:1 " * 8 + "B:2 B:2 B:2 B:2"]
        build_brass = "{x}:4 {x}:4 {x}:4 {x}:4"
    build_drums = [b.strip() for b in build_drums]

    intro_chords = A["chords"][:3] + [A["chords"][7]]
    over = t.get("brass", {})
    S = []  # (label, chords, {channel: bars})

    def sec(label, chords, parts, accomp_kind="A"):
        S.append((label, chords, parts, accomp_kind))

    light, heavy = t["drums"], t["drums2"]
    sec("intro", intro_chords, {"lead": [rest] * 3 + [intro_pick], "drums": loop(light, 4),
                                "drums2": [rest] * 3 + [fill_bar]}, "intro")
    sec("A", A["chords"], {"lead": A["lead"], "brass": over.get("A", [stab] * 8),
                           "drums": loop(light, 8), "drums2": [crash(heavy[0])] + loop(heavy, 8)[1:],
                           **{k: v for k, v in A.get("extra", {}).items()}})
    sec("B", B["chords"], {"lead": B["lead"], "brass": over.get("B", [stab] * 8),
                           "drums": loop(light, 8), "drums2": loop(heavy, 8),
                           **{k: v for k, v in B.get("extra", {}).items()}}, "B")
    a2 = {"lead": a2_lead(A["lead"]), "brass": [stab] * 8, "drums": loop(light, 8), "drums2": loop(heavy, 8)}
    if lead2_on:
        a2["lead2"] = thirds_below(A["lead"], scale, flats, A["chords"], LONG)
    sec("A2", A["chords"], a2)
    if six8:
        b2 = {"lead": B["lead"], "brass": brass_double(B["lead"]), "drums": loop(light, 8),
              "drums2": [crash(heavy[0])] + loop(heavy, 8)[1:], **B.get("extra", {})}
        sec("B2", B["chords"], b2, "B")
    sec("C", C["chords"], {"lead": C["lead"], "brass": [stab] * 8, "drums": loop(light, 8), "drums2": loop(heavy, 8)}, "C")
    c2 = {"lead": C["lead"], "brass": brass_double(C["lead"]), "drums": loop(light, 8), "drums2": loop(heavy, 8)}
    if lead2_on:
        c2["lead2"] = thirds_below(C["lead"], scale, flats, C["chords"], LONG)
    sec("C2", C["chords"], c2, "C")
    sec("build", t["build_chords"], {"lead": build_lead, "brass": [build_brass] * 4, "drums": loop(light, 4),
                                     "drums2": build_drums}, "build")
    if not six8:
        sec("B2", B["chords"], {"lead": B["lead"], "brass": brass_double(B["lead"]), "drums": loop(light, 8),
                                "drums2": [crash(heavy[0])] + loop(heavy, 8)[1:], **B.get("extra", {})}, "B")
        sec("A3", A["chords"], {"lead": A["lead"], "brass": over.get("A3", brass_double(A["lead"])),
                                "drums": loop(light, 8), "drums2": [crash(heavy[0])] + loop(heavy, 8)[1:],
                                **({"lead2": thirds_below(A["lead"], scale, flats, A["chords"], LONG)} if lead2_on else {}),
                                **A.get("extra", {})})
    else:
        sec("A3", A["chords"], {"lead": A["lead"], "brass": over.get("A3", brass_double(A["lead"])),
                                "drums": loop(light, 8), "drums2": [crash(heavy[0])] + loop(heavy, 8)[1:],
                                **({"lead2": thirds_below(A["lead"], scale, flats, A["chords"], LONG)} if lead2_on else {}),
                                **A.get("extra", {})})
        b3 = {"lead": B["lead"], "brass": [stab] * 8, "drums": loop(light, 8), "drums2": loop(heavy, 8), **B.get("extra", {})}
        if lead2_on:
            b3["lead2"] = thirds_below(B["lead"], scale, flats, B["chords"], LONG)
        sec("B3", B["chords"], b3, "B")
    sec("tag", t["tag_chords"], {"lead": tag_lead, "drums": loop(light, 4), "drums2": [rest] * 3 + [fill_bar]}, "tag")

    channels = list(t["layers"].keys())
    out = {ch: [] for ch in channels}
    for label, chords, parts, kind in S:
        n = len(chords)
        for ch in channels:
            if ch in parts:
                bars = parts[ch]
            else:
                tmpl = accomp.get(kind, {}).get(ch, accomp["A"].get(ch)) if kind in accomp else accomp["A"].get(ch)
                if isinstance(tmpl, list):
                    bars = loop(tmpl, n)
                elif tmpl:
                    bars = [tmpl] * n
                else:
                    bars = [rest] * n
            assert len(bars) == n, (t["id"], label, ch, len(bars), n)
            bars = [fill(b, chords[i]) if "{" in b else b for i, b in enumerate(bars)]
            out[ch].append((label, bars))
    return out, sum(len(c) for _, c, _, _ in S)


def emit(t):
    chans, nbars = build_track(t)
    secs = nbars * t["barSteps"] * 60 / t["bpm"] / t["spb"]
    L = []
    L.append("        // %s" % t["comment"])
    L.append("        // %d bars, about %d:%02d before it loops." % (nbars, secs // 60, secs % 60))
    L.append('        "%s": {' % t["id"])
    L.append('            title: "%s", group: "chapter", volume: %s,' % (t["title"], t.get("volume", 1.0)))
    L.append('            mood: "%s",' % t["mood"])
    L.append("            bpm: %d, stepsPerBeat: %d, barSteps: %d," % (t["bpm"], t["spb"], t["barSteps"]))
    L.append("            // The room (1-4) each instrument joins in. Room 1 is sparse; room 4 is the full band.")
    L.append("            layers: { %s }," % ", ".join("%s: %d" % kv for kv in t["layers"].items()))
    L.append("            channels: {")
    for ch, sections in chans.items():
        L.append("                %s: [" % ch)
        for label, bars in sections:
            L.append("                    // %s" % label)
            longest = max(len(b) for b in bars)
            per = 4 if longest < 34 else 2 if longest < 70 else 1
            for i in range(0, len(bars), per):
                L.append("                    " + " ".join('"%s",' % b for b in bars[i:i + per]))
        L.append("                ],")
    L.append("            },")
    L.append("        },")
    return "\n".join(L), nbars, secs


T = []

# ------------------------------------------------------------------ Chapter 1
T.append(dict(
    id="sea-legs", title="Sea Legs", volume=1.0, bpm=72, spb=6, barSteps=12,
    scale=["A", "B", "C", "D", "E", "F#", "G"],
    comment="Chapter 1: \"Sea Legs\". A dorian, 6/8. Light and curious: a hopping fiddle tune over plucked bass, accordion and tambourine.",
    mood="Light, curious and jaunty in A dorian: fiddle, pizzicato, accordion",
    layers={"lead": 1, "pizz": 1, "drums": 1, "squeeze": 2, "cello": 2, "bell": 3, "ostinato": 3, "lead2": 3, "brass": 4, "drums2": 4},
    stab="r:6 {x}:2 r:2 {x}:2",
    A=dict(chords="Am D Am D C G E E".split(), lead=[
        "E5:2 r:1 A4:1 C5:2 E5:2 D5:1 C5:1 B4:2", "A4:2 D5:2 F#5:2 E5:4 r:2", "E5:2 r:1 A4:1 C5:2 E5:2 F#5:1 G5:1 A5:2", "F#5:2 D5:2 A4:2 D5:4 r:2",
        "G5:2 E5:1 C5:1 G4:2 C5:2 E5:2 G5:2", "D5:2 B4:1 G4:1 D4:2 G4:2 B4:2 D5:2", "B4:3 C5:1 B4:2 G#4:2 A4:2 B4:2", "E5:6 r:6"],
        extra={"bell": ["r:12", "r:8 D6:2 F#6:2", "r:12", "r:8 A5:2 D6:2", "r:12", "r:8 B5:2 D6:2", "r:12", "r:12"]}),
    B=dict(chords="Am G D Am C D E E".split(), lead=[
        "A5:4 G5:1 F#5:1 E5:2 C5:2 E5:2", "D5:4 B4:2 G4:2 B4:2 D5:2", "F#5:4 E5:1 D5:1 A4:2 D5:2 F#5:2", "E5:6 r:6",
        "G5:4 F#5:1 E5:1 C5:2 E5:2 G5:2", "A5:4 G5:1 F#5:1 D5:2 F#5:2 A5:2", "G#5:2 A5:2 B5:2 E5:3 F#5:1 G#5:2", "B5:6 r:6"],
        extra={"bell": ["r:12", "r:12", "r:12", "r:8 C6:2 E6:2", "r:12", "r:12", "r:12", "r:8 G#5:2 B5:2"]}),
    C=dict(chords="F G C Am F G E E".split(), lead=[
        "A5:3 G5:1 F5:2 C5:2 F5:2 A5:2", "B5:3 A5:1 G5:2 D5:2 G5:2 B5:2", "C6:4 B5:1 A5:1 G5:2 E5:2 C5:2", "E5:2 A5:2 C6:2 B5:4 r:2",
        "A5:2 C6:2 A5:2 G5:2 F5:2 E5:2", "D5:2 G5:2 B5:2 A5:2 G5:2 F#5:2", "G#5:2 B5:2 E6:2 D6:2 B5:2 G#5:2", "B5:6 G#5:2 A5:2 B5:2"]),
    build_chords="D D E E".split(), tag_chords="Am D Am E".split(),
    accomp={
        "A": {"pizz": "{r}:2 r:2 {o}:2 {f}:2 r:2 {o}:2", "squeeze": "r:2 {x}:2 r:2 r:2 {x}:2 r:2", "cello": "{r}:6 {r}:6",
              "ostinato": "{o}:2 r:1 {o}:1 {p}:2 {o}:2 r:1 {o}:1 {p}:2", "bell": "r:12"},
        "C": {"bell": "{6}:6 {5}:6"},
        "intro": {"squeeze": "r:12", "ostinato": "r:12"},
    },
    drums=["F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1"],
    drums2=["B:2 r:10", "B:2 r:4 S:2 r:2 S:1 S:1"],
))

# ------------------------------------------------------------------ Chapter 2
PB = ["E4:4 G4:2 C5:4 B4:2 C5:2 E5:2", "F#4:4 E4:2 D4:4 A3:2 D4:2 F#4:2", "G4:4 F#4:2 E4:2 B3:2 E4:2 G4:4", "B4:4 A4:2 G4:2 F#4:2 E4:2 B3:4",
      "E4:4 G4:2 C5:4 B4:2 A4:2 G4:2", "A4:4 F#4:2 D4:4 E4:2 F#4:2 A4:2", "D#4:2 F#4:2 B4:4 A4:2 F#4:2 D#4:4"]
T.append(dict(
    id="pressure", title="Pressure", volume=0.9, bpm=124, spb=4, barSteps=16,
    scale=["E", "F#", "G", "A", "B", "C", "D"],
    comment="Chapter 2: \"Pressure\". E minor, 4/4, brisk. Clockwork heist: ticking plucks and a whirring string arpeggio under a sneaky fiddle, anvil ticks and horn stabs.",
    mood="Clockwork heist in E minor: ticking plucks, whirring strings, sneaky fiddle",
    layers={"lead": 1, "pizz": 1, "drums": 1, "cello": 2, "ostinato": 3, "lead2": 3, "brass": 4, "drums2": 4},
    stab="{x}:2 r:10 {x}:2 r:2",
    A=dict(chords="Em Em C B Em Em Am B".split(), lead=[
        "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 B3:4",
        "E5:2 D5:2 C5:2 B4:2 A4:2 G4:2 A4:2 C5:2", "B4:4 D#5:2 F#5:2 A5:3 G5:1 F#5:4",
        "E5:2 F#5:2 G5:2 E5:2 B5:3 A#5:1 B5:2 G5:2", "F#5:2 G5:2 A5:2 F#5:2 E5:4 G5:2 B5:2",
        "C6:2 B5:2 A5:2 G5:2 E5:2 F#5:2 G5:2 A5:2", "B5:2 A5:2 F#5:2 D#5:2 B4:4 r:4"]),
    B=dict(chords="C D Em Em C D B B".split(), lead=shift(PB, 1) + ["F#5:2 B5:2 D#6:2 F#6:2 D#6:2 B5:2 F#5:4"],
           extra={"lead2": [
               "r:8 G5:1 F#5:1 G5:1 F#5:1 G5:2 E5:2", "r:8 A5:1 G#5:1 A5:1 G#5:1 A5:2 F#5:2",
               "r:8 B5:1 A#5:1 B5:1 A#5:1 B5:2 G5:2", "r:8 E5:1 D#5:1 E5:1 D#5:1 E5:2 B4:2",
               "r:8 G5:1 F#5:1 G5:1 F#5:1 G5:2 C6:2", "r:8 A5:1 G#5:1 A5:1 G#5:1 A5:2 D6:2",
               "r:8 D#5:1 E5:1 D#5:1 E5:1 F#5:2 B4:2", "r:8 F#5:1 G5:1 F#5:1 F5:1 F#5:4"]}),
    C=dict(chords="Am Am C C Am Am B B".split(), lead=[
        "A4:1 r:1 C5:1 r:1 E5:2 D#5:2 E5:2 C5:2 A4:4", "B4:2 C5:2 D5:2 E5:2 F5:3 E5:1 D5:2 C5:2",
        "G4:1 r:1 C5:1 r:1 E5:2 D5:2 C5:2 B4:2 G4:4", "A4:2 B4:2 C5:2 D5:2 E5:4 G5:4",
        "A5:1 r:1 E5:1 r:1 C5:2 E5:2 A5:2 G5:2 E5:4", "F5:2 E5:2 D5:2 C5:2 B4:2 C5:2 D5:2 E5:2",
        "D#5:2 F#5:2 B5:4 A5:2 G5:2 F#5:4", "D#5:1 E5:1 F#5:1 G5:1 A5:1 B5:1 C6:1 D#6:1 F#6:8"]),
    build_chords="C C B B".split(), tag_chords="Em C Am B".split(),
    accomp={
        "A": {"pizz": "{o}:2 {p}:2 {h}:2 {p}:2 {o}:2 {p}:2 {h}:2 {p}:2",
              "ostinato": "{o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1 {p}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1 {p}:1 {o}:1",
              "cello": "{r}:2 r:2 {r}:2 r:2 {r}:2 r:2 {f}:2 {r}:2"},
        "intro": {"ostinato": "r:16"},
    },
    drums=["K:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 K:2", "K:2 h:1 h:1 A:2 K:2 F:2 h:1 h:1 A:2 h:1 h:1"],
    drums2=["B:4 r:4 S:4 r:4", "B:4 r:2 B:2 S:4 S:1 S:1 S:1 S:1"],
))

# ------------------------------------------------------------------ Chapter 3
LA = ["A3:6 D4:3 E4:1 F4:2", "F4:3 E4:1 D4:2 Bb3:2 D4:2 F4:2", "A3:2 D4:2 E4:2 F4:3 G4:1 A4:2", "Bb4:6 A4:3 G4:1 F4:2",
      "G4:4 Bb4:2 D5:6", "C5:3 Bb4:1 A4:2 F4:2 A4:2 D5:2", "G4:2 A4:2 Bb4:2 D5:3 C5:1 Bb4:2", "A4:6 C#4:2 E4:2 A4:2"]
T.append(dict(
    id="locks-keys", title="Locks and Keys", volume=0.9, bpm=80, spb=6, barSteps=12, flats=True,
    scale=["D", "E", "F", "G", "A", "Bb", "C"],
    comment="Chapter 3: \"Locks and Keys\". D minor, quick 6/8. Mysterious but on the move: music-box bells turn like a key; a horn call, then the fiddle climbs.",
    mood="Mysterious and adventurous in D minor: music-box bells, horn call, gallop",
    layers={"lead": 1, "bell": 1, "drums": 1, "cello": 2, "pizz": 2, "ostinato": 3, "lead2": 3, "brass": 4, "drums2": 4},
    stab="{x}:2 r:2 {x}:2 r:4 {x}:2",
    A=dict(chords="Dm Bb Dm Bb Gm Dm Gm A".split(), lead=shift(LA, 1)),
    B=dict(chords="F C Bb F Gm Bb A A".split(), lead=[
        "A5:4 C6:2 A5:3 G5:1 F5:2", "G5:2 E5:1 F5:1 G5:2 E5:2 C5:2 E5:2", "F5:4 D5:2 Bb4:2 D5:2 F5:2", "A5:6 G5:2 A5:2 C6:2",
        "D6:4 C6:2 Bb5:2 A5:2 G5:2", "F5:3 G5:1 F5:2 D5:2 E5:2 F5:2", "C#5:2 E5:2 A5:2 G5:3 F5:1 E5:2", "C#5:2 D5:2 E5:2 F5:2 G5:2 A5:2"]),
    C=dict(chords="Gm C F Dm Bb Gm A A".split(), lead=[
        "D5:2 G5:2 Bb5:2 A5:3 G5:1 D5:2", "E5:2 G5:2 C6:2 Bb5:3 A5:1 G5:2", "A5:4 F5:2 C5:2 F5:2 A5:2", "D6:6 A5:3 F5:1 D5:2",
        "F5:2 Bb5:2 D6:2 C6:2 Bb5:2 A5:2", "G5:2 Bb5:2 D6:2 C6:2 Bb5:2 G5:2", "A5:2 C#6:2 E6:2 D6:2 C#6:2 A5:2", "E5:2 F5:2 G5:2 A5:2 Bb5:2 C#6:2"]),
    brass={"A": LA, "A3": LA},
    build_chords="Bb Bb A A".split(), tag_chords="Dm Bb Gm A".split(),
    accomp={
        "A": {"bell": "{4}:2 {5}:2 {6}:2 {5}:2 {4}:2 {5}:2", "cello": "{r}:4 {r}:2 {r}:4 {f}:2",
              "pizz": "{o}:2 r:4 {p}:2 r:4", "ostinato": "{o}:2 {o}:1 {o}:1 {o}:2 {p}:2 {o}:1 {o}:1 {o}:2"},
        "B": {"bell": "{6}:2 {5}:2 {4}:2 {6}:2 {5}:2 {4}:2"},
        "C": {"bell": "{4}:1 {5}:1 {6}:1 {5}:1 {4}:2 {6}:2 {5}:2 {4}:2"},
        "tag": {"bell": "{6}:2 {5}:2 {4}:2 {5}:2 {4}:4"},
    },
    drums=["F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 J:2 F:2 J:1 J:1 F:1 F:1"],
    drums2=["B:2 r:4 S:2 r:4", "B:2 r:2 B:2 S:2 S:1 S:1 S:2"],
))

# ------------------------------------------------------------------ Chapter 4
T.append(dict(
    id="gunpowder", title="Gunpowder", volume=0.92, bpm=112, spb=4, barSteps=16,
    scale=["A", "B", "C", "D", "E", "F", "G"],
    comment="Chapter 4: \"Gunpowder\". A minor, 4/4. Bold and martial: a marching tune over snare and taiko, then the fiddle charges over horn stabs.",
    mood="Bold and martial in A minor: marching horns, snare rolls, taiko",
    layers={"lead": 1, "pizz": 1, "drums": 1, "cello": 2, "ostinato": 3, "lead2": 3, "brass": 4, "drums2": 4},
    stab="{x}:2 r:2 {x}:2 r:6 {x}:2 {x}:2",
    A=dict(chords="Am Am F G Am Am F E".split(), lead=[
        "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8", "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
        "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8", "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8"]),
    B=dict(chords="Dm Am F G Dm Am E E".split(), lead=[
        "D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:2 A5:2", "E5:2 A5:2 C6:2 E6:2 D6:2 C6:2 B5:2 C6:2",
        "A5:4 F5:2 C5:2 F5:4 A5:4", "G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2",
        "F5:4 A5:4 D6:6 C6:2", "C6:4 B5:2 A5:2 E5:8",
        "G#5:2 A5:2 B5:2 C6:2 D6:2 C6:2 B5:2 G#5:2", "B5:8 G#5:4 E5:4"]),
    C=dict(chords="F F C C Dm Dm E E".split(), lead=[
        "C5:2 F5:2 A5:4 G5:2 F5:2 E5:2 F5:2", "A5:6 G5:2 F5:4 C5:4", "E5:2 G5:2 C6:4 B5:2 A5:2 G5:2 E5:2", "G5:6 E5:2 C5:8",
        "D5:3 D5:1 F5:4 A5:3 A5:1 D6:4", "C6:2 A5:2 F5:2 A5:2 D6:8", "B5:3 B5:1 G#5:4 E5:3 E5:1 B4:4", "E5:2 F5:2 G#5:2 A5:2 B5:2 C6:2 D6:2 E6:2"]),
    build_chords="Dm Dm E E".split(), tag_chords="Am F Dm E".split(),
    accomp={
        "A": {"pizz": "{o}:2 r:2 {p}:2 r:2 {o}:2 r:2 {p}:2 {o}:2",
              "ostinato": "{o}:2 {o}:1 {o}:1 {o}:2 {o}:1 {o}:1 {o}:2 {o}:1 {o}:1 {p}:2 {o}:1 {o}:1",
              "cello": "{r}:2 r:2 {r}:2 r:2 {r}:2 r:2 {f}:2 {r}:2"},
    },
    drums=["k:2 s:1 s:1 h:2 s:1 s:1 k:2 s:1 s:1 h:2 s:1 s:1", "k:2 s:1 s:1 h:2 s:1 s:1 k:2 s:1 s:1 s:1 s:1 s:1 s:1"],
    drums2=["B:4 r:2 B:2 S:4 r:4", "B:4 r:2 B:2 S:2 S:1 S:1 S:1 S:1 S:1 S:1"],
))

# ------------------------------------------------------------------ Chapter 5
CB = ["C4:6 Eb4:3 D4:1 C4:2", "D4:6 Bb3:6", "Eb4:4 G4:2 C5:6", "Bb4:3 A4:1 G4:2 D4:6",
      "Eb4:4 G4:2 Bb4:4 G4:2", "C5:4 A4:2 F4:4 A4:2", "D5:6 C5:2 Bb4:2 A4:2", "F#4:6 A4:6"]
T.append(dict(
    id="crossfire", title="Crossfire", volume=0.85, bpm=76, spb=6, barSteps=12, flats=True,
    scale=["G", "A", "Bb", "C", "D", "Eb", "F"],
    comment="Chapter 5: \"Crossfire\". G minor, 6/8. Urgent and stormy: rushing strings, a fiddle racing down the scale, horns riding the storm.",
    mood="Urgent and stormy in G minor: rushing strings, racing fiddle, horns",
    layers={"lead": 1, "pizz": 1, "drums": 1, "cello": 2, "squeeze": 2, "ostinato": 3, "lead2": 3, "brass": 4, "drums2": 4},
    stab="{x}:2 r:4 {x}:2 r:2 {x}:2",
    A=dict(chords="Gm F Eb D Gm F Eb D".split(), lead=[
        "D5:2 G5:2 A5:1 Bb5:1 A5:2 G5:2 D5:2", "C5:2 F5:2 G5:1 A5:1 G5:2 F5:2 C5:2", "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 F#5:2 A5:6",
        "Bb5:2 A5:1 G5:1 D5:2 G5:2 A5:1 Bb5:1 C6:2", "A5:2 G5:1 F5:1 C5:2 F5:2 G5:1 A5:1 Bb5:2", "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:2 G5:2", "F#5:6 D5:2 E5:2 F#5:2"]),
    B=dict(chords="Cm Gm Cm Gm Eb F D D".split(), lead=shift(CB, 1),
           extra={"lead2": ["G5:12", "D5:12", "G5:12", "Bb5:12", "G5:6 Bb5:6", "A5:6 C6:6", "D6:12", "C6:6 A5:6"]}),
    C=dict(chords="Eb Eb Bb Bb Cm Cm D D".split(), lead=[
        "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 G5:2 Bb5:2", "Bb5:3 Ab5:1 G5:2 F5:2 Eb5:2 G5:2", "F5:2 D5:1 Bb4:1 F4:2 Bb4:2 D5:2 F5:2", "A5:3 G5:1 F5:2 D5:6",
        "Eb5:2 G5:2 C6:2 Bb5:2 Ab5:2 G5:2", "F5:2 Eb5:1 D5:1 C5:2 Eb5:2 G5:2 C6:2", "A5:2 F#5:1 D5:1 A4:2 D5:2 F#5:2 A5:2", "C6:2 Bb5:1 A5:1 G5:2 F#5:2 E5:2 F#5:2"]),
    brass={"B": CB},
    build_chords="Eb Eb D D".split(), tag_chords="Gm Eb Cm D".split(),
    accomp={
        "A": {"pizz": "{o}:2 {p}:2 {h}:2 {o}:2 {p}:2 {h}:2", "squeeze": "{x}:2 r:4 {x}:2 r:4",
              "ostinato": "{o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1", "cello": "{r}:6 {r}:6"},
        "intro": {"squeeze": "r:12"},
    },
    drums=["F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 F:2 J:1 J:1 J:2"],
    drums2=["B:2 r:4 S:2 r:2 B:2", "B:2 r:2 B:2 S:2 S:1 S:1 T:2"],
))

# ------------------------------------------------------------------ Chapter 6
DA = ["C4:6 G3:2 C4:2 D4:2 Eb4:4", "Eb4:6 C4:2 Ab3:8", "G4:6 F4:2 Eb4:2 D4:2 C4:4", "Eb4:8 Ab4:8",
      "Ab4:6 G4:2 F4:2 Eb4:2 C4:4", "G4:6 Eb4:2 C4:8", "D4:4 G4:4 B4:8", "D5:6 C5:2 B4:8"]
T.append(dict(
    id="davy-jones", title="Davy Jones", volume=0.78, bpm=80, spb=4, barSteps=16, flats=True,
    scale=["C", "D", "Eb", "F", "G", "Ab", "Bb"],
    comment="Chapter 6: \"Davy Jones\". C minor, 4/4. The finale: dark and majestic. Low horns and a tolling bell over pounding strings; the fiddle soars over a Db major lift.",
    mood="Epic and dark-majestic in C minor: low horns, tolling bell, taiko",
    layers={"lead": 1, "pizz": 1, "bell": 1, "drums": 1, "cello": 2, "sub": 2, "ostinato": 3, "strings": 3, "lead2": 3, "brass": 4, "drums2": 4},
    stab="{x}:6 {x}:2 r:4 {x}:4",
    A=dict(chords="Cm Ab Cm Ab Fm Cm G G".split(), lead=shift(DA, 1)),
    B=dict(chords="Ab Eb Bb Cm Db Ab G G".split(), lead=[
        "C6:6 Bb5:2 Ab5:2 G5:2 Ab5:4", "G5:6 F5:2 Eb5:8", "F5:6 G5:2 Ab5:2 Bb5:2 D6:4", "Eb6:8 D6:4 C6:4",
        "Db6:6 C6:2 Ab5:8", "C6:4 Eb6:4 Ab5:8", "B5:4 C6:2 D6:2 G5:8", "D6:8 B5:4 G5:4"]),
    C=dict(chords="Fm Db Ab Eb Fm Db G G".split(), lead=[
        "F5:4 Ab5:4 C6:6 Bb5:2", "Ab5:6 F5:2 Db5:8", "Eb5:4 Ab5:4 C6:4 Eb6:4", "Bb5:6 G5:2 Eb5:8",
        "C6:4 Ab5:2 F5:2 C6:4 F6:4", "F6:6 Eb6:2 Db6:8", "B5:4 D6:4 F6:4 D6:4", "G5:4 B5:4 D6:8"]),
    brass={"A": DA, "A3": DA},
    build_chords="Ab Ab G G".split(), tag_chords="Cm Ab Fm G".split(),
    accomp={
        "A": {"pizz": "{o}:4 {p}:4 {h}:4 {p}:4", "bell": "{h}:16", "cello": "{r}:8 {r}:8", "sub": "{r}:16",
              "ostinato": "{o}:2 {o}:2 {o}:2 {o}:2 {o}:2 {o}:2 {p}:2 {o}:2", "strings": "{x}:16"},
        "intro": {"strings": "r:16", "ostinato": "r:16"},
    },
    drums=["T:4 h:2 h:2 F:4 h:2 h:2", "T:4 h:2 h:2 F:2 F:2 T:2 T:2"],
    drums2=["B:4 r:4 B:2 B:2 r:4", "B:4 r:4 B:4 S:1 S:1 S:1 S:1"],
))


if __name__ == "__main__":
    P = pathlib.Path(r"C:\Users\jackk\BlockedV2\static\js\audio.js")
    src = P.read_text(encoding="utf-8")
    for t in T:
        text, nbars, secs = emit(t)
        m = re.search(r'(        // [^\n]*\n)+        "%s": \{\n.*?\n        \},\n' % t["id"], src, re.S)
        src = src[:m.start()] + text + "\n" + src[m.end():]
        print("%-12s %3d bars  %d:%02d" % (t["id"], nbars, secs // 60, secs % 60))
    P.write_text(src, encoding="utf-8")
