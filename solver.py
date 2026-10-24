"""Solves Blocked levels by trying every possible sequence of moves.

The rules here copy static/js/engine.js exactly (including its quirks), so if
the solver says a level can be beaten, it can be beaten in the game. Use it
from the command line:

    flask --app app solve 4        # level with id 4
    flask --app app solve all      # every level

It reports the fewest moves needed, one shortest solution, and how
forgiving the level is (how many moves lead somewhere you can no longer win
from, so you'd have to press R).
"""
from collections import deque

DIRS = {'U': (0, -1), 'D': (0, 1), 'L': (-1, 0), 'R': (1, 0)}
CANNON_DIRS = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}


class Level:
    def __init__(self, width, height, tiles):
        self.width, self.height = width, height
        self.cannons, self.exits = {}, set()
        self.plates, self.fuses = [], []          # [(pos, target or None)] in board (row) order
        walls, boxes, player = set(), set(), None
        for t in sorted(tiles, key=lambda t: (t['y'], t['x'])):
            pos = (t['x'], t['y'])
            kind = t['type'].lower()
            target = (t['aX'], t['aY']) if t.get('aX') is not None and t.get('aY') is not None else None
            if kind == 'wall':
                walls.add(pos)
            elif kind == 'box':
                boxes.add(pos)
            elif kind == 'player':
                player = pos
            elif kind == 'exit':
                self.exits.add(pos)
            elif kind == 'cannon':
                self.cannons[pos] = CANNON_DIRS.get(t.get('direction') or 'up', (0, -1))
            elif kind == 'pressureplate':
                self.plates.append((pos, target))
            elif kind == 'fuse':
                self.fuses.append((pos, target))
        self.player = player
        # Plate targets act as gates (unless they're cannons, which plates ignore).
        self.gates = {t for _, t in self.plates if t is not None and self.inside(t) and t not in self.cannons}
        # When several plates point at one gate, the last one (in board order) decides.
        decider = {t: plate for plate, t in self.plates if t in self.gates}
        self.gate_order = [(plate, t) for plate, t in self.plates if t in self.gates and decider[t] == plate]
        # The game runs the plate and fuse checks once when the level loads.
        self.start = None if player is None else self.checks(player, frozenset(boxes), frozenset(walls))

    def inside(self, p):
        return 0 <= p[0] < self.width and 0 <= p[1] < self.height

    def squeeze_spot(self, gate, player, boxes, walls):
        """Where a crate goes when a gate shuts on it: the first free square in
        rings around the gate (radius 1, 2, ...), each ring read from its
        top-right corner, right to left, top to bottom."""
        gx, gy = gate
        for r in range(1, max(self.width, self.height)):
            for y in range(gy - r, gy + r + 1):
                for x in range(gx + r, gx - r - 1, -1):
                    if max(abs(x - gx), abs(y - gy)) != r:
                        continue
                    p = (x, y)
                    if self.inside(p) and p not in walls and p not in boxes and p not in self.cannons and p != player:
                        return p
        return None

    def settle_plates(self, player, boxes, walls):
        """checkPressurePlates: open or shut every gate (mutates boxes/walls).
        A gate that shuts on a crate squeezes it out; if that lands it on another
        plate, the plates are checked again. Returns False if a gate shut on the pirate."""
        for _ in range(10):
            squeezed = False
            for plate, target in self.gate_order:
                if plate == player or plate in boxes:
                    walls.discard(target)
                elif target not in walls:
                    if target == player:
                        return False
                    if target in boxes:
                        boxes.discard(target)
                        spot = self.squeeze_spot(target, player, boxes, walls)
                        if spot is not None:
                            boxes.add(spot)
                        squeezed = True
                    walls.add(target)
            if not squeezed:
                break
        return True

    def checks(self, player, boxes, walls):
        """Returns the settled state, or None if the pirate was killed (a gate shut on
        them, or a cannon shot hit them)."""
        boxes, walls = set(boxes), set(walls)
        if not self.settle_plates(player, boxes, walls):
            return None
        # checkFuses. A shot crate flies one tile at a time, and the plates react
        # after every tile: a gate shuts the moment its crate is shot off the
        # plate, and a crate flying over a plate opens its gate as it passes.
        # (In the game the pirate can keep moving during a flight; the solver
        # waits for each shot to land, which is always allowed.)
        for fuse, target in self.fuses:
            if not (fuse == player or fuse in boxes):
                continue
            if target not in self.cannons:
                continue
            dx, dy = self.cannons[target]
            x, y = target[0] + dx, target[1] + dy
            if (x, y) not in boxes:
                continue
            while True:
                nxt = (x + dx, y + dy)
                if nxt == player:  # a cannonball crate flattens the pirate
                    return None
                if not self.inside(nxt) or nxt in boxes or nxt in walls:
                    if self.inside(nxt) and nxt in walls and nxt not in self.gates:  # gates eat the crate
                        walls.discard(nxt)
                    boxes.discard((x, y))
                    if self.inside(nxt) and nxt in boxes:
                        boxes.discard(nxt)
                    if not self.settle_plates(player, boxes, walls):
                        return None
                    break
                boxes.discard((x, y))
                x, y = nxt
                boxes.add((x, y))
                if not self.settle_plates(player, boxes, walls):
                    return None
                if (x, y) not in boxes:   # a shutting gate squeezed the flying crate away
                    break
        return player, frozenset(boxes), frozenset(walls)

    def gate_open_after(self, gate, player, boxes):
        """Whether a gate is open once a move finishes (the last plate controlling it decides)."""
        is_open = True
        for plate, target in self.plates:
            if target == gate:
                is_open = plate == player or plate in boxes
        return is_open

    def move(self, state, d):
        player, boxes, walls = state
        dx, dy = DIRS[d]
        nxt = (player[0] + dx, player[1] + dy)
        if not self.inside(nxt) or nxt in walls or nxt in self.cannons:
            return None
        entering = [nxt]
        if nxt in boxes:
            beyond = (nxt[0] + dx, nxt[1] + dy)
            if not self.inside(beyond) or beyond in walls or beyond in boxes or beyond in self.cannons:
                return None
            boxes = (boxes - {nxt}) | {beyond}
            entering.append(beyond)
        # Can't step (or push a crate) into a gate that this move will shut.
        for cell in entering:
            if cell in self.gates and not self.gate_open_after(cell, nxt, boxes):
                return None
        return self.checks(nxt, boxes, walls)  # None if a gate crushed the pirate

    def won(self, state):
        return state[0] in self.exits


