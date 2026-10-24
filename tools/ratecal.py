import os
import sys, math, json
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from seed_levels import LEVELS, parse
import fast, levels_user as U, l12, rotate

def metrics(rows, links, sol=None, cap=3_000_000):
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    W, H, tiles = parse(spec)
    F = fast.Fast(W, H, tiles)
    r = fast.solve(F, max_states=cap, stats=True)
    exact = r['solvable']
    if not exact:
        r = {'solution': sol, 'moves': len(sol), 'states': cap * 10, 'push_ruin': None}
    s = F.start; pushes = 0
    for ch in r['solution']:
        n = F.move(s, 'UDLR'.index(ch)); pushes += n[1] != s[1]; s = n
    kinds = {t['type'] for t in tiles}
    mech = ('pressureplate' in kinds) + ('fuse' in kinds)
    return {'moves': r['moves'], 'pushes': pushes, 'states': r['states'], 'ruin': r['push_ruin'], 'mech': mech, 'exact': exact}

out = {}
for spec in LEVELS:
    out[spec['name']] = metrics(spec['map'], spec['links'])
sol = lambda n: open(n).read().strip()
out['L5'] = metrics(*U.L5)
out['L6'] = metrics(*rotate.rotate_ccw(*U.L6), sol=sol('l6_solution.txt'))
out['L7'] = metrics(*U.L7, sol=sol('l7_solution.txt'))
out['L9'] = metrics(*U.L9, sol=sol('l9_solution.txt'))
out['L11'] = metrics(*U.L11, sol=sol('l11_solution.txt'))
out['L12'] = metrics(*l12.V2, sol=sol('l12_solution.txt'))
json.dump(out, open('ratecal.json', 'w'), indent=1)
for k, v in out.items(): print(k, v)
