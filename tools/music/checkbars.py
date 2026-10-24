"""Check every bar of every channel in audio.js SONGS adds up to barSteps."""
import re, sys, pathlib
src = pathlib.Path(sys.argv[1]).read_text(encoding="utf-8")
block = src[src.index("const SONGS = {"):]
block = block[:block.index("\n    };")]
songs = re.split(r'\n        "?([\w-]+)"?: \{\n', block)[1:]
NOTE = re.compile(r"^[A-G][#b]?-?\d$")
DRUMS = set("KkBFSsHhJATC")
errors, total = 0, 0
for name, body in zip(songs[::2], songs[1::2]):
    bar = int(re.search(r"barSteps: (\d+)", body).group(1))
    chans = re.findall(r"\n\s+(\w+): \[(.*?)\],", body, re.S)
    lens = {}
    for ch, arr in chans:
        if ch in ("cycle", "mute"):
            continue
        bars = re.findall(r'"([^"]*)"', arr)
        lens[ch] = len(bars)
        for i, b in enumerate(bars):
            total += 1
            steps = 0
            for tok in b.split():
                what, _, n = tok.partition(":")
                steps += int(n or 1)
                if what == "r":
                    continue
                for part in what.split("+"):
                    ok = part in DRUMS if ch.startswith("drums") else bool(NOTE.match(part))
                    if not ok:
                        errors += 1
                        print(f"{name}.{ch} bar {i+1}: bad note {part!r}")
            if steps != bar:
                errors += 1
                print(f"{name}.{ch} bar {i+1}: {steps} steps, expected {bar}: {b}")
    longest = max(lens.values())
    for ch, n in lens.items():
        if longest % n:
            errors += 1
            print(f"{name}.{ch}: {n} bars doesn't divide the song's {longest} bars")
    print(f"{name:14s} {longest:3d} bars  " + " ".join(f"{c}={n}" for c, n in lens.items()))
print(f"{total} bars checked, {errors} problems")
sys.exit(1 if errors else 0)