def solve(level, max_states=2_000_000):
    """Breadth-first search. Returns a dict describing the level."""
    if level.start is None:
        return {'solvable': False, 'reason': 'no pirate'}
    start = level.start
    parent = {start: None}
    edges = {}
    order = deque([start])
    wins = []
    truncated = False
    while order:
        s = order.popleft()
        if level.won(s):
            wins.append(s)
            continue
        out = []
        for d in 'UDLR':
            n = level.move(s, d)
            if n is None or n == s:
                continue
            out.append(n)
            if n not in parent:
                if len(parent) >= max_states:
                    truncated = True
                    continue
                parent[n] = (s, d)
                order.append(n)
        edges[s] = out

    if not wins:
        return {'solvable': False, 'states': len(parent), 'truncated': truncated}

    best = wins[0]  # BFS order, so the first win found is a shortest one
    path = []
    s = best
    while parent[s] is not None:
        s, d = parent[s]
        path.append(d)
    path.reverse()

    # Which states can still reach a win?
    reverse = {}
    for s, outs in edges.items():
        for n in outs:
            reverse.setdefault(n, []).append(s)
    alive = set(wins)
    queue = deque(wins)
    while queue:
        s = queue.popleft()
        for p in reverse.get(s, ()):
            if p not in alive:
                alive.add(p)
                queue.append(p)

    # Forgiveness: of the moves you could make while still able to win,
    # what share ruin the attempt?
    live_moves = ruinous = live_pushes = ruinous_pushes = 0
    for s, outs in edges.items():
        if s in alive:
            for n in outs:
                live_moves += 1
                pushed = n[1] != s[1]
                live_pushes += pushed
                if n not in alive:
                    ruinous += 1
                    ruinous_pushes += pushed

    # Traps along the shortest solution: wrong moves that kill the run.
    traps = 0
    s = start
    for d in path:
        for alt in 'UDLR':
            n = level.move(s, alt)
            if alt != d and n is not None and n != s and n not in alive:
                traps += 1
        s = level.move(s, d)

    return {
        'solvable': True,
        'moves': len(path),
        'solution': ''.join(path),
        'states': len(parent),
        'dead_states': len(parent) - len(alive),
        'ruin_rate': ruinous / live_moves if live_moves else 0.0,
        'push_ruin_rate': ruinous_pushes / live_pushes if live_pushes else 0.0,
        'traps_on_path': traps,
        'truncated': truncated,
    }


def describe(result):
    if not result['solvable']:
        extra = ' (search stopped early, level too big to finish)' if result.get('truncated') else ''
        return f"NOT SOLVABLE{extra}: {result.get('reason', 'no way to reach a chest')}"
    return (f"solvable in {result['moves']} moves: {result['solution']}\n"
            f"  {result['states']} positions reachable, {result['dead_states']} of them are dead ends\n"
            f"  {result['push_ruin_rate']:.0%} of crate pushes ruin the run; "
            f"{result['traps_on_path']} trap moves next to the best path"
            + ('\n  (search stopped early; numbers are partial)' if result['truncated'] else ''))
