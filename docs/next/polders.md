# Polders

The island's escape valve for running out of land. It is fully plumbed and has never
been finished: **nothing ever creates a polder.**

## Why it matters now

Measured after the hamlet work: 475 fully buildable 4x4 blocks, of which about 305 are
owned by hamlets plus the town commons, carrying 203 houses. Capacity is roughly 300–340
houses before new projects stop getting a hamlet at all and their houses pile onto the
commons. The failure is graceful but visible.

Raising `gridSize` is **not** an option: it changes the terrain, fails the `size` check in
`loadLayout` and resets the town square.

## Fix this first

`POLDER_H` is `80/256 = 0.3125`, which is **below** `BEACH_MAX = 0.35`. So `isBeach`
returns true for a reclaimed cell and `isBuildable` therefore returns false — a polder
comes out unbuildable. Either raise `POLDER_H` above `BEACH_MAX` or exempt polder cells
from the beach test. Both are in `shared/terrain.mjs`.

## What already exists

| Where | What |
|---|---|
| `shared/terrain.mjs` | `makeTerrain(seed, { size, polders })` flattens those cells to `POLDER_H` |
| `lib/layout.mjs` | `emptyLayout` and `loadLayout` carry `polders`; `placeAll` passes them on |
| `scan.mjs` | puts `polders` on the wire |
| `web/js/main.js` | `buildScene` passes `village.polders` to `makeTerrain`, so the viewer already agrees with the scanner |
| `web/js/buildings.js` | there is a `poldermill` model, listed as "never yet" on `/demo` |
| `lib/village.mjs` | `MILESTONES` has no entry for it |

## Work

1. `POLDER_H` versus `BEACH_MAX`.
2. Decide when a polder is reclaimed — a milestone at N settlers, or when the allocator
   reports it could not seat a district. `lib/layout.mjs` already sets `rec.guest` for
   exactly that case. Pick shallow water next to the coast, deterministically from the
   seed.
3. A dyke around it, and the polder mill as the milestone building.
4. Reclaiming must not touch the heightfield outside the polder, so no standing house
   moves.

## Verifying

The hamlet work's checker asserts that no pre-existing `house:*` plot changed its
`gx`/`gz`/`rot` and that the town square and every civic plot are bit-identical. Run
`node scan.mjs` twice and diff `data/layout.json`: the second run must change nothing but
`generatedAt`.

Back up `data/layout.json` before the first real scan. It is the only irreplaceable file
in `data/` — `village.json` and `cache.json` both rebuild themselves.
