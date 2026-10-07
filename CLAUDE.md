# CLAUDE.md

Promptholm's island with the game taken out (README.md says what is left). It is a distillate of
the AgentVillage repo, and most of its files are copies: **only `start.mjs`, `serve.mjs`,
`web/index.html`, `web/js/main.js`, `web/js/watch-net.js`, `package.json`, `README.md` and this file
are the distillate's own** (`DISTILL_ENTRIES` lists the extra ones). Every other file is refreshed
from AgentVillage by its `scripts/distill.mjs`, which walks the import graph from those entries -
so a fix to a copied module belongs in AgentVillage, and an edit here is lost on the next refresh.
AgentVillage's CLAUDE.md is the long version of every invariant the copied code keeps.

What the own files are:

- `start.mjs` sets `PROMPTHOLM_HOME` (default `~/.promptholm-destillaat`) *before* `lib/paths.mjs`
  is imported, seeds it from the live island once, then imports `serve.mjs`. Never start
  `serve.mjs` directly: without the variable it would take the live island's home.
- `serve.mjs` is the island's server cut down to the scan on a timer, `village.json`, `/events`,
  the planner's routes (`/api/plan`, `/api/plan/survey`, `/api/plan/undo`), `/api/placements`,
  `/api/crowd-ids`, and a sea of its own on loopback (`createSea` with `volcano: false`,
  `starters: false`) that walks the settlers. Port 4848.
- `web/js/main.js` is the island's page cut down to orbit + planner + director: no walk mode, no
  rooms, no other islands, no chronicle, no clicks on the island (hover names stay).
- `web/js/watch-net.js` joins that sea as a client that never walks: clock, weather, fleet, crowd.
- `web/index.html` hides the island's chips and panels with nothing to do here; `ui.js` is a copy
  and still finds every control by id, so they are hidden rather than removed, and `main.js` hands
  it no-op handlers for the rest.

Commands: `npm install` (vendors three.js), `npm run dev` (serve and open), `npm run serve`.
