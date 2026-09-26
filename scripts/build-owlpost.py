"""The owl post. Rebuild with scripts/blender.mjs --background --python scripts/build-owlpost.py.

The village post office, where the letters go out by owl: a narrow square stone tower under a
steep slate spire, its upper storeys faced with a grid of little arched nest boxes in
slate-blue woodwork with owls sitting in them, a dormer high on the spire with one more owl in
it, and a stone owl with its wings spread over the door. Against the tower, lower and plastered
and half-timbered, a wing with the shop window on its right and a small gabled parcel room on
its left, a heap of parcels tied with string in front of each, and a round sign with an
envelope on it hung out on a bracket from the tower's corner. Not yet placed on the island
(Plans/knus-dorpscentrum.md); it is one of the shops of the new streets.

One civic asset, `civic_owlpost` (budget 1500), all of it merged - nothing on it moves.
`anchor.smoke` is on the wing's chimney, `anchor.door` at the foot of the door. Written in
island coordinates (x right, y up, z to the front) through xyz().

It stands in a terrace, shoulder to shoulder with the next shop, so it fills its 3x3 lot's
width (x within +-1.46 with the eaves, the lot edge is 1.50) and nothing but the door step,
the parcels, the sign and the stone owl comes forward of the tower's front at z = 1.10 (the
sign's bracket, furthest, ends at 1.46).

Why the tower is where it is: a first version put a 1.5-wide tower at the left edge with the
door off to its right, and it read as a house with a hipped roof - at that width a spire
capped at 3.5 cannot be steeper than 50 degrees. At 1.24 wide it is 59 degrees and reads as a
tower, and standing just left of the middle it has the door centred under it within reach of
the middle of the lot's front, where the island's paths arrive. What is left either side is
a low gable each, the shop on the right being the wider.

Why so coarse: a nest box is a flat dark arch on a board with a shelf under it and dividers
beside it, not a hollow - a real recess costs five times the triangles and reads the same at
the distance the island is looked at from. An owl is a six-sided lump in two bands whose top
ring has its two side corners pulled up into ear tufts, with a pale quad for the face; the
triangles go on owls rather than on a second grid of boxes on the tower's side, which the
wing's roof hides from most of the angles the island is seen from.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/owlpost'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def material(sheet, name, color, emissive=False):
    m = bpy.data.materials.new(f'{sheet}:{name}')
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    if emissive:
        m['emissive'] = 1.0
    return m


STONE = material('stone', 'owlpost tower', 0x9a948a)
STONE_LIGHT = material('stone', 'owlpost dressing', 0xc2bbae)
STONE_DARK = material('stone', 'owlpost footing', 0x77726b)
PLASTER = material('wall', 'owlpost plaster', 0xeee3ca)
TIMBER = material('plank', 'owlpost timber', 0x4a3323)
SLATE = material('roof', 'owlpost slate', 0x3e4755)
# The woodwork: deep slate blue going teal. The boxes' boards are a shade lighter than the
# panel they are nailed to, so the grid reads as a grid and not as one painted slab.
WOOD = material('plank', 'owlpost slate blue', 0x2c5364)
WOOD_LIGHT = material('plank', 'owlpost slate blue trim', 0x3d6e80)
PANEL = material('plain', 'owlpost nest board', 0x254655)
HOLE = material('plain', 'owlpost nest box', 0x1a1f23)
# A few nests have a lamp lit at the back: at night the owl in front of it is a silhouette.
HOLE_LIT = material('plain', 'owlpost lit nest', 0x6e4c2c, emissive=True)
GLASS = material('plain', 'owlpost window', 0x2b3137)
WINDOW_GLOW = material('plain', 'owlpost lit window', 0xffd88a, emissive=True)
IRON = material('plain', 'owlpost iron', 0x2f3035)
BRASS = material('plain', 'owlpost brass', 0xc09a44)
KRAFT_A = material('plain', 'owlpost parcel', 0xb98a57)
KRAFT_B = material('plain', 'owlpost parcel dark', 0xa27546)
KRAFT_C = material('plain', 'owlpost parcel light', 0xcaa06a)
STRING = material('plain', 'owlpost string', 0x57402b)
PAPER = material('plain', 'owlpost envelope', 0xf3ecdb)
INK = material('plain', 'owlpost envelope fold', 0x5f5040)
SEAL = material('plain', 'owlpost wax seal', 0xb0322a)
BEAK = material('plain', 'owlpost beak', 0xc99a3a)
OWLS = [  # body, face
    (material('plain', 'owlpost brown owl', 0x7b5a3a), material('plain', 'owlpost brown owl face', 0xdcc9a4)),
    (material('plain', 'owlpost grey owl', 0x8d8983), material('plain', 'owlpost grey owl face', 0xe7e2d7)),
    (material('plain', 'owlpost snowy owl', 0xebe7dd), material('plain', 'owlpost snowy owl face', 0xfbf8f1)),
    (material('plain', 'owlpost tawny owl', 0xa3703f), material('plain', 'owlpost tawny owl face', 0xe9d5ae)),
]


class Part:
    def __init__(self, asset, name, origin=(0, 0, 0)):
        self.asset, self.name, self.origin = asset, f'{asset.name} {name}', Vector(origin)
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def add(self, points, faces, mat):
        base, s = len(self.verts), self.slot(mat)
        self.verts.extend(Vector(p) - self.origin for p in points)
        for f in faces:
            self.faces.append([base + i for i in f])
            self.mats.append(s)

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


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


# A box's six faces by the way they look, so a box against a wall or on the ground can leave
# out the face nobody will ever see - over a hundred boxes, that is two owls' worth.
BOX_FACES = {'-z': [0, 3, 2, 1], '+z': [4, 5, 6, 7], '-y': [0, 1, 5, 4],
             '+y': [2, 3, 7, 6], '+x': [1, 2, 6, 5], '-x': [0, 4, 7, 3]}


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, drop=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [f for k, f in BOX_FACES.items() if k not in drop], mat)


def span(part, x0, x1, y0, y1, z0, z1, mat, drop=()):
    box(part, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), mat, drop=drop)


def solid(part, pts, faces, mat, inside=None):
    """Faces turned outwards from the middle of the shape (or from `inside`), whatever order
    they were listed in: the spire, the roof slabs and the owls are star-shaped round their
    middle, and working out the winding of every one of them by hand is where a face goes
    missing."""
    pts = [Vector(p) for p in pts]
    c = Vector(inside) if inside is not None else sum(pts, Vector()) / len(pts)
    out = []
    for f in faces:
        n = Vector()
        for i, j in zip(f, f[1:] + f[:1]):
            a, b = pts[i], pts[j]
            n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
        mid = sum((pts[i] for i in f), Vector()) / len(f)
        out.append(f if n.dot(mid - c) >= 0 else f[::-1])
    part.add(pts, out, mat)


def cylinder(part, a, b, r, mat, sides=6, cap=None):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(2 * math.pi * (i + .5) / sides) + v * math.sin(2 * math.pi * (i + .5) / sides)) * r for i in range(sides)]
    pts = ring(a) + ring(b)
    solid(part, pts, [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap:
        solid(part, pts, [list(range(sides)), list(range(sides, 2 * sides))], cap)


class Face:
    """A wall seen from outside: u runs to the right along it, d straight out of it."""

    def __init__(self, ox, oz, ux, uz):
        self.o, self.u, self.n = (ox, oz), (ux, uz), (-uz, ux)
        self.yaw = math.atan2(-uz, ux)      # turns a box's x onto u and its z onto d

    def at(self, u, y, d=0.0):
        return (self.o[0] + u * self.u[0] + d * self.n[0], y, self.o[1] + u * self.u[1] + d * self.n[1])

    def box(self, part, u, y, d, size, mat, drop=('-z',), ry=0.0):
        """A box sized (along u, up, out of the wall), its back to the wall by default."""
        box(part, self.at(u, y, d), size, mat, ry=self.yaw + ry, drop=drop)


def arch(uc, yb, w, hr, segs=4):
    """An arched opening's outline, anticlockwise from the bottom left: a rectangle hr tall
    with a half round of `segs` straight pieces on top."""
    r = w / 2
    pts = [(uc - r, yb), (uc + r, yb)]
    for k in range(segs + 1):
        a = math.pi * k / segs
        pts.append((uc + r * math.cos(a), yb + hr + r * math.sin(a)))
    return pts


def flat(part, face, outline, d, mat):
    part.add([face.at(u, y, d) for u, y in outline], [list(range(len(outline)))], mat)


def pane(part, face, u, y, w, h, d, mat):
    """A flat rectangle centred on (u, y), d out of the wall: a window's glass or its glow."""
    flat(part, face, [(u - w / 2, y - h / 2), (u + w / 2, y - h / 2), (u + w / 2, y + h / 2), (u - w / 2, y + h / 2)], d, mat)


