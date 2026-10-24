"""Do the rooms of a chapter line up? Used by `flask --app app check-flow` and
the editor's Checks box.

A room's exit side is the border its treasure chest sits on. Its entrance side
is the border nearest the pirate's start. Walking out of one room's right side
should bring you in through the next room's left side, so a room's exit side
should face the next room's entrance side. Nothing here changes a level: it
reports mismatches and suggests a mirror or rotation that would fix them.
"""
SIDES = ('left', 'right', 'top', 'bottom')
OPPOSITE = {'left': 'right', 'right': 'left', 'top': 'bottom', 'bottom': 'top'}


def exit_sides(width, height, tiles):
    """Borders the level's chests sit on (empty if every chest is inside the room)."""
    sides = set()
    for t in tiles:
        if t['type'].lower() != 'exit':
            continue
        if t['x'] == 0: sides.add('left')
        if t['x'] == width - 1: sides.add('right')
        if t['y'] == 0: sides.add('top')
        if t['y'] == height - 1: sides.add('bottom')
    return sides


def entrance_sides(width, height, tiles):
    """The border(s) nearest the pirate's start."""
    player = next((t for t in tiles if t['type'].lower() == 'player'), None)
    if player is None:
        return set()
    gaps = {'left': player['x'], 'right': width - 1 - player['x'],
            'top': player['y'], 'bottom': height - 1 - player['y']}
    nearest = min(gaps.values())
    return {side for side, gap in gaps.items() if gap == nearest}


# ---- the eight ways to mirror or rotate a level ----
# Each maps (x, y, w, h) -> (x', y') and says how the board size changes.
TRANSFORMS = {
    'mirror left-right': (lambda x, y, w, h: (w - 1 - x, y), False),
    'mirror top-bottom': (lambda x, y, w, h: (x, h - 1 - y), False),
    'rotate 180': (lambda x, y, w, h: (w - 1 - x, h - 1 - y), False),
    'rotate clockwise': (lambda x, y, w, h: (h - 1 - y, x), True),
    'rotate anticlockwise': (lambda x, y, w, h: (y, w - 1 - x), True),
    'flip along the diagonal': (lambda x, y, w, h: (y, x), True),
    'flip along the other diagonal': (lambda x, y, w, h: (h - 1 - y, w - 1 - x), True),
}
TURN = {'left': 'up', 'up': 'right', 'right': 'down', 'down': 'left'}


def transform(width, height, tiles, name):
    """A copy of the level mirrored/rotated; plate and fuse links and cannon
    directions move with it. Returns (width, height, tiles)."""
    fn, swaps = TRANSFORMS[name]
    w2, h2 = (height, width) if swaps else (width, height)
    # Where does a unit step in each direction end up? That's how cannons turn.
    def turn(direction):
        dx, dy = {'up': (0, -1), 'down': (0, 1), 'left': (-1, 0), 'right': (1, 0)}[direction]
        x0, y0 = fn(1, 1, 3, 3)
        x1, y1 = fn(1 + dx, 1 + dy, 3, 3)
        return {(0, -1): 'up', (0, 1): 'down', (-1, 0): 'left', (1, 0): 'right'}[(x1 - x0, y1 - y0)]
    out = []
    for t in tiles:
        x, y = fn(t['x'], t['y'], width, height)
        new = dict(t, x=x, y=y)
        if t.get('aX') is not None and t.get('aY') is not None:
            new['aX'], new['aY'] = fn(t['aX'], t['aY'], width, height)
        if t['type'].lower() == 'cannon':
            new['direction'] = turn(t.get('direction') or 'up')
        out.append(new)
    return w2, h2, out


def check(rooms, chapter_size=5, verify=False, max_states=400_000):
    """rooms: the voyage in order, as dicts with name, width, height, tiles.
    Returns a list of problems: {room, next, exit, entrance, fixes}."""
    problems = []
    for i in range(len(rooms) - 1):
        if (i + 1) % chapter_size == 0:
            continue   # the chapter ends here; the next chapter starts fresh
        a, b = rooms[i], rooms[i + 1]
        out = exit_sides(a['width'], a['height'], a['tiles'])
        into = entrance_sides(b['width'], b['height'], b['tiles'])
        if not out:
            # The chest is inside the room, so there's no wall to walk out through.
            problems.append({'room': a['name'], 'next': b['name'], 'exit': [], 'entrance': sorted(into), 'fixes': []})
            continue
        wanted = {OPPOSITE[s] for s in out}
        if wanted & into:
            continue
        fixes = []
        for name in TRANSFORMS:
            w, h, tiles = transform(b['width'], b['height'], b['tiles'], name)
            if not wanted & entrance_sides(w, h, tiles):
                continue
            fix = {'change': f"{name} '{b['name']}'"}
            # Does the room after still line up once this one is turned?
            if (i + 2) % chapter_size != 0 and i + 2 < len(rooms):
                c = rooms[i + 2]
                fix['keeps_next'] = bool({OPPOSITE[s] for s in exit_sides(w, h, tiles)}
                                         & entrance_sides(c['width'], c['height'], c['tiles']))
            if verify:
                from solver import Level, solve
                r = solve(Level(w, h, tiles), max_states=max_states)
                fix['verified'] = ('solvable in %d moves' % r['moves']) if r['solvable'] else (
                    'too big to check here' if r.get('truncated') else 'NOT solvable')
            fixes.append(fix)
        problems.append({'room': a['name'], 'next': b['name'], 'exit': sorted(out),
                         'entrance': sorted(into), 'fixes': fixes})
    return problems
