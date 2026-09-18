# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Promptholm: a 3D island (three.js, no build step) where every Claude Code / Cowork session
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

`.claude/launch.json` has `island-worktree` (auto-port, `--no-rescan`) for previewing from a
worktree without colliding with the island already running on 4747.

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

## Invariants worth knowing before changing anything

**A house never moves.** `data/layout.json` is append-only and is the only irreplaceable
file under `data/`; `village.json` and `cache.json` rebuild themselves. Four version gates
in `lib/layout.mjs`, in descending order of violence: `LAYOUT_VERSION` (throws away the town
and the terrain — almost never right), `PARCEL_VERSION` (re-plans houses, sheds, parcels,
paths), `ROAD_VERSION` (re-routes hamlet roads and nothing else), `SQUARE_VERSION`. Reach
for the smallest one that does the job. [docs/branches.md](docs/branches.md) lists what to
assert after a layout change, and the trap: **stop the server before measuring**
(`stop-island.cmd`), or its own rescan interleaves with yours and every plot looks moved.

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

**`POST /api/island` is the first write route on the public allowlist**, deliberately
against the rule below. See the carve-out written above `PUBLIC_API` in `lib/access.mjs`;
the short version is that LAN membership is the whole gate, so the size cap, the rate limit,
the quarantine under `data/guests/` and the whitelisting rebuilder in `lib/islandbundle.mjs`
are the only defences - and an `inviteCode` now buys writes where it used to buy a look.
A berth never survives a restart: `createGuests()` clears the tree on start, which is what
keeps an uploaded island a *visit* rather than an export.

**One material, one draw call per building.** Which texture sheet a face uses is a number
carried on the vertex, not a material of its own, and night glow is a per-vertex emissive
mask. Giving a building a material array turns 300 houses into thousands of draw calls.
`?stats` reports the colour pass only — the shadow pass is not in it.

**Nothing is fetched at boot.** Blender sets are baked into ordinary modules
(`web/js/*-mesh.js`) imported synchronously through `web/js/models.js`, so every shape
exists before the first line of `main.js` runs. Do not introduce a loader: the boot screen
stuck on "Charting the island…" is a failure this project has already had.

**The server is dangerous on purpose.** `/api/assign` spawns real Claude Code sessions
unattended with full permissions in any folder, so `lib/access.mjs` demands all three of a
loopback socket, a known `Host` and a matching `Origin`, and never reads
`X-Forwarded-For`. The ceiling is `SETTLERS_MAX_AGENTS` (4). Put any new write route behind
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

Debug query params: `?nointro`, `?hour=21`, `?stats`.

## Layout of the source

| | |
|---|---|
| `scan.mjs` / `serve.mjs` | the two entry points |
| `lib/` | sources, parsing, the village model, `layout.mjs` (plots, hamlets, roads), `access.mjs`, `dispatch.mjs` (spawning agents), `sprint.mjs` / `issues.mjs` (the two noticeboards), `mail.mjs` + `imap.mjs` + `smtp.mjs` (the postbox), `ws.mjs` (hand-written, no dependency) |
| `shared/` | terrain, regions (the world/local contract), rng, crops, shapes — Node and browser both |
| `web/js/` | `guest-island.js` (a region at a berth), `boat.js` (`stepBoat` is pure), `main.js` (boot, camera, animation queue), `world.js` (ground, sea, forest, sky), `buildings.js` (every primitive shape), `hamlets.js`, `settlers.js`, `walk.js`; `*-mesh.js` are baked output — never hand-edit |
| `scripts/build-*.py` | author the `.blend` files; `export-models.py` bakes them |
| `tools/island.mjs` | the island's own CLI: `where`, `look`, `build`, `remove`, `reload` — talks to the running server over HTTP |
| `docs/manual.md` | what everything on the island means; `docs/next/` is written-up work that is *not* done |

`data/` is generated and safe to delete, with three exceptions: `layout.json` (above),
`garden.json` (the walker's purse and beds — the scanner never touches it) and `mail.json`
(mail server credentials, deliberately gitignored twice). `config.json` is per-machine and
untracked; `config.example.json` is the template.

## Conventions

Commit messages are in Dutch: one imperative line saying what changed in the island's own
terms ("Zet de kerk op de maat van het stadhuis"), with the reasoning in the body when there
is any. Code, comments and documentation are in English. Comments carry the *why* — which
alternative was tried, what broke, which number this is the only copy of — and the existing
files set a high bar for that; match it rather than stripping it back.

Environment variables: `JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` (the cork board),
`SETTLERS_GITHUB_REPO`, `SETTLERS_MAX_AGENTS`, `SETTLERS_PORT`, `SETTLERS_CLAUDE_HOME`,
`CLAUDE_EXE`, `GH_EXE`, `BLENDER`.
