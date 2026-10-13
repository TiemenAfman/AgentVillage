"""Measure the bought Sea of Thieves sloop - the ruler for scripts/build-sloop.py (Plans/nieuwe-sloep.md, chip 1).

    node scripts/blender.mjs --background --python scripts/measure-sloop.py -- <path to .gltf> [refs/sloop]

The model is bought: it is never copied into the repository and never committed. It stays wherever it
was downloaded (the default is the keeper's Downloads folder) and this script only *reads* it; what it
writes - `measure.json` and `renders/` - goes under `refs/` (gitignored). The game's sloop is built from
the numbers in that JSON, never from these triangles.

What it does, in order:
  1. imports the glTF, bakes the node rotation into the vertices (Sketchfab parents the pieces under a
     turned `Sketchfab_model` node) and reads the four pieces as four BVHTrees for ray casts: 378k
     faces are too many to bisect by hand;
  2. finds the length axis and the bow from the hull alone - the lowest quarter of the model's height is
     hull and nothing else: its longest axis is the length, the bow is the end that narrows first AND the
     end the bowsprit sticks out of (a disagreement stops the script with a sentence) - and then trues
     the axis on the rail, since the bottom's point cloud is a quarter of a degree off;
  3. turns bow to +Z of the island (Blender -Y), scales to a hull of 9 at cap-rail height - the stem's
     top to the transom's top, bowsprit and stern gallery excluded - puts the keel (the lowest point) on
     0, centres x on the hull and z on the hull's middle, and writes the composite matrix;
  4. cuts stations every 0.25 (the stem and the transom too, and 0.125-stations where the plan curves
     fast) with level rays from either side: half-width per height in steps of 0.05, lone jumps over 0.3
     dropped (a shroud or the yard crossing the ray), plus a deck profile per station from rays down
     (cap rail, deck, the bulwark's inner edge) and the keel from a ray up;
  5. reads the decks and the cabin under the quarterdeck, mast, nest, yard, helm, stairs, bowsprit, gun
     ports, transom and rudder off those, lists what stands on the decks, and offers draught candidates -
     the keeper chooses `W` from the side render's ruler;
  6. renders side (ruler every 0.1 from the keel, station lines, draught candidates), top, body-plan
     (the stations stacked, seen from the bow), quarter, stern and deck: workbench, grey, cavity on,
     back-face culling OFF because the model is double-sided.

Frames: Blender's inside the script (x across, +x starboard, y along with the bow at -y, z up); the JSON
is in island coordinates, `island = (x, z_up, -y)`, exactly as every build-*.py's `xyz()` turns them.
Nothing here is exact to the model's last triangle - rays every 0.05 and 0.02 are the resolution - and
the readings past the sections (decks, stairs, ports...) are heuristics over this one model, checked by
eye on the renders; a different ship may need them read again.
"""
import bpy
import json
import math
import sys
from collections import deque
from pathlib import Path

import numpy as np
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parent.parent
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SOURCE = Path(args[0]) if args else Path.home() / 'Downloads/Sea_of_Thieves_-_Sloop/Sea_of_Thieves_-_Sloop.gltf'
OUT = Path(args[1]) if len(args) > 1 else ROOT / 'refs/sloop'
RENDERS = OUT / 'renders'

LENGTH = 9.0          # the hull stem to transom at cap-rail height, the keeper's choice (Plans/nieuwe-sloep.md)
STEP = 0.25           # a station every quarter cell, the stem and the transom besides
H_STEP = 0.05         # half-widths per this much height
X_STEP = 0.02         # the deck profile's rays across
JUMP = 0.3            # a lone half-width this far off both its neighbours is rigging, not hull
BEND = 0.15           # the rail's half-width changing this much between stations earns a 0.125-station
FAR = 12.0            # where a level ray starts, outside anything
GAP_STEPS = 8         # a run of level hits survives this many empty heights (the open cabin's window)
RAKE_STEP = 0.1       # how far the stem or the transom may move out per H_STEP of height (63 degrees of rake):
                      # the forefoot moves 0.065 a step, the bowsprit leaving the stem head at 29 degrees 0.14


def fail(msg):
    print(f'measure-sloop: {msg}', file=sys.stderr, flush=True)
    sys.exit(2)


