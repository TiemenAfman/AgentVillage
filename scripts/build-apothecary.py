"""The apothecary. Rebuild with scripts/blender.mjs --background --python scripts/build-apothecary.py.

A small shop on the square (Plans/knus-dorpscentrum.md), in the house style of the tavern and the
bakery: a rough stone ground floor with a violet-painted wooden shopfront - two round windows of
dark teal bottle glass either side of a plum door, a gold line under the fascia - a jettied upper
floor of cream plaster in warm oak timber, and a terracotta roof at the tavern's pitch with one
gable over the door and a brick chimney behind the ridge. Out on the pavement: a potion bottle on
a violet board hung from an iron bracket, terracotta pots with an herb in two, a barrel with a
mortar and pestle on it, and a little table of coloured bottles, one of which glows.

One civic asset, `civic_apothecary` (budget 1500), and nothing that moves. The door is in the
middle of the front, because that is where the island's paths arrive. `anchor.door` is at its
foot, `anchor.smoke` on the chimney pot, and `building_height` is the pot's top, worked out from
the geometry rather than written down.

Its size is the village's, not the lot's. It was first built to fill its 3x3 lot like a terrace
house, 2.8 wide and 3.3 tall under a 47-degree slate roof, and on the island it stood twice the
size of the tavern (1.80 x 1.57 x 1.69) and the bakery beside it - the houses are 1.0-1.2 wide
and 1.1-1.9 tall. So the body is x -0.84..0.84, z -0.52..0.82, eaves at 0.95, ridge at 1.60 (44
degrees; the tavern's rises 0.57 over 0.62), the gable over the door at 1.41 (45), the chimney pot
at 1.83; it stands towards the street on its lot, and nothing on the pavement passes z 1.13 or
|x| 0.85. A door is 0.28 x 0.46 and a window about 0.17 across, the tavern's and the bakery's
scale, which is what makes them read as one street. What stopped reading at that size went: the
dormer (there is no room for one beside the gable on a roof this size), the copper pans beside
the door, the rails over and under the upper windows, the chimney's second stack.

The pavement is two parts, one either side of the door, and the sign keeps every corner above
0.556: web/js/buildings.js takes a building's footprint a rectangle per baked part from every
vertex below WALK_CLEARANCE (0.55), and one part holding the pots on the left and the barrel on
the right was one rectangle across the doorway.

Every window is a dark pane with a smaller emissive shape just in front of it, as in
build-bakery.py: dark by day with a lit middle, and the middle is what glows at night. The shop's
two are round and teal - the colour of the potions inside, and the one thing besides the sign that
says what this shop is from the far side of the square. The sign is a picture made of geometry,
because a baked set has no texture to letter: a round flask with a neck and a cork, in gold,
pushed through the board so both faces carry it.

The house is solid boxes rather than wall slabs: nobody looks into it, and a box is twelve
triangles where four walls are forty-eight. The timber that is only ever seen from the front is
drawn without the faces that lie against the plaster, which is where most of the saving is.
Plaster takes the wall sheet, the tiles the roof sheet, the stone the stone sheet and the timber
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


# The bakery's plaster and oak, the tavern's terracotta and ridge course and footing stone; the
# violet, the plum, the gold and the teal are the shop's own.
STONE = material('stone', 'apothecary rubble', 0x968778)
QUOIN = material('stone', 'apothecary quoins', 0xb3a892)
PLASTER = material('wall', 'apothecary plaster', 0xf0e2c4)
TIMBER = material('plank', 'apothecary timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'apothecary timber', 0x6a4426)
TILES = material('roof', 'apothecary tiles', 0xb8552f)
RIDGE_TILES = material('roof', 'apothecary ridge', 0xc76b3d)
CHIMNEY = material('stone', 'apothecary chimney', 0x9c5a44)     # the tavern's brick
VIOLET = material('plank', 'apothecary violet paint', 0x6c3d91)
PLUM = material('plank', 'apothecary plum door', 0x4a2766)
PLUM_PLAIN = material('plain', 'apothecary plum frame', 0x3a1d50)
GOLD = material('plain', 'apothecary gold', 0xd8aa3e)
TEAL_GLASS = material('plain', 'apothecary bottle glass', 0x1c474d)
TEAL_GLOW = material('plain', 'apothecary lit bottle glass', 0x72dcc6, emissive=True)
GLASS = material('plain', 'apothecary window', 0x2b3337)
WARM_GLOW = material('plain', 'apothecary lit window', 0xffd88a, emissive=True)
IRON = material('plain', 'apothecary iron', 0x2e2f33)
CLAY = material('plain', 'apothecary terracotta', 0xc3683f)
CLAY_DARK = material('plain', 'apothecary terracotta dark', 0xa8552f)
EARTH = material('plain', 'apothecary earth', 0x3b2b20)
HERB = material('plain', 'apothecary herb', 0x5e9140)
BARREL = material('plank', 'apothecary barrel', 0x8a5a34)
TABLE = material('plank', 'apothecary table', 0x7a5232)
CORK = material('plain', 'apothecary cork', 0xb3895c)
RED = material('plain', 'apothecary red potion', 0xb23a46)
BLUE = material('plain', 'apothecary blue potion', 0x3d60c2)
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
    """A round thing from a to b, r0 at a and r1 at b: a pot, a chimney pot, a flask."""
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

X0, X1 = -0.84, 0.84          # the side walls
ZB = -0.52                    # back wall
ZF = 0.78                     # the stone front of the ground floor
ZU = 0.82                     # the plaster front of the upper floor, jettied out over it
PL = 0.14                     # the stone plinth, as high as the tavern's
FLOOR = 0.62                  # the first floor, where the jetty starts
EAVES, RIDGE = 0.95, 1.60     # a pitch of 44 degrees, the tavern's
MID = (ZB + ZU) / 2
RX = 0.94                     # how far the roof reaches sideways: the tavern's 0.1 past the wall
OH = 0.1                      # eaves overhang, front and back
T = 0.04                      # tile thickness
CG, CGR = 0.46, 1.41          # the front gable: half its width, and its ridge (45 degrees)
D = 0.02                      # how far a timber stands off the plaster


def pane(part, c, w, h, n, mat):
    """A flat window pane on a wall: two triangles, where a box would be ten."""
    u, v = basis(n)
    c = Vector(c)
    corners = [c + u * sx * w / 2 + v * sy * h / 2 for sx, sy in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    part.add(corners, [[0, 1, 2, 3]], mat)


def window(part, c, w, h, n, glow=0.03):
    """A dark pane and the smaller lit one just in front of it, as build-bakery.py does."""
    pane(part, c, w, h, n, GLASS)
    pane(part, Vector(c) + Vector(n) * 0.004, w - 2 * glow, h - 2 * glow, n, WARM_GLOW)


# ---- the house: stone, plaster, the gable ends, the timber frame ---------------------------
house = Part(ASSET, 'house')
# Plaster down to a stone plinth all round, as the tavern has: the first version was stone the
# whole ground floor, and from the square its sides were the darkest thing on it.
span(house, X0, X1, 0, PL, ZB, ZF, STONE, skip=('bottom', 'top'))
span(house, X0, X1, PL, FLOOR, ZB, ZF, PLASTER, skip=('bottom', 'top'))
span(house, X0, X1, FLOOR, EAVES, ZB, ZU, PLASTER, skip=('top',))
for x, sgn in ((X0, -1), (X1, 1)):
    tri = [Vector((x, EAVES, ZB)), Vector((x, EAVES, ZU)), Vector((x, RIDGE, MID))]
    house.add(tri, [[0, 1, 2] if sgn < 0 else [2, 1, 0]], PLASTER)
    # A window in each side wall, two and a door at the back: flat and cheap, because only the
    # front is the shop.
    window(house, (x + sgn * 0.002, 0.8, 0.15), 0.17, 0.19, (sgn, 0, 0))
    window(house, (sgn * 0.42, 0.8, ZB - 0.002), 0.17, 0.19, (0, 0, -1))
window(house, (-0.35, 0.3, ZB - 0.002), 0.17, 0.18, (0, 0, -1))
pane(house, (0.3, 0.23, ZB - 0.002), 0.2, 0.44, (0, 0, -1), PLUM)
# Quoins framing the shopfront at the two front corners: dressed blocks, long and short in turn.
for sgn in (-1, 1):
    for k, (y0, y1) in enumerate(((0.0, 0.2), (0.2, 0.4), (0.4, 0.6))):
        w = 0.12 if k % 2 == 0 else 0.08
        span(house, sgn * X1 - (w if sgn > 0 else 0), sgn * X1 + (0 if sgn > 0 else w),
             y0 + 0.008, y1 - 0.008, ZF - 0.001, ZF + 0.016, QUOIN, skip=('back', 'bottom'))
# The jetty's bressumer and the top plate under the eaves.
span(house, X0 - 0.015, X1 + 0.015, FLOOR, FLOOR + 0.05, ZU - 0.02, ZU + 0.03, TIMBER, skip=('back',))
# Along the sides: the plate under the eaves, the floor line, a post at the back corner and one
# in the middle, as the tavern's sides have - only the face away from the wall.
for sgn in (-1, 1):
    x, out = sgn * (X1 + 0.01), 'right' if sgn > 0 else 'left'
    span(house, x - 0.01, x + 0.01, EAVES - 0.04, EAVES, ZB, ZU, TIMBER_Z, skip=('back', 'front', 'top', 'right' if sgn < 0 else 'left'))
    span(house, x - 0.01, x + 0.01, FLOOR, FLOOR + 0.035, ZB, ZU - 0.02, TIMBER_Z, skip=('back', 'front', 'right' if sgn < 0 else 'left'))
    span(house, x - 0.01, x + 0.01, PL, EAVES - 0.04, -0.182, -0.138, TIMBER, skip=('top', 'bottom', 'right' if sgn < 0 else 'left'))
    # The back corner post stands proud of both walls, so one post shows on the side and the back.
    span(house, sgn * X1 - 0.027, sgn * X1 + 0.027, PL, EAVES - 0.04, ZB - 0.012, ZB + 0.042, TIMBER,
         skip=('top', 'bottom', 'front', 'right' if sgn < 0 else 'left'))
# Across the back: the floor line, the top plate and three posts, so the back is framed like the
# tavern's rather than blank - it is what the road behind the square sees.
for y0, y1 in ((FLOOR, FLOOR + 0.035), (EAVES - 0.04, EAVES)):
    span(house, X0, X1, y0, y1, ZB - 0.016, ZB, TIMBER, skip=('front', 'left', 'right'))
for x in (-0.6, -0.08, 0.6):
    span(house, x - 0.02, x + 0.02, PL, EAVES - 0.04, ZB - 0.014, ZB, TIMBER, skip=('front', 'top', 'bottom'))
span(house, X0 - 0.015, X1 + 0.015, EAVES - 0.04, EAVES, ZU, ZU + D, TIMBER, skip=('back',))
# Posts, and braces a hair behind them so no two faces share a plane.
POSTS = (0.815, 0.64, 0.4, 0.1)
for x in POSTS:
    for sgn in (-1, 1):
        span(house, sgn * x - 0.02, sgn * x + 0.02, FLOOR + 0.05, EAVES - 0.04, ZU, ZU + D + 0.004,
             TIMBER, skip=('back', 'top', 'bottom'))
# Braces in the window register: into each corner post, and a V opening over the middle window.
for sgn in (-1, 1):
    for xa, xb in ((0.8, 0.655), (0.115, 0.385)):
        beam(house, (sgn * xa, FLOOR + 0.06, ZU + D / 2), (sgn * xb, EAVES - 0.045, ZU + D / 2), 0.03, D - 0.004, TIMBER,
             up=(0, 0, 1), skip=('start', 'end', 'under'))
# The upper windows: the two panes, a mullion, a transom and a sill. The bars stand a centimetre
# off the glass, so only their faces to the street are drawn.
FRONT_ONLY = ('back', 'top', 'bottom', 'left', 'right')
for x, w in ((-0.52, 0.17), (0.0, 0.13), (0.52, 0.17)):
    window(house, (x, 0.805, ZU + 0.003), w, 0.19, (0, 0, 1))
    span(house, x - 0.008, x + 0.008, 0.71, 0.9, ZU + 0.006, ZU + 0.016, TIMBER, skip=FRONT_ONLY)
    span(house, x - w / 2, x + w / 2, 0.797, 0.813, ZU + 0.006, ZU + 0.016, TIMBER, skip=FRONT_ONLY)
    span(house, x - w / 2 - 0.015, x + w / 2 + 0.015, 0.69, 0.71, ZU, ZU + 0.045, TIMBER, skip=('back', 'bottom'))
house.build()

# ---- the shopfront: violet boards, two round bottle-glass windows, the door -----------------
shop = Part(ASSET, 'shopfront')
ZP = ZF + 0.018                                         # the face of the painted panel
span(shop, -0.68, 0.68, 0.02, 0.5, ZF, ZP, VIOLET, skip=('back',))
span(shop, -0.7, 0.7, 0.5, 0.565, ZF, ZF + 0.04, VIOLET, skip=('back', 'bottom'))
span(shop, -0.72, 0.72, 0.565, FLOOR, ZF, ZF + 0.055, PLUM, skip=('back', 'bottom'))
span(shop, -0.7, 0.7, 0.508, 0.52, ZF + 0.04, ZF + 0.045, GOLD, skip=('back',))
for x in (-0.68, 0.68, -0.16, 0.16):
    span(shop, x - 0.025, x + 0.025, 0.0, 0.5, ZF, ZF + 0.036, VIOLET, skip=('back', 'top', 'bottom'))
WINDOWS = (-0.42, 0.42)
WY, WR = 0.28, 0.13
for x in WINDOWS:
    disc(shop, (x, WY, ZP + 0.002), WR - 0.018, (0, 0, 1), TEAL_GLASS, sides=10)
    disc(shop, (x, WY, ZP + 0.005), WR - 0.05, (0, 0, 1), TEAL_GLOW, sides=10, phase=math.pi / 10)
    ring(shop, (x, WY, ZP + 0.03), WR - 0.028, WR, 0.03, (0, 0, 1), PLUM_PLAIN, sides=10)
    # Bottle glass is small panes: a gold cross of glazing bars over the lit middle, its ends
    # tucked under the frame.
    span(shop, x - WR + 0.02, x + WR - 0.02, WY - 0.007, WY + 0.007, ZP + 0.005, ZP + 0.016, GOLD, skip=FRONT_ONLY)
    span(shop, x - 0.007, x + 0.007, WY - WR + 0.02, WY + WR - 0.02, ZP + 0.005, ZP + 0.016, GOLD, skip=FRONT_ONLY)
    # A sill under it.
    span(shop, x - 0.12, x + 0.12, 0.13, 0.15, ZP, ZP + 0.04, PLUM, skip=('back',))
# The door: plum boards in a violet frame, a round teal light, a gold knob, a stone step.
span(shop, -0.14, 0.14, 0.03, 0.49, ZF, ZP + 0.01, PLUM, skip=('back',))
disc(shop, (0, 0.37, ZP + 0.012), 0.045, (0, 0, 1), TEAL_GLASS, sides=8)
disc(shop, (0, 0.37, ZP + 0.015), 0.027, (0, 0, 1), TEAL_GLOW, sides=8)
ring(shop, (0, 0.37, ZP + 0.018), 0.043, 0.058, 0.0, (0, 0, 1), GOLD, sides=8, rim=False)
box(shop, (0.09, 0.23, ZP + 0.02), (0.022, 0.022, 0.018), GOLD, skip=('back',))
span(shop, -0.2, 0.2, 0.0, 0.03, ZF, ZF + 0.09, STONE, skip=('bottom',))
shop.build()

# ---- the roof: terracotta pitches, the front gable, the chimney -----------------------------
roof = Part(ASSET, 'roof')


def pitch_normal(d, along):
    """Out of a pitch that runs down d and along the ridge `along`: the side facing the sky."""
    n = Vector(along).cross(d).normalized()
    return n if n.y > 0 else -n


def along_x(xa, xb, hi, lo, n, t, skip=()):
    """A pitch whose ridge runs along x, from the ridge line `hi` down to the eaves line `lo`."""
    plate(roof, [(xa, hi.y, hi.z), (xb, hi.y, hi.z), (xb, lo.y, lo.z), (xa, lo.y, lo.z)], n, t, TILES, skip=skip)


def along_z(hi, lo, z0, z1, t, skip=()):
    """A pitch whose ridge runs along z, from z0 at the back to z1 at the front."""
    plate(roof, [(hi.x, hi.y, z0), (hi.x, hi.y, z1), (lo.x, lo.y, z1), (lo.x, lo.y, z0)],
          pitch_normal(lo - hi, (0, 0, 1)), t, TILES, skip=skip)


# The main roof. Its front pitch is three slabs: the two either side of the gable with their
# eaves out, and the middle one, under the gable's own pitches, stopping a little short of the
# wall, so the top edge of its end stays behind the gable instead of standing out of its foot as
# a ledge. The faces a ridge cap or the roof behind covers are left out (see plate()).
S = (RIDGE - EAVES) / (ZU - MID)                       # the main pitch, rise over run
r_front = Vector((0, RIDGE, MID)); e_front = Vector((0, EAVES, ZU))
d_front = (e_front - r_front).normalized()
n_front = pitch_normal(d_front, (1, 0, 0))
e_front_out = e_front + d_front * OH
e_front_in = e_front - d_front * (0.035 / d_front.z)
along_x(-RX, -CG, r_front, e_front_out, n_front, T, skip=(2,))
along_x(-CG, CG, r_front, e_front_in, n_front, T, skip=(0, 2, 4))
along_x(CG, RX, r_front, e_front_out, n_front, T, skip=(2,))
r_back = Vector((0, RIDGE, MID)); e_back = Vector((0, EAVES, ZB))
d_back = (e_back - r_back).normalized()
along_x(-RX, RX, r_back, e_back + d_back * OH, pitch_normal(d_back, (1, 0, 0)), T, skip=(2,))
box(roof, (0, RIDGE + T + 0.005, MID), (2 * RX + 0.02, 0.04, 0.075), RIDGE_TILES, skip=('bottom',))

# The front gable: a plaster triangle over the middle window, a round teal light in it, two
# pitches running back until the main roof swallows them, barge boards and an iron finial.
gable = [Vector((-CG, EAVES, ZU)), Vector((CG, EAVES, ZU)), Vector((0, CGR, ZU))]
roof.add(gable, [[0, 1, 2]], PLASTER)
g_back = max(MID, ZU - (CGR + 0.1 - EAVES) / S)
g_front = ZU + 0.08
for sgn in (-1, 1):
    top, low = Vector((0, CGR, 0)), Vector((sgn * CG, EAVES, 0))
    low_out = low + (low - top).normalized() * 0.08
    along_z(top, low_out, g_back, g_front, T, skip=(2, 5))
    beam(roof, (0, CGR - 0.008, ZU + 0.06), (low_out.x, low_out.y - 0.008, ZU + 0.06), 0.04, 0.024, TIMBER,
         up=(0, 0, 1), skip=('start', 'under'))
box(roof, (0, CGR + T + 0.008, (g_back + g_front) / 2), (0.065, 0.04, g_front - g_back), RIDGE_TILES, skip=('bottom', 'back'))
beam(roof, (0, CGR + 0.03, ZU + 0.065), (0, CGR + 0.13, ZU + 0.065), 0.018, 0.018, IRON, skip=('start',))
box(roof, (0, CGR + 0.13, ZU + 0.065), (0.036, 0.036, 0.036), GOLD, ry=math.pi / 4, rx=math.pi / 5)
GY, GR = 1.13, 0.08
disc(roof, (0, GY, ZU + 0.002), GR - 0.018, (0, 0, 1), TEAL_GLASS, sides=8)
disc(roof, (0, GY, ZU + 0.005), GR - 0.042, (0, 0, 1), TEAL_GLOW, sides=8)
ring(roof, (0, GY, ZU + 0.022), GR - 0.022, GR, 0.022, (0, 0, 1), TIMBER, sides=8)
# A king post over the round light and two raking struts under it, as the frame below has.
span(roof, -0.012, 0.012, GY + GR - 0.004, CGR - 0.03, ZU, ZU + D, TIMBER, skip=('back', 'top'))
for sgn in (-1, 1):
    beam(roof, (sgn * 0.36, EAVES, ZU + D / 2), (sgn * 0.085, GY - 0.05, ZU + D / 2), 0.028, D - 0.004, TIMBER,
         up=(0, 0, 1), skip=('start', 'end', 'under'))

# The chimney, behind the ridge on the right: a brick stack leaning a hair, a stone crown, a pot.
CX, CZ = 0.5, -0.22
box(roof, (CX, 1.41, CZ), (0.17, 0.62, 0.16), CHIMNEY, rz=-0.04, skip=('bottom',))
box(roof, (CX + 0.012, 1.737, CZ), (0.21, 0.036, 0.2), QUOIN, rz=-0.04, skip=('bottom',))
tube(roof, (CX + 0.014, 1.755, CZ), (CX + 0.014, 1.83, CZ), 0.034, 0.029, CLAY_DARK, sides=6, cap_b=EARTH)
roof.build()
SMOKE = (CX + 0.014, 1.85, CZ)

# ---- the sign: a gold flask on a violet board, from an iron bracket -------------------------
# Low enough that its arm passes under the eaves at the wall, high enough that the board's
# bottom edge clears WALK_CLEARANCE (see the docstring).
sign = Part(ASSET, 'sign')
SX = -0.72
ARM = 0.86
span(sign, SX - 0.022, SX + 0.022, ARM - 0.13, ARM + 0.01, ZU + D, ZU + D + 0.012, IRON, skip=('back',))
beam(sign, (SX, ARM, ZU + D), (SX, ARM, 1.13), 0.018, 0.018, IRON, skip=('start',))
beam(sign, (SX, ARM - 0.12, ZU + D), (SX, ARM - 0.01, 1.03), 0.012, 0.012, IRON, up=(1, 0, 0), skip=('start',))
for z in (0.975, 1.105):
    beam(sign, (SX, ARM - 0.01, z), (SX, 0.8, z), 0.006, 0.006, IRON, skip=('start', 'end'))
span(sign, SX - 0.011, SX + 0.011, 0.57, 0.8, 0.955, 1.125, GOLD)
span(sign, SX - 0.014, SX + 0.014, 0.585, 0.785, 0.97, 1.11, VIOLET)
FY, FZ = 0.655, 1.04
tube(sign, (SX - 0.02, FY, FZ), (SX + 0.02, FY, FZ), 0.048, 0.048, GOLD, sides=8, cap_a=GOLD, cap_b=GOLD)
span(sign, SX - 0.018, SX + 0.018, FY + 0.04, FY + 0.09, FZ - 0.014, FZ + 0.014, GOLD, skip=('bottom',))
span(sign, SX - 0.02, SX + 0.02, FY + 0.09, FY + 0.115, FZ - 0.019, FZ + 0.019, CORK)
sign.build()

# ---- the pavement: pots and a table on the left, the barrel on the right --------------------


def pot(part, x, z, r0, r1, h, y=0.0, mat=CLAY, plant=False):
    tube(part, (x, y, z), (x, y + h, z), r0, r1, mat, sides=5, cap_b=EARTH, phase=x * 7)
    if plant:
        # An herb as a three-sided spindle: a point up, a point down into the earth, and the
        # three leaves' tips round the rim - six triangles, which is all a sprig is from the square.
        top, rim = y + h, r1 * 0.95
        tips = [(x + math.cos(k * 2.1 + x) * rim, top + 0.02, z + math.sin(k * 2.1 + x) * rim) for k in range(3)]
        pts = [(x, top + 0.085, z)] + tips + [(x, top - 0.004, z)]
        solid(part, pts, [[0, 1, 2], [0, 2, 3], [0, 3, 1], [4, 2, 1], [4, 3, 2], [4, 1, 3]], HERB)


left = Part(ASSET, 'yard left')
# Stacked terracotta under the sign.
pot(left, -0.76, 0.95, 0.038, 0.052, 0.085)
pot(left, -0.66, 1.0, 0.038, 0.052, 0.085, mat=CLAY_DARK)
pot(left, -0.715, 0.975, 0.032, 0.044, 0.07, y=0.085, plant=True)
# The table and its bottles, one of them glowing.
TX, TZ = -0.47, 1.0
span(left, TX - 0.11, TX + 0.11, 0.15, 0.168, TZ - 0.065, TZ + 0.065, TABLE)
for dx in (-0.085, 0.085):
    span(left, TX + dx - 0.01, TX + dx + 0.01, 0.0, 0.15, TZ - 0.05, TZ + 0.05, TABLE, skip=('top', 'bottom'))
for dx, dz, r, h, mat in ((-0.065, 0.012, 0.021, 0.042, RED), (0.0, -0.014, 0.017, 0.056, GREEN_GLOW),
                          (0.062, 0.014, 0.019, 0.044, BLUE)):
    x, z, y = TX + dx, TZ + dz, 0.168
    tube(left, (x, y, z), (x, y + h, z), r, r * 0.8, mat, sides=5, cap_b=mat)
    tube(left, (x, y + h, z), (x, y + h + 0.022, z), 0.007, 0.007, mat, sides=4, cap_b=CORK)
left.build()

right = Part(ASSET, 'yard right')
# The barrel, and a mortar and pestle on it; a pot of herbs by the window.
BX, BZ = 0.6, 0.99
lathe(right, (BX, 0, BZ), [(0, 0.062), (0.095, 0.075), (0.19, 0.062)], BARREL, sides=8, cap=BARREL)
for y, r in ((0.04, 0.068), (0.15, 0.068)):
    tube(right, (BX, y - 0.01, BZ), (BX, y + 0.01, BZ), r + 0.003, r + 0.003, IRON, sides=8)
tube(right, (BX - 0.012, 0.19, BZ), (BX - 0.012, 0.23, BZ), 0.022, 0.032, CLAY_DARK, sides=6, cap_b=EARTH)
beam(right, (BX - 0.018, 0.215, BZ), (BX + 0.012, 0.27, BZ - 0.018), 0.012, 0.012, TABLE)
pot(right, 0.39, 1.0, 0.034, 0.048, 0.08, mat=CLAY_DARK, plant=True)
right.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(SMOKE)
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.11))
ASSET.objects.link(door)

# The tallest thing is the chimney pot, and the scene says so rather than a guess at it.
top = max(v.y for p in (house, shop, roof, sign, left, right) for v in p.verts)
bpy.context.scene['building_height'] = round(top, 2)
tris = 0
for o in ASSET.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        print(f'  {o.name}: {len(o.data.loop_triangles)} triangles')
print(f'civic_apothecary: {tris} triangles, building_height {round(top, 2)}')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'apothecary.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'apothecary'})
