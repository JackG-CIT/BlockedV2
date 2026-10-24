"""Solve a level in stages: each stage is a crate-position goal (or the chest),
starting from where the previous stage ended. Every stage is replayed with the
exact rules from fast.py, and the whole move list is replayed at the end."""
import os, subprocess, time, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from seed_levels import parse
import fast

JAVA = r"C:\Program Files\Eclipse Adoptium\jdk-21.0.12.101-hotspot\bin\java.exe"
HERE = os.path.dirname(os.path.abspath(__file__))


def level_tiles(rows, links):
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    return parse(spec)


def tiles_for_state(W, H, tiles, F, state):
    """The level's fixed tiles (plates, fuses, cannons, chests) plus the state's walls, crates and pirate."""
    p, boxes, walls = state
    out = [t for t in tiles if t['type'] in ('pressureplate', 'fuse', 'cannon', 'exit')]
    for i in range(W * H):
        x, y = i % W, i // W
        if walls >> i & 1 and not F.gates >> i & 1:
            out.append({'type': 'wall', 'x': x, 'y': y, 'direction': None, 'aX': None, 'aY': None})
        if boxes >> i & 1:
            out.append({'type': 'box', 'x': x, 'y': y, 'direction': None, 'aX': None, 'aY': None})
    out.append({'type': 'player', 'x': p % W, 'y': p // W, 'direction': None, 'aX': None, 'aY': None})
    return out


def run_java(W, H, tiles, mode, cap, xmx, need=(), goals=(), gone=(), minboxes=0, free=()):
    path = os.path.join(HERE, 'jsolve', 'stage.txt')
    with open(path, 'w') as f:
        f.write(f"{W} {H}\n")
        for gx, gy in goals:
            f.write(f"goal {gx} {gy} - - -\n")
        for nx, ny in need:
            f.write(f"needbox {nx} {ny} - - -\n")
        if minboxes:
            f.write(f"minboxes {minboxes} 0 - - -\n")
        for gx, gy in gone:
            f.write(f"needgone {gx} {gy} - - -\n")
        for fx, fy in free:
            f.write(f"needfree {fx} {fy} - - -\n")
        for tl in sorted(tiles, key=lambda t: (t['y'], t['x'])):
            f.write(f"{tl['type']} {tl['x']} {tl['y']} {tl['direction'] or '-'} "
                    f"{'-' if tl['aX'] is None else tl['aX']} {'-' if tl['aY'] is None else tl['aY']}\n")
    out = subprocess.run([JAVA, f'-Xmx{xmx}', '-cp', os.path.join(HERE, 'jsolve'), 'Solver', path, mode, str(cap)],
                         capture_output=True, text=True)
    if out.returncode:
        raise RuntimeError(out.stderr)
    lines = out.stdout.split('\n')
    head = lines[0].split()
    if head[1] != 'SOLVED':
        return None, head
    steps = [(int(a), 'UDLR'.index(b)) for a, b in (s.split(':') for s in lines[1].split()[1:])] if len(lines) > 1 and lines[1].startswith('STEPS') else []
    return steps, head


def solve_stages(rows, links, stages, mode='macro', cap=30_000_000, xmx='20g'):
    """stages: list of dicts {need: [(x,y)...]} or {'exit': True}, optional goals/mode/cap."""
    W, H, tiles = level_tiles(rows, links)
    F0 = fast.Fast(W, H, tiles)
    state = F0.start
    full = []
    for n, st in enumerate(stages, 1):
        t = time.time()
        cur_tiles = tiles_for_state(W, H, tiles, F0, state)
        F = fast.Fast(W, H, cur_tiles)
        assert F.start == state, 'state rebuild mismatch'
        steps, head = run_java(W, H, cur_tiles, st.get('mode', mode), st.get('cap', cap), xmx,
                               need=st.get('need', ()), goals=st.get('goals', ()), gone=st.get('gone', ()),
                               minboxes=st.get('min', 0), free=st.get('free', ()))
        if steps is None:
            print(f"stage {n} {st}: FAILED {' '.join(head[1:])} ({time.time()-t:.0f}s)")
            print("PARTIAL " + ''.join(full))
            return None
        M = fast.Macro(F)
        moves = []
        for src, di in steps:
            moves += fast.walk(F, M, state, src)
            state = F.move((src, state[1], state[2]), di)
            assert state is not None
            moves.append('UDLR'[di])
        full += moves
        print(f"stage {n}: {len(moves)} moves ({' '.join(head[2:])}, {time.time()-t:.0f}s)")
    # replay everything from the real start
    s = F0.start
    for ch in full:
        s = F0.move(s, 'UDLR'.index(ch))
        assert s is not None, 'full replay blocked'
    won = bool(F0.exits >> s[0] & 1)
    print(f"TOTAL {len(full)} moves, wins={won}\n{''.join(full)}")
    return ''.join(full) if won else None


def render(rows, links, moves):
    W, H, tiles = level_tiles(rows, links)
    F = fast.Fast(W, H, tiles)
    s = F.start
    for ch in moves:
        s = F.move(s, 'UDLR'.index(ch))
    p, boxes, walls = s
    plates = {pl for pl, _ in F.plates}
    fuses = {f for f, _ in F.fuses}
    out = []
    for y in range(H):
        row = ''
        for x in range(W):
            i = y * W + x
            if i == p: row += 'P'
            elif boxes >> i & 1: row += '=' if i in plates else 'B'
            elif walls >> i & 1: row += 'D' if F.gates >> i & 1 else '#'
            elif i in F.cannons: row += {(0, -1): '^', (0, 1): 'v', (-1, 0): '<', (1, 0): '>'}[F.cannons[i]]
            elif i in plates: row += '_'
            elif i in fuses: row += 'F'
            elif F.exits >> i & 1: row += 'E'
            elif F.gates >> i & 1: row += 'o'
            else: row += '.'
        out.append(row)
    print('\n'.join(out))
