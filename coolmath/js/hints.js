// Hints, shared by the website's play page (play.js) and the standalone build.
//
// A Web Worker (solver.js) works out the answer, but only when the player asks.
// Finding out you've boxed yourself in is part of the puzzle, so the game never
// says "stuck" on its own; a hint that finds no way out says so.
//
// If the level comes with a stored solution (route), the worker follows it
// whenever the board is somewhere along that route, so hints work even on
// levels too big to solve in the browser. Off the route, it searches live.
(function (global) {
    "use strict";
    const ARROWS = { U: "↑ up", D: "↓ down", L: "← left", R: "→ right" };

    // opts: table, level, game, solverUrl, route (string or null), text (element
    // for messages), button (the hint button), stuck (the stuck banner),
    // exitWord ("treasure", "door"...), sound(name).
    function create(opts) {
        const { table, level, game, text, button, stuck } = opts;
        const sound = opts.sound || (() => {});
        const worker = global.Worker && opts.solverUrl ? new Worker(opts.solverUrl) : null;
        let version = 0;          // bumps every time the board settles
        let latest = null;        // solver answer for the current version
        let pendingVersion = null;
        let working = false;
        let hintLevel = 0;
        let requested = false;
        let used = 0;

        function ask() {
            if (!worker || game.won) return;
            if (working) { pendingVersion = version; return; }
            working = true;
            worker.postMessage({ id: version, level, board: game.getState(), route: opts.route || null });
        }

        if (worker) {
            worker.onmessage = e => {
                working = false;
                const result = e.data;
                if (result.id === version) {
                    latest = result;
                    if (requested) { requested = false; show(); }
                }
                if (pendingVersion !== null) { pendingVersion = null; ask(); }
            };
        }

        function clear() {
            table.querySelectorAll(".hint").forEach(td => td.classList.remove("hint"));
            text.textContent = "";
        }

        function mark(cells) {
            cells.filter(Boolean).forEach(([x, y]) => {
                const td = Blocked.getCell(table, x, y);
                if (td) td.classList.add("hint");
            });
        }

        // Call whenever the board comes to rest (after a move, undo or reset).
        function settled() {
            version++;
            latest = null;
            hintLevel = 0;
            clear();
            if (button) button.textContent = opts.buttonLabel || "Hint (H)";
            if (stuck) stuck.classList.add("hidden");
            if (requested) ask();
        }

        function show() {
            if (game.won) return;
            if (!worker) { text.textContent = "Hints need a newer browser."; return; }
            if (!latest) {
                requested = true;
                text.textContent = "Thinking…";
                ask();
                return;
            }
            clear();
            if (stuck) stuck.classList.add("hidden");
            if (latest.error) { text.textContent = "Couldn't work out a hint here."; return; }
            if (!latest.solvable) {
                if (latest.truncated) {
                    text.textContent = "This one's too big for me to see the whole way through from here. Try undoing back to a spot you were sure of.";
                } else {
                    sound("stuck");
                    if (stuck) stuck.classList.remove("hidden");
                    else text.textContent = "There's no way out from here. Undo (Z) or restart (R).";
                }
                return;
            }
            used++;
            sound("hint");
            const g = latest.goal;
            if (hintLevel === 0) {
                if (g.kind === "plate") {
                    mark([g.plate, g.crate]);
                    text.textContent = "Next goal: rest the marked crate on the marked plate.";
                } else if (g.kind === "fire") {
                    mark([g.fuse, g.cannon, g.crate]);
                    text.textContent = g.loaded
                        ? "Next goal: light the marked fuse to fire its cannon."
                        : "Next goal: line the marked crate up in front of the cannon, then light the fuse.";
                } else if (g.kind === "push") {
                    mark([g.crate, g.dest]);
                    text.textContent = "Next goal: shift the marked crate to the other marked spot.";
                } else {
                    mark([g.exit]);
                    text.textContent = `The way is clear. Head for the ${opts.exitWord || "treasure"}!`;
                }
                hintLevel = 1;
                if (button) button.textContent = "Show next move";
            } else {
                const [px, py] = game.getState().player;
                mark([[px, py]]);
                text.textContent = `Next move: ${ARROWS[latest.nextMove]}. (${latest.moves} moves left on ${latest.onRoute ? "this route" : "the best route"}.)`;
            }
        }

        return {
            settled,
            show,
            clear,
            get used() { return used; },
            destroy() { if (worker) worker.terminate(); },
        };
    }

    global.BlockedHints = { create };
})(window);
