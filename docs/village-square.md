# Village square

The civic square now shares the terrain shader with paths and yards. A separate
coverage mask keeps limestone paving on the square. Warm, varied stones sit in
staggered rows, with worn corners and sandy joints; individual stones disappear
at its irregular edge before the sand blends into the meadow.

No raised plaza mesh, black cobble texture, extra draw call or collision change.
At 128 cells the extra one-channel mask uses 1 MiB. Its coverage is rebuilt with
roads and history replay. Ground shadows and terrain normals apply unchanged.

Validated in the browser at noon, both from island overview and close range;
mask tests check interior joins, feathered borders and removing a plaza.
