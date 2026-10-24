// Blocked game engine: builds a board from level data, draws tiles, and runs
// the puzzle rules. The rules (move, checkPressurePlates, fireFuse/flyStep) are
// the original play.js logic, scoped to one board so the level editor's playtest
// can reuse them.
//
// A level looks like:
//   { width, height, tiles: [{ type, x, y, direction, aX, aY }, ...] }
// type is one of: player, wall, box, pressureplate, cannon, fuse, exit, kraken, hull, water.
// Water blocks the pirate and crates like a wall, but a shot crate flies over it.
// Plates and fuses point at the tile they control with aX/aY. A kraken or hull
// tile keeps its health in aX: all of one kind share one health pool.
(function (global) {
    "use strict";

    // ========== Building and drawing ==========
    function getCell(table, x, y) {
        if (!Number.isInteger(x) || !Number.isInteger(y)) return null;
        return table.querySelector(`.y${y} .x${x}`);
    }

    function targetOf(table, cell) {
        if (cell.dataset.targetX === undefined) return null;
        return getCell(table, parseInt(cell.dataset.targetX), parseInt(cell.dataset.targetY));
    }

    function buildBoard(table, level) {
        table.innerHTML = "";
        // A square can hold two tiles: a plate or fuse with a crate or the
        // pirate starting on top of it.
        const tiles = {}, health = {};
        (level.tiles || []).forEach(t => { (tiles[t.x + "," + t.y] = tiles[t.x + "," + t.y] || []).push(t); });

        for (let y = 0; y < level.height; y++) {
            const tr = document.createElement("tr");
            tr.className = "y" + y;
            for (let x = 0; x < level.width; x++) {
                const td = document.createElement("td");
                td.className = "x" + x;
                td.dataset.x = x;
                td.dataset.y = y;
                for (const t of tiles[x + "," + y] || []) {
                    const type = t.type.toLowerCase();
                    td.classList.add(type);
                    if ((type === "pressureplate" || type === "fuse") && t.aX != null && t.aY != null) {
                        td.dataset.targetX = t.aX;
                        td.dataset.targetY = t.aY;
                    }
                    if (type === "cannon") td.dataset.direction = t.direction || "up";
                    if (type === "water") td.classList.add("wall");
                    if (MONSTERS[type]) {
                        td.classList.add("wall");    // blocks like a wall while it lives
                        health[type] = Math.max(health[type] || 0, t.aX || 3);
                    }
                }
                tr.appendChild(td);
            }
            table.appendChild(tr);
        }
        // Each monster's health is kept on its squares (so undo snapshots keep it too).
        Object.keys(health).forEach(kind => {
            const cells = Array.from(table.querySelectorAll("td." + kind));
            cells.forEach(td => { td.dataset.hp = health[kind]; td.dataset.maxHp = health[kind]; });
            // The kraken gets an eye or two along its top row.
            if (kind === "kraken") cells.filter((td, k) => td.dataset.y === cells[0].dataset.y && k % 3 === 1 || cells.length < 3 && k === 0)
                .forEach(td => { td.dataset.eye = "1"; });
        });
        renderHealth(table);

        // Whatever a plate controls is drawn as a gate.
        table.querySelectorAll(".pressureplate").forEach(pp => {
            const target = targetOf(table, pp);
            if (target && !target.classList.contains("cannon")) target.dataset.door = "1";
        });
        table.querySelectorAll("td").forEach(renderCell);
    }

    // ========== Monsters: the kraken, and an enemy ship's hull ==========
    // Their squares block like walls. Every crate shot into one costs that monster
    // one health (the crate is gone); with none left, all of its squares vanish.
    // The same rule is in solver.js and solver.py (MONSTERS).
    const MONSTERS = { kraken: "Kraken", hull: "Enemy ship" };

    function monsterHealth(table, kind) {
        const cell = table.querySelector(`td.${kind}.wall`);
        return cell ? parseInt(cell.dataset.hp) : 0;
    }

    // A health bar for each monster, in a strip above the board (outside the camera's
    // window, so it never scrolls away). Health lives on the squares, so redrawing from
    // them is always right, after undo and restart too.
    function renderHealth(table) {
        const frame = table.closest(".board-frame");
        if (!frame) return;
        let strip = frame.querySelector(":scope > .health");
        const bars = Object.keys(MONSTERS).map(kind => {
            const first = table.querySelector("td." + kind);
            if (!first) return "";
            const max = parseInt(first.dataset.maxHp), hp = monsterHealth(table, kind);
            const pips = Array.from({ length: max }, (_, k) => `<i class="pip${k < hp ? "" : " spent"}"></i>`).join("");
            return `<span class="health-bar ${kind}${hp ? "" : " beaten"}"><b>${MONSTERS[kind]}</b>${pips}</span>`;
        }).join("");
        if (!bars) { if (strip) strip.remove(); return; }
        if (!strip) {
            strip = document.createElement("div");
            strip.className = "health";
            frame.prepend(strip);
        }
        strip.innerHTML = bars;
    }

    // A crate hit this monster: one less health, and with none left it's beaten.
    function hitMonster(table, kind, emit) {
        const cells = Array.from(table.querySelectorAll(`td.${kind}.wall`));
        const hp = parseInt(cells[0].dataset.hp) - 1;
        cells.forEach(td => { td.dataset.hp = hp; });
        if (hp <= 0) {
            cells.forEach(td => { td.classList.remove("wall"); renderCell(td); flash(td); });
            if (emit) emit("smash");
        }
        renderHealth(table);
        return hp;
    }

    // Mid-chapter rooms end at a door (an exit in the outer wall) or a trapdoor
    // (an exit inside the room); the treasure chest is for a chapter's last room.
    // The page says which by setting data-exit-style="door" on the board table.
    function exitSprite(cell) {
        const table = cell.closest("table");
        if (!table || table.dataset.exitStyle !== "door") return "chest";
        const x = parseInt(cell.dataset.x), y = parseInt(cell.dataset.y);
        const rows = table.rows.length, cols = table.rows[0].cells.length;
        return x === 0 || y === 0 || x === cols - 1 || y === rows - 1 ? "door goal" : "hatch goal";
    }

    // Draws a cell from its classes: a floor-level layer (plate, fuse, chest,
    // open gate) and an object layer on top (pirate, crate, wall, cannon).
    function renderCell(cell) {
        const c = cell.classList;
        const weighed = c.contains("player") || c.contains("box");

        let base = "";
        if (c.contains("pressureplate")) base = weighed ? "plate pressed" : "plate";
        else if (c.contains("fuse")) base = weighed ? "fuse lit" : "fuse";
        else if (c.contains("exit")) base = exitSprite(cell);
        else if (c.contains("water")) base = "water";
        else if (cell.dataset.door) base = "gate-open";

        let obj = "";
        if (c.contains("player")) obj = "pirate";
        else if (c.contains("box")) obj = c.contains("pressureplate") ? "crate weighing" : "crate";
        else if (c.contains("kraken") && c.contains("wall")) obj = cell.dataset.eye ? "kraken-eye" : "kraken";
        else if (c.contains("hull") && c.contains("wall")) obj = "hull";
        else if ((c.contains("wall") && !c.contains("water")) || c.contains("nopass")) obj = cell.dataset.door ? "gate" : "wall";
        else if (c.contains("cannon")) obj = "cannon " + (cell.dataset.direction || "up");

        cell.innerHTML = (base ? `<i class="sp ${base}"></i>` : "") + (obj ? `<i class="sp ${obj}"></i>` : "");
    }

    // ========== Rules ==========
    // Would this gate be open once a move finishes? playerAt is where the
    // pirate ends up, and boxFrom/boxTo describe a crate being pushed (or null).
    // Like checkPressurePlates, the last plate (in reading order) that
    // controls a gate decides it.
    function gateOpenAfter(table, gate, playerAt, boxFrom, boxTo) {
        let open = true;
        table.querySelectorAll(".pressureplate").forEach(pp => {
            if (targetOf(table, pp) !== gate) return;
            const hasBox = pp === boxTo || (pp.classList.contains("box") && pp !== boxFrom);
            open = pp === playerAt || hasBox;
        });
        return open;
    }

    // Where a crate goes when a gate shuts on it: the first free square in
    // rings around the gate (radius 1, 2, ...), each ring read from its
    // top-right corner, right to left, top to bottom. Free means a crate could
    // be pushed there: not a wall, shut gate, crate, cannon or the pirate.
    function squeezeSpot(table, gate) {
        const gx = parseInt(gate.dataset.x), gy = parseInt(gate.dataset.y);
        const rows = table.rows.length, cols = table.rows[0].cells.length;
        for (let r = 1; r < Math.max(rows, cols); r++) {
            for (let y = gy - r; y <= gy + r; y++) {
                for (let x = gx + r; x >= gx - r; x--) {
                    if (Math.max(Math.abs(x - gx), Math.abs(y - gy)) !== r) continue;
                    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
                    const c = getCell(table, x, y).classList;
                    if (!c.contains("wall") && !c.contains("nopass") && !c.contains("box") && !c.contains("cannon") && !c.contains("player")) {
                        return getCell(table, x, y);
                    }
                }
            }
        }
        return null;
    }

    // emit(name), if given, is told about plates and gates changing (for sound).
    // Returns true if a gate shut on the pirate (the caller restarts the level).
    function checkPressurePlates(table, emit) {
        const plates = Array.from(table.querySelectorAll(".pressureplate"));
        // When several plates point at one gate, the last one (in reading order) decides.
        const decider = new Map();
        plates.forEach(pp => {
            const t = targetOf(table, pp);
            if (t && !t.classList.contains("cannon")) decider.set(t, pp);
        });
        let crushed = false;
        // A gate that shuts on a crate squeezes it out; if that lands it on
        // another plate, the plates are checked again.
        for (let pass = 0; pass < 10 && !crushed; pass++) {
            let squeezed = false;
            for (const pp of plates) {
                const gate = targetOf(table, pp);
                if (!gate || decider.get(gate) !== pp) continue;
                const pressed = pp.classList.contains("player") || pp.classList.contains("box");
                const wasShut = gate.classList.contains("wall");
                if (pressed) {
                    gate.classList.remove("nopass", "wall");
                } else if (!wasShut) {
                    if (gate.classList.contains("player")) { crushed = true; break; }
                    if (gate.classList.contains("box")) {
                        gate.classList.remove("box");
                        const spot = squeezeSpot(table, gate);
                        if (spot) {
                            spot.classList.add("box");
                            renderCell(spot);
                            flash(spot);
                        }
                        if (emit) emit("crash");
                        squeezed = true;
                    }
                    gate.classList.add("nopass", "wall");
                }
                const isShut = gate.classList.contains("wall");
                if (emit && isShut !== wasShut) emit(isShut ? "gateClose" : "gateOpen");
                renderCell(gate);
            }
            if (!squeezed) break;
        }
        plates.forEach(pp => {
            const pressed = pp.classList.contains("player") || pp.classList.contains("box");
            if (emit && pressed !== (pp.dataset.pressed === "1")) emit(pressed ? "plate" : "plateUp");
            pp.dataset.pressed = pressed ? "1" : "0";
        });
        return crushed;
    }

    // ========== Cannon shots, in real time ==========
    // A shot crate flies one tile every SHOT_MS while the pirate keeps moving.
    // After every tile the plates are checked again, so a gate shuts the moment
    // its crate is shot off the plate. A crate in flight is marked with
    // data-fly="dx,dy" on its square (so it survives undo snapshots); it can't
    // be pushed, doesn't light fuses, and isn't fired again.
    const SHOT_MS = 50;
    const DIR = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
    const restingBox = c => c && c.classList.contains("box") && !c.dataset.fly;

    // If this fuse is lit, fire its cannon: returns the crate square now in flight (or null).
    function fireFuse(table, fuse, emit) {
        if (!(fuse.classList.contains("player") || restingBox(fuse))) return null;
        const cannon = targetOf(table, fuse);
        if (!cannon || !cannon.classList.contains("cannon")) return null;
        const [dx, dy] = DIR[cannon.dataset.direction] || DIR.up;
        const crate = getCell(table, parseInt(fuse.dataset.targetX) + dx, parseInt(fuse.dataset.targetY) + dy);
        if (!restingBox(crate)) return null;
        if (emit) emit("fire");
        cannon.classList.add("firing");
        setTimeout(() => cannon.classList.remove("firing"), 250);
        crate.dataset.fly = dx + "," + dy;
        return crate;
    }

    // Moves one flying crate a tile. Returns "hit" if it struck the pirate.
    function flyStep(table, crate, emit) {
        const [dx, dy] = crate.dataset.fly.split(",").map(Number);
        const next = getCell(table, parseInt(crate.dataset.x) + dx, parseInt(crate.dataset.y) + dy);
        if (next && next.classList.contains("player")) {
            // A cannonball crate flattens the pirate.
            crate.classList.remove("box");
            delete crate.dataset.fly;
            renderCell(crate);
            flash(crate);
            if (emit) emit("crash");
            return "hit";
        }
        const blocked = c => c.classList.contains("box") || c.classList.contains("nopass") || (c.classList.contains("wall") && !c.classList.contains("water"));
        if (!next || blocked(next)) {
            // Cannon fire smashes walls, but a shut gate just eats the crate.
            // A monster loses a health instead.
            const monster = next && next.classList.contains("wall") && Object.keys(MONSTERS).find(k => next.classList.contains(k));
            if (monster) {
                hitMonster(table, monster, emit);
                flash(next);
                if (emit) emit("crash");
            } else if (next && next.classList.contains("wall") && !next.dataset.door) {
                next.classList.remove("wall", "nopass");
                renderCell(next);
                flash(next);
                if (emit) emit("smash");
            } else if (emit) {
                emit("crash");
            }
            crate.classList.remove("box");
            delete crate.dataset.fly;
            renderCell(crate);
            flash(crate);
            if (next && next.classList.contains("box")) {
                next.classList.remove("box");
                delete next.dataset.fly;
                renderCell(next);
            }
            return "landed";
        }
        const fly = crate.dataset.fly;
        crate.classList.remove("box");
        delete crate.dataset.fly;
        renderCell(crate);
        next.classList.add("box");
        next.dataset.fly = fly;
        renderCell(next);
        return "moved";
    }

    function flash(cell) {
        cell.classList.remove("smash");
        void cell.offsetWidth; // restart the animation
        cell.classList.add("smash");
        setTimeout(() => cell.classList.remove("smash"), 400);
    }

    // ========== A running game ==========
    // opts.onUpdate({ moves, ms }) is called after every move and each tick.
    // opts.onWin({ moves, ms }) is called once when the pirate reaches a chest.
    // opts.onSettle() is called whenever the board comes to rest (after a
    // move's cannon shots finish, an undo, or a reset).
    function startGame(table, level, opts = {}) {
        buildBoard(table, level);
        if (!table.querySelector(".player")) return null;

        const rows = level.height;
        const cols = level.width;
        const initialBoardHTML = table.innerHTML;

        let playerCell, playerx, playery;
        let moveCount = 0;
        let startTime = null;
        let timerInterval = null;
        let won = false;
        let dead = false;
        let generation = 0;
        let history = [];    // board snapshots for undo
        let shotTimer = null;    // ticks the flying crates along
        let pendingFuses = [];   // fuses still to check after the shot in the air lands

        function findPlayer() {
            playerCell = table.querySelector(".player");
            playerx = parseInt(playerCell.dataset.x);
            playery = parseInt(playerCell.dataset.y);
        }

        function elapsed() {
            return startTime ? Date.now() - startTime : 0;
        }

        function updateHUD() {
            if (opts.onUpdate) opts.onUpdate({ moves: moveCount, ms: elapsed() });
        }

        function startTimer() {
            if (!startTime) {
                startTime = Date.now();
                timerInterval = setInterval(updateHUD, 100);
            }
        }

        function stopTimer() {
            if (timerInterval) {
                clearInterval(timerInterval);
                timerInterval = null;
            }
            updateHUD();
        }

        function cell(x, y) {
            if (x < 0 || y < 0 || x >= cols || y >= rows) return null;
            return getCell(table, x, y);
        }

        const sound = name => { if (opts.onSound) opts.onSound(name); };
        const flying = () => Array.from(table.querySelectorAll("td[data-fly]"));

        // After every move: plates first, then each fuse in turn. Fuses wait
        // their turn while a shot is in the air, the same order the solver uses.
        function runChecks(silent = false) {
            const emit = silent ? null : sound;
            if (checkPressurePlates(table, emit)) {
                sound("gateClose");
                die("crushed");
                return;
            }
            pendingFuses = Array.from(table.querySelectorAll(".fuse"));
            nextShot(emit);
        }

        // Fires the next lit fuse if nothing is in the air, or tells the page the board has settled.
        function nextShot(emit = sound) {
            while (!flying().length && pendingFuses.length) {
                if (fireFuse(table, pendingFuses.shift(), emit)) break;
            }
            if (flying().length) {
                if (!shotTimer) shotTimer = setInterval(tick, SHOT_MS);
            } else {
                stopFlights();
                settled();
            }
        }

        // One tile of flight for every crate in the air; the plates react after each tile.
        function tick() {
            if (won || dead) { stopFlights(); return; }
            for (const crate of flying()) {
                if (!crate.dataset.fly) continue;
                if (flyStep(table, crate, sound) === "hit") { die("shot"); return; }
                if (checkPressurePlates(table, sound)) { sound("gateClose"); die("crushed"); return; }
            }
            // A gate that shut on a flying crate squeezed it away: it's not flying any more.
            table.querySelectorAll("td[data-fly]").forEach(td => { if (!td.classList.contains("box")) delete td.dataset.fly; });
            if (!flying().length) nextShot();
        }

        // Tells the page the board is at rest. Always a moment later (never in the
        // middle of a move or of startGame), so the page has finished setting up.
        function settled() {
            const gen = generation;
            Promise.resolve().then(() => { if (gen === generation && opts.onSettle) opts.onSettle(); });
        }

        function stopFlights() {
            if (shotTimer) clearInterval(shotTimer);
            shotTimer = null;
        }

        // The pirate was crushed by a gate or hit by a cannon shot: back to the start.
        function die(how) {
            const gen = generation;
            dead = true;
            stopFlights();
            pendingFuses = [];
            flash(playerCell);
            sound("stuck");
            if (opts.onDeath) opts.onDeath(how);
            setTimeout(() => { if (gen === generation) resetLevel(); }, 900);
        }

        function cleanBoard() {
            table.querySelectorAll(".smash, .firing, .highlight, .hint").forEach(td =>
                td.classList.remove("smash", "firing", "highlight", "hint"));
        }

        function resetLevel() {
            generation++;
            stopFlights();
            pendingFuses = [];
            dead = false;
            table.innerHTML = initialBoardHTML;
            findPlayer();

            moveCount = 0;
            startTime = null;
            if (timerInterval) clearInterval(timerInterval);
            timerInterval = null;
            won = false;
            history = [];

            table.querySelectorAll("td").forEach(renderCell);
            renderHealth(table);
            runChecks(true);
            updateHUD();
            follow(table, true);
        }

        // Takes back one move (shots that were in the air then carry on). The timer keeps running.
        function undo() {
            if (won || dead || !history.length) return false;
            const snap = history.pop();
            generation++;
            stopFlights();
            pendingFuses = [];
            table.innerHTML = snap.html;
            cleanBoard();
            findPlayer();
            moveCount = snap.moves;
            renderHealth(table);
            follow(table, true);
            sound("undo");
            updateHUD();
            nextShot();
            return true;
        }

        // The board as plain data, for the solver.
        function getState() {
            const walls = [], boxes = [];
            table.querySelectorAll("td").forEach(td => {
                const x = parseInt(td.dataset.x), y = parseInt(td.dataset.y);
                if (td.classList.contains("wall") || td.classList.contains("nopass")) walls.push([x, y]);
                if (td.classList.contains("box")) boxes.push([x, y]);
            });
            const health = {};
            Object.keys(MONSTERS).forEach(kind => { health[kind] = monsterHealth(table, kind); });
            return { player: [playerx, playery], boxes, walls, health };
        }

        // Moves are never held back: you can keep moving while a shot is in the air.
        function move(dx, dy) {
            if (won || dead) return;
            if (!tryMove(dx, dy)) sound("bump");
        }

        // Returns false if the move is blocked.
        function tryMove(dx, dy) {
            const nextCell = cell(playerx + dx, playery + dy);
            if (!nextCell) return false;

            if (nextCell.classList.contains("wall") || nextCell.classList.contains("nopass") || nextCell.classList.contains("cannon")) return false;

            const nextNextCell = cell(playerx + 2 * dx, playery + 2 * dy);
            const before = table.innerHTML;

            const pushing = nextCell.classList.contains("box");
            if (pushing && nextCell.dataset.fly) return false;   // can't push a crate in flight
            if (pushing) {
                if (!nextNextCell || nextNextCell.classList.contains("wall") || nextNextCell.classList.contains("nopass") || nextNextCell.classList.contains("box") || nextNextCell.classList.contains("cannon")) return false;
            }

            // You can't slip into a gate that this very move will shut, like
            // stepping off a plate into its own gate. Same for a pushed crate.
            const boxFrom = pushing ? nextCell : null;
            const boxTo = pushing ? nextNextCell : null;
            if (nextCell.dataset.door && !gateOpenAfter(table, nextCell, nextCell, boxFrom, boxTo)) return false;
            if (pushing && nextNextCell.dataset.door && !gateOpenAfter(table, nextNextCell, nextCell, boxFrom, boxTo)) return false;

            if (pushing) {
                nextCell.classList.remove("box");
                renderCell(nextCell);

                nextNextCell.classList.add("box");
                renderCell(nextNextCell);
            }

            if (!startTime) startTimer();
            history.push({ html: before, moves: moveCount });
            moveCount++;

            playerCell.classList.remove("player");
            renderCell(playerCell);

            playerx += dx;
            playery += dy;

            playerCell = cell(playerx, playery);
            playerCell.classList.add("player");
            renderCell(playerCell);
            faceDirection(dx);
            follow(table);
            sound(pushing ? "push" : "step");

            runChecks();
            updateHUD();

            if (playerCell.classList.contains("exit")) {
                won = true;
                stopTimer();
                if (opts.onWin) opts.onWin({ moves: moveCount, ms: elapsed() });
            }
            return true;
        }

        let facingLeft = false;
        function faceDirection(dx) {
            if (dx) facingLeft = dx < 0;
            const sprite = playerCell.querySelector(".pirate");
            if (sprite) sprite.classList.toggle("flip", facingLeft);
        }

        // ============================ Controls ============================
        const KEYS = {
            ArrowRight: [1, 0], d: [1, 0], D: [1, 0],
            ArrowLeft: [-1, 0], a: [-1, 0], A: [-1, 0],
            ArrowUp: [0, -1], w: [0, -1], W: [0, -1],
            ArrowDown: [0, 1], s: [0, 1], S: [0, 1],
        };

        function onKey(event) {
            const t = event.target;
            if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
            if (event.ctrlKey || event.metaKey || event.altKey) return;
            if (KEYS[event.key]) {
                event.preventDefault();
                move(...KEYS[event.key]);
            } else if (event.key === "r" || event.key === "R") {
                sound("reset");
                resetLevel(); // RESET LEVEL
            } else if (event.key === "z" || event.key === "Z" || event.key === "Backspace") {
                event.preventDefault();
                undo();
            }
        }
        document.addEventListener("keydown", onKey);

        // Hovering a plate or fuse highlights what it controls (and the other way
        // round, below). Listening on
        // the table means this survives resets that replace the board's HTML.
        function clearHighlights() {
            table.querySelectorAll(".highlight").forEach(td => td.classList.remove("highlight"));
        }
        // Hovering a cannon or a gate (shut, a gate looks like a wall)
        // highlights the plates or fuses that work it.
        function onHover(event) {
            clearHighlights();
            const td = event.target.closest("td");
            if (!td) return;
            if (td.classList.contains("pressureplate") || td.classList.contains("fuse")) {
                const targetCell = targetOf(table, td);
                if (targetCell) targetCell.classList.add("highlight");
            } else if (td.dataset.door || td.classList.contains("cannon")) {
                table.querySelectorAll(".pressureplate, .fuse").forEach(source => {
                    if (targetOf(table, source) === td) source.classList.add("highlight");
                });
            }
        }
        table.addEventListener("mouseover", onHover);
        table.addEventListener("mouseleave", clearHighlights);

        // ============================ Initialize ============================
        findPlayer();
        runChecks(true);
        updateHUD();
        requestAnimationFrame(() => follow(table, true));

        return {
            move,
            undo,
            getState,
            reset() { sound("reset"); resetLevel(); },
            get won() { return won; },
            get busy() { return !!shotTimer || pendingFuses.length > 0; },   // a shot is in the air
            get canUndo() { return history.length > 0 && !won; },
            destroy() {
                generation++;
                stopFlights();
                if (timerInterval) clearInterval(timerInterval);
                document.removeEventListener("keydown", onKey);
                table.removeEventListener("mouseover", onHover);
                table.removeEventListener("mouseleave", clearHighlights);
            },
        };
    }

    // Draws a level without playing it (thumbnails and the editor), with
    // gates shut the way they start in game.
    function drawLevel(table, level) {
        buildBoard(table, level);
        checkPressurePlates(table);
    }

    // Picks a tile size so a width x height board fits in the given space.
    function fitTile(width, height, maxW, maxH, min = 12, max = 56) {
        const size = Math.floor(Math.min(maxW / width, maxH / height));
        return Math.max(min, Math.min(max, size));
    }

    // ========== Big boards: the camera ==========
    // A board that would need tiles smaller than CAMERA_MIN to fit gets CAMERA_TILE
    // tiles instead, inside a window (.board-wrap.camera) that follows the pirate.
    // maxW/maxH are the space the page has for the board.
    const CAMERA_MIN = 26, CAMERA_TILE = 30;

    // ========== Wide levels built as a row of rooms: one room at a time ==========
    // A level at least ROOMS_MIN_WIDTH wide whose rooms are split by solid wall columns
    // (a doorway or gate allowed) is shown a room at a time, zoomed in. Walking through a
    // door slides the view to the next room; walking back slides it back.
    const ROOMS_MIN_WIDTH = 24, ROOM_MIN = 5;
    function roomsOf(table) {
        const rows = table.rows.length, cols = rows ? table.rows[0].cells.length : 0;
        if (cols < ROOMS_MIN_WIDTH) return null;
        const solid = c => c.classList.contains("wall") || c.classList.contains("nopass") || c.classList.contains("cannon");
        const dividers = [0];
        for (let x = 1; x < cols - 1; x++) {
            let open = 0;
            for (let y = 0; y < rows; y++) if (!solid(table.rows[y].cells[x])) open++;
            if (open <= 1) dividers.push(x);   // a wall with at most one doorway
        }
        dividers.push(cols - 1);
        const rooms = [];
        for (let i = 0; i + 1 < dividers.length; i++) {
            const from = dividers[i], to = dividers[i + 1];
            const last = rooms[rooms.length - 1];
            if (to - from < 2) { if (last) last.to = to; continue; }   // two walls side by side
            if (last && to - from + 1 < ROOM_MIN) { last.to = to; continue; }   // too narrow to be a room: join the one before
            rooms.push({ from, to });
        }
        return rooms.length >= 2 ? rooms : null;
    }

    function fitBoard(table, width, height, maxW, maxH, min = 14, max = 72) {
        const wrap = table.closest(".board-wrap");
        const strip = table.closest(".board-frame") && table.closest(".board-frame").querySelector(":scope > .health");
        const capH = strip ? strip.offsetHeight + 6 : 0;
        let size = fitTile(width, height, maxW, maxH - capH, 1, max);
        // A row of rooms: show the widest room whole, if that makes the tiles a good deal bigger.
        const rooms = wrap && roomsOf(table);
        const roomW = rooms ? Math.max(...rooms.map(r => r.to - r.from + 1)) : 0;
        const roomSize = rooms ? fitTile(roomW, height, maxW, maxH - capH, 1, max) : 0;
        const byRoom = !!rooms && roomSize >= size * 1.25;
        table._rooms = byRoom ? rooms : null;
        table._room = null;
        const camera = !!wrap && (byRoom || size < CAMERA_MIN);
        size = byRoom ? roomSize : camera ? CAMERA_TILE : Math.max(min, size);
        table.style.setProperty("--tile", size + "px");
        if (wrap) {
            wrap.classList.toggle("camera", camera);
            wrap.classList.toggle("rooms", byRoom);
            wrap.style.width = camera ? Math.min(maxW, (byRoom ? roomW : width) * size) + "px" : "";
            wrap.style.height = camera ? Math.min(maxH - capH, height * size) + "px" : "";
        }
        follow(table, true);
        return size;
    }

    // Keeps the pirate in view: in the middle of the camera's window, or (a row of
    // rooms) the room the pirate is in. In a doorway the view stays where it was.
    function follow(table, instant = false) {
        const wrap = table.closest(".board-wrap.camera");
        const p = wrap && table.querySelector("td.player");
        if (!p) return;
        const y = table.offsetTop + p.offsetTop + p.offsetHeight / 2;
        let x = table.offsetLeft + p.offsetLeft + p.offsetWidth / 2;
        const rooms = table._rooms;
        if (rooms) {
            const px = parseInt(p.dataset.x);
            const inside = r => px > r.from && px < r.to;
            let room = rooms.find(inside) || table._room || rooms.find(r => px >= r.from && px <= r.to);
            if (table._room && !inside(table._room) && !rooms.some(inside)) room = table._room;
            table._room = room;
            const first = table.rows[0].cells[room.from], last = table.rows[0].cells[room.to];
            x = table.offsetLeft + (first.offsetLeft + last.offsetLeft + last.offsetWidth) / 2;
        }
        wrap.scrollTo({ left: x - wrap.clientWidth / 2, top: y - wrap.clientHeight / 2, behavior: instant ? "auto" : "smooth" });
    }

    global.Blocked = { startGame, drawLevel, buildBoard, renderCell, getCell, fitTile, fitBoard, follow };
})(window);
