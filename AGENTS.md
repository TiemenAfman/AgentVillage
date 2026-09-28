# AGENTS.md

Orientation and traps for an agent working on this repository. Compact by design: the
exhaustive invariants live in [CLAUDE.md](CLAUDE.md), the *why* behind a feature in
[Plans/](Plans/README.md) (`✅` done, `🚧` partly built) and what a thing on the island means
in [docs/manual.md](docs/manual.md). When the two disagree, the code is the truth and
`CLAUDE.md` should be fixed.

## What this is

Promptholm: a 3D island (three.js, **no build step**) where every Claude Code / Codex session
on this machine is a settler with a house. `scan.mjs` reads the session transcripts already on
disk, `serve.mjs` serves the island and pushes updates, `web/` draws it. Windows, Node 22+,
the only runtime dependency is a vendored copy of three.js.

## Commands

```bash
npm install                        # also vendors three.js into web/vendor (postinstall)
npm run dev                        # serve on :4747 and open a browser
npm run serve                      # serve without opening
npm run watch                      # serve + watch lib/, serve.mjs, scan.mjs, sea.mjs; asks Y/n
npm run scan                       # rebuild data/village.json once
npm run scan:all                   # ignore foundedAt, use every session ever; writes *.all.json
npm run models                     # bake every Blender set and check it (needs Blender)
npm run models -- props            # bake one set
npm run models:preview             # render assets/<set>/renders/<asset>.png
npm run setup                      # install the session hook into ~/.claude/settings.json
npm run app                        # cargo build the islander, then run the Tauri window (needs Rust)
npm run app:pack                   # lay out dist/Promptholm/ — a release is a folder, not a checkout
npm run android:pack               # copy web/ + shared/ into src-android/dist/ for the phone
node tools/island.mjs where        # the island's own CLI over HTTP: where, look, build, remove, reload
```

**There is no linter, formatter or typechecker.** `node --check` over every `web/js/` and
`shared/` module is `tests/syntax.test.mjs`, and it is the only parse-level gate — most of
`web/js` is browser-only, so a misplaced hunk breaks nothing else and leaves the boot screen
stuck on "Charting the island…".

## Tests

`node:test`, no npm script. On Windows the shell does not expand the glob, so quote it and let
Node do it:

```bash
node --test "tests/*.test.mjs"          # everything
node --test tests/models.test.mjs      # one file
node --test "tests/sea-*.test.mjs"     # one group
```

- `node --test tests/` does **not** work — Node treats the directory as a module and fails with
  `MODULE_NOT_FOUND`.
- A fresh worktree needs `npm install` first, or every test importing `three` fails.
- Tests run browser modules under Node: they `register('./support/shared-loader.mjs')` to
  resolve the `shared/` import-map prefix and stub `globalThis.document` before importing
  anything that reaches `web/js/buildings.js` (it builds a `TextureLoader` at import time).
  Copy that preamble when adding a test that touches `web/js/`.
- `tests/layout-measure.test.mjs` measures the live `data/layout.json`, so two of its
  assertions can fail on this machine without your change. Check against a clean tree first.
- `tests/support/sea.mjs` defaults `starters: false`; pass `starters: true` when a test needs
  starter islands, since every berth and island count otherwise assumes an empty ring.

## Traps that cost real time

**Importing `lib/paths.mjs` can move the island.** `HOME` is
`PROMPTHOLM_HOME || (WORKTREE ? ROOT : settleHome())` and `settleHome()` runs while the module
is being evaluated, copying an existing island into `~/.promptholm`. So a `node -e` probe of
that module is not free. (`tests/home.test.mjs` copies the module into a scratch checkout and
imports it in a child with its own profile.) A linked worktree — a `.git` *file* — keeps its
own island in itself; the main checkout and a release share `~/.promptholm`.

**Never hold a `data/*.json` open across an event-loop turn.** `writeJsonAtomic` replaces by
rename, and on Windows a rename over any open handle fails EPERM. `sendFile` reads with
`readFileSync`, never `fs.readFile` or a stream — that is what lost a scan to
"rescan failed (issues): EPERM" while a page was mid-download.

**Stop the server before measuring a layout.** Tray → Stop, or
`taskkill /f /im promptholm-island.exe`. A running islander rescans on a 60 s timer, and its
own pass interleaves with yours, so every plot looks moved.

