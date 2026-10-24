"""Bitmask port of BlockedV2/solver.py for level design (same rules, much faster)."""
from collections import deque

DIRS = (('U', 0, -1), ('D', 0, 1), ('L', -1, 0), ('R', 1, 0))
CDIR = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}


class Fast:
    def __init__(self, W, H, tiles, no_squeeze=False):
        # no_squeeze: use the old rule (a gate stays jammed open while anything
        # stands in it) to test whether a level really needs the squeeze.
        self.no_squeeze = no_squeeze
        self.W, self.H = W, H
        idx = lambda x, y: y * W + x
        self.walls0 = self.boxes0 = 0
        self.exits = 0
        self.cannons = {}
        plates, fuses = [], []
        player = None
        for t in sorted(tiles, key=lambda t: (t['y'], t['x'])):
            i = idx(t['x'], t['y'])
            k = t['type'].lower()
            tgt = (t['aX'], t['aY']) if t.get('aX') is not None and t.get('aY') is not None else None
            if k == 'wall': self.walls0 |= 1 << i
            elif k == 'box': self.boxes0 |= 1 << i
            elif k == 'player': player = i
            elif k == 'exit': self.exits |= 1 << i
            elif k == 'cannon': self.cannons[i] = CDIR.get(t.get('direction') or 'up', (0, -1))
            elif k == 'pressureplate': plates.append((i, tgt))
            elif k == 'fuse': fuses.append((i, tgt))
        inside = lambda p: p is not None and 0 <= p[0] < W and 0 <= p[1] < H
        self.cannon_mask = 0
        for c in self.cannons: self.cannon_mask |= 1 << c
        self.plates = [(p, idx(*t)) for p, t in plates if inside(t) and idx(*t) not in self.cannons]
        self.gates = 0
        self.ctrl = {}
        for p, t in self.plates:
            self.gates |= 1 << t
            self.ctrl[t] = p          # the last plate in board order decides
        self.gate_order = [(p, t) for p, t in self.plates if self.ctrl[t] == p]
        # squeeze scan order per gate: rings from the top-right, right to left, top to bottom
        self.ring = {}
        for _, t in self.gate_order:
            gx, gy = t % W, t // W
            order = []
            for r in range(1, max(W, H)):
                for y in range(gy - r, gy + r + 1):
                    for x in range(gx + r, gx - r - 1, -1):
                        if max(abs(x - gx), abs(y - gy)) == r and 0 <= x < W and 0 <= y < H:
                            order.append(y * W + x)
            self.ring[t] = order
        self.fuses = [(f, idx(*t)) for f, t in fuses if inside(t) and idx(*t) in self.cannons]
        # neighbour table
        self.nb = []
        for i in range(W * H):
            x, y = i % W, i // W
            row = []
            for _, dx, dy in DIRS:
                nx, ny = x + dx, y + dy
                row.append(ny * W + nx if 0 <= nx < W and 0 <= ny < H else -1)
            self.nb.append(row)
        self.player = player
        self.start = None if player is None else self.checks(player, self.boxes0, self.walls0)

    def step_cell(self, i, dx, dy):
        x, y = i % self.W + dx, i // self.W + dy
        return y * self.W + x if 0 <= x < self.W and 0 <= y < self.H else -1

    def settle_plates(self, p, boxes, walls):
        """Open or shut every gate (with the squeeze). Returns (boxes, walls), or None if a gate crushed the pirate."""
        for _ in range(10):
            squeezed = False
            for plate, t in self.gate_order:
                tb = 1 << t
                if plate == p or boxes >> plate & 1:
                    walls &= ~tb
                elif not walls & tb:
                    if self.no_squeeze and (t == p or boxes & tb):
                        continue          # jammed open
                    if t == p:
                        return None
                    if boxes & tb:
                        boxes &= ~tb
                        for c in self.ring[t]:
                            if c != p and not ((walls | boxes | self.cannon_mask) >> c & 1):
                                boxes |= 1 << c
                                break
                        squeezed = True
                    walls |= tb
            if not squeezed:
                break
        return boxes, walls

    def checks(self, p, boxes, walls):
        r = self.settle_plates(p, boxes, walls)
        if r is None:
            return None
        boxes, walls = r
        # A shot crate flies a tile at a time; the plates react after every tile.
        for fuse, c in self.fuses:
            if not (fuse == p or boxes >> fuse & 1):
                continue
            dx, dy = self.cannons[c]
            cur = self.step_cell(c, dx, dy)
            if cur < 0 or not boxes >> cur & 1:
                continue
            while True:
                n = self.step_cell(cur, dx, dy)
                if n == p:          # the shot flattens the pirate
                    return None
                if n < 0 or boxes >> n & 1 or walls >> n & 1:
                    if n >= 0 and walls >> n & 1 and not self.gates >> n & 1:
                        walls &= ~(1 << n)
                    boxes &= ~(1 << cur)
                    if n >= 0 and boxes >> n & 1:
                        boxes &= ~(1 << n)
                    r = self.settle_plates(p, boxes, walls)
                    if r is None:
                        return None
                    boxes, walls = r
                    break
                boxes = (boxes & ~(1 << cur)) | (1 << n)
                cur = n
                r = self.settle_plates(p, boxes, walls)
                if r is None:
                    return None
                boxes, walls = r
                if not boxes >> cur & 1:   # squeezed away by a shutting gate
                    break
        return (p, boxes, walls)

    def gate_open_after(self, g, p, boxes):
        pl = self.ctrl[g]
        return pl == p or bool(boxes >> pl & 1)

    def move(self, s, di):
        p, boxes, walls = s
        n = self.nb[p][di]
        if n < 0 or walls >> n & 1 or self.cannon_mask >> n & 1:
            return None
        entering = [n]
        if boxes >> n & 1:
            b = self.nb[n][di]
            if b < 0 or (walls | boxes | self.cannon_mask) >> b & 1:
                return None
            boxes = (boxes & ~(1 << n)) | (1 << b)
            entering.append(b)
        for c in entering:
            if self.gates >> c & 1 and not self.gate_open_after(c, n, boxes):
                return None
        return self.checks(n, boxes, walls)   # None if a gate crushed the pirate


