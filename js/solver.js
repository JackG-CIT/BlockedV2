// In-browser copy of solver.py, run in a Web Worker so it never freezes the
// game. Given a level and the current board, it works out whether the
// treasure can still be reached and what the next big step towards it is.
//
// The rules mirror engine.js exactly. Keep this file, engine.js and
// solver.py in step if the rules ever change.
"use strict";

const MAX_STATES = 300000;
const DIRS = [["U", 0, -1], ["D", 0, 1], ["L", -1, 0], ["R", 1, 0]];
const CANNON_DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
// Monsters (solver.py MONSTERS): squares that block like walls; every crate shot into
// one costs it a health, and with none left all its squares vanish. Health is kept in
// the walls set as negative numbers: token(m, k) for k = 1..health.
const MONSTERS = ["kraken", "hull"];
const token = (m, k) => -(1 + m * 1000 + k);

function prepare(level) {
    const W = level.width, H = level.height;
    const L = { W, H, cannons: new Map(), exits: new Set(), plates: [], fuses: [], plateCells: new Set(),
                monsterCells: MONSTERS.map(() => []), monsterAt: new Map(), health: MONSTERS.map(() => 0) };
    const tiles = level.tiles.slice().sort((a, b) => a.y - b.y || a.x - b.x);
    for (const t of tiles) {
        const i = t.y * W + t.x;
        const type = t.type.toLowerCase();
        const target = t.aX != null && t.aY != null && t.aX >= 0 && t.aY >= 0 && t.aX < W && t.aY < H
            ? t.aY * W + t.aX : -1;
        if (type === "cannon") L.cannons.set(i, CANNON_DIRS[t.direction] || CANNON_DIRS.up);
        else if (type === "exit") L.exits.add(i);
        else if (type === "pressureplate") { L.plates.push([i, target]); L.plateCells.add(i); }
        else if (type === "fuse") L.fuses.push([i, target]);
        else if (MONSTERS.includes(type)) {
            const m = MONSTERS.indexOf(type);
            L.monsterCells[m].push(i);
            L.monsterAt.set(i, m);
            L.health[m] = Math.max(L.health[m], t.aX || 3);
        }
    }
    // Plate targets act as gates (unless they're cannons, which plates ignore).
    L.gates = new Set(L.plates.map(([, t]) => t).filter(t => t >= 0 && !L.cannons.has(t)));
    // When several plates point at one gate, the last one (in board order) decides.
    const decider = new Map();
    for (const [plate, t] of L.plates) if (L.gates.has(t)) decider.set(t, plate);
    L.gateOrder = L.plates.filter(([plate, t]) => L.gates.has(t) && decider.get(t) === plate);
    return L;
}

// Adds the monsters' squares and full health to a fresh walls set.
function addMonsters(L, walls) {
    L.monsterCells.forEach((cells, m) => {
        if (!cells.length) return;
        cells.forEach(c => walls.add(c));
        for (let k = 1; k <= L.health[m]; k++) walls.add(token(m, k));
    });
}

function healthLeft(walls, m) {
    let k = 0;
    while (walls.has(token(m, k + 1))) k++;
    return k;
}

// A crate hit monster m: one less health; at none, its squares vanish.
function hitMonster(L, m, walls) {
    const left = healthLeft(walls, m);
    walls.delete(token(m, left));
    if (left <= 1) L.monsterCells[m].forEach(c => walls.delete(c));
}

function inside(L, x, y) {
    return x >= 0 && y >= 0 && x < L.W && y < L.H;
}

// Where a crate goes when a gate shuts on it: the first free square in rings
// around the gate (radius 1, 2, ...), each ring read from its top-right
// corner, right to left, top to bottom.
function squeezeSpot(L, gate, p, boxes, walls) {
    const gx = gate % L.W, gy = Math.floor(gate / L.W);
    for (let r = 1; r < Math.max(L.W, L.H); r++) {
        for (let y = gy - r; y <= gy + r; y++) {
            for (let x = gx + r; x >= gx - r; x--) {
                if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== r || !inside(L, x, y)) continue;
                const i = y * L.W + x;
                if (!walls.has(i) && !boxes.has(i) && !L.cannons.has(i) && i !== p) return i;
            }
        }
    }
    return -1;
}

// checkPressurePlates + checkFuses. Mutates boxes/walls; returns the shots
// fired, or null if the pirate was killed (crushed by a gate or shot).
// checkPressurePlates: open or shut every gate (mutates boxes/walls). A gate
// that shuts on a crate squeezes it out; if that lands it on another plate,
// the plates are checked again. Returns false if a gate shut on the pirate.
function settlePlates(L, p, boxes, walls) {
    for (let pass = 0; pass < 10; pass++) {
        let squeezed = false;
        for (const [plate, target] of L.gateOrder) {
            if (plate === p || boxes.has(plate)) walls.delete(target);
            else if (!walls.has(target)) {
                if (target === p) return false;
                if (boxes.has(target)) {
                    boxes.delete(target);
                    const spot = squeezeSpot(L, target, p, boxes, walls);
                    if (spot >= 0) boxes.add(spot);
                    squeezed = true;
                }
                walls.add(target);
            }
        }
        if (!squeezed) break;
    }
    return true;
}

