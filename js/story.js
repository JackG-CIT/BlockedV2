// The story: animated pixel cutscenes and the voyage map.
//
// Shared by the website (templates/index.html) and the standalone build
// (static/standalone/standalone.js). The words come from story.py, which the
// page hands over as JSON; this file only draws. Call BlockedStory.init() first.
(function (global) {
    "use strict";

    let IMG = "img/";                       // where the sprites live
    let STORY = { chapters: [], parts: {}, cutscenes: {} };
    let SEEN_KEY = "blocked-story-seen";    // which cutscenes this player has watched

    function init(opts) {
        IMG = opts.imgBase || IMG;
        STORY = opts.story || STORY;
        SEEN_KEY = opts.seenKey || SEEN_KEY;
    }

    // ---------- remembered in the browser (it's fine if storage is blocked) ----------
    function seenAll() {
        try { return JSON.parse(localStorage.getItem(SEEN_KEY) || "{}") || {}; } catch (e) { return {}; }
    }
    const seen = id => !!seenAll()[id];
    function markSeen(id) {
        try { const s = seenAll(); s[id] = 1; localStorage.setItem(SEEN_KEY, JSON.stringify(s)); } catch (e) { /* storage blocked */ }
    }
    function remember(key, value) {
        try { if (value === undefined) return localStorage.getItem(key); localStorage.setItem(key, value); } catch (e) { return null; }
        return value;
    }

    function escapeHtml(text) {
        return String(text == null ? "" : text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
    }

    // =====================================================================
    // Cutscenes
    // =====================================================================
    // A cutscene is a few shots, each a drawing function plus a caption from
    // story.py. The canvas is 320x180 "pixels", scaled up with no smoothing.
    const W = 320, H = 180;
    const COL = {
        ink: "#1d1a1f", cream: "#f5efe0", gold: "#f6c84c", lamp: "#ffd36b", red: "#d33b36",
        wood: "#a86a32", woodDark: "#6e4119", woodDeep: "#4b2b12", hold: "#2a170a",
        sky: ["#0a1222", "#0f1b33", "#152846", "#1d3659"], sea: "#17508a", seaDark: "#123e6b", foam: "#cfeaff",
    };

    const sprites = {};
    function sprite(name) {
        if (!sprites[name]) { const im = new Image(); im.src = IMG + name + ".svg"; sprites[name] = im; }
        return sprites[name];
    }
    const loaded = im => im.complete && im.naturalWidth > 0;
    function draw(ctx, name, x, y, w, h, flip) {
        const im = sprite(name);
        if (!loaded(im)) return;
        x = Math.round(x); y = Math.round(y);
        if (flip) { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(im, 0, 0, w, h); ctx.restore(); }
        else ctx.drawImage(im, x, y, w, h);
    }
    // Rook's ship: the same ship sprite, darkened to iron and soot.
    let castle = null;
    function castleSprite() {
        const im = sprite("ship");
        if (castle || !loaded(im)) return castle;
        const c = document.createElement("canvas");
        c.width = 152; c.height = 116;
        const x = c.getContext("2d");
        x.drawImage(im, 0, 0, 152, 116);
        x.globalCompositeOperation = "source-atop";
        x.fillStyle = "rgba(28, 18, 40, 0.66)";
        x.fillRect(0, 0, 152, 116);
        return (castle = c);
    }

    function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    function seeded(n) { let s = n; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
    function disc(ctx, cx, cy, r, c) {
        for (let dy = -r; dy <= r; dy++) {
            const half = Math.floor(Math.sqrt(r * r - dy * dy));
            rect(ctx, cx - half, cy + dy, half * 2 + 1, 1, c);
        }
    }

    // ---------- scenery ----------
    const WATER = 128;   // the waterline in outdoor shots
    function nightSky(ctx, t) {
        const h = WATER / COL.sky.length;
        COL.sky.forEach((c, i) => rect(ctx, 0, i * h, W, h + 1, c));
        const r = seeded(11);
        for (let i = 0; i < 46; i++) {
            const x = r() * W, y = r() * (WATER - 30), on = Math.sin(t * 2.5 + i * 1.7) > 0.7;
            rect(ctx, x, y, 1, 1, on ? "#ffffff" : "rgba(207, 234, 255, 0.55)");
        }
        disc(ctx, 262, 26, 9, COL.cream);
        rect(ctx, 258, 22, 3, 2, "#e2d8c0");
        rect(ctx, 265, 29, 2, 2, "#e2d8c0");
    }
    function sea(ctx, t) {
        rect(ctx, 0, WATER, W, H - WATER, COL.sea);
        rect(ctx, 0, WATER + 26, W, H - WATER - 26, COL.seaDark);
        for (let row = 0; row < 8; row++) {
            const y = WATER + 3 + row * 6, speed = 6 + row * 2;
            for (let x = 0; x < W + 40; x += 34) {
                const xx = ((x + row * 13 + t * speed) % (W + 40)) - 20;
                rect(ctx, xx, y, 5 + (row % 3), 1, row < 4 ? "rgba(207, 234, 255, 0.7)" : "rgba(207, 234, 255, 0.35)");
            }
        }
        for (let i = 0; i < 6; i++) {   // the moon on the water
            const w = 8 - i + Math.round(Math.sin(t * 3 + i) * 2);
            rect(ctx, 262 - w / 2, WATER + 4 + i * 7, w, 1, "rgba(245, 239, 224, 0.6)");
        }
    }
    function fog(ctx, t, alpha, from = -60, to = W + 60) {
        if (alpha <= 0) return;
        for (let i = 0; i < 9; i++) {
            const span = to - from;
            const x = from + ((i * 53 + t * (5 + i % 3 * 3)) % span);
            const y = 52 + (i % 4) * 18;
            const c = `rgba(196, 208, 224, ${alpha * (0.22 + (i % 3) * 0.06)})`;
            rect(ctx, x, y, 90, 10, c);
            rect(ctx, x + 12, y - 6, 62, 6, c);
            rect(ctx, x + 26, y - 10, 32, 4, c);
        }
    }
    // Ships sit on the waterline and bob. The sprite is 76x58 with its hull bottom at y=54.
    function ship(ctx, x, t, phase, dark) {
        const y = WATER - 53 + Math.round(Math.sin(t * 2 + phase) * 1.2);
        if (dark) { const c = castleSprite(); if (c) ctx.drawImage(c, Math.round(x), y, 76, 58); }
        else draw(ctx, "ship", x, y, 76, 58);
        return y;
    }
    // A tiny sailor, 4x7. Knight wears a gold hat.
    function sailor(ctx, x, y, hat, t) {
        const step = Math.floor(t * 8) % 2;
        rect(ctx, x, y, 4, 2, hat);
        rect(ctx, x, y + 2, 4, 2, "#f2c39d");
        rect(ctx, x, y + 4, 4, 2, "#f5efe0");
        rect(ctx, x + (step ? 0 : 2), y + 6, 2, 1, COL.ink);
    }
    function pixelText(ctx, text, x, y, c) {   // for "Zzz" and "!"
        ctx.fillStyle = c;
        ctx.font = "10px 'Jersey 10', monospace";
        ctx.fillText(text, Math.round(x), Math.round(y));
    }

    // ---------- the intro ----------
    const INTRO = [
        { dur: 6, draw(ctx, t) {   // the White Knight at night
            nightSky(ctx, t);
            sea(ctx, t);
            const x = Math.min(122, -80 + t * 40);
            const y = ship(ctx, x, t, 0);
            if (Math.sin(t * 9) > -0.6) rect(ctx, x + 9, y + 26, 2, 2, COL.lamp);   // stern lantern
            fog(ctx, t, 0.35);
        } },
        { dur: 7, draw(ctx, t) {   // the Castle comes out of the fog, and fires
            const shake = t > 5 && t < 5.4 ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0;
            ctx.translate(shake, 0);
            nightSky(ctx, t);
            sea(ctx, t);
            ship(ctx, 196, t, 0);
            const cx = -90 + Math.min(t, 4.5) * 33;
            const cy = ship(ctx, cx, t, 1.3, true);
            fog(ctx, t, Math.max(0, 1 - t / 4.5), -60, 180);
            if (t > 5 && t < 5.25) { disc(ctx, cx + 74, cy + 36, 5, COL.lamp); disc(ctx, cx + 74, cy + 36, 2, "#ffffff"); }
            if (t > 5.1) {   // smoke drifting off
                const s = (t - 5.1) * 8;
                disc(ctx, cx + 78 + s, cy + 34 - s / 2, 3 + Math.min(4, s / 3), "rgba(200, 200, 210, 0.45)");
            }
            if (t > 5.4 && t < 6.6) {   // the shot lands short of the White Knight
                const h = Math.round(Math.sin((t - 5.4) / 1.2 * Math.PI) * 16);
                rect(ctx, 182, WATER - h, 4, h, COL.foam);
                rect(ctx, 179, WATER - 2, 10, 2, COL.foam);
            }
        } },
        { dur: 8, draw(ctx, t) {   // the crew dragged across, the White Knight towed away
            nightSky(ctx, t);
            sea(ctx, t);
            const drift = t > 5.2 ? (t - 5.2) * 26 : 0;
            const wx = 34 - drift, rx = 140 - drift;
            const wy = ship(ctx, wx, t, 0);
            const ry = ship(ctx, rx, t, 1.3, true);
            const deck = wy + 26;
            ctx.strokeStyle = COL.woodDeep;   // grappling lines, then the tow rope
            ctx.lineWidth = 1;
            ctx.beginPath();
            if (t < 5.2) { ctx.moveTo(wx + 66, deck); ctx.lineTo(rx + 8, ry + 26); }
            else { ctx.moveTo(wx + 74, wy + 22); ctx.lineTo(rx + 4, ry + 30); }
            ctx.stroke();
            for (let i = 0; i < 6; i++) {   // the crew, one by one, Knight last
                const start = i * 0.7, x = wx + 40 + Math.min((t - start) * 20, 78);
                if (t < start || x > rx + 30) continue;
                sailor(ctx, x, deck - 7, i === 5 ? COL.gold : COL.cream, t);
            }
            rect(ctx, rx + 28, ry + 19, 4, 7, COL.ink);   // a guard with a lantern
            if (Math.sin(t * 7) > -0.5) rect(ctx, rx + 32, ry + 21, 2, 2, COL.lamp);
            fog(ctx, t, Math.min(0.6, t / 10));
        } },
        { dur: 8, draw(ctx, t) {   // Pawn, asleep in a crate in the hold
            rect(ctx, 0, 0, W, H, COL.hold);
            for (let y = 6; y < H; y += 9) {
                rect(ctx, 0, y, W, 1, "rgba(0, 0, 0, 0.35)");
                for (let x = (y * 7) % 40; x < W; x += 40) rect(ctx, x, y - 8, 1, 8, "rgba(0, 0, 0, 0.25)");
            }
            rect(ctx, 0, 14, W, 6, COL.woodDeep);   // a beam
            rect(ctx, 0, H - 12, W, 12, COL.woodDark);   // the floor
            const swing = Math.sin(t * 1.4) * 16, lx = 160 + swing, ly = 52;
            ctx.strokeStyle = COL.ink;
            ctx.beginPath(); ctx.moveTo(160, 20); ctx.lineTo(lx, ly); ctx.stroke();
            for (let r = 80; r > 10; r -= 14) disc(ctx, lx, ly + 4, r, "rgba(255, 200, 110, 0.05)");
            rect(ctx, lx - 3, ly, 6, 8, COL.lamp);
            rect(ctx, lx - 4, ly - 1, 8, 2, COL.ink);
            const S = 24, floor = H - 12 - S;
            const stack = [[1, 0], [2, 0], [3, 0], [5, 0], [6, 0], [7, 0], [8, 0], [10, 0], [11, 0], [2, 1], [5, 1], [7, 1], [10, 1], [7, 2]];
            stack.forEach(([cx, cy]) => draw(ctx, "crate", cx * S, floor - cy * S, S, S));
            const px = 6 * S, py = floor - S;   // Pawn's crate
            const awake = t > 4.6, wobble = t > 2.6 && !awake ? (Math.floor(t * 9) % 2 ? 1 : -1) : 0;
            if (awake) {   // Pawn pops up, with the lid knocked off
                const rise = Math.min(1, (t - 4.6) / 0.4);
                ctx.save();
                ctx.beginPath(); ctx.rect(px, 0, S, py + 6); ctx.clip();
                draw(ctx, "pirate", px + 2, py + 10 - rise * 22, 20, 20);
                ctx.restore();
                const lid = Math.min(1, (t - 4.6) / 0.6);
                rect(ctx, px + 26 + lid * 10, py - 4 + lid * (lid - 0.6) * 40, 20, 4, COL.wood);
                if (t > 5.4 && Math.floor(t * 4) % 2) pixelText(ctx, "!", px + 10, py - 12, COL.gold);
            }
            draw(ctx, "crate", px + wobble, py, S, S);
            if (!awake) {
                for (let i = 0; i < 3; i++) {   // Zzz
                    const z = (t * 0.6 + i / 3) % 1;
                    pixelText(ctx, "z", px + 14 + z * 12, py - 4 - z * 22, `rgba(245, 239, 224, ${1 - z})`);
                }
            }
        } },
    ];

    // Scenes not drawn yet still play: their captions over a moonlit sea.
    const PLAIN = { dur: 5, draw(ctx, t) { nightSky(ctx, t); sea(ctx, t); ship(ctx, 122, t, 0); } };
    const SCENES = { intro: INTRO };

    const TYPE_SPEED = 38;   // characters a second
    const HOLD = 2.4;        // seconds a finished caption stays before moving on

    // Plays a cutscene over the page. Resolves when it ends (or is skipped).
    function play(id) {
        const shots = ((STORY.cutscenes[id] || {}).shots || []);
        const drawings = SCENES[id] || [];
        const count = Math.max(shots.length, drawings.length, 1);
        return new Promise(resolve => {
            const box = document.createElement("div");
            box.className = "cutscene";
            box.setAttribute("role", "dialog");
            box.setAttribute("aria-modal", "true");
            box.setAttribute("aria-label", "Story scene");
            box.innerHTML = `
                <div class="cutscene-stage"><canvas width="${W}" height="${H}"></canvas></div>
                <div class="cutscene-caption">
                    <p class="cutscene-text" aria-live="polite"></p>
                    <p class="cutscene-keys"><span class="cutscene-dots"></span><span><kbd>Space</kbd> next &middot; <kbd>Esc</kbd> skip</span></p>
                </div>
                <button class="btn small wood cutscene-skip" type="button">Skip &#9654;&#9654;</button>`;
            document.body.appendChild(box);
            const canvas = box.querySelector("canvas"), ctx = canvas.getContext("2d");
            const textEl = box.querySelector(".cutscene-text"), dotsEl = box.querySelector(".cutscene-dots");
            ctx.imageSmoothingEnabled = false;
            ["ship", "pirate", "crate"].forEach(sprite);

            let shot = 0, start = performance.now(), shown = -1, fullAt = null, raf = 0, over = false;
            const caption = () => shots[shot] || "";
            function showDots() {
                dotsEl.innerHTML = Array.from({ length: count }, (_, i) => `<i class="${i === shot ? "on" : i < shot ? "done" : ""}"></i>`).join("");
            }
            function next() {
                if (++shot >= count) return finish();
                start = performance.now(); shown = -1; fullAt = null;
                showDots();
            }
            function finish() {
                if (over) return;
                over = true;
                cancelAnimationFrame(raf);
                document.removeEventListener("keydown", onKey, true);
                markSeen(id);
                box.classList.add("closing");
                setTimeout(() => { box.remove(); resolve(); }, 350);
            }
            function advance() {
                if (fullAt == null) fullAt = (performance.now() - start) / 1000;   // finish the caption first
                else next();
            }
            function onKey(e) {
                // The scene has the keyboard while it plays: nothing reaches the game underneath.
                e.preventDefault();
                e.stopPropagation();
                if (e.repeat) return;
                if (e.key === "Escape") finish();
                else if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") advance();
            }
            document.addEventListener("keydown", onKey, true);
            box.addEventListener("click", e => { if (e.target.closest(".cutscene-skip")) finish(); else advance(); });

            function frame(now) {
                const t = (now - start) / 1000;
                const scene = drawings[Math.min(shot, drawings.length - 1)] || PLAIN;
                ctx.save();
                try { scene.draw(ctx, t); } catch (err) { /* a drawing bug shouldn't trap the player */ }
                ctx.restore();
                if (t < 0.6) rect(ctx, 0, 0, W, H, `rgba(0, 0, 0, ${1 - t / 0.6})`);
                const text = caption();
                const n = fullAt != null ? text.length : Math.max(0, Math.min(text.length, Math.floor((t - 0.4) * TYPE_SPEED)));
                if (n === text.length && fullAt == null) fullAt = t;
                if (n !== shown) { textEl.textContent = text.slice(0, n); shown = n; }
                if (fullAt != null && t - fullAt > HOLD && t > (scene.dur || 0)) next();
                if (!over) raf = requestAnimationFrame(frame);
            }
            showDots();
            raf = requestAnimationFrame(frame);
        });
    }

    // Plays a cutscene once per player. Resolves straight away if it's been seen.
    function playOnce(id) { return seen(id) ? Promise.resolve() : play(id); }

    // Any button with data-story-scene="intro" (re)plays that scene.
    document.addEventListener("click", e => {
        const b = e.target.closest("[data-story-scene]");
        if (b) { e.preventDefault(); play(b.dataset.storyScene); }
    });

    // =====================================================================
    // The voyage map
    // =====================================================================
    // chapters: [{ number, title, levels: [{ id, name, number, state, href? }] }]
    // state is "cleared", "open" or "locked". The first open, uncleared room is
    // where Pawn stands. Chapters in the "ship" part draw as decks of Rook's
    // ship (the first chapter at the bottom); "sea" chapters as stops on a chart.
    function renderMap(el, chapters) {
        const info = STORY.chapters || [];
        const withStory = chapters.map((ch, i) => ({ ...ch, ...(info[i] && info[i].title === ch.title ? info[i] : partOf(ch.title, i)), levels: ch.levels }));
        const current = (() => {
            for (const ch of withStory) for (const lv of ch.levels) if (lv.state === "open") return lv;
            return null;
        })();
        const ship = withStory.filter(c => c.part === "ship"), seaChs = withStory.filter(c => c.part !== "ship");
        let html = "";
        if (ship.length) html += part("ship", shipSvg(ship, current));
        if (seaChs.length) html += part("sea", chartSvg(seaChs, current));
        el.innerHTML = html;
        return current;
    }
    function partOf(title, i) {   // story for a chapter the page didn't send (shouldn't happen)
        const known = (STORY.chapters || []).find(c => c.title === title);
        return known || { part: i < 3 ? "ship" : "sea", place: "" };
    }
    function part(kind, svg) {
        const p = (STORY.parts || {})[kind] || {};
        return `<section class="map-part map-${kind}">
            <div class="map-part-head"><h3>${escapeHtml(p.title || "")}</h3><p>${escapeHtml(p.note || "")}</p></div>
            ${svg}</section>`;
    }

    // One room on the map. The chapter's last room (its finale) shows the chest.
    function node(lv, x, y, last, current, atSea) {
        const r = last || current ? 13 : 11;
        const locked = lv.state === "locked";
        const cls = `map-node ${lv.state}${last ? " finale" : ""}${current ? " current" : ""}`;
        const label = `${lv.number}. ${lv.name}${locked ? " (locked)" : lv.state === "cleared" ? " (cleared)" : ""}`;
        let inner = `<rect class="map-tile" x="${x - r}" y="${y - r}" width="${r * 2}" height="${r * 2}"/>`;
        if (current) inner += atSea
            ? `<image class="map-pawn" href="${IMG}ship.svg" x="${x - 12}" y="${y - 10}" width="25" height="19"/>`
            : `<image class="map-pawn" href="${IMG}pirate.svg" x="${x - 10}" y="${y - 10}" width="20" height="20"/>`;
        else if (locked) inner += `<image href="${IMG}lock.svg" x="${x - 7}" y="${y - 7}" width="14" height="14"/>`;
        else if (last) inner += `<image href="${IMG}chest.svg" x="${x - 10}" y="${y - 10}" width="20" height="20"/>`;
        else inner += `<text x="${x}" y="${y + 5}" text-anchor="middle">${lv.number}</text>`;
        if (lv.state === "cleared" && !last) inner += `<rect class="map-tick" x="${x + r - 6}" y="${y - r - 2}" width="8" height="8"/>`;
        const attrs = `class="${cls}" data-level="${escapeHtml(lv.id)}" data-index="${lv.number - 1}"`;
        const title = `<title>${escapeHtml(label)}</title>`;
        return locked
            ? `<g ${attrs} aria-label="${escapeHtml(label)}">${title}${inner}</g>`
            : `<a ${attrs} href="${escapeHtml(lv.href || "#")}" aria-label="Play ${escapeHtml(label)}">${title}${inner}</a>`;
    }
    function route(points, cls) {
        return points.length > 1 ? `<polyline class="${cls}" points="${points.map(p => p.join(",")).join(" ")}"/>` : "";
    }
    function svg(height, body, label) {
        return `<svg class="map-svg" viewBox="0 0 320 ${height}" role="img" aria-label="${escapeHtml(label)}" shape-rendering="crispEdges">${body}</svg>`;
    }

    // Rook's ship in cross-section: one deck per chapter, climbing upward.
    function shipSvg(chs, current) {
        const DECK = 50, TOP = 86, n = chs.length, height = TOP + n * DECK + 40;
        let body = `<rect class="map-night" x="0" y="0" width="320" height="${height}"/>`;
        // masts, sails and Rook's flag
        [[112, 46], [214, 40]].forEach(([mx, w], i) => {
            body += `<rect class="map-mast" x="${mx - 2}" y="${i ? 18 : 4}" width="4" height="${TOP - (i ? 18 : 4)}"/>`;
            body += `<rect class="map-sail" x="${mx - w / 2}" y="${i ? 24 : 12}" width="${w}" height="20"/><rect class="map-sail-stripe" x="${mx - w / 2}" y="${i ? 32 : 20}" width="${w}" height="3"/>`;
            body += `<rect class="map-sail" x="${mx - w / 2 - 6}" y="${i ? 48 : 38}" width="${w + 12}" height="24"/><rect class="map-sail-stripe" x="${mx - w / 2 - 6}" y="${i ? 58 : 48}" width="${w + 12}" height="3"/>`;
        });
        body += `<rect class="map-flag" x="114" y="0" width="18" height="11"/><rect class="map-flag-skull" x="121" y="3" width="4" height="4"/>`;
        body += `<rect class="map-rail" x="14" y="${TOP - 8}" width="292" height="8"/>`;
        const points = [], nodes = [];
        chs.forEach((ch, c) => {
            const j = n - 1 - c;                  // row from the top; the first chapter is the lowest deck
            const y = TOP + j * DECK, inset = 14 + j * 7;
            const dim = ch.levels.every(lv => lv.state === "locked") ? " dim" : "";
            body += `<g class="map-deck${dim}" id="map-chapter-${ch.number}">`;
            body += `<rect class="map-hull" x="${inset}" y="${y}" width="${320 - inset * 2}" height="${DECK}"/>`;
            body += `<rect class="map-room" x="${inset + 6}" y="${y + 4}" width="${320 - inset * 2 - 12}" height="${DECK - 10}"/>`;
            body += `<rect class="map-beam" x="${inset}" y="${y + DECK - 6}" width="${320 - inset * 2}" height="6"/>`;
            body += `<text class="map-label" x="${inset + 12}" y="${y + 15}">${ch.number}. ${escapeHtml(ch.title)}</text>`;
            if (ch.place) body += `<text class="map-place" x="${320 - inset - 12}" y="${y + 15}" text-anchor="end">${escapeHtml(ch.place)}</text>`;
            body += `</g>`;
            const k = ch.levels.length, left = inset + 26, right = 320 - inset - 26;
            ch.levels.forEach((lv, i) => {
                const f = k > 1 ? i / (k - 1) : 0.5;
                const x = Math.round(c % 2 ? right - f * (right - left) : left + f * (right - left));
                const ny = y + 31;
                points.push([x, ny]);
                nodes.push(node(lv, x, ny, i === k - 1, lv === current, false));
            });
        });
        const keel = TOP + n * DECK, kinset = 14 + n * 7;
        body += `<rect class="map-keel" x="${kinset}" y="${keel}" width="${320 - kinset * 2}" height="12"/>`;
        body += `<rect class="map-keel" x="${kinset + 16}" y="${keel + 12}" width="${320 - kinset * 2 - 32}" height="6"/>`;
        body += `<text class="map-name" x="160" y="${keel + 9}" text-anchor="middle">THE CASTLE</text>`;
        body += route(points, "map-ladder") + nodes.join("");
        const water = TOP + n * DECK - 5;   // just below the lowest deck's rooms
        body += `<rect class="map-water" x="0" y="${water}" width="320" height="${height - water}"/>`;
        for (let x = 4; x < 320; x += 22) body += `<rect class="map-wave" x="${x}" y="${water}" width="9" height="2"/>`;
        return svg(height, body, "Map of Rook's ship, one deck per chapter");
    }

    // The ocean chart: each chapter a stop along a dotted route to the X.
    function chartSvg(chs, current) {
        const LEG = 104, TOP = 18, height = TOP + chs.length * LEG + 50;
        let body = `<rect class="map-parch" x="0" y="0" width="320" height="${height}"/>`;
        for (let y = 10; y < height; y += 14) for (let x = (y * 3) % 40; x < 320; x += 40) body += `<rect class="map-ripple" x="${x}" y="${y}" width="6" height="1"/>`;
        body += compass(286, 30);
        const points = [], nodes = [];
        chs.forEach((ch, c) => {
            const y0 = TOP + c * LEG, side = c % 2;     // islands alternate left and right
            const ix = side ? 236 : 84;
            body += island(ix, y0 + 26, c);
            const dim = ch.levels.every(lv => lv.state === "locked") ? " dim" : "";
            body += `<g class="map-stop${dim}" id="map-chapter-${ch.number}">`;
            body += `<text class="map-label" x="${side ? 196 : 124}" y="${y0 + 22}" text-anchor="${side ? "end" : "start"}">${ch.number}. ${escapeHtml(ch.title)}</text>`;
            if (ch.place) body += `<text class="map-place" x="${side ? 196 : 124}" y="${y0 + 34}" text-anchor="${side ? "end" : "start"}">${escapeHtml(ch.place)}</text>`;
            body += `</g>`;
            const k = ch.levels.length, left = 28, right = 292;
            ch.levels.forEach((lv, i) => {
                const f = k > 1 ? i / (k - 1) : 0.5;
                const x = Math.round(c % 2 ? right - f * (right - left) : left + f * (right - left));
                const y = Math.round(y0 + 70 + Math.sin(i * 1.4 + c) * 9);
                points.push([x, y]);
                nodes.push(node(lv, x, y, i === k - 1, lv === current, true));
            });
        });
        const end = points[points.length - 1];
        if (end) {
            const [x, y] = [end[0] + (end[0] > 160 ? -30 : 30), end[1] + 34];
            points.push([x, y]);
            body += `<g class="map-x"><rect x="${x - 13}" y="${y - 3}" width="26" height="6" transform="rotate(45 ${x} ${y})"/><rect x="${x - 13}" y="${y - 3}" width="26" height="6" transform="rotate(-45 ${x} ${y})"/></g>`;
        }
        body += route(points, "map-route") + nodes.join("");
        return svg(height, body, "Chart of the voyage to the treasure");
    }
    function island(x, y, seed) {
        const r = seeded(seed + 3), rows = [[-22, 22], [-30, 30], [-34, 32], [-28, 30], [-18, 20]];
        let out = "";
        rows.forEach(([a, b], i) => {
            const j = Math.round(r() * 4) - 2;
            out += `<rect class="map-sand" x="${x + a + j}" y="${y - 10 + i * 5}" width="${b - a}" height="5"/>`;
            if (i > 0 && i < 4) out += `<rect class="map-grass" x="${x + a + j + 5}" y="${y - 10 + i * 5}" width="${b - a - 10}" height="5"/>`;
        });
        out += `<rect class="map-palm" x="${x - 1}" y="${y - 22}" width="3" height="14"/><rect class="map-grass" x="${x - 7}" y="${y - 24}" width="15" height="3"/>`;
        return out;
    }
    function compass(x, y) {
        return `<g class="map-compass"><rect x="${x - 1}" y="${y - 14}" width="3" height="28"/><rect x="${x - 14}" y="${y - 1}" width="28" height="3"/>
            <rect class="map-compass-n" x="${x - 1}" y="${y - 14}" width="3" height="10"/><text x="${x + 1}" y="${y - 17}" text-anchor="middle">N</text></g>`;
    }
    // ---------- Map / List switch ----------
    // buttons: elements with data-view="map" / "list". Remembers the choice.
    function viewSwitch({ buttons, map, list, key, onChange }) {
        function set(view, save) {
            map.classList.toggle("hidden", view !== "map");
            list.classList.toggle("hidden", view !== "list");
            buttons.forEach(b => { b.classList.toggle("active", b.dataset.view === view); b.setAttribute("aria-pressed", String(b.dataset.view === view)); });
            if (save) remember(key, view);
            if (onChange) onChange(view);
        }
        buttons.forEach(b => b.addEventListener("click", () => set(b.dataset.view, true)));
        set(remember(key) === "list" ? "list" : "map", false);
        return set;
    }

    global.BlockedStory = { init, play, playOnce, seen, renderMap, viewSwitch };
})(window);