def solve(F, max_states=20_000_000, stats=False):
    start = F.start
    parent = {start: None}
    q = deque([start])
    win = None
    edges = {} if stats else None
    wins = []
    while q:
        s = q.popleft()
        if F.exits >> s[0] & 1:
            if win is None: win = s
            wins.append(s)
            if not stats: break
            continue
        out = [] if stats else None
        for di in range(4):
            n = F.move(s, di)
            if n is None or n == s:
                continue
            if stats: out.append(n)
            if n not in parent:
                if len(parent) >= max_states:
                    return {'solvable': False, 'truncated': True, 'states': len(parent)}
                parent[n] = (s, di)
                q.append(n)
        if stats: edges[s] = out
    if win is None:
        return {'solvable': False, 'truncated': False, 'states': len(parent)}
    path = []
    s = win
    while parent[s] is not None:
        s, di = parent[s]
        path.append(DIRS[di][0])
    path.reverse()
    r = {'solvable': True, 'moves': len(path), 'solution': ''.join(path), 'states': len(parent), 'truncated': False}
    if stats:
        rev = {}
        for s, outs in edges.items():
            for n in outs: rev.setdefault(n, []).append(s)
        alive = set(wins); dq = deque(wins)
        while dq:
            s = dq.popleft()
            for pr in rev.get(s, ()):
                if pr not in alive: alive.add(pr); dq.append(pr)
        lp = rp = 0
        for s, outs in edges.items():
            if s in alive:
                for n in outs:
                    if n[1] != s[1]:
                        lp += 1
                        rp += n not in alive
        r['dead'] = len(parent) - len(alive)
        r['push_ruin'] = rp / lp if lp else 0
    return r


# ---------- Macro search: collapse free walking ----------
# Walking over plain deck changes nothing, so every square the pirate can walk
# to without touching a plate, fuse, gate or chest is one position. Only
# pushes and steps onto those special squares branch the search.

