"""The owl post. Rebuild with scripts/blender.mjs --background --python scripts/build-owlpost.py.

The village post office, where the letters go out by owl: a slim square stone tower under a
steep tiled spire, its upper storey faced with a board of arched nest boxes in slate-blue
woodwork with owls sitting in them, a dormer on the spire with one more owl in it, and a stone
owl with its wings spread over the door. Against the tower, lower and plastered and
half-timbered, a wing with the shop window on its right and a narrower parcel room on its left,
a heap of parcels tied with string in front of each, and a round sign with an envelope on it
hung out on a bracket from the tower's corner. Not yet placed on the island
(Plans/knus-dorpscentrum.md); it is one of the shops of the new streets.

One civic asset, `civic_owlpost` (budget 1500), all of it merged - nothing on it moves.
`anchor.smoke` is on the shop's chimney, `anchor.door` at the foot of the door. Written in
island coordinates (x right, y up, z to the front) through xyz().

Why it is the size it is: the first owl post filled its whole 3x3 lot (2.9 wide, 3.5 tall) and
on the island it stood twice the size of everything round it - the tavern is 1.8 x 1.6 x 1.7,
a house 1.0-1.2 wide and 1.1-1.9 tall - and under near-black slate and timber it read as
somebody else's village. So it was drawn again at the tavern's scale, not scaled down: the
wings' eaves at 0.88 and 0.95 with 43-degree roofs (the tavern rises 0.57 over 1.24), a door
0.27 wide and 0.49 tall like the tavern's, timbers 0.035-0.045 like its uprights, terracotta
tiles, cream plaster and warm oak. The whole building is 1.7 wide (x within +-0.90 with the
eaves) and its walls run from z = -0.55 to the tower's front at 0.84, so it stands towards
the street with room behind; nothing but the step, the parcels, the stone owl, the nests'
pent roof and the sign comes forward of that (the sign's bracket, furthest, ends at 1.10).

The tower is what makes it the owl post, so it alone is allowed above the other shops: walls to
1.60 and the finial at 2.28, which is a small version of the town hall's tower, not a rival to
it. At 0.76 square with a spire kicked out over the eaves it is 55 degrees steep and reads as
a tower; any wider and the spire has to flatten into a hipped roof to stay under 2.3, which is
what a house has. The wings meet the tower at their eaves (0.95 and 0.88) and their ridges
(1.18 and 1.08) run front to back away from it, so from the street the tower stands clear of
them from the nest board up.

Why so coarse: a nest box is a flat dark arch on a board with a shelf under it and dividers
beside it, not a hollow - a real recess costs five times the triangles and reads the same at
the distance the island is looked at from. At this size the board has three by two boxes
rather than three by three, so an owl is still the size of a fist on the screen instead of a
speck. An owl is a six-sided lump in two bands whose top ring has its two side corners pulled
up into ear tufts, with a pale quad for the face; the triangles go on owls rather than on a
second board on the tower's side, which the wings' roofs hide from most angles anyway.
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


# The village's own palette: the tavern's foundation stone for the tower, its cream plaster
# and terracotta, the bakery's oak. Only the nest boxes keep the slate blue, as the accent.
STONE = material('stone', 'owlpost tower', 0x968778)
STONE_LIGHT = material('stone', 'owlpost dressing', 0xbdb09b)
STONE_DARK = material('stone', 'owlpost footing', 0x7d7267)
BRICK = material('stone', 'owlpost chimney', 0x9c5a44)
PLASTER = material('wall', 'owlpost plaster', 0xe8d4ad)
TIMBER = material('plank', 'owlpost timber', 0x6a4426)
OAK = material('plank', 'owlpost door', 0x845335)
TILES = material('roof', 'owlpost tiles', 0xb8552f)
TILES_LIGHT = material('roof', 'owlpost ridge tiles', 0xc76b3d)
# The woodwork: deep slate blue going teal. The boxes' boards are a shade lighter than the
# panel they are nailed to, so the board reads as a grid and not as one painted slab.
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


def prism(part, face, outline, d0, d1, mat, floor=False):
    """An outline stood out of a wall from d0 to d1: its front and its edges, no back - and no
    bottom edge either when it stands on something (`floor`), which arch() lists first."""
    n = len(outline)
    pts = [face.at(u, y, d0) for u, y in outline] + [face.at(u, y, d1) for u, y in outline]
    faces = [list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(1 if floor else 0, n)]
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


def gable_house(part, x0, x1, z0, z1, eaves, ridge, face_z, frame, inner):
    """A plastered block with a gable at each end, on a stone footing, its front framed in
    oak. `frame` lists (x, y, width, height, turn) in the front's own plane; `inner` is the
    side ('-x' or '+x') that stands against the tower, whose face nobody can see."""
    span(part, x0, x1, FOOT, eaves, z0, z1, PLASTER, drop=('-y', '+y', inner))
    span(part, x0, x1, 0, FOOT, z0 - 0.02, z1 + 0.025, STONE_DARK, drop=('-y', inner))
    xc = (x0 + x1) / 2
    for z, order in ((z1, (0, 1, 2)), (z0, (0, 2, 1))):
        part.add([(x0, eaves, z), (x1, eaves, z), (xc, ridge, z)], [list(order)], PLASTER)
    timbers(part, Face(0, face_z, 1, 0), frame)


# Which faces of a timber nobody sees, by what it is: a post stands on the footing with its
# top in the eaves plate, a rail butts into a post at each end, a plate's top is under the
# roof's overhang, a brace's two ends are cut into what it braces. Every one of those is two
# triangles; over thirty timbers it paid for the framing on the wings' long sides.
POST = ('-y', '+y')
RAIL = ('-x', '+x')
PLATE = ('+y',)
BRACE = ('-y', '+y')


def timbers(part, face, frame, d=0.01):
    """Oak laid on a wall, 0.02 proud of it: (u, y, width, height, turn[, hidden faces]) in
    the wall's own plane, u along it as `face` runs."""
    for u, y, w, h, rz, *hide in frame:
        box(part, face.at(u, y, d), (w, h, 0.02), TIMBER, ry=face.yaw, rz=rz, drop=('-z',) + (hide[0] if hide else ()))