def r3(v):
    """Everything in the JSON rounded to a millimetre of a cell, lists and dicts alike."""
    if isinstance(v, (float, np.floating)):
        return round(float(v) + 0.0, 3)
    if isinstance(v, (int, np.integer)) and not isinstance(v, bool):
        return int(v)
    if isinstance(v, dict):
        return {k: r3(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [r3(x) for x in v]
    return v


# ---- the source ------------------------------------------------------------------------------
if not SOURCE.is_file():
    fail(f'no model at {SOURCE}')
src = SOURCE.resolve()
if ROOT in src.parents and (ROOT / 'refs') not in src.parents:
    fail(f'{src} is inside the repository: the bought model is read where it was downloaded, never copied in')

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(SOURCE))
scene = bpy.context.scene
parts = [o for o in scene.objects if o.type == 'MESH']
if not parts:
    fail('the glTF holds no mesh')
node_matrices = []
for o in parts:
    node_matrices.append(o.matrix_world.copy())
    # The node's transform into the vertices (the galleon's build-pirateship.py did the same): the pieces hang under
    # a turned root, and every ray and every number below wants world coordinates.
    o.data.transform(o.matrix_world)
    o.data.update()
    o.parent = None
    o.matrix_world = Matrix()
for o in list(scene.objects):
    if o not in parts:
        bpy.data.objects.remove(o, do_unlink=True)
NODE = node_matrices[0]
if any(max(abs(x) for row in (m - NODE) for x in row) > 1e-6 for m in node_matrices[1:]):
    fail('the pieces carry different node transforms; the matrix in the JSON would be true for one of them only')


def coords():
    """Every vertex of every piece, one array (N, 3), in the pieces' current data."""
    out = []
    for o in parts:
        a = np.empty(len(o.data.vertices) * 3)
        o.data.vertices.foreach_get('co', a)
        out.append(a.reshape(-1, 3))
    return np.concatenate(out)


def transform_all(M):
    for o in parts:
        o.data.transform(M)
        o.data.update()


def build_trees():
    bpy.context.view_layer.update()
    deps = bpy.context.evaluated_depsgraph_get()
    return [BVHTree.FromObject(o, deps) for o in parts]


P = coords()
faces = sum(len(o.data.polygons) for o in parts)
print(f'source {SOURCE.name}: {len(parts)} pieces, {len(P)} vertices, {faces} faces', flush=True)

# ---- the hull's own axis and its bow -----------------------------------------------------------
zmin, zmax = P[:, 2].min(), P[:, 2].max()
hull = P[P[:, 2] < zmin + 0.25 * (zmax - zmin)]      # the lowest quarter: hull, nothing above the rail
xy = hull[:, :2] - hull[:, :2].mean(axis=0)
w, v = np.linalg.eigh(xy.T @ xy / len(xy))
axis = v[:, int(np.argmax(w))]                       # the long axis of the bottom of the hull
alpha = math.pi / 2 - math.atan2(axis[1], axis[0])    # turn it onto +y
M1 = Matrix.Rotation(alpha, 4, 'Z')
P = P @ np.array(M1.to_3x3()).T
hull = P[P[:, 2] < zmin + 0.25 * (zmax - zmin)]

# Up: glTF is y-up and Blender's importer turns it z-up, so after the node bake z is up. Checked on the
# shape rather than believed: the top sixth of the height has to be a mast, thin against the hull.
beam0 = hull[:, 0].max() - hull[:, 0].min()
top = P[P[:, 2] > zmax - (zmax - zmin) / 6]
if top[:, 0].max() - top[:, 0].min() > 0.5 * beam0 and top[:, 1].max() - top[:, 1].min() > 0.5 * beam0:
    print('measure-sloop: WARNING the top of the model is as wide as the hull - is z really up?', flush=True)

y0, y1 = hull[:, 1].min(), hull[:, 1].max()
bins = 40
half = np.full(bins, np.nan)
idx = np.clip(((hull[:, 1] - y0) / (y1 - y0) * bins).astype(int), 0, bins - 1)
for b in range(bins):
    sel = hull[idx == b]
    if len(sel):
        half[b] = (sel[:, 0].max() - sel[:, 0].min()) / 2
n_end = max(2, bins * 15 // 100)
low_w, high_w = np.nanmean(half[:n_end]), np.nanmean(half[-n_end:])
narrow_end = -1 if low_w < high_w else 1
excess_lo, excess_hi = y0 - P[:, 1].min(), P[:, 1].max() - y1
sprit_end = -1 if excess_lo > excess_hi else 1
print(f'bow by taper: {"-y" if narrow_end < 0 else "+y"} (widths {low_w:.0f} / {high_w:.0f}); '
      f'bow by bowsprit: {"-y" if sprit_end < 0 else "+y"} (sticks out {excess_lo:.0f} / {excess_hi:.0f})', flush=True)
if narrow_end != sprit_end:
    fail('the end that narrows is not the end the bowsprit leaves from: look at the model before trusting any of this')
if max(excess_lo, excess_hi) < 1.5 * min(excess_lo, excess_hi):
    print('measure-sloop: WARNING both ends stick out about as far; the bowsprit reading is weak', flush=True)
beta = 0.0 if narrow_end < 0 else math.pi     # bow to -y
M2 = Matrix.Rotation(beta, 4, 'Z')
P = P @ np.array(M2.to_3x3()).T
hull = P[P[:, 2] < zmin + 0.25 * (zmax - zmin)]
y0, y1 = hull[:, 1].min(), hull[:, 1].max()

# Provisional scale off the bottom's extent, so the ray steps below mean the same on any source.
k0 = LENGTH / (y1 - y0)
M0 = Matrix.Scale(k0, 4) @ Matrix.Translation(Vector((-(hull[:, 0].max() + hull[:, 0].min()) / 2, -(y0 + y1) / 2, -zmin))) @ M2 @ M1
transform_all(M0)
trees = build_trees()
beam0 = (hull[:, 0].max() - hull[:, 0].min()) * k0


def cast(origin, direction, dist=4 * FAR):
    """The nearest hit of a ray over every piece, or None."""
    best, best_d = None, None
    o, d = Vector(origin), Vector(direction)
    for t in trees:
        loc, _n, _i, dd = t.ray_cast(o, d, dist)
        if loc is not None and (best_d is None or dd < best_d):
            best, best_d = loc, dd
    return best


def side_hits(y, h):
    """Half-widths at (y, h): from starboard (+x) and from port, None where the ray meets nothing."""
    s = cast((FAR, y, h), (-1, 0, 0))
    p = cast((-FAR, y, h), (1, 0, 0))
    return (s.x if s else None, -p.x if p else None)


def along_hit(from_y, direction, x, h):
    hit = cast((x, from_y, h), (0, direction, 0))
    return hit.y if hit else None


def down_hit(x, y, above, dist=None):
    hit = cast((x, y, above), (0, 0, -1), dist if dist is not None else above + 1.0)
    return hit.z if hit else None


def hull_top(y, step=H_STEP, lowest=0.0, top=None):
    """The top of the hull at station y: the highest height of the run of level hits that starts at the
    keel. Going up, a hull only ever widens by a lot (the keel's foot onto the flat of the bottom is one
    step of 0.4), so a jump *outward* is hull; a jump inward of over JUMP is the mast - at its station
    the rays above the rail meet it, a hand off the centreline - and ends the run, unless the next height
    is back on the hull, in which case it was the yard or a shroud crossing the ray and is skipped. A
    gap of GAP_STEPS ends the run too - wide enough to cross the openings in the sides of the open stern
    cabin (0.2 of hull under the quarterdeck's rail), so that the quarterdeck's rail is the top there."""
    top = top if top is not None else 8.0
    seen = {1: None, 2: None}

    def fits(s, p):
        for col, w in ((1, s), (2, p)):
            if w is not None and (seen[col] is None or w >= seen[col] - JUMP):
                return True
        return False

    h, last, gap = lowest, None, 0
    while h < top:
        s, p = side_hits(y, h)
        if fits(s, p):
            for col, w in ((1, s), (2, p)):
                if w is not None and (seen[col] is None or w >= seen[col] - JUMP):
                    seen[col] = w
            gap, last = 0, h
        elif s is None and p is None:
            gap += 1
            if last is not None and gap > GAP_STEPS:
                break
        else:
            s2, p2 = side_hits(y, h + step)
            if not fits(s2, p2):
                break
        h += step
    return last


# ---- the centreline, from the rail itself ------------------------------------------------------------
# The bottom's point cloud gives the axis to within half a degree, and half a degree is 0.04 at the ends:
# the keel read 0.26 to one side and 0.13 to the other. So the axis is corrected on the rail: the middle
# between the two sides, a little under the top of the hull, at a row of stations, fitted to a line.
mids = []
for y in np.arange(-3.5, 3.51, 0.5):
    t = hull_top(y)
    if t is None:
        continue
    for d in (0.1, 0.2, 0.3):
        s, p = side_hits(y, t - d)
        if s is not None and p is not None:
            mids.append((y, (s - p) / 2))
if len(mids) < 6:
    fail('too few stations to find the centreline')
b_fit, a_fit = np.polyfit([m[0] for m in mids], [m[1] for m in mids], 1)
M_axis = Matrix.Translation(Vector((-a_fit, 0, 0))) @ Matrix.Rotation(-math.atan(b_fit), 4, 'Z')
print(f'centreline: {a_fit:+.4f} off, {math.degrees(math.atan(b_fit)):+.3f} degrees skew; corrected', flush=True)
transform_all(M_axis)
trees = build_trees()
M0 = M_axis @ M0
P = coords()

# ---- the hull's length: the stem's top to the transom's top ------------------------------------------
# Level rays along the axis, two columns either side of the centreline (the stem is raked and pointed, so
# the columns are extrapolated to the centreline; dead on it a ray meets the bowsprit, the rudder or an
# ornament), from the keel up: the run of hits that climbs the stem - or the transom - ends where the
# hull does, and that height is the rail. Above it is bowsprit, or the stern gallery hung out over the
# transom, and neither is hull. The columns are near the centreline on purpose: the transom has a window
# or a door in it and the quarterdeck's cabin opens to the sides, and a ray through either runs on to a
# bulkhead a third of the ship forward - a jump the run refuses, looking one step further up first.


def end_run(direction, cols, lowest):
    """`direction` +1 looks aft from ahead (the stem), -1 forward from astern (the transom). Returns the
    end's y extrapolated to the centreline at the top of the run, that height, and the run itself. The
    run starts at `lowest`, above the keel and the turn of the bilge, where the lowest rays meet the keel
    and the next ones the bottom half a ship further out; it ends where the end moves more than RAKE_STEP
    between two heights - the bowsprit over the stem head, the gallery hung out over the transom - or
    where nothing is met any more."""
    run, last = [], None
    h = lowest
    while h < 8.0:
        # Of the two sides of a column the hit nearer the ship's middle is the hull's: the bowsprit lies
        # a hand to starboard of the centreline and the starboard column met it before the stem.
        nearer = max if direction > 0 else min

        def column(col, hh):
            ys = [along_hit(-direction * FAR, direction, s * col, hh) for s in (1, -1)]
            ys = [y for y in ys if y is not None]
            return nearer(ys) if ys else None

        per_col = [column(col, h) for col in cols]
        ok = per_col[0] is not None and (last is None or abs(per_col[0] - last) < RAKE_STEP)
        if ok:
            run.append((h, per_col))
            last = per_col[0]
        elif run:
            nxt = column(cols[0], h + H_STEP)
            if nxt is None or abs(nxt - last) >= RAKE_STEP:
                break
        h += H_STEP
    if not run:
        return None, None, run
    # Extrapolated from the topmost height where the outer column still reads the same end (within 0.5
    # of the inner one): at the very top it may already look over the rail onto the deck.
    for h_top, (a, b) in reversed(run):
        if b is not None and abs(b - a) < 0.5:
            return a - (b - a) * cols[0] / (cols[1] - cols[0]), h_top, run
    h_top, (a, _b) = run[-1]
    return a, h_top, run


STEM_COLS, STERN_COLS = (0.05, 0.09), (0.06, 0.12)
cap_mid = hull_top(0.0)
if cap_mid is None:
    fail('no hull at midships')
stem_y, stem_h, stem_run = end_run(1, tuple(c * beam0 for c in STEM_COLS), 0.3 * cap_mid)
stern_y, stern_h, stern_run = end_run(-1, tuple(c * beam0 for c in STERN_COLS), 0.3 * cap_mid)
if stem_y is None or stern_y is None:
    fail('could not follow the stem or the transom up to the rail')
L_cap = stern_y - stem_y
print(f'provisional: stem {stem_y:.3f} (rail at {stem_h:.2f}), transom {stern_y:.3f} (top at {stern_h:.2f}), hull {L_cap:.3f} long', flush=True)

# ---- the final frame ----------------------------------------------------------------------------
k1 = LENGTH / L_cap
keel_z = P[:, 2].min()
M3 = Matrix.Scale(k1, 4) @ Matrix.Translation(Vector((0, -(stem_y + stern_y) / 2, -keel_z)))
MATRIX = M3 @ M0
transform_all(M3)
trees = build_trees()
P = coords()
half_len = LENGTH / 2
stem_y, stern_y = -half_len, half_len
beam0 *= k1
TOTAL = MATRIX @ NODE   # from the glTF's own vertex coordinates (as Blender imports them, y-up turned z-up)
print(f'scale {k0 * k1:.6f} per source unit; keel {P[:, 2].min():.4f}, bow at y {P[:, 1].min():.3f}, stern {P[:, 1].max():.3f}', flush=True)


# ---- stations ---------------------------------------------------------------------------------
def station_list():
    z = -half_len + 0.01
    out = [z]
    k = -half_len + STEP
    while k < half_len - 1e-6:
        out.append(round(k, 3))
        k += STEP
    out.append(half_len - 0.01)
    return out


def section(z):
    """Half-widths per height at island z (Blender y = -z), up to just over the hull's top there."""
    y = -z
    top = hull_top(y)
    rows = []
    h = 0.0
    while top is not None and h <= top + 0.06:
        s, p = side_hits(y, h)
        if s is not None or p is not None:
            rows.append([h, s, p])
        h += H_STEP
    # Lone jumps over JUMP on either side are rigging crossing the ray, not the hull.
    for col in (1, 2):
        vals = [r[col] for r in rows]
        for i in range(1, len(rows) - 1):
            a, b, c = vals[i - 1], vals[i], vals[i + 1]
            if b is not None and a is not None and c is not None and abs(b - a) > JUMP and abs(b - c) > JUMP:
                rows[i][col] = None
    return rows, top


def deck_profile(z, rows, top):
    """Rays down from just over the hull's top at station z: the cap rail (the highest hit within 0.1 of
    the outer edge), the deck (the median of the flat inner run) and the edge (where the hits fall from
    the one to the other, the bulwark's inside), both sides, and the keel from a ray up."""
    y = -z
    outer = max([abs(r[c]) for r in rows for c in (1, 2) if r[c] is not None and r[0] >= top - 0.35] or [0.3])
    xs = np.arange(-outer - 0.04, outer + 0.04 + 1e-9, X_STEP)
    hits = [down_hit(x, y, top + 0.15, top + 0.5) for x in xs]
    keel = cast((0, y, -1.0), (0, 0, 1), 10)
    out = {'keel': keel.z if keel else None, 'top': top}
    got = [(x, h) for x, h in zip(xs, hits) if h is not None]
    if not got:
        return out
    xs_hit = [x for x, _h in got]
    out['outer_s'], out['outer_p'] = max(xs_hit), -min(xs_hit)
    inner = [h for x, h in got if abs(x) < 0.5 * max(out['outer_s'], out['outer_p'])]
    # The deck is the height most of the inner hits share, to 0.02: not the lowest (a hatch or the
    # companionway) and not the median (a stair across the whole width).
    counts, edges = np.histogram(inner, bins=np.arange(min(inner) - 0.01, max(inner) + 0.03, 0.02))
    k = int(np.argmax(counts))
    deck = float(np.median([h for h in inner if edges[k] <= h < edges[k + 1]]))
    for side, sign in (('s', 1), ('p', -1)):
        edge_pts = [(x, h) for x, h in got if sign * x > 0]
        if not edge_pts:
            continue
        far = max(sign * x for x, _h in edge_pts)
        cap = max(h for x, h in edge_pts if sign * x > far - 0.1)
        out[f'cap_{side}'] = cap
        mid = deck + 0.5 * (cap - deck)
        edge = None
        for x, h in sorted(edge_pts, key=lambda p: -sign * p[0]):
            if h < mid:
                edge = sign * x + X_STEP / 2
                break
        out[f'edge_{side}'] = edge
    caps = [out[k] for k in ('cap_s', 'cap_p') if k in out]
    edges = [out[k] for k in ('edge_s', 'edge_p') if out.get(k) is not None]
    out['cap'] = max(caps) if caps else None
    out['deck'] = deck
    out['edge'] = float(np.mean(edges)) if edges else None
    return out


stations = station_list()
SECTIONS, PROFILE = {}, {}


def measure_station(z):
    rows, top = section(z)
    SECTIONS[z] = rows
    PROFILE[z] = deck_profile(z, rows, top) if top is not None else {'keel': None, 'top': None}


for z in stations:
    measure_station(z)
# Where the rail's half-width changes fast between two quarter-stations, a station in between.
extra = []
for a, b in zip(stations, stations[1:]):
    wa = PROFILE[a].get('outer_s') or 0
    wb = PROFILE[b].get('outer_s') or 0
    if abs(wa - wb) > BEND and b - a > 0.2:
        extra.append(round((a + b) / 2, 3))
for z in extra:
    measure_station(z)
stations = sorted(SECTIONS)
print(f'{len(stations)} stations ({len(extra)} at the bends)', flush=True)
H_MAX = max(p['top'] for p in PROFILE.values() if p.get('top') is not None)


def near_station(z):
    return min(stations, key=lambda s: abs(s - z))


def local_top(z):
    return PROFILE[near_station(z)].get('top') or H_MAX


# ---- the whole: length, beam, depth ----------------------------------------------------------------
widths = [(r[1] or 0) + (r[2] or 0) for z in stations for r in SECTIONS[z]
          if r[1] is not None and r[2] is not None and r[0] <= (PROFILE[z].get('cap') or 9)]
BEAM = max(widths)
BEAM_RAIL = max(2 * max(p.get('outer_s', 0), p.get('outer_p', 0)) for p in PROFILE.values())
mid_station = near_station(0.0)
DEPTH = PROFILE[mid_station]['cap']
HEIGHT = float(P[:, 2].max())
KEEL_MID = PROFILE[mid_station]['keel']

# ---- draught candidates ----------------------------------------------------------------------------
mid_rows = [r for r in SECTIONS[mid_station] if r[1] is not None and r[2] is not None]
wmax = max(r[1] + r[2] for r in mid_rows)
w90 = next((r[0] for r in mid_rows if r[1] + r[2] >= 0.9 * wmax), None)
DRAUGHT = {'width90': w90, 'h30': 0.3 * DEPTH, 'h35': 0.35 * DEPTH, 'h40': 0.4 * DEPTH}


# ---- decks ----------------------------------------------------------------------------------------
def sweep_deck(x_list, z0, z1, dz=0.02):
    """The top surface along z, the median over a few x columns, from just over the local hull top."""
    out = []
    z = z0
    while z <= z1 + 1e-9:
        top = local_top(z)
        hs = [h for h in (down_hit(x, -z, top + 0.15, top + 0.5) for x in x_list) if h is not None]
        out.append((z, float(np.median(hs)) if hs else None))
        z += dz
    return out


SWEEP = sweep_deck((-0.45, -0.2, 0.0, 0.2, 0.45), -half_len + 0.02, half_len - 0.02)


def plateaus(sweep, tol=0.04, min_len=0.4):
    runs, cur = [], []
    for z, h in sweep:
        if h is None:
            if cur:
                runs.append(cur)
            cur = []
            continue
        if cur and abs(h - cur[-1][1]) > tol:
            runs.append(cur)
            cur = []
        cur.append((z, h))
    if cur:
        runs.append(cur)
    return [{'z0': r[0][0], 'z1': r[-1][0], 'y': float(np.median([h for _z, h in r]))}
            for r in runs if r[-1][0] - r[0][0] >= min_len]


PLATEAUS = plateaus(SWEEP)
# One deck runs on past what stands on it (a wheel, a capstan, a hatch): plateaus at one height with
# less than 0.6 between them are one.
merged_plateaus = []
for pl in PLATEAUS:
    last = merged_plateaus[-1] if merged_plateaus else None
    if last and abs(pl['y'] - last['y']) < 0.03 and pl['z0'] - last['z1'] < 0.6:
        last['z1'] = pl['z1']
    else:
        merged_plateaus.append(dict(pl))
PLATEAUS = merged_plateaus
if not PLATEAUS:
    fail('no deck found from above')
main = max(PLATEAUS, key=lambda p: p['z1'] - p['z0'])
DECKS = [{'name': 'main', **main}]
MAIN_Y = main['y']
aft = [p for p in PLATEAUS if p['z1'] <= main['z0'] + 0.05 and p['y'] > MAIN_Y + 0.2]
fore = [p for p in PLATEAUS if p['z0'] >= main['z1'] - 0.05 and p['y'] > MAIN_Y + 0.1]
CABIN = None
if aft:
    q = max(aft, key=lambda p: p['z1'] - p['z0'])
    # The break: the quarterdeck's forward edge, the first sample from the main deck going aft that is
    # at the quarterdeck's height.
    brk = next((z for z, h in reversed(SWEEP) if z <= q['z1'] + 0.05 and h is not None and h >= q['y'] - 0.05), q['z1'])
    DECKS.append({'name': 'quarter', **q, 'break': brk, 'rise': q['y'] - MAIN_Y})
    # Under it: rays down from well under the quarterdeck's planking (0.3: an origin inside the planks
    # met their own underside) find the cabin's floor - sunken or the main deck - and rays up from that
    # floor its ceiling; level rays from the centreline its walls.
    floors, ceils, halves = [], [], []
    for z in np.arange(brk - 0.05, q['z0'] - 0.05, -0.05):
        f = down_hit(0.0, -z, q['y'] - 0.3, 3.0)
        if f is None or f > q['y'] - 0.4:
            continue
        up = cast((0.0, -z, f + 0.03), (0, 0, 1), 3.0)
        if up is None or up.z < f + 0.3:
            continue
        floors.append((float(z), f))
        ceils.append(up.z)
        mid_h = (f + up.z) / 2
        ins = cast((0.0, -z, mid_h), (1, 0, 0), 5)
        inp = cast((0.0, -z, mid_h), (-1, 0, 0), 5)
        if ins is not None and inp is not None:
            halves.append((ins.x - inp.x) / 2)
    if floors:
        fl = float(np.median([f for _z, f in floors]))
        ce = float(np.median(ceils))
        CABIN = {'z0': min(z for z, _f in floors), 'z1': max(z for z, _f in floors), 'floor': fl,
                 'ceiling': ce, 'clear': ce - fl, 'clear_over_main': ce - MAIN_Y, 'sunk': MAIN_Y - fl,
                 'half_width': float(np.median(halves)) if halves else None}
    # Aft of the quarterdeck the stern may open into a well lower than it (this sloop's: the sunken
    # cabin's floor runs on to the transom under an awning frame), with the transom's top for a rail.
    well = [p for p in PLATEAUS if p['z1'] <= q['z0'] + 0.05 and p['y'] < q['y'] - 0.3]
    if well:
        wl = max(well, key=lambda p: p['z1'] - p['z0'])
        DECKS.append({'name': 'stern_well', **wl, 'rise': wl['y'] - MAIN_Y})
if fore:
    f = min(fore, key=lambda p: p['z0'])
    between = [(z, h) for z, h in SWEEP if main['z1'] < z < f['z0'] and h is not None]
    steps = [abs(b[1] - a[1]) for a, b in zip(between, between[1:])]
    ramp = bool(between) and (f['y'] - MAIN_Y > 0.1) and (max(steps or [0]) < 0.08)
    DECKS.append({'name': 'fore', **f, 'rise': f['y'] - MAIN_Y, 'ramp': ramp,
                  'ramp_from': main['z1'] if ramp else None, 'ramp_to': f['z0'] if ramp else None})
qd = next((d for d in DECKS if d['name'] == 'quarter'), None)
fd = next((d for d in DECKS if d['name'] == 'fore'), None)


# ---- mast, nest, yard --------------------------------------------------------------------------------
def cluster(pts, start, keep):
    c = np.array(start, dtype=float)
    for _ in range(3):
        d = np.linalg.norm(pts[:, :2] - c, axis=1)
        sel = pts[d < keep]
        if not len(sel):
            return None, None
        c = sel[:, :2].mean(axis=0)
    d = np.linalg.norm(pts[:, :2] - c, axis=1)
    return c, pts[d < keep]


# The mast is the one column that runs the whole height: of the vertices between a body's height over
# the main deck and the top, the 0.1-square of x, y with the greatest spread in z is on it (a flag at
# the truck streams off to one side, so the top alone would not do). The model's spars are long
# cylinders with vertices only at their ends - nothing at all between 4.1 and 10.1 on the mast - so
# its centre and radius are read with level rays at a body's height over the main deck, from inside
# the bulwark towards it, where nothing but shrouds comes near it.
tall = P[(P[:, 2] > MAIN_Y + 1.5) & (P[:, 2] < HEIGHT - 0.3)]
cols_xy = {}
for x_, y_, z_ in tall[::4]:
    key = (int(round(x_ * 10)), int(round(y_ * 10)))
    lo_, hi_ = cols_xy.get(key, (z_, z_))
    cols_xy[key] = (min(lo_, z_), max(hi_, z_))
best_key = max(cols_xy, key=lambda k: cols_xy[k][1] - cols_xy[k][0])
mast_c = np.array([best_key[0] / 10, best_key[1] / 10])


def round_about(c, h):
    """The spar through (c, h): its centre and radius, from level rays. First from far out along x on the
    line y = c[1] (the column's guess is good to a hand in y, and nothing else stands at that height
    along that line), then from inside the spar along y, then once more from inside in all four
    directions - from inside a closed cylinder a ray meets its own wall at exactly the radius."""
    s_ = cast((FAR, c[1], h), (-1, 0, 0))
    p_ = cast((-FAR, c[1], h), (1, 0, 0))
    if s_ is None or p_ is None or s_.x - p_.x > 1.0:
        return None, None
    cx = (s_.x + p_.x) / 2
    a_ = cast((cx, c[1], h), (0, 1, 0), 1.0)
    f_ = cast((cx, c[1], h), (0, -1, 0), 1.0)
    if a_ is None or f_ is None:
        return None, None
    cy = (a_.y + f_.y) / 2
    hits = [cast((cx, cy, h), d, 1.0) for d in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0))]
    if any(hit is None for hit in hits):
        return None, None
    centre = np.array([(hits[0].x + hits[1].x) / 2, (hits[2].y + hits[3].y) / 2])
    radius = ((hits[0].x - hits[1].x) + (hits[2].y - hits[3].y)) / 4
    return centre, radius


