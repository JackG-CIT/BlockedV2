"""Chapter boss tracks (faster, grander versions of each chapter loop) and Eye of the Storm II.
Inserts/replaces them in audio.js."""
import re, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).parent))
from compose import fill
import compose3
from compose3 import P, SPECS

BOSS_BPM = {"sea-legs": 86, "pressure": 138, "locks-keys": 92, "gunpowder": 128, "crossfire": 88, "davy-jones": 96}
BOSS_VOL = {"sea-legs": 0.75, "pressure": 0.78, "locks-keys": 0.62, "gunpowder": 0.66, "crossfire": 0.63, "davy-jones": 0.7}


def bars_js(name, bars, indent):
    L = [" " * indent + "%s: [" % name]
    longest = max(len(b) for b in bars)
    per = 4 if longest < 34 else 2 if longest < 70 else 1
    for i in range(0, len(bars), per):
        L.append(" " * (indent + 4) + " ".join('"%s",' % b for b in bars[i:i + per]))
    L.append(" " * indent + "],")
    return L


def chapter_boss(tid):
    BS, meta, var = compose3.build(tid)
    spec = SPECS[tid]
    chords = spec["A"]["chords"] + spec["B"]["chords"]
    six8 = BS == 12
    grand = var["grand"][1]
    second = var["changeup"][1]["lead2"]
    if six8:
        drive = "B:2 r:2 B:2 B:2 r:2 S:2"
        first = "B+C:2 r:2 B:2 B:2 r:2 S:2"
        fillb = "B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1"
        ost = "{o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {p}:1 {h}:1 {o}:1 {p}:1"
    else:
        drive = "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2"
        first = "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2"
        fillb = "B:2 B:2 B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1"
        ost = "{o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1 {p}:1 {o}:1"
    drums2 = [first] + [drive] * 7 + [first] + [drive] * 6 + [fillb]
    boss = {"lead": grand["lead"], "brass2": grand["brass2"], "drums2": drums2,
            "ostinato2": [fill(ost, c) for c in chords]}
    if "sub" in grand:
        boss["sub"] = grand["sub"]
    boss2 = dict(boss)
    boss2["lead2"] = second
    loop_secs = 16 * BS * 60 / BOSS_BPM[tid] / meta["spb"]
    cycle = ["boss", "boss", "boss2"]
    L = []
    L.append('        // Chapter %s boss level: "%s" sped up (%d -> %d bpm) with the full band, horns on the tune, driving taiko and rushing strings.'
             % (list(SPECS).index(tid) + 1, spec["title"], meta["bpm"], BOSS_BPM[tid]))
    L.append("        // One loop is %d s; every third time round a second fiddle joins in." % loop_secs)
    L.append('        "%s-boss": {' % tid)
    L.append('            title: "%s (boss)", group: "chapter-boss", volume: %s,' % (spec["title"], BOSS_VOL[tid]))
    L.append('            mood: "Faster, grander %s for the chapter\'s hardest level",' % spec["title"])
    L.append("            bpm: %d, stepsPerBeat: %d, barSteps: %d," % (BOSS_BPM[tid], meta["spb"], BS))
    L.append('            loop: "%s-short",' % tid)
    L.append("            cycle: [%s]," % ", ".join('"%s"' % c for c in cycle))
    L.append("            variations: {")
    for name, chans in (("boss", boss), ("boss2", boss2)):
        L.append("                %s: {" % name)
        L.append("                    channels: {")
        for c, bars in chans.items():
            assert len(bars) == 16
            L += bars_js(c, bars, 24)
        L.append("                    },")
        L.append("                },")
    L.append("            },")
    L.append("        },")
    return "\n".join(L), loop_secs