def beam(a, b, w=0.035, hide=BRACE):
    """A timber from a to b in the plane of a wall, as a frame entry."""
    return ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, w, math.dist(a, b), -math.atan2(b[0] - a[0], b[1] - a[1]), hide)


def pitch(part, a, b, z0, z1, t, mat):
    """A roof slab whose underside runs from a to b (x, y) and from z0 to z1, t thick."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    n = Vector((-dy, dx))
    n = (n if n.y > 0 else -n).normalized() * t
    ends = [a, b, (b[0] + n.x, b[1] + n.y), (a[0] + n.x, a[1] + n.y)]
    solid(part, [(x, y, z) for z in (z0, z1) for x, y in ends],
          [[0, 1, 2, 3], [4, 5, 6, 7], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]], mat)


def gable_roof(part, x0, x1, z0, z1, eaves, ridge, over_left, over_right, front):
    """Two tiled pitches and a ridge over gable_house(); an overhang of 0 is a side that butts
    against the tower. Oak barge boards along the front gable, as on the tavern."""
    xc = (x0 + x1) / 2
    back = z0 - 0.04
    ends = []
    for x, over in ((x0, over_left), (x1, over_right)):
        run = Vector((x - xc, eaves - ridge)).normalized()
        end = (x + run.x * over, eaves + run.y * over)
        pitch(part, (xc, ridge), end, back, front, 0.035, TILES)
        ends.append(end)
    box(part, (xc, ridge + 0.03, (back + front) / 2), (0.06, 0.035, front - back + 0.01), TILES_LIGHT, drop=('-y',))
    for end in ends:
        a, b = Vector((xc, ridge + 0.015)), Vector((end[0] - 0.008 * (1 if end[0] > xc else -1), end[1]))
        mid = (a + b) / 2
        box(part, (mid.x, mid.y, front + 0.01), ((b - a).length, 0.04, 0.02), TIMBER, rz=math.atan2(b.y - a.y, b.x - a.x), drop=('-z', '-x', '+x'))


ASSET = bpy.data.collections.new('civic_owlpost')
bpy.context.scene.collection.children.link(ASSET)
FOOT = 0.07                                 # top of the stone footing

# The tower: 0.76 square, a little left of the middle, its front a hand proud of the wings'.
TX0, TX1, TZ1 = -0.40, 0.36, 0.84
TZ0 = TZ1 - (TX1 - TX0)
TCX, TCZ = (TX0 + TX1) / 2, (TZ0 + TZ1) / 2
TE = 1.60                                   # top of the tower's walls
APEX = 2.20
# The shop on the right and the parcel room on the left, each under a front gable at 43
# degrees, the shop the wider and so the taller of the two.
WZ0, WZ1 = -0.55, 0.78
SLOPE = math.tan(math.radians(43))
RX0, RX1 = TX1, 0.85
RE = 0.95
RR = RE + (RX1 - RX0) / 2 * SLOPE
LX0, LX1 = -0.83, TX0
LE = 0.88
LR = LE + (LX1 - LX0) / 2 * SLOPE
RC, LC = (RX0 + RX1) / 2, (LX0 + LX1) / 2

FRONT = Face(0, TZ1, 1, 0)
WING = Face(0, WZ1, 1, 0)
RIGHT = Face(TX1, TZ1, 0, -1)
LEFT = Face(TX0, TZ0, 0, 1)

# ---- the tower -----------------------------------------------------------------------------
tower = Part(ASSET, 'tower')
DX = TCX
span(tower, TX0, TX1, 0, TE, TZ0, TZ1, STONE, drop=('-y', '+y'))
# The footing stands proud of the wall everywhere but under the door, which comes down to a step.
span(tower, TX0 - 0.015, DX - 0.19, 0, FOOT, TZ0, TZ1 + 0.025, STONE_DARK, drop=('-y', '-z'))
span(tower, DX + 0.19, TX1 + 0.015, 0, FOOT, TZ0, TZ1 + 0.025, STONE_DARK, drop=('-y', '-z'))
# A string course where the nest board begins, and a cornice under the spire.
span(tower, TX0 - 0.012, TX1 + 0.012, 0.795, 0.83, TZ0 - 0.012, TZ1 + 0.015, STONE_LIGHT, drop=('-y',))
span(tower, TX0 - 0.02, TX1 + 0.02, TE - 0.05, TE, TZ0 - 0.02, TZ1 + 0.02, STONE_LIGHT, drop=('+y',))

# The door, in a dressed-stone arch with a keystone, on a step: oak like the tavern's with a
# brass letter slot, the size of the tavern's door and not of a church's.
prism(tower, FRONT, arch(DX, 0.0, 0.37, 0.34), 0, 0.02, STONE_LIGHT, floor=True)
prism(tower, FRONT, arch(DX, 0.03, 0.27, 0.32), 0.02, 0.032, OAK, floor=True)
FRONT.box(tower, DX, 0.53, 0.012, (0.06, 0.065, 0.026), STONE_LIGHT)
span(tower, DX - 0.2, DX + 0.2, 0, 0.03, TZ1, TZ1 + 0.08, STONE_DARK, drop=('-y', '-z'))
FRONT.box(tower, DX + 0.02, 0.27, 0.035, (0.09, 0.022, 0.01), BRASS)

# A narrow window on the other side, arched like the nest boxes, lit from inside.
WIN = TX0 + 0.10
prism(tower, FRONT, arch(WIN, 0.21, 0.13, 0.16), 0, 0.015, STONE_LIGHT, floor=True)
flat(tower, FRONT, arch(WIN, 0.235, 0.085, 0.14), 0.017, GLASS)
flat(tower, FRONT, arch(WIN, 0.26, 0.05, 0.11), 0.02, WINDOW_GLOW)
FRONT.box(tower, WIN, 0.2, 0.0, (0.17, 0.025, 0.07), STONE_LIGHT)

# The stone owl over the door: the owl's own lump on a corbel, and two flat wings spread
# against the wall behind it.
FRONT.box(tower, DX, 0.588, 0.015, (0.1, 0.035, 0.07), STONE_LIGHT)
owl(tower, FRONT, DX, 0.605, 0.04, (STONE_LIGHT, STONE_LIGHT), scale=1.05, beak=STONE_LIGHT)
# Flat, not stood out: at 0.15 long their edges were a sliver nobody saw, at 16 triangles.
for s in (-1, 1):
    wing = [(DX + s * u, y) for u, y in ((0.03, 0.635), (0.115, 0.665), (0.155, 0.765), (0.02, 0.715))]
    flat(tower, FRONT, wing if s > 0 else wing[::-1], 0.006, STONE_LIGHT)

# Small arched windows high on both sides, over the wings' roofs, lit at night.
for face in (RIGHT, LEFT):
    flat(tower, face, arch(0.38, 1.19, 0.15, 0.13), 0.003, STONE_LIGHT)
    flat(tower, face, arch(0.38, 1.21, 0.1, 0.12), 0.006, GLASS)
    flat(tower, face, arch(0.38, 1.235, 0.06, 0.09), 0.009, WINDOW_GLOW)

# The lean-to behind the tower, plastered like the wings, its roof a single tiled pitch.
LT0, LT1 = 1.30, RE
solid(tower, [(TX0, FOOT, WZ0), (TX1, FOOT, WZ0), (TX1, FOOT, TZ0), (TX0, FOOT, TZ0),
              (TX0, LT1, WZ0), (TX1, LT1, WZ0), (TX1, LT0, TZ0), (TX0, LT0, TZ0)],
      [[0, 1, 5, 4], [0, 4, 7, 3], [1, 2, 6, 5]], PLASTER)
span(tower, TX0, TX1, 0, FOOT, WZ0 - 0.02, TZ0, STONE_DARK, drop=('-y', '+x', '-x'))
sag = (LT0 - LT1) / (TZ0 - WZ0) * 0.04
solid(tower, [(TX0, LT0 - 0.01, TZ0), (TX1, LT0 - 0.01, TZ0), (TX0, LT1 - sag, WZ0 - 0.04), (TX1, LT1 - sag, WZ0 - 0.04),
              (TX0, LT0 + 0.025, TZ0), (TX1, LT0 + 0.025, TZ0), (TX0, LT1 - sag + 0.035, WZ0 - 0.04), (TX1, LT1 - sag + 0.035, WZ0 - 0.04)],
      [[4, 5, 7, 6], [0, 1, 3, 2], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]], TILES)
tower.build()

# ---- the spire -----------------------------------------------------------------------------
# A square pyramid in the village's tiles that kicks out at the eaves (bellcast) over a
# fascia in the lighter ridge tile, and a brass finial.
spire = Part(ASSET, 'spire')
H0, H1, KICK = (TX1 - TX0) / 2 + 0.06, (TX1 - TX0) / 2 - 0.01, TE + 0.07


def square(h, y):
    return [(TCX - h, y, TCZ - h), (TCX - h, y, TCZ + h), (TCX + h, y, TCZ + h), (TCX + h, y, TCZ - h)]


pts = square(H0, TE - 0.02) + square(H0, TE + 0.02) + square(H1, KICK)
faces = [[3, 2, 1, 0]] + [[k, (k + 1) % 4, 4 + (k + 1) % 4, 4 + k] for k in range(4)]
solid(spire, pts, faces, TILES_LIGHT, inside=(TCX, TE, TCZ))
pts = square(H0, TE + 0.02) + square(H1, KICK) + [(TCX, APEX, TCZ)]
faces = [[k, (k + 1) % 4, 4 + (k + 1) % 4, 4 + k] for k in range(4)] + [[4 + k, 4 + (k + 1) % 4, 8] for k in range(4)]
solid(spire, pts, faces, TILES, inside=(TCX, TE + 0.2, TCZ))
cylinder(spire, (TCX, APEX - 0.05, TCZ), (TCX, APEX + 0.03, TCZ), 0.012, BRASS, sides=4)
solid(spire, [(TCX, APEX + 0.02, TCZ), (TCX, APEX + 0.08, TCZ)] +
      [(TCX + 0.026 * math.cos(a), APEX + 0.05, TCZ + 0.026 * math.sin(a)) for a in (0, math.pi / 2, math.pi, 3 * math.pi / 2)],
      [[0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 2], [1, 3, 2], [1, 4, 3], [1, 5, 4], [1, 2, 5]], BRASS)

# A dormer on the front pitch, boarded in the nest boxes' blue, with the highest nest of all.
slope = lambda z: KICK + (APEX - KICK) * (1 - (z - TCZ) / H1)
DF = TCZ + 0.27                                  # the dormer's front
RL = slope(DF)                                   # where the pitch meets it
DW, DT, DP = 0.17, RL + 0.14, RL + 0.225
span(spire, TCX - DW / 2, TCX + DW / 2, RL - 0.03, DT, TCZ + 0.1, DF, WOOD, drop=('-y', '+y', '-z'))
spire.add([(TCX - DW / 2, DT, DF), (TCX + DW / 2, DT, DF), (TCX, DP, DF)], [[0, 1, 2]], WOOD)
for s in (-1, 1):
    e = s * (DW / 2 + 0.03)
    solid(spire, [(TCX, DP + 0.025, DF + 0.03), (TCX + e, DT - 0.015, DF + 0.03), (TCX, DP + 0.025, TCZ + 0.08), (TCX + e, DT - 0.015, TCZ + 0.08),
                  (TCX, DP, DF + 0.03), (TCX + e, DT - 0.04, DF + 0.03), (TCX, DP, TCZ + 0.08), (TCX + e, DT - 0.04, TCZ + 0.08)],
          [[0, 1, 3, 2], [4, 5, 7, 6], [0, 1, 5, 4], [1, 3, 7, 5]], TILES_LIGHT)
DORMER = Face(0, DF, 1, 0)
flat(spire, DORMER, arch(TCX, RL + 0.02, 0.11, 0.05), 0.003, HOLE_LIT)
DORMER.box(spire, TCX, RL + 0.02, 0.022, (0.14, 0.016, 0.05), WOOD_LIGHT)
spire.build()

# ---- the nest boxes ------------------------------------------------------------------------
nests = Part(ASSET, 'nests')
owls = Part(ASSET, 'owls')
OWL = 1.2                                        # how big an owl in a box is


def nest_grid(face, u0, u1, y0, cols, rows, h, fill, lit):
    """A board of cols x rows arched boxes from (u0, y0), each box `h` tall.

    `fill[(col, row)]` is what sits in a box: an owl colour index, or 'letters' for a bundle
    of post waiting to go; the boxes in `lit` have their lamp on."""
    y1 = y0 + rows * h
    w = (u1 - u0) / cols
    # The board's top and the top shelf's are inside the pent roof.
    face.box(nests, (u0 + u1) / 2, (y0 + y1) / 2, 0.012, (u1 - u0 + 0.03, y1 - y0 + 0.03, 0.024), PANEL, drop=('-z', '+y'))
    for k in range(rows + 1):
        face.box(nests, (u0 + u1) / 2, y0 + k * h, 0.055, (u1 - u0 + 0.03, 0.022, 0.065), WOOD_LIGHT,
                 drop=('-z', '+y') if k == rows else ('-z',))
    for k in range(cols + 1):
        face.box(nests, u0 + k * w, (y0 + y1) / 2, 0.048, (0.022, y1 - y0, 0.05), WOOD, drop=('-z', '-y', '+y'))
    # A little pent roof over the whole board, to keep the rain off the owls.
    solid(nests, [face.at(u0 - 0.03, y1 + 0.015, 0.0), face.at(u1 + 0.03, y1 + 0.015, 0.0),
                  face.at(u0 - 0.03, y1 - 0.01, 0.125), face.at(u1 + 0.03, y1 - 0.01, 0.125),
                  face.at(u0 - 0.03, y1 + 0.045, 0.0), face.at(u1 + 0.03, y1 + 0.045, 0.0),
                  face.at(u0 - 0.03, y1 + 0.015, 0.13), face.at(u1 + 0.03, y1 + 0.015, 0.13)],
          [[4, 5, 7, 6], [0, 1, 3, 2], [2, 3, 7, 6], [0, 2, 6, 4], [1, 3, 7, 5]], TILES_LIGHT)
    for c in range(cols):
        for r in range(rows):
            uc, yb = u0 + (c + 0.5) * w, y0 + r * h + 0.011
            what = fill.get((c, r))
            flat(nests, face, arch(uc, yb, w * 0.7, h * 0.38), 0.027, HOLE_LIT if (c, r) in lit else HOLE)
            if isinstance(what, int):
                owl(owls, face, uc + (0.008 if c % 2 else -0.008), yb, 0.06, OWLS[what], scale=OWL,
                    turn=0.15 * ((c * 2 + r) % 3 - 1))
            elif what == 'letters':
                face.box(nests, uc - 0.015, yb + 0.022, 0.035, (w * 0.45, 0.044, 0.05), PAPER, drop=('-y', '-z'), ry=0.12)
                face.box(nests, uc - 0.015, yb + 0.022, 0.035, (0.012, 0.047, 0.053), STRING, drop=('-y', '-z'), ry=0.12)


nest_grid(FRONT, TX0 + 0.065, TX1 - 0.065, 0.86, 3, 2, 0.29,
          {(0, 0): 0, (1, 0): 'letters', (2, 0): 3, (1, 1): 2, (2, 1): 1},
          lit={(0, 1), (1, 1)})
owl(owls, DORMER, TCX, RL + 0.022, 0.035, OWLS[2], scale=0.72)
nests.build()

# ---- the wings -----------------------------------------------------------------------------
wings = Part(ASSET, 'wings')
gable_house(wings, RX0, RX1, WZ0, WZ1, RE, RR, WZ1, [
    (RX0 + 0.022, (FOOT + RE) / 2, 0.045, RE - FOOT, 0, POST),
    (RX1 - 0.022, (FOOT + RE) / 2, 0.045, RE - FOOT, 0, POST),
    (RC, 0.6, RX1 - RX0, 0.035, 0, RAIL),
    (RC, RE - 0.018, RX1 - RX0 + 0.02, 0.04, 0, PLATE),
    (RC, (RE + RR) / 2 - 0.02, 0.035, RR - RE - 0.04, 0, POST),
    beam((RX0 + 0.045, 0.615), (RC - 0.1, RE - 0.035)), beam((RX1 - 0.045, 0.615), (RC + 0.1, RE - 0.035)),
], '-x')
gable_house(wings, LX0, LX1, WZ0, WZ1, LE, LR, WZ1, [
    (LX0 + 0.022, (FOOT + LE) / 2, 0.045, LE - FOOT, 0, POST),
    (LX1 - 0.022, (FOOT + LE) / 2, 0.045, LE - FOOT, 0, POST),
    (LC, 0.6, LX1 - LX0, 0.035, 0, RAIL),
    (LC, LE - 0.018, LX1 - LX0 + 0.02, 0.04, 0, PLATE),
    (LC, (LE + LR) / 2 - 0.02, 0.035, LR - LE - 0.04, 0, POST),
    beam((LX0 + 0.045, 0.617), (LX1 - 0.045, LE - 0.035)), beam((LX1 - 0.045, 0.617), (LX0 + 0.045, LE - 0.035)),
], '+x')
# The long sides, which the island shows as often as the fronts: a post at each end and one
# in the middle, a rail at the floor, a pair of braces over the middle post like the tavern's,
# and a window downstairs towards the street - with a sill on the shop's, the side seen from
# the square.
DEPTH = WZ1 - WZ0
RSIDE, LSIDE = Face(RX1, WZ1, 0, -1), Face(LX0, WZ0, 0, 1)
for face, eaves, mid, win, sill in ((RSIDE, RE, 0.8, 0.4, True), (LSIDE, LE, DEPTH - 0.8, DEPTH - 0.4, False)):
    frame = [(u, (FOOT + eaves) / 2, 0.045, eaves - FOOT, 0, POST) for u in (0.022, mid, DEPTH - 0.022)]
    frame.append((DEPTH / 2, 0.6, DEPTH, 0.035, 0, RAIL))
    frame += [beam((mid - 0.24, eaves - 0.02), (mid - 0.02, 0.617)), beam((mid + 0.24, eaves - 0.02), (mid + 0.02, 0.617))]
    timbers(wings, face, frame)
    pane(wings, face, win, 0.38, 0.16, 0.2, 0.004, GLASS)
    pane(wings, face, win, 0.38, 0.1, 0.13, 0.008, WINDOW_GLOW)
    if sill:
        face.box(wings, win, 0.27, 0.025, (0.2, 0.022, 0.05), TIMBER)
# The shop window, a slate-blue frame with a bar, and a small window upstairs: the tavern's
# windows are 0.2 x 0.24 of glass, and the shop's is that and half again for the display.
SW = RC
pane(wings, WING, SW, 0.37, 0.3, 0.25, 0.022, GLASS)
pane(wings, WING, SW, 0.37, 0.22, 0.17, 0.026, WINDOW_GLOW)
box(wings, (SW, 0.37, WZ1 + 0.03), (0.02, 0.25, 0.012), WOOD, drop=('-z', '-y', '+y'))
box(wings, (SW, 0.235, WZ1 + 0.04), (0.36, 0.025, 0.06), WOOD, drop=('-z',))
box(wings, (SW, 0.505, WZ1 + 0.035), (0.35, 0.03, 0.05), WOOD, drop=('-z',))
pane(wings, WING, RC, 0.775, 0.13, 0.13, 0.022, GLASS)
pane(wings, WING, RC, 0.775, 0.08, 0.08, 0.026, WINDOW_GLOW)
box(wings, (RC, 0.7, WZ1 + 0.03), (0.17, 0.02, 0.04), TIMBER, drop=('-z',))
# The parcel room's window with its slate-blue shutters folded back.
pane(wings, WING, LC, 0.4, 0.14, 0.18, 0.022, GLASS)
pane(wings, WING, LC, 0.4, 0.08, 0.11, 0.026, WINDOW_GLOW)
for s in (-1, 1):
    box(wings, (LC + s * 0.11, 0.4, WZ1 + 0.03), (0.07, 0.2, 0.016), WOOD, drop=('-z',))
box(wings, (LC, 0.3, WZ1 + 0.04), (0.2, 0.022, 0.05), TIMBER, drop=('-z',))
# Windows on the back too, for whichever way the island turns it.
REAR = Face(0, WZ0, -1, 0)
for x, w in ((RC, 0.2), (LC, 0.14)):
    pane(wings, REAR, -x, 0.42, w, 0.2, 0.004, GLASS)
    pane(wings, REAR, -x, 0.42, w - 0.07, 0.13, 0.008, WINDOW_GLOW)
# The chimney, brick like the tavern's, out of the shop's right pitch towards the back.
CX, CZ = 0.7, -0.3
CT = 1.40
span(wings, CX - 0.06, CX + 0.06, 1.0, CT, CZ - 0.06, CZ + 0.06, BRICK, drop=('-y', '+y'))
span(wings, CX - 0.075, CX + 0.075, CT, CT + 0.04, CZ - 0.075, CZ + 0.075, STONE_LIGHT, drop=('-y',))
wings.build()

roof = Part(ASSET, 'roof')
gable_roof(roof, RX0, RX1, WZ0, WZ1, RE, RR, 0.0, 0.035, WZ1 + 0.05)
gable_roof(roof, LX0, LX1, WZ0, WZ1, LE, LR, 0.035, 0.0, WZ1 + 0.05)
roof.build()

# ---- the front: the sign, the parcels ------------------------------------------------------
front = Part(ASSET, 'front')
# The sign on its bracket, hung out from the tower's corner: a round slate-blue board in a
# brass ring with an envelope on both faces, its flap a V, sealed with red wax.
SX, ARM = TX1 - 0.06, 0.72
box(front, (SX, ARM, TZ1 + 0.13), (0.016, 0.016, 0.26), IRON, drop=('-z',))
SC = (SX, 0.575, TZ1 + 0.16)
R = 0.085
for dz in (-0.04, 0.04):
    low = SC[1] + math.sqrt(R * R - dz * dz) - 0.004
    box(front, (SX, (ARM + low) / 2, SC[2] + dz), (0.006, ARM - low, 0.006), IRON, drop=('-y', '+y'))
# The board's edge is the brass ring: a second, wider ring round it cost as much again.
cylinder(front, (SX - 0.009, SC[1], SC[2]), (SX + 0.009, SC[1], SC[2]), R, BRASS, sides=8, cap=WOOD)
box(front, (SX, SC[1] - 0.004, SC[2]), (0.024, 0.068, 0.1), PAPER)
# The flap's V, a thin stroke down to the seal from each top corner, on both faces.
for side in (1, -1):
    x = SX + side * 0.0125
    for s in (-1, 1):
        top, bottom = (SC[2] + s * 0.05, SC[1] + 0.03), (SC[2], SC[1] - 0.003)
        k = 0.003
        quad = [(x, top[1] + k, top[0]), (x, top[1] - k, top[0]), (x, bottom[1] - k, bottom[0]), (x, bottom[1] + k, bottom[0])]
        solid(front, quad, [[0, 1, 2, 3]], INK, inside=(SX, SC[1], SC[2]))
# The seal is a red square on each face rather than a block through the board: nobody sees
# a seal's edges.
for side in (1, -1):
    x, k = SX + side * 0.0135, 0.008
    solid(front, [(x, SC[1] - 0.003 - k, SC[2] - k), (x, SC[1] - 0.003 - k, SC[2] + k),
                  (x, SC[1] - 0.003 + k, SC[2] + k), (x, SC[1] - 0.003 + k, SC[2] - k)], [[0, 1, 2, 3]], SEAL, inside=(SX, SC[1], SC[2]))

# Parcels in kraft paper, tied with string, in a heap before the parcel room and two more by
# the shop. (x, bottom, z, width, height, depth, turn, paper, strings) Five, not eight: at
# half a metre a parcel is a handful of pixels, and a heap of three reads as a heap.
PARCELS = [
    (-0.66, 0.0, 0.93, 0.17, 0.13, 0.15, 0.1, KRAFT_A, 2),
    (-0.49, 0.0, 0.95, 0.13, 0.1, 0.13, -0.2, KRAFT_B, 1),
    (-0.65, 0.13, 0.925, 0.12, 0.085, 0.11, -0.25, KRAFT_C, 1),
    (0.71, 0.0, 0.91, 0.13, 0.1, 0.12, 0.2, KRAFT_B, 2),
    (0.7, 0.1, 0.91, 0.09, 0.065, 0.08, -0.3, KRAFT_C, 1),
]
for x, y, z, w, h, d, ry, paper, strings in PARCELS:
    c = (x, y + h / 2, z)
    box(front, c, (w, h, d), paper, ry=ry, drop=('-y',))
    # A band of string is a box a hair bigger than the parcel, and its two broad faces are
    # inside the paper - only its top and its two ends ever show.
    box(front, (x, y + h / 2 + 0.0025, z), (0.014, h + 0.005, d + 0.005), STRING, ry=ry, drop=('-y', '+x', '-x'))
    if strings > 1:
        box(front, (x, y + h / 2 + 0.0025, z), (w + 0.005, h + 0.005, 0.014), STRING, ry=ry, drop=('-y', '+z', '-z'))
front.build()
owl(owls, FRONT, SX, ARM + 0.008, 0.21, OWLS[1], scale=0.8, turn=0.45)
owls.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((CX, CT + 0.07, CZ))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DX, 0, TZ1 + 0.1))
ASSET.objects.link(door)

# The tallest thing is the finial's point, and building_height is how tall the set stands.
bpy.context.scene['building_height'] = round(APEX + 0.08, 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'owlpost.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'owlpost'})
