"""Level lab: transcribed user levels + link search with the real solver."""
import os
import sys, itertools, random, time
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from seed_levels import parse
from solver import Level, solve
import fast

USER = {
    'L3': [
        '############',
        '#..........#',
        '#.BB.......#',
        '#.....######',
        '#.....#_...#',
        '#..P.D....DE',
        '#.....#....#',
        '#.#.#.######',
        '#.#_#......#',
        '#.#.#....###',
        '#........D_#',
        '############',
    ],
    'U': [
        '############',
        '#..#.......#',
        '#._#...BBB.#',
        '###........#',
        '#...B....###',
        '#....B...DDE',
        '#..P..B..###',
        '#......B...#',
        '#.......#D##',
        '#..##...#_.#',
        '#.._B...#..#',
        '############',
    ],
    'L6': [
        '############',
        '###...#....#',
        '#_PB..#....#',
        '###.B_#....#',
        '#_##B.#....#',
        '#.#._.#....E',
        '#B.BBB_#...#',
        '#..._..#...#',
        '#D#####....#',
        '#DDD.DD....#',
        '#BBBBBB....#',
        '############',
    ],
    'L7': [
        '############',
        '#P_B.#__...#',
        '#....#.....#',
        '#..B.#.....#',
        '##.##__#D.##',
        '##.B..D#B.DE',
        '#.D##.DD..##',
        '#.....##...#',
        '#.B...#...D#',
        '#.___.D..#D#',
        '#.....#..#_#',
        '############',
    ],
    'L11': [
        '############',
        '#_#...D___.#',
        '#....#######',
        '#....B.._F.#',
        '#####B######',
        '#>...#DDDD#E',
        '#####B######',
        '#.....#....#',
        '#FBBP.#BBB.#',
        '#>.B....BB.#',
        '##^F..#....#',
        '############',
    ],
}


def gates_of(rows):
    return [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c == 'D']


def cells(rows, chars):
    return [(x, y) for y, r in enumerate(rows) for x, c in enumerate(r) if c in chars]


def build(rows, links):
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    w, h, tiles = parse(spec)
    return Level(w, h, tiles)


def run(rows, links, max_states=20_000_000, stats=False):
    t = time.time()
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    r = fast.solve(fast.Fast(*parse(spec)), max_states=max_states, stats=stats)
    r['secs'] = round(time.time() - t, 1)
    return r


def show(name, r):
    if not r['solvable']:
        print(f"{name}: UNSOLVABLE states={r.get('states')} trunc={r.get('truncated')} {r.get('secs')}s")
    else:
        extra = f", dead={r['dead']}, push_ruin={r['push_ruin']:.0%}" if 'dead' in r else ''
        print(f"{name}: {r['moves']} moves, states={r['states']}{extra}, {r['secs']}s")
        print("   " + r['solution'])


def mrun(rows, links, max_states=5_000_000):
    t = time.time()
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    r = fast.solve_macro(fast.Fast(*parse(spec)), max_states=max_states)
    r['secs'] = round(time.time() - t, 1)
    return r


def grun(rows, links, max_states=3_000_000, weight=3):
    t = time.time()
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    F = fast.Fast(*parse(spec))
    r = fast.solve_greedy(F, max_states=max_states, weight=weight)
    if r['solvable']:   # replay with the exact rules
        s = F.start
        for ch in r['solution']:
            s = F.move(s, 'UDLR'.index(ch))
        assert F.exits >> s[0] & 1, 'replay failed'
    r['secs'] = round(time.time() - t, 1)
    return r


JAVA = r"C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin\java.exe"
HERE = __import__('os').path.dirname(__import__('os').path.abspath(__file__))


def jrun(rows, links, mode='macro', cap=20_000_000, xmx='24g', goals=()):
    """Solve with the Java solver, rebuild the full move list, replay it with fast.py."""
    import subprocess, os
    t = time.time()
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    W, H, tiles = parse(spec)
    path = os.path.join(HERE, 'jsolve', 'level.txt')
    with open(path, 'w') as f:
        f.write(f"{W} {H}\n")
        for gx, gy in goals:
            f.write(f"goal {gx} {gy} - - -\n")
        for tl in sorted(tiles, key=lambda t: (t['y'], t['x'])):
            f.write(f"{tl['type']} {tl['x']} {tl['y']} {tl['direction'] or '-'} "
                    f"{'-' if tl['aX'] is None else tl['aX']} {'-' if tl['aY'] is None else tl['aY']}\n")
    out = subprocess.run([JAVA, f'-Xmx{xmx}', '-cp', os.path.join(HERE, 'jsolve'), 'Solver', path, mode, str(cap)],
                         capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    lines = out.stdout.split('\n')
    head = lines[0].split()
    info = dict(kv.split('=') for kv in head[2:])
    r = {'states': int(info['states']), 'secs': round(time.time() - t, 1)}
    if head[1] != 'SOLVED':
        r.update(solvable=False, truncated=head[1] == 'TRUNCATED')
        return r
    F = fast.Fast(W, H, tiles)
    M = fast.Macro(F)
    steps = [(int(a), 'UDLR'.index(b)) for a, b in (s.split(':') for s in lines[1].split()[1:])]
    sol, cur = [], F.start
    for src, di in steps:
        sol += fast.walk(F, M, cur, src)
        cur = F.move((src, cur[1], cur[2]), di)
        assert cur is not None, 'replay blocked'
        sol.append('UDLR'[di])
    assert F.exits >> cur[0] & 1, 'replay did not win'
    r.update(solvable=True, truncated=False, moves=len(sol), solution=''.join(sol), steps=len(steps))
    return r
