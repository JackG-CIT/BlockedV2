// Blocked's sound: every effect and every song is synthesised in the browser
// with the Web Audio API, so there are no audio files to license or load.
//
// Music is written as note lists below; edit them like sheet music.
// "D4:4" is the note D in octave 4 held for 4 steps, "r:2" is a 2-step rest,
// "D3+F3+A3:16" is a chord. Drum channels use K/k (kick loud/soft),
// B (big taiko drum), F (frame drum), S/s (snare loud/soft), H/h (hi-hat
// loud/soft), J (tambourine jingle), A (anvil clang), T (timpani) and
// C (cymbal crash); "B+C:4" hits two at once.
//
// Which song plays where is set by PLAYLIST (search for it below): pages ask
// for a slot such as "lobby", "chapter3" or "boss", and PLAYLIST says which
// track from SONGS fills that slot. /sounds lets you audition every track.
// Long chapter tracks play their short loop over and over, with a variation
// pass (a change-up, a grand pass, a breakdown) every few times round: see `cycle`.
//
// To use your own recordings instead, put a file named after the slot
// (lobby.mp3, chapter1.mp3 ... boss.mp3) in static/audio/ (only files you have
// the rights to). The game picks them up automatically.
(function (global) {
    "use strict";

    // Inside the site's frame (see templates/shell.html) the page around it owns
    // the music, so it keeps playing while pages change. Borrow its player.
    const host = (() => {
        try { return global.parent !== global && global.parent.BLOCKED_SHELL ? global.parent.BlockedSound : null; }
        catch (e) { return null; }
    })();
    if (host) {
        // Clicks and key presses happen in here, so pass them on: browsers only
        // let a page start sound after the player does something.
        ["pointerdown", "keydown", "touchstart"].forEach(ev =>
            global.addEventListener(ev, () => host.unlock(), { capture: true, passive: true }));
        global.BlockedSound = new Proxy(host, {
            get(target, key) {
                if (key === "go") return url => { global.location.href = url; }; // no fade needed
                const value = target[key];
                return typeof value === "function" ? value.bind(target) : value;
            },
        });
        return;
    }

    // ========== Settings (remembered per browser) ==========
    // longMusic: the long chapter tracks with variations (true) or just the short 16-bar loops (false).
    const DEFAULTS = { music: 0.6, sfx: 0.8, muted: false, longMusic: true };
    let settings = { ...DEFAULTS };
    try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem("blocked-audio") || "{}") }; } catch (e) { /* storage blocked */ }
    function save() {
        try { localStorage.setItem("blocked-audio", JSON.stringify(settings)); } catch (e) { /* storage blocked */ }
    }

    let ctx = null, master, musicBus, sfxBus, reverb, meter;
    const config = global.BLOCKED_AUDIO || { files: {} };

    function init() {
        if (ctx) return true;
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        // A gentle compressor so loud moments (cannons, big chords) don't clip.
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -14;
        comp.knee.value = 10;
        comp.ratio.value = 4;
        comp.attack.value = 0.005;
        comp.release.value = 0.2;
        master.connect(comp);
        comp.connect(ctx.destination);
        meter = ctx.createAnalyser();
        meter.fftSize = 2048;
        comp.connect(meter);
        musicBus = ctx.createGain();
        sfxBus = ctx.createGain();
        musicBus.connect(master);
        sfxBus.connect(master);
        reverb = makeReverb(2.2);
        const wet = ctx.createGain();
        wet.gain.value = 0.25;
        reverb.connect(wet);
        wet.connect(musicBus);
        applyVolumes();
        return true;
    }

    function applyVolumes() {
        if (!ctx) return;
        const t = ctx.currentTime;
        master.gain.setTargetAtTime(settings.muted ? 0 : 1, t, 0.05);
        musicBus.gain.setTargetAtTime(settings.music * 0.5, t, 0.05);
        sfxBus.gain.setTargetAtTime(settings.sfx * 1.1, t, 0.05);
        if (fileMusic) fileMusic.volume = settings.muted ? 0 : settings.music * 0.6;
    }

    function makeReverb(seconds) {
        const len = Math.floor(ctx.sampleRate * seconds);
        const buf = ctx.createBuffer(2, len, ctx.sampleRate);
        for (let c = 0; c < 2; c++) {
            const d = buf.getChannelData(c);
            for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
        }
        const conv = ctx.createConvolver();
        conv.buffer = buf;
        return conv;
    }

    let noiseBuf = null;
    function noise() {
        if (!noiseBuf) {
            noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
            const d = noiseBuf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        }
        const src = ctx.createBufferSource();
        src.buffer = noiseBuf;
        src.loop = true;
        return src;
    }

    // A 25% pulse wave: the classic NES lead sound.
    let pulseWave = null;
    function pulse() {
        if (!pulseWave) {
            const n = 32, re = new Float32Array(n), im = new Float32Array(n);
            for (let k = 1; k < n; k++) im[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * 0.25);
            pulseWave = ctx.createPeriodicWave(re, im);
        }
        return pulseWave;
    }

    const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    function freq(name) {
        const m = /^([A-G])(#|b)?(-?\d)$/.exec(name);
        if (!m) return 0;
        const semis = NOTE[m[1]] + (m[2] === "#" ? 1 : m[2] === "b" ? -1 : 0) + (parseInt(m[3]) + 1) * 12;
        return 440 * Math.pow(2, (semis - 69) / 12);
    }

    // ========== Building blocks ==========
    // A single tone with an attack/decay envelope.
    function tone(dest, { type = "square", f, f2, at = 0, dur = 0.2, vol = 0.3, attack = 0.005, release = 0.08, filter, q, vibrato, detune = 0 }) {
        const t = ctx.currentTime + at;
        const osc = ctx.createOscillator();
        if (type === "pulse") osc.setPeriodicWave(pulse()); else osc.type = type;
        osc.frequency.setValueAtTime(f, t);
        if (f2) osc.frequency.exponentialRampToValueAtTime(Math.max(f2, 1), t + dur);
        osc.detune.value = detune;
        if (vibrato) {
            const lfo = ctx.createOscillator(), depth = ctx.createGain();
            lfo.frequency.value = 5.5;
            depth.gain.setValueAtTime(0, t);
            depth.gain.linearRampToValueAtTime(f * vibrato, t + Math.min(dur, 0.3));
            lfo.connect(depth);
            depth.connect(osc.frequency);
            lfo.start(t);
            lfo.stop(t + dur + release);
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
        g.gain.setValueAtTime(vol, t + Math.max(attack, dur - release));
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur + release);
        let node = osc;
        if (filter) {
            const lp = ctx.createBiquadFilter();
            lp.type = "lowpass";
            lp.frequency.value = filter;
            if (q) lp.Q.value = q;
            osc.connect(lp);
            node = lp;
        }
        node.connect(g);
        g.connect(dest);
        osc.start(t);
        osc.stop(t + dur + release + 0.02);
        return g;
    }

    // A burst of filtered noise (for thuds, hisses, booms and drums).
    function hiss(dest, { at = 0, dur = 0.2, vol = 0.3, type = "lowpass", f = 1000, f2, q = 1, attack = 0.002 }) {
        const t = ctx.currentTime + at;
        const src = noise();
        const bq = ctx.createBiquadFilter();
        bq.type = type;
        bq.frequency.setValueAtTime(f, t);
        if (f2) bq.frequency.exponentialRampToValueAtTime(f2, t + dur);
        bq.Q.value = q;
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(vol, t + attack);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        src.connect(bq);
        bq.connect(g);
        g.connect(dest);
        src.start(t, Math.random() * 0.5);
        src.stop(t + dur + 0.05);
    }

    const jitter = (amount = 0.06) => 1 + (Math.random() * 2 - 1) * amount;

    // ========== Sound effects ==========
    const SFX = {
        // A boot knocking on deck planks. The knock sits in the mid range so
        // laptop and phone speakers (which can't play deep bass) still carry it.
        step() {
            hiss(sfxBus, { dur: 0.06, vol: 0.3, type: "bandpass", f: 1300 * jitter(0.15), q: 2.5 });
            tone(sfxBus, { type: "triangle", f: 330 * jitter(0.08), f2: 190, dur: 0.05, vol: 0.4 });
            tone(sfxBus, { type: "sine", f: 150 * jitter(), f2: 90, dur: 0.06, vol: 0.3 });
        },
        // A heavy wooden crate scraping one tile and thudding into place.
        push() {
            hiss(sfxBus, { dur: 0.22, vol: 0.55, type: "bandpass", f: 700 * jitter(), f2: 320, q: 2.5 });
            hiss(sfxBus, { dur: 0.12, vol: 0.2, type: "bandpass", f: 2400 * jitter(0.2), q: 4 });
            tone(sfxBus, { type: "triangle", f: 180 * jitter(), f2: 95, dur: 0.14, vol: 0.6 });
            tone(sfxBus, { type: "sine", f: 90 * jitter(), f2: 55, at: 0.12, dur: 0.12, vol: 0.5 });
            tone(sfxBus, { type: "square", f: 260 * jitter(), f2: 170, dur: 0.08, vol: 0.12, filter: 1400 });
        },
        // Walking into something solid.
        bump() {
            tone(sfxBus, { type: "sine", f: 110, f2: 60, dur: 0.1, vol: 0.5 });
            tone(sfxBus, { type: "triangle", f: 240, f2: 150, dur: 0.06, vol: 0.3 });
            hiss(sfxBus, { dur: 0.07, vol: 0.25, type: "bandpass", f: 900, q: 1.5 });
        },
        // A brass plate clicking down / springing back up.
        plate() {
            tone(sfxBus, { type: "square", f: 660, dur: 0.03, vol: 0.12, filter: 3000 });
            tone(sfxBus, { type: "triangle", f: 220, f2: 180, at: 0.02, dur: 0.12, vol: 0.25 });
        },
        plateUp() {
            tone(sfxBus, { type: "triangle", f: 180, f2: 240, dur: 0.08, vol: 0.18 });
            tone(sfxBus, { type: "square", f: 880, at: 0.05, dur: 0.02, vol: 0.08, filter: 3000 });
        },
        // Stone grinding as a gate sinks into the deck, or rises out of it.
        gateOpen() {
            hiss(sfxBus, { dur: 0.45, vol: 0.25, type: "bandpass", f: 300, f2: 900, q: 4 });
            tone(sfxBus, { type: "sawtooth", f: 70, f2: 55, dur: 0.4, vol: 0.12, filter: 400 });
            tone(sfxBus, { type: "triangle", f: 523, at: 0.35, dur: 0.12, vol: 0.12 });
        },
        gateClose() {
            hiss(sfxBus, { dur: 0.35, vol: 0.25, type: "bandpass", f: 900, f2: 250, q: 4 });
            tone(sfxBus, { type: "sine", f: 90, f2: 45, at: 0.28, dur: 0.18, vol: 0.5 });
        },
        // Fuse fizz then a cannon boom.
        fire() {
            hiss(sfxBus, { dur: 0.12, vol: 0.18, type: "highpass", f: 4000 });
            tone(sfxBus, { type: "sine", f: 120, f2: 35, at: 0.06, dur: 0.5, vol: 0.9 });
            hiss(sfxBus, { at: 0.06, dur: 0.6, vol: 0.6, f: 1800, f2: 120 });
            hiss(sfxBus, { at: 0.06, dur: 0.15, vol: 0.3, type: "highpass", f: 2500 });
        },
        // Stone wall blown apart.
        smash() {
            hiss(sfxBus, { dur: 0.5, vol: 0.55, f: 2500, f2: 200 });
            tone(sfxBus, { type: "sine", f: 80, f2: 30, dur: 0.35, vol: 0.6 });
            for (let i = 0; i < 5; i++) {
                hiss(sfxBus, { at: 0.08 + i * 0.06 * jitter(0.4), dur: 0.05, vol: 0.2, type: "bandpass", f: 1500 * jitter(0.5), q: 6 });
            }
        },
        // A crate splintering against something it can't break.
        crash() {
            hiss(sfxBus, { dur: 0.25, vol: 0.4, type: "bandpass", f: 1200, f2: 400, q: 2 });
            for (let i = 0; i < 4; i++) {
                tone(sfxBus, { type: "square", f: 300 * jitter(0.3), f2: 120, at: i * 0.04, dur: 0.05, vol: 0.08, filter: 1500 });
            }
        },
        undo() {
            tone(sfxBus, { type: "triangle", f: 660, f2: 440, dur: 0.08, vol: 0.18 });
            tone(sfxBus, { type: "triangle", f: 440, f2: 330, at: 0.06, dur: 0.08, vol: 0.14 });
        },
        reset() {
            hiss(sfxBus, { dur: 0.35, vol: 0.18, type: "bandpass", f: 400, f2: 2500, q: 1.5 });
            tone(sfxBus, { type: "triangle", f: 392, dur: 0.08, vol: 0.15, at: 0.05 });
            tone(sfxBus, { type: "triangle", f: 523, dur: 0.1, vol: 0.15, at: 0.13 });
        },
        // A low, minor "uh-oh" when the level can't be won any more.
        stuck() {
            [["A3", 0], ["F3", 0.18], ["D3", 0.36]].forEach(([n, at]) =>
                tone(sfxBus, { type: "pulse", f: freq(n), at, dur: 0.22, vol: 0.14, filter: 1600 }));
            tone(sfxBus, { type: "sine", f: freq("D2"), at: 0.36, dur: 0.6, vol: 0.25 });
        },
        hint() {
            [["E5", 0], ["B5", 0.09]].forEach(([n, at]) =>
                tone(sfxBus, { type: "sine", f: freq(n), at, dur: 0.25, vol: 0.18, release: 0.3 }));
        },
        // Treasure! A fanfare plus jingling coins.
        win() {
            const notes = [["G4", 0, 0.12], ["B4", 0.12, 0.12], ["D5", 0.24, 0.12], ["G5", 0.36, 0.5]];
            notes.forEach(([n, at, dur]) => {
                tone(sfxBus, { type: "pulse", f: freq(n), at, dur, vol: 0.16, filter: 3500, vibrato: 0.01 });
                tone(sfxBus, { type: "triangle", f: freq(n) / 2, at, dur, vol: 0.18 });
            });
            for (let i = 0; i < 9; i++) {
                const at = 0.4 + i * 0.07 * jitter(0.3);
                tone(sfxBus, { type: "square", f: 2200 * jitter(0.25), dur: 0.04, at, vol: 0.05, filter: 7000 });
                tone(sfxBus, { type: "sine", f: 3300 * jitter(0.2), dur: 0.12, at: at + 0.01, vol: 0.06 });
            }
        },
        // UI
        click() {
            tone(sfxBus, { type: "square", f: 880, f2: 660, dur: 0.03, vol: 0.07, filter: 3000 });
        },
        place() {
            tone(sfxBus, { type: "triangle", f: 330 * jitter(0.03), f2: 260, dur: 0.06, vol: 0.18 });
            hiss(sfxBus, { dur: 0.04, vol: 0.08, type: "bandpass", f: 1200, q: 2 });
        },
        erase() {
            hiss(sfxBus, { dur: 0.08, vol: 0.12, type: "highpass", f: 2000, f2: 6000 });
        },
        link() {
            [["C5", 0], ["G5", 0.06]].forEach(([n, at]) =>
                tone(sfxBus, { type: "pulse", f: freq(n), at, dur: 0.06, vol: 0.08, filter: 4000 }));
        },
        save() {
            [["C5", 0], ["E5", 0.07], ["G5", 0.14]].forEach(([n, at]) =>
                tone(sfxBus, { type: "triangle", f: freq(n), at, dur: 0.1, vol: 0.16 }));
        },
    };

    // ========== Music ==========
    // Instruments for music channels. Each plays one note (or chord) at a time.
    // They're built to sound like a small film orchestra: a string section,
    // a horn section, a fiddle, cellos and big drums.
    const INSTRUMENTS = {
        // Sustained string section: three slightly detuned saws, slow bow attack.
        strings: (b, t, f, d) => [-8, 0, 8].forEach(detune =>
            note({ bus: b, type: "sawtooth", f, t, d, v: 0.02, filter: 2000, attack: 0.15, release: 0.4, detune, vibrato: 0.004, vibDelay: 0.25 })),
        // Short, bouncing string notes: the driving pulse under adventure music.
        ostinato: (b, t, f, d) => [-6, 6].forEach(detune =>
            note({ bus: b, type: "sawtooth", f, t, d: Math.min(d * 0.6, 0.14), v: 0.04, filter: 1800, attack: 0.004, release: 0.08, detune })),
        // French horns: the filter opens as the note swells, like brass does.
        brass: (b, t, f, d) => {
            note({ bus: b, type: "sawtooth", f, t, d, v: 0.06, filter: 2400, sweep: 450, attack: 0.06, release: 0.2, vibrato: 0.005, vibDelay: 0.3 });
            note({ bus: b, type: "sawtooth", f, t, d, v: 0.035, filter: 2000, sweep: 400, attack: 0.07, release: 0.2, detune: 7 });
            note({ bus: b, type: "triangle", f: f / 2, t, d, v: 0.06, attack: 0.06, release: 0.2 });
        },
        // A singing fiddle / solo violin for melodies.
        lead: (b, t, f, d) => {
            note({ bus: b, type: "sawtooth", f, t, d, v: 0.045, filter: 3200, attack: 0.03, release: 0.15, vibrato: 0.007, vibDelay: 0.12 });
            note({ bus: b, type: "triangle", f, t, d, v: 0.06, attack: 0.03, release: 0.15, vibrato: 0.007, vibDelay: 0.12 });
        },
        // Cellos and basses.
        cello: (b, t, f, d) => {
            note({ bus: b, type: "sawtooth", f, t, d: d * 0.95, v: 0.08, filter: 800, attack: 0.03, release: 0.2 });
            note({ bus: b, type: "sine", f, t, d: d * 0.95, v: 0.14, attack: 0.03, release: 0.2 });
        },
        sub: (b, t, f, d) => note({ bus: b, type: "sine", f, t, d, v: 0.24, attack: 0.3, release: 0.6 }),
        bell: (b, t, f) => {
            note({ bus: b, type: "sine", f, t, d: 0.05, v: 0.07, release: 1.2 });
            note({ bus: b, type: "sine", f: f * 2.76, t, d: 0.02, v: 0.02, release: 0.5 });
        },
        // Accordion / concertina: two reeds tuned slightly apart plus a hollow
        // square reed, for the "squeeze-box" chord stabs of a ship's band.
        squeeze: (b, t, f, d) => {
            const len = Math.min(d * 0.85, 0.5);
            note({ bus: b, type: "sawtooth", f, t, d: len, v: 0.016, filter: 1700, attack: 0.02, release: 0.07, detune: -12 });
            note({ bus: b, type: "sawtooth", f, t, d: len, v: 0.016, filter: 1700, attack: 0.02, release: 0.07, detune: 12 });
            note({ bus: b, type: "square", f, t, d: len, v: 0.011, filter: 1200, attack: 0.02, release: 0.07 });
        },
        // A wordless choir ("aah"): soft, dark voices that swell in slowly.
        choir: (b, t, f, d) => {
            [-6, 6].forEach(detune => note({ bus: b, type: "sawtooth", f, t, d, v: 0.016, filter: 1100, attack: 0.3, release: 0.5, detune, vibrato: 0.006, vibDelay: 0.2 }));
            note({ bus: b, type: "triangle", f, t, d, v: 0.035, attack: 0.3, release: 0.5, vibrato: 0.006, vibDelay: 0.2 });
        },
        // Plucked strings (pizzicato): a quick snap that rings away.
        pizz: (b, t, f) => {
            note({ bus: b, type: "triangle", f, t, d: 0.02, v: 0.13, attack: 0.003, release: 0.3 });
            note({ bus: b, type: "sawtooth", f, t, d: 0.01, v: 0.035, filter: 1400, attack: 0.003, release: 0.14 });
        },
    };

    function note({ bus, type, f, t, d, v, filter, sweep, vibrato, vibDelay = 0, attack = 0.005, release = 0.06, detune = 0 }) {
        const osc = ctx.createOscillator();
        if (type === "pulse") osc.setPeriodicWave(pulse()); else osc.type = type;
        osc.frequency.value = f;
        osc.detune.value = detune;
        // Vibrato: the pitch wobbles 5 times a second, fading in after vibDelay the
        // way a player leans into a long note. It's written straight onto the note's
        // pitch as a curve (100 points a second) rather than driven by a second,
        // live oscillator: the same wobble, at a fraction of the work for the
        // browser, which is what kept the music from stuttering on slower computers.
        if (vibrato && d + release > vibDelay) {
            const from = t + vibDelay, to = t + d + release, depth = f * vibrato;
            const n = Math.max(2, Math.ceil((to - from) * 100));
            const curve = new Float32Array(n);
            for (let k = 0; k < n; k++) {
                const at = from + (to - from) * k / (n - 1);
                const fade = Math.min(1, (at - from) / 0.25);
                curve[k] = f + depth * fade * Math.sin(2 * Math.PI * 5 * (at - t));
            }
            osc.frequency.setValueCurveAtTime(curve, from, to - from);
        }
        const g = ctx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(v, t + attack);
        g.gain.setValueAtTime(v, t + Math.max(attack, d));
        g.gain.exponentialRampToValueAtTime(0.0001, t + d + release);
        let n = osc;
        if (filter) {
            const lp = ctx.createBiquadFilter();
            lp.type = "lowpass";
            // A fixed cutoff is set as a plain value: an automated one (setValueAtTime)
            // makes the browser recompute the filter for every sample, which is
            // what made the music stutter on slower computers. Same sound either way.
            if (sweep) {
                lp.frequency.setValueAtTime(sweep, t);
                lp.frequency.exponentialRampToValueAtTime(filter, t + Math.max(attack * 2, 0.12));
            } else {
                lp.frequency.value = filter;
            }
            osc.connect(lp);
            n = lp;
        }
        n.connect(g);
        g.connect(bus);
        osc.start(t);
        osc.stop(t + d + release + 0.05);
        // Unhook the note's nodes once it's done, so a long session doesn't pile them up.
        osc.onended = () => { g.disconnect(); if (n !== osc) n.disconnect(); };
    }

    function drum(bus, t, kind, v) {
        const g = ctx.createGain();
        g.connect(bus);
        const env = (vol, dur) => {
            g.gain.setValueAtTime(vol * v, t);
            g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        };
        if (kind === "K" || kind === "k") {
            const o = ctx.createOscillator();
            o.type = "sine";
            o.frequency.setValueAtTime(kind === "K" ? 110 : 80, t);
            o.frequency.exponentialRampToValueAtTime(40, t + 0.15);
            env(kind === "K" ? 0.5 : 0.35, 0.25);
            o.connect(g);
            o.start(t);
            o.stop(t + 0.3);
        } else if (kind === "B") {                 // big taiko drum: a deep boom plus the skin's slap
            const o = ctx.createOscillator();
            o.type = "sine";
            o.frequency.setValueAtTime(130, t);
            o.frequency.exponentialRampToValueAtTime(48, t + 0.25);
            env(0.7, 0.6);
            o.connect(g);
            o.start(t);
            o.stop(t + 0.65);
            const src = noise(), f = ctx.createBiquadFilter(), sg = ctx.createGain();
            f.type = "lowpass";
            f.frequency.value = 900;
            sg.gain.setValueAtTime(0.25 * v, t);
            sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
            src.connect(f);
            f.connect(sg);
            sg.connect(bus);
            src.start(t, Math.random() * 0.5);
            src.stop(t + 0.15);
        } else if (kind === "T") {                 // timpani
            const o = ctx.createOscillator();
            o.type = "sine";
            o.frequency.setValueAtTime(95, t);
            o.frequency.exponentialRampToValueAtTime(70, t + 0.5);
            env(0.45, 0.7);
            o.connect(g);
            o.start(t);
            o.stop(t + 0.75);
        } else if (kind === "F") {                 // frame drum: a hand-struck skin, higher than the taiko
            const o = ctx.createOscillator();
            o.type = "sine";
            o.frequency.setValueAtTime(200, t);
            o.frequency.exponentialRampToValueAtTime(115, t + 0.15);
            env(0.4, 0.25);
            o.connect(g);
            o.start(t);
            o.stop(t + 0.3);
            const src = noise(), f = ctx.createBiquadFilter(), sg = ctx.createGain();
            f.type = "bandpass";
            f.frequency.value = 700;
            sg.gain.setValueAtTime(0.12 * v, t);
            sg.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
            src.connect(f);
            f.connect(sg);
            sg.connect(bus);
            src.start(t, Math.random() * 0.5);
            src.stop(t + 0.1);
        } else if (kind === "A") {                 // anvil: a bright clang of clashing metal partials
            [[1250, 0.05], [1873, 0.035], [3120, 0.02]].forEach(([fr, vol]) => {
                const o = ctx.createOscillator(), og = ctx.createGain();
                o.type = "triangle";
                o.frequency.value = fr;
                og.gain.setValueAtTime(vol * v, t);
                og.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
                o.connect(og);
                og.connect(bus);
                o.start(t);
                o.stop(t + 0.4);
            });
        } else if (kind === "J") {                 // tambourine: a shaken jingle that rings briefly
            const src = noise(), f = ctx.createBiquadFilter();
            f.type = "bandpass";
            f.frequency.value = 8500;
            f.Q.value = 1.2;
            g.gain.setValueAtTime(0.0001, t);
            g.gain.linearRampToValueAtTime(0.11 * v, t + 0.006);
            g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
            src.connect(f);
            f.connect(g);
            src.start(t, Math.random() * 0.5);
            src.stop(t + 0.15);
        } else if (kind === "C") {                 // cymbal crash, rings out
            const src = noise(), f = ctx.createBiquadFilter();
            f.type = "highpass";
            f.frequency.value = 5000;
            env(0.09, 1.8);
            src.connect(f);
            f.connect(g);
            src.start(t, Math.random() * 0.5);
            src.stop(t + 1.9);
        } else {
            const src = noise(), f = ctx.createBiquadFilter();
            const loud = { S: 0.22, s: 0.08, H: 0.07, h: 0.035 }[kind] || 0.05;
            f.type = kind === "S" || kind === "s" ? "bandpass" : "highpass";
            f.frequency.value = kind === "S" || kind === "s" ? 1800 : 7000;
            env(loud, kind === "S" ? 0.14 : kind === "s" ? 0.07 : 0.04);
            src.connect(f);
            f.connect(g);
            src.start(t, Math.random() * 0.5);
            src.stop(t + 0.2);
        }
    }

    // ---- Which track plays where ----
    // Pages ask for a SLOT; this table says which track (from SONGS below) fills
    // it. To swap music, change the track id on the right, save and refresh.
    // Track ids: set-sail, black-flag, captains-oath, sea-legs, pressure,
    // locks-keys, gunpowder, crossfire, davy-jones, boss-storm, boss-kraken,
    // milestone, open-ocean, fair-winds.
    const PLAYLIST = {
        lobby: "set-sail",        // title screen and menus
        chapter1: "sea-legs",     // levels 1-5    Sea Legs
        chapter2: "pressure",     // levels 6-10   Pressure (plates and gates)
        chapter3: "locks-keys",   // levels 11-15  Locks and Keys
        chapter4: "gunpowder",    // levels 16-20  Gunpowder (cannons)
        chapter5: "crossfire",    // levels 21-25  Crossfire
        chapter6: "davy-jones",   // levels 26-30  Davy Jones (finale)
        boss1: "sea-legs-boss",   // level 5, the hardest of chapter 1
        boss2: "pressure-boss",   // level 10
        boss3: "locks-keys-boss", // level 15
        boss4: "gunpowder-boss",  // level 20
        boss5: "crossfire-boss",  // level 25
        boss6: "davy-jones-boss", // level 30
        finale: "boss-storm",     // the voyage's final grand level(s)
        milestone: "milestone",   // a big milestone (not used by any page yet)
    };
    // Other names pages may use: older ones, and "boss", which now means the finale.
    const ALIASES = { voyage: "chapter1", deep: "finale", boss: "finale" };

    // ---- The songs ----
    // Each track: title, group (title / chapter / chapter-boss / boss / short / extra), volume (1 = normal;
    // raise or lower to balance it against the others), mood, tempo (bpm = beats
    // per minute), stepsPerBeat (the smallest note; 4 = sixteenths in 4/4, 6 =
    // sixteenths in 6/8), barSteps (steps in one bar; every bar of every channel
    // must add up to exactly this), then one note list per instrument.
    const SONGS = {
        // Title: "Set Sail". D minor, 6/8. Horns sing the theme over a galloping bow, an accordion and taiko; then the fiddle takes over and the horns answer.
        "set-sail": {
            title: "Set Sail", group: "title", volume: 1.0,
            mood: "Grand pirate anthem in D minor: horns, gallop, accordion",
            bpm: 64, stepsPerBeat: 6, barSteps: 12,
            channels: {
                brass: [
                    "D4:4 A4:2 A4:3 G4:1 F4:1 E4:1", "D4:2 F4:2 A4:2 D5:6", "C5:4 Bb4:2 A4:2 G4:2 F4:2", "G4:4 A4:2 E4:6",
                    "D5:4 A4:2 A4:3 G4:1 F4:1 G4:1", "F4:2 Bb4:2 D5:2 F5:6", "D5:3 C5:1 Bb4:2 G4:2 A4:2 Bb4:2", "A4:6 C#5:2 D5:2 E5:2",
                    "F4:6 A4:6", "G4:6 E4:6", "F4:6 D4:6", "A4:12",
                    "F4:6 Bb4:6", "G4:6 C5:6", "C#5:6 A4:6", "E4:6 C#4:6",
                ],
                lead: [
                    "r:12", "r:12", "r:12", "r:12",
                    "r:12", "r:12", "r:12", "r:12",
                    "A5:2 G5:1 F5:1 C5:2 F5:4 A5:2", "G5:2 F5:1 E5:1 C5:2 E5:6", "F5:2 E5:1 D5:1 A4:2 D5:2 F5:2 A5:2", "A5:6 G5:2 F5:2 E5:2",
                    "D5:2 F5:2 Bb5:2 A5:3 G5:1 F5:2", "E5:2 G5:2 C6:2 Bb5:3 A5:1 G5:2", "A5:4 G5:2 F5:2 E5:2 C#5:2", "D5:2 E5:2 C#5:2 A4:6",
                ],
                squeeze: [
                    "r:2 D4+F4+A4:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2", "r:2 D4+F4+A4:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2",
                    "r:2 Bb3+D4+F4:2 Bb3+D4+F4:2 r:2 Bb3+D4+F4:2 Bb3+D4+F4:2", "r:2 C4+E4+G4:2 C4+E4+G4:2 r:2 C4+E4+G4:2 C4+E4+G4:2",
                    "r:2 D4+F4+A4:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2", "r:2 Bb3+D4+F4:2 Bb3+D4+F4:2 r:2 Bb3+D4+F4:2 Bb3+D4+F4:2",
                    "r:2 Bb3+D4+G4:2 Bb3+D4+G4:2 r:2 Bb3+D4+G4:2 Bb3+D4+G4:2", "r:2 C#4+E4+A4:2 C#4+E4+A4:2 r:2 C#4+E4+A4:2 C#4+E4+A4:2",
                    "r:2 C4+F4+A4:2 C4+F4+A4:2 r:2 C4+F4+A4:2 C4+F4+A4:2", "r:2 C4+E4+G4:2 C4+E4+G4:2 r:2 C4+E4+G4:2 C4+E4+G4:2",
                    "r:2 D4+F4+A4:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2", "r:2 D4+F4+A4:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2",
                    "r:2 Bb3+D4+F4:2 Bb3+D4+F4:2 r:2 Bb3+D4+F4:2 Bb3+D4+F4:2", "r:2 C4+E4+G4:2 C4+E4+G4:2 r:2 C4+E4+G4:2 C4+E4+G4:2",
                    "r:2 C#4+E4+A4:2 C#4+E4+A4:2 r:2 C#4+E4+A4:2 C#4+E4+A4:2", "r:2 C#4+E4+A4:2 C#4+E4+A4:2 r:2 C#4+E4+A4:2 C#4+E4+A4:2",
                ],
                ostinato: [
                    "D3:2 D3:1 D3:1 A3:2 D3:2 D3:1 D3:1 A3:2", "D3:2 D3:1 D3:1 A3:2 D3:2 D3:1 D3:1 A3:2",
                    "Bb3:2 Bb3:1 Bb3:1 F4:2 Bb3:2 Bb3:1 Bb3:1 F4:2", "C4:2 C4:1 C4:1 G4:2 C4:2 C4:1 C4:1 G4:2",
                    "D3:2 D3:1 D3:1 A3:2 D3:2 D3:1 D3:1 A3:2", "Bb3:2 Bb3:1 Bb3:1 F4:2 Bb3:2 Bb3:1 Bb3:1 F4:2",
                    "G3:2 G3:1 G3:1 D4:2 G3:2 G3:1 G3:1 D4:2", "A3:2 A3:1 A3:1 E4:2 A3:2 A3:1 A3:1 E4:2",
                    "F3:2 F3:1 F3:1 C4:2 F3:2 F3:1 F3:1 C4:2", "C4:2 C4:1 C4:1 G4:2 C4:2 C4:1 C4:1 G4:2",
                    "D3:2 D3:1 D3:1 A3:2 D3:2 D3:1 D3:1 A3:2", "D3:2 D3:1 D3:1 A3:2 D3:2 D3:1 D3:1 A3:2",
                    "Bb3:2 Bb3:1 Bb3:1 F4:2 Bb3:2 Bb3:1 Bb3:1 F4:2", "C4:2 C4:1 C4:1 G4:2 C4:2 C4:1 C4:1 G4:2",
                    "A3:2 A3:1 A3:1 E4:2 A3:2 A3:1 A3:1 E4:2", "A3:2 A3:1 A3:1 E4:2 A3:2 A3:1 A3:1 E4:2",
                ],
                cello: [
                    "D2:6 D2:6", "D2:6 D2:6", "Bb2:6 Bb2:6", "C3:6 C3:6",
                    "D2:6 D2:6", "Bb2:6 Bb2:6", "G2:6 G2:6", "A2:6 A2:6",
                    "F2:6 F2:6", "C3:6 C3:6", "D2:6 D2:6", "D2:6 D2:6",
                    "Bb2:6 Bb2:6", "C3:6 C3:6", "A2:6 A2:6", "A2:6 A2:6",
                ],
                drums: [
                    "B+C:2 J:2 J:2 F:2 J:2 J:2", "B:2 J:2 B:2 S:2 J:1 J:1 J:2", "B:2 J:2 J:2 F:2 J:2 J:2", "B:2 B:2 S:1 S:1 S:2 F:1 F:1 S:1 S:1",
                ],
            },
        },
        // Title: "Under the Black Flag". A minor, 6/8. A rollicking shanty: fiddle tune with horn answers, then the horns take the tune and the fiddle runs.
        "black-flag": {
            title: "Under the Black Flag", group: "title", volume: 1.0,
            mood: "Rollicking shanty in A minor: fiddle and accordion, horn answers",
            bpm: 70, stepsPerBeat: 6, barSteps: 12,
            channels: {
                lead: [
                    "E4:2 A4:2 B4:2 C5:3 B4:1 A4:2", "B4:2 A4:2 E4:2 A4:6", "D4:2 G4:2 A4:2 B4:3 A4:1 G4:2", "A4:2 G4:2 D4:2 G4:6",
                    "E4:2 A4:2 B4:2 C5:3 D5:1 E5:2", "D5:2 C5:2 B4:2 A4:4 C5:2", "B4:3 A4:1 G#4:2 E4:2 F4:2 G#4:2", "B4:6 r:6",
                    "r:6 G5:1 F5:1 E5:1 D5:1 C5:2", "r:6 D5:1 C5:1 B4:1 A4:1 G4:2", "r:6 E5:1 D5:1 C5:1 B4:1 A4:2", "r:6 G5:1 F#5:1 E5:1 D5:1 B4:2",
                    "r:6 A5:1 G5:1 F5:1 E5:1 C5:2", "r:6 B5:1 A5:1 G5:1 F5:1 D5:2", "r:6 E5:1 F5:1 G#5:1 A5:1 B5:2", "r:6 E5:2 B4:2 G#4:2",
                ],
                brass: [
                    "r:12", "r:6 A3:2 C4:2 E4:2", "r:12", "r:6 G3:2 B3:2 D4:2",
                    "r:12", "r:6 A3:2 C4:2 E4:2", "r:12", "r:6 G#3:2 B3:2 E4:2",
                    "E4:4 G4:2 C5:6", "B4:4 A4:2 G4:2 D4:4", "C5:4 B4:2 A4:2 E4:2 A4:2", "B4:6 G4:6",
                    "A4:4 C5:2 F5:6", "D5:4 B4:2 G4:2 A4:2 B4:2", "G#4:4 B4:2 E5:6", "D5:2 C5:2 B4:2 G#4:6",
                ],
                squeeze: [
                    "C4+E4+A4:2 r:2 C4+E4+A4:2 C4+E4+A4:2 r:2 C4+E4+A4:2", "C4+E4+A4:2 r:2 C4+E4+A4:2 C4+E4+A4:2 r:2 C4+E4+A4:2",
                    "B3+D4+G4:2 r:2 B3+D4+G4:2 B3+D4+G4:2 r:2 B3+D4+G4:2", "B3+D4+G4:2 r:2 B3+D4+G4:2 B3+D4+G4:2 r:2 B3+D4+G4:2",
                    "C4+E4+A4:2 r:2 C4+E4+A4:2 C4+E4+A4:2 r:2 C4+E4+A4:2", "C4+E4+A4:2 r:2 C4+E4+A4:2 C4+E4+A4:2 r:2 C4+E4+A4:2",
                    "B3+E4+G#4:2 r:2 B3+E4+G#4:2 B3+E4+G#4:2 r:2 B3+E4+G#4:2", "B3+E4+G#4:2 r:2 B3+E4+G#4:2 B3+E4+G#4:2 r:2 B3+E4+G#4:2",
                    "C4+E4+G4:2 r:2 C4+E4+G4:2 C4+E4+G4:2 r:2 C4+E4+G4:2", "B3+D4+G4:2 r:2 B3+D4+G4:2 B3+D4+G4:2 r:2 B3+D4+G4:2",
                    "C4+E4+A4:2 r:2 C4+E4+A4:2 C4+E4+A4:2 r:2 C4+E4+A4:2", "B3+E4+G4:2 r:2 B3+E4+G4:2 B3+E4+G4:2 r:2 B3+E4+G4:2",
                    "C4+F4+A4:2 r:2 C4+F4+A4:2 C4+F4+A4:2 r:2 C4+F4+A4:2", "B3+D4+G4:2 r:2 B3+D4+G4:2 B3+D4+G4:2 r:2 B3+D4+G4:2",
                    "B3+E4+G#4:2 r:2 B3+E4+G#4:2 B3+E4+G#4:2 r:2 B3+E4+G#4:2", "B3+E4+G#4:2 r:2 B3+E4+G#4:2 B3+E4+G#4:2 r:2 B3+E4+G#4:2",
                ],
                ostinato: [
                    "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2", "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2", "G3:2 G3:1 G3:1 G3:2 D4:2 G3:1 G3:1 G3:2", "G3:2 G3:1 G3:1 G3:2 D4:2 G3:1 G3:1 G3:2",
                    "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2", "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2", "E3:2 E3:1 E3:1 E3:2 B3:2 E3:1 E3:1 E3:2", "E3:2 E3:1 E3:1 E3:2 B3:2 E3:1 E3:1 E3:2",
                    "C4:2 C4:1 C4:1 C4:2 G4:2 C4:1 C4:1 C4:2", "G3:2 G3:1 G3:1 G3:2 D4:2 G3:1 G3:1 G3:2", "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2", "E3:2 E3:1 E3:1 E3:2 B3:2 E3:1 E3:1 E3:2",
                    "F3:2 F3:1 F3:1 F3:2 C4:2 F3:1 F3:1 F3:2", "G3:2 G3:1 G3:1 G3:2 D4:2 G3:1 G3:1 G3:2", "E3:2 E3:1 E3:1 E3:2 B3:2 E3:1 E3:1 E3:2", "E3:2 E3:1 E3:1 E3:2 B3:2 E3:1 E3:1 E3:2",
                ],
                cello: [
                    "A2:4 E3:2 A2:4 E3:2", "A2:4 E3:2 A2:4 E3:2", "G2:4 D3:2 G2:4 D3:2", "G2:4 D3:2 G2:4 D3:2",
                    "A2:4 E3:2 A2:4 E3:2", "A2:4 E3:2 A2:4 E3:2", "E2:4 B2:2 E2:4 B2:2", "E2:4 B2:2 E2:4 B2:2",
                    "C3:4 G3:2 C3:4 G3:2", "G2:4 D3:2 G2:4 D3:2", "A2:4 E3:2 A2:4 E3:2", "E2:4 B2:2 E2:4 B2:2",
                    "F2:4 C3:2 F2:4 C3:2", "G2:4 D3:2 G2:4 D3:2", "E2:4 B2:2 E2:4 B2:2", "E2:4 B2:2 E2:4 B2:2",
                ],
                drums: [
                    "B+C:2 J:2 J:2 S:2 J:2 J:2", "K:2 J:2 K:2 S:2 J:2 J:1 J:1", "B:2 J:2 J:2 S:2 J:2 J:2", "K:2 J:2 K:2 S:2 S:1 S:1 S:1 S:1",
                ],
            },
        },
        // Title: "The Captain's Oath". G minor, 4/4. Cinematic: galloping low strings and taiko under a horn theme, then a fiddle tune with horn stabs.
        "captains-oath": {
            title: "The Captain's Oath", group: "title", volume: 0.85,
            mood: "Cinematic and heroic in G minor: horn theme, galloping strings, taiko",
            bpm: 92, stepsPerBeat: 4, barSteps: 16,
            channels: {
                brass: [
                    "G4:6 D4:2 G4:2 A4:2 Bb4:4", "A4:2 G4:2 F4:2 D4:2 G4:8",
                    "G4:6 Bb4:2 Eb5:8", "D5:4 C5:4 A4:4 F4:4",
                    "G4:6 D5:2 D5:4 C5:2 Bb4:2", "C5:4 Bb4:2 G4:2 Eb5:8",
                    "Eb5:4 D5:2 C5:2 Bb4:4 A4:2 G4:2", "F#4:8 A4:4 D5:4",
                    "Bb3+D4+F4:3 r:5 Bb3+D4+F4:2 r:2 Bb3+D4+F4:4", "C4+F4+A4:3 r:5 C4+F4+A4:2 r:2 C4+F4+A4:4",
                    "Bb3+D4+G4:3 r:5 Bb3+D4+G4:2 r:2 Bb3+D4+G4:4", "Bb3+Eb4+G4:3 r:5 Bb3+Eb4+G4:2 r:2 Bb3+Eb4+G4:4",
                    "C4+Eb4+G4:3 r:5 C4+Eb4+G4:2 r:2 C4+Eb4+G4:4", "D4+F#4+A4:3 r:5 D4+F#4+A4:2 r:2 D4+F#4+A4:4",
                    "Bb3+D4+G4:3 r:5 Bb3+D4+G4:2 r:2 Bb3+D4+G4:4", "D4+F#4+A4:3 r:5 D4+F#4+A4:2 r:2 D4+F#4+A4:4",
                ],
                lead: [
                    "r:16", "r:16", "r:16", "r:16",
                    "r:16", "r:16", "r:16", "r:16",
                    "D5:4 F5:4 Bb5:6 A5:2", "A5:4 G5:2 F5:2 C5:8", "D5:2 G5:2 A5:2 Bb5:2 A5:4 G5:4", "G5:6 F5:2 Eb5:8",
                    "Eb5:4 G5:4 C6:6 Bb5:2", "A5:4 F#5:4 D5:8", "G5:3 F#5:1 G5:2 A5:2 Bb5:4 A5:2 G5:2", "F#5:8 A5:4 D5:4",
                ],
                strings: [
                    "r:16", "r:16", "r:16", "r:16",
                    "r:16", "r:16", "r:16", "r:16",
                    "Bb3+D4+F4:16", "C4+F4+A4:16", "Bb3+D4+G4:16", "Bb3+Eb4+G4:16",
                    "C4+Eb4+G4:16", "D4+F#4+A4:16", "Bb3+D4+G4:16", "D4+F#4+A4:16",
                ],
                ostinato: [
                    "G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 D4:2 G3:1 G3:1",
                    "G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 D4:2 G3:1 G3:1",
                    "Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:1 Eb3:1 Bb3:2 Eb3:1 Eb3:1",
                    "F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 C4:2 F3:1 F3:1",
                    "G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 D4:2 G3:1 G3:1",
                    "Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:1 Eb3:1 Bb3:2 Eb3:1 Eb3:1",
                    "C4:2 C4:1 C4:1 C4:2 C4:1 C4:1 C4:2 C4:1 C4:1 G4:2 C4:1 C4:1",
                    "D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 A3:2 D3:1 D3:1",
                    "Bb3:2 Bb3:1 Bb3:1 Bb3:2 Bb3:1 Bb3:1 Bb3:2 Bb3:1 Bb3:1 F4:2 Bb3:1 Bb3:1",
                    "F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 C4:2 F3:1 F3:1",
                    "G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 D4:2 G3:1 G3:1",
                    "Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:1 Eb3:1 Bb3:2 Eb3:1 Eb3:1",
                    "C4:2 C4:1 C4:1 C4:2 C4:1 C4:1 C4:2 C4:1 C4:1 G4:2 C4:1 C4:1",
                    "D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 A3:2 D3:1 D3:1",
                    "G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 D4:2 G3:1 G3:1",
                    "D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 A3:2 D3:1 D3:1",
                ],
                cello: [
                    "G2:8 G2:8", "G2:8 G2:8", "Eb2:8 Eb2:8", "F2:8 F2:8",
                    "G2:8 G2:8", "Eb2:8 Eb2:8", "C3:8 C3:8", "D2:8 D2:8",
                    "Bb2:8 Bb2:8", "F2:8 F2:8", "G2:8 G2:8", "Eb2:8 Eb2:8",
                    "C3:8 C3:8", "D2:8 D2:8", "G2:8 G2:8", "D2:8 D2:8",
                ],
                sub: [
                    "r:16", "r:16", "r:16", "r:16",
                    "r:16", "r:16", "r:16", "r:16",
                    "Bb2:16", "F2:16", "G2:16", "Eb2:16",
                    "C3:16", "D2:16", "G2:16", "D2:16",
                ],
                drums: [
                    "B+C:4 r:2 B:2 S:4 r:2 B:2", "B:4 r:2 B:2 S:4 F:2 F:2", "B:4 r:2 B:2 S:4 r:2 B:2", "B:4 F:2 F:2 S:2 S:2 S:1 S:1 S:1 S:1",
                ],
            },
        },
        // Chapter 1: "Sea Legs". The short loop over and over, with a variation every few times round.
        // One loop is 26 s; the whole cycle is about 3:33 before it repeats.
        "sea-legs": {
            title: "Sea Legs", group: "chapter", volume: 1.7,
            mood: "Light, curious and jaunty in A dorian: fiddle, pizzicato, accordion",
            bpm: 72, stepsPerBeat: 6, barSteps: 12,
            // The normal loop is the "sea-legs-short" track (same notes).
            loop: "sea-legs-short",
            // The order the passes play in, then it starts again. Each pass is one time round the loop.
            cycle: ["normal", "normal", "changeup", "normal", "normal", "grand", "normal", "breakdown"],
            // Each variation changes some parts of the normal loop: `mute` silences parts,
            // `channels` replaces or adds parts, `volume` sets that pass's level.
            variations: {
                // Change-up: a second fiddle joins in, with drum fills.
                changeup: {
                    volume: 1.0,
                    channels: {
                        lead2: [
                            "C5:2 r:1 F#4:1 A4:2 C5:2 B4:1 A4:1 G4:2", "F#4:2 B4:2 D5:2 A4:4 r:2",
                            "C5:2 r:1 F#4:1 A4:2 C5:2 D5:1 E5:1 F#5:2", "D5:2 B4:2 F#4:2 A4:4 r:2",
                            "E5:2 C5:1 A4:1 E4:2 A4:2 C5:2 E5:2", "B4:2 G4:1 E4:1 B3:2 E4:2 G4:2 B4:2",
                            "G#4:3 A4:1 G4:2 F4:2 F#4:2 G4:2", "B4:6 r:6",
                            "E5:4 E5:1 D5:1 C5:2 A4:2 C5:2", "B4:4 G4:2 E4:2 G4:2 B4:2",
                            "D5:4 C5:1 B4:1 F#4:2 B4:2 D5:2", "C5:6 r:6",
                            "E5:4 D5:1 C5:1 A4:2 C5:2 E5:2", "F#5:4 E5:1 D5:1 B4:2 D5:2 F#5:2",
                            "F5:2 F#5:2 G5:2 B4:3 D5:1 F5:2", "G#5:6 r:6",
                        ],
                        drums2: [
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                            "C:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                        ],
                    },
                },
                // Grand: the horns double the tune, big taiko and cymbals, deep bass.
                grand: {
                    volume: 0.58,
                    channels: {
                        lead: [
                            "E5:2 r:1 A4:1 C5:2 E5:2 D5:1 C5:1 B4:2", "A4:2 D5:2 F#5:2 E5:4 r:2",
                            "E5:2 r:1 A4:1 C5:2 E5:2 F#5:1 G5:1 A5:2", "F#5:2 D5:2 A4:2 D5:4 r:2",
                            "G5:2 E5:1 C5:1 G4:2 C5:2 E5:2 G5:2", "D5:2 B4:1 G4:1 D4:2 G4:2 B4:2 D5:2",
                            "B4:3 C5:1 B4:2 G#4:2 A4:2 B4:2", "E5:6 r:6",
                            "A5:4 G5:1 F#5:1 E5:2 C5:2 E5:2", "D5:4 B4:2 G4:2 B4:2 D5:2",
                            "F#5:4 E5:1 D5:1 A4:2 D5:2 F#5:2", "E5:6 r:6",
                            "G5:4 F#5:1 E5:1 C5:2 E5:2 G5:2", "A5:4 G5:1 F#5:1 D5:2 F#5:2 A5:2",
                            "G#5:2 A5:2 B5:2 E5:3 F#5:1 G#5:2", "B5:6 r:6",
                        ],
                        brass2: [
                            "E4:2 r:1 A3:1 C4:2 E4:2 D4:1 C4:1 B3:2", "A3:2 D4:2 F#4:2 E4:4 r:2",
                            "E4:2 r:1 A3:1 C4:2 E4:2 F#4:1 G4:1 A4:2", "F#4:2 D4:2 A3:2 D4:4 r:2",
                            "G4:2 E4:1 C4:1 G3:2 C4:2 E4:2 G4:2", "D4:2 B3:1 G3:1 D3:2 G3:2 B3:2 D4:2",
                            "B3:3 C4:1 B3:2 G#3:2 A3:2 B3:2", "E4:6 r:6",
                            "A4:4 G4:1 F#4:1 E4:2 C4:2 E4:2", "D4:4 B3:2 G3:2 B3:2 D4:2",
                            "F#4:4 E4:1 D4:1 A3:2 D4:2 F#4:2", "E4:6 r:6",
                            "G4:4 F#4:1 E4:1 C4:2 E4:2 G4:2", "A4:4 G4:1 F#4:1 D4:2 F#4:2 A4:2",
                            "G#4:2 A4:2 B4:2 E4:3 F#4:1 G#4:2", "B4:6 r:6",
                        ],
                        drums2: [
                            "B+C:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B+C:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        sub: [
                            "A2:12", "D2:12", "A2:12", "D2:12",
                            "C3:12", "G2:12", "E2:12", "E2:12",
                            "A2:12", "G2:12", "D2:12", "A2:12",
                            "C3:12", "D2:12", "E2:12", "E2:12",
                        ],
                    },
                },
                // Breakdown: just the fiddle, a plucked bass and light drums, then a fill back in.
                breakdown: {
                    volume: 0.95,
                    mute: ["brass", "bell", "squeeze"],
                    channels: {
                        lead: [
                            "E5:2 r:1 A4:1 C5:2 E5:2 D5:1 C5:1 B4:2", "A4:2 D5:2 F#5:2 E5:4 r:2",
                            "E5:2 r:1 A4:1 C5:2 E5:2 F#5:1 G5:1 A5:2", "F#5:2 D5:2 A4:2 D5:4 r:2",
                            "G5:2 E5:1 C5:1 G4:2 C5:2 E5:2 G5:2", "D5:2 B4:1 G4:1 D4:2 G4:2 B4:2 D5:2",
                            "B4:3 C5:1 B4:2 G#4:2 A4:2 B4:2", "E5:6 r:6",
                            "A5:4 G5:1 F#5:1 E5:2 C5:2 E5:2", "D5:4 B4:2 G4:2 B4:2 D5:2",
                            "F#5:4 E5:1 D5:1 A4:2 D5:2 F#5:2", "E5:6 r:6",
                            "G5:4 F#5:1 E5:1 C5:2 E5:2 G5:2", "A5:4 G5:1 F#5:1 D5:2 F#5:2 A5:2",
                            "G#5:2 A5:2 B5:2 E5:3 F#5:1 G#5:2", "B5:6 r:6",
                        ],
                        drums: [
                            "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1", "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1",
                            "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1", "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1",
                            "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1", "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1",
                            "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1", "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1",
                        ],
                        drums2: [
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                        ],
                    },
                },
            },
        },
        // Chapter 2: "Pressure". The short loop over and over, with a variation every few times round.
        // One loop is 30 s; the whole cycle is about 4:07 before it repeats.
        "pressure": {
            title: "Pressure", group: "chapter", volume: 1.15,
            mood: "Clockwork heist in E minor: ticking plucks, whirring strings, sneaky fiddle",
            bpm: 124, stepsPerBeat: 4, barSteps: 16,
            // The normal loop is the "pressure-short" track (same notes).
            loop: "pressure-short",
            // The order the passes play in, then it starts again. Each pass is one time round the loop.
            cycle: ["normal", "normal", "changeup", "normal", "normal", "grand", "normal", "breakdown"],
            // Each variation changes some parts of the normal loop: `mute` silences parts,
            // `channels` replaces or adds parts, `volume` sets that pass's level.
            variations: {
                // Change-up: a second fiddle joins in, with drum fills.
                changeup: {
                    volume: 1.0,
                    channels: {
                        lead2: [
                            "C4:2 D4:2 E4:2 C4:2 G4:3 G4:1 G4:2 E4:2", "D4:2 E4:2 F#4:2 D4:2 B3:4 G3:4",
                            "C5:2 B4:2 A4:2 G4:2 F#4:2 E4:2 F#4:2 A4:2", "F#4:4 C5:2 D5:2 F#5:3 E5:1 D#5:4",
                            "C5:2 D5:2 E5:2 C5:2 G5:3 G5:1 G5:2 E5:2", "D5:2 E5:2 F#5:2 D5:2 B4:4 E5:2 G5:2",
                            "A5:2 G5:2 F#5:2 E5:2 C5:2 D5:2 E5:2 F#5:2", "G5:2 F#5:2 D5:2 C5:2 F#4:4 r:4",
                            "E5:4 G5:2 C6:4 B5:2 C6:2 E6:2", "F#5:4 E5:2 D5:4 A4:2 D5:2 F#5:2",
                            "G5:4 F#5:2 E5:2 B4:2 E5:2 G5:4", "B5:4 A5:2 G5:2 F#5:2 E5:2 B4:4",
                            "E5:4 G5:2 C6:4 B5:2 A5:2 G5:2", "A5:4 F#5:2 D5:4 E5:2 F#5:2 A5:2",
                            "D#5:2 F#5:2 B5:4 A5:2 F#5:2 D#5:4", "F#6:4 D#6:4 B5:4 r:4",
                        ],
                        drums2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                            "C:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                        ],
                    },
                },
                // Grand: the horns double the tune, big taiko and cymbals, deep bass.
                grand: {
                    volume: 0.82,
                    channels: {
                        lead: [
                            "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 B3:4",
                            "E5:2 D5:2 C5:2 B4:2 A4:2 G4:2 A4:2 C5:2", "B4:4 D#5:2 F#5:2 A5:3 G5:1 F#5:4",
                            "E5:2 F#5:2 G5:2 E5:2 B5:3 A#5:1 B5:2 G5:2", "F#5:2 G5:2 A5:2 F#5:2 E5:4 G5:2 B5:2",
                            "C6:2 B5:2 A5:2 G5:2 E5:2 F#5:2 G5:2 A5:2", "B5:2 A5:2 F#5:2 D#5:2 B4:4 r:4",
                            "E5:4 G5:2 C6:4 B5:2 C6:2 E6:2", "F#5:4 E5:2 D5:4 A4:2 D5:2 F#5:2",
                            "G5:4 F#5:2 E5:2 B4:2 E5:2 G5:4", "B5:4 A5:2 G5:2 F#5:2 E5:2 B4:4",
                            "E5:4 G5:2 C6:4 B5:2 A5:2 G5:2", "A5:4 F#5:2 D5:4 E5:2 F#5:2 A5:2",
                            "D#5:2 F#5:2 B5:4 A5:2 F#5:2 D#5:4", "F#6:4 D#6:4 B5:4 r:4",
                        ],
                        brass2: [
                            "E3:2 F#3:2 G3:2 E3:2 B3:3 A#3:1 B3:2 G3:2", "F#3:2 G3:2 A3:2 F#3:2 E3:4 B2:4",
                            "E4:2 D4:2 C4:2 B3:2 A3:2 G3:2 A3:2 C4:2", "B3:4 D#4:2 F#4:2 A4:3 G4:1 F#4:4",
                            "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 G4:2 B4:2",
                            "C5:2 B4:2 A4:2 G4:2 E4:2 F#4:2 G4:2 A4:2", "B4:2 A4:2 F#4:2 D#4:2 B3:4 r:4",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                        ],
                        drums2: [
                            "B+C:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B+C:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        sub: [
                            "E2:16", "E2:16", "C3:16", "B2:16",
                            "E2:16", "E2:16", "A2:16", "B2:16",
                            "C3:16", "D2:16", "E2:16", "E2:16",
                            "C3:16", "D2:16", "B2:16", "B2:16",
                        ],
                    },
                },
                // Breakdown: just the fiddle, a plucked bass and light drums, then a fill back in.
                breakdown: {
                    volume: 1.25,
                    mute: ["brass", "ostinato", "cello"],
                    channels: {
                        lead: [
                            "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 B3:4",
                            "E5:2 D5:2 C5:2 B4:2 A4:2 G4:2 A4:2 C5:2", "B4:4 D#5:2 F#5:2 A5:3 G5:1 F#5:4",
                            "E5:2 F#5:2 G5:2 E5:2 B5:3 A#5:1 B5:2 G5:2", "F#5:2 G5:2 A5:2 F#5:2 E5:4 G5:2 B5:2",
                            "C6:2 B5:2 A5:2 G5:2 E5:2 F#5:2 G5:2 A5:2", "B5:2 A5:2 F#5:2 D#5:2 B4:4 r:4",
                            "E5:4 G5:2 C6:4 B5:2 C6:2 E6:2", "F#5:4 E5:2 D5:4 A4:2 D5:2 F#5:2",
                            "G5:4 F#5:2 E5:2 B4:2 E5:2 G5:4", "B5:4 A5:2 G5:2 F#5:2 E5:2 B4:4",
                            "E5:4 G5:2 C6:4 B5:2 A5:2 G5:2", "A5:4 F#5:2 D5:4 E5:2 F#5:2 A5:2",
                            "D#5:2 F#5:2 B5:4 A5:2 F#5:2 D#5:4", "F#6:4 D#6:4 B5:4 r:4",
                        ],
                        drums: [
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 h:1 h:1 A:2 h:1 h:1",
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 h:1 h:1 A:2 h:1 h:1",
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 h:1 h:1 A:2 h:1 h:1",
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 h:1 h:1 A:2 h:1 h:1",
                            "k:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 k:2", "k:2 h:1 h:1 A:2 k:2 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                        ],
                        drums2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                        ],
                    },
                },
            },
        },
        // Chapter 3: "Locks and Keys". The short loop over and over, with a variation every few times round.
        // One loop is 24 s; the whole cycle is about 3:12 before it repeats.
        "locks-keys": {
            title: "Locks and Keys", group: "chapter", volume: 1.0,
            mood: "Mysterious and adventurous in D minor: music-box bells, horn call, gallop",
            bpm: 80, stepsPerBeat: 6, barSteps: 12,
            // The normal loop is the "locks-keys-short" track (same notes).
            loop: "locks-keys-short",
            // The order the passes play in, then it starts again. Each pass is one time round the loop.
            cycle: ["normal", "normal", "changeup", "normal", "normal", "grand", "normal", "breakdown"],
            // Each variation changes some parts of the normal loop: `mute` silences parts,
            // `channels` replaces or adds parts, `volume` sets that pass's level.
            variations: {
                // Change-up: a second fiddle joins in, with drum fills.
                changeup: {
                    volume: 1.0,
                    channels: {
                        lead2: [
                            "A4:6 D5:3 E5:1 F5:2", "F5:3 E5:1 D5:2 Bb4:2 D5:2 F5:2",
                            "A4:2 D5:2 E5:2 F5:3 G5:1 A5:2", "Bb5:6 A5:3 G5:1 F5:2",
                            "G5:4 Bb5:2 D6:6", "C6:3 Bb5:1 A5:2 F5:2 A5:2 D6:2",
                            "G5:2 A5:2 Bb5:2 D6:3 C6:1 Bb5:2", "A5:6 C#5:2 E5:2 A5:2",
                            "F5:4 A5:2 F5:3 E5:1 D5:2", "E5:2 C5:1 D5:1 E5:2 C5:2 A4:2 C5:2",
                            "D5:4 Bb4:2 G4:2 Bb4:2 D5:2", "F5:6 E5:2 F5:2 A5:2",
                            "Bb5:4 A5:2 G5:2 F5:2 E5:2", "D5:3 E5:1 D5:2 Bb4:2 C5:2 D5:2",
                            "Bb4:2 C5:2 F5:2 E5:3 D5:1 C5:2", "Bb4:2 Bb4:2 C5:2 D5:2 E5:2 F5:2",
                        ],
                        drums2: [
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                            "C:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                        ],
                    },
                },
                // Grand: the horns double the tune, big taiko and cymbals, deep bass.
                grand: {
                    volume: 0.72,
                    channels: {
                        lead: [
                            "A4:6 D5:3 E5:1 F5:2", "F5:3 E5:1 D5:2 Bb4:2 D5:2 F5:2",
                            "A4:2 D5:2 E5:2 F5:3 G5:1 A5:2", "Bb5:6 A5:3 G5:1 F5:2",
                            "G5:4 Bb5:2 D6:6", "C6:3 Bb5:1 A5:2 F5:2 A5:2 D6:2",
                            "G5:2 A5:2 Bb5:2 D6:3 C6:1 Bb5:2", "A5:6 C#5:2 E5:2 A5:2",
                            "A5:4 C6:2 A5:3 G5:1 F5:2", "G5:2 E5:1 F5:1 G5:2 E5:2 C5:2 E5:2",
                            "F5:4 D5:2 Bb4:2 D5:2 F5:2", "A5:6 G5:2 A5:2 C6:2",
                            "D6:4 C6:2 Bb5:2 A5:2 G5:2", "F5:3 G5:1 F5:2 D5:2 E5:2 F5:2",
                            "C#5:2 E5:2 A5:2 G5:3 F5:1 E5:2", "C#5:2 D5:2 E5:2 F5:2 G5:2 A5:2",
                        ],
                        brass2: [
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "A4:4 C5:2 A4:3 G4:1 F4:2", "G4:2 E4:1 F4:1 G4:2 E4:2 C4:2 E4:2",
                            "F4:4 D4:2 Bb3:2 D4:2 F4:2", "A4:6 G4:2 A4:2 C5:2",
                            "D5:4 C5:2 Bb4:2 A4:2 G4:2", "F4:3 G4:1 F4:2 D4:2 E4:2 F4:2",
                            "C#4:2 E4:2 A4:2 G4:3 F4:1 E4:2", "C#4:2 D4:2 E4:2 F4:2 G4:2 A4:2",
                        ],
                        drums2: [
                            "B+C:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B+C:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        sub: [
                            "D2:12", "Bb2:12", "D2:12", "Bb2:12",
                            "G2:12", "D2:12", "G2:12", "A2:12",
                            "F2:12", "C3:12", "Bb2:12", "F2:12",
                            "G2:12", "Bb2:12", "A2:12", "A2:12",
                        ],
                    },
                },
                // Breakdown: just the fiddle, a plucked bass and light drums, then a fill back in.
                breakdown: {
                    volume: 1.35,
                    mute: ["brass", "ostinato", "cello"],
                    channels: {
                        lead: [
                            "A4:6 D5:3 E5:1 F5:2", "F5:3 E5:1 D5:2 Bb4:2 D5:2 F5:2",
                            "A4:2 D5:2 E5:2 F5:3 G5:1 A5:2", "Bb5:6 A5:3 G5:1 F5:2",
                            "G5:4 Bb5:2 D6:6", "C6:3 Bb5:1 A5:2 F5:2 A5:2 D6:2",
                            "G5:2 A5:2 Bb5:2 D6:3 C6:1 Bb5:2", "A5:6 C#5:2 E5:2 A5:2",
                            "A5:4 C6:2 A5:3 G5:1 F5:2", "G5:2 E5:1 F5:1 G5:2 E5:2 C5:2 E5:2",
                            "F5:4 D5:2 Bb4:2 D5:2 F5:2", "A5:6 G5:2 A5:2 C6:2",
                            "D6:4 C6:2 Bb5:2 A5:2 G5:2", "F5:3 G5:1 F5:2 D5:2 E5:2 F5:2",
                            "C#5:2 E5:2 A5:2 G5:3 F5:1 E5:2", "C#5:2 D5:2 E5:2 F5:2 G5:2 A5:2",
                        ],
                        drums: [
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:1 s:1 s:1 s:1 s:2",
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:1 s:1 s:1 s:1 s:2",
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:1 s:1 s:1 s:1 s:2",
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 F:2 s:1 s:1 s:1 s:1 s:2",
                        ],
                        drums2: [
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                        ],
                        pizz: [
                            "D3:2 r:2 A3:2 D3:2 r:2 A3:2", "Bb3:2 r:2 F4:2 Bb3:2 r:2 F4:2", "D3:2 r:2 A3:2 D3:2 r:2 A3:2", "Bb3:2 r:2 F4:2 Bb3:2 r:2 F4:2",
                            "G3:2 r:2 D4:2 G3:2 r:2 D4:2", "D3:2 r:2 A3:2 D3:2 r:2 A3:2", "G3:2 r:2 D4:2 G3:2 r:2 D4:2", "A3:2 r:2 E4:2 A3:2 r:2 E4:2",
                            "F3:2 r:2 C4:2 F3:2 r:2 C4:2", "C4:2 r:2 G4:2 C4:2 r:2 G4:2", "Bb3:2 r:2 F4:2 Bb3:2 r:2 F4:2", "F3:2 r:2 C4:2 F3:2 r:2 C4:2",
                            "G3:2 r:2 D4:2 G3:2 r:2 D4:2", "Bb3:2 r:2 F4:2 Bb3:2 r:2 F4:2", "A3:2 r:2 E4:2 A3:2 r:2 E4:2", "A3:2 r:2 E4:2 A3:2 r:2 E4:2",
                        ],
                    },
                },
            },
        },
        // Chapter 4: "Gunpowder". The short loop over and over, with a variation every few times round.
        // One loop is 34 s; the whole cycle is about 4:34 before it repeats.
        "gunpowder": {
            title: "Gunpowder", group: "chapter", volume: 1.0,
            mood: "Bold and martial in A minor: marching horns, snare rolls, taiko",
            bpm: 112, stepsPerBeat: 4, barSteps: 16,
            // The normal loop is the "gunpowder-short" track (same notes).
            loop: "gunpowder-short",
            // The order the passes play in, then it starts again. Each pass is one time round the loop.
            cycle: ["normal", "normal", "changeup", "normal", "normal", "grand", "normal", "breakdown"],
            // Each variation changes some parts of the normal loop: `mute` silences parts,
            // `channels` replaces or adds parts, `volume` sets that pass's level.
            variations: {
                // Change-up: a second fiddle joins in, with drum fills.
                changeup: {
                    volume: 1.0,
                    channels: {
                        lead2: [
                            "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8",
                            "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
                            "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8",
                            "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
                            "B4:2 D5:2 F5:2 B5:2 A5:2 F5:2 D5:2 F5:2", "C5:2 F5:2 A5:2 C6:2 B5:2 A5:2 G5:2 A5:2",
                            "F5:4 D5:2 A4:2 C5:4 F5:4", "E5:2 G5:2 B5:4 A5:2 G5:2 F5:2 E5:2",
                            "D5:4 F5:4 A5:6 A5:2", "A5:4 G5:2 F5:2 C5:8",
                            "F5:2 F5:2 G5:2 A5:2 B5:2 A5:2 G5:2 F5:2", "G#5:8 E5:4 B4:4",
                        ],
                        drums2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                            "C:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                        ],
                    },
                },
                // Grand: the horns double the tune, big taiko and cymbals, deep bass.
                grand: {
                    volume: 0.75,
                    channels: {
                        lead: [
                            "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8",
                            "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
                            "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8",
                            "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
                            "D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:2 A5:2", "E5:2 A5:2 C6:2 E6:2 D6:2 C6:2 B5:2 C6:2",
                            "A5:4 F5:2 C5:2 F5:4 A5:4", "G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2",
                            "F5:4 A5:4 D6:6 C6:2", "C6:4 B5:2 A5:2 E5:8",
                            "G#5:2 A5:2 B5:2 C6:2 D6:2 C6:2 B5:2 G#5:2", "B5:8 G#5:4 E5:4",
                        ],
                        brass2: [
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "D4:2 F4:2 A4:2 D5:2 C5:2 A4:2 F4:2 A4:2", "E4:2 A4:2 C5:2 E5:2 D5:2 C5:2 B4:2 C5:2",
                            "A4:4 F4:2 C4:2 F4:4 A4:4", "G4:2 B4:2 D5:4 C5:2 B4:2 A4:2 G4:2",
                            "F4:4 A4:4 D5:6 C5:2", "C5:4 B4:2 A4:2 E4:8",
                            "G#4:2 A4:2 B4:2 C5:2 D5:2 C5:2 B4:2 G#4:2", "B4:8 G#4:4 E4:4",
                        ],
                        drums2: [
                            "B+C:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B+C:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        sub: [
                            "A2:16", "A2:16", "F2:16", "G2:16",
                            "A2:16", "A2:16", "F2:16", "E2:16",
                            "D2:16", "A2:16", "F2:16", "G2:16",
                            "D2:16", "A2:16", "E2:16", "E2:16",
                        ],
                    },
                },
                // Breakdown: just the fiddle, a plucked bass and light drums, then a fill back in.
                breakdown: {
                    volume: 1.35,
                    mute: ["brass", "ostinato", "cello"],
                    channels: {
                        lead: [
                            "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8",
                            "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
                            "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8",
                            "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
                            "D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:2 A5:2", "E5:2 A5:2 C6:2 E6:2 D6:2 C6:2 B5:2 C6:2",
                            "A5:4 F5:2 C5:2 F5:4 A5:4", "G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2",
                            "F5:4 A5:4 D6:6 C6:2", "C6:4 B5:2 A5:2 E5:8",
                            "G#5:2 A5:2 B5:2 C6:2 D6:2 C6:2 B5:2 G#5:2", "B5:8 G#5:4 E5:4",
                        ],
                        drums: [
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 s:2 s:1 s:1 F:2 s:1 s:1 s:2 s:1 s:1",
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 s:2 s:1 s:1 F:2 s:1 s:1 s:2 s:1 s:1",
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 s:2 s:1 s:1 F:2 s:1 s:1 s:2 s:1 s:1",
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 s:2 s:1 s:1 F:2 s:1 s:1 s:2 s:1 s:1",
                            "F:4 s:1 s:1 s:2 F:2 s:1 s:1 s:4", "F:2 s:1 s:1 F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 s:1 s:1",
                        ],
                        drums2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                        ],
                        pizz: [
                            "A3:2 r:2 E4:2 r:2 A3:2 r:2 E4:2 r:2", "A3:2 r:2 E4:2 r:2 A3:2 r:2 E4:2 r:2",
                            "F3:2 r:2 C4:2 r:2 F3:2 r:2 C4:2 r:2", "G3:2 r:2 D4:2 r:2 G3:2 r:2 D4:2 r:2",
                            "A3:2 r:2 E4:2 r:2 A3:2 r:2 E4:2 r:2", "A3:2 r:2 E4:2 r:2 A3:2 r:2 E4:2 r:2",
                            "F3:2 r:2 C4:2 r:2 F3:2 r:2 C4:2 r:2", "E3:2 r:2 B3:2 r:2 E3:2 r:2 B3:2 r:2",
                            "D3:2 r:2 A3:2 r:2 D3:2 r:2 A3:2 r:2", "A3:2 r:2 E4:2 r:2 A3:2 r:2 E4:2 r:2",
                            "F3:2 r:2 C4:2 r:2 F3:2 r:2 C4:2 r:2", "G3:2 r:2 D4:2 r:2 G3:2 r:2 D4:2 r:2",
                            "D3:2 r:2 A3:2 r:2 D3:2 r:2 A3:2 r:2", "A3:2 r:2 E4:2 r:2 A3:2 r:2 E4:2 r:2",
                            "E3:2 r:2 B3:2 r:2 E3:2 r:2 B3:2 r:2", "E3:2 r:2 B3:2 r:2 E3:2 r:2 B3:2 r:2",
                        ],
                    },
                },
            },
        },
        // Chapter 5: "Crossfire". The short loop over and over, with a variation every few times round.
        // One loop is 25 s; the whole cycle is about 3:22 before it repeats.
        "crossfire": {
            title: "Crossfire", group: "chapter", volume: 1.0,
            mood: "Urgent and stormy in G minor: rushing strings, racing fiddle, horns",
            bpm: 76, stepsPerBeat: 6, barSteps: 12,
            // The normal loop is the "crossfire-short" track (same notes).
            loop: "crossfire-short",
            // The order the passes play in, then it starts again. Each pass is one time round the loop.
            cycle: ["normal", "normal", "changeup", "normal", "normal", "grand", "normal", "breakdown"],
            // Each variation changes some parts of the normal loop: `mute` silences parts,
            // `channels` replaces or adds parts, `volume` sets that pass's level.
            variations: {
                // Change-up: a second fiddle joins in, with drum fills.
                changeup: {
                    volume: 1.0,
                    channels: {
                        lead2: [
                            "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 Eb5:1 F5:1 Eb5:2 D5:2 A4:2",
                            "G4:2 C5:2 D5:1 Eb5:1 D5:2 C5:2 G4:2", "F4:2 Bb4:2 Eb5:2 F#5:6",
                            "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:1 G5:1 A5:2", "F5:2 Eb5:1 D5:1 A4:2 D5:2 Eb5:1 F5:1 G5:2",
                            "Eb5:2 D5:1 C5:1 G4:2 C5:2 D5:2 Eb5:2", "D5:6 Bb4:2 Db5:2 Eb5:2",
                            "C5:6 Eb5:3 D5:1 C5:2", "D5:6 Bb4:6",
                            "Eb5:4 G5:2 C6:6", "Bb5:3 A5:1 G5:2 D5:6",
                            "Eb5:4 G5:2 Bb5:4 G5:2", "C6:4 A5:2 F5:4 A5:2",
                            "D6:6 C6:2 Bb5:2 A5:2", "F#5:6 A5:6",
                        ],
                        drums2: [
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                            "C:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                        ],
                    },
                },
                // Grand: the horns double the tune, big taiko and cymbals, deep bass.
                grand: {
                    volume: 0.72,
                    channels: {
                        lead: [
                            "D5:2 G5:2 A5:1 Bb5:1 A5:2 G5:2 D5:2", "C5:2 F5:2 G5:1 A5:1 G5:2 F5:2 C5:2",
                            "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 F#5:2 A5:6",
                            "Bb5:2 A5:1 G5:1 D5:2 G5:2 A5:1 Bb5:1 C6:2", "A5:2 G5:1 F5:1 C5:2 F5:2 G5:1 A5:1 Bb5:2",
                            "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:2 G5:2", "F#5:6 D5:2 E5:2 F#5:2",
                            "C5:6 Eb5:3 D5:1 C5:2", "D5:6 Bb4:6",
                            "Eb5:4 G5:2 C6:6", "Bb5:3 A5:1 G5:2 D5:6",
                            "Eb5:4 G5:2 Bb5:4 G5:2", "C6:4 A5:2 F5:4 A5:2",
                            "D6:6 C6:2 Bb5:2 A5:2", "F#5:6 A5:6",
                        ],
                        brass2: [
                            "D4:2 G4:2 A4:1 Bb4:1 A4:2 G4:2 D4:2", "C4:2 F4:2 G4:1 A4:1 G4:2 F4:2 C4:2",
                            "Bb3:2 Eb4:2 F4:1 G4:1 F4:2 Eb4:2 Bb3:2", "A3:2 D4:2 F#4:2 A4:6",
                            "Bb4:2 A4:1 G4:1 D4:2 G4:2 A4:1 Bb4:1 C5:2", "A4:2 G4:1 F4:1 C4:2 F4:2 G4:1 A4:1 Bb4:2",
                            "G4:2 F4:1 Eb4:1 Bb3:2 Eb4:2 F4:2 G4:2", "F#4:6 D4:2 E4:2 F#4:2",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                        ],
                        drums2: [
                            "B+C:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B+C:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 B:6",
                            "B:6 B:6", "B:6 B:6", "B:6 B:6", "B:6 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        sub: [
                            "G2:12", "F2:12", "Eb2:12", "D2:12",
                            "G2:12", "F2:12", "Eb2:12", "D2:12",
                            "C3:12", "G2:12", "C3:12", "G2:12",
                            "Eb2:12", "F2:12", "D2:12", "D2:12",
                        ],
                    },
                },
                // Breakdown: just the fiddle, a plucked bass and light drums, then a fill back in.
                breakdown: {
                    volume: 1.35,
                    mute: ["brass", "squeeze", "ostinato", "cello"],
                    channels: {
                        lead: [
                            "D5:2 G5:2 A5:1 Bb5:1 A5:2 G5:2 D5:2", "C5:2 F5:2 G5:1 A5:1 G5:2 F5:2 C5:2",
                            "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 F#5:2 A5:6",
                            "Bb5:2 A5:1 G5:1 D5:2 G5:2 A5:1 Bb5:1 C6:2", "A5:2 G5:1 F5:1 C5:2 F5:2 G5:1 A5:1 Bb5:2",
                            "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:2 G5:2", "F#5:6 D5:2 E5:2 F#5:2",
                            "C5:6 Eb5:3 D5:1 C5:2", "D5:6 Bb4:6",
                            "Eb5:4 G5:2 C6:6", "Bb5:3 A5:1 G5:2 D5:6",
                            "Eb5:4 G5:2 Bb5:4 G5:2", "C6:4 A5:2 F5:4 A5:2",
                            "D6:6 C6:2 Bb5:2 A5:2", "F#5:6 A5:6",
                        ],
                        drums: [
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 F:2",
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 F:2",
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 F:2",
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 J:1 J:1 F:2 s:2 J:1 J:1 J:2",
                            "F:2 J:1 J:1 J:2 s:2 J:1 J:1 F:2", "F:2 s:1 s:1 F:2 s:1 s:1 s:1 s:1 F:2",
                        ],
                        drums2: [
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:12",
                            "r:12", "r:12", "r:12", "r:6 S:1 S:1 S:1 S:1 S:2",
                        ],
                        pizz: [
                            "G3:2 r:2 D4:2 G3:2 r:2 D4:2", "F3:2 r:2 C4:2 F3:2 r:2 C4:2", "Eb3:2 r:2 Bb3:2 Eb3:2 r:2 Bb3:2", "D3:2 r:2 A3:2 D3:2 r:2 A3:2",
                            "G3:2 r:2 D4:2 G3:2 r:2 D4:2", "F3:2 r:2 C4:2 F3:2 r:2 C4:2", "Eb3:2 r:2 Bb3:2 Eb3:2 r:2 Bb3:2", "D3:2 r:2 A3:2 D3:2 r:2 A3:2",
                            "C4:2 r:2 G4:2 C4:2 r:2 G4:2", "G3:2 r:2 D4:2 G3:2 r:2 D4:2", "C4:2 r:2 G4:2 C4:2 r:2 G4:2", "G3:2 r:2 D4:2 G3:2 r:2 D4:2",
                            "Eb3:2 r:2 Bb3:2 Eb3:2 r:2 Bb3:2", "F3:2 r:2 C4:2 F3:2 r:2 C4:2", "D3:2 r:2 A3:2 D3:2 r:2 A3:2", "D3:2 r:2 A3:2 D3:2 r:2 A3:2",
                        ],
                    },
                },
            },
        },
        // Chapter 6: "Davy Jones". The short loop over and over, with a variation every few times round.
        // One loop is 48 s; the whole cycle is about 4:48 before it repeats.
        "davy-jones": {
            title: "Davy Jones", group: "chapter", volume: 0.95,
            mood: "Epic and dark-majestic in C minor: low horns, tolling bell, taiko",
            bpm: 80, stepsPerBeat: 4, barSteps: 16,
            // The normal loop is the "davy-jones-short" track (same notes).
            loop: "davy-jones-short",
            // The order the passes play in, then it starts again. Each pass is one time round the loop.
            cycle: ["normal", "changeup", "normal", "grand", "normal", "breakdown"],
            // Each variation changes some parts of the normal loop: `mute` silences parts,
            // `channels` replaces or adds parts, `volume` sets that pass's level.
            variations: {
                // Change-up: a second fiddle joins in, with drum fills.
                changeup: {
                    volume: 1.0,
                    channels: {
                        lead2: [
                            "C5:6 G4:2 C5:2 D5:2 Eb5:4", "Eb5:6 C5:2 Ab4:8", "G5:6 F5:2 Eb5:2 D5:2 C5:4", "Eb5:8 Ab5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 C5:4", "G5:6 Eb5:2 C5:8", "D5:4 G5:4 B5:8", "D6:6 C6:2 B5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 Eb5:4", "Eb5:6 D5:2 Bb4:8", "D5:6 Eb5:2 F5:2 G5:2 Bb5:4", "C6:8 G5:4 G5:4",
                            "Ab5:6 Ab5:2 F5:8", "Ab5:4 C6:4 Eb5:8", "G5:4 Ab5:2 Bb5:2 D5:8", "B5:8 G5:4 D5:4",
                        ],
                        drums2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                            "C:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                        ],
                    },
                },
                // Grand: the horns double the tune, big taiko and cymbals, deep bass.
                grand: {
                    volume: 0.88,
                    channels: {
                        lead: [
                            "C5:6 G4:2 C5:2 D5:2 Eb5:4", "Eb5:6 C5:2 Ab4:8", "G5:6 F5:2 Eb5:2 D5:2 C5:4", "Eb5:8 Ab5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 C5:4", "G5:6 Eb5:2 C5:8", "D5:4 G5:4 B5:8", "D6:6 C6:2 B5:8",
                            "C6:6 Bb5:2 Ab5:2 G5:2 Ab5:4", "G5:6 F5:2 Eb5:8", "F5:6 G5:2 Ab5:2 Bb5:2 D6:4", "Eb6:8 D6:4 C6:4",
                            "Db6:6 C6:2 Ab5:8", "C6:4 Eb6:4 Ab5:8", "B5:4 C6:2 D6:2 G5:8", "D6:8 B5:4 G5:4",
                        ],
                        brass2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "C5:6 Bb4:2 Ab4:2 G4:2 Ab4:4", "G4:6 F4:2 Eb4:8", "F4:6 G4:2 Ab4:2 Bb4:2 D5:4", "Eb5:8 D5:4 C5:4",
                            "Db5:6 C5:2 Ab4:8", "C5:4 Eb5:4 Ab4:8", "B4:4 C5:2 D5:2 G4:8", "D5:8 B4:4 G4:4",
                        ],
                        drums2: [
                            "B+C:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B+C:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 B:4 r:4",
                            "B:4 r:4 B:4 r:4", "B:4 r:4 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                    },
                },
                // Breakdown: just the fiddle, a plucked bass and light drums, then a fill back in.
                breakdown: {
                    volume: 1.5,
                    mute: ["brass", "strings", "bell", "ostinato", "cello", "sub"],
                    channels: {
                        lead: [
                            "C5:6 G4:2 C5:2 D5:2 Eb5:4", "Eb5:6 C5:2 Ab4:8", "G5:6 F5:2 Eb5:2 D5:2 C5:4", "Eb5:8 Ab5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 C5:4", "G5:6 Eb5:2 C5:8", "D5:4 G5:4 B5:8", "D6:6 C6:2 B5:8",
                            "C6:6 Bb5:2 Ab5:2 G5:2 Ab5:4", "G5:6 F5:2 Eb5:8", "F5:6 G5:2 Ab5:2 Bb5:2 D6:4", "Eb6:8 D6:4 C6:4",
                            "Db6:6 C6:2 Ab5:8", "C6:4 Eb6:4 Ab5:8", "B5:4 C6:2 D6:2 G5:8", "D6:8 B5:4 G5:4",
                        ],
                        drums: [
                            "F:4 r:4 F:2 F:2 r:4", "F:4 r:4 F:4 F:2 F:2",
                            "F:4 r:4 F:2 F:2 r:4", "F:4 F:2 F:2 F:2 F:1 F:1 s:1 s:1 s:1 s:1",
                            "F:4 r:4 F:2 F:2 r:4", "F:4 r:4 F:4 F:2 F:2",
                            "F:4 r:4 F:2 F:2 r:4", "F:4 F:2 F:2 F:2 F:1 F:1 s:1 s:1 s:1 s:1",
                            "F:4 r:4 F:2 F:2 r:4", "F:4 r:4 F:4 F:2 F:2",
                            "F:4 r:4 F:2 F:2 r:4", "F:4 F:2 F:2 F:2 F:1 F:1 s:1 s:1 s:1 s:1",
                            "F:4 r:4 F:2 F:2 r:4", "F:4 r:4 F:4 F:2 F:2",
                            "F:4 r:4 F:2 F:2 r:4", "F:4 F:2 F:2 F:2 F:1 F:1 s:1 s:1 s:1 s:1",
                        ],
                        drums2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:8 S:1 S:1 S:1 S:1 S:2 S:2",
                        ],
                        pizz: [
                            "C4:2 r:2 G4:2 r:2 C4:2 r:2 G4:2 r:2", "Ab3:2 r:2 Eb4:2 r:2 Ab3:2 r:2 Eb4:2 r:2",
                            "C4:2 r:2 G4:2 r:2 C4:2 r:2 G4:2 r:2", "Ab3:2 r:2 Eb4:2 r:2 Ab3:2 r:2 Eb4:2 r:2",
                            "F3:2 r:2 C4:2 r:2 F3:2 r:2 C4:2 r:2", "C4:2 r:2 G4:2 r:2 C4:2 r:2 G4:2 r:2",
                            "G3:2 r:2 D4:2 r:2 G3:2 r:2 D4:2 r:2", "G3:2 r:2 D4:2 r:2 G3:2 r:2 D4:2 r:2",
                            "Ab3:2 r:2 Eb4:2 r:2 Ab3:2 r:2 Eb4:2 r:2", "Eb3:2 r:2 Bb3:2 r:2 Eb3:2 r:2 Bb3:2 r:2",
                            "Bb3:2 r:2 F4:2 r:2 Bb3:2 r:2 F4:2 r:2", "C4:2 r:2 G4:2 r:2 C4:2 r:2 G4:2 r:2",
                            "Db4:2 r:2 Ab4:2 r:2 Db4:2 r:2 Ab4:2 r:2", "Ab3:2 r:2 Eb4:2 r:2 Ab3:2 r:2 Eb4:2 r:2",
                            "G3:2 r:2 D4:2 r:2 G3:2 r:2 D4:2 r:2", "G3:2 r:2 D4:2 r:2 G3:2 r:2 D4:2 r:2",
                        ],
                    },
                },
            },
        },
        // ---- The short chapter loops (16 bars, the versions from before the tracks
        // were extended). The "Long chapter music" switch in the sound menu
        // picks these instead of the long ones with variations. ----
        "sea-legs-short": {
            title: "Sea Legs (short loop)", group: "short", volume: 1.7,
            mood: "Light, curious and jaunty in A dorian: fiddle, pizzicato, accordion",
            bpm: 72, stepsPerBeat: 6, barSteps: 12,
            channels: {
                lead: [
                    "E5:2 r:1 A4:1 C5:2 E5:2 D5:1 C5:1 B4:2", "A4:2 D5:2 F#5:2 E5:4 r:2", "E5:2 r:1 A4:1 C5:2 E5:2 F#5:1 G5:1 A5:2", "F#5:2 D5:2 A4:2 D5:4 r:2",
                    "G5:2 E5:1 C5:1 G4:2 C5:2 E5:2 G5:2", "D5:2 B4:1 G4:1 D4:2 G4:2 B4:2 D5:2", "B4:3 C5:1 B4:2 G#4:2 A4:2 B4:2", "E5:6 r:6",
                    "A5:4 G5:1 F#5:1 E5:2 C5:2 E5:2", "D5:4 B4:2 G4:2 B4:2 D5:2", "F#5:4 E5:1 D5:1 A4:2 D5:2 F#5:2", "E5:6 r:6",
                    "G5:4 F#5:1 E5:1 C5:2 E5:2 G5:2", "A5:4 G5:1 F#5:1 D5:2 F#5:2 A5:2", "G#5:2 A5:2 B5:2 E5:3 F#5:1 G#5:2", "B5:6 r:6",
                ],
                brass: [
                    "r:12", "r:12", "r:12", "r:12",
                    "r:12", "r:12", "r:12", "r:6 B3:2 E4:2 G#4:2",
                    "r:12", "r:12", "r:12", "r:6 A3:2 C4:2 E4:2",
                    "r:12", "r:12", "r:12", "r:6 G#3:2 B3:2 E4:2",
                ],
                bell: [
                    "r:12", "r:8 D6:2 F#6:2", "r:12", "r:8 A5:2 D6:2",
                    "r:12", "r:8 B5:2 D6:2", "r:12", "r:12",
                    "r:12", "r:12", "r:12", "r:8 C6:2 E6:2",
                    "r:12", "r:12", "r:12", "r:8 G#5:2 B5:2",
                ],
                pizz: [
                    "A2:2 r:2 A3:2 E3:2 r:2 A3:2", "D2:2 r:2 D3:2 A2:2 r:2 D3:2", "A2:2 r:2 A3:2 E3:2 r:2 A3:2", "D2:2 r:2 D3:2 A2:2 r:2 D3:2",
                    "C3:2 r:2 C4:2 G3:2 r:2 C4:2", "G2:2 r:2 G3:2 D3:2 r:2 G3:2", "E2:2 r:2 E3:2 B2:2 r:2 E3:2", "E2:2 r:2 E3:2 B2:2 r:2 E3:2",
                    "A2:2 r:2 A3:2 E3:2 r:2 A3:2", "G2:2 r:2 G3:2 D3:2 r:2 G3:2", "D2:2 r:2 D3:2 A2:2 r:2 D3:2", "A2:2 r:2 A3:2 E3:2 r:2 A3:2",
                    "C3:2 r:2 C4:2 G3:2 r:2 C4:2", "D2:2 r:2 D3:2 A2:2 r:2 D3:2", "E2:2 r:2 E3:2 B2:2 r:2 E3:2", "E2:2 r:2 E3:2 B2:2 r:2 E3:2",
                ],
                squeeze: [
                    "r:2 C4+E4+A4:2 r:2 r:2 C4+E4+A4:2 r:2", "r:2 D4+F#4+A4:2 r:2 r:2 D4+F#4+A4:2 r:2", "r:2 C4+E4+A4:2 r:2 r:2 C4+E4+A4:2 r:2", "r:2 D4+F#4+A4:2 r:2 r:2 D4+F#4+A4:2 r:2",
                    "r:2 C4+E4+G4:2 r:2 r:2 C4+E4+G4:2 r:2", "r:2 B3+D4+G4:2 r:2 r:2 B3+D4+G4:2 r:2", "r:2 B3+E4+G#4:2 r:2 r:2 B3+E4+G#4:2 r:2", "r:2 B3+E4+G#4:2 r:2 r:2 B3+E4+G#4:2 r:2",
                    "r:2 C4+E4+A4:2 r:2 r:2 C4+E4+A4:2 r:2", "r:2 B3+D4+G4:2 r:2 r:2 B3+D4+G4:2 r:2", "r:2 D4+F#4+A4:2 r:2 r:2 D4+F#4+A4:2 r:2", "r:2 C4+E4+A4:2 r:2 r:2 C4+E4+A4:2 r:2",
                    "r:2 C4+E4+G4:2 r:2 r:2 C4+E4+G4:2 r:2", "r:2 D4+F#4+A4:2 r:2 r:2 D4+F#4+A4:2 r:2", "r:2 B3+E4+G#4:2 r:2 r:2 B3+E4+G#4:2 r:2", "r:2 B3+E4+G#4:2 r:2 r:2 B3+E4+G#4:2 r:2",
                ],
                drums: [
                    "F:2 J:2 J:2 s:2 J:2 J:2", "F:2 J:2 F:2 s:2 J:2 J:1 J:1",
                ],
            },
        },
        "pressure-short": {
            title: "Pressure (short loop)", group: "short", volume: 1.15,
            mood: "Clockwork heist in E minor: ticking plucks, whirring strings, sneaky fiddle",
            bpm: 124, stepsPerBeat: 4, barSteps: 16,
            channels: {
                lead: [
                    "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 B3:4",
                    "E5:2 D5:2 C5:2 B4:2 A4:2 G4:2 A4:2 C5:2", "B4:4 D#5:2 F#5:2 A5:3 G5:1 F#5:4",
                    "E5:2 F#5:2 G5:2 E5:2 B5:3 A#5:1 B5:2 G5:2", "F#5:2 G5:2 A5:2 F#5:2 E5:4 G5:2 B5:2",
                    "C6:2 B5:2 A5:2 G5:2 E5:2 F#5:2 G5:2 A5:2", "B5:2 A5:2 F#5:2 D#5:2 B4:4 r:4",
                    "r:8 G5:1 F#5:1 G5:1 F#5:1 G5:2 E5:2", "r:8 A5:1 G#5:1 A5:1 G#5:1 A5:2 F#5:2",
                    "r:8 B5:1 A#5:1 B5:1 A#5:1 B5:2 G5:2", "E5:2 G5:2 B5:2 E6:2 D6:2 B5:2 G5:2 B5:2",
                    "r:8 G5:1 F#5:1 G5:1 F#5:1 G5:2 C6:2", "r:8 A5:1 G#5:1 A5:1 G#5:1 A5:2 D6:2",
                    "D#6:2 B5:2 F#5:2 B5:2 D#6:2 F#6:2 D#6:2 B5:2", "F#6:4 D#6:4 B5:4 r:4",
                ],
                brass: [
                    "B3+E4+G4:2 r:10 B3+E4+G4:2 r:2",
                    "B3+E4+G4:2 r:10 B3+E4+G4:2 r:2",
                    "C4+E4+G4:2 r:10 C4+E4+G4:2 r:2",
                    "B3+D#4+F#4:2 r:10 B3+D#4+F#4:2 r:2",
                    "B3+E4+G4:2 r:10 B3+E4+G4:2 r:2",
                    "B3+E4+G4:2 r:10 B3+E4+G4:2 r:2",
                    "C4+E4+A4:2 r:10 C4+E4+A4:2 r:2",
                    "B3+D#4+F#4:2 r:10 B3+D#4+F#4:2 r:2",
                    "E4:4 G4:2 C5:4 B4:2 C5:2 E5:2",
                    "F#4:4 E4:2 D4:4 A3:2 D4:2 F#4:2",
                    "G4:4 F#4:2 E4:2 B3:2 E4:2 G4:4",
                    "B4:4 A4:2 G4:2 F#4:2 E4:2 B3:4",
                    "E4:4 G4:2 C5:4 B4:2 A4:2 G4:2",
                    "A4:4 F#4:2 D4:4 E4:2 F#4:2 A4:2",
                    "D#4:2 F#4:2 B4:4 A4:2 F#4:2 D#4:4",
                    "B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 B3+D#4+F#4:2 B3+D#4+F#4:4",
                ],
                pizz: [
                    "E3:2 B3:2 E4:2 B3:2 E3:2 B3:2 E4:2 B3:2", "E3:2 B3:2 E4:2 B3:2 E3:2 B3:2 E4:2 B3:2",
                    "C4:2 G4:2 C5:2 G4:2 C4:2 G4:2 C5:2 G4:2", "B3:2 F#4:2 B4:2 F#4:2 B3:2 F#4:2 B4:2 F#4:2",
                    "E3:2 B3:2 E4:2 B3:2 E3:2 B3:2 E4:2 B3:2", "E3:2 B3:2 E4:2 B3:2 E3:2 B3:2 E4:2 B3:2",
                    "A3:2 E4:2 A4:2 E4:2 A3:2 E4:2 A4:2 E4:2", "B3:2 F#4:2 B4:2 F#4:2 B3:2 F#4:2 B4:2 F#4:2",
                    "C4:2 G4:2 C5:2 G4:2 C4:2 G4:2 C5:2 G4:2", "D3:2 A3:2 D4:2 A3:2 D3:2 A3:2 D4:2 A3:2",
                    "E3:2 B3:2 E4:2 B3:2 E3:2 B3:2 E4:2 B3:2", "E3:2 B3:2 E4:2 B3:2 E3:2 B3:2 E4:2 B3:2",
                    "C4:2 G4:2 C5:2 G4:2 C4:2 G4:2 C5:2 G4:2", "D3:2 A3:2 D4:2 A3:2 D3:2 A3:2 D4:2 A3:2",
                    "B3:2 F#4:2 B4:2 F#4:2 B3:2 F#4:2 B4:2 F#4:2", "B3:2 F#4:2 B4:2 F#4:2 B3:2 F#4:2 B4:2 F#4:2",
                ],
                ostinato: [
                    "E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                ],
                cello: [
                    "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2", "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2", "C3:2 r:2 C3:2 r:2 C3:2 r:2 G3:2 C3:2", "B2:2 r:2 B2:2 r:2 B2:2 r:2 F#3:2 B2:2",
                    "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2", "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2", "A2:2 r:2 A2:2 r:2 A2:2 r:2 E3:2 A2:2", "B2:2 r:2 B2:2 r:2 B2:2 r:2 F#3:2 B2:2",
                    "C3:2 r:2 C3:2 r:2 C3:2 r:2 G3:2 C3:2", "D2:2 r:2 D2:2 r:2 D2:2 r:2 A2:2 D2:2", "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2", "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2",
                    "C3:2 r:2 C3:2 r:2 C3:2 r:2 G3:2 C3:2", "D2:2 r:2 D2:2 r:2 D2:2 r:2 A2:2 D2:2", "B2:2 r:2 B2:2 r:2 B2:2 r:2 F#3:2 B2:2", "B2:2 r:2 B2:2 r:2 B2:2 r:2 F#3:2 B2:2",
                ],
                drums: [
                    "K+C:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 K:2", "K:2 h:1 h:1 A:2 K:2 F:2 h:1 h:1 A:2 h:1 h:1",
                    "K:2 h:1 h:1 A:2 h:1 h:1 F:2 h:1 h:1 A:2 K:2", "K:2 h:1 h:1 A:2 K:2 F:2 S:1 S:1 S:1 S:1 S:1 S:1",
                ],
            },
        },
        "locks-keys-short": {
            title: "Locks and Keys (short loop)", group: "short", volume: 1.0,
            mood: "Mysterious and adventurous in D minor: music-box bells, horn call, gallop",
            bpm: 80, stepsPerBeat: 6, barSteps: 12,
            channels: {
                brass: [
                    "A3:6 D4:3 E4:1 F4:2", "F4:3 E4:1 D4:2 Bb3:2 D4:2 F4:2",
                    "A3:2 D4:2 E4:2 F4:3 G4:1 A4:2", "Bb4:6 A4:3 G4:1 F4:2",
                    "G4:4 Bb4:2 D5:6", "C5:3 Bb4:1 A4:2 F4:2 A4:2 D5:2",
                    "G4:2 A4:2 Bb4:2 D5:3 C5:1 Bb4:2", "A4:6 C#4:2 E4:2 A4:2",
                    "C4+F4+A4:2 r:2 C4+F4+A4:2 r:4 C4+F4+A4:2", "C4+E4+G4:2 r:2 C4+E4+G4:2 r:4 C4+E4+G4:2",
                    "Bb3+D4+F4:2 r:2 Bb3+D4+F4:2 r:4 Bb3+D4+F4:2", "C4+F4+A4:2 r:2 C4+F4+A4:2 r:4 C4+F4+A4:2",
                    "Bb3+D4+G4:2 r:2 Bb3+D4+G4:2 r:4 Bb3+D4+G4:2", "Bb3+D4+F4:2 r:2 Bb3+D4+F4:2 r:4 Bb3+D4+F4:2",
                    "C#4+E4+A4:2 r:2 C#4+E4+A4:2 r:4 C#4+E4+A4:2", "C#4+E4+A4:2 r:2 C#4+E4+A4:2 r:4 C#4+E4+A4:2",
                ],
                lead: [
                    "r:12", "r:12", "r:12", "r:12",
                    "r:12", "r:12", "r:12", "r:12",
                    "A5:4 C6:2 A5:3 G5:1 F5:2", "G5:2 E5:1 F5:1 G5:2 E5:2 C5:2 E5:2", "F5:4 D5:2 Bb4:2 D5:2 F5:2", "A5:6 G5:2 A5:2 C6:2",
                    "D6:4 C6:2 Bb5:2 A5:2 G5:2", "F5:3 G5:1 F5:2 D5:2 E5:2 F5:2", "C#5:2 E5:2 A5:2 G5:3 F5:1 E5:2", "C#5:2 D5:2 E5:2 F5:2 G5:2 A5:2",
                ],
                bell: [
                    "D5:2 F5:2 A5:2 F5:2 D5:2 F5:2", "Bb4:2 D5:2 F5:2 D5:2 Bb4:2 D5:2", "D5:2 F5:2 A5:2 F5:2 D5:2 F5:2", "Bb4:2 D5:2 F5:2 D5:2 Bb4:2 D5:2",
                    "Bb4:2 D5:2 G5:2 D5:2 Bb4:2 D5:2", "D5:2 F5:2 A5:2 F5:2 D5:2 F5:2", "Bb4:2 D5:2 G5:2 D5:2 Bb4:2 D5:2", "C#5:2 E5:2 A5:2 E5:2 C#5:2 E5:2",
                    "A5:2 F5:2 C5:2 A5:2 F5:2 C5:2", "G5:2 E5:2 C5:2 G5:2 E5:2 C5:2", "F5:2 D5:2 Bb4:2 F5:2 D5:2 Bb4:2", "A5:2 F5:2 C5:2 A5:2 F5:2 C5:2",
                    "G5:2 D5:2 Bb4:2 G5:2 D5:2 Bb4:2", "F5:2 D5:2 Bb4:2 F5:2 D5:2 Bb4:2", "A5:2 E5:2 C#5:2 A5:2 E5:2 C#5:2", "A5:2 E5:2 C#5:2 A5:2 E5:2 C#5:2",
                ],
                ostinato: [
                    "D3:2 D3:1 D3:1 D3:2 A3:2 D3:1 D3:1 D3:2", "Bb3:2 Bb3:1 Bb3:1 Bb3:2 F4:2 Bb3:1 Bb3:1 Bb3:2",
                    "D3:2 D3:1 D3:1 D3:2 A3:2 D3:1 D3:1 D3:2", "Bb3:2 Bb3:1 Bb3:1 Bb3:2 F4:2 Bb3:1 Bb3:1 Bb3:2",
                    "G3:2 G3:1 G3:1 G3:2 D4:2 G3:1 G3:1 G3:2", "D3:2 D3:1 D3:1 D3:2 A3:2 D3:1 D3:1 D3:2",
                    "G3:2 G3:1 G3:1 G3:2 D4:2 G3:1 G3:1 G3:2", "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2",
                    "F3:2 F3:1 F3:1 F3:2 C4:2 F3:1 F3:1 F3:2", "C4:2 C4:1 C4:1 C4:2 G4:2 C4:1 C4:1 C4:2",
                    "Bb3:2 Bb3:1 Bb3:1 Bb3:2 F4:2 Bb3:1 Bb3:1 Bb3:2", "F3:2 F3:1 F3:1 F3:2 C4:2 F3:1 F3:1 F3:2",
                    "G3:2 G3:1 G3:1 G3:2 D4:2 G3:1 G3:1 G3:2", "Bb3:2 Bb3:1 Bb3:1 Bb3:2 F4:2 Bb3:1 Bb3:1 Bb3:2",
                    "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2", "A3:2 A3:1 A3:1 A3:2 E4:2 A3:1 A3:1 A3:2",
                ],
                cello: [
                    "D2:4 D2:2 D2:4 A2:2", "Bb2:4 Bb2:2 Bb2:4 F3:2", "D2:4 D2:2 D2:4 A2:2", "Bb2:4 Bb2:2 Bb2:4 F3:2",
                    "G2:4 G2:2 G2:4 D3:2", "D2:4 D2:2 D2:4 A2:2", "G2:4 G2:2 G2:4 D3:2", "A2:4 A2:2 A2:4 E3:2",
                    "F2:4 F2:2 F2:4 C3:2", "C3:4 C3:2 C3:4 G3:2", "Bb2:4 Bb2:2 Bb2:4 F3:2", "F2:4 F2:2 F2:4 C3:2",
                    "G2:4 G2:2 G2:4 D3:2", "Bb2:4 Bb2:2 Bb2:4 F3:2", "A2:4 A2:2 A2:4 E3:2", "A2:4 A2:2 A2:4 E3:2",
                ],
                drums: [
                    "B+C:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "F:2 J:1 J:1 B:2 S:2 J:1 J:1 J:2", "B:2 J:1 J:1 J:2 F:2 J:1 J:1 J:2", "B:2 J:1 J:1 F:2 S:1 S:1 S:1 S:1 S:2",
                ],
            },
        },
        "gunpowder-short": {
            title: "Gunpowder (short loop)", group: "short", volume: 1.0,
            mood: "Bold and martial in A minor: marching horns, snare rolls, taiko",
            bpm: 112, stepsPerBeat: 4, barSteps: 16,
            channels: {
                brass: [
                    "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8",
                    "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
                    "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8",
                    "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
                    "D4+F4+A4:2 r:2 D4+F4+A4:2 r:6 D4+F4+A4:2 D4+F4+A4:2", "C4+E4+A4:2 r:2 C4+E4+A4:2 r:6 C4+E4+A4:2 C4+E4+A4:2",
                    "C4+F4+A4:2 r:2 C4+F4+A4:2 r:6 C4+F4+A4:2 C4+F4+A4:2", "B3+D4+G4:2 r:2 B3+D4+G4:2 r:6 B3+D4+G4:2 B3+D4+G4:2",
                    "D4+F4+A4:2 r:2 D4+F4+A4:2 r:6 D4+F4+A4:2 D4+F4+A4:2", "C4+E4+A4:2 r:2 C4+E4+A4:2 r:6 C4+E4+A4:2 C4+E4+A4:2",
                    "B3+E4+G#4:2 r:2 B3+E4+G#4:2 r:6 B3+E4+G#4:2 B3+E4+G#4:2", "B3+E4+G#4:2 r:2 B3+E4+G#4:2 r:6 B3+E4+G#4:2 B3+E4+G#4:2",
                ],
                lead: [
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:2 A5:2", "E5:2 A5:2 C6:2 E6:2 D6:2 C6:2 B5:2 C6:2",
                    "A5:4 F5:2 C5:2 F5:4 A5:4", "G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2",
                    "F5:4 A5:4 D6:6 C6:2", "C6:4 B5:2 A5:2 E5:8",
                    "G#5:2 A5:2 B5:2 C6:2 D6:2 C6:2 B5:2 G#5:2", "B5:8 G#5:4 E5:4",
                ],
                ostinato: [
                    "A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 E4:2 A3:1 A3:1", "A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 E4:2 A3:1 A3:1",
                    "F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 C4:2 F3:1 F3:1", "G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 D4:2 G3:1 G3:1",
                    "A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 E4:2 A3:1 A3:1", "A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 E4:2 A3:1 A3:1",
                    "F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 C4:2 F3:1 F3:1", "E3:2 E3:1 E3:1 E3:2 E3:1 E3:1 E3:2 E3:1 E3:1 B3:2 E3:1 E3:1",
                    "D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 A3:2 D3:1 D3:1", "A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 E4:2 A3:1 A3:1",
                    "F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 F3:2 F3:1 F3:1 C4:2 F3:1 F3:1", "G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 G3:2 G3:1 G3:1 D4:2 G3:1 G3:1",
                    "D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 D3:2 D3:1 D3:1 A3:2 D3:1 D3:1", "A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 A3:2 A3:1 A3:1 E4:2 A3:1 A3:1",
                    "E3:2 E3:1 E3:1 E3:2 E3:1 E3:1 E3:2 E3:1 E3:1 B3:2 E3:1 E3:1", "E3:2 E3:1 E3:1 E3:2 E3:1 E3:1 E3:2 E3:1 E3:1 B3:2 E3:1 E3:1",
                ],
                cello: [
                    "A2:2 r:2 A2:2 r:2 A2:2 r:2 E3:2 A2:2", "A2:2 r:2 A2:2 r:2 A2:2 r:2 E3:2 A2:2", "F2:2 r:2 F2:2 r:2 F2:2 r:2 C3:2 F2:2", "G2:2 r:2 G2:2 r:2 G2:2 r:2 D3:2 G2:2",
                    "A2:2 r:2 A2:2 r:2 A2:2 r:2 E3:2 A2:2", "A2:2 r:2 A2:2 r:2 A2:2 r:2 E3:2 A2:2", "F2:2 r:2 F2:2 r:2 F2:2 r:2 C3:2 F2:2", "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2",
                    "D2:2 r:2 D2:2 r:2 D2:2 r:2 A2:2 D2:2", "A2:2 r:2 A2:2 r:2 A2:2 r:2 E3:2 A2:2", "F2:2 r:2 F2:2 r:2 F2:2 r:2 C3:2 F2:2", "G2:2 r:2 G2:2 r:2 G2:2 r:2 D3:2 G2:2",
                    "D2:2 r:2 D2:2 r:2 D2:2 r:2 A2:2 D2:2", "A2:2 r:2 A2:2 r:2 A2:2 r:2 E3:2 A2:2", "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2", "E2:2 r:2 E2:2 r:2 E2:2 r:2 B2:2 E2:2",
                ],
                drums: [
                    "B+C:4 s:1 s:1 S:2 B:2 s:1 s:1 S:4", "B:2 s:1 s:1 S:2 s:1 s:1 B:2 s:1 s:1 S:2 S:1 S:1",
                    "B:4 s:1 s:1 S:2 B:2 s:1 s:1 S:4", "B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1 S:1 S:1 S:1 S:1",
                ],
            },
        },
        "crossfire-short": {
            title: "Crossfire (short loop)", group: "short", volume: 1.0,
            mood: "Urgent and stormy in G minor: rushing strings, racing fiddle, horns",
            bpm: 76, stepsPerBeat: 6, barSteps: 12,
            channels: {
                lead: [
                    "D5:2 G5:2 A5:1 Bb5:1 A5:2 G5:2 D5:2", "C5:2 F5:2 G5:1 A5:1 G5:2 F5:2 C5:2",
                    "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 F#5:2 A5:6",
                    "Bb5:2 A5:1 G5:1 D5:2 G5:2 A5:1 Bb5:1 C6:2", "A5:2 G5:1 F5:1 C5:2 F5:2 G5:1 A5:1 Bb5:2",
                    "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:2 G5:2", "F#5:6 D5:2 E5:2 F#5:2",
                    "G5:12", "D5:12",
                    "G5:12", "Bb5:12",
                    "G5:6 Bb5:6", "A5:6 C6:6",
                    "D6:12", "C6:6 A5:6",
                ],
                brass: [
                    "r:12", "r:12", "r:12", "r:12",
                    "r:12", "r:12", "r:12", "r:12",
                    "C4:6 Eb4:3 D4:1 C4:2", "D4:6 Bb3:6", "Eb4:4 G4:2 C5:6", "Bb4:3 A4:1 G4:2 D4:6",
                    "Eb4:4 G4:2 Bb4:4 G4:2", "C5:4 A4:2 F4:4 A4:2", "D5:6 C5:2 Bb4:2 A4:2", "F#4:6 A4:6",
                ],
                squeeze: [
                    "Bb3+D4+G4:2 r:4 Bb3+D4+G4:2 r:4", "C4+F4+A4:2 r:4 C4+F4+A4:2 r:4", "Bb3+Eb4+G4:2 r:4 Bb3+Eb4+G4:2 r:4", "D4+F#4+A4:2 r:4 D4+F#4+A4:2 r:4",
                    "Bb3+D4+G4:2 r:4 Bb3+D4+G4:2 r:4", "C4+F4+A4:2 r:4 C4+F4+A4:2 r:4", "Bb3+Eb4+G4:2 r:4 Bb3+Eb4+G4:2 r:4", "D4+F#4+A4:2 r:4 D4+F#4+A4:2 r:4",
                    "C4+Eb4+G4:2 r:4 C4+Eb4+G4:2 r:4", "Bb3+D4+G4:2 r:4 Bb3+D4+G4:2 r:4", "C4+Eb4+G4:2 r:4 C4+Eb4+G4:2 r:4", "Bb3+D4+G4:2 r:4 Bb3+D4+G4:2 r:4",
                    "Bb3+Eb4+G4:2 r:4 Bb3+Eb4+G4:2 r:4", "C4+F4+A4:2 r:4 C4+F4+A4:2 r:4", "D4+F#4+A4:2 r:4 D4+F#4+A4:2 r:4", "D4+F#4+A4:2 r:4 D4+F#4+A4:2 r:4",
                ],
                ostinato: [
                    "G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1",
                    "F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1",
                    "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1",
                    "D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1",
                    "G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1",
                    "F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1",
                    "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1",
                    "D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1",
                    "C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1",
                    "G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1",
                    "C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1",
                    "G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1",
                    "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1",
                    "F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1",
                    "D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1",
                    "D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1",
                ],
                cello: [
                    "G2:6 G2:6", "F2:6 F2:6", "Eb2:6 Eb2:6", "D2:6 D2:6",
                    "G2:6 G2:6", "F2:6 F2:6", "Eb2:6 Eb2:6", "D2:6 D2:6",
                    "C3:6 C3:6", "G2:6 G2:6", "C3:6 C3:6", "G2:6 G2:6",
                    "Eb2:6 Eb2:6", "F2:6 F2:6", "D2:6 D2:6", "D2:6 D2:6",
                ],
                drums: [
                    "B+C:2 J:1 J:1 J:2 S:2 J:1 J:1 B:2", "B:2 J:1 J:1 B:2 S:2 J:1 J:1 J:2", "B:2 J:1 J:1 J:2 S:2 J:1 J:1 B:2", "B:2 S:1 S:1 B:2 S:1 S:1 S:1 S:1 T:2",
                ],
            },
        },
        "davy-jones-short": {
            title: "Davy Jones (short loop)", group: "short", volume: 0.95,
            mood: "Epic and dark-majestic in C minor: low horns, tolling bell, taiko",
            bpm: 80, stepsPerBeat: 4, barSteps: 16,
            channels: {
                brass: [
                    "C4:6 G3:2 C4:2 D4:2 Eb4:4", "Eb4:6 C4:2 Ab3:8",
                    "G4:6 F4:2 Eb4:2 D4:2 C4:4", "Eb4:8 Ab4:8",
                    "Ab4:6 G4:2 F4:2 Eb4:2 C4:4", "G4:6 Eb4:2 C4:8",
                    "D4:4 G4:4 B4:8", "D5:6 C5:2 B4:8",
                    "C4+Eb4+Ab4:6 C4+Eb4+Ab4:2 r:4 C4+Eb4+Ab4:4", "Bb3+Eb4+G4:6 Bb3+Eb4+G4:2 r:4 Bb3+Eb4+G4:4",
                    "Bb3+D4+F4:6 Bb3+D4+F4:2 r:4 Bb3+D4+F4:4", "C4+Eb4+G4:6 C4+Eb4+G4:2 r:4 C4+Eb4+G4:4",
                    "Db4+F4+Ab4:6 Db4+F4+Ab4:2 r:4 Db4+F4+Ab4:4", "C4+Eb4+Ab4:6 C4+Eb4+Ab4:2 r:4 C4+Eb4+Ab4:4",
                    "B3+D4+G4:6 B3+D4+G4:2 r:4 B3+D4+G4:4", "B3+D4+G4:6 B3+D4+G4:2 r:4 B3+D4+G4:4",
                ],
                lead: [
                    "r:16", "r:16", "r:16", "r:16",
                    "r:16", "r:16", "r:16", "r:16",
                    "C6:6 Bb5:2 Ab5:2 G5:2 Ab5:4", "G5:6 F5:2 Eb5:8", "F5:6 G5:2 Ab5:2 Bb5:2 D6:4", "Eb6:8 D6:4 C6:4",
                    "Db6:6 C6:2 Ab5:8", "C6:4 Eb6:4 Ab5:8", "B5:4 C6:2 D6:2 G5:8", "D6:8 B5:4 G5:4",
                ],
                strings: [
                    "C4+Eb4+G4:16", "C4+Eb4+Ab4:16", "C4+Eb4+G4:16", "C4+Eb4+Ab4:16",
                    "C4+F4+Ab4:16", "C4+Eb4+G4:16", "B3+D4+G4:16", "B3+D4+G4:16",
                    "C4+Eb4+Ab4:16", "Bb3+Eb4+G4:16", "Bb3+D4+F4:16", "C4+Eb4+G4:16",
                    "Db4+F4+Ab4:16", "C4+Eb4+Ab4:16", "B3+D4+G4:16", "B3+D4+G4:16",
                ],
                bell: [
                    "C5:16", "Ab4:16", "C5:16", "Ab4:16",
                    "F4:16", "C5:16", "G4:16", "G4:16",
                    "Ab4:16", "Eb4:16", "Bb4:16", "C5:16",
                    "Db5:16", "Ab4:16", "G4:16", "G4:16",
                ],
                ostinato: [
                    "C4:2 C4:2 C4:2 C4:2 C4:2 C4:2 G4:2 C4:2", "Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Eb4:2 Ab3:2",
                    "C4:2 C4:2 C4:2 C4:2 C4:2 C4:2 G4:2 C4:2", "Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Eb4:2 Ab3:2",
                    "F3:2 F3:2 F3:2 F3:2 F3:2 F3:2 C4:2 F3:2", "C4:2 C4:2 C4:2 C4:2 C4:2 C4:2 G4:2 C4:2",
                    "G3:2 G3:2 G3:2 G3:2 G3:2 G3:2 D4:2 G3:2", "G3:2 G3:2 G3:2 G3:2 G3:2 G3:2 D4:2 G3:2",
                    "Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Eb4:2 Ab3:2", "Eb3:2 Eb3:2 Eb3:2 Eb3:2 Eb3:2 Eb3:2 Bb3:2 Eb3:2",
                    "Bb3:2 Bb3:2 Bb3:2 Bb3:2 Bb3:2 Bb3:2 F4:2 Bb3:2", "C4:2 C4:2 C4:2 C4:2 C4:2 C4:2 G4:2 C4:2",
                    "Db4:2 Db4:2 Db4:2 Db4:2 Db4:2 Db4:2 Ab4:2 Db4:2", "Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Ab3:2 Eb4:2 Ab3:2",
                    "G3:2 G3:2 G3:2 G3:2 G3:2 G3:2 D4:2 G3:2", "G3:2 G3:2 G3:2 G3:2 G3:2 G3:2 D4:2 G3:2",
                ],
                cello: [
                    "C3:8 C3:8", "Ab2:8 Ab2:8", "C3:8 C3:8", "Ab2:8 Ab2:8",
                    "F2:8 F2:8", "C3:8 C3:8", "G2:8 G2:8", "G2:8 G2:8",
                    "Ab2:8 Ab2:8", "Eb2:8 Eb2:8", "Bb2:8 Bb2:8", "C3:8 C3:8",
                    "Db3:8 Db3:8", "Ab2:8 Ab2:8", "G2:8 G2:8", "G2:8 G2:8",
                ],
                sub: [
                    "C3:16", "Ab2:16", "C3:16", "Ab2:16",
                    "F2:16", "C3:16", "G2:16", "G2:16",
                    "Ab2:16", "Eb2:16", "Bb2:16", "C3:16",
                    "Db3:16", "Ab2:16", "G2:16", "G2:16",
                ],
                drums: [
                    "B+C:4 r:4 B:2 B:2 r:4", "B:4 r:4 B:4 T:2 T:2", "B:4 r:4 B:2 B:2 r:4", "B:4 T:2 T:2 B:2 T:1 T:1 S:1 S:1 S:1 S:1",
                ],
            },
        },
        // Boss: "Eye of the Storm". E minor, 4/4, fast. Driving sixteenth strings and taiko; a horn theme, then a fiddle charge over horn and accordion stabs.
        "boss-storm": {
            title: "Eye of the Storm", group: "boss", volume: 0.95,
            mood: "Fast and driving in E minor: pounding taiko, horn theme, fiddle charge",
            bpm: 132, stepsPerBeat: 4, barSteps: 16,
            channels: {
                brass: [
                    "E4:4 B4:4 A4:2 G4:2 F#4:2 G4:2", "E4:6 G4:2 C5:8",
                    "B4:4 E5:4 D5:2 B4:2 A4:2 B4:2", "A4:6 F#4:2 D4:8",
                    "E5:4 B4:4 D5:2 C5:2 B4:2 A4:2", "G4:6 A4:2 C5:8",
                    "C5:4 B4:2 A4:2 E5:4 C5:4", "D#5:8 F#5:4 B4:4",
                    "C4+E4+G4:2 r:2 C4+E4+G4:2 r:4 C4+E4+G4:2 r:2 C4+E4+G4:2", "D4+F#4+A4:2 r:2 D4+F#4+A4:2 r:4 D4+F#4+A4:2 r:2 D4+F#4+A4:2",
                    "B3+E4+G4:2 r:2 B3+E4+G4:2 r:4 B3+E4+G4:2 r:2 B3+E4+G4:2", "B3+E4+G4:2 r:2 B3+E4+G4:2 r:4 B3+E4+G4:2 r:2 B3+E4+G4:2",
                    "C4+E4+G4:2 r:2 C4+E4+G4:2 r:4 C4+E4+G4:2 r:2 C4+E4+G4:2", "D4+F#4+A4:2 r:2 D4+F#4+A4:2 r:4 D4+F#4+A4:2 r:2 D4+F#4+A4:2",
                    "B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:4 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2", "B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:4 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2",
                ],
                lead: [
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "G5:2 E5:2 C5:2 E5:2 G5:2 C6:2 B5:2 G5:2", "A5:2 F#5:2 D5:2 F#5:2 A5:2 D6:2 C6:2 A5:2",
                    "B5:4 G5:2 E5:2 B5:4 E6:4", "D6:2 B5:2 G5:2 E5:2 D5:2 E5:2 G5:2 B5:2",
                    "C6:4 B5:2 G5:2 E5:4 G5:4", "D6:4 C6:2 A5:2 F#5:4 A5:4",
                    "B5:2 A5:2 G5:2 F#5:2 D#5:2 F#5:2 A5:2 B5:2", "D#6:8 B5:8",
                ],
                squeeze: [
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "r:2 C4+E4+G4:2 r:2 C4+E4+G4:2 r:2 C4+E4+G4:2 r:2 C4+E4+G4:2", "r:2 D4+F#4+A4:2 r:2 D4+F#4+A4:2 r:2 D4+F#4+A4:2 r:2 D4+F#4+A4:2",
                    "r:2 B3+E4+G4:2 r:2 B3+E4+G4:2 r:2 B3+E4+G4:2 r:2 B3+E4+G4:2", "r:2 B3+E4+G4:2 r:2 B3+E4+G4:2 r:2 B3+E4+G4:2 r:2 B3+E4+G4:2",
                    "r:2 C4+E4+G4:2 r:2 C4+E4+G4:2 r:2 C4+E4+G4:2 r:2 C4+E4+G4:2", "r:2 D4+F#4+A4:2 r:2 D4+F#4+A4:2 r:2 D4+F#4+A4:2 r:2 D4+F#4+A4:2",
                    "r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2", "r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:2",
                ],
                ostinato: [
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                ],
                cello: [
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2",
                    "A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 E3:2 A2:2", "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2",
                    "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2", "D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2",
                    "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2", "D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2",
                    "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2", "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2",
                ],
                sub: [
                    "r:16", "r:16", "r:16", "r:16",
                    "r:16", "r:16", "r:16", "r:16",
                    "C3:16", "D2:16", "E2:16", "E2:16",
                    "C3:16", "D2:16", "B2:16", "B2:16",
                ],
                drums: [
                    "B+C:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2", "B:2 B:1 B:1 S:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                ],
            },
        },
        // Boss: "Eye of the Storm II". E minor, 4/4, fast. The Eye of the Storm horn theme made bigger: a stormy taiko build,
        // a low horn ostinato and choir under the theme, then a new soaring horn tune and a climax of snare rolls.
        "boss-storm-v2": {
            title: "Eye of the Storm II", group: "boss", volume: 0.85,
            mood: "Huge boss version of Eye of the Storm: taiko build, choir, low horn ostinato, soaring horns",
            bpm: 140, stepsPerBeat: 4, barSteps: 16,
            channels: {
                brass: [
                    "E3:2 E3:2 B3:2 E3:2 E3:2 E3:2 B3:2 E3:2", "C4:2 C4:2 G4:2 C4:2 C4:2 C4:2 G4:2 C4:2",
                    "E3:2 E3:2 B3:2 E3:2 E3:2 E3:2 B3:2 E3:2", "B3:2 B3:2 F#4:2 B3:2 B3:2 B3:2 F#4:2 B3:2",
                    "E4:4 B4:4 A4:2 G4:2 F#4:2 G4:2", "E4:6 G4:2 C5:8",
                    "B4:4 E5:4 D5:2 B4:2 A4:2 B4:2", "A4:6 F#4:2 D4:8",
                    "E5:4 B4:4 D5:2 C5:2 B4:2 A4:2", "G4:6 A4:2 C5:8",
                    "C5:4 B4:2 A4:2 E5:4 C5:4", "D#5:8 F#5:4 B4:4",
                    "G4:4 C5:4 E5:6 D5:2", "F#5:4 E5:2 D5:2 A4:8",
                    "B4:4 E5:4 G5:6 F#5:2", "E5:12 D5:2 B4:2",
                    "C5:4 E5:4 G5:6 A5:2", "F#5:4 D5:4 A5:8",
                    "B5:6 A5:2 F#5:4 D#5:4", "F#5:8 B4:8",
                    "C4+E4+G4:2 r:2 C4+E4+G4:2 r:2 C4+E4+G4:4 C4+E4+G4:4", "C4+E4+A4:2 r:2 C4+E4+A4:2 r:2 C4+E4+A4:4 C4+E4+A4:4",
                    "B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:4 B3+D#4+F#4:4", "B3+D#4+F#4:2 r:2 B3+D#4+F#4:2 r:2 B3+D#4+F#4:4 B3+D#4+F#4:4",
                ],
                brass2: [
                    "r:16", "r:16",
                    "r:16", "r:16",
                    "E3:2 r:2 E3:2 E3:2 r:2 E3:2 B3:2 E3:2", "C4:2 r:2 C4:2 C4:2 r:2 C4:2 G4:2 C4:2",
                    "E3:2 r:2 E3:2 E3:2 r:2 E3:2 B3:2 E3:2", "D3:2 r:2 D3:2 D3:2 r:2 D3:2 A3:2 D3:2",
                    "E3:2 r:2 E3:2 E3:2 r:2 E3:2 B3:2 E3:2", "C4:2 r:2 C4:2 C4:2 r:2 C4:2 G4:2 C4:2",
                    "A3:2 r:2 A3:2 A3:2 r:2 A3:2 E4:2 A3:2", "B3:2 r:2 B3:2 B3:2 r:2 B3:2 F#4:2 B3:2",
                    "C4:2 r:2 C4:2 C4:2 r:2 C4:2 G4:2 C4:2", "D3:2 r:2 D3:2 D3:2 r:2 D3:2 A3:2 D3:2",
                    "E3:2 r:2 E3:2 E3:2 r:2 E3:2 B3:2 E3:2", "E3:2 r:2 E3:2 E3:2 r:2 E3:2 B3:2 E3:2",
                    "C4:2 r:2 C4:2 C4:2 r:2 C4:2 G4:2 C4:2", "D3:2 r:2 D3:2 D3:2 r:2 D3:2 A3:2 D3:2",
                    "B3:2 r:2 B3:2 B3:2 r:2 B3:2 F#4:2 B3:2", "B3:2 r:2 B3:2 B3:2 r:2 B3:2 F#4:2 B3:2",
                    "r:16", "r:16",
                    "r:16", "r:16",
                ],
                lead: [
                    "r:16", "r:16",
                    "r:16", "B4:2 C5:2 D#5:2 E5:2 F#5:2 G5:2 A5:2 B5:2",
                    "E5:4 B5:4 A5:2 G5:2 F#5:2 G5:2", "E5:6 G5:2 C6:8",
                    "B5:4 E6:4 D6:2 B5:2 A5:2 B5:2", "A5:6 F#5:2 D5:8",
                    "E6:4 B5:4 D6:2 C6:2 B5:2 A5:2", "G5:6 A5:2 C6:8",
                    "C6:4 B5:2 A5:2 E6:4 C6:4", "D#6:8 F#6:4 B5:4",
                    "G4:4 C5:4 E5:6 D5:2", "F#5:4 E5:2 D5:2 A4:8",
                    "B4:4 E5:4 G5:6 F#5:2", "E5:12 D5:2 B4:2",
                    "C5:4 E5:4 G5:6 A5:2", "F#5:4 D5:4 A5:8",
                    "B5:6 A5:2 F#5:4 D#5:4", "F#5:8 B4:8",
                    "E5:2 G5:2 C6:2 E6:2 C6:2 G5:2 E5:2 G5:2", "A5:2 C6:2 E6:2 C6:2 A5:2 E5:2 C5:2 E5:2",
                    "D#5:2 F#5:2 B5:2 D#6:2 F#6:4 D#6:4", "B5:2 A5:2 G5:2 F#5:2 E5:2 D#5:2 C5:2 B4:2",
                ],
                choir: [
                    "B3+E4+G4:16", "C4+E4+G4:16", "B3+E4+G4:16", "B3+D#4+F#4:16",
                    "B3+E4+G4:16", "C4+E4+G4:16", "B3+E4+G4:16", "D4+F#4+A4:16",
                    "B3+E4+G4:16", "C4+E4+G4:16", "C4+E4+A4:16", "B3+D#4+F#4:16",
                    "C4+E4+G4:16", "D4+F#4+A4:16", "B3+E4+G4:16", "B3+E4+G4:16",
                    "C4+E4+G4:16", "D4+F#4+A4:16", "B3+D#4+F#4:16", "B3+D#4+F#4:16",
                    "C4+E4+G4:8 C4+E4+G4:8", "C4+E4+A4:8 C4+E4+A4:8", "B3+D#4+F#4:8 B3+D#4+F#4:8", "B3+D#4+F#4:8 B3+D#4+F#4:8",
                ],
                ostinato: [
                    "r:16",
                    "r:16",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                    "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                    "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                ],
                cello: [
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2",
                    "A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 E3:2 A2:2", "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2",
                    "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2", "D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2",
                    "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2", "E2:2 E2:2 E2:2 E2:2 E2:2 E2:2 B2:2 E2:2",
                    "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2", "D2:2 D2:2 D2:2 D2:2 D2:2 D2:2 A2:2 D2:2",
                    "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2", "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2",
                    "C3:2 C3:2 C3:2 C3:2 C3:2 C3:2 G3:2 C3:2", "A2:2 A2:2 A2:2 A2:2 A2:2 A2:2 E3:2 A2:2",
                    "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2", "B2:2 B2:2 B2:2 B2:2 B2:2 B2:2 F#3:2 B2:2",
                ],
                sub: [
                    "E2:16", "C3:16", "E2:16", "B2:16",
                    "E2:16", "C3:16", "E2:16", "D2:16",
                    "E2:16", "C3:16", "A2:16", "B2:16",
                    "C3:16", "D2:16", "E2:16", "E2:16",
                    "C3:16", "D2:16", "B2:16", "B2:16",
                    "C3:16", "A2:16", "B2:16", "B2:16",
                ],
                drums: [
                    "B:4 r:4 B:4 r:4", "B:4 r:4 B:2 B:2 B:2 B:2",
                    "B:2 B:2 B:2 B:2 B:2 B:2 B:2 B:2", "B:1 B:1 B:1 B:1 B:1 B:1 B:1 B:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                    "B+C:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B+C:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:2 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2", "B:2 h:1 h:1 B:2 h:1 h:1 S:2 h:1 h:1 B:1 B:1 S:2",
                    "B+C:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1", "B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1 B:2 S:1 S:1",
                    "B:2 B:2 S:1 S:1 S:1 S:1 B:2 B:2 S:1 S:1 S:1 S:1", "B:1 B:1 B:1 B:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1 T:2 T:2",
                ],
                drums2: [
                    "r:16", "r:16", "r:16", "r:16",
                    "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4",
                    "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4",
                    "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4",
                    "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4", "T:4 r:4 T:4 A:4",
                    "C:16", "r:16", "C:16", "r:16",
                ],
            },
        },
        // Boss: "Kraken Rising". D minor with a dark Eb (phrygian), 6/8. A heavy horn riff over huge taiko and anvil, then the fiddle shrieks above.
        "boss-kraken": {
            title: "Kraken Rising", group: "boss", volume: 0.9,
            mood: "Heavy and epic in D phrygian: horn riff, huge taiko and anvil",
            bpm: 74, stepsPerBeat: 6, barSteps: 12,
            channels: {
                brass: [
                    "D4:3 D4:1 D4:2 F4:2 E4:2 D4:2", "Eb4:6 D4:2 C4:2 Bb3:2",
                    "D4:3 D4:1 D4:2 A4:2 G4:2 F4:2", "G4:6 F4:2 Eb4:2 D4:2",
                    "F4:3 F4:1 F4:2 Bb4:2 A4:2 G4:2", "G4:3 G4:1 G4:2 C5:2 Bb4:2 A4:2",
                    "A4:6 F4:2 D4:2 F4:2", "C#4:2 D4:2 E4:2 A4:6",
                    "D4+F4+A4:2 r:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2", "Bb3+Eb4+G4:2 r:2 Bb3+Eb4+G4:2 r:2 Bb3+Eb4+G4:2 Bb3+Eb4+G4:2",
                    "D4+F4+A4:2 r:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2", "Bb3+Eb4+G4:2 r:2 Bb3+Eb4+G4:2 r:2 Bb3+Eb4+G4:2 Bb3+Eb4+G4:2",
                    "Bb3+D4+F4:2 r:2 Bb3+D4+F4:2 r:2 Bb3+D4+F4:2 Bb3+D4+F4:2", "C4+E4+G4:2 r:2 C4+E4+G4:2 r:2 C4+E4+G4:2 C4+E4+G4:2",
                    "D4+F4+A4:2 r:2 D4+F4+A4:2 r:2 D4+F4+A4:2 D4+F4+A4:2", "C#4+E4+A4:2 r:2 C#4+E4+A4:2 r:2 C#4+E4+A4:2 C#4+E4+A4:2",
                ],
                lead: [
                    "r:12", "r:12", "r:12", "r:12",
                    "r:12", "r:12", "r:12", "r:12",
                    "D6:6 C6:1 Bb5:1 A5:2 F5:2", "G5:6 F5:1 Eb5:1 D5:2 Eb5:2", "F5:2 A5:2 D6:2 E6:3 D6:1 C6:2", "Bb5:6 G5:6",
                    "F5:2 Bb5:2 D6:2 C6:3 Bb5:1 A5:2", "G5:2 C6:2 E6:2 D6:3 C6:1 Bb5:2", "A5:4 D6:2 C6:2 Bb5:2 A5:2", "C#6:6 A5:6",
                ],
                ostinato: [
                    "D3:2 D3:1 D3:1 D3:2 D3:2 D3:1 D3:1 A3:2", "Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:2 Eb3:1 Eb3:1 Bb3:2",
                    "D3:2 D3:1 D3:1 D3:2 D3:2 D3:1 D3:1 A3:2", "Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:2 Eb3:1 Eb3:1 Bb3:2",
                    "Bb3:2 Bb3:1 Bb3:1 Bb3:2 Bb3:2 Bb3:1 Bb3:1 F4:2", "C4:2 C4:1 C4:1 C4:2 C4:2 C4:1 C4:1 G4:2",
                    "D3:2 D3:1 D3:1 D3:2 D3:2 D3:1 D3:1 A3:2", "A3:2 A3:1 A3:1 A3:2 A3:2 A3:1 A3:1 E4:2",
                    "D3:2 D3:1 D3:1 D3:2 D3:2 D3:1 D3:1 A3:2", "Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:2 Eb3:1 Eb3:1 Bb3:2",
                    "D3:2 D3:1 D3:1 D3:2 D3:2 D3:1 D3:1 A3:2", "Eb3:2 Eb3:1 Eb3:1 Eb3:2 Eb3:2 Eb3:1 Eb3:1 Bb3:2",
                    "Bb3:2 Bb3:1 Bb3:1 Bb3:2 Bb3:2 Bb3:1 Bb3:1 F4:2", "C4:2 C4:1 C4:1 C4:2 C4:2 C4:1 C4:1 G4:2",
                    "D3:2 D3:1 D3:1 D3:2 D3:2 D3:1 D3:1 A3:2", "A3:2 A3:1 A3:1 A3:2 A3:2 A3:1 A3:1 E4:2",
                ],
                cello: [
                    "D2:6 D2:6", "Eb2:6 Eb2:6", "D2:6 D2:6", "Eb2:6 Eb2:6",
                    "Bb2:6 Bb2:6", "C3:6 C3:6", "D2:6 D2:6", "A2:6 A2:6",
                    "D2:6 D2:6", "Eb2:6 Eb2:6", "D2:6 D2:6", "Eb2:6 Eb2:6",
                    "Bb2:6 Bb2:6", "C3:6 C3:6", "D2:6 D2:6", "A2:6 A2:6",
                ],
                sub: [
                    "D2:12", "Eb2:12", "D2:12", "Eb2:12",
                    "Bb2:12", "C3:12", "D2:12", "A2:12",
                    "D2:12", "Eb2:12", "D2:12", "Eb2:12",
                    "Bb2:12", "C3:12", "D2:12", "A2:12",
                ],
                drums: [
                    "B+C:2 B:1 B:1 F:2 S:2 B:2 F:2", "B:2 F:1 F:1 B:2 S:2 F:1 F:1 B:2", "B:2 B:1 B:1 F:2 S:2 B:2 A:2", "B:2 B:2 S:1 S:1 B:1 B:1 S:1 S:1 S:1 S:1",
                ],
            },
        },
        // Chapter 1 boss level: "Sea Legs" sped up (72 -> 86 bpm) with the full band, horns on the tune, driving taiko and rushing strings.
        // One loop is 22 s; every third time round a second fiddle joins in.
        "sea-legs-boss": {
            title: "Sea Legs (boss)", group: "chapter-boss", volume: 0.75,
            mood: "Faster, grander Sea Legs for the chapter's hardest level",
            bpm: 86, stepsPerBeat: 6, barSteps: 12,
            loop: "sea-legs-short",
            cycle: ["boss", "boss", "boss2"],
            variations: {
                boss: {
                    channels: {
                        lead: [
                            "E5:2 r:1 A4:1 C5:2 E5:2 D5:1 C5:1 B4:2", "A4:2 D5:2 F#5:2 E5:4 r:2",
                            "E5:2 r:1 A4:1 C5:2 E5:2 F#5:1 G5:1 A5:2", "F#5:2 D5:2 A4:2 D5:4 r:2",
                            "G5:2 E5:1 C5:1 G4:2 C5:2 E5:2 G5:2", "D5:2 B4:1 G4:1 D4:2 G4:2 B4:2 D5:2",
                            "B4:3 C5:1 B4:2 G#4:2 A4:2 B4:2", "E5:6 r:6",
                            "A5:4 G5:1 F#5:1 E5:2 C5:2 E5:2", "D5:4 B4:2 G4:2 B4:2 D5:2",
                            "F#5:4 E5:1 D5:1 A4:2 D5:2 F#5:2", "E5:6 r:6",
                            "G5:4 F#5:1 E5:1 C5:2 E5:2 G5:2", "A5:4 G5:1 F#5:1 D5:2 F#5:2 A5:2",
                            "G#5:2 A5:2 B5:2 E5:3 F#5:1 G#5:2", "B5:6 r:6",
                        ],
                        brass2: [
                            "E4:2 r:1 A3:1 C4:2 E4:2 D4:1 C4:1 B3:2", "A3:2 D4:2 F#4:2 E4:4 r:2",
                            "E4:2 r:1 A3:1 C4:2 E4:2 F#4:1 G4:1 A4:2", "F#4:2 D4:2 A3:2 D4:4 r:2",
                            "G4:2 E4:1 C4:1 G3:2 C4:2 E4:2 G4:2", "D4:2 B3:1 G3:1 D3:2 G3:2 B3:2 D4:2",
                            "B3:3 C4:1 B3:2 G#3:2 A3:2 B3:2", "E4:6 r:6",
                            "A4:4 G4:1 F#4:1 E4:2 C4:2 E4:2", "D4:4 B3:2 G3:2 B3:2 D4:2",
                            "F#4:4 E4:1 D4:1 A3:2 D4:2 F#4:2", "E4:6 r:6",
                            "G4:4 F#4:1 E4:1 C4:2 E4:2 G4:2", "A4:4 G4:1 F#4:1 D4:2 F#4:2 A4:2",
                            "G#4:2 A4:2 B4:2 E4:3 F#4:1 G#4:2", "B4:6 r:6",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1", "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1", "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1", "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1", "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1",
                        ],
                        sub: [
                            "A2:12", "D2:12", "A2:12", "D2:12",
                            "C3:12", "G2:12", "E2:12", "E2:12",
                            "A2:12", "G2:12", "D2:12", "A2:12",
                            "C3:12", "D2:12", "E2:12", "E2:12",
                        ],
                    },
                },
                boss2: {
                    channels: {
                        lead: [
                            "E5:2 r:1 A4:1 C5:2 E5:2 D5:1 C5:1 B4:2", "A4:2 D5:2 F#5:2 E5:4 r:2",
                            "E5:2 r:1 A4:1 C5:2 E5:2 F#5:1 G5:1 A5:2", "F#5:2 D5:2 A4:2 D5:4 r:2",
                            "G5:2 E5:1 C5:1 G4:2 C5:2 E5:2 G5:2", "D5:2 B4:1 G4:1 D4:2 G4:2 B4:2 D5:2",
                            "B4:3 C5:1 B4:2 G#4:2 A4:2 B4:2", "E5:6 r:6",
                            "A5:4 G5:1 F#5:1 E5:2 C5:2 E5:2", "D5:4 B4:2 G4:2 B4:2 D5:2",
                            "F#5:4 E5:1 D5:1 A4:2 D5:2 F#5:2", "E5:6 r:6",
                            "G5:4 F#5:1 E5:1 C5:2 E5:2 G5:2", "A5:4 G5:1 F#5:1 D5:2 F#5:2 A5:2",
                            "G#5:2 A5:2 B5:2 E5:3 F#5:1 G#5:2", "B5:6 r:6",
                        ],
                        brass2: [
                            "E4:2 r:1 A3:1 C4:2 E4:2 D4:1 C4:1 B3:2", "A3:2 D4:2 F#4:2 E4:4 r:2",
                            "E4:2 r:1 A3:1 C4:2 E4:2 F#4:1 G4:1 A4:2", "F#4:2 D4:2 A3:2 D4:4 r:2",
                            "G4:2 E4:1 C4:1 G3:2 C4:2 E4:2 G4:2", "D4:2 B3:1 G3:1 D3:2 G3:2 B3:2 D4:2",
                            "B3:3 C4:1 B3:2 G#3:2 A3:2 B3:2", "E4:6 r:6",
                            "A4:4 G4:1 F#4:1 E4:2 C4:2 E4:2", "D4:4 B3:2 G3:2 B3:2 D4:2",
                            "F#4:4 E4:1 D4:1 A3:2 D4:2 F#4:2", "E4:6 r:6",
                            "G4:4 F#4:1 E4:1 C4:2 E4:2 G4:2", "A4:4 G4:1 F#4:1 D4:2 F#4:2 A4:2",
                            "G#4:2 A4:2 B4:2 E4:3 F#4:1 G#4:2", "B4:6 r:6",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1", "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1", "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1", "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1", "E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E3:1 E3:1 B3:1 E4:1 E3:1 B3:1",
                        ],
                        sub: [
                            "A2:12", "D2:12", "A2:12", "D2:12",
                            "C3:12", "G2:12", "E2:12", "E2:12",
                            "A2:12", "G2:12", "D2:12", "A2:12",
                            "C3:12", "D2:12", "E2:12", "E2:12",
                        ],
                        lead2: [
                            "C5:2 r:1 F#4:1 A4:2 C5:2 B4:1 A4:1 G4:2", "F#4:2 B4:2 D5:2 A4:4 r:2",
                            "C5:2 r:1 F#4:1 A4:2 C5:2 D5:1 E5:1 F#5:2", "D5:2 B4:2 F#4:2 A4:4 r:2",
                            "E5:2 C5:1 A4:1 E4:2 A4:2 C5:2 E5:2", "B4:2 G4:1 E4:1 B3:2 E4:2 G4:2 B4:2",
                            "G#4:3 A4:1 G4:2 F4:2 F#4:2 G4:2", "B4:6 r:6",
                            "E5:4 E5:1 D5:1 C5:2 A4:2 C5:2", "B4:4 G4:2 E4:2 G4:2 B4:2",
                            "D5:4 C5:1 B4:1 F#4:2 B4:2 D5:2", "C5:6 r:6",
                            "E5:4 D5:1 C5:1 A4:2 C5:2 E5:2", "F#5:4 E5:1 D5:1 B4:2 D5:2 F#5:2",
                            "F5:2 F#5:2 G5:2 B4:3 D5:1 F5:2", "G#5:6 r:6",
                        ],
                    },
                },
            },
        },
        // Chapter 2 boss level: "Pressure" sped up (124 -> 138 bpm) with the full band, horns on the tune, driving taiko and rushing strings.
        // One loop is 27 s; every third time round a second fiddle joins in.
        "pressure-boss": {
            title: "Pressure (boss)", group: "chapter-boss", volume: 0.78,
            mood: "Faster, grander Pressure for the chapter's hardest level",
            bpm: 138, stepsPerBeat: 4, barSteps: 16,
            loop: "pressure-short",
            cycle: ["boss", "boss", "boss2"],
            variations: {
                boss: {
                    channels: {
                        lead: [
                            "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 B3:4",
                            "E5:2 D5:2 C5:2 B4:2 A4:2 G4:2 A4:2 C5:2", "B4:4 D#5:2 F#5:2 A5:3 G5:1 F#5:4",
                            "E5:2 F#5:2 G5:2 E5:2 B5:3 A#5:1 B5:2 G5:2", "F#5:2 G5:2 A5:2 F#5:2 E5:4 G5:2 B5:2",
                            "C6:2 B5:2 A5:2 G5:2 E5:2 F#5:2 G5:2 A5:2", "B5:2 A5:2 F#5:2 D#5:2 B4:4 r:4",
                            "E5:4 G5:2 C6:4 B5:2 C6:2 E6:2", "F#5:4 E5:2 D5:4 A4:2 D5:2 F#5:2",
                            "G5:4 F#5:2 E5:2 B4:2 E5:2 G5:4", "B5:4 A5:2 G5:2 F#5:2 E5:2 B4:4",
                            "E5:4 G5:2 C6:4 B5:2 A5:2 G5:2", "A5:4 F#5:2 D5:4 E5:2 F#5:2 A5:2",
                            "D#5:2 F#5:2 B5:4 A5:2 F#5:2 D#5:4", "F#6:4 D#6:4 B5:4 r:4",
                        ],
                        brass2: [
                            "E3:2 F#3:2 G3:2 E3:2 B3:3 A#3:1 B3:2 G3:2", "F#3:2 G3:2 A3:2 F#3:2 E3:4 B2:4",
                            "E4:2 D4:2 C4:2 B3:2 A3:2 G3:2 A3:2 C4:2", "B3:4 D#4:2 F#4:2 A4:3 G4:1 F#4:4",
                            "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 G4:2 B4:2",
                            "C5:2 B4:2 A4:2 G4:2 E4:2 F#4:2 G4:2 A4:2", "B4:2 A4:2 F#4:2 D#4:2 B3:4 r:4",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 B:2 B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                        ],
                        sub: [
                            "E2:16", "E2:16", "C3:16", "B2:16",
                            "E2:16", "E2:16", "A2:16", "B2:16",
                            "C3:16", "D2:16", "E2:16", "E2:16",
                            "C3:16", "D2:16", "B2:16", "B2:16",
                        ],
                    },
                },
                boss2: {
                    channels: {
                        lead: [
                            "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 B3:4",
                            "E5:2 D5:2 C5:2 B4:2 A4:2 G4:2 A4:2 C5:2", "B4:4 D#5:2 F#5:2 A5:3 G5:1 F#5:4",
                            "E5:2 F#5:2 G5:2 E5:2 B5:3 A#5:1 B5:2 G5:2", "F#5:2 G5:2 A5:2 F#5:2 E5:4 G5:2 B5:2",
                            "C6:2 B5:2 A5:2 G5:2 E5:2 F#5:2 G5:2 A5:2", "B5:2 A5:2 F#5:2 D#5:2 B4:4 r:4",
                            "E5:4 G5:2 C6:4 B5:2 C6:2 E6:2", "F#5:4 E5:2 D5:4 A4:2 D5:2 F#5:2",
                            "G5:4 F#5:2 E5:2 B4:2 E5:2 G5:4", "B5:4 A5:2 G5:2 F#5:2 E5:2 B4:4",
                            "E5:4 G5:2 C6:4 B5:2 A5:2 G5:2", "A5:4 F#5:2 D5:4 E5:2 F#5:2 A5:2",
                            "D#5:2 F#5:2 B5:4 A5:2 F#5:2 D#5:4", "F#6:4 D#6:4 B5:4 r:4",
                        ],
                        brass2: [
                            "E3:2 F#3:2 G3:2 E3:2 B3:3 A#3:1 B3:2 G3:2", "F#3:2 G3:2 A3:2 F#3:2 E3:4 B2:4",
                            "E4:2 D4:2 C4:2 B3:2 A3:2 G3:2 A3:2 C4:2", "B3:4 D#4:2 F#4:2 A4:3 G4:1 F#4:4",
                            "E4:2 F#4:2 G4:2 E4:2 B4:3 A#4:1 B4:2 G4:2", "F#4:2 G4:2 A4:2 F#4:2 E4:4 G4:2 B4:2",
                            "C5:2 B4:2 A4:2 G4:2 E4:2 F#4:2 G4:2 A4:2", "B4:2 A4:2 F#4:2 D#4:2 B3:4 r:4",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 B:2 B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                            "B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B3:1 B3:1 F#4:1 B3:1 B4:1 B3:1 F#4:1 B3:1",
                        ],
                        sub: [
                            "E2:16", "E2:16", "C3:16", "B2:16",
                            "E2:16", "E2:16", "A2:16", "B2:16",
                            "C3:16", "D2:16", "E2:16", "E2:16",
                            "C3:16", "D2:16", "B2:16", "B2:16",
                        ],
                        lead2: [
                            "C4:2 D4:2 E4:2 C4:2 G4:3 G4:1 G4:2 E4:2", "D4:2 E4:2 F#4:2 D4:2 B3:4 G3:4",
                            "C5:2 B4:2 A4:2 G4:2 F#4:2 E4:2 F#4:2 A4:2", "F#4:4 C5:2 D5:2 F#5:3 E5:1 D#5:4",
                            "C5:2 D5:2 E5:2 C5:2 G5:3 G5:1 G5:2 E5:2", "D5:2 E5:2 F#5:2 D5:2 B4:4 E5:2 G5:2",
                            "A5:2 G5:2 F#5:2 E5:2 C5:2 D5:2 E5:2 F#5:2", "G5:2 F#5:2 D5:2 C5:2 F#4:4 r:4",
                            "E5:4 G5:2 C6:4 B5:2 C6:2 E6:2", "F#5:4 E5:2 D5:4 A4:2 D5:2 F#5:2",
                            "G5:4 F#5:2 E5:2 B4:2 E5:2 G5:4", "B5:4 A5:2 G5:2 F#5:2 E5:2 B4:4",
                            "E5:4 G5:2 C6:4 B5:2 A5:2 G5:2", "A5:4 F#5:2 D5:4 E5:2 F#5:2 A5:2",
                            "D#5:2 F#5:2 B5:4 A5:2 F#5:2 D#5:4", "F#6:4 D#6:4 B5:4 r:4",
                        ],
                    },
                },
            },
        },
        // Chapter 3 boss level: "Locks and Keys" sped up (80 -> 92 bpm) with the full band, horns on the tune, driving taiko and rushing strings.
        // One loop is 20 s; every third time round a second fiddle joins in.
        "locks-keys-boss": {
            title: "Locks and Keys (boss)", group: "chapter-boss", volume: 0.62,
            mood: "Faster, grander Locks and Keys for the chapter's hardest level",
            bpm: 92, stepsPerBeat: 6, barSteps: 12,
            loop: "locks-keys-short",
            cycle: ["boss", "boss", "boss2"],
            variations: {
                boss: {
                    channels: {
                        lead: [
                            "A4:6 D5:3 E5:1 F5:2", "F5:3 E5:1 D5:2 Bb4:2 D5:2 F5:2",
                            "A4:2 D5:2 E5:2 F5:3 G5:1 A5:2", "Bb5:6 A5:3 G5:1 F5:2",
                            "G5:4 Bb5:2 D6:6", "C6:3 Bb5:1 A5:2 F5:2 A5:2 D6:2",
                            "G5:2 A5:2 Bb5:2 D6:3 C6:1 Bb5:2", "A5:6 C#5:2 E5:2 A5:2",
                            "A5:4 C6:2 A5:3 G5:1 F5:2", "G5:2 E5:1 F5:1 G5:2 E5:2 C5:2 E5:2",
                            "F5:4 D5:2 Bb4:2 D5:2 F5:2", "A5:6 G5:2 A5:2 C6:2",
                            "D6:4 C6:2 Bb5:2 A5:2 G5:2", "F5:3 G5:1 F5:2 D5:2 E5:2 F5:2",
                            "C#5:2 E5:2 A5:2 G5:3 F5:1 E5:2", "C#5:2 D5:2 E5:2 F5:2 G5:2 A5:2",
                        ],
                        brass2: [
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "A4:4 C5:2 A4:3 G4:1 F4:2", "G4:2 E4:1 F4:1 G4:2 E4:2 C4:2 E4:2",
                            "F4:4 D4:2 Bb3:2 D4:2 F4:2", "A4:6 G4:2 A4:2 C5:2",
                            "D5:4 C5:2 Bb4:2 A4:2 G4:2", "F4:3 G4:1 F4:2 D4:2 E4:2 F4:2",
                            "C#4:2 E4:2 A4:2 G4:3 F4:1 E4:2", "C#4:2 D4:2 E4:2 F4:2 G4:2 A4:2",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1", "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1", "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1", "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1", "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1",
                            "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1", "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1", "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1",
                        ],
                        sub: [
                            "D2:12", "Bb2:12", "D2:12", "Bb2:12",
                            "G2:12", "D2:12", "G2:12", "A2:12",
                            "F2:12", "C3:12", "Bb2:12", "F2:12",
                            "G2:12", "Bb2:12", "A2:12", "A2:12",
                        ],
                    },
                },
                boss2: {
                    channels: {
                        lead: [
                            "A4:6 D5:3 E5:1 F5:2", "F5:3 E5:1 D5:2 Bb4:2 D5:2 F5:2",
                            "A4:2 D5:2 E5:2 F5:3 G5:1 A5:2", "Bb5:6 A5:3 G5:1 F5:2",
                            "G5:4 Bb5:2 D6:6", "C6:3 Bb5:1 A5:2 F5:2 A5:2 D6:2",
                            "G5:2 A5:2 Bb5:2 D6:3 C6:1 Bb5:2", "A5:6 C#5:2 E5:2 A5:2",
                            "A5:4 C6:2 A5:3 G5:1 F5:2", "G5:2 E5:1 F5:1 G5:2 E5:2 C5:2 E5:2",
                            "F5:4 D5:2 Bb4:2 D5:2 F5:2", "A5:6 G5:2 A5:2 C6:2",
                            "D6:4 C6:2 Bb5:2 A5:2 G5:2", "F5:3 G5:1 F5:2 D5:2 E5:2 F5:2",
                            "C#5:2 E5:2 A5:2 G5:3 F5:1 E5:2", "C#5:2 D5:2 E5:2 F5:2 G5:2 A5:2",
                        ],
                        brass2: [
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "A4:4 C5:2 A4:3 G4:1 F4:2", "G4:2 E4:1 F4:1 G4:2 E4:2 C4:2 E4:2",
                            "F4:4 D4:2 Bb3:2 D4:2 F4:2", "A4:6 G4:2 A4:2 C5:2",
                            "D5:4 C5:2 Bb4:2 A4:2 G4:2", "F4:3 G4:1 F4:2 D4:2 E4:2 F4:2",
                            "C#4:2 E4:2 A4:2 G4:3 F4:1 E4:2", "C#4:2 D4:2 E4:2 F4:2 G4:2 A4:2",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1", "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1", "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1", "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1", "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1", "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1",
                            "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1", "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1", "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 F4:1 Bb4:1 Bb3:1 F4:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1", "A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A3:1 A3:1 E4:1 A4:1 A3:1 E4:1",
                        ],
                        sub: [
                            "D2:12", "Bb2:12", "D2:12", "Bb2:12",
                            "G2:12", "D2:12", "G2:12", "A2:12",
                            "F2:12", "C3:12", "Bb2:12", "F2:12",
                            "G2:12", "Bb2:12", "A2:12", "A2:12",
                        ],
                        lead2: [
                            "A4:6 D5:3 E5:1 F5:2", "F5:3 E5:1 D5:2 Bb4:2 D5:2 F5:2",
                            "A4:2 D5:2 E5:2 F5:3 G5:1 A5:2", "Bb5:6 A5:3 G5:1 F5:2",
                            "G5:4 Bb5:2 D6:6", "C6:3 Bb5:1 A5:2 F5:2 A5:2 D6:2",
                            "G5:2 A5:2 Bb5:2 D6:3 C6:1 Bb5:2", "A5:6 C#5:2 E5:2 A5:2",
                            "F5:4 A5:2 F5:3 E5:1 D5:2", "E5:2 C5:1 D5:1 E5:2 C5:2 A4:2 C5:2",
                            "D5:4 Bb4:2 G4:2 Bb4:2 D5:2", "F5:6 E5:2 F5:2 A5:2",
                            "Bb5:4 A5:2 G5:2 F5:2 E5:2", "D5:3 E5:1 D5:2 Bb4:2 C5:2 D5:2",
                            "Bb4:2 C5:2 F5:2 E5:3 D5:1 C5:2", "Bb4:2 Bb4:2 C5:2 D5:2 E5:2 F5:2",
                        ],
                    },
                },
            },
        },
        // Chapter 4 boss level: "Gunpowder" sped up (112 -> 128 bpm) with the full band, horns on the tune, driving taiko and rushing strings.
        // One loop is 30 s; every third time round a second fiddle joins in.
        "gunpowder-boss": {
            title: "Gunpowder (boss)", group: "chapter-boss", volume: 0.66,
            mood: "Faster, grander Gunpowder for the chapter's hardest level",
            bpm: 128, stepsPerBeat: 4, barSteps: 16,
            loop: "gunpowder-short",
            cycle: ["boss", "boss", "boss2"],
            variations: {
                boss: {
                    channels: {
                        lead: [
                            "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8",
                            "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
                            "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8",
                            "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
                            "D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:2 A5:2", "E5:2 A5:2 C6:2 E6:2 D6:2 C6:2 B5:2 C6:2",
                            "A5:4 F5:2 C5:2 F5:4 A5:4", "G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2",
                            "F5:4 A5:4 D6:6 C6:2", "C6:4 B5:2 A5:2 E5:8",
                            "G#5:2 A5:2 B5:2 C6:2 D6:2 C6:2 B5:2 G#5:2", "B5:8 G#5:4 E5:4",
                        ],
                        brass2: [
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "D4:2 F4:2 A4:2 D5:2 C5:2 A4:2 F4:2 A4:2", "E4:2 A4:2 C5:2 E5:2 D5:2 C5:2 B4:2 C5:2",
                            "A4:4 F4:2 C4:2 F4:4 A4:4", "G4:2 B4:2 D5:4 C5:2 B4:2 A4:2 G4:2",
                            "F4:4 A4:4 D5:6 C5:2", "C5:4 B4:2 A4:2 E4:8",
                            "G#4:2 A4:2 B4:2 C5:2 D5:2 C5:2 B4:2 G#4:2", "B4:8 G#4:4 E4:4",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 B:2 B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                        ],
                        sub: [
                            "A2:16", "A2:16", "F2:16", "G2:16",
                            "A2:16", "A2:16", "F2:16", "E2:16",
                            "D2:16", "A2:16", "F2:16", "G2:16",
                            "D2:16", "A2:16", "E2:16", "E2:16",
                        ],
                    },
                },
                boss2: {
                    channels: {
                        lead: [
                            "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8",
                            "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
                            "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8",
                            "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
                            "D5:2 F5:2 A5:2 D6:2 C6:2 A5:2 F5:2 A5:2", "E5:2 A5:2 C6:2 E6:2 D6:2 C6:2 B5:2 C6:2",
                            "A5:4 F5:2 C5:2 F5:4 A5:4", "G5:2 B5:2 D6:4 C6:2 B5:2 A5:2 G5:2",
                            "F5:4 A5:4 D6:6 C6:2", "C6:4 B5:2 A5:2 E5:8",
                            "G#5:2 A5:2 B5:2 C6:2 D6:2 C6:2 B5:2 G#5:2", "B5:8 G#5:4 E5:4",
                        ],
                        brass2: [
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "r:16", "r:16",
                            "D4:2 F4:2 A4:2 D5:2 C5:2 A4:2 F4:2 A4:2", "E4:2 A4:2 C5:2 E5:2 D5:2 C5:2 B4:2 C5:2",
                            "A4:4 F4:2 C4:2 F4:4 A4:4", "G4:2 B4:2 D5:4 C5:2 B4:2 A4:2 G4:2",
                            "F4:4 A4:4 D5:6 C5:2", "C5:4 B4:2 A4:2 E4:8",
                            "G#4:2 A4:2 B4:2 C5:2 D5:2 C5:2 B4:2 G#4:2", "B4:8 G#4:4 E4:4",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 B:2 B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D3:1 D3:1 A3:1 D3:1 D4:1 D3:1 A3:1 D3:1",
                            "A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A3:1 A3:1 E4:1 A3:1 A4:1 A3:1 E4:1 A3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                            "E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E3:1 E3:1 B3:1 E3:1 E4:1 E3:1 B3:1 E3:1",
                        ],
                        sub: [
                            "A2:16", "A2:16", "F2:16", "G2:16",
                            "A2:16", "A2:16", "F2:16", "E2:16",
                            "D2:16", "A2:16", "F2:16", "G2:16",
                            "D2:16", "A2:16", "E2:16", "E2:16",
                        ],
                        lead2: [
                            "A4:3 A4:1 E5:4 D5:2 C5:2 B4:2 C5:2", "A4:6 E4:2 A4:8",
                            "C5:3 C5:1 F5:4 E5:2 D5:2 C5:2 A4:2", "B4:6 G4:2 D5:8",
                            "E5:3 E5:1 A5:4 G5:2 E5:2 D5:2 C5:2", "E5:6 C5:2 A4:8",
                            "F5:4 E5:2 D5:2 C5:4 A4:4", "B4:4 G#4:4 E4:8",
                            "B4:2 D5:2 F5:2 B5:2 A5:2 F5:2 D5:2 F5:2", "C5:2 F5:2 A5:2 C6:2 B5:2 A5:2 G5:2 A5:2",
                            "F5:4 D5:2 A4:2 C5:4 F5:4", "E5:2 G5:2 B5:4 A5:2 G5:2 F5:2 E5:2",
                            "D5:4 F5:4 A5:6 A5:2", "A5:4 G5:2 F5:2 C5:8",
                            "F5:2 F5:2 G5:2 A5:2 B5:2 A5:2 G5:2 F5:2", "G#5:8 E5:4 B4:4",
                        ],
                    },
                },
            },
        },
        // Chapter 5 boss level: "Crossfire" sped up (76 -> 88 bpm) with the full band, horns on the tune, driving taiko and rushing strings.
        // One loop is 21 s; every third time round a second fiddle joins in.
        "crossfire-boss": {
            title: "Crossfire (boss)", group: "chapter-boss", volume: 0.63,
            mood: "Faster, grander Crossfire for the chapter's hardest level",
            bpm: 88, stepsPerBeat: 6, barSteps: 12,
            loop: "crossfire-short",
            cycle: ["boss", "boss", "boss2"],
            variations: {
                boss: {
                    channels: {
                        lead: [
                            "D5:2 G5:2 A5:1 Bb5:1 A5:2 G5:2 D5:2", "C5:2 F5:2 G5:1 A5:1 G5:2 F5:2 C5:2",
                            "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 F#5:2 A5:6",
                            "Bb5:2 A5:1 G5:1 D5:2 G5:2 A5:1 Bb5:1 C6:2", "A5:2 G5:1 F5:1 C5:2 F5:2 G5:1 A5:1 Bb5:2",
                            "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:2 G5:2", "F#5:6 D5:2 E5:2 F#5:2",
                            "C5:6 Eb5:3 D5:1 C5:2", "D5:6 Bb4:6",
                            "Eb5:4 G5:2 C6:6", "Bb5:3 A5:1 G5:2 D5:6",
                            "Eb5:4 G5:2 Bb5:4 G5:2", "C6:4 A5:2 F5:4 A5:2",
                            "D6:6 C6:2 Bb5:2 A5:2", "F#5:6 A5:6",
                        ],
                        brass2: [
                            "D4:2 G4:2 A4:1 Bb4:1 A4:2 G4:2 D4:2", "C4:2 F4:2 G4:1 A4:1 G4:2 F4:2 C4:2",
                            "Bb3:2 Eb4:2 F4:1 G4:1 F4:2 Eb4:2 Bb3:2", "A3:2 D4:2 F#4:2 A4:6",
                            "Bb4:2 A4:1 G4:1 D4:2 G4:2 A4:1 Bb4:1 C5:2", "A4:2 G4:1 F4:1 C4:2 F4:2 G4:1 A4:1 Bb4:2",
                            "G4:2 F4:1 Eb4:1 Bb3:2 Eb4:2 F4:2 G4:2", "F#4:6 D4:2 E4:2 F#4:2",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb4:1 Eb3:1 Bb3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb4:1 Eb3:1 Bb3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb4:1 Eb3:1 Bb3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                        ],
                        sub: [
                            "G2:12", "F2:12", "Eb2:12", "D2:12",
                            "G2:12", "F2:12", "Eb2:12", "D2:12",
                            "C3:12", "G2:12", "C3:12", "G2:12",
                            "Eb2:12", "F2:12", "D2:12", "D2:12",
                        ],
                    },
                },
                boss2: {
                    channels: {
                        lead: [
                            "D5:2 G5:2 A5:1 Bb5:1 A5:2 G5:2 D5:2", "C5:2 F5:2 G5:1 A5:1 G5:2 F5:2 C5:2",
                            "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 F#5:2 A5:6",
                            "Bb5:2 A5:1 G5:1 D5:2 G5:2 A5:1 Bb5:1 C6:2", "A5:2 G5:1 F5:1 C5:2 F5:2 G5:1 A5:1 Bb5:2",
                            "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:2 G5:2", "F#5:6 D5:2 E5:2 F#5:2",
                            "C5:6 Eb5:3 D5:1 C5:2", "D5:6 Bb4:6",
                            "Eb5:4 G5:2 C6:6", "Bb5:3 A5:1 G5:2 D5:6",
                            "Eb5:4 G5:2 Bb5:4 G5:2", "C6:4 A5:2 F5:4 A5:2",
                            "D6:6 C6:2 Bb5:2 A5:2", "F#5:6 A5:6",
                        ],
                        brass2: [
                            "D4:2 G4:2 A4:1 Bb4:1 A4:2 G4:2 D4:2", "C4:2 F4:2 G4:1 A4:1 G4:2 F4:2 C4:2",
                            "Bb3:2 Eb4:2 F4:1 G4:1 F4:2 Eb4:2 Bb3:2", "A3:2 D4:2 F#4:2 A4:6",
                            "Bb4:2 A4:1 G4:1 D4:2 G4:2 A4:1 Bb4:1 C5:2", "A4:2 G4:1 F4:1 C4:2 F4:2 G4:1 A4:1 Bb4:2",
                            "G4:2 F4:1 Eb4:1 Bb3:2 Eb4:2 F4:2 G4:2", "F#4:6 D4:2 E4:2 F#4:2",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                            "r:12", "r:12",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B+C:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 r:2 B:2 B:2 r:2 S:2",
                            "B:2 r:2 B:2 B:2 r:2 S:2", "B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb4:1 Eb3:1 Bb3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb4:1 Eb3:1 Bb3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C4:1 C4:1 G4:1 C5:1 C4:1 G4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G3:1 G3:1 D4:1 G4:1 G3:1 D4:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Bb3:1 Eb4:1 Eb3:1 Bb3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F3:1 F3:1 C4:1 F4:1 F3:1 C4:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                            "D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D3:1 D3:1 A3:1 D4:1 D3:1 A3:1",
                        ],
                        sub: [
                            "G2:12", "F2:12", "Eb2:12", "D2:12",
                            "G2:12", "F2:12", "Eb2:12", "D2:12",
                            "C3:12", "G2:12", "C3:12", "G2:12",
                            "Eb2:12", "F2:12", "D2:12", "D2:12",
                        ],
                        lead2: [
                            "Bb4:2 Eb5:2 F5:1 G5:1 F5:2 Eb5:2 Bb4:2", "A4:2 D5:2 Eb5:1 F5:1 Eb5:2 D5:2 A4:2",
                            "G4:2 C5:2 D5:1 Eb5:1 D5:2 C5:2 G4:2", "F4:2 Bb4:2 Eb5:2 F#5:6",
                            "G5:2 F5:1 Eb5:1 Bb4:2 Eb5:2 F5:1 G5:1 A5:2", "F5:2 Eb5:1 D5:1 A4:2 D5:2 Eb5:1 F5:1 G5:2",
                            "Eb5:2 D5:1 C5:1 G4:2 C5:2 D5:2 Eb5:2", "D5:6 Bb4:2 Db5:2 Eb5:2",
                            "C5:6 Eb5:3 D5:1 C5:2", "D5:6 Bb4:6",
                            "Eb5:4 G5:2 C6:6", "Bb5:3 A5:1 G5:2 D5:6",
                            "Eb5:4 G5:2 Bb5:4 G5:2", "C6:4 A5:2 F5:4 A5:2",
                            "D6:6 C6:2 Bb5:2 A5:2", "F#5:6 A5:6",
                        ],
                    },
                },
            },
        },
        // Chapter 6 boss level: "Davy Jones" sped up (80 -> 96 bpm) with the full band, horns on the tune, driving taiko and rushing strings.
        // One loop is 40 s; every third time round a second fiddle joins in.
        "davy-jones-boss": {
            title: "Davy Jones (boss)", group: "chapter-boss", volume: 0.7,
            mood: "Faster, grander Davy Jones for the chapter's hardest level",
            bpm: 96, stepsPerBeat: 4, barSteps: 16,
            loop: "davy-jones-short",
            cycle: ["boss", "boss", "boss2"],
            variations: {
                boss: {
                    channels: {
                        lead: [
                            "C5:6 G4:2 C5:2 D5:2 Eb5:4", "Eb5:6 C5:2 Ab4:8", "G5:6 F5:2 Eb5:2 D5:2 C5:4", "Eb5:8 Ab5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 C5:4", "G5:6 Eb5:2 C5:8", "D5:4 G5:4 B5:8", "D6:6 C6:2 B5:8",
                            "C6:6 Bb5:2 Ab5:2 G5:2 Ab5:4", "G5:6 F5:2 Eb5:8", "F5:6 G5:2 Ab5:2 Bb5:2 D6:4", "Eb6:8 D6:4 C6:4",
                            "Db6:6 C6:2 Ab5:8", "C6:4 Eb6:4 Ab5:8", "B5:4 C6:2 D6:2 G5:8", "D6:8 B5:4 G5:4",
                        ],
                        brass2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "C5:6 Bb4:2 Ab4:2 G4:2 Ab4:4", "G4:6 F4:2 Eb4:8", "F4:6 G4:2 Ab4:2 Bb4:2 D5:4", "Eb5:8 D5:4 C5:4",
                            "Db5:6 C5:2 Ab4:8", "C5:4 Eb5:4 Ab4:8", "B4:4 C5:2 D5:2 G4:8", "D5:8 B4:4 G4:4",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 B:2 B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1 Bb3:1 Eb3:1",
                            "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb4:1 Bb3:1 F4:1 Bb3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "Db4:1 Db4:1 Ab4:1 Db4:1 Db4:1 Db4:1 Ab4:1 Db4:1 Db4:1 Db4:1 Ab4:1 Db4:1 Db5:1 Db4:1 Ab4:1 Db4:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                        ],
                    },
                },
                boss2: {
                    channels: {
                        lead: [
                            "C5:6 G4:2 C5:2 D5:2 Eb5:4", "Eb5:6 C5:2 Ab4:8", "G5:6 F5:2 Eb5:2 D5:2 C5:4", "Eb5:8 Ab5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 C5:4", "G5:6 Eb5:2 C5:8", "D5:4 G5:4 B5:8", "D6:6 C6:2 B5:8",
                            "C6:6 Bb5:2 Ab5:2 G5:2 Ab5:4", "G5:6 F5:2 Eb5:8", "F5:6 G5:2 Ab5:2 Bb5:2 D6:4", "Eb6:8 D6:4 C6:4",
                            "Db6:6 C6:2 Ab5:8", "C6:4 Eb6:4 Ab5:8", "B5:4 C6:2 D6:2 G5:8", "D6:8 B5:4 G5:4",
                        ],
                        brass2: [
                            "r:16", "r:16", "r:16", "r:16",
                            "r:16", "r:16", "r:16", "r:16",
                            "C5:6 Bb4:2 Ab4:2 G4:2 Ab4:4", "G4:6 F4:2 Eb4:8", "F4:6 G4:2 Ab4:2 Bb4:2 D5:4", "Eb5:8 D5:4 C5:4",
                            "Db5:6 C5:2 Ab4:8", "C5:4 Eb5:4 Ab4:8", "B4:4 C5:2 D5:2 G4:8", "D5:8 B4:4 G4:4",
                        ],
                        drums2: [
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B+C:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2",
                            "B:2 r:2 B:2 r:2 B:2 B:2 S:2 r:2", "B:2 B:2 B:2 B:2 S:1 S:1 S:1 S:1 S:1 S:1 S:1 S:1",
                        ],
                        ostinato2: [
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F3:1 F3:1 C4:1 F3:1 F4:1 F3:1 C4:1 F3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb3:1 Eb3:1 Bb3:1 Eb3:1 Eb4:1 Eb3:1 Bb3:1 Eb3:1",
                            "Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb3:1 Bb3:1 F4:1 Bb3:1 Bb4:1 Bb3:1 F4:1 Bb3:1",
                            "C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C4:1 C4:1 G4:1 C4:1 C5:1 C4:1 G4:1 C4:1",
                            "Db4:1 Db4:1 Ab4:1 Db4:1 Db4:1 Db4:1 Ab4:1 Db4:1 Db4:1 Db4:1 Ab4:1 Db4:1 Db5:1 Db4:1 Ab4:1 Db4:1",
                            "Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab3:1 Ab3:1 Eb4:1 Ab3:1 Ab4:1 Ab3:1 Eb4:1 Ab3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                            "G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G3:1 G3:1 D4:1 G3:1 G4:1 G3:1 D4:1 G3:1",
                        ],
                        lead2: [
                            "C5:6 G4:2 C5:2 D5:2 Eb5:4", "Eb5:6 C5:2 Ab4:8", "G5:6 F5:2 Eb5:2 D5:2 C5:4", "Eb5:8 Ab5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 C5:4", "G5:6 Eb5:2 C5:8", "D5:4 G5:4 B5:8", "D6:6 C6:2 B5:8",
                            "Ab5:6 G5:2 F5:2 Eb5:2 Eb5:4", "Eb5:6 D5:2 Bb4:8", "D5:6 Eb5:2 F5:2 G5:2 Bb5:4", "C6:8 G5:4 G5:4",
                            "Ab5:6 Ab5:2 F5:8", "Ab5:4 C6:4 Eb5:8", "G5:4 Ab5:2 Bb5:2 D5:8", "B5:8 G5:4 D5:4",
                        ],
                    },
                },
            },
        },

        // ---- Extras ----
        // "Heroic Milestone": the old title theme. D major, 4/4. A heroic orchestral
        // adventure theme: horns over driving strings and taiko (Bm G D A Bm G Em A).
        "milestone": {
            title: "Heroic Milestone", group: "extra", volume: 1.0,
            mood: "Heroic orchestral fanfare in D major, saved for a big milestone",
            bpm: 92, stepsPerBeat: 4, barSteps: 16,
            channels: {
                brass: [
                    "F#4:4 B4:6 A4:2 B4:2 C#5:2", "D5:6 C#5:2 B4:4 G4:4", "A4:6 F#4:2 A4:2 D5:6", "C#5:8 E5:4 C#5:4",
                    "D5:4 F#5:6 E5:2 D5:2 C#5:2", "B4:4 D5:4 G5:6 F#5:2", "E5:6 D5:2 B4:4 G5:4", "F#5:4 E5:4 C#5:4 A4:4",
                ],
                strings: [
                    "B3+D4+F#4:16", "B3+D4+G4:16", "A3+D4+F#4:16", "A3+C#4+E4:16",
                    "B3+D4+F#4:16", "B3+D4+G4:16", "B3+E4+G4:16", "A3+C#4+E4:16",
                ],
                ostinato: [
                    "B2:2 B2:2 F#3:2 B2:2 D3:2 B2:2 F#3:2 B2:2", "G2:2 G2:2 D3:2 G2:2 B2:2 G2:2 D3:2 G2:2",
                    "D3:2 D3:2 A3:2 D3:2 F#3:2 D3:2 A3:2 D3:2", "A2:2 A2:2 E3:2 A2:2 C#3:2 A2:2 E3:2 A2:2",
                    "B2:2 B2:2 F#3:2 B2:2 D3:2 B2:2 F#3:2 B2:2", "G2:2 G2:2 D3:2 G2:2 B2:2 G2:2 D3:2 G2:2",
                    "E2:2 E2:2 B2:2 E2:2 G2:2 E2:2 B2:2 E2:2", "A2:2 A2:2 E3:2 A2:2 C#3:2 A2:2 E3:2 A2:2",
                ],
                cello: ["B1:8 B1:8", "G1:8 G1:8", "D2:8 D2:8", "A1:8 A1:8", "B1:8 B1:8", "G1:8 G1:8", "E2:8 E2:8", "A1:8 A1:8"],
                drums: [
                    "B+C:4 r:2 B:2 S:4 r:2 B:2", "B:4 r:2 B:2 S:2 s:2 S:2 s:1 s:1",
                    "B:4 r:2 B:2 S:4 r:2 B:2", "B:4 B:2 B:2 S:1 s:1 S:1 s:1 S:1 S:1 S:1 S:1",
                ],
            },
        },
        // "Open Ocean": slow, vast and majestic in C major. A soaring string melody
        // over shimmering bells, with a bright D major lift (C G Am F C G D F).
        "open-ocean": {
            title: "Open Ocean", group: "extra", volume: 1.1,
            mood: "Slow, vast and majestic in C major: soaring strings and bells",
            bpm: 72, stepsPerBeat: 4, barSteps: 16,
            channels: {
                lead: [
                    "G4:4 C5:4 E5:8", "D5:8 B4:4 D5:4", "E5:6 C5:2 A4:8", "C5:4 F5:4 A5:8",
                    "G5:8 E5:4 G5:4", "B5:8 A5:4 G5:4", "A5:8 F#5:4 A5:4", "C6:8 A5:4 F5:4",
                ],
                strings: [
                    "C4+E4+G4:16", "B3+D4+G4:16", "C4+E4+A4:16", "C4+F4+A4:16",
                    "C4+E4+G4:16", "B3+D4+G4:16", "D4+F#4+A4:16", "C4+F4+A4:16",
                ],
                bell: [
                    "C6:4 G5:4 E6:4 G5:4", "B5:4 D6:4 G6:4 D6:4", "A5:4 C6:4 E6:4 C6:4", "A5:4 C6:4 F6:4 C6:4",
                    "C6:4 G5:4 E6:4 G5:4", "B5:4 D6:4 G6:4 D6:4", "A5:4 D6:4 F#6:4 D6:4", "A5:4 C6:4 F6:4 C6:4",
                ],
                ostinato: [
                    "C3:2 G3:2 C4:2 G3:2 C3:2 G3:2 C4:2 G3:2", "G2:2 D3:2 G3:2 D3:2 G2:2 D3:2 G3:2 D3:2",
                    "A2:2 E3:2 A3:2 E3:2 A2:2 E3:2 A3:2 E3:2", "F2:2 C3:2 F3:2 C3:2 F2:2 C3:2 F3:2 C3:2",
                    "C3:2 G3:2 C4:2 G3:2 C3:2 G3:2 C4:2 G3:2", "G2:2 D3:2 G3:2 D3:2 G2:2 D3:2 G3:2 D3:2",
                    "D3:2 A3:2 D4:2 A3:2 D3:2 A3:2 D4:2 A3:2", "F2:2 C3:2 F3:2 C3:2 F2:2 C3:2 F3:2 C3:2",
                ],
                sub: ["C2:16", "G1:16", "A1:16", "F1:16", "C2:16", "G1:16", "D2:16", "F1:16"],
                drums: [
                    "B+C:4 r:8 T:2 T:2", "B:4 r:12", "B:4 r:8 T:2 T:2", "B:4 r:4 T:2 T:2 T:1 T:1 T:1 T:1",
                ],
            },
        },
        // "Fair Winds": a bright, galloping sea journey in G major (6/8). A fiddle
        // tune with a horn counter-melody (G D Em C | G D C D | Em C G D | C D G G).
        "fair-winds": {
            title: "Fair Winds", group: "extra", volume: 1.0,
            mood: "Bright, sunny fiddle jig in G major",
            bpm: 100, stepsPerBeat: 3, barSteps: 6,
            channels: {
                lead: [
                    "D4:2 G4:1 B4:2 D5:1", "F#5:3 E5:2 D5:1", "E5:2 G5:1 B4:2 E5:1", "E5:3 D5:2 C5:1",
                    "B4:2 D5:1 G5:2 B5:1", "A5:3 F#5:2 D5:1", "G5:2 E5:1 C5:2 E5:1", "D5:2 E5:1 F#5:2 A5:1",
                    "G5:3 F#5:2 E5:1", "E5:2 D5:1 C5:3", "D5:2 G5:1 B5:3", "A5:2 F#5:1 D5:3",
                    "E5:2 G5:1 E5:1 D5:1 C5:1", "D5:2 F#5:1 A5:2 F#5:1", "G5:6", "D5:2 B4:1 G4:3",
                ],
                brass: [
                    "B3:6", "A3:6", "B3:6", "C4:6", "D4:6", "D4:3 F#4:3", "E4:6", "F#4:3 A4:3",
                    "G4:6", "G4:3 E4:3", "D4:3 G4:3", "F#4:3 A4:3", "G4:3 E4:3", "F#4:3 A4:3", "G4:6", "D4:6",
                ],
                strings: [
                    "G3+B3+D4:6", "F#3+A3+D4:6", "G3+B3+E4:6", "G3+C4+E4:6", "G3+B3+D4:6", "F#3+A3+D4:6", "G3+C4+E4:6", "F#3+A3+D4:6",
                    "G3+B3+E4:6", "G3+C4+E4:6", "G3+B3+D4:6", "F#3+A3+D4:6", "G3+C4+E4:6", "F#3+A3+D4:6", "G3+B3+D4:6", "G3+B3+D4:6",
                ],
                ostinato: [
                    "G2:1 D3:1 B3:1 G2:1 D3:1 B3:1", "D3:1 A3:1 F#4:1 D3:1 A3:1 F#4:1", "E3:1 B3:1 G4:1 E3:1 B3:1 G4:1", "C3:1 G3:1 E4:1 C3:1 G3:1 E4:1",
                    "G2:1 D3:1 B3:1 G2:1 D3:1 B3:1", "D3:1 A3:1 F#4:1 D3:1 A3:1 F#4:1", "C3:1 G3:1 E4:1 C3:1 G3:1 E4:1", "D3:1 A3:1 F#4:1 D3:1 A3:1 F#4:1",
                    "E3:1 B3:1 G4:1 E3:1 B3:1 G4:1", "C3:1 G3:1 E4:1 C3:1 G3:1 E4:1", "G2:1 D3:1 B3:1 G2:1 D3:1 B3:1", "D3:1 A3:1 F#4:1 D3:1 A3:1 F#4:1",
                    "C3:1 G3:1 E4:1 C3:1 G3:1 E4:1", "D3:1 A3:1 F#4:1 D3:1 A3:1 F#4:1", "G2:1 D3:1 B3:1 G2:1 D3:1 B3:1", "G2:1 D3:1 B3:1 G2:1 D3:1 B3:1",
                ],
                cello: [
                    "G2:3 D2:3", "D2:3 A2:3", "E2:3 B2:3", "C2:3 G2:3", "G2:3 D2:3", "D2:3 A2:3", "C2:3 G2:3", "D2:3 A2:3",
                    "E2:3 B2:3", "C2:3 G2:3", "G2:3 D2:3", "D2:3 A2:3", "C2:3 G2:3", "D2:3 A2:3", "G2:3 D2:3", "G2:3 D2:3",
                ],
                drums: [
                    "B+C:1 h:1 h:1 S:1 h:1 h:1", "B:1 h:1 B:1 S:1 h:1 h:1", "B:1 h:1 h:1 S:1 h:1 h:1", "B:1 h:1 B:1 S:1 h:1 H:1",
                    "B:1 h:1 h:1 S:1 h:1 h:1", "B:1 h:1 B:1 S:1 h:1 h:1", "B:1 h:1 h:1 S:1 h:1 h:1", "B:1 s:1 S:1 S:1 S:1 T:1",
                ],
            },
        },
    };

    // Turns one set of note lists into events { step, inst, kind, notes, len },
    // with shorter lists (like a 2-bar drum loop) repeating to fill `length`.
    function layout(channels, length) {
        const events = [], own = {};
        let longest = 0;
        for (const [inst, bars] of Object.entries(channels)) {
            let step = 0;
            for (const bar of bars) {
                for (const tok of bar.trim().split(/\s+/)) {
                    const [what, len] = tok.split(":");
                    const steps = parseInt(len || "1");
                    // "lead2" is a second part played by the lead instrument.
                    if (what !== "r") events.push({ step, inst, kind: inst.replace(/\d+$/, ""), notes: what.split("+"), len: steps });
                    step += steps;
                }
            }
            own[inst] = step;
            longest = Math.max(longest, step);
        }
        length = length || longest;
        const full = [];
        for (const e of events) {
            for (let s = e.step; s < length; s += own[e.inst]) full.push({ ...e, step: s });
        }
        return { events: full, length };
    }

    // Turns a song into one schedule. A long chapter track plays its `loop`
    // (another track's notes) once per pass, in the order given by `cycle`;
    // a pass named after one of its `variations` changes some parts that time round.
    function compile(song) {
        const base = song.loop ? SONGS[song.loop] : song;
        const normal = layout(base.channels);
        const passLen = normal.length;
        const cycle = song.cycle || ["normal"];
        const events = [], passes = [];
        cycle.forEach((name, i) => {
            const v = (song.variations || {})[name];
            const start = i * passLen;
            passes.push({ name, start, volume: (v && v.volume) || 1 });
            let evs = normal.events;
            if (v) {
                const chans = {};
                for (const [ch, bars] of Object.entries(base.channels)) {
                    if (!(v.mute || []).includes(ch)) chans[ch] = bars;
                }
                Object.assign(chans, v.channels || {});
                evs = layout(chans, passLen).events;
            }
            for (const e of evs) events.push({ ...e, step: e.step + start });
        });
        events.sort((a, b) => a.step - b.step);
        const bpm = song.bpm || base.bpm, stepsPerBeat = song.stepsPerBeat || base.stepsPerBeat;
        return {
            ...base, ...song, bpm, stepsPerBeat, barSteps: song.barSteps || base.barSteps,
            events, passes, length: passLen * cycle.length, stepDur: 60 / bpm / stepsPerBeat,
        };
    }

    // ---- Players ----
    // Each playing song gets its own volume channel, so two can overlap
    // while one fades out and the other fades in.
    const compiled = {};
    let current = null;   // the song you're hearing now
    let fileMusic = null; // an <audio> element when a song file replaces the synth

    function getSong(name) {
        return compiled[name] || (compiled[name] = compile(SONGS[name]));
    }

    // The sound test page can try a different track in a slot, in this
    // browser only. The real choice is PLAYLIST above.
    let preview = {};
    try { preview = JSON.parse(localStorage.getItem("blocked-playlist-preview") || "{}") || {}; } catch (e) { /* storage blocked */ }
    const trackFor = slot => (SONGS[preview[slot]] && preview[slot]) || PLAYLIST[slot];

    // "chapter3" -> { slot: "chapter3", track: "locks-keys" }. A track id works too.
    function resolve(name) {
        const slot = ALIASES[name] || name;
        let track = PLAYLIST[slot] ? trackFor(slot) : slot;
        // "Long chapter music" off: a chapter slot plays its short loop instead.
        if (!settings.longMusic && PLAYLIST[slot] && SONGS[track + "-short"]) track += "-short";
        return SONGS[track] ? { slot, track } : null;
    }

    const passAt = (song, step) => song.passes.filter(x => x.start <= step).pop() || song.passes[0];

    function startPlayer(name, at, startStep, fadeIn) {
        const song = getSong(name);
        const bus = ctx.createGain();
        bus.gain.setValueAtTime(0.0001, ctx.currentTime);
        bus.gain.setValueAtTime(0.0001, at);
        bus.gain.linearRampToValueAtTime(song.volume || 1, at + fadeIn);
        bus.connect(musicBus);
        bus.connect(reverb);
        // Each pass of a long track can have its own level (a softer breakdown, say).
        const mix = ctx.createGain();
        mix.gain.value = passAt(song, startStep).volume;
        mix.connect(bus);
        let index = song.events.findIndex(e => e.step >= startStep);
        if (index < 0) index = song.events.length;
        const p = {
            name, song, bus, mix, step: startStep, nextTime: at, stopAt: Infinity, index,
            // wall-clock time the song's step 0 played, to resume on the next page
            started: Date.now() + (at - ctx.currentTime) * 1000 - startStep * song.stepDur * 1000,
        };
        p.timer = setInterval(() => schedule(p), 25);
        return p;
    }

    function schedule(p) {
        const { song } = p;
        while (p.nextTime < ctx.currentTime + 0.2 && p.nextTime < p.stopAt) {
            const pass = song.passes.find(x => x.start === p.step);
            if (pass && song.passes.length > 1) p.mix.gain.setTargetAtTime(pass.volume, p.nextTime, 0.4);
            while (p.index < song.events.length && song.events[p.index].step === p.step) {
                const e = song.events[p.index++];
                const dur = e.len * song.stepDur;
                for (const n of e.notes) {
                    if (e.kind === "drums") drum(p.mix, p.nextTime, n, 1);
                    else INSTRUMENTS[e.kind](p.mix, p.nextTime, freq(n), dur);
                }
            }
            p.step++;
            p.nextTime += song.stepDur;
            if (p.step >= song.length) {
                p.step = 0;
                p.index = 0;
            }
        }
    }

    function stopPlayer(p, at, fade) {
        p.stopAt = at + fade;
        p.bus.gain.cancelScheduledValues(at);
        p.bus.gain.setTargetAtTime(0.0001, at, fade / 4);
        setTimeout(() => {
            clearInterval(p.timer);
            p.bus.disconnect();
        }, (at - ctx.currentTime + fade + 2) * 1000);
    }

    // When the current song next reaches the start of a bar (a half bar for
    // slow songs, so a switch never waits more than ~2 seconds).
    function nextBar(p) {
        const { song } = p;
        let unit = song.barSteps;
        if (unit * song.stepDur > 2.2) unit /= 2;
        const left = (unit - (p.step % unit)) % unit;
        let at = p.nextTime + left * song.stepDur;
        if (at - ctx.currentTime < 0.3) at += unit * song.stepDur;
        return at;
    }

    // A soft reverse-cymbal swell that rises into the moment songs change,
    // landing on a low timpani hit.
    function swell(at, length) {
        const start = Math.max(ctx.currentTime, at - length);
        const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
        f.type = "bandpass";
        f.Q.value = 0.8;
        f.frequency.setValueAtTime(800, start);
        f.frequency.exponentialRampToValueAtTime(6000, at);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(0.12, at);
        g.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
        src.connect(f);
        f.connect(g);
        g.connect(musicBus);
        g.connect(reverb);
        src.start(start);
        src.stop(at + 0.3);
        drum(musicBus, at, "T", 0.8);
    }

    // Switch songs. Mid-page this waits for the bar line and crossfades.
    // `name` is a slot ("lobby", "chapter2", "boss") or a track id ("gunpowder").
    // Two slots that use the same track carry on without restarting.
    function playSong(name, fromPass = null) {
        const r = resolve(name);
        if (!r || !init()) return;
        const files = config.files || {};
        const file = files[r.slot] || files[name];
        const key = file ? "file:" + r.slot : r.track;
        if (current && current.name === key && fromPass === null) return;
        if (file) {
            if (current && current.bus) stopPlayer(current, ctx.currentTime, 1.5);
            playFile(key, file);
            remember();
            return;
        }
        name = r.track;
        if (fileMusic) {
            const old = fileMusic;
            fadeElement(old, 0, 1500, () => old.pause());
            fileMusic = null;
        }
        if (current && current.bus) {
            const at = nextBar(current);
            stopPlayer(current, at, 2.0);
            swell(at, Math.min(1.2, at - ctx.currentTime));
            current = startPlayer(name, at, fromPass === null ? 0 : passStart(name, fromPass), 0.8);
        } else if (fromPass !== null) {
            current = startPlayer(name, ctx.currentTime + 0.1, passStart(name, fromPass), 0.5);
        } else {
            current = resumeOrBridge(name);
        }
        remember();
    }

    // First song on a page: carry on seamlessly if the last page was playing
    // the same song, otherwise play a short bridge into the new one.
    const passStart = (name, i) => (getSong(name).passes[i] || { start: 0 }).start;

    function resumeOrBridge(name) {
        const song = getSong(name);
        const loopDur = song.length * song.stepDur;
        let saved = null;
        try { saved = JSON.parse(sessionStorage.getItem("blocked-song") || "null"); } catch (e) { /* storage blocked */ }
        const recent = saved && Date.now() - (saved.leftAt || 0) < 15000;
        if (saved && saved.name === name && saved.started) {
            const pos = ((Date.now() - saved.started) / 1000) % loopDur;
            const step = ((Math.ceil(pos / song.stepDur) % song.length) + song.length) % song.length;
            return startPlayer(name, ctx.currentTime + 0.05, step, recent ? 0.35 : 1.5);
        }
        if (recent) {
            const at = ctx.currentTime + 0.7;
            swell(at, 0.7);
            return startPlayer(name, at, 0, 0.5);
        }
        return startPlayer(name, ctx.currentTime + 0.1, 0, 2.0);
    }

    function remember(leaving = false) {
        try {
            const data = { name: current ? current.name : null, leftAt: leaving ? Date.now() : 0 };
            if (current && current.started) data.started = current.started;
            if (fileMusic) data.position = fileMusic.currentTime;
            sessionStorage.setItem("blocked-song", JSON.stringify(data));
        } catch (e) { /* storage blocked */ }
    }

    function fadeElement(el, to, ms, done) {
        const from = el.volume, start = performance.now();
        const tick = () => {
            const k = Math.min(1, (performance.now() - start) / ms);
            el.volume = from + (to - from) * k;
            if (k < 1) requestAnimationFrame(tick); else if (done) done();
        };
        tick();
    }

    function playFile(name, url) {
        const el = new Audio(url);
        el.loop = true;
        el.volume = 0;
        try {
            const saved = JSON.parse(sessionStorage.getItem("blocked-song") || "null");
            if (saved && saved.name === name && saved.position) el.currentTime = saved.position;
        } catch (e) { /* storage blocked */ }
        if (fileMusic) {
            const old = fileMusic;
            fadeElement(old, 0, 1500, () => old.pause());
        }
        fileMusic = el;
        current = { name };
        el.play().catch(() => {});
        fadeElement(el, settings.muted ? 0 : settings.music * 0.6, 1200);
    }

    // Fade the music out, then go to a new page (or submit a form).
    function leave(go) {
        if (!ctx || !current || settings.muted) { go(); return; }
        if (current.bus) {
            current.bus.gain.cancelScheduledValues(ctx.currentTime);
            current.bus.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.08);
        }
        if (fileMusic) fadeElement(fileMusic, 0, 300);
        remember(true);
        setTimeout(go, 320);
    }

    // Links and forms on the site fade the music out before the page changes.
    document.addEventListener("click", e => {
        const a = e.target.closest && e.target.closest("a[href]");
        if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (a.target && a.target !== "_self") return;
        const url = new URL(a.href, location.href);
        if (url.origin !== location.origin || (url.pathname === location.pathname && url.hash)) return;
        if (!current) return;
        e.preventDefault();
        leave(() => { location.href = a.href; });
    });
    document.addEventListener("submit", e => {
        const form = e.target;
        if (e.defaultPrevented || !current || form.dataset.leaving) return;
        e.preventDefault();
        form.dataset.leaving = "1";
        leave(() => form.submit());
    });
    global.addEventListener("pagehide", () => { if (current) remember(true); });

    // ========== Public API ==========
    let wanted = null;   // the song to start once the browser lets us make sound
    let unlocked = false;

    function unlock() {
        if (unlocked || !init()) return;
        unlocked = true;
        if (ctx.state === "suspended") ctx.resume();
        if (wanted) playSong(wanted);
    }
    // Browsers usually only allow sound after you click or press a key on the
    // page. Sites you visit a lot are often allowed straight away, so try that
    // first; otherwise the music starts on your first click or key press.
    function tryAutoStart() {
        if (unlocked || !init()) return;
        const go = () => {
            if (ctx.state !== "running" || unlocked) return;
            unlocked = true;
            if (wanted) playSong(wanted);
        };
        if (ctx.state === "running") go();
        else ctx.resume().then(go).catch(() => {});
    }

    ["pointerdown", "keydown", "touchstart"].forEach(ev =>
        global.addEventListener(ev, unlock, { capture: true, passive: true }));

    let lastPlayed = {};
    const Sound = {
        play(name) {
            if (!unlocked || !SFX[name] || settings.muted || settings.sfx === 0) return;
            // Don't stack the same sound many times in one instant.
            const now = performance.now();
            if (lastPlayed[name] && now - lastPlayed[name] < 30) return;
            lastPlayed[name] = now;
            SFX[name]();
        },
        // Play a slot ("chapter2") or track ("pressure"). Pages may pass options
        // such as { room }; the music doesn't change with them.
        music(name) {
            wanted = name;
            if (unlocked) playSong(name);
            else tryAutoStart();
        },
        // Sound test: jump straight to one pass of a long track's cycle (0 = the start).
        audition(track, pass = 0) {
            wanted = track;
            if (!unlocked) unlock();
            playSong(track, pass);
        },
        get settings() { return { ...settings }; },
        set(key, value) {
            settings[key] = value;
            save();
            applyVolumes();
            // Switching long/short chapter music crossfades to the other version now.
            if (key === "longMusic" && wanted && unlocked) playSong(wanted);
        },
        // Go to another page with the music fading out first.
        go(url) { leave(() => { location.href = url; }); },
        // Let sound start (called by the framed page on a click or key press).
        unlock,
        toggleMute() {
            Sound.set("muted", !settings.muted);
            return settings.muted;
        },
        // Loudest sample in the last few milliseconds of output (0 to 1+), for testing.
        peak() {
            if (!meter) return 0;
            const buf = new Float32Array(meter.fftSize);
            meter.getFloatTimeDomainData(buf);
            return buf.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
        },
        // Fade the music out (the sound test page's stop button).
        stopMusic() {
            wanted = null;
            if (!ctx || !current) return;
            if (current.bus) stopPlayer(current, ctx.currentTime, 0.8);
            if (fileMusic) {
                const old = fileMusic;
                fadeElement(old, 0, 800, () => old.pause());
                fileMusic = null;
            }
            current = null;
            remember();
        },
        // Which track a slot (or old name) plays, e.g. resolve("chapter4") -> "gunpowder".
        resolve(name) { const r = resolve(name); return r ? r.track : null; },
        // Try another track in a slot in this browser only (null puts PLAYLIST back).
        preview(slot, track) {
            if (track && track !== PLAYLIST[slot]) preview[slot] = track; else delete preview[slot];
            try { localStorage.setItem("blocked-playlist-preview", JSON.stringify(preview)); } catch (e) { /* storage blocked */ }
        },
        get previews() { return { ...preview }; },
        get playing() { return current ? current.name : null; },
        // Where the current player is: step, which pass of the cycle (and its name).
        // `started` stays the same while a track keeps playing.
        get position() {
            if (!current || !current.bus) return null;
            const pass = passAt(current.song, current.step);
            return { name: current.name, step: current.step, started: current.started, pass: current.song.passes.indexOf(pass), passName: pass.name };
        },
        // The pass order of each long track, e.g. { "sea-legs": ["normal", "normal", "changeup", ...] }.
        cycles: Object.fromEntries(Object.entries(SONGS).filter(([, s]) => s.cycle).map(([id, s]) => [id, [...s.cycle]])),
        names: Object.keys(SFX),
        songs: Object.keys(SONGS),
        tracks: Object.entries(SONGS).map(([id, s]) => ({ id, title: s.title, mood: s.mood, group: s.group, bpm: s.bpm, stepsPerBeat: s.stepsPerBeat, barSteps: s.barSteps })),
        playlist: { ...PLAYLIST },
        slots: Object.keys(PLAYLIST),
    };
    global.BlockedSound = Sound;
})(window);