**A change under `lib/`, `serve.mjs`, `scan.mjs` or `sea.mjs` needs the node process on 4747
restarted.** `/api/reload` only tells open tabs to refetch `web/js/`. Restarting the islander
mid-session is fine (kill the exe, start it again from `src-tauri/target/{debug,release}/`),
but say so in the conversation first.

**`web/js/*-mesh.js` is baked output — never hand-edit it.** Change `assets/<set>/*.blend` via
`scripts/build-*.py` and run `npm run models`, which is idempotent: a second run that changes a
byte means the bake is not deterministic.

**`Dockerfile.sea` and `scripts/pack-release.mjs` copy the island by name**, so a runtime
import from a new top-level folder works locally and produces an image or release that dies on
its first line. `tests/sea-image.test.mjs` walks the real import graph and holds both.

**A new file under `web/js/` must not need a build step or a loader.** Baked shapes are plain
modules imported synchronously through `web/js/models.js`, and `web/index.html` maps `shared/`
and `three` in an import map. The one deliberate exception is the volcano's lava imp
(`web/js/imp.js`, a skinned GLB), allowed after boot and never awaited.

## Three processes, and who owns what

| | |
|---|---|
| **islander** (`serve.mjs`, `scan.mjs`, `lib/`) | owns this machine: the scan, `data/`, the agents, the mail, the tickets. Loopback only. |
| **sea** (`sea.mjs`, `lib/sea.mjs`, `lib/fleet.mjs`) | a clock, a fleet and a relay for the world. Reads no transcripts, never scans, and **writes nothing to disk** — that is why it has no schema, no migration and no upgrade path. It does have one island of its own: the volcano. |
| **client** (`web/`) | draws both. |

Single player is not a mode: `serve.mjs` starts a sea on loopback and joins it with one
island. Hosting is that same sea bound to the network; joining is somebody else's address
(`config.multiplayer.sea.mode`, changed at runtime through `POST /api/sea`). There is
deliberately no offline mode, because that is two drawing paths.

The line home (`lib/seaclient.mjs`) goes one way on purpose: the islander reaches out, the sea
never reaches in. Do not add an inbound half without reading that section in `CLAUDE.md`.

## Invariants that decide a design, in one line each

- **A house never moves by itself.** `data/layout.json` is append-only and the only
  irreplaceable file under `data/`. The keeper may move things deliberately, through
  `POST /api/plan` only.
- **Six version gates in `lib/layout.mjs`**, in descending order of violence: `LAYOUT_VERSION`
  (wipes the town and the terrain), `PARCEL_VERSION` (re-plans houses, sheds, paths),
  `TOWN_VERSION` (re-lays the town centre and its roads; no house moves), `ROAD_VERSION`,
  `SQUARE_VERSION`, `QUAY_VERSION`. Reach for the smallest one that does the job; each
  re-planning is destructive and a release is not the place for one.
- **A patch release never breaks compatibility** — no `SEA_V` bump, no version gate, nothing
  in `layout.json` or a bundle that an older 0.x would misread. Any of those is the next minor.
- **`shared/` runs identically in Node and in the browser**, so it stays plain arithmetic: no
  `sin`, `cos` or `pow` (last-bit differences), no clock, no three.js. Crowd code counts *ticks*
  (`DT = 0.05`), never `dt`. `tests/settler-walk.test.mjs` reads the source to enforce this.
- **One world frame, many island-local frames.** `shared/regions.mjs` is the contract; terrain
  and `layout.json` are always local and origin-centred, and a second island is a *region* with
  a world offset. `cellWorld` adds the origin, `worldHeight` subtracts it.
- **Nothing a visitor can reach writes anything.** `PUBLIC_API` is a three-entry allowlist
  (`/api/hello`, `/api/props`, `/api/crops`) and the API is deny-by-default.
  `lib/access.mjs` also demands a loopback socket, a known `Host` and a matching `Origin`, and
  never reads `X-Forwarded-For`. `/api/crowd-ids`, `/api/gold` and `/api/animals` are
  deliberately *not* on it — they carry real ids, the gold count and the animals' diary.
  Put any new write route behind the same check.
- **Nothing in the browser reaches the network without naming which machine it means**: every
  call through `web/js/api.js` (`mine()` for this island, `sea()` for the world) and every asset
  through `web/js/assets.js`. Both derive their base from `import.meta.url`, never `location`.
  `tests/api-base.test.mjs` fails on a bare `fetch('/`.
- **One material, one draw call per building** — the texture sheet is a number on the vertex,
  never a material array. `?stats` reports the colour pass only.
