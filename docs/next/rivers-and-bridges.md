# Rivers and bridges

A second way to close off a hamlet, next to the hedge: a river the road has to cross.

Nothing is built yet. This note is here so the reasoning does not have to be found
again.

## Why it fits

`lib/layout.mjs` only calls a super-cell usable when all sixteen of its ground cells are
buildable, so a river cell rules out the whole super-cell it runs through. A river
therefore separates parcels on its own, without a single new rule in the allocator.

## The crux

`routePath` walks `FREE`, `PATH` and `SQUARE` cells only. Every hamlet lays exactly one
road to the town (`road:<district>:<lobe>`), and if a river lies between them that road
cannot be built at all — the search exhausts and the hamlet is left without one, which
the invariant check will catch. So a river needs bridge cells the search may enter, at a
price, and the price is what makes a road prefer a bridge that already exists over
building a second one. That is the same idea as `REUSE` for shared road cells.

## Work

1. **Carve the river** in `shared/terrain.mjs`: from high ground down the gradient to the
   coast, one or two cells wide, cut below `SEA_LEVEL` so `isWater` is true. Deterministic
   from the seed.

   This changes `terrain.hash`, and **`loadLayout` does not check the hash** — only `v`,
   `seed` and `size`. So add `terrainHash` to the layout and treat a mismatch the way a
   seed change is treated, or houses end up standing in the water.

   `shared/terrain.mjs` runs in both node and the browser, and the viewer already warns on
   a `terrainHash` mismatch (`buildScene` in `web/js/main.js`). Both sides must agree.

2. **Draw it** with the existing water shader (`waterMat` in `web/js/world.js`, which
   already does the sea and the lake), plus banks.

3. **Bridges** in `lib/layout.mjs`: a `BRIDGE` cell state that `routePath` may enter at a
   premium, a narrowest-crossing search, and the bridge persisted in the layout so it is
   as sticky as a building.

4. **A bridge model** in `web/js/buildings.js`, and a row on `/demo`. The model sheet has
   a `line(items, draw, title)` helper, and since the hamlet work a `demoTerrain` /
   `groundPatch` pair for pieces that have to follow the ground — a bridge does.

## Verifying

The throwaway checker the hamlet work used still applies: every lobe keeps exactly one
road that ends on somebody else's square, no house may stand in water, and a second scan
must change nothing. `node scan.mjs`, then `node serve.mjs` on localhost:4747.

Read **Hamlets and git** in the README first: it explains `PARCEL_VERSION` and why the
town square must not move.
