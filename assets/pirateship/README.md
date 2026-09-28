# pirateship

The pirate ship, a hero set like `benchy`: one painted mesh, `pirateship hull`.

**Source and credit.** "Low-Poly Pirate Ship" by
[Greggory_Fisher](https://sketchfab.com/Greggory_Fisher), from
<https://sketchfab.com/3d-models/low-poly-pirate-ship-c5e06cf1ba164b749cb47044fe7b86eb>,
licensed [CC-BY-4.0](http://creativecommons.org/licenses/by/4.0/). Changed for the island:
decimated from 73k to about 14k triangles, cups, bottles and baked shadow decals removed,
material colours baked into vertex colours, turned, scaled and set on the keel.

`source/pirateship-greggoryfisher.glb` is the download as it came; `scripts/build-pirateship.py`
turns it into `pirateship.blend` and bakes `web/js/pirateship-mesh.js`:

```bash
blender --background --python scripts/build-pirateship.py -- [preview.png] [side|deck]
```

Its triangle budget is its own (`HERO_BUDGETS` in `scripts/model-rules.mjs`, 15000): a
galleon you walk the deck of, one draw call, and a few in the world at most.
