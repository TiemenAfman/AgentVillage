# The harbour, half dug

The quay now stands in water instead of beside it. What is left is making it stand at one
*height*: the lanes arch over each other and the houses sit three quarters of a metre below
their own planks. Both are the same omission, and both are small - the hard parts are done
and are written down here so nobody does them twice.

Branch: `feature/de-haven`, commit `a50c500`. Everything below is measured on Promptholm at
`gridSize` 256, seed 1337.

## What already works

**The island has a dock at all.** `landing` is the nearest *beach* cell to town - a height
test, `isBeach` - and nothing ever promised it touches the sea; `coastCells` is the list
that means "has water beside it". On this island they are six cells apart, so asking the
landing which way the sea lay answered "nowhere" and no dock was built. `dockShore` in
`web/js/main.js` walks on to the real waterline.

**Neither harbour is in a pond.** `coastCells` counts a pond's rim as coast, and on a 256
island the town sits 85 cells from the sea while a fourteen-cell puddle sits seven cells
away - so the quay district built its pier across the puddle, with ten Cowork houses on
stilts around it. The sea is now flooded once from the map border (`seaCells`, in both
`lib/layout.mjs` and `web/js/main.js`) and a shore whose water is not in that fill is not a
shore. Measured over twelve seeds at both sizes: six of twenty-four landings used to get a
dock in a pond, now none do.

**The ground under the quay is dredged away.** A basin is the polder run backwards -
`BASIN_H = -80/256` in `shared/terrain.mjs`, stamped with the same `setCell` - and it keeps
the polders' bargain: the cells are decided once in `lib/layout.mjs` and written into the
layout, never worked out in the terrain module. An island with no basin hashes exactly as
before, so this needed no version gate and moved nobody's house.

**The lanes are decks.** A road is not geometry - it is a wear mask painted on the ground
mesh (`web/js/world.js`) - and the ground under the basin is below the sea, so a road left
on record would be an invisible stripe on a seabed with settlers walking over it.
`drownRoads` turns every paved cell that ended up over water into a bridge.

**Water belongs to nobody.** `decodeOwnership` takes an optional terrain and leaves water
cells unowned, so no fence and no field is planned on the basin. Before this the quay had
ploughed field parcels on the seabed, read through the water as a green smear.

## What is wrong now

### The lanes arch over each other

They are built as ordinary bridges, and a bridge arches on purpose: `BRIDGE_ARCH = 0.34`
as a raised cosine, because a flat plank between two banks reads as a board lying in a
ditch. A quay lane has no far bank - it runs from a house to a house - so the hump is a
hill in the middle of a quay, and where two lanes cross they do it at different heights.
That is the spaghetti.

Half the fix is in: `bridgeStops(cells, terrain, axis, { quay })` in `web/js/buildings.js`
already returns a flat deck at `QUAY_DECK` with no arch, and skips `spanToBanks` because a
quay lane ends where its planks end. What is left:

- `web/js/main.js` `syncBridges` (~:2082, ~:2087) passes nothing. Both calls want
  `{ quay: !!b.quay }` - `bridgeDeckHeights` as well as `buildBridgeGeometry`, or the
  planks and the surface you walk on disagree.
- Nothing sets `b.quay`. `drownRoads` in `lib/layout.mjs` is where the bridge record is
  made, and it is the only place that knows the cell is over a basin rather than over a
  river. Mark it there.
- `lib/islandbundle.mjs` `bridge()` rebuilds a visitor's bridges field by field from a
  whitelist, so the flag does not travel until it is added - a visiting island's quay
  would arch. One boolean beside `axis`.

### The houses sit below their own planks

`main.js:1866` pins a harbour house with
`if (spec.harbour && y <= HARBOUR_WATERLINE) y = Math.max(-0.35, Math.min(y, 0.05))`. On
the basin floor that gives -0.3125, while the planks are at `QUAY_DECK` = +0.44. The house
floor is `y + 0.62` - the number `main.js:2690` already uses to stand a settler on a
harbour house - so it lands at 0.31 against a walkway at 0.44.

The whole point of a quay is that it is one floor: pier, lanes and house decks at the same
height, walkable end to end. So a harbour house over water wants `y = QUAY_DECK - 0.62`,
not the waterline. `web/js/guest-island.js:171` carries a copy of the same clamp and needs
the same change, or a visitor's quay sinks while ours does not.

Worth doing at the same time, because it is the same clamp and it is already visibly wrong:
a house whose ground is between 0.05 and `HARBOUR_WATERLINE` (0.35) is *lowered* into
ground it has nothing to sink into. On this island Dreamy Vibrant Einstein stood at 0.05 on
ground of 0.27 with its stone base buried. The clamp should fire on water, not on the beach
line.

## Two hazards, both of which bite silently

**A terrain change wipes the island.** `placeAll` resets the whole layout when
`layout.terrainHash !== terrain.hash` (`lib/layout.mjs`, near the top) - that guard is what
stops houses standing in a river that was cut after they were placed. Digging a basin
changes the hash, so the scan that digs it must write the new hash in the same pass, which
it does. The practical trap is running a server whose code predates the basin against a
layout that has one: it builds terrain without the basin, fails the check, and throws away
the town. Stop the server before scanning across that boundary.

**A basin must touch the sea.** If it does not, `onOpenSea` decides the quay's own planks
are in a puddle, gives them back and re-picks - every scan, forever. `basinCells` digs a
four-connected channel from the parcel to the shore cell the pier leaves from; that cell
has open sea on its far side by construction, which is what `seawardDirection` chose it
for. `tests/layout-measure.test.mjs` asserts the join, and that test is the only thing
standing between this design and an island that reorganises itself nightly.

## Checking it

```bash
node --test "tests/*.test.mjs"
```

173 at the time of writing. Two are new: *the quay stands in water, and its water is the
sea*, and *a lane over the basin is a deck, not a stripe on the seabed*. Both return early
on an island with no Cowork work, because there is no quay district to dig under.

Then look at it, which is what caught both faults above - stop the server first, scan, and
start it again from the branch that knows about basins.