// Plates, then fuses. Mutates boxes/walls; returns the shots fired, or null if
// the pirate was killed (crushed by a gate or shot). A shot crate flies one tile
// at a time and the plates react after every tile (a gate shuts the moment its
// crate is shot off the plate). In the game the pirate can keep moving during a
// flight; the solver waits for each shot to land, which is always allowed.
function settle(L, p, boxes, walls) {
    if (!settlePlates(L, p, boxes, walls)) return null;
    const shots = [];
    for (const [fuse, target] of L.fuses) {
        if (!(fuse === p || boxes.has(fuse))) continue;
        if (!L.cannons.has(target)) continue;
        const [dx, dy] = L.cannons.get(target);
        let x = target % L.W + dx, y = Math.floor(target / L.W) + dy;
        if (!inside(L, x, y) || !boxes.has(y * L.W + x)) continue;
        shots.push({ fuse, cannon: target, crate: y * L.W + x });
        for (;;) {
            const nx = x + dx, ny = y + dy;
            const n = inside(L, nx, ny) ? ny * L.W + nx : -1;
            if (n === p) return null; // a cannonball crate flattens the pirate
            if (n < 0 || boxes.has(n) || walls.has(n)) {
                if (n >= 0 && walls.has(n) && L.monsterAt.has(n)) hitMonster(L, L.monsterAt.get(n), walls);
                else if (n >= 0 && walls.has(n) && !L.gates.has(n)) walls.delete(n); // gates eat the crate
                boxes.delete(y * L.W + x);
                if (n >= 0 && boxes.has(n)) boxes.delete(n);
                if (!settlePlates(L, p, boxes, walls)) return null;
                break;
            }
            boxes.delete(y * L.W + x);
            x = nx; y = ny;
            boxes.add(y * L.W + x);
            if (!settlePlates(L, p, boxes, walls)) return null;
            if (!boxes.has(y * L.W + x)) break;   // a shutting gate squeezed the flying crate away
        }
    }
    return shots;
}

function gateOpenAfter(L, gate, p, boxes) {
    let open = true;
    for (const [plate, target] of L.plates) {
        if (target === gate) open = plate === p || boxes.has(plate);
    }
    return open;
}

// One move. Returns null if blocked, else { p, boxes, walls, pushed: [from, to] | null, shots }.
function step(L, s, dx, dy) {
    const px = s.p % L.W, py = Math.floor(s.p / L.W);
    const nx = px + dx, ny = py + dy;
    if (!inside(L, nx, ny)) return null;
    const n = ny * L.W + nx;
    if (s.walls.has(n) || L.cannons.has(n)) return null;
    const boxes = new Set(s.boxes), walls = new Set(s.walls);
    let pushed = null;
    if (boxes.has(n)) {
        const bx = nx + dx, by = ny + dy;
        if (!inside(L, bx, by)) return null;
        const b = by * L.W + bx;
        if (walls.has(b) || boxes.has(b) || L.cannons.has(b)) return null;
        boxes.delete(n);
        boxes.add(b);
        pushed = [n, b];
    }
    // Can't step (or push a crate) into a gate that this move will shut.
    for (const cell of pushed ? [n, pushed[1]] : [n]) {
        if (L.gates.has(cell) && !gateOpenAfter(L, cell, n, boxes)) return null;
    }
    const shots = settle(L, n, boxes, walls);
    if (!shots) return null; // the pirate was crushed or shot
    return { p: n, boxes, walls, pushed, shots };
}

function key(s) {
    return s.p + "|" + [...s.boxes].sort((a, b) => a - b).join(",") + "|" + [...s.walls].sort((a, b) => a - b).join(",");
}

function search(L, start) {
    const startKey = key(start);
    const parent = new Map([[startKey, null]]);
    const states = new Map([[startKey, start]]);
    let frontier = [startKey];
    let truncated = false;
    if (L.exits.has(start.p)) return { solvable: true, path: [] };
    while (frontier.length) {
        const next = [];
        for (const k of frontier) {
            const s = states.get(k);
            for (const [d, dx, dy] of DIRS) {
                const n = step(L, s, dx, dy);
                if (!n) continue;
                const nk = key(n);
                if (parent.has(nk)) continue;
                if (parent.size >= MAX_STATES) { truncated = true; continue; }
                parent.set(nk, [k, d]);
                if (L.exits.has(n.p)) {
                    const path = [];
                    let cur = nk;
                    while (parent.get(cur)) {
                        const [pk, pd] = parent.get(cur);
                        path.push(pd);
                        cur = pk;
                    }
                    return { solvable: true, path: path.reverse() };
                }
                states.set(nk, n);
                next.push(nk);
            }
            states.delete(k);
        }
        frontier = next;
    }
    return { solvable: false, truncated };
}