MAST = NEST = YARD = None
c_new, r = round_about(mast_c, MAIN_Y + 1.0)
if c_new is not None:
    mast_c = c_new
    rad = np.linalg.norm(P[:, :2] - mast_c, axis=1)
    column = P[rad < 2 * r + 0.05]
    truck = float(column[:, 2].max())
    foot = down_hit(mast_c[0] + r + 0.06, mast_c[1], MAIN_Y + 0.8, 3)
    high_c, r_high = round_about(mast_c, truck - 1.2)
    MAST = {'x': float(mast_c[0]), 'z': float(-mast_c[1]), 'r': r, 'truck': truck, 'height': HEIGHT, 'deck': foot,
            'r_near_truck': r_high,
            'lean': [float(high_c[0] - mast_c[0]), float(-(high_c[1] - mast_c[1]))] if high_c is not None else None}
    # The nest: rays down beside the mast from near the truck meet its floor (or its parapet, or the
    # ladder - the median of twelve bearings is the floor); level rays towards the mast at a hand over
    # that floor meet the parapet's outside; rays down just inside that meet its rim.
    floors = []
    for ang in range(0, 360, 30):
        px = mast_c[0] + (r + 0.25) * math.cos(math.radians(ang))
        py = mast_c[1] + (r + 0.25) * math.sin(math.radians(ang))
        f = down_hit(px, py, truck - 0.2, truck - MAIN_Y - 1.5)
        if f is not None:
            floors.append(f)
    if floors:
        floor = float(np.median(floors))
        # The basket itself has vertices enough (unlike the spars): everything round the mast within
        # 1.2 of it, from a little under that floor to a body's height over it, is the nest - its outer
        # radius the 95th percentile of their reach, its rim their top, its underside their bottom.
        basket = P[(rad > r + 0.05) & (rad < 1.2) & (P[:, 2] > floor - 0.4) & (P[:, 2] < floor + 0.8)]
        if len(basket) > 20:
            reach = np.linalg.norm(basket[:, :2] - mast_c, axis=1)
            r_out = float(np.percentile(reach, 95))
            NEST = {'floor': floor, 'r': r_out, 'rim': float(basket[:, 2].max()), 'bottom': float(basket[:, 2].min()),
                    'floor_hits': sorted(floors)}
    # The yard: the band of height with the widest reach across x near the mast's station.
    near_mast = P[np.abs(P[:, 1] - mast_c[1]) < 0.6]
    prof = []
    for z in np.arange(H_MAX + 0.1, truck, 0.05):
        sel = near_mast[(near_mast[:, 2] >= z) & (near_mast[:, 2] < z + 0.05)]
        if len(sel):
            prof.append((float(z), float(np.abs(sel[:, 0] - mast_c[0]).max()), int(len(sel))))
    if prof and NEST and NEST['rim'] is not None:
        prof = [p for p in prof if p[0] < NEST['floor'] - 0.1 or p[0] > NEST['rim'] + 0.1]
    if prof:
        yz, yhalf, _n = max(prof, key=lambda p: p[1])
        ysel = near_mast[(near_mast[:, 2] >= yz) & (near_mast[:, 2] < yz + 0.05) & (np.abs(near_mast[:, 0] - mast_c[0]) > 0.5)]
        sail = [z for z, hw, n in prof if z < yz and hw > 0.5 * yhalf and n > 50]
        YARD = {'half': yhalf, 'y': yz + 0.025, 'z': float(-np.median(ysel[:, 1])) if len(ysel) else float(-mast_c[1]),
                'sail_foot': min(sail) if sail else None, 'profile': prof}

