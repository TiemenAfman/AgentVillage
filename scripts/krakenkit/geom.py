"""Shared geometry for the Salty Kraken's inside: materials, the bmesh buckets and every small
turned or carved thing (candles, bottles, skulls, chests, lanterns...). Used by
scripts/build-piratetavern-room.py (the hall) and by every object in scripts/krakenkit/ (the ship's
parts the hall is furnished with), so that a candle is the same candle everywhere.

Everything is modelled in island coordinates (x east, y up, z south = the front) and turned into
Blender's at `flush`. See build-piratetavern-room.py for why every primitive is a closed bmesh.
"""
import bpy
import bmesh
import math
import random
from mathutils import Matrix, Vector

TAU, PI = math.tau, math.pi
F = .06                     # interior.js FLOOR: the top of a room's floor

# ---- materials -------------------------------------------------------------------------------
# Dark ship's timber, but not black: seven lamps light a hall nine units across, and the first
# thing the keeper missed in the old room was being able to see the gold.
COLORS = {
    'plank:tar': 0x2e2219, 'plank:hull': 0x6e4c31, 'plank:deck': 0x5e3e27, 'plank:stage': 0x7a5434,
    'plankZ:ceiling': 0x3b281b, 'plankZ:beam': 0x2e1f15, 'plank:beam': 0x2e1f15,
    'plank:oak': 0x845335, 'plank:bar': 0x4a2e1c, 'plank:table': 0x7a5232, 'plank:chest': 0x6a4428,
    'plank:juke': 0x4a2616,
    'plain:rib': 0x33231a, 'plain:darkwood': 0x3a261a, 'plain:wood': 0x6b4a2f, 'plain:panel': 0x5e3a22,
    'plain:carved': 0x7a4e2c,
    'stone:hearth': 0x80766b, 'stone:cellar': 0x6a625a, 'stone:flags': 0x5f5850,
    'stone:rock': 0x55535a, 'stone:rock-warm': 0x6a5e50,
    'plain:soot': 0x1c1410, 'plain:iron': 0x2c2d2f, 'plain:brass': 0xc9a13b, 'plain:bronze': 0xa0703a,
    'plain:gold': 0xd9a33d, 'plain:gold-hi': 0xf0c24a, 'plain:silver': 0xc9ccd2,
    'plain:bone': 0xe6dcc4, 'plain:black': 0x151417, 'plain:wax': 0xf0e2c8,
    'plain:bottle-green': 0x2f5a36, 'plain:bottle-brown': 0x6a3e22, 'plain:rum': 0x8a4a1a,
    'plain:bottle-blue': 0x2a4a7a, 'plain:bottle-clear': 0xa8b8a0, 'plain:stoneware': 0xd8c8a8,
    'plain:cork': 0x9a7a4a, 'plain:ale': 0xc98a2a,
    'plain:rope': 0xb89a68, 'plain:net': 0x7a6a4c, 'plain:float-teal': 0x2ec4b6, 'plain:float-green': 0x5aa060,
    'plain:velvet': 0x8e2f3a, 'plain:rug': 0x6a2a2e, 'plain:rug-border': 0xb8862f,
    'plain:parchment': 0xe8d9b0, 'plain:ink': 0x4a3a2a, 'plain:flag': 0x1c1d22, 'plain:sack': 0x9a7a4a,
    'plain:globe': 0x3a6a7a, 'plain:land': 0x8a8a4a, 'plain:starfish': 0xd9703a, 'plain:shell': 0x8a8a80,
    'plain:pearl': 0xf2ece0, 'plain:cloth': 0x2a2a30, 'plain:sail': 0xcdbb92, 'plain:sail-red': 0x8a2f2a,
    # What glows (emissive 1 in the bake; pirate-tavern.js turns the broad ones down).
    'plain:flame': 0xffd23a, 'plain:socket': 0xffa030, 'plain:glass': 0xffc070,
    'plain:ruby': 0xc8323c, 'plain:emerald': 0x2f9a58, 'plain:sapphire': 0x2f5fc8, 'plain:amethyst': 0x9a4ad0,
    'plain:niche-purple': 0x7a44c0, 'plain:niche-teal': 0x22b8c8, 'plain:pane': 0x24346e,
    'plain:tube-purple': 0xb050ff, 'plain:tube-teal': 0x30f0e0, 'plain:juke-window': 0xffb050,
}
GLOW = {'plain:flame', 'plain:socket', 'plain:glass', 'plain:ruby', 'plain:emerald', 'plain:sapphire',
        'plain:amethyst', 'plain:niche-purple', 'plain:niche-teal', 'plain:pane', 'plain:tube-purple',
        'plain:tube-teal', 'plain:juke-window'}
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
    m['emissive'] = 1.0 if name in GLOW else 0.0
    materials[name] = m

def material(name, hex, glow=False, ao=True):
    """A colour of an object's own (`plank:figurehead`), made once. The shared ones above stay the
    shared ones; an object that needs another adds it here from its own module. `ao=False` keeps
    bake_ao off it: polished gold among candles was shaded to brown."""
    if name in materials:
        return name
    m = bpy.data.materials.new(name)
    rgb = [((hex >> s) & 255) / 255 for s in [16, 8, 0]]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m['emissive'] = 1.0 if glow else 0.0
    if not ao:
        m['no_ao'] = 1
    materials[name] = m
    if glow:
        GLOW.add(name)
    return name


