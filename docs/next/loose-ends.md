# Loose ends

Three things that are known, understood and not done. Each is written down with what
makes it awkward, so the next person does not have to rediscover that part.

## The forest does not grow back

Scrub the chronicle into the past and the landscape rewinds with it - the roads, the
plaza, hamlet land, the polders where they exist. The trees do not. Ground that was
cleared for a house stays bald at every moment before that house was built.

`fellTrees` in `web/js/world.js` is one-way by design: it hides an instance by moving
it to `y = -999` at a thousandth of its scale, and deletes the cell from `treeCells`
so nothing can find it again.

The good news is that felling is only hiding, and every tree already keeps what it
would take to put it back - `{x, z, s, rot, cell, kind}` is stored in `trees` when the
scatter is built. So replanting is a matter of rebuilding one instance matrix, not of
re-running the scatter, and it costs no memory. Two things stand in the way:

- `treeCells.delete(k)` throws away the way back. That wants to be the `felled` flag
  that the item already carries, rather than dropping the entry.
- **Nothing dates cleared ground.** `layout.cleared` is a de-duplicated set rebuilt
  each scan from plots, greens and paths, unioned with whatever was already on record.
  Its array order is roughly "plots, then greens, then paths" - not chronological, and
  not stable between scans.

The date is derivable, though, and exactly the way the roads already are: every cleared
cell was cleared *by* something, and those things carry dates. A plot cell by its
building's `startedAt`, a path cell by the owner named in its id. The one honest gap is
ground cleared for something that has since gone; those cells have no claimant and can
stay bald.

## Six hamlet gates stand at the head of the road, not on the boundary

A hamlet's name sign is an arch over its road, placed where that road leaves the
hamlet's own land. `gateOf` in `web/js/main.js` finds that spot by walking the road
outward and taking the step where it stops standing on the parcel.

For seventeen of the island's twenty-three hamlets there is such a step. For six there
is not, so the sign falls back to the first cell of the road. Those are hamlets whose
road leaves across a bridge, or whose parcel the route re-enters further along - so
there is no single crossing where the land stops being theirs.

The fallback is not wrong: the head of the road is a reasonable place for a sign. It is
only that a gate is worth hunting for where a road actually crosses a hedge, and for
those six it never does. Anyone wanting them properly gated would have to decide what a
gate means when the boundary is a river or is crossed twice.

## The polder code is not in `main`

Land reclamation - the fix to `POLDER_H`, the reclaiming itself, the dike, the causeway
and the polder mill - lives on `develop_martijn` and has never been merged into `main`.
`docs/next/polders.md`, which describes the work as still to be done, is therefore only
half true: it is done, it is verified, and it is somewhere else.

What is in `main` is the *chronicle* side of it, which is written so that it does not
need the polders: the coast follows the cursor only if there are polders on the wire to
follow, and there are none here.

Merging it is not a plain cherry-pick. `main` has moved a long way in `lib/layout.mjs`
since that branch was cut, and the two collide in the terrain-hash guard the rivers work
added: draining a polder changes the heightfield on purpose, so the hash has to be
recorded *after* reclaiming or the guard treats the island as reseeded and re-plans every
house. That resolution is already worked out in the merge commit on `develop_martijn`.