# ---- helm ---------------------------------------------------------------------------------------------
# The wheel stands on the quarterdeck, thin fore-and-aft: of everything a body's height over that deck
# it is the slab of y with the most vertices (the awning hoops over it are spread along the deck).
HELM = None
if qd:
    sel = P[(P[:, 2] > qd['y'] + 0.2) & (P[:, 2] < qd['y'] + 1.2) & (P[:, 1] > -qd['z1']) & (P[:, 1] < -qd['z0']) & (np.abs(P[:, 0]) < 1.0)]
    if MAST:
        sel = sel[np.linalg.norm(sel[:, :2] - mast_c, axis=1) > 0.6]
    if len(sel) > 50:
        counts, edges = np.histogram(sel[:, 1], bins=np.arange(-qd['z1'], -qd['z0'] + 0.05, 0.05))
        k = int(np.argmax(counts))
        slab = sel[(sel[:, 1] >= edges[k] - 0.1) & (sel[:, 1] < edges[k + 1] + 0.1)]
        c = slab[:, :2].mean(axis=0)
        base = down_hit(c[0], c[1], qd['y'] + 1.5, 3)
        HELM = {'x': float(c[0]), 'z': float(-c[1]), 'top': float(slab[:, 2].max()), 'bottom': float(slab[:, 2].min()),
                'plinth': base, 'deck': qd['y'],
                'thick': float(slab[:, 1].max() - slab[:, 1].min()), 'wide': float(slab[:, 0].max() - slab[:, 0].min())}