def prism(part, face, outline, d0, d1, mat):
    """An outline stood out of a wall from d0 to d1: its front and its edges, no back."""
    n = len(outline)
    pts = [face.at(u, y, d0) for u, y in outline] + [face.at(u, y, d1) for u, y in outline]
    faces = [list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    part.add(pts, faces, mat)


def owl(part, face, u, y, d, colours, scale=1.0, turn=0.0, beak=None):
    """A sitting owl, 0.13 tall at scale 1, standing on (u, y) in front of `face` at depth d.

    Two bands of six sides and a fan on top; the fan's two side corners are lifted into ear
    tufts, which is the whole difference between an owl and a pepper pot at this size."""
    body, face_mat = colours
    ca, sa = math.cos(turn), math.sin(turn)
    # The owl's own right and forward, turned by `turn` from the wall's.
    fu = (face.u[0] * ca + face.n[0] * sa, face.u[1] * ca + face.n[1] * sa)
    fn = (face.n[0] * ca - face.u[0] * sa, face.n[1] * ca - face.u[1] * sa)
    base = face.at(u, y, d)

    def p(r_u, h, r_n):
        return Vector((base[0] + (fu[0] * r_u + fn[0] * r_n) * scale, base[1] + h * scale,
                       base[2] + (fu[1] * r_u + fn[1] * r_n) * scale))

    def ring(h, r, tuft=0.0):
        out = []
        for k in range(6):
            a = math.pi * k / 3            # corners at 0 and 180 degrees are the sides
            lift = tuft if k in (0, 3) else 0.0
            rr = r * (0.85 if lift else 1.0)
            out.append(p(rr * math.cos(a), h + lift, rr * math.sin(a) * 0.9))
        return out

    rings = [ring(0.0, 0.031), ring(0.052, 0.045), ring(0.1, 0.034, tuft=0.034)]
    pts = rings[0] + rings[1] + rings[2] + [p(0, 0.106, 0)]
    faces = []
    for j in range(2):
        for k in range(6):
            faces.append([j * 6 + k, j * 6 + (k + 1) % 6, (j + 1) * 6 + (k + 1) % 6, (j + 1) * 6 + k])
    faces += [[12 + k, 12 + (k + 1) % 6, 18] for k in range(6)]
    solid(part, pts, faces, body, inside=p(0, 0.05, 0))
    # The face: the front quad of the upper band (corners 1 and 2 face forward), a shade paler
    # and a hair proud of it, with the beak a single triangle in the middle.
    lo1, lo2, hi1, hi2 = rings[1][1], rings[1][2], rings[2][1], rings[2][2]
    out = Vector((fn[0], 0, fn[1])) * 0.004 * scale
    mid = (lo1 + lo2 + hi1 + hi2) / 4
    quad = [mid + (q - mid) * 0.84 + out for q in (lo2, lo1, hi1, hi2)]
    quad[0].y += 0.008 * scale; quad[1].y += 0.008 * scale
    behind = mid - out * 4
    solid(part, quad, [[0, 1, 2, 3]], face_mat, inside=behind)
    side = Vector((fu[0], 0, fu[1])) * 0.009 * scale
    tip = [mid + out * 1.5 + Vector((0, -0.004 * scale, 0)) + side, mid + out * 1.5 + Vector((0, -0.004 * scale, 0)) - side,
           mid + out * 1.5 + Vector((0, -0.024 * scale, 0))]
    solid(part, tip, [[0, 1, 2]], beak or BEAK, inside=behind)


def gable_house(part, x0, x1, z0, z1, eaves, ridge, face_z, frame):
    """A plastered block with a gable at each end, on a stone footing, its front framed in
    dark timber. `frame` lists (x, y, width, height, turn) in the front's own plane."""
    span(part, x0, x1, FOOT, eaves, z0, z1, PLASTER, drop=('-y', '+y'))
    span(part, x0, x1, 0, FOOT, z0 - 0.02, z1 + 0.03, STONE_DARK, drop=('-y',))
    xc = (x0 + x1) / 2
    for z, order in ((z1, (0, 1, 2)), (z0, (0, 2, 1))):
        part.add([(x0, eaves, z), (x1, eaves, z), (xc, ridge, z)], [list(order)], PLASTER)
    for x, y, w, h, rz in frame:
        box(part, (x, y, face_z + 0.011), (w, h, 0.022), TIMBER, rz=rz, drop=('-z',))


def beam(a, b, w=0.035):
    """A timber from a to b in the plane of a wall, as a frame entry."""
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, w, math.dist(a, b), -math.atan2(b[0] - a[0], b[1] - a[1]))


