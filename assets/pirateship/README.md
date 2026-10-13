# pirateship

The sloop every island's first boat is: a hero set, one asset called after the set. The set and its
parts keep the galleon's names (`pirateship`, `pirateship hull`), because web/js/boat.js, web/js/models.js
and the generators find her by them and a name on the wire is never renamed for a new model.

**Built here, from nothing.** `scripts/build-sloop.py` writes `pirateship.blend` and bakes
`web/js/pirateship-mesh.js` in one run ([Plans/nieuwe-sloep.md](../../Plans/nieuwe-sloep.md), chip 3):

```bash
node scripts/blender.mjs --background --python scripts/build-sloop.py
node scripts/blender.mjs --background --python scripts/build-sloop.py -- refs/sloop-build deck cabin nest nobake
```

The second form renders previews (side, quarter, stern, bow, top, deck, cabin, port, nest, iso, pair beside
the Batavia, lines and under without the sea) and, with `nobake`, leaves the .blend and the module alone.
Run it twice: the module must come out the same bytes (the .blend carries Blender's own timestamps).
`npm run models -- pirateship` re-exports the committed .blend and then derives the craft and cuts the walk
map from it (scripts/build-craft.mjs, scripts/build-shipwalk.mjs).

**The yardstick is bought and not in git.** Her sizes come from a Sea of Thieves sloop the keeper bought,
measured once by `scripts/measure-sloop.py` into `refs/sloop/measure.json` (gitignored) and typed into the
build script as literals. No mesh of it is used, and none of it may ever be committed.

**What she bakes as.** `pirateship hull` (everything that can be touched, one white material
`plain:pirateship paint`, the colours per corner in `Paint`), `pirateship glow` (window glass and lantern
lights, emissive), `pirateship sail` (a 10 x 14 grid hung from its yard, origin on the yard's middle, every
corner at or under it) and `pirateship flag` (hung by its luff at the part's origin, flying aft). The last two
are moved by web/js/ship-motion.js. Keel on y = 0, origin amidships, `anchor.waterline` at her draught (0.83).

**Colour zones.** Every face carries a zone (`zones`, one index a triangle, and `zoneNames`, each a name
and its base colour, written by scripts/export-models.py for a part with an INT face attribute `zone`):
planks, bottom, boot, wales, trim, spine, transom, rudder, iron, glass, deck, inner, cap, fittings, spar,
rope, sail, flag, flagmark. A shade inside a zone is in the corner's colour, so repainting a zone is the new
colour over its base colour, times the corner.

**Anchors** (scripts/model-rules.mjs, read into `shared/craft-galleon.mjs` by scripts/build-craft.mjs):
`deck.*` and `stair.*` (the waist, the break, fore and bow, the starboard walkway, the companion's foot, the
cabin, the stern well, the quarterdeck and the stairhead, the nest), `rail.*` (the bulwark in straight runs
and the balustrades), `port.1|2` (the entry ports, starboard first), `climb.side-starboard|port` and
`climb.mast` (up the pins), `mount.cannon-s|p` and `mount.harpoon`, `mast.main`, `helm`, `nest`, `cargo`,
`waterline`. `tests/sloop-bake.test.mjs` holds the bake to them.

Her triangle budget is her own (`HERO_BUDGETS` in `scripts/model-rules.mjs`, 20000; she is about 11k).
