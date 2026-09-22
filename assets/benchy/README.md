# Benchy

The editable coloured studio model is `source/Benchy.blend`, based on the original
[Creative Tools 3DBenchy](https://github.com/CreativeTools/3DBenchy) multipart geometry.
It uses a petrol hull, ivory cabin, navy roof and funnel, brass details and a brown deck.

Run `blender --background --python scripts/build-benchy.py` from the repository root
to rebuild `benchy.blend` and `web/js/benchy-mesh.js`. The builder repairs only parts
that cannot be decimated directly, then merges their paint into vertex colours.
The result stays below the 4,000 triangle hero budget and keeps `benchy hull` as one
part and one draw call. Studio lights and materials are not runtime shaders: the game
uses its shared lighting and flat shading.

`npm run models -- benchy` rebakes the game Blender file through the normal exporter.
The source faces +X; the game faces +Z. The keel is centred at ground level. Rider
placement is checked against the exported cabin in `tests/boat.test.mjs`.