def pitch(part, a, b, z0, z1, t, mat):
    """A roof slab whose underside runs from a to b (x, y) and from z0 to z1, t thick."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = Vector((-dy, dx))
    n = (n if n.y > 0 else -n).normalized() * t
    ends = [a, b, (b[0] + n.x, b[1] + n.y), (a[0] + n.x, a[1] + n.y)]
    solid(part, [(x, y, z) for z in (z0, z1) for x, y in ends],
          [[0, 1, 2, 3], [4, 5, 6, 7], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], mat)


def gable_roof(part, x0, x1, z0, z1, eaves, ridge, over_left, over_right, front):
    """Two slate pitches and a ridge over gable_house(); an overhang of 0 is a side that butts
    against the tower. Barge boards in the woodwork's colour along the front gable."""
    xc = (x0 + x1) / 2
    ends = []
    for x, over in ((x0, over_left), (x1, over_right)):
        run = Vector((x - xc, eaves - ridge)).normalized()
        end = (x + run.x * over, eaves + run.y * over)
        pitch(part, (xc, ridge), end, z0 - 0.06, front, 0.045, SLATE)
        ends.append(end)
    box(part, (xc, ridge + 0.045, (z0 - 0.06 + front) / 2), (0.08, 0.04, front - z0 + 0.07), SLATE, drop=('-y',))
    for end in ends:
        a, b = Vector((xc, ridge + 0.02)), Vector((end[0] - 0.012 * (1 if end[0] > xc else -1), end[1]))
        mid = (a + b) / 2
        box(part, (mid.x, mid.y, front + 0.012), ((b - a).length, 0.05, 0.024), WOOD, rz=math.atan2(b.y - a.y, b.x - a.x), drop=('-z',))


