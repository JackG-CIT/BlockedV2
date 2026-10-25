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
    // The player can switch story scenes off in the speaker menu (soundmenu.js): then no
    // cutscene or chapter card plays by itself. "Watch again" buttons still play them.
    function scenesOn() {
        try { return localStorage.getItem("blocked-scenes") !== "off"; } catch (e) { return true; }
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
    // A cutscene is a run of shots that plays straight through, full screen, with
    // no narration: the characters' own lines (from story.py) pop up in speech
    // bubbles. Any key or a tap skips it. The canvas is 180 "pixels" tall and as
    // wide as the screen's shape needs (320 to 420), scaled up with no smoothing.
    // Scenes are drawn for a 320-wide stage centred in that.
    const H = 180, STAGE = 320;
    const RES = 3;            // drawn at 3x detail, so words and sprites stay crisp when scaled up
    let VW = STAGE, OX = 0;   // the canvas width, and how far the stage sits from its left edge
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
    function draw(ctx, name, x, y, w, h) {
        const im = sprite(name);
        if (loaded(im)) ctx.drawImage(im, Math.round(x), Math.round(y), w, h);
    }
    // Rook's ship: the same ship sprite, darkened to iron and soot.
    let castle = null;
    function castleSprite() {
        const im = sprite("ship");
        if (castle || !loaded(im)) return castle;
        const c = document.createElement("canvas");
        c.width = 76 * RES; c.height = 58 * RES;
        const x = c.getContext("2d");
        x.drawImage(im, 0, 0, c.width, c.height);
        x.globalCompositeOperation = "source-atop";
        x.fillStyle = "rgba(28, 18, 40, 0.66)";
        x.fillRect(0, 0, c.width, c.height);
        return (castle = c);
    }

    function rect(ctx, x, y, w, h, c) { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h)); }
    const full = (ctx, y, h, c) => rect(ctx, -OX, y, VW, h, c);   // a band right across the screen
    function seeded(n) { let s = n; return () => ((s = (s * 9301 + 49297) % 233280) / 233280); }
    function disc(ctx, cx, cy, r, c) {
        for (let dy = -r; dy <= r; dy++) {
            const half = Math.floor(Math.sqrt(r * r - dy * dy));
            rect(ctx, cx - half, cy + dy, half * 2 + 1, 1, c);
        }
    }
    const between = (t, a, b) => t >= a && t < b;

    // ---------- scenery ----------
    const WATER = 128;   // the waterline in outdoor shots
    function nightSky(ctx, t) {
        const h = WATER / COL.sky.length;
        COL.sky.forEach((c, i) => full(ctx, i * h, h + 1, c));
        const r = seeded(11);
        for (let i = 0; i < 60; i++) {
            const x = -OX + r() * VW, y = r() * (WATER - 30), on = Math.sin(t * 2.5 + i * 1.7) > 0.7;
            rect(ctx, x, y, 1, 1, on ? "#ffffff" : "rgba(207, 234, 255, 0.55)");
        }
        disc(ctx, 262, 26, 9, COL.cream);
        rect(ctx, 258, 22, 3, 2, "#e2d8c0");
        rect(ctx, 265, 29, 2, 2, "#e2d8c0");
    }
    function sea(ctx, t, glint = "rgba(245, 239, 224, 0.6)") {   // glint: the moon (or sun) on the water
        full(ctx, WATER, H - WATER, COL.sea);
        full(ctx, WATER + 26, H - WATER - 26, COL.seaDark);
        for (let row = 0; row < 8; row++) {
            const y = WATER + 3 + row * 6, speed = 6 + row * 2;
            for (let x = 0; x < VW + 40; x += 34) {
                const xx = -OX + ((x + row * 13 + t * speed) % (VW + 40)) - 20;
                rect(ctx, xx, y, 5 + (row % 3), 1, row < 4 ? "rgba(207, 234, 255, 0.7)" : "rgba(207, 234, 255, 0.35)");
            }
        }
        for (let i = 0; glint && i < 6; i++) {   // the moon on the water
            const w = 8 - i + Math.round(Math.sin(t * 3 + i) * 2);
            rect(ctx, 262 - w / 2, WATER + 4 + i * 7, w, 1, glint);
        }
    }
    function fog(ctx, t, alpha, from = -OX - 60, to = VW - OX + 60) {
        if (alpha <= 0) return;
        for (let i = 0; i < 11; i++) {
            const x = from + ((i * 53 + t * (5 + i % 3 * 3)) % (to - from));
            const y = 52 + (i % 4) * 18;
            const c = `rgba(196, 208, 224, ${alpha * (0.22 + (i % 3) * 0.06)})`;
            rect(ctx, x, y, 90, 10, c);
            rect(ctx, x + 12, y - 6, 62, 6, c);
            rect(ctx, x + 26, y - 10, 32, 4, c);
        }
    }
    // Ships sit on the waterline and bob. The sprite is 76x58; its deck is about 26 down.
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
    // Captain Rook: bigger, a black tricorn and a red coat.
    function rook(ctx, x, y, t) {
        const sway = Math.floor(t * 3) % 2;
        rect(ctx, x - 1, y, 8, 2, COL.ink);
        rect(ctx, x + 1, y - 1, 4, 1, COL.ink);
        rect(ctx, x, y + 2, 6, 3, "#f2c39d");
        rect(ctx, x, y + 5, 6, 4, COL.red);
        rect(ctx, x + 6, y + 5 - sway, 2, 2, COL.red);   // waving his arm
        rect(ctx, x, y + 9, 2, 1, COL.ink);
        rect(ctx, x + 4, y + 9, 2, 1, COL.ink);
    }

    // ---------- words inside the animation ----------
    // A speech bubble above (x, y), the point of its tail. Rook's are dark, with red words.
    function bubble(ctx, text, x, y, villain) {
        if (!text) return;
        ctx.font = "10px 'Jersey 10', monospace";
        const w = Math.ceil(ctx.measureText(text).width) + 8, h = 13;
        const bx = Math.round(Math.max(-OX + 2, Math.min(VW - OX - w - 2, x - w / 2))), by = Math.round(y - h - 4);
        const bg = villain ? COL.ink : COL.cream, fg = villain ? "#ff6b5e" : COL.ink;
        rect(ctx, bx - 1, by - 1, w + 2, h + 2, villain ? COL.red : COL.ink);
        rect(ctx, bx, by, w, h, bg);
        rect(ctx, x - 1, by + h, 3, 2, bg);   // the tail
        rect(ctx, x, by + h + 2, 1, 2, bg);
        ctx.fillStyle = fg;
        ctx.textBaseline = "alphabetic";
        ctx.fillText(text, bx + 4, by + 10);
    }
    function shout(ctx, text, x, y, c) {   // a sound in the scene, like BOOM
        if (!text) return;
        ctx.font = "12px 'Jersey 10', monospace";
        ctx.fillStyle = COL.ink;
        ctx.fillText(text, Math.round(x) + 1, Math.round(y) + 1);
        ctx.fillStyle = c;
        ctx.fillText(text, Math.round(x), Math.round(y));
    }

    // No speech bubbles, sound words or titles in any scene (the user's call): the
    // pictures tell it. Set to false to draw story.py's lines again.
    const WORDLESS = true;

    // The logo's letters (art/make_sprites.py GLYPHS), for the crates in the hold.
    const GLYPHS = {
        B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
        L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
        O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
        C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
        K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
        E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
        D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
    };

    // Fire on a ship's hull: a few flickering flames.
    function flames(ctx, x, y, t) {
        for (let i = 0; i < 3; i++) {
            const h = 3 + Math.round((Math.sin(t * 13 + i * 2.1) + 1) * 2);
            rect(ctx, x + i * 5, y - h, 3, h, i % 2 ? COL.lamp : "#ff8a1e");
            rect(ctx, x + i * 5 + 1, y - h - 1, 1, 1, "#ffd84a");
        }
    }

    // ---------- the intro ----------
    // Each shot gets its lines from story.py: say(key) is that shot's line for key.
    const INTRO = [
        { dur: 5.5, draw(ctx, t, say) {   // the White Knight, homeward bound at night
            nightSky(ctx, t);
            sea(ctx, t);
            const x = Math.min(122, -80 + t * 44);
            const y = ship(ctx, x, t, 0);
            if (Math.sin(t * 9) > -0.6) rect(ctx, x + 9, y + 26, 2, 2, COL.lamp);   // stern lantern
            sailor(ctx, x + 44, y + 19, COL.cream, 0);
            fog(ctx, t, 0.35);
            if (between(t, 2.4, 5.2)) bubble(ctx, say("sailor"), x + 46, y + 17);
        } },
        { dur: 7.5, draw(ctx, t, say) {   // the Castle comes out of the fog, and fires
            const shake = between(t, 5.6, 6) ? (Math.floor(t * 30) % 2 ? 1 : -1) : 0;
            ctx.translate(shake, 0);
            nightSky(ctx, t);
            sea(ctx, t);
            const wy = ship(ctx, 196, t, 0);
            sailor(ctx, 240, wy + 19, COL.cream, 0);
            const cx = -90 + Math.min(t, 4.2) * 36;
            const cy = ship(ctx, cx, t, 1.3, true);
            if (t > 3.6) rook(ctx, cx + 30, cy + 16, t);
            fog(ctx, t, Math.max(0, 1 - t / 4.2), -OX - 60, 180);
            if (between(t, 2.2, 4)) bubble(ctx, say("lookout"), 242, wy + 17);
            if (between(t, 4, 5.6)) bubble(ctx, say("rook"), cx + 33, cy + 14, true);
            if (between(t, 5.6, 5.85)) { disc(ctx, cx + 74, cy + 36, 6, COL.lamp); disc(ctx, cx + 74, cy + 36, 2, "#ffffff"); }
            if (t > 5.7) {   // smoke drifting off
                const s = (t - 5.7) * 8;
                disc(ctx, cx + 78 + s, cy + 34 - s / 2, 3 + Math.min(4, s / 3), "rgba(200, 200, 210, 0.45)");
            }
            if (between(t, 5.6, 6.8)) shout(ctx, say("boom"), cx + 66, cy + 22, COL.lamp);
            if (between(t, 5.9, 6.3)) {   // the shot strikes the White Knight
                disc(ctx, 214, wy + 40, 7, COL.lamp);
                disc(ctx, 214, wy + 40, 3, "#ffffff");
            }
            if (t > 6.2) flames(ctx, 208, wy + 44, t);
        } },
        { dur: 10, draw(ctx, t, say) {   // the crew dragged across, Pawn smuggled over in a crate, the White Knight sunk
            nightSky(ctx, t);
            sea(ctx, t);
            const cut = 6.4;                                  // the grappling lines are cut
            const away = t > cut ? (t - cut) * 26 : 0;        // the Castle sails off
            const sink = t > cut ? (t - cut) * 8 : 0;         // and the White Knight goes down by the stern
            const wx = 34, rx = 140 + away;
            ctx.save();
            ctx.beginPath(); ctx.rect(-OX, 0, VW, WATER + 1); ctx.clip();   // nothing shows below the waterline
            ctx.translate(wx + 70, WATER);
            ctx.rotate(-Math.min(0.3, sink / 70));
            ctx.translate(-(wx + 70), -WATER + sink);
            const wy = ship(ctx, wx, t, 0);
            if (sink < 30) flames(ctx, wx + 18, wy + 44, t);
            ctx.restore();
            const ry = ship(ctx, rx, t, 1.3, true);
            const deck = wy + 26;
            if (t < cut) {   // the grappling line
                ctx.strokeStyle = COL.woodDeep;
                ctx.lineWidth = 1;
                ctx.beginPath(); ctx.moveTo(wx + 66, deck); ctx.lineTo(rx + 8, ry + 26); ctx.stroke();
            }
            // The crew, one by one (Knight last): over the side, hauled through the water
            // on a line, and up the Castle's hull.
            for (let i = 0; i < 6 && t < cut; i++) {
                const hat = i === 5 ? COL.gold : COL.cream;
                const u = t - (0.6 + i * 0.55);
                if (u < 0) continue;
                const rail = wx + 66, side = rx + 6, swim = WATER - 4;
                if (u < 0.5) sailor(ctx, wx + 44 + (rail - wx - 44) * u / 0.5, deck - 7, hat, t);          // to the rail
                else if (u < 0.8) sailor(ctx, rail + (u - 0.5) * 10, deck - 7 + (swim - deck + 7) * ((u - 0.5) / 0.3) ** 2, hat, t);   // over the side
                else if (u < 2.0) {   // hauled through the water: just a head bobbing, and a splash
                    const x = rail + 3 + (side - rail - 3) * (u - 0.8) / 1.2, bob = Math.round(Math.sin(u * 9) * 0.6);
                    rect(ctx, x, swim + bob, 4, 2, hat);
                    rect(ctx, x, swim + 2 + bob, 4, 2, "#f2c39d");
                    rect(ctx, x - 2, WATER, 8, 1, COL.foam);
                    ctx.strokeStyle = COL.woodDeep; ctx.lineWidth = 1;   // the line they're hauled on
                    ctx.beginPath(); ctx.moveTo(x + 4, swim + 3); ctx.lineTo(side + 2, ry + 26); ctx.stroke();
                } else if (u < 2.6) sailor(ctx, side, swim - (swim - (ry + 19)) * (u - 2.0) / 0.6, hat, t);   // up the hull
            }
            // Pawn (red bandana) hops into a crate of plunder, which Rook's crew haul across.
            const k = Math.max(0, Math.min(1, (t - 2.2) / 3.6));
            const cx = wx + 58 + (rx + 14 - (wx + 58)) * k, cy = deck - 7 + (ry + 20 - (deck - 7)) * k - Math.sin(k * Math.PI) * 6;
            if (t < 1.6) sailor(ctx, wx + 48 + t * 5, deck - 7, COL.red, t);
            else if (t < 2.0) sailor(ctx, wx + 56, deck - 9 - Math.sin((t - 1.6) / 0.4 * Math.PI) * 5, COL.red, t);
            if (k < 1) {
                rect(ctx, cx, cy, 8, 7, COL.wood);
                rect(ctx, cx, cy, 8, 1, COL.woodDeep);
                rect(ctx, cx + 3, cy + 1, 1, 6, COL.woodDeep);
                if (t > 2.0 && Math.floor(t * 2) % 3 === 0) rect(ctx, cx + 2, cy - 2, 4, 2, COL.red);   // a peek
            }
            rook(ctx, rx + 30, ry + 16, t);
            if (t > cut) {   // bubbles where she went down
                const r = seeded(Math.floor(t * 6));
                for (let i = 0; i < 4; i++) disc(ctx, wx + 20 + r() * 50, WATER + 1 - r() * 3, 1, COL.foam);
            }
            // Things are going badly: a red alarm glow pulses over the scene.
            if (t < cut) full(ctx, 0, H, `rgba(211, 59, 54, ${0.06 + Math.max(0, Math.sin(t * 5)) * 0.06})`);
            fog(ctx, t, Math.min(0.6, t / 10));
        } },
        { dur: 9, draw(ctx, t, say) {   // Pawn, asleep in a crate in the hold: the crates spell BLOCKED
            full(ctx, 0, H, COL.hold);
            for (let y = 6; y < H; y += 9) {
                full(ctx, y, 1, "rgba(0, 0, 0, 0.35)");
                for (let x = -OX + (y * 7) % 40; x < VW - OX; x += 40) rect(ctx, x, y - 8, 1, 8, "rgba(0, 0, 0, 0.25)");
            }
            full(ctx, 14, 6, COL.woodDeep);   // a beam
            full(ctx, H - 26, 26, COL.woodDark);   // the floor (high enough to clear the skip hint)
            const swing = Math.sin(t * 1.4) * 16, lx = 160 + swing, ly = 52;
            ctx.strokeStyle = COL.ink;
            ctx.beginPath(); ctx.moveTo(160, 20); ctx.lineTo(lx, ly); ctx.stroke();
            for (let r = 80; r > 10; r -= 14) disc(ctx, lx, ly + 4, r, "rgba(255, 200, 110, 0.05)");
            rect(ctx, lx - 3, ly, 6, 8, COL.lamp);
            rect(ctx, lx - 4, ly - 1, 8, 2, COL.ink);
            // The crates in the hold are stacked to spell BLOCKED (the logo's letters), and
            // Pawn pops out of the top of the O. Then the crates glow gold: that's the title.
            const S = 6, GW = 5, GAP = 2, word = "BLOCKED";
            const across = word.length * GW + (word.length - 1) * GAP;
            const x0 = Math.round(160 - across * S / 2), top = H - 26 - 7 * S;
            const glow = Math.max(0, Math.min(1, (t - 6.2) / 1.2));
            const px = x0 + (2 * (GW + GAP) + 2) * S, py = top;   // Pawn's crate: the top of the O
            const awake = t > 4.6, wobble = t > 2.6 && !awake ? (Math.floor(t * 9) % 2 ? 1 : -1) : 0;
            [...word].forEach((letter, i) => GLYPHS[letter].forEach((row, y) => [...row].forEach((c, x) => {
                if (c !== "#") return;
                const cx = x0 + (i * (GW + GAP) + x) * S, cy = top + y * S;
                if (cx === px && cy === py) return;
                draw(ctx, "crate", cx, cy, S, S);
                if (glow) rect(ctx, cx, cy, S, S, `rgba(246, 200, 76, ${glow * (y < 2 ? 0.75 : 0.6)})`);
            })));
            if (awake) {   // Pawn pops up, with the lid knocked off
                const rise = Math.min(1, (t - 4.6) / 0.4);
                ctx.save();
                ctx.beginPath(); ctx.rect(px - 6, 0, S + 12, py + 2); ctx.clip();
                draw(ctx, "pirate", px - 3, py + 2 - rise * 12, 12, 12);
                ctx.restore();
                const lid = Math.min(1, (t - 4.6) / 0.6);
                rect(ctx, px + 6 + lid * 10, py - 2 - Math.sin(lid * Math.PI) * 8 + lid * (H - 28 - py), 7, 2, COL.wood);   // the lid lands on the floor
                if (between(t, 5.1, 6.1)) shout(ctx, "!", px + 1, py - 14, COL.gold);
            }
            draw(ctx, "crate", px + wobble, py, S, S);
            if (glow) rect(ctx, px + wobble, py, S, S, `rgba(246, 200, 76, ${glow * 0.75})`);
            if (!awake) {
                ctx.font = "10px 'Jersey 10', monospace";
                for (let i = 0; i < 3; i++) {   // Zzz
                    const z = (t * 0.6 + i / 3) % 1;
                    ctx.fillStyle = `rgba(245, 239, 224, ${1 - z})`;
                    ctx.fillText("z", Math.round(px + 4 + z * 12), Math.round(py - 2 - z * 22));
                }
            }
        } },
    ];

    // ---------- more scenery for the later scenes ----------
    // A sky in bands of colour, top to bottom, with an optional sun low on the horizon.
    function bandSky(ctx, colors, sun) {
        const h = WATER / colors.length;
        colors.forEach((c, i) => full(ctx, i * h, h + 1, c));
        if (sun) { disc(ctx, sun[0], sun[1], sun[2], sun[3]); disc(ctx, sun[0], sun[1], sun[2] - 3, "rgba(255, 255, 255, 0.35)"); }
    }
    const DAWN = ["#3b2a55", "#7a3f62", "#c8645a", "#f0a060"];
    const DAY = ["#4f86c6", "#6a9fd6", "#8db8e4", "#b5d3ee"];
    const BLOOD = ["#2a0d18", "#4d1420", "#7a2228", "#a8402e"];
    // A ship sprite darkened (or blackened) to any size, drawn once and kept.
    const tints = {};
    function tinted(color, w, h) {
        const key = color + w + "x" + h, im = sprite("ship");
        if (tints[key] || !loaded(im)) return tints[key];
        const c = document.createElement("canvas");
        c.width = w * RES; c.height = h * RES;
        const x = c.getContext("2d");
        x.drawImage(im, 0, 0, c.width, c.height);
        x.globalCompositeOperation = "source-atop";
        x.fillStyle = color;
        x.fillRect(0, 0, c.width, c.height);
        return (tints[key] = c);
    }
    // The Black Queen: Rook's flagship, half again as big as the Castle and nearly black.
    function blackQueen(ctx, x, t, angle = 0, sink = 0) {
        const c = tinted("rgba(12, 6, 18, 0.84)", 114, 87);
        if (!c) return WATER - 80;
        const y = WATER - 80 + Math.round(Math.sin(t * 1.6) * 1.5) + sink;
        ctx.save();
        ctx.translate(Math.round(x + 57), y + 60);
        ctx.rotate(angle);
        ctx.drawImage(c, -57, -60, 114, 87);
        ctx.restore();
        return y;
    }
    // Rook's jolly boat, with heads poking out of it and oars going.
    function boat(ctx, x, y, hats, t, rowing) {
        hats.forEach((hat, i) => { rect(ctx, x + 4 + i * 5, y - 4, 4, 2, hat); rect(ctx, x + 4 + i * 5, y - 2, 4, 2, "#f2c39d"); });
        rect(ctx, x, y, 32, 3, COL.wood);
        rect(ctx, x + 2, y + 3, 28, 2, COL.woodDark);
        rect(ctx, x + 5, y + 5, 22, 1, COL.woodDeep);
        if (rowing) {   // an oar each side, sweeping back and forth in the water
            const o = Math.round(Math.sin(t * 7) * 3);
            ctx.strokeStyle = COL.woodDeep; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x + 8, y); ctx.lineTo(x - 2 + o, y + 6);
            ctx.moveTo(x + 24, y); ctx.lineTo(x + 34 + o, y + 6);
            ctx.stroke();
        }
    }
    function splash(ctx, x, t0, t, height = 16) {
        if (!between(t, t0, t0 + 1.1)) return;
        const h = Math.round(Math.sin((t - t0) / 1.1 * Math.PI) * height);
        rect(ctx, x, WATER - h, 4, h, COL.foam);
        rect(ctx, x - 3, WATER - 2, 10, 2, COL.foam);
    }
    function flash(ctx, x, y, t, t0) {
        if (between(t, t0, t0 + 0.25)) { disc(ctx, x, y, 6, COL.lamp); disc(ctx, x, y, 2, "#ffffff"); }
        if (t > t0 + 0.1 && t < t0 + 3) {
            const s = (t - t0) * 8;
            disc(ctx, x + 4 + s, y - 2 - s / 2, 3 + Math.min(4, s / 3), "rgba(200, 200, 210, 0.45)");
        }
    }
    function shake(ctx, t, t0) { if (between(t, t0, t0 + 0.4)) ctx.translate(Math.floor(t * 30) % 2 ? 1 : -1, 0); }
    // The crown island: a rocky island with five gold-tipped peaks.
    function crownIsland(ctx, x, w, h) {
        const base = WATER;
        rect(ctx, x, base - h * 0.45, w, h * 0.45 + 2, "#3d3a46");
        for (let i = 0; i < 5; i++) {
            const px = x + (i + 0.5) * w / 5, ph = h * (i % 2 ? 0.75 : 1);
            for (let row = 0; row < ph * 0.6; row += 2) {
                const half = Math.max(1, (w / 10) * (1 - row / (ph * 0.6)));
                rect(ctx, px - half, base - h * 0.45 - row, half * 2, 2, row > ph * 0.5 ? COL.gold : "#4b4757");
            }
        }
        rect(ctx, x - 6, base - 2, w + 12, 3, "#e2cc9c");   // a strip of beach
    }
    function tentacle(ctx, x, h, t, phase) {
        for (let i = 0; i < h; i += 3) {
            const sway = Math.sin(t * 2.2 + phase + i * 0.08) * (i / 6);
            const r = Math.max(2, 6 - i / 14);
            disc(ctx, x + sway, WATER - i, r, i % 9 < 3 ? "#9b4fae" : "#7a3b8f");
            if (i % 12 === 6) rect(ctx, x + sway + r - 2, WATER - i, 2, 2, "#e8b8f0");   // suckers
        }
    }
    function bubbles(ctx, t, from, to, n) {
        const r = seeded(5);
        for (let i = 0; i < n; i++) {
            const x = from + r() * (to - from), speed = 8 + r() * 10, life = (t * speed / 20 + r()) % 1;
            rect(ctx, x, WATER + 8 - life * 14, 2, 2, `rgba(207, 234, 255, ${1 - life})`);
        }
    }
    function sailorAt(ctx, x, y, hat, t, jump) {
        sailor(ctx, x, y - (jump ? Math.abs(Math.round(Math.sin(t * 8 + x) * 3)) : 0), hat, t);
    }
    // Rook in his nightshirt and nightcap.
    function rookNightshirt(ctx, x, y, t) {
        rect(ctx, x + 1, y - 1, 4, 2, COL.red);
        rect(ctx, x + 5, y, 2, 2, COL.red);
        rect(ctx, x, y + 1, 6, 4, "#f2c39d");
        rect(ctx, x, y + 5, 6, 5, COL.cream);
        rect(ctx, x + 6, y + 5 - Math.floor(t * 4) % 2, 2, 2, COL.cream);
    }
    function parchment(ctx) {
        full(ctx, 0, H, "#8a6a3c");
        rect(ctx, 14, 10, 292, 160, "#e9d7a8");
        rect(ctx, 14, 10, 292, 3, "#c9a96a");
        rect(ctx, 14, 167, 292, 3, "#c9a96a");
        for (let y = 24; y < 166; y += 12) for (let x = 24 + (y % 24); x < 300; x += 26) rect(ctx, x, y, 6, 1, "rgba(31, 100, 168, 0.25)");
    }
    function ink(ctx, text, x, y, size, color = "#5a3a1a", align = "center") {
        if (!text) return;
        ctx.font = `${size}px 'Jersey 10', monospace`;
        ctx.textAlign = align;
        ctx.fillStyle = color;
        ctx.fillText(text, Math.round(x), Math.round(y));
        ctx.textAlign = "start";
    }

    // ---------- after Locks: the escape ----------
    const ESCAPE = [
        { dur: 6.5, draw(ctx, t, say) {   // sneaking along the Castle's deck to the jolly boat
            nightSky(ctx, t);
            sea(ctx, t);
            const cx = 150, cy = ship(ctx, cx, t, 0.4, true);
            const deck = cy + 26;
            ctx.strokeStyle = COL.woodDeep; ctx.lineWidth = 1;   // the boat hangs off the stern
            ctx.beginPath(); ctx.moveTo(cx + 2, deck - 12); ctx.lineTo(cx - 20, deck + 6); ctx.moveTo(cx + 2, deck - 12); ctx.lineTo(cx - 2, deck + 6); ctx.stroke();
            boat(ctx, cx - 26, deck + 6, [], t, false);
            const hats = [COL.red, COL.gold, COL.cream, COL.cream, COL.cream];   // Pawn leads, Knight next
            hats.forEach((hat, i) => {
                const start = 0.4 + i * 0.6, x = cx + 50 - Math.min(Math.max(0, t - start) * 14, 44 - i * 6);
                if (t > start) sailor(ctx, x, deck - 7, hat, t);
            });
            if (between(t, 1.8, 3.8)) bubble(ctx, say("knight"), cx + 40, deck - 9);
            if (between(t, 4.2, 6.2)) bubble(ctx, say("pawn"), cx + 8, deck - 9);
        } },
        { dur: 7.5, draw(ctx, t, say) {   // row for the fog; Rook wakes up and fires
            shake(ctx, t, 4.2);
            nightSky(ctx, t);
            sea(ctx, t);
            const cx = 200, cy = ship(ctx, cx, t, 0.4, true);
            if (t > 1.8 && Math.sin(t * 12) > -0.7) rect(ctx, cx + 9, cy + 25, 3, 2, COL.lamp);   // a light goes on
            if (t > 2) rookNightshirt(ctx, cx + 30, cy + 15, t);
            const drop = Math.min(1, t / 0.6);
            const bx = cx - 26 - Math.max(0, t - 0.6) * 17, by = Math.round((cy + 32) + drop * (WATER - 3 - cy - 32));
            boat(ctx, bx, by, [COL.red, COL.gold, COL.cream, COL.cream, COL.cream], t, t > 0.6);
            if (between(t, 0.9, 2.3)) bubble(ctx, say("crew"), bx + 16, by - 6);
            if (between(t, 2.3, 4.1)) bubble(ctx, say("rook"), cx + 33, cy + 13, true);
            flash(ctx, cx + 4, cy + 34, t, 4.2);
            if (between(t, 4.2, 5.3)) shout(ctx, say("boom"), cx - 16, cy + 22, COL.lamp);
            splash(ctx, bx + 46, 4.5, t);
            fog(ctx, t, Math.min(0.9, Math.max(0, t - 3) / 4), -OX - 60, 150);
        } },
        { dur: 7, draw(ctx, t, say) {   // Rook's chart: the way to his harbour, and the X beyond
            parchment(ctx);
            ink(ctx, say("chart"), 160, 30, 14);
            [[170, 66, 1], [262, 124, 2], [92, 104, 3]].forEach(([x, y, seed]) => {   // islands
                const r = seeded(seed), rows = [[-14, 14], [-20, 18], [-22, 22], [-17, 19], [-10, 11]];
                rows.forEach(([a, b], i) => {
                    const j = Math.round(r() * 4) - 2;
                    rect(ctx, x + a + j, y - 10 + i * 4, b - a, 4, "#d8c38a");
                    if (i > 0 && i < 4) rect(ctx, x + a + j + 4, y - 10 + i * 4, b - a - 8, 4, "#8fb36a");
                });
            });
            rect(ctx, 186, 66, 12, 2, COL.woodDark);   // the harbour's pier
            ink(ctx, say("harbour"), 170, 56, 9);
            const path = [[40, 150], [90, 140], [140, 92], [170, 82], [210, 96], [250, 116], [262, 120]];
            const go = Math.min(1, t / 5) * (path.length - 1);
            let last = path[0];
            for (let i = 0; i < path.length - 1 && i < go; i++) {
                const [ax, ay] = path[i], [bx, by] = path[i + 1], f = Math.min(1, go - i);
                for (let s = 0; s < f; s += 0.08) rect(ctx, ax + (bx - ax) * s, ay + (by - ay) * s, 2, 2, "#962127");
                last = [ax + (bx - ax) * f, ay + (by - ay) * f];
            }
            const atHarbour = go >= 3 ? path[3] : last;   // the boat stops at the harbour; the line runs on
            boat(ctx, atHarbour[0] - 16, atHarbour[1] - 4, [COL.red], t, false);
            if (go >= path.length - 1) {
                const [x, y] = path[path.length - 1];
                ctx.save(); ctx.translate(x, y - 10); ctx.rotate(Math.PI / 4); rect(ctx, -9, -2, 18, 4, COL.red); rect(ctx, -2, -9, 4, 18, COL.red); ctx.restore();
                ink(ctx, say("x"), x - 10, y + 22, 9, "#962127");
            }
            // a compass rose
            rect(ctx, 280, 30, 2, 22, "#5a3a1a"); rect(ctx, 270, 40, 22, 2, "#5a3a1a"); rect(ctx, 280, 30, 2, 8, COL.red);
        } },
    ];

    // ---------- after Gunpowder: the White Knight sails ----------
    const SHIP_FREE = [
        { dur: 7, draw(ctx, t, say) {   // the sea gate, a cannon, and a lit fuse
            shake(ctx, t, 4.2);
            bandSky(ctx, DAWN, [250, 112, 14, "#ffcf70"]);
            sea(ctx, t, "rgba(255, 207, 112, 0.7)");
            const wy = ship(ctx, 6, t, 0);   // chained up at the dock
            ctx.strokeStyle = "#7c808b"; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(10, wy + 40); ctx.lineTo(-OX, WATER + 4); ctx.moveTo(70, wy + 44); ctx.lineTo(96, WATER + 6); ctx.stroke();
            rect(ctx, 96, WATER - 10, 60, 10, COL.woodDark);   // the dock, with a cannon on it
            draw(ctx, "cannon", 128, WATER - 26, 16, 16);
            sailor(ctx, 112, WATER - 17, COL.red, 0);
            for (let y = WATER - 64; y < WATER; y += 16) { draw(ctx, "wall", 180, y, 16, 16); draw(ctx, "wall", 284, y, 16, 16); }
            const blown = t > 4.5;
            if (!blown) {   // the gate between the towers
                rect(ctx, 196, WATER - 48, 88, 52, COL.woodDark);
                for (let x = 200; x < 284; x += 10) rect(ctx, x, WATER - 48, 3, 52, COL.woodDeep);
                rect(ctx, 196, WATER - 30, 88, 4, "#7c808b");
            } else {
                const f = t - 4.5;
                for (let i = 0; i < 14; i++) {   // planks flying
                    const r = seeded(i + 1), vx = (r() - 0.3) * 60, vy = -30 - r() * 40;
                    rect(ctx, 230 + vx * f, WATER - 26 + vy * f + 60 * f * f, 6, 2, COL.woodDark);
                }
            }
            if (between(t, 1, 3.2)) bubble(ctx, say("pawn"), 114, WATER - 19);
            if (between(t, 3.2, 4.2)) rect(ctx, 122 + (t - 3.2) * 8, WATER - 14 - (t - 3.2) * 4, 2, 2, COL.lamp);   // the fuse burning
            flash(ctx, 146, WATER - 19, t, 4.2);
            if (between(t, 4.2, 4.5)) rect(ctx, 150 + (t - 4.2) * 260, WATER - 20, 4, 3, COL.ink);   // the shot
            if (between(t, 4.5, 6.4)) { disc(ctx, 240, WATER - 26, Math.round(4 + (t - 4.5) * 16), "rgba(255, 200, 110, 0.35)"); shout(ctx, say("boom"), 214, WATER - 56, COL.lamp); }
        } },
        { dur: 7, draw(ctx, t, say) {   // out through the gap and into the sunrise
            bandSky(ctx, DAWN, [250, 104 - t * 2, 14, "#ffcf70"]);
            sea(ctx, t, "rgba(255, 207, 112, 0.7)");
            for (let y = WATER - 64; y < WATER; y += 16) { draw(ctx, "wall", 180, y, 16, 16); draw(ctx, "wall", 284, y, 16, 16); }
            const x = -40 + t * 46;
            const wy = ship(ctx, x, t, 0);
            fog(ctx, 0, Math.max(0, 0.5 - t / 8), 180, 300);   // the last of the smoke
            if (between(t, 0.8, 2.8)) bubble(ctx, say("crew"), x + 46, wy + 17);
            if (between(t, 3, 5.6)) bubble(ctx, say("knight"), x + 30, wy + 17);
        } },
    ];

    // ---------- after Davy Jones' Locker: the Black Queen ----------
    const BLACK_QUEEN = [
        { dur: 6, draw(ctx, t, say) {   // the fog lifts on the crown island
            bandSky(ctx, DAY);
            sea(ctx, t, null);
            crownIsland(ctx, 236, 56, 40);
            const wy = ship(ctx, 40 + t * 8, t, 0);
            fog(ctx, t, Math.max(0, 0.9 - t / 4));
            if (between(t, 2.4, 5.6)) bubble(ctx, say("lookout"), 40 + t * 8 + 46, wy + 17);
        } },
        { dur: 7.5, draw(ctx, t, say) {   // a black sail astern, under a red sky
            bandSky(ctx, BLOOD);
            sea(ctx, t, null);
            crownIsland(ctx, 256, 56, 40);
            const wy = ship(ctx, 150 + t * 4, t, 0);
            const qx = -130 + Math.min(t, 3.5) * 42, qy = blackQueen(ctx, qx, t);
            fog(ctx, t, Math.max(0, 0.8 - t / 3), -OX - 60, 120);
            if (t > 2) rook(ctx, qx + 50, qy + 30, t);
            if (between(t, 2.6, 4.6)) bubble(ctx, say("rook"), qx + 53, qy + 28, true);
            if (between(t, 4.8, 7)) bubble(ctx, say("knight"), 150 + t * 4 + 30, wy + 17);
            full(ctx, 0, H, `rgba(120, 0, 0, ${0.05 + Math.max(0, Math.sin(t * 3)) * 0.06})`);
        } },
    ];

    // ---------- after the deck battle: the kraken ----------
    const KRAKEN = [
        { dur: 6.5, draw(ctx, t, say) {   // the Black Queen goes down by the bow
            bandSky(ctx, BLOOD);
            const angle = Math.min(0.55, t * 0.09), sink = Math.round(t * 5);
            const qy = blackQueen(ctx, 20, t, angle, sink);
            if (t < 5) rook(ctx, 40, qy + 26 + Math.round(t * 1.5), t * 3);   // shaking his fist on the stern
            sea(ctx, t, null);
            bubbles(ctx, t, 30, 150, 14);
            const wy = ship(ctx, 210, t, 0);
            if (between(t, 0.8, 3)) bubble(ctx, say("rook"), 43, qy + 22, true);
            if (between(t, 3.6, 6.2)) bubble(ctx, say("knight"), 240, wy + 17);
        } },
        { dur: 6.5, draw(ctx, t, say) {   // the sea boils, and something rises
            shake(ctx, t, 2.2);
            bandSky(ctx, BLOOD);
            crownIsland(ctx, 262, 50, 36);
            const wy = ship(ctx, 30, t, 0);
            const rise = Math.max(0, Math.min(1, (t - 1.2) / 2));
            [[170, 64, 0], [204, 80, 1.3], [236, 58, 2.6]].forEach(([x, h, p]) => tentacle(ctx, x, Math.round(h * rise), t, p));
            sea(ctx, t, null);
            bubbles(ctx, t, 150, 260, 26);
            if (between(t, 2.4, 5.4)) bubble(ctx, say("crew"), 76, wy + 17);
        } },
    ];

    // ---------- after the last room: the end ----------
    const ENDING = [
        { dur: 5.5, draw(ctx, t, say) {   // dawn, and the crown island ahead
            bandSky(ctx, DAWN, [160, 116, 16, "#ffd98a"]);
            sea(ctx, t, null);
            crownIsland(ctx, 196, 92, 64);
            const x = -60 + t * 22, wy = ship(ctx, x, t, 0);
            if (between(t, 1.6, 4.4)) bubble(ctx, say("lookout"), x + 46, wy + 17);
        } },
        { dur: 6, draw(ctx, t, say) {   // the Lost King's Hoard
            bandSky(ctx, ["#1d1a2e", "#2c2440", "#3d3052", "#4f3d63"]);
            full(ctx, WATER - 8, H - WATER + 8, "#e2cc9c");
            full(ctx, WATER + 14, H - WATER, "#d1b884");
            for (let r = 70; r > 10; r -= 12) disc(ctx, 160, WATER - 16, r, "rgba(246, 200, 76, 0.06)");
            draw(ctx, "chest", 136, WATER - 44, 48, 48);
            const coins = seeded(3);
            for (let i = 0; i < 26; i++) {   // gold spilling up out of the chest
                const vx = (coins() - 0.5) * 70, vy = -40 - coins() * 40, life = (t * 0.9 + coins()) % 1.3;
                rect(ctx, 158 + vx * life, WATER - 34 + vy * life + 60 * life * life, 3, 3, i % 3 ? COL.gold : "#fff3c4");
            }
            [[92, COL.cream], [108, COL.gold], [204, COL.cream], [220, COL.red], [236, COL.cream]].forEach(([x, hat]) => sailorAt(ctx, x, WATER - 14, hat, t, true));
            if (between(t, 1, 3.6)) bubble(ctx, say("crew"), 160, WATER - 46);
        } },
        { dur: 8, draw(ctx, t, say) {   // the captain's hat, three sizes too big
            bandSky(ctx, DAWN, [262, 40, 12, "#ffd98a"]);
            full(ctx, WATER, H - WATER, "#d1b884");
            ctx.save(); ctx.translate(92, WATER - 35); ctx.scale(5, 5); sailor(ctx, 0, 0, COL.gold, 0); ctx.restore();   // Knight
            draw(ctx, "pirate", 170, 74, 54, 54);   // Pawn
            const drop = Math.min(1, Math.max(0, (t - 2.6) / 0.5)), bounce = drop === 1 ? Math.round(Math.sin(Math.min(1, (t - 3.1) * 3) * Math.PI) * -3) : 0;
            const hy = -40 + drop * 104 + bounce;   // the hat lands on Pawn, over the eyes
            rect(ctx, 156, hy + 8, 82, 8, COL.ink);
            rect(ctx, 170, hy - 6, 54, 16, COL.ink);
            rect(ctx, 188, hy - 12, 18, 6, COL.ink);
            rect(ctx, 192, hy, 10, 6, COL.gold);   // a gold badge
            if (between(t, 0.5, 2.5)) bubble(ctx, say("knight"), 102, WATER - 38);
            if (between(t, 2.5, 4.4)) bubble(ctx, say("knight2"), 102, WATER - 38);
            if (t > 4.6) bubble(ctx, say("pawn"), 197, 62);
        } },
        { dur: 7, draw(ctx, t, say) {   // CHECKMATE
            full(ctx, 0, H, "#070d17");
            const r = seeded(4);
            for (let i = 0; i < 50; i++) rect(ctx, -OX + r() * VW, r() * H, 1, 1, Math.sin(t * 2 + i) > 0.5 ? "#ffffff" : "rgba(207, 234, 255, 0.4)");
            ctx.globalAlpha = Math.min(1, t / 1.2);
            ink(ctx, say("checkmate"), 161, 81, 34, COL.ink);
            ink(ctx, say("checkmate"), 160, 80, 34, COL.gold);
            ctx.globalAlpha = Math.max(0, Math.min(1, (t - 1.8) / 1));
            ink(ctx, say("end"), 160, 104, 16, COL.cream);
            ctx.globalAlpha = Math.max(0, Math.min(0.6, (t - 3.6) / 1.5));
            ink(ctx, say("after"), 160, 150, 9, COL.cream);
            ctx.globalAlpha = 1;
        } },
    ];

    // Scenes not drawn yet still play, as a moonlit sea.
    const PLAIN = [{ dur: 4, draw(ctx, t) { nightSky(ctx, t); sea(ctx, t); ship(ctx, 122, t, 0); } }];
    const SCENES = { intro: INTRO, escape: ESCAPE, "ship-free": SHIP_FREE, "black-queen": BLACK_QUEEN, kraken: KRAKEN, ending: ENDING };
    const FADE = 0.6;   // seconds of fade to and from black between shots

    // Plays a cutscene full screen. Resolves when it ends, or when a key press or the
    // Skip button skips it (other clicks and taps don't, so a stray one can't cut a
    // scene short; phones have no keys, so the button is their way out).
    function play(id) {
        const lines = ((STORY.cutscenes[id] || {}).lines || []);
        const shots = SCENES[id] || PLAIN;
        const total = shots.reduce((sum, s) => sum + s.dur, 0);
        return new Promise(resolve => {
            const box = document.createElement("div");
            box.className = "cutscene";
            box.setAttribute("role", "dialog");
            box.setAttribute("aria-modal", "true");
            box.setAttribute("aria-label", "Story scene. Press any key to skip.");
            box.innerHTML = `<canvas height="${H}"></canvas><p class="cutscene-hint">Press any key to skip</p>` +
                `<button class="btn small cutscene-skip" type="button">Skip &#9654;</button>`;
            document.body.appendChild(box);
            const canvas = box.querySelector("canvas"), ctx = canvas.getContext("2d");
            ["ship", "pirate", "crate", "logo", "chest", "wall", "cannon"].forEach(sprite);

            function fit() {   // fill the screen: widen the canvas to its shape, then scale it up
                const aspect = innerWidth / Math.max(1, innerHeight);
                VW = Math.max(280, Math.min(420, Math.round(H * aspect)));
                OX = Math.round((VW - STAGE) / 2);
                canvas.width = VW * RES;
                canvas.height = H * RES;
                const scale = Math.min(innerWidth / VW, innerHeight / H);
                canvas.style.width = Math.floor(VW * scale) + "px";
                canvas.style.height = Math.floor(H * scale) + "px";
                ctx.imageSmoothingEnabled = false;
            }
            fit();
            addEventListener("resize", fit);

            let begun = performance.now(), raf = 0, over = false;
            function finish() {
                if (over) return;
                over = true;
                cancelAnimationFrame(raf);
                document.removeEventListener("keydown", onKey, true);
                removeEventListener("resize", fit);
                markSeen(id);
                box.classList.add("closing");
                setTimeout(() => { box.remove(); resolve(); }, 400);
            }
            function onKey(e) {
                // The scene has the keyboard while it plays: nothing reaches the game underneath.
                e.preventDefault();
                e.stopPropagation();
                finish();
            }
            document.addEventListener("keydown", onKey, true);
            box.addEventListener("pointerdown", e => e.preventDefault());   // clicks don't skip
            box.querySelector(".cutscene-skip").addEventListener("click", finish);   // ...but the button does

            function frame(now) {
                let t = (now - begun) / 1000;
                if (t >= total) return finish();
                let n = 0;
                while (n < shots.length - 1 && t >= shots[n].dur) { t -= shots[n].dur; n++; }
                // The scenes are wordless: story.py's lines are kept, but never drawn.
                const shot = shots[n], say = key => (WORDLESS ? "" : (lines[n] || {})[key] || "");
                ctx.setTransform(RES, 0, 0, RES, OX * RES, 0);
                try { shot.draw(ctx, t, say); } catch (err) { /* a drawing bug shouldn't trap the player */ }
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                const dark = Math.max(0, 1 - t / FADE, n < shots.length - 1 ? 1 - (shot.dur - t) / FADE : 0);
                if (dark > 0) { ctx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, dark)})`; ctx.fillRect(0, 0, canvas.width, canvas.height); }
                raf = requestAnimationFrame(frame);
            }
            raf = requestAnimationFrame(frame);
        });
    }

    // Plays a cutscene once per player. Resolves straight away if it's been seen.
    function playOnce(id) { return seen(id) || !scenesOn() ? Promise.resolve() : play(id); }
    // A scene the game plays by itself (the ending): skipped if the player switched scenes off.
    function auto(id) { return scenesOn() ? play(id) : Promise.resolve(); }

    // ---------- chapter title cards ----------
    // A full-screen card when a chapter starts: its number, title, place and intro.
    // Space, Enter, Esc or the Set sail button sets sail (clicking elsewhere on the card doesn't).
    function titleCard(ch) {
        return new Promise(resolve => {
            const box = document.createElement("div");
            box.className = "chapter-card";
            box.setAttribute("role", "dialog");
            box.setAttribute("aria-modal", "true");
            box.setAttribute("aria-labelledby", "chapterCardTitle");
            box.innerHTML = `
                <div class="chapter-card-inner">
                    <p class="chapter-card-num">Chapter ${escapeHtml(ch.number)}</p>
                    <h2 id="chapterCardTitle">${escapeHtml(ch.title)}</h2>
                    ${ch.place ? `<p class="chapter-card-place">${escapeHtml(ch.place)}</p>` : ""}
                    ${ch.intro ? `<p class="chapter-card-intro">${escapeHtml(ch.intro)}</p>` : ""}
                    <button class="btn big" type="button">Set sail &#9654; <kbd>Space</kbd></button>
                </div>`;
            document.body.appendChild(box);
            let over = false;
            function close() {
                if (over) return;
                over = true;
                document.removeEventListener("keydown", onKey, true);
                markSeen("card:" + ch.title);
                box.classList.add("closing");
                setTimeout(() => { box.remove(); resolve(); }, 350);
            }
            function onKey(e) {
                e.preventDefault();
                e.stopPropagation();   // nothing reaches the game underneath
                if (!e.repeat && (e.key === " " || e.key === "Enter" || e.key === "Escape")) close();
            }
            document.addEventListener("keydown", onKey, true);
            box.querySelector("button").addEventListener("click", close);
            box.querySelector("button").focus({ preventScroll: true });
        });
    }

    // ---------- what plays before a room ----------
    // The first time: the scene for the room (or chapter) just finished, then the
    // chapter's title card if this room starts one.
    //   afterLevel    the name of the room before this one
    //   afterChapter  the title of the chapter before, when this room starts a new one
    //   chapter       { number, title, place, intro } when this room starts a chapter
    function sceneAfter(key) {
        if (!key) return null;
        for (const [id, c] of Object.entries(STORY.cutscenes || {})) {
            if (SCENES[id] && (c.after || []).includes(key)) return id;
        }
        return null;
    }
    async function before({ afterLevel = null, afterChapter = null, chapter = null } = {}) {
        if (!scenesOn()) return;
        for (const key of [afterLevel && "level:" + afterLevel, afterChapter && "chapter:" + afterChapter]) {
            const id = sceneAfter(key);
            if (id && !seen(id)) await play(id);
        }
        if (chapter && chapter.title && !seen("card:" + chapter.title)) await titleCard(chapter);
    }

    // "Watch again" buttons for the scenes this player has seen (the intro is always there).
    function sceneButtons(el) {
        if (!el) return;
        const all = STORY.cutscenes || {};
        const ids = Object.keys(all).filter(id => SCENES[id] && (id === "intro" || seen(id))).sort((a, b) => (all[a].order || 0) - (all[b].order || 0));
        el.innerHTML = `<span class="map-tools-label">Watch again:</span>` + ids.map(id =>
            `<button class="btn small sea" type="button" data-story-scene="${escapeHtml(id)}">${escapeHtml(STORY.cutscenes[id].title || id)}</button>`).join("");
    }

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

    global.BlockedStory = { init, play, playOnce, auto, scenesOn, before, titleCard, sceneButtons, seen, renderMap, viewSwitch };
})(window);
