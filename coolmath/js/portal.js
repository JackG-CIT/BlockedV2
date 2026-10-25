// =====================================================================
//  PORTAL HOOKS: Coolmath Games. `flask --app app export-standalone --coolmath`
//  ships this file as js/portal.js in place of the empty placeholders.
//
//  Coolmath's page around the game's iframe defines cmgGameEvent (and, for
//  ads, cmgAdBreak). The game tells it:
//      cmgGameEvent("start")            once, when the game has loaded
//      cmgGameEvent("start", "7")       when voyage level 7 starts
//      cmgGameEvent("replay", "7")      when the player restarts level 7
//  and asks for an ad between chapters and after the ending.
//
//  These names come from a community SDK, not from Coolmath. Coolmath sends
//  its own SDK once it licenses a game: check these calls against it then.
//  Every call is guarded, so the build also runs anywhere else, doing nothing.
//
//  unlockAllLevels() opens every level, for Coolmath's reviewers.
// =====================================================================
(function (global) {
    "use strict";
    // Coolmath's functions live on the page around the game (parent), or on this page.
    function cmg(name) {
        for (const host of [global.parent, global]) {
            try {
                if (host && typeof host[name] === "function") return host[name].bind(host);
            } catch (e) { /* a parent on another origin we can't read */ }
        }
        return null;
    }
    function event(type, level) {
        const send = cmg("cmgGameEvent");
        if (!send) return;
        try { level == null ? send(type) : send(type, String(level)); } catch (e) { /* never let the portal break the game */ }
    }

    const BlockedPortal = {
        gameStart() { event("start"); },
        levelStart(level) { if (level.number != null) event("start", level.number); },
        levelComplete(level, result) {},
        levelRestart(level) { if (level.number != null) event("replay", level.number); },
        breakTime(done) {
            const ad = cmg("cmgAdBreak");
            if (ad) { try { ad(); } catch (e) { /* no ad this time */ } }
            done();
        },

        // ---- called by the portal, not the game ----
        pauseGame() {
            const S = global.BlockedSound;
            if (!S || paused) return;
            paused = true;
            wasMuted = S.settings.muted;
            S.set("muted", true);
        },
        resumeGame() {
            const S = global.BlockedSound;
            if (!S || !paused) return;
            paused = false;
            S.set("muted", wasMuted);
        },
    };
    let paused = false, wasMuted = false;
    global.BlockedPortal = BlockedPortal;
    global.unlockAllLevels = () => { if (global.BlockedStandalone) global.BlockedStandalone.unlockAll(); };
})(window);
