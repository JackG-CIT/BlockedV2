# Morning report

Nothing is committed or pushed. Every change is in the working tree for you to review.

Database backups made before anything touched `blocked.db`:
- `blocked.backup-20261024-030044.db` (before the first ratings)
- `blocked.backup-20261024-035731.db` (right before the 30-level seed)

## Part 1: What was in flight

**Done.**

**The 30-level voyage is in `seed_levels.py` and seeded into `blocked.db`.** The seed added 10 levels and refreshed 20. All 106 completion records were kept: none of the original 20 changed layout, so none lost their times.

| Chapter | Levels (the 5th is the chapter test) |
| --- | --- |
| 1 Sea Legs | Shore Leave, Heave Ho, Wedged, One at a Time, **Stowaway Shuffle** (new) |
| 2 Pressure | Stomp, Dead Weight, Two Locks, Hold the Door, **Seven Seals** (your Level 6) |
| 3 Locks and Keys | **Squeeze Play** (new, teaches the squeeze), **Tangled Rigging** (your Level 5), Cargo Hold, **Nine Locks** (your Level 7), **Pinch Point** (your Level 9) |
| 4 Gunpowder | Fire in the Hole, Load and Light, Clear the Way, Powder Keg, Broadside |
| 5 Crossfire | Open Fire, Run the Gauntlet, Powder Monkey, Crossfire, **Powder Room** (your Level 11) |
| 6 Davy Jones' Locker | The Brig, Davy Jones' Locker, **Hair Trigger** (new, loaded fuse), **The Long Shot** (new boss), **The Last Broadside** (your Level 12, rebuilt) |

**Every level's stored solution replays to a win under the exact rules.** Par is shown where it's proven shortest. Where it isn't (Nine Locks, Pinch Point, Powder Room, The Long Shot, The Last Broadside), the stored route is the best one found, and hints follow it.

**Music, Phase 3:** done by the music helper.
- The six chapter tracks are now 2 to 3½ minutes long. Each has an intro, A, B, a new bridge, a build-up and a tag.
- They build up room by room. Room 1 is sparse (fiddle, pluck, light drums), and room 4 is the full band. A room change adds or removes layers on the next bar line and never restarts the song.
- The /sounds page has Room 1–4 preview buttons.
- Every bar checks out, and full-band peaks are 0.42–0.50.

**Line-up check (`flask --app app check-flow --verify`):** 2 mismatches, not applied. These need your decision; see below.

**Chapter 1 played end to end in headless Edge, on a copy of the database with a fresh player:**

| Room | Music | Exit | Skulls and par | Win screen |
| --- | --- | --- | --- | --- |
| 1–4 | Sea Legs, never restarted (same song start time), layers building 1 → 4 | glowing trapdoor | shown | tally |
| 5 | switched to Eye of the Storm | chest | shown | full popup |

Completions saved once per room, and there were zero page errors. All 34 site pages load with the new voyage.

## Part 2: Two versions of the game

**Done.**

- **Build:** `flask --app app export-standalone` writes `dist/standalone/` and `dist/blocked-standalone.zip` (**101 KB zipped**).
- **No network at all:** the pixel font is bundled under the OFL licence.
- **Shared code:** `engine.js`, `solver.js`, `audio.js`, `hints.js`, `editor.js`, `soundmenu.js`, the sprites, `style.css`, and the editor and sound-menu markup are the same files the website uses. Only the glue is new: `templates/standalone.html` and `static/standalone/standalone.js`.
- **Hints on every level:** each level ships its solution, and hints follow it when you're on that route. Off the route they fall back to the live solver. This also improved the **website**: its hints now work on the big levels too.
- **Portal hooks:** placeholder no-ops in `static/standalone/portal.js`: `gameStart`, `levelStart`, `levelComplete`, `levelRestart`, `breakTime` (between chapters), and `pauseGame`/`resumeGame`.
- **Tested in headless Edge from a local static server:**
  - The first-play tutorial showed.
  - Chapter 1 played through: trapdoors and tally, then the chest and popup.
  - Progress survived a reload ("5 of 30 rooms cleared").
  - The hint on the 456-move Powder Room followed its route.
  - Editor import, edit, save and play all worked.
  - No sideways scrolling at phone width.
  - **Zero requests outside the folder, zero page errors.**
- **README:** has a "Two versions of the game" section.

Also done: the design tools now live in `tools/` (with `tools/README.md`), so they won't vanish with the scratchpad.

## Part 3: Hard levels

**12 hard levels**, in `tools/hard_levels.py`, ranked best first. They're not in the voyage.

**Where to play them:**
- **On the site:** they're loaded as unpublished drafts in a **copy** of the database, `blocked.drafts.db`. Run `$env:SQLITE_PATH = "blocked.drafts.db"; .venv\Scripts\python app.py` and they show under your drafts, ready for the editor.
- **In the standalone build:** `tools/hard_levels_import.txt` has one line per level for its "Import a level" button.
- **In the voyage:** each entry also drops straight into `seed_levels.py`.