// Walks the solution and finds the first big step: a crate that comes to
// rest on a plate, a cannon shot, or the final run to the treasure.
function nextGoal(L, start, path) {
    const ids = new Map([...start.boxes].map(b => [b, b])); // where each crate is now -> where it started
    let s = start;
    const moves = path.map(d => DIRS.find(x => x[0] === d));
    let firstPush = null; // { crate, dest, done }: the first crate moved, and where it ends up
    for (let i = 0; i < moves.length; i++) {
        const [, dx, dy] = moves[i];
        const n = step(L, s, dx, dy);
        if (n.pushed) {
            const id = ids.get(n.pushed[0]);
            ids.delete(n.pushed[0]);
            ids.set(n.pushed[1], id);
            if (!firstPush) firstPush = { crate: id, dest: n.pushed[1], done: false };
            else if (!firstPush.done && firstPush.crate === id) firstPush.dest = n.pushed[1];
            else firstPush.done = true;
        }
        if (n.shots.length) {
            const shot = n.shots[0];
            return { kind: "fire", fuse: shot.fuse, cannon: shot.cannon, crate: ids.get(shot.crate), loaded: shot.crate === ids.get(shot.crate) };
        }
        if (n.pushed && L.plateCells.has(n.pushed[1])) {
            // Only count it if the crate stays there for the next move.
            const after = i + 1 < moves.length ? step(L, n, moves[i + 1][1], moves[i + 1][2]) : null;
            if (!after || !after.pushed || after.pushed[0] !== n.pushed[1]) {
                return { kind: "plate", plate: n.pushed[1], crate: ids.get(n.pushed[1]) };
            }
        }
        // Rebuild crate tracking after a shot destroyed crates.
        for (const b of [...ids.keys()]) if (!n.boxes.has(b)) ids.delete(b);
        s = n;
    }
    if (firstPush) return { kind: "push", crate: firstPush.crate, dest: firstPush.dest };
    return { kind: "exit", exit: s.p };
}

// If the board is somewhere along a stored solution (route), the rest of that
// route from here. Big levels ship one so hints work past MAX_STATES.
function routeFrom(L, level, current, route) {
    let s = { p: -1, boxes: new Set(), walls: new Set() };
    for (const t of level.tiles) {
        const i = t.y * L.W + t.x, type = t.type.toLowerCase();
        if (type === "player") s.p = i;
        else if (type === "box") s.boxes.add(i);
        else if (type === "wall") s.walls.add(i);
    }
    addMonsters(L, s.walls);
    if (s.p < 0 || !settle(L, s.p, s.boxes, s.walls)) return null;
    const want = key(current);
    for (let k = 0; k <= route.length; k++) {
        if (key(s) === want) return route.slice(k).split("");
        if (k === route.length) break;
        const d = DIRS.find(x => x[0] === route[k]);
        s = d && step(L, s, d[1], d[2]);
        if (!s) return null;
    }
    return null;
}

function analyse(level, board, route) {
    const L = prepare(level);
    const idx = ([x, y]) => y * L.W + x;
    const start = { p: idx(board.player), boxes: new Set(board.boxes.map(idx)), walls: new Set(board.walls.map(idx)) };
    // The board's walls include living monsters' squares; add their health left.
    MONSTERS.forEach((kind, m) => {
        const left = (board.health || {})[kind] || 0;
        for (let k = 1; k <= left; k++) start.walls.add(token(m, k));
    });
    const onRoute = route ? routeFrom(L, level, start, route) : null;
    const result = onRoute ? { solvable: true, path: onRoute } : search(L, start);
    if (!result.solvable) return { solvable: false, truncated: result.truncated };
    const cell = i => [i % L.W, Math.floor(i / L.W)];
    const goal = nextGoal(L, start, result.path);
    for (const k of ["fuse", "cannon", "crate", "plate", "exit", "dest"]) {
        if (goal[k] !== undefined) goal[k] = cell(goal[k]);
    }
    return { solvable: true, moves: result.path.length, nextMove: result.path[0], goal, onRoute: !!onRoute };
}

if (typeof self !== "undefined" && typeof window === "undefined") {
    self.onmessage = e => {
        const { id, level, board, route } = e.data;
        let result;
        try {
            result = analyse(level, board, route);
        } catch (err) {
            result = { error: String(err) };
        }
        self.postMessage({ id, ...result });
    };
}
