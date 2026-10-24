// Play page: runs the level, shows the HUD, and saves the result on a win.
document.addEventListener("DOMContentLoaded", function () {
    const data = JSON.parse(document.getElementById("levelData").textContent);
    const level = data.level;
    const table = document.getElementById("gameBoard");

    const $ = id => document.getElementById(id);
    const moveDisplay = $("moveCount");
    const timeDisplay = $("timeElapsed");
    const winModal = $("winModal");

    function formatTime(ms) {
        if (ms == null) return "-";
        const s = ms / 1000;
        if (s < 60) return s.toFixed(1) + "s";
        return Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0");
    }

    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text;
        return div.innerHTML;
    }

    // ========== Sidebar ==========
    function showStats(stats) {
        const rows = [["Times cleared", stats.count]];
        if (stats.count > 0) {
            rows.push(
                ["Best time", formatTime(stats.best_ms)],
                ["Fewest moves", stats.best_moves],
                ["Average time", formatTime(stats.avg_ms)],
                ["Average moves", stats.avg_moves.toFixed(1)]
            );
        }
        $("myStats").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")
            + (stats.count === 0 ? `<dd style="grid-column: 1 / -1; text-align: left; font-weight: 400">You haven't cleared this one yet.</dd>` : "");
    }

    function showLeaderboard(rows) {
        if (!rows.length) {
            $("leaderboard").innerHTML = "<p class='muted'>No one has cleared this yet. Be the first!</p>";
            return;
        }
        $("leaderboard").innerHTML = `
            <table class="board-table">
                <thead><tr><th>#</th><th>Sailor</th><th class="num">Time</th><th class="num">Moves</th></tr></thead>
                <tbody>${rows.map((r, i) => `
                    <tr class="${r.username === window.CURRENT_USER ? "me" : ""}">
                        <td>${i + 1}</td><td>${escapeHtml(r.username)}</td>
                        <td class="num">${formatTime(r.best_ms)}</td><td class="num">${r.best_moves}</td>
                    </tr>`).join("")}
                </tbody>
            </table>`;
    }

    showStats(data.stats);
    showLeaderboard(data.leaderboard);

    // ========== Board size ==========
    // Size tiles so the board and everything under it fit on screen without
    // scrolling (as long as the level isn't enormous).
    function fitBoard() {
        const area = document.querySelector(".board-area");
        const frame = document.querySelector(".board-frame");
        const top = frame.getBoundingClientRect().top + window.scrollY;
        let below = 0;
        for (let el = frame.nextElementSibling; el; el = el.nextElementSibling) {
            if (el.offsetParent) below += el.offsetHeight + 16;
        }
        const maxW = area.clientWidth - 40;
        const maxH = window.innerHeight - top - below - 48;
        const size = Blocked.fitTile(level.width, level.height, maxW, Math.max(maxH, 200), 20, 72);
        table.style.setProperty("--tile", size + "px");
    }
    fitBoard();
    window.addEventListener("resize", fitBoard);

    // ========== Game ==========
    table.dataset.exitStyle = data.exitStyle || "chest";
    const game = Blocked.startGame(table, level, {
        onUpdate({ moves, ms }) {
            moveDisplay.textContent = moves;
            timeDisplay.textContent = formatTime(ms);
        },
        onWin: showWin,
        onSettle: boardSettled,
        onSound: name => BlockedSound.play(name),
        onDeath: how => {
            $("hintText").textContent = how === "shot"
                ? "Blasted by your own cannon! Back to the start you go."
                : "Crushed by a gate! Back to the start you go.";
        },
    });

    if (!game) {
        $("noPlayer").classList.remove("hidden");
        return;
    }

    // ========== Hints (shared with the standalone build: hints.js) ==========
    const hints = BlockedHints.create({
        table, level, game,
        solverUrl: table.dataset.solver,
        route: data.route,
        text: $("hintText"),
        button: $("hintBtn"),
        stuck: $("stuckBanner"),
        exitWord: data.exitStyle === "door" ? "way out" : "treasure",
        sound: name => BlockedSound.play(name),
        buttonLabel: "Hint",
    });
    const showHint = () => hints.show();
    const clearHint = () => hints.clear();

    function boardSettled() {
        hints.settled();
        $("undoBtn").disabled = !game || !game.canUndo;
    }

    $("hintBtn").addEventListener("click", () => { showHint(); $("hintBtn").blur(); });
    $("undoBtn").addEventListener("click", () => { game.undo(); $("undoBtn").blur(); });
    document.addEventListener("keydown", e => {
        if ((e.key === "h" || e.key === "H") && winModal.classList.contains("hidden")) showHint();
    });

    // ========== Winning ==========
    // Mid-chapter rooms (when you're playing through the chapter) skip the win
    // popup: a quick tally, a fade to dark, and the next room fades in. Boss
    // rooms, the last room, replays from the home page, and players who switch
    // "Walk straight on" off get the full popup.
    let saving = Promise.resolve(null);   // this run's save; moving on waits for it
    let leaving = false;
    let walkOnWanted = true;
    try { walkOnWanted = localStorage.getItem("blocked-autoadvance") !== "off"; } catch (e) { /* storage blocked */ }
    if ($("autoAdvance")) {
        $("autoAdvance").checked = walkOnWanted;
        $("autoAdvance").addEventListener("change", e => {
            walkOnWanted = e.target.checked;
            try { localStorage.setItem("blocked-autoadvance", walkOnWanted ? "on" : "off"); } catch (err) { /* storage blocked */ }
            e.target.blur();
        });
    }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

    function saveRun(moves, ms) {
        return (async () => {
            try {
                const res = await fetch(data.completeUrl, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ moves, time_ms: ms }),
                });
                const result = await res.json();
                if (!result.ok) throw new Error(result.error || "Couldn't save");
                showStats(result.stats);
                showLeaderboard(result.leaderboard);
                return result;
            } catch (err) {
                return { error: err.message };
            }
        })();
    }

    function resultNote(result) {
        if (result.error) return "Couldn't save this run (" + result.error + ").";
        const notes = [];
        if (result.stats.count === 1) notes.push("First clear!");
        else {
            if (result.newBestTime) notes.push("New best time!");
            if (result.newBestMoves) notes.push("Fewest moves yet!");
        }
        return (notes.join(" ") || `Your best is ${formatTime(result.stats.best_ms)} in ${result.stats.best_moves} moves.`)
            + (hints.used ? ` (${hints.used} hint${hints.used === 1 ? "" : "s"} used)` : "");
    }

    function parNote(moves) {
        if (!data.par) return "";
        return moves <= data.par ? `☠ You matched par (${data.par} moves)!` : `Par is ${data.par} moves.`;
    }

    function showWin({ moves, ms }) {
        BlockedSound.play("win");
        clearHint();
        $("stuckBanner").classList.add("hidden");
        saving = saveRun(moves, ms);
        if (data.autoAdvance && walkOnWanted && data.nextUrl) walkOn(moves, ms);
        else showPopup(moves, ms);
    }

    function walkOn(moves, ms) {
        $("tallyMoves").textContent = moves;
        $("tallyTime").textContent = formatTime(ms);
        $("tallyNote").textContent = parNote(moves) || "Saving…";
        $("tallyLine").textContent = data.transitionLine || "";
        $("tally").classList.remove("hidden");
        saving.then(result => {
            $("tallyNote").textContent = [parNote(moves), resultNote(result)].filter(Boolean).join(" ");
        });
        Promise.all([saving, wait(data.transitionLine ? 2600 : 1700)]).then(() => {
            if (!$("tally").classList.contains("hidden")) goNext();
        });
    }

    function showPopup(moves, ms) {
        $("winMoves").textContent = moves;
        $("winTime").textContent = formatTime(ms);
        $("winBest").textContent = "Saving…";
        if (data.par) {
            $("winPar").textContent = moves <= data.par
                ? `☠ You matched par (${data.par} moves). Nobody can do it in fewer!`
                : `Par is ${data.par} moves. Can you find a shorter route?`;
            $("winPar").classList.remove("hidden");
        }
        winModal.classList.remove("hidden");
        if (data.nextUrl) {
            // Space or Enter moves on straight away (see the keydown handler below).
            const midChapter = data.room && data.room < 5;
            $("nextBtn").firstChild.textContent = midChapter ? "Next room ▶ " : "Next level ▶ ";
            $("nextBtn").href = data.nextUrl;
            $("nextBtn").classList.remove("hidden");
            $("nextBtn").focus();
        } else {
            $("nextBtn").classList.add("hidden");
            $("replayBtn").focus();
        }
        saving.then(result => { $("winBest").textContent = resultNote(result); });
    }

    // Fade to dark, then go on once this run has saved (a quick tap never loses a record).
    function goNext() {
        if (!data.nextUrl || leaving) return;
        leaving = true;
        $("curtain").classList.remove("entering");
        $("curtain").classList.add("closing");
        Promise.all([saving, wait(450)]).then(() => BlockedSound.go(data.nextUrl));
    }
    const nextLevel = goNext;
    $("nextBtn").addEventListener("click", e => { e.preventDefault(); nextLevel(); });

    // Walking in from the room before: the board fades in from dark and the
    // pirate steps in from the nearest edge, as if through a doorway.
    if (data.entering) {
        const pirate = table.querySelector(".player .sp.pirate");
        const [px, py] = game.getState().player;
        const gaps = [[px, -1, 0], [level.width - 1 - px, 1, 0], [py, 0, -1], [level.height - 1 - py, 0, 1]];
        const [, dx, dy] = gaps.sort((a, b) => a[0] - b[0])[0];   // nearest edge
        if (pirate) {
            pirate.style.translate = `${dx * 100}% ${dy * 100}%`;
            pirate.getBoundingClientRect();   // apply the start position before animating
            pirate.style.transition = "translate 450ms ease-out 250ms";
            pirate.style.translate = "0 0";
        }
    }

    function replay() {
        winModal.classList.add("hidden");
        game.reset();
    }

    $("replayBtn").addEventListener("click", replay);
    $("resetBtn").addEventListener("click", () => { game.reset(); $("resetBtn").blur(); });
    document.querySelectorAll("[data-move]").forEach(btn => {
        btn.addEventListener("click", () => {
            const [dx, dy] = btn.dataset.move.split(",").map(Number);
            game.move(dx, dy);
        });
    });

    // On the win screen or the room tally: Space or Enter goes on to the next
    // room. R already restarts the board; this also closes the win screen and
    // stays in this room instead of walking on.
    document.addEventListener("keydown", event => {
        const tallyUp = !$("tally").classList.contains("hidden");
        if (winModal.classList.contains("hidden") && !tallyUp) return;
        if ((event.key === "r" || event.key === "R") && !leaving) {
            winModal.classList.add("hidden");
            $("tally").classList.add("hidden");
        }
        if ((event.key === " " || event.key === "Enter") && data.nextUrl) {
            event.preventDefault();
            nextLevel();
        }
    });
});
