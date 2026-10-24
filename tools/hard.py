"""Checks, tidies and rates candidate hard levels (from the Java evolver or by hand).

    ..\\.venv\\Scripts\\python hard.py evo_run1          # check every candidate in a folder
    ..\\.venv\\Scripts\\python hard.py evo_run1 --top 40 # only the 40 best-scoring

For each candidate:
  1. solve it exactly (fast.py, same rules as the game) and replay the solution;
  2. prove every piece is needed: removing any crate, walling up any gate
     (so its plate can never open it), or swapping any cannon for a wall must
     make the level unsolvable; a level that squeezes crates must be unsolvable
     under the old "gates jam open" rule;
  3. tidy: floor that the solution never touches becomes wall if the level
     stays the same puzzle (same moves, no easier);
  4. rate it with rating.py's formula.
Results go to <folder>/checked.json, best first.
"""
import glob
import json
import os
import re
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import fast
import rating
from seed_levels import parse

CAP = 3_000_000


def read_candidates(folder):
    out = []
    for path in glob.glob(os.path.join(folder, 'best-*.txt')):
        text = open(path).read()
        for block in text.split('### ')[1:]:
            lines = block.strip().split('\n')
            head, rows = lines[0], []
            links, solution = {}, ''
            for line in lines[1:]:
                if line.startswith('links'):
                    for a, b in re.findall(r'(\d+,\d+)->(\d+,\d+)', line):
                        links[tuple(map(int, a.split(',')))] = tuple(map(int, b.split(',')))
                elif line.startswith('solution'):
                    solution = line.split()[1] if len(line.split()) > 1 else ''
                else:
                    rows.append(line)
            score = float(re.search(r'score=([\d.]+)', head).group(1))
            style = re.search(r'style=(\w+)', head).group(1)
            out.append({'rows': rows, 'links': links, 'solution': solution, 'evo_score': score, 'style': style})
    return out


def build(rows, links, **kw):
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    W, H, tiles = parse(spec)
    return fast.Fast(W, H, tiles, **kw), tiles


def solvable(rows, links, cap=CAP, **kw):
    F, _ = build(rows, links, **kw)
    if F.start is None:
        return None
    r = fast.solve(F, max_states=cap)
    if r.get('truncated'):
        return 'unknown'
    return r['moves'] if r['solvable'] else None


def replace(rows, x, y, ch):
    rows = [list(r) for r in rows]
    rows[y][x] = ch
    return [''.join(r) for r in rows]


def analyse(rows, links):
    """Exact solve with stats, then the rating formula. None if unsolvable/too big."""
    F, tiles = build(rows, links)
    if F.start is None:
        return None
    r = fast.solve(F, max_states=CAP, stats=True)
    if not r['solvable']:
        return None
    s, pushes = F.start, 0
    used_squeeze = False
    for ch in r['solution']:
        n = F.move(s, 'UDLR'.index(ch))
        if n[1] != s[1]:
            pushes += 1
        s = n
    assert F.exits >> s[0] & 1, 'replay did not win'
    kinds = {t['type'] for t in tiles}
    mech = ('pressureplate' in kinds) + ('fuse' in kinds)
    value = rating.score(r['moves'], pushes, r['states'], r['push_ruin'], mech)
    return {'moves': r['moves'], 'pushes': pushes, 'states': r['states'], 'ruin': round(r['push_ruin'], 3),
            'score': round(value, 2), 'difficulty': rating.halves(value), 'solution': r['solution']}


def necessity(rows, links):
    """List of pieces that turned out not to be needed."""
    problems = []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in 'B=':
                variant = replace(rows, x, y, '.' if ch == 'B' else '_')
                if solvable(variant, links) not in (None,):
                    problems.append(f'crate at {x},{y} is not needed')
            if ch in '^v<>':
                variant = replace(rows, x, y, '#')
                if solvable(variant, {k: v for k, v in links.items() if v != (x, y)}) not in (None,):
                    problems.append(f'cannon at {x},{y} is not needed')
    for plate, gate in links.items():
        if rows[gate[1]][gate[0]] in '^v<>':
            continue
        variant = replace(rows, gate[0], gate[1], '#')
        if solvable(variant, {k: v for k, v in links.items() if k != plate}) not in (None,):
            problems.append(f'gate at {gate[0]},{gate[1]} never has to open')
    return problems


def uses_squeeze(rows, links, solution):
    F, _ = build(rows, links)
    s = F.start
    for ch in solution:
        p, boxes, _ = s
        di = 'UDLR'.index(ch)
        n = F.nb[p][di]
        expected = boxes
        if boxes >> n & 1:
            expected = (boxes & ~(1 << n)) | (1 << F.nb[n][di])
        s = F.move(s, di)
        if bin(s[1]).count('1') == bin(expected).count('1') and s[1] != expected:
            return True
    return False


def tidy(rows, links, base):
    """Turn untouched floor into wall while the puzzle stays the same length and no easier."""
    F, _ = build(rows, links)
    touched = set()
    s = F.start
    W = len(rows[0])
    for ch in [''] + list(base['solution']):
        if ch:
            s = F.move(s, 'UDLR'.index(ch))
        touched.add(s[0])
        b = s[1]
        i = 0
        while b:
            if b & 1:
                touched.add(i)
            b >>= 1
            i += 1
    gates = {g for g in links.values()}
    for y in range(1, len(rows) - 1):
        for x in range(1, W - 1):
            if rows[y][x] != '.' or (x, y) in gates or y * W + x in touched:
                continue
            variant = replace(rows, x, y, '#')
            a = analyse(variant, links)
            if a and a['moves'] == base['moves'] and a['score'] >= base['score'] - 0.3:
                rows, base = variant, a
    return rows, base


def main():
    folder = sys.argv[1]
    top = int(sys.argv[sys.argv.index('--top') + 1]) if '--top' in sys.argv else None
    cands = sorted(read_candidates(folder), key=lambda c: -c['evo_score'])
    if top:
        cands = cands[:top]
    results = []
    for n, c in enumerate(cands, 1):
        a = analyse(c['rows'], c['links'])
        if not a:
            print(f'{n}: skipped (too big to check exactly, or unsolvable)')
            continue
        rows, a = tidy(c['rows'], c['links'], a)
        problems = necessity(rows, c['links'])
        squeeze = uses_squeeze(rows, c['links'], a['solution'])
        if squeeze and solvable(rows, c['links'], no_squeeze=True) not in (None,):
            problems.append('solvable without the squeeze')
        entry = {'rows': rows, 'links': {f'{k[0]},{k[1]}': f'{v[0]},{v[1]}' for k, v in c['links'].items()},
                 'style': c['style'], 'squeeze': squeeze, 'problems': problems, **a}
        results.append(entry)
        print(f"{n}: {c['style']} score {a['score']} ({a['difficulty'] / 2:g} skulls) {a['moves']} moves "
              f"{a['pushes']} pushes ruin {a['ruin']} states {a['states']} squeeze={squeeze} "
              f"{'OK' if not problems else problems}")
    results.sort(key=lambda e: (bool(e['problems']), -e['score']))
    json.dump(results, open(os.path.join(folder, 'checked.json'), 'w'), indent=1)
    print(f"{sum(not e['problems'] for e in results)} clean of {len(results)} checked")


if __name__ == '__main__':
    main()
