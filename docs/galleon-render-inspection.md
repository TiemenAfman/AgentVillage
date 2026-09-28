# Galleon render inspection

Inspected on 2026-09-28 with Blender 5.2.2 LTS, on branch
`codex/galleon-render-controle` in the Settlers checkout, and merged into AgentVillage the
same day. "The adjacent checkout" below is AgentVillage as it was before that merge: the
14,456-triangle bake it held then is the one this revision replaced.

## Detailed revision

### Carriage correction

The earlier normal repair did not close the carriage sides: the source has two skins
per wooden cheek and omits the connecting perimeter faces. Forty boundary loops were
bridged into twenty closed cheeks. The build now checks that no wooden boundary edges
remain and refuses unpaired skins. Small metal openings inside the cheeks are filled
separately. Cannon bores are excluded from this repair.

Inspected an isolated carriage from the front quarter, rear quarter and underside with
backface culling, plus the assembled close-up in `renders/carriage-fixed/`. All 19 model
tests pass after this correction and a repeated authoring build produces identical baked
output. This supersedes the earlier claim that repairing normals alone fixed the base.

### Deck and cannon detail

The branch now includes its own source GLB, authoring script, `.blend` and exported
`pirateship-mesh.js`, registered in the model catalogue. The original inspection below
describes the earlier 14,456-triangle model from the adjacent checkout.

The revision adds staggered deck planks with dark seams and colour variation, preserves
more rigging, and restores cannon barrels, wheels, reinforcing rings and shot. Cannon
material sections are welded and oriented as complete assemblies before simplifying
coplanar faces. Metal fittings are also welded and oriented before simplification.
The exported revision has 29,798 triangles under an explicit 30,000-triangle hero budget,
one mesh and one material. Length and deck frame are preserved.

The revised whole-ship and cannon views are in `assets/pirateship/renders/final/` and
`assets/pirateship/renders/detailed/`. These are visual checks with backface culling;
open cannon bores and other intentional openings mean this is not a watertightness claim.
The sailing integration in the adjacent checkout has not been imported or modified.

Validation: all 19 model tests pass. `npm run models -- pirateship` validates all 29
sets, and re-exporting the saved model leaves the baked module byte-for-byte identical.

## Source and reproduction

The galleon is named `pirateship`. Its existing Blender model is in the adjacent
`AgentVillage` checkout; this Settlers checkout does not contain that model or its
game integration. The inspection reads that file without changing it.

```powershell
node scripts/blender.mjs --background --python scripts/inspect-model.py -- 'C:/Development/- Anders/AgentVillage/assets/pirateship/pirateship.blend' 'assets/pirateship/renders/inspection'
```

The source contains one building mesh, `pirateship hull`, with 14,456 triangles.
The script produces twenty 1200 × 1200 PNGs and `inspection.json`. Each of ten views
is rendered with backface culling enabled and disabled: port, starboard, bow, stern,
top, bottom, bow quarter, stern quarter, deck, and diagonally below the hull.
Vertex colours are preserved. There is no water or floor to hide the keel.

## Findings

**Correction after inspecting the cannons at close range:** the overview was too
small to assess these details. The cannon barrels and fittings visibly lose faces
with backface culling enabled. Disabling culling restores surfaces on the barrels'
rear ends, muzzle rims, and carriage fittings. This is a real rendering defect in
the saved model; the overview does not justify calling the whole ship free of holes.
The intended muzzle opening itself is not the defect.

The detail comparison is in `assets/pirateship/renders/cannons/`, especially
`bow-quarter-culled.png` versus `bow-quarter-two-sided.png`. Reproduce with:

```powershell
node scripts/blender.mjs --background --python scripts/inspect-model.py -- 'C:/Development/- Anders/AgentVillage/assets/pirateship/pirateship.blend' 'assets/pirateship/renders/cannons' --target 1.3 -1.5 2.7 --span 4
```

The build script reduces the cannon metal parts to 25% and one carriage material
to 5% of their source triangle counts. Whether the defective face orientation is
already present in the download or introduced during that process remains unverified.

### Whole-ship overview

- No obvious background-visible holes in the hull, keel, deck, or sails in the
  inspected views.
- At overview scale, the culled and two-sided views did not reveal the cannon defects
  subsequently found in the detail renders.
- The bottom and stern remain covered. Strong triangular light/dark patches on the
  hull appear to be flat-shaded facets, not holes.
- Open spaces between railings, rigging, and around the stairs remain visible;
  these do not establish a defect in the hull.

The locally generated `assets/pirateship/renders/inspection/contact-sheet.png`
places each culled view beside its two-sided counterpart. The full-resolution
individual renders are in the same ignored directory.

This is a visual inspection of the saved Blender model. It does not prove watertight
topology or verify the exported mesh in the browser. No model repair was made.
