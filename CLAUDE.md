# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Promptholm: a 3D island (three.js, no build step) where every Claude Code / Cowork session
on this machine is a settler with a house. `scan.mjs` reads the session records already on
disk, `serve.mjs` serves the island and pushes updates, `web/` draws it. Windows, Node 22+,
no runtime dependency other than three.js.

## Plans

Grotere ontwerpen, vóór ze code worden, gaan in `Plans/` — write down the why and the
decisions there before touching code on anything bigger than a small fix, and keep it there
rather than in a throwaway chat. It is shared with Tiemen, so it is also how he sees what is
still in progress: `Plans/` holds only the plans that are open (🚧), `Plans/README.md` lists them.
A finished plan (✅ at the top) is moved to `Plans/DONE/` with `git mv`, and every reference to it
- `Plans/<name>.md` in code comments, tests and docs, and the relative links between plans - is
rewritten to `Plans/DONE/<name>.md` in the same change.

## Commands

```bash
npm install                        # also vendors three.js into web/vendor (postinstall)
npm run dev                        # serve on :4747 and open a browser
npm run serve                      # serve without opening
npm run scan                       # rebuild data/village.json once
npm run scan:all                   # ignore foundedAt, use every session ever; writes *.all.json
npm run models                     # bake every Blender set and check it (needs Blender)
npm run models -- props            # bake one set
npm run models:preview             # render assets/<set>/renders/<asset>.png
npm run app                        # build the islander, then run the window (tauri dev; needs Rust)
npm run app:build                  # promptholm-island.exe + promptholm.exe in src-tauri/target/release/
git tag v0.2.0 && git push origin v0.2.0   # release: .github/workflows/release.yml builds both exes on
                                   # windows-latest and attaches promptholm-windows-x64.zip; the tag must
                                   # equal "version" in src-tauri/tauri.conf.json or the job stops
```

Tests are `node:test` with no npm script. On Windows the shell does not expand the glob, so
quote it and let Node expand it:

```bash
node --test "tests/*.test.mjs"
```

```bash
node --test tests/models.test.mjs
```

`node --test tests/` does **not** work — Node treats the directory as a module and fails
with MODULE_NOT_FOUND. A fresh worktree needs `npm install` first, or every test that
imports `three` fails. It also has no `data/layout.json` or `cache.json` of its own (its
island is itself, see HOME below), so `tests/layout-measure.test.mjs` founds the island
three times over every transcript on the machine with a cold cache, and
`tests/plan-scan.test.mjs`, waiting on the same `data/scan.lock`, gives up after ~20 s -
a failure of the sandbox, not of the planner; alone it passes.

`tests/layout-measure.test.mjs` (and `plan-scan.test.mjs`) scan a copy of whatever island
`DATA` holds, so they fail or pass on the keeper's island as it stands, not on the last
commit: from the main checkout that is `~/.promptholm`; from a linked worktree it is the
worktree's own empty `data/`, i.e. a fresh founding that proves nothing about the live
island. To measure the live island from a worktree, run them with `PROMPTHOLM_HOME` on a
copy of `~/.promptholm` (below).

Tests exercise browser modules under Node: they `register('./support/shared-loader.mjs')`
to resolve the `shared/` import-map prefix, and stub `globalThis.document` before importing
anything that reaches `web/js/buildings.js` (it builds a `TextureLoader` at import time).
Copy that preamble when adding a test that touches `web/js/`. A whole walk mode can be driven under
Node as well: `tests/diving-walk.test.mjs` has the stubs (a 2D context that accepts every call, the
global `addEventListener` collecting the key handlers) and steps `createWalkMode` frame by frame
against a fake sea.

`tests/layout-measure.test.mjs` measures whatever `DATA` holds. To measure the live island,
point `PROMPTHOLM_HOME` at a copy of `~/.promptholm` that has its `config.json` (and
`data/arrivals.jsonl`), not only `layout.json` + `cache.json` in a worktree's `data/`: with
no `config.json` there, `loadConfig` founds one with `foundedAt` = now, the village model is
empty, every hamlet but the quay is taken up, and three tests fail for that reason alone.
Without `arrivals.jsonl` the settlers' `lastAt` is older and tents leave that the island keeps.
A scan reads the machine's live transcripts, so two runs minutes apart are not comparable byte
for byte (a new session is a new settler): to compare old code against new, run both in one
process, off / on / off, where the two "off" runs agreeing proves the model held still.

