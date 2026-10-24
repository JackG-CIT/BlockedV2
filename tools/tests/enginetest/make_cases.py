import os
import json, sys
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".."))
from seed_levels import LEVELS, parse
TOOLS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..')
import fast, levels_user as U, l12

def case(name, rows, links, moves):
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    W, H, tiles = parse(spec)
    F = fast.Fast(W, H, tiles)
    s = F.start
    states = []
    for ch in moves:
        s = F.move(s, 'UDLR'.index(ch))
        p, b, w = s
        states.append([[p % W, p // W], sorted([i % W, i // W] for i in range(W * H) if b >> i & 1)])
    # hint-solver checkpoints: exact remaining distance from a few late positions
    checks = []
    for k in (len(moves) - 25, len(moves) - 12, len(moves) - 5):
        if k <= 0: continue
        s = F.start
        for ch in moves[:k]:
            s = F.move(s, 'UDLR'.index(ch))
        G = fast.Fast(W, H, tiles); G.start = s
        r = fast.solve(G, max_states=250000)
        if r['solvable']:
            checks.append({'at': k, 'moves': r['moves']})
    return {'name': name, 'level': {'width': W, 'height': H, 'tiles': tiles}, 'moves': moves,
            'states': states, 'won': bool(F.exits >> s[0] & 1) or None, 'checks': checks}

def main():
    """Every voyage level (with its stored solution) plus the hard extra levels."""
    import hard_levels
    skip = set(sys.argv[1:])   # levels whose stored solution is known to be out of date
    cases = [case(spec['name'], spec['map'], spec['links'], spec['solution']) for spec in LEVELS if spec['name'] not in skip]
    cases += [case(lv['name'], lv['map'], lv['links'], lv['solution']) for lv in hard_levels.HARD]
    json.dump(cases, open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'cases.json'), 'w'))
    print(len(cases), 'cases', sum(len(c['checks']) for c in cases), 'hint checks')


if __name__ == '__main__':
    main()