- **The page draws its own island at the scene origin and translates the world instead**
  (`state.homeOrigin`, `worldToScene` / `sceneToWorld`). Moving the island instead was tried and
  is the wrong half.

## The two shells

`src-tauri/` is a Tauri 2 window around the islander, pointed at `http://localhost:4747/`.
**Nothing under `web/` is bundled** — a `web/js/` or `lib/` change needs no rebuild at all,
only a reload (or the server restart a server-side change already needs). Only a change under
`src-tauri/` itself needs a rebuild. Two exes come out of one crate: `promptholm.exe` is the
window, `promptholm-island.exe` is the tray + islander that runs `node serve.mjs --supervised`.

`src-android/` is the phone's own crate and the one place `web/` *is* bundled (a phone has no
islander). `npm run android:apk` needs JDK 21, `JAVA_HOME`, `ANDROID_HOME`, `NDK_HOME`.

## The pipeline

```
~/.claude/projects/**.jsonl          transcripts (append-only)
~/.claude/sessions/<pid>.json        what is running now
%APPDATA%\Claude\...                 session titles, models, Cowork tasks
        |  lib/sources.mjs discovers; lib/parse.mjs folds in only the new bytes
        |  (data/cache.json remembers how far each file was read)
        v
lib/village.mjs   aggregates -> settlers, sheds, districts, milestones
lib/layout.mjs    decides where each thing stands  -> data/layout.json
        v
data/village.json  -- serve.mjs -->  web/js/main.js   (SSE /events, WebSocket for players)
```

`serve.mjs` rescans on a timer (60 s) — that is how a new session appears without a hook firing.
The session hook (`hooks/on-session.mjs`) **must never disturb a session**: it silences stdout
and always exits 0.

`data/` and `config.json` live in HOME, and are generated and safe to delete with four
exceptions: `layout.json`, `garden.json` (the walker's purse), `mail.json` (gitignored twice)
and `animal-events.jsonl` (the story animals' journal). `config.json` is per-machine and
untracked; `config.example.json` is the template.

## Conventions

- **Commit messages are in Dutch**, one imperative line in the island's own terms ("Zet de kerk
  op de maat van het stadhuis"), with the reasoning in the body when there is any. Code,
  comments and documentation are in English.
- Comments carry the *why* — which alternative was tried, what broke, which number is the only
  copy. The existing files set a high bar; match it rather than stripping it back.
- **Bigger than a small fix, write the plan in `Plans/` first** (Dutch, same ✅/🚧 marking in
  `Plans/README.md`) and keep it there. It is shared with Tiemen, so it is also how he sees what
  is in progress.
- The product is **Promptholm** everywhere — the package, the crate, both exes, the `.blend`
  sources, every `PROMPTHOLM_*` variable. "Settlers" survives only as what the island's
  inhabitants are called. The GitHub repo and its URLs are still `AgentVillage`.

## Debug entry points

`/demo` (every shape on one field, with a Hitbox view), `/editor` (drag handles, saves whole
lines to `web/js/buildings.js` and only when a line is found exactly once). Query params:
`?nointro`, `?hour=21`, `?stats`, `?sky=rain`, `?rave`, `?tipsy=0.8`, `?edge`, `?goldrun`,
`?timber`.

`.claude/launch.json` has `island-worktree` (auto-port, `--no-rescan`) for previewing from a
worktree without colliding with the island on 4747. Pitfall: the preview tool reads
`launch.json` from the directory the session was *launched* in, so from a hand-made worktree it
runs the main checkout's code against the live island in `~/.promptholm` — where a
`POST /api/plan` is a real move. To try server code from a worktree, run
`node serve.mjs --port <free> --no-rescan --no-open` from inside it instead.

## Environment variables

`JIRA_BASE_URL` / `JIRA_EMAIL` / `JIRA_API_TOKEN` (the cork board), `PROMPTHOLM_GITHUB_REPO`,
`PROMPTHOLM_MAX_AGENTS`, `PROMPTHOLM_PORT`, `PROMPTHOLM_CLAUDE_HOME`, `PROMPTHOLM_CODEX_HOME`,
`PROMPTHOLM_ROOT` (which checkout the exes run), `PROMPTHOLM_HOME` (where `config.json` and
`data/` live), `CLAUDE_EXE`, `GH_EXE`, `BLENDER`. The sea reads `SEA_PORT`, `SEA_NAME`,
`SEA_KEY`, `SEA_ADMIN_KEY`, `SEA_UPDATE_HOOK` and `SEA_TZ` (the world's zone by name — a
container without it runs on UTC).
