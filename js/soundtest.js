// The sound test: lists every music track (grouped, with the slots they fill and
// buttons to jump to their variations), lets you try a track in a slot in this
// browser, and plays every effect. Shared by the website's /sounds page and the
// standalone build's Sound test screen. BlockedSoundTest.init() (re)draws it.
(function () {
    "use strict";
    let started = false;
    function init() {
        const LABELS = {
            step: "Footstep", push: "Push crate", bump: "Bump", plate: "Plate down", plateUp: "Plate up",
            gateOpen: "Gate opens", gateClose: "Gate shuts", fire: "Cannon fires", smash: "Wall smashed",
            crash: "Crate breaks", undo: "Undo", reset: "Restart", stuck: "Stuck", hint: "Hint",
            win: "Treasure found", click: "UI click", place: "Editor: place", erase: "Editor: erase",
            link: "Editor: link", save: "Editor: save",
        };
        const S = BlockedSound;
        const GROUPS = [["title", "Title"], ["chapter", "Chapters"], ["short", "Short chapter loops (Long chapter music off)"], ["chapter-boss", "Chapter boss levels"], ["boss", "Boss and finale"], ["extra", "Extras"]];
        const SLOT_NAMES = {
            lobby: "Title and menus", chapter1: "Chapter 1: Sea Legs", chapter2: "Chapter 2: Pressure",
            chapter3: "Chapter 3: Locks and Keys", chapter4: "Chapter 4: Gunpowder", chapter5: "Chapter 5: Crossfire",
            chapter6: "Chapter 6: Davy Jones", boss1: "Chapter 1 boss level", boss2: "Chapter 2 boss level",
            boss3: "Chapter 3 boss level", boss4: "Chapter 4 boss level", boss5: "Chapter 5 boss level",
            boss6: "Chapter 6 boss level", finale: "Final grand level(s)", milestone: "Big milestone",
        };
        const PASS_NAMES = { normal: "normal", changeup: "change-up", grand: "grand", breakdown: "breakdown", boss: "boss", boss2: "boss + second fiddle" };
        const slotsFor = id => S.slots.filter(slot => S.resolve(slot) === id);
        const tracksBox = document.getElementById("tracks");
        const nowPlaying = document.getElementById("nowPlaying");
        function renderTracks() {
            tracksBox.innerHTML = "";
            GROUPS.forEach(([group, label]) => {
                const list = S.tracks.filter(t => t.group === group);
                if (!list.length) return;
                const h = document.createElement("h4");
                h.textContent = label;
                h.className = "track-group";
                tracksBox.appendChild(h);
                const grid = document.createElement("div");
                grid.className = "track-grid";
                list.forEach(t => {
                    const card = document.createElement("div");
                    card.className = "track";
                    const b = document.createElement("button");
                    b.className = "btn wood small";
                    b.type = "button";
                    b.textContent = "Play";
                    b.addEventListener("click", () => { S.music(t.id); setTimeout(showPlaying, 50); });
                    const info = document.createElement("div");
                    const title = document.createElement("strong");
                    title.textContent = t.title + " ";
                    const id = document.createElement("code");
                    id.textContent = t.id;
                    const mood = document.createElement("div");
                    mood.className = "muted";
                    mood.textContent = t.mood;
                    const tags = document.createElement("div");
                    slotsFor(t.id).forEach(slot => {
                        const tag = document.createElement("span");
                        tag.className = "badge";
                        tag.textContent = slot + (S.previews[slot] ? " (this browser)" : "");
                        tag.title = SLOT_NAMES[slot] || slot;
                        tags.appendChild(tag);
                        tags.appendChild(document.createTextNode(" "));
                    });
                    info.append(title, id, mood, tags);
                    if (S.cycles[t.id]) info.append(cycleInfo(t.id));
                    card.append(b, info);
                    grid.appendChild(card);
                });
                tracksBox.appendChild(grid);
            });
        }
        // A long track's pass order, plus buttons to jump to each kind of variation.
        function cycleInfo(id) {
            const cycle = S.cycles[id], box = document.createElement("div");
            const line = document.createElement("div");
            line.className = "cycle muted";
            line.textContent = "Cycle: " + cycle.map(p => PASS_NAMES[p] || p).join(", ");
            const row = document.createElement("div");
            row.className = "passes";
            [...new Set(cycle)].filter(p => p !== "normal").forEach(pass => {
                const b = document.createElement("button");
                b.className = "btn small";
                b.type = "button";
                b.textContent = "Hear " + (PASS_NAMES[pass] || pass);
                b.addEventListener("click", () => { S.audition(id, cycle.indexOf(pass)); setTimeout(showPlaying, 50); });
                row.appendChild(b);
            });
            box.append(line, row);
            return box;
        }
        function showPlaying() {
            const t = S.tracks.find(t => t.id === S.playing), pos = S.position;
            const pass = t && S.cycles[t.id] && pos ? " (pass " + (pos.pass + 1) + " of " + S.cycles[t.id].length + ": " + (PASS_NAMES[pos.passName] || pos.passName) + ")" : "";
            nowPlaying.textContent = t ? "Now playing: " + t.title + pass : "Nothing playing";
        }
        document.getElementById("stopMusic").addEventListener("click", () => { S.stopMusic(); showPlaying(); });

        const slotsBox = document.getElementById("slots");
        function renderSlots() {
            slotsBox.innerHTML = "";
            S.slots.forEach(slot => {
                const label = document.createElement("label");
                label.className = "field";
                const name = document.createElement("span");
                name.textContent = SLOT_NAMES[slot] || slot;
                const sel = document.createElement("select");
                S.tracks.forEach(t => {
                    const o = document.createElement("option");
                    o.value = t.id;
                    o.textContent = t.title + (t.id === S.playlist[slot] ? " (PLAYLIST)" : "");
                    sel.appendChild(o);
                });
                sel.value = S.resolve(slot);
                sel.addEventListener("change", () => {
                    S.preview(slot, sel.value);
                    S.music(sel.value);
                    renderTracks();
                    setTimeout(showPlaying, 50);
                });
                const small = document.createElement("small");
                small.textContent = "slot: " + slot;
                label.append(name, sel, small);
                slotsBox.appendChild(label);
            });
        }
        document.getElementById("resetSlots").addEventListener("click", () => {
            S.slots.forEach(slot => S.preview(slot, null));
            renderSlots();
            renderTracks();
        });
        renderTracks();
        renderSlots();
        tracksBox.addEventListener("redraw", () => { renderTracks(); renderSlots(); showPlaying(); });
        setInterval(showPlaying, 1000);
        const effects = document.getElementById("effects");
        S.names.forEach(name => {
            const b = document.createElement("button");
            b.className = "btn small";
            b.type = "button";
            b.textContent = LABELS[name] || name;
            b.addEventListener("click", () => S.play(name));
            effects.appendChild(b);
        });
    }
    window.BlockedSoundTest = {
        init() {
            // Buttons and the "Now playing" timer are only wired up once per page.
            if (started) { document.getElementById("tracks").dispatchEvent(new Event("redraw")); return; }
            started = true;
            init();
        },
    };
})();