| Rank | Name | Moves (shortest) | Skulls | Board | Mechanics | The key idea |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **The Chimney** | 386 | 4 | 8x10 | plates, cannons, squeeze | Four shots up the chimney above the cannon, and each crate goes the long way. Two plates in the lower left work two gates: one lets you into the fuse's corner, the other slams on a crate and squeezes it onto the square beside the gun. Roll it under the cannon, then walk back to the fuse. Three crates share two plates, so you're forever swapping which crate holds which door. |
| 2 | **Backfire** | 336 | 3.5 | 10x9 | plates, cannons, squeeze | The cannon fires left, away from the rest of the ship. Two gates in the bottom room are conveyors: let them slam on crates to lift them up the narrow middle column to the gun. Then blast the row open, three walls deep, to the treasure. |
| 3 | **Down the Hatch** | 356 | 3.5 | 11x9 | plates, cannons, squeeze | Shoot straight down the right-hand column, four walls deep, to the treasure. The only way to load the gun is to let the column's side gate slam on a crate and squeeze it in. That gate's plate is up top, beside the crate that has to keep the bottom-left door open. |
| 4 | **Conveyor** | 321 | 3.5 | 11x8 | plates, squeeze | The lower-right gate is a conveyor. Hold its plate, park a crate in the doorway, let go, and the slam throws the crate up into the right-hand room, one square further each time as earlier crates fill the nearer squares. Three crates later, the last one can reach the plate that opens the way out. |
| 5 | **Four Bells** | 258 | 3.5 | 12x7 | plates, cannons | The cannon fires right along the row, straight into a gate, so every shot needs a crate holding the plate below. Three shots, three walls. The plate up top opens the side door you need to bring the crates round. |
| 6 | **Relay** | 320 | 3.5 | 13x8 | plates, squeeze | One gate slams on a crate and squeezes it straight back onto its own plate, and that's how crates get recycled. Ferry them round until the two stacked plates in the middle hold both right-hand gates at once. The last one opens the door by the treasure. |
| 7 | **Pinch and Tuck** | 218 | 3.5 | 10x10 | plates, squeeze | The same gate squeezes crates to two places: first into the dead-end square above it, then, with that square filled, onto the plate beside it. What lands where depends on what's already blocking the nearer squares. |
| 8 | **Back to Back** | 247 | 3.5 | 13x8 | cannons | Two cannons face each other across the top row. Park a crate on the far fuse so the left-facing gun fires on every move, then feed it crates to blast the top row open wall by wall, all the way through the outer wall to the treasure. |
| 9 | **The Long Way Round** | 296 | 3.5 | 11x9 | plates, cannons, squeeze | Only three crates for three jobs that keep overlapping: one opens the start gate (which squeezes crates into the middle room), one feeds the corner cannon to dig a shaft up the right side, and one must end on the plate that opens the top door. Get the order wrong and the crate you need is buried. |
| 10 | **Long Haul** | 260 | 3.5 | 14x9 | cannons | Three crates, three walls on the cannon's row. Each crate has to be walked through the whole twisting hold to reach the cannon's mouth without blocking the route for the next one. |
| 11 | **Through the Gates** | 179 | 3.5 | 11x8 | plates, cannons | The cannon's line of fire runs through two gates. Every shot needs both held open by crates on plates, and one shot has to destroy a crate you can't push out of the line any other way. |
| 12 | **Crossed Lines** | 204 | 3 | 14x8 | plates, squeeze | Ferry three crates through one gate by letting it slam on each in turn, then cross-wire the far end: each of the last two plates opens the gate beside the other, so both crates have to arrive before either door helps. |

**How they were made and checked:**
- **Evolved:** a parallel evolver (`tools/jsolve/Evolve.java`, 20 threads, 2.5 hours, 1,153 climbs) grew small boards one change at a time. It kept a change only when it scored harder with `rating.py`'s formula and was still solvable by an exact search under the game's rules. It also tested every piece for necessity whenever a level looked like a new best.
- **Refined:** the best 24 got another 75 minutes of climbing (`Refine.java`), and the 12 finalists a further hour, which improved 7 of them.
- **Strict check** (`tools/hard.py`, Python, exact), which every one of the 12 passed:
  - The move count is the **proven shortest solution**, and the full replay wins.
  - **Every piece is needed:** removing any single crate makes the level unsolvable, and so does walling up any gate or turning any cannon into a wall.
  - Levels that squeeze are unsolvable under the old "gates jam open" rule, so the squeeze is needed.
  - Floor the solution never touches was turned into wall where that didn't change the puzzle.
- **Engine check:** all 12, plus the 30 voyage levels, play correctly in the real browser engine move for move. Hints agree at 106 checkpoints.

