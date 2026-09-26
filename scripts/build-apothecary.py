"""The apothecary. Rebuild with scripts/blender.mjs --background --python scripts/build-apothecary.py.

A narrow shop in a terrace of them (Plans/knus-dorpscentrum.md): a rough stone ground floor with
a violet-painted wooden shopfront - two round windows of dark teal bottle glass either side of a
plum door, a gold line under the fascia - a jettied upper floor of cream plaster in dark timber,
and a very steep slate roof (47 degrees, the gable's 62) with one tall gable over the door, a
single dormer and a crooked chimney behind the ridge. Out on the pavement: a potion bottle on a
violet board hung from an iron bracket, stacked terracotta pots with an herb in two, two copper
pans on the wall beside the door, a barrel with a mortar and pestle on it, and a little table of
coloured bottles, one of which glows.

One civic asset, `civic_apothecary` (budget 1500, 1344 used), and nothing that moves. It fills its
lot the way a terrace house fills its plot: the walls run x -1.40..+1.40 so the neighbours stand
almost against it, the roof stops at 1.46, and nothing on the pavement passes z 1.47 - the lot
edge is 1.50 all round. The door is in the middle of the front, because that is where the
island's paths arrive. `anchor.door` is at its foot, `anchor.smoke` on the chimney pot, and
`building_height` is the pot's top, worked out from the geometry rather than written down.

Every window is a dark pane with a smaller emissive shape just in front of it, as in
build-bakery.py: dark by day with a lit middle, and the middle is what glows at night. The shop's
two are round and teal - the colour of the potions inside, and the one thing besides the sign that
says what this shop is from the far side of the square. The sign is a picture made of geometry,
because a baked set has no texture to letter: a round flask with a neck and a cork, in gold,
pushed through the board so both faces carry it.

The house is solid boxes rather than wall slabs: nobody looks into it, and a box is twelve
triangles where four walls are forty-eight. The timber that is only ever seen from the front is
drawn without the faces that lie against the plaster, which is where most of the saving is.
Plaster takes the wall sheet, the slates the roof sheet, the stone the stone sheet and the timber
and the painted boards the plank sheets, so the island's own textures draw the courses and the
boards. Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/apothecary'
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


STONE = material('stone', 'apothecary rubble', 0x8e877b)
QUOIN = material('stone', 'apothecary quoins', 0xaaa295)
PLASTER = material('wall', 'apothecary plaster', 0xeee4cc)
TIMBER = material('plank', 'apothecary timber', 0x3c2b1f)
SLATE = material('roof', 'apothecary slate', 0x49525f)
RIDGE_SLATE = material('roof', 'apothecary ridge', 0x363d48)
CHIMNEY = material('stone', 'apothecary chimney', 0x7f786f)
VIOLET = material('plank', 'apothecary violet paint', 0x6c3d91)
PLUM = material('plank', 'apothecary plum door', 0x4a2766)
PLUM_PLAIN = material('plain', 'apothecary plum frame', 0x3a1d50)
GOLD = material('plain', 'apothecary gold', 0xd8aa3e)
TEAL_GLASS = material('plain', 'apothecary bottle glass', 0x1c474d)
TEAL_GLOW = material('plain', 'apothecary lit bottle glass', 0x72dcc6, emissive=True)
GLASS = material('plain', 'apothecary window', 0x2b3337)
WARM_GLOW = material('plain', 'apothecary lit window', 0xffd88a, emissive=True)
IRON = material('plain', 'apothecary iron', 0x2e2f33)
COPPER = material('plain', 'apothecary copper', 0xc77b47)
COPPER_DARK = material('plain', 'apothecary copper inside', 0x94502c)
CLAY = material('plain', 'apothecary terracotta', 0xc3683f)
CLAY_DARK = material('plain', 'apothecary terracotta dark', 0xa8552f)
EARTH = material('plain', 'apothecary earth', 0x3b2b20)
HERB = material('plain', 'apothecary herb', 0x5e9140)
BARREL = material('plank', 'apothecary barrel', 0x8a5a34)
TABLE = material('plank', 'apothecary table', 0x7a5232)
CORK = material('plain', 'apothecary cork', 0xb3895c)
RED = material('plain', 'apothecary red potion', 0xb23a46)
BLUE = material('plain', 'apothecary blue potion', 0x3d60c2)
AMBER = material('plain', 'apothecary amber potion', 0xd48d2c)
GREEN_GLOW = material('plain', 'apothecary glowing potion', 0x6fd85c, emissive=True)


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


def newell(pts, face):
    n = Vector()
    for i in range(len(face)):
        a, b = pts[face[i]], pts[face[(i + 1) % len(face)]]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    return n


def solid(part, pts, faces, mat):
    """A convex solid, every face turned to face away from its middle. The island draws front
    faces only, so a face wound the wrong way is a hole - and working the winding out by hand
    for every rotated box is exactly how one gets missed."""
    pts = [Vector(p) for p in pts]
    c = sum(pts, Vector()) / len(pts)
    out = []
    for f in faces:
        fc = sum((pts[i] for i in f), Vector()) / len(f)
        out.append(list(f) if newell(pts, f).dot(fc - c) >= 0 else list(f)[::-1])
    part.add(pts, out, mat)


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


# Box faces by the side they face, so a board lying on a wall can leave its back out.
BOX_FACES = {'back': [0, 3, 2, 1], 'front': [4, 5, 6, 7], 'bottom': [0, 1, 5, 4],
             'top': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 4, 7, 3]}


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    solid(part, pts, [f for k, f in BOX_FACES.items() if k not in skip], mat)


def span(part, x0, x1, y0, y1, z0, z1, mat, skip=()):
    """A box by its extents, which is how a wall and a timber are thought about."""
    box(part, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), mat, skip=skip)


def beam(part, a, b, w, h, mat, up=(0, 1, 0), skip=()):
    """A timber from a to b, w across and h deep; `up` says which way h points."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    side = d.cross(Vector(up))
    side = side.normalized() if side.length > 1e-6 else d.cross(Vector((1, 0, 0))).normalized()
    upv = side.cross(d).normalized()
    pts = [p + side * sx * w / 2 + upv * sy * h / 2
           for p in (a, b) for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = {'start': [0, 1, 2, 3], 'end': [4, 5, 6, 7], 'under': [0, 1, 5, 4],
             'over': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 3, 7, 4]}
    solid(part, pts, [f for k, f in faces.items() if k not in skip], mat)


