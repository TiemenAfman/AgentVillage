# Verifying a change to the layout

This page used to be a map of nine topic branches and what each one depended on. They
have all landed on `main` and been deleted, so the map is gone; what is left is the part
that outlives them, which is how to check that a change to the layout has not quietly
broken the promise the whole thing rests on.

## The promise

**A house never moves by itself.** `data/layout.json` records where every building stands
and is only ever added to. It is the only irreplaceable file in `data/` - `village.json`
and `cache.json` both rebuild themselves - so copy it before a first scan on anything new.

The keeper may move a whole hamlet, through `POST /api/plan` (`lib/plan.mjs`), and that is
the one exception: it is a hand, not a scan. Every check below still holds for it with one
word added - *unless the plan named it* - and the plan route enforces that itself: the diff
it computes has an `otherMoved` list, and a plan with anything in it is refused before a
byte is written. Every apply writes `layout.before-plan-<ts>.json` beside the layout first.

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

1. **No plot moved that the plan did not name.** Every `house:*`, `shed:*` and `civic:*`
   entry keeps its `gx`, `gz` and `rot`. This is the one that matters; everything else is a
   way of catching a version gate that fired when it should not have. After a plan, the
   household of the moved hamlet has shifted by exactly the delta and its office stands at
   the new gate; nothing else - `diff.plots.otherMoved` is this check at runtime.
2. **The town is bit-identical** - `town.square`, `centre`, `lots`, `size`, `paved` and
   `commons`, and the lattice anchor.
3. **Land already owned did not move.** Every district keeps every super-cell of every
   lobe.
4. **A second scan changes nothing.** Two consecutive scans leave `data/layout.json`
   byte-identical.
5. **After a plan is applied, a plain scan changes nothing either.** The apply runs
   `placeAll` to a fixed point (at most three passes) and refuses if it does not settle, so
   the scan after it is the same no-op as any other. `tests/plan-scan.test.mjs` measures
   it on a copy of the live island; `tests/plan-move.test.mjs` on a synthetic one.

If a change edits the terrain, two more, both from `layout.polders` and
`shared/terrain.mjs`: that no cell which was solid land got rewritten, and that the count
of whole buildable four-by-four blocks only ever went up.

And one that is not computable from the files, because it is about the order two lines run
in: `layout.terrainHash` is recorded **after** everything that moves the ground on purpose,
never before. The guard reads a changed heightfield as a changed seed and re-plans the
island from nothing, which is right for a tuned generator and ruinous here, because
`reclaim` raising a polder at `POLDER_AT` and `planFairway` deepening a channel at
`FAIRWAY_AT` both change the heightfield deliberately. Recorded before either of them, the
stored hash is a coast the island no longer has, and every house moves on every scan -
assertions 1 and 4 above, both failing, with nothing in the diff to say why.
`tests/polder-hash.test.mjs` measures it.

Write a third such feature and it goes behind the same line, and into `groundOf` at the top
of that test - which exists precisely so the expectation is built from what the layout says
it dug and drained, rather than from a list of terrain features kept in step by hand. A
test that names them one by one does not fail when a new one arrives; it keeps passing,
against an island nobody is planning.

## Stop the server before you measure

**The island server rescans on a timer** - every sixty seconds by default. So a
"second scan changes nothing" test run against a live island is measuring the server's
scan interleaved with yours, and it will show plots moving and files differing when
nothing is wrong. This cost half a day once. Stop it (tray → Stop, or `taskkill /f /im
promptholm-island.exe`), then measure, then start it again.

## The version gates, and which one to reach for

Five numbers in `lib/layout.mjs`, in descending order of violence:

| | Throws away |
|---|---|
| `LAYOUT_VERSION` | Everything, the town and the terrain included. Almost never right. |
| `PARCEL_VERSION` | Houses, sheds, parcels and paths - re-planned at once. The town keeps every stone. |
| `ROAD_VERSION` | The hamlet roads and `cleared`, and nothing else. |
| `SQUARE_VERSION` | One plot on the town square, and only if it stands inside another one. |
| `QUAY_VERSION` | The quay: its planks and its parcel, if those planks are not over open sea. |

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
