"""Four new voyage levels (drafts for seed_levels.py). 'D' marks gate squares (parse() treats it as floor)."""

LEVELS = [
    {   # voyage 5 - chapter 1 test (crates only)
        'name': 'Stowaway Shuffle',
        'notes': "Every crate's in the way, and every corner's a grave. Shove with care.",
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
    },
    {   # voyage 11 - chapter 3 opener: the squeeze
        'name': 'Squeeze Play',
        'notes': "A shut door don't argue. Whatever's in the doorway gets shoved aside.",
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
    },
    {   # voyage 28 - chapter 6: the loaded fuse
        'name': 'Hair Trigger',
        'notes': "Sit a crate on the fuse and the cannon never sleeps. Feed it.",
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
    },
    {   # voyage 29 - chapter 6 boss
        'name': 'The Long Shot',
        'notes': "Load the gun, feed the gun, and mind where you're standing when it fires.",
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
        'links': {(8, 4): (6, 2), (2, 4): (4, 4), (3, 4): (2, 5), (5, 5): (6, 5),
                  (9, 7): (9, 5), (12, 5): (13, 2), (14, 1): (14, 3)},
    },
]

SOLUTIONS = {
    'Stowaway Shuffle': 'RDDDDLDRRRRURRUULURRURDDDDRRRURRUUR',
    'Squeeze Play': 'RURRDDUULLDRURDLLLDDRLDD',
    'Hair Trigger': 'UURRRRRURDLLLLLLDDRULURRRLDLDDRUULURRLDDRULURDDDRD',
    'The Long Shot': 'UULDULLLULDDUULLLDRRURDLLLDDRDDRDRRRRRDDLUUUURRULULDDRRRRUUURDLDDLLLDDLLLLLLDRRRRDRUUUURRRRUURRRR',
}