class Macro:
    def __init__(self, F):
        self.F = F
        W, H = F.W, F.H
        self.full = (1 << (W * H)) - 1
        col0 = colL = 0
        for y in range(H):
            col0 |= 1 << (y * W)
            colL |= 1 << (y * W + W - 1)
        self.notcol0, self.notcolL = self.full & ~col0, self.full & ~colL
        special = F.exits | F.gates
        for p, _ in F.plates: special |= 1 << p
        for f, _ in F.fuses: special |= 1 << f
        for f, _ in getattr(F, 'all_fuses', []): special |= 1 << f
        self.special = special
        self.blocked_static = F.cannon_mask | special

    def shifts(self, m):
        W = self.F.W
        return ((m >> W), (m << W) & self.full, (m & self.notcol0) >> 1, (m & self.notcolL) << 1)  # U D L R

    def region(self, p, boxes, walls):
        free = self.full & ~(walls | boxes | self.blocked_static)
        r = 1 << p
        while True:
            u, d, l, rr = self.shifts(r)
            n = (r | u | d | l | rr) & free | r
            if n == r:
                return r
            r = n

    def norm(self, s):
        p, boxes, walls = s
        if self.special >> p & 1:
            return s
        r = self.region(p, boxes, walls)
        return ((r & -r).bit_length() - 1, boxes, walls)

    def expand(self, s):
        p, boxes, walls = s
        F = self.F
        if self.special >> p & 1:
            for di in range(4):
                n = F.move(s, di)
                if n is not None and n != s:
                    yield p, di, n
            return
        r = self.region(p, boxes, walls)
        free = self.full & ~(walls | boxes | self.blocked_static)
        for di, sh in enumerate(self.shifts(r)):
            # region cells whose neighbour in this direction is not free deck
            edge = sh & ~free & ~walls & ~F.cannon_mask
            # map back to the source cells
            while edge:
                low = edge & -edge
                n_cell = low.bit_length() - 1
                edge ^= low
                src = n_cell - (-F.W, F.W, -1, 1)[di]
                n = F.move((src, boxes, walls), di)
                if n is not None:
                    yield src, di, n


def solve_macro(F, max_states=5_000_000):
    M = Macro(F)
    start = M.norm(F.start)
    parent = {start: None}
    q = deque([start])
    win = None
    while q:
        s = q.popleft()
        if F.exits >> s[0] & 1:
            win = s
            break
        for src, di, n in M.expand(s):
            k = M.norm(n)
            if k not in parent:
                if len(parent) >= max_states:
                    return {'solvable': False, 'truncated': True, 'states': len(parent)}
                parent[k] = (s, src, di)
                q.append(k)
    if win is None:
        return {'solvable': False, 'truncated': False, 'states': len(parent)}
    steps = []
    s = win
    while parent[s] is not None:
        s, src, di = parent[s]
        steps.append((src, di))
    steps.reverse()
    # Expand into real moves: walk (shortest) to src, then make the move.
    path, cur = [], F.start
    for src, di in steps:
        path += walk(F, M, cur, src)
        cur = F.move((src, cur[1], cur[2]), di)
        path.append(DIRS[di][0])
    return {'solvable': True, 'pushes_and_steps': len(steps), 'moves': len(path), 'solution': ''.join(path),
            'states': len(parent), 'truncated': False}


def walk(F, M, s, target):
    p, boxes, walls = s
    if p == target:
        return []
    free = M.full & ~(walls | boxes | M.blocked_static)
    prev = {p: None}
    dq = deque([p])
    while dq:
        c = dq.popleft()
        for di in range(4):
            n = F.nb[c][di]
            if n < 0 or n in prev or not (free >> n & 1):
                continue
            prev[n] = (c, di)
            if n == target:
                out = []
                while prev[n] is not None:
                    n, d = prev[n]
                    out.append(DIRS[d][0])
                return out[::-1]
            dq.append(n)
    raise RuntimeError('walk failed')


def solve_greedy(F, max_states=3_000_000, weight=3):
    """Weighted best-first over macro positions. Finds *a* solution fast (not
    the shortest); priority = steps + weight * uncovered plates."""
    import heapq
    M = Macro(F)
    plate_mask = 0
    for p, _ in F.plates: plate_mask |= 1 << p
    nplates = len(F.plates)
    def h(s):
        held = bin(s[1] & plate_mask).count('1') + (1 if plate_mask >> s[0] & 1 else 0)
        return nplates - held
    start = M.norm(F.start)
    parent = {start: None}
    g = {start: 0}
    heap = [(weight * h(start), 0, start)]
    win = None
    while heap:
        _, gs, s = heapq.heappop(heap)
        if F.exits >> s[0] & 1:
            win = s
            break
        for src, di, n in M.expand(s):
            k = M.norm(n)
            if k not in parent:
                if len(parent) >= max_states:
                    return {'solvable': False, 'truncated': True, 'states': len(parent)}
                parent[k] = (s, src, di)
                heapq.heappush(heap, (gs + 1 + weight * h(k), gs + 1, k))
    if win is None:
        return {'solvable': False, 'truncated': False, 'states': len(parent)}
    steps = []
    s = win
    while parent[s] is not None:
        s, src, di = parent[s]
        steps.append((src, di))
    steps.reverse()
    path, cur = [], F.start
    for src, di in steps:
        path += walk(F, M, cur, src)
        cur = F.move((src, cur[1], cur[2]), di)
        path.append(DIRS[di][0])
    return {'solvable': True, 'moves': len(path), 'solution': ''.join(path), 'states': len(parent), 'truncated': False}
