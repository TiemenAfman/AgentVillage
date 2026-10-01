"""The Salty Kraken: render 17, built as literally as a 3D model can be - a pirate galleon
standing whole on a sea rock, its long side to the water, a steep stair up the rock to a door by
the stern - and a kraken that has hold of it.

Run: node scripts/blender.mjs --background --python scripts/build-piratetavern.py
Hand edits are lost: this script writes assets/piratetavern/promptholm-piratetavern.blend
from scratch and bakes it in the same run.

Designed from 2D renders before a line of it was written (Plans/piratenkroeg.md, "Het
exterieur"). The keeper picked render 17 of the second round and asked for it literally, at
about 80k triangles, with krakens. So this follows the picture where the picture is clear:
- **The proportions**: a deep, round-bellied hull on a rock 0.7 high, masts reaching 3 above the
  deck - about 5 in all. On a 5 x 3 lot (the ship on 3 x 3 read as a toy).
- **The masts**: the fore mast amidships with a hard-bellied course under a topsail; the aft mast
  on the stern castle with a fighting top at its middle, its course furled, a big topsail above.
  The sails brown, patched and torn along the foot.
- **The great Jolly Roger** on a staff raked forward off the forecastle, a smaller swallow-tailed
  one at the fore masthead; a lantern on a bracket under the bowsprit and one on an iron arm off
  the stern; a shore timber from the bow down to the rock; a cupola and a leaning spar on the
  stern castle; a carved sea-devil on each stern quarter; iron bolts along every wale.
- **The steep plank stair** up the rock to an arched door under the stern castle, a lantern
  beside it and a skull over it, and two glowing ports low on the waist.
And fills in what the picture does not settle (its far side, its rigging, which is not a
consistent ship): the land side mirrors the water side, the rigging is a ship's. Added to the
picture at the keeper's word: four kraken arms up out of the rock, holding on.

Every plank edge is geometry - each strake of the hull stands a hair proud of the one below -
because an island building has no texture of its own: vertex colours and one of six shared
sheets, so what the render shows as seams and bolts has to be triangles.

There is deliberately **no anchor.flag**: main.js hangs the district's flag on every one it
finds, and this ship flies its own. The sign (web/js/piratesign.js) is not baked here - it
swings - and hangs on anchor.sign on the stern castle's forward corner, its arm out towards the
water (PIRATE_SIGN_YAW, -90 degrees, in web/js/buildings.js).

Axes as every set: island (x east, y up, z towards the water) in the helpers, Blender gets
(x, -z, y). The bow points west, the stern east; the long flank faces the water (+Z).

No ordinary hero budget: HERO_BUDGETS.piratetavern in scripts/model-rules.mjs is a ceiling
against a bake running away. It is one instance in each island's batch - triangles, no draw
call.
"""
import bpy
import math
import random
import runpy
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(globals().get('ROOT_DIR') or Path(__file__).resolve().parents[1])
OUT = ROOT / 'assets/piratetavern'
PREVIEW_ONLY = globals().get('PREVIEW_ONLY', False)
bpy.ops.wm.read_factory_settings(use_empty=True)
# Every jitter below comes from this one stream, in build order: a second bake must change no
# byte (npm run models is checked for that).
rng = random.Random(17)

COLORS = {
    'plank:hull': 0x8a5c30, 'plank:tar': 0x4a3322, 'plank:oak': 0x7a5634, 'plank:deck': 0x8b6a47,
    'plank:dark': 0x2a1f18, 'plankZ:tread': 0x7d6045, 'plankZ:post': 0x4a3524,
    'stone:rock': 0x5d6166, 'stone:rock-dark': 0x45494e, 'stone:barnacle': 0x8f8a7c,
    'wall:canvas': 0xd6cbb0, 'wall:canvas-dark': 0xb3a78c,
    'plain:sail': 0x8a6a42, 'wall:sail-dark': 0x5e4629,
    'roof:castle': 0x4a3a2c,
    'plain:iron': 0x2c2d2f, 'plain:gold': 0xc9a13b, 'plain:glass': 0xffc070,
    'plain:flag': 0x1c1d22, 'plain:bone': 0xece4d2, 'plain:rope': 0xb89a68,
    'plain:kraken': 0x6b3a6e, 'plain:kraken-dark': 0x4a2650, 'plain:sucker': 0xc98aa0,
    'plain:void': 0x140f0b, 'plain:moss': 0x5b6636,
}
materials = {}
for name, hex in COLORS.items():
    m = bpy.data.materials.new(name)
    rgb = [((hex >> s) & 255) / 255 for s in [16, 8, 0]]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .86
    m['emissive'] = 1.0 if name == 'plain:glass' else 0.0
    materials[name] = m

HULL, TAR, OAK, DECK, DARK = 'plank:hull', 'plank:tar', 'plank:oak', 'plank:deck', 'plank:dark'
TREAD, POST = 'plankZ:tread', 'plankZ:post'
ROCK, ROCK_DARK, BARNACLE = 'stone:rock', 'stone:rock-dark', 'stone:barnacle'
CANVAS, CANVAS_DARK, CASTLE_ROOF = 'wall:canvas', 'wall:canvas-dark', 'roof:castle'
SAIL, SAIL_DARK = 'plain:sail', 'wall:sail-dark'
IRON, GOLD, GLASS, FLAG, BONE, ROPE = 'plain:iron', 'plain:gold', 'plain:glass', 'plain:flag', 'plain:bone', 'plain:rope'
KRAKEN, KRAKEN_DARK, SUCKER, VOID, MOSS = 'plain:kraken', 'plain:kraken-dark', 'plain:sucker', 'plain:void', 'plain:moss'

# The ship lists three degrees towards the water about its keel line. Every part of the ship
# is built upright and turned at the end (`ship=True`); the rock, the stair and the things on
# the quay are not.
HEEL = math.radians(3)
KEEL_Y = 0.42
_heel = (Matrix.Translation((0, 0, KEEL_Y)) @ Matrix.Rotation(HEEL, 4, 'X') @ Matrix.Translation((0, 0, -KEEL_Y)))
SHIP_PARTS = []
_count = {}


def xyz(p):
    return (p[0], -p[2], p[1])


def link(obj, name, mat, ship):
    # Part names are unique in the bake; a helper called in a loop numbers its parts.
    n = _count.get(name, 0)
    _count[name] = n + 1
    obj.name = 'Salty ' + name + (f' {n}' if n else '')
    if isinstance(mat, (list, tuple)):
        for m in mat:
            obj.data.materials.append(materials[m])
    else:
        obj.data.materials.append(materials[mat])
    obj['building_part'] = True
    if ship:
        SHIP_PARTS.append(obj)
    return obj


def bevel(o, width, segments=1):
    m = o.modifiers.new('Worn edges', 'BEVEL')
    m.width, m.segments, m.limit_method = width, segments, 'ANGLE'
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.modifier_apply(modifier=m.name)


def box(name, p, size, mat, ship=True, turn=0.0, tilt=0.0, roll=0.0, round_=0.0):
    """A box centred on p, sized (w, h, d) in island axes; `turn` about its own vertical,
    `tilt` about its own x (a slope running down towards +Z), `roll` about its own z."""
    bpy.ops.mesh.primitive_cube_add(size=1, location=xyz(p))
    o = bpy.context.object
    o.scale = (size[0], size[2], size[1])
    o.rotation_euler = (tilt, roll, -turn)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if round_:
        bevel(o, round_, 2)
    return link(o, name, mat, ship)


def round_sides(sides):
    # The HD bake (the keeper: "17 in a 50k model"): every round thing twice as many sides as it
    # was drawn with in the 13k version, and nothing under six, so a rope is round too.
    return sides * 2 if sides >= 6 else 6


def rod(name, a, b, r, mat, ship=True, top=None, sides=8, fill='NGON'):
    sides = round_sides(sides)
    a, b = Vector(xyz(a)), Vector(xyz(b))
    bpy.ops.mesh.primitive_cone_add(vertices=sides, radius1=r, radius2=r if top is None else top,
                                    depth=(b - a).length, location=(a + b) / 2, end_fill_type=fill)
    o = bpy.context.object
    o.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return link(o, name, mat, ship)


def ball(name, p, size, mat, ship=True, seg=8, rings=5):
    if seg >= 5:
        # A bigger ball is an icosphere: UV spheres of ten or twelve segments came out of two
        # builds of this script in a different triangle order (same shape, different bytes), and
        # the rock's icospheres never have.
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1, location=xyz(p))
        o = bpy.context.object
        o.scale = (size[0], size[2], size[1])
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        return link(o, name, mat, ship)
    seg, rings = seg * 2, rings * 2 - 1
    bpy.ops.mesh.primitive_uv_sphere_add(segments=seg, ring_count=rings, radius=1, location=xyz(p))
    o = bpy.context.object
    o.scale = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    return link(o, name, mat, ship)