# ---- stairs -------------------------------------------------------------------------------------------
def find_stairs(lower, upper, z_from, z_to):
    """Columns of rays down whose top surface climbs (or falls) between `lower` and `upper` in two or
    more treads of 0.05 to 0.2, three columns wide at least."""
    cols = {}
    xs = np.arange(-BEAM_RAIL / 2, BEAM_RAIL / 2 + 1e-9, 0.05)
    for x in xs:
        levels, zs = [], []
        z = z_from
        while z <= z_to:
            top = local_top(z)
            h = down_hit(x, -z, top + 0.15, top + 0.5)
            if h is not None and lower + 0.04 < h < upper - 0.04 and abs(h - MAIN_Y) > 0.04:
                if not levels or abs(h - levels[-1]) > 0.02:
                    levels.append(h)
                zs.append(z)
            z += 0.03
        rises = [b - a for a, b in zip(levels, levels[1:])]
        if len(levels) >= 2 and (all(r > 0 for r in rises) or all(r < 0 for r in rises)) and 0.05 <= np.median(np.abs(rises)) <= 0.2:
            cols[round(float(x), 3)] = (levels, min(zs), max(zs))
    groups, cur = [], []
    for x in sorted(cols):
        if cur and x - cur[-1] > 0.101:
            groups.append(cur)
            cur = []
        cur.append(x)
    if cur:
        groups.append(cur)
    res = []
    for group in groups:
        if len(group) < 3:
            continue
        counts = [len(cols[x][0]) for x in group]
        levels = cols[group[len(group) // 2]][0]
        res.append({'x0': group[0] - 0.025, 'x1': group[-1] + 0.025, 'width': group[-1] - group[0] + 0.05,
                    'z0': min(cols[x][1] for x in group), 'z1': max(cols[x][2] for x in group),
                    'treads': int(np.median(counts)), 'levels': levels,
                    'aft_goes': 'up' if levels[0] > levels[-1] else 'down',   # levels run aft to fore
                    'rise': float(np.median(np.abs(np.diff(levels))))})
    return res


STAIRS = []
if qd:
    low = CABIN['floor'] if CABIN else MAIN_Y
    STAIRS += find_stairs(low, qd['y'], qd['break'] - 0.1, qd['break'] + 1.8)
if fd and not fd['ramp']:
    STAIRS += find_stairs(MAIN_Y, fd['y'], fd['z0'] - 1.6, fd['z0'] + 0.1)

# ---- bowsprit -----------------------------------------------------------------------------------------
BOWSPRIT = None
ahead = P[P[:, 1] < stem_y - 0.05]
if len(ahead):
    zi = -ahead[:, 1]
    tip = float(zi.max())
    tip_pts = ahead[zi > tip - 0.1]
    root_pts = ahead[zi < -stem_y + 0.15]
    h_tip = float(np.median(tip_pts[:, 2]))
    h_root = float(np.median(root_pts[:, 2])) if len(root_pts) else None
    BOWSPRIT = {'z_max': tip, 'y_tip': h_tip, 'y_root': h_root, 'z_root': -stem_y,
                'angle_deg': math.degrees(math.atan2(h_tip - h_root, tip + stem_y)) if h_root is not None else None,
                'x': float(np.median(ahead[:, 0])), 'y_max': float(ahead[:, 2].max()),
                'thick': float(tip_pts[:, 0].max() - tip_pts[:, 0].min())}

# ---- gun ports: notches in the waist's rail, read two ways ---------------------------------------------
# Along the main deck only (the quarterdeck has an open railing, which a level ray passes between every
# baluster), every 0.02: the rail's top just inside the outer edge dips, or a level ray at deck + 0.15
# goes in past the bulwark. Runs closer than 0.25 are one port with a gun's carriage across it.
PORTS = []
RAIL = {side: float(np.median([PROFILE[z][f'cap_{side}'] for z in stations
                               if main['z0'] <= z <= main['z1'] and PROFILE[z].get(f'cap_{side}') is not None]))
        for side in ('s', 'p')}
for side, sign in (('s', 1), ('p', -1)):
    runs, cur = [], None
    z = main['z0'] + 0.05
    while z < main['z1'] - 0.05:
        prof = PROFILE[near_station(z)]
        deck = prof.get('deck') or MAIN_Y
        top = prof.get('top') or DEPTH
        # The hull's side just over the deck, under any gun run out through the port.
        s_, p_ = side_hits(-z, deck + 0.05)
        outer = s_ if sign > 0 else p_
        notch, sill = False, None
        if outer:
            sills = [down_hit(sign * (outer - d), -z, top + 0.15, top + 0.5) for d in (0.03, 0.06, 0.09)]
            sills = [v for v in sills if v is not None]
            sill = min(sills) if sills else None
            if sill is not None and sill < RAIL[side] - 0.08:
                notch = True
            s2, p2 = side_hits(-z, deck + 0.15)
            w = s2 if sign > 0 else p2
            if w is not None and w < outer - 0.1:
                notch = True
        if notch:
            if cur is None:
                cur = {'side': side, 'z0': z, 'z1': z, 'sills': [sill] if sill is not None else []}
            else:
                cur['z1'] = z
                if sill is not None:
                    cur['sills'].append(sill)
        elif cur is not None:
            runs.append(cur)
            cur = None
        z += 0.02
    if cur:
        runs.append(cur)
    merged = []
    for r in runs:
        if merged and r['z0'] - merged[-1]['z1'] < 0.25:
            merged[-1]['z1'] = r['z1']
            merged[-1]['sills'] += r['sills']
        else:
            merged.append(r)
    for r in merged:
        if r['z1'] - r['z0'] >= 0.1:
            PORTS.append({'side': r['side'], 'z0': r['z0'], 'z1': r['z1'], 'z': (r['z0'] + r['z1']) / 2,
                          'width': r['z1'] - r['z0'] + 0.02, 'sill': float(np.median(r['sills'])) if r['sills'] else None,
                          'rail': RAIL[r['side']]})

# ---- transom, stem and rudder ----------------------------------------------------------------------------
# The transom's face per height is the stern run, read again in the final frame; its half-width is read a
# hand forward of that face; its rake is a line through the upper part of the run. The rudder is whatever
# stands further aft than the face on the centreline.
_, _, stern_fin = end_run(-1, tuple(c * beam0 for c in STERN_COLS), 0.3 * DEPTH)
_, _, stem_fin = end_run(1, tuple(c * beam0 for c in STEM_COLS), 0.3 * DEPTH)
T_FACE = [[h, -per_col[0]] for h, per_col in stern_fin]
STEM_RUN = [[h, -per_col[0]] for h, per_col in stem_fin]
TRANSOM, RUDDER = [], []
for h, per_col in stern_fin:
    face = per_col[0]
    centre = along_hit(FAR, -1, 0.0, h)
    if centre is not None and centre > face + 0.05:
        RUDDER.append([h, -centre])
    s, p = side_hits(face - 0.05, h)
    if s is not None and p is not None:
        TRANSOM.append([h, (s + p) / 2])
TRANSOM_SLOPE = None
if len(T_FACE) > 3:
    upper = [(hh, z) for hh, z in T_FACE if hh > T_FACE[-1][0] - 0.6 * (T_FACE[-1][0] - T_FACE[0][0])]
    if len(upper) > 2:
        a = np.polyfit([hh for hh, _z in upper], [z for _hh, z in upper], 1)
        TRANSOM_SLOPE = {'dz_per_h': float(a[0]), 'deg_from_vertical': math.degrees(math.atan(-a[0])), 'top': T_FACE[-1][0]}

# ---- what stands on the decks ----------------------------------------------------------------------------
# A grid of rays down over the hull, 0.05 apart; everything higher than the deck under it by 0.08 is a
# thing, and things that touch are one. Mast, guns, wheel, hatch, capstan, stairs, rails: the inventory
# the builder places by, with where and how big.
GX, GZ = np.arange(-BEAM_RAIL / 2, BEAM_RAIL / 2 + 1e-9, 0.05), np.arange(-half_len, half_len + 1e-9, 0.05)
deck_at = [PROFILE[near_station(z)].get('deck') for z in GZ]
grid = np.full((len(GZ), len(GX)), np.nan)
for i, z in enumerate(GZ):
    prof = PROFILE[near_station(z)]
    top = local_top(z)
    # Inside the bulwarks only (the inner edge where there is one, else a hand in from the side).
    lim_s = (prof.get('edge_s') or (prof.get('outer_s') or 0) - 0.05) - 0.03
    lim_p = (prof.get('edge_p') or (prof.get('outer_p') or 0) - 0.05) - 0.03
    for j, x in enumerate(GX):
        if x > lim_s or x < -lim_p:
            continue
        h = down_hit(x, -z, top + 0.15, top + 0.5)
        if h is not None:
            grid[i, j] = h
FIXTURES = []
seen = np.zeros(grid.shape, dtype=bool)
for i in range(len(GZ)):
    for j in range(len(GX)):
        d = deck_at[i]
        if seen[i, j] or np.isnan(grid[i, j]) or d is None or grid[i, j] < d + 0.08:
            continue
        cells, dq = [], deque([(i, j)])
        seen[i, j] = True
        while dq:
            a, b = dq.popleft()
            cells.append((a, b))
            for da, db in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                na, nb = a + da, b + db
                if 0 <= na < len(GZ) and 0 <= nb < len(GX) and not seen[na, nb] and not np.isnan(grid[na, nb]):
                    dd = deck_at[na]
                    if dd is not None and grid[na, nb] >= dd + 0.08:
                        seen[na, nb] = True
                        dq.append((na, nb))
        if len(cells) < 4:
            continue
        zs_, xs_ = [GZ[a] for a, _b in cells], [GX[b] for _a, b in cells]
        hs = [grid[a, b] for a, b in cells]
        FIXTURES.append({'x': float(np.mean(xs_)), 'z': float(np.mean(zs_)), 'x0': float(min(xs_)), 'x1': float(max(xs_)),
                         'z0': float(min(zs_)), 'z1': float(max(zs_)), 'top': float(max(hs)), 'cells': len(cells)})
FIXTURES.sort(key=lambda f: -f['cells'])

# ---- the JSON -----------------------------------------------------------------------------------------
MEASURE = {
    'source': str(SOURCE),
    'units': 'island units: 1 = one ground cell; frame x across (+x starboard), y up, z along with the bow at +z',
    'matrix': [list(row) for row in TOTAL],
    'matrix_note': 'blender = matrix @ gltf_vertex, Blender axes after import (z up); island = (x, z, -y)',
    'length': LENGTH, 'beam': BEAM, 'beam_rail': BEAM_RAIL, 'depth': DEPTH, 'hull_top_max': H_MAX, 'height': HEIGHT,
    'keel_midships': KEEL_MID, 'stem_z': -stem_y, 'transom_z': -stern_y,
    'draught_candidates': DRAUGHT,
    'sections': {f'{z:.3f}': SECTIONS[z] for z in stations},
    'deck_profile': {f'{z:.3f}': {k: PROFILE[z].get(k) for k in ('cap', 'deck', 'edge', 'keel', 'cap_s', 'cap_p', 'edge_s', 'edge_p', 'outer_s', 'outer_p', 'top')} for z in stations},
    'deck_sweep': [[z, h] for z, h in SWEEP],
    'decks': DECKS, 'plateaus': PLATEAUS, 'cabin': CABIN, 'mast': MAST, 'nest': NEST, 'yard': YARD, 'helm': HELM, 'stairs': STAIRS,
    'bowsprit': BOWSPRIT, 'ports': PORTS, 'transom': TRANSOM, 'transom_face': T_FACE, 'stem_face': STEM_RUN,
    'transom_slope': TRANSOM_SLOPE, 'rudder': RUDDER, 'fixtures': FIXTURES,
}
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'measure.json').write_text(json.dumps(r3(MEASURE), indent=1), encoding='utf-8')
print(f'wrote {OUT / "measure.json"}', flush=True)

print('---- the sloop, in island units ----')
print(f'length {LENGTH:.3f} (stem z {-stem_y:.3f}, transom z {-stern_y:.3f}), beam {BEAM:.3f} (rail {BEAM_RAIL:.3f}), '
      f'cap rail at midships {DEPTH:.3f}, hull top at most {H_MAX:.3f}, keel at midships {KEEL_MID}, height to the truck {HEIGHT:.3f}')
for d in DECKS:
    print('  deck', r3(d))
print('  cabin', r3(CABIN))
print('  mast', r3(MAST))
print('  nest', r3({k: v for k, v in (NEST or {}).items() if k != 'floor_hits'}))
print('  yard', r3({k: v for k, v in (YARD or {}).items() if k != 'profile'}))
print('  helm', r3(HELM))
for s in STAIRS:
    print('  stairs', r3(s))
print('  bowsprit', r3(BOWSPRIT))
for p in PORTS:
    print('  port', r3(p))
print('  transom slope', r3(TRANSOM_SLOPE), 'rudder rows', len(RUDDER))
for f in FIXTURES[:14]:
    print('  fixture', r3(f))
print('  draught candidates', r3(DRAUGHT))

# ---- renders ------------------------------------------------------------------------------------------
RENDERS.mkdir(parents=True, exist_ok=True)


def material(name, rgb):
    m = bpy.data.materials.get(name)
    if m is None:
        m = bpy.data.materials.new(name)
        m.diffuse_color = (*rgb, 1.0)
    return m


GREY = material('grey', (0.62, 0.62, 0.62))
RED = material('red', (0.85, 0.12, 0.08))
BLUE = material('blue', (0.1, 0.3, 0.9))
GREEN = material('green', (0.1, 0.6, 0.2))
DARK = material('dark', (0.12, 0.12, 0.12))
SEA = material('sea', (0.05, 0.18, 0.26))
for o in parts:
    o.data.materials.clear()
    o.data.materials.append(GREY)

OVERLAYS = {}


def mesh_object(name, verts, faces, mat, tag):
    m = bpy.data.meshes.new(name)
    m.from_pydata([Vector(v) for v in verts], [], faces)
    m.update()
    m.materials.append(mat)
    o = bpy.data.objects.new(name, m)
    scene.collection.objects.link(o)
    OVERLAYS.setdefault(tag, []).append(o)
    return o


def box(name, c, s, mat, tag):
    verts = []
    for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
        verts.append((c[0] + x * s[0] / 2, c[1] + y * s[1] / 2, c[2] + z * s[2] / 2))
    faces = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (2, 6, 7, 3), (1, 5, 6, 2), (0, 3, 7, 4)]
    return mesh_object(name, verts, faces, mat, tag)


