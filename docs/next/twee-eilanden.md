# Two islands, one world: what is not finished

The coordinate work is done. `shared/regions.mjs` places an island at a berth, the water
covers the whole archipelago, `web/js/guest-island.js` draws ground you can stand on,
`web/js/boat.js` gets you across, and the server can take delivery of an island and park
it. What is missing is almost all of the middle: the two ends have been built and have
never been introduced to each other.

Each of the following is checked against the code rather than against anybody's memory of
it, and says what makes it awkward.

## Nothing actually sends an island, and nothing fetches one

Both halves exist and neither calls the other.

On the server, `POST /api/island` parses a bundle and moors it (`serve.mjs:716`), and
`GET /api/islands` hands back either the list of berths or one whole island
(`serve.mjs:753`). `GET /api/hello` already carries a freshly built bundle of *this*
island, keeper and beacon id and all (`serve.mjs:700`).

On the page, `joinIsland` (`web/js/main.js:1255`) takes exactly the fields a bundle
carries — id, seed, gridSize, polders, terrainHash, name, village — rebuilds the terrain,
finds a free berth and hands back a region.

Between them: nothing. Grep the tree for `api/island` and the only hits are `serve.mjs`,
the comment in `lib/access.mjs` and one test. No client posts a bundle anywhere, and
`web/js/` never mentions `/api/islands` at all. The `guests` event the upload route
broadcasts (`serve.mjs:742`) has no listener.

So the only island that ever reaches a berth today is the one the `?join=` debug parameter
conjures — `?join=self` for our own island again at the berth due east, `?join=seed:12345`
for a stranger's shape with no village on it (`joinRegionsFromParams`,
`web/js/main.js:1288`). That parameter only fires at boot, from `buildScene`, before the
world is built.

The awkward part is deciding *who* posts. A bundle is built on the sender's machine and
must be, because the redaction has to run on the side that holds the secrets. So sailing
to a neighbour is not enough — somebody has to push. The beacon already knows every island
on the network and its port (`lib/neighbours.mjs`), which makes an unasked-for upload
technically easy and socially wrong: an island arriving in your harbour because its keeper
pressed nothing is not a visit.

## Their props and their beds travel and are never drawn

`buildBundle` packs up to 500 props and 200 beds (`CAPS` in `lib/islandbundle.mjs:42`),
`parseBundle` rebuilds them field for field, and `guests.summary()` even counts them for
the berth listing.

`createGuestIsland` takes `{ scene, region, buildings, material, modest, month }` and has
no parameter for either. `raiseGuestIslands` (`web/js/main.js:1414`) passes
`region.village.buildings` and nothing else. Their jetties, their signposts and every bed
they have sown arrive and sit in the berth file unread.

The same is true of `paths`, `bridges`, `districts` and `cleared`, which the bundle also
carries — but those are the "no hamlet dressing" the header of `guest-island.js` declares
on purpose, and they want the ground-wear and hamlet machinery region-scoped first. Props
and beds want none of that: both are already plain world-coordinate lists with their own
draw paths.

## Moored boats are not shared between players

`lib/boats.mjs` is written, 169 lines, deliberately in the shape of `lib/panelstate.mjs`,
with `BOAT_ID`, `PILOT_ID`, the same bounds as a pose, take/drop claiming and a note that
boats are not persisted so a restart puts them back at their moorings.

`serve.mjs` does not import it. Grep for `boats` in that file and there is nothing.

So a boat exists only in the tab that made it: `spawnBoat` (`web/js/main.js:1406`) pushes
one into `state.boats` and nothing leaves the page. Two people at one dock each press
**E**, each gets their own boat in the same water, and neither sees the other's. Worse in
the case the module's header was written for: somebody who walks down to the water five
minutes after a boat was left on the far shore finds it back at the jetty, because there
is no shared answer to where it is.

Wiring it needs the relay side too — `state.net.setRoom('boat', ...)` already tells the
other players that somebody is aboard (`web/js/main.js:804`), but the hull itself has no
pose on the wire.

## A berth never refreshes, and nothing evicts one

An island at a berth is a snapshot and stays one. There is no poll, no SSE handler and no
re-upload path, so a bundle parked at 10:00 is what you are still looking at at 16:00.

`shared/regions.mjs` has `replace(id, region)` ready for exactly this, and it is careful
about the thing that would break: it keeps the departing region's `levelBase` rather than
removing and re-adding, because re-issuing strides would shift the level keys under a
bridge deck somebody is standing on. `raiseGuestIslands` is idempotent for the same
reason. The pieces are there; nothing drives them.

Eviction is thinner than it looks. `createGuests()` returns an `evict(id)`, and
`tests/guest-berth.test.mjs` exercises it — but `serve.mjs` never calls it. The only thing
that ever clears a berth is the sweep `createGuests()` does at construction, which is once,
at server start. A visitor who closes their tab leaves their island moored for the rest of
the run, holding one of the four berths and up to two megabytes of the eight-megabyte lot.