# ---------------------------------------------------------------- Eye of the Storm II
def storm2():
    build = "Em C Em B".split()
    A = "Em C Em D Em C Am B".split()
    B = "C D Em Em C D B B".split()
    climax = "C Am B B".split()
    chords = build + A + B + climax
    theme = ["E4:4 B4:4 A4:2 G4:2 F#4:2 G4:2", "E4:6 G4:2 C5:8", "B4:4 E5:4 D5:2 B4:2 A4:2 B4:2", "A4:6 F#4:2 D4:8",
             "E5:4 B4:4 D5:2 C5:2 B4:2 A4:2", "G4:6 A4:2 C5:8", "C5:4 B4:2 A4:2 E5:4 C5:4", "D#5:8 F#5:4 B4:4"]
    soar = ["G4:4 C5:4 E5:6 D5:2", "F#5:4 E5:2 D5:2 A4:8", "B4:4 E5:4 G5:6 F#5:2", "E5:12 D5:2 B4:2",
            "C5:4 E5:4 G5:6 A5:2", "F#5:4 D5:4 A5:8", "B5:6 A5:2 F#5:4 D#5:4", "F#5:8 B4:8"]
    from compose2 import shift
    ostlow = "{o}:2 {o}:2 {p}:2 {o}:2 {o}:2 {o}:2 {p}:2 {o}:2"
    stabs = "{x}:2 r:2 {x}:2 r:2 {x}:4 {x}:4"
    ch = {
        "brass": [ostlow] * 4 + theme + soar + [stabs] * 4,
        "brass2": ["r:16"] * 4 + ["{o}:2 r:2 {o}:2 {o}:2 r:2 {o}:2 {p}:2 {o}:2"] * 16 + ["r:16"] * 4,
        "lead": ["r:16"] * 3 + ["B4:2 C5:2 D#5:2 E5:2 F#5:2 G5:2 A5:2 B5:2"] + shift(theme, 1) + soar + [
            "E5:2 G5:2 C6:2 E6:2 C6:2 G5:2 E5:2 G5:2", "A5:2 C6:2 E6:2 C6:2 A5:2 E5:2 C5:2 E5:2",
            "D#5:2 F#5:2 B5:2 D#6:2 F#6:4 D#6:4", "B5:2 A5:2 G5:2 F#5:2 E5:2 D#5:2 C5:2 B4:2"],
        "choir": ["{x}:16"] * 20 + ["{x}:8 {x}:8"] * 4,
        "ostinato": ["r:16"] * 2 + ["{o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1 {p}:1 {o}:1"] * 22,
        "cello": ["{r}:2 {r}:2 {r}:2 {r}:2 {r}:2 {r}:2 {f}:2 {r}:2"] * 24,
        "sub": ["{r}:16"] * 24,
        "drums": ["B:4 r:4 B:4 r:4", "B:4 r:4 B:2 B:2 B:2 B:2", "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2", "B:1 B:1 B:1 B:1 B:1 B:1 B:1 B:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1"]
                 + ["B+C:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2"] + ["B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2"] * 7
                 + ["B+C:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2"] + ["B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2"] * 7
                 + ["B+C:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1", "B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1",
                    "B:2 B:2 S:1 S:1 S:1 S:1 B:2 B:2 S:1 S:1 S:1 S:1", "B:1 B:1 B:1 B:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 T:2 T:2"],
        "drums2": ["r:16"] * 4 + ["T:4 r:4 T:4 A:4"] * 16 + ["C:16", "r:16", "C:16", "r:16"],
    }
    out = {k: [fill(b, chords[i]) if "{" in b else b for i, b in enumerate(v)] for k, v in ch.items()}
    L = ['        // Boss: "Eye of the Storm II". E minor, 4/4, fast. The Eye of the Storm horn theme made bigger: a stormy taiko build,',
         '        // a low horn ostinato and choir under the theme, then a new soaring horn tune and a climax of snare rolls.',
         '        "boss-storm-v2": {',
         '            title: "Eye of the Storm II", group: "boss", volume: 0.85,',
         '            mood: "Huge boss version of Eye of the Storm: taiko build, choir, low horn ostinato, soaring horns",',
         "            bpm: 140, stepsPerBeat: 4, barSteps: 16,",
         "            channels: {"]
    for k, bars in out.items():
        assert len(bars) == 24, k
        L += bars_js(k, bars, 16)
    L += ["            },", "        },"]
    return "\n".join(L)


if __name__ == "__main__":
    src = P.read_text(encoding="utf-8")
    # remove earlier versions
    for tid in list(BOSS_BPM) :
        src = re.sub(r'(        // [^\n]*\n)*        "%s-boss": \{\n.*?\n        \},\n' % tid, "", src, flags=re.S)
    src = re.sub(r'(        // [^\n]*\n)*        "boss-storm-v2": \{\n.*?\n        \},\n', "", src, flags=re.S)
    # Eye of the Storm II goes right after Eye of the Storm; chapter bosses after Kraken Rising.
    m = re.search(r'        "boss-storm": \{\n.*?\n        \},\n', src, re.S)
    src = src[:m.end()] + storm2() + "\n" + src[m.end():]
    m = re.search(r'        "boss-kraken": \{\n.*?\n        \},\n', src, re.S)
    texts = []
    for tid in BOSS_BPM:
        text, secs = chapter_boss(tid)
        texts.append(text)
        print("%-16s %3d bpm  loop %4.1fs  cycle %4.1fs" % (tid + "-boss", BOSS_BPM[tid], secs, secs * 3))
    src = src[:m.end()] + "\n".join(texts) + "\n" + src[m.end():]
    P.write_text(src, encoding="utf-8")