def polyline(name, pts, width, mat, tag, normal):
    """A ribbon through pts (3-tuples), `width` wide, lying flat against `normal`."""
    n = Vector(normal).normalized()
    verts, faces = [], []
    for i, p in enumerate(pts):
        p = Vector(p)
        q = Vector(pts[min(i + 1, len(pts) - 1)]) - Vector(pts[max(i - 1, 0)])
        if q.length < 1e-9:
            q = Vector((0, 0, 1))
        side = q.cross(n).normalized() * (width / 2)
        verts += [p - side, p + side]
        if i:
            a = 2 * (i - 1)
            faces.append((a, a + 1, a + 3, a + 2))
    return mesh_object(name, verts, faces, mat, tag)


def label(text, at, rot, size, mat, tag, align='LEFT'):
    c = bpy.data.curves.new('label', 'FONT')
    c.body = text
    c.size = size
    c.align_x = align
    c.materials.append(mat)
    o = bpy.data.objects.new('label', c)
    o.location = at
    o.rotation_euler = rot
    scene.collection.objects.link(o)
    OVERLAYS.setdefault(tag, []).append(o)
    return o


SIDE_X = -(BEAM_RAIL / 2 + 0.35)            # the side overlays stand between the hull and the port camera
SIDE_ROT = (math.pi / 2, 0, -math.pi / 2)    # text read from the port side, bow to the right
TOP_ROT = (0, 0, -math.pi / 2)               # text read from above with the bow to the right
ruler_y = half_len + 0.6
ruler_top = H_MAX + 0.8
h = 0.0
while h <= ruler_top + 1e-9:
    big = abs(h * 2 - round(h * 2)) < 1e-6
    ln = 0.3 if big else 0.14
    box('tick', (SIDE_X, ruler_y + ln / 2, h), (0.012, ln, 0.012), DARK, 'side')
    if big:
        label(f'{h:.1f}', (SIDE_X, ruler_y + ln + 0.05, h - 0.06), SIDE_ROT, 0.16, DARK, 'side')
    h += 0.1
