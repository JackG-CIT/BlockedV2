# Blocked

A pixel-art pirate puzzle game. Push crates, weigh down pressure plates, light fuses and fire cannons to reach the treasure in as few moves as you can.

Players make an account, sail through the **Voyage** (the main levels, which unlock one at a time), set best times on each level's leaderboard, and build their own levels for the **Crew Waters** section.

## Running it on your computer

You need Python 3.10 or newer.

```powershell
cd BlockedV2
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env      # then put a random SECRET_KEY in .env
python app.py
```

Open http://127.0.0.1:5000 and click **Join the crew**. **The first account you register becomes the captain (admin).** Only the captain can put levels in the Voyage and change their order.

To load the main voyage (see `seed_levels.py`):

```powershell
flask --app app seed
```

The voyage is 30 levels in six chapters of five. Each chapter brings in a new idea, and its fifth level is a harder chapter test that plays the boss music. The home page groups the levels by chapter, and chapter titles live in `CHAPTERS` at the bottom of `seed_levels.py`.

Story text: give a level an optional `'transition'` line in `seed_levels.py` and it shows on the tally as the player walks on to the next room.

**Do the rooms line up?** `flask --app app check-flow` reports where a room's exit side doesn't face the next room's entrance side. The exit side is the wall the chest sits on, and the entrance side is the wall nearest the pirate's start. It also lists rooms whose chest sits inside the room. For each mismatch it suggests a mirror or rotation that would fix it. Add `--verify` to re-solve each suggestion, because turning a level changes how the squeeze plays out (it scans from the top-right). Nothing is changed automatically. The editor's Checks box gives the same warnings for voyage rooms as you edit.

After changing `seed_levels.py`, run `flask --app app seed --refresh`. That updates levels already in the database and puts the voyage back in the file's order. A level whose layout changed loses its old times. Seed levels are matched by name, so if you rename one, list its old name under `'was'` in its entry.

To make someone else an admin, open **Crew** in the top bar (admins only) and click **Make captain**. You can also do it from the command line: `flask --app app make-admin THEIR_USERNAME`. Admins can edit or delete any level.

## Two versions of the game

**The community version** is this Flask site: accounts, leaderboards, Crew Waters (player levels), the online editor and the captain's admin tools. Run it as described above.

**The standalone version** is a folder of static files for web game portals (Coolmath Games and the like). It has no server, no accounts, and makes no network requests at all: even the font is bundled. Build it with:

```powershell
flask --app app export-standalone
```

That writes `dist/standalone/` (open `index.html` from any static web server) and `dist/blocked-standalone.zip`, which is about 100 KB. To try it locally: `python -m http.server -d dist/standalone 8000`, then open http://localhost:8000.

What the standalone version has:
- The voyage from `seed_levels.py`, chosen by chapter, with the same room-to-room flow, doors/trapdoors/chests, music, difficulty skulls and par.
- Progress, best moves and times, settings and volume saved in the browser (`localStorage`).
- Hints on every level. The export ships a known solution for each level, and hints follow it whenever the board is on that route, so even the biggest levels get hints. Off the route, the browser solver searches live.
- A first-play tutorial, and a one-line "how it works" popup the first time each mechanic appears (plates and gates, the squeeze, fuses and cannons, loaded fuses, doors). The "How to play" screen lists them all.
- A level editor with playtest. Players' levels stay in their browser and can be shared as a line of text (Export / Import a level).
- Keyboard, touch (swipe the board or use the arrow pad) and small screens.
- No leaderboards, accounts or Crew Waters.

Both versions share the same game code: `engine.js` (board and rules), `solver.js` and `hints.js` (hints), `audio.js` (music and sound), `editor.js`, `soundmenu.js`, the sprites and `style.css`, plus the shared editor and sound-menu markup in `templates/_editor.html` and `templates/_sound_menu.html`. A fix to any of them lands in both versions the next time you export. Only the glue differs. The site uses Flask pages; the standalone build uses `templates/standalone.html` (a single page whose screens switch in place, so the music never stops) and `static/standalone/standalone.js`.

