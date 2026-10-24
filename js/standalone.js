// The standalone build: the whole game on one page, with no server.
//
// It reuses the website's game code as-is: engine.js (the board and rules),
// solver.js (hints, in a worker), hints.js, audio.js, editor.js and
// soundmenu.js. This file is only the glue for a game with no accounts:
// screens, saving progress in the browser, the chapter flow, tutorials, and
// the player's own levels. Levels come from js/levels.js (written by
// `flask --app app export-standalone`).
(function () {
    "use strict";
    const DATA = window.BLOCKED_DATA;
    const LEVELS = DATA.levels;
    const $ = id => document.getElementById(id);
    const S = window.BlockedSound;
    const portal = window.BlockedPortal;

    // ========== Saved in the browser ==========
    const store = {
        get(key, fallback) {
            try { const v = localStorage.getItem("blocked-sa-" + key); return v == null ? fallback : JSON.parse(v); }
            catch (e) { return fallback; }
        },
        set(key, value) {
            try { localStorage.setItem("blocked-sa-" + key, JSON.stringify(value)); } catch (e) { /* storage blocked: progress lasts until the tab closes */ }
        },
    };
    const progress = store.get("progress", {});   // level id -> { count, best_ms, best_moves }
    const seen = store.get("seen", {});           // tutorials already shown
    let myLevels = store.get("mylevels", []);      // the player's own levels
    let walkOnWanted = store.get("autoadvance", true);

    // ========== Small helpers ==========
    function formatTime(ms) {
        if (ms == null) return "-";
        const s = ms / 1000;
        if (s < 60) return s.toFixed(1) + "s";
        return Math.floor(s / 60) + ":" + (s % 60).toFixed(1).padStart(4, "0");
    }
    function escapeHtml(text) {
        const div = document.createElement("div");
        div.textContent = text == null ? "" : String(text);
        return div.innerHTML;
    }
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    const NAMES = { 1: "Calm Seas", 2: "Choppy", 3: "Squall", 4: "Storm", 5: "Maelstrom" };
    // Same markup as app.py's skull_icons(): ratings are in half-skull steps (1-10).
    function skulls(d, empty = true) {
        const full = Math.floor(d / 2), half = d % 2;
        let out = '<i class="skull"></i>'.repeat(full) + (half ? '<i class="skull half"></i>' : "");
        if (empty) out += '<i class="skull dim"></i>'.repeat(5 - full - half);
        return `<span class="skulls" aria-hidden="true">${out}</span>`;
    }
    const ratingName = d => NAMES[Math.ceil(d / 2)];

    function isUnlocked(i) {
        return i === 0 || !!progress[LEVELS[i].id] || !!progress[LEVELS[i - 1].id];
    }
    function firstUncleared() {
        const i = LEVELS.findIndex(lv => !progress[lv.id]);
        return i < 0 ? 0 : i;
    }

    // ========== Screens ==========
    // One page, many screens: switching screens never reloads, so the music
    // carries on and crossfades when a screen wants a different song.
    let screen = "title";
    function show(name) {
        if (screen === "play" && name !== "play") stopLevel();
        if (screen === "workshop" && name !== "workshop" && editor) closeEditor(true);
        screen = name;
        document.querySelectorAll(".screen").forEach(el => el.classList.toggle("hidden", el.id !== "screen-" + name));
        document.querySelectorAll(".topbar [data-go]").forEach(el => el.classList.toggle("active", el.dataset.go === name));
        if (name !== "play" && name !== "sounds") S.music("lobby", { room: 0 });
        if (name === "title") renderTitle();
        if (name === "chapters") renderChapters();
        if (name === "workshop") renderMyLevels();
        if (name === "help") renderHelp();
        if (name === "sounds") BlockedSoundTest.init();
        window.scrollTo(0, 0);
    }
    document.addEventListener("click", e => {
        const go = e.target.closest("[data-go]");
        if (go) { e.preventDefault(); show(go.dataset.go); }
    });

    // ========== Title ==========
    function renderTitle() {
        const cleared = LEVELS.filter(lv => progress[lv.id]).length;
        $("continueBtn").textContent = cleared === 0 ? "Set sail" : cleared === LEVELS.length ? "Play again" : "Continue the voyage";
        $("titleProgress").textContent = cleared ? `${cleared} of ${LEVELS.length} rooms cleared` : "";
    }
    $("continueBtn").addEventListener("click", () => playVoyage(firstUncleared(), { flow: true }));

    // ========== Level select ==========
    function card(lv, number, locked, onPlay, extra = "") {
        const prog = progress[lv.id];
        const el = document.createElement("article");
        el.className = "level-card" + (locked ? " locked" : prog ? " cleared" : "");
        el.innerHTML = `
            ${number ? `<span class="num">${number}</span>` : ""}
            <div class="thumb">${locked ? '<img src="img/lock.svg" alt="Locked">' : '<table class="board mini"></table>'}</div>
            <div class="body">
                <h3>${escapeHtml(lv.name)}</h3>
                <p class="notes">${locked ? "Clear the room before this one to unlock it." : escapeHtml(lv.notes || "")}</p>
                <div class="meta">
                    ${prog ? `<img src="img/check.svg" alt="Cleared"><span class="pill">${formatTime(prog.best_ms)}</span><span class="pill">${prog.best_moves} moves</span>` : ""}
                    ${lv.difficulty ? `<span class="pill rating" title="Difficulty: ${lv.difficulty / 2} of 5 skulls (${ratingName(lv.difficulty)})">${skulls(lv.difficulty, false)}</span>` : ""}
                </div>
                ${extra}
            </div>`;
        if (!locked) {
            const table = el.querySelector("table");
            table.dataset.exitStyle = lv.mid ? "door" : "chest";
            table.style.setProperty("--tile", Blocked.fitTile(lv.width, lv.height, 210, 150, 4, 28) + "px");
            Blocked.drawLevel(table, lv);
            if (onPlay) {
                const open = document.createElement("button");
                open.className = "stretched";
                open.type = "button";
                open.setAttribute("aria-label", "Play " + lv.name);
                open.addEventListener("click", onPlay);
                el.querySelector(".body").appendChild(open);
            }
        }
        return el;
    }

    function renderChapters() {
        const list = $("chapterList");
        list.innerHTML = "";
        DATA.chapters.forEach((title, c) => {
            const h = document.createElement("h3");
            h.className = "chapter-title";
            h.id = "chapter-" + (c + 1);
            h.textContent = `Chapter ${c + 1}: ${title}`;
            const grid = document.createElement("div");
            grid.className = "level-grid";
            LEVELS.forEach((lv, i) => {
                if (lv.chapter !== c + 1) return;
                grid.appendChild(card(lv, i + 1, !isUnlocked(i), () => playVoyage(i, { flow: !progress[lv.id] })));
            });
            list.append(h, grid);
        });
        renderMap();
    }

    // ========== The voyage map (story.js draws it) ==========
    BlockedStory.init({ imgBase: "img/", story: DATA.story, seenKey: "blocked-sa-story-seen" });
    function renderMap() {
        const chapters = DATA.chapters.map((title, c) => ({
            number: c + 1, title,
            levels: LEVELS.map((lv, i) => ({ lv, i })).filter(({ lv }) => lv.chapter === c + 1).map(({ lv, i }) => ({
                id: lv.id, name: lv.name, number: i + 1,
                state: progress[lv.id] ? "cleared" : isUnlocked(i) ? "open" : "locked",
            })),
        })).filter(ch => ch.levels.length);
        BlockedStory.renderMap($("voyageMapBody"), chapters);
        BlockedStory.sceneButtons($("sceneButtons"));
    }
    $("voyageMapBody").addEventListener("click", e => {
        const room = e.target.closest("a.map-node");
        if (!room) return;
        e.preventDefault();
        const i = Number(room.dataset.index);
        playVoyage(i, { flow: !progress[LEVELS[i].id] });
    });
    BlockedStory.viewSwitch({
        buttons: [...document.querySelectorAll("#screen-chapters .view-toggle [data-view]")],
        map: $("voyageMap"), list: $("chapterList"), key: "blocked-sa-view",
    });

    // ========== Tutorials ==========
    const CONTROLS = `<ul class="info-list">
        <li><b>Move:</b> arrow keys or WASD (or swipe the board, or the arrow pad on a touch screen).</li>
        <li><b>Push crates</b> by walking into them. Crates never come back, so think before you shove.</li>
        <li><b>Z</b> undoes a move, <b>R</b> restarts, <b>H</b> gives a hint (press again for the exact next move).</li>
        <li><b>M</b> mutes. The speaker button up top sets the volume.</li>
    </ul>`;
    const MECHANICS = {
        plates: ["Pressure plates and gates", "While you or a crate stands on a plate, its gate is open. Step off and the gate shuts. Hover a plate to see its gate, or a gate to see its plate."],
        squeeze: ["The squeeze", "A gate that shuts on a crate squeezes it out to the nearest free square, checking squares around the gate starting at the top-right. Block the nearer squares and you can drop a crate somewhere you can't reach."],
        cannons: ["Fuses and cannons", "Stand on a fuse (or put a crate on it) and its cannon fires the crate sitting in front of it. The shot smashes the first wall or crate it hits. Don't stand in the line of fire!"],
        loaded: ["A loaded fuse", "A crate parked on a fuse keeps its cannon firing after every move, so any crate that lands in front of it is shot straight away."],
        hull: ["The enemy ship", "Her hull blocks like a wall, and every crate you shoot into it costs her one health (the bar above the board). Use it all up and the whole ship sinks out of your way."],
        kraken: ["The kraken", "The kraken blocks your way like a wall. Every crate you shoot into it costs it one health (the bar above the board). Use it all up and it sinks back into the deep."],
        doors: ["Doors and trapdoors", "Rooms in the middle of a chapter end at a glowing door or trapdoor. Walk through to the next room. The treasure waits at the end of each chapter."],
    };

    // Shows each popup the player hasn't seen yet, one after another.
    async function introduce(lv) {
        const queue = [];
        if (!seen.controls) queue.push(["controls", "Welcome aboard!", CONTROLS]);
        for (const m of lv.mechanics || []) {
            if (!seen[m] && MECHANICS[m]) queue.push([m, MECHANICS[m][0], `<p>${MECHANICS[m][1]}</p>`]);
        }
        for (const [key, title, body] of queue) {
            await info(title, body);
            seen[key] = true;
            store.set("seen", seen);
        }
    }

    let infoDone = null;
    function info(title, body) {
        $("infoTitle").textContent = title;
        $("infoBody").innerHTML = body;
        $("infoModal").classList.remove("hidden");
        $("infoOk").focus();
        return new Promise(resolve => { infoDone = resolve; });
    }
    function closeInfo() {
        if (!infoDone) return;
        $("infoModal").classList.add("hidden");
        const done = infoDone;
        infoDone = null;
        done();
    }
    $("infoOk").addEventListener("click", closeInfo);

    function renderHelp() {
        $("helpList").innerHTML = CONTROLS + Object.values(MECHANICS)
            .map(([t, text]) => `<li><b>${t}:</b> ${text}</li>`).join("");
    }

    // ========== Playing ==========
    const table = $("gameBoard");
    let game = null, hints = null;
    let current = null;        // { lv, index (voyage) or null (own level), flow }
    let leaving = false, saving = null;

    function fitBoard() {
        if (!current) return;
        const area = document.querySelector("#screen-play .board-area");
        const frame = document.querySelector("#screen-play .board-frame");
        const top = frame.getBoundingClientRect().top + window.scrollY;
        let below = 0;
        for (let el = frame.nextElementSibling; el; el = el.nextElementSibling) {
            if (el.offsetParent) below += el.offsetHeight + 16;
        }
        const maxW = area.clientWidth - 24;
        const maxH = window.innerHeight - top - below - 32;
        Blocked.fitBoard(table, current.lv.width, current.lv.height, maxW, Math.max(maxH, 180), 14, 72);
    }
    window.addEventListener("resize", fitBoard);

    function stopLevel() {
        if (game) game.destroy();
        if (hints) hints.destroy();
        game = hints = null;
        current = null;
        $("tally").classList.add("hidden");
        $("winModal").classList.add("hidden");
    }

    function showStats(lv) {
        const p = progress[lv.id];
        const rows = [["Times cleared", p ? p.count : 0]];
        if (p) rows.push(["Best time", formatTime(p.best_ms)], ["Fewest moves", p.best_moves]);
        if (lv.par) rows.push(["Par", lv.par + " moves"]);
        $("myStats").innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("");
    }

    function playVoyage(index, { flow = false, entering = false } = {}) {
        if (!isUnlocked(index)) return;
        startLevel({ lv: LEVELS[index], index, flow }, entering);
    }

    function playOwn(lv) {
        startLevel({ lv: { ...lv, chapter: 0, room: 0, id: "own-" + (lv.id || "draft") }, index: null, flow: false, own: lv }, false);
    }

    async function startLevel(cur, entering) {
        if (screen !== "play") show("play");
        stopLevel();
        current = cur;
        leaving = false;
        const lv = cur.lv;
        const voyage = cur.index != null;
        $("pPlace").textContent = voyage
            ? `Chapter ${lv.chapter}: ${DATA.chapters[lv.chapter - 1]} · ${lv.mid || lv.test ? "Room" : "Level"} ${lv.room} of ${lv.size}` + (lv.test ? " · Chapter test" : "")
            : "Your level";
        $("pName").textContent = lv.name;
        $("pDifficulty").innerHTML = lv.difficulty
            ? `${skulls(lv.difficulty)} ${ratingName(lv.difficulty)}${lv.par ? ` · Par ${lv.par} moves` : ""}` : "";
        $("pNotes").textContent = lv.notes || "";
        $("pBack").textContent = voyage ? "All levels" : "Your levels";
        $("autoAdvanceRow").classList.toggle("hidden", !voyage || !lv.mid);
        $("autoAdvance").checked = walkOnWanted;
        $("hintText").textContent = "";
        $("stuckBanner").classList.add("hidden");
        $("moveCount").textContent = "0";
        $("timeElapsed").textContent = "0.0s";
        showStats(lv);
        // Music: the same slots as the website (chapters.py music_slot): each chapter's
        // track, its grand boss version in the last room, and the finale's own tracks.
        if (voyage) {
            S.music(lv.music, { room: lv.mid ? lv.room : 0 });
        } else {
            S.music("chapter1", { room: 0 });
        }
        table.innerHTML = "";
        table.dataset.exitStyle = voyage && lv.mid ? "door" : "chest";
        fitBoard();
        if (entering) {
            $("curtain").classList.remove("closing");
            $("curtain").classList.add("entering");
        } else {
            $("curtain").classList.remove("closing", "entering");
        }
        if (voyage) await BlockedStory.before(storyBefore(cur.index));
        if (current !== cur) return;   // the player left during a scene
        if (voyage) await introduce(lv);
        if (current !== cur) return;   // the player left while a tutorial was up
        game = Blocked.startGame(table, lv, {
            onUpdate({ moves, ms }) {
                $("moveCount").textContent = moves;
                $("timeElapsed").textContent = formatTime(ms);
            },
            onWin: won,
            onSettle: () => { if (hints) hints.settled(); $("undoBtn").disabled = !game || !game.canUndo; },
            onSound: name => S.play(name),
            onDeath: how => {
                $("hintText").textContent = how === "shot"
                    ? "Blasted by your own cannon! Back to the start you go."
                    : "Crushed by a gate! Back to the start you go.";
            },
        });
        if (!game) { $("hintText").textContent = "This level has no pirate to play as."; return; }
        fitBoard();   // again, now the board (and any health bar) is drawn
        hints = BlockedHints.create({
            table, level: lv, game,
            solverUrl: "js/solver.js",
            route: lv.solution || null,
            text: $("hintText"),
            button: $("hintBtn"),
            stuck: $("stuckBanner"),
            exitWord: table.dataset.exitStyle === "door" ? "way out" : "treasure",
            sound: name => S.play(name),
            buttonLabel: "Hint",
        });
        if (entering) stepIn(lv);
        portal.levelStart({ id: lv.id, name: lv.name, chapter: lv.chapter, room: lv.room });
    }

    // The story around voyage room i (story.js): what plays before it, the first time.
    function storyBefore(i) {
        const lv = LEVELS[i], prev = LEVELS[i - 1];
        const first = !prev || prev.chapter !== lv.chapter;
        const told = (DATA.story.chapters || [])[lv.chapter - 1] || {};
        return {
            afterLevel: prev ? prev.name : null,
            afterChapter: first && prev ? DATA.chapters[prev.chapter - 1] : null,
            chapter: first ? { number: lv.chapter, title: DATA.chapters[lv.chapter - 1], place: told.place, intro: told.intro } : null,
        };
    }
    // A chapter's last room ends with its story line on the "Treasure found!" popup.
    function chestLine(i) {
        if (i == null) return "";
        const lv = LEVELS[i], next = LEVELS[i + 1];
        if (next && next.chapter === lv.chapter) return "";
        return ((DATA.story.chapters || [])[lv.chapter - 1] || {}).end || "";
    }

    // Walking in from the room before: the pirate steps in from the nearest edge.
    function stepIn(lv) {
        const pirate = table.querySelector(".player .sp.pirate");
        if (!pirate) return;
        const [px, py] = game.getState().player;
        const gaps = [[px, -1, 0], [lv.width - 1 - px, 1, 0], [py, 0, -1], [lv.height - 1 - py, 0, 1]];
        const [, dx, dy] = gaps.sort((a, b) => a[0] - b[0])[0];
        pirate.style.translate = `${dx * 100}% ${dy * 100}%`;
        pirate.getBoundingClientRect();
        pirate.style.transition = "translate 450ms ease-out 250ms";
        pirate.style.translate = "0 0";
    }

    function won({ moves, ms }) {
        const cur = current;
        const lv = cur.lv;
        S.play("win");
        hints.clear();
        $("stuckBanner").classList.add("hidden");
        // Save the run (only voyage rooms keep records).
        let note = "";
        if (cur.index != null) {
            const before = progress[lv.id];
            const first = !before;
            const p = before || { count: 0, best_ms: ms, best_moves: moves };
            const newTime = first || ms < p.best_ms, newMoves = first || moves < p.best_moves;
            progress[lv.id] = { count: p.count + 1, best_ms: Math.min(p.best_ms, ms), best_moves: Math.min(p.best_moves, moves) };
            store.set("progress", progress);
            showStats(lv);
            note = first ? "First clear!" : [newTime && "New best time!", newMoves && "Fewest moves yet!"].filter(Boolean).join(" ")
                || `Your best is ${formatTime(progress[lv.id].best_ms)} in ${progress[lv.id].best_moves} moves.`;
            portal.levelComplete({ id: lv.id, name: lv.name, chapter: lv.chapter, room: lv.room },
                                 { moves, ms, par: lv.par || null, firstClear: first });
        }
        if (hints.used) note += ` (${hints.used} hint${hints.used === 1 ? "" : "s"} used)`;
        const parNote = lv.par ? (moves <= lv.par ? `☠ You matched par (${lv.par} moves)!` : `Par is ${lv.par} moves.`) : "";
        const hasNext = cur.index != null && cur.index + 1 < LEVELS.length;
        if (cur.index != null && cur.flow && lv.mid && hasNext && walkOnWanted) {
            $("tallyMoves").textContent = moves;
            $("tallyTime").textContent = formatTime(ms);
            $("tallyNote").textContent = [parNote, note].filter(Boolean).join(" ");
            $("tallyLine").textContent = lv.transition || "";
            $("tally").classList.remove("hidden");
            wait(lv.transition ? 2600 : 1700).then(() => {
                if (current === cur && !$("tally").classList.contains("hidden")) goNext();
            });
            return;
        }
        $("winMoves").textContent = moves;
        $("winTime").textContent = formatTime(ms);
        $("winBest").textContent = note;
        $("winPar").textContent = parNote;
        $("winPar").classList.toggle("hidden", !parNote);
        $("winTitle").textContent = lv.mid ? "Room cleared!" : "Treasure found!";
        const theEnd = cur.index != null && cur.index === DATA.ending;   // the ending plays next
        $("winStory").textContent = chestLine(cur.index);
        $("winStory").classList.toggle("hidden", !$("winStory").textContent);
        $("nextBtn").classList.toggle("hidden", !hasNext && !theEnd);
        $("nextBtn").firstChild.textContent = theEnd ? "The end ▶ " : lv.mid ? "Next room ▶ " : "Next level ▶ ";
        $("winBackBtn").textContent = cur.index != null ? "Back to the chapter" : "Back to your levels";
        $("winModal").classList.remove("hidden");
        (hasNext || theEnd ? $("nextBtn") : $("replayBtn")).focus();
    }

    // Fade to dark, then the next room fades in. Between chapters the portal gets a break.
    function goNext() {
        const cur = current;
        if (cur && cur.index === DATA.ending && !leaving) return theEnd();
        if (!cur || cur.index == null || cur.index + 1 >= LEVELS.length || leaving) return;
        leaving = true;
        const next = cur.index + 1;
        const newChapter = LEVELS[next].chapter !== cur.lv.chapter;
        $("curtain").classList.remove("entering");
        $("curtain").classList.add("closing");
        wait(450).then(() => {
            const go = () => playVoyage(next, { flow: true, entering: true });
            if (newChapter) portal.breakTime(go); else go();
        });
    }

    // After the voyage's last room: the ending, then the map.
    function theEnd() {
        leaving = true;
        $("winModal").classList.add("hidden");
        BlockedStory.auto("ending").then(() => portal.breakTime(() => show("chapters")));
    }

    function backFromLevel() {
        const cur = current;
        if (cur && cur.own) { show("workshop"); openEditor(cur.own); return; }
        const chapter = cur ? cur.lv.chapter : 1;
        portal.breakTime(() => {
            show("chapters");
            const h = $("voyageMap").classList.contains("hidden") ? $("chapter-" + chapter) : $("map-chapter-" + chapter);
            if (h) h.scrollIntoView({ block: "center" });
        });
    }

    $("nextBtn").addEventListener("click", goNext);
    $("replayBtn").addEventListener("click", () => { $("winModal").classList.add("hidden"); if (game) game.reset(); });
    $("winBackBtn").addEventListener("click", backFromLevel);
    $("pBack").addEventListener("click", backFromLevel);
    $("resetBtn").addEventListener("click", () => {
        if (!game) return;
        game.reset();
        $("resetBtn").blur();
        portal.levelRestart({ id: current.lv.id });
    });
    $("undoBtn").addEventListener("click", () => { if (game) game.undo(); $("undoBtn").blur(); });
    $("hintBtn").addEventListener("click", () => { if (hints) hints.show(); $("hintBtn").blur(); });
    $("autoAdvance").addEventListener("change", e => {
        walkOnWanted = e.target.checked;
        store.set("autoadvance", walkOnWanted);
        e.target.blur();
    });
    document.querySelectorAll("#screen-play [data-move]").forEach(btn => {
        btn.addEventListener("click", () => {
            if (!game) return;
            const [dx, dy] = btn.dataset.move.split(",").map(Number);
            game.move(dx, dy);
        });
    });

    // Swipe the board to move (touch screens).
    let touchStart = null;
    const frame = document.querySelector("#screen-play .board-frame");
    frame.addEventListener("touchstart", e => {
        if (e.touches.length === 1) touchStart = [e.touches[0].clientX, e.touches[0].clientY];
    }, { passive: true });
    frame.addEventListener("touchend", e => {
        if (!touchStart || !game) return;
        const t = e.changedTouches[0];
        const dx = t.clientX - touchStart[0], dy = t.clientY - touchStart[1];
        touchStart = null;
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
        if (Math.abs(dx) > Math.abs(dy)) game.move(Math.sign(dx), 0);
        else game.move(0, Math.sign(dy));
    }, { passive: true });
    frame.addEventListener("touchmove", e => { if (touchStart) e.preventDefault(); }, { passive: false });

    document.addEventListener("keydown", e => {
        const t = e.target;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
        if (infoDone) {
            if (e.key === " " || e.key === "Enter" || e.key === "Escape") { e.preventDefault(); closeInfo(); }
            return;
        }
        if (screen !== "play" || !game) return;
        const popup = !$("winModal").classList.contains("hidden");
        const tally = !$("tally").classList.contains("hidden");
        if (popup || tally) {
            if ((e.key === "r" || e.key === "R") && !leaving) {
                $("winModal").classList.add("hidden");
                $("tally").classList.add("hidden");
            }
            if (e.key === " " || e.key === "Enter") { e.preventDefault(); goNext(); }
            return;
        }
        if (e.key === "h" || e.key === "H") hints.show();
        if (e.key === " ") e.preventDefault();   // don't scroll the page
    });

    // ========== Your own levels ==========
    let editor = null, editing = null;

    function saveMyLevels() { store.set("mylevels", myLevels); }

    function renderMyLevels() {
        $("workshopList").classList.remove("hidden");
        $("workshopEditor").classList.add("hidden");
        const grid = $("myLevels");
        grid.innerHTML = "";
        if (!myLevels.length) {
            grid.innerHTML = '<div class="empty">No levels yet. Build one, or import one a friend sent you.</div>';
            return;
        }
        myLevels.forEach(lv => {
            const actions = `<div class="card-actions">
                <button class="btn small" type="button" data-act="play">Play</button>
                <button class="btn small wood" type="button" data-act="edit">Edit</button>
                <button class="btn small sea" type="button" data-act="export">Export</button>
                <button class="btn small red" type="button" data-act="delete">Delete</button></div>`;
            const el = card(lv, null, false, null, actions);
            el.querySelector(".card-actions").addEventListener("click", e => {
                const act = e.target.closest("[data-act]");
                if (!act) return;
                if (act.dataset.act === "play") playOwn(lv);
                if (act.dataset.act === "edit") openEditor(lv);
                if (act.dataset.act === "export") shareOut(lv);
                if (act.dataset.act === "delete" && confirm(`Delete "${lv.name}" from this browser?`)) {
                    myLevels = myLevels.filter(x => x.id !== lv.id);
                    saveMyLevels();
                    renderMyLevels();
                }
            });
            grid.appendChild(el);
        });
    }

    function openEditor(lv) {
        if (screen !== "workshop") show("workshop");
        if (editor) closeEditor(true);
        editing = lv || null;
        $("workshopList").classList.add("hidden");
        $("workshopEditor").classList.remove("hidden");
        $("editorTitle").textContent = lv ? `Editing “${lv.name}”` : "Build a level";
        $("editorHost").replaceChildren($("editorTemplate").content.cloneNode(true));
        editor = BlockedEditor.start({
            level: lv ? { ...lv, published: true } : null,
            limits: DATA.limits,
            exitStyle: "chest",
            store: {
                save(body, id) {
                    const level = cleanLevel(body);
                    if (!level) return { ok: false, errors: ["That level doesn't look right."] };
                    level.id = id || "L" + Date.now().toString(36);
                    const at = myLevels.findIndex(x => x.id === level.id);
                    if (at >= 0) myLevels[at] = level; else myLevels.push(level);
                    saveMyLevels();
                    editing = level;
                    $("editorTitle").textContent = `Editing “${level.name}”`;
                    return { ok: true, id: level.id };
                },
            },
        });
        $("exportBtn").addEventListener("click", () => shareOut(editor.level()));
    }

    function closeEditor(quiet) {
        if (!editor) return true;
        if (!quiet && editor.dirty && !confirm("Leave without saving your changes?")) return false;
        editor.destroy();
        editor = null;
        $("editorHost").replaceChildren();
        return true;
    }

    $("newLevelBtn").addEventListener("click", () => openEditor(null));
    $("editorBackBtn").addEventListener("click", () => { if (closeEditor(false)) renderMyLevels(); });
    $("editorPlayBtn").addEventListener("click", () => {
        if (!editor) return;
        const lv = cleanLevel(editor.level());
        if (!lv || !lv.tiles.some(t => t.type === "player")) { alert("Place a pirate first."); return; }
        lv.id = editing ? editing.id : null;
        if (!closeEditor(false)) return;
        playOwn(lv);
    });

    // Levels as text: checked carefully, since a pasted level could be anything.
    const TYPES = new Set(["player", "wall", "box", "pressureplate", "cannon", "fuse", "exit"]);
    const DIRS = new Set(["up", "down", "left", "right"]);
    function cleanLevel(raw) {
        if (!raw || typeof raw !== "object") return null;
        const int = v => Number.isInteger(v) ? v : (typeof v === "string" && /^-?\d+$/.test(v) ? parseInt(v, 10) : null);
        const width = int(raw.width), height = int(raw.height);
        if (width == null || height == null || width < DATA.limits.min || height < DATA.limits.min
            || width > DATA.limits.max || height > DATA.limits.max) return null;
        const tiles = [];
        for (const t of Array.isArray(raw.tiles) ? raw.tiles : []) {
            if (!t || !TYPES.has(String(t.type).toLowerCase())) continue;
            const x = int(t.x), y = int(t.y);
            if (x == null || y == null || x < 0 || y < 0 || x >= width || y >= height) continue;
            const type = String(t.type).toLowerCase();
            tiles.push({
                type, x, y,
                direction: type === "cannon" && DIRS.has(t.direction) ? t.direction : null,
                aX: int(t.aX), aY: int(t.aY),
            });
        }
        return {
            name: String(raw.name || "Untitled").slice(0, 80),
            notes: String(raw.notes || "").slice(0, 500),
            width, height, tiles,
        };
    }

    // Import / export dialog
    let shareAction = null;
    function shareOut(lv) {
        const clean = cleanLevel(lv);
        $("shareTitle").textContent = "Export a level";
        $("shareHelp").textContent = "Copy this text and send it to a friend. They can paste it into Import a level.";
        $("shareText").value = JSON.stringify(clean);
        $("shareText").readOnly = true;
        $("shareMsg").textContent = "";
        $("shareOk").textContent = "Copy";
        shareAction = () => {
            $("shareText").select();
            const done = () => { $("shareMsg").textContent = "Copied!"; };
            if (navigator.clipboard) navigator.clipboard.writeText($("shareText").value).then(done, () => document.execCommand("copy") && done());
            else if (document.execCommand("copy")) done();
        };
        $("shareModal").classList.remove("hidden");
        $("shareText").focus();
        $("shareText").select();
    }
    $("importBtn").addEventListener("click", () => {
        $("shareTitle").textContent = "Import a level";
        $("shareHelp").textContent = "Paste a level someone exported, then press Import.";
        $("shareText").value = "";
        $("shareText").readOnly = false;
        $("shareMsg").textContent = "";
        $("shareOk").textContent = "Import";
        shareAction = () => {
            let lv = null;
            try { lv = cleanLevel(JSON.parse($("shareText").value)); } catch (e) { lv = null; }
            if (!lv) { $("shareMsg").textContent = "That doesn't look like a Blocked level."; return; }
            lv.id = "L" + Date.now().toString(36);
            myLevels.push(lv);
            saveMyLevels();
            $("shareModal").classList.add("hidden");
            renderMyLevels();
        };
        $("shareModal").classList.remove("hidden");
        $("shareText").focus();
    });
    $("shareOk").addEventListener("click", () => shareAction && shareAction());
    $("shareClose").addEventListener("click", () => $("shareModal").classList.add("hidden"));

    // ========== Start ==========
    show("title");
    portal.gameStart();
    BlockedStory.playOnce("intro");   // the first time the game opens
    window.BlockedStandalone = { playVoyage, show, progress: () => ({ ...progress }) };   // handy for testing
})();