def outward(o):
    for other in bpy.context.selected_objects:
        other.select_set(False)
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.mesh.normals_make_consistent(inside=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def solid(name, verts, faces, mat, ship=True, mats=None, consistent=True):
    """A hand-made mesh; `mats` gives a material slot per face when `mat` is a list."""
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata([xyz(v) for v in verts], [], faces)
    if mats:
        for poly, k in zip(mesh.polygons, mats):
            poly.material_index = k
    mesh.update()
    o = bpy.data.objects.new('x', mesh)
    bpy.context.collection.objects.link(o)
    link(o, name, mat, ship)
    if consistent:
        outward(o)
    return o


def plate(name, outline, x, y, z, depth, mat, ship=True, turn=0.0):
    """A flat shape of some thickness, its outline in its own (u, v), its front facing the
    direction `turn` (0 = +Z)."""
    cu, su = math.cos(turn), math.sin(turn)
    at = lambda u, v, w: (x + u * cu + w * su, y + v, z - u * su + w * cu)
    front = [at(a, b, depth / 2) for a, b in outline]
    back = [at(a, b, -depth / 2) for a, b in outline]
    n = len(outline)
    faces = [tuple(range(n)), tuple(range(2 * n - 1, n - 1, -1))]
    faces += [(i, n + i, n + (i + 1) % n, (i + 1) % n) for i in range(n)]
    return solid(name, front + back, faces, mat, ship)


def sweep(name, path, radii, mat, ship=True, sides=8, cap=True):
    """A tube along a polyline, one radius per point: tentacles, ropes, rails."""
    sides = round_sides(sides)
    rings = []
    for i, p in enumerate(path):
        a = Vector(path[max(i - 1, 0)])
        b = Vector(path[min(i + 1, len(path) - 1)])
        t = (b - a).normalized()
        side = t.cross(Vector((0, 1, 0)))
        if side.length < 1e-4:
            side = t.cross(Vector((1, 0, 0)))
        side.normalize()
        up = side.cross(t).normalized()
        r = radii[i]
        rings.append([Vector(p) + (side * math.cos(k * math.tau / sides) + up * math.sin(k * math.tau / sides)) * r
                      for k in range(sides)])
    verts = [tuple(v) for ring in rings for v in ring]
    faces = []
    for i in range(len(rings) - 1):
        for k in range(sides):
            a, b = i * sides + k, i * sides + (k + 1) % sides
            faces.append((a, b, b + sides, a + sides))
    if cap:
        faces.append(tuple(range(sides - 1, -1, -1)))
        last = (len(rings) - 1) * sides
        faces.append(tuple(range(last, last + sides)))
    return solid(name, verts, faces, mat, ship)


def cloth(name, grid, mat, ship=True, thick=0.006):
    """A sheet of canvas or cloth from a grid of points, given both faces: the building
    material is single-sided, and a sail is seen from both sides."""
    rows, cols = len(grid), len(grid[0])
    front = [p for row in grid for p in row]
    # The back is the same sheet a hair behind, along the sheet's own normal.
    a, b, c = Vector(grid[0][0]), Vector(grid[0][-1]), Vector(grid[-1][0])
    nrm = (b - a).cross(c - a).normalized() * thick
    back = [tuple(Vector(p) - nrm) for p in front]
    n = len(front)
    faces = []
    for j in range(rows - 1):
        for i in range(cols - 1):
            q = (j * cols + i, j * cols + i + 1, (j + 1) * cols + i + 1, (j + 1) * cols + i)
            faces.append(q)
            faces.append(tuple(n + k for k in reversed(q)))
    return solid(name, front + back, faces, mat, ship, consistent=False)


# ---- the hull -------------------------------------------------------------------------------
# Lofted through stations from the stem (west) to the transom (east), and planked: each side is
# STRAKES bands, each standing a hair proud of the one below, so every plank edge is a real step
# that catches the light the way the seams do in the render. The ring runs from the starboard
# gunwale round the keel to the port gunwale, then up the inside of the bulwarks and across the
# deck - closed, so the bulwarks have a thickness and the deck lies inside them.
#
# Proportions are render 17's, measured off it against its hull length: a deep, round-bellied
# hull (1.3 from keel to gunwale on a length of 4), on a rock 0.7 high, under masts reaching 3
# above the deck - about 5 in all, twenty metres, which is what that picture is.
BOW_X, STERN_X = -2.00, 1.95
BEAM, BULWARK = 0.62, 0.05
KEEL_Y = 0.72
N_STATIONS = 130
STRAKES = 18
PROUD = 0.011                   # how far a strake stands out over the one below it
_heel = (Matrix.Translation((0, 0, KEEL_Y)) @ Matrix.Rotation(HEEL, 4, 'X') @ Matrix.Translation((0, 0, -KEEL_Y)))


def t_of(x):
    return (x - BOW_X) / (STERN_X - BOW_X)


def beam(x):
    t = t_of(x)
    return BEAM * min(1.0, t / 0.40) ** 0.55 * (1 - 0.2 * max(0.0, (t - 0.74) / 0.26))


def keel(x):
    t = t_of(x)
    return KEEL_Y + 0.62 * max(0.0, (0.24 - t) / 0.24) ** 1.5 + 0.12 * max(0.0, (t - 0.86) / 0.14)


def sheer(x):
    t = t_of(x)
    return 2.00 + 0.32 * (1 - t) ** 3 + 0.30 * t ** 3


def deck_y(x):
    return sheer(x) - 0.15


# (share of the half-beam, share of the height from keel to gunwale): a round belly and a
# pronounced tumblehome over it.
RING = [(0.86, 1.00), (0.95, 0.88), (1.00, 0.72), (0.99, 0.55), (0.92, 0.38), (0.76, 0.22), (0.50, 0.09), (0.22, 0.02), (0.0, 0.0)]
DARK_STRAKES = {2, 3, 7, 12}    # the wales and the band under them, tarred dark


def profile(h):
    """(share of half-beam, outward normal in (z, y)) at share h of the height."""
    for (w0, h0), (w1, h1) in zip(RING, RING[1:]):
        if h1 <= h <= h0:
            f = (h - h1) / (h0 - h1)
            w = w1 + (w0 - w1) * f
            n = Vector(((h0 - h1), -(w0 - w1)))
            return w, n.normalized()
    return RING[0][0], Vector((1, 0))


def section(x):
    """One station's ring, and which strake each outer span belongs to (None elsewhere)."""
    b, k, s, d = beam(x), keel(x), sheer(x), deck_y(x)
    depth = s - k
    side = []            # starboard, gunwale down to the keel
    owner = []
    for i in range(STRAKES):
        h_top = 1 - i / STRAKES
        h_bot = 1 - (i + 1) / STRAKES
        w, n = profile(h_top)
        side.append((w * b, k + h_top * depth))
        wb, nb = profile(h_bot)
        # the plank's lower edge stands proud; the next plank starts back on the hull
        side.append((wb * b + nb.x * PROUD, k + h_bot * depth + nb.y * PROUD))
        owner += [i, None]
    side.append((0.0, k))
    outer = side + [(-z, y) for z, y in reversed(side[:-1])]
    own = owner + [None] + list(reversed(owner))
    inner_w = max(RING[0][0] * b - BULWARK, 0.0)
    inner = [(-inner_w, s - 0.005), (-inner_w, d), (inner_w, d), (inner_w, s - 0.005)]
    return outer + inner, own + [None] * 4, len(outer)


def hull_point(x, h, side=1):
    """A point on the outside of the hull at share h of its height, and its outward normal."""
    b, k, s = beam(x), keel(x), sheer(x)
    w, n = profile(h)
    return Vector((x, k + h * (s - k), side * w * b)), Vector((0, n.y, side * n.x)).normalized()


xs = [BOW_X + (STERN_X - BOW_X) * (i / (N_STATIONS - 1)) ** 1.1 for i in range(N_STATIONS)]
secs = [section(x) for x in xs]
ring_n, owners, n_outer = len(secs[0][0]), secs[0][1], secs[0][2]
verts = [(x, y, z) for x, (sec, _, _) in zip(xs, secs) for z, y in sec]
faces, mats = [], []
for i in range(N_STATIONS - 1):
    for j in range(ring_n):
        a, c = i * ring_n + j, (i + 1) * ring_n + j
        a2, c2 = i * ring_n + (j + 1) % ring_n, (i + 1) * ring_n + (j + 1) % ring_n
        faces.append((a, c, c2, a2))
        if j < n_outer - 1:
            # A span belongs to the strake of whichever end is a strake's top: on the starboard side
            # that is its first point, on the port side (the list reversed) its second.
            k = owners[j] if owners[j] is not None else owners[j + 1] if owners[j + 1] is not None else owners[j - 1]
            mats.append(1 if (k in DARK_STRAKES or (k is not None and k >= STRAKES - 5)) else 0)
        elif j == n_outer + 1:
            mats.append(3)                                  # the deck
        else:
            mats.append(2)                                  # bulwarks inside and the cap rail
last = (N_STATIONS - 1) * ring_n
faces.append(tuple(range(last, last + ring_n)))             # the transom, behind the stern castle
mats.append(0)
solid('hull', verts, faces, [HULL, TAR, OAK, DECK], mats=mats)

# The wales: three heavy rubbing strakes along each side, iron-studded every hand's breadth.
for h, r in ((0.84, 0.03), (0.66, 0.034), (0.44, 0.028)):
    for side in (1, -1):
        path = []
        for x in xs[6:-2:2]:
            p, n = hull_point(x, h, side)
            path.append(tuple(p + n * (r * 0.7 + PROUD)))
        sweep('wale', path, [r] * len(path), DARK, sides=4)
        for x in [BOW_X + 0.45 + 0.13 * k for k in range(int((STERN_X - BOW_X - 0.6) / 0.13))]:
            p, n = hull_point(x, h, side)
            q = p + n * (r * 1.6 + PROUD)
            rod('wale bolt', tuple(q - n * 0.012), tuple(q + n * 0.01), 0.012, IRON, sides=3)
# The keel timber and the stem post curving up the bow; the rudder at the stern with its irons.
sweep('keel', [(x, keel(x) - 0.03, 0) for x in xs[4::3]], [0.045] * len(xs[4::3]), DARK, sides=4)
stem = [(BOW_X + 0.03 - 0.12 * math.sin(a), keel(BOW_X) - 0.03 + (sheer(BOW_X) + 0.12 - keel(BOW_X)) * (1 - math.cos(a)) / (1 - math.cos(1.25)), 0)
        for a in [1.25 * i / 9 for i in range(10)]]
sweep('stem', stem, [0.05] * len(stem), DARK, sides=4)
RUD_Y0, RUD_Y1 = keel(STERN_X) + 0.02, sheer(STERN_X) - 0.25
box('rudder', (STERN_X + 0.07, (RUD_Y0 + RUD_Y1) / 2, 0), (0.12, RUD_Y1 - RUD_Y0, 0.05), DARK, round_=0.012)
for f in (0.2, 0.5, 0.8):
    y = RUD_Y0 + (RUD_Y1 - RUD_Y0) * f
    box('rudder iron', (STERN_X + 0.06, y, 0), (0.16, 0.025, 0.065), IRON)
# A patched plank or two, and the bolts that hold the patches, down the weathered flank.
for x, h in ((-1.1, 0.30), (0.35, 0.26), (-0.2, 0.62), (0.9, 0.52)):
    p, n = hull_point(x, h, 1)
    plate('hull patch', [(-0.11, -0.05), (0.12, -0.045), (0.11, 0.05), (-0.1, 0.055)], p.x, p.y, p.z + 0.016, 0.012, TAR,
          turn=math.atan2(n.x, n.z))
    for dx in (-0.08, 0.08):
        for dy in (-0.03, 0.03):
            rod('patch bolt', (p.x + dx, p.y + dy, p.z + 0.02), (p.x + dx, p.y + dy, p.z + 0.035), 0.008, IRON, sides=3)

# The shore: a great timber from the bow down to the rock, as the render has it - whether the
# ship's own cutwater sprung loose or a prop somebody set under her, it holds the bow up.
sweep('shore', [(BOW_X - 0.02, sheer(BOW_X) - 0.25, 0.04), (BOW_X + 0.2, 1.1, 0.2), (BOW_X + 0.52, 0.12, 0.34)],
      [0.055, 0.058, 0.06], OAK, ship=False, sides=4)
for f in (0.25, 0.6):
    a, b = Vector((BOW_X - 0.02, sheer(BOW_X) - 0.25, 0.04)), Vector((BOW_X + 0.52, 0.12, 0.34))
    p = a.lerp(b, f)
    rod('shore band', tuple(p - (b - a).normalized() * 0.02), tuple(p + (b - a).normalized() * 0.02), 0.07, IRON, ship=False, sides=4)

# ---- windows ------------------------------------------------------------------------------------------
ARCH = [(math.cos(math.pi * i / 10), math.sin(math.pi * i / 10)) for i in range(11)]


def arched(name, centre, normal, w, h, frame=0.024, square=False):
    """A window on a face with outward `normal`: arched, or square with a cross (the flank's)."""
    turn = math.atan2(normal.x, normal.z)
    x, y, z = centre
    if square:
        outline = [(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)]
        fo = [(-w / 2 - frame, -h / 2 - frame), (w / 2 + frame, -h / 2 - frame), (w / 2 + frame, h / 2 + frame), (-w / 2 - frame, h / 2 + frame)]
    else:
        outline = [(-w / 2, -h / 2), (w / 2, -h / 2)] + [(w / 2 * c, h / 2 - w / 2 + w / 2 * s) for c, s in ARCH]
        fo = [(-w / 2 - frame, -h / 2 - frame), (w / 2 + frame, -h / 2 - frame)] + \
             [((w / 2 + frame) * c, h / 2 - w / 2 + (w / 2 + frame) * s) for c, s in ARCH]
    plate(name + ' frame', fo, x, y, z, 0.03, DARK, turn=turn)
    off = Vector((math.sin(turn), 0, math.cos(turn)))
    g = Vector(centre) + off * 0.012
    plate(name + ' pane', outline, g.x, g.y, g.z, 0.012, GLASS, turn=turn)
    b = Vector(centre) + off * 0.02
    box(name + ' bar', tuple(b), (0.014, h * 0.92, 0.008), DARK, turn=turn)
    box(name + ' bar', tuple(b + Vector((0, 0 if square else -h * 0.08, 0))), (w * 0.95, 0.014, 0.008), DARK, turn=turn)
    box(name + ' sill', tuple(Vector(centre) + off * 0.02 + Vector((0, -h / 2 - frame - 0.012, 0))), (w + 0.07, 0.022, 0.05), OAK, turn=turn)


# The two glowing ports low on the waist of the render, and more along both sides of the hold.
for side, row in ((1, (-0.72, -0.40, -0.08, 0.30)), (-1, (-0.9, -0.3, 0.3))):
    for x in row:
        p, n = hull_point(x, 0.36, side)
        arched('hold window', tuple(p + n * (PROUD + 0.012)), Vector((0, 0, side)), 0.15, 0.15, square=True)

# ---- the stern castle ------------------------------------------------------------------------------
# Raised aft, one tall storey over the deck with a balustrade round its roof, a little domed
# cupola on the roof, a carved figure at its quarter, glowing windows, the stern lantern on an
# iron arm off its end, and the spar leaning out over its taffrail.
C0, C1 = 0.72, STERN_X + 0.05
CY0 = deck_y(1.3)
CH_ = 0.56
H1 = beam(1.35) * RING[0][0] + 0.01


def storey(name, x0, x1, y0, h, half, lean=0.05, mat=HULL):
    v = [(x0, y0, -half), (x1, y0, -half), (x1, y0, half), (x0, y0, half),
         (x0, y0 + h, -half + lean), (x1, y0 + h, -half + lean), (x1, y0 + h, half - lean), (x0, y0 + h, half - lean)]
    f = [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)]
    o = solid(name, v, f, mat)
    bevel(o, 0.014, 2)
    return o


