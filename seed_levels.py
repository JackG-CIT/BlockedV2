"""The main voyage: 30 levels in six chapters of five, for `flask --app app seed`.

Each chapter adds a new idea and ends with a harder test of it (every 5th
level is a chapter's "boss", and gets the boss music). Each chapter adds a new idea and ends with a harder test of it (every 5th
level is a chapter's "boss", and gets the boss music). They teach the rules by doing. Each new idea first appears somewhere safe,
then gets tested, then gets combined with the others. Every level has been
checked with solver.py: it can be beaten, and it needs the mechanic it's
built around.

Optional per level:
  'transition'  a line shown on the room tally as you walk on to the next room
                (story text; leave it out for none)
  'difficulty'  rating in half skulls (1-10) and 'par' (fewest moves, or None),
                worked out offline by the solver; rating.py has the formula
  'solution'    a known winning route (U/D/L/R); hints follow it on big levels
  'was'         old names, if a level is renamed (so --refresh still finds it)

Optional per level:
  'transition'  a line shown on the room tally as you walk on to the next room
                (story text; leave it out for none)
  'difficulty'  rating in half skulls (1-10) and 'par' (fewest moves, or None),
                worked out offline by the solver; rating.py has the formula
  'solution'    a known winning route (U/D/L/R); hints follow it on big levels
  'was'         old names, if a level is renamed (so --refresh still finds it)

Map key:  # wall   P pirate (start)   B crate   E treasure (exit)
          _ pressure plate   F fuse   ^ v < > cannon facing that way
          = a crate that starts on a pressure plate
          D marks a gate (an empty tile a plate opens). It's only a reminder;
            the link itself is set in "links" as (plate or fuse) -> target.
"""

