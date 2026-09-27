# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Promptholm: a 3D island (three.js, no build step) where every Codex / Cowork session
on this machine is a settler with a house. `scan.mjs` reads the session records already on
disk, `serve.mjs` serves the island and pushes updates, `web/` draws it. Windows, Node 22+,
no runtime dependency other than three.js.

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
```

Tests are `node:test` with no npm script. On Windows the shell does not expand the glob, so
quote it and let Node expand it:

```bash
node --test "tests/*.test.mjs"
```

Two of `tests/layout-measure.test.mjs`'s assertions fail against the live `data/layout.json`
on this machine and have nothing to do with your change — check against a clean tree before
chasing one.

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

`.Codex/launch.json` has `island-worktree` (auto-port, `--no-rescan`) for previewing from a
worktree without colliding with the island already running on 4747.

## The pipeline

```
~/.Codex/projects/**.jsonl          transcripts (append-only)
~/.Codex/sessions/<pid>.json        what is running now
%APPDATA%\Codex\...                 session titles, models, Cowork tasks
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

## Invariants worth knowing before changing anything

**A house never moves.** `data/layout.json` is append-only and is the only irreplaceable
file under `data/`; `village.json` and `cache.json` rebuild themselves. Five version gates
in `lib/layout.mjs`, in descending order of violence: `LAYOUT_VERSION` (throws away the town
and the terrain — almost never right), `PARCEL_VERSION` (re-plans houses, sheds, parcels,
paths), `ROAD_VERSION` (re-routes hamlet roads and nothing else), `SQUARE_VERSION`,
`QUAY_VERSION` (re-plans the quay alone, its planks included — the one gate that runs from
`placeAll` rather than `loadLayout`, because it has to ask the ground a question). Reach
for the smallest one that does the job. [docs/branches.md](docs/branches.md) lists what to
assert after a layout change, and the trap: **stop the server before measuring**
(tray → Stop, or `taskkill /f /im promptholm-island.exe`), or its own rescan interleaves with yours and every plot looks moved.

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
Everything that builds ground has to be handed it — `lib/layout.mjs`, `lib/garden.mjs`,
`lib/fleet.mjs`, `lib/islandbundle.mjs`, three calls in `web/js/main.js` — and the one that
deliberately is not is `horizon.js`, which ignores the polders too because a silhouette at
that range is every other cell.

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
`gridSize` still cannot grow (`loadLayout` throws the town away when `size` changes): two
islands means two terrains at an offset, never one bigger heightfield.

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
whole — `DETAILED` in `main.js`, nearest first by `nearestFirst()` — while the rest are
silhouettes at their real berth through `horizon.js`. Eight islands in full does not render;
measured at six, 850 draw calls against 788 for one.

There is no longer any way to visit somebody by *leaving*. `cross()`, `visitNeighbour()`
and `?arrive=` are gone with the berth machinery: an island in your sea is water you can
cross, and an island on the horizon is one in a sea you have not joined — which is a choice
in Settings, not a boat.

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
is a CSS3D renderer over the whole canvas. A foreign board therefore carries what that
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
thing that knows who is new.** `createCrowd(island, { known })` is handed the ids the crowd
before it had; anybody not in that set walks up from the landing beach. `known` is null for
the first crowd an island ever has — and after a sea restart — so a whole village never
comes ashore at once, and more than `MAX_ARRIVING` (8) is a scan catching up rather than an
arrival, so nobody walks. No flag in the bundle and no timestamp to trust.

**Two things about a crowd arriving on a screen.** Nobody is drawn before the sea has said
where they are: a body enrolled by a roster starts at its island's own middle, and drawing
it there put a stranger on the town square until its slice came round. And a joining client
is handed every position at once, once (`slices: 1` at the handshake in `lib/sea.mjs`),
because the beat's rotation takes `KEYFRAME_S` to get round everybody and watching a village
fill up over ten seconds is not a first impression worth having. The client holds that one
message while it translates the roster — see below — or it would be dropped in full, which
is exactly the ten seconds back again.

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
stuck on "Charting the island…" is a failure this project has already had.

**There are three processes now, and only one of them is dangerous.** The *sea*
(`sea.mjs`, `lib/sea.mjs`, `lib/fleet.mjs`) is a clock, a fleet and a relay with no island
of its own: it reads no transcripts, never scans, and **writes nothing to disk**. That last
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
standing on it. And **our own island stands where the sea says it does**, not at `[0,0]`:
poses travel in world coordinates, so a client that quietly kept itself at the origin would
see every other body in the wrong place and be seen in the wrong place itself. The local
terrain is still origin-centred and `layout.json` is still local; only the region's offset
changes.

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

A sea says *that* it wants a key in `/health` (`keyed`), never which one — without that the
picker cannot tell a sea that will have you from one that will turn you away, and the only
way to find out is to move the island and watch it be refused. A refusal is also said
**once per reason, not once per attempt**: `net.js` keeps retrying, which is right, but none
of these reasons fix themselves, so the loop turned one problem into a toast every few
seconds — in the wire's own vocabulary ("key"), which tells whoever wrote the protocol what
is wrong and tells whoever has to fix it nothing.

`SEA_KEY` is shared by everybody in a world. Each islander keeps it in
`multiplayer.sea.key`, and **its own page is handed it over loopback** in `/api/hello` —
never a visitor, who could otherwise park an island and wear a name there. Without that
hand-off a sea that gets a key locks out the browser of the very island publishing to it.

Behind Nginx Proxy Manager, two settings or the island connects and then sits in silence:
**Websockets Support on**, and a read timeout longer than the sea's own 25 s ping
(`proxy_read_timeout 300s`). Everything after the handshake goes over that socket.

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

**Somebody running different code is a banner, not a console warning.** Three machines make
a world — this page, the islander that packed a bundle, whichever islander packed somebody
else's — and when their `shared/terrain.mjs` disagree an island is drawn in the wrong shape
with nothing crashing and nothing logged where anybody looks. `ui.setSkew(id, name)` keeps
it on screen and names who.

**The server is dangerous on purpose.** `/api/assign` spawns real Codex sessions
unattended with full permissions in any folder, so `lib/access.mjs` demands all three of a
loopback socket, a known `Host` and a matching `Origin`, and never reads
`X-Forwarded-For`. The ceiling is `PROMPTHOLM_MAX_AGENTS` (4). Put any new write route behind
the same check.

**The hook must never disturb a session.** `hooks/on-session.mjs` silences stdout (a
SessionStart hook's stdout is injected into the model's context) and always exits 0.

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

Debug query params: `?nointro`, `?hour=21`, `?stats`, `?sky=rain`. (`?sail` is gone with the
browser's own boating — outings are the sea's, and `eager` is a flag on `createBoating`
there.)

## Layout of the source

| | |
|---|---|
| `scan.mjs` / `serve.mjs` | the two entry points |
| `lib/` | sources, parsing, the village model, `layout.mjs` (plots, hamlets, roads), `access.mjs`, `dispatch.mjs` (spawning agents), `sprint.mjs` / `issues.mjs` (the two noticeboards), `mail.mjs` + `imap.mjs` + `smtp.mjs` (the postbox), `ws.mjs` (hand-written, no dependency) |
| `shared/` | terrain, regions (the world/local contract), rng, crops, shapes, `boating.mjs` (settlers taking a boat out), `hull.mjs` (how a hull sits in the water) — Node and browser both |
| `web/js/` | `crowd-view.js` (every island's people, ours too, off the wire), `guest-island.js` (a region at a berth), `boat.js` (`stepBoat` is pure), `main.js` (boot, camera, animation queue), `world.js` (ground, sea, forest, sky), `buildings.js` (every primitive shape), `hamlets.js`, `walk.js`; the settlers are in three files — `settler-walk.js` (a re-export of
`shared/settlerwalk.mjs`, kept for the workbench pages), `settler-figures.js` (what is
drawn; every mesh and every sine wave) and `settlers.js`, which nothing simulates out of
any more — what is still imported from it is the wardrobe and `figureGeometry`; `*-mesh.js` are baked output — never hand-edit |
| `scripts/build-*.py` | author the `.blend` files; `export-models.py` bakes them |
| `tools/island.mjs` | the island's own CLI: `where`, `look`, `build`, `remove`, `reload` — talks to the running server over HTTP |
| `docs/manual.md` | what everything on the island means; `docs/next/` is written-up work that is *not* done |

`data/` is generated and safe to delete, with these exceptions: `layout.json` (above),
`garden.json` (the walker's purse and beds — the scanner never touches it) and `mail.json`
(mail server credentials, deliberately gitignored twice). `config.json` is per-machine and
untracked; `config.example.json` is the template.

The story animals add `animal-events.jsonl`, opened by the islander on its first scan
(`lib/animal-life.mjs`; off with `config.animals.enabled: false`). That journal is also
irreplaceable: animal identities, activity cursors and memories rebuild from it, not from
transcripts. `animals.json` is its disposable checkpoint. The islander owns the story, the sea
only walks the animals (`POST /island/:id/animals`, `{t:'herd'}`, `{t:'af'}`, and a
`{t:'animal', a:'done'}` back over the islander's own socket). See
[docs/animal-story-storage.md](docs/animal-story-storage.md) for writer ownership and crash
recovery, [docs/animals-wire.md](docs/animals-wire.md) for the wire, and
[Plans/dierenverhalen.md](Plans/dierenverhalen.md) for the design.

## Conventions

Commit messages are in Dutch: one imperative line saying what changed in the island's own
terms ("Zet de kerk op de maat van het stadhuis"), with the reasoning in the body when there
is any. Code, comments and documentation are in English. Comments carry the *why* — which
alternative was tried, what broke, which number this is the only copy of — and the existing
files set a high bar for that; match it rather than stripping it back.

Environment variables: `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` (the cork board),
`PROMPTHOLM_GITHUB_REPO`, `PROMPTHOLM_MAX_AGENTS`, `PROMPTHOLM_PORT`, `PROMPTHOLM_CLAUDE_HOME`,
`CLAUDE_EXE`, `GH_EXE`, `BLENDER`. The sea reads its own three: `SEA_PORT`, `SEA_NAME`,
`SEA_KEY`.
