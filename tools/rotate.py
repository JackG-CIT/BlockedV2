def rotate_ccw(rows, links):
    """Rotate a map 90 degrees counter-clockwise; links move with it."""
    H, W = len(rows), len(rows[0])
    # new (x', y') = (y, W-1-x)
    new = [''.join(rows[y][W - 1 - yy] for y in range(H)) for yy in range(W)]
    f = lambda p: (p[1], W - 1 - p[0])
    return new, {f(a): f(b) for a, b in links.items()}


def rotate_cw(rows, links):
    H, W = len(rows), len(rows[0])
    # new (x', y') = (H-1-y, x)
    new = [''.join(rows[H - 1 - y][x] for y in range(H)) for x in range(W)]
    f = lambda p: (H - 1 - p[1], p[0])
    return new, {f(a): f(b) for a, b in links.items()}
