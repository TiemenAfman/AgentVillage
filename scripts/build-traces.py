"""The marks the island's story animals leave behind for good. Rebuild with
scripts/blender.mjs --background --python scripts/build-traces.py.

Seven props, one per kind in TRACE_KINDS (shared/animals.mjs), each under the prop budget of
120 triangles and centred on its own middle, because the island puts a trace down by its
middle (scripts/model-rules.mjs) and Plans/dierenverhalen.md puts it down through the same
check a garden bed gets:

    prop_trace_nest       a hen's straw nest by a door, three eggs in a dark hollow
    prop_trace_lookout    a goat's cairn of flat stones on high ground, a tuft at its foot
    prop_trace_perch      a sparrow's birdhouse on a pole in somebody's garden
    prop_trace_feeder     the Feathered Corner: a seed tray on a post under a little roof,
                          with a seed bell hanging off the eave
    prop_trace_print      the mystery's first clue: two three-toed prints in a patch of mud
    prop_trace_find       the mystery's second: a brass button in a scratched-up patch, and
                          the glint that gives it away
    prop_trace_cache      the mystery's end, at the lighthouse: the old keeper's chest, lid
                          ajar, a logbook inside and a signal lamp beside it

Why they are as coarse as they are. A trace is seen from the orbit camera, where a cell is a
couple of dozen pixels and a hen's nest is four of them; what has to survive that is a
silhouette and one contrast each - the dark hollow with pale eggs in it, the red roof on a
pole, the dark print on lighter mud. Seven sides to the nest, six to a cairn stone and five to
an egg are where adding one more stopped changing the thumbnail. Undersides nothing can see
(a slab lying on the ground, a chest's bottom) are left out rather than spending the budget on
them.

Two parts move and are baked apart, inside the asset that stands on the ground, with their
Blender origin on their own pivot - the pattern the sawmill's blade set (assets/README.md):
`prop_trace_feeder bell` hangs from the eave and swings, `prop_trace_find glint` sits over the
button and flashes. web/js/traces.js leaves them out of the still merge and draws them as
instanced meshes of their own; nothing else here turns.

Two materials glow after dark, as a switch (`m['emissive'] = 1.0`): the signal lamp's glass,
like every other lamp on the island, and the find's glint. The flat marks - the print, the
find's patch - rise 6 mm off the ground at most, so they stand on it (the origin rule) and
traces.js tilts them to the slope instead of letting a hillside swallow half of one.

Written in island coordinates (x right, y up, z to the front) through xyz(). Faces are wound
by what they face (Part.add's `orient`), because the island's material culls back faces and a
hand-wound slab facing the wrong way is a hole that only shows once it is on the island.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/traces'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)

UP = (0, 1, 0)
DOWN = (0, -1, 0)
TAU = 2 * math.pi


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def material(sheet, name, color, emissive=False):
    m = bpy.data.materials.new(f'{sheet}:{name}')
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m['emissive'] = 1.0 if emissive else 0.0
    return m


def jit(k, amount):
    """A fixed wobble for vertex k, in -amount..amount. A table of sines rather than an rng, so
    the bake is the same bake on every run (npm run models is run twice to prove it)."""
    v = math.sin(k * 12.9898 + 78.233) * 43758.5453
    return (v - math.floor(v) - 0.5) * 2 * amount


# The nest
STRAW = material('plain', 'nest straw', 0xd2ad55)
STRAW_SHADE = material('plain', 'nest straw shade', 0xa9833a)
HOLLOW = material('plain', 'nest hollow', 0x6b4c24)
EGG = material('plain', 'nest egg', 0xf3ead6)
EGG_BROWN = material('plain', 'nest egg brown', 0xd9b184)
# The cairn
CAIRN = material('stone', 'cairn stone', 0xa29d92)
CAIRN_DARK = material('stone', 'cairn stone dark', 0x86827a)
CAIRN_PALE = material('stone', 'cairn stone pale', 0xb9b4a8)
TUFT = material('plain', 'trace tuft', 0x6f8f3a)
# The birdhouse and the feeder
POLE = material('plain', 'trace pole', 0x765536)
BOX = material('plain', 'birdhouse box', 0xd0a468)
BIRD_ROOF = material('plain', 'birdhouse roof', 0xa9432e)
HOLE = material('plain', 'birdhouse hole', 0x21180f)
TRAY = material('plain', 'feeder tray', 0x8d6843)
FEEDER_ROOF = material('plain', 'feeder roof', 0x55704a)
SEED = material('plain', 'feeder seed', 0xd6b673)
BELL = material('plain', 'feeder bell', 0xb58f5a)
STRING = material('plain', 'feeder string', 0xe4d9c0)
# The mystery
MUD = material('plain', 'print mud', 0x76593b)
MUD_WET = material('plain', 'print mud wet', 0x8a6b48)
PRINT = material('plain', 'print pressed', 0x2f2217)
SCRATCHED = material('plain', 'find earth', 0x80613f)
SCRATCH = material('plain', 'find scratch', 0x4a3522)
BRASS = material('plain', 'find brass', 0xcfa647)
BRASS_DARK = material('plain', 'find brass dark', 0x7b5e22)
GLINT = material('plain', 'find glint', 0xfff3bf, emissive=True)
# The cache
CHEST = material('plank', 'cache chest', 0x7e6a52)
CHEST_LID = material('plank', 'cache lid', 0x8a7459)
INSIDE = material('plain', 'cache inside', 0x2a2119)
IRON = material('plain', 'cache iron', 0x3d3b38)
LOCK = material('plain', 'cache lock', 0xb8923a)
LOGBOOK = material('plain', 'cache logbook', 0x7a3526)
LAMP = material('plain', 'cache lamp', 0x2f3a3a)
LAMP_GLASS = material('plain', 'cache lamp glass', 0xffd27f, emissive=True)


class Part:
    def __init__(self, asset, name, origin=(0, 0, 0)):
        self.asset, self.name, self.origin = asset, f'{asset.name} {name}', Vector(origin)
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def add(self, points, faces, mat, orient=None):
        """Faces over `points` (island coordinates, not relative to the origin). `orient` turns
        each face to face something: 'out' is away from the middle of these points (a convex
        shape), a vector is that way, a function answers a direction for a face's middle."""
        base, s = len(self.verts), self.slot(mat)
        pts = [Vector(p) for p in points]
        centre = sum(pts, Vector()) / len(pts)
        for f in faces:
            f = list(f)
            if orient is not None:
                # Newell's normal, over the whole loop rather than its first corner: a wobbled
                # outline can have a dent there, and three points of a dent face the other way.
                normal = Vector()
                for i, j in zip(f, f[1:] + f[:1]):
                    u, v = pts[i], pts[j]
                    normal += Vector(((u.y - v.y) * (u.z + v.z), (u.z - v.z) * (u.x + v.x), (u.x - v.x) * (u.y + v.y)))
                mid = sum((pts[i] for i in f), Vector()) / len(f)
                if orient == 'out':
                    want = mid - centre
                elif callable(orient):
                    want = Vector(orient(mid))
                else:
                    want = Vector(orient)
                if normal.dot(want) < 0:
                    f = f[::-1]
            self.faces.append([base + i for i in f])
            self.mats.append(s)
        self.verts.extend(p - self.origin for p in pts)
        return base

    def both(self, points, faces, mat):
        """Faces seen from either side: a blade of grass, a wisp of straw, a spark."""
        base = self.add(points, faces, mat)
        s = self.slot(mat)
        for f in faces:
            self.faces.append([base + i for i in f][::-1])
            self.mats.append(s)

    def turn(self, start, pivot, m3):
        """Turn every vertex added since `start` about `pivot` - a proper rotation, so the faces
        keep facing the way add() wound them."""
        pivot = Vector(pivot)
        for i in range(start, len(self.verts)):
            v = self.verts[i] + self.origin
            self.verts[i] = m3 @ (v - pivot) + pivot - self.origin

    def build(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([xyz(v) for v in self.verts], [], self.faces)
        for mat in self.slots:
            mesh.materials.append(mat)
        for poly, m in zip(mesh.polygons, self.mats):
            poly.material_index = m
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        obj.location = xyz(self.origin)
        obj['building_part'] = True
        self.asset.objects.link(obj)
        return obj


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def rot_x(a):
    return Matrix.Rotation(a, 3, 'X')


def rot_y(a):
    return Matrix.Rotation(a, 3, 'Y')


def rot_z(a):
    return Matrix.Rotation(a, 3, 'Z')


def prism(part, outline, y0, y1, mat, top=True, bottom=False, top_mat=None):
    """An upright prism over a convex outline of (x, z): a slab, a post, a tray wall."""
    n = len(outline)
    pts = [(x, y0, z) for x, z in outline] + [(x, y1, z) for x, z in outline]
    part.add(pts, [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], mat, orient='out')
    if top:
        part.add([(x, y1, z) for x, z in outline], [list(range(n))], top_mat or mat, orient=UP)
    if bottom:
        part.add([(x, y0, z) for x, z in outline], [list(range(n))], mat, orient=DOWN)


def rect(cx, cz, w, d):
    return [(cx - w / 2, cz - d / 2), (cx + w / 2, cz - d / 2), (cx + w / 2, cz + d / 2), (cx - w / 2, cz + d / 2)]


def box(part, centre, size, mat, top=True, bottom=True, turn=None):
    """A box about its middle, optionally turned about that middle."""
    cx, cy, cz = centre
    start = len(part.verts)
    prism(part, rect(cx, cz, size[0], size[2]), cy - size[1] / 2, cy + size[1] / 2, mat, top=top, bottom=bottom)
    if turn is not None:
        part.turn(start, centre, turn)


def outline(cx, cz, r, sides, k0, wobble=0.0, sx=1.0, sz=1.0, phase=0.0):
    """A convex-ish polygon of `sides` round (cx, cz), each radius wobbled by jit(k0 + i)."""
    return [(cx + math.cos(phase + TAU * i / sides) * r * sx * (1 + jit(k0 + i, wobble)),
             cz + math.sin(phase + TAU * i / sides) * r * sz * (1 + jit(k0 + i, wobble))) for i in range(sides)]


def ring(cx, cz, y, r, sides, phase=0.0, k0=0, wobble=0.0):
    return [(cx + math.cos(phase + TAU * i / sides) * r * (1 + jit(k0 + i, wobble)), y,
             cz + math.sin(phase + TAU * i / sides) * r * (1 + jit(k0 + i, wobble))) for i in range(sides)]


def band(part, lower, upper, mat, orient):
    """The quads between two rings of equal length."""
    n = len(lower)
    part.add(lower + upper, [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], mat, orient=orient)


def fan(part, loop, apex, mat, orient):
    n = len(loop)
    part.add(loop + [apex], [[i, (i + 1) % n, n] for i in range(n)], mat, orient=orient)


def radial(cx, cz, lift=0.0):
    """Away from an upright axis through (cx, cz), tipped up by `lift`."""
    return lambda m: (m.x - cx, lift, m.z - cz)


def spindle(part, centre, axis_turn, rings_, tip, tail, sides, mat, phase=0.0):
    """A closed body of revolution along local +y - an egg, a seed bell - then laid over by
    `axis_turn` about `centre`. `rings_` are (u, r) along the axis; `tip` and `tail` the two
    ends' u."""
    cx, cy, cz = centre
    start = len(part.verts)
    loops = [ring(cx, cz, cy + u, r, sides, phase) for u, r in rings_]
    out = radial(cx, cz)
    for lower, upper in zip(loops, loops[1:]):
        band(part, lower, upper, mat, out)
    fan(part, loops[-1], (cx, cy + tip, cz), mat, UP)
    fan(part, loops[0], (cx, cy + tail, cz), mat, DOWN)
    if axis_turn is not None:
        part.turn(start, centre, axis_turn)


def tuft(part, cx, cz, blades, height, mat, k0=0):
    """A few blades of grass, each one double-sided triangle."""
    for i in range(blades):
        t = TAU * i / blades + jit(k0 + i, 0.4)
        lean = (math.cos(t) * 0.03, math.sin(t) * 0.03)
        w = 0.012
        side = (-math.sin(t) * w, math.cos(t) * w)
        h = height * (1 + jit(k0 + 7 + i, 0.25))
        part.both([(cx - side[0], 0.0, cz - side[1]), (cx + side[0], 0.0, cz + side[1]),
                   (cx + lean[0], h, cz + lean[1])], [[0, 1, 2]], mat)


# ---- the nest ------------------------------------------------------------------------------
# A bowl of straw, 0.25 across and a hand high: the outside bulges and is shaded at its foot,
# the rim is the lightest straw, and the hollow inside is dark, which is what tells a nest from
# a haystack's base at orbit distance. Seven sides, each ring turned a little on the one below
# and every radius wobbled, so it reads as straw laid round rather than as a heptagon.
a = collection('prop_trace_nest')
p = Part(a, 'bowl')
S = 7
profile = [(0.0, 0.106), (0.026, 0.124), (0.052, 0.101), (0.043, 0.071)]
loops = [ring(0, 0, y, r, S, phase=0.23 * j, k0=10 * j, wobble=0.07) for j, (y, r) in enumerate(profile)]
band(p, loops[0], loops[1], STRAW_SHADE, radial(0, 0))
band(p, loops[1], loops[2], STRAW, radial(0, 0, 0.3))
band(p, loops[2], loops[3], STRAW, UP)
fan(p, loops[3], (0, 0.024, 0), HOLLOW, UP)
# Two wisps off the rim, which is most of what makes straw look like straw from above. They
# lie along the rim and poke out past it, level: pointing down, the first draft's read as a fang.
for k, t in enumerate((2.3, 4.9)):
    r0, r1 = 0.108, 0.148
    p.both([(math.cos(t - 0.1) * r0, 0.047, math.sin(t - 0.1) * r0),
            (math.cos(t + 0.1) * r0, 0.051, math.sin(t + 0.1) * r0),
            (math.cos(t + 0.42) * r1, 0.05 + 0.004 * k, math.sin(t + 0.42) * r1)], [[0, 1, 2]], STRAW)
p.build()
# Three eggs in the hollow, laid over on their sides; one brown, because a hen's clutch is.
eggs = Part(a, 'eggs')
for (x, z, lay, spin, mat) in ((-0.024, -0.012, 1.25, 0.4, EGG), (0.022, -0.006, 1.1, 2.2, EGG),
                               (0.0, 0.026, 1.3, 1.2, EGG_BROWN)):
    spindle(eggs, (x, 0.038, z), rot_y(spin) @ rot_x(lay), [(-0.008, 0.0135), (0.006, 0.0155)],
            0.022, -0.018, 5, mat)
eggs.build()

# ---- the lookout ---------------------------------------------------------------------------
# A cairn: five flat stones stacked by hand, each a little off the one under it and tipped a
# little, a pointed stone on top, a loose one at the foot and a tuft of grass. The stone sheet
# gives the faces their grain; three greys give the stack its courses.
a = collection('prop_trace_lookout')
p = Part(a, 'cairn')
slabs = [
    # cx, cz, r, y0, h, sides, tip about x, tip about z, material
    (0.0, 0.0, 0.15, 0.0, 0.05, 7, 0.0, 0.0, CAIRN_DARK),
    (0.012, -0.006, 0.122, 0.048, 0.046, 6, 0.05, -0.04, CAIRN),
    (-0.01, 0.008, 0.1, 0.092, 0.044, 6, -0.06, 0.05, CAIRN_PALE),
    (0.006, -0.002, 0.078, 0.134, 0.04, 6, 0.04, 0.06, CAIRN),
    (-0.004, 0.005, 0.056, 0.172, 0.034, 6, -0.05, -0.03, CAIRN_DARK),
]
for i, (cx, cz, r, y0, h, sides, tx, tz, mat) in enumerate(slabs):
    start = len(p.verts)
    prism(p, outline(cx, cz, r, sides, 40 + 10 * i, wobble=0.12, sx=1.0, sz=0.86, phase=0.5 * i),
          y0, y0 + h, mat, top=True, bottom=False)
    if tx or tz:
        p.turn(start, (cx, y0, cz), rot_x(tx) @ rot_z(tz))
# The capstone: a short point, the thing a goat stands beside and looks out from.
fan(p, ring(0.0, 0.004, 0.204, 0.034, 5, phase=0.3, k0=90, wobble=0.1), (0.006, 0.262, 0.0), CAIRN_PALE, 'out')
# A loose stone at the foot, as if one had rolled off.
prism(p, outline(0.19, 0.08, 0.042, 5, 100, wobble=0.15, sz=0.8), 0.0, 0.028, CAIRN, top=True)
tuft(p, -0.13, 0.1, 3, 0.07, TUFT, k0=120)
p.build()

# ---- the perch -----------------------------------------------------------------------------
# A birdhouse on a pole, 0.63 to the ridge: pale box, red roof, a dark round door on the front
# (+z) with a peg under it. The red on a pole is what finds it in a garden from the air.
a = collection('prop_trace_perch')
p = Part(a, 'birdhouse')
box(p, (0, 0.23, 0), (0.028, 0.46, 0.028), POLE, top=False, bottom=False)
# The box: a pentagon extruded along z, gable to the front, its two pitches under the roof.
W, D, Y0, EAVE, RIDGE = 0.05, 0.046, 0.46, 0.56, 0.604
front = [(-W, Y0, D), (W, Y0, D), (W, EAVE, D), (0, RIDGE, D), (-W, EAVE, D)]
back = [(x, y, -D) for x, y, _ in front]
p.add(front, [[0, 1, 2, 3, 4]], BOX, orient=(0, 0, 1))
p.add(back, [[0, 1, 2, 3, 4]], BOX, orient=(0, 0, -1))
p.add([front[0], front[1], back[1], back[0]], [[0, 1, 2, 3]], BOX, orient=DOWN)
p.add([front[1], front[2], back[2], back[1]], [[0, 1, 2, 3]], BOX, orient=(1, 0, 0))
p.add([front[4], front[0], back[0], back[4]], [[0, 1, 2, 3]], BOX, orient=(-1, 0, 0))
# The roof: two boards, overhanging front, back and eaves.
pitch = math.atan2(RIDGE - EAVE, W)
for side in (-1, 1):
    run = math.hypot(W, RIDGE - EAVE) + 0.022
    mid = (side * run / 2 * math.cos(pitch), RIDGE + 0.006 - run / 2 * math.sin(pitch), 0)
    box(p, mid, (run, 0.012, 2 * D + 0.04), BIRD_ROOF, turn=rot_z(-side * pitch))
# The door: a dark hexagon just proud of the front, and the peg below it.
door = ring(0, 0, 0, 0.017, 6, phase=math.pi / 6)
p.add([(x, 0.522 + z, D + 0.0015) for x, _, z in door], [[0, 1, 2, 3, 4, 5]], HOLE, orient=(0, 0, 1))
box(p, (0, 0.49, D + 0.018), (0.008, 0.008, 0.036), POLE, bottom=True)
tuft(p, 0.0, 0.0, 3, 0.06, TUFT, k0=140)
p.build()

# ---- the feeder ----------------------------------------------------------------------------
# The Feathered Corner: a seed tray on a post, a little gabled roof on two uprights over it,
# a heap of seed in the tray and a seed bell hanging off the +x eave. Green roof, so it is not
# mistaken for the birdhouse beside it - they are found together (lib/animal-stories.mjs).
a = collection('prop_trace_feeder')
p = Part(a, 'feeder')
box(p, (0, 0.2, 0), (0.034, 0.4, 0.034), POLE, top=False, bottom=False)
TX, TZ, T0, T1, FLOOR, RIM = 0.1, 0.08, 0.4, 0.43, 0.412, 0.012
outer = rect(0, 0, 2 * TX, 2 * TZ)
inner = rect(0, 0, 2 * (TX - RIM), 2 * (TZ - RIM))
prism(p, outer, T0, T1, TRAY, top=False, bottom=True)
lo = [(x, T1, z) for x, z in outer]
hi = [(x, T1, z) for x, z in inner]
band(p, lo, hi, TRAY, UP)                                     # the rim's top
band(p, [(x, FLOOR, z) for x, z in inner], hi, TRAY, lambda m: (-m.x, 0, -m.z))   # the inner walls, facing in
p.add([(x, FLOOR, z) for x, z in inner], [[0, 1, 2, 3]], SEED, orient=UP)
fan(p, ring(0.015, -0.01, FLOOR, 0.055, 6, phase=0.2, k0=160, wobble=0.15), (0.01, FLOOR + 0.026, -0.005), SEED, 'out')
# Two uprights at the ends of the tray and a roof on them, ridge along x.
for x in (-0.088, 0.088):
    box(p, (x, 0.5, 0), (0.014, 0.14, 0.014), TRAY, top=False, bottom=False)
ROOF_Y, SLOPE = 0.575, math.radians(34)
for side in (-1, 1):
    run = 0.115
    mid = (0, ROOF_Y - run / 2 * math.sin(SLOPE), side * run / 2 * math.cos(SLOPE))
    box(p, mid, (0.27, 0.01, run), FEEDER_ROOF, turn=rot_x(side * SLOPE))
p.build()
# The bell, on its own pivot at the eave: a string, and a lump of seed cake on the end of it.
HANG = (0.12, 0.566, 0.0)
bell = Part(a, 'bell', origin=HANG)
box(bell, (HANG[0], HANG[1] - 0.025, 0), (0.004, 0.05, 0.004), STRING, top=False, bottom=False)
spindle(bell, (HANG[0], HANG[1] - 0.072, 0), None, [(-0.012, 0.02), (0.008, 0.018)], 0.024, -0.024, 5, BELL)
bell.build()

# ---- the print -----------------------------------------------------------------------------
# Two prints of something with three long toes, one foot ahead of the other along +z (the way
# it went), pressed dark into a patch of mud a finger high. Bigger than any hen's on purpose:
# it is the one mark on the island that is not a thing any of its animals would leave.
a = collection('prop_trace_print')
p = Part(a, 'mud')
prism(p, outline(0, 0, 0.2, 9, 200, wobble=0.1, sx=0.74, sz=1.0, phase=0.2), 0.0, 0.006, MUD, top=True)
# Each layer 1.2 mm over the one below: the island's camera has its near plane at 0.5, and a
# 24-bit depth buffer there tells 1.2 mm apart out to about a hundred units off. Closer layers
# shimmer in and out of each other from the orbit camera.
Y = 0.0084


def footprint(part, hx, hz, heading):
    """A heel pad and three toes fanning forward from (hx, hz), `heading` off +z. The toes are
    as broad as they are because a thin one is gone at orbit distance: the first draft's were a
    finger wide and read as an arrow, then as nothing."""
    c, s = math.cos(heading), math.sin(heading)

    def at(u, v):                      # u across, v along the foot
        return (hx + u * c + v * s, Y, hz - u * s + v * c)
    # A squashed ring of lighter, pushed-up mud round the whole print, under it.
    part.add([(x, Y - 0.0012, z) for x, _, z in (at(u, v) for u, v in
              ((-0.05, 0.0), (-0.03, -0.042), (0.03, -0.042), (0.05, 0.0), (0.07, 0.085), (0.0, 0.13), (-0.07, 0.085)))],
             [[0, 1, 2, 3, 4, 5, 6]], MUD_WET, orient=UP)
    part.add([at(u, v) for u, v in ((-0.026, 0.0), (-0.013, -0.026), (0.013, -0.026), (0.026, 0.0), (0.015, 0.022), (-0.015, 0.022))],
             [[0, 1, 2, 3, 4, 5]], PRINT, orient=UP)
    for spread, length in ((-0.6, 0.085), (0.0, 0.105), (0.6, 0.085)):
        cs, sn = math.cos(spread), math.sin(spread)
        right = (cs, -sn)
        root = (sn * 0.012, 0.012 + cs * 0.012)
        mid = (sn * length * 0.78, 0.012 + cs * length * 0.78)
        tip = (sn * length, 0.012 + cs * length)
        pts = [at(root[0] - right[0] * 0.011, root[1] - right[1] * 0.011), at(root[0] + right[0] * 0.011, root[1] + right[1] * 0.011),
               at(mid[0] + right[0] * 0.007, mid[1] + right[1] * 0.007), at(mid[0] - right[0] * 0.007, mid[1] - right[1] * 0.007), at(*tip)]
        part.add(pts, [[0, 1, 2, 3], [3, 2, 4]], PRINT, orient=UP)


footprint(p, -0.048, -0.1, 0.1)
footprint(p, 0.048, 0.04, -0.08)
p.build()

# ---- the find ------------------------------------------------------------------------------
# A brass button half out of a scratched-up patch of earth: the hen found it by digging, so
# there are three dark scratch lines round it. Tipped up on one edge, to catch the light.
a = collection('prop_trace_find')
p = Part(a, 'patch')
prism(p, outline(0, 0, 0.078, 7, 400, wobble=0.14, sx=1.0, sz=0.85), 0.0, 0.005, SCRATCHED, top=True)
for i, (x, z, t) in enumerate(((-0.045, -0.02, 0.5), (0.04, -0.035, -0.3), (0.035, 0.035, 0.2))):
    c, s = math.cos(t), math.sin(t)
    pts = [(x + u * c - v * s, 0.0062, z + u * s + v * c) for u, v in ((-0.025, -0.003), (0.025, -0.003), (0.025, 0.003), (-0.025, 0.003))]
    p.add(pts, [[0, 1, 2, 3]], SCRATCH, orient=UP)
# Its low edge ends a hair above the ground once tipped (0.36 of its radius down), so it is in
# the patch without being under the island.
start = len(p.verts)
prism(p, outline(-0.004, 0.004, 0.026, 8, 0), 0.0095, 0.0165, BRASS, top=True)
for hx in (-0.006, 0.006):
    p.add([(x, 0.0178, z) for x, z in rect(-0.004 + hx, 0.004, 0.005, 0.005)], [[0, 1, 2, 3]], BRASS_DARK, orient=UP)
p.turn(start, (-0.004, 0.0095, 0.004), rot_x(-0.32) @ rot_z(0.18))
p.build()
# The glint: a four-pointed spark in three planes, so it reads from wherever the camera is.
# traces.js flashes it by scaling it about this origin.
GLINT_AT = (-0.004, 0.044, 0.004)
g = Part(a, 'glint', origin=GLINT_AT)
# Modelled at the size of a flash at its brightest; traces.js keeps it at a third of that
# between flashes, where at full size it stood over the button like a trophy.
L, Wd = 0.024, 0.0045
for plane in ('xy', 'zy', 'xz'):
    def pt(u, v, plane=plane):
        gx, gy, gz = GLINT_AT
        if plane == 'xy':
            return (gx + u, gy + v, gz)
        if plane == 'zy':
            return (gx, gy + v, gz + u)
        return (gx + u, gy, gz + v)
    g.both([pt(-L, 0), pt(0, -Wd), pt(L, 0), pt(0, Wd)], [[0, 1, 2, 3]], GLINT)
    g.both([pt(0, -L), pt(Wd, 0), pt(0, L), pt(-Wd, 0)], [[0, 1, 2, 3]], GLINT)
g.build()

# ---- the cache -----------------------------------------------------------------------------
# The old keeper's chest: grey weathered boards, iron straps, a brass lock plate on the front
# (+z), the lid ajar on its back hinge, a logbook inside, and beside it the signal lamp whose
# glass lights after dark like every lamp on the island.
a = collection('prop_trace_cache')
p = Part(a, 'chest')
CX, HW, HD, H = -0.05, 0.11, 0.07, 0.1
prism(p, rect(CX, 0, 2 * HW, 2 * HD), 0.0, H, CHEST, top=False, bottom=False)
p.add([(x, H - 0.008, z) for x, z in rect(CX, 0, 2 * HW - 0.004, 2 * HD - 0.004)], [[0, 1, 2, 3]], INSIDE, orient=UP)
for sx in (-0.07, 0.07):                                        # straps, front and back
    for sz in (1, -1):
        z = sz * (HD + 0.0012)
        p.add([(CX + sx - 0.009, 0.0, z), (CX + sx + 0.009, 0.0, z), (CX + sx + 0.009, H, z), (CX + sx - 0.009, H, z)],
              [[0, 1, 2, 3]], IRON, orient=(0, 0, sz))
z = HD + 0.0016
p.add([(CX - 0.016, H - 0.045, z), (CX + 0.016, H - 0.045, z), (CX + 0.016, H - 0.008, z), (CX - 0.016, H - 0.008, z)],
      [[0, 1, 2, 3]], LOCK, orient=(0, 0, 1))
box(p, (CX - 0.02, H - 0.008 + 0.011, -0.005), (0.075, 0.022, 0.052), LOGBOOK, bottom=False, turn=rot_y(0.25))
# The lid: a three-facet vault along x, hinged at the back top edge and opened 50 degrees.
start = len(p.verts)
vault = [(HD, 0.0), (HD, 0.024), (0.036, 0.046), (-0.036, 0.046), (-HD, 0.024), (-HD, 0.0)]      # (z, y)
x0, x1 = CX - HW - 0.003, CX + HW + 0.003
left = [(x0, H + y, z) for z, y in vault]
right = [(x1, H + y, z) for z, y in vault]
n = len(vault)
p.add(left + right, [[i, i + 1, n + i + 1, n + i] for i in range(n - 1)], CHEST_LID, orient='out')
p.add(left + right, [[n - 1, 0, n, 2 * n - 1]], INSIDE, orient=DOWN)
p.add(left, [list(range(n))], CHEST_LID, orient=(-1, 0, 0))
p.add(right, [list(range(n))], CHEST_LID, orient=(1, 0, 0))
for sx in (-0.07, 0.07):                                        # the straps over the vault's crown
    p.add([(CX + sx - 0.009, H + 0.0475, 0.036), (CX + sx + 0.009, H + 0.0475, 0.036),
           (CX + sx + 0.009, H + 0.0475, -0.036), (CX + sx - 0.009, H + 0.0475, -0.036)], [[0, 1, 2, 3]], IRON, orient=UP)
p.turn(start, (0, H, -HD), rot_x(-math.radians(50)))
p.build()
lamp = Part(a, 'lamp')
LX, LZ = 0.12, 0.025
box(lamp, (LX, 0.009, LZ), (0.068, 0.018, 0.068), LAMP, bottom=False)
box(lamp, (LX, 0.048, LZ), (0.05, 0.06, 0.05), LAMP_GLASS, top=False, bottom=False)
box(lamp, (LX, 0.084, LZ), (0.068, 0.012, 0.068), LAMP, bottom=True, top=False)
fan(lamp, [(x, 0.09, z) for x, _, z in [(LX + dx, 0, LZ + dz) for dx, dz in ((-0.034, -0.034), (0.034, -0.034), (0.034, 0.034), (-0.034, 0.034))]],
    (LX, 0.112, LZ), LAMP, 'out')
# The carrying ring: two thin uprights off the cap's point and a bar across them.
for dx in (-0.014, 0.014):
    box(lamp, (LX + dx, 0.121, LZ), (0.004, 0.022, 0.004), IRON, top=False, bottom=False)
box(lamp, (LX, 0.133, LZ), (0.032, 0.004, 0.004), IRON, bottom=False)
lamp.build()

bpy.context.scene['building_height'] = 0.63
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'traces.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'traces'})
