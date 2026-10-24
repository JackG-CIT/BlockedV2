"""Writes BlockedV2/seed_levels.py with the 30-level, six-chapter voyage."""
import os
import sys, importlib, pprint
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import seed_levels as old
import rating
import fast
import levels_user as U, l12, rotate, new_levels

OLD = {lv['name']: lv for lv in old.LEVELS}
NEW = {lv['name']: lv for lv in new_levels.LEVELS}


def user(name, notes, rows_links, was=()):
    rows, links = rows_links
    lv = {'name': name, 'notes': notes, 'map': rows, 'links': links}
    if was:
        lv['was'] = list(was)
    return lv


L6 = rotate.rotate_ccw(*U.L6)

CHAPTERS = [
    ('Sea Legs', 'pushing crates', [
        OLD['Shore Leave'], OLD['Heave Ho'], OLD['Wedged'], OLD['One at a Time'],
        new_levels.LEVELS[0]]),
    ('Pressure', 'plates and gates', [
        OLD['Stomp'], OLD['Dead Weight'], OLD['Two Locks'], OLD['Hold the Door'],
        user('Seven Seals', 'Seven locks between you and the sea, and every one wants a crate.', L6)]),
    ('Locks and Keys', 'squeezing crates out of shutting gates', [
        new_levels.LEVELS[1],
        user('Tangled Rigging', 'Every plate pulls a rope to some other door. Trace the rigging.', U.L5),
        OLD['Cargo Hold'],
        user('Nine Locks', "Five crates, nine locks. Not every door has to stay open forever.", U.L7),
        user('Pinch Point', "A shutting gate spits its crate out somewhere. Make it somewhere useful.", U.L9)]),
    ('Gunpowder', 'cannons and fuses', [
        OLD['Fire in the Hole'], OLD['Load and Light'], OLD['Clear the Way'], OLD['Powder Keg'],
        OLD['Broadside']]),
    ('Crossfire', 'cannons and gates together', [
        OLD['Open Fire'], OLD['Run the Gauntlet'], OLD['Powder Monkey'], OLD['Crossfire'],
        user('Powder Room', 'Eleven crates and not one to spare. Count before you shoot.', U.L11)]),
    ("Davy Jones' Locker", 'loaded fuses, and everything at once', [
        OLD['The Brig'], OLD["Davy Jones' Locker"], new_levels.LEVELS[2], new_levels.LEVELS[3],
        user('The Last Broadside', 'Break out of the brig, blast the hold open, and give her a broadside to remember.', l12.V6)]),
]


# Levels too big to rate with a full search: a known solution (from the stage
# solver). Seven Seals' 44 is proven shortest by a plain breadth-first search.
HERE = os.path.dirname(os.path.abspath(__file__))
_sol = lambda f: open(os.path.join(HERE, 'solutions', f)).read().strip()
KNOWN_SOLUTIONS = {'Seven Seals': _sol('l6_solution.txt'), 'Nine Locks': _sol('l7_solution.txt'),
                   'Pinch Point': _sol('l9_solution.txt'), 'Powder Room': _sol('l11_solution.txt'),
                   'The Last Broadside': _sol('l12_solution.txt')}
KNOWN_SOLUTIONS.update(getattr(new_levels, 'SOLUTIONS', {}))
EXACT_PAR = {'Seven Seals': 44}


