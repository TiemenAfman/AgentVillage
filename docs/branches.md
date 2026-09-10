# Verifying a change to the layout

This page used to be a map of nine topic branches and what each one depended on. They
have all landed on `main` and been deleted, so the map is gone; what is left is the part
that outlives them, which is how to check that a change to the layout has not quietly
broken the promise the whole thing rests on.

## The promise

**A house never moves.** `data/layout.json` records where every building stands and is
only ever added to. It is the only irreplaceable file in `data/` - `village.json` and
`cache.json` both rebuild themselves - so copy it before a first scan on anything new.

```bash
node scan.mjs        # rebuild data/village.json
node serve.mjs       # look at it on localhost:4747
```

`scan.mjs` takes `--out`, `--layout-file` and `--cache-file`, so a change can be scanned
into scratch files without touching the island you are running. `--all` ignores the
founding date and uses every session ever recorded, which is the closest thing to a
stress test: it puts several hundred settlers on the island at once.

## What to assert rather than eyeball

Four things, all computable from `data/layout.json` and `data/village.json` alone:

1. **No plot moved.** Every `house:*`, `shed:*` and `civic:*` entry keeps its `gx`, `gz`
   and `rot`. This is the one that matters; everything else is a way of catching a
   version gate that fired when it should not have.
2. **The town is bit-identical** - `town.square`, `centre`, `lots`, `size`, `paved` and
   `commons`, and the lattice anchor.
3. **Land already owned did not move.** Every district keeps every super-cell of every
   lobe.
4. **A second scan changes nothing.** Two consecutive scans leave `data/layout.json`
   byte-identical.

If a change edits the terrain, two more, both from `layout.polders` and
`shared/terrain.mjs`: that no cell which was solid land got rewritten, and that the count
of whole buildable four-by-four blocks only ever went up.

## Stop the server before you measure

**The island server rescans on a timer** - every sixty seconds by default. So a
"second scan changes nothing" test run against a live island is measuring the server's
scan interleaved with yours, and it will show plots moving and files differing when
nothing is wrong. This cost half a day once. `stop-island.cmd`, then measure, then start
it again.

## The version gates, and which one to reach for

Three numbers in `lib/layout.mjs`, in descending order of violence:

| | Throws away |
|---|---|
| `LAYOUT_VERSION` | Everything, the town and the terrain included. Almost never right. |
| `PARCEL_VERSION` | Houses, sheds, parcels and paths - re-planned at once. The town keeps every stone. |
| `ROAD_VERSION` | The hamlet roads and `cleared`, and nothing else. |

The reason the smallest one exists is worth keeping: roads are the one part of the layout
that can be thrown away cheaply, because they are derived geometry that no building stands
on. Bumping the parcels to fix a road would move every house on the island.

## What the branch experiment found

Kept because it explains the shape of the history rather than anything you can still do.

Nine branches were cut so a release could be assembled from any subset of them, and every
pair was merged both ways to prove it - fifty-six merges. It worked, with one dependency
that could not be removed: the streets work came first and the three fixes plus the hamlet
work all carried it, because those commits rewrite the same large regions of
`web/js/main.js` and `web/js/world.js`. Building them on `main` instead was tried and
every pair that spanned the streets work conflicted.

The other thing it found is that a dependency can be about meaning rather than mechanics.
The hamlet work needed the repository grouping not because the files collided but because
`MIN_HAMLET` counts sessions per project: with a district per folder the island had
thirty-seven districts instead of twenty-eight, twenty of them with one or two sessions,
and every number written about the hamlets would have described a different island.