ASSET = bpy.data.collections.new('civic_owlpost')
bpy.context.scene.collection.children.link(ASSET)
FOOT = 0.10                                 # top of the stone footing

# The tower: square, just left of the middle, its front a hand proud of the wings'.
TX0, TX1, TZ1 = -0.82, 0.42, 1.10
TZ0 = TZ1 - (TX1 - TX0)
TCX, TCZ = (TX0 + TX1) / 2, (TZ0 + TZ1) / 2
TE = 2.30                                   # top of the tower's walls
APEX = 3.39
# The shop on the right and the parcel room on the left, each under a steep front gable.
RX0, RX1, WZ0, WZ1 = TX1, 1.40, -1.30, 1.00
RE, RR = 1.42, 2.12
LX0, LX1 = -1.40, TX0
LE, LR = 1.24, 1.70
RC, LC = (RX0 + RX1) / 2, (LX0 + LX1) / 2

FRONT = Face(0, TZ1, 1, 0)
WING = Face(0, WZ1, 1, 0)
BACK = Face(TX1, TZ0, -1, 0)
LEFT = Face(TX0, TZ0, 0, 1)

# ---- the tower -----------------------------------------------------------------------------
tower = Part(ASSET, 'tower')
DX = TCX
span(tower, TX0, TX1, 0, TE, TZ0, TZ1, STONE, drop=('-y',))
# The footing stands proud of the wall everywhere but under the door, which comes down to a step.
span(tower, TX0 - 0.02, DX - 0.2, 0, FOOT, TZ0, TZ1 + 0.03, STONE_DARK, drop=('-y', '-z'))
span(tower, DX + 0.2, TX1 + 0.02, 0, FOOT, TZ0, TZ1 + 0.03, STONE_DARK, drop=('-y', '-z'))
span(tower, TX0 - 0.02, TX1 + 0.02, 1.02, 1.07, TZ0 - 0.02, TZ1 + 0.025, STONE_LIGHT)
span(tower, TX0 - 0.03, TX1 + 0.03, TE - 0.07, TE, TZ0 - 0.03, TZ1 + 0.03, STONE_LIGHT)

# The door, in a dressed-stone arch with a keystone, on a step, and a brass letter slot.
prism(tower, FRONT, arch(DX, 0.0, 0.40, 0.46), 0, 0.022, STONE_LIGHT)
prism(tower, FRONT, arch(DX, 0.04, 0.28, 0.42), 0.022, 0.034, WOOD)
FRONT.box(tower, DX, 0.665, 0.015, (0.07, 0.08, 0.03), STONE_LIGHT)
span(tower, DX - 0.24, DX + 0.24, 0, 0.04, TZ1, TZ1 + 0.1, STONE_DARK, drop=('-y', '-z'))
FRONT.box(tower, DX + 0.09, 0.28, 0.042, (0.022, 0.03, 0.016), BRASS)
FRONT.box(tower, 0.16, 0.5, 0.008, (0.11, 0.03, 0.016), BRASS)
FRONT.box(tower, 0.16, 0.5, 0.012, (0.08, 0.008, 0.016), IRON)