def basis(n):
    """Two axes u, v with u x v = n, so a ring walked from u to v runs anticlockwise about n."""
    n = Vector(n).normalized()
    ref = Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))
    u = ref.cross(n).normalized()
    return u, n.cross(u).normalized()


def circle(c, r, n, sides, phase=0.0):
    u, v = basis(n)
    angles = [phase + 2 * math.pi * i / sides for i in range(sides)]
    return [Vector(c) + (u * math.cos(a) + v * math.sin(a)) * r for a in angles]


def disc(part, c, r, n, mat, sides=10, phase=0.0):
    part.add(circle(c, r, n, sides, phase), [list(range(sides))], mat)


def ring(part, c, r_in, r_out, depth, n, mat, sides=12, rim=True):
    """A round frame standing `depth` proud of its wall: its face and (with rim) its outer edge."""
    n = Vector(n).normalized()
    outer, inner = circle(c, r_out, n, sides), circle(c, r_in, n, sides)
    back = [p - n * depth for p in outer]
    s = sides
    faces = [[i, (i + 1) % s, s + (i + 1) % s, s + i] for i in range(s)]
    if rim:
        faces += [[2 * s + i, 2 * s + (i + 1) % s, (i + 1) % s, i] for i in range(s)]
    part.add(outer + inner + back, faces, mat)