storey('stern castle', C0, C1, CY0, CH_, H1)
# its planking: a strake line every storey-tenth on the three faces the render shows
for k in range(1, 7):
    y = CY0 + CH_ * k / 7
    lean = 0.05 * k / 7
    rod('castle seam', (C0 + 0.02, y, H1 - lean + 0.004), (C1 - 0.02, y, H1 - lean + 0.004), 0.005, DARK, sides=3)
    rod('castle seam', (C0 + 0.02, y, -H1 + lean - 0.004), (C1 - 0.02, y, -H1 + lean - 0.004), 0.005, DARK, sides=3)
    rod('castle seam', (C1 + 0.004, y, -H1 + lean + 0.02), (C1 + 0.004, y, H1 - lean - 0.02), 0.005, DARK, sides=3)
RY = CY0 + CH_
box('castle cornice', ((C0 + C1) / 2, RY + 0.015, 0), (C1 - C0 + 0.06, 0.04, 2 * H1 + 0.02), OAK, round_=0.008)
box('castle roof deck', ((C0 + C1) / 2, RY + 0.04, 0), (C1 - C0, 0.02, 2 * H1 - 0.1), DECK)
# Balustrade round the roof, turned balusters on a rail.
RH = 0.17
for (x0, z0), (x1, z1) in (((C0 + 0.02, H1 - 0.06), (C1 - 0.02, H1 - 0.06)), ((C0 + 0.02, -H1 + 0.06), (C1 - 0.02, -H1 + 0.06)),
                           ((C1 - 0.02, -H1 + 0.06), (C1 - 0.02, H1 - 0.06)), ((C0 + 0.02, -H1 + 0.06), (C0 + 0.02, -0.25))):
    L = math.hypot(x1 - x0, z1 - z0)
    box('castle rail', ((x0 + x1) / 2, RY + 0.05 + RH, (z0 + z1) / 2), (max(x1 - x0, 0.03) + 0.02, 0.028, max(z1 - z0, 0.03) + 0.02), OAK, round_=0.006)
    n = max(3, int(L / 0.075))
    for i in range(n + 1):
        f = i / n
        p = (x0 + (x1 - x0) * f, RY + 0.05, z0 + (z1 - z0) * f)
        rod('castle baluster', p, (p[0], p[1] + RH, p[2]), 0.011, OAK, top=0.008, sides=4)
        ball('castle baluster knop', (p[0], p[1] + RH * 0.45, p[2]), (0.016, 0.02, 0.016), OAK, seg=3, rings=2)
# The cupola: a little round cabin with a domed roof, on the roof deck.
CU = (1.32, RY + 0.05, -0.05)
rod('cupola wall', CU, (CU[0], CU[1] + 0.2, CU[2]), 0.17, HULL, top=0.165, sides=8)
for k in range(5):
    a = k * math.tau / 5 + 0.6
    nrm = Vector((math.cos(a), 0, math.sin(a)))
    box('cupola window', (CU[0] + nrm.x * 0.168, CU[1] + 0.11, CU[2] + nrm.z * 0.168), (0.06, 0.09, 0.01), GLASS, turn=math.atan2(nrm.x, nrm.z))
rod('cupola eave', (CU[0], CU[1] + 0.2, CU[2]), (CU[0], CU[1] + 0.23, CU[2]), 0.2, OAK, sides=8)
# The dome, built ring by ring: a UV sphere with its lower half deleted came out of two builds in a
# different triangle order, and a bake has to be the same bytes twice.
dome_v, dome_f = [], []
SEG, RINGS = 16, 5
for j in range(RINGS):
    phi = (math.pi / 2) * j / RINGS
    for i in range(SEG):
        a = i * math.tau / SEG
        dome_v.append((CU[0] + 0.19 * math.cos(phi) * math.cos(a), CU[1] + 0.23 + 0.16 * math.sin(phi), CU[2] + 0.19 * math.cos(phi) * math.sin(a)))
dome_v.append((CU[0], CU[1] + 0.39, CU[2]))
for j in range(RINGS - 1):
    for i in range(SEG):
        dome_f.append((j * SEG + i, j * SEG + (i + 1) % SEG, (j + 1) * SEG + (i + 1) % SEG, (j + 1) * SEG + i))
apex = len(dome_v) - 1
for i in range(SEG):
    dome_f.append(((RINGS - 1) * SEG + i, (RINGS - 1) * SEG + (i + 1) % SEG, apex))
