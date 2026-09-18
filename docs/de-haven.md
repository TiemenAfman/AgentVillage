# The harbour

The quay is the one district that is supposed to be standing in the water. Its houses are
built on stilts, they are refused a yard and a doorstep because they stand on their own
legs, and the ground under them is dredged away so the sea comes in. This is how that is
built and, at the foot, the two things about it that bite silently.

Measured on Promptholm at `gridSize` 256, seed 1337, and again on a 64 island with sixteen
Cowork sessions on it.

## One storey, end to end

The whole point of a quay is that it is one floor: the pier, the lanes over the basin and
every house deck at the same height, walkable from the water's edge to the last front door.
That height is `QUAY_DECK` in `web/js/buildings.js` — `SEA_LEVEL + 0.44`, which is a hand
more clearance than a bridge over a river keeps, because a pier stands in open water where
the swell is the whole sea.

Three things meet there, and each used to arrive at its own height:

**The pier.** The dock set is modelled in one frame with its piles' feet at y = 0, so the
island drops the lot by `QUAY_DECK - DOCK_DECK` and there is no seam anywhere along the run.
`assets/docks` is the worked example; `tests/docks.test.mjs` asserts the joins.

**The lanes.** A road is not geometry — it is a wear mask painted on the ground mesh
(`web/js/world.js`) — and the ground under the basin is below the sea, so a road left on
record would be an invisible stripe on a seabed with settlers walking over it. `drownRoads`
in `lib/layout.mjs` turns every paved cell that ended up over water into a deck.

Those decks are *not* bridges, and the difference is a flag. A bridge arches on purpose:
`BRIDGE_ARCH` as a raised cosine, because a flat plank between two banks reads as a board
lying in a ditch. A quay lane has no far bank — it runs from a house to a house — so the
hump is a hill in the middle of the quay, and where two lanes cross they do it at different
heights and the pair reads as planks thrown over each other. On the island above the lanes
rode between 0.892 and 1.481 with a 0.589 bump in them, over planks at 0.44.

So `drownRoads` marks the record `quay: true`, and it is the only place that can: by the
time `web/js/buildings.js` has it, a cell over the harbour and a cell over a river are both
simply not land. `bridgeStops` then returns a flat deck at `QUAY_DECK` and skips
`spanToBanks`, because a quay lane ends where its planks end. Three places have to carry the
flag on or it does not arrive: `syncBridges` in `web/js/main.js` passes it to
`bridgeDeckHeights` *and* `buildBridgeGeometry` — the floor a settler walks on and the
planks it sees, which are only ever right together — and `bridge()` in
`lib/islandbundle.mjs` names it in the whitelist, or a visitor's quay arches while ours lies
flat.

**The landings.** A quay house is built in the middle cell of a three-by-three plot while
the lane runs along the outside of it, so for several releases there was 1.06 of open water
between a front door and the planks it was supposed to open onto: from the air, boxes
floating beside a jetty that passed them by. `quayPorch` lays the boards that cover it -
plank rather than the stone step every other house gets, because a step is what the ground
under a door does and under this door there is no ground.

Two things make it a floor rather than a picture of one. `quayPorchCells` hands its cells to
`handOutDecks`, which is the map the settlers and walk mode read their footing from. And
`quayPorchReach` measures how far it may go: to the near edge of the lane outside the door
and not a plank further. That is measured rather than assumed, because a lane lies two ways
round and the two are 0.66 apart - across the front its boards stop `DECK_HALF` from the
middle of the door cell, and running at the door its own end lip already reaches most of
the way. A landing cut for the wrong one either stops in open water or lies along the lane
on exactly its plane, which is the one thing the depth buffer cannot be asked to decide.
Measured per cell, not per run: `drownRoads` leaves runs that turn a corner, and taking the
record's `axis` for all of them puts a deck a cell and a half from where it is drawn.

Where a landing arrives, the lane's railing opens. `buildBridgeGeometry` takes the meeting
points as `gates` and leaves out the kerb, the beam and the posts across them - a
post-and-rail down the whole length of a quay lane is a fence in front of every door on the
quay. The trestles underneath stay: a gateway is a hole in the railing, not in the deck.

**The houses.** `makeRecord` pins a harbour house over water to `HARBOUR_PIN`, which is
`QUAY_DECK` less `HARBOUR_FLOOR` (0.62, the height its floor stands over its own origin and
the number `main.js` already stands a settler on a harbour house with). The two constants
live beside `QUAY_DECK` in `buildings.js` so they cannot drift, and `web/js/guest-island.js`
reaches for the same ones rather than keeping a copy.