TAR, HULLW, DECKP, STAGEP = 'plank:tar', 'plank:hull', 'plank:deck', 'plank:stage'
CEIL, BEAMZ, BEAMX = 'plankZ:ceiling', 'plankZ:beam', 'plank:beam'
OAK, BARW, TABLEW, CHESTW, JUKEW = 'plank:oak', 'plank:bar', 'plank:table', 'plank:chest', 'plank:juke'
RIB, DARK, WOOD, PANEL, CARVED = 'plain:rib', 'plain:darkwood', 'plain:wood', 'plain:panel', 'plain:carved'
HEARTH, CELLAR, FLAGS = 'stone:hearth', 'stone:cellar', 'stone:flags'
SOOT, IRON, BRASS, BRONZE = 'plain:soot', 'plain:iron', 'plain:brass', 'plain:bronze'
GOLD, GOLDHI, SILVER = 'plain:gold', 'plain:gold-hi', 'plain:silver'
BONE, BLACK, WAX = 'plain:bone', 'plain:black', 'plain:wax'
ROPE, NET, VELVET, RUG, RUGB = 'plain:rope', 'plain:net', 'plain:velvet', 'plain:rug', 'plain:rug-border'
PARCH, INK, FLAG, SACK, PEARL, CLOTH = 'plain:parchment', 'plain:ink', 'plain:flag', 'plain:sack', 'plain:pearl', 'plain:cloth'
FLAME, SOCKET, GLASS, PANE = 'plain:flame', 'plain:socket', 'plain:glass', 'plain:pane'
GEMS = ['plain:ruby', 'plain:emerald', 'plain:sapphire', 'plain:amethyst']
BOTTLES = ['plain:bottle-green', 'plain:bottle-brown', 'plain:rum', 'plain:bottle-blue', 'plain:bottle-clear']

# ---- geometry: everything goes into a bmesh per (group, material) ----------------------------
# One Blender object per primitive was the exterior's way, and at a few thousand coins it is
# minutes of operator calls. So a primitive is a bmesh of its own, closed, its faces turned
# outward by recalc_face_normals (which is why every shape here is a closed solid, the niche's
# vault and the sloop's hull included), and then poured into its bucket.
BUCKETS, SOLO = {}, []
_frames = [Matrix()]
_group = ['room']


class frame:
    """Model a piece in its own frame: everything emitted inside goes through `m` first."""
    def __init__(self, m):
        self.m = m

    def __enter__(self):
        _frames.append(_frames[-1] @ self.m)

    def __exit__(self, *_):
        _frames.pop()


class group:
    """What is emitted inside goes into parts named after `name` rather than the current group:
    `roof` is the lid interior.js takes off, `near` the walls the hall's cutaway preview leaves
    out (scripts/preview-krakenroom.py). Merged parts lose their labels, so a group is the way to
    keep a set of pieces apart."""
    def __init__(self, name):
        self.name = name

    def __enter__(self):
        _group.append(self.name)

    def __exit__(self, *_):
        _group.pop()


class lid(group):
    """What is emitted inside belongs to the roof (see the top)."""
    def __init__(self):
        super().__init__('roof')


def M(at=(0, 0, 0), turn=0.0, tilt=0.0, roll=0.0, scale=None):
    m = (Matrix.Translation(Vector(at)) @ Matrix.Rotation(turn, 4, 'Y')
         @ Matrix.Rotation(tilt, 4, 'X') @ Matrix.Rotation(roll, 4, 'Z'))
    if scale is not None:
        s = (scale, scale, scale) if isinstance(scale, (int, float)) else scale
        m = m @ Matrix.Diagonal((*s, 1))
    return m


def merge(dst, src):
    src.verts.index_update()
    vs = [dst.verts.new(v.co) for v in src.verts]
    for f in src.faces:
        dst.faces.new([vs[v.index] for v in f.verts])


TRIS = {}


def emit(bm, mat, label):
    if mat not in materials:
        raise KeyError(mat)
    TRIS[label] = TRIS.get(label, 0) + sum(len(f.verts) - 2 for f in bm.faces)
    bm.transform(_frames[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    # recalc_face_normals comes to the same windings every run but not by the same route: which
    # corner a turned face starts at differed between two bakes, and so did the file. `canonical`
    # starts every face at its least corner and sorts them, so a bake is the same bytes twice.
    bm = canonical(bm)
    if mat in GLOW:
        SOLO.append((label, mat, _group[-1], bm))
        return
    key = (_group[-1], mat)
    if key not in BUCKETS:
        BUCKETS[key] = bmesh.new()
    merge(BUCKETS[key], bm)
    bm.free()


def box(label, at, size, mat, turn=0.0, tilt=0.0, roll=0.0, bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts[:])
    if bevel:
        bmesh.ops.bevel(bm, geom=bm.edges[:], offset=bevel, offset_type='OFFSET', segments=1,
                        profile=.5, affect='EDGES', clamp_overlap=True)
    bm.transform(M(at, turn, tilt, roll))
    emit(bm, mat, label)


def span(label, x0, x1, y0, y1, z0, z1, mat, bevel=0.0):
    box(label, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), mat, bevel=bevel)


def rod(label, a, b, r, mat, top=None, sides=6):
    a, b = Vector(a), Vector(b)
    d = b - a
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r,
                          radius2=r if top is None else top, depth=d.length)
    q = Vector((0, 0, 1)).rotation_difference(d.normalized())
    bm.transform(Matrix.Translation((a + b) / 2) @ q.to_matrix().to_4x4())
    emit(bm, mat, label)