A test that goes through `scan()` must date its transcripts relative to now, never on a
fixed day: `scan()` builds the village on `Date.now()` with the config from HOME (its `now`
option reaches only the planner's snapshot name), so a fixture's tent packs up a week after
its date and nothing the test hands `scan()` stops it. Tests that call `buildVillage`
directly pass their own `now` and `config: { tentGraceMs: 0 }` instead
(`tests/tents-leave.test.mjs`).

`.claude/launch.json` has `island-worktree` (auto-port, `--no-rescan`) for previewing from a
worktree without colliding with the island already running on 4747. Pitfall: the preview
tool reads `launch.json` from the directory the session was *launched* in and starts the
server there, so from a worktree made by hand (`git worktree add`) it runs the main
checkout's code on the live island in `~/.promptholm` — its own `layout.json`, and a
`POST /api/plan` against it is a real move. To try server code from such a worktree, run
`node serve.mjs --port <free> --no-rescan --no-open` from inside it: `ROOT` is resolved from
`import.meta.url`, and a linked worktree keeps its island in itself (see HOME below), so
that process uses the worktree's own `data/` and `config.json`.

To try a branch on the keeper's **real** island without touching it, run it on a copy: copy
`~/.promptholm` (leave out `*.lock`, which names the live islander's pid, and `*.log`) to a
scratch folder, and in the copy's `config.json` set `multiplayer.sea` to `{ mode: 'single',
url: null, key: null, port: <free> }` and `network.public` to false - the live island joins the
open sea under its claim token, and a copy left on `join` would publish under that same token.
Then start the worktree's `serve.mjs --port <free> --no-rescan --no-open` with `PROMPTHOLM_HOME`
on the copy, set *before* `lib/paths.mjs` is imported (a two-line launcher that sets it and
`import()`s serve.mjs works as a `launch.json` entry). From a worktree, not the main checkout:
`WORKTREE` is what keeps `ensureStatusLine` from repointing the machine's status line.

A change to server-side code (`lib/`, `serve.mjs`, `scan.mjs`, `sea.mjs`) needs the Node
process on 4747 restarted before it takes effect - `/api/reload` only tells open browser
tabs to refetch `web/js/`, it does not touch the server process. `npm run watch` is
`watch-island.mjs`: it runs the island, watches those same files, and asks in its own
console (`[watch-island] ... restart the island? [Y/n]`) before restarting on a change -
never silently, since the island already running may have somebody's session or an open
panel worth not interrupting without warning. During a session working alongside a person,
Claude may restart the islander itself after a server-side change -
`taskkill /f /im promptholm-island.exe` (its node shuts down cleanly when the tray exe's pipe
closes) and start `promptholm-island.exe` again from whichever of `src-tauri/target/{debug,release}/` it was running from - without a formal
confirmation step first - a quick heads-up in the conversation is enough, matching the
console's own Y/n rather than a blocking question.

## The pipeline

```
~/.claude/projects/**.jsonl          transcripts (append-only)
~/.claude/sessions/<pid>.json        what is running now
%APPDATA%\Claude\...                 session titles, models, Cowork tasks
        |  lib/sources.mjs discovers; lib/parse.mjs folds in only the new bytes
        |  (data/cache.json remembers how far each file was read)
        v
lib/village.mjs   aggregates -> settlers, sheds, districts, milestones (TIERS, MILESTONES)
lib/layout.mjs    decides where each thing stands  -> data/layout.json
        v
data/village.json  -- serve.mjs -->  web/js/main.js   (SSE /events, WebSocket for players)
```

`serve.mjs` rescans on a timer (60 s by default) — that is how a new Cowork task appears
without a hook firing.

Pitfall: every `data/*.json` is replaced by rename (`writeJsonAtomic`, synchronous, retries
without yielding), and on Windows a rename over a file that *any* handle has open fails with
EPERM - Node's own handles included. So nothing in the islander may hold one of those files
open across an event-loop turn: `sendFile` reads with `readFileSync`, never `fs.readFile` or a
stream, which is what lost a scan to "rescan failed (issues): EPERM" whenever a page was
mid-download of `village.json` (the issues rescan two seconds after a restart, while every
open page refetches).

## Invariants worth knowing before changing anything

**A house never moves by itself.** `data/layout.json` is append-only and is the only
irreplaceable file under `data/`; `village.json` and `cache.json` rebuild themselves. The
scanner never moves a plot - with two deliberate exceptions for the quay district's Cowork houses,
`unsettleQuay` and the one move onto the resort on the sea (`moveToResort`, below); the keeper may, deliberately, through one door — `POST /api/plan`
(`lib/plan.mjs`, applied in the same slot in `scan.mjs` as `clearRoads`, under the scan
queue), which moves **whole hamlets** (lobes, with every house, shed and the land itself, by
a super-cell delta), gives a hamlet land or takes it away (`parcel`: `Super.eligible` for
what is added, never below the hamlet's population or `ensureParcel` grows it straight
back), and paints `layout.zones` (no-build super-cells, countryside only,
enforced exactly like a polder's dike: `heldOf` + `RESERVED`, no hash). It also moves or turns
**one of the town's own buildings** (`civic`: the three by three lots in `MOVABLE_CIVICS`, cell
by cell, onto the town's ground only, never half on a free lot - `takeCivicLot` reads corners -
and a nudge takes its lot along; the hall takes its postbox) and gives the town ground
(`commons`, only more). Where each may stand is `civicSites`, baked into the survey and every
dry run that moves one, a hex digit per corner with a bit per door direction, so the planner
never judges a drag itself (`Plans/DONE/gebouwen-verplaatsen.md`). A plan is tried on a
copy first, all or nothing; `diff.plots.otherMoved` must be empty and no house may be newly
left without a way to the square (`stranded` in `lib/plan.mjs` — `placeAll` roads a hamlet
as far as the router gets and says nothing) or nothing is written; `layout.before-plan-
<ts>.json` is written before the apply and `POST /api/plan/undo` puts one back; the scan
after an apply is byte-identical again. `placeAll` refuses nothing handed to it — measured,
two houses on a slope of 2.1 were accepted — so the validation in `lib/plan.mjs`
(`Super.eligible` on every destination super-cell, `freeBlock` on a `replayGrid`) is the
feature, not a nicety. Design and measurements: `Plans/DONE/wijkjes-verplaatsen.md`.
**A project keeps to one piece of land** ([Plans/DONE/wijkjes-samenvoegen.md](Plans/DONE/wijkjes-samenvoegen.md)).
The scan founds no annex for a project any more (only the quay, `annexes(rec)`): a boxed-in
hamlet grows wider through `growLobe`'s rungs - past `RCAP`, then belt 0 up against its
neighbours (never onto their land), then onto beach - and a house that finds its land roaded
asks for one super-cell it can stand on (`roomy`, a *filter* per rung: as a preference the
first rung was satisfied by a roaded cell and the wider ones never ran). Only a project walled
in on every side goes to the commons. What already stands in pieces is brought home by the
planner's `merge` op (`{ district, lobe }`, the lobe that stays becomes lobe 0 with its road
and office renamed to match; `diff.scattered` must be empty), and in plan mode a click selects
the whole project, so a drag no longer tears one apart. Known gap: on an island founded small
the first hamlet by the square can be walled in by neighbours' belt-0 growth before it needs
the land, and its later houses lodge on the commons.
The keeper may also draw a road (`road` op, `opRoad`): the gaps it crosses become bridges
exactly as long as the gap, and the whole road is kept in `layout.roads` besides what it
paved, because `clearRoads` throws every path away and no door re-routes a road nobody's
house asked for - `replayKeeperRoads` in `placeAll` paves it again (`Plans/DONE/wegen-tekenen.md`).
Building by hand (the Build chip, `B`, `buildmenu.js`/`ghost.js`) is off unless switched on
under Settings → Debug (per browser, `promptholm.debug.build`): the planner keeps the town.
Roads, unlike plots, the scan does take up by itself: every scan runs the planner's
`pruneUnreachable` and lays again whatever no longer reaches the square, because a path
records only the cells it paved itself - when a hamlet dies its road goes, and every road
that had braided onto it was left ending in the grass (45 houses cut off, 25 September
2026). Six version gates in `lib/layout.mjs`, in descending order of violence:
`LAYOUT_VERSION` (throws away the town
and the terrain — almost never right), `PARCEL_VERSION` (re-plans houses, sheds, parcels,
paths), `TOWN_VERSION` (lays the centre's own buildings out again on the town's plan and
re-routes every road round its streets; no house or shed moves), `ROAD_VERSION` (re-routes
hamlet roads and nothing else), `SQUARE_VERSION`,
`QUAY_VERSION` (re-plans the quay alone, its planks included — the one gate that runs from
`placeAll` rather than `loadLayout`, because it has to ask the ground a question). Reach
for the smallest one that does the job. [docs/branches.md](docs/branches.md) lists what to
assert after a layout change, and the trap: **stop the server before measuring**
(tray → Stop, or `taskkill /f /im promptholm-island.exe`), or its own rescan interleaves with yours and every plot looks moved.

**A tent may leave; what the village earned never does** ([Plans/DONE/tenten-vertrekken.md](Plans/DONE/tenten-vertrekken.md)).
A resident drawn as a tent (`tier === 'tent'`: fewer than three human turns, not a harbour
house, not a hotel), not running, not a founder, not rehomed and quiet for `tentGraceMs` (a
week) packs up in `buildVillage`: house and sheds into `dropped`, front path lifted in
`scan.mjs` like a banishment's, session id in `model.departed` (village.json `departed`, which
the town hall's register reads to offer **Invite**). So `stats.settlers` can go *down*, and
nothing earned may be gated on it: the ladder counts `stats.reached`, the most there have ever
been at once, kept in `layout.ladder = { since, settlers, apprentices }` (written back by
scan.mjs, moved only by a new most-ever). **`reachedOf(model)` in lib/village.mjs is the one
reading** - milestones, furniture, `yardStage`, `earnedBoats` and every gate in `placeAll`
(fairway, polders, square, bridge) take it; only the header count and `nextMilestone`'s
`remaining` measure from who lives here now, which is what makes the next rung take longer.
`model.arrivals` is now "the first moment n lived here at once" (`firstsOf`), with a departure
dated `lastAt + tentGraceMs` but never before `ladder.since`: a layout from before the rule has
no `ladder`, starts it at its first scan and keeps every date it had; `emptyLayout` carries
`{ since: 0 }` because a new town has no such past; `resetForNewTerrain` keeps it.

**The planner is a third mode, and nothing real moves in it before Apply.** `state.mode`
is `'orbit' | 'walk' | 'plan'`; `web/js/plan-mode.js` renders the same scene through its own
`OrthographicCamera` (north up, so a screen rectangle is a world rectangle) and never touches
`camera`/`controls`, which is what makes leaving free. A hamlet being dragged is drawn as
ghosts (`plan-overlay.js`: each building's shape, copied out of the batch, under ghost.js's green/red) while the
real groups stay put — `reportPlacements` reads their positions after every scan, and a drag
across the 60 s rescan would have published a village standing in the wrong place. The
server is the authority: a dry run after every change, the real thing on Apply, and then
every open page follows through its ordinary `applyVillage`: a record whose `plot` changed
is built again, roads are redrawn when their *content* changes (not their count), and the
ground is rebuilt when the polders do (`groundSig`). The one thing it cannot do live is
regrow the forest on ground given back — `createLandscape` scatters it once per page load —
so an old hamlet site is meadow until the next reload.
What plan mode switches off — and `leftPlan` switches back on — is the CSS3D boards, the
clouds, the hamlet arches, the nameplates and the haze; the frame loop's camera and label
branches are `=== 'orbit'`, not `!== 'walk'`, for the same reason. The drag's colour comes
from `GET /api/plan/survey` (`lib/survey.mjs`, bits per super-cell), never from a second copy
of the rules in the browser.

**A polder and a fairway are the same mechanism pointed two ways.** A polder takes water
off the island, a dredged fairway takes ground off the sea, and both are a list of cells in
`layout.json` handed to `makeTerrain` — so both are as sticky as a house and both change
the terrain hash. `layout.fairway` is dug once, at `FAIRWAY_AT` settlers, and never planned
again; `planFairway` refuses every cell anything stands on, and `polderCandidate` refuses
every cell the channel holds, because a fairway is shallow water and reads to a polder like
perfect ground to wall in. The ordering that makes all of this survive is the polders' own
and is load-bearing: `makeTerrain` is called *with* the fairway before the hash check, so an
island that has never dredged still recognises itself, and `layout.terrainHash` is recorded
*after* the digging, or the next scan finds a mismatch it caused itself and wipes the town.
A `null` fairway means nobody has asked; `{ cells: [] }` means we asked and there was
nothing to dig, and the difference is what stops the search running on every scan for ever.
A polder the keeper drains by hand (`polder` op in `lib/plan.mjs`) goes through the same
`polderFromSupers` + `digPolder` the ladder uses and records the hash itself, straight after
digging; it carries `manual`, `at` and `dugAt` (provenance, kept off the bundle), counts as a
rung for `poldersWanted`, and `scan.mjs` dates the planned ones around it. Unlike the
ladder's, a hand-drawn polder may take a super-cell the coastline runs through
(`polderCandidate(…, { shore: true })`, also the survey's `water` bit): its land cells are
left out of `p.cells`, which is what makes a coast with shallows before the sand
reclaimable at all. The ladder keeps the strict all-water rule, or islands that already
have polders would dig different ones. Every polder also
gets one sticky approach road (`road:polder:<n>:approach`) from its causeway to the square,
or an empty polder is orphaned paving until somebody builds on it. The sea can take a polder
back (`unpolder`): refused while anything stands on or owns it or another polder leans on
it, one per plan because the list is indexed, and `layout.poldersReturned` is the ladder's
memory of it so the next scan does not dig the same coast up again.
Everything that builds ground has to be handed it — `lib/layout.mjs`, `lib/garden.mjs`,
`lib/fleet.mjs`, `lib/islandbundle.mjs`, three calls in `web/js/main.js` — and the one that
deliberately is not is `horizon.js`, which ignores the polders too because a silhouette at
that range is every other cell.

**An island founded small grows, by accretion** ([Plans/DONE/eiland-laten-groeien.md](Plans/DONE/eiland-laten-groeien.md)).
`layout.grow = { base, steps }` (null on an island founded on its whole grid, which never
grows) is makeTerrain's `grow` and travels wherever ground is built, exactly like the
polders - bundle (`growth`, strict, radii whole numbers), `village.grow`, every page and
the sea. The founding ground is built on `base` (`groundOf`) and set down in the middle of
the grid; each step `{ r, grid, hold }` raises only sea and beach joined to open water,
never touches a corner above `BEACH_MAX` or of a `hold` cell (what stood there, in local
coordinates), and remembers the grid it was worked out on so a bigger grid later reproduces
it bit for bit. `placeAll` grows by itself (`growStep`) when houses are left over, in the
same scan, and records the hash before placing again; a house with no room in its own
hamlet waits one ring instead of taking the commons (`waited`) - but only when a ring could
give it land (`landWouldHelp`; a hamlet at `MAX_LOBES` or short of a free block rather than
of land asked for a whole ring per house, which took one seed from coast 101 to 172), and the polder ladder waits
until the island has reached its grid. What the new ground drowns moves on purpose: the
quay (`unsettleQuay`), the harbours, the landing, the lighthouse - and roads left leading
nowhere go through `pruneUnreachable` (now in layout.mjs). What it closes in is taken in:
`absorbDikes` levels every polder dike with no water left beside it by taking those cells
out of `p.dike` (so every reader - makeTerrain, heldOf, world.js, older seas - sees the
shorter wall with no new field), keeping any dike cell within one of a plot or bridge (the
poldermill's) and giving a dike back whole if levelling would let water in; `p.absorbed`
(the step's index, provenance, off the bundle) makes `unpolder` refuse it. The planner's Grow button is the
`grow` plan-op on the same `growStep`. New installs are founded with `FOUNDING` (a 40 island on a
64 grid; both grow) - deliberately not the defaults, which also fill in old configs.
**The grid is the layout's; `gridSize` is what a new island is founded on and
`maxGridSize` (default 384, Settings → Island size, `/api/island-size`) the most it may
become** - `islandCap(config)` in lib/paths.mjs is the one reading, and being a default it
is filled into every old config, which is how islands that already stood got room to grow.
`loadLayout` no longer throws the town away when `layout.size` differs from the setting
(only a new seed or `LAYOUT_VERSION` does), and every caller builds ground on
`layout.size`: `scan.mjs` (`cap` = islandCap, `size` = the layout's, read again after
`placeAll`), `placeAll` and the planner (which re-read `layout.size` themselves), the
garden, the survey and the parcel; the reach of props, beds and the player is islandCap too.
The sea keeps that room free: `village.island.room` rides the bundle (absent = its size),
and `lib/fleet.mjs` lays berths out on `reach` = max(half, room/2), so an island growing
into its own room keeps its berth. A grown island's bundle carries `grow`, which a sea from
before this ignores - it then hashes different ground and refuses the island - so the open
sea has to run this code before anybody on it grows.
When a ring does not fit, `growStep` first calls `growCanvas` - centred, in steps of 32,
every grid index +k and every super-cell field left alone, since those hang off
`lattice.anchor`; `tests/canvas-grow.test.mjs` walks the whole layout and fails on any
pair that did neither. An island founded on its whole grid becomes `grow.base` = that grid
the first time, which is how raising `gridSize` lets the live island grow at all. A page
whose `grid.size` changes reloads (`applyVillage`); `diffLayouts` compares plots in local
coordinates, or a grown grid reads as every house moved.

**A growth step's ground is versioned per step.** A step (`layout.grow.steps`, `{ r, grid,
hold, relief }`) decides the terrain hash like a polder does, so its look can never change in
place: `relief` (`RELIEF_VERSION` in `shared/terrain.mjs`, written by `growStep`) opts a new
step into `growRelief`'s hills and rivers, and a step without it draws the flat ring it always
did. New shapes mean a new version beside the old, never an edit to it. The river rule there -
cut only in corners this step makes, never below their height before it - is what keeps
"accretion never lowers anything" true ([Plans/DONE/eiland-laten-groeien.md](Plans/DONE/eiland-laten-groeien.md)).

**A ring must not cut water off from the sea, and every edge people make is a profile** ([Plans/quay-en-rivier.md](Plans/quay-en-rivier.md)).
`accrete` floods the sea once, before it raises anything, so a lagoon, a spit or a river mouth was ringed
in by the new ground (live: seven ponds of 247 cells, and the fairway's seaward end closed by a two-cell
spit), and everything the layout did to the ground was a stamp per cell that jumped from sea to meadow in
one cell. The rule now: **an earthwork is a mask plus a profile by distance** (`workProfile`,
`cornerDistance2` - an exact distance transform on the corner lattice - and `profileDig` = `min`,
`profileKeep` = `min(ring, max(before, P))`, `profileFill` = inpainted from the rim with `max`, all in
shared/terrain.mjs, trig-free, quantised to 1/256): bed `CHANNEL_H`, underwater bank, a 3-cell beach to
BEACH_MAX, then a land bank until it meets the ground. A step with `water: WATER_VERSION` carries what it
decided, written by `growStep` when it takes the step (makeTerrain's `settle` option asks `settleRing`,
the answer comes back as `terrain.settled`): `lane` (cells joining water the channel or a river belongs
to back to the sea, kept open), `ponds` (water it shut in that nothing belongs to, filled) and `haven` (a
copy of the harbour funnel as it stood, kept open) - all LOCAL like `hold`. It used to work its lane out
from whatever fairway was handed in, and a channel dug later then redrew an old ring (measured: 160 cells
far from any channel flipped, under houses, hash re-recorded in the same pass). `WATER_VERSION` is still 1
with this meaning (the old one never shipped); a step without `water` draws bit for bit as before
(`tests/water-growth.test.mjs` pins recorded hashes, the live `03aefc04` and the new water-1 goldens).
What the layout does to the ground itself is **`layout.works = { v, dig: [{ cells, hold }], fill, haven }`**
(`checkWorks`), handed as `works` to every makeTerrain (`tests/works-everywhere.test.mjs` reads the source
and fails on a call that hands over polders/fairway/grow without it), applied after the rings and the
fairway's own stamp (never re-profiled: it is in the live hash), fill before dig, before the polders.
Each dig carries its own `hold` (what stood within the profile's reach when it was dug; never lowered), so
a later dig never lifts back ground an earlier one took from under a newer house. `repairFairway` (cut from
`line[0]` to open water through ground below BEACH_MAX nothing stands on; a crane/lighthouse in the way is
lifted by `liftCivics`), `fillRingPonds` (no longer waits for a fairway: `works.fill` undefined = not asked,
`[]` = nothing to do) and `planHaven` (below) all run once at the start of `placeAll` and re-record the hash
straight after. **`makeTerrain` refuses** an unknown field in a step or in `works`, a `works.v` it does not
draw and a malformed funnel, as `checkGrow` refuses an unknown relief; `parseBundle` whitelists all of it
strictly. The scan that first changes the hash through `works` keeps the old file as
`layout.before-works-<ts>.json` (scan.mjs `backUpBeforeWorks`): **older code ignores `works`, hashes other
ground and plans the town again from nothing** - a release and a checkout share `~/.promptholm` - and an
older sea or page draws another island and refuses it / shows the skew banner. So this ships as a minor,
and the open sea (stack 28, by hand) is redeployed before the live island publishes its new hash.

**The harbour is a funnel no ring may close** (`works.haven = { top, dir, w0, open, max, from }`, fase 2).
Narrow at the head of the inlet - `top` is `havenBridgeSite` (first crossing of the river above the
channel's inland end at most 3 cells of water), `w0` half its width - and wider towards the sea by `open`
per cell per side (so it is as wide as the bay where the channel meets it), up to `max` =
`HAVEN_WIDEN` (3) times that half-width (never past `FUNNEL_MAX`), then straight on: a *ray*
(`funnelHas`, one sqrt, whole-number `dir`), so `growCanvas` shifts `top` only and the funnel runs on
through new sea. `dir` is derived per seed, never a compass point: bearings within `HAVEN_ARC` of the
head-to-channel-mouth bearing, the one that keeps the quay's planks/shore/berths/crane/galleon berth within
a cell of it across the fewest cells of land wins (`chooseHaven`). `planHaven` waits for the harbours
(`layout.harbours != null`) and a channel that reaches the sea; a pass that just planned the harbours
places the island again in the same scan (`havenPass` at the end of `placeAll`, at most twice: the
stone quay below is due the pass after the funnel), so the funnel is
planned at the start of a pass and the scan after is still a no-op. Planning digs the head once
(`works.dig`: funnel sand below BEACH_MAX reached from the head, nothing standing on or beside it; a crane
in the way is lifted) and copies nothing onto old steps; every later step gets `haven` and keeps it open
with `profileKeep`, so a ring builds nothing in it, meets it with a beach either side and leaves its own
natural sea floor (no trench of -2.5 where the old grid edge was). What already stands is never dug away.
`keptWater`/`opPolder` keep the funnel and a ring round it as water, `fillRingPonds` never fills a pond
touching it. The banks' roles are derived (`havenBank`/`havenBanks`: the quay's bank is the quay district's
side of the axis, the other is the pirates' - read-only; nothing is reserved there by asking).

**The harbour is real water with a stone quay; there is no basin overlay any more** (fase 3,
`planKade` in lib/layout.mjs, [Plans/quay-en-rivier.md](Plans/quay-en-rivier.md)). Once the funnel is
planned and there is a quay district with planks and land (`kadeDue`), `planKade` digs ONE more
`works.dig` (the old overlay's parcel+ring, the rim to the channel, the funnel west of the axis over the
old yard's rows, the yard's dock, an anchorage, a few rows of sand past the quay's end) and lays
**`works.kade = { cells, level, back, hold }`** (shared/terrain.mjs `levelKade`, applied after the digs,
before the polders; `checkKade` refuses anything else; `parseBundle` strict; `growCanvas` shifts
`cells`/`hold`): every corner of its cells at `level`/256 (113 = BASIN_DECK), so its water-side row of
corners IS the wall (set by the quay, never held), ground above it cut back with the works' land bank,
ground behind it (along `back`) raised to meet it, `hold` untouched. `WORKS_VERSION` stayed 1 for the extra
field only because no release ever carried `works`; from the first release a new earthwork is a new
version. Geometry is in the funnel's own frame (`kadeFrame`: axis within ~27 degrees of a grid axis, else
`kade: null`): wall one cell past the parcel's ring, quay 3 wide, from the parcel's first row to the last
row where all three quay cells are dry (Hoogezand: x168-170, z267-313). What stands in the basin is held
(digHold's rule) except the quay's houses (`p.quay`, on piles, drawn at BASIN_DECK), their paths and the
quay harbour's approach: those stay road as **boardwalk** (`dugKeys`: a recorded path cell over dug water
is forced PATH in placeAll's replay and `replayGrid`, and the quay's `deck` takes every such cell). The
quay's ramp (shore + slip) stays land. `planKade` moves the yard itself to the pirates' bank (`yardSite`
with `kadeBankOf`: every yard cell on the far side of the axis and outside `havenKeys(layout, 1)`) and
lifts crane, warehouse/weigh house (if near) and ships; the loops place them again: crane on
`kadeCraneCell` (the wall column's seaward end, jib over the water), warehouse/weigh house by `kadeSite`
(3x3 BEHIND the quay, door step on its back row - `strandedAtSea` counts a step on the quay as "at the
water", so a ring never moves it), ships by `kadeRedeSite` in lanes of the big ships' water. **The big
ships' water** is `shipWaterOf(works)` in shared/quay.mjs (pirates' half of the funnel, >= `SHIP_LANE`
off the axis, past the quay's seaward end - from `works` alone, so page, layout and bundle agree), and
`shipBerth(m, height, water)` lays the galleon there with a per-cell search in whole numbers (nearest
cell from the mooring's own cell, ties row-major; without `water` the old 16 rays, bit for bit). The quay
is `road:kade` (all quay cells but the crane's, laid once, forced PATH after, like a causeway; plus
`road:kade:approach` only if nothing reaches it). Beside a kade, `growStep` keeps the quay harbour's
`road:harbour:<n>` and its approach when it re-plans the harbours (relaid from the ramp it finds water on
every side). On the page the quay is ground painted as plaza (world.js `squareCells`), its wall is
`buildQuayKade` (web/js/quay-basin.js: one mesh, face + coping over the foot cell, stairs in front of the
face) and feet stand on `quayKade(village, terrain).height` (shared/quay-basin.mjs: the foot cell at
`level`, the treads) in walk.js `groundAt`/`bedUnder` and settlerwalk `createStandHeight` - **so the open
sea must be redeployed for the settlers' stand height**; `parcelWaterField`/`quayWaterField`, the ground
shader's discard and the basin mesh are gone. Known gap: the bridge at `havenBridgeSite` is not built.
The quay stands at `kadeHarbour` (the harbour whose planks lie in the funnel's ring: the quay district's
own first - Hoogezand - else the one nearest the funnel's top); beside any harbour but the district's own,
or a district parcel wider than `KADE_PARCEL.across`, it is laid past `KADE_PARCEL` (Hoogezand's parcel in
the funnel's frame, from the ramp) along the run of dry rows through the ramp's row (>= `KADE_RUN_MIN`). A
quay district's house in the quay's way is let through only if `resortSite` has a lot for every one of them
(asked on the trial layout); any other building still refuses it. **While the island can still grow
(`canGrow`), a refusal waits** (nothing recorded, `kadeWaiting` keyed on grid and harbours so `kadeDue` asks
for no pointless pass) - an island founded small asked on a coast of forty and "no room" was final. After a
growth step `placeAll` starts its `havenPass` count again, or a quay due after the ring re-planned the
harbours was decided on the next scan. Measured with a seven-house quay district: 0 of 30 seeds founded on
40 (150 settlers) and 2 of 40 founded on 96 (200 settlers) get a quay at all - the funnel is not within ~27
degrees of a grid axis, no harbour lies in it, or the town's civics stand in the quay's strip. Open.

**The quay's houses live on a resort on the sea; the harbour stays the quay's** (`layout.resort`,
[Plans/quay-op-zee.md](Plans/quay-op-zee.md)). `planResort`, straight after `planKade` in every pass, once
(`undefined` = not asked, `null` = no quay or no site, waits while `canGrow`), records `resortSite`'s pick -
derived, never a cell: a beach foot on the quay's bank, a jetty to a boardwalk spine, 3x3 lots on the water
either side (doors on the spine), a second spine behind a plank through a gap (a comb), a raft beyond,
`{ foot, out, shape, jetty, deck, lots: [{gx,gz,rot}], raft, strand }` - and moves every house of the quay
district onto the next free lot (`moveToResort`; plot gets `lot: n`, `lobe: -1`). Hoogezand: foot (191,311),
jetty east to x196, 20 lots. Top-level on purpose: not in `works` (`checkWorks`/`parseBundle` would make
older seas refuse the island for a record that moves no ground), not on `districts.quay` (`migrateParcels`
keeps a district only as its planks, and lib/plan.mjs moves districts by super-cell). **Option A: the
district's `pier`/`shore` do not move** - they are the quay's harbour, so `standingQuay`, `kadehaven`,
`waterfront`, moorings, boat 0 and the galleon are untouched; moving them took all of that out to sea. The
resort reaches pages and the sea only as the houses (`plot.quay`, on piles now reaching -1.00: the boardwalk
set's `DECK` is 1.44) and the district's `deck` (`resortCells(layout).drawn`: the shortest walk inside the
deck from the jetty to every occupied lot's doorstep, grows with the district; `centre` is the jetty head).
In the replay (placeAll and `replayGrid`, `markResort`) the drawn deck is PATH, the rest of the deck and
every free lot RESERVED; `keptWater` and `fairwayHeld` hold the whole grown resort plus a ring
(`resortKeep`). The way in is `road:quay:resort` (strand over the sand, forced back like a slipway, then
routed to the square; `unsettleQuay` keeps it). A quay with a resort founds no parcel (district loop), a new
Cowork house takes the next free lot (house loop) and past the last lodges on the commons (never waits for
a ring, `guest` = lots < population), and `p.quay` is not set on a commons lodger. **A ring keeps it open**:
`growStep` hands `resortWater` (grown resort + 1 cell, water cells) to `makeTerrain`'s settle as channel and
as `settle.lane` (settleRing's `seed`), so it is written on the step as ordinary `lane` - no new step field,
no WATER_VERSION bump, bit for bit the hash a field of its own gave (55c22da7 on Hoogezand's r 180 ring).
`growCanvas` shifts the record; the planner refuses `move`/`parcel` of the quay once it has a resort
(`onResort`). **QUAY_VERSION 3**: `migrateQuay` from 2 only asks `moveToResort` again (the move itself is
`planResort`'s, so a new island and Hoogezand take one road), and **the pick-the-planks branch is `=== 1`,
not `>= 1`** - a v2 layout through it would re-pick the planks, and `pickPier` answers (163,264) today on
Hoogezand where they stand at (154,284). Older code on a v3 layout does take that branch (it only knows 2):
a release only, never a patch. The scan that sets the resort keeps `layout.before-resort-<ts>.json`
(scan.mjs `backUpBeforeResort`). On the page: `resort-dressing.js` finds the resort's piece of the deck
(wet, houses on it, meets a beach) and puts a raft past the spine's tip and parasols on the sand into the
same deck geometry (`resortParts`, no draw call of its own); `createQuayKade` gives the kade `fingers`, finger
jetties where the houses stood, drawn in the wall's mesh (dressing: `BOATS_PER_HARBOUR` stays 3); `sailIn`
sails a resort house to its own front deck.

**`shared/` runs identically in Node and in the browser.** `shared/terrain.mjs` decides the
ground both the scanner and the viewer use, so it sticks to plain arithmetic — no `sin`,
`cos` or `pow`, which can differ in the last bit between runtimes. The viewer hashes the
terrain on load and warns in the console if the two disagree. `web/index.html` maps
`shared/` and `three` in an import map; Node gets the same through the test loader.

**A village has no seed of its own.** It carries one at `village.island.seed`; there is
no `village.seed`, so reading it gives `undefined` and any `|| 0` behind it silently draws
every island as if it were seed 0. In `web/js/` the seed to reach for is `terrain.seed`,
which `makeTerrain` puts on the terrain object and which the rest of the viewer already
uses. Leave such a read without a fallback: four of them hid behind one for months.

**One world frame, many island-local frames.** `shared/regions.mjs` is the contract, and its
header comment is the long version. `shared/terrain.mjs` and `data/layout.json` speak LOCAL
coordinates — `-half..+half` around one island's own middle — and always will; `makeTerrain`
stays origin-centred so a house never moves. A second island gets a *region*: the same
terrain with a world offset, through a facade with the same method names. The asymmetry that
makes every existing caller correct for free is that **`cellWorld` adds the origin and
`worldHeight` subtracts it**. The rule that does not follow from it: a module that builds its
own positions out of `half` (`world.js`, `hamlets.js`) wants the RAW local terrain and an
offset group, not the facade. Outside every region, `archipelago.height` is `OPEN_SEA`
(-2.5), not the nearest coast — which is what `makeTerrain`'s own clamp would hand back.
Two islands means two terrains at an offset, never one bigger heightfield. One island's
own grid *can* grow now, but only by `growCanvas` (below), never by a setting.

**A visiting island is a place, not a village.** `web/js/guest-island.js` draws a region at a
berth: its ground, its buildings, its moving parts, its collision. It deliberately does not
go through `applyVillage` or into `state.byId` - those own the chronicle, the dossier, the
milestones and the filters, and region-scoping them would mean touching the post, the market
and the garden to draw a coastline. Guest ids are namespaced `guest:<region>:<id>`, because
both islands have a `civic:board`. No nameplates over there: 41 of them measured 123 draw
calls and 41 canvas textures, which took a second island from 1.35x the call count to 1.76x
against a 1.6x budget - `attachExtras(rec, { signs: false })` is what keeps that true.

Its people come the same way — and so do ours. **There is no local simulation left in the
browser.** `web/js/crowd-view.js` feeds positions off the wire into `createFigures` for
every island including our own, so a village of three hundred costs the same eleven draw
calls a village of three does. And only the near ones are drawn
whole — `DETAILED` in `main.js`, nearest to the *viewer* first (`pickDetailed`: the walker or boat
on foot, the orbit target otherwise, rechecked every 2 s with a hysteresis so two islands
at the same distance do not trade places every step) — while the rest are
silhouettes at their real berth through `horizon.js`. Eight islands in full does not render;
measured at six, 850 draw calls against 788 for one.

There is no longer any way to visit somebody by *leaving*. `cross()`, `visitNeighbour()`
and `?arrive=` are gone with the berth machinery: an island in your sea is water you can
cross. The LAN beacon (`lib/neighbours.mjs`, `multiplayer.discovery`) is gone too — islands
meet only by joining the same sea from the main menu, so the horizon holds nothing but the
far part of our own fleet (past `DETAILED`) and the `?join=` debug islands.

**Nothing a visitor can reach writes anything.** There is no write route on `PUBLIC_API`
and there is not meant to be one. There was — `POST /api/island` took delivery of somebody
else's island and parked it under `data/guests/` — and the sea took that job: an island is
published to a world that holds it in memory and never writes it down. So `lib/access.mjs`
is back to all three of a loopback socket, a known `Host` and a matching `Origin`, with no
flag and no path list that can spend any of them, and an `inviteCode` is back to buying a
look. `lib/islandbundle.mjs` survives and is the centrepiece: an island *is* its bundle, and
`parseBundle` is the whitelisting rebuilder on the side that has to survive a lie.

**One material, one batch per island** ([Plans/DONE/gebouwen-in-een-batch.md](Plans/DONE/gebouwen-in-een-batch.md)).
Which texture sheet a face uses is a number carried on the vertex, not a material of its own,
and night glow is a per-vertex emissive mask - and every building body on an island is one
instance in that island's `BatchedMesh` (`web/js/record-batch.js`: `homeBatch` in main.js in
`scene`, one per guest inside its offset group), so all of them are one draw call a pass. The
yard signs' frames are instances in the same batch (`createNameplate({ batch })`, two shared
shapes); their lettered faces are still a mesh each. **The record keeps its scene graph and the
batch mirrors it:** `rec.mesh` is an empty Object3D stand-in, and in the batch's own
`onBeforeRender`, once per `render()` (after `updateMatrixWorld`, before the shadow pass), the
batch copies each stand-in's visibility (every parent up to the batch's parent `visible`, and
`layers.mask !== 0`) and its matrix. So `applyVisibility`, `popIn`, `leaveAnimation`, the
Object Distance cut, `keepRegion` and the Batavia's swell keep writing the group or the stand-in
and never touch the batch - keep it that way rather than telling the batch from each writer.
A hit's id is `pickedId(hit)` (batchId -> stand-in -> `userData.id`); a ghost's shape is
`positionsOf(stand)`, a copy, because the batch keeps the only copy of every building (the
loose geometry is disposed on `add`). r170 quirks it works round: `frustumCulled = false` on the
batch (its own sphere is computed once and never again), one `setColorAt(white)` (the renderer
compares a field that does not exist, `object.colorTexture`, and otherwise re-picks the program
every draw), and `deleteGeometry` frees an id and not its range (`optimize()` compacts before
the batch grows). Giving a building a material array, or a mesh of its own, takes it out of the
batch: a call a pass again - on Hoogezand the 806 bodies and 395 sign frames cost ~13 ms of a
28 ms frame from above.
`?stats` reports both passes (render-stats.js); without `WEBGL_multi_draw` three draws a batch
house by house but still skips its per-object work, which is where the time went.

**Four graphics distances, and they are not one number with four names.** View Distance
is `camera.far` (`main.js applyViewDistance`, +150 because `setFogRange` closes the haze at
`FOG_CAP` = 0.95 of it, and never tied to the world's size; the sky dome is drawn *on* the
far plane, `p.xyww` in world.js, so a near far plane never shows the black clear colour, and
`world.setFar` keeps the fog-free sun and moon inside it); Object Distance is how far a
house, prop or boat is still drawn (not a slider: View Distance times the tier's ratio, see below); NPC
Distance is how far a *person* is still drawn; Shadow Distance is the ceiling on how wide
the sun's shadow box may grow (`setShadowDistance` in world.js - not `shadow.camera.far`,
which `followShadow` rewrites on every zoom). The sliders are in Settings → Graphics, per
browser (`web/js/graphics-settings.js`), and only the ones somebody moved are stored
(`saveGraphic`); the rest follow the machine's tier - `full` (1250/2000/1000/380: a far plane
of 1400, the old look), `modest` (main.js's `modest`: integrated graphics or `?modest`) and
`phone` (the app), with "This machine's defaults" to forget every choice. `state.graphics` is
written from exactly one place, `onGraphicsSetting` - which has to be on **createUI**'s
handlers; it was handed to `createNet` once and every slider moved its label and nothing else
(`tests/graphics-settings.test.mjs` reads the source for it). The plan is
`Plans/DONE/graphics-afstanden.md`. Before touching any of them:

- **A house comes out of the mist; it never appears - while Object Distance is beyond the haze.**
  `cullCeiling()` in main.js (`fogCeilingOf` in fade.js) is the nearer of the far plane and Object
  Distance; the haze itself (`fogCeiling()`) is the far plane's alone. A record is taken out of the render list (`keepRecord` in
  `web/js/record-cull.js`, `layers.mask = 0`) only `CULL_PAD` past Object Distance - so what
  is cut is always already the colour of the fog, and on the way in it thickens out of it.
  The sky dome's band along the horizon *is* the fog colour (`uFog`, written in
  `sky.onBeforeRender` in the *output* colour space - three hands every material its fog that
  way, after `colorspace_fragment`, and the dome writes its colours as they are; given the
  linear value it showed 171,206,243 against the fogged sea's 214,232,249, a hard line), so a
  fully fogged mast against the sky matches it too. Two things are
  never masked: lights (turned down to 0 instead - the light count is in every lit program's
  key, and a masked campfire recompiled every material on screen) and records with a
  `fog: false` part (a lighthouse beam, a campfire flame: landmarks, never cut).
  A whole guest island whose nearest edge is past the fog ceiling plus the pad is masked the
  same way (`keepRegion`, key `'far'`: ground, wood, fields, props, houses; not while anything
  on it is a landmark), and its `update` skipped. Cuts are kept per object in `userData.cut`
  with the list of keys holding it, so a record cut and its island cut undo in any order.
  The cut is taken in `cullRecords()`, right before the render, once every branch of the
  frame has put the camera where it is drawn from. Anything `fog: false` that a fogged house
  could hide breaks the rule when the house goes: the fireflies were the one measured case,
  and now fade their alpha with the fog.
  From above, Object Distance is floored at the orbit target's distance × 1.5 + 32
  (`objectReachOf` in fade.js, `objectReach()` in main.js - every reader goes through it), so
  zooming out never fogs away the town being looked at; on foot it is the setting. Since that
  moves the ceiling with the zoom, the crowd's dither is decided against `widestFogCeiling()`
  (the floor at the end of the leash), and the cut is never tighter than `fogAt`, the haze
  actually standing (set before `controls.update`).
  That is what makes an older machine playable without the island looking cut short: the
  `modest` and `phone` tiers bring Object Distance in, and a neighbour's houses, mills and
  people are past the haze and not drawn at all.
- **The haze is the island's, and View Distance opens it only past the default.** `applyFogRange`
  works the fog out from the island's size, not from the far plane, so raising View Distance alone
  moved the far plane and nothing anybody saw. `hazeOpening` (graphics-settings.js, 0 up to the
  desktop's 1250, 1 from `HAZE_OPEN_AT` 6000 up; the slider goes to 20000 and past 6000 only the far plane moves) pulls `setFogRange`'s far end towards `FOG_CAP * far` and
  its near end towards 0.8 of it - so the tiers below 1250 are untouched. Two more things follow the
  far plane and have to: the ocean disc (`ocean.scale` in `setFar`, or its rim shows against the
  dome once the fog is gone) and the clouds (`setCloudReach`, called with `scene.fog.far`: rings of
  tiles beyond the 3 x 3, in a shadowless child mesh, capped at `CLOUD_RING_MAX`, and past those a coarse layer of the same clouds at `FAR_SCALE` times the size and
  spacing - as much sea covered in a sixteenth of the clouds - out to `FAR_RING_MAX` rings of its tiles). `edgeReach`
  (the haze closing in near the world's edge) is a few thousand at most and was the invisible
  wall the fog stopped at whatever the slider said; the opening lifts it to the far plane. What the haze
  used to hide shows once it is gone: the water's per-pixel ripples alias into a lattice of dots
  past a few hundred units (`calm` in the water shader fades them out), and the ocean disc sits
  0.2 under the patch, which the depth buffer cannot separate out there (`polygonOffset` on it).
  **Object Distance is not a slider any more**: `objectDistanceOf` (graphics-settings.js) is View
  Distance times the tier's `OBJECT_RATIO` (desktop 1.6, past the far plane; modest 0.7; phone 0.65),
  written into `state.graphics.objectDistance` by `withObjectDistance` whenever View Distance moves.
  The haze is the far plane's alone (`fogCeiling`); `cullCeiling` is what the cut of records,
  neighbours and islets uses. A chosen Object Distance would have left houses standing in clear air
  or cut them there, and the stipple fade that hides that costs every building its early depth test.
- **The fog is by distance, not depth** (`web/js/radial-fog.js` patches three's `fog_vertex`
  chunk once, before anything compiles; every shader that fogs, the hand-written water, lava
  and weather ones too, goes through it). three's own fog was `-mvPosition.z`, and at the
  corner of the frame a thing is only ~0.76 as deep as it is far, so "cut in full fog" was true
  in the middle of the screen and false at its corners. The far plane still cuts on depth,
  and distance is never less than depth, so the far-plane cut is in full fog with more margin.
- **The dither is for the people.** `web/js/fade.js` (a screen-hash `discard` on
  `length(mvPosition.xyz)`, spliced into `createBuildingMaterial`, so it stays in the opaque
  pass) is compiled into `crowdMat` only while `fadeNeeded(npcDistance, fogCeiling())` says a
  cut could be seen; NPC Distance can lie well inside the haze, and there a person dithers out
  over the last fifth before `beyond` in crowd-view.js (`NPC_PAD`) hands them back. The
  building material is never asked: its range *is* the fog ceiling. Decided in
  `applyObjectDistances` (sliders, the planner) against the ceiling, never the fog of the
  moment, and never per frame; `customProgramCacheKey` carries the `-fade`. The crowd's
  shadows fade with them through the material's depth twin (`mat.userData.fadeDepth`, the same
  band against `uFadeEye`, the camera copied in once a frame by `setFadeEye`), handed to every
  crowd mesh where it is made (`createFigures`). An imp is not given to a guard in the band
  (`inBand`, only while the dither is on), since its skinned material knows nothing of it.
- **The water patch is tiled per island** (`waterPatchPlan` in world.js, `tests/water-patch.test.mjs`):
  one vertex per unit only within `WATER_REACH` of an island's grid, every `WATER_FADE_STEP`
  in the fade into the ocean, one quad per row of open sea - the same outline and fade as the
  old single plane over the archipelago's bounding box, which was 2.5M of 2.75M triangles on
  a full page. Swell (`aWave`) goes to zero before the dense/coarse join so the two meet flat.
  The water shader fogs by `distance(vWorld, cameraPosition)` per pixel: a radial fog
  interpolated across the ocean disc's huge triangles over-fogged it.
  And a small dense patch sails with you (`nearWaterPlan`, `setWaterFocus` from main.js each
  frame: the walker or boat on foot, the orbit target from above), 5 x 5 lattice cells made
  only of the cells the plan draws coarse, whose coarse fragments inside its square are
  discarded (`uNear`, `aCoarse`) - so the swell is under your boat everywhere and nothing is
  drawn twice. Past the outline its rim slopes down `OCEAN_DROP` to the ocean disc: before
  it, a boat far from any island floated 0.2 over that disc.
- **Lighter machines draw less of what the distances do not reach**: `DETAILED` (guest
  islands drawn whole) is 1 on the phone, 2 on `modest`, 4 otherwise; a light phone renders at
  pixel ratio 1; a `modest` page stands as few volcano imps as a phone (`IMP_CAP.phone`).
- **Fog-free lights at the horizon fade before the far plane** (`horizon.js update`, reach
  0.9 of `camera.far`), and the sun and moon hang inside it (`world.setFar`).
- **`rec.group.visible` is not a rendering flag and must not be written per frame.** It is
  state: `applyVisibility()` owns it (filtered, alive in the chronicle, arrived),
  `popIn()` and a build clear it. The Object Distance cut is `layers.mask = 0` on the record's
  objects instead (kept and restored through `userData.cullMask`), a mask nothing else in
  the project uses; it takes the record out of the colour pass, the shadow pass and the
  raycaster (the body through its stand-in, which the batch then hides), and the frame loop
  skips its `animateExtras`. In `crowd-view.js` `f.visible` *is*
  only "drawn this frame" and `view.hide(f)` is free to use; the sea's state (`f.to`, `f.pos`)
  is never touched by the cut.
- **A settler who is not drawn is not an instance** ([Plans/DONE/verborgen-inwoners-tellen-niet.md](Plans/DONE/verborgen-inwoners-tellen-niet.md)).
  Every batch in `settler-figures.js` (the body, each hat shape, skirts, hair) keeps the figures
  it draws packed in front of `count`; a figure changing side trades slots with the last drawn
  (matrix and `instanceColor` in every mesh of the batch), `draw()` moves whoever it is handed
  across by `f.visible`, and `enrol` puts a newcomer on the undrawn side. Parking a hidden body
  at y = -999 inside `count`, as it was, still cost the GPU its vertices in both passes: 2
  million triangles on Hoogezand at NPC Distance 50. Swords, torches and every tool are counted
  per frame instead. So **a slot number moves whenever somebody else changes side**: read
  `f.slot` when you use it, never keep one across a frame. Per-figure bookkeeping lives in a
  `WeakMap` in `createFigures`, not on the caller's figure. `tests/settler-batches.test.mjs`.

**Nothing in the browser reaches the network without naming which machine it means.**
Every call goes through `web/js/api.js`: `mine()` for this island's own server (the garden,
the mail, the tickets, spawning agents) and `sea()` for the shared world. Assets go through
`web/js/assets.js` — `textureUrl()`, `modelUrl()` — because a loader's path is just as
absolute as a fetch and is far easier to miss. Both modules work their bases out from
`import.meta.url`, never from `location` or the document, which is what lets the island be
served from a subpath behind a reverse proxy; `shared/` is reached only through the import
map, never by climbing out with `../../`. `tests/api-base.test.mjs` holds all of that,
including a scan that fails on a bare `fetch('/`. To check it by hand, put any reverse
proxy in front and load the island at a subpath: everything must come from under it.

**A board says which island it is on, and a neighbour's board says whose it is.**
`lib/players.mjs` has accepted `<islandId>:prop:<uuid>` since the boards moved to the sea
and for a long time nothing sent one, which is plumbing with no button; `scopePanel` /
`ourPanel` in `shared/panels.mjs` are the button, and they must stay exact inverses —
`panels.all()` replaces the whole set, so one of somebody else's leaking in would empty
ours rather than merely clutter it. There is **one** panels layer, not one per island: it
is a CSS3D renderer *under* the whole canvas (`#panels` precedes `#stage`), seen through
a hole each board writes into the island's scene (alpha 0 + depth, `HOLE` in
`web/js/panels.js`) - which is why the renderer has `alpha: true` with clear alpha 1, and
why an opaque material that writes alpha below 1 would open a window onto the page. A foreign board therefore carries what that
layer cannot work out for it — world coordinates and its own `y`, because the layer was
handed our terrain — and renders blank with a sentence naming whose machine reads it.
That sentence is the feature: what a board says comes out of one islander's Jira token,
GitHub token and git checkout, none of which go on the sea, and an unexplained empty board
gets reported as broken.

**A tree does not cost a coastline.** A bundle is a snapshot and live is a stream, and the
two do not combine for free: a republish is 206 kB, makes every viewer drop a region and
build its ground and buildings again, and — since the sea walks the crowd — sends every
settler on that island back to their own front door. So what is *standing* on an island
goes through a door of its own, `POST /island/:id/parcel`, which updates the bundle and
broadcasts `{t:'island', a:'parcel'}` and **deliberately does not move `rev`**. `rev` means
"their island is not what we drew"; moving it is what triggers the rebuild. The cost of not
moving it is that a viewer disconnected across a patch misses the tree until the next scan
republishes — a minute at most.

Both halves are needed and they are not symmetrical: `packParcel` (forgiving, `context(false)`,
fills a missing `scale` in) on the sender, `parseParcel` (strict, refuses) on the sea. Props
in `props.json` carry only what whoever built them gave them, so raw props sent down that
door come back as "a measurement arrived as something that is not a number" and the tree
silently never appears anywhere else. It is the same asymmetry `buildBundle`/`parseBundle`
have always had; it only became possible to get wrong when a second door was cut beside them.

**A crowd is rebuilt on every publish, and the difference between two of them is the only
thing that knows who is new** (and the one thing carried over whole is the gold errand -
see the gold pit below). `createCrowd(island, { known })` is handed the ids the crowd
before it had; anybody not in that set walks up from the landing beach. `known` is null for
the first crowd an island ever has — and after a sea restart — so a whole village never
comes ashore at once, and more than `MAX_ARRIVING` (8) is a scan catching up rather than an
arrival, so nobody walks. No flag in the bundle and no timestamp to trust.

The idle sweep that retires a quiet connection (`lib/players.mjs`) only ever retires
somebody who is *walking* — an islander's own socket presence is its join
(`lib/seaclient.mjs`), and a watching page has no walker either, so before this a minute of
quiet closed those sockets too: forced republish, three rev bumps a minute, and every
settler walking back to their own door, on every screen, every sixty seconds.

**Four harbours, and boats counted rather than listed** ([Plans/DONE/vier-havens.md](Plans/DONE/vier-havens.md)).
`layout.harbours` is one slot per side (`HARBOUR_SIDES`, n/e/s/w from the town centre),
`null` like the fairway until planned, a `null` slot for a side with no open-water coast.
`planHarbours` picks each with `pickPier` narrowed to its side, but the quay the island
already shows *is* its side's harbour (`standingQuay`: the quay district's planks, else the
landing-derived quay the page and the sea already drew) - so nothing anybody saw moves.
Each harbour has a slipway `road:harbour:<n>` over the beach (BLOCKED, so forced back every
scan like a polder causeway) and `road:harbour:<n>:approach` to the square, planned *after*
`planBridge`, or an approach bridges the river first and the island's own bridge is never
built. The page, the sea and every other page derive the same docks and boats without a
message: `quaysOf` / `mooringsFor` in `shared/quay.mjs`, fed `island.harbours` (village.json,
and the bundle - strict in `parseBundle`). The island's first boat keeps `boat:<region>` at
the berth it always had, because older pages and seas find it by that id; the rest are
`boat:<region>-<side><k>`, derived from a per-side count in `data/boats.json`
(`lib/boatyard.mjs`, its own file so layout.json keeps one writer), capped at
`BOATS_PER_HARBOUR` (3, the one copy) where it is made, where it arrives and where it is laid
out. B at one of your own harbours posts `/api/harbour/boat` (keeper-only, not on
`PUBLIC_API`); the rescan after it republishes, and `harbourSig` in `applyVillage` is what
makes the new hull appear without a reload, since harbours are not districts. The village also
earns boats (`earnedBoats` in shared/quay.mjs: one every `FLEET_EVERY` settlers from `FLEET_AT`,
dealt round from the kadehaven, the first boat's harbour one fewer). scan.mjs writes
`max(built, earned)`, which never leaves 0..3, so an older sea moors exactly what a newer page
draws; B builds *ahead* of that count and never below it (`harbourRoom`), and `first: true` marks
the first boat's harbour in village.json only (the bundle's whitelist drops it). The sea's
outings grow with the crowd it walks (`outingsAtOnce`, 2 to 4) and sail round every plot that
lies on water (`waterPlots`). A bundle with no
harbours gets the one dock and one boat of old, so a world of mixed versions still sails.

The welcome carries **every** boat (`snapshot` in `lib/boats.mjs`), untouched ones at their
mooring - leaving those out let two pages that had heard different things draw one ship in
two places. The sea knows no galleon, so its mooring for `boat:<region>` is the Benchy's
berth; `onBoatFromServer` in main.js reads a position on that berth as `shipBerth`.

An unattended boat does not stay marooned either: after five quiet minutes the sea's own
beat walks it back to its home berth (`lib/boats.mjs`) — before this the one boat an island
has could be left on the far shore for good, recoverable only by restarting the whole sea.

**Two things about a crowd arriving on a screen.** Nobody is drawn before the sea has said
where they are: a body enrolled by a roster starts at its island's own middle, and drawing
it there put a stranger on the town square until its slice came round. And a joining client
is handed every position at once, once (`slices: 1` at the handshake in `lib/sea.mjs`),
because the beat's rotation takes `KEYFRAME_S` to get round everybody and watching a village
fill up over ten seconds is not a first impression worth having. The client holds that one
message while it translates the roster — see below — or it would be dropped in full, which
is exactly the ten seconds back again.

**A settler held in a conversation turns on every screen through `fh`, not through a row.**
A row has no heading and a held settler is `'still'`, so the page used to leave them facing
the way they had been walking. The sea works the whole held set out of `f.attend` every beat
(`encodeHeld`: `[idx, x, z, …]`, the talker's spot in the island's own frame) and broadcasts
`{t:'fh', i, h}` only when it changes, plus one per island - empty too - in the join dump, or a
page back from a sea restart keeps the old word for ever. Derived rather than hooked on
attend/release, because `f.attend` is also cleared by a guard falling, a resident moving and a
republish, and a compact renumbers. `crowd-view.js held()` keeps it by index (it can land before
our roster is translated) and `draw` faces a *standing* body at the talker at the walk's 0.12.
Anything that names one of our settlers *to* the sea goes through `seaIdOf` in main.js (the
inverse of `/api/crowd-ids`): `faceUp` sent `house:<uuid>` and the sea held nobody.
A conversation lasts until it is ended - Escape closes the chat, the town hall or a keeper's
words (`parley`, `endParley`, `ui.setSpeech`) - and the caller of `faceUp` pauses walk mode
first: with the feet still running, walk mode's stance beat `web/js/facetoface.js`'s follow and
the camera swung in to a keeper and straight back up. `faceUp` also says the hold again every
`HOLD_AGAIN_MS`, because a crowd rebuilt by a republish starts with nobody held, and hands
facetoface a *finder* rather than the figure, because the rebuilt roster is new objects.

On the drawing side `rev` only decides whether to refetch, never whether to rebuild:
`web/js/islandsig.js` compares a `drawnSignature()` of what is already standing against the
new bundle, because a neighbour's landscape costs the same ~550 ms to build as our own
(trees, fields, hamlets, through the same `createLandscape`), and rebuilding it on every
publish from an active neighbour stalled the frame — `dt` included — three times a minute.

**Everything another machine moves is drawn on one timeline** (`web/js/timeline.js`:
`LAG_MS`, `MAX_EXTRAPOLATE_MS`) - the other players in peers.js and every hull somebody else
is steering (`glideBoats` in main.js, a short track of samples rather than a pair, run before
the peers). A pilot is drawn standing on their hull (`seatOf`), never on their own pose: on
two timelines they part by as far as the boat goes in the difference. `'boat'` in a pose is
a room to the sea (`afoot` in lib/hostility.mjs) and a hull to peers.js (`BOAT_ROOM`), not a
place - read as a place it hid every pilot. [Plans/DONE/lopen-op-de-boot.md](Plans/DONE/lopen-op-de-boot.md).
Standing on a deck is a position in the hull's own frame (`shared/deck.mjs`, trig-free: a
hull comes in as `{ x, z, fx, fz }`, `frameOf` in lib/boats.mjs), and what a boat holds is
`shared/crafts.mjs`, the one copy (every boat is a Benchy, `crew: 1`). The sea takes a deck
pose (`on` + `d`) only from somebody `aboard`, clamps it to the planks, works the world
position out itself, and sends decks as their own list `d` beside the rows - a row's slots
are fixed and an older page must read it unchanged. Aboard is not afoot (`pilotsOf` counts the
crew). Walk mode sets `state.deck` on the galleon only (`CRAFTS.galleon`, the pirate ship,
crew 5): E at its wheel is *leave the helm* (`letGoBoat`, and E again is `takeBoat`), the hull
coasts under `stepBoat` with the gas off while you walk it (`stepOnDeck` in walk.js) - and a
ship is heavy: `CRAFTS.galleon.sail` carries her own `drag`, `creep`, `bite`, `astern`, `yawLag`
(a yaw rate `b.w` eased towards the rudder, only on a hull whose craft sets it) and `accel`, so she
takes 6 s to top speed and runs out ~45 s / ~130 units, and `runOut` (60 s) is how long the sea takes
her position from whoever let go (`coastOf` in lib/boats.mjs, else `COAST_MS`): keep it above the
run-out from full turbo or she freezes for everybody else while her own page still sails her
(`tests/boat-inertia.test.mjs`). Nothing steps a hull nobody is aboard, so a ship you jump or
climb off (`letRun` in walk.js, the three `onLeftDeck` sites) is kept in `loose` and stepped by
`walk.runOut(dt)`, which main.js calls every frame in every mode until she stops, somebody else has
the wheel or you are on her again; she is `runningHull()` there, whose position is sent like
`ownHull()`'s and whose echo from the sea is not taken back. Escape from the deck is not that:
`exitWalk` stops her on purpose (`tests/ship-runout.test.mjs` drives the real walk mode headless).
And `ownHull()` in main.js is the hull that is ours whether at the wheel, on the planks or on her
ladder. **A ship has no key to board or leave** (`isShip` in main.js: no `boat` interactable,
none from a dock): she is boarded by walking into the foot of one of her two rope ladders
(`craft.ladders`, at z 1.85 because the gun ports stand out to 2.63 everywhere else along the
waist; `ladderUp`, and `ladderDown` from the deck, in `shared/deck.mjs`), which you climb along a
path in the hull's frame (`stepClimb`: pushing at the hull is up, away is down, no push hangs
you where you are, a jump lets go) and which tells the sea at the top (`boardBoat`, so you are crew)
and at the foot or on letting go (`leaveBoat`); and she is left by
jumping - a rail with a `top` is a bulwark that a body with its feet above it goes over, a mast has
none - after which you fall on from where you are with the hull's speed in `drift`, not into a
teleport. **The ship is her own hitbox** (`shared/hullwalk.mjs`, Plans/DONE/lopen-op-de-boot.md). A deck
made of rectangles and a list of rails, worked out by hand, was wrong somewhere new every time
(a staircase walked as a step, then the round plinth at the wheel), so the page walks the model:
`scripts/build-shipwalk.mjs` cuts the baked hull with a vertical line through every 5 cm square of
her plan and writes where it meets a surface, at what height, and whether it is one to stand on
(`web/js/shipwalk-map.js`, generated - `npm run models` cuts it again after baking her, and
`tests/shipwalk.test.mjs` fails on a stale one). Floor is the highest surface within a step of the
feet with a body's air above it, an obstacle is anything at all in a body's height above that,
and a footprint has to be held up all round, so a bulwark's top is not walked along and a ledge is
not walked off: what is left is a jump. The sea walks nobody on a ship and clamps a claimed
position to the coarse rectangles of `shared/crafts.mjs` (also where a ladder lands, and the
fallback for a craft with no model); `tests/deck-bake.test.mjs` keeps those honest against the bake.
Anywhere a body is *put* on a ship (where a ladder lands, a pace ahead of the wheel) is
`nearestStand`, never a coordinate. The wheel's plinth is the model's (`SHIP_HELM`).
**A hull is a reference plane** and whoever is on one stands on *that*: a point of her own frame
read off the transform she is drawn with this frame (`hullPointOf` in boat.js; `poseHull` in main.js
places and swells her at the frame's clock first, and the fleet loop repeats it, which is
idempotent), not `toWorld` plus a height - a pitching hull moves her deck sideways as well as up,
0.05 on a deck 1.16 over her pivot, which is feet sliding over the planks on a settler half a unit
tall. The body leans with the plane (`hullTiltOf`: her rotation less her heading) and walk mode's
camera stands in a share of it (`CAM_TILT` 0.25: offset turned and `camera.up` tilted by that much
of the plane; all of it put the camera on a lever as long as its 27 units behind a ship's wheel and
rolled the horizon with every swell); `exit()` puts the camera upright again. Peers on a deck and a
ship's pilot at her wheel are drawn the same way (`hullOf.point`/`tilt`, `seatOf`). The ladder is
drawn from the same `craft.ladders` numbers and welded into the hull's
geometry (`ladderBoxes`, boat.js), so it is no extra draw call and cannot drift from the one you
climb. Whoever else moves the hull you stand on - another pilot, or one running her out after
`letGo` - is followed, not stepped: `hullFollowed` in main.js, handed to walk mode as `following`,
and `glideBoats` still glides that hull. Plans/DONE/lopen-op-de-boot.md. `kindOf` makes every island's first boat
(`boat:<region>`, no suffix) the galleon, for the sea and every page alike, and `shipBerth` in
main.js lays it in deep water off a berth cut for a Benchy - by arithmetic on the ground, so
every page agrees. A sea from before this counts the ship's crew as one and holds nobody on
its deck: the open sea has to be redeployed before others see you walk it.

**Other players are drawn with your own rig** (Plans/DONE/andere-spelers-zoals-jij.md): peers.js
gives each one a `createClassicAvatar` in the look their page sends (`{t:'look'}`, on every
connect and from the studio's Apply; the sea checks its shape in `lookOf` and hands it on in
`identity`, the page runs it through `normalizeAvatar`), driven by the pose bits - `LYING`,
`CROUCHING`, `SITTING`, `DANCING` are 256/512/1024/2048 (`POSE_MASK` is 8191 now, with `ASLEEP` 4096 above them) - and by events for
the arms: `{t:'swing', side}` goes to combat and on to the others as `swung`, `{t:'drink', side}`
as `drank`. Events, not bits: a swing is over in less than two pose beats. A dance is a bit
because it lasts (R, [Plans/DONE/dansen.md](Plans/DONE/dansen.md)), and only the bit crosses: every page
picks the move from the dancer's id (`danceStep` in `web/js/dance.js`, the one copy of the
moves the rave's settlers dance too) and dances them to the beat *it* plays (`danceBeat` in
main.js: the hall, else the music, else the wall clock at the song's tempo).

**The sea walks every crowd, ours included, and the roster it sends back is in redacted
names.** A published bundle is the same bundle a stranger is handed — `guestVillage`
renames `house:<uuid>` to `house:s3` — so the sea knows our settlers by names this page
never drew a house under. The islander is the only thing that can join the two, because it
did the renaming, and a shed's id in particular cannot be reconstructed from outside
(`shed:s3:x7` carries a counter). So `buildBundle(…, out)` hands back
`renamed -> real`, derived from the two arrays rather than from the swap table — `clean()`
maps an array to an array, so position is preserved by construction and a rename added
tomorrow is carried for free. It reaches the page through `GET /api/crowd-ids`, which is
**deliberately not on `PUBLIC_API`**: it is the exact inverse of the redaction, and one
request would undo all of it. `tests/crowd-ids.test.mjs` asserts both halves.

A settler with no face is what a broken mapping looks like, and the temptation is to make
the route public to fix it. Don't.

The other direction needs the same map: anything that names one of our settlers *to* the
sea (`net.attend` from `faceUp`) goes through `seaIdOf` in main.js, because our own
`house:<uuid>` is nobody on the sea - it was sent raw for a while and every conversation let
the settler walk on. A crowd row on the wire is `[idx, x, z, anim]` with no heading, so what
turns them towards you on every page is the separate `fh` message (above), not the row.

**The settlers walk in `shared/settlerwalk.mjs` and are drawn in
`web/js/settler-figures.js`, and two things cross between them.** The walk writes `f.anim`
each step — `walk`, `step`, `hammer` or `still` — and the renderer derives the bob, the
gait, the arm swing and the idle sway from it off its *own* clock; and it writes `f.face`
plus `f.turn`, a direction and how briskly to turn towards it, because an *angle* needs
`atan2` and the walk may not have one. None of the cosmetic sine waves feed back into a
position, which is what made the split possible; keep it that way, or the drawing becomes
something the wire has to carry.

The walk obeys `shared/`'s rule in full: no transcendental functions, no clock, no three.js,
and `tests/settler-walk.test.mjs` asserts all three by reading the source. It counts *ticks*
(`advance(n)`, `DT = 0.05`) rather than taking a `dt`, because two runtimes accumulating
wall-clock time diverge immediately however identical the code is. That test file
deliberately registers no loader and stubs no `document`: the moment it needs one, something
has reached back into the browser and the sea can no longer step a crowd.

Three more rules hold the seam. The walk's rng stream (`<id>:walk`) is ordered and
load-bearing, so anything cosmetic draws from `<id>:gait` instead and never from the middle
of it. A figure's errand hooks are records (`f.after`, `f.then`), never closures, because a
closure cannot be compared against another machine's copy or resumed after a restart;
`f.onDone` is still a function and only for `walkIn` and `sendOut`, which are somebody
else's errand. And the door a settler stands outside comes from `DOOR_DIR[plot.rot]` alone —
`placeFigure` used to pass the building mesh's own yaw, which the sea does not have; the two
were checked against each other for all four rotations and agree exactly.

**Nothing is fetched at boot.** Blender sets are baked into ordinary modules
(`web/js/*-mesh.js`) imported synchronously through `web/js/models.js`, so every shape
exists before the first line of `main.js` runs. Do not introduce a loader: the boot screen
stuck on "Charting the island…" is a failure this project has already had. The one deliberate
exception is the volcano's lava imp (`web/js/imp.js`, a skinned GLB a bake cannot carry): a dynamic
import of GLTFLoader and SkeletonUtils through `modelUrl`, allowed only after `state.ui.boot(true)`
(`allowImp()`) and started only when a volcano crowd has a guard to swap; a failed load is logged
once and every guard stays an instanced figure. Nothing may await it - keep any future model on
that pattern. Every `guard:<n>` is drawn as an imp (Codex lodgers stay settlers), and a skinned
mesh cannot be instanced, so the rules that make that affordable are load-bearing: each imp is a
`SkeletonUtils.clone` sharing **one** geometry and **one** shader program - each imp has its own
material copy, made once at creation for the hit flash (same patch, same cache key, so three
compiles once), and neither is ever disposed with an imp (guards respawn every 20 s); culling stays on through one `boundingSphere` that holds every pose
of every clip (`cullSphere`, sampled against the real GLB in `tests/imp.test.mjs`); an imp not
drawn last frame (`onBeforeRender`) or over `ANIMATE_RANGE` (40) from the camera skips its mixer
unless it is mid-swing; and only the nearest `IMP_LIMIT` to the camera are imps (16 desktop, 6 with
`STANDALONE`; `pickImps`, holders kept by a 0.8 distance factor), the rest instanced figures.
Clips: `idle` (phase hashed from the guard id), `walk` in place at 0.346 m/s scale 1 (timeScale
follows the body's speed), `swim` whenever the ground under it is below `SEA_LEVEL` (the model
lowered so the surface is at 0.50 m of it, instead of the settlers' `WADE_Y`), `attack`;
`walk-rootmotion` is dropped at load. A new GLB means re-checking `IMP_HEIGHT_M` and the sphere.
SkeletonUtils is a new vendored file: a checkout that has not run `npm install` (or
`node scripts/vendor.mjs`) since then gets the logged failure, not imps.

**A room's own sets load at its door, never at boot** (the second exception): `models.js` `LAZY` holds the
Salty Kraken's hall (`piratetavern_room`, 34 MB) and its ship's parts (`krakenkit`), imported on demand by
`loadSet`; `interior.js` `ROOM_SETS`/`prepareRoom`/`roomReady` say which room needs which, main.js starts
them as soon as that room's door is within reach and `enterInterior` waits for them ("The door sticks a
moment..."), and `pack-android.mjs` leaves them out of the app (the phone has no rooms). Everything the
island itself draws stays in `SETS`. The hall's every number is `web/js/kraken-layout.js` (read by
pirate-tavern.js and, through `scripts/kraken-layout-json.mjs`, by the bake) and its props'
`web/js/kraken-dressing.js` (`PROPS` + `FOOT`, from which pirate-tavern.js derives the blockers):
change a floor or a prop there and rebake, never in two places.

**The bicycle is `state.bike`, never `state.vehicle`** ([Plans/DONE/fiets.md](Plans/DONE/fiets.md)).
`vehicle` means the boat to every `aboard()` in main.js and net.js (hull sync, berth, the
boat's stamina pool), so a second kind of vehicle in it would make them all lie. F (pad Y)
mounts and dismounts in any walk mode created with `bikes: true` (the island and `/demo`, not
rooms); the bike comes out of the satchel and goes back in, so no server state exists for it.
`stepBike` (`web/js/bicycle.js`) is pure like `stepBoat` and takes walk.js's own `groundAt` and
`blocked`, so water, walls and ledges above `STEP_UP` stop it exactly as they stop feet. Space hops with
the feet's own `JUMP_V`/`GRAVITY` (copied into `BIKE_HOP`/`BIKE_GRAVITY`, the test reads walk.js);
in the air water is no wall, and a landing in it sets `splash`, on which walk.js puts the bike
away and leaves a swimmer. The camera on a bike is free: any look input resets
`riddenSinceLook`, and it only trails the bike again after `RECENTRE_AFTER` of riding (the boat
still trails every frame). The mesh
hangs each baked part (`scripts/build-bicycle.py`) on its Blender origin, and the steering axis
is read off the steer and front-axle origins - move a pivot in the builder, not in JS. Peers
see a rider through `FLAG_RIDING` (128, within `POSE_MASK`); a sea still running the old
`lib/players.mjs` masks it away, so a remote-hosted sea has to be redeployed before other
players see bicycles.

**There are three processes now, and only one of them is dangerous.** The *sea*
(`sea.mjs`, `lib/sea.mjs`, `lib/fleet.mjs`) is a clock, a fleet and a relay whose one island
of its own is the volcano (below): it reads no transcripts, never scans, and **writes nothing
to disk**. That last
one is load-bearing rather than an omission - it is what means there is no schema, no
migration and no upgrade path, and a restart is a second of blank water while everybody
reconnects. The *islander* (`serve.mjs`) owns this machine: the scan, `data/`, the agents,
the mail, the tickets, and it listens on loopback only. The *client* draws both.

Single player is not a mode. `serve.mjs` starts a sea in its own process bound to loopback
and joins it with one island in it; hosting is that same sea bound to the network; joining
is somebody else's address (`config.multiplayer.sea.mode`, changed at runtime through
`POST /api/sea`). One code path — the difference between being alone and being in company
is how many rows are in `world.islands`. There is deliberately no offline mode to keep in
step, because that is two drawing paths and a class of bug that only appears in front of
other people.

Two rules that hold the world together. **An island never moves once it has an origin** —
`nextOrigin()` in `shared/regions.mjs` is the policy and `clearOf()` is the invariant, and
a newcomer that shifted the fleet would slide the world under the feet of everybody
standing on it. And **the page draws its own island at the scene origin whatever berth the
sea gave it, and translates the world instead.** There is no offset group for home — the
ground, the houses, the hamlets and the quay hang straight in `scene` on local
coordinates — so `state.homeOrigin` is the berth in the *sea's* frame and nothing more than
a translation: applied at the socket in `web/js/net.js` (poses, boats and `attend` gain it
going out and lose it coming in) and wherever a fleet row's origin becomes a region
(`joinIsland`, `syncHorizon`). `worldToScene` / `sceneToWorld` in `shared/regions.mjs` are
the two lines. It is read off the fleet every time the fleet is news (`rehomeFrom` →
`rehome`, which takes every guest region down to be raised again), never only at boot: a
joiner's page is connected before its own islander has published, so its berth arrives a
moment after the welcome. Placing home *at* `homeOrigin` was tried first and is the wrong
half: the region moved and nothing drawn moved with it, and the host — at the sea's origin,
which was also the page's — was refused as overlapping home and shown as mist. The volcano
holds `[0,0]` now, so the host's page translates exactly like a joiner's; the identity is left
only for a sea raised with `volcano: false` (tests). Poses still travel in world
coordinates; the local terrain is still origin-centred and `layout.json` is still local.

**The sea's one island is the volcano, and it is nobody's.** `shared/volcano.mjs` is its whole
identity (id `0000000000000000`, seed `'volcano'`, size 192, `hostile`, `volcano`);
`createSea` raises it through `fleet.raiseVolcano()` at `[0,0]` before anybody joins, so a
restart raises it bit for bit and the disk rule survives. Everything that makes an island
somebody's is refused for it (`sea: true` on the fleet row): no token, so `publish`/`patch`/
`claim` refuse it; never quiet or swept; not counted against `MAX_ISLANDS` (`fleet.players()`
is what `max` reads, `count()` is the world); no landing, so `shared/quay.mjs` gives it no
dock and no boat. Nobody else may publish `volcano: true`. It travels like any island -
`volcanoBundle()` goes through `parseBundle` - and `island.volcano` has to reach every
`makeTerrain` that builds ground from a bundle (fleet publish, `parseBundle`, `joinIsland`,
the horizon row, which carries `volcano` because a silhouette never sees the bundle), or the
middle of the world is an ordinary island and a skew banner. Its seed is the one word
`parseBundle` accepts, and only beside `volcano: true`. `nextOrigin` treats whoever holds
`[0,0]` as the middle: ring 1 lies at its half + `SEA_GAP` + the biggest other half, but never
inside one pitch (176 for 64-grids round the 192-grid volcano, 208 for 128s, 304 for 256s,
432 for a starter's 384 of room - tighter than the pitch a ring holds only east and west, and
the open sea was a line; eight to a ring, bearings first, round the compass from east), later
rings one ordinary pitch further, so the volcano does not spread everybody else
out. Its shape (`volcanoGround` + `volcanoRelief` in `shared/terrain.mjs`): a buildable apron
up to ~3.5, then a concave cone to a rim ~38 up (summit 41, crater ~10 deep), with radial
ridges and ravines, broken cliff bands, crags, a jagged rim breached where each of its three
flows leaves, three parasitic cones (`crater.vents`) and old lava fields (`terrain.oldLava`,
painted dark by world.js). The relief is added *after* makeTerrain's box blur - blurred, a
feature a few cells across is gone - and world.js paints its bands off `crater.top`, not in
units. A* on it is ~5-10x dearer than on the 128 cone (30-65 ms beach-to-rim, `findPath`'s
`open.sort`), which the hostility tick's 3 searches per 650 ms pay for.

**Beside it, the starters: the sea's too, but made to be taken** ([Plans/DONE/starter-eilanden.md](Plans/DONE/starter-eilanden.md)).
`starterBundle(slot)` (`lib/islandbundle.mjs`) is a 64-island with a square, well, tables,
tavern and town hall - so an innkeeper and a mayor, no settlers - from the slot number alone;
`fleet.raiseStarters()` keeps `STARTER.free` (3) unclaimed, berthed with `nextOrigin` after
the volcano, each holding `STARTER.room` (384, so `reach` 192). On the fleet they are
`sea: true` + `starter: true`: never swept, `claim`/`patch`/`vouch` refuse them, but unlike the
volcano they **count against `MAX_ISLANDS`** (`places()`; `players()` stays real islanders
only). A newcomer's `publish` takes the berth of the first starter it fits in and returns it
as `island.took`; `lib/sea.mjs` then `retireStarter()`s it (crowd off, walkers on it
`evicted` to their skiff or square via `health.refuge`, `gone` before the newcomer's
`joined`) and `topUpStarters()` puts out the next slot - slots are never reused in one run.
`createSea({ starters })` defaults on; the test helpers default it **off** (`starters: false`
in `tests/support/sea.mjs` and the sea tests' own `createSea`), because every berth and
island count in them assumes an empty ring - pass `starters: true` to test them. The fleet
row carries `reach`, and the phone's `standaloneHome()` lays its open-water berth on it: on
`gridSize / 2` it put its skiff inside the room a starter holds for its claimer.

**The volcano's lava has bridges, and they are ordinary bridges.** `volcanoBridges()` in
`shared/volcano.mjs` picks three crossings per flow (apron, mid-cone, high cone) from the
terrain alone - axis-aligned, exactly over the lava + bank run, landing on plain ground -
and `volcanoBundle()` ships them as `bridges` + `decks`, so the sea's crowd stands on them
(`setDecks`), `lib/lava.mjs` lets anybody on one off, and the guards' reach mask
(`lib/hostility.mjs reachOf`) keeps a *bridged* lava cell walkable: the bridges are the
chokepoints. Both use `DECK_CLEAR` (hostility.mjs, the one copy). Deck heights repeat
`bridgeStops` from `web/js/buildings.js` (the sea may not import `web/`), with Bhaskara's
sine for the arch because `shared/` may not call `cos` - under a millimetre off what the page
draws. `guest-island.js` draws any guest's `bridges` (one merged mesh, one draw call - no
neighbour's bridges were drawn before) and `handOutDecks` in main.js gives walk mode every
guest region's bundle `decks`. `codexPlots` and `guardhouseSite` refuse any lot on a bridge
cell or where one lands.

**One building has many residents: the volcano's guardhouse and its guards.** The bundle
carries one building, `civic:guardhouse` (drawn as `civicType: 'castle'` until there is a
model - `GUARDHOUSE_LOOKS_LIKE`), placed by `guardhouseSite()` from the terrain alone.
Its residents are not in the
bundle: `lib/guards.mjs` counts islanders online (`live`, non-sea, **non-hostile** islands -
an older islander's separate Codex island is hostile, so in a world of mixed versions one
islander still counts once) and calls
`crowd.addGuard()`, which **appends** `guard:<n>` to the running crowd; the sea then
broadcasts the roster and everybody's position at once (`onRoster` in `lib/sea.mjs`). Never
`crowds.join` for this - that rebuilds the crowd and walks every guard home. Target is
`guardTarget()` (`GUARDS` in `shared/volcano.mjs`, the one copy); only a rise acts at once,
a fall hides nobody, and `guardDied(id)` (for step 7) leaves a `null` hole in `crowdRoster`
so no index moves and respawns after `RESPAWN_MS` only while below the target. The page
dresses a `guard:<n>` against the guardhouse spec with the guard's own id
(`web/js/crowd-view.js`), which is what makes them individuals. Because guards walk on every
sea from the first beat, `broadcast` in `lib/sea.mjs` reaches **joined** sockets only - before
that, a socket's first message was as likely a crowd frame as its welcome.

**There is no Codex island any more: every islander's Codex settlers live on the volcano.**
The islander publishes one island; `codexSettlers()` in `serve.mjs` reads the Codex scan's
`data/codex/village.json` (the scan and its `layout.json` carry on, but nothing places a house
from it) and `packCodex` - the same `guestVillage` redaction a bundle gets, so `house:s3` and
never a uuid, prompt or path - gives at most `CODEX.PER_ISLANDER` (60) `{id, style, tier, kind,
active}`. `seaClient.sendCodex()` posts it to **`POST /island/:id/codex`** after every publish
when its hash changed, and forced on every welcome; a 404 is repaired by publishing first.
The sea's door checks the key first (`keyOpens`), then **`fleet.vouch`** - the island's own
claim token, and an untokened island cannot be spoken for at all - then `parseCodex`, which is
stricter than `parseParcel`: an unknown field, a duplicate, a number for a word or 61 entries
refuses the lot. `lib/residents.mjs` puts them up: a house on `codexPlots()` (300 3x3 lots on
a pitch-4 lattice, off the guardhouse by `CODEX.CLEAR`, doors downhill) at `hash32('codex:<island>:<id>')
% pool`, linear probe when taken, assignments kept until their own settler leaves - so neither
an arrival nor a departure moves a standing house; the rest **lodge in the guardhouse**
(dressed from their own id, like guards) and move in when a plot frees; past `CODEX.RESIDENTS`
(360) bodies they wait in the list. Residents are **added to the running volcano crowd**
(`crowd.placeResident` / `removeResident`: appended, departures are `null` holes, `compact()`
closes them past 64 and renumbers - the sea then forgets `onWire` for that crowd), never a
`crowds.join`. The houses go into the volcano's bundle through `fleet.furnishVolcano`
**without moving `rev`**, and the sea broadcasts `{t:'island', a:'codex', i, houses}` (the
whole set) *before* the roster and positions. The page takes it like a parcel: `region.village`
updated, `guest.applyBuildings()` raises/lowers only the changed houses (no landscape rebuild),
`crowd.setBuildings()` re-dresses whoever moved; `drawnSignature` leaves `codex:` buildings out.
The sweep that drops an islander after `GRACE_MS` calls `residents.drop` - houses and residents
go, guards and the volcano stay. `settler-figures.js` now reuses freed slots (`free`), because
the volcano's crowd churns for as long as the page is open.

**The story animals are the islander's to remember and the sea's to walk**
([Plans/DONE/dierenverhalen.md](Plans/DONE/dierenverhalen.md); the wire is
[docs/animals-wire.md](docs/animals-wire.md), the disk [docs/animal-story-storage.md](docs/animal-story-storage.md)).
At most six named animals per island (`shared/animals.mjs`, the one copy of species, traits,
acts - wire order, append only - and trace kinds): a hen first, then a goat and a sparrow.
`lib/animal-stories.mjs` is a reducer with no clock: `decide*` makes every choice (off a
stream seeded by the island's salt and the event's sequence) and writes the *outcome* into
the event, `applyAnimalEvent` only checks and applies, so a replay never rerolls and a rule
change only touches future choices (`rules` in each event). `lib/animal-store.mjs` keeps
`data/animal-events.jsonl` - **irreplaceable, like layout.json** - flushed per event,
replayed in full on open, torn tails kept aside, one writer (`animal-store.lock`, taken over
only from a pid that no longer runs). `lib/animal-life.mjs` runs it from serve.mjs: after
every scan (`animalsLook`, also 1.5 s after the keeper's page connects, because the first hen
arrives only while somebody is watching a working island) it asks for an arrival, lets go of
stale errands, turns new activity into errands and finds ground for earned marks
(`lib/animal-places.mjs`, which uses the garden's own `groundCheck` - a nest never goes where
a bed would be refused). Activity is `humanTurns + assistantMsgs + toolCalls` per house, an
opportunity rather than a reward: only the cursor a visit consumed is journaled, in the same
event as the visit; one notable encounter per animal per 20-minute window, three per island
per hour, one label change per animal per day (labels have hysteresis). The errand goes to
the sea through **`POST /island/:id/animals`** (key, then `fleet.vouch`, then the strict
`parseAnimals` of `lib/animalbundle.mjs`; `packAnimals` is the forgiving sender) and counts
only when the sea says `{t:'animal', a:'done', gen}` **over the islander's own socket** -
`lib/seaclient.mjs` counts `gen` up on every welcome and re-posts everything, and
`animalLife.complete` refuses any other generation, so an interrupted errand runs again and
a completion heard twice counts once. That message is the one thing the islander acts on from
the sea; it is still not an inbound route. The sea (`shared/animalwalk.mjs`, trig-free and
tick-counted like settlerwalk; `lib/animal-crowd.mjs`) keeps herds in memory like everything
else and broadcasts **`{t:'herd'}`** (who, and the marks) and **`{t:'af'}`** (seven numbers a
row) - their own `t`s, because a page from before them reads any unknown `{t:'island', a}` as
a fleet row. `rev` never moves for an animal. A sea older than the door answers `no route`,
which the seaclient says once and leaves until the next welcome. The page draws every island's
animals through one shared instanced batch (`web/js/animal-view.js`; `web/js/fauna.js` keeps
the joint animation, `/demo` and the stable still move on their own through the same pose) and
explains them from `/api/animals` (not on `PUBLIC_API`: real house ids and the whole diary) in
`web/js/animal-dossier.js`; a visitor gets only the public card the sea carries, with settlers
under their redacted ids. `config.animals.pace` divides every story duration for playtesting.

The line home (`lib/seaclient.mjs`) goes one way on purpose: the islander reaches out, the
sea never reaches in. That is what lets `lib/access.mjs` stay strict — the island needs no
route open to anybody — so an inbound half would be a change of posture, not a convenience.

**The sea can go in a box; the islander never can.** `Dockerfile.sea` copies `sea.mjs`,
`lib/` and `shared/` **by name** and not the tree, because the tree holds the scanner, the
mail server and the agent dispatcher. That naming is also the failure mode — an import into
a fourth folder works here and produces a container that dies on its first line, on a box
nobody watches — so `tests/sea-image.test.mjs` walks the real import graph and checks every
file in it is inside something the Dockerfile copies. `--open` in the `CMD` is not optional:
inside a container, loopback is nobody, and what keeps the sea shut is the network it is
published on plus `SEA_KEY`. No volumes, deliberately.

**Which code is running is baked in, not read.** The sea may not touch `node:fs`, so its
version and commit live in `lib/build.mjs` (null in a checkout) and `Dockerfile.sea`'s
throwaway first stage overwrites it from `scripts/stamp-build.mjs` - the only stage that
copies the whole tree, which `tests/sea-image.test.mjs` holds. An islander hands its own sea
`readBuildInfo(ROOT)` (`lib/buildinfo.mjs`: `release.json` for a release, else
`package.json` + `.git` read by hand), and the tray shows the same through `build_label` in
`src-tauri/src/island.rs` - one rule in two languages, keep them agreeing. They surface in
`/health`, the welcome (`build`) and the front page. Compatibility is still `SEA_V`, not the
commit: bump it when an old peer would misread a message, not for an addition it can ignore.
`SEA_PROTOCOL` in `web/js/update.js` is the page's copy (`tests/update.test.mjs` holds the
two equal). The page knows its own release from `/api/hello` (`build`) or, in the app, from
what the pack baked in, and compares it with the welcome's on every connect: older is a
banner with the release link, newer says the sea is behind - by `version`, never by commit,
which differs between players on the same release all the time, and by the *line* only
(`compareLines`, major.minor): a patch apart says nothing - except on the phone, whose
`updateGate` compares whole versions, because a phone cannot pull and that card (with a
Later) is the only way a patch ever reaches it. **A patch release never breaks
compatibility with the island or the sea** (0.4.x runs on any 0.4.y's island and meets it on
any sea): no `SEA_V` bump, no layout gate (`LAYOUT_VERSION`, `PARCEL_VERSION`,
`TOWN_VERSION`, `ROAD_VERSION`, `SQUARE_VERSION`, `QUAY_VERSION`), nothing in `layout.json`, `config.json` or
a bundle that an older 0.4.x would misread - a release and a checkout share one island in
`~/.promptholm`, and an older one on a newer layout plans the town again. Any of those is
the next minor.

The sea also serves its own front page — no file on disk (the disk rule above forbids
that), an inline string in `lib/sea.mjs` that fetches its own `/health` and `/world`. Its
one button is a restart, wired to `POST /update`, which asks for a Portainer/webhook URL in
`updateHook` — but the key check runs *before* the hook check, on purpose: checked the other
way round, an unkeyed sea's 501 ("no hook configured") would tell an attacker it has no lock
on the door at all. And closing the sea now walks every open connection
(`closeIdleConnections()`/`closeAllConnections()`) instead of waiting for the websocket ping
to notice — a sea holds nothing on disk to flush, so there is nothing a graceful wait
protects, and a browser left attached had been stalling a restart up to 62 s (25 s ping ×
2.5) before this.

A sea says *that* it wants a key in `/health` (`keyed`), never which one — without that the
picker cannot tell a sea that will have you from one that will turn you away, and the only
way to find out is to move the island and watch it be refused. A refusal is also said
**once per reason, not once per attempt**: `net.js` keeps retrying, which is right, but none
of these reasons fix themselves, so the loop turned one problem into a toast every few
seconds — in the wire's own vocabulary ("key"), which tells whoever wrote the protocol what
is wrong and tells whoever has to fix it nothing.

A sea that does not answer at all is the same rule with no refusal to hang it on: since the
sea walks every crowd, it is an island with nobody on it (26 September 2026, twelve minutes
of it, found only by asking). After `QUIET_MS` (10 s, past a sea restart's blank second)
`lib/seaclient.mjs` logs it once, naming the address, and says `back after …` on the join;
`net.js` says `onStatus('quiet')` once, and main.js puts `web/js/seaquiet.js`'s sentence in
the skew box (`setSeaQuiet`) until a socket opens - with **On my own** as the hint only for
the keeper, only when the sea is somebody else's (`seaMode`/`seaOpen` on `/api/hello`).
Pitfall that made it worse: Node's own WebSocket (undici 6.21, Node 22.16) fires `error` and
never `close` for a socket that failed before it opened, and `close()` on one recurses until
the stack runs out - so a retry hung only off `close` stops after the first failed attempt.
The islander's line home ends an attempt on either event, once (`gone`), and closes only a
socket that opened.

`SEA_KEY` is optional and only for a private sea - the open sea has none, so a Windows
release and the phone app can both just join, and `POST /update` is locked by
`SEA_ADMIN_KEY` instead (falling back to `SEA_KEY`). When set, it is shared by everybody in a world. Each islander keeps it in
`multiplayer.sea.key`, and **its own page is handed it over loopback** in `/api/hello` —
never a visitor, who could otherwise park an island and wear a name there. Without that
hand-off a sea that gets a key locks out the browser of the very island publishing to it.
The same key also guards `/island/:id`, `/island/:id/parcel` and `/island/:id/codex`, not only the socket join —
`seaClient` posts over HTTP regardless of whether its own socket was accepted, so before
this an islander refused at the handshake still parked its bundle over HTTP under a token
that outlived the refusal, for good.

**While the islander runs, the sea keeps its island.** The claim token is kept in
`data/sea-token.json` (under `home`; an old `codex` entry is left alone), not minted per process: a fresh token made every
tray restart a stranger to its own island, refused as `claimed` until the old claim's
`GRACE_MS` ran out. `onClose` in `lib/sea.mjs` does not mark an island quiet while another
islander socket still holds it — the old line dying after the new one joined used to get a
live island swept. And `lib/seaclient.mjs` gives up only on `version` and `key`; `claimed`
and `full` are waited out — giving up left the island HTTP-only: "keeper away", swept,
back on the next changed scan, gone again.

**And when the islander stops, the island stays for days.** `GRACE_MS` is three days, not
the 45 s it was: a phone has no island, so a sea with every islander offline was the volcano
alone. A quiet island is drawn, walked and keeps its crowd; only the sweep takes it. Two
costs: a ghost holds one of `MAX_ISLANDS`' places until then, and an islander whose token
changed (lost `data/sea-token.json`, new machine on the same id) is `claimed` for as long -
a sea restart clears both, since the fleet lives in memory only.

The browser side of the line home reads the same way: `web/js/net.js` asks the islander
which sea to join again on every (re)connect (`followSea()`) rather than holding the answer
from the boot-time `/api/hello` — without that, switching mode left the page reconnecting
forever to the world it had just left.

Behind Nginx Proxy Manager, two settings or the island connects and then sits in silence:
**Websockets Support on**, and a read timeout longer than the sea's own 25 s ping
(`proxy_read_timeout 300s`). Everything after the handshake goes over that socket.

**Everything that harms a player goes through `hurt()`, and health is the sea's.**
`lib/health.mjs` holds it per connection in memory; a guard's reach (`lib/hostility.mjs`)
and standing in lava (`lib/lava.mjs`, `terrain.isLava`, not on a deck, feet within
`LAVA_FEET`) call `hurt`, and other players must too, never `roster.evict` directly. Both
use `afoot()` from hostility, which also demands `p.posed` (`lib/players.mjs`): a socket
that said "walking" but never sent a pose is at a default [0,0], the volcano's crater, and
is nobody's target. The page does not send poses at all until its berth is known
(`state.homeOrigin` is null until then; `frame` in `web/js/net.js`). Lava is out of the
guards' reach mask except under a bridge, so a flow is a wall to their A* with the bridges as its gates. The bar
counts (`oneHit` is off by default and kept only as a way back): a guard in `GUARD_REACH`
swings once per `GUARD_SWING_MS` of its own (a `WeakMap` by figure) - never once per beat,
which emptied a bar in 200 ms - and at most `MAX_ATTACKERS` (3) at one player, the rest
waiting in reach. A swing is **announced, then lands**: `{t:'agent', a:'swing', i, id}` goes
out at once (every page plays the imp's `attack` clip, or a settler's sword arm,
`settler-figures.js strike`) and the blow is resolved `GUARD_WINDUP_MS` (0.55 s, the clip's
measured strike frame) later from where both stand *then* (`REACH_SLACK` of give) - so the
page never guesses at an attack, and a shield raised or a step back during the wind-up counts.
A blow costs `GUARD_HIT` (10; `RESIDENT_HIT` 6) less `SHIELD_ARMOR` (0.25) per hand the pose
says carries a shield (`POSE.SHIELD_LEFT` 32 / `SHIELD_RIGHT` 64, raised or not, stacking),
then `BLOCK_FRACTION` on top if a raised shield (`POSE.BLOCKING` 16, in `lib/players.mjs`)
faces the guard within `FRONT_ARC_COS` (`blowOn`); lava ignores both.
Only the 0-hp hit evicts, then whole + 5 s immunity. Fighting back is
`lib/combat.mjs`: the page sends a bare `{t:'swing'}` and the sea aims it from the last pose
(`p.yaw`, facing `(sin, cos)` as walk.js sets it) - the one flat `PLAYER_HIT` off the nearest
guard or Codex resident in the arc, broadcast as `{t:'agent', a:'hit', i, id, hp, max}`, also
from behind a raised shield (one hand blocks while the other fights). The page keeps that
`hp` on the figure (`crowd-view.js hit`) for the floating bars over every hostile in range
(`web/js/agent-bars.js`: two InstancedMeshes billboarded on the CPU, two draw calls for all of
them; a newcomer sees an already-hurt agent as whole until its next hit). At
0 an agent falls only through its owner (`guards.guardDied`, `residents.died`), a hole in the
roster and back 20 s later through the same running crowd, never a rebuild; a fallen resident
is kept out of `place()` so a list arriving meanwhile cannot raise it early. A hostile island chases *everybody*, its own
islander's walker included, and its guards swim `GUARD_SWIM` cells off the coast - the
strip is a per-crowd reach mask handed to `findPath` as `isLand`, and a swimmer inside it
is a target. The private `{t:'health', hp, max, regenIn, rate}` carries relative times so
the page fills the bar on its own clock; it is sent only when the page's number would be
wrong without it: after every hit that leaves you standing, and "whole" after an evict the
page was told less than.

**Air is the sea's too, and the page keeps the same sum** ([Plans/onderwater-zwemmen.md](Plans/onderwater-zwemmen.md)).
`shared/breath.mjs` is the one copy - `AIR_S` 30 seconds of lung, `REFILL_S` 3 to fill it at the
surface, `DROWN_PER_S` 12, `HEAD` 0.5 (the same number as diving.js `DIVE_HEAD`, a test holds them
equal), `submerged(f, y)` = the SWIMMING bit and `y + HEAD < SEA_LEVEL`, and `stepAir`. The sea
reads only what the pose already carries - `lib/breath.mjs`, ticked after `lava.tick()` and before
`health.tick()`, filters with `afoot` like lava - so it needs no water data of its own, which it
does not have between islands. An empty lung calls `health.hurt(p, DROWN_PER_S * dt, { kind:
'drown' })`, and the eviction that follows carries an optional `why: 'drown'` (so the toast says
"out of breath", and every other `evicted` is byte for byte what it was). The private `{ t:
'breath', air, max, rate }` is sent only when the page's own prediction would be wrong: going under,
coming up (rate-limited to one a second, or a diver bobbing at head depth sends one a beat), and
"full" after an evict. `rate` is -1 draining, `max / REFILL_S` refilling, 0 full; there are no
timestamps because the sea's clock is not the page's. The page steps `stepAir` itself every frame
(`stepBreath` in main.js, on real elapsed time capped at 0.5 s like the sea) and the message only
corrects it, so a sea from before it gives a bar that moves and a diver who never drowns.
`y` and `SWIMMING` are client claims, like every pose: a page that lies about its height does not
drown. No new pose bit and no `SEA_V`, so it is a patch - but drowning happens only on a sea that
runs this code, and the open sea is redeployed by hand. A guard still chases a diver inside its reach
strip but cannot hit one further than 1.2 under the surface (the vertical window in
`lib/hostility.mjs` and `lib/combat.mjs`): a deliberate loose end, not a rule.

**The islets are the page's, worked out from the fleet, and never regions**
([Plans/DONE/starter-eilanden.md](Plans/DONE/starter-eilanden.md)). `shared/islets.mjs isletsNear(fleet, at)`
is a lattice (`ISLET_PITCH`) with one hash per square, kept only where an islet's square is
`clearOf` every row's `reach` plus `ISLET_MARGIN` (and a phone's own berth, handed in as
`extra`) - so every page sees the same islets, the sea gains nothing, and they never go into
`nextOrigin`. `web/js/islets.js` draws them relative to `state.homeOrigin` from `syncIslets()` in
`doSyncFleet`, and draws nothing until the berth is known. They are ground without being regions:
`createIslets`' `seabed` (`{ height, squares }`) is handed to the archipelago (`setSeabed`, from
`onChange` and again in `buildScene`, which makes a new sea), and between the islands `height()`
says `isletBed` - `isletHeight`, the ground that is drawn, up to `ISLET_FADE` radii and sinking into
`OPEN_SEA` by `ISLET_SPAN`, so the box ends in the sea's own depth and never in a step. That one
hook is why feet (`heightUnder`), hulls (`boatGround`: an islet is a shoal to a boat, sand above
`BEACH_MAX` a wall), peers and the sound bed all see them. The water is dense round them through
`waterSquares()` -> `waterPatchPlan` (a square may carry its own `reach` and `step`: an islet's
`ISLET_SHOAL_REACH` 6 and every second vertex, or 59 of them cost a tenth of a page instead of
2.8%; dense tiles that touch take the finest step, or the coarser leaves a T-junction). The bed is
a general hook (`seabed`, not islets): anything else that raises the sea floor goes through it.
A palm is solid at its trunk: `islets.blockers()` (round `{ x, z, r }`, into `walkableBlockers`, and
re-handed to walk mode on `onChange`) - and the trunk is *not* at the model's origin: the baked
Quaternius palm stands 0.39 to one side, turned by `rot`, so `PALM_FOOT` is rotated and scaled like the
mesh. Bushes are not solid.
The chart (`createWorldMap`, M on foot, M or the Map chip from the sky - `skyMap` in main.js)
shows the whole world, `WORLD_HALF` (2016) round the volcano in `shared/regions.mjs`, with a
line every `KM` (252 units, a sixteenth: A-P by 1-16) and every islet (`mapIslets`, once per
fleet and berth). **The world is round by a jump** ([Plans/DONE/ronde-wereld.md](Plans/DONE/ronde-wereld.md)):
past `WORLD_HALF` `wrapEye` in main.js moves body, hull and bicycle the whole width back
(`wrapShift`) before walk mode steps, `pushSample` (timeline.js) starts a track again on a
jump of over half the world instead of gliding it, `nextOrigin` keeps every island's room
`SEA_BAND` (900) off the edge, and `setFogRange` closes the haze in near it (`edgeReach`) so
what is across is behind the fog on both sides. The sea knows none of it and needs no
redeploy for it: a pose on the far side is just a pose. `?edge` starts walk mode 12 units
short of the east edge.

**The weather is the sea's, and a missing sky is sunshine.** `lib/weather.mjs` is one word
(`clear` / `overcast` / `rain` / `fog`) plus a seed and a `since`, turning every eleven
minutes or so on the sea's own clock and riding out on the welcome and on one broadcast. It
is in memory like everything else the sea holds, so a restart is a new sky and that is the
whole migration story. On the page, `web/js/weather.js` draws it by *multiplying* what
`world.js` has already set from the hour — the nine clouds, the dome's two colours, the
three lights, the haze — which is why it runs immediately after `world.update` in the frame
and never before it: world.js writes all of those fresh every frame, and that is what stops
a multiplier compounding. Clear is a multiplier of one everywhere, so a world with no
weather in it is not a degraded island, it is the island. Nothing about a sky ever reaches
`ui.setSkew` or the terrain hash: an unrecognised word and an absent field are both clear,
and the vocabulary is written out twice on purpose (the sea may not import `web/`, the page
may not import `lib/`) with `tests/weather.test.mjs` holding the two copies together. The
rain box lives under the cloud layer (`base` in weather.js `fall`: the clouds' underside less their `drop`, and from above the line of sight sets it down where it meets that layer) - riding the camera up put streaks over the clouds. The
cloud layer hangs at `CLOUD_Y` (54-66, above the volcano's 41: at 24-33 the clouds drifted through the
mountain) and the rain box spans from the clouds' underside to the water. There is no rain from the orbit camera (`fromSky` in createWeather): a box of drops seen from up there is a block that swings
round with the camera, and a screen-space shower and a widened box were tried and looked worse than none.
The sky dome is never greyed by the weather - only the light, the haze's reach and the stars.
The
haze is still decided in exactly one place: `applyFogRange` hands `hazeRange` a multiplier,
and the floor in there is what keeps the furthest coast in the world on this side of the
murk — the price being that thick fog is milder the wider the world is.

**The calendar is the sea's too, and the page never asks its own zone.** The welcome's `now`
+ `tz` go through `worldTime()` in `shared/worldclock.mjs` — hour, month, weekday, season,
moon phase, the one copy — via `worldNow()` in `main.js`; `tests/worldclock.test.mjs` fails
on any local `.getMonth()`/`.getDay()`/`.getHours()` in `web/js/` or `shared/` (the
workbench and real-date labels excepted). The sea reads its zone by name (`SEA_TZ`,
`lib/seaclock.mjs`, offset per moment through `Intl`, so summer time is free) and broadcasts
`{t:'clock'}` when the offset changes. The sea's own beat asks the same `worldTime` (on
`clock.offset()`) whether it is night and whether the village is due on the square - `nightAt`
/ `gatheringAt` (coffee, lunch, tea and the Friday borrel, one `GATHERINGS` list) in
`shared/daylight.mjs`, which say what an hour means and never what the hour is - and
hands both to `crowds.tick` / `setGather`. Without `SEA_TZ` it is the host's zone — which in a
container is UTC, hence `ENV SEA_TZ=Europe/Amsterdam` in `Dockerfile.sea`.
The clouds, the swell and the moon run on the sea's clock too (`world.update`'s fourth
argument, `{ t, moon }`, sea epoch ms - never the chronicle's): the cloud layer is one
`CLOUD_TILE` of clouds from a fixed seed repeated over the **whole sea in the world frame**
(`cloudNearest`, `setSeaHome(state.homeOrigin)` every frame), drawn three by three round the
camera, so every screen has the same cloud and the same shadow; the island's own rng is still
spent as the nine old clouds spent it, or the fireflies move. `uTime` is sea seconds mod
`WAVE_LOOP` (20π, whole periods of every `uTime * n` in the water shader - a new wave rate
must keep that, `tests/sea-clouds.test.mjs` reads the shader). A lens (`?hour`, the chip, the
chronicle) marks the clock chip `· local`.
[Plans/DONE/klok-en-hemel-van-de-zee.md](Plans/DONE/klok-en-hemel-van-de-zee.md) has the rest.

**Somebody running different code is a banner, not a console warning.** Three machines make
a world — this page, the islander that packed a bundle, whichever islander packed somebody
else's — and when their `shared/terrain.mjs` disagree an island is drawn in the wrong shape
with nothing crashing and nothing logged where anybody looks. `ui.setSkew(id, name)` keeps
it on screen and names who.

**The server is dangerous on purpose.** `/api/assign` spawns real Claude Code sessions
unattended with full permissions in any folder, so `lib/access.mjs` demands all three of a
loopback socket, a known `Host` and a matching `Origin`, and never reads
`X-Forwarded-For`. The ceiling is `PROMPTHOLM_MAX_AGENTS` (4). Put any new write route behind
the same check.

**The player and inventory use the selected smooth traveller (concept 3).**
`scripts/build-settler.py` reuses the concept helpers, fits equipment and stores rig
anchors and body groups in the Blender source. `export-settler.py` preserves corner
normals when `avatar_smooth_normals` is enabled; do not recompute them after merging.
`classic-avatar.js` gives the hero a smooth material while sharing the island's live
shader uniforms. `rig-settler.py` adds three-bone chains with skin weights; the exporter
writes `SETTLER_JOINTS` and per-corner weights. `avatar-gait.js` drives foot placement
from actual displacement and owns land walk/run speeds. `walk.js` measures movement
after collisions; `peers.js` measures interpolation in the relevant land/deck frame.
The `/avatar-motion.html` workbench shows walk/run/idle and the live inventory.
The Outfit thumbnail includes the shirt, vest, belt and pouch.
Resident rebuilds preserve faces from their own blend rather than copying the player.
See [Plans/DONE/ambachtelijke-reiziger.md](Plans/DONE/ambachtelijke-reiziger.md).

**A temporary renderer gives its context back.** `renderer.dispose()` does not release a WebGL
context - only `forceContextLoss()` does - and the browser caps live contexts at about sixteen,
evicting the oldest, which after enough visits to a panel is the island's own. The inventory
(`web/js/studio.js`) opens two per visit, the alcove and the slot icons, and closes both that
way; anything else that makes a renderer for a moment must too. Its slot table is
`web/js/inventory.js`, kept DOM-free so `tests/inventory.test.mjs` can hold every equip key to
one slot and every swatch to one dye button; its popover (`web/js/popover.js`) lives in `body`
at `position: fixed` and catches Escape in the capture phase on `window`, so the first Escape
closes the popover and only the second closes the panel - the studio's own Escape handler and
`walk.js` both listen later in that same keydown.

**What can be unlocked is one list, `shared/equipment.mjs`** ([Plans/schatkaarten.md](Plans/schatkaarten.md)):
`{ id, slot, name, unlock, status: 'live' | 'planned', render? }`. `avatar.js` derives `HAND_ITEMS` and
`PLAYER_HAT_SHAPES` from `liveOf(slot)`, so a *planned* piece is data only - not an id the look accepts,
no tile - and a live one needs a drawing function (`render` = a key of `HELD_ITEM_PROCEDURAL` in
classic-avatar.js; `tests/equipment.test.mjs` fails without). Pieces from before unlocking are not listed
and count as owned (`unlockOf` gives null). Ownership is `web/js/unlocks.js` (localStorage
`promptholm.unlocks`, per browser, never throws, newer-format content is left alone); `normalizeAvatar` and
the sea's `lookOf` deliberately do not filter on it, only the picker does (`studio.js openPicker`: a locked
tile is the same icon as a silhouette with the piece's `hint`, and its click does nothing). The rig side of
the treasure hunt lives in classic-avatar.js: `dig(on, side?)` (a repeating 0.6 s stroke, takes the shovel
into a free hand and gives the old item back; `digged()` counts flung shovelfuls, `digging()`) and
`setCarry(on)` (both arms out, `carried` group holds the load; `carrying()`); `update(pose)` also honours
`pose.digging` / `pose.carrying` flags, which is what peers.js should hand it from the pose bits. A dig
turns the shovel with a quaternion (`unArm * Rx(tilt)`), not per-axis Euler undo: the arm is turned in about
z while it digs and the two do not commute.

**The browser keeps ctrl+W whatever the page says.** On foot, `walk.js` cancels every ctrl+letter and
ctrl+digit shortcut a page is allowed to cancel (`BROWSER_KEYS`: all 26 letters, the digits and Tab - not
the handful that once happened to hurt, which is how ctrl+A got through) and asks for a Keyboard Lock
(`navigator.keyboard.lock`) on the same letters. The lock only
takes effect in fullscreen - that is the API, not a choice - so outside fullscreen ctrl+W, ctrl+T,
ctrl+N and ctrl+<digit> still belong to the browser (the desktop window has no tab to lose), and
Escape is deliberately not locked (a
locked Escape makes leaving fullscreen press-and-hold). ctrl+A is cancelled in every mode, from the sky
too (`web/js/page-keys.js`, installed from main.js; a field keeps it). **Ctrl is a bindable key**
(`'control'`, unbound by default): once it is somebody's, `ctrlIsKey()` makes `onKeyDown` treat it and
whatever is pressed while it is held as game keys instead of throwing the press away, and the browser
shortcut is cancelled all the same - `tests/ctrl-key.test.mjs`. AltGr arrives as ctrl+alt on a Dutch
layout and stays a letter; its synthetic Control press does fire a bound Ctrl. The mouse buttons fight, one per hand:
the left button is the left hand, the right button the right (`SIDE_OF` in walk.js). A hand
holding a shield blocks while its button is held; any other hand (sword, hammer, bare fist)
attacks - the right on the press, the left on the press under a pointer lock and otherwise on a
click that did not become a drag. `classic-avatar.js` takes `attack(side)` and a `blocking` of
`{ leftArm, rightArm }` (a bare `true` still means the default hand). A hand holding a beer
drinks instead (`act` in walk.js, `drink(side)` in classic-avatar.js) - and a glass is never a
shield, so it must never reach `guardUp`/`state.blocking`, or the sea sees a raised guard
([Plans/DONE/bier-en-dronken.md](Plans/DONE/bier-en-dronken.md)). The key row says per button what its
hand does (`handAction` -> `ui.setMouse`). The purple bar is the page's, like stamina: **one**
pool (`web/js/tipsy.js`) made in `main.js`, handed to the island's walk mode *and* every room's
(or you walk out of the tavern sober) and stepped once in `frame()`; its blur is a CSS filter
written on `#stage` and `#panels` together, only on foot. G hands a beer to one of our own
settlers within `GIVE_R` (`giveBeer` in main.js, `crowd-view.js giveBeer`): the drink, the
pint and the sway are this page's alone and live per house id in the crowd view, never on
`f.pos`; the settler is held with `attend` under the name the **sea** knows them by
(`seaIdOf`, the inverse of `/api/crowd-ids`) - our own `house:<uuid>` is nobody on the sea.

**The keys on foot are rebindable and listed only under Settings → Controls** (the key row
at the bottom is off, `SHOW_KEY_ROW` in ui.js), as a table of three columns per action - primary key,
secondary key, controller button ([Plans/toetsen-en-bindings.md](Plans/toetsen-en-bindings.md)).
`web/js/keybinds.js` keeps them per browser (`promptholm.bindings`, only what differs from the default;
the old one-key `promptholm.keys` is read as primary keys and not written); walk.js still tests the
*default* keys, because `canon()` turns a pressed key into the default key of the action bound to it in
either slot - so a new action is a row in `ACTIONS`, not a handler change. The arrow keys are the default
secondary keys of walking (`canon` sends them to W A S D; an unbound default key is `null`, dead). A key
or a button is one action's alone and taking one **swaps** (the loser is handed what the winner let go
of); Esc, Alt/AltGr/Meta and the pad's Back and Start cannot be bound. The controller column comes out
of `MAPS.walk`/`MAPS.inside` in `input.js`, built by `applyPadBindings` from `padOf` (and rebuilt on
`onBindingsChange`, so a change needs no reload; every other mode keeps its fixed buttons). It is greyed
and dead while `navigator.getGamepads()` shows no pad, its head then says **Controller** and with one the
pad's name (`padName`), the labels follow its family (`padLabel`: ✕ ◯ □ △ on a PlayStation pad), and a
capture holds the pad away from the rest of the page (`suspendPad`) so that pressing B does not also
close Settings.

**A room can have storeys** ([Plans/verdiepingen-binnen.md](Plans/verdiepingen-binnen.md)): `def.surfaces`
(interior.js -> `walk.setSurfaces`) are floors `{x0,x1,z0,z1,y}` and slopes `{...,y0,y1,axis}` as rectangles,
which `groundAt` takes like `levels` (the highest within `STEP_UP` of the feet) - a stair is drawn as treads
and walked as a slope. A blocker with `y0`/`y1` is a wall only to a body whose span meets it (`atHeight`),
an interactable with `floor` is out of reach from another storey, and `clampCam` keeps the camera under a
floor that hangs over you or it. Only rooms hand surfaces over; the island and the sea keep to cell
`levels` (`tests/walk-surfaces.test.mjs`).

**Leaving walk mode leaves the body standing** ([Plans/DONE/karakter-blijft-staan.md](Plans/DONE/karakter-blijft-staan.md)):
`walk.park()` keeps the figure drawn and on the sea (`walking` stays on, the pose carries
`ASLEEP` 4096, `POSE_MASK` 8191, a Zzz from `web/js/zzz.js`), and the frame loop steps a
parked walk in orbit without touching the camera. It walks only a route from above
(`goTo`, fed by `walkBodyTo` in main.js: `findPath` over cells, blocked by the feet's own
`blockedAt`), from a click on bare ground or the dossier's Walk here. The search is told what a settler's
is not (`findPath` options in shared/settlerwalk.mjs): the decks of hand-built bridges are open over the
water but entered only at their ends (`step`: a deck is a cell like its bank and two metres higher at
the crown - boarded from the side halfway across, the walker swam), roads are cheaper (`prefer`, and the
bridge's axis is a road), and a hamlet's boundary fence costs twelve steps except where a road passes
(`crossing`); guards and settlers pass none of it; `enterWalk` starts
where it stands, and the islander starts it on the square (`parkOnSquare`). Asleep is not
`afoot`. At a tiller or on a deck exitWalk still flies up the old way.

**On foot the mouse is a pointer lock by default.** `syncLock()` in `walk.js` takes it on
`enter`, gives it back whenever something needs a cursor (`setPaused(true)` for any overlay,
`setWorking` for a board) and asks for it again on the way out of those — so a new panel only
has to pause the walker, never touch the lock. A re-request without a gesture is allowed only
after a lock the *page* released; after the user's Escape it needs a click, which is why a
single click on the canvas takes it back and does not also swing. That first Escape only frees
the mouse (`unlockedAt` swallows it), the second leaves walk mode. Drag-to-look is the fallback
where every request is refused: the desktop app's browser pane throws `WrongDocumentError`, so
pointer lock cannot be tested there — use a real Chrome or the Tauri window. That pane, hidden,
also runs no frames between screenshots: a drink or a walk only advances while one is taken,
and a `setTimeout` loop polling the page sees time stand still. For anything that needs real
frames - an fps number, a soak - use the Chrome DevTools MCP's own Chrome, and bring its window
to the front (`select_page` with `bringToFront`) first: behind another window every GL call
blocks on the present, and the island runs at 1 fps with 1.5 s of `?stats` "work" a frame,
which reads exactly like a regression and is not one (measured: the 61-settler island went from
1 to 100 fps on that one call). Comparing two versions: run one islander at a time (two local
seas each walking Hoogezand's crowd made the same page swing between 40 and 67 fps), take the
second pass after a load (the first is still compiling and collecting), and alternate - the same
code measured 23 ms and 28 ms an hour apart on this laptop. To see the price of something, hide it
from the console (`rec.mesh.visible = false` on every record is the batch's ceiling) rather than
reasoning from call counts.

**First person is the wheel's last notch (or V), and it is a view model, not a body.**
`state.firstPerson` in `walk.js`: the camera sits `FP_BACK` behind the eye (carried through the
avatar's own matrix, so a crouch or the saddle moves it) and pulls the near plane in to
`FP_NEAR` only while it is on, because the island's camera keeps 0.5 for depth precision at the
horizon. `classic-avatar.js` then hides everything but the two arms (`FP_HIDDEN`) and carries
held items higher and tilted (`FP_HOLD_X`, `FP_TILT`), following `camPitch` - none of it is on
the wire, so nobody else sees that pose. The whole rig is mirrored (`object.scale.x = -1`):
the bake's "Right hand" sits at +x, which on a figure facing +z is its left hand. The villagers' own rigs (smith, butcher, baker) set it back to 1: their tools were placed
against the unmirrored rig, and `tests/butcher.test.mjs` fails on the cleaver if one is not.

**The follow camera never hangs under the sea - until its body is under it, and then never over.**
`placeCamera` in walk.js floors the camera with `cameraFloor` (web/js/camera-floor.js): over ground
it is the ground plus a hand, over water the *surface* plus `WATER_CAM_MIN` (0.5, over the swell and
the near plane) - the ground under open sea is `OPEN_SEA`, so the old ground-plus-a-hand let a
wheeled-out camera look up at a boat through the underside of the water. While `state.diving`
(below) the camera belongs under the water: its floor is the bed, and `applyCeiling` holds it
`WATER_CAM_MAX` under the surface - a camera left above a diver would look down through a sea that
is opaque at depth. Both go over on `blend`, a smoothstep of a 0.8 s timer (`camDive`), never on
the flag: the surface swimmer's camera hangs 2.3 up, and an exponential ease moved it 0.16 in one
frame (`tests/diving-walk.test.mjs` holds the step small). **A swimmer may look far up, and the floor
bends the aim instead of flattening it**: `pitchRange` opens to `SWIM_PITCH_MIN` (-1.1, about 63 degrees,
in the water and on land alike - it was -0.25 on land, which left a walker no sky), and `placeCamera` lifts the look-at point by however far `cameraFloor`/`applyCeiling`
pushed the camera *up* (`lift`, never first person, never downward - the diver's ceiling keeps
its old view of the diver). So the lens still never sits half under the sea, and the mouse looking up still
looks up: the body slides out of the bottom of the frame from about -0.6, which is the price of seeing the sky.

**Diving is the walker's third way in the water, and a diver is still a swimmer**
([Plans/onderwater-zwemmen.md](Plans/onderwater-zwemmen.md)). C (pad B, touch B) held while
swimming in water deep enough (`canDive`: a body's height of sea) sinks the body; Space (pad A)
swims it up; letting go hangs it (neutral buoyancy). **The view steers too** (`lookRise` in diving.js): with a stroke
going, `camPitch` well below level sinks and well above climbs (third person: a dead band 0.14 to 0.54
around the camera's 0.28 to 0.44; first person: level is 0), by how far forward the stroke is - backwards
turns it round, sideways and standing still do nothing - and it adds to C and Space, it does not
replace them. `web/js/diving.js` is pure like `stepBike`:
`stepDive` takes `{ y, vy }` and the world (`bed`, `lid`, `surface`) and says where the feet end
up and whether the body has `surfaced` - at exactly `WATER_Y - SWIM_SINK`, the height walk.js
floats a swimmer at, so leaving dive mode is no step. **Three flags on walk state, and they mean
different things:** `dive` (the feet are free of the surface), `diving` (the *head* is under:
`y + DIVE_HEAD < WATER_Y`, which is what the camera, the mist, the sound and the sea's air key
on) and `onBed` (standing on the sand, where a diver walks slower). `swimming` stays true
throughout: every reader of it (no fight, no dance, no drink, the sea's SWIMMING bit) keeps
working, and `state.grounded` stays true too, so a diver is never AIRBORNE. `crouching` is exactly
"C is held" (set on the press, dropped on the release), which is why keyboard, pad and a rebound key
all come through it - and why the rig and the camera use `stoop = crouching && !dive`, since C is
not a crouch down there. What a diver stands on is `bedUnder` (the stone quay's wall and stairs, then
`sea.bedAt`, the *drawn* bed), never `groundAt`, whose meaning ("the surface or deck under the feet", also
main.js's "can I step out here") does not change. Under a deck `ceilingAt` stops the rise; in the
shallows (`SHALLOW`) the water lifts a body that is not pushed down, so a diver reaching a beach
rises out of it instead of being snapped up when the bed comes dry. **A fall into deep water plunges** (`plungeSpeed` in diving.js, called where walk.js's airborne branch
lands in water): faster than `PLUNGE_MIN` 3.6 - a hop off level ground is ~3, a ship's rail ~5.5, a rock ~9 -
the body dives with 0.7 of its speed instead of having it zeroed at the surface, and below a stroke's own
`DIVE_DOWN` `stepDive` coasts at `DIVE_COAST` rather than `DIVE_RATE`, so it is a metre or two down and then
hangs like any diver (no automatic float up: Space swims you back). A jump off a moving hull keeps her way
(`drift`) shooting on under water too, decaying at `DIVE_DRIFT` 1/s instead of the surface's 3/s. `reach()` offers nothing
to a body that is `dive`-ing: the distances are flat, and E would board the dock's boat from two
units down. The phone shows B in the water through `walk.inWater()` (`touchpad.js setHands`).
`?dive` starts walk mode in open water off the home island's east side. Others see a diver
through the `y` that was always sent (`peers.js`: a swimmer sent below `SURFACE_Y - DIVE_BELOW`
is drawn there, clamped to the surface above and the bed below, tipped by `divePitch` off the
vertical speed of their last two samples): no pose bit, no new message, and a page from before
diving sends -0.07 and is drawn afloat.

**The sea has a floor, and it is a layer beside the terrain, never in it**
([Plans/onderwater-zwemmen.md](Plans/onderwater-zwemmen.md)). Writing a bed into any terrain `H` -
even a corner far out at sea - changes `layout.terrainHash`, moves every house and makes every
neighbour refuse the island, so the relief between and past the islands is `shared/seabed.mjs`
(trig-free, from `makeSimplex2D('seabed')`, in the world's frame): `bedDelta` in [-1, 1.5] on top of
`OPEN_SEA`, banks up to `BED_TOP` -1.0 (boats scrape only from 0.35, so none ever touches one),
trenches down to `BED_DEEPEST` -3.5 (inside the sea's pose clamp of -4), slopes about 0.25, faded in
over `BED_BAND` 12 to `BED_FADE` 40 units off any island grid or islet square, so between two
islands it reaches only a third of its height. **`archipelago.bedAt(x, z)` is the bed a diver meets;
`height()` is still the logical water** (boats, guards, colour, `water-patch.test.mjs`'s "the coarse
water is only valid over flat OPEN_SEA") and has not changed. Inside a region `bedAt` is the
*unramped* `r.terrain.worldHeight` - what the island's mesh really draws, since `placeIsland`
ramps the outer `BLEND_CELLS` to `OPEN_SEA` and a diver must touch the drawn floor - then blends
the island's rim into the field over `BED_BAND`, and islets come in through `seabed.height`
(`max`). The field lives in the world's frame and the archipelago in the page's (home at the
origin), so **`setBedHome(state.homeOrigin)` must be called wherever the berth changes** or two
pages berthed apart put a bank in different places; main.js `seaFloorChanged()` does it, and asks
the bed and its life to plan again, on a rehome, a guest island, and the islets' `onChange`.
`web/js/seabed.js` draws it: one mesh following the body in three rings (step 1 out to 24, 2 to
64, 4 to 128: ~17.8k triangles, ONE draw; `modest` 1/4/8) on a lattice anchored to the world so
nothing swims, rebuilt when the focus has drifted 8 units, heights from `bedAt`, colour from the
truth (depth, slope, caustics off the water's own uniforms - `world.waterUniforms`, shared not
cloned). **It sits `SEABED_LIFT` over the terrain with a polygonOffset that pulls it forward, and
draws over an island's own underwater ground as well**: an island's shore colours (teal `bandColour`,
the grass sheet, the sea's light) are a dark slab against the sand of the open sea, and with the
bed lowered under the island's mesh - as it first was - a diver saw that slab's straight edge at the
grid's rim. Land cells (all corners at the waterline or above) are left out. It is switched off
from the sky and at the surface, and the opaque ocean disc hides it from above anyway.

**Under the surface the lens decides** (`web/js/underwater.js`). It keys on the *camera* being under
`world.surfaceAt` over water (`state.sea.height < 0`), with hysteresis, not on the body: a diver's
camera is on its way down for 0.8 s after the head goes under. It runs in the frame after weather
and `applyFogRange` and before `seaFloorFrame` and `cullRecords`, in the way weather.js multiplies
what world.js wrote: fog near 0.5, far 60 falling to 25 by 3.5 down (never past the fog above, so
"what `record-cull` cuts is already fogged" stays a property of the function), teal darker with depth
and at night; `exp(-0.18 d)` on the key, hemisphere and ambient light; `scene.background` at the fog
colour; dome, clouds, sun, moon, rain and the three front water meshes hidden; near/far stashed and
put back exactly (a range `applyFogRange` wrote since counts as the ordinary one, and only for
the same Fog object: a reseed makes a new one). **The surface from underneath is one full-screen
quad, not three BackSide meshes**: with the near plane at 0.5 a ceiling closer than that is cut
away, exactly where a diver spends the first seconds, and the swell (+-0.09) tears holes in a
one-sided ceiling. Each pixel intersects its ray with the plane at the surface height, shows the
Snell window (sky colour and the sun's glint inside about 49 degrees, the dimmed mist outside,
ripples only on `WAVE_RATES` so there is no seam at the 20*pi fold) and writes that point's depth
to `gl_FragDepth`, so everything above it lies behind and everything below in front; it draws
first, opaque, and is `visible=false` above water. The overlay is `#underwater` (never a `filter`
on `#stage`, which the beer's blur owns), the sound is a low-pass 20 kHz to 600 Hz on the master
(`sound.setUnderwater`), and `enterPlan` calls `underwater.reset()` first so the planner does not
stash the sea's mist as the ordinary one.

**What lives on the floor is planned from the bed alone, and is the page's**
(`web/js/sea-life-plan.js`, pure and tested, and `sea-life.js`). The sea is cut into 16-unit
chunks and each is planned from its own coordinates - `hash32('sea:<cx>:<cz>...')` for the
choices, world-frame noise for the clusters - so nothing is stored or sent and two pages that look at
the same water see the same reef: kelp in forests where the bed is -1.2 or deeper (shortened to
keep its top 0.35 under the surface, at 0.4 to 0.75 of its baked 1.5 or a forest hid its own
diver), coral on banks (-2.3 up to -0.9), rocks on steep ground, shells and starfish on sand,
and nothing shallower than -0.9 (the island's own things live there, and polders and the fairway
floor are that shallow). The shapes are the baked set `sea` (`web/js/sea-mesh.js`, `scripts/build-sea.py`,
605 triangles for eleven assets): one InstancedMesh per shape, no shadows (a caster counts twice in
`?stats`), matrices written once per chunk crossing; kelp sways from a vertex shader off its height
in the bake. **Ask for `flora_rock_sea_a`/`_b` by name and never through `models.variants('flora_rock')`**,
which now also returns them. Schools of 6 to 14 (`fauna_fish_a`/`_b`, two more meshes) swim a slow
figure of eight over their chunk between the bed and just under the surface, and part for anybody
diving within 4 units; bubbles are one `Points` pool fed by every diver's mouth (`peers.divers()`,
and the walker's own). Caps by tier (`CAPS`: full / modest / phone) bound reach and instances, and
the reach never goes past the mist. Cosmetic: no fish is on the wire.

**The hook must never disturb a session.** `hooks/on-session.mjs` silences stdout (a
SessionStart hook's stdout is injected into the model's context) and always exits 0.

**The gold pit's count is the keeper's, and it comes from two places on this machine**
([Plans/DONE/goudkuil.md](Plans/DONE/goudkuil.md)). Claude Code hands the five-hour usage window
(`rate_limits.five_hour`) to a `statusLine` command and to nothing else - not a hook, not a
transcript - so `hooks/statusline.mjs` is the one writer of `data/usage.json`
(`lib/usage.mjs`, only when the number moved). The desktop app runs no status line at all,
so a keeper who works only in its Code tab never got a reading and saw a full pit; what the
app does do is sample the same window every quarter of an hour into
`%APPDATA%\Claude\plan-usage-history.json` (`fh`, no reset), which `readDesktopUsage` reads
and gives a `resetsAt` estimated from the history - five hours after the window's first
sample, an upper bound, because a pit that fills late is better than one that fills while
the window is spent. `currentUsage` takes whichever spoke last. `shared/gold.mjs goldOf` is
the one copy of what it comes to: `100 - round(used)` bars, and a full pit when there is no
reading or the window's `resetsAt` has passed. The script keeps the session hook's rules: always exit 0,
and with `--pass` (it is put *in front of* a status line the user already had,
`lib/statusline.mjs`) stdin goes back out untouched before anything that could fail. Nobody
runs anything to install it: the islander does, on start (`ensureStatusLine` from
serve.mjs), once per island - `data/statusline.json` records that it asked, and a line the
user took out again stays out; a settings.json that does not parse is never rewritten. Never
from a linked worktree (`WORKTREE`): its island is its own, so its marker says "never asked"
and it would repoint the machine's one status line at the sandbox's script and data. The
count reaches only the keeper's own page - `/api/gold` (not on `PUBLIC_API`) and the
`localOnly` SSE `gold` event from `watchGold` - never `village.json` and never a bundle: a
visitor and every other island draw a full pit (`attachExtras`' `gold` follows `mail`), and
a count in the bundle would also be a republish, a rebuilt region and a crowd sent home on
every percent. The pit itself is an ordinary civic 3x3 (`civic:goldpit`, placed once by
`findBlockAround` after the milestones - never `takeCivicLot`, whose eight lots are exactly
the town hall's and the seven 3x3 milestones'), with its bars an InstancedMesh hung on
from `animated.goldpile` (`web/js/goldpit.js`, `count` = bars). On the sea a settler at
work fetches a bar first (`startGold` in `shared/settlerwalk.mjs`: its own `<id>:gold`
stream, `MAX_GOLD` out at once) behind a wheelbarrow: `'barrow'` out empty, `'load'` bent over
it at the pile, `'carry'` home full - appended to `ANIMS`, the two walks in `MOVING`, the same
kind of word as a woodcutter's `'haul'`. `settler-figures.js` sets the barrow on the ground
under them (no bob, no lean: it runs on its wheel), turns the wheel by distance travelled and
parks it on its legs for loading (`BARROW`, three batches for the whole crowd). Between
trips it stands beside its settler while they hammer, along the front of the house and empty -
derived on the page (`barrowAtHome` in crowd-view.js: `'hammer'` on an island whose buildings
include the pit), so nothing about it is on the wire and every screen parks the same barrows. `createCrowd(island, { known, before })` hands each settler's gold errand over from
the crowd before it (`walk.adopt`, only when their doorstep did not move): a working island
republishes every scan (`lastAt`), and without that a settler living over a minute from the
pit would be stood back at their door before ever reaching it.

**The pit's gold comes from a mine, by way of a goldsmith** ([Plans/DONE/goudmijn.md](Plans/DONE/goudmijn.md)).
The mine holds the keeper's seven-day window as ore (`shared/gold.mjs mineOf`, one lump a
percent, the pit's bargain: no reading is a full mine), riding along as `mine` on `/api/gold`
and `event: gold` - never the bundle. The desktop app's `sd` has no reset, so `weekResetOf` in
lib/usage.mjs takes the last real drop it sampled (to half or less, or to 5) plus a week, and
`currentUsage` takes the week from the newest source that has one. **The pit never holds more
than the mine can give**: `purseOf` (shared/gold.mjs, the one copy, what `/api/gold` answers)
is the five hours or the rest of the week, whichever is less (`window` the five hours' own count,
`capped` when the week held it down), so a gold run can only bring what the mine has. A week
turning over fills the bin over `ORE_FILL_S` (`attachOrePile` in web/js/goldmine.js, stepped
from `animateExtras`), spending shows at once. `civic:goldsmith` (nearest
the pit) and `civic:goldmine` (high ground within `MINE_RING`) are placed right after the pit,
sticky 3x3s with the town's claim, and `standAt` in `placeAll` takes a lot only if its road
reaches the square on that same scan and it cuts no land off (`reachCount`) - the mine once
stood across a river and got its road the scan after, and a goldsmith on a founding island's
last dry block sealed a slipway's way up. Lots with `INLAND` cells of dry non-beach ground round
them go first (`byCoast`, `MINE_TRIES` per list), and the mine *waits* for one while the island
can still grow - not as `unplaced`, which would make the island grow for it. Because the mine's claim can lie apart from the
commons, the planner's `commons` op refuses only ground that adds a piece (`pieces`), not a
town that is already in several. The delivery is the page's alone (`web/js/goldrun.js`): a
rise of `MIN_RISE` bars or more is a window turned over, and the pit holds its old count while
the miner pushes a cart by road (`roadBetween` in shared/roads.mjs) to the goldsmith, who
smelts and barrows the bars to the pit; no buildings or no road between them fills it at once.
`?goldrun` plays one from 20 bars. `tests/goldmine.test.mjs`.

**The sawmill's horse takes timber to the yard, on the sea's clock** ([Plans/DONE/houtkar.md](Plans/DONE/houtkar.md)).
`web/js/timberrun.js` is the gold run's pattern with no state: where the horse, the wagon, the
carter and the yard's three hands are is `tripAt` / `crewAt` of the sea's time (`timeNow()` in
main.js), so every screen - visitors' too, since nothing in it is the keeper's - has the wagon at
the same place, and a page loaded mid-trip finds it mid-road. The trip is one closed loop
(`tripLoop`: out on the right of the road, a U-turn at each end, back on the other side), so the
horse is one arc length and the wagon's axle trails it by `hitch`, measured off the bake
(`scripts/build-wagon.py`, `prop_wagon` + `prop_timber`; the bake splits parts per material, so
they are asked for by prefix). The horse always walks (`HORSE_SPEED`): a road too long for
`TIMBER_EVERY` gets a longer period (`tripPlan`), never a trot. The horse is fauna.js's, posed
from outside its brain like the rave's, and is not the stable's. The crew hang in the yard
group's frame on rounds picked off the bake per `yardStage`, stand on whatever of the yard is
under them (a raycast into the yard's own meshes, cached per spot), are in the shed after dark,
and the carrier leaves his round `CARRIER_LEAD` before the wagon arrives to unload it. main.js
wraps every call into it: a fault there once stopped the boot. `?timber` starts a trip now.
`tests/timberrun.test.mjs`.

**Left alone, the camera goes to watch something happen** ([Plans/DONE/regisseur.md](Plans/DONE/regisseur.md)).
`web/js/director.js` has no DOM and no camera (`createDirector`, `pickShot`, tested): after
`IDLE_S` of no pointer, wheel, touch or key, from above only (`directorMay` in main.js: orbit,
no intro, no tween, no open `aside.panel`, not the chronicle, Settings' *Wander by itself* on),
it picks a shot from `directorShots()` - an arrival first (`state.arrivals`, fed by the `arrive`
event), then by weight the gold run (`goldRun.focus()`), the timber wagon (`timberRun.where`),
a yard hand (`timberRun.handAt`), a working settler (a visible figure whose `anim` is in
`WORK_WORDS`), a story animal (the goat weighted up), the fisherman, the smith, the baker, the butcher
(`TRADESMEN`) and the goldsmith between runs (`goldRun.smithAt()`), while at work, watched from the side of their building they stand on - a shot's
`az`) and, at most once per
`CENTRE_EVERY`, the town centre - never the same key
twice running, flies to it over `FLY_S`, follows and circles it for `HOLD_S` from the shot's
`dist`, and says what it is in `#director-caption`. After every shot it goes back up to the whole
island (`overview`, `islandFrame()` in main.js - the boot framing) for `OVERVIEW_S`, circling it
at `OVERVIEW_RATE`, and stays there, circling, for as long as nothing is happening. `stepDirector` runs just before
`controls.update()` in the orbit branch, and any input `poke()`s it: it stops where it stands.
`?director=5` starts after five seconds. The fisherman is `web/js/fisher.js` (the smith's
pattern, our own island only because he measures the water's edge off `groundAt` - except a hut on the
quay, whose ground is cut away: there he stands on the deck (`deckY`, `HARBOUR_DECK`), or he is sunk in the kerb), with a
villager's `rod` in classic-avatar.js whose line is modelled for `FISH_ARM`, and a `reach` pose
for one arm.

**The town centre has a plan, and a shop has a lot in it** ([Plans/DONE/knus-dorpscentrum.md](Plans/DONE/knus-dorpscentrum.md)):
`TOWN_PLAN` in `lib/layout.mjs` - the eight lots of the ring round the square (`RING`, the old
`CIVIC_LOTS`, each building of the square on its own via `RING_OF`), four two-cell streets
leaving it with the clock (`STREETS`) and sixteen three by three street lots filled from the
square outwards (`STREET_LOTS`; school and water tower take the far end), the gold pit behind
the library. A building whose lot is taken or unbuildable falls back to the nearest free block,
facing whichever side has ground in front of its door (`openRot`). Workshops (`TRADES`: sawmill,
smithy, stable) and a new castle stand beyond it (`TRADE_RING`, `TOWN_REACH`). Street lots on the
town's ground are RESERVED from the first scan like the ring - but never the streets themselves,
which would wall the hamlets off from the square - and `townHeld` is what tells those marks from
a keeper's zone or a dike, which are RESERVED too. A street is paved from the square to its last
building, into `town.paved` (so every reader of the paving has it) and again as `town.streets`
for the one reader that must leave it out: the Friday gathering (`gatherCells` in
`shared/roads.mjs`, the third argument of `setRoads`). The static shops are `SHOPS` in
`web/js/buildings.js` - one asset `civic_<type>` each, at the tavern's size under the village's
terracotta (a first version at twice that, in dark slate, stuck out and was rebaked), walked
round part by part (`APART`) and set on the tavern's step. `TOWN_VERSION` laid an existing centre out again once.

**The pirate's chest and the treasure statue are two one-cell civics that no version gate covers**
([Plans/schatkaarten.md](Plans/schatkaarten.md)): both are new plots appended to `layout.plots`, so no
existing plot moves and none of the six gates is needed (an older code reads them as civics it
does not know and leaves them alone). `civic:pirate` is placed like the postbox, once, on the first scan
with a tavern and a free `SQUARE` cell one step *along the front* of its doorstep (`ALONG_FRONT` by the
tavern's `rot`, the `aside` direction of `shared/settlerwalk.mjs`; never off an island, a starter stands its
tavern at rot 2), and follows the tavern like the postbox follows the hall (`migrateTown`, `opCivic`). His
keeper (`KEEPERS.pirate`) stands out in front of the chest with no `aside`: pushed sideways he lands
in the corner cell of the seventieth settler's statue. The sea's starters carry the chest too
(`starterBundle`, held to the town's rule by `tests/pirate.test.mjs`). **From 52 settlers the chest moves once,
behind the Salty Kraken** (`PUB_ID`, below): onto the first of `chestSpots(pub)` (`shared/treasure.mjs`, `[u, v]` off
the lot's middle, behind and beside, never in front; `LOOK` held equal to `DOOR_DIR`) whose cell is bare land or
paving on no road, doorstep or plot, with the keeper's cell in front of it dry ground and never a pier. It is
*lifted* at the top of `placeAll`, before the plot replay, whenever the pub is earned and not yet standing or
stands with the chest elsewhere, so the cell it leaves is bare this very scan; `placeChest` runs at the chest
block and again after the `deferred` rungs (a pub founded with the island), and with no spot the chest goes
back where it was at the same place in `layout.plots` (`putBackAt`), so a pub with no ground behind it costs no
byte. `movedBetween` in `tests/support/village.mjs` forgives exactly that one move, on the scan the pub first
stands. Below 52, and wherever the pub has no spot, the tavern rule above holds; `migrateTown` and `opCivic`
carry the chest along with the tavern only while the tavern is its host. `civic:treasure` is placed when
`model.treasure.placed` is true - scan.mjs puts `treasureView(loadTreasure())` on the *model*, so the
planner's re-survey sees it too - on the first of `TREASURE_SPOTS` that is on the plaza's paving, unoccupied
and no doorstep, and is sticky (a `treasure.json` that goes missing takes the statue out of village.json,
never off its cell). Its plaque is `web/js/treasure-plaque.js` on the bake's `anchors.sign`, not
`createNameplate` (a staked yard board); the number is `village.treasure.found`, told to the record by
`applyVillage`.

**The hunt is played by `web/js/treasure.js`, drawn by `treasure-site.js`, and its state is in three places**
([Plans/schatkaarten.md](Plans/schatkaarten.md)). `createTreasureHunt(deps)` holds the rules and touches
neither the DOM nor the network - the book, the walker, the view and every answer of the island come in as
functions, which is what lets `tests/treasure-hunt.test.mjs` play a whole hunt on a fake walker and
`tests/treasure-walk.test.mjs` on the real one; main.js wires it in `startTreasureHunt`. State: the quest
book (`promptholm.quests`, plus `card` in `promptholm.finds`, quest-log.js's), **our own keys in that same
`promptholm.finds` object** (`bottleDay`, `dug` seeds, `statue` = where she lies once dug up; every write
reads the whole object and writes it whole, as quest-log.js does for `card`), and the island's
`data/treasure.json` (`POST /api/treasure`, keeper-only: `keeper()` = `!state.guest` and not the phone).
The bottle comes only on a world day someone worked (`workDays` off `house.lastAt`), only with the shovel
owned, never while the first hunt's map is in hand (`bottleAllowed`), one per day (`bottleDay`). The statue
after the first dig is **not** derived from the map (dug up, the card is cleared): `finds.statue` keeps her
island/islet/world spot so she stays on the sand across a reload, and `treasure.json` says `buried` until
she is lifted. A page that loads and finds `lifted` sends `dropped` (`boot`), and `pagehide` sends it with
`keepalive` when she is in the arms or on a boat: the unique statue is never lost, and only `placed` is final.
The square is offered while she is in the arms as an interactable whose x/z are the *walker's own* inside
`SQUARE_REACH` (distance 0), because the walker takes the nearest thing and the square is crowded; the boat's
prompt is a getter on `walk.carrying()` ("lay the statue on the boat"). E at the X turns the body towards it
before `walk.dig` (the hole is `DIG_REACH` 0.6 ahead of the feet; `DIG_TOLERANCE` decides if it is on the X).
Late quest events are caught up (delivering also reports lifted and boarded), the book ignores one that is not
its current step. Known gap: once the statue stands in the town, a second browser's first-hunt map digs an
ordinary chest and its `bring-it-home` chain cannot advance. `?hunt` puts `__state` on window.

**The Salty Kraken is a pub at the water, a third room, and the crew that tells the rest of the story**
([Plans/piratenkroeg.md](Plans/piratenkroeg.md)). Rung 52, `civic:piratetavern` (`PUB_ID`), a three by three
in `AT_THE_WATER`, `FACES_WATER` and `CLAIMS_LAND` but not `QUAYSIDE`: its lot comes from **one function,
`pirateTavernSite`**, which today only calls `harbourSite` and which the quay work (`fix/quay-en-rivier`)
retargets to the pirate bank of the haven funnel - never change `harbourSite` for it, and hold no test to a
distance from one harbour. A new civic plot, so a minor. Outside it is a hero bake (`assets/piratetavern`,
3838 of 4000 with the sign's arm) with **no `anchor.flag`** - main.js hangs the district's flag on every one,
and it flies its own Jolly Roger - and an `anchor.sign` where `web/js/piratesign.js` hangs the swinging sign at
`PIRATE_SIGN_YAW` (the upper storey's two-degree twist). E answers from the lot's middle (`kind: 'tavern'`,
`room: 'piratetavern'`), since its door's step is wet. Inside is `ROOMS.piratetavern`
(`web/js/pirate-tavern.js`): four rectangles, the camera kept in the hall, the cellar or the oriel (`areas`, a
low `ceiling` per area takes the lid off earlier), and **exactly seven PointLights**, the tavern's count, which
is in the building material's program key. `talkers` (`kind: 'crew'`) go to `onTalk`, a seat's first order to
`onOrder`, both `createInterior` options. The crew are instanced settlers drawn with `anim: 'sit'`
(`sitPose` in settler-figures.js, off `f.seat = { h, rest }`): drawing only, not in the wire's `ANIMS`, and
`tests/sit-pose.test.mjs` holds feet out of the floor. Captain Spack Jarrow is a fetched GLB
(`web/models/spack-jarrow.glb`, unaltered, `web/js/captain.js`) under the imp's rules: loaded on the first
`enter()`, once, a failure said once, nothing waiting - a crew figure stands in until he lands. The room's
dressing is primitives for now and is to be redesigned as a bake (Plans/piratenkroeg.md, "Ontwerpvraag voor
Fable"): only `parts`/`roof` go, the seats, blockers, lights, talkers and show stay data.
**The story goes on with the crew** (`shared/quests.mjs`): `CREW` (ids, names, idle lines), three chapters
after *Bring It Home* on the events `drank { where }` and `dived { depth }`, a step's `least` and `times` (Three
Chests counts the day's chest), and **repeatable quests count alongside the story** in `advance` - or an island
with no pub would stop the day's chest for good. `businessWith(state)` is who the `!` hangs over (the log's
`talk` is that id now, not a boolean); `QUEST_STATE_V` stayed 1, so an old book goes on at the captain.
`web/js/pirate.js` is one window for every giver (`createQuestGiver`; `createPirate` opens it on him).
**Music in rooms**: `web/js/sound.js` has two computed songs on one bed (`makeSong`, `steerSong`,
`songClock`, `clockOf(room.music)`) - the rave and the Kraken's jukebox (`SHANTY_SONG`: three tunes, every one
on the same 0.6 s count so the crew nod through the loop; 44.1 kHz, 13.5 MB, made only near the pub) - and
**the keeper's own tracks**: `HOME/audio/{kroeg,rave,pirates}` (`lib/music.mjs`, `/api/music`, not on
`PUBLIC_API`), played whole one after the other through a media element main.js hands in (`makeElement`), so
sound.js itself still fetches nothing. `audio/` is gitignored for a worktree, whose HOME is the checkout.

**A hamlet's name stands over each way in; the entrances are derived, and the keeper may set them.**
`entrancesOf` (`shared/entrances.mjs`, the one sum the page and the server both make; the page's wrapper is
`hamletEntrances` in `web/js/hamlet-sign-placement.js`) finds where the road network crosses the edge of
the hamlet's land: two paved cells side by side, one on the land and one off it. Never two consecutive cells
of one path - a path records only what it paved itself, so consecutive cells can lie a street apart (that is
what once put a sign in the middle of AgentVillage). A road is a road: every road counts, whoever laid it and
whatever it leads to (polder, harbour, keeper, the `path:civic:*` roads to the town's buildings), but not a
house's front path - that touches the fence wherever a house stands and made entrances in the middle of
nowhere. One per side (N/E/S/W - never two on a side; a second gate replaces the first), at most `maxEntrances(population)`
(1 to 4, `ENTRANCE_STEPS`). A hand-built bridge lies where it happens to lie: it counts as road while it stands and
is never stored as an entrance, and it lays no roads (to join one to a hamlet, put the hamlet's gate on its
landing, or draw a road). On one side
the keeper's gate wins, then the hamlet's own road, then a bridge built by hand, then the crossing nearest the
middle. **The keeper sets them with the planner's Gate tool** (key 7): the `gate` op in `lib/plan.mjs`
(`opGate`) writes `layout.gates[district][side]` = `{ at }`, `{ closed: true }` or nothing, judged like every
op (on the edge of the hamlet's own land, dry, unbuilt, a road able to leave it for the square, and within
the size's allowance - the keeper's gates count first). `placeAll` then lays `road:gate:<district>:<side>`
from the gate to the square (sticky, like a polder's approach; the op takes it off the list when the gate
moves or shuts, and a `move` carries a gate with its land), and `village.gates` reaches the page. A stored
gate that is no longer on the land or its edge is ignored, not obeyed. With two or more entrances the board
says which under the name, on the same board (`createNameplate({ sub, subBack })`): "North entrance" on the
front, seen from outside, and "North exit" on the back, seen from within. `hamletSignSites` stands the arch
*over* the road exactly on the boundary fence's line - half a cell out from the cell the road leaves the land at
(`fx`/`fz` in the site, added to `cellWorld` in main.js), in the fence's own opening, posts on the cells either
side (checked against every path, plot, deck and earlier sign; on the fence line a post may stand on the edge
of a house's lot, never on paving; a keeper's gate needs no paving under it yet). Where that is impossible it
falls back to a cell of the road one step out or up to three in, and with no straight stretch there is no sign:
a gateway beside the road in the grass read as a mistake. The fence opens at a bridge's foot and at a
keeper's gate too (`setBridgeRoads` in `world.js`, fed from `syncHamlets`). Planning hides the arches, so
`plan-mode.js` draws the same entrances on the overlay (`setGates`: bar over the boundary, green arrow in,
orange arrow out, the side's name), with the draft's gates patched over the island's.
`tests/entrances.test.mjs`, `tests/hamlet-sign-placement.test.mjs`, `tests/plan-gate.test.mjs`
([Plans/DONE/ingangen-en-bruggen.md](Plans/DONE/ingangen-en-bruggen.md), [Plans/DONE/ingangen-verplaatsen.md](Plans/DONE/ingangen-verplaatsen.md)).

**The castle is the one square civic lot that is not three by three** ([Plans/DONE/groot-kasteel.md](Plans/DONE/groot-kasteel.md)):
`CASTLE_LOT` (7, two super-cells square with the lane between them) in `lib/layout.mjs`, and
`web/js/buildings.js` draws a 7 as the great castle (`assets/greatcastle`,
`scripts/build-greatcastle.py`) and anything narrower as the old `assets/castle` bake - never
one scaled to the other: at 7/3 the gate was a cell wide and a storey and a half tall, and a
bigger building gets more windows, not bigger ones (`tests/castle.test.mjs` holds the gate to
the town hall's door). The volcano's guardhouse is the small one. Read a civic lot's size off
`p.w` and `p.d` and never assume 3 - `doorCell`/`outsideDoor` take both, and `plotDoor` (below)
is the door every reader asks. `castleSite` places a new one on the nearest free, flat (`CASTLE_RELIEF`) lattice
block of town or nobody's land, never a civic lot, and `claimForTown` puts that land in the
commons; `growCastle` grows a castle from before this where it stands, front kept, over FREE
cells only - never over a road, its own included, because a road laid later over another's
cells never recorded them - and otherwise leaves it the old size. No version gate: `w < 7` is
the gate.

**Past a hundred the ladder goes to the sea, on the first lots that are not square**
([Plans/DONE/mijlpalen-tot-tweehonderd.md](Plans/DONE/mijlpalen-tot-tweehonderd.md)). Eleven rungs from 95
to 200; three share civicType `ship`, so a rung may name its building (`civicId`, and
`civicIdOf` in lib/village.mjs is the one copy - the model, scan.mjs and the placing loop all
ask it). `lotOf` gives `{ w, d }` as at rot 0 and `stamped` swaps them at an odd rot: a ship is
4 x 16 (`civic:ship`, `civic:ship:2`, `civic:ship:3`: no door, no road), the shipyard 5 x 16 with
its gate where the model has it (`YARD_GATE`, the baked `anchor.door`, turned by
web/js/shipyard.js's own quarter turns). `plotDoor(id, p)` is the one reading of a door -
scan.mjs's `door`, the civic roads, the planner's doorsteps and `stranded` - so never ask
`outsideDoor(..., p.w)` of a lot that may not be square - and never `p.w >= 3` as "has a door",
which counts the ships. The warehouse, weigh house, fisherman's hut and the Salty Kraken open on the
sea (`coastSite`), so their door's step is water and the road finds the lot from its sides.
`coastSite` takes a lot only if `civicRoad`, tried with the lot stood on the grid, begins
within `GATE_REACH` of the door (`atDoor`: `houseGate`'s box, where a settler finds a road -
a `path:` further off is a road on paper). It puts the trial cells back to what they were, not
FREE, because beach is BLOCKED. Failing every harbour, `harbourSite` goes round again with
the door on one cell of beach and open water straight past it. `civicRoad` paves the sand it
walks: the **strandpad** ([Plans/DONE/strandpaden.md](Plans/DONE/strandpaden.md)) goes
into the path's `cells` and into `paths[].strand`, which the replay (placeAll's and
`replayGrid`) forces back to PATH while it is still BLOCKED land, since the replay otherwise
paves only FREE.
`growCanvas` shifts it. A new layout.json field, so it ships in a minor, not a patch.
**Sixteen is a ceiling, not headroom**:
`parseBundle` takes a `w`/`d` of 1 to 16, and a lot one cell longer makes every older sea refuse
the whole island. What stands at the water goes to the **kadehaven** (`kadehaven`: the quay
district's harbour; else where the island's first boat lies - the landing's quay, or the harbour
on its side of the town; else the one nearest the town), worked out every scan and never
stored; the crane falls back to it, which is what gives an island with no quay district - the
live one - a crane at all. Ships anchor on the **rede** (`redeCell`: deeper than `REDE_DEPTH`,
open sea, not the fairway, two cells off every plank, slipway and berth - all three berths of
every harbour, boats or not - out of every pier head's lane, out of the galleon's `GALLEON_ROOM`,
not a polder; 8 to 20 cells from the head), the second and third beside the first `FLEET_PITCH`
apart. Where the galleon lies is `shipBerth` in **shared/quay.mjs**, the page's old sum with its
`sin`/`cos` written out as V8's own doubles, so the layout and every page agree to the bit
(`tests/ship-berth.test.mjs`). The polders keep off a ship and the yard and a ring round them
(`keptWater`), a ladder polder that would pond one is filled in again in the same scan
(`afloatDrowned`) and a keeper's is refused; a growth ring that fills their water moves them on
purpose (`strandedAtSea` in `doomedBy`) and lifts their `path:` with them. The rungs at the water
wait for the harbours on an island's first scan (`deferred` in `placeAll`) and are placed straight
after `planHarbours` in the same pass, so the scan after it is still a no-op. The yard's record
carries `stage` 0-4 (`yardStage`), strict in `parseBundle`, because a bundle has no settler
count. No version gate: nothing but new plots. On the page the Batavia floats (`floatingPose` in
web/js/batavia.js, never `groundAt` of the sea bed) and is solid through `shipSolids`: slabs a
unit long with a `hull` height that `hullOver` in boat.js hands a boat's bow and probes, because
a level is a cell and her side lies on no cell edge. The yard stands on its land end
(`shipyardGround` in web/js/shipyard.js, never below `YARD_FLOOR`), which is why its site keeps
the dry rows under `YARD_LAND_MAX`: any higher and the slipway's toe comes out of the water. Its
last stage is not the yard's own model but the Batavia's bake laid on its keel (`bataviaOnStocks`
in web/js/buildings.js: turned stern to sea, less her rig, flags, boarding ladder and spare
anchor, repainted in timber by her baked colours), so a change to scripts/build-batavia.py is a
change to the yard too - tests/shipyard.test.mjs says so.

## The Blender pipeline

`assets/<set>/<set>.blend` → `npm run models` → `web/js/<set>-mesh.js` (committed).
[assets/README.md](assets/README.md) is the full house style; the short version:

- 1 Blender unit = 1 island unit = 1 ground cell = 4 m. `game(p) = (p.x, p.z, -p.y)`.
- The front of a model faces **+Z** on the island (−Y in Blender). The origin sits on the
  ground, in the middle of the footprint.
- A material name's prefix up to the first colon is its texture sheet: `plain`, `wall`,
  `roof`, `stone`, `plank`, `plankZ`. `bark` and `foliage` belong to the forest and the
  hedge, which are not drawn with the building material.
- Triangle budgets follow the name prefix: `flora_` 60, `prop_` 120, `addon_` 150, `roof_`
  300, `house_` 600, `civic_` 1500, hero 4000.
- A set that stands over water is modelled in **one frame**, with its piles' feet at y = 0
  and everything else measured from there, so the island can drop the whole set by one
  number (`QUAY_DECK - DOCK_DECK` in `buildings.js`) and get a deck with no step in it.
  `assets/docks` is the worked example; `tests/docks.test.mjs` asserts the joins.

The rules live once in `scripts/model-rules.mjs`, and `tests/models.test.mjs` runs the same
`checkAll()` over what is committed — so the suite catches a bad bake on a machine that has
no Blender. `npm run models` is idempotent; a second run that changes a byte means the bake
is not deterministic.

A part that moves but does not stand on the ground (the sawmill's blade, its log, its rollers)
is baked *inside* an asset that does, with its Blender origin on its own axis, and the building
leaves it out of the merge with `meshAsset(name, hex, { skip })` - `isSawmillMoving` in
buildings.js is the example, `web/js/sawmill.js` hangs the parts on their `at`. A separate asset
for it would fail the on-the-ground rule; the windmill's sails dodge that with a hard-coded lift.
The smithy adds the other half of that pattern: a still part baked only to be *measured* (the
anvil, whose `at` is where the smith strikes) and `anchor.door`, and a passive settler - the
player rig (`createClassicAvatar`) with a hammer, nobody's agent - driven by `web/js/smithy.js`
off `uNight` (Plans/DONE/smidse.md). A glow that dims at runtime sets `aEmissive` below 1 on its
geometry; the bake still only allows 0 or 1.
Something hung off a wall cannot have its origin on its fixing: every asset's lowest point must be
y = 0. `assets/piratesign` (the Salty Kraken's sign, `web/js/piratesign.js`) is the pattern: wall at
x = 0, arm along +x, y = 0 at the board's foot, and `anchor.sign` on the wall fixing, which the
module subtracts (`pirateSignFrame`) so a building names only its facade point and a yaw. Merging
baked slots by hand, go through `mergeParts` from buildings.js, never `mergeGeometries`: only
sheeted slots carry `aSheet`, and the bare merge returns null.

**The Salty Kraken's kit is one module per object** (`scripts/krakenkit/<object>.py`: `ASSET =
'civic_kraken_<object>'` and `build()`, on `geom.py`'s bmesh helpers rather than one Blender object per
primitive, which at a few thousand coins was minutes of operator calls). `scripts/preview-krakenkit.py --
<object>` builds and renders one without baking, so several can be worked on at once; `scripts/build-krakenkit.py`
bakes the set - always whole: given a list of objects it writes a module with only those and drops the rest.
A piece whose size varies (a gallery deck, a gangplank, a truss) is a module of functions the room's own scripts
call (`deck.py`, `walkway.py`, `frames.py`, `hatch.py`), plus a showcase `ASSET` so the preview has something to
render; a fixed piece is placed by pirate-tavern.js at `KIT` in the layout. Every piece starts at y = 0 at its
lowest point, so what the room hangs it by (flames, a chain's top, a beam) is a module constant (`FLAME_Y`,
`RING_TOP`, `BEAM_Y`), repeated in `KIT` where the JS needs it. `geom.bake_ao` bakes Cycles ambient occlusion into the vertex colours (the
exporter reads a colour attribute instead of the material's colour), which is where a painted reference's
depth comes from with no textures. Two things were needed to make a second bake the same bytes: Cycles on
**one thread** (the sample order varied), and **`canonical()`** on every primitive in `emit` - bmesh's
`recalc_face_normals` and `convex_hull` reach the same faces by a different route each run, so faces are
started at their least corner and sorted. The Blender preview does not show the island's plank and stone
sheets, so how a kit piece looks is judged in the game (`/demo`, E at the Salty Kraken). The keeper's
reference sheets live outside git in `D:\git\Martijn\AgentVillage\refs\krakenkit\` (photos of others among
them); `Plans/piratenkroeg.md` has the prompts and the state of every piece.

## The two workbench pages

- `/demo` — every object the island can build on one field, with a night slider and a
  **Hitbox** view (amber is the solid part, red is where a settler's middle stops).
- `/editor` — the same sheet with drag handles. **Save** posts whole lines to
  `/api/model-save`, which rewrites `web/js/buildings.js` only when each line is found
  exactly once. A line that does not match word for word (a colour by variable,
  `x: W / 2 - 0.08`) is found by its call site instead: with `traceParts(true)` (the
  editor only) every primitive's note carries line:col off the stack, and `inPlace` in
  `web/js/editor.js` changes only the moved numbers *by their delta*, folding into a
  trailing constant, so formulas survive. Refused and named: a placement that is a call
  (`inside(a, {})`) or a spread missing the key, a call over several lines, and a line
  that draws several pieces (loop, helper called twice) not all changed alike. A line
  in a helper two models share (`noticeBoard`) changes both.

Debug query params: `?hunt` (`__state`/`__camera` on window without the dive: walk with
`document.getElementById('walk-btn').click()`, teleport with `__state.walk.state.pos.set(x, y, z)`, read
`__state.hunt.sites()`; the browser pane runs no frames between screenshots, so take one to let time pass),
`?quest=<id>[:<step>]` (the quest book jumps to that quest of shared/quests.mjs with the story before
it told and its rewards granted - `?quest=a-round-for-the-crew` plays the Salty Kraken without the first
hunt; it is written to `promptholm.quests`, so it lasts after the reload), `?nointro`, `?hour=21`, `?stats`, `?sky=rain`, `?rave` (the castle's
Saturday-night rave open at any hour, Plans/DONE/rave-in-het-kasteel.md), `?tipsy=0.8` (start that
drunk), `?edge` (walk mode starts at the world's east edge, to try the jump round it), `?dive`
(walk mode starts in open water off the east coast: C sinks, Space rises; it also puts `__state` and
`__camera` on `window`, which is how a test browser reads the walker and the camera - hold a key with
`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'c' }))`, since a tapped key is up before a
frame has seen it, and mind the 30 s of air: staying under in a screenshot session drowns you). (`?sail` is gone with the
browser's own boating — outings are the sea's, and `eager` is a flag on `createBoating`
there.)

## The desktop window

`src-tauri/` is a Tauri 2 shell around the islander, not a second viewer: the window is a
WebView2 pointed at `http://localhost:4747/`, exactly what Chrome's `--app` window shows. **Nothing under `web/` is bundled** — the scaffold's Vite route (`web/` → `dist/` →
`http://tauri.localhost`) was removed because it broke three invariants at once: `api.js`
would work `mine()` out from the wrong origin, `lib/access.mjs` refuses an Origin that is not
the Host on every route, and the import map for `three`/`shared/` is the no-build-step
contract. [Plans/DONE/eiland-als-desktop-app.md](Plans/DONE/eiland-als-desktop-app.md) has the full
argument. Which means a `web/js/` change (like a minimap.js/classic-avatar.js edit) or a
server-side one (`lib/`, `serve.mjs`) never needs `npm run app:build` — the window only ever
fetches the running islander live, the same page a browser tab would get, and a reload of
the window (or the same server restart a server-side change already needs) is all it takes.
Only a change under `src-tauri/` itself - the splash, the port probing, window behaviour,
the icon - needs a rebuild. **Two exes from one crate** ([Plans/DONE/islander-als-eigen-exe.md](Plans/DONE/islander-als-eigen-exe.md)):
`promptholm.exe` is the interface, `promptholm-island.exe` (`src/bin/promptholm-island.rs`,
tray-icon + tao directly, no Tauri, no WebView) *is* the islander — it starts
`node serve.mjs --no-open --supervised` as its child, output appended to `data/server.log`,
and keeps a tray icon (open / browser / stop-start / restart / log / quit). `--supervised`
makes serve.mjs `shutdown()` when its stdin closes: Windows has no SIGTERM to send from
outside, so that pipe is how Stop is polite, and why a killed islander exe leaves no node
behind. One islander per port (named mutex); an island started by hand is adopted, and its
Stop is `kill_listener` (netstat for the pid, `taskkill /f`). A tray whose island was
stopped from its menu still holds the mutex, so a second copy that finds nothing listening
*knocks* (a named event beside the mutex, `Local\Promptholm-island-<port>-knock`) and the
keeper starts its island; a keeper from before the knock gets a message box instead.
Exiting there without a word was the "the exes are broken" of 0.4.0: double-click, nothing,
and the window's minute ran out. `src/island.rs` is shared by both
through `#[path]`, so it must never reach for Tauri. Neither exe has a console, in debug too.
**A release is a folder, not a checkout**: `npm run app:pack` (`scripts/pack-release.mjs`)
lays out `dist/Promptholm/` - `promptholm.exe` alone on top, and the island in `app/` beside
it with `promptholm-island.exe` in there too, so nobody has to ask which of two exes to start;
the window looks for the islander in `app\` before beside itself (a release unpacked over an
old one keeps the old islander on top), and the islander finds its root as its own folder
*before* `CARGO_MANIFEST_DIR`. The island is copied *by
name* like `Dockerfile.sea` (a runtime import from a new top-level folder must be added to
its list). `app/release.json` is its marker. **The island's own files live in one home
for a release and a checkout alike** ([Plans/DONE/een-thuis-voor-het-eiland.md](Plans/DONE/een-thuis-voor-het-eiland.md)):
`HOME` in `lib/paths.mjs` (config.json, data/, .env) is `PROMPTHOLM_HOME`, else the checkout
itself for a *linked worktree* (a `.git` file - a sandbox, or a preview server in one works on
the real island and publishes under its sea token), else `~/.promptholm` - so a new release
runs on the island the debug build left. Decided from the files alone because the session
hook runs with none of our environment; `home()` in `src/island.rs` is the same rule and
must stay it, or the tray's log and the server's are two files. Not AppData, measured: the
Claude desktop app is an MSIX package, and every AppData write by it *and by anything it
starts* - the session hook, which scans and so writes layout.json on every session, and an
islander a session restarts - lands in `%LOCALAPPDATA%\Packages\Claude_<id>\LocalCache\`, a
second layout.json that Explorer and an exe the user starts never see. Importing
`lib/paths.mjs` moves an island into `~/.promptholm` when it has no config.json yet
(`settleHome`): copied, not moved, from the island the session hook points at (the real
one), else this code's old home (the checkout, or `%LOCALAPPDATA%\Promptholm` for a
release), logs/locks/`guests`/`print` left behind, config.json last, one process under
`moving.lock` while the rest wait, and a failed copy runs on the old home rather than
founding an empty island beside it. **Importing lib/paths.mjs outside a worktree is
therefore not free**: a `node -e` probe of it moves the island, so `tests/home.test.mjs`
copies the module into a scratch checkout and imports it in a child with its own profile.
The islander runs `setup.mjs --first-run` when
HOME has no config.json (leaves an existing hook alone, since it may be a checkout's), tells
the user in a message box when there is no node, and leaves the folder it ran from in
`~/.promptholm\checkout.txt` so a stray exe elsewhere can still find the island. Testing
AppData behaviour itself (the WebView2 profile, an old release home) from a Claude desktop
session hits the same redirect: a process made through WMI (`Invoke-CimMethod
Win32_Process -MethodName Create`) runs outside the package and sees and writes the real
AppData, exactly like a double-click. Shortcuts made through the `WScript.Shell` COM object
are not redirected either.
What the window adds is what a browser cannot: it probes the port and, if nothing answers,
starts the islander exe (in `app\`, or next to it in a build folder; node directly when that
exe is missing).
**The islander outlives the window, and there is never more than
one.** Outliving a plain close is free on Windows; outliving a tree kill (`taskkill /T`, Task
Manager's "End process tree", closing the terminal that ran `npm run app`) is not, so the
window starts it through a second copy of its own exe (`--spawn-island`) that exits at
once — the islander's parent is a dead pid before anybody walks the tree. That go-between is
waited on with `status()`, never `output()`: its stdout/stderr pipes are inherited all the way
down to node, so `output()` waited for node to *exit* and the splash sat on "Starting the
island" while the island was up. The window opens on `src-tauri/splash/index.html` and is navigated
to the island once the port is up; the splash asks Rust to begin (`start_island`) so no
event is emitted before anybody listens. Links to other sites (`on_new_window`,
`on_navigation`) go to the system browser, so a Jira ticket cannot replace the island with
no back button. Port order is `--port` → `PORT` → `config.json` → 4747, the same as
`serve.mjs`; `--url` attaches to an island elsewhere and starts nothing; `PROMPTHOLM_ROOT`
tells a stray exe where the checkout is. The window is built in Rust, not declared in
`tauri.conf.json`, because `additional_browser_args` (which *replaces* Tauri's default
`--disable-features=…`, so that has to be repeated) and the two navigation hooks only exist on
the builder. Pitfall: a `cargo build` that fails reading permissions from a path that no
longer exists is a stale build-script cache — `cargo clean -p tauri -p tauri-build -p
promptholm` in `src-tauri/`, not a full clean.

## The phone

`src-android/` is its own Tauri crate, and the one place `web/` *is* bundled: a phone has no
islander, so none of the desktop's reasons apply ([Plans/eiland-op-android.md](Plans/eiland-op-android.md)).
`npm run android:pack` copies `web/` + `shared/` to `src-android/dist/` and writes
`window.PROMPTHOLM_STANDALONE = { sea }` into that copy's head. No key, deliberately: an
APK is a zip anybody can read, so the open sea runs with no `SEA_KEY` (anybody may join;
an island's claim token keeps its name) and the restart button has its own
`SEA_ADMIN_KEY`; the pack only bakes a key given by name (`--key`), for a private sea.
`release.yml`'s `android` job builds and signs it on every tag. The launcher icon is the
committed `gen/android/.../res/mipmap-*`, not `icons/` (which only the desktop reads) - it
shipped as Tauri's default logo up to 0.6.3; regenerate it from the maskable island with
`npx tauri icon ../web/icons/island-maskable-512.png -o <tmp>` in `src-android/` and copy
`android/mipmap-*` over. `STANDALONE` in `web/js/api.js` makes
`mine()` refuse without fetching (the app origin answers every path, and a 404 "from the
islander" is the keeper's mode); the page then has no island at all: home is a free berth of water (`nextOrigin`, drawn on
`makeTerrain(…, { open: true })`, which is sea edge to edge), the body joins as a wanderer
(`island: null`; a hostile island that catches it sends it back to its skiff instead of a
square, the boat's id in `evicted`), it starts in a *skiff* - a boat with no mooring, `boat:w-<player id>`, which the
sea makes on `launch`, lets only its owner sail and sinks when that socket closes
(`lib/boats.mjs`; relaunched under the new id on every welcome) - never leaves walk mode, and is
driven by `web/js/touchpad.js`, which polls like a gamepad so walk.js needs no touch code.
`npm run android:apk` builds a debug-signed arm64 APK; it needs JDK **21** (the template's
Gradle 8.14 does not run on 25) and `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`. To try the
page without a phone, serve `src-android/dist/` from any static server — that origin has no
islander behind it either.

**Touch is a pad with two extras, and the phone's HUD is one CSS block.** `web/js/touchpad.js`
polls in `gamepad.js`'s shape (A jump, X interact, Run = `L3`, and on foot B crouch and Y
bike - the walk map's own buttons, so they needed no code in walk.js), laid out after Xbox
Cloud Gaming's touch controls: `.tp-cluster`, a faint thumb circle with every button placed by
`--x/--y` from its middle and mirrored by `--flip` for `lefty`, outline SVG icons with the pad
letter as a coloured badge (`ICONS` in touchpad.js). Plus two fields only
`walk.pad()` reads through `p.raw`: `drag` (px since the last poll, turned like the mouse by
`DRAG_YAW`/`DRAG_PITCH`, **never × dt** - that made look speed follow the frame rate) and
`zoom` (a pinch factor for `zoomBy`). The stick is round with a dead zone (`stickOut`, tested).
The hand buttons bypass the pad and call `walk.hand(side, down)`; `touchHud` in main.js sets
X's caption and shows the hands, B and Y (`.tp-foot`) only `walk.onFoot()`. A short still tap on the look side is
`tapName` (guest figures only - the phone has no island). The camera's distance is `base ×
zoomPref` (`place()`), so a zoom survives boarding; a boat now waits `RECENTRE_AFTER` like the
bike before swinging back. Per-device settings live in `web/js/phoneprefs.js` (localStorage,
read live; `quality: 'light'` is the default and means `modest`, since `MODEST_GPU` knows no
phone GPU). A keeper's conversation has its own input mode (`parley` in `input.js`: X/B/BACK)
and a tappable `#speech` - Esc was the only way out. Android's back button: `phoneBack()`
holds one `history` entry while any overlay is open and `popstate` closes them. All phone
layout is under `body.standalone` in `web/css/ui.css`, edges from `--sl/--sr/--st/--sb`
(`env(safe-area-inset-*)`, the APK draws into the notch), toasts and island chat moved out of
the stick's half with `pointer-events: none`, and a `max-height: 480px` block for landscape.
The radar is tappable (opens the chart; `createWorldMap({ phone })` adds its ✕ and tap-to-name)
and sizes its canvas off its box. To see it without a phone: `node scripts/pack-android.mjs`,
serve `src-android/dist/`, and drive it with Playwright's touch emulation.

**Updating goes through Rust, not the page** (`src-android/src/lib.rs`): the page sits on
`tauri.localhost`, and a GitHub release asset carries no CORS header. `latest_release` asks
the GitHub API for the newest tag, so the app's update gate (`updateGate`'s `latest`) goes up
as soon as there is a release, not only once the sea is updated; `install_update` fetches the
APK into the app's cache and hands it to Android's installer through **our own Kotlin**,
`InstallerPlugin.kt` beside `MainActivity.kt` in `gen/android/app/src/main/java/com/promptholm/sea/`
(a `@TauriPlugin` class in the app module, registered from `lib.rs` by name with
`register_android_plugin`; a content:// URI from the manifest's FileProvider, `cache-path` in
`res/xml/file_paths.xml`, so the file has to be in the cache). Not the opener plugin's
`open_path`: on Android that hands a bare path to `ACTION_VIEW`, nothing answers, and up to
0.7.0 the button fetched the whole APK and then fell back to the browser, whose download sat at
100% and never installed. Both are app commands, so they need no entry in
`capabilities/default.json` (only plugin calls from the page do).

## Layout of the source

| | |
|---|---|
| `scan.mjs` / `serve.mjs` | the two entry points |
| `lib/` | sources, parsing, the village model, `layout.mjs` (plots, hamlets, roads), `plan.mjs` (the keeper's hand: moving hamlets, zones) + `survey.mjs` (the land register as bits, for the planner's preview), `access.mjs`, `dispatch.mjs` (spawning agents), `sprint.mjs` / `issues.mjs` (the two noticeboards), `mail.mjs` + `imap.mjs` + `smtp.mjs` (the postbox), `usage.mjs` + `statusline.mjs` (the gold pit's reading, and putting the status line into `~/.claude/settings.json`), `ws.mjs` (hand-written, no dependency); on the sea side `guards.mjs` and `residents.mjs` (the volcano's guards, and every islander's Codex settlers housed on it) |
| `shared/` | terrain, regions (the world/local contract), `lattice.mjs` (the super-grid arithmetic: `blockOf`, `superOf` — the one copy), rng, crops, shapes, `boating.mjs` (settlers taking a boat out), `hull.mjs` (how a hull sits in the water) — Node and browser both |
| `web/js/` | `crowd-view.js` (every island's people, ours too, off the wire), `guest-island.js` (a region at a berth), `record-batch.js` (every building body on an island in one BatchedMesh), `boat.js` (`stepBoat` is pure), `main.js` (boot, camera, animation queue), `world.js` (ground, sea, forest, sky), `buildings.js` (every primitive shape), `hamlets.js`, `walk.js`; the inventory is `studio.js` (markup, the two renderers), `inventory.js` (the slot table, DOM-free and tested) and `popover.js` (one floating picker at a time); the settlers are in three files — `settler-walk.js` (a re-export of
`shared/settlerwalk.mjs`, kept for the workbench pages), `settler-figures.js` (what is
drawn; every mesh and every sine wave) and `settlers.js`, which nothing simulates out of
any more — what is still imported from it is the wardrobe and `figureGeometry`; `*-mesh.js` are baked output — never hand-edit |
| `web/css/` | `ui.css` is the layout, `harbour.css` the theme loaded after it — and it overrides positions too (`.panel { top }` per breakpoint), so a rule for the phone (≤480px, where a panel is a bottom sheet) belongs in harbour.css's media block or it silently loses |
| `scripts/build-*.py` | author the `.blend` files; `export-models.py` bakes them |
| `tools/island.mjs` | the island's own CLI: `where`, `look`, `build`, `remove`, `reload` — talks to the running server over HTTP |
| `docs/manual.md` | what everything on the island means; `docs/next/` is written-up work that is *not* done |
| `site/` | promptholm.com, the landing page: static, no build step, light only, published by `.github/workflows/site.yml`; its download buttons use `releases/latest/download/<asset>`, so keep the asset names `release.yml` makes ([Plans/DONE/website.md](Plans/DONE/website.md)) |

`data/` and `config.json` are HOME's - `~/.promptholm`, or a worktree's own (see the desktop
window above) - and a checkout's own `data/` is only the backup an island moved out of
(`data/MOVED.txt` says so). `data/` is generated and safe to delete, with four exceptions: `layout.json` (above),
`garden.json` (the walker's purse and beds — the scanner never touches it), `mail.json`
(mail server credentials, deliberately gitignored twice) and `animal-events.jsonl` (the story
animals' journal - their names, bonds and marks rebuild from nothing else; `animals.json`
beside it is only a checkpoint). `config.json` is per-machine and
untracked; `config.example.json` is the template.

## Conventions

Commit messages are in Dutch: one imperative line saying what changed in the island's own
terms ("Zet de kerk op de maat van het stadhuis"), with the reasoning in the body when there
is any. Code, comments and documentation are in English. Comments carry the *why* — which
alternative was tried, what broke, which number this is the only copy of — and the existing
files set a high bar for that; match it rather than stripping it back.

The product is **Promptholm** everywhere: the npm package, the crate, both exes
(`promptholm.exe`, `promptholm-island.exe`), the `.blend` sources, titles, log prefix and every
environment variable (`PROMPTHOLM_*`; the old `SETTLERS_*` names are gone, with no fallback).
"Settlers" survives only as what the island's inhabitants are called (`web/js/settlers.js`,
`village.settlers`), which is the game's vocabulary rather than its name. The exceptions are
deliberate: the GitHub repository and its URLs are still `AgentVillage` (renaming it is the
owner's call), and `agentvillage.xeroxmsj.freeddns.org` is a real hostname.

Environment variables: `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` (the cork board),
`PROMPTHOLM_GITHUB_REPO`, `PROMPTHOLM_MAX_AGENTS`, `PROMPTHOLM_PORT`, `PROMPTHOLM_CLAUDE_HOME`,
`PROMPTHOLM_CODEX_HOME`, `PROMPTHOLM_ROOT` (which checkout the exes run), `PROMPTHOLM_HOME`
(where config.json and data/ live), `CLAUDE_EXE`, `GH_EXE`, `BLENDER`. The sea reads its own: `SEA_PORT`, `SEA_NAME`,
`SEA_KEY`, `SEA_ADMIN_KEY`, `SEA_UPDATE_HOOK` and `SEA_TZ` (the world's time zone by name).