It used to pin to the waterline instead, which put the floor at 0.31 against a walkway at
0.44: a step up onto every doorstep on the quay.

Its floor is as thick and as wide as whatever the body reaches below its own ground line. A
dwelling is modelled with a skirt under it - the course that stops a gap opening on the
downhill side - and on land that skirt is buried. Over water there is nothing to bury it in:
0.30 of masonry hung under every house on the quay, which from the sea read as a stone block
slung beneath a house that is supposed to be standing on posts. So the floor covers it the
way ground would, and it is measured off the body rather than set to a number - the number
that fitted the hut left a finger of a cottage's 1.12 skirt showing all the way round. And the test that decides *whether* to pin
is the sea, not the beach line — a house whose ground is dry sand at 0.27 was being lowered
into ground it has nothing to sink into, with its stone base buried, while The Quay, whose
ground runs from 1.65 to 1.99, had nineteen houses pinned at 0.05 and read from the air as
green wedges lying in the grass. A house whose plot turned out to be land stands on that
land like any other building, stilts and all, which is what a house on a quayside does.

## Getting the water there

**The ground is dredged away.** A basin is the polder run backwards — `BASIN_H = -80/256` in
`shared/terrain.mjs`, stamped with the same `setCell` — and it keeps the polders' bargain:
the cells are decided once in `lib/layout.mjs` and written into the layout, never worked out
in the terrain module. An island with no basin hashes exactly as before, so this needed no
version gate and moved nobody's house.

**Neither harbour is in a pond.** `coastCells` counts a pond's rim as coast, and on a 256
island the town sits 85 cells from the sea while a fourteen-cell puddle sits seven cells
away — so the quay district built its pier across the puddle, with ten Cowork houses on
stilts around it. The sea is now flooded once from the map border and a shore whose water is
not in that fill is not a shore: `onOpenSea` in `lib/layout.mjs` for the district's pier, and
`seaCells` in `shared/quay.mjs` for the dock every island has. Measured over twelve seeds at
both sizes: six of twenty-four landings used to get a dock in a pond, now none do.

**The landing is a preference, not a promise.** `landing` is the nearest *beach* cell to
town — a height test — and nothing ever promised it touches the sea; `coastCells` is the
list that means "has water beside it". On this island they are six cells apart, so asking
the landing which way the sea lay answered "nowhere" and no dock was built. `quaySite` in
`shared/quay.mjs` walks on to the nearest real waterline that is the sea.

That file is shared for the reason its header gives: three sides have to agree about where
the boat is without a message between them — the viewer drawing the planks, `serve.mjs`
handing `lib/boats.mjs` its moorings, and the browser across the channel looking for an
untouched boat in the same place.

**Water belongs to nobody.** `decodeOwnership` takes an optional terrain and leaves water
cells unowned, so no fence and no field is planned on the basin. Before this the quay had
ploughed field parcels on the seabed, read through the water as a green smear.

## Two hazards, both of which bite silently

**A terrain change wipes the island.** `placeAll` resets the whole layout when
`layout.terrainHash !== terrain.hash` (`lib/layout.mjs`, near the top) — that guard is what
stops houses standing in a river that was cut after they were placed. Digging a basin
changes the hash, so the scan that digs it must write the new hash in the same pass, which
it does. The practical trap is running a server whose code predates the basin against a
layout that has one: it builds terrain without the basin, fails the check, and throws away
the town. Stop the server before scanning across that boundary.

**A basin must touch the sea.** If it does not, `onOpenSea` decides the quay's own planks
are in a puddle, gives them back and re-picks — every scan, forever. `basinCells` digs a
four-connected channel from the parcel to the shore cell the pier leaves from; that cell has
open sea on its far side by construction, which is what `seawardDirection` chose it for.
`tests/layout-measure.test.mjs` asserts the join, and that test is the only thing standing
between this design and an island that reorganises itself nightly.

## Checking it

```bash
node --test "tests/*.test.mjs"
```

187 at the time of writing. `tests/quay-deck.test.mjs` measures the heights against each
other on a terrain with a basin dredged into it, and the landing against a lane in all four
rotations and both orientations, so it holds on a checkout with no sessions on disk; the two in `tests/layout-measure.test.mjs` — *the quay stands in water,
and its water is the sea*, and *a lane over the basin is a deck, not a stripe on the
seabed* — measure the real island and return early when there is no Cowork work to earn a
quay district.

Then look at it, which is what caught every fault written down here — stop the server first
(`stop-island.cmd`), scan, and start it again.