# A narrow window on the other side, arched like the nest boxes, lit from inside.
WIN = -0.6
prism(tower, FRONT, arch(WIN, 0.30, 0.28, 0.28), 0, 0.02, STONE_LIGHT)
flat(tower, FRONT, arch(WIN, 0.34, 0.2, 0.25), 0.022, GLASS)
flat(tower, FRONT, arch(WIN, 0.38, 0.12, 0.2), 0.026, WINDOW_GLOW)
FRONT.box(tower, WIN, 0.285, 0.0, (0.34, 0.035, 0.12), STONE_LIGHT)

# The stone owl over the door: the owl's own lump at half as big again on a corbel, and two
# flat wings spread against the wall behind it.
FRONT.box(tower, DX, 0.725, 0.02, (0.14, 0.05, 0.1), STONE_LIGHT)
owl(tower, FRONT, DX, 0.75, 0.055, (STONE_LIGHT, STONE_LIGHT), scale=1.45, beak=STONE_LIGHT)
for s in (-1, 1):
    wing = [(DX + s * u, y) for u, y in ((0.04, 0.80), (0.17, 0.85), (0.23, 0.99), (0.03, 0.915))]
    prism(tower, FRONT, wing if s > 0 else wing[::-1], 0.004, 0.03, STONE_LIGHT)

# Small windows high on the back and on the left, over the lean-to and the parcel room.
for face, u in ((BACK, 0.62), (LEFT, 0.62)):
    flat(tower, face, [(u - 0.11, 1.7), (u + 0.11, 1.7), (u + 0.11, 1.98), (u - 0.11, 1.98)], 0.004, GLASS)
    flat(tower, face, [(u - 0.06, 1.75), (u + 0.06, 1.75), (u + 0.06, 1.93), (u - 0.06, 1.93)], 0.008, WINDOW_GLOW)

# The lean-to behind the tower, plastered like the wings.
solid(tower, [(TX0, FOOT, WZ0), (TX1, FOOT, WZ0), (TX1, FOOT, TZ0), (TX0, FOOT, TZ0),
              (TX0, 1.14, WZ0), (TX1, 1.14, WZ0), (TX1, 1.5, TZ0), (TX0, 1.5, TZ0)],
      [[4, 5, 6, 7], [0, 1, 5, 4], [0, 4, 7, 3], [1, 2, 6, 5]], PLASTER)
span(tower, TX0, TX1, 0, FOOT, WZ0 - 0.02, TZ0, STONE_DARK, drop=('-y', '+x', '-x'))
solid(tower, [(TX0, 1.49, TZ0), (TX1, 1.49, TZ0), (TX0, 1.1, WZ0 - 0.06), (TX1, 1.1, WZ0 - 0.06),
              (TX0, 1.535, TZ0), (TX1, 1.535, TZ0), (TX0, 1.145, WZ0 - 0.06), (TX1, 1.145, WZ0 - 0.06)],
      [[4, 5, 7, 6], [0, 1, 3, 2], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]], SLATE)
tower.build()

# ---- the spire -----------------------------------------------------------------------------
# A square pyramid that kicks out at the eaves (bellcast) over a fascia, and a brass finial.
spire = Part(ASSET, 'spire')
H0, H1, KICK = 0.71, 0.58, TE + 0.14


def square(h, y):
    return [(TCX - h, y, TCZ - h), (TCX - h, y, TCZ + h), (TCX + h, y, TCZ + h), (TCX + h, y, TCZ - h)]


pts = square(H0, TE - 0.03) + square(H0, TE + 0.03) + square(H1, KICK) + [(TCX, APEX, TCZ)]
faces = [[3, 2, 1, 0]]
for j in range(2):
    faces += [[j * 4 + k, j * 4 + (k + 1) % 4, (j + 1) * 4 + (k + 1) % 4, (j + 1) * 4 + k] for k in range(4)]
faces += [[8 + k, 8 + (k + 1) % 4, 12] for k in range(4)]
solid(spire, pts, faces, SLATE, inside=(TCX, TE + 0.3, TCZ))
cylinder(spire, (TCX, APEX - 0.08, TCZ), (TCX, APEX + 0.04, TCZ), 0.016, BRASS, sides=4)
solid(spire, [(TCX, APEX + 0.03, TCZ), (TCX, APEX + 0.11, TCZ)] +
      [(TCX + 0.035 * math.cos(a), APEX + 0.07, TCZ + 0.035 * math.sin(a)) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)],
      [[0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 2], [1, 3, 2], [1, 4, 3], [1, 5, 4], [1, 2, 5]], BRASS)