**Portal hooks:** `static/standalone/portal.js` has placeholder (do-nothing) functions the game already calls at the right moments: `gameStart`, `levelStart`, `levelComplete`, `levelRestart`, and `breakTime` (between chapters, a natural spot for a portal's ad break). It also has `pauseGame`/`resumeGame` for a portal's SDK to call. To wire up a portal, fill these in and add the portal's script tag to `templates/standalone.html`.

## The database

The old school database (`drhscit.org`) doesn't accept connections any more, so there are two options:

**1. Local SQLite (the default, no setup).** If `DATABASE_URL` in `.env` is blank, everything is saved in `blocked.db` next to `app.py`. The tables are created automatically the first time you run the game. This is the easiest choice for building levels on one computer. Back up `blocked.db` to keep your levels.

**2. Free hosted Postgres on Neon.** Use this to share one database between computers or to put the game online.
1. Sign up at https://neon.tech (the free plan is plenty).
2. Create a project. On its dashboard, click **Connect** and copy the connection string. It looks like `postgresql://user:password@ep-xxxx.neon.tech/neondb?sslmode=require`.
3. Paste it into `.env` as `DATABASE_URL=...`, then restart the game. The tables are created automatically.

Supabase's free Postgres also works: use its "Session pooler" connection string the same way.

Your levels in a local `blocked.db` don't move to Neon automatically. Build in whichever one you plan to keep.

## Putting it online (optional)

[Render](https://render.com) can host it for free:
1. Use a Neon database (Render's free disk gets wiped, so SQLite won't last there).
2. On Render, create a **Web Service** from this GitHub repo.
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app`
3. Under **Environment**, add `SECRET_KEY` (any long random string) and `DATABASE_URL` (your Neon string).

## Playing

Arrow keys or WASD move, **Z** (or Backspace) undoes a move, **R** restarts, and **H** gives a hint. The first hint shows the next goal, like which crate goes on which plate. Press it again to see the exact next move. Undo takes moves off your count, but the timer keeps running.

Each chapter plays as one journey through the ship. Every room is still its own level, with its own best times, par, rating, hints, undo and restart, but clearing a mid-chapter room skips the win popup:
1. A quick tally shows your moves, your time, whether you matched par, and any new best. The level's optional transition line appears here too.
2. The screen fades to dark.
3. The next room fades in with the pirate stepping in from the nearest edge.

**Space** skips the wait, and **R** cancels it so you can stay and replay the room. The fifth (boss) room of each chapter, the last room of the voyage, and any cleared room replayed from the home page show the full "Treasure found!" popup. In that popup, **Space** (or Enter) goes on to the next room, and **Back to the chapter** returns to the home page. Players who prefer the popup every time can untick **Walk straight on to the next room** under the board. That choice is saved in the browser.

Rooms 1 to 4 of a chapter end at a **door** (when the exit tile is in the outer wall) or a **trapdoor** (when it's inside the room). Both pulse with a gold glow. The treasure chest is saved for each chapter's last room. It's the same Treasure tile in the editor, and the game picks the picture from the room's place in the chapter.

Leaving mid-chapter is fine: the home page's **Set sail** button picks up at the first room you haven't cleared.

Every level shows a difficulty from half a skull to five (Calm Seas, Choppy, Squall, Storm, Maelstrom), plus a **par**: the fewest moves possible, when the solver can prove it. `rating.py` works the rating out from the solver's analysis. A level is rated a few seconds after it's saved in the editor, and `flask --app app rate all` re-rates everything. To recalibrate the scale, change `EASIEST`/`HARDEST` at the top of `rating.py`.

The music never stops between pages. A page opened in the browser loads a small shell page (`templates/shell.html`) that plays the music and shows the site in a frame. Moving around only changes the frame, so songs carry on and crossfade when a page wants a different one.

The game never tells you on its own that you've boxed yourself in. Working that out is part of the puzzle. If you ask for a hint from a position where the treasure can't be reached any more, a **Stuck!** banner appears instead.

## Sound and music

All the music and sound effects are generated in the browser by [static/js/audio.js](static/js/audio.js). There are no audio files, so there's nothing to license.

### The tracks

Every track is original, written for Blocked in a pirate style: minor keys, galloping strings, horns, fiddle, accordion and big drums.

| Track id | Title | Feel |
| --- | --- | --- |
| `set-sail` | Set Sail | Grand pirate anthem in D minor (6/8): horns, gallop, accordion |
| `black-flag` | Under the Black Flag | Rollicking shanty in A minor (6/8): fiddle and accordion, horn answers |
| `captains-oath` | The Captain's Oath | Cinematic and heroic in G minor: horn theme, galloping strings, taiko |
| `sea-legs` | Sea Legs | Light, curious and jaunty in A dorian (6/8): fiddle, plucked strings |
| `pressure` | Pressure | Clockwork heist in E minor: ticking plucks, whirring strings, sneaky fiddle |
| `locks-keys` | Locks and Keys | Mysterious but adventurous in D minor (6/8): music-box bells, horn call |
| `gunpowder` | Gunpowder | Bold and martial in A minor: marching horns, snare rolls, taiko |
| `crossfire` | Crossfire | Urgent and stormy in G minor (6/8): rushing strings, racing fiddle |
| `davy-jones` | Davy Jones | Epic and dark-majestic in C minor: low horns, tolling bell, taiko |
| `sea-legs-boss` ... `davy-jones-boss` | (chapter) (boss) | Each chapter's tune, faster and grander, for its hardest level |
| `boss-storm` | Eye of the Storm | Fast and driving in E minor: pounding taiko, horn theme, fiddle charge |
| `boss-storm-v2` | Eye of the Storm II | A bigger boss version: taiko build, choir, low horn ostinato, soaring horns |
| `boss-kraken` | Kraken Rising | Heavy and epic in D phrygian (6/8): horn riff, huge taiko and anvil |
| `milestone` | Heroic Milestone | The old D major title theme, saved for a big milestone |
| `open-ocean` | Open Ocean | Slow, vast and majestic in C major: soaring strings and bells |
| `fair-winds` | Fair Winds | Bright, sunny fiddle jig in G major |

Each chapter track also has a short 16-bar version, `sea-legs-short` ... `davy-jones-short`. These play when "Long chapter music" is switched off in the sound menu.

### Which track plays where

Pages ask for a **slot**, and the `PLAYLIST` near the top of the music section in `audio.js` says which track fills it:

| Slot | Where | Track |
| --- | --- | --- |
| `lobby` | Title screen and menus | `set-sail` |
| `chapter1` ... `chapter6` | The levels of each chapter | `sea-legs`, `pressure`, `locks-keys`, `gunpowder`, `crossfire`, `davy-jones` |
| `boss1` ... `boss6` | The hardest (5th) level of each chapter | `sea-legs-boss` ... `davy-jones-boss` |
| `finale` | The voyage's final grand level(s) | `boss-storm` (Eye of the Storm) |
| `milestone` | A big milestone (not used yet) | `milestone` |

Eye of the Storm II (`boss-storm-v2`) and Kraken Rising aren't in a slot. Try them in one with "Try a track in a slot" on **/sounds**. Older names still work: `boss` and `deep` mean `finale`, and `voyage` means `chapter1`.

Songs change on a bar line with a crossfade. Between pages, the music fades out, then either picks up where it left off (same track, even if it's in a different slot) or plays a short cymbal-swell bridge into the new one. Pages can pass the room number, but the music ignores it: a chapter's track simply keeps playing from room to room.

- The speaker button in the top bar has music and effects volume, mute, and the "Long chapter music" switch. **M** mutes from anywhere.
- **/sounds** is the sound test page. It plays every track (grouped into Title, Chapters, Short chapter loops, Chapter boss levels, Boss and finale, and Extras) and shows which slot each one fills. It shows each long track's cycle with buttons to jump to its variations, has a stop button, and plays every sound effect.
- To use real recordings instead, put a file named after the slot (`lobby.mp3`, `chapter1.mp3`, `boss1.mp3`, `finale.mp3` ...) in `static/audio/`. It replaces the generated music for that slot automatically. Only use files you have the rights to, especially if you submit the game somewhere like Cool Math Games.

### Loops and variations

A long chapter track is its short 16-bar tune played over and over by the full band. Every few times round, it plays a **variation pass** instead, then goes back to normal. The variations are the same tune dressed differently:

- **change-up**: a second fiddle joins in (a harmony a third below, or doubling the horns), with drum fills into the second half and the next loop.
- **grand**: the horns double the tune, with big taiko and cymbals and a deep bass.
- **breakdown**: just the fiddle, a plucked bass and light drums, then a snare fill brings the band back.

| Track | One loop | Cycle (then it starts again) | Whole cycle |
| --- | --- | --- | --- |
| Sea Legs | 27 s | normal, normal, change-up, normal, normal, grand, normal, breakdown | 3:33 |
| Pressure | 31 s | same order | 4:07 |
| Locks and Keys | 24 s | same order | 3:12 |
| Gunpowder | 34 s | same order | 4:34 |
| Crossfire | 25 s | same order | 3:22 |
| Davy Jones | 48 s | normal, change-up, normal, grand, normal, breakdown | 4:48 |

The chapter boss tracks work the same way. They use the chapter's loop at a faster tempo with the full band, horns on the tune, driving taiko and rushing strings, and every third time round a second fiddle joins in.

### How to tweak the music

You don't need to read music for any of this. Open `static/js/audio.js`, change something, save, and refresh the page (the **/sounds** page is the quickest place to listen).

**Swap a track into a slot.** Find `const PLAYLIST` and change the track id on the right. For example, to try Eye of the Storm II on the final levels:

```js
finale: "boss-storm-v2",
```

To try it without editing code first, use "Try a track in a slot" on **/sounds**. That only changes your browser, and "Back to PLAYLIST" undoes it.

**Change how often the variations come.** Each long track has a `cycle` line, for example:

```js
cycle: ["normal", "normal", "changeup", "normal", "normal", "grand", "normal", "breakdown"],
```

Each word is one time round the loop, in order, and then the cycle starts again. Add more `"normal"`s to make the variations rarer, move them around, or leave one out. Each variation is listed under `variations`:

- `volume` is that pass's level (below 1 is softer, above 1 louder).
- `mute` lists parts that sit out that time.
- `channels` lists parts it replaces or adds.

The normal loop itself is the `-short` track named in `loop:`, so changing a note in `pressure-short` changes it in the long track too.

**How the note lists work.** Each track (in `const SONGS`) has one list per instrument, and each string in the list is one bar:

- `"D4:4"` plays the note D in octave 4 for 4 steps. Higher numbers are higher octaves. `#` is sharp and `b` is flat, so `"F#4"` and `"Bb3"` work.
- `"r:2"` is a rest (silence) for 2 steps.
- `"D4+F4+A4:6"` is a chord: three notes at once.
- `lead2`, `brass2`, `drums2` and `ostinato2` are second parts for the same instrument (a second fiddle, the horns doubling the tune, the big drums, rushing strings).
- On the `drums` lines, letters are drums: `B` big taiko, `F` frame drum, `K` kick, `S`/`s` snare loud/soft, `H`/`h` hi-hat loud/soft, `J` tambourine, `A` anvil, `T` timpani, `C` cymbal crash.
- **Every bar has to add up to `barSteps`** (12 in the 6/8 tracks, 16 in the 4/4 ones). If you make one note longer, make another shorter.
- A shorter list (like a 4-bar drum loop) repeats to fill the song.

**Change the speed.** Change `bpm`. Bigger is faster, so `bpm: 112` to `bpm: 124` speeds a track up by about 10%. A long track and its boss version each have their own `bpm`.

**Change the key.** Move every note in a track by the same amount (for example every D becomes E, F becomes G, and so on). This is fiddly by hand, so it's a good one to ask Claude for.

**Make a track louder or quieter.** Each track has `volume: 1.0`. Try `0.8` to make it quieter or `1.2` to make it louder, so the tracks sit at the same level.

**Change an instrument's sound or volume.** The instruments are in `const INSTRUMENTS`, shared by every track: `strings`, `ostinato` (short bouncing strings), `brass` (horns), `lead` (fiddle), `cello`, `sub` (deep bass), `bell`, `squeeze` (accordion), `pizz` (plucked strings) and `choir`. Each `v:` number is a loudness. Making one smaller (say `0.06` to `0.04`) turns that instrument down in every track. To drop an instrument from just one track, delete its list from that track.

**Ask Claude.** You can describe what you want in plain words, for example:

- "Make chapter 4 faster with more drums."
- "The boss music is too busy, thin it out."
- "Make the grand pass in Pressure come every third loop."
- "Add a new variation to Sea Legs where the accordion takes the tune."
- "Write a new lobby track that sounds like a tavern sing-along and put it in the lobby slot."
- "Chapter 2 is too quiet next to the others."

It helps to say which track or slot you mean, what you like about it, and what bugs you.

## Building levels

Click **Build** in the top bar. The editor has tiles on the left, the board in the middle and settings on the right.

| Key | Tile | Notes |
| --- | --- | --- |
| 1 | Pirate | Where the player starts. There's only ever one. |
| 2 | Wall | Blocks everything. Cannon shots can smash walls. |
| 3 | Crate | Pushable, one at a time. |
| 4 | Pressure plate | After placing it, click the tile it controls. That tile becomes a **gate**. |
| 5 | Cannon | Click a cannon again to turn it. |
| 6 | Fuse | After placing it, click the cannon it fires. |
| 7 | Treasure | The exit. Reaching it clears the level. |
| 8 | Link | Re-link an existing plate or fuse. |
| 0 | Erase | Right-click also erases. |

- Click and drag to paint walls, crates or erase. **Esc** skips linking. **Ctrl+S** saves.
- Hover a tile to see what it is and what controls it. Gold dashed lines show plate links, orange lines show fuse links, and red lines are broken links.
- **Playtest** runs the level right in the editor. The **Checks** box lists anything that's missing or broken.
- Untick **Published** to keep a level as a private draft. A level needs a pirate and a treasure chest before it can be published.
- As captain, tick **Main voyage** and set **Voyage order** to place a level in the campaign (lower numbers come first).
- If you change a published level's layout, its old times are cleared, because they were set on a different puzzle. Renaming a level doesn't clear them.
- To check that a level can be beaten, run `flask --app app solve LEVEL_ID` (or `solve all`). It prints the fewest moves needed, a shortest solution, and how many crate pushes lead to a dead end. Big, open levels with lots of crates can take a while or hit the search limit.

### Exactly how the mechanics work

These are the original rules, plus the gate fixes and the squeeze. If you ever change them, change `static/js/engine.js`, `static/js/solver.js` and `solver.py` together:
- The pirate moves one tile per key press (arrows or WASD; R restarts). Walls, closed gates, cannons and the board edge block movement.
- Walking into a crate pushes it, unless something is behind it: a wall, gate, crate, cannon or the edge.
- **Pressure plate:** while the pirate or a crate stands on it, its gate is open. Otherwise the gate is shut. (A plate linked to a cannon does nothing.)
- **Gates:** you can't step into a gate, or push a crate into one, if that same move would shut it. So stepping off a plate straight into its own gate doesn't work. If several plates point at one gate, the last plate in reading order decides.
- **Squeeze:** when a gate shuts on a crate standing in the doorway, the crate is squeezed out to the nearest free square. The game checks square rings around the gate (radius 1, then 2, and so on). Each ring starts at its top-right corner and is read right to left, top to bottom. Free means a crate could be pushed there: plates, fuses, open gates and chests count, but walls, shut gates, crates, cannons and the pirate don't. Block the nearer squares and you can drop a crate into a pocket nobody can walk into. If the squeezed crate lands on a plate, the plates are checked again straight away.
- **Crushed:** if a gate shuts on the pirate, they're crushed and the level restarts.
- **Fuse:** whenever the pirate or a crate is on a fuse after a move, its cannon fires. If a crate sits directly in front of the cannon, it's shot forward until the next tile is a wall, gate, crate or the edge. Then the crate is destroyed. It also destroys a wall or crate it hits, but a shut gate just stops it.
- **Shots fly in real time:** a shot crate flies one tile every 50 ms, and you can keep moving while it's in the air.
  - **Plates react to every tile of the flight.** A gate shuts the moment its crate is shot off the plate, so a shot can be stopped by a gate it just closed. A crate flying over a plate holds it down for that instant.
  - **A crate in flight** can't be pushed, doesn't light fuses it passes, and isn't fired again.
  - **Several fuses lit by one move** fire one after another, each shot waiting for the one before to land.
  - **Walking into the line of fire** gets the pirate hit, and the level restarts.
  - **The solvers** (`solver.py`, `solver.js` and the tools) treat a shot the same way, tile by tile, and assume you wait for it to land. Waiting is always allowed, so every solution they find works in the game. Tricks that need you to move mid-flight are possible in play but invisible to the solver (hints, par, the level checks). A crate parked on a fuse keeps that cannon firing after every move, so any crate that lands in front of it is shot straight away.
- **Starting positions:** a crate or the pirate can start on top of a plate or fuse. In the editor, paint a crate (or the pirate) onto a plate or fuse. Erasing takes the top piece off first. A crate resting on a plate is drawn slightly see-through so you can tell the plate is held.
- Reaching a treasure chest wins.

## Project layout

```
app.py            Flask routes: accounts, levels, saving results, editor API, crew page
db.py             Database layer (SQLite by default, Postgres via DATABASE_URL)
rating.py         Difficulty (half skulls to five) and par, from the solver
flow.py           Checks each room's exit lines up with the next room's entrance (check-flow)
solver.py         Finds shortest solutions (used by `flask --app app solve`)
seed_levels.py    The 30 voyage levels for `flask --app app seed`
templates/        Pages (base, index, auth, play, editor, error, shell, standalone) and shared
                  partials (_editor.html, _sound_menu.html)
static/js/        engine.js (board + rules), play.js, editor.js, audio.js (all sound and music),
                  solver.js (in-browser copy of solver.py for hints), hints.js, soundmenu.js
static/standalone/ The standalone build's glue: standalone.js, portal.js, standalone.css
static/fonts/     The pixel font, bundled for the standalone build
static/css/       style.css
export_standalone.py  Builds the standalone version (flask --app app export-standalone)
tools/            Level design tools: fast solvers, the stage solver, voyage assembly (see tools/README.md)
static/img/       Pixel-art sprites (generated, don't edit by hand)
art/              make_sprites.py draws every sprite from text grids
```

To change the art, edit a grid or colour in `art/make_sprites.py` and run `python art/make_sprites.py`. It rewrites the SVGs in `static/img` and saves `art/preview.png` so you can check them.