solid('cupola dome', dome_v, dome_f, CASTLE_ROOF)
rod('cupola finial', (CU[0], CU[1] + 0.38, CU[2]), (CU[0], CU[1] + 0.47, CU[2]), 0.018, GOLD, top=0.0, sides=4)
# Stern windows across the transom, and two on the water flank of the castle.
for i, z in enumerate((-0.3, 0.0, 0.3)):
    arched('stern window', (C1 + 0.014, CY0 + CH_ * 0.55, z), Vector((1, 0, 0)), 0.13, 0.2)
for x in (1.0, 1.55):
    arched('castle window', (x, CY0 + CH_ * 0.55, H1 - 0.03 + 0.014), Vector((0, 0, 1)), 0.13, 0.2)
arched('castle window', (1.3, CY0 + CH_ * 0.55, -H1 + 0.03 - 0.014), Vector((0, 0, -1)), 0.13, 0.2)
# The carved figure on the stern quarter: a hunched sea-devil holding the corner.
for side in (1, -1):
    fz = side * (H1 + 0.02)
    ball('quarter figure body', (C1 - 0.02, CY0 + 0.2, fz), (0.07, 0.16, 0.06), DARK, seg=6, rings=5)
    ball('quarter figure head', (C1 - 0.01, CY0 + 0.41, fz), (0.065, 0.07, 0.06), DARK, seg=6, rings=4)
    for hz in (-0.035, 0.035):
        rod('quarter figure horn', (C1 - 0.01, CY0 + 0.45, fz + hz), (C1 + 0.02, CY0 + 0.53, fz + hz * 1.8), 0.012, DARK, top=0.0, sides=3)
    sweep('quarter figure tail', [(C1 - 0.02, CY0 + 0.06, fz), (C1 + 0.02, CY0 - 0.08, fz), (C1 - 0.02, CY0 - 0.2, fz + side * 0.02)], [0.03, 0.02, 0.008], DARK, sides=4)
# The stern lantern on its iron arm, off the castle's end (render 17, right).
AR0 = (C1 + 0.01, RY - 0.08, 0.28)
AR1 = (C1 + 0.07, RY - 0.08, 0.28)
rod('stern lantern arm', AR0, AR1, 0.012, IRON, sides=4)
sweep('stern lantern arm scroll', [(C1 + 0.01, RY - 0.25, 0.28), (C1 + 0.04, RY - 0.19, 0.28), (AR1[0] - 0.01, RY - 0.1, 0.28)], [0.008] * 3, IRON, sides=3)


def lantern(name, top, size=1.2, ship=True, hung=True):
    """A ship's lantern with its top at `top`: a ring to hang it by (when `hung`), a cone of a cap
    with a rim, eight glass panes between iron stiles with a band round their middle, a base and a
    finial under it. The first version was a four-sided glowing bottle with four ribs, and at the
    size of render 17's lanterns it read as a bottle."""
    x, y, z = top
    s = size
    if hung:
        ring = [(x, y + 0.02 * s + 0.016 * s * math.cos(a), z + 0.016 * s * math.sin(a)) for a in [i * math.tau / 8 for i in range(9)]]
        sweep(name + ' ring', ring, [0.0035 * s] * 9, IRON, ship=ship, sides=3, cap=False)
    rod(name + ' cap', (x, y, z), (x, y - 0.065 * s, z), 0.012 * s, IRON, ship=ship, top=0.056 * s, sides=4)
    rod(name + ' rim', (x, y - 0.065 * s, z), (x, y - 0.078 * s, z), 0.06 * s, IRON, ship=ship, sides=4)
    rod(name + ' glass', (x, y - 0.078 * s, z), (x, y - 0.24 * s, z), 0.049 * s, GLASS, ship=ship, sides=4)
    for k in range(8):
        a = k * math.tau / 8 + math.tau / 16
        rod(name + ' stile', (x + 0.052 * s * math.cos(a), y - 0.078 * s, z + 0.052 * s * math.sin(a)),
            (x + 0.052 * s * math.cos(a), y - 0.24 * s, z + 0.052 * s * math.sin(a)), 0.0042 * s, IRON, ship=ship, sides=3)
    rod(name + ' band', (x, y - 0.155 * s, z), (x, y - 0.163 * s, z), 0.054 * s, IRON, ship=ship, sides=4, fill='NOTHING')
    rod(name + ' base', (x, y - 0.24 * s, z), (x, y - 0.258 * s, z), 0.06 * s, IRON, ship=ship, sides=4)
    rod(name + ' foot', (x, y - 0.258 * s, z), (x, y - 0.29 * s, z), 0.05 * s, IRON, ship=ship, top=0.012 * s, sides=4)
    rod(name + ' finial', (x, y - 0.29 * s, z), (x, y - 0.32 * s, z), 0.009 * s, IRON, ship=ship, top=0.0, sides=3)


def post_lantern(name, base, height, size=1.0, ship=True):
    """A lantern standing on a post, the post's top in its foot."""
    x, y, z = base
    rod(name + ' post', (x, y, z), (x, y + height, z), 0.018, POST, ship=ship, sides=4)
    lantern(name, (x, y + height + 0.29 * size, z), size, ship=ship, hung=False)


lantern('stern lantern', (AR1[0], AR1[1], AR1[2]))
# The spar over the taffrail, leaning out and up to the east (the render's right).
SP0, SP1 = (C1 - 0.2, RY + 0.06, -0.2), (STERN_X + 0.16, RY + 0.9, -0.2)
rod('stern spar', SP0, SP1, 0.028, OAK, top=0.018, sides=6)
rod('stern spar band', tuple(Vector(SP0).lerp(Vector(SP1), 0.3)), tuple(Vector(SP0).lerp(Vector(SP1), 0.33)), 0.032, IRON, sides=6)

# ---- the forecastle and the bow ---------------------------------------------------------------------
F0, F1 = -1.92, -1.25
FY = deck_y(-1.55)
FH = beam(-1.45) * RING[0][0] - 0.01
storey('forecastle', F0, F1, FY, 0.24, FH, lean=0.03)
box('forecastle cornice', ((F0 + F1) / 2, FY + 0.255, 0), (F1 - F0 + 0.05, 0.03, 2 * FH + 0.03), OAK, round_=0.006)
for z in (-FH + 0.03, FH - 0.03):
    box('forecastle rail', ((F0 + F1) / 2, FY + 0.39, z), (F1 - F0, 0.024, 0.024), OAK, round_=0.005)
    for i in range(9):
        x = F0 + 0.02 + (F1 - F0 - 0.04) * i / 8
        rod('forecastle baluster', (x, FY + 0.27, z), (x, FY + 0.39, z), 0.009, OAK, top=0.007, sides=4)
# The catheads: two stout beams out over the bow either side.
for side in (1, -1):
    rod('cathead', (F0 + 0.12, FY + 0.2, side * (FH - 0.05)), (F0 - 0.08, FY + 0.24, side * (FH + 0.14)), 0.03, DARK, sides=4)
# The bowsprit, as steep as the lot allows, and the lantern on its bracket under it.
BS0 = (BOW_X + 0.08, sheer(BOW_X) - 0.05, 0)
BS1 = (-2.12, sheer(BOW_X) + 0.8, 0)       # inside the 11 x 6 lot at 2.5x
rod('bowsprit', BS0, BS1, 0.04, OAK, top=0.022, sides=8)
for f in (0.25, 0.5, 0.75):
    p = Vector(BS0).lerp(Vector(BS1), f)
    rod('bowsprit band', tuple(p), tuple(p + (Vector(BS1) - Vector(BS0)).normalized() * 0.025), 0.045 - 0.015 * f, IRON, sides=8)
BR0 = (BOW_X + 0.02, sheer(BOW_X) - 0.18, 0.12)
BR1 = (BOW_X - 0.07, sheer(BOW_X) - 0.18, 0.12)
rod('bow lantern bracket', BR0, BR1, 0.011, IRON, sides=4)
rod('bow lantern bracket stay', (BOW_X + 0.02, sheer(BOW_X) - 0.36, 0.12), (BOW_X - 0.16, sheer(BOW_X) - 0.19, 0.12), 0.008, IRON, sides=3)
lantern('bow lantern', BR1)
# The great Jolly Roger of the render: on a staff raked forward off the forecastle, flying aft.
JR0 = (F0 + 0.16, FY + 0.25, 0.05)
JR1 = (-2.06, FY + 1.65, 0.05)
rod('flag staff', JR0, JR1, 0.022, OAK, top=0.014, sides=6)
rod('flag staff truck', JR1, (JR1[0] - 0.02, JR1[1] + 0.05, JR1[2]), 0.025, GOLD, top=0.0, sides=4)

# ---- the lanterns at the corners ------------------------------------------------------------------
# Lanterns on the stern castle's three outer corners of its balustrade, on the forecastle's two bow
# corners, and one hung under the fore top: at night the windows alone left the upper works dark.
for cx, cz in ((C1 - 0.02, H1 - 0.06), (C1 - 0.02, -H1 + 0.06), (C0 + 0.02, H1 - 0.06)):
    post_lantern('castle lantern', (cx, RY + 0.05 + RH + 0.014, cz), 0.07, 1.0)
for cz in (-FH + 0.03, FH - 0.03):
    post_lantern('forecastle lantern', (F0 + 0.02, FY + 0.402, cz), 0.06, 0.9)

# ---- the deck: gratings, barrels, crates, coils ----------------------------------------------------
for x in (-0.55, 0.35):
    box('hatch', (x, deck_y(x) + 0.035, 0), (0.34, 0.07, 0.32), OAK, round_=0.01)
    for k in range(5):
        box('hatch grating', (x - 0.13 + 0.065 * k, deck_y(x) + 0.072, 0), (0.014, 0.005, 0.27), DARK)
