# Soft sandy paths and yards

Roads, front paths and worn ground around buildings now share a coverage mask on
the terrain material. Sand merges with the existing grass, seasonal colours and
lighting instead of sitting on raised, opaque strips. Only explicitly paved
square cells retain cobbles. Routing, plots, bridges and settler navigation are
unchanged.

`web/js/ground-wear.js` rasterizes deterministic, irregular verges and elliptical
yards. Coverage is combined by maximum, so crossings cannot darken or form seams.
The mask is rebuilt when paths or buildings change, including history replay.
Shader grain adds fine variation without additional objects or textures.

At a 128-cell island the mask is 1024 squared, one byte per texel (1 MiB).
Resolution is capped at 2048. Sand adds no draw calls or terrain triangles;
only the central paving remains a separate mesh. There is no alpha sorting or
terrain/decal height mismatch. The same shader runs in standard and modest mode.

Validation: all 48 tests pass, including real layout checks with 48 houses,
curve bounds, sand/plaza precedence, smooth verge coverage, deterministic noise,
map boundaries and removing old wear. Browser checks cover standard and modest
rendering, countryside lanes and village yards, with no console errors.

