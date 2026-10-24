"""Draft the pirate track library and print it as plain JS note lists.

Accompaniment bars can be templates that are filled in from each bar's chord:
  {r} root (E2..D#3)  {f} fifth above it  {o} root +8va  {p} fifth +8va  {h} root +2 8va  {l} root -8va
  {x} chord voicing (Bb3..A4)  {X} voicing +8va  {1}{2}{3} voicing tones  {4}{5}{6} same +8va
Melody bars are literal.
"""
import re, sys

LETTERS = "CDEFGAB"
PC = {"C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11}


class N:
    def __init__(self, letter, acc, midi):
        self.letter, self.acc, self.midi = letter, acc, midi

    def name(self):
        octave = (self.midi - PC[self.letter] - self.acc) // 12 - 1
        return self.letter + {0: "", 1: "#", -1: "b"}[self.acc] + str(octave)

    def up(self, semis):
        return N(self.letter, self.acc, self.midi + semis)


def spell(letter, acc, steps, semis, base_midi_pc):
    """Note `steps` letters and `semis` semitones above letter+acc (pitch class only)."""
    li = (LETTERS.index(letter) + steps) % 7
    l2 = LETTERS[li]
    target = (PC[letter] + acc + semis) % 12
    a = (target - PC[l2]) % 12
    if a > 6:
        a -= 12
    return l2, a


def place(letter, acc, lo, hi):
    pc = (PC[letter] + acc) % 12
    for m in range(lo, hi):
        if m % 12 == pc:
            return N(letter, acc, m)
    raise ValueError


def chord(sym):
    m = re.fullmatch(r"([A-G])([#b]?)(m|5|sus)?", sym)
    letter, acc, q = m.group(1), {"": 0, "#": 1, "b": -1}[m.group(2)], m.group(3) or ""
    third = spell(letter, acc, 2, 3 if q == "m" else 4, 0)
    if q == "sus":
        third = spell(letter, acc, 3, 5, 0)
    fifth = spell(letter, acc, 4, 7, 0)
    tones = [(letter, acc)] + ([] if q == "5" else [third]) + [fifth]
    voicing = sorted((place(l, a, 58, 70) for l, a in tones), key=lambda n: n.midi)
    r = place(letter, acc, 38, 50)
    f = N(fifth[0], fifth[1], r.midi + 7)
    return {"r": r, "f": f, "o": r.up(12), "p": f.up(12), "h": r.up(24), "l": r.up(-12), "v": voicing}


def fill(template, sym):
    c = chord(sym)
    v = c["v"]
    subs = {k: c[k].name() for k in "rfophl"}
    subs["x"] = "+".join(n.name() for n in v)
    subs["X"] = "+".join(n.up(12).name() for n in v)
    for i, n in enumerate(v):
        subs[str(i + 1)] = n.name()
        subs[str(i + 4)] = n.up(12).name()
        subs[str(i + 7)] = n.up(24).name()
    while len(v) < 3:  # power chords: reuse top tone
        v = v + [v[-1]]
    for i in range(3):
        subs.setdefault(str(i + 1), v[i].name())
        subs.setdefault(str(i + 4), v[i].up(12).name())
    return re.sub(r"\{(\w)\}", lambda m: subs[m.group(1)], template)


def R(n=1, steps=None):
    return ["r:%d" % steps] * n


def build(track):
    chords = track["chords"]
    out = {}
    for ch, bars in track["channels"].items():
        if len(bars) == len(chords):
            out[ch] = [fill(b, chords[i]) if "{" in b else b for i, b in enumerate(bars)]
        else:
            assert "{" not in "".join(bars), (track["id"], ch)
            out[ch] = bars
    return out


def emit(track):
    chans = build(track)
    lines = []
    lines.append("        // %s" % track["comment"])
    key = '"%s"' % track["id"]
    lines.append("        %s: {" % key)
    lines.append('            title: "%s", group: "%s", volume: %s,' % (track["title"], track["group"], track.get("volume", 1.0)))
    lines.append('            mood: "%s",' % track["mood"])
    lines.append("            bpm: %d, stepsPerBeat: %d, barSteps: %d," % (track["bpm"], track["spb"], track["barSteps"]))
    lines.append("            channels: {")
    for ch, bars in chans.items():
        per = 4 if max(len(b) for b in bars) < 40 else 2
        if max(len(b) for b in bars) > 70:
            per = 1
        lines.append("                %s: [" % ch)
        for i in range(0, len(bars), per):
            lines.append("                    " + " ".join('"%s",' % b for b in bars[i:i + per]))
        lines.append("                ],")
    lines.append("            },")
    lines.append("        },")
    return "\n".join(lines)


T = []

# ---------------------------------------------------------------- Title
GALLOP68 = "{o}:2 {o}:1 {o}:1 {p}:2 {o}:2 {o}:1 {o}:1 {p}:2"
OOMPAH68 = "r:2 {x}:2 {x}:2 r:2 {x}:2 {x}:2"
T.append(dict(
    id="set-sail", title="Set Sail", group="title",
    comment="Title: \"Set Sail\". D minor, 6/8. Horns sing the theme over a galloping bow, an accordion and taiko; then the fiddle takes over and the horns answer.",
    mood="Grand pirate anthem in D minor: horns, gallop, accordion",
    bpm=64, spb=6, barSteps=12,
    chords="Dm Dm Bb C Dm Bb Gm A F C Dm Dm Bb C A A".split(),
    channels={
        "brass": [
            "D4:4 A4:2 A4:3 G4:1 F4:1 E4:1", "D4:2 F4:2 A4:2 D5:6", "C5:4 Bb4:2 A4:2 G4:2 F4:2", "G4:4 A4:2 E4:6",
            "D5:4 A4:2 A4:3 G4:1 F4:1 G4:1", "F4:2 Bb4:2 D5:2 F5:6", "D5:3 C5:1 Bb4:2 G4:2 A4:2 Bb4:2", "A4:6 C#5:2 D5:2 E5:2",
            "F4:6 A4:6", "G4:6 E4:6", "F4:6 D4:6", "A4:12", "F4:6 Bb4:6", "G4:6 C5:6", "C#5:6 A4:6", "E4:6 C#4:6",
        ],
        "lead": R(8, 12) + [
            "A5:2 G5:1 F5:1 C5:2 F5:4 A5:2", "G5:2 F5:1 E5:1 C5:2 E5:6", "F5:2 E5:1 D5:1 A4:2 D5:2 F5:2 A5:2", "A5:6 G5:2 F5:2 E5:2",
            "D5:2 F5:2 Bb5:2 A5:3 G5:1 F5:2", "E5:2 G5:2 C6:2 Bb5:3 A5:1 G5:2", "A5:4 G5:2 F5:2 E5:2 C#5:2", "D5:2 E5:2 C#5:2 A4:6",
        ],
        "squeeze": [OOMPAH68] * 16,
        "ostinato": [GALLOP68] * 16,
        "cello": ["{r}:6 {r}:6"] * 16,
        "drums": [
            "B+C:2 J:2 J:2 F:2 J:2 J:2", "B:2 J:2 B:2 S:2 J:1 J:1 J:2",
            "B:2 J:2 J:2 F:2 J:2 J:2", "B:2 B:2 S:1 S:1 S:2 F:1 F:1 S:1 S:1",
        ],
    }))

T.append(dict(
    id="black-flag", title="Under the Black Flag", group="title",
    comment="Title: \"Under the Black Flag\". A minor, 6/8. A rollicking shanty: fiddle tune with horn answers, then the horns take the tune and the fiddle runs.",
    mood="Rollicking shanty in A minor: fiddle and accordion, horn answers",
    bpm=70, spb=6, barSteps=12,
    chords="Am Am G G Am Am E E C G Am Em F G E E".split(),
    channels={
        "lead": [
            "E4:2 A4:2 B4:2 C5:3 B4:1 A4:2", "B4:2 A4:2 E4:2 A4:6", "D4:2 G4:2 A4:2 B4:3 A4:1 G4:2", "A4:2 G4:2 D4:2 G4:6",
            "E4:2 A4:2 B4:2 C5:3 D5:1 E5:2", "D5:2 C5:2 B4:2 A4:4 C5:2", "B4:3 A4:1 G#4:2 E4:2 F4:2 G#4:2", "B4:6 r:6",
            "r:6 G5:1 F5:1 E5:1 D5:1 C5:2", "r:6 D5:1 C5:1 B4:1 A4:1 G4:2", "r:6 E5:1 D5:1 C5:1 B4:1 A4:2", "r:6 G5:1 F#5:1 E5:1 D5:1 B4:2",
            "r:6 A5:1 G5:1 F5:1 E5:1 C5:2", "r:6 B5:1 A5:1 G5:1 F5:1 D5:2", "r:6 E5:1 F5:1 G#5:1 A5:1 B5:2", "r:6 E5:2 B4:2 G#4:2",
        ],
        "brass": [
            "r:12", "r:6 A3:2 C4:2 E4:2", "r:12", "r:6 G3:2 B3:2 D4:2",
            "r:12", "r:6 A3:2 C4:2 E4:2", "r:12", "r:6 G#3:2 B3:2 E4:2",
            "E4:4 G4:2 C5:6", "B4:4 A4:2 G4:2 D4:4", "C5:4 B4:2 A4:2 E4:2 A4:2", "B4:6 G4:6",
            "A4:4 C5:2 F5:6", "D5:4 B4:2 G4:2 A4:2 B4:2", "G#4:4 B4:2 E5:6", "D5:2 C5:2 B4:2 G#4:6",
        ],
        "squeeze": ["{x}:2 r:2 {x}:2 {x}:2 r:2 {x}:2"] * 16,
        "ostinato": ["{o}:2 {o}:1 {o}:1 {o}:2 {p}:2 {o}:1 {o}:1 {o}:2"] * 16,
        "cello": ["{r}:4 {f}:2 {r}:4 {f}:2"] * 16,
        "drums": [
            "B+C:2 J:2 J:2 S:2 J:2 J:2", "K:2 J:2 K:2 S:2 J:2 J:1 J:1",
            "B:2 J:2 J:2 S:2 J:2 J:2", "K:2 J:2 K:2 S:2 S:1 S:1 S:1 S:1",
        ],
    }))

GALLOP44 = "{o}:2 {o}:1 {o}:1 {o}:2 {o}:1 {o}:1 {o}:2 {o}:1 {o}:1 {p}:2 {o}:1 {o}:1"
T.append(dict(
    id="captains-oath", title="The Captain's Oath", group="title",
    comment="Title: \"The Captain's Oath\". G minor, 4/4. Cinematic: galloping low strings and taiko under a horn theme, then a fiddle tune with horn stabs.",
    mood="Cinematic and heroic in G minor: horn theme, galloping strings, taiko",
    bpm=92, spb=4, barSteps=16,
    chords="Gm Gm Eb F Gm Eb Cm D Bb F Gm Eb Cm D Gm D".split(),
    channels={
        "brass": [
            "G4:6 D4:2 G4:2 A4:2 Bb4:4", "A4:2 G4:2 F4:2 D4:2 G4:8", "G4:6 Bb4:2 Eb5:8", "D5:4 C5:4 A4:4 F4:4",
            "G4:6 D5:2 D5:4 C5:2 Bb4:2", "C5:4 Bb4:2 G4:2 Eb5:8", "Eb5:4 D5:2 C5:2 Bb4:4 A4:2 G4:2", "F#4:8 A4:4 D5:4",
        ] + ["{x}:3 r:5 {x}:2 r:2 {x}:4"] * 8,
        "lead": R(8, 16) + [
            "D5:4 F5:4 Bb5:6 A5:2", "A5:4 G5:2 F5:2 C5:8", "D5:2 G5:2 A5:2 Bb5:2 A5:4 G5:4", "G5:6 F5:2 Eb5:8",
            "Eb5:4 G5:4 C6:6 Bb5:2", "A5:4 F#5:4 D5:8", "G5:3 F#5:1 G5:2 A5:2 Bb5:4 A5:2 G5:2", "F#5:8 A5:4 D5:4",
        ],
        "strings": R(8, 16) + ["{x}:16"] * 8,
        "ostinato": [GALLOP44] * 16,
        "cello": ["{r}:8 {r}:8"] * 16,
        "sub": R(8, 16) + ["{r}:16"] * 8,
        "drums": [
            "B+C:4 r:2 B:2 S:4 r:2 B:2", "B:4 r:2 B:2 S:4 F:2 F:2",
            "B:4 r:2 B:2 S:4 r:2 B:2", "B:4 F:2 F:2 S:2 S:2 S:1 S:1 S:1 S:1",
        ],
    }))

# ---------------------------------------------------------------- Chapters
T.append(dict(
    id="sea-legs", title="Sea Legs", group="chapter",
    comment="Chapter 1: \"Sea Legs\". A dorian, 6/8. Light and curious: plucked bass, a hopping fiddle tune, accordion and tambourine.",
    mood="Light, curious and jaunty in A dorian: fiddle, pizzicato, accordion",
    bpm=72, spb=6, barSteps=12,
    chords="Am D Am D C G E E Am G D Am C D E E".split(),
    channels={
        "lead": [
            "E5:2 r:1 A4:1 C5:2 E5:2 D5:1 C5:1 B4:2", "A4:2 D5:2 F#5:2 E5:4 r:2", "E5:2 r:1 A4:1 C5:2 E5:2 F#5:1 G5:1 A5:2", "F#5:2 D5:2 A4:2 D5:4 r:2",
            "G5:2 E5:1 C5:1 G4:2 C5:2 E5:2 G5:2", "D5:2 B4:1 G4:1 D4:2 G4:2 B4:2 D5:2", "B4:3 C5:1 B4:2 G#4:2 A4:2 B4:2", "E5:6 r:6",
            "A5:4 G5:1 F#5:1 E5:2 C5:2 E5:2", "D5:4 B4:2 G4:2 B4:2 D5:2", "F#5:4 E5:1 D5:1 A4:2 D5:2 F#5:2", "E5:6 r:6",
            "G5:4 F#5:1 E5:1 C5:2 E5:2 G5:2", "A5:4 G5:1 F#5:1 D5:2 F#5:2 A5:2", "G#5:2 A5:2 B5:2 E5:3 F#5:1 G#5:2", "B5:6 r:6",
        ],
        "brass": R(7, 12) + ["r:6 B3:2 E4:2 G#4:2"] + R(3, 12) + ["r:6 A3:2 C4:2 E4:2"] + R(3, 12) + ["r:6 G#3:2 B3:2 E4:2"],
        "bell": [
            "r:12", "r:8 D6:2 F#6:2", "r:12", "r:8 A5:2 D6:2", "r:12", "r:8 B5:2 D6:2", "r:12", "r:12",
            "r:12", "r:12", "r:12", "r:8 C6:2 E6:2", "r:12", "r:12", "r:12", "r:8 G#5:2 B5:2",
        ],
        "pizz": ["{r}:2 r:2 {o}:2 {f}:2 r:2 {o}:2"] * 16,
        "squeeze": ["r:2 {x}:2 r:2 r:2 {x}:2 r:2"] * 16,
        "drums": ["F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1"],
    }))

T.append(dict(
    id="pressure", title="Pressure", group="chapter",
    comment="Chapter 2: \"Pressure\". E minor, 4/4. Clockwork and sneaky: ticking plucks and anvil, a tiptoeing fiddle, then low horns creep in.",
    mood="Clockwork and sneaky in E minor: ticking plucks, anvil, tiptoe fiddle",
    bpm=100, spb=4, barSteps=16,
    chords="Em Em C B Em Em Am B C D Em Em C D B B".split(),
    channels={
        "lead": [
            "r:4 E4:2 F#4:2 G4:3 r:1 F#4:2 E4:2", "B4:6 A#4:2 B4:4 r:4", "r:4 E5:2 D5:2 C5:3 r:1 B4:2 A4:2", "B4:6 D#5:2 F#5:4 r:4",
            "r:4 E5:2 F#5:2 G5:3 r:1 F#5:2 E5:2", "B5:6 A#5:2 B5:2 G5:2 E5:4", "C6:4 B5:2 A5:2 E5:4 C5:4", "D#5:4 F#5:4 B4:8",
            "r:16", "r:16", "r:16", "r:8 B5:1 A#5:1 B5:1 A#5:1 B5:4",
            "r:16", "r:16", "r:16", "r:8 F#5:1 G5:1 F#5:1 F5:1 F#5:4",
        ],
        "brass": R(8, 16) + [
            "E3:4 G3:2 C4:4 B3:2 C4:2 E4:2", "F#4:4 E4:2 D4:4 A3:2 D4:2 F#4:2", "G4:6 F#4:2 E4:4 B3:4", "E4:8 r:8",
            "E4:4 G4:2 C5:6 B4:2 A4:2", "A4:4 F#4:2 D4:6 E4:2 F#4:2", "D#4:4 F#4:4 B4:8", "A4:4 F#4:4 D#4:8",
        ],
        "pizz": ["{o}:2 {p}:2 {h}:2 {p}:2 {o}:2 {p}:2 {h}:2 {p}:2"] * 16,
        "cello": ["{r}:2 r:6 {r}:2 r:2 {f}:2 r:2"] * 16,
        "strings": R(8, 16) + ["{x}:16"] * 8,
        "drums": ["K:2 h:2 A:2 h:2 F:2 h:2 A:2 h:2", "K:2 h:2 A:2 K:2 F:2 h:2 A:2 h:1 h:1"],
    }))

T.append(dict(
    id="locks-keys", title="Locks and Keys", group="chapter",
    comment="Chapter 3: \"Locks and Keys\". D minor, 6/8. Deeper and mysterious: music-box bells turn like a key, a horn call over the gallop, then a fiddle climbs out.",
    mood="Mysterious but adventurous in D minor: music-box bells, horn call, gallop",
    bpm=58, spb=6, barSteps=12,
    chords="Dm Bb Dm Bb Gm Dm Gm A F C Bb F Gm Bb A A".split(),
    channels={
        "brass": [
            "A3:6 D4:3 E4:1 F4:2", "F4:6 D4:6", "A3:2 D4:2 E4:2 F4:3 G4:1 A4:2", "Bb4:6 A4:3 G4:1 F4:2",
            "G4:4 Bb4:2 D5:6", "C5:3 Bb4:1 A4:2 F4:6", "G4:2 A4:2 Bb4:2 D5:3 C5:1 Bb4:2", "A4:6 C#4:2 E4:2 A4:2",
            "F4:12", "E4:12", "D4:12", "F4:12", "G4:12", "F4:12", "E4:12", "E4:6 C#4:6",
        ],
        "lead": R(8, 12) + [
            "A5:4 C6:2 A5:3 G5:1 F5:2", "G5:4 E5:2 C5:6", "F5:4 D5:2 Bb4:2 D5:2 F5:2", "A5:6 G5:2 A5:2 C6:2",
            "D6:4 C6:2 Bb5:2 A5:2 G5:2", "F5:3 G5:1 F5:2 D5:6", "C#5:2 E5:2 A5:2 G5:3 F5:1 E5:2", "C#5:6 E5:6",
        ],
        "bell": ["{4}:2 {5}:2 {6}:2 {5}:2 {4}:2 {5}:2"] * 8 + ["{6}:12"] * 8,
        "strings": R(8, 12) + ["{x}:12"] * 8,
        "ostinato": ["{o}:2 {o}:1 {o}:1 {o}:2 {p}:2 {o}:1 {o}:1 {o}:2"] * 16,
        "cello": ["{r}:12"] * 16,
        "drums": ["B:2 h:2 h:2 F:2 h:2 h:2", "T:2 h:2 h:2 F:2 h:2 F:1 F:1"],
    }))

T.append(dict(
    id="gunpowder", title="Gunpowder", group="chapter",
    comment="Chapter 4: \"Gunpowder\". A minor, 4/4. Bold and martial: snare rolls and taiko, a marching horn tune, then the fiddle charges over horn stabs.",
    mood="Bold and martial in A minor: marching horns, snare rolls, taiko",
    bpm=112, spb=4, barSteps=16,
    chords="Am Am F G Am Am F E Dm Am F G Dm Am E E".split(),
    channels={
        "brass": [
            "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8", "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
            "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8", "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
        ] + ["{x}:2 r:2 {x}:2 r:6 {x}:2 {x}:2"] * 8,
        "lead": R(8, 16) + [
            "D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:2 A5:2", "E5:2 A5:2 C6:2 E6:2 D6:2 C6:2 B5:2 C6:2",
            "A5:4 F5:2 C5:2 F5:4 A5:4", "G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2",
            "F5:4 A5:4 D6:6 C6:2", "C6:4 B5:2 A5:2 E5:8",
            "G#5:2 A5:2 B5:2 C6:2 D6:2 C6:2 B5:2 G#5:2", "B5:8 G#5:4 E5:4",
        ],
        "ostinato": [GALLOP44] * 16,
        "cello": ["{r}:2 r:2 {r}:2 r:2 {r}:2 r:2 {f}:2 {r}:2"] * 16,
        "drums": [
            "B+C:4 s:1 s:1 S:2 B:2 s:1 s:1 S:4", "B:2 s:1 s:1 S:2 s:1 s:1 B:2 s:1 s:1 S:2 S:1 S:1",
            "B:4 s:1 s:1 S:2 B:2 s:1 s:1 S:4", "B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1 S:1 S:1 S:1 S:1",
        ],
    }))

T.append(dict(
    id="crossfire", title="Crossfire", group="chapter",
    comment="Chapter 5: \"Crossfire\". G minor, 6/8. Urgent and stormy: rushing strings, a fiddle racing down the scale, then the horns ride the storm.",
    mood="Urgent and stormy in G minor: rushing strings, racing fiddle, horns",
    bpm=76, spb=6, barSteps=12,
    chords="Gm F Eb D Gm F Eb D Cm Gm Cm Gm Eb F D D".split(),
    channels={
        "lead": [
            "D5:2 G5:2 A5:1 Bb5:1 A5:2 G5:2 D5:2", "C5:2 F5:2 G5:1 A5:1 G5:2 F5:2 C5:2", "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 F#5:2 A5:6",
            "Bb5:2 A5:1 G5:1 D5:2 G5:2 A5:1 Bb5:1 C6:2", "A5:2 G5:1 F5:1 C5:2 F5:2 G5:1 A5:1 Bb5:2", "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:2 G5:2", "F#5:6 D5:2 E5:2 F#5:2",
            "G5:12", "D5:12", "G5:12", "Bb5:12", "G5:6 Bb5:6", "A5:6 C6:6", "D6:12", "C6:6 A5:6",
        ],
        "brass": R(8, 12) + [
            "C4:6 Eb4:3 D4:1 C4:2", "D4:6 Bb3:6", "Eb4:4 G4:2 C5:6", "Bb4:3 A4:1 G4:2 D4:6",
            "Eb4:4 G4:2 Bb4:4 G4:2", "C5:4 A4:2 F4:4 A4:2", "D5:6 C5:2 Bb4:2 A4:2", "F#4:6 A4:6",
        ],
        "squeeze": ["{x}:2 r:4 {x}:2 r:4"] * 16,
        "ostinato": ["{o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1"] * 16,
        "cello": ["{r}:6 {r}:6"] * 16,
        "drums": [
            "B+C:2 J:1 J:1 J:2 S:2 J:1 J:1 B:2", "B:2 J:1 J:1 B:2 S:2 J:1 J:1 J:2",
            "B:2 J:1 J:1 J:2 S:2 J:1 J:1 B:2", "B:2 S:1 S:1 B:2 S:1 S:1 S:1 S:1 T:2",
        ],
    }))

T.append(dict(
    id="davy-jones", title="Davy Jones", group="chapter",
    comment="Chapter 6: \"Davy Jones\". C minor, 4/4. The finale: dark and majestic. Low horns and a tolling bell over pounding strings, then the fiddle soars over the Db major lift.",
    mood="Epic and dark-majestic in C minor: low horns, tolling bell, taiko",
    bpm=80, spb=4, barSteps=16,
    chords="Cm Ab Cm Ab Fm Cm G G Ab Eb Bb Cm Db Ab G G".split(),
    channels={
        "brass": [
            "C4:6 G3:2 C4:2 D4:2 Eb4:4", "Eb4:6 C4:2 Ab3:8", "G4:6 F4:2 Eb4:2 D4:2 C4:4", "Eb4:8 Ab4:8",
            "Ab4:6 G4:2 F4:2 Eb4:2 C4:4", "G4:6 Eb4:2 C4:8", "D4:4 G4:4 B4:8", "D5:6 C5:2 B4:8",
        ] + ["{x}:6 {x}:2 r:4 {x}:4"] * 8,
        "lead": R(8, 16) + [
            "C6:6 Bb5:2 Ab5:2 G5:2 Ab5:4", "G5:6 F5:2 Eb5:8", "F5:6 G5:2 Ab5:2 Bb5:2 D6:4", "Eb6:8 D6:4 C6:4",
            "Db6:6 C6:2 Ab5:8", "C6:4 Eb6:4 Ab5:8", "B5:4 C6:2 D6:2 G5:8", "D6:8 B5:4 G5:4",
        ],
        "strings": ["{x}:16"] * 16,
        "bell": ["{h}:16"] * 16,
        "ostinato": ["{o}:2 {o}:2 {o}:2 {o}:2 {o}:2 {o}:2 {p}:2 {o}:2"] * 16,
        "cello": ["{r}:8 {r}:8"] * 16,
        "sub": ["{r}:16"] * 16,
        "drums": [
            "B+C:4 r:4 B:2 B:2 r:4", "B:4 r:4 B:4 T:2 T:2",
            "B:4 r:4 B:2 B:2 r:4", "B:4 T:2 T:2 B:2 T:1 T:1 S:1 S:1 S:1 S:1",
        ],
    }))

# ---------------------------------------------------------------- Boss
T.append(dict(
    id="boss-storm", title="Eye of the Storm", group="boss",
    comment="Boss: \"Eye of the Storm\". E minor, 4/4, fast. Driving sixteenth strings and taiko; a horn theme, then a fiddle charge over horn and accordion stabs.",
    mood="Fast and driving in E minor: pounding taiko, horn theme, fiddle charge",
    bpm=132, spb=4, barSteps=16,
    chords="Em C Em D Em C Am B C D Em Em C D B B".split(),
    channels={
        "brass": [
            "E4:4 B4:4 A4:2 G4:2 F#4:2 G4:2", "E4:6 G4:2 C5:8", "B4:4 E5:4 D5:2 B4:2 A4:2 B4:2", "A4:6 F#4:2 D4:8",
            "E5:4 B4:4 D5:2 C5:2 B4:2 A4:2", "G4:6 A4:2 C5:8", "C5:4 B4:2 A4:2 E5:4 C5:4", "D#5:8 F#5:4 B4:4",
        ] + ["{x}:2 r:2 {x}:2 r:4 {x}:2 r:2 {x}:2"] * 8,
        "lead": R(8, 16) + [
            "G5:2 E5:2 C5:2 E5:2 G5:2 C6:2 B5:2 G5:2", "A5:2 F#5:2 D5:2 F#5:2 A5:2 D6:2 C6:2 A5:2",
            "B5:4 G5:2 E5:2 B5:4 E6:4", "D6:2 B5:2 G5:2 E5:2 D5:2 E5:2 G5:2 B5:2",
            "C6:4 B5:2 G5:2 E5:4 G5:4", "D6:4 C6:2 A5:2 F#5:4 A5:4",
            "B5:2 A5:2 G5:2 F#5:2 D#5:2 F#5:2 A5:2 B5:2", "D#6:8 B5:8",
        ],
        "squeeze": R(8, 16) + ["r:2 {x}:2 r:2 {x}:2 r:2 {x}:2 r:2 {x}:2"] * 8,
        "ostinato": ["{o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {o}:1 {o}:1 {p}:1 {o}:1 {h}:1 {o}:1 {p}:1 {o}:1"] * 16,
        "cello": ["{r}:2 {r}:2 {r}:2 {r}:2 {r}:2 {r}:2 {f}:2 {r}:2"] * 16,
        "sub": R(8, 16) + ["{r}:16"] * 8,
        "drums": [
            "B+C:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
            "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2", "B:2 B:1 B:1 S:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
        ],
    }))

T.append(dict(
    id="boss-kraken", title="Kraken Rising", group="boss",
    comment="Boss: \"Kraken Rising\". D minor with a dark Eb (phrygian), 6/8. A heavy horn riff over huge taiko and anvil, then the fiddle shrieks above.",
    mood="Heavy and epic in D phrygian: horn riff, huge taiko and anvil",
    bpm=74, spb=6, barSteps=12,
    chords="Dm Eb Dm Eb Bb C Dm A Dm Eb Dm Eb Bb C Dm A".split(),
    channels={
        "brass": [
            "D4:3 D4:1 D4:2 F4:2 E4:2 D4:2", "Eb4:6 D4:2 C4:2 Bb3:2", "D4:3 D4:1 D4:2 A4:2 G4:2 F4:2", "G4:6 F4:2 Eb4:2 D4:2",
            "F4:3 F4:1 F4:2 Bb4:2 A4:2 G4:2", "G4:3 G4:1 G4:2 C5:2 Bb4:2 A4:2", "A4:6 F4:2 D4:2 F4:2", "C#4:2 D4:2 E4:2 A4:6",
        ] + ["{x}:2 r:2 {x}:2 r:2 {x}:2 {x}:2"] * 8,
        "lead": R(8, 12) + [
            "D6:6 C6:1 Bb5:1 A5:2 F5:2", "G5:6 F5:1 Eb5:1 D5:2 Eb5:2", "F5:2 A5:2 D6:2 E6:3 D6:1 C6:2", "Bb5:6 G5:6",
            "F5:2 Bb5:2 D6:2 C6:3 Bb5:1 A5:2", "G5:2 C6:2 E6:2 D6:3 C6:1 Bb5:2", "A5:4 D6:2 C6:2 Bb5:2 A5:2", "C#6:6 A5:6",
        ],
        "ostinato": ["{o}:2 {o}:1 {o}:1 {o}:2 {o}:2 {o}:1 {o}:1 {p}:2"] * 16,
        "cello": ["{r}:6 {r}:6"] * 16,
        "sub": ["{r}:12"] * 16,
        "drums": [
            "B+C:2 B:1 B:1 F:2 S:2 B:2 F:2", "B:2 F:1 F:1 B:2 S:2 F:1 F:1 B:2",
            "B:2 B:1 B:1 F:2 S:2 B:2 A:2", "B:2 B:2 S:1 S:1 B:1 B:1 S:1 S:1 S:1 S:1",
        ],
    }))

if __name__ == "__main__":
    print("\n".join(emit(t) for t in T))