# A dormer on the front pitch with the highest nest of all in it.
slope = lambda z: KICK + (APEX - KICK) * (1 - (z - TCZ) / H1)
DF = TCZ + 0.4                                   # the dormer's front
RL = slope(DF)                                   # where the pitch meets it
DW, DT, DP = 0.26, RL + 0.22, RL + 0.35
span(spire, TCX - DW / 2, TCX + DW / 2, RL - 0.03, DT, TCZ + 0.15, DF, STONE, drop=('-y', '-z'))
spire.add([(TCX - DW / 2, DT, DF), (TCX + DW / 2, DT, DF), (TCX, DP, DF)], [[0, 1, 2]], STONE)
for s in (-1, 1):
    e = s * (DW / 2 + 0.04)
    solid(spire, [(TCX, DP + 0.03, DF + 0.04), (TCX + e, DT - 0.02, DF + 0.04), (TCX, DP + 0.03, TCZ + 0.1), (TCX + e, DT - 0.02, TCZ + 0.1),
                  (TCX, DP, DF + 0.04), (TCX + e, DT - 0.05, DF + 0.04), (TCX, DP, TCZ + 0.1), (TCX + e, DT - 0.05, TCZ + 0.1)],
          [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [1, 3, 7, 5]], SLATE)
DORMER = Face(0, DF, 1, 0)
flat(spire, DORMER, arch(TCX, RL + 0.03, 0.15, 0.07), 0.004, HOLE_LIT)
DORMER.box(spire, TCX, RL + 0.03, 0.03, (0.2, 0.02, 0.07), WOOD)
spire.build()

# ---- the nest boxes ------------------------------------------------------------------------
nests = Part(ASSET, 'nests')
owls = Part(ASSET, 'owls')
OWL = 1.4                                        # how big an owl in a box is


def nest_grid(face, u0, u1, y0, cols, rows, h, fill, lit):
    """A board of cols x rows arched boxes from (u0, y0), each box `h` tall.

    `fill[(col, row)]` is what sits in a box: an owl colour index, 'lit' for an empty box with
    its lamp on, or 'letters' for a bundle of post waiting to go; the boxes in `lit` have
    their lamp on."""
    y1 = y0 + rows * h
    w = (u1 - u0) / cols
    face.box(nests, (u0 + u1) / 2, (y0 + y1) / 2, 0.015, (u1 - u0 + 0.04, y1 - y0 + 0.04, 0.03), PANEL)
    for k in range(rows + 1):
        face.box(nests, (u0 + u1) / 2, y0 + k * h, 0.075, (u1 - u0 + 0.04, 0.03, 0.09), WOOD_LIGHT)
    for k in range(cols + 1):
        face.box(nests, u0 + k * w, (y0 + y1) / 2, 0.065, (0.03, y1 - y0, 0.07), WOOD, drop=('-z', '-y', '+y'))
    # A little pent roof over the whole board, to keep the rain off the owls.
    solid(nests, [face.at(u0 - 0.04, y1 + 0.02, 0.0), face.at(u1 + 0.04, y1 + 0.02, 0.0),
                  face.at(u0 - 0.04, y1 - 0.01, 0.17), face.at(u1 + 0.04, y1 - 0.01, 0.17),
                  face.at(u0 - 0.04, y1 + 0.06, 0.0), face.at(u1 + 0.04, y1 + 0.06, 0.0),
                  face.at(u0 - 0.04, y1 + 0.03, 0.18), face.at(u1 + 0.04, y1 + 0.03, 0.18)],
          [[4, 5, 7, 6], [0, 1, 3, 2], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]], SLATE)
    for c in range(cols):
        for r in range(rows):
            uc, yb = u0 + (c + 0.5) * w, y0 + r * h + 0.015
            what = fill.get((c, r))
            flat(nests, face, arch(uc, yb, w * 0.66, h * 0.36), 0.031, HOLE_LIT if (c, r) in lit else HOLE)
            if isinstance(what, int):
                owl(owls, face, uc + (0.012 if c % 2 else -0.012), yb, 0.085, OWLS[what], scale=OWL,
                    turn=0.15 * ((c * 2 + r) % 3 - 1))
            elif what == 'letters':
                face.box(nests, uc - 0.02, yb + 0.03, 0.035, (w * 0.42, 0.06, 0.07), PAPER, drop=('-y', '-z'), ry=0.12)
                face.box(nests, uc - 0.02, yb + 0.03, 0.035, (0.014, 0.064, 0.074), STRING, drop=('-y', '-z'), ry=0.12)