for x, z in ((-1.05, -0.32), (-0.95, -0.36), (-1.0, -0.2), (0.62, 0.34), (0.55, 0.38)):
    rod('deck barrel', (x, deck_y(x), z), (x, deck_y(x) + 0.16, z), 0.06, OAK, top=0.054, sides=6)
    rod('deck barrel hoop', (x, deck_y(x) + 0.03, z), (x, deck_y(x) + 0.045, z), 0.062, IRON, sides=6, fill='NOTHING')
    rod('deck barrel hoop', (x, deck_y(x) + 0.115, z), (x, deck_y(x) + 0.13, z), 0.058, IRON, sides=6, fill='NOTHING')
for x, z, t in ((0.1, -0.35, 0.3), (-0.3, 0.32, -0.4)):
    box('deck crate', (x, deck_y(x) + 0.08, z), (0.16, 0.16, 0.16), OAK, turn=t, round_=0.008)
for x, z in ((-0.2, -0.3), (0.55, -0.28)):
    rod('deck coil', (x, deck_y(x), z), (x, deck_y(x) + 0.04, z), 0.08, ROPE, sides=8)
rod('capstan', (0.62, deck_y(0.62), -0.05), (0.62, deck_y(0.62) + 0.15, -0.05), 0.07, OAK, top=0.055, sides=8)
for k in range(4):
    a = k * math.pi / 4
    rod('capstan bar', (0.62 - 0.16 * math.cos(a), deck_y(0.62) + 0.13, -0.05 - 0.16 * math.sin(a)),
        (0.62 + 0.16 * math.cos(a), deck_y(0.62) + 0.13, -0.05 + 0.16 * math.sin(a)), 0.008, OAK, sides=3)

# ---- masts, yards, sails, rigging ---------------------------------------------------------------------
# Brown, patched, torn along the foot: the render's sails. The fore mast stands amidships with its
# course bellied hard and a topsail over it; the aft mast stands on the stern castle with a
# fighting top at its middle, its course furled, and a big topsail above.
BRACE = math.radians(-24)


