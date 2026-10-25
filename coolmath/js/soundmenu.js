// The speaker button's volume panel, the M mute key, and UI click sounds.
// Shared by the website (base.html) and the standalone build.
(function () {
    const S = window.BlockedSound;
    const panel = document.getElementById("soundPanel");
    const toggle = document.getElementById("soundToggle");
    if (!S || !panel || !toggle) return;
    const music = document.getElementById("musicVol"), sfx = document.getElementById("sfxVol"), mute = document.getElementById("muteAll");
    const longMusic = document.getElementById("longMusic");
    // Story cutscenes on or off (story.js reads the same key). Kept in the browser.
    const scenes = document.getElementById("storyScenes");
    const SCENES_KEY = "blocked-scenes";
    // Level skip keys (for testing): = and - on a level jump forwards and backwards (play.js, standalone.js).
    const skipKeys = document.getElementById("skipKeys");
    const SKIP_KEY = "blocked-skipkeys";
    const skipOn = () => { try { return localStorage.getItem(SKIP_KEY) === "on"; } catch (e) { return false; } };
    const scenesOn = () => { try { return localStorage.getItem(SCENES_KEY) !== "off"; } catch (e) { return true; } };
    function sync() {
        const s = S.settings;
        music.value = s.music;
        sfx.value = s.sfx;
        mute.checked = s.muted;
        if (longMusic) longMusic.checked = s.longMusic !== false;
        if (scenes) scenes.checked = scenesOn();
        if (skipKeys) skipKeys.checked = skipOn();
        toggle.classList.toggle("muted", s.muted);
    }
    sync();
    toggle.addEventListener("click", e => {
        e.stopPropagation();
        panel.classList.toggle("hidden");
        toggle.setAttribute("aria-expanded", String(!panel.classList.contains("hidden")));
    });
    document.addEventListener("click", e => {
        if (!panel.contains(e.target) && e.target !== toggle) panel.classList.add("hidden");
    });
    music.addEventListener("input", () => S.set("music", parseFloat(music.value)));
    sfx.addEventListener("input", () => S.set("sfx", parseFloat(sfx.value)));
    sfx.addEventListener("change", () => S.play("push"));
    mute.addEventListener("change", () => { S.set("muted", mute.checked); sync(); });
    // Long, layered chapter tracks, or the short loops. Takes effect straight away.
    if (longMusic) longMusic.addEventListener("change", () => { S.set("longMusic", longMusic.checked); sync(); });
    if (skipKeys) skipKeys.addEventListener("change", () => {
        try { localStorage.setItem(SKIP_KEY, skipKeys.checked ? "on" : "off"); } catch (e) { /* storage blocked */ }
    });
    if (scenes) scenes.addEventListener("change", () => {
        try { localStorage.setItem(SCENES_KEY, scenes.checked ? "on" : "off"); } catch (e) { /* storage blocked */ }
    });
    document.addEventListener("keydown", e => {
        const t = e.target;
        if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
        if ((e.key === "m" || e.key === "M") && !e.ctrlKey && !e.metaKey) { S.toggleMute(); sync(); }
    });
    document.addEventListener("click", e => {
        if (e.target.closest(".btn, .navlink, .tool")) S.play("click");
    }, true);
})();
