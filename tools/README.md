# Level design tools

Helpers used to design, check and rate levels. None of this runs as part of the game.
Run everything with the project's Python from this folder:

```powershell
cd tools
..\.venv\Scripts\python
```

| File | What it does |
| --- | --- |
| `fast.py` | A bitmask copy of `solver.py` (same rules, about 10x faster). `Fast(w, h, tiles)` + `solve(F, stats=True)` is an exact breadth-first search; `solve_macro` / `solve_greedy` collapse free walking so bigger levels fit. |
| `jsolve/Solver.java` | The same rules in Java, for levels with millions of positions. Modes: `exact`, `macro` (breadth-first over pushes), `greedyN` (best-first, finds *a* solution fast). Needs Java 21 (`C:\Program Files\Eclipse Adoptium\jdk-21...`). Rebuild with `javac -d jsolve jsolve\Solver.java`. |
| `lab.py` | Quick experiments: `lab.run(rows, links, max_states, stats=True)` (exact, Python), `lab.jrun(rows, links, mode, cap, xmx)` (Java), `lab.show(name, result)`. Maps use the `seed_levels.py` format; `D` marks a gate square. |
| `stages.py` / `mystages.py` | Solve a big level in stages: each stage is a goal (`need` crates on squares, `gone` walls, `free` squares, `min` crates left, or `{}` = reach the exit), solved from where the last one ended; the full move list is replayed with the exact rules at the end (`wins=True`). `render(rows, links, moves)` prints the board after some moves. The two files are identical except for the temp file they use, so two can run at once. |
| `rotate.py` | Rotate a map (links move with it). `flow.py` in the repo has all 8 mirror/rotate transforms on tile lists. |
| `levels_user.py`, `l12.py` | The user's levels as transcribed (with their wiring), and the rebuilt Level 12. |
| `solutions/` | Known solutions for levels too big to solve exactly in one go (replayed by `assemble.py`). |
| `assemble.py` | Writes the 30-level voyage into `seed_levels.py` (chapters, ratings, par). Run it, then `flask --app app seed --refresh`. |
| `ratecal.py` | Collects solver numbers used to calibrate `rating.py`. |
| `hard_levels.py` | Extra hard levels designed with these tools (not in the voyage). |
| `music/` | Music helpers: `compose2.py` generates the long, layered chapter tracks into `static/js/audio.js` (and holds each track's `layers`); `checkbars.py` checks every bar adds up; `musictest.py` / `layertest.py` play every track and room in headless Edge and report peaks; `pagetest.py` checks the /sounds page. |
| `tests/` | Browser tests (headless Edge via Playwright): `enginetest/` plays solutions in the real engine and checks every move against the Python solver; `shelltest.py` / `flowtest.py` check continuous music and the room-to-room flow. |

The Java solver writes its input to `jsolve/level.txt` (lab.py) or `jsolve/stage*.txt` (stages); don't run two jobs that use the same file at once.
