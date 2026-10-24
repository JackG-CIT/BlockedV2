"""Difficulty ratings: half a skull up to 5 skulls, worked out by the solver.

A level's score mixes four things the solver measures:
  - crate pushes on the best route (each one is a decision),
  - how long that route is,
  - how often a crate push ruins the run (how unforgiving it is),
  - how many positions the puzzle has (how much there is to get lost in),
plus a little for each kind of mechanic in play (plates, fuses).

Ratings are stored in half-skull steps: 1 = half a skull ... 10 = five
skulls. The score maps onto that scale in a straight line from EASIEST (half
a skull) to HARDEST (five skulls). HARDEST is set well above the current
voyage's toughest level (about 19.5) to leave room for harder ones; to
re-tune, change EASIEST/HARDEST (or WEIGHTS) and run `flask --app app rate all`.
Levels too big for the solver to finish are rated five skulls.
"""
import math

from solver import Level, solve

NAMES = {1: 'Calm Seas', 2: 'Choppy', 3: 'Squall', 4: 'Storm', 5: 'Maelstrom'}
WEIGHTS = {'pushes': 1.2, 'length': 1.0, 'ruin': 3.0, 'size': 0.45, 'mechanic': 0.5}
EASIEST, HARDEST = 2.5, 24.0       # scores that map to half a skull and to five skulls
MAX_HALVES = 10
MAX_STATES = 400_000


def score(moves, pushes, states, ruin, mechanics):
    w = WEIGHTS
    return (w['pushes'] * math.log2(1 + pushes)
            + w['length'] * math.log2(1 + moves / 10)
            + w['ruin'] * ruin
            + w['size'] * math.log10(max(states, 1))
            + w['mechanic'] * mechanics)


def halves(value):
    """Score -> half-skull steps, 1 (half a skull) to 10 (five skulls)."""
    step = (value - EASIEST) / (HARDEST - EASIEST) * (MAX_HALVES - 1)
    return max(1, min(MAX_HALVES, round(step) + 1))


def name(difficulty):
    """The sea-state name for a rating in half-skull steps (2 halves = 1 skull)."""
    return NAMES[(difficulty + 1) // 2]


def rate(width, height, tiles, max_states=MAX_STATES):
    """Returns {'difficulty': 1-10 half-skulls, 'par': fewest moves or None, 'score': float or None,
    'solution': a winning move string (U/D/L/R) or None}. Hints follow the solution on big levels."""
    level = Level(width, height, tiles)
    result = solve(level, max_states=max_states)
    if not result['solvable']:
        # Too big to finish (or no way through): rate it as the hardest.
        return {'difficulty': MAX_HALVES, 'par': None, 'score': None, 'solution': None}
    state, pushes = level.start, 0
    for d in result['solution']:
        nxt = level.move(state, d)
        pushes += nxt[1] != state[1]
        state = nxt
    kinds = {t['type'].lower() for t in tiles}
    mechanics = ('pressureplate' in kinds) + ('fuse' in kinds)
    value = score(result['moves'], pushes, result['states'], result['push_ruin_rate'], mechanics)
    return {'difficulty': halves(value), 'par': None if result['truncated'] else result['moves'],
            'score': round(value, 2), 'solution': result['solution']}
