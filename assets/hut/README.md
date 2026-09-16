# Timber hut

Editable source: `agentvillage-hut.blend`. The 408-triangle body adds fitted shutters,
framed warm windows, corner posts, diagonal braces and a small entrance canopy.
It composes with the existing roofs, chimney, porch and safe yard placement.

Bake hand edits with `npm run models -- hut`. Rebuild from `design.json` with
`blender --background --python scripts/build-dwelling.py -- hut`; rebuilding
replaces hand edits. Preview the complete house at `/dwellings.html?tier=hut`.