nest_grid(FRONT, TX0 + 0.09, TX1 - 0.09, 1.12, 3, 3, 0.33,
          {(0, 0): 0, (1, 0): 'letters', (2, 0): 3, (1, 1): 2, (1, 2): 1, (2, 2): 0},
          lit={(0, 1), (1, 1), (1, 2)})
owl(owls, DORMER, TCX, RL + 0.035, 0.045, OWLS[2], scale=1.05)
nests.build()

# ---- the wings -----------------------------------------------------------------------------
wings = Part(ASSET, 'wings')
T = 0.022
gable_house(wings, RX0, RX1, WZ0, WZ1, RE, RR, WZ1, [
    (RX0 + 0.03, (FOOT + RE) / 2, 0.05, RE - FOOT, 0),
    (RX1 - 0.025, (FOOT + RE) / 2, 0.05, RE - FOOT, 0),
    (RC, 1.0, RX1 - RX0, 0.04, 0),
    (RC, RE - 0.02, RX1 - RX0 + 0.03, 0.045, 0),
    (RC, (RE + RR) / 2 - 0.04, 0.04, RR - RE - 0.08, 0),
    beam((RC, 1.8), (RC - 0.34, RE)), beam((RC, 1.8), (RC + 0.34, RE)),
    beam((RX0 + 0.05, 1.02), (RC - 0.2, RE - 0.04)), beam((RX1 - 0.05, 1.02), (RC + 0.2, RE - 0.04)),
])
gable_house(wings, LX0, LX1, WZ0, WZ1, LE, LR, WZ1, [
    (LX0 + 0.025, (FOOT + LE) / 2, 0.05, LE - FOOT, 0),
    (LX1 - 0.03, (FOOT + LE) / 2, 0.05, LE - FOOT, 0),
    (LC, LE - 0.02, LX1 - LX0 + 0.03, 0.045, 0),
    (LC, (LE + LR) / 2 - 0.03, 0.035, LR - LE - 0.06, 0),
])
# The shop window, a slate-blue frame with a bar, and a small window upstairs.
SW = RC
pane(wings, WING, SW, 0.63, 0.54, 0.44, 0.004, GLASS)
pane(wings, WING, SW, 0.63, 0.42, 0.32, 0.008, WINDOW_GLOW)
box(wings, (SW, 0.63, WZ1 + 0.022), (0.024, 0.44, 0.014), WOOD, drop=('-z',))
box(wings, (SW, 0.395, WZ1 + 0.035), (0.62, 0.03, 0.07), WOOD, drop=('-z',))
box(wings, (SW, 0.865, WZ1 + 0.03), (0.6, 0.035, 0.06), WOOD, drop=('-z',))
pane(wings, WING, RC, 1.21, 0.24, 0.24, 0.004, GLASS)
pane(wings, WING, RC, 1.21, 0.15, 0.15, 0.008, WINDOW_GLOW)
box(wings, (RC, 1.085, WZ1 + 0.03), (0.3, 0.025, 0.05), WOOD, drop=('-z',))
# The parcel room's window with its slate-blue shutters folded back.
pane(wings, WING, LC, 0.72, 0.2, 0.26, 0.004, GLASS)
pane(wings, WING, LC, 0.72, 0.12, 0.17, 0.008, WINDOW_GLOW)
for s in (-1, 1):
    box(wings, (LC + s * 0.16, 0.72, WZ1 + 0.012), (0.1, 0.28, 0.02), WOOD, drop=('-z',))
box(wings, (LC, 0.575, WZ1 + 0.03), (0.26, 0.025, 0.06), WOOD, drop=('-z',))
# Windows on the back too, for whichever way the island turns it.
REAR = Face(0, WZ0, -1, 0)
for x, w in ((RC, 0.3), (LC, 0.18)):
    pane(wings, REAR, -x, 0.72, w, 0.28, 0.004, GLASS)
    pane(wings, REAR, -x, 0.72, w - 0.1, 0.18, 0.008, WINDOW_GLOW)
# The chimney, out of the shop's right pitch towards the back.
CX, CZ = 1.12, -0.8
span(wings, CX - 0.08, CX + 0.08, 1.62, 2.44, CZ - 0.08, CZ + 0.08, STONE, drop=('-y',))
span(wings, CX - 0.1, CX + 0.1, 2.44, 2.49, CZ - 0.1, CZ + 0.1, STONE_LIGHT, drop=())
wings.build()

