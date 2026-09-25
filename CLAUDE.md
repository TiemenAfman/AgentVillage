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
still in progress; `Plans/ik-wil-graag-mutliplayer-splendid-nest.md` is the current one.

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
imports `three` fails.

Tests exercise browser modules under Node: they `register('./support/shared-loader.mjs')`
to resolve the `shared/` import-map prefix, and stub `globalThis.document` before importing
anything that reaches `web/js/buildings.js` (it builds a `TextureLoader` at import time).
Copy that preamble when adding a test that touches `web/js/`.

`.claude/launch.json` has `island-worktree` (auto-port, `--no-rescan`) for previewing from a
worktree without colliding with the island already running on 4747. Pitfall: the preview
tool reads `launch.json` from the directory the session was *launched* in and starts the
server there, so from a worktree made by hand (`git worktree add`) it runs the main
checkout's code on the live island in `~/.promptholm` — its own `layout.json`, and a
`POST /api/plan` against it is a real move. To try server code from such a worktree, run
`node serve.mjs --port <free> --no-rescan --no-open` from inside it: `ROOT` is resolved from
`import.meta.url`, and a linked worktree keeps its island in itself (see HOME below), so
that process uses the worktree's own `data/` and `config.json`.

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
scanner never moves a plot; the keeper may, deliberately, through one door — `POST /api/plan`
(`lib/plan.mjs`, applied in the same slot in `scan.mjs` as `clearRoads`, under the scan
queue), which moves **whole hamlets** (lobes, with every house, shed and the land itself, by
a super-cell delta), gives a hamlet land or takes it away (`parcel`: `Super.eligible` for
what is added, never below the hamlet's population or `ensureParcel` grows it straight
back), and paints `layout.zones` (no-build super-cells, countryside only,
enforced exactly like a polder's dike: `heldOf` + `RESERVED`, no hash). A plan is tried on a
copy first, all or nothing; `diff.plots.otherMoved` must be empty and no house may be newly
left without a way to the square (`stranded` in `lib/plan.mjs` — `placeAll` roads a hamlet
as far as the router gets and says nothing) or nothing is written; `layout.before-plan-
<ts>.json` is written before the apply and `POST /api/plan/undo` puts one back; the scan
after an apply is byte-identical again. `placeAll` refuses nothing handed to it — measured,
two houses on a slope of 2.1 were accepted — so the validation in `lib/plan.mjs`
(`Super.eligible` on every destination super-cell, `freeBlock` on a `replayGrid`) is the
feature, not a nicety. Design and measurements: `Plans/wijkjes-verplaatsen.md`.
The keeper may also draw a road (`road` op, `opRoad`): the gaps it crosses become bridges
exactly as long as the gap, and the whole road is kept in `layout.roads` besides what it
paved, because `clearRoads` throws every path away and no door re-routes a road nobody's
house asked for - `replayKeeperRoads` in `placeAll` paves it again (`Plans/wegen-tekenen.md`).
Building by hand (the Build chip, `B`, `buildmenu.js`/`ghost.js`) is off unless switched on
under Settings → Debug (per browser, `promptholm.debug.build`): the planner keeps the town.
Five version gates in `lib/layout.mjs`, in descending order of violence: `LAYOUT_VERSION` (throws away the town
and the terrain — almost never right), `PARCEL_VERSION` (re-plans houses, sheds, parcels,
paths), `ROAD_VERSION` (re-routes hamlet roads and nothing else), `SQUARE_VERSION`,
`QUAY_VERSION` (re-plans the quay alone, its planks included — the one gate that runs from
`placeAll` rather than `loadLayout`, because it has to ask the ground a question). Reach
for the smallest one that does the job. [docs/branches.md](docs/branches.md) lists what to
assert after a layout change, and the trap: **stop the server before measuring**
(tray → Stop, or `taskkill /f /im promptholm-island.exe`), or its own rescan interleaves with yours and every plot looks moved.

**The planner is a third mode, and nothing real moves in it before Apply.** `state.mode`
is `'orbit' | 'walk' | 'plan'`; `web/js/plan-mode.js` renders the same scene through its own
`OrthographicCamera` (north up, so a screen rectangle is a world rectangle) and never touches
`camera`/`controls`, which is what makes leaving free. A hamlet being dragged is drawn as
ghosts (`plan-overlay.js`: the real meshes' geometry under ghost.js's green/red) while the
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

**An island founded small grows, by accretion** ([Plans/eiland-laten-groeien.md](Plans/eiland-laten-groeien.md)).
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
`grow` plan-op on the same `growStep`. New installs are founded with `FOUNDING` (a 32 island on a
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
"accretion never lowers anything" true ([Plans/eiland-laten-groeien.md](Plans/eiland-laten-groeien.md)).

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

**One material, one draw call per building.** Which texture sheet a face uses is a number
carried on the vertex, not a material of its own, and night glow is a per-vertex emissive
mask. Giving a building a material array turns 300 houses into thousands of draw calls.
`?stats` reports the colour pass only — the shadow pass is not in it.

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

**Four harbours, and boats counted rather than listed** ([Plans/vier-havens.md](Plans/vier-havens.md)).
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
makes the new hull appear without a reload, since harbours are not districts. A bundle with no
harbours gets the one dock and one boat of old, so a world of mixed versions still sails.

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

On the drawing side `rev` only decides whether to refetch, never whether to rebuild:
`web/js/islandsig.js` compares a `drawnSignature()` of what is already standing against the
new bundle, because a neighbour's landscape costs the same ~550 ms to build as our own
(trees, fields, hamlets, through the same `createLandscape`), and rebuilding it on every
publish from an active neighbour stalled the frame — `dt` included — three times a minute.

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

**The bicycle is `state.bike`, never `state.vehicle`** ([Plans/fiets.md](Plans/fiets.md)).
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
see a rider through `FLAG_RIDING` (128; `POSE_MASK` is 255 now); a sea still running the old
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
`[0,0]` as the middle: ring 1 lies at its half + `SEA_GAP` + the biggest other half (176 for
64-grids round the 192-grid volcano, 208 for 128s, 272 for 256s; eight to a ring, bearings
first), later rings one ordinary pitch further, so the volcano does not spread everybody else
out. Its shape (`volcanoGround` + `volcanoRelief` in `shared/terrain.mjs`): a buildable apron
up to ~3.5, then a concave cone to a rim ~38 up (summit 41, crater ~10 deep), with radial
ridges and ravines, broken cliff bands, crags, a jagged rim breached where each of its three
flows leaves, three parasitic cones (`crater.vents`) and old lava fields (`terrain.oldLava`,
painted dark by world.js). The relief is added *after* makeTerrain's box blur - blurred, a
feature a few cells across is gone - and world.js paints its bands off `crater.top`, not in
units. A* on it is ~5-10x dearer than on the 128 cone (30-65 ms beach-to-rim, `findPath`'s
`open.sort`), which the hostility tick's 3 searches per 650 ms pay for.

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
(`compareLines`, major.minor): a patch apart says nothing. **A patch release never breaks
compatibility with the island or the sea** (0.4.x runs on any 0.4.y's island and meets it on
any sea): no `SEA_V` bump, no layout gate (`LAYOUT_VERSION`, `PARCEL_VERSION`,
`ROAD_VERSION`, `SQUARE_VERSION`, `QUAY_VERSION`), nothing in `layout.json`, `config.json` or
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
then `BLOCK_FRACTION` on top if a raised shield (`POSE.BLOCKING` 16; mask in
`lib/players.mjs` 127) faces the guard within `FRONT_ARC_COS` (`blowOn`); lava ignores both.
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
`clock.offset()`) whether it is night and whether it is the borrel - `nightAt` / `borrelAt`
in `shared/daylight.mjs`, which say what an hour means and never what the hour is - and
hands both to `crowds.tick` / `setGather`. Without `SEA_TZ` it is the host's zone — which in a
container is UTC, hence `ENV SEA_TZ=Europe/Amsterdam` in `Dockerfile.sea`.
[Plans/klok-en-hemel-van-de-zee.md](Plans/klok-en-hemel-van-de-zee.md) has the rest (the
borrel, the clouds, the moon).

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

**The browser keeps ctrl+W whatever the page says.** On foot, `walk.js` cancels the ctrl shortcuts a
page is allowed to cancel (save, print, find, reload, …) and asks for a Keyboard Lock
(`navigator.keyboard.lock`) on the letters and digits the browser pairs with ctrl. The lock only
takes effect in fullscreen - that is the API, not a choice - so outside fullscreen ctrl+W, ctrl+T,
ctrl+N and ctrl+<digit> still belong to the browser, and Escape is deliberately not locked (a
locked Escape makes leaving fullscreen press-and-hold). The mouse buttons fight, one per hand:
the left button is the left hand, the right button the right (`SIDE_OF` in walk.js). A hand
holding a shield blocks while its button is held; any other hand (sword, hammer, bare fist)
attacks - the right on the press, the left on the press under a pointer lock and otherwise on a
click that did not become a drag. `classic-avatar.js` takes `attack(side)` and a `blocking` of
`{ leftArm, rightArm }` (a bare `true` still means the default hand). A hand holding a beer
drinks instead (`act` in walk.js, `drink(side)` in classic-avatar.js) - and a glass is never a
shield, so it must never reach `guardUp`/`state.blocking`, or the sea sees a raised guard
([Plans/bier-en-dronken.md](Plans/bier-en-dronken.md)). The key row says per button what its
hand does (`handAction` -> `ui.setMouse`). The purple bar is the page's, like stamina: **one**
pool (`web/js/tipsy.js`) made in `main.js`, handed to the island's walk mode *and* every room's
(or you walk out of the tavern sober) and stepped once in `frame()`; its blur is a CSS filter
written on `#stage` and `#panels` together, only on foot. G hands a beer to one of our own
settlers within `GIVE_R` (`giveBeer` in main.js, `crowd-view.js giveBeer`): the drink, the
pint and the sway are this page's alone and live per house id in the crowd view, never on
`f.pos`; the settler is held with `attend` under the name the **sea** knows them by
(`seaIdOf`, the inverse of `/api/crowd-ids`) - our own `house:<uuid>` is nobody on the sea.

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
and a `setTimeout` loop polling the page sees time stand still.

**The hook must never disturb a session.** `hooks/on-session.mjs` silences stdout (a
SessionStart hook's stdout is injected into the model's context) and always exits 0.

**The gold pit's count is the keeper's, and a status line is the only place it comes from**
([Plans/goudkuil.md](Plans/goudkuil.md)). Claude Code hands the five-hour usage window
(`rate_limits.five_hour`) to a `statusLine` command and to nothing else - not a hook, not a
transcript - so `hooks/statusline.mjs` is the one writer of `data/usage.json`
(`lib/usage.mjs`, only when the number moved) and `shared/gold.mjs goldOf` the one copy of
what it comes to: `100 - round(used)` bars, and a full pit when there is no reading or the
window's `resetsAt` has passed. The script keeps the session hook's rules: always exit 0,
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

**The castle is the one civic lot that is not three by three** ([Plans/groot-kasteel.md](Plans/groot-kasteel.md)):
`CASTLE_LOT` (7, two super-cells square with the lane between them) in `lib/layout.mjs`, and
`web/js/buildings.js` draws the baked castle at `plot.w / 3`, so read a civic lot's size off
`p.w` and never assume 3 - `doorCell`/`outsideDoor` take the width, `scan.mjs`'s `doorOf` is
`doorCell`. `castleSite` places a new one on the nearest free, flat (`CASTLE_RELIEF`) lattice
block of town or nobody's land, never a civic lot, and `claimForTown` puts that land in the
commons; `growCastle` grows a castle from before this where it stands, front kept, over FREE
cells only - never over a road, its own included, because a road laid later over another's
cells never recorded them - and otherwise leaves it the old size. No version gate: `w < 7` is
the gate.

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

## The two workbench pages

- `/demo` — every object the island can build on one field, with a night slider and a
  **Hitbox** view (amber is the solid part, red is where a settler's middle stops).
- `/editor` — the same sheet with drag handles. **Save** posts whole lines to
  `/api/model-save`, which rewrites `web/js/buildings.js` only when each line is found
  exactly once. Computed lines (`{ y: f + 0.62 }`, loop-generated windows) have no literal
  to match and are reported rather than guessed at.

Debug query params: `?nointro`, `?hour=21`, `?stats`, `?sky=rain`, `?tipsy=0.8` (start that
drunk). (`?sail` is gone with the
browser's own boating — outings are the sea's, and `eager` is a flag on `createBoating`
there.)

## The desktop window

`src-tauri/` is a Tauri 2 shell around the islander, not a second viewer: the window is a
WebView2 pointed at `http://localhost:4747/`, exactly what Chrome's `--app` window shows. **Nothing under `web/` is bundled** — the scaffold's Vite route (`web/` → `dist/` →
`http://tauri.localhost`) was removed because it broke three invariants at once: `api.js`
would work `mine()` out from the wrong origin, `lib/access.mjs` refuses an Origin that is not
the Host on every route, and the import map for `three`/`shared/` is the no-build-step
contract. [Plans/eiland-als-desktop-app.md](Plans/eiland-als-desktop-app.md) has the full
argument. Which means a `web/js/` change (like a minimap.js/classic-avatar.js edit) or a
server-side one (`lib/`, `serve.mjs`) never needs `npm run app:build` — the window only ever
fetches the running islander live, the same page a browser tab would get, and a reload of
the window (or the same server restart a server-side change already needs) is all it takes.
Only a change under `src-tauri/` itself - the splash, the port probing, window behaviour,
the icon - needs a rebuild. **Two exes from one crate** ([Plans/islander-als-eigen-exe.md](Plans/islander-als-eigen-exe.md)):
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
for a release and a checkout alike** ([Plans/een-thuis-voor-het-eiland.md](Plans/een-thuis-voor-het-eiland.md)):
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
`release.yml`'s `android` job builds and signs it on every tag. `STANDALONE` in `web/js/api.js` makes
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

## Layout of the source

| | |
|---|---|
| `scan.mjs` / `serve.mjs` | the two entry points |
| `lib/` | sources, parsing, the village model, `layout.mjs` (plots, hamlets, roads), `plan.mjs` (the keeper's hand: moving hamlets, zones) + `survey.mjs` (the land register as bits, for the planner's preview), `access.mjs`, `dispatch.mjs` (spawning agents), `sprint.mjs` / `issues.mjs` (the two noticeboards), `mail.mjs` + `imap.mjs` + `smtp.mjs` (the postbox), `usage.mjs` + `statusline.mjs` (the gold pit's reading, and putting the status line into `~/.claude/settings.json`), `ws.mjs` (hand-written, no dependency); on the sea side `guards.mjs` and `residents.mjs` (the volcano's guards, and every islander's Codex settlers housed on it) |
| `shared/` | terrain, regions (the world/local contract), `lattice.mjs` (the super-grid arithmetic: `blockOf`, `superOf` — the one copy), rng, crops, shapes, `boating.mjs` (settlers taking a boat out), `hull.mjs` (how a hull sits in the water) — Node and browser both |
| `web/js/` | `crowd-view.js` (every island's people, ours too, off the wire), `guest-island.js` (a region at a berth), `boat.js` (`stepBoat` is pure), `main.js` (boot, camera, animation queue), `world.js` (ground, sea, forest, sky), `buildings.js` (every primitive shape), `hamlets.js`, `walk.js`; the inventory is `studio.js` (markup, the two renderers), `inventory.js` (the slot table, DOM-free and tested) and `popover.js` (one floating picker at a time); the settlers are in three files — `settler-walk.js` (a re-export of
`shared/settlerwalk.mjs`, kept for the workbench pages), `settler-figures.js` (what is
drawn; every mesh and every sine wave) and `settlers.js`, which nothing simulates out of
any more — what is still imported from it is the wardrobe and `figureGeometry`; `*-mesh.js` are baked output — never hand-edit |
| `web/css/` | `ui.css` is the layout, `harbour.css` the theme loaded after it — and it overrides positions too (`.panel { top }` per breakpoint), so a rule for the phone (≤480px, where a panel is a bottom sheet) belongs in harbour.css's media block or it silently loses |
| `scripts/build-*.py` | author the `.blend` files; `export-models.py` bakes them |
| `tools/island.mjs` | the island's own CLI: `where`, `look`, `build`, `remove`, `reload` — talks to the running server over HTTP |
| `docs/manual.md` | what everything on the island means; `docs/next/` is written-up work that is *not* done |

`data/` and `config.json` are HOME's - `~/.promptholm`, or a worktree's own (see the desktop
window above) - and a checkout's own `data/` is only the backup an island moved out of
(`data/MOVED.txt` says so). `data/` is generated and safe to delete, with three exceptions: `layout.json` (above),
`garden.json` (the walker's purse and beds — the scanner never touches it) and `mail.json`
(mail server credentials, deliberately gitignored twice). `config.json` is per-machine and
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