def disc(label, at, r, h, mat, sides=6, turn=0.0, tilt=0.0, roll=0.0, top=None):
    """A short cylinder standing on `at`, its axis up before it is turned."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=sides, radius1=r,
                          radius2=r if top is None else top, depth=h)
    bm.transform(M(at, turn, tilt, roll) @ Matrix.Translation((0, h / 2, 0)) @ Matrix.Rotation(-PI / 2, 4, 'X'))
    emit(bm, mat, label)


def ball(label, at, size, mat, seg=8, rings=5, turn=0.0, tilt=0.0, roll=0.0):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=1.0)
    bm.transform(Matrix.Rotation(-PI / 2, 4, 'X'))
    s = (size, size, size) if isinstance(size, (int, float)) else size
    bmesh.ops.scale(bm, vec=Vector(s), verts=bm.verts[:])
    bm.transform(M(at, turn, tilt, roll))
    emit(bm, mat, label)


def lathe(label, profile, mat, at=(0, 0, 0), sides=8, turn=0.0, tilt=0.0, roll=0.0, scale=None, phase=0.0):
    """A turned solid: `profile` is (radius, height) from the bottom up; a radius of 0 is a pole."""
    bm = bmesh.new()
    rings = []
    for r, y in profile:
        if r < 1e-6:
            rings.append([bm.verts.new((0, y, 0))])
        else:
            rings.append([bm.verts.new((r * math.cos(phase + TAU * i / sides), y, r * math.sin(phase + TAU * i / sides)))
                          for i in range(sides)])
    for A, B in zip(rings, rings[1:]):
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1:
            for i in range(sides):
                bm.faces.new((A[0], B[i], B[(i + 1) % sides]))
        elif len(B) == 1:
            for i in range(sides):
                bm.faces.new((A[i], A[(i + 1) % sides], B[0]))
        else:
            for i in range(sides):
                bm.faces.new((A[i], A[(i + 1) % sides], B[(i + 1) % sides], B[i]))
    for ring in (rings[0], rings[-1]):
        if len(ring) > 1:
            bm.faces.new(ring)
    bm.transform(M(at, turn, tilt, roll, scale))
    emit(bm, mat, label)


def prism(label, outline, depth, mat, m=None):
    """A flat outline in its own x and y, `depth` thick along its own z, placed by `m`."""
    bm = bmesh.new()
    front = [bm.verts.new((u, v, depth / 2)) for u, v in outline]
    back = [bm.verts.new((u, v, -depth / 2)) for u, v in outline]
    n = len(outline)
    bm.faces.new(front)
    bm.faces.new(list(reversed(back)))
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((front[i], back[i], back[j], front[j]))
    if m is not None:
        bm.transform(m)
    emit(bm, mat, label)


def hull(label, pts, mat, m=None):
    bm = bmesh.new()
    vs = [bm.verts.new(p) for p in pts]
    res = bmesh.ops.convex_hull(bm, input=vs)
    loose = list({g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)})
    if loose:
        bmesh.ops.delete(bm, geom=loose, context='VERTS')
    if m is not None:
        bm.transform(m)
    emit(bm, mat, label)


def canonical(bm, m=None):
    """The same solid with every face started at its least corner and the faces in an order of
    their own positions, so that the order a bmesh op happened to leave them in (see `emit`) never
    reaches the file."""
    if m is not None:
        bm.transform(m)
    faces = []
    for f in bm.faces:
        pts = [tuple(round(c, 6) for c in v.co) for v in f.verts]
        k = pts.index(min(pts))
        faces.append(pts[k:] + pts[:k])
    faces.sort()
    out = bmesh.new()
    verts = {}
    for pts in faces:
        out.faces.new([verts[p] if p in verts else verts.setdefault(p, out.verts.new(p)) for p in pts])
    bm.free()
    return out


def tube(label, pts, r, mat, sides=5):
    """A tube along a polyline; `r` a radius or one per point."""
    pts = [Vector(p) for p in pts]
    n = len(pts)
    radii = r if isinstance(r, (list, tuple)) else [r] * n
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, n - 1)] - pts[max(i - 1, 0)]).normalized()
        up = Vector((0, 1, 0)) if abs(t.y) < .9 else Vector((1, 0, 0))
        u = t.cross(up).normalized()
        w = t.cross(u)
        rings.append([bm.verts.new(p + (u * math.cos(TAU * k / sides) + w * math.sin(TAU * k / sides)) * max(radii[i], 1e-4))
                      for k in range(sides)])
    for A, B in zip(rings, rings[1:]):
        for k in range(sides):
            bm.faces.new((A[k], A[(k + 1) % sides], B[(k + 1) % sides], B[k]))
    bm.faces.new(rings[0])
    bm.faces.new(list(reversed(rings[-1])))
    emit(bm, mat, label)


def torus(label, at, R, r, mat, seg=12, sides=4, turn=0.0, tilt=0.0, roll=0.0, arc=None, start=0.0):
    """A ring about its own vertical axis; `arc` makes it part of a ring, from `start`."""
    bm = bmesh.new()
    full = arc is None
    a1 = TAU if full else arc
    n = seg if full else seg + 1
    rings = []
    for i in range(n):
        a = start + a1 * i / seg
        out = Vector((math.cos(a), 0, math.sin(a)))
        c = out * R
        rings.append([bm.verts.new(c + (out * math.cos(TAU * j / sides) + Vector((0, 1, 0)) * math.sin(TAU * j / sides)) * r)
                      for j in range(sides)])
    for i in range(n if full else n - 1):
        A, B = rings[i], rings[(i + 1) % n]
        for j in range(sides):
            bm.faces.new((A[j], A[(j + 1) % sides], B[(j + 1) % sides], B[j]))
    if not full:
        bm.faces.new(rings[0])
        bm.faces.new(list(reversed(rings[-1])))
    bm.transform(M(at, turn, tilt, roll))
    emit(bm, mat, label)


def arc_pts(cx, cy, rx, ry, a0, a1, n):
    return [(cx + rx * math.cos(a0 + (a1 - a0) * i / n), cy + ry * math.sin(a0 + (a1 - a0) * i / n)) for i in range(n + 1)]


def band(label, cx, cy, r0, r1, a0, a1, n, depth, mat, m, ry=None):
    """Part of an annulus in the xy plane, `depth` along z: an arch ring, cut into n voussoirs
    so every piece is convex (and the stone ones read as stones)."""
    k0 = 1 if ry is None else ry[0] / r0
    k1 = 1 if ry is None else ry[1] / r1
    for i in range(n):
        t0, t1 = a0 + (a1 - a0) * i / n, a0 + (a1 - a0) * (i + 1) / n
        pts = []
        for t in (t0, t1):
            for r, k in ((r0, k0), (r1, k1)):
                for z in (-depth / 2, depth / 2):
                    pts.append((cx + r * math.cos(t), cy + r * k * math.sin(t), z))
        hull(label, pts, mat, m)


# ---- small things, each in its own frame: at the origin, standing on y = 0, front +z --------
def rng(seed):
    return random.Random(seed)


# The share of the coins the hoards were first drawn with. Loose coins were an eighth of the first
# bake; gold lying on the floor is a sheet of it now (gold_floor), with coins only on top.
COINS = .6


def gold_floor(cx, cz, r, seed, y=None, coins=6):
    """Gold lying on the boards as a layer rather than as coins: a low, lumpy puddle of it, with a
    few coins and a gem on top to say what it is."""
    y = F if y is None else y
    g = rng(seed)
    pts = []
    for i in range(10):
        a = TAU * i / 10 + g.uniform(-.2, .2)
        rr = r * g.uniform(.6, 1.0)
        pts += [(cx + rr * math.cos(a), y, cz + rr * math.sin(a) * .8), (cx + rr * .8 * math.cos(a), y + .006, cz + rr * .8 * math.sin(a) * .8)]
    pts.append((cx, y + .014, cz))
    hull('gold floor', pts, GOLD)
    scatter(cx, cz, y + .006, 0, r * .8, coins, seed + 1)
    if g.random() > .4:
        gem((cx + g.uniform(-r, r) * .4, y + .012, cz + g.uniform(-r, r) * .4), .01, seed=seed + 2)


def candles(at, n, seed, spread=.06):
    """A cluster of candles burnt down to different heights, the wax run down them in thick
    beards and pooled round their feet - the candles of the referenties, not a birthday cake."""
    x, y, z = at
    g = rng(seed)
    for i in range(n):
        a = TAU * i / n + g.uniform(-.3, .3)
        rr = spread * (g.uniform(.2, 1) if i else 0)
        px, pz = x + rr * math.cos(a), z + rr * math.sin(a)
        h = g.uniform(.03, .1)
        r = g.uniform(.009, .014)
        candle((px, y, pz), h=h, r=r, drips=0, seed=seed * 7 + i)
        for k in range(3):
            b = g.uniform(0, TAU)
            l = g.uniform(.4, .9) * h
            rod('candle beard', (px + r * math.cos(b), y + h - .003, pz + r * math.sin(b)),
                (px + r * 1.3 * math.cos(b), y + h - l, pz + r * 1.3 * math.sin(b)), r * .5, WAX, top=r * .15, sides=4)
    ball('wax pool', (x, y + .004, z), (spread * 1.2 + .02, .008, spread + .02), WAX, seg=8, rings=3)


def cloth(corner, nu, nv, sag, mat, thick=.006, ragged=0.0, seed=0):
    """Cloth hung by its corners: `corner(u, v)` is the flat sheet, `sag(u, v)` how far each point
    drops, `ragged` how much the free edge (v = 1) is torn. Two layers and an edge, so it is a
    closed solid and has a face towards whoever looks at it from underneath."""
    g = rng(seed)
    tear = [g.uniform(0, ragged) for _ in range(nu + 1)]
    bm = bmesh.new()
    layers = []
    for off in (0, -thick):
        grid = []
        for j in range(nv + 1):
            row = []
            for i in range(nu + 1):
                u, v = i / nu, j / nv
                p = Vector(corner(u, v)) + Vector((0, -sag(u, v) + off, 0))
                if j == nv:
                    p.y -= tear[i]
                row.append(bm.verts.new(p))
            grid.append(row)
        layers.append(grid)
    top, bot = layers
    for j in range(nv):
        for i in range(nu):
            bm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]))
            bm.faces.new((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]))
    ring = [(0, i) for i in range(nu)] + [(j, nu) for j in range(nv)] + [(nv, i) for i in range(nu, 0, -1)] + [(j, 0) for j in range(nv, 0, -1)]
    for k, (j, i) in enumerate(ring):
        j2, i2 = ring[(k + 1) % len(ring)]
        bm.faces.new((top[j][i], top[j2][i2], bot[j2][i2], bot[j][i]))
    emit(bm, mat, 'cloth')


def flame(at, s=1.0):
    lathe('flame', [(0, 0), (.006, .004), (.009, .012), (.006, .021), (0, .034)], FLAME, at=at, sides=5, scale=s)


def candle(at=(0, 0, 0), h=.05, r=.009, drips=2, seed=0):
    x, y, z = at
    rod('candle', (x, y, z), (x, y + h, z), r, WAX, top=r * .92, sides=6)
    rod('candle wick', (x, y + h, z), (x, y + h + .006, z), .0015, BLACK, sides=3)
    flame((x, y + h + .003, z), r / .009)
    g = rng(seed)
    for i in range(drips):
        a = g.uniform(0, TAU)
        l = g.uniform(.012, .03)
        rod('candle drip', (x + r * .95 * math.cos(a), y + h - .002, z + r * .95 * math.sin(a)),
            (x + r * 1.02 * math.cos(a), y + h - l, z + r * 1.02 * math.sin(a)), .0035, WAX, top=.0012, sides=4)


def goblet(at, s=1.0, mat=GOLD, turn=0.0, tilt=0.0, roll=0.0):
    lathe('goblet', [(0, 0), (.02, 0), (.021, .003), (.008, .008), (.005, .012), (.005, .024), (.009, .028),
                     (.007, .031), (.017, .037), (.022, .05), (.023, .06), (.019, .06), (.017, .048), (0, .042)],
          mat, at=at, sides=6, scale=s, turn=turn, tilt=tilt, roll=roll)


def candlestick(at, h=.05, s=1.0, mat=GOLD, seed=0):
    x, y, z = at
    lathe('candlestick', [(0, 0), (.022, 0), (.022, .006), (.012, .012), (.007, .02), (.009, .05), (.005, .07),
                          (.013, .078), (.014, .084), (0, .084)], mat, at=at, sides=8, scale=s)
    candle((x, y + .084 * s, z), h=h, seed=seed)


def candelabra(at, s=1.0, seed=0, mat=GOLD):
    """Three candles on a gold stand: a foot, a stem, two arms curling up."""
    x, y, z = at
    lathe('candelabra', [(0, 0), (.03, 0), (.03, .008), (.016, .016), (.008, .026), (.01, .08), (.006, .12),
                         (.013, .128), (.013, .134), (0, .134)], mat, at=at, sides=8, scale=s)
    for sx in (-1, 1):
        pts = [(x, y + .09 * s, z)] + [(x + sx * .06 * s * math.sin(t), y + (.09 + .04 * (1 - math.cos(t))) * s, z)
                                       for t in (.5, 1.0, 1.5)]
        pts.append((x + sx * .062 * s, y + .128 * s, z))
        tube('candelabra arm', pts, .004 * s, mat, sides=4)
        disc('candelabra cup', (x + sx * .062 * s, y + .124 * s, z), .012 * s, .01 * s, mat, sides=8)
        candle((x + sx * .062 * s, y + .134 * s, z), h=.04 * s, r=.008 * s, seed=seed + sx)
    candle((x, y + .134 * s, z), h=.05 * s, r=.009 * s, seed=seed + 7)


def tankard(at, turn=0.0, mat=WOOD, ale=True):
    x, y, z = at
    lathe('tankard', [(0, 0), (.024, 0), (.025, .004), (.023, .008), (.023, .05), (.025, .054), (.025, .058),
                      (.021, .058), (.02, .052), (0, .052)], mat, at=at, sides=8, turn=turn)
    for hy in (.012, .044):
        disc('tankard hoop', (x, y + hy - .002, z), .0245, .005, IRON, sides=8)
    if ale:
        disc('tankard ale', (x, y + .05, z), .02, .004, 'plain:ale', sides=8)
    with frame(M(at, turn)):
        torus('tankard handle', (.024, .03, 0), .016, .004, mat, seg=6, sides=4, tilt=PI / 2, arc=PI, start=-PI / 2)


BOTTLE_SHAPES = {
    'wine': [(0, 0), (.018, 0), (.019, .004), (.019, .05), (.016, .058), (.008, .066), (.0065, .07), (.0065, .088),
             (.0075, .09), (.0075, .094), (0, .094)],
    'rum': [(0, 0), (.022, 0), (.023, .035), (.02, .042), (.008, .05), (.007, .064), (.0085, .066), (.0085, .07), (0, .07)],
    'flask': [(0, 0), (.012, 0), (.02, .008), (.024, .022), (.02, .036), (.01, .044), (.006, .048), (.006, .064),
              (.0075, .066), (0, .066)],
    'gin': [(0, 0), (.022, 0), (.022, .062), (.012, .07), (.007, .074), (.007, .086), (0, .086)],
    'jug': [(0, 0), (.02, 0), (.026, .02), (.025, .045), (.014, .06), (.009, .07), (.01, .075), (0, .075)],
}


def bottle(kind, at, mat, s=1.0, turn=0.0, label=None, tilt=0.0, roll=0.0):
    prof = BOTTLE_SHAPES[kind]
    sides, phase = (4, PI / 4) if kind == 'gin' else (6, 0.0)
    lathe('bottle', prof, 'plain:stoneware' if kind == 'jug' else mat, at=at, sides=sides, phase=phase,
          scale=s, turn=turn, tilt=tilt, roll=roll)
    top = prof[-1][1] * s
    with frame(M(at, turn, tilt, roll)):
        if kind != 'jug':
            rod('bottle cork', (0, top - .004 * s, 0), (0, top + .008 * s, 0), .0055 * s, 'plain:cork', sides=5)
        else:
            torus('jug handle', (.02 * s, .05 * s, 0), .014 * s, .004 * s, 'plain:stoneware', seg=5, sides=4,
                  tilt=PI / 2, arc=PI, start=-PI / 2)
        if label and kind in ('wine', 'rum', 'gin'):
            r = (.0195 if kind == 'wine' else .0235 if kind == 'rum' else .0225) * s
            disc('bottle label', (0, .016 * s, 0), r, .016 * s, label, sides=sides)


def barrel(at, r=.12, h=.28, wood=OAK, turn=0.0, tilt=0.0, roll=0.0, sides=10, hoops=(.1, .3, .7, .9), head=True):
    """A cask: staves bellied out, four iron hoops round it, and a head let into the top."""
    bulge = lambda t: r * (.84 + .16 * (1 - (2 * t - 1) ** 2))
    prof = [(0, 0)] + [(bulge(t), h * t) for t in (0, .15, .35, .5, .65, .85, 1)] + [(0, h)]
    with frame(M(at, turn, tilt, roll)):
        lathe('barrel', prof, wood, sides=sides)
        for t in hoops:
            disc('barrel hoop', (0, h * t - .008, 0), bulge(t) + .004, .016, IRON, sides=sides)
        if head:
            disc('barrel head', (0, h - .004, 0), r * .78, .008, DARK, sides=sides)


def coin(at, s=1.0, tilt=0.0, roll=0.0, turn=0.0, mat=GOLD):
    disc('coin', at, .013 * s, .004 * s, mat, sides=5, tilt=tilt, roll=roll, turn=turn)


def gem(at, s=.012, seed=0, which=None):
    g = rng(seed)
    mat = GEMS[g.randrange(4)] if which is None else which
    x, y, z = at
    a = g.uniform(0, PI)
    pts = [(x + s * math.cos(a + k * PI / 2), y, z + s * math.sin(a + k * PI / 2)) for k in range(4)]
    hull('gem', pts + [(x, y + s * 1.2, z), (x, y - s * .6, z)], mat)


def scatter(cx, cz, y, r0, r1, n, seed, s=1.0, arc=(0, TAU), stack=0):
    """Coins lying about on a floor or a table round a point, a few leaning on each other."""
    g = rng(seed)
    for i in range(max(1, round(n * COINS))):
        a = g.uniform(*arc)
        r = r0 + (r1 - r0) * math.sqrt(g.random())
        coin((cx + r * math.cos(a), y + (g.random() * .003 if stack else 0), cz + r * math.sin(a)), s,
             tilt=g.uniform(-.15, .15), roll=g.uniform(-.15, .15), turn=g.uniform(0, PI))


def heap(at, R, H, coins, seed, gems=0, sides=9):
    """A hoard: a lumpy dome of gold with coins lying on its slopes and gems pushed into it.
    The dome alone reads as a yellow pudding; the coins on it are what make it money."""
    g = rng(seed)
    x, y, z = at
    prof = [(0, 0)]
    for k, t in enumerate((0, .35, .62, .82, .94)):
        prof.append((R * (1 - t * t) ** .5 * (1 if k == 0 else .98), H * t))
    prof.append((0, H))
    bm = bmesh.new()
    rings = []
    for k, (r, hy) in enumerate(prof):
        if r < 1e-6:
            rings.append([bm.verts.new((x, y + hy, z))])
            continue
        ring = []
        for i in range(sides):
            a = TAU * i / sides + k * .4
            jr = r * (1 + (g.uniform(-.12, .12) if 0 < k else g.uniform(-.06, .06)))
            ring.append(bm.verts.new((x + jr * math.cos(a), y + hy + (g.uniform(-.25, .25) * H * .3 if 0 < k else 0),
                                      z + jr * math.sin(a))))
        rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        if len(B) == 1:
            for i in range(sides):
                bm.faces.new((A[i], A[(i + 1) % sides], B[0]))
        elif len(A) > 1:
            for i in range(sides):
                bm.faces.new((A[i], A[(i + 1) % sides], B[(i + 1) % sides], B[i]))
    bm.faces.new(rings[1])
    for v in [v for v in bm.verts if v.co.y < y + 1e-6 and len(v.link_faces) == 0]:
        bm.verts.remove(v)
    emit(bm, GOLD, 'heap')
    for i in range(round(coins * COINS)):
        a = g.uniform(0, TAU)
        rr = R * math.sqrt(g.uniform(.02, 1))
        hy = H * (1 - (rr / R) ** 2)
        slope = 2 * H * rr / (R * R)
        coin((x + rr * math.cos(a), y + hy + .002, z + rr * math.sin(a)), g.uniform(.9, 1.1),
             tilt=-math.atan(slope) * math.sin(a) + g.uniform(-.3, .3), roll=math.atan(slope) * math.cos(a) + g.uniform(-.3, .3),
             turn=g.uniform(0, PI), mat=GOLDHI if i % 4 == 0 else GOLD)
    for i in range(gems):
        a = g.uniform(0, TAU)
        rr = R * g.uniform(.1, .7)
        gem((x + rr * math.cos(a), y + H * (1 - (rr / R) ** 2) + .004, z + rr * math.sin(a)), .011, seed=seed * 31 + i)


def rock(at, size, seed, mat='stone:rock'):
    """A boulder: the hull of a dozen points jittered round an ellipsoid. Enough of them
    overlapping is a cave wall, and each is thirty triangles."""
    g = rng(seed)
    x, y, z = at
    sx, sy, sz = size
    pts = []
    for i in range(12):
        u, v = g.uniform(-1, 1), g.uniform(0, TAU)
        k = math.sqrt(1 - u * u) * g.uniform(.75, 1.0)
        pts.append((x + sx * k * math.cos(v), y + sy * u * g.uniform(.8, 1.0), z + sz * k * math.sin(v)))
    hull('rock', pts, mat)


def rock_face(x0, x1, y0, y1, plane, depth, seed, normal, size=.34, mat='stone:rock', axis='z', reach=None):
    """A face of rock: boulders on a jittered grid over x0..x1 (along the wall) and y0..y1,
    their middles `depth` behind `plane`, bulging towards `normal` (+1/-1) by up to `reach`
    (a function of height - low down a boulder may not stand out past the wall's blocker)."""
    g = rng(seed)
    step = size * 1.1
    y = y0
    row = 0
    while y < y1 + step * .3:
        u = x0 - (step / 2 if row % 2 else 0)
        while u < x1 + step * .5:
            s = size * g.uniform(.7, 1.25)
            out = (reach(y) if reach else s * .4) * g.uniform(.3, 1.0)
            w = plane + normal * (out - s * .5) - normal * depth
            p = (u + g.uniform(-.06, .06), y + g.uniform(-.05, .05), w) if axis == 'z' else (w, y + g.uniform(-.05, .05), u + g.uniform(-.06, .06))
            sz = (s, s * g.uniform(.7, 1.0), s * .5) if axis == 'z' else (s * .5, s * g.uniform(.7, 1.0), s)
            rock(p, sz, g.randrange(1 << 30), mat if g.random() > .3 else 'stone:rock-warm')
            u += step * g.uniform(.8, 1.1)
        y += step * .8
        row += 1


def pearls(pts, r=.007, n=14):
    """A string of pearls hung between points, sagging."""
    p = [Vector(v) for v in pts]
    total = [0.0]
    for a, b in zip(p, p[1:]):
        total.append(total[-1] + (b - a).length)
    for i in range(n):
        d = total[-1] * i / (n - 1)
        k = max(j for j in range(len(total) - 1) if total[j] <= d + 1e-9) if d < total[-1] else len(total) - 2
        t = (d - total[k]) / max(total[k + 1] - total[k], 1e-9)
        q = p[k].lerp(p[k + 1], t)
        ball('pearl', q, r, PEARL, seg=4, rings=3)


def crown(at, s=1.0, seed=0):
    x, y, z = at
    disc('crown band', at, .03 * s, .016 * s, GOLDHI, sides=10)
    for k in range(6):
        a = TAU * k / 6
        rod('crown point', (x + .028 * s * math.cos(a), y + .014 * s, z + .028 * s * math.sin(a)),
            (x + .03 * s * math.cos(a), y + .036 * s, z + .03 * s * math.sin(a)), .007 * s, GOLDHI, top=.001, sides=4)
    for k in range(3):
        a = TAU * k / 3 + .5
        gem((x + .031 * s * math.cos(a), y + .008 * s, z + .031 * s * math.sin(a)), .006 * s, seed=seed + k)


def ingots(at, turn=0.0):
    """Gold bars stacked three, two, one: a trapezoid each, a narrower top than bottom."""
    with frame(M(at, turn)):
        for row, n in ((0, 3), (1, 2), (2, 1)):
            for i in range(n):
                cx = (i - (n - 1) / 2) * .045
                y0 = row * .022
                hull('ingot', [(cx + sx * .02, y0, sz * .05) for sx in (-1, 1) for sz in (-1, 1)]
                     + [(cx + sx * .014, y0 + .02, sz * .042) for sx in (-1, 1) for sz in (-1, 1)], GOLDHI)


def chest(at, turn=0.0, w=.42, d=.26, h=.2, open_=1.95, fill=True, seed=0, spill=True, s=1.0):
    """A sea chest thrown open: an iron-bound box with a rounded lid swung back on its hinges,
    heaped over its rim with gold that runs down its front onto the floor. The gold is what the
    keeper asked for by name: 'kisten die openstaan met goud dat eroverheen stroomt'."""
    g = rng(seed)
    with frame(M(at, turn, scale=s)):
        span('chest', -w / 2, w / 2, .012, h, -d / 2, d / 2, CHESTW, bevel=.006)
        span('chest plinth', -w / 2 - .008, w / 2 + .008, 0, .02, -d / 2 - .008, d / 2 + .008, DARK, bevel=.004)
        for x in (-w * .32, w * .32):
            span('chest strap', x - .016, x + .016, .01, h + .002, -d / 2 - .004, d / 2 + .004, IRON)
        for sx in (-1, 1):
            for sz in (-1, 1):
                box('chest corner', (sx * (w / 2 - .012), h / 2, sz * (d / 2 - .012)), (.03, h + .004, .03), IRON)
        span('chest lock', -.035, .035, h - .075, h - .005, d / 2, d / 2 + .008, BRASS)
        span('chest keyhole', -.006, .006, h - .055, h - .03, d / 2 + .006, d / 2 + .01, BLACK)
        for sx in (-1, 1):
            torus('chest handle', (sx * (w / 2 + .012), h * .6, 0), .02, .004, IRON, seg=6, sides=4, roll=PI / 2, arc=PI, start=0)
        # The lid: an arch across the chest's depth, run along its width, swung back about the
        # hinge at the back of the rim.
        rise = d * .38
        outline = [(-(d / 2) * math.cos(t), rise * math.sin(t)) for t in [PI * i / 8 for i in range(9)]]
        hinge = Vector((0, h, -d / 2))
        swing = Matrix.Translation(hinge) @ Matrix.Rotation(-open_, 4, 'X') @ Matrix.Translation(-hinge)
        # prism outline u = -z: Ry(+90) takes the prism's own z to x and its own x to -z.
        place = swing @ Matrix.Translation((0, h, 0)) @ Matrix.Rotation(PI / 2, 4, 'Y')
        prism('chest lid', [(-u, v) for u, v in reversed(outline)], w, CHESTW, place)
        inner = [(-(d / 2 - .012) * math.cos(t), (rise - .012) * math.sin(t)) for t in [PI * i / 8 for i in range(9)]]
        prism('chest lid lining', [(-u, v - .0) for u, v in reversed(inner)], w - .024, VELVET,
              place @ Matrix.Translation((0, -.004, 0)))
        for x in (-w * .32, w * .32):
            ring = [(x, h + v, u) for u, v in [(-(d / 2 + .004) * math.cos(t), (rise + .004) * math.sin(t))
                                                for t in [PI * i / 8 for i in range(9)]]]
            tube('chest lid strap', [swing @ Vector(p) for p in ring], .006, IRON, sides=4)
        if not fill:
            return
        # The hoard: a heap in the box standing proud of the rim, a tongue of gold poured over the
        # front edge, and coins run out across the floor in front.
        heap((0, h - .05, 0), min(w, d) * .62, .12, coins=int(26 * w / .42), seed=seed + 1, gems=4)
        heap((-w * .18, h - .04, .01), min(w, d) * .4, .1, coins=10, seed=seed + 2)
        if spill:
            front = d / 2
            hull('gold spill', [(-.09, h + .02, front - .03), (.07, h + .015, front - .03), (-.06, h - .01, front + .01),
                                (.05, h - .02, front + .012), (-.12, .0, front + .09), (.1, .0, front + .1),
                                (-.13, 0, front + .02), (.11, 0, front + .02), (-.02, .06, front + .05)], GOLD)
            for i in range(18):
                t = g.random()
                xx = g.uniform(-.1, .1) * (1 + t * .3)
                yy = (h + .015) * (1 - t) + .004
                zz = front - .02 + t * .12
                coin((xx, yy + .01, zz), tilt=.6 + g.uniform(-.3, .3), roll=g.uniform(-.4, .4), turn=g.uniform(0, PI))
            scatter(0, front + .16, 0, .02, .16, 22, seed + 3, arc=(-PI * .1, PI * 1.1))
            pearls([(.1, h + .06, .0), (.14, h + .03, front + .005), (.15, h - .06, front + .02), (.17, .005, front + .08)], n=12)


def skull(glow=True):
    """A skull a little over life size for a settler, facing +z, its jaw on y = 0. Eye sockets
    are black rings with a small ember in each: the lamp's 'gloeiende oogkassen'."""
    ball('skull cranium', (0, .062, -.004), (.04, .042, .047), BONE, seg=10, rings=6)
    ball('skull face', (0, .034, .02), (.029, .026, .028), BONE, seg=8, rings=5)
    for sx in (-1, 1):
        ball('skull cheek', (sx * .026, .038, .022), (.012, .011, .014), BONE, seg=6, rings=4)
    hull('skull jaw', [(sx * .017, 0, .034) for sx in (-1, 1)] + [(sx * .028, .012, -.006) for sx in (-1, 1)]
         + [(sx * .027, .026, .012) for sx in (-1, 1)] + [(sx * .016, .02, .042) for sx in (-1, 1)]
         + [(sx * .024, .003, .016) for sx in (-1, 1)], BONE)
    box('skull bite', (0, .0245, .042), (.028, .004, .006), BLACK)
    for i in range(6):
        box('skull tooth', (-.0125 + i * .005, .029, .0435), (.0038, .007, .004), BONE)
    for sx in (-1, 1):
        disc('skull socket', (sx * .015, .046, .029), .0125, .013, BLACK, sides=8, tilt=PI / 2)
        if glow:
            disc('eye', (sx * .015, .046, .0405), .0078, .002, SOCKET, sides=6, tilt=PI / 2)
    prism('skull nose', [(0, .009), (-.006, -.004), (.006, -.004)], .012, BLACK, Matrix.Translation((0, .033, .042)))


def skull_lamp_top(y0, seed):
    """A candle on the crown of a skull with the wax run down over the bone."""
    candle((0, y0, -.004), h=.045, r=.011, drips=3, seed=seed)
    g = rng(seed + 9)
    for i in range(5):
        a = g.uniform(-PI * .9, PI * .1)
        ball('wax run', (.03 * math.cos(a), y0 - .012 - g.uniform(0, .02), -.004 + .03 * math.sin(a) * .8),
             (.007, .016, .007), WAX, seg=5, rings=3)


def lantern(at, hang_to=None, s=1.0):
    """A ship's lantern: an iron cage round amber glass, a pyramid cap and a ring, on a chain."""
    x, y, z = at
    with frame(M(at, scale=s)):
        box('lantern glass', (0, 0, 0), (.05, .07, .05), GLASS)
        for sx in (-1, 1):
            for sz in (-1, 1):
                box('lantern rib', (sx * .027, 0, sz * .027), (.008, .076, .008), IRON)
        span('lantern base', -.034, .034, -.048, -.036, -.034, .034, IRON)
        span('lantern top', -.034, .034, .036, .044, -.034, .034, IRON)
        lathe('lantern cap', [(.036, 0), (0, .036)], IRON, at=(0, .044, 0), sides=4, phase=PI / 4)
        torus('lantern ring', (0, .092, 0), .011, .0025, IRON, seg=6, sides=3, tilt=PI / 2)
    if hang_to is not None:
        chain((x, y + .1 * s, z), (x, hang_to, z))


def chain(a, b, link=.03):
    """Links as flat plates, each turned a quarter on the last. A ring per link was 30 triangles
    and a quarter of the first bake; overhead, at this size, a plate reads as a link."""
    a, b = Vector(a), Vector(b)
    d = b - a
    n = max(1, int(d.length / link))
    for i in range(n):
        p = a + d * ((i + .5) / n)
        q = Vector((0, 1, 0)).rotation_difference(d.normalized())
        m = Matrix.Translation(p) @ q.to_matrix().to_4x4() @ Matrix.Rotation((i % 2) * PI / 2, 4, 'Y')
        with frame(m):
            box('chain link', (0, 0, 0), (.013, link * 1.15, .004), IRON)


def rope_column(x, z, y0, y1, r=.012, mat=CARVED, turns=4):
    """A carved rope-twist column: two strands wound round each other."""
    for ph in (0, PI):
        pts = []
        n = int(turns * 6)
        for i in range(n + 1):
            t = i / n
            a = ph + t * turns * TAU
            pts.append((x + r * .55 * math.cos(a), y0 + (y1 - y0) * t, z + r * .55 * math.sin(a)))
        tube('rope twist', pts, r * .6, mat, sides=4)


def coil(at, r0=.1, turns=3, layers=2, thick=.018, mat=ROPE):
    x, y, z = at
    pts = []
    n = int(turns * layers * 10)
    for i in range(n + 1):
        t = i / n
        a = t * turns * layers * TAU
        layer = int(t * layers * .999)
        r = r0 - layer * thick * 1.3 - (t * layers - layer) * thick * .2
        pts.append((x + r * math.cos(a), y + thick * .5 + layer * thick * .9, z + r * math.sin(a)))
    tube('rope coil', pts, thick * .5, mat, sides=4)



def flush(prefix, collection=None, groups=True):
    """Turn the buckets into Blender objects and empty them: one per (group, material), named
    `<prefix> <group> <material>`, and one per glowing piece. `collection` is where they go (a
    kit asset's own, named after it); `groups=False` leaves the group out of the name."""
    coll = collection or bpy.context.scene.collection

    def make(name, mat, bm):
        for v in bm.verts:
            x, y, z = v.co
            v.co = (x, -z, y)
        me = bpy.data.meshes.new(name)
        bm.to_mesh(me)
        bm.free()
        ob = bpy.data.objects.new(name, me)
        coll.objects.link(ob)
        ob.data.materials.append(materials[mat])
        ob['building_part'] = True

    tag = lambda g: f' {g}' if groups else ''
    for (group, mat), bm in sorted(BUCKETS.items()):
        make(f'{prefix}{tag(group)} {mat.replace(":", " ")}', mat, bm)
    counts = {}
    for label, mat, group, bm in SOLO:
        k = (group, label)
        counts[k] = counts.get(k, 0) + 1
        make(f'{prefix}{tag(group)} {label} {counts[k]}', mat, bm)
    BUCKETS.clear()
    SOLO.clear()
    total = sum(TRIS.values())
    top = sorted(TRIS.items(), key=lambda kv: -kv[1])[:12]
    TRIS.clear()
    return total, top


def bake_ao(objects, distance=.08, strength=.75, samples=48):
    """Darken every corner by how far it sits in a crevice, and write that into a colour attribute
    the exporter reads instead of the material's flat colour (scripts/export-models.py): the
    seams between planks, the inside of a niche, under a moulding. The island has no textures,
    so this is where the depth of a painted reference comes from - at no cost in the game.

    Cycles' ambient occlusion over all `objects` at once (a bottle darkens the shelf it stands
    on). The result is rounded to 1/64 so that two bakes of the same scene write the same bytes.
    Glowing parts are left alone: an ember in shadow is still an ember."""
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = samples
    scene.cycles.seed = 0
    scene.cycles.device = 'CPU'
    # One thread: with several, the order the samples are summed in varies between runs, and a
    # corner that sits on a rounding step lands on either side of it (a second bake differed).
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 1
    scene.render.bake.target = 'VERTEX_COLORS'
    scene.world = scene.world or bpy.data.worlds.new('ao')
    scene.world.light_settings.distance = distance
    todo = [o for o in objects if o.type == 'MESH' and not o.data.materials[0].get('emissive', 0)
            and not o.data.materials[0].get('no_ao', 0)]
    for o in todo:
        o.data.color_attributes.new('ao', 'FLOAT_COLOR', 'CORNER')
        o.data.color_attributes.active_color = o.data.color_attributes['ao']
    for o in bpy.context.view_layer.objects:
        o.select_set(o in todo)
    if not todo:
        return
    bpy.context.view_layer.objects.active = todo[0]
    for m in {o.data.materials[0] for o in todo}:
        m.use_nodes = True
    bpy.context.view_layer.update()
    with bpy.context.temp_override(selected_objects=todo, selected_editable_objects=todo,
                                   active_object=todo[0], object=todo[0]):
        bpy.ops.object.bake(type='AO')
    for o in todo:
        base = o.data.materials[0].diffuse_color
        for c in o.data.color_attributes['ao'].data:
            ao = round(c.color[0] * 64) / 64
            k = 1 - strength * (1 - ao)
            c.color = (round(base[0] * k, 5), round(base[1] * k, 5), round(base[2] * k, 5), 1)
