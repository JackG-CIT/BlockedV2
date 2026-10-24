"""Replays a level's solution and lists the moments that matter: crates landing
on plates (and the gate opening), squeezes, cannon shots and what they destroy,
crates parked on fuses. Handy for writing up what a level is about.

    from describe import events
    for e in events(rows, links, solution): print(e)
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
import fast
from seed_levels import parse


def events(rows, links, solution):
    W = len(rows[0])
    spec = {'map': [r.replace('D', '.') for r in rows], 'links': links}
    F = fast.Fast(*parse(spec))
    xy = lambda i: (i % W, i // W)
    plates = dict(F.plates)                    # plate cell -> gate cell
    fuses = {f for f, _ in F.fuses}
    out = []
    s = F.start
    for n, ch in enumerate(solution, 1):
        p, boxes, walls = s
        di = 'UDLR'.index(ch)
        nxt = F.nb[p][di]
        pushed_to = F.nb[nxt][di] if boxes >> nxt & 1 else None
        expected = boxes if pushed_to is None else (boxes & ~(1 << nxt)) | (1 << pushed_to)
        s = F.move(s, di)
        p2, b2, w2 = s
        lost = bin(expected).count('1') - bin(b2).count('1')
        if lost > 0:
            gone = [xy(i) for i in range(W * len(rows)) if walls >> i & 1 and not w2 >> i & 1 and not F.gates >> i & 1]
            out.append(f'move {n}: cannon shot' + (f', blasts wall {gone}' if gone else ', crate destroyed'))
        elif b2 != expected:
            moved_to = [xy(i) for i in range(W * len(rows)) if b2 >> i & 1 and not expected >> i & 1]
            out.append(f'move {n}: a shutting gate squeezes a crate to {moved_to}')
        if pushed_to is not None and b2 >> pushed_to & 1:
            if pushed_to in plates:
                out.append(f'move {n}: crate onto plate {xy(pushed_to)} (opens gate {xy(plates[pushed_to])})')
            if pushed_to in fuses:
                out.append(f'move {n}: crate parked on fuse {xy(pushed_to)} (its cannon now fires every move)')
    return out