LEVELS = [
    # ===== Chapter 1: Sea Legs (pushing crates) =====
    # 1
    {
        'name': 'Shore Leave',
        'notes': "Find your sea legs. The treasure won't dig itself up.",
        'difficulty': 1, 'par': 24,
        'map': [
            '##########',
            '#P...#...#',
            '####.#.#.#',
            '#....#.#.#',
            '#.####.#E#',
            '#......###',
            '##########',
        ],
        'links': {},
        'solution': 'RRRDDLLLDDRRRRRUUUURRDDD',
    },
    # 2
    {
        'name': 'Heave Ho',
        'notes': "Something's in the way. Lean into it.",
        'difficulty': 2, 'par': 12,
        'map': [
            '##########',
            '#P..B...##',
            '######.###',
            '#E.....###',
            '##########',
        ],
        'links': {},
        'solution': 'RRRRRDDLLLLL',
    },
    # 3
    {
        'name': 'Wedged',
        'notes': "Crates go where they're shoved, and they never come back.",
        'difficulty': 2, 'par': 8,
        'map': [
            '#########',
            '#P..#####',
            '#..B....#',
            '#...###E#',
            '#########',
        ],
        'links': {},
        'solution': 'RRDRRRRD',
    },
    # 4
    {
        'name': 'One at a Time',
        'notes': "Even the burliest pirate can't shift two at once.",
        'difficulty': 2, 'par': 10,
        'map': [
            '#########',
            '#...#...#',
            '#P.BB..E#',
            '#...#...#',
            '#########',
        ],
        'links': {},
        'solution': 'URRDRRURDR',
    },
    # 5  (chapter test)
    {
        'name': 'Stowaway Shuffle',
        'notes': "Every crate's in the way, and every corner's a grave. Shove with care.",
        'difficulty': 4, 'par': 35,
        'map': [
            '################',
            '#PB.####..######',
            '#.B###....B#.B.E',
            '##.##.B.#.##.B.#',
            '##.####B#.##B..#',
            '#..##.B......###',
            '#......##.######',
            '################',
        ],
        'links': {},
        'solution': 'RDDDDLDRRRRURRUULURRURDDDDRRRURRUUR',
    },
    # ===== Chapter 2: Pressure (plates and gates) =====
    # 6
    {
        'name': 'Stomp',
        'notes': 'Some planks are more than they seem.',
        'difficulty': 2, 'par': 9,
        'map': [
            '###########',
            '#P.B_...###',
            '#......D.E#',
            '###########',
        ],
        'links': {(4, 1): (7, 2)},
        'solution': 'RRDRRRRRR',
    },
    # 7
    {
        'name': 'Dead Weight',
        'notes': "You can't stand in two places at once.",
        'difficulty': 3, 'par': 10,
        'map': [
            '#########',
            '#P....#E#',
            '#.B._.D.#',
            '#.....#.#',
            '#########',
        ],
        'links': {(4, 2): (6, 2)},
        'solution': 'DRRURRDRRU',
    },
    # 8
    {
        'name': 'Two Locks',
        'notes': 'Every lock wants its own weight.',
        'difficulty': 3, 'par': 20,
        'map': [
            '#############',
            '#P...#._..###',
            '#.B..D..B.D.#',
            '#.._##....#E#',
            '#############',
        ],
        'links': {(3, 3): (5, 2), (7, 1): (10, 2)},
        'solution': 'DRURDRRRDRRURULDRRRD',
    },
    # 9
    {
        'name': 'Hold the Door',
        'notes': 'One to hold, one to carry.',
        'difficulty': 4, 'par': 17,
        'map': [
            '#############',
            '#P....#.....#',
            '#.B.B.D..._.#',
            '#..._.#.....#',
            '########D####',
            '########E####',
            '#############',
        ],
        'links': {(4, 3): (6, 2), (10, 2): (8, 4)},
        'solution': 'RDLDRRURRRRRRDLDD',
    },
    # 10  (chapter test)
    {
        'name': 'Seven Seals',
        'notes': 'Seven locks between you and the sea, and every one wants a crate.',
        'difficulty': 5, 'par': 44,
        'map': [
            '#########E#',
            '######_.#D#',
            '#.._..B.#D#',
            '#..BB_B_#D#',
            '#.B.#.=.#D#',
            '##P###..#D#',
            '##_#_.B.DD#',
            '###########',
        ],
        'links': {(2, 6): (8, 6), (3, 2): (9, 6), (4, 6): (9, 5), (5, 3): (9, 4), (6, 4): (9, 3), (6, 1): (9, 2), (7, 3): (9, 1)},
        'solution': 'ULUURRRRDRULLLLDDDURURURRDDRDDLUDLRRRRUUUUUU',
    },
    # ===== Chapter 3: Locks and Keys (squeezing crates out of shutting gates) =====
    # 11
    {
        'name': 'Squeeze Play',
        'notes': "A shut door don't argue. Whatever's in the doorway gets shoved aside.",
        'difficulty': 3, 'par': 24,
        'map': [
            '########',
            '#....###',
            '#PB.B###',
            '#.##.###',
            '#.=.D###',
            '#D###_##',
            '#E######',
        ],
        'links': {(2, 4): (4, 4), (5, 5): (1, 5)},
        'solution': 'RURRDDUULLDRURDLLLDDRLDD',
    },
    # 12
    {
        'name': 'Tangled Rigging',
        'notes': 'Every plate pulls a rope to some other door. Trace the rigging.',
        'difficulty': 5, 'par': 74,
        'map': [
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
        'links': {(3, 8): (9, 10), (10, 10): (5, 5), (7, 4): (10, 5)},
        'solution': 'UURUULDDDDDDDDUUUUUULLURURDDDDDDULLDDDDRRRRRRRRLLLLLLUUUULURRRRRDRURULDRRR',
    },
    # 13
    {
        'name': 'Cargo Hold',
        'notes': 'Three locks, three crates. Every crate has one good home.',
        'difficulty': 4, 'par': 35,
        'map': [
            '###########',
            '#...#..####',
            '#.B..B.####',
            '##.#_._####',
            '#P.B...DDDE',
            '#...#_.####',
            '###########',
        ],
        'links': {(4, 3): (7, 4), (6, 3): (8, 4), (5, 5): (9, 4)},
        'solution': 'RRRURRUULDRDLULLULLDRRRRURDLDDRRRRR',
    },
    # 14
    {
        'name': 'Nine Locks',
        'notes': 'Five crates, nine locks. Not every door has to stay open forever.',
        'difficulty': 6, 'par': None,
        'map': [
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
        'links': {(2, 1): (2, 6), (2, 9): (6, 5), (3, 9): (6, 6), (4, 9): (7, 6), (5, 4): (6, 9), (6, 4): (8, 4), (6, 1): (10, 8), (7, 1): (10, 9), (10, 10): (10, 5)},
        'solution': 'DRRRULDLDDDDDDUUUUUURRDLULDDDDDLDRURDULUURRRDRULDDDDDLLUULURRDRUUUDDDDRRURUUUUURULDLUDRRDDDDDLDLLLUUUURUUUDRRRDDDDDLDLLLULLLLDRRRRRRDRULURRURDDUULUURR',
    },
    # 15  (chapter test)
    {
        'name': 'Pinch Point',
        'notes': 'A shutting gate spits its crate out somewhere. Make it somewhere useful.',
        'difficulty': 6, 'par': None,
        'map': [
            '############',
            '#..#.......#',
            '#._#...BBB.#',
            '###D.......#',
            '#...B....###',
            '#....B...DDE',
            '#..P..B..###',
            '#......B...#',
            '#.......D###',
            '#..##...#_.#',
            '#.._=...#..#',
            '############',
        ],
        'links': {(4, 10): (3, 3), (3, 10): (8, 8), (2, 2): (9, 5), (9, 9): (10, 5)},
        'solution': 'URURULUURRRRDLLLDDLDDDDRDDLLRRUULLLDLDRUUUUUURRRRDRDDLDRUUULDLDRRRUUULUURDDDDUULLLDDLDRRUUUUUURRRDLDDDDLDUUUUURRRDLLULDDDDLDDLLLLDDRLUUUUURRRRRRRRR',
    },
    # ===== Chapter 4: Gunpowder (cannons and fuses) =====
    # 16
    {
        'name': 'Fire in the Hole',
        'notes': 'Mind the fuse.',
        'difficulty': 2, 'par': 8,
        'map': [
            '#########',
            '#P..F..##',
            '#......##',
            '#.>B..#E#',
            '#.....#.#',
            '#########',
        ],
        'links': {(4, 1): (2, 3)},
        'solution': 'RRRDDRRR',
    },
    # 17
    {
        'name': 'Load and Light',
        'notes': "A cannon's only as good as what's in front of it.",
        'difficulty': 3, 'par': 15,
        'map': [
            '##########',
            '#P...F..##',
            '#..B....##',
            '#>.....#E#',
            '#......#.#',
            '##########',
        ],
        'links': {(5, 1): (1, 3)},
        'solution': 'RRDRDLUURRDDRRR',
    },
    # 18
    {
        'name': 'Clear the Way',
        'notes': "When a wall of crates won't budge, try something louder.",
        'difficulty': 2, 'par': 10,
        'map': [
            '###########',
            '#P..F######',
            '#....###E##',
            '#>B..BB...#',
            '###########',
        ],
        'links': {(4, 1): (1, 3)},
        'solution': 'RRRDDRRRRU',
    },
    # 19
    {
        'name': 'Powder Keg',
        'notes': "A fuse doesn't care who's standing on it.",
        'difficulty': 3, 'par': 27,
        'map': [
            '############',
            '#P....######',
            '#.B.F.v#####',
            '#####......#',
            '######.##B.#',
            '######.##..#',
            '############',
            '######E#####',
            '############',
        ],
        'links': {(4, 2): (6, 2)},
        'solution': 'DRRURRDDRRRRRDDLURULLLLDDDD',
    },
    # 20  (chapter test)
    {
        'name': 'Broadside',
        'notes': 'Count your shots before you take them.',
        'difficulty': 4, 'par': 32,
        'map': [
            '#############',
            '#P.#.F#######',
            '#..B..#######',
            '#.#.B.#######',
            '#>....#..#..E',
            '#..B..#######',
            '#.....#######',
            '#############',
        ],
        'links': {(5, 1): (1, 4)},
        'solution': 'DRRRDRDLLURRUDDDLLDLUURRRRRRRRRR',
    },
    # ===== Chapter 5: Crossfire (cannons and gates together) =====
    # 21
    {
        'name': 'Open Fire',
        'notes': 'A shut gate stops a cannonball as well as a pirate.',
        'difficulty': 3, 'par': 18,
        'map': [
            '#############',
            '#P...F#######',
            '#..B._#######',
            '#.....#######',
            '#>B.......D#E',
            '#############',
        ],
        'links': {(5, 2): (10, 4), (5, 1): (1, 4)},
        'solution': 'DRRRURLDDDRRRRRRRR',
    },
    # 22
    {
        'name': 'Run the Gauntlet',
        'notes': "Your powder's on the wrong side of the gate.",
        'difficulty': 4, 'par': 33,
        'map': [
            '############',
            '#P._.##..v.#',
            '#..B.##....#',
            '#..B..D....#',
            '#.F...#....#',
            '#######.####',
            '#########E##',
            '############',
        ],
        'links': {(3, 1): (6, 3), (2, 4): (9, 1)},
        'solution': 'DDRRUDRRRRRDRULLLLDLLLURRRRRDRRDD',
    },
    # 23
    {
        'name': 'Powder Monkey',
        'notes': "Once you're through, there's no going back to light it.",
        'difficulty': 4, 'par': 42,
        'map': [
            '############',
            '#P....######',
            '#.B.F.v#####',
            '#####......#',
            '######.#.B.#',
            '######.#B..#',
            '######.#...#',
            '############',
            '######.#####',
            '############',
            '######E#####',
            '############',
        ],
        'links': {(4, 2): (6, 2)},
        'solution': 'DRRURRDDRRRRRDDLURULLLRDRDDLUURULLLDDDDDDD',
    },
    # 24
    {
        'name': 'Crossfire',
        'notes': "Today's obstacle is tomorrow's ammunition.",
        'difficulty': 4, 'par': 36,
        'map': [
            '##############',
            '#P....#....Fv#',
            '#..B..#..B...#',
            '#>....BB.....#',
            '#..F..#.....B#',
            '##############',
            '############E#',
            '##############',
        ],
        'links': {(3, 4): (1, 3), (11, 1): (12, 1)},
        'solution': 'RRDRDLDURRRRRURRRUDDDLLULURRRUDDDRDD',
    },
    # 25  (chapter test)
    {
        'name': 'Powder Room',
        'notes': 'Eleven crates and not one to spare. Count before you shoot.',
        'difficulty': 8, 'par': None,
        'map': [
            '############',
            '#_#...D___.#',
            '#D...#######',
            '#....B.._F.#',
            '#####B######',
            '#>...#DDDD#E',
            '#####B######',
            '#.....#....#',
            '#FB=P.#BBB.#',
            '#>.B....BB.#',
            '##^F..#....#',
            '############',
        ],
        'links': {(3, 8): (1, 2), (8, 3): (6, 1), (1, 1): (6, 5), (7, 1): (7, 5), (8, 1): (8, 5), (9, 1): (9, 5), (9, 3): (1, 5), (1, 8): (1, 9), (3, 10): (2, 10)},
        'solution': 'ULLDURRDDDLRULRDLULUUUUUURRRRRLLLLLDDDDRRDLULDLURDDRRRRRDRRRUUULLLDURRRDDDLLULLLDLURULDRRRDRRRULLLLLDLUURULLRDDLLUUUUUULURRDRULURRRRRLLLLDDLLDDDDDDRRRRRUURDURRDDLLLLLDLUURULLRDDLLUUUUUULURRDRULURRRRLLLDDLLDDDDDDRRRRRUURRDRDLLLLLDLUURULLRDDLLUUUUUULURRDRULURRRLLDDLLDDDDDDRUDLUUUUUURRRRRRLLLLLLDDDDDDRRUULRDDLLUUUURRRDDDLDRRRURRDLLLLDLURULULLUUUURRRDDDDDLDRRRURRDLLLLDLUURULLRDDLLUURRRUUUURRRRLLLLDDDDLLLUUUURULDLUDRDDDDRRDLURDDLLUUUDRRRUUUURRRRLLLLDDRRRRRR',
    },
    # ===== Chapter 6: Davy Jones' Locker (loaded fuses, and everything at once) =====
    # 26
    {
        'name': 'The Brig',
        'notes': 'No room to spare and no second chances. Think three pushes ahead.',
        'difficulty': 4, 'par': 42,
        'map': [
            '##############',
            '#._B.#..DDDE##',
            '#..B....######',
            '#._#..B.######',
            '#.P_...#######',
            '#...##########',
            '#..###########',
            '##############',
        ],
        'links': {(2, 1): (8, 1), (2, 3): (9, 1), (3, 4): (10, 1)},
        'solution': 'RRUULRRRRDLLDLLLULUURDRRULDRDRDLUURRURRRRR',
    },
    # 27
    {
        'name': "Davy Jones' Locker",
        'notes': "Everything you've learned. Nothing to spare.",
        'difficulty': 5, 'par': 86,
        'map': [
            '#################',
            '#P...F###.#######',
            '#.#B.####..######',
            '##..#.####..#..##',
            '#>.....BB...D..#E',
            '#..#.####...#..##',
            '#.B#..####_######',
            '#.....###..######',
            '#################',
        ],
        'links': {(10, 6): (12, 4), (5, 1): (1, 4)},
        'solution': 'RRDDLDDLDDRRRUUULUUURRLDLDDLDLDDRUUDDRRUUURRRRRDRRUULDDULLLLLLLUUURRLDLDDRRRRRRRRRRRRR',
    },
    # 28
    {
        'name': 'Hair Trigger',
        'notes': 'Sit a crate on the fuse and the cannon never sleeps. Feed it.',
        'difficulty': 5, 'par': 50,
        'map': [
            '##########',
            '#...#v..##',
            '#.B.....##',
            '#.B.B##F##',
            '#P.B.#####',
            '#....#####',
            '#####E####',
        ],
        'links': {(7, 3): (5, 1)},
        'solution': 'UURRRRRURDLLLLLLDDRULURRRLDLDDRUULURRLDDRULURDDDRD',
    },
    # 29
    {
        'name': 'The Long Shot',
        'notes': "Load the gun, feed the gun, and mind where you're standing when it fires.",
        'difficulty': 6, 'par': None,
        'map': [
            '################',
            '#.....#...#..#_#',
            '#.B...DB..#.BD##',
            '#.##.##.B.#...DE',
            '#.=_D##._P#.#.##',
            '##D##F>.#D#.=###',
            '#....#...#######',
            '#..B...B._######',
            '#.B....B.#######',
            '#........#######',
            '################',
        ],
        'links': {(8, 4): (6, 2), (2, 4): (4, 4), (3, 4): (2, 5), (5, 5): (6, 5), (9, 7): (9, 5), (12, 5): (13, 2), (14, 1): (14, 3)},
        'solution': 'UULDULLLULDDUULLLDRRURDLLLDDRDDRDRRRRRDDLUUUURRULULDDRRRRUUURDLDDLLLDDLLLLLLDRRRRDRUUUURRRRUURRRR',
    },
    # 30  (chapter test)
    {
        'name': 'The Last Broadside',
        'notes': 'Break out of the brig, blast the hold open, and give her a broadside to remember.',
        'difficulty': 7, 'par': None,
        'map': [
            '#########################',
            '############_#...########',
            '######_...F##D...########',
            '######.BBB.#.....#.....##',
            '#>...D.BPB.D..BB.D....D#E',
            '######.BBB.#..BB.#..._.##',
            '######...._#....=########',
            '############.....########',
            '#########################',
        ],
        'links': {(6, 2): (5, 4), (10, 6): (11, 4), (12, 1): (17, 4), (16, 6): (13, 2), (10, 2): (1, 4), (21, 5): (22, 4)},
        'solution': 'DLDRRLLLUUUDDRRULLLLLRRRRRRURDUUDDRRDDRRUUUUDRRDLLDLUUDDDDRRRUUULDLDRUUUURDLDRRRRRURDLLLLLLLLLLLLLUDDDRULUURRDLLLLLLLRRRRRURRUDDRRRRRRRRRRRRRR',
    },
]

# Chapter titles, in order (five levels each).
CHAPTERS = ['Sea Legs',
 'Pressure',
 'Locks and Keys',
 'Gunpowder',
 'Crossfire',
 "Davy Jones' Locker"]


SYMBOLS = {'#': 'wall', 'P': 'player', 'B': 'box', 'E': 'exit', '_': 'pressureplate', 'F': 'fuse'}
CANNONS = {'^': 'up', 'v': 'down', '<': 'left', '>': 'right'}
STACKED = {'=': ('pressureplate', 'box')}   # a crate that starts on a plate


def parse(spec):
    rows = spec['map']
    tiles = []
    for y, row in enumerate(rows):
        for x, ch in enumerate(row):
            if ch in SYMBOLS or ch in CANNONS or ch in STACKED:
                for kind in STACKED.get(ch, (SYMBOLS.get(ch, 'cannon'),)):
                    tile = {'type': kind, 'x': x, 'y': y,
                            'direction': CANNONS.get(ch), 'aX': None, 'aY': None}
                    if kind in ('pressureplate', 'fuse') and (x, y) in spec['links']:
                        tile['aX'], tile['aY'] = spec['links'][(x, y)]
                    tiles.append(tile)
    return len(rows[0]), len(rows), tiles