def tube(part, a, b, r0, r1, mat, sides=6, cap_a=None, cap_b=None, phase=0.0):
    """A round thing from a to b, r0 at a and r1 at b: a pot, a pan, a chimney pot, a flask."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ra, rb = circle(a, r0, d, sides, phase), circle(b, r1, d, sides, phase)
    part.add(ra + rb, [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap_a:
        part.add(ra, [list(range(sides))[::-1]], cap_a)
    if cap_b:
        part.add(rb, [list(range(sides))], cap_b)


def lathe(part, c, profile, mat, sides=8, cap=None):
    """Rings (y, r) about a vertical axis at c, bottom first - a barrel's bulge."""
    rings = [circle((c[0], y, c[2]), r, (0, 1, 0), sides) for y, r in profile]
    pts = [p for rg in rings for p in rg]
    faces = [[j * sides + i, j * sides + (i + 1) % sides, (j + 1) * sides + (i + 1) % sides, (j + 1) * sides + i]
             for j in range(len(rings) - 1) for i in range(sides)]
    part.add(pts, faces, mat)
    if cap:
        part.add(rings[-1], [list(range(sides))], cap)


def plate(part, bottom, n, t, mat, skip=()):
    """A slab of thickness t over four bottom corners, pushed out along n: a roof pitch. `skip` leaves
    out faces by index - 0 under, 1 over, then the four edges from the one between corners 0 and 1 -
    where a ridge cap or the roof behind already covers them."""
    bottom = [Vector(p) for p in bottom]
    top = [p + Vector(n).normalized() * t for p in bottom]
    faces = [[0, 1, 2, 3], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    solid(part, bottom + top, [f for i, f in enumerate(faces) if i not in skip], mat)


ASSET = bpy.data.collections.new('civic_apothecary')
bpy.context.scene.collection.children.link(ASSET)

X0, X1 = -1.40, 1.40          # the walls; the neighbours' walls stand 0.20 away
ZB = -1.30                    # back wall
ZF = 1.05                     # the stone front of the ground floor
ZU = 1.12                     # the plaster front of the upper floor, jettied out over it
FLOOR = 0.86                  # where the stone stops and the jetty starts
EAVES, RIDGE = 1.64, 2.95
MID = (ZB + ZU) / 2
RX = 1.45                     # how far the roof reaches sideways: short of the lot edge at 1.50
OH = 0.13                     # eaves overhang, front and back
T = 0.055                     # slate thickness
CG, CGR = 0.62, 2.8           # the front gable: half its width, and its ridge


def pane(part, c, w, h, n, mat):
    """A flat window pane on a wall: two triangles, where a box would be ten."""
    u, v = basis(n)
    c = Vector(c)
    corners = [c + u * sx * w / 2 + v * sy * h / 2 for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    part.add(corners, [[0, 1, 2, 3]], mat)


def window(part, c, w, h, n, glow=0.05):
    """A dark pane and the smaller lit one just in front of it, as build-bakery.py does."""
    pane(part, c, w, h, n, GLASS)
    pane(part, Vector(c) + Vector(n) * 0.004, w - 2 * glow, h - 2 * glow, n, WARM_GLOW)


# ---- the house: stone, plaster, the gable ends, the timber frame ---------------------------
house = Part(ASSET, 'house')
span(house, X0, X1, 0, FLOOR, ZB, ZF, STONE, skip=('bottom', 'top'))
span(house, X0, X1, FLOOR, EAVES, ZB, ZU, PLASTER, skip=('top',))
for x, sgn in ((X0, -1), (X1, 1)):
    tri = [Vector((x, EAVES, ZB)), Vector((x, EAVES, ZU)), Vector((x, RIDGE, MID))]
    house.add(tri, [[0, 1, 2] if sgn < 0 else [2, 1, 0]], PLASTER)
    # A window in each side wall, three and a door at the back: flat and cheap, because a terrace
    # hides the sides and the back is only seen from the yard behind.
    window(house, (x + sgn * 0.002, 1.25, 0.2), 0.26, 0.3, (sgn, 0, 0))
    window(house, (sgn * 0.7, 1.25, ZB - 0.002), 0.28, 0.32, (0, 0, -1))
window(house, (-0.55, 0.42, ZB - 0.002), 0.26, 0.28, (0, 0, -1))
pane(house, (0.45, 0.3, ZB - 0.002), 0.3, 0.58, (0, 0, -1), PLUM)
# Quoins at the two front corners of the stone: lighter dressed blocks, long and short in turn.
for sgn in (-1, 1):
    for k, (y0, y1) in enumerate(((0.0, 0.27), (0.27, 0.54), (0.54, 0.8))):
        w = 0.19 if k % 2 == 0 else 0.13
        span(house, sgn * X1 - (w if sgn > 0 else 0), sgn * X1 + (0 if sgn > 0 else w),
             y0 + 0.01, y1 - 0.01, ZF - 0.001, ZF + 0.022, QUOIN, skip=('back', 'bottom'))
# The jetty's bressumer, the top plate under the eaves, and the rails either side of the windows.
D = 0.026                                               # how far a timber stands off the plaster
span(house, -1.42, 1.42, FLOOR, FLOOR + 0.075, ZU - 0.03, ZU + 0.045, TIMBER)
span(house, -1.42, 1.42, EAVES - 0.065, EAVES, ZU, ZU + D, TIMBER, skip=('back',))
for y in (1.055, 1.47):
    span(house, -1.40, 1.40, y, y + 0.04, ZU, ZU + D, TIMBER, skip=('back',))
# Posts a hair proud of the rails and braces a hair behind them, so no two faces share a plane.
POSTS = (1.375, 1.045, 0.675, 0.155)
for x in POSTS:
    for sgn in (-1, 1):
        span(house, sgn * x - 0.025, sgn * x + 0.025, FLOOR + 0.075, EAVES - 0.065, ZU, ZU + D + 0.005,
             TIMBER, skip=('back', 'top', 'bottom'))
# Braces in the window register: into each corner post, and a V opening over the middle window.
for sgn in (-1, 1):
    for xa, xb in ((1.35, 1.07), (0.18, 0.65)):
        beam(house, (sgn * xa, 1.095, ZU + D / 2), (sgn * xb, 1.47, ZU + D / 2), 0.042, D - 0.006, TIMBER,
             up=(0, 0, 1), skip=('start', 'end', 'under'))
# The upper windows: the two panes, a cross of glazing bars and a sill.
for x, w in ((-0.86, 0.3), (0.0, 0.24), (0.86, 0.3)):
    window(house, (x, 1.2825, ZU + 0.003), w, 0.365, (0, 0, 1))
    span(house, x - 0.01, x + 0.01, 1.1, 1.465, ZU + 0.008, ZU + 0.02, TIMBER, skip=('back', 'top', 'bottom'))
    span(house, x - w / 2, x + w / 2, 1.27, 1.29, ZU + 0.008, ZU + 0.02, TIMBER, skip=('back', 'left', 'right'))
    span(house, x - w / 2 - 0.02, x + w / 2 + 0.02, 1.075, 1.1, ZU, ZU + 0.06, TIMBER, skip=('back',))
house.build()

# ---- the shopfront: violet boards, two round bottle-glass windows, the door -----------------
shop = Part(ASSET, 'shopfront')
ZP = ZF + 0.025                                         # the face of the painted panel
span(shop, -1.1, 1.1, 0.03, 0.66, ZF, ZP, VIOLET, skip=('back',))
span(shop, -1.16, 1.16, 0.66, 0.8, ZF, ZF + 0.055, VIOLET, skip=('back', 'bottom'))
span(shop, -1.19, 1.19, 0.8, FLOOR, ZF, ZF + 0.075, PLUM, skip=('back', 'bottom'))
span(shop, -1.16, 1.16, 0.672, 0.69, ZF + 0.055, ZF + 0.062, GOLD, skip=('back',))
for x in (-1.12, 1.12, -0.215, 0.215):
    span(shop, x - 0.035, x + 0.035, 0.0, 0.66, ZF, ZF + 0.05, VIOLET, skip=('back', 'top', 'bottom'))
WINDOWS = (-0.70, 0.70)
WY, WR = 0.41, 0.215
for x in WINDOWS:
    disc(shop, (x, WY, ZP + 0.002), WR - 0.03, (0, 0, 1), TEAL_GLASS, sides=10)
    disc(shop, (x, WY, ZP + 0.006), WR - 0.085, (0, 0, 1), TEAL_GLOW, sides=10, phase=math.pi / 10)
    ring(shop, (x, WY, ZP + 0.04), WR - 0.04, WR, 0.04, (0, 0, 1), PLUM_PLAIN, sides=10)
    # Bottle glass is small panes: a gold cross of glazing bars over the lit middle, its ends
    # tucked under the frame.
    span(shop, x - WR + 0.03, x + WR - 0.03, WY - 0.009, WY + 0.009, ZP + 0.006, ZP + 0.02, GOLD,
         skip=('back', 'left', 'right'))
    span(shop, x - 0.009, x + 0.009, WY - WR + 0.03, WY + WR - 0.03, ZP + 0.006, ZP + 0.02, GOLD,
         skip=('back', 'top', 'bottom'))
    # A sill under it.
    span(shop, x - 0.2, x + 0.2, 0.15, 0.18, ZP, ZP + 0.06, PLUM, skip=('back',))
# The door: plum boards in a violet frame, a round teal light, a gold knob, a stone step.
span(shop, -0.18, 0.18, 0.03, 0.63, ZF, ZP + 0.012, PLUM, skip=('back',))
disc(shop, (0, 0.47, ZP + 0.014), 0.06, (0, 0, 1), TEAL_GLASS, sides=10)
disc(shop, (0, 0.47, ZP + 0.017), 0.035, (0, 0, 1), TEAL_GLOW, sides=8)
ring(shop, (0, 0.47, ZP + 0.02), 0.058, 0.078, 0.0, (0, 0, 1), GOLD, sides=10, rim=False)
box(shop, (0.12, 0.31, ZP + 0.024), (0.03, 0.03, 0.024), GOLD, skip=('back',))
span(shop, -0.27, 0.27, 0.0, 0.035, ZF, ZF + 0.13, STONE, skip=('bottom',))
# Two copper pans hung on the boards beside the door by their handles.
for x, y, r in ((-0.37, 0.39, 0.075), (0.37, 0.43, 0.058)):
    tube(shop, (x, y, ZP), (x, y, ZP + 0.024), r, r * 0.92, COPPER, sides=8, cap_b=COPPER_DARK)
    beam(shop, (x, y + r * 0.9, ZP + 0.012), (x, y + r + 0.12, ZP + 0.012), 0.018, 0.012, COPPER, up=(0, 0, 1),
         skip=('start', 'under'))
shop.build()

# ---- the roof: slate pitches, the front gable, the crooked chimney -------------------------
roof = Part(ASSET, 'roof')


def pitch_normal(d, along):
    """Out of a pitch that runs down d and along the ridge `along`: the side facing the sky."""
    n = Vector(along).cross(d).normalized()
    return n if n.y > 0 else -n


def along_x(xa, xb, hi, lo, n, t, skip=()):
    """A pitch whose ridge runs along x, from the ridge line `hi` down to the eaves line `lo`."""
    plate(roof, [(xa, hi.y, hi.z), (xb, hi.y, hi.z), (xb, lo.y, lo.z), (xa, lo.y, lo.z)], n, t, SLATE, skip=skip)


def along_z(hi, lo, z0, z1, t, skip=()):
    """A pitch whose ridge runs along z, from z0 at the back to z1 at the front."""
    plate(roof, [(hi.x, hi.y, z0), (hi.x, hi.y, z1), (lo.x, lo.y, z1), (lo.x, lo.y, z0)],
          pitch_normal(lo - hi, (0, 0, 1)), t, SLATE, skip=skip)


# The main roof. Its front pitch is three slabs: the two either side of the gable with their
# eaves out, and the middle one, under the gable's own pitches, stopping a little short of the
# wall, so the top edge of its end stays behind the gable instead of standing out of its foot as
# a ledge. The faces a ridge cap or the roof behind covers are left out (see plate()).
S = (RIDGE - EAVES) / (ZU - MID)                       # the main pitch, rise over run
r_front = Vector((0, RIDGE, MID)); e_front = Vector((0, EAVES, ZU))
d_front = (e_front - r_front).normalized()
n_front = pitch_normal(d_front, (1, 0, 0))
e_front_out = e_front + d_front * OH
e_front_in = e_front - d_front * (0.045 / d_front.z)
along_x(-RX, -CG, r_front, e_front_out, n_front, T, skip=(2,))
along_x(-CG, CG, r_front, e_front_in, n_front, T, skip=(0, 2, 4))
along_x(CG, RX, r_front, e_front_out, n_front, T, skip=(2,))
r_back = Vector((0, RIDGE, MID)); e_back = Vector((0, EAVES, ZB))
d_back = (e_back - r_back).normalized()
along_x(-RX, RX, r_back, e_back + d_back * OH, pitch_normal(d_back, (1, 0, 0)), T, skip=(2,))
box(roof, (0, RIDGE + T + 0.005, MID), (2 * RX + 0.02, 0.05, 0.09), RIDGE_SLATE)

# The front gable: a plaster triangle over the middle window, a round teal light in it, two steep
# pitches running back until the main roof swallows them, barge boards and an iron finial.
gable = [Vector((-CG, EAVES, ZU)), Vector((CG, EAVES, ZU)), Vector((0, CGR, ZU))]
roof.add(gable, [[0, 1, 2]], PLASTER)
g_back = max(MID, ZU - (CGR + 0.12 - EAVES) / S)
g_front = ZU + 0.1
for sgn in (-1, 1):
    top, low = Vector((0, CGR, 0)), Vector((sgn * CG, EAVES, 0))
    low_out = low + (low - top).normalized() * 0.1
    along_z(top, low_out, g_back, g_front, T, skip=(2, 5))
    beam(roof, (0, CGR - 0.01, ZU + 0.075), (low_out.x, low_out.y - 0.01, ZU + 0.075), 0.05, 0.03, TIMBER,
         up=(0, 0, 1))
box(roof, (0, CGR + T + 0.01, (g_back + g_front) / 2), (0.08, 0.05, g_front - g_back), RIDGE_SLATE)
beam(roof, (0, CGR + 0.04, ZU + 0.08), (0, CGR + 0.2, ZU + 0.08), 0.022, 0.022, IRON, skip=('start',))
box(roof, (0, CGR + 0.2, ZU + 0.08), (0.045, 0.045, 0.045), GOLD, ry=math.pi / 4, rx=math.pi / 5)
GY, GR = 2.07, 0.15
disc(roof, (0, GY, ZU + 0.002), GR - 0.03, (0, 0, 1), TEAL_GLASS, sides=10)
disc(roof, (0, GY, ZU + 0.006), GR - 0.07, (0, 0, 1), TEAL_GLOW, sides=8)
ring(roof, (0, GY, ZU + 0.03), GR - 0.035, GR, 0.03, (0, 0, 1), TIMBER, sides=10)
# A king post over the round light and two raking struts under it, as the frame below has.
span(roof, -0.014, 0.014, GY + GR - 0.005, CGR - 0.03, ZU, ZU + D, TIMBER, skip=('back', 'top'))
for sgn in (-1, 1):
    beam(roof, (sgn * 0.5, EAVES, ZU + D / 2), (sgn * 0.13, GY - 0.08, ZU + D / 2), 0.036, D - 0.006, TIMBER,
         up=(0, 0, 1), skip=('start', 'end', 'under'))

# One small dormer on the right of the front pitch, and deliberately only one: the roof is most
# of what is seen of this house from the square, and an unbroken slate plane that big read as a
# barn. On the right because the chimney is there too - the sign keeps the left.
DX0, DX1, DZ, DE, DR = 0.86, 1.24, 0.7, 2.36, 2.62
DM = (DX0 + DX1) / 2
span(roof, DX0, DX1, EAVES + (ZU - DZ) * S - 0.03, DE, ZU - (DE - EAVES) / S - 0.04, DZ, PLASTER,
     skip=('top', 'bottom', 'back'))
roof.add([Vector((DX0, DE, DZ)), Vector((DX1, DE, DZ)), Vector((DM, DR, DZ))], [[0, 1, 2]], PLASTER)
for sgn in (-1, 1):
    top, low = Vector((DM, DR, 0)), Vector((DM + sgn * (DX1 - DX0) / 2, DE, 0))
    along_z(top, low + (low - top).normalized() * 0.07, ZU - (DR - EAVES) / S - 0.03, DZ + 0.06, 0.04, skip=(5,))
window(roof, (DM, 2.2, DZ + 0.003), 0.18, 0.2, (0, 0, 1), glow=0.035)
span(roof, DM - 0.12, DM + 0.12, 2.075, 2.1, DZ, DZ + 0.05, TIMBER, skip=('back',))

# The chimney, behind the ridge on the right: two stacks that do not quite agree, a crown, a pot.
CX, CZ = 0.93, -0.74
box(roof, (CX, 2.5, CZ), (0.25, 0.86, 0.23), CHIMNEY, rz=-0.05, skip=('bottom',))
box(roof, (CX + 0.035, 3.02, CZ), (0.22, 0.24, 0.21), CHIMNEY, rz=0.08, skip=('bottom',))
box(roof, (CX + 0.05, 3.16, CZ), (0.29, 0.05, 0.27), QUOIN, rz=0.06)
tube(roof, (CX + 0.055, 3.18, CZ), (CX + 0.055, 3.3, CZ), 0.05, 0.043, CLAY_DARK, sides=6, cap_b=EARTH)
roof.build()
SMOKE = (CX + 0.055, 3.32, CZ)

# ---- the sign: a gold flask on a violet board, from an iron bracket -------------------------
sign = Part(ASSET, 'sign')
SX = -1.2
span(sign, SX - 0.03, SX + 0.03, 1.2, 1.42, ZU + D, ZU + D + 0.015, IRON, skip=('back',))
beam(sign, (SX, 1.4, ZU + D), (SX, 1.4, 1.465), 0.024, 0.024, IRON, skip=('start',))
beam(sign, (SX, 1.22, ZU + D), (SX, 1.39, 1.33), 0.016, 0.016, IRON, up=(1, 0, 0), skip=('start',))
for z in (1.23, 1.41):
    beam(sign, (SX, 1.39, z), (SX, 1.33, z), 0.008, 0.008, IRON, skip=('start', 'end'))
span(sign, SX - 0.014, SX + 0.014, 0.87, 1.335, 1.185, 1.46, GOLD)
span(sign, SX - 0.018, SX + 0.018, 0.895, 1.31, 1.205, 1.44, VIOLET)
FY, FZ = 1.035, 1.322
tube(sign, (SX - 0.026, FY, FZ), (SX + 0.026, FY, FZ), 0.085, 0.085, GOLD, sides=10, cap_a=GOLD, cap_b=GOLD)
span(sign, SX - 0.024, SX + 0.024, FY + 0.07, FY + 0.175, FZ - 0.02, FZ + 0.02, GOLD, skip=('bottom',))
span(sign, SX - 0.026, SX + 0.026, FY + 0.175, FY + 0.22, FZ - 0.027, FZ + 0.027, CORK)
sign.build()

# ---- the pavement: pots, the barrel with its mortar, the table of bottles -------------------
yard = Part(ASSET, 'yard')


def pot(x, z, r0, r1, h, y=0.0, mat=CLAY, plant=False):
    tube(yard, (x, y, z), (x, y + h, z), r0, r1, mat, sides=5, cap_b=EARTH, phase=x * 7)
    if plant:
        # An herb as a three-sided spindle: a point up, a point down into the earth, and the
        # three leaves' tips round the rim - six triangles, which is all a sprig is from the square.
        top, rim = y + h, r1 * 0.95
        tips = [(x + math.cos(k * 2.1 + x) * rim, top + 0.03, z + math.sin(k * 2.1 + x) * rim) for k in range(3)]
        pts = [(x, top + 0.13, z)] + tips + [(x, top - 0.005, z)]
        solid(yard, pts, [[0, 1, 2], [0, 2, 3], [0, 3, 1], [4, 2, 1], [4, 3, 2], [4, 1, 3]], HERB)


# Stacked terracotta on the left, under the sign; two more by the right window, one with herbs.
pot(-1.27, 1.25, 0.06, 0.085, 0.14)
pot(-1.1, 1.33, 0.06, 0.085, 0.14, mat=CLAY_DARK)
pot(-1.19, 1.29, 0.05, 0.07, 0.11, y=0.14, plant=True)
pot(-0.98, 1.41, 0.035, 0.05, 0.07, mat=CLAY_DARK)
pot(0.56, 1.32, 0.055, 0.075, 0.12, mat=CLAY_DARK, plant=True)
pot(0.72, 1.38, 0.04, 0.055, 0.08)
# The barrel, and a mortar and pestle on it.
BX, BZ = 1.1, 1.29
lathe(yard, (BX, 0, BZ), [(0, 0.1), (0.15, 0.12), (0.3, 0.1)], BARREL, sides=8, cap=BARREL)
for y, r in ((0.06, 0.109), (0.24, 0.109)):
    tube(yard, (BX, y - 0.015, BZ), (BX, y + 0.015, BZ), r + 0.004, r + 0.004, IRON, sides=8)
tube(yard, (BX - 0.02, 0.3, BZ), (BX - 0.02, 0.36, BZ), 0.035, 0.05, CLAY_DARK, sides=6, cap_b=EARTH)
beam(yard, (BX - 0.03, 0.34, BZ), (BX + 0.02, 0.43, BZ - 0.03), 0.018, 0.018, TABLE)
# The table and its bottles, one of them glowing.
TX, TZ = -0.7, 1.3
span(yard, TX - 0.17, TX + 0.17, 0.25, 0.28, TZ - 0.1, TZ + 0.1, TABLE)
for dx in (-0.13, 0.13):
    span(yard, TX + dx - 0.015, TX + dx + 0.015, 0.0, 0.25, TZ - 0.08, TZ + 0.08, TABLE, skip=('top', 'bottom'))
for dx, dz, r, h, mat in ((-0.11, 0.02, 0.032, 0.06, RED), (-0.04, -0.03, 0.022, 0.09, GREEN_GLOW),
                          (0.03, 0.03, 0.028, 0.065, BLUE), (0.1, -0.02, 0.024, 0.05, AMBER)):
    x, z, y = TX + dx, TZ + dz, 0.28
    tube(yard, (x, y, z), (x, y + h, z), r, r * 0.8, mat, sides=5, cap_b=mat)
    tube(yard, (x, y + h, z), (x, y + h + 0.035, z), 0.009, 0.009, mat, sides=4, cap_b=CORK)
yard.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(SMOKE)
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.12))
ASSET.objects.link(door)

# The tallest thing is the chimney pot, and the scene says so rather than a guess at it.
top = max(v.y for p in (house, shop, roof, sign, yard) for v in p.verts)
bpy.context.scene['building_height'] = round(top, 2)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'apothecary.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'apothecary'})
