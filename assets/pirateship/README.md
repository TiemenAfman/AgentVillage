# pirateship

The pirate ship, a hero set like `benchy`: one painted mesh, `pirateship hull`.

**Source and credit.** "Low-Poly Pirate Ship" by
[Greggory_Fisher](https://sketchfab.com/Greggory_Fisher), from
<https://sketchfab.com/3d-models/low-poly-pirate-ship-c5e06cf1ba164b749cb47044fe7b86eb>,
licensed [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). Changed for the island:
reduced from 73k to 29,798 triangles, cups, bottles and baked shadow decals removed,
material colours baked into vertex colours, turned, scaled and set on the keel.
Decks have staggered planks with narrow caulked seams and deterministic colour variation.
Cannon material sections are welded and oriented together before planar simplification,
preserving barrel bores, reinforcing rings, carriage wheels and shot. Metal fittings are
welded and oriented before simplification too. More of the original rigging is retained.

The carriage cheeks in the download are open double skins. Their 40 wooden boundary
loops are paired and bridged into 20 closed cheeks. The build refuses an unpaired loop
or any remaining wooden boundary edge. Small metal openings inside the cheeks are
filled separately; cannon bores are excluded. Close-up renders, including the underside,
are saved in `renders/carriage-fixed/` for the assembled ship.

`source/pirateship-greggoryfisher.glb` is the download as it came; `scripts/build-pirateship.py`
turns it into `pirateship.blend` and bakes `web/js/pirateship-mesh.js`:

```bash
blender --background --python scripts/build-pirateship.py -- [preview.png] [side|deck]
```

Its triangle budget is its own (`HERO_BUDGETS` in `scripts/model-rules.mjs`, 30000): a
galleon you walk the deck of, one draw call, and a few in the world at most.

The source model came from the neighbouring `AgentVillage` checkout. This branch includes
the source, authoring script, Blender model and baked module, and registers the asset in
`web/js/models.js`. This checkout still uses the Benchy for its player boat; importing
the separate galleon sailing system is outside this model edit.

For inspection without changing the model:

```powershell
node scripts/blender.mjs --background --python scripts/inspect-model.py -- assets/pirateship/pirateship.blend assets/pirateship/renders/final
node scripts/blender.mjs --background --python scripts/inspect-model.py -- assets/pirateship/pirateship.blend assets/pirateship/renders/detailed --target 1.3 -1.5 2.7 --span 4
```

Both commands pair ten views with backface culling on and off. Inspection renders are
ignored; the build is reproducible from the credited GLB. The original length, height and
deck frame are preserved; plank faces sit 0.004 units above their supporting surface.