def rate_offline(lv):
    """Same formula as rating.py, but with the fast solver so big levels can be rated."""
    spec = {'map': [r.replace('D', '.') for r in lv['map']], 'links': lv['links']}
    W, H, tiles = old.parse(spec)
    F = fast.Fast(W, H, tiles)
    # Try an exact search first; the known giants (too big for it) go straight to their stored solution.
    giant = lv['name'] in ('Seven Seals', 'Nine Locks', 'Pinch Point', 'Powder Room', 'The Last Broadside')
    r = {'solvable': False} if giant else fast.solve(F, max_states=1_500_000, stats=True)
    exact = r['solvable']
    if exact:
        sol, states, ruin = r['solution'], r['states'], r['push_ruin']
    else:
        sol = KNOWN_SOLUTIONS[lv['name']]
        states, ruin = 30_000_000, 0.35      # too big to count: assume a typical trap rate
    s, pushes = F.start, 0
    for ch in sol:
        n = F.move(s, 'UDLR'.index(ch))
        assert n is not None, lv['name']
        pushes += n[1] != s[1]
        s = n
    assert F.exits >> s[0] & 1, lv['name'] + ' solution does not win'
    kinds = {t['type'] for t in tiles}
    value = rating.score(len(sol), pushes, states, ruin, ('pressureplate' in kinds) + ('fuse' in kinds))
    lv['difficulty'] = rating.halves(value)   # half-skull steps, 1-10
    lv['par'] = len(sol) if exact else EXACT_PAR.get(lv['name'])
    lv['solution'] = sol
    print(f"  {lv['name']}: {lv['difficulty'] / 2:g} skulls ({rating.name(lv['difficulty'])}), "
          f"score {value:.1f}, {'par ' + str(len(sol)) if exact else 'best known ' + str(len(sol))}")


def fmt_level(lv):
    out = ['    {']
    out.append(f"        'name': {lv['name']!r},")
    if lv.get('was'):
        out.append(f"        'was': {lv['was']!r},")
    out.append(f"        'notes': {lv['notes']!r},")
    out.append(f"        'difficulty': {lv['difficulty']}, 'par': {lv['par']!r},")
    if lv.get('transition'):
        out.append(f"        'transition': {lv['transition']!r},")
    out.append("        'map': [")
    for r in lv['map']:
        out.append(f"            {r!r},")
    out.append('        ],')
    links = ', '.join(f'{a}: {b}' for a, b in lv['links'].items())
    out.append(f"        'links': {{{links}}},")
    out.append(f"        'solution': {lv['solution']!r},")
    out.append('    },')
    return '\n'.join(out)


def main():
    src = open(old.__file__, encoding='utf-8').read()
    head = src[:src.index('LEVELS = [')]
    tail = src[src.index("SYMBOLS = {"):]
    head = head.replace('The main voyage: 20 levels for `flask --app app seed`.',
                        'The main voyage: 30 levels in six chapters of five, for `flask --app app seed`.')
    head = head.replace("""They teach the rules by doing.""", """Each chapter adds a new idea and ends with a harder test of it (every 5th
level is a chapter's "boss", and gets the boss music). They teach the rules by doing.""")
    head = head.replace("""Map key:""", """Optional per level:
  'transition'  a line shown on the room tally as you walk on to the next room
                (story text; leave it out for none)
  'difficulty'  rating in half skulls (1-10) and 'par' (fewest moves, or None),
                worked out offline by the solver; rating.py has the formula
  'solution'    a known winning route (U/D/L/R); hints follow it on big levels
  'was'         old names, if a level is renamed (so --refresh still finds it)

Map key:""")
    for _, _, levels in CHAPTERS:
        for lv in levels:
            rate_offline(lv)
    body = ['LEVELS = [']
    n = 0
    for c, (title, idea, levels) in enumerate(CHAPTERS, 1):
        assert len(levels) == 5
        body.append(f'    # ===== Chapter {c}: {title} ({idea}) =====')
        for lv in levels:
            n += 1
            body.append(f'    # {n}' + ('  (chapter test)' if n % 5 == 0 else ''))
            body.append(fmt_level(lv))
    body.append(']')
    body.append('')
    body.append('# Chapter titles, in order (five levels each).')
    body.append('CHAPTERS = ' + pprint.pformat([t for t, _, _ in CHAPTERS]))
    body.append('')
    body.append('')
    text = head + '\n'.join(body) + '\n' + tail
    open(old.__file__, 'w', encoding='utf-8', newline='\n').write(text)
    print('wrote', n, 'levels')


if __name__ == '__main__':
    main()