def sail(name, x, y0, y1, w, belly=0.16, torn=0.0, mat=SAIL):
    dz, dx = math.cos(BRACE) * w / 2, math.sin(BRACE) * w / 2
    rod(name + ' yard', (x - dx * 1.14, y0 + 0.025, -dz * 1.14), (x + dx * 1.14, y0 + 0.025, dz * 1.14), 0.022, OAK, top=0.013, sides=6)
    for f in (-1.14, 1.14):
        rod(name + ' yard arm', (x + dx * f, y0 + 0.025, dz * f), (x + dx * f * 1.03, y0 + 0.025, dz * f * 1.03), 0.015, IRON, sides=4)
    rows, cols = 15, 21
    grid = []
    for j in range(rows):
        f = j / (rows - 1)
        y = y0 - (y0 - y1) * f
        row = []
        for i in range(cols):
            s = -1 + 2 * i / (cols - 1)
            bell = belly * (1 - s * s) * (0.3 + 0.7 * math.sin(math.pi * min(f, 0.999) * 0.85))
            bell += 0.016 * math.sin(s * math.pi * 3.5 + 0.7) * f * (1 - 0.4 * f)     # folds from the yard
            spread = 1 + 0.14 * f
            yy = y
            if j == rows - 1 and torn:
                yy += rng.uniform(0, torn) if i % 3 == 1 else rng.uniform(0, torn * 0.35)
            if j >= rows - 3 and torn and i in (cols // 4, cols // 4 + 1):
                yy += torn * 1.6 * (j - rows + 4) / 3                      # a rent up from the foot
            row.append((x + s * dx * spread - bell * math.cos(BRACE), yy, s * dz * spread + bell * math.sin(BRACE)))
        grid.append(row)
    cloth(name, grid, mat)
    for j in (3, 5):
        band = [Vector(p) + Vector((-0.009 * math.cos(BRACE), 0, 0.009 * math.sin(BRACE))) for p in grid[j]]
        sweep(name + ' reef band', [tuple(v) for v in band], [0.006] * len(band), SAIL_DARK, sides=3, cap=False)
    for i in (0, cols - 1):
        sweep(name + ' boltrope', [grid[j][i] for j in range(rows)], [0.007] * rows, ROPE, sides=3, cap=False)
    # a darker patch sewn on
    pj, pi_ = rows // 2, cols // 2 + 3
    patch = [[tuple(Vector(grid[j][i]) + Vector((-0.012 * math.cos(BRACE), 0, 0.012 * math.sin(BRACE)))) for i in range(pi_, pi_ + 3)] for j in range(pj, pj + 3)]
    cloth(name + ' patch', patch, SAIL_DARK, thick=0.004)


def furled(name, x, y, w):
    """A course furled on its yard: a fat roll of canvas under it, bound with gaskets."""
    dz, dx = math.cos(BRACE) * w / 2, math.sin(BRACE) * w / 2
    rod(name + ' yard', (x - dx * 1.1, y, -dz * 1.1), (x + dx * 1.1, y, dz * 1.1), 0.022, OAK, top=0.014, sides=6)
    pts = [(x + dx * f, y - 0.05 - 0.02 * (1 - f * f), dz * f) for f in [-1 + 2 * i / 10 for i in range(11)]]
    sweep(name + ' roll', pts, [0.03 + 0.03 * (1 - ((i - 5) / 5) ** 2) for i in range(11)], SAIL, sides=6)
    for f in (-0.7, -0.3, 0.1, 0.5, 0.85):
        p = (x + dx * f, y - 0.05, dz * f)
        rod(name + ' gasket', (p[0] - 0.004, p[1] - 0.07, p[2]), (p[0] + 0.004, p[1] + 0.03, p[2]), 0.05, ROPE, sides=4, fill='NOTHING')


def top_platform(name, x, y, r=0.22, rail=True):
    rod(name, (x, y, 0), (x, y + 0.04, 0), r, OAK, sides=8)
    rod(name + ' skirt', (x, y - 0.1, 0), (x, y, 0), 0.05, OAK, top=r * 0.9, sides=8)
    if rail:
        for k in range(16):
            a = k * math.tau / 16
            rod(name + ' baluster', (x + r * 0.92 * math.cos(a), y + 0.04, r * 0.92 * math.sin(a)),
                (x + r * 0.92 * math.cos(a), y + 0.17, r * 0.92 * math.sin(a)), 0.007, OAK, sides=3)
        rod(name + ' rail', (x, y + 0.16, 0), (x, y + 0.18, 0), r * 0.95, OAK, sides=8, fill='NOTHING')


def shrouds(name, x, top_y, n=4):
    """Shrouds from the chainwales to under the top, with deadeyes, chain plates and ratlines."""
    for side in (1, -1):
        ends = []
        for k in range(n):
            fx = x - 0.28 + 0.56 * k / (n - 1)
            foot, fn = hull_point(fx, 0.97, side)
            a = Vector((foot.x, sheer(fx) + 0.07, foot.z + side * 0.05))
            b = Vector((x - 0.05 + 0.1 * k / (n - 1), top_y - 0.03, side * 0.1))
            rod(name + ' shroud', tuple(a), tuple(b), 0.0055, ROPE, sides=3)
            rod(name + ' deadeye', tuple(a - Vector((0, 0, side * 0.012))), tuple(a + Vector((0, 0, side * 0.012))), 0.022, DARK, sides=4)
            rod(name + ' chain plate', tuple(a), (foot.x, sheer(fx) - 0.18, foot.z + side * (PROUD + 0.01)), 0.006, IRON, sides=3)
            ends.append((a, b))
        box(name + ' chainwale', (x, sheer(x) + 0.03, side * (hull_point(x, 0.97, 1)[0].z + 0.04)), (0.7, 0.03, 0.09), DARK, round_=0.006)
        for r in range(1, 17):
            f = r / 17
            pts = [a.lerp(b, f) for a, b in ends]
            for p, q in zip(pts, pts[1:]):
                rod(name + ' ratline', tuple(p), tuple(q), 0.0035, ROPE, sides=3)


FORE_X, AFT_X = -0.05, 1.18
FORE_TOP, AFT_TOP = 5.0, 4.72
rod('foremast', (FORE_X, deck_y(FORE_X) - 0.02, 0), (FORE_X, FORE_TOP, 0), 0.065, OAK, top=0.03, sides=8)
for y in (2.3, 2.8, 3.3, 4.0):
    rod('foremast band', (FORE_X, y, 0), (FORE_X, y + 0.025, 0), 0.068 - 0.008 * (y - 2.3), IRON, sides=8)
top_platform('fore top', FORE_X, 3.56)
rod('fore top lantern hook', (FORE_X, 3.46, 0.16), (FORE_X, 3.46, 0.24), 0.006, IRON, sides=3)
lantern('fore top lantern', (FORE_X, 3.44, 0.24), 0.9)
sail('fore course', FORE_X, 3.52, 2.62, 1.86, belly=0.2, torn=0.12)
sail('fore topsail', FORE_X, 4.32, 3.82, 1.35, belly=0.14, torn=0.06)
shrouds('fore', FORE_X, 3.56)
rod('aftmast', (AFT_X, RY + 0.04, 0), (AFT_X, AFT_TOP, 0), 0.055, OAK, top=0.026, sides=8)
for y in (3.0, 3.6, 4.1):
    rod('aftmast band', (AFT_X, y, 0), (AFT_X, y + 0.022, 0), 0.058 - 0.008 * (y - 3.0), IRON, sides=8)
top_platform('aft top', AFT_X, 3.16)
furled('aft course', AFT_X, 3.12, 1.5)
sail('aft topsail', AFT_X, 4.42, 3.36, 1.4, belly=0.2, torn=0.1)
rod('aft topgallant yard', (AFT_X - 0.15, 4.6, -0.36), (AFT_X + 0.15, 4.6, 0.36), 0.014, OAK, sides=4)
# Stays: fore top to the bowsprit, fore masthead to the flag staff, the two masts to each other,
# and the aft mast's backstays to the taffrail.
for a, b in (((FORE_X, FORE_TOP - 0.25, 0), BS1), ((FORE_X, 3.6, 0), tuple(Vector(BS0).lerp(Vector(BS1), 0.6))),
             ((FORE_X, 4.4, 0), JR1), ((AFT_X, AFT_TOP - 0.1, 0), (FORE_X, 4.3, 0)), ((AFT_X, 3.2, 0), (FORE_X, 3.0, 0)),
             ((AFT_X, AFT_TOP - 0.15, 0), (C1 - 0.05, RY + 0.2, 0.3)), ((AFT_X, AFT_TOP - 0.15, 0), (C1 - 0.05, RY + 0.2, -0.3)),
             ((FORE_X, 4.9, 0), (AFT_X, 4.65, 0))):
    rod('stay', a, b, 0.005, ROPE, sides=3)
# Loose ends: a few lines hanging slack from the yards, as in the render.
for x, y, z, L in ((FORE_X - 0.35, 3.5, 0.78, 0.55), (FORE_X + 0.3, 4.3, -0.55, 0.4), (AFT_X + 0.3, 4.4, -0.6, 0.5)):
    sweep('slack line', [(x, y, z), (x + 0.03, y - L * 0.5, z + 0.03), (x - 0.02, y - L, z + 0.02)], [0.004] * 3, ROPE, sides=3, cap=False)

# ---- the Jolly Rogers ---------------------------------------------------------------------------------


def jolly_roger(name, at, fw, fh, direction=1, tails=False):
    """A flag flying from `at` (its luff at the staff) towards +x (direction 1) or -x, cloth and
    skull on both faces; `tails` cuts a swallow-tail in the fly."""
    x0, y0, z0 = at
    cols, rows = 7, 5
    grid = []
    for j in range(rows):
        f = j / (rows - 1)
        row = []
        for i in range(cols):
            u = i / (cols - 1)
            ripple = 0.035 * math.sin(u * math.pi * 2.2 + 0.5) * u
            droop = 0.05 * u * u
            yy = y0 - fh * f - droop
            row.append((x0 + direction * fw * u, yy, z0 + ripple))
        grid.append(row)
    if tails:
        # pull the middle of the fly in, which makes the swallow-tail
        mid = rows // 2
        grid[mid][-1] = (x0 + direction * fw * 0.78, grid[mid][-1][1], grid[mid][-1][2])
    cloth(name, grid, FLAG, thick=0.01)
    ex, ey = x0 + direction * fw * 0.45, y0 - fh * 0.48
    k = fh / 0.22
    for s in (1, -1):
        zz = z0 + 0.035 * math.sin(0.45 * math.pi * 2.2 + 0.5) * 0.45 + s * 0.012
        for sgn in (-1, 1):
            a = (ex - sgn * 0.085 * k, ey - 0.075 * k, zz)
            b = (ex + sgn * 0.085 * k, ey + 0.055 * k, zz)
            rod(name + ' crossbone', a, b, 0.008 * k, BONE, sides=3)
            for end in (a, b):
                ball(name + ' knuckle', end, (0.013 * k, 0.013 * k, 0.005), BONE, seg=3, rings=2)
        half = [(0, .05), (.026, .045), (.041, .03), (.045, .01), (.038, -.01), (.033, -.02), (.031, -.035), (.016, -.042)]
        outline = [(x * k, (.012 + y) * k) for x, y in half] + [(-x * k, (.012 + y) * k) for x, y in reversed(half[1:])]
        plate(name + ' skull', outline, ex, ey, zz + s * 0.004, 0.003, BONE)
        for sx in (-1, 1):
            hexagon = [(.0125 * k * math.cos(i * math.tau / 6), .0125 * k * math.sin(i * math.tau / 6)) for i in range(6)]
            plate(name + ' socket', hexagon, ex + sx * .017 * k, ey + .024 * k, zz + s * 0.0068, 0.002, FLAG)


jolly_roger('great jolly roger', (JR1[0] + 0.03, JR1[1] - 0.08, JR1[2]), 0.62, 0.52, 1)
jolly_roger('fore jolly roger', (FORE_X + 0.03, FORE_TOP - 0.02, 0), 0.5, 0.3, 1, tails=True)
rod('fore truck', (FORE_X, FORE_TOP, 0), (FORE_X, FORE_TOP + 0.05, 0), 0.03, GOLD, top=0.0, sides=4)

# ---- the kraken, still holding on ---------------------------------------------------------------------
# Four arms, up out of the rock: two on the water side, round the bow and over the waist, one over
# the land side's rail and one round the stern. Swept tubes tapering to a curl, suckers inside.


def tentacle(name, pts, r0, suck_side):
    radii = [r0 * (1 - 0.9 * i / (len(pts) - 1)) for i in range(len(pts))]
    sweep(name, pts, radii, KRAKEN, ship=False, sides=7)
    for i in range(1, len(pts) - 2):
        p, q = Vector(pts[i]), Vector(pts[i + 1])
        m = (p + q) / 2
        t = (q - p).normalized()
        off = t.cross(Vector((0, 0, 1))).normalized() * suck_side
        if off.length < 0.1:
            off = Vector((0, -1, 0))
        rr = radii[i] * 0.36
        ball(name + ' sucker', tuple(m + off * (radii[i] * 0.86)), (rr, rr, rr), SUCKER, ship=False, seg=3, rings=2)


def curve(p0, p1, p2, p3, n=10):
    out = []
    for i in range(n):
        t = i / (n - 1)
        a = [(1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t * t, t ** 3]
        out.append(tuple(sum(w * c[k] for w, c in zip(a, (p0, p1, p2, p3))) for k in range(3)))
    return out


def through(ctrl, n):
    """A smooth path through control points (Catmull-Rom), n points along it."""
    out = []
    segs = len(ctrl) - 1
    for i in range(n):
        u = i / (n - 1) * segs
        k = min(int(u), segs - 1)
        t = u - k
        p0, p1, p2, p3 = (Vector(ctrl[max(k - 1, 0)]), Vector(ctrl[k]), Vector(ctrl[k + 1]), Vector(ctrl[min(k + 2, segs)]))
        v = 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (3 * p1 - p0 - 3 * p2 + p3) * t * t * t)
        out.append(tuple(v))
    return out


# Each arm comes up out of the rock, climbs the hull's side, hooks over the gunwale onto the deck
# and ends in a curl; the first straight versions read as purple poles leant against the ship.
ARMS = [
    ([(-1.62, 0.3, 0.62), (-1.78, 0.9, 0.98), (-1.66, 1.6, 0.9), (-1.52, 2.14, 0.66), (-1.42, 2.34, 0.4),
      (-1.3, 2.26, 0.2), (-1.22, 2.1, 0.26), (-1.28, 2.02, 0.36), (-1.36, 2.07, 0.33)], 0.12, 1),
    ([(-0.97, 0.3, 0.74), (-0.85, 1.0, 1.02), (-1.01, 1.62, 0.96), (-1.17, 2.08, 0.7), (-1.25, 2.3, 0.44),
      (-1.35, 2.2, 0.22), (-1.29, 2.06, 0.15), (-1.21, 2.1, 0.24), (-1.25, 2.17, 0.27)], 0.1, -1),
    ([(0.2, 0.3, -0.76), (0.28, 1.0, -1.04), (0.12, 1.7, -0.95), (-0.05, 2.15, -0.68), (-0.15, 2.33, -0.42),
      (-0.28, 2.22, -0.22), (-0.22, 2.08, -0.16), (-0.13, 2.12, -0.24), (-0.17, 2.19, -0.28)], 0.11, -1),
    ([(1.8, 0.3, -0.62), (2.02, 0.95, -0.9), (1.92, 1.6, -0.86), (1.76, 2.1, -0.6), (1.66, 2.3, -0.36),
      (1.54, 2.22, -0.2), (1.6, 2.08, -0.14), (1.69, 2.12, -0.22), (1.64, 2.19, -0.26)], 0.09, 1),
]
for ctrl, r0, side in ARMS:
    tentacle('kraken arm', through(ctrl, 46), r0, side)

# ---- the rock ---------------------------------------------------------------------------------------------
# Heaped under the whole keel as the render has it: big jagged boulders carrying the hull, more
# of them round the stern and under the stair, the pile running out in stones over the ground,
# cut level at the ground (an asset's lowest point is y = 0), and low at the back of the lot
# (the chest stands behind the pub, shared/treasure.mjs chestSpots).


def boulder(name, p, s, mat=ROCK, jag=0.22, subdiv=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1, location=xyz(p))
    o = bpy.context.object
    o.rotation_euler = (rng.uniform(0, 3), rng.uniform(0, 3), rng.uniform(0, 3))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)
    me = o.data
    for v in me.vertices:
        f = 1 + rng.uniform(-jag, jag * 0.6)
        v.co = Vector((v.co.x * s[0] * f, v.co.y * s[2] * f, v.co.z * s[1] * f))
    bpy.context.view_layer.update()
    for v in me.vertices:
        w = o.matrix_world @ v.co
        if w.z < 0:
            v.co.z -= w.z
    me.update()
    return link(o, name, mat, False)


BIG = [(-1.7, 0.02, .45, .70, .50), (-1.2, -0.05, .52, .80, .55), (-0.6, 0.05, .55, .76, .58),
       (0.0, -0.04, .55, .74, .56), (0.6, 0.04, .55, .76, .56), (1.2, -0.03, .52, .82, .54),
       (1.75, 0.05, .46, .78, .50), (2.0, 0.3, .30, .52, .34), (1.5, 0.62, .36, .62, .34),
       (-1.0, 0.6, .34, .42, .30), (-1.96, 0.3, .28, .40, .30), (0.4, 0.66, .30, .40, .28)]