box('ruler', (SIDE_X, ruler_y, ruler_top / 2), (0.012, 0.012, ruler_top), DARK, 'side')
for z in stations:
    box('station', (SIDE_X, -z, (H_MAX + 0.3) / 2 - 0.1), (0.01, 0.01, H_MAX + 0.5), BLUE, 'side')
    box('station-top', (0, -z, H_MAX + 0.6), (BEAM_RAIL + 0.7, 0.01, 0.01), BLUE, 'top')
    if abs(z * 2 - round(z * 2)) < 1e-6:
        label(f'{z:g}', (SIDE_X, -z + 0.03, -0.45), SIDE_ROT, 0.14, BLUE, 'side')
        label(f'{z:g}', (BEAM_RAIL / 2 + 0.45, -z + 0.05, H_MAX + 0.6), TOP_ROT, 0.14, BLUE, 'top')
for k, (name, hh) in enumerate(DRAUGHT.items()):
    if hh is None:
        continue
    box('draught', (SIDE_X, 0, hh), (0.01, LENGTH + 1.0, 0.012), GREEN, 'side')
    end = -half_len - 0.6 if k % 2 == 0 else half_len + 0.1
    label(f'{name} {hh:.2f}', (SIDE_X, end, hh + 0.015), SIDE_ROT, 0.11, GREEN, 'side', 'LEFT' if k % 2 == 0 else 'RIGHT')
for d in DECKS:
    box('deck', (SIDE_X, -(d['z0'] + d['z1']) / 2, d['y']), (0.01, d['z1'] - d['z0'], 0.014), RED, 'side')
    # The main deck's label at its bow end, the rest at their aft end (read to the left, off the hull).
    at_bow = d['name'] in ('main', 'fore')
    label(f'{d["name"]} {d["y"]:.2f}', (SIDE_X, -d['z1'] if at_bow else -d['z0'] + 0.05, d['y'] + 0.03), SIDE_ROT, 0.11, RED, 'side', 'LEFT' if at_bow else 'RIGHT')
