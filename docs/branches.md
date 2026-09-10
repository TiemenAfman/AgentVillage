# The branches, and what depends on what

Work on the island is cut into branches that can be taken one at a time, so a release can
be assembled from whichever of them is wanted. **Every combination merges cleanly, in any
order** — that was checked by merging all 56 pairs both ways, and the full set in several
orders.

## What there is

| Branch | What it is | Alone it brings |
|---|---|---|
| `feature/streets-school-strollers` | The town centre, roads that braid into it, settlers who walk them, shapes for the milestones, and the `/demo` model sheet | 6 commits |
| `fix/camera-for-the-larger-island` | The camera and the shadow frustum were still sized for the 64-cell grid; the coast was cropped at boot and half of it cast no shadow | + streets |
| `fix/one-hamlet-per-repository` | A district is the repository a session's folder belongs to, not the folder itself | + streets |
| `fix/route-search-rounding` | `routePath` discarded valid steps because its costs are float32 and its heap float64 | + streets |
| `feature/hamlets` | Land is owned: a parcel per project, hedges, fields, greens, name signs | + streets, camera, repository, rounding |
| `feature/rivers-and-bridges` | Rivers cut from the hill to the coast, and a bridge where a hamlet's road has to cross one | + streets, camera, repository, rounding, hamlets |
| `feature/polders` | A note on the polder machinery and the bug that makes a reclaimed cell unbuildable | docs only |
| `perf/serve-gzip` | A note on compressing what the server sends | docs only |
| `docs/branch-layout` | This page | docs only |

## What went straight onto `main`

A fix that `main` can actually take does not need a branch waiting for it. So far:

- **Labels hung in the air after stepping down to walk** (`5cc77c0`). The label layer was
  never emptied on the way into walk mode. Independent of everything else, and merged
  clean with all nine branches both ways before it went in.

Two of the fixes below cannot go that route, and it is worth saying why rather than
leaving it to be discovered:

- `fix/route-search-rounding` fixes the weighted route search, and **`main` has no
  weighted route search** — it is a plain flood fill until the streets branch lands. There
  is nothing there to fix.
- `fix/camera-for-the-larger-island` would apply to `main` on its own, but the streets
  branch rewrites the same regions of `web/js/main.js` and `web/js/world.js`, so putting
  it on `main` first only moves the conflict to whoever merges the streets work. It sits
  on the streets branch instead, where it merges in any order.

## The one dependency that could not be removed

`feature/streets-school-strollers` comes first, and the three fixes plus
`feature/hamlets` all carry it. That is not a choice — it is where the work actually sits.

Those commits rewrite large parts of `web/js/main.js`, `web/js/world.js` and the README,
and the camera fix, the repository grouping and the hamlet work all touch the same
regions. Building them on `main` instead was tried: every pair that spanned the streets
work conflicted. Basing them on the streets branch makes all of it merge in any order,
at the cost of the streets work coming along.

So the choice is: take the streets branch, then take any subset of the rest. If a fix is
wanted without the streets work, it has to be rewritten against `main` on its own — the
diff is small in each case, but it is a rewrite, not a cherry-pick.

`feature/hamlets` carries the other three fixes as real merge parents, which is what makes
the order free. Taking `feature/hamlets` therefore means taking them too; taking any of
them on its own does not pull in the hamlets.

The two remaining notes - `feature/polders` and `perf/serve-gzip` - are documentation only
and share no file with anything else, so they can go in or stay out at any point.
`feature/rivers-and-bridges` is no longer one of them: it now carries the rivers and the
bridges, and it is built on `feature/hamlets` because a bridge is a crossing on a
*hamlet's* road to town and there is no such road until that branch lands.

## Why the hamlet work depends on the repository grouping

Not just mechanically. `MIN_HAMLET` counts sessions per project and the sizing is derived
from it, and with a district per folder the counts are different ones: thirty-seven
districts instead of twenty-eight, twenty of them with one or two sessions. The hamlets
would still be laid out, but the numbers in the README would describe a different island.

## Verifying a combination

`data/layout.json` is the only irreplaceable file in `data/` — `village.json` and
`cache.json` rebuild themselves — so copy it before a first scan on a new combination.

```bash
node scan.mjs        # rebuild data/village.json
node serve.mjs       # look at it on localhost:4747
```

`scan.mjs` takes `--out`, `--layout-file` and `--cache-file`, so a combination can be
scanned into scratch files without touching the island you are running. `--all` ignores
the founding date and uses every session ever recorded.

Two things worth asserting rather than eyeballing, both computable from `data/layout.json`
and `data/village.json` alone: that the town square, its lots and every civic plot are
bit-identical to before, and that a second scan changes nothing but `generatedAt`.