for x, z, sx, sy, sz in BIG:
    boulder('rock', (x, sy * 0.5, z), (sx, sy, sz), rng.choice((ROCK, ROCK, ROCK_DARK)), subdiv=3)
MEDIUM = [(-2.12, -0.35, .2, .24, .2), (-0.3, -0.72, .24, .22, .2), (0.9, -0.74, .22, .2, .2), (1.9, -0.6, .22, .24, .2),
          (-1.5, 0.82, .2, .2, .18), (2.18, 0.72, .16, .18, .16), (1.95, 0.95, .18, .15, .16), (-0.25, 0.9, .16, .14, .15),
          (2.16, -0.2, .16, .3, .2), (-2.18, 0.62, .16, .16, .14), (0.2, 0.98, .12, .1, .12)]   # none at the stair's foot
for x, z, sx, sy, sz in MEDIUM:
    boulder('rock', (x, sy * 0.35, z), (sx, sy, sz), rng.choice((ROCK, ROCK_DARK)), subdiv=3)
for i in range(26):
    x = -2.15 + 4.3 * rng.random()
    z = rng.choice((1, 1, -1)) * (0.85 + 0.35 * rng.random())
    r = 0.03 + 0.05 * rng.random()
    if -0.8 < x < 1.15 and z > 0.6:
        continue                     # the ground along the stair stays clear
    boulder('stone', (x, r * 0.4, max(min(z, 1.24), -1.1)), (r * 1.3, r, r), rng.choice((ROCK, ROCK_DARK)), jag=0.25, subdiv=1)
for i in range(18):
    x = -1.9 + 3.8 * i / 17 + rng.uniform(-0.08, 0.08)
    zb, yb, mb = 0.9 + rng.uniform(-0.1, 0.12), rng.uniform(0.04, 0.16), rng.choice((BARNACLE, MOSS))
    if -0.8 < x < 1.15:
        continue                     # not along the stair
    ball('barnacle', (x, yb, zb), (0.03, 0.025, 0.03), mb, ship=False, seg=3, rings=2)

# ---- the chimney -----------------------------------------------------------------------------------------
# An old cannon barrel stood on end through the castle roof, smoking.
CHM = (C0 + 0.18, RY + 0.05, 0.22)
rod('cannon chimney', CHM, (CHM[0], CHM[1] + 0.36, CHM[2]), 0.055, IRON, top=0.046, sides=6)
rod('cannon chimney ring', (CHM[0], CHM[1] + 0.32, CHM[2]), (CHM[0], CHM[1] + 0.36, CHM[2]), 0.062, IRON, sides=6)
SMOKE = (CHM[0], CHM[1] + 0.4, CHM[2])

# ---- the heel, and then two and a half times the size ------------------------------------------------
# Everything above is the ship of render 17 at the size it was first built, and it is set down on
# the island two and a half times larger (the keeper, in the game: "hij is veel te klein"), on an
# 11 x 6 lot. What a settler touches is built after this, at a settler's size: the door, the
# stair, its rails, the lanterns by them, the sign on its post, the barrels at the foot.
SCALE = 2.5
LOT_HALF_X, LOT_HALF_Z = 5.5 - 0.15, 3.0 - 0.15
bpy.context.view_layer.update()
for o in SHIP_PARTS:
    o.matrix_world = _heel @ o.matrix_world
_scale = Matrix.Diagonal((SCALE, SCALE, SCALE, 1))
for o in list(bpy.context.scene.objects):
    if o.type == 'MESH':
        o.matrix_world = _scale @ o.matrix_world


def world_of(p):
    """A point of the ship as it was drawn, where it is on the island now: heeled, then scaled."""
    v = _scale @ (_heel @ Vector(xyz(p)))
    return Vector((v.x, v.z, -v.y))


# ---- the door, cut in the hull under the stern castle ----------------------------------------------
# Halfway up the hull's side, where it stands plumb, at a settler's size.
DOOR_H, DOOR_W = 0.56, 0.3
_dc = world_of(hull_point(0.98, 0.5, 1)[0])
DX = _dc.x
DOOR_SILL = _dc.y - DOOR_H * 0.5
HZ = _dc.z + 0.02                      # the hull's outside at the door
DOOR_Z = HZ + 0.02
door_outline = [(-DOOR_W / 2, 0), (DOOR_W / 2, 0)] + [(DOOR_W / 2 * c, DOOR_H - DOOR_W / 2 + DOOR_W / 2 * s) for c, s in ARCH]
plate('door recess', [(u * 1.3, v * 1.08 - 0.02) for u, v in door_outline], DX, DOOR_SILL, DOOR_Z, 0.06, DARK, ship=False)
plate('door', door_outline, DX, DOOR_SILL, DOOR_Z + 0.034, 0.02, HULL, ship=False)
for k in range(1, 5):
    u = -DOOR_W / 2 + DOOR_W * k / 5
    box('door seam', (DX + u, DOOR_SILL + DOOR_H * 0.45, DOOR_Z + 0.045), (0.006, DOOR_H * 0.85, 0.004), DARK, ship=False)
for y in (0.12, 0.34):
    box('door band', (DX, DOOR_SILL + y, DOOR_Z + 0.047), (DOOR_W * 0.94, 0.024, 0.008), IRON, ship=False)
    for u in (-0.1, 0.0, 0.1):
        ball('door stud', (DX + u, DOOR_SILL + y, DOOR_Z + 0.053), (0.008, 0.008, 0.005), IRON, ship=False, seg=3, rings=2)
rod('door ring', (DX + 0.08, DOOR_SILL + 0.28, DOOR_Z + 0.046), (DX + 0.08, DOOR_SILL + 0.28, DOOR_Z + 0.06), 0.03, GOLD, ship=False, sides=6, fill='NOTHING')
ball('door skull', (DX, DOOR_SILL + DOOR_H + 0.08, DOOR_Z + 0.04), (0.07, 0.075, 0.05), BONE, ship=False, seg=5, rings=4)
for sx in (-1, 1):
    ball('door skull socket', (DX + sx * 0.025, DOOR_SILL + DOOR_H + 0.09, DOOR_Z + 0.08), (0.017, 0.019, 0.012), VOID, ship=False, seg=3, rings=2)
LX = DX - 0.3
rod('door lantern bracket', (LX, DOOR_SILL + 0.55, DOOR_Z - 0.01), (LX, DOOR_SILL + 0.55, DOOR_Z + 0.13), 0.008, IRON, ship=False, sides=3)
lantern('door lantern', (LX, DOOR_SILL + 0.55, DOOR_Z + 0.13), 1.05, ship=False)

# ---- the stair: a zigzag up the rock, walked as well as drawn ------------------------------------------
# Two flights along the water flank, at about 31 degrees: the lower from its foot (east) up to a
# landing (west), the upper back east from the landing to the stoop at the door. Each is a floor
# walk mode stands you on (anchor.deck.<name>.lo|hi for a floor, anchor.stair.<name>.lo|hi for a ramp
# with `lo` at its foot - the ship's own vocabulary, scripts/model-rules.mjs - read by
# web/js/buildings.js as `surfaces`), and each is drawn
# as treads a settler's step apart on two stringers, with a rail on its open side.
Y = DOOR_SILL
STAIR_W, GAP, LAND_L, STOOP_L = 0.42, 0.06, 0.62, 0.7
RUN = (Y / 2) / math.tan(math.radians(31))
UZ0 = HZ + 0.14                    # clear of the hull's own solid (web/js/buildings.js pirateSolids)
UZ1 = UZ0 + STAIR_W
WZ0, WZ1 = UZ1 + GAP, UZ1 + GAP + STAIR_W
XE = DX - STOOP_L / 2              # the upper flight's top and the lower flight's foot
XLE = XE - RUN                     # the landing's east edge
XLW = XLE - LAND_L
SURFACES = {
    'stoop': ((XE, Y, HZ + 0.02), (XE + STOOP_L, Y, UZ1)),
    'up': ((XLE, Y / 2, UZ0), (XE, Y, UZ1)),
    'land': ((XLW, Y / 2, UZ0), (XLE, Y / 2, WZ1)),
    'down': ((XE, 0.0, WZ0), (XLE, Y / 2, WZ1)),
}
RISE = 0.085


def flight(name, lo, hi, z0, z1):
    """Treads from the lo end (x, y) to the hi end, two planks a tread, on two stringers."""
    (x0, y0), (x1, y1) = lo, hi
    n = max(2, round(abs(y1 - y0) / RISE))
    run = (x1 - x0) / n
    for i in range(n):
        # each tread's top at the height the ramp has over its middle, so a foot on the drawing is
        # a foot on the floor walk mode gives it
        xm = x0 + run * (i + 0.5)
        ym = y0 + (y1 - y0) * (i + 0.5) / n
        for half in (0, 1):
            zc = z0 + (z1 - z0) * (0.25 + 0.5 * half)
            box(name + ' tread', (xm, ym - 0.018, zc), (abs(run) + 0.012, 0.035, (z1 - z0) / 2 - 0.012), TREAD, ship=False, round_=0.005)
    for z in (z0 + 0.03, z1 - 0.03):
        # never below the ground at the foot: every asset's lowest point is y = 0
        sweep(name + ' stringer', [(x0, max(y0 - 0.06, 0.035), z), (x1, max(y1 - 0.06, 0.035), z)], [0.03, 0.03], POST, ship=False, sides=4)