**Ratings:** one level reaches 4 skulls, ten sit at 3.5 and one at 3. They take 179–386 moves on boards no bigger than 13×9. The scale was deliberately left with room above your current hardest level, Powder Room, at about 4. When you recalibrate (`EASIEST`/`HARDEST` in `rating.py`), they'll move up alongside your new levels.

**Caveat:** the evolver designs to a score, not a theme, so some boards look a bit irregular (for example a deck cannon standing in the middle of a room). The puzzles are sound, but a few may want a cosmetic tidy before they ship.

## Needs your ear
- **The new music:** the six new bridge melodies, the generated build-ups and tags, and the second-fiddle harmony. These may sound plain or clash in places.
- **Room 3 to room 4:** horns and big drums come in together, so it's the biggest step up. Gunpowder's rooms 1–3 are noticeably quieter than its room 4.
- **Locks and Keys** loops at 1:54, just under 2 minutes.

## Needs your decision
- **Squeeze Play → Tangled Rigging:** Squeeze Play exits on the bottom, but Tangled Rigging starts nearest its left. Rotating Tangled Rigging clockwise fixes this pair (re-verified, still 74 moves) but breaks the next one. Moving the pirate's start tile may be simpler.
- **The Long Shot → The Last Broadside:** The Long Shot exits on the right, but The Last Broadside starts nearest its top or bottom. Four rotations would fix it, but that level is too big to re-verify here. Moving the pirate start would be easier.
- **Rooms that end at a trapdoor:** most rooms keep their exit inside the room. That's fine (trapdoors don't need to line up), but if you want doors everywhere, those rooms need their exit moved to a wall.
- **The Long Shot** is 97 moves, a little under the 100–250 asked for. Its squeeze proof rests on map reasoning: both pockets are walled in on every side, so a crate can only get there by squeeze. A full "no squeeze" search was too big to finish.
- **Stowaway Shuffle** was found by computer search, then cleaned up by hand. Worth a play-test for feel.

## Defaults I chose (change any of them)
- **Placeholder names:** new levels got placeholder names and one-line notes in the pirate voice (Stowaway Shuffle, Squeeze Play, Hair Trigger, The Long Shot, the names for your levels, and the 12 hard ones). They're easy to rewrite when you add the story. Each level can also take an optional `'transition'` line, which shows on the room tally.
- **Hard levels:** kept out of the voyage, as you asked. They're drafts in `blocked.drafts.db` only, never in the live database.
- **Standalone voyage:** the standalone build uses the same 30-level voyage, read from `seed_levels.py` when you export.
- **Standalone levels:** player-made levels there keep no best times (only voyage rooms do).
- **Portal break:** `breakTime` is called between chapters and when going back to the level list.
- **Ratings:** `flask --app app rate all` keeps a level's existing rating when that level is too big for the in-app solver, instead of overwriting it with "5 skulls (unknown)".

## What fell short or was skipped
- **Hard-level ratings:** 11 of the 12 reached 3.5–4 skulls, and Crossed Lines sits at 3. The scale has deliberate headroom for your harder levels (see Part 3).
- **The Long Shot:** 97 moves, just under the 100–250 asked for.
- **Line-up mismatches:** the two `check-flow` mismatches are reported, not applied, as you asked.
- **Website font:** the site itself still loads its pixel font from Google Fonts. Only the standalone build bundles it. Pointing the site at the bundled copy too would be a two-line change, if you want no outside requests anywhere.
- **Test note:** my first end-to-end chapter test read a stale frame address from Playwright and failed. The game was fine (checked by hand). The fixed test is `tools/tests/chapter_test.py`.

## Files that changed (all uncommitted)
- **Rules, kept in sync** (unchanged tonight apart from the stored-route support in `solver.js`):
  - `static/js/engine.js`
  - `static/js/solver.js`
  - `solver.py`
- **Website:**
  - `app.py`: chapters, room flow, music slots, the shell, ratings, check-flow, export-standalone
  - `db.py`: new columns, added automatically to older databases
  - `templates/`: the play, index, base and editor pages, plus the new `shell.html`, `standalone.html`, `_editor.html` and `_sound_menu.html`
  - `static/js/play.js`
  - `static/js/hints.js`: new, shared
  - `static/js/soundmenu.js`: new, shared
  - `static/js/editor.js`: can now be started and stopped
  - `static/css/style.css`
- **Music:**
  - `static/js/audio.js`
  - `templates/sounds.html`
- **Levels:**
  - `seed_levels.py`: the 30-level voyage, with ratings, par and solutions
- **New files:**
  - `rating.py`
  - `flow.py`
  - `export_standalone.py`
  - `static/standalone/`
  - `static/fonts/`
  - `static/img/door.svg`, `hatch.svg`, `skull.svg` (drawn by `art/make_sprites.py`)
  - `tools/`
- **Not in git** (added to `.gitignore`):
  - `dist/`
  - the `blocked.backup-*.db` files
  - `blocked.drafts.db`
