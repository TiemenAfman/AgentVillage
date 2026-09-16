# Town hall

`agentvillage-townhall.blend` is the editable source. It shares the tavern's
plaster, oak, terracotta and warm window materials, with a patinated bell dome,
civic crest and double entrance doors.

After editing the source, bake and validate with `npm run models -- townhall`.
The result is `web/js/townhall-mesh.js`, registered in the shared model catalog.
`scripts/build-townhall.py` reconstructs the source from scratch using the
tavern palette; running it replaces hand edits to this blend file.

The baked asset has 163 parts and 2492 triangles. With the existing entrance
porch the runtime building has 2764 triangles (previously 818, an increase of
1946). Parts merge into one geometry with the shared building material.
Door, flag and chimney smoke anchors are exported with the model. The building
fits the existing civic plot and keeps the existing interaction behavior.

Open `/townhall.html?modest` for an orbitable day/evening/night comparison;
`townhall-preview.png` is the Blender render. Geometry, palette compatibility,
door clearance, anchors and dome winding are covered by `tests/townhall.test.mjs`.