if CABIN:
    box('cabin-floor', (SIDE_X, -(CABIN['z0'] + CABIN['z1']) / 2, CABIN['floor']), (0.01, CABIN['z1'] - CABIN['z0'], 0.014), RED, 'side')
    box('cabin-ceiling', (SIDE_X, -(CABIN['z0'] + CABIN['z1']) / 2, CABIN['ceiling']), (0.01, CABIN['z1'] - CABIN['z0'], 0.014), RED, 'side')
    label(f'cabin floor {CABIN["floor"]:.2f}, ceiling {CABIN["ceiling"]:.2f}', (SIDE_X, -CABIN['z1'] - 0.05, CABIN['floor'] - 0.14), SIDE_ROT, 0.11, RED, 'side', 'LEFT')
if MAST:
    label(f'mast z {MAST["z"]:.2f}', (SIDE_X, -MAST['z'] + 0.12, H_MAX + 0.35), SIDE_ROT, 0.11, DARK, 'side', 'LEFT')
label(f'hull {LENGTH:g}   beam {BEAM:.2f}   cap rail {DEPTH:.2f}   main deck {MAIN_Y:.2f}', (SIDE_X, half_len + 0.1, H_MAX + 0.9), SIDE_ROT, 0.2, DARK, 'side')

# The body plan: every station as a closed polyline in one plane, seen from the bow; stern stations
# blue, bow stations red, the midship one black, grid lines every 0.5.
for i, z in enumerate(stations):
    rows = [r for r in SECTIONS[z] if r[1] is not None and r[2] is not None]
    if len(rows) < 2:
        continue
    pts = [(r[1], 0, r[0]) for r in rows] + [(-r[2], 0, r[0]) for r in reversed(rows)]
    t = (z + half_len) / LENGTH
    mat = material(f'plan{i}', (0.1 + 0.8 * t, 0.15, 0.9 - 0.8 * t)) if abs(z) > 0.01 else DARK
    polyline('plan', pts + pts[:1], 0.012, mat, 'plan', (0, 1, 0))
for g in np.arange(-math.ceil(BEAM_RAIL / 2 * 2) / 2, BEAM_RAIL / 2 + 0.5, 0.5):
    box('grid', (g, 0.02, (H_MAX + 0.5) / 2), (0.006, 0.006, H_MAX + 0.5), DARK if abs(g) < 1e-6 else GREEN, 'plan')
    label(f'{g:g}', (g - 0.05, 0.02, -0.25), (math.pi / 2, 0, 0), 0.12, DARK, 'plan')
for g in np.arange(0, H_MAX + 0.5, 0.5):
    box('grid', (0, 0.02, g), (BEAM_RAIL + 1.0, 0.006, 0.006), GREEN, 'plan')
    label(f'{g:g}', (BEAM_RAIL / 2 + 0.55, 0.02, g - 0.05), (math.pi / 2, 0, 0), 0.12, DARK, 'plan')
label('body plan from the bow: stern stations blue, bow red, midships black', (-BEAM_RAIL / 2 - 0.4, 0.02, H_MAX + 0.6), (math.pi / 2, 0, 0), 0.12, DARK, 'plan')

W_SHOWN = DRAUGHT['h35']
mesh_object('sea', [(-40, -40, W_SHOWN), (40, -40, W_SHOWN), (40, 40, W_SHOWN), (-40, 40, W_SHOWN)], [(0, 3, 2, 1)], SEA, 'sea')


def figure(p, tag):
    """A settler for scale: 0.43 tall, like the island's own (build-batavia.py's)."""
    for c, s in (((0, 0.1, 0), (0.1, 0.2, 0.07)), ((0, 0.28, 0), (0.13, 0.16, 0.08)), ((0, 0.39, 0), (0.08, 0.08, 0.08))):
        box('settler', (p[0] + c[0], p[1] + c[2], p[2] + c[1]), (s[0], s[2], s[1]), RED, tag)


if MAST:
    figure((MAST['x'] + MAST['r'] + 0.25, -MAST['z'] + 0.4, MAIN_Y), 'figure')
if qd:
    figure((0.3, -(qd['z0'] + qd['z1']) / 2, qd['y']), 'figure')

scene.render.engine = 'BLENDER_WORKBENCH'
sh = scene.display.shading
sh.light = 'STUDIO'
sh.color_type = 'MATERIAL'
sh.show_shadows = True
sh.shadow_intensity = 0.3
sh.show_cavity = True
sh.cavity_type = 'BOTH'
sh.show_backface_culling = False      # the model is double-sided; culled, half its faces vanish
sh.background_type = 'VIEWPORT'
sh.background_color = (0.88, 0.9, 0.93)
scene.display.render_aa = '16'
scene.view_settings.view_transform = 'Standard'
scene.render.resolution_x, scene.render.resolution_y = 2000, 1250
cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
scene.collection.objects.link(cam)
scene.camera = cam
# Blender coordinates here (x across, y along, z up). Orthographic where the picture is a ruler.
SHOTS = {
    'side': {'eye': (-30, -0.6, H_MAX * 0.5), 'look': (0, -0.6, H_MAX * 0.5), 'ortho': LENGTH + 6.0, 'show': ('side', 'figure', 'sea')},
    'top': {'eye': (0, -0.6, 40), 'rot': TOP_ROT, 'ortho': LENGTH + 6.0, 'show': ('top', 'figure')},
    'body-plan': {'eye': (0, -30, (H_MAX + 0.3) / 2), 'look': (0, 0, (H_MAX + 0.3) / 2), 'ortho': max(BEAM_RAIL + 1.6, H_MAX + 1.2) * 1.6, 'show': ('plan',), 'hull': False},
    'quarter': {'eye': (-9.5, -9.0, H_MAX + 2.5), 'look': (0, 0.3, H_MAX * 0.7), 'lens': 35, 'show': ('figure', 'sea')},
    'stern': {'eye': (-5, 11, H_MAX + 2.5), 'look': (0, 2.5, H_MAX * 0.7), 'lens': 40, 'show': ('figure', 'sea')},
    'deck': {'eye': (0.5, -half_len - 1.5, H_MAX + 1.6), 'look': (0, 1.5, MAIN_Y + 0.3), 'lens': 26, 'show': ('figure',)},
    'bow': {'eye': (-4.5, -half_len - 6.0, H_MAX + 1.5), 'look': (0, -half_len + 1.5, MAIN_Y + 0.2), 'lens': 40, 'show': ('figure', 'sea')},
}
if NEST and MAST:
    SHOTS['nest'] = {'eye': (MAST['x'] - 2.6, -MAST['z'] - 2.2, NEST['floor'] + 1.2), 'look': (MAST['x'], -MAST['z'], NEST['floor'] + 0.2), 'lens': 40, 'show': ()}
for view, shot in SHOTS.items():
    for tag, objs in OVERLAYS.items():
        for o in objs:
            o.hide_render = tag not in shot['show']
    for o in parts:
        o.hide_render = not shot.get('hull', True)
    if 'ortho' in shot:
        cam.data.type = 'ORTHO'
        cam.data.ortho_scale = shot['ortho']
    else:
        cam.data.type = 'PERSP'
        cam.data.lens = shot['lens']
    cam.location = Vector(shot['eye'])
    if 'rot' in shot:
        cam.rotation_euler = shot['rot']
    else:
        cam.rotation_euler = (Vector(shot['look']) - Vector(shot['eye'])).to_track_quat('-Z', 'Y').to_euler()
    scene.render.filepath = str(RENDERS / f'{view}.png')
    bpy.ops.render.render(write_still=True)
    print(f'rendered {RENDERS / f"{view}.png"}', flush=True)