flight('stair lower', (XE, 0.0), (XLE, Y / 2), WZ0, WZ1)
flight('stair upper', (XLE, Y / 2), (XE, Y), UZ0, UZ1)
box('stair landing', ((XLW + XLE) / 2, Y / 2 - 0.02, (UZ0 + WZ1) / 2), (LAND_L, 0.04, WZ1 - UZ0), TREAD, ship=False, round_=0.006)
box('stair stoop', (XE + STOOP_L / 2, Y - 0.02, (HZ + 0.02 + UZ1) / 2), (STOOP_L, 0.04, UZ1 - HZ - 0.02), TREAD, ship=False, round_=0.006)
# What carries the landing and the stoop: posts down to the ground.
for x, z in ((XLW + 0.05, WZ1 - 0.05), (XLE - 0.05, WZ1 - 0.05), (XLW + 0.05, UZ0 + 0.05)):
    rod('stair landing post', (x, 0, z), (x, Y / 2 - 0.04, z), 0.03, POST, ship=False, sides=4)
for x in (XE + 0.06, XE + STOOP_L - 0.06):
    rod('stair stoop post', (x, 0, UZ1 - 0.04), (x, Y - 0.04, UZ1 - 0.04), 0.03, POST, ship=False, sides=4)
# Rails: on the lower flight's water side, round the landing's open sides, on the upper flight's
# water side (the drop to the lower flight) and round the stoop.
RAIL_H = 0.32
RAILS = []


def rail(name, pts, posts_every=0.55):
    """A rail at RAIL_H over a polyline of (x, y, z) floor points, with posts along it."""
    path = [Vector(p) for p in pts]
    posts = [path[0]]
    for a, b in zip(path, path[1:]):
        n = max(1, round((b - a).length / posts_every))
        posts += [a.lerp(b, k / n) for k in range(1, n + 1)]
    for p in posts:
        rod(name + ' post', (p.x, max(p.y - 0.03, 0.0), p.z), (p.x, p.y + RAIL_H, p.z), 0.017, POST, ship=False, sides=4)
    for lift, r in ((RAIL_H, 0.016), (RAIL_H * 0.5, 0.01)):
        sweep(name, [(p.x, p.y + lift, p.z) for p in path], [r] * len(path), POST, ship=False, sides=4, cap=False)
    # and every segment as a pair of anchors, the floor under each end: web/js/buildings.js makes a
    # wall of it at that height, so the rail you see is a rail you are stopped by
    for a, b in zip(path, path[1:]):
        k = len(RAILS)
        RAILS.append((a, b))
    return posts


lower_posts = rail('stair lower rail', [(XE, 0.0, WZ1 + 0.02), (XLE, Y / 2, WZ1 + 0.02), (XLW, Y / 2, WZ1 + 0.02), (XLW, Y / 2, UZ0)])
rail('stair upper rail', [(XLE, Y / 2, UZ1 + 0.03), (XE, Y, UZ1 + 0.03), (XE + STOOP_L, Y, UZ1 + 0.03), (XE + STOOP_L, Y, HZ + 0.04)])
post_lantern('stair foot lantern', (XE, RAIL_H - 0.02, WZ1 + 0.02), 0.03, 1.0, ship=False)
post_lantern('stair landing lantern', (XLW, Y / 2 + RAIL_H - 0.02, WZ1 + 0.02), 0.03, 1.0, ship=False)
post_lantern('stair stoop lantern', (XE + STOOP_L, Y + RAIL_H - 0.02, UZ1 + 0.03), 0.03, 0.95, ship=False)

# ---- the rock under the stair, and the rock kept inside the lot -------------------------------------------
# A few boulders of its own under the lower flight and the landing, and then every rock that
# reaches under a tread cut off below it: the drawn stair lies on the rock, and walk mode's floor is
# the stair's. Those rocks are renamed `stair rock`, which web/js/buildings.js leaves out of the
# solids - the stair is walked over them, and a low solid under the high end of each flight keeps
# anybody from walking underneath instead. Every rock is also kept inside the lot.
for f, r in ((0.25, 0.32), (0.5, 0.42), (0.78, 0.46)):
    x = XE + (XLE - XE) * f
    boulder('stair rock', (x, 0.0, (WZ0 + WZ1) / 2 - 0.05), (r * 1.2, Y / 2 * f + 0.1, r), ROCK_DARK, jag=0.15, subdiv=2)
boulder('stair rock', ((XLW + XLE) / 2, 0.0, (UZ0 + WZ1) / 2), (0.55, Y / 2, 0.55), ROCK_DARK, jag=0.15, subdiv=2)


def floor_under(x, z):
    """The stair's floor over (x, z), or None off it."""
    best = None
    for (lo, hi) in SURFACES.values():
        x0, x1 = sorted((lo[0], hi[0]))
        z0, z1 = sorted((lo[2], hi[2]))
        if not (x0 - 0.12 <= x <= x1 + 0.12 and z0 - 0.12 <= z <= z1 + 0.12):
            continue
        t = 0.0 if hi[0] == lo[0] else min(max((x - lo[0]) / (hi[0] - lo[0]), 0.0), 1.0)
        y = lo[1] + (hi[1] - lo[1]) * t
        best = y if best is None else min(best, y)
    return best


bpy.context.view_layer.update()
for o in list(bpy.context.scene.objects):
    if o.type != 'MESH' or not any(k in o.name for k in ('rock', 'stone')):
        continue
    me = o.data
    mw, inv = o.matrix_world, o.matrix_world.inverted()
    cut = False
    for v in me.vertices:
        w = mw @ v.co
        x, y, z = w.x, w.z, -w.y
        cap = floor_under(x, z)
        if cap is not None and y > cap - 0.08:
            y, cut = max(cap - 0.08, 0.0), True
        x = min(max(x, -LOT_HALF_X), LOT_HALF_X)
        z = min(max(z, -LOT_HALF_Z), LOT_HALF_Z)
        v.co = inv @ Vector((x, -z, y))
    me.update()
    if cut and 'stair rock' not in o.name:
        n = _count.get('stair rock', 0)
        _count['stair rock'] = n + 1
        o.name = 'Salty stair rock' + (f' {n}' if n else '')

# ---- at the foot of the stair: the sign on its post, barrels, a crate, rope ---------------------------
# The sign (web/js/piratesign.js) stands on its own post beside the stair's foot, its arm out east
# over the way in and its board facing the water, where the island's camera reads it.
FOOT = (XE + 0.3, 0.0, (WZ0 + WZ1) / 2)
SIGN_POST = (XE + 0.12, 0.0, WZ1 + 0.16)
box('sign post', (SIGN_POST[0], 0.56, SIGN_POST[2]), (0.075, 1.12, 0.075), POST, ship=False, round_=0.008)
box('sign post cap', (SIGN_POST[0], 1.13, SIGN_POST[2]), (0.1, 0.03, 0.1), POST, ship=False, round_=0.006)
rod('sign post brace', (SIGN_POST[0] + 0.035, 0.72, SIGN_POST[2]), (SIGN_POST[0] + 0.2, 0.975, SIGN_POST[2]), 0.012, POST, ship=False, sides=4)
SIGN_AT = (SIGN_POST[0] + 0.04, 0.98, SIGN_POST[2])
box('sign wall plate', (SIGN_AT[0] - 0.003, SIGN_AT[1], SIGN_AT[2]), (0.008, 0.1, 0.07), IRON, ship=False)
for x, z in ((XE + 0.95, WZ1 - 0.05), (XE + 1.17, WZ1 - 0.12)):
    rod('barrel', (x, 0, z), (x, .27, z), .105, OAK, ship=False, top=.095, sides=8)
    for y in (.05, .20):
        rod('barrel hoop', (x, y, z), (x, y + .022, z), .108, IRON, ship=False, sides=8, fill='NOTHING')
    rod('barrel lid', (x, .268, z), (x, .28, z), .09, DARK, ship=False, sides=8)
box('crate', (XE + 1.02, 0.1, WZ1 - 0.36), (.2, .2, .2), OAK, ship=False, turn=.3, round_=.01)
rod('rope coil', (XE + 1.42, 0, WZ1 - 0.02), (XE + 1.42, .045, WZ1 - 0.02), .085, ROPE, ship=False, sides=8)

# ---- anchors ----------------------------------------------------------------------------------------
# anchor.door is where a settler stands to go in: on the ground at the foot of the stair. The
# stair's floors go out as corner pairs; the hull's own solid (its footprint, from keel to the
# castle's roof) as another, since the hull has no vertex a settler's height off the ground and
# would otherwise be no wall to somebody on the stair.
anchors = {'smoke': world_of(SMOKE), 'sign': Vector(SIGN_AT), 'door': Vector(FOOT)}
for name, (lo, hi) in SURFACES.items():
    kind = 'deck' if lo[1] == hi[1] else 'stair'
    anchors[f'{kind}.{name}.lo'] = Vector(lo)
    anchors[f'{kind}.{name}.hi'] = Vector(hi)
for k, (a, b) in enumerate(RAILS):
    anchors[f'rail.{k}.a'] = a
    anchors[f'rail.{k}.b'] = b
anchors['solid.hull.lo'] = Vector((world_of((BOW_X + 0.35, 0, 0)).x, world_of((0, KEEL_Y, 0)).y, -(HZ - 0.06)))
anchors['solid.hull.hi'] = Vector((world_of((STERN_X, 0, 0)).x, world_of((0, RY + 0.2, 0)).y, HZ - 0.06))
for name, q in anchors.items():
    bpy.ops.object.empty_add(location=xyz(tuple(q)))
    bpy.context.object.name = 'anchor.' + name

bpy.context.view_layer.update()
top = max((o.matrix_world @ Vector(c)).z for o in bpy.context.scene.objects if o.type == 'MESH' for c in o.bound_box)
# A hair over the highest point: a height exactly on it reads as below it in float32.
bpy.context.scene['building_height'] = round(top + .01, 3)
if not PREVIEW_ONLY:
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-piratetavern.blend'))
    # Four decimals (0.4 mm on the island), as the hall inside: at six this module was 11.7 MB.
    runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'piratetavern', 'DIGITS': 4})
