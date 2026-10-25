// =====================================================================
//  PORTAL HOOKS (placeholders). Every function here does nothing yet.
//
//  Web game portals (Coolmath Games and others) usually ask games to call
//  their SDK at certain moments: when the game starts, when a level starts
//  or ends, and around breaks where they may show an ad. The standalone
//  build calls these hooks at those moments, so wiring up a portal later only
//  means filling them in here (and adding the portal's own script tag to
//  templates/standalone.html). Nothing else in the game needs to change.
//
//  If a portal wants the game to pause (for an ad), call
//  BlockedPortal.pauseGame() / resumeGame() from its SDK callback; they mute
//  and unmute the music for you.
// =====================================================================
(function (global) {
    "use strict";
    const BlockedPortal = {
        // The game finished loading and the title screen is showing.
        gameStart() {},
        // The player started (or restarted from scratch) a level.
        // level: { id, name, chapter, room, number } (room 5 = chapter boss; 0 = a player-made level;
        // number = the voyage position counting from 1, null for a player-made level)
        levelStart(level) {},
        // The player cleared a level. result: { moves, ms, par, firstClear }
        levelComplete(level, result) {},
        // The player restarted the level they're on (R or the Restart button). level: { id, number }
        levelRestart(level) {},
        // A natural break (between chapters, back to the level list): portals often show ads here.
        // Call done() when the game may carry on (immediately, unless the portal shows something).
        breakTime(done) { done(); },

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
})(window);