The obvious hook is the WebSocket disconnect that already drops a player, but the two are
not the same identity: a berth is keyed by island id and held against the address that
parked it (`berths` in `lib/guests.mjs:84`), and a player is a connection. Two people
behind one NAT are one address and can hand a berth back and forth, which is right and is
also why "the last socket from that address closed" is not the same question as "that
island has gone home".

## The journey home

A visit can change exactly two things, and `lib/garden.mjs` says so in its header: the
purse, pouch and beds in `garden.json`, and the hand-placed scenery in `props.mjs`.
Everything else is rebuilt by `scan.mjs` from transcripts that only exist on the owner's
machine, and `layout.json` never travels in either direction.

Both modules are already written for it. `where()` in `lib/garden.mjs:41` takes a `file`,
a `seed`, a `gridSize`, a `layoutFile`, `polders` and `paved`, so a berth can keep its own
garden under `data/guests/<id>/`; `addProp` takes `{ file, gridSize }` for the same reason,
and both compute `reach` from the size passed in rather than caching it, explicitly so two
berths of two different island sizes cannot borrow each other's edge.

The carrying-home half is written but not connected. `lib/journal.mjs` is the host's side —
an append-only log of *operations* rather than a snapshot, so that a `buy` and a `sell`
merge with whatever the gardener at home did meanwhile instead of clobbering the purse.
`lib/visits.mjs` is the visitor's side, and it pulls rather than being pushed to: the host
publishes the log over HTTP and the guest's own machine decides when to replay it through
its own mutators, so there is no inbound route and no credential the host holds.

What is missing is every wire into them. `serve.mjs` mentions neither module, and it
passes no berth to the garden or the props either: `/api/props` calls `listProps()` bare
(`serve.mjs:946`), `addProp(body)` bare (`:952`), `plantBed(body)` bare (`:1003`). Nothing
in `web/js/` sends a region with a prop or a bed — `sowHere` (`web/js/main.js:647`) sends
the walker's world x and z and no more.

The consequence today: stand on a berth, sow a bed, and it is written into *your* island's
`garden.json` at a world coordinate a hundred and twelve units off your own coast, where
your own terrain check has no opinion about it. Nothing routes it to the berth's file and
nothing carries it back to the island it was sown on.

## Visiting without leaving the page

Sailing to a neighbour still means leaving. `visitNeighbour` (`web/js/main.js:1487`) plays
a crossing and then really does send the browser to their server, which is the honest
thing and is documented as such in the manual. There is no in-place alternative: no config
flag, no second mode, nothing under `multiplayer` in `config.example.json` that touches it.

Now that an island can stand at a berth and be walked, "sail over" could mean walking
across without the origin changing. That is a much larger change than it sounds, and the
reason is the same asymmetry `guest-island.js` was built around: their island is a *place*
here, not a village. Talking to their settlers, reading their boards and opening their
dossiers all go through `state.byId` and the chronicle, which are single and ours.

## The water patch is the cost of a full harbour

The sea is one surface over the whole archipelago (`waterPatchSpan`, `web/js/world.js:150`),
sized from `sea.gridBounds()` plus a margin of `max(60, 130 - half)`, with a vertex per
unit — or every other one in `modest` mode. It is rebuilt whenever an island joins a
running page: `raiseGuestIslands` calls `reshapeWater()` first, so a new coast rises out of
its own shallows rather than out of the flat open-ocean disc.

`tests/water-span.test.mjs` pins what it costs. One 64-cell island on its own is a 260 by
260 square: 68,121 vertices and 135,200 triangles, which the test's own header calls about
a third of the island's ~430,000. Add one island to the east and it becomes a 372 by 260
rectangle — under 1.5x the water for twice the island, which is the whole reason a second
one is affordable.

Four berths are not two islands. `SEA_GAP` is 48 and a berth sits at `ownHalf + gap +
theirHalf`, so with all four taken and every island a 64-grid the grid bounds run
-144..144 on both axes, the margin of 98 makes it -242..242, and the patch is 484 by 484:

| Berths taken | Water patch | Triangles |
|---|---|---|
| none | 260 x 260 | 135,200 |
| one, east | 372 x 260 | 193,440 |
| all four | 484 x 484 | 468,512 |

A full harbour is therefore more water than the whole island used to be geometry, on top
of four guest islands' worth of ground and buildings. There is no test on the four-berth
case and no tier switch: `modest` is chosen once at boot from the GPU, so a page that
started on a machine's good graphics and then fills its harbour has no way to drop to
every-other-vertex. Either the patch wants a tier of its own past two islands, or the
berths want a smaller `SEA_GAP` — and the gap is load-bearing, because it is what makes
the crossing a voyage.
