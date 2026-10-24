// Level editor: paint tiles, link plates and fuses, playtest, and save.
// The website starts it from the page's #editorData; the standalone build calls
// BlockedEditor.start(cfg) itself, with cfg.store to save levels in the browser.
(function (global) {
function startEditor(cfg) {
    // Page-wide listeners are tracked so a standalone screen can shut the editor down.
    const cleanup = [];
    const on = (target, ev, fn, opt) => { target.addEventListener(ev, fn, opt); cleanup.push(() => target.removeEventListener(ev, fn, opt)); };
    const $ = id => document.getElementById(id);

    const table = $("editTable");
    const linksSvg = $("links");
    const statusBar = $("status");
    const nameInput = $("levelName");
    const noteInput = $("levelNote");
    const widthInput = $("levelWidth");
    const heightInput = $("levelHeight");
    const publishedInput = $("published");
    const campaignInput = $("inCampaign");
    const positionInput = $("position");
    const { min: MIN_SIZE, max: MAX_SIZE } = cfg.limits;

    const TOOLS = [
        { id: "player", label: "Pirate", key: "1", sprite: "pirate", drag: false },
        { id: "wall", label: "Wall", key: "2", sprite: "wall", drag: true },
        { id: "box", label: "Crate", key: "3", sprite: "crate", drag: true },
        { id: "pressureplate", label: "Plate", key: "4", sprite: "plate", drag: false },
        { id: "cannon", label: "Cannon", key: "5", sprite: "cannon", drag: false },
        { id: "fuse", label: "Fuse", key: "6", sprite: "fuse", drag: false },
        { id: "exit", label: "Treasure", key: "7", sprite: "chest", drag: false },
        { id: "link", label: "Link", key: "8", sprite: "gate", drag: false },
        { id: "kraken", label: "Kraken", key: "9", sprite: "kraken-eye", drag: true },
        { id: "hull", label: "Enemy hull", key: "-", sprite: "hull", drag: true },
        { id: "erase", label: "Erase", key: "0", sprite: null, drag: true },
    ];
    const NAMES = { player: "Pirate start", wall: "Wall", box: "Crate", pressureplate: "Pressure plate",
                    cannon: "Cannon", fuse: "Fuse", exit: "Treasure (exit)", kraken: "Kraken", hull: "Enemy hull" };
    // The kraken and an enemy hull block like walls; each crate shot into one costs it a
    // health, and with none left all its squares vanish. Every square of one kind shares
    // its health (stored in aX on each square). Click one again to change it.
    const MONSTER = new Set(["kraken", "hull"]);
    const MAX_HEALTH = 20;
    function healthOf(kind) {
        for (const row of board) for (const c of row) if (c && c.type === kind && c.aX) return c.aX;
        return 3;
    }
    function setHealth(kind, hp) {
        board.forEach(row => row.forEach(c => { if (c && c.type === kind) c.aX = hp; }));
    }
    const TURN = { up: "right", right: "down", down: "left", left: "up" };
    // A crate or the pirate can start on top of a plate or fuse. That cell is
    // stored as the plate/fuse with top: "box" or top: "player".
    const FLOOR = new Set(["pressureplate", "fuse"]);
    const TOPS = new Set(["box", "player"]);

    let width, height, board;
    let tool = "wall";
    let linking = null;   // {x, y} of the plate/fuse being linked
    let painting = false;
    let dirty = false;
    let levelId = cfg.level ? cfg.level.id : null;

    // ========== Board data ==========
    function emptyBoard(w, h) {
        return Array.from({ length: h }, () => Array(w).fill(null));
    }

    function loadLevel(level) {
        width = level.width;
        height = level.height;
        board = emptyBoard(width, height);
        level.tiles.forEach(t => {
            if (t.x >= width || t.y >= height) return;
            const type = t.type.toLowerCase(), cur = board[t.y][t.x];
            if (cur && FLOOR.has(cur.type) && TOPS.has(type)) cur.top = type;
            else if (cur && TOPS.has(cur.type) && FLOOR.has(type)) board[t.y][t.x] = { type, aX: t.aX, aY: t.aY, top: cur.type };
            else board[t.y][t.x] = { type, direction: t.direction, aX: t.aX, aY: t.aY };
        });
    }

    function toLevel() {
        const tiles = [];
        board.forEach((row, y) => row.forEach((c, x) => {
            if (!c) return;
            tiles.push({ type: c.type, x, y, direction: c.direction ?? null, aX: c.aX ?? null, aY: c.aY ?? null });
            if (c.top) tiles.push({ type: c.top, x, y, direction: null, aX: null, aY: null });
        }));
        return { width, height, tiles };
    }

    function inBounds(x, y) {
        return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < width && y < height;
    }

    function markDirty() {
        dirty = true;
        $("saveState").textContent = "Unsaved changes";
    }

    // ========== Drawing ==========
    function tileSize() {
        const col = document.querySelector(".editor-board");
        return Blocked.fitTile(width, height, col.clientWidth - 40, window.innerHeight - 280, 16, 48);
    }

    function render() {
        const size = tileSize();
        table.style.setProperty("--tile", size + "px");
        table.dataset.exitStyle = cfg.exitStyle || "chest";
        Blocked.drawLevel(table, toLevel());
        if (linking) {
            const src = Blocked.getCell(table, linking.x, linking.y);
            if (src) src.classList.add("link-source");
        }
        drawLinks(size);
        runChecks();
    }

    function drawLinks(size) {
        linksSvg.innerHTML = "";
        if (!$("showLinks").checked) return;
        const ns = "http://www.w3.org/2000/svg";
        const centre = v => (v + 0.5) * size;
        board.forEach((row, y) => row.forEach((c, x) => {
            if (!c || (c.type !== "pressureplate" && c.type !== "fuse") || c.aX == null || c.aY == null) return;
            const target = inBounds(c.aX, c.aY) ? board[c.aY][c.aX] : null;
            const broken = !inBounds(c.aX, c.aY) || (c.type === "fuse" && (!target || target.type !== "cannon"));
            const cls = broken ? "broken" : c.type === "fuse" ? "fuse-link" : "plate-link";
            const tx = Math.max(0, Math.min(width - 1, c.aX));
            const ty = Math.max(0, Math.min(height - 1, c.aY));
            const line = document.createElementNS(ns, "line");
            line.setAttribute("x1", centre(x));
            line.setAttribute("y1", centre(y));
            line.setAttribute("x2", centre(tx));
            line.setAttribute("y2", centre(ty));
            line.setAttribute("class", cls);
            linksSvg.appendChild(line);
            const dot = document.createElementNS(ns, "circle");
            dot.setAttribute("cx", centre(tx));
            dot.setAttribute("cy", centre(ty));
            dot.setAttribute("r", Math.max(4, size / 8));
            dot.setAttribute("class", cls);
            dot.setAttribute("fill", broken ? "#d33b36" : c.type === "fuse" ? "#ff8a1e" : "#f6c84c");
            linksSvg.appendChild(dot);
        }));
        linksSvg.setAttribute("width", width * size);
        linksSvg.setAttribute("height", height * size);
    }

    // ========== Checks ==========
    function findProblems() {
        const errors = [], warnings = [];
        let players = 0, exits = 0;
        const fired = new Set();
        board.forEach((row, y) => row.forEach((c, x) => {
            if (!c) return;
            const at = `(${x}, ${y})`;
            if (c.type === "player" || c.top === "player") players++;
            if (c.type === "exit") exits++;
            if (c.type === "pressureplate" || c.type === "fuse") {
                const what = c.type === "fuse" ? "Fuse" : "Plate";
                if (c.aX == null || c.aY == null) {
                    warnings.push(`${what} at ${at} isn't linked to anything yet.`);
                } else if (!inBounds(c.aX, c.aY)) {
                    warnings.push(`${what} at ${at} points off the board.`);
                } else {
                    const target = board[c.aY][c.aX];
                    if (c.type === "fuse" && (!target || target.type !== "cannon")) {
                        warnings.push(`Fuse at ${at} isn't linked to a cannon.`);
                    } else if (c.type === "pressureplate" && target && target.type === "cannon") {
                        warnings.push(`Plate at ${at} points at a cannon. Plates only open gates.`);
                    }
                    if (c.type === "fuse") fired.add(c.aX + "," + c.aY);
                }
            }
        }));
        board.forEach((row, y) => row.forEach((c, x) => {
            if (c && c.type === "cannon" && !fired.has(x + "," + y)) warnings.push(`Cannon at (${x}, ${y}) has no fuse.`);
        }));
        warnings.push(...flowWarnings());
        if (players === 0) errors.push("Place a pirate. That's where the player starts.");
        if (exits === 0) errors.push("Place at least one treasure chest. That's the exit.");
        return { errors, warnings };
    }

    // Voyage rooms: does this room's entrance face the previous room's exit, and
    // its exit face the next room's entrance? (Same idea as flow.py / check-flow.)
    const OPPOSITE = { left: "right", right: "left", top: "bottom", bottom: "top" };
    function sidesOf(x, y) {
        const s = [];
        if (x === 0) s.push("left");
        if (x === width - 1) s.push("right");
        if (y === 0) s.push("top");
        if (y === height - 1) s.push("bottom");
        return s;
    }
    function flowWarnings() {
        const f = cfg.flow;
        if (!f) return [];
        const out = [];
        const exits = [], gaps = [];
        board.forEach((row, y) => row.forEach((c, x) => {
            if (!c) return;
            if (c.type === "exit") exits.push(...sidesOf(x, y));
            if (c.type === "player" || c.top === "player") {
                gaps.push(["left", x], ["right", width - 1 - x], ["top", y], ["bottom", height - 1 - y]);
            }
        }));
        const nearest = gaps.length ? Math.min(...gaps.map(g => g[1])) : null;
        const entrance = gaps.filter(g => g[1] === nearest).map(g => g[0]);
        if (f.prevExit && f.prevExit.length && entrance.length && !f.prevExit.some(s => entrance.includes(OPPOSITE[s]))) {
            out.push(`The room before ("${f.prevName}") exits on its ${f.prevExit.join("/")}, so the pirate should start near the ${f.prevExit.map(s => OPPOSITE[s]).join("/")} here.`);
        }
        if (f.nextEntrance && f.nextEntrance.length) {
            if (!exits.length) out.push(`The exit is inside the room, so it's a trapdoor down to "${f.nextName}" (no wall side to line up). Put it in the outer wall for a door.`);
            else if (!exits.some(s => f.nextEntrance.includes(OPPOSITE[s]))) {
                out.push(`The next room ("${f.nextName}") starts near its ${f.nextEntrance.join("/")}, so this room's chest should be on the ${f.nextEntrance.map(s => OPPOSITE[s]).join("/")} wall.`);
            }
        }
        return out;
    }

    function runChecks() {
        const { errors, warnings } = findProblems();
        const items = [
            ...errors.map(t => `<li class="error">${t}</li>`),
            ...warnings.map(t => `<li class="warn">${t}</li>`),
        ];
        if (!items.length) items.push(`<li class="good">Looks shipshape. Playtest it, then publish.</li>`);
        $("checks").innerHTML = items.join("");
        return errors;
    }

    // ========== Status bar ==========
    function setStatus(text, isLinking = false) {
        statusBar.textContent = text;
        statusBar.classList.toggle("linking", isLinking);
    }

    function describe(x, y) {
        const c = board[y][x];
        let text = `(${x}, ${y}): ${c ? (c.top ? NAMES[c.top] + " on a " + NAMES[c.type].toLowerCase() : NAMES[c.type]) : "Empty deck"}`;
        if (c && c.type === "cannon") text += `, facing ${c.direction}`;
        if (c && MONSTER.has(c.type)) text += `, ${c.aX || 3} health (click it again to change)`;
        if (c && (c.type === "pressureplate" || c.type === "fuse")) {
            text += c.aX == null ? ", not linked" : ` → ${c.type === "fuse" ? "fires" : "opens"} (${c.aX}, ${c.aY})`;
        }
        const openers = [];
        board.forEach((row, yy) => row.forEach((o, xx) => {
            if (o && o.aX === x && o.aY === y) openers.push(`${o.type === "fuse" ? "fuse" : "plate"} at (${xx}, ${yy})`);
        }));
        if (openers.length) text += `. Controlled by ${openers.join(", ")}`;
        return text;
    }

    // ========== Tools ==========
    function buildToolbar() {
        $("tools").innerHTML = TOOLS.map(t => `
            <button class="tool" type="button" data-tool="${t.id}">
                <span class="icon ${t.sprite ? "" : "erase"}">${t.sprite ? `<i class="sp ${t.sprite}"></i>` : "✕"}</span>
                ${t.label}<kbd>${t.key}</kbd>
            </button>`).join("");
        $("tools").addEventListener("click", e => {
            const btn = e.target.closest("[data-tool]");
            if (btn) selectTool(btn.dataset.tool);
        });
    }

    function selectTool(id) {
        tool = id;
        document.querySelectorAll(".tool").forEach(b => b.classList.toggle("active", b.dataset.tool === id));
        cancelLink(false);
        if (id === "link") setStatus("Click a plate or fuse, then click what it should control.");
        else if (id === "cannon") setStatus("Click to place a cannon. Click a cannon again to turn it.");
        else if (MONSTER.has(id)) setStatus(`Painting: ${TOOLS.find(t => t.id === id).label} (health ${healthOf(id)}). Click one again to raise its health; it blocks like a wall until cannon fire uses its health up.`);
        else setStatus(`Painting: ${TOOLS.find(t => t.id === id).label}. Right-click to erase.`);
    }

    function startLink(x, y) {
        linking = { x, y };
        const isFuse = board[y][x].type === "fuse";
        setStatus(isFuse ? "Now click the cannon this fuse fires. (Esc to skip)"
                         : "Now click the tile this plate opens. It becomes a gate. (Esc to skip)", true);
    }

    function cancelLink(rerender = true) {
        if (!linking) return;
        linking = null;
        setStatus("Link skipped.");
        if (rerender) render();
    }

    function finishLink(x, y) {
        const src = board[linking.y][linking.x];
        if (!src || (linking.x === x && linking.y === y)) {
            cancelLink();
            return;
        }
        const target = board[y][x];
        if (src.type === "fuse" && (!target || target.type !== "cannon")) {
            setStatus("Fuses can only fire cannons. Click a cannon, or press Esc.", true);
            return;
        }
        if (src.type === "pressureplate" && target && target.type === "cannon") {
            setStatus("Plates open gates, not cannons. Click another tile, or press Esc.", true);
            return;
        }
        src.aX = x;
        src.aY = y;
        BlockedSound.play("link");
        const from = linking;
        linking = null;
        markDirty();
        render();
        setStatus(`Linked ${src.type === "fuse" ? "fuse" : "plate"} at (${from.x}, ${from.y}) to (${x}, ${y}).`);
    }

    function apply(x, y, dragging) {
        const cur = board[y][x];
        const t = tool;
        if (t === "erase" ? cur : t !== "link" && !(cur && cur.type === t && t !== "cannon")) {
            BlockedSound.play(t === "erase" ? "erase" : "place");
        }
        if (t === "erase") {
            if (!cur) return;
            eraseAt(x, y);
        } else if (t === "link") {
            if (cur && (cur.type === "pressureplate" || cur.type === "fuse")) startLink(x, y);
            else setStatus("Click a plate or fuse first.");
            render();
            return;
        } else if (t === "cannon") {
            if (cur && cur.type === "cannon") {
                if (dragging) return;
                cur.direction = TURN[cur.direction] || "up";
            } else {
                board[y][x] = { type: "cannon", direction: "up" };
            }
        } else if (MONSTER.has(t)) {
            if (cur && cur.type === t) {
                if (dragging) return;
                const hp = (cur.aX || 3) % MAX_HEALTH + 1;
                setHealth(t, hp);
                setStatus(`${NAMES[t]} health: ${hp}. Every crate shot into it costs one.`);
            } else {
                board[y][x] = { type: t, aX: healthOf(t), aY: null };
            }
        } else if (t === "player") {
            board.forEach(row => row.forEach((c, xx, r) => {
                if (c && c.type === "player") r[xx] = null;
                else if (c && c.top === "player") delete c.top;
            }));
            if (cur && FLOOR.has(cur.type)) cur.top = "player";
            else board[y][x] = { type: "player" };
        } else if (t === "pressureplate" || t === "fuse") {
            // Sliding a plate or fuse under a crate or the pirate keeps them on top.
            if (!cur || cur.type !== t) board[y][x] = { type: t, aX: null, aY: null, ...(cur && (TOPS.has(cur.type) || cur.top) ? { top: cur.top || cur.type } : {}) };
            markDirty();
            startLink(x, y);
            render();
            return;
        } else if (t === "box" && cur && FLOOR.has(cur.type)) {
            if (cur.top === "box") return;
            cur.top = "box";
        } else {
            if (cur && cur.type === t) return;
            board[y][x] = { type: t };
        }
        markDirty();
        render();
    }

    // Erasing a stacked cell takes the crate or pirate off the plate first.
    function eraseAt(x, y) {
        const cur = board[y][x];
        if (cur && cur.top) delete cur.top;
        else board[y][x] = null;
    }

    // ========== Mouse ==========
    function cellFrom(event) {
        const td = event.target.closest("td");
        if (!td || !table.contains(td)) return null;
        return { x: parseInt(td.dataset.x), y: parseInt(td.dataset.y) };
    }

    table.addEventListener("mousedown", e => {
        const pos = cellFrom(e);
        if (!pos) return;
        e.preventDefault();
        if (e.button === 2) {
            if (linking) { cancelLink(); return; }
            if (board[pos.y][pos.x]) { eraseAt(pos.x, pos.y); BlockedSound.play("erase"); markDirty(); render(); }
            painting = "erase";
            return;
        }
        if (e.button !== 0) return;
        if (linking) { finishLink(pos.x, pos.y); return; }
        apply(pos.x, pos.y, false);
        if (TOOLS.find(t => t.id === tool).drag) painting = tool;
    });

    table.addEventListener("mouseover", e => {
        const pos = cellFrom(e);
        if (!pos) return;
        if (painting === "erase" && tool !== "erase") {
            if (board[pos.y][pos.x]) { eraseAt(pos.x, pos.y); BlockedSound.play("erase"); markDirty(); render(); }
        } else if (painting) {
            apply(pos.x, pos.y, true);
        }
        if (!linking) setStatus(describe(pos.x, pos.y));
    });

    table.addEventListener("contextmenu", e => e.preventDefault());
    on(window, "mouseup", () => { painting = false; });

    // ========== Size ==========
    function clampSize(v) {
        const n = parseInt(v);
        if (Number.isNaN(n)) return null;
        return Math.max(MIN_SIZE, Math.min(MAX_SIZE, n));
    }

    function resize() {
        const w = clampSize(widthInput.value), h = clampSize(heightInput.value);
        if (w == null || h == null || (w === width && h === height)) return;
        const old = board;
        board = emptyBoard(w, h);
        for (let y = 0; y < Math.min(h, height); y++)
            for (let x = 0; x < Math.min(w, width); x++)
                board[y][x] = old[y][x];
        width = w;
        height = h;
        markDirty();
        render();
    }
    widthInput.addEventListener("change", () => { resize(); widthInput.value = width; });
    heightInput.addEventListener("change", () => { resize(); heightInput.value = height; });
    widthInput.addEventListener("input", resize);
    heightInput.addEventListener("input", resize);

    $("borderBtn").addEventListener("click", () => {
        for (let y = 0; y < height; y++)
            for (let x = 0; x < width; x++)
                if ((x === 0 || y === 0 || x === width - 1 || y === height - 1) && !board[y][x])
                    board[y][x] = { type: "wall" };
        markDirty();
        render();
    });

    $("clearBtn").addEventListener("click", () => {
        if (!confirm("Clear every tile off the board?")) return;
        board = emptyBoard(width, height);
        linking = null;
        markDirty();
        render();
    });

    $("showLinks").addEventListener("change", render);
    [nameInput, noteInput, publishedInput, campaignInput, positionInput].forEach(el => {
        if (el) el.addEventListener("input", markDirty);
    });

    // ========== Keyboard ==========
    on(document, "keydown", e => {
        if (!$("testModal").classList.contains("hidden")) {
            if (e.key === "Escape") closePlaytest();
            return;
        }
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
            e.preventDefault();
            save(false);
            return;
        }
        const t = e.target;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT") return;
        if (e.key === "Escape") { cancelLink(); return; }
        const match = TOOLS.find(x => x.key === e.key);
        if (match) selectTool(match.id);
        else if (e.key.toLowerCase() === "l") selectTool("link");
        else if (e.key.toLowerCase() === "e") selectTool("erase");
    });

    // ========== Playtest ==========
    let testGame = null;
    const testFormat = ms => (ms / 1000).toFixed(1) + "s";

    function openPlaytest() {
        const { errors } = findProblems();
        if (errors.length) {
            setStatus("Can't playtest yet: " + errors.join(" "));
            return;
        }
        $("testModal").classList.remove("hidden");
        $("testMsg").textContent = "Arrow keys or WASD to move, Z to undo, R to restart, Esc to go back to editing.";
        const testTable = $("testTable");
        const size = Blocked.fitTile(width, height, Math.min(1000, window.innerWidth - 120), window.innerHeight - 330, 16, 48);
        testTable.style.setProperty("--tile", size + "px");
        testTable.dataset.exitStyle = cfg.exitStyle || "chest";
        testGame = Blocked.startGame(testTable, toLevel(), {
            onSound: name => BlockedSound.play(name),
            onDeath: how => { $("testMsg").textContent = (how === "shot" ? "Blasted by a cannon!" : "Crushed by a gate!") + " The level restarts."; },
            onUpdate({ moves, ms }) {
                $("testMoves").textContent = moves;
                $("testTime").textContent = testFormat(ms);
            },
            onWin({ moves, ms }) {
                BlockedSound.play("win");
                $("testMsg").textContent = `Cleared in ${moves} moves (${testFormat(ms)}). It's beatable! Press R to try again or Esc to keep editing.`;
            },
        });
    }

    function closePlaytest() {
        if (testGame) testGame.destroy();
        testGame = null;
        $("testModal").classList.add("hidden");
    }

    $("testBtn").addEventListener("click", openPlaytest);
    $("testClose").addEventListener("click", closePlaytest);
    $("testReset").addEventListener("click", () => {
        if (testGame) testGame.reset();
        $("testMsg").textContent = "Arrow keys or WASD to move, Z to undo, R to restart, Esc to go back to editing.";
    });

    // ========== Saving ==========
    async function save(asCopy) {
        const published = asCopy ? false : publishedInput.checked;
        const errors = findProblems().errors;
        if (!nameInput.value.trim()) {
            $("saveState").textContent = "Give the level a name first.";
            nameInput.focus();
            return;
        }
        if (published && errors.length) {
            $("saveState").textContent = "Fix the red checks before publishing, or untick Published to save a draft.";
            return;
        }
        const body = {
            ...toLevel(),
            name: asCopy ? nameInput.value.trim() + " (copy)" : nameInput.value.trim(),
            notes: noteInput.value,
            published,
            in_campaign: campaignInput ? campaignInput.checked : false,
            position: positionInput ? parseInt(positionInput.value) || 0 : 0,
        };
        $("saveState").textContent = "Saving…";
        if (cfg.store) {
            // Standalone build: levels live in this browser.
            const result = cfg.store.save(body, asCopy ? null : levelId);
            if (!result.ok) { $("saveState").textContent = (result.errors || ["Couldn't save."]).join(" "); return; }
            levelId = result.id;
            if (asCopy) nameInput.value = body.name;
            dirty = false;
            BlockedSound.play("save");
            $("saveState").textContent = "Saved in this browser ✓";
            return;
        }
        const url = asCopy || !levelId ? cfg.createUrl : cfg.saveUrl;
        try {
            const res = await fetch(url, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            const result = await res.json();
            if (!result.ok) {
                $("saveState").textContent = (result.errors || ["Couldn't save."]).join(" ");
                return;
            }
            dirty = false;
            BlockedSound.play("save");
            if (asCopy || !levelId) {
                BlockedSound.go(result.editUrl);
                return;
            }
            $("saveState").textContent = "Saved ✓" + (result.recordsCleared ? " The layout changed, so this level's old records were cleared." : "");
        } catch (err) {
            $("saveState").textContent = "Couldn't reach the server. Your changes are still here; try again.";
        }
    }

    $("saveBtn").addEventListener("click", () => save(false));
    if ($("copyBtn")) $("copyBtn").addEventListener("click", () => save(true));

    on(window, "beforeunload", e => {
        if (dirty) {
            e.preventDefault();
            e.returnValue = "";
        }
    });

    // ========== Start ==========
    if (cfg.level) {
        loadLevel(cfg.level);
        nameInput.value = cfg.level.name;
        noteInput.value = cfg.level.notes || "";
        publishedInput.checked = !!cfg.level.published;
        if (campaignInput) campaignInput.checked = !!cfg.level.in_campaign;
        if (positionInput) positionInput.value = cfg.level.position;
    } else {
        loadLevel({ width: 12, height: 8, tiles: [] });
        if (campaignInput) campaignInput.checked = cfg.isAdmin;
        if (positionInput) positionInput.value = cfg.nextPosition;
    }
    widthInput.value = width;
    heightInput.value = height;

    buildToolbar();
    selectTool("wall");
    render();
    on(window, "resize", render);

    return {
        destroy() {
            cleanup.forEach(off => off());
            if (testGame) testGame.destroy();
        },
        get dirty() { return dirty; },
        level: () => ({ ...toLevel(), name: nameInput.value.trim(), notes: noteInput.value }),
    };
}

global.BlockedEditor = { start: startEditor };
document.addEventListener("DOMContentLoaded", () => {
    const data = document.getElementById("editorData");
    if (data) startEditor(JSON.parse(data.textContent));
});
})(window);