roof = Part(ASSET, 'roof')
gable_roof(roof, RX0, RX1, WZ0, WZ1, RE, RR, 0.0, 0.04, WZ1 + 0.08)
gable_roof(roof, LX0, LX1, WZ0, WZ1, LE, LR, 0.03, 0.0, WZ1 + 0.07)
roof.build()

# ---- the front: the sign, the parcels ------------------------------------------------------
front = Part(ASSET, 'front')
# The sign on its bracket, hung out from the tower's corner: a round slate-blue board in a
# brass ring with an envelope on both faces, its flap a V, sealed with red wax.
SX, ARM = 0.3, 0.975
box(front, (SX, ARM, TZ1 + 0.18), (0.022, 0.022, 0.36), IRON)
SC = (SX, 0.775, TZ1 + 0.2)
R = 0.13
for dz in (-0.06, 0.06):
    low = SC[1] + math.sqrt(R * R - dz * dz) - 0.005
    box(front, (SX, (ARM + low) / 2, SC[2] + dz), (0.008, ARM - low, 0.008), IRON, drop=('-y', '+y'))
cylinder(front, (SX - 0.013, SC[1], SC[2]), (SX + 0.013, SC[1], SC[2]), R, WOOD, sides=8, cap=WOOD)
cylinder(front, (SX - 0.009, SC[1], SC[2]), (SX + 0.009, SC[1], SC[2]), R + 0.014, BRASS, sides=8, cap=BRASS)
box(front, (SX, SC[1] - 0.005, SC[2]), (0.034, 0.1, 0.15), PAPER)
# The flap's V, a thin stroke down to the seal from each top corner, on both faces.
for side in (1, -1):
    x = SX + side * 0.0175
    for s in (-1, 1):
        top, bottom = (SC[2] + s * 0.075, SC[1] + 0.045), (SC[2], SC[1] - 0.004)
        k = 0.004
        quad = [(x, top[1] + k, top[0]), (x, top[1] - k, top[0]), (x, bottom[1] - k, bottom[0]), (x, bottom[1] + k, bottom[0])]
        solid(front, quad, [[0, 1, 2, 3]], INK, inside=(SX, SC[1], SC[2]))
box(front, (SX, SC[1] - 0.004, SC[2]), (0.04, 0.024, 0.024), SEAL)

# Parcels in kraft paper, tied with string, in a heap before the parcel room and two more by
# the shop. (x, bottom, z, width, height, depth, turn, paper, strings)
PARCELS = [
    (-1.22, 0.0, 1.16, 0.24, 0.2, 0.22, 0.1, KRAFT_A, 2),
    (-0.97, 0.0, 1.18, 0.2, 0.15, 0.2, -0.2, KRAFT_B, 2),
    (-1.13, 0.0, 1.35, 0.16, 0.11, 0.13, 0.35, KRAFT_C, 1),
    (-1.2, 0.2, 1.16, 0.18, 0.13, 0.16, -0.25, KRAFT_C, 2),
    (-0.99, 0.15, 1.18, 0.14, 0.1, 0.13, 0.3, KRAFT_A, 1),
    (-1.19, 0.33, 1.15, 0.12, 0.08, 0.11, 0.55, KRAFT_B, 1),
    (1.27, 0.0, 1.14, 0.18, 0.14, 0.18, 0.2, KRAFT_B, 2),
    (1.26, 0.14, 1.14, 0.13, 0.09, 0.12, -0.3, KRAFT_C, 1),
]
for x, y, z, w, h, d, ry, paper, strings in PARCELS:
    c = (x, y + h / 2, z)
    box(front, c, (w, h, d), paper, ry=ry, drop=('-y',))
    box(front, (x, y + h / 2 + 0.002, z), (0.016, h + 0.006, d + 0.006), STRING, ry=ry, drop=('-y',))
    if strings > 1:
        box(front, (x, y + h / 2 + 0.002, z), (w + 0.006, h + 0.006, 0.016), STRING, ry=ry, drop=('-y',))
front.build()
owl(owls, FRONT, SX, ARM + 0.011, 0.3, OWLS[1], scale=1.1, turn=0.45)
owls.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((CX, 2.52, CZ))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DX, 0, TZ1 + 0.1))
ASSET.objects.link(door)

# The tallest thing is the finial's ball, and building_height is how tall the set stands.
bpy.context.scene['building_height'] = round(APEX + 0.11, 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'owlpost.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'owlpost'})
