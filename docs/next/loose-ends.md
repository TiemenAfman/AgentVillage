# Loose ends

Two things that are known, understood and not done. Each is written down with what
makes it awkward, so the next person does not have to rediscover that part.

This page had a third, "The polder code is not in `main`", and it was out of date: the
whole of `develop_martijn` has since been merged, `main` is a hundred and ninety-five
commits past it, and the reclaiming has been carried further here than it ever was there.
`docs/next/polders.md` went with it, into the manual under
[When the island runs out of land](../manual.md#when-the-island-runs-out-of-land). The one
thing that page was right to single out - that the terrain hash must be recorded *after*
reclaiming, or the guard treats a drained polder as a reseeded island and re-plans every
house - is now `tests/polder-hash.test.mjs`, which measures it rather than asserting it
was thought about.

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
only that a gate is worth hunting for where a road actually crosses a boundary, and for
those six it never does. Anyone wanting them properly gated would have to decide what a
gate means when the boundary is a river or is crossed twice.
