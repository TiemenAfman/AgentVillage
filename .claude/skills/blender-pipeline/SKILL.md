---
name: blender-pipeline
description: Model, rebake and check Promptholm's Blender sets - assets/<set>/*.blend -> scripts/build-*.py / export-models.py -> web/js/<set>-mesh.js, checked by scripts/model-rules.mjs. Use whenever a task adds or changes a baked shape (a prop, a house, a tree, a civic building, a dock piece), touches a build-*.py script, a .blend, a *-mesh.js, model-rules.mjs or models.js, runs `npm run models` / `models:preview`, or asks why a bake was refused (budget, sheet prefix, origin, anchor, duplicate part name). Also when a new shape should be modelled rather than written as boxes in buildings.js.
---

# The Blender pipeline

Every baked shape on the island travels one route, and nothing on the island ever needs
Blender at runtime: the baked modules are committed.

    scripts/build-<set>.py  --authors-->  assets/<set>/<name>.blend
    npm run models          --bakes---->  web/js/<set>-mesh.js   (committed, never hand-edit)
    web/js/models.js        --imports-->  mesh('prop_barrel staves') in buildings.js

The full house style is [assets/README.md](../../../assets/README.md). Read it before
modelling anything new; this skill is the working checklist, not a replacement.

## Commands

```bash
npm run models                              # bake every set, then check all of them
npm run models -- props                     # bake one set (all sets are still checked)
npm run models:preview                      # render assets/<set>/renders/<asset>.png
npm run models:preview -- props prop_barrel # one asset
node scripts/blender.mjs                    # which blender.exe would be used
node --test tests/models.test.mjs           # the same rules over what is committed, no Blender needed
```

Blender is found via `$BLENDER`, then `C:\Program Files\Blender Foundation\Blender *`,
then the PATH (`scripts/blender.mjs`). A `build-*.py` is run directly:
`node scripts/blender.mjs --background --python scripts/build-<set>.py`. It regenerates the
`.blend` from scratch, so hand edits in that `.blend` are lost - either change the script,
or edit the `.blend` by hand and bake with `npm run models` instead. Pick one per set and
say which.

## Rules the bake enforces (scripts/model-rules.mjs is the only copy of the numbers)

- **Units and axes.** 1 Blender unit = 1 island unit = 1 cell = 4 m. Blender is Z up, the
  island Y up: `game(p) = (p.x, p.z, -p.y)`; the build scripts write island coordinates
  through their `xyz()` helper.
- **Front faces +Z on the island (-Y in Blender).** Doors, windows, awnings, tent openings.
- **Origin on the ground (`y = 0` is grass), in the middle of the footprint.** Props and
  plants centred on x and z. Roofs: origin on the eaves plane.
- **Material name prefix = texture sheet**: `plain`, `wall`, `roof`, `stone`, `plank`,
  `plankZ`, `ground`. Text after the colon is free (`plank:oak`). `bark` / `foliage` only
  for flora and the hedge. Colour set linearised on both `diffuse_color` and the BSDF base
  colour; `m['emissive'] = 1.0` is a night-glow switch (0 or 1, never between).
- **No textures, UVs or normals.** Flat shading; vertex colours are a multiplier (white =
  untouched), never the colour itself.
- **Marking.** `obj['building_part'] = True` on every mesh to bake; `scene['building_height']`
  set. A multi-asset set puts each asset in a collection named after it, and every object
  in it is named `<asset> <part>` - part names are unique across *all* sets.
  Anchors are empties `anchor.smoke|flag|door|sign`. Variants `_a/_b/_c`, cheap one `_lo`.
- **Triangle budgets by name prefix, counted after modifiers:** `flora_rock` / `flora_bush`
  40, `flora_` 60, `prop_` 120, `addon_` 150, `roof_` 300, `house_` 600, `civic_` 1500,
  hero set 4000. A name matching no prefix has no budget and is refused.
- **Sets over water** (docks, quay steps) are modelled in one frame with pile feet at
  y = 0; `tests/docks.test.mjs` asserts the joins.
- **The yard.** A house reaches at most ~1.15 from its plot middle, the +Z door cell stays
  clear, a shed is at most `SHED_SPAN` 0.58 across.

## Adding a new set

1. Write `scripts/build-<set>.py` by copying the nearest existing one (`build-props.py` for
   several small things, `build-tavern.py` for one hero building) - keep its helpers
   (`xyz`, `finish`, the linearised colour) and its docstring style: say *why* every shape
   is as coarse as it is.
2. Run it; it saves `assets/<set>/<name>.blend`.
3. `npm run models -- <set>` - writes `web/js/<set>-mesh.js` exporting `<SET>`.
4. Import it in `web/js/models.js` and add it to `SETS`. Nothing else registers a set;
   do **not** add a loader or a fetch - shapes must exist before `main.js` runs.
5. Use it from `web/js/buildings.js` via `mesh('<asset> <part>', ...)` / the asset name.
6. Check it on `/demo` (night slider, **Hitbox** view) rather than on the island, where
   half the buildings are rotated.

## Before committing

- Run `npm run models` **twice**; the second run must change no byte (the bake is
  deterministic or it is broken).
- `node --test tests/models.test.mjs` (plus `tests/docks.test.mjs` / `tests/tavern.test.mjs`
  when those sets changed).
- Commit the `.blend`, the `build-*.py` and the `*-mesh.js` together. `*.blend1` and
  `assets/**/renders/` are ignored and stay that way.
- Report the triangle count against the budget, and - for anything with `castShadow` or
  instanced - that `?stats` shows only the colour pass, so the shadow cost has to be
  worked out by hand (instances x triangles).
- Commit message in Dutch, in the island's own terms ("Geef de kar een tweede wiel").
