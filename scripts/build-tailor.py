"""The clothes shop. Rebuild with scripts/blender.mjs --background --python scripts/build-tailor.py.

A tailor's in a shopping street (Plans/knus-dorpscentrum.md), at the tavern's size and under
the tavern's terracotta: rough stone below, cream plaster between warm oak timbers above, a
tiled roof with a cross gable over the door, and a crooked stone chimney. The shopfront colour
is wine red with gold: an arched hood over the door holding a round gold medallion - a spool of
thread with a needle across it, which says the trade in three shapes - a curved bay window
beside the door with a dress form and folded cloth in it, a flower box under an upper window,
and a gold coat hanger with a robe on it hanging from an iron bracket at the corner. No letters
anywhere: a baked model has no texture to write them on, so what the shop sells has to be said
in geometry.

Why it is the size it is. The first cut filled its 3x3 lot's width (2.9 across, 3.4 to the
chimney) under a near-black slate roof pitched at 48 and 63 degrees, and on the island it stood
twice the height of the tavern and the town hall beside it - a townhouse dropped among
cottages. So it is now measured off the tavern and the bakery: a body 1.70 wide and 1.36 deep,
eaves at 0.96, a ridge at 1.60 on a 43.5 degree pitch (the tavern's is 42.6) and a cross gable
at 45, a door 0.44 tall and 0.26 wide under its fanlight, windows the tavern's size, and the
tavern's own terracotta (0xb8552f) with its lighter ridge (0xc76b3d). What was fiddly at the
old size and unreadable at this one went: the dormer, the third window over the hood, the coat
hanger's shoulders, two of the five flowers. The sides are no longer party walls - at 1.70 on a 3.00 lot there is a
gap either side - so the frame goes round the corners and each gable end has a small window.

One civic asset, `civic_tailor` (budget 1500), nothing that moves. The body stands towards the
street: stone front at z 0.76, the jettied upper floor at 0.82, the back wall at -0.54; the
hood, the bay and the sign reach forward to z 1.08 at most. The door is in the middle of the
front, where the street's path arrives, and `anchor.door` is at its foot; `anchor.smoke` is on
the chimney pot, the highest point, which is also `building_height`.

Where the triangles go: the shopfront and the frame, which are what is looked at. A pane of
glass and the glow in front of it are one face each, not boxes - their edges would be a
hundredth of a unit deep - and a timber or a board fixed to a wall has no face against it
(`skip=BACK`).

Plaster takes the wall sheet, the tiles the roof sheet, the stone the stone sheet and the
timber the plank sheet, so the island's own textures draw the courses and the boards.
Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/tailor'
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


# The village's own palette - the tavern's stone, plaster and tiles, the bakery's oak - so the
# shop reads as one of them from across the square; only the shopfront is its own.
STONE = material('stone', 'tailor rubble', 0x968778)
CHIMNEY = material('stone', 'tailor chimney', 0x8f8c86)
PLASTER = material('wall', 'tailor plaster', 0xe8d4ad)
TIMBER = material('plank', 'tailor timber', 0x6a4426)
TILES = material('roof', 'tailor tiles', 0xb8552f)
RIDGE_TILE = material('roof', 'tailor ridge', 0xc76b3d)
WINE = material('plain', 'tailor wine red', 0x7a1d2b)
WINE_DARK = material('plain', 'tailor wine shadow', 0x5c1420)
GOLD = material('plain', 'tailor gold', 0xd6a53c)
DOOR = material('plank', 'tailor door', 0x845335)
GLASS = material('plain', 'tailor window', 0x2e3136)
WINDOW_GLOW = material('plain', 'tailor lit window', 0xffd88a, emissive=True)
IRON = material('plain', 'tailor iron', 0x343638)
STEEL = material('plain', 'tailor needle', 0xd3d6dc)
THREAD = material('plain', 'tailor thread', 0x9b2335)
SPOOL = material('plain', 'tailor spool', 0x8a5a32)
DRESS = material('plain', 'tailor dress', 0x2f6c6e)
FORM = material('plain', 'tailor dress form', 0x3a2a22)
MUSTARD = material('plain', 'tailor mustard cloth', 0xd9a13f)
PLUM = material('plain', 'tailor plum cloth', 0x6a4585)
CREAM = material('plain', 'tailor cream cloth', 0xeee2c8)
POT = material('plain', 'tailor chimney pot', 0xa65a3a)
LEAVES = material('plain', 'tailor leaves', 0x587346)
BLOOM_A = material('plain', 'tailor red flowers', 0xd9434c)
BLOOM_B = material('plain', 'tailor yellow flowers', 0xf2c64e)


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


def newell(pts):
    """A polygon's normal by Newell's rule: right-handed, so counter-clockwise faces out."""
    n = Vector((0, 0, 0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    return n


def face(part, pts, mat, out):
    """One flat face, wound so it looks towards `out` - the island culls the back of a face."""
    pts = [Vector(p) for p in pts]
    if newell(pts).dot(Vector(out)) < 0:
        pts.reverse()
    part.add(pts, [list(range(len(pts)))], mat)


def panel(part, lo, hi, z, mat, out=1):
    """A pane on a wall, as the one face it is: (x, y) lo to hi at z, looking along +z or -z."""
    face(part, [(lo[0], lo[1], z), (hi[0], lo[1], z), (hi[0], hi[1], z), (lo[0], hi[1], z)], mat, (0, 0, out))


def side_panel(part, lo, hi, x, mat, out):
    """The same on a side wall: (z, y) lo to hi at x, looking along +x or -x."""
    face(part, [(x, lo[1], lo[0]), (x, lo[1], hi[0]), (x, hi[1], hi[0]), (x, hi[1], lo[0])], mat, (out, 0, 0))


def slab(part, top, t, mat, out, bottom=True):
    """A flat polygon given thickness: `top` faces `out`, the slab hangs t behind it.

    Every roof pitch is one of these rather than a rotated box, because a pitch that meets a
    cross gable has a notch in it, and a box cannot have one."""
    pts = [Vector(p) for p in top]
    n = newell(pts)
    if n.dot(Vector(out)) < 0:
        pts.reverse()
        n = -n
    n.normalize()
    k = len(pts)
    faces = [list(range(k))]
    if bottom:
        faces.append(list(range(2 * k - 1, k - 1, -1)))
    faces += [[(i + 1) % k, i, k + i, k + (i + 1) % k] for i in range(k)]
    part.add(pts + [p - n * t for p in pts], faces, mat)


def prism(part, poly_xz, y0, y1, mat, bottom=False):
    slab(part, [(x, y1, z) for x, z in poly_xz], y1 - y0, mat, (0, 1, 0), bottom)


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


# A box's faces in the box's own frame: -z, +z, -y, +y, +x, -x. `skip` leaves some out.
BOX_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
BACK, FRONT, BOTTOM, TOP = 0, 1, 2, 3   # against the front wall, against the back wall, on something, under something
RIGHT, LEFT = 4, 5                      # the +x and the -x end
ENDS = (4, 5)                           # both ends along x, butted into something


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    skip = {skip} if isinstance(skip, int) else {i for s in skip for i in ((s,) if isinstance(s, int) else s)}
    part.add(pts, [f for i, f in enumerate(BOX_FACES) if i not in skip], mat)


def span(part, lo, hi, mat, skip=()):
    """A box from one corner to the other, which is how most of a facade is measured."""
    box(part, [(a + b) / 2 for a, b in zip(lo, hi)], [b - a for a, b in zip(lo, hi)], mat, skip=skip)


def beam(part, a, b, z, w, d, mat, skip=BACK):
    """A timber in the plane of the front wall, from (x, y) a to b, standing proud at z."""
    dx, dy = b[0] - a[0], b[1] - a[1]
    box(part, ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, z), (math.hypot(dx, dy), w, d), mat, rz=math.atan2(dy, dx), skip=skip)


def strut(part, x, a, b, t, mat, w=None, skip=()):
    """A bar in the plane x = const, from (y, z) a to b: the bracket, the hanger's shoulders,
    a verge board (`w` across x when it is not square)."""
    dy, dz = b[0] - a[0], b[1] - a[1]
    box(part, (x, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), (w or t, t, math.hypot(dy, dz)), mat, rx=math.atan2(-dy, dz), skip=skip)


def cylinder(part, a, b, r, mat, sides=6, caps=(True, True)):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(2 * math.pi * i / sides) + v * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)]
    pa, pb = ring(a), ring(b)
    for i in range(sides):
        j = (i + 1) % sides
        face(part, [pa[i], pa[j], pb[j], pb[i]], mat, (pa[i] + pa[j]) / 2 - a)
    if caps[0]:
        face(part, pa, mat, -d)
    if caps[1]:
        face(part, pb, mat, d)


def lathe(part, cx, cz, rings, mat, sides=6):
    """A turned shape round a vertical axis, from the bottom ring up: the dress on its form."""
    ring = lambda y, r: [Vector((cx + r * math.sin(2 * math.pi * (i + .5) / sides), y, cz + r * math.cos(2 * math.pi * (i + .5) / sides))) for i in range(sides)]
    for (y0, r0), (y1, r1) in zip(rings, rings[1:]):
        a, b = ring(y0, r0), ring(y1, r1)
        for i in range(sides):
            j = (i + 1) % sides
            mid = (a[i] + a[j] + b[i] + b[j]) / 4
            face(part, [a[i], a[j], b[j], b[i]], mat, mid - Vector((cx, mid.y, cz)))


ASSET = bpy.data.collections.new('civic_tailor')
bpy.context.scene.collection.children.link(ASSET)

# ---- the measurements everything hangs off -------------------------------------------------
X0, X1 = -0.85, 0.85          # the body, 1.70 across: the tavern is 1.30 and the town hall 1.93
ZB = -0.54                    # back wall
ZF = 0.76                     # front wall, ground floor (stone)
ZJ = 0.82                     # front wall, upper floor: jettied out over the shopfront
G1 = 0.58                     # top of the stone ground floor, sill of the upper floor
WT = 0.915                    # wall plate
EAVE = 0.955                  # top of the tiles where they cross the wall line
RIDGE = 1.60                  # top of the tiles at the ridge
ZR = (ZB + ZJ) / 2            # the ridge runs along x, over the middle of the upper floor
K = (RIDGE - EAVE) / (ZJ - ZR)  # the main pitch, rise over run: 0.95, 43.5 degrees
XO = 0.92                     # the roof's reach past the gable ends
ZO = 0.08                     # and over the front and the back
ROOF_T = 0.045
GX = 0.46                     # the cross gable over the door, x -0.46..0.46 at the wall
KG = 1.0                      # its pitch: 45 degrees, a shade steeper than the main roof
GRIDGE = EAVE + GX * KG       # its ridge, 1.415 - well under the main one
GXO = 0.06                    # its reach past its own walls
GZO = 0.10                    # and past the front wall


def main_y(z):
    """Top of the main front pitch at z."""
    return EAVE + (ZJ - z) * K


# ---- the body: stone below, plaster above, the attic between the gable ends -------------------
body = Part(ASSET, 'body')
span(body, (X0, 0, ZB), (X1, G1, ZF), STONE, skip=BOTTOM)
span(body, (X0, G1, ZB), (X1, WT, ZJ), PLASTER)
slab(body, [(X1, WT, ZJ), (X1, WT, ZB), (X1, RIDGE - 0.07, ZR)], X1 - X0, PLASTER, (1, 0, 0))
# The cross gable's face: a triangle of plaster flush with the upper floor, under its own roof.
slab(body, [(-GX, WT, ZJ), (GX, WT, ZJ), (0, GRIDGE - 0.06, ZJ)], 0.04, PLASTER, (0, 0, 1), bottom=False)
body.build()

# ---- the roof ------------------------------------------------------------------------------
roof = Part(ASSET, 'roof')
zf = ZJ + ZO
yf = main_y(zf)
# Where the cross gable's valley leaves the front eave (both pitches are at yf there), and
# where it reaches the gable's ridge: the main front pitch is cut away between the two.
xv = (GRIDGE - yf) / KG
zv = ZJ - (GRIDGE - EAVE) / K
for s in (-1, 1):
    slab(roof, [(s * XO, yf, zf), (s * xv, yf, zf), (0, GRIDGE, zv), (0, RIDGE, ZR), (s * XO, RIDGE, ZR)],
         ROOF_T, TILES, (0, 1, 1))
yb = EAVE - ZO * K
slab(roof, [(-XO, RIDGE, ZR), (XO, RIDGE, ZR), (XO, yb, ZB - ZO), (-XO, yb, ZB - ZO)], ROOF_T, TILES, (0, 1, -1))
box(roof, (0, RIDGE + 0.012, ZR), (2 * XO + 0.02, 0.04, 0.08), RIDGE_TILE, skip=BOTTOM)
# Oak verge boards down both ends of the main roof, as the tavern has: without them the
# tiles' edge is the same colour as the pitch and the gable end loses its outline.
for s in (-1, 1):
    x = s * (XO + 0.012)
    for zeave in (zf, ZB - ZO):
        strut(roof, x, (yb - 0.025, zeave), (RIDGE - 0.02, ZR), 0.05, TIMBER, w=0.024, skip=(FRONT, LEFT if s > 0 else RIGHT))
# The cross gable: two pitches running back until the main roof swallows them.
gz0, gz1 = ZJ + GZO, zv - 0.05
gy = EAVE - GXO * KG
for s in (-1, 1):
    slab(roof, [(s * (GX + GXO), gy, gz0), (0, GRIDGE, gz0), (0, GRIDGE, gz1), (s * (GX + GXO), gy, gz1)],
         ROOF_T, TILES, (s, 1, 0))
    # An oak bargeboard along each rake, so the gable reads as a line against the sky.
    beam(roof, (s * (GX + GXO), gy - 0.02), (0, GRIDGE - 0.02), gz0 + 0.01, 0.05, 0.022, TIMBER, skip=BACK)
box(roof, (0, GRIDGE + 0.008, (gz0 + gz1) / 2), (0.07, 0.04, gz0 - gz1 + 0.02), RIDGE_TILE, skip=BOTTOM)
# The chimney: just behind the ridge on the left, and crooked - the stack leans one way and its
# top course a little more, the way a chimney does that has stood through a few winters.
CX, CZ = -0.52, -0.04
lean, lean2 = rotation(rz=0.04), rotation(rz=0.13)
c0, c1, c2 = 1.36, 1.66, 1.76
mid = Vector((CX, (c0 + c1) / 2, CZ))
box(roof, mid, (0.17, c1 - c0, 0.15), CHIMNEY, rz=0.04, skip=BOTTOM)
knee = mid + lean @ Vector((0, (c1 - c0) / 2, 0))
top = knee + lean2 @ Vector((0.012, c2 - c1, 0))
box(roof, (knee + top) / 2, (0.155, c2 - c1 + 0.012, 0.14), CHIMNEY, rz=0.13, skip=BOTTOM)
box(roof, top + lean2 @ Vector((0, 0.016, 0)), (0.21, 0.032, 0.19), CHIMNEY, rz=0.1)
pot0 = top + lean2 @ Vector((0.03, 0.032, 0))
pot1 = pot0 + lean2 @ Vector((0, 0.065, 0))
cylinder(roof, pot0, pot1, 0.03, POT, sides=6, caps=(False, True))
roof.build()

# ---- the timber frame of the upper floor, and its windows ----------------------------------
frame = Part(ASSET, 'frame')
TZ = ZJ + 0.01                           # the timbers stand proud of the plaster
S0 = G1 + 0.035                          # top of the jetty's sill beam
P0 = WT - 0.045                          # underside of the wall plate
span(frame, (X0 - 0.01, G1 - 0.02, ZJ - 0.035), (X1 + 0.01, S0, ZJ + 0.03), TIMBER, skip=())   # the jetty's sill beam
span(frame, (X0 - 0.01, P0, ZJ - 0.01), (X1 + 0.01, WT, ZJ + 0.02), TIMBER, skip=(BACK, TOP))     # the wall plate
for x in (-0.83, -GX, GX, 0.83):
    box(frame, (x, (S0 + P0) / 2, TZ), (0.04, P0 - S0, 0.02), TIMBER, skip=(BACK, BOTTOM, TOP))
SY = (0.665, 0.835)                      # the two side windows of the upper floor
SW = (GX + 0.83) / 2                     # and their middle, either side
for s in (-1, 1):
    lo, hi = sorted((s * (GX + 0.02), s * 0.81))
    span(frame, (lo, SY[0] - 0.03, ZJ), (hi, SY[0], ZJ + 0.025), TIMBER, skip=(BACK, ENDS))     # rail under the window
    span(frame, (lo, SY[1], ZJ), (hi, SY[1] + 0.025, ZJ + 0.02), TIMBER, skip=(BACK, ENDS))     # and over it
    wx = s * SW
    panel(frame, (wx - 0.105, SY[0]), (wx + 0.105, SY[1]), ZJ + 0.004, GLASS)
    panel(frame, (wx - 0.075, SY[0] + 0.025), (wx + 0.075, SY[1] - 0.025), ZJ + 0.008, WINDOW_GLOW)
    box(frame, (wx, sum(SY) / 2, ZJ + 0.012), (0.016, SY[1] - SY[0], 0.01), TIMBER, skip=(BACK, BOTTOM, TOP))
    # The middle, behind the hood: two braces leaning in towards the gable's foot.
    beam(frame, (s * 0.42, S0), (s * 0.17, P0), TZ, 0.035, 0.02, TIMBER, skip=(BACK, ENDS))
# The gable: a collar and a king post, and a round window under the collar.
GAPEX = GRIDGE - 0.06
collar = 1.23
cw = GX * (GAPEX - collar) / (GAPEX - WT)
box(frame, (0, collar, TZ), (2 * cw, 0.035, 0.02), TIMBER, skip=BACK)
box(frame, (0, (collar + GAPEX) / 2, TZ), (0.035, GAPEX - collar, 0.02), TIMBER, skip=(BACK, BOTTOM, TOP))
ring = lambda r, z, n=8: [(r * math.cos(2 * math.pi * (i + .5) / n), 1.075 + r * math.sin(2 * math.pi * (i + .5) / n), z) for i in range(n)]
face(frame, ring(0.09, ZJ + 0.006), TIMBER, (0, 0, 1))
face(frame, ring(0.072, ZJ + 0.01), GLASS, (0, 0, 1))
face(frame, ring(0.05, ZJ + 0.014), WINDOW_GLOW, (0, 0, 1))
# The sides, which a 1.70 shop on a 3.00 lot shows between itself and the next: the sill beam
# and the plate go round the corner, a post stands at the back and under the ridge, and a
# small window lights the attic from each gable end.
for s in (-1, 1):
    x0, x1 = sorted((s * X1, s * (X1 + 0.02)))
    inner = LEFT if s > 0 else RIGHT
    span(frame, (x0, G1 - 0.02, ZB - 0.01), (x1, S0, ZJ - 0.035), TIMBER, skip=inner)
    span(frame, (x0, P0, ZB - 0.01), (x1, WT, ZJ - 0.01), TIMBER, skip=(inner, TOP))
    span(frame, (x0, S0, ZR - 0.02), (x1, P0, ZR + 0.02), TIMBER, skip=(inner, BOTTOM, TOP))
    xs = s * (X1 + 0.004)
    side_panel(frame, (ZR - 0.08, 1.05), (ZR + 0.08, 1.21), xs, TIMBER, s)
    side_panel(frame, (ZR - 0.06, 1.07), (ZR + 0.06, 1.19), xs + s * 0.004, GLASS, s)
    side_panel(frame, (ZR - 0.04, 1.09), (ZR + 0.04, 1.17), xs + s * 0.008, WINDOW_GLOW, s)
# The back, towards the lane behind the shop: a band of timber over the stone, a plate under
# the eaves and three posts, two windows and a back door, so it is not a blank wall.
span(frame, (X0 - 0.01, G1 - 0.02, ZB - 0.025), (X1 + 0.01, S0, ZB), TIMBER, skip=FRONT)
span(frame, (X0 - 0.01, P0, ZB - 0.02), (X1 + 0.01, WT, ZB), TIMBER, skip=(FRONT, TOP))
for x in (-0.83, 0, 0.83):
    box(frame, (x, (S0 + P0) / 2, ZB - 0.01), (0.04, P0 - S0, 0.02), TIMBER, skip=(FRONT, BOTTOM, TOP))
for x in (-0.42, 0.42):
    panel(frame, (x - 0.1, SY[0]), (x + 0.1, SY[1]), ZB - 0.004, GLASS, out=-1)
    panel(frame, (x - 0.07, SY[0] + 0.025), (x + 0.07, SY[1] - 0.025), ZB - 0.008, WINDOW_GLOW, out=-1)
span(frame, (0.32, 0.02, ZB - 0.02), (0.56, 0.44, ZB), DOOR, skip=FRONT)
span(frame, (0.3, 0.44, ZB - 0.03), (0.58, 0.47, ZB), TIMBER, skip=FRONT)
span(frame, (0.29, 0, ZB - 0.08), (0.59, 0.02, ZB), STONE, skip=(FRONT, BOTTOM))
frame.build()

# ---- the shopfront: fascia, hood, door, the left window ------------------------------------
front = Part(ASSET, 'front')
span(front, (X0, 0.5, ZF - 0.01), (X1, G1 - 0.02, ZF + 0.03), WINE, skip=BACK)
span(front, (X0, 0.488, ZF + 0.015), (X1, 0.502, ZF + 0.038), GOLD, skip=BACK)
# The door, in a recess painted wine red, under a fanlight.
HI, HO, SPRING = 0.16, 0.25, 0.48       # the hood: inner and outer half-width, where the arch springs
HT = 0.30                               # the outer arch's rise: taller than it is wide, a hood
HZ = ZF + 0.18                          # how far the hood stands out
panel(front, (-HI, 0), (HI, SPRING), ZF + 0.003, WINE_DARK)
span(front, (-0.13, 0.02, ZF + 0.003), (0.13, SPRING - 0.02, ZF + 0.024), DOOR, skip=BACK)
panel(front, (-0.045, 0.3), (0.045, 0.4), ZF + 0.027, WINDOW_GLOW)
box(front, (0.09, 0.22, ZF + 0.03), (0.02, 0.02, 0.014), GOLD, skip=BACK)
span(front, (-HI, SPRING - 0.02, ZF), (HI, SPRING + 0.01, ZF + 0.03), WINE, skip=BACK)
fan = lambda r, z, n=6: [(r * math.cos(math.pi * i / n), SPRING + 0.01 + r * math.sin(math.pi * i / n), z) for i in range(n + 1)]
face(front, fan(HI - 0.01, ZF + 0.004), GLASS, (0, 0, 1))
face(front, fan(HI - 0.05, ZF + 0.01), WINDOW_GLOW, (0, 0, 1))
span(front, (-HI, 0, ZF), (HI, 0.02, HZ), STONE, skip=(BACK, BOTTOM))    # the step, the hood's floor
for s in (-1, 1):
    lo, hi = sorted((s * HI, s * HO))
    span(front, (lo, 0, ZF), (hi, SPRING, HZ), WINE, skip=(BACK, BOTTOM, TOP))
    span(front, (lo - 0.01, 0, ZF), (hi + 0.01, 0.05, HZ + 0.01), WINE_DARK, skip=(BACK, BOTTOM))
    span(front, (lo - 0.008, SPRING - 0.03, ZF), (hi + 0.008, SPRING, HZ + 0.008), GOLD, skip=BACK)
# The arch: a band from the inner half-circle to a taller outer curve, extruded out from the
# wall, so it is thick at the crown - which is where the medallion hangs.
N = 6
inner = [(HI * math.cos(math.pi * i / N), SPRING + HI * math.sin(math.pi * i / N)) for i in range(N + 1)]
outer = [(HO * math.cos(math.pi * i / N), SPRING + HT * math.sin(math.pi * i / N)) for i in range(N + 1)]
for i in range(N):
    (ax, ay), (bx, by) = inner[i], inner[i + 1]
    (cx, cy), (dx, dy) = outer[i], outer[i + 1]
    face(front, [(ax, ay, HZ), (bx, by, HZ), (dx, dy, HZ), (cx, cy, HZ)], WINE, (0, 0, 1))
    face(front, [(ax, ay, ZF), (bx, by, ZF), (bx, by, HZ), (ax, ay, HZ)], WINE_DARK, (-(ax + bx), SPRING * 2 - ay - by, 0))
    face(front, [(cx, cy, ZF), (dx, dy, ZF), (dx, dy, HZ), (cx, cy, HZ)], WINE, (cx + dx, cy + dy - SPRING * 2, 0))
    # a gold edge along the front of the outer curve
    face(front, [(cx * 0.88, SPRING + (cy - SPRING) * 0.9, HZ + 0.005), (dx * 0.88, SPRING + (dy - SPRING) * 0.9, HZ + 0.005),
                 (dx, dy, HZ + 0.005), (cx, cy, HZ + 0.005)], GOLD, (0, 0, 1))
# The medallion at the crown: a gold disc, a spool of wine-red thread on it, a needle across.
# At this size it is the one detail on the front worth its triangles, so it keeps its shapes
# and only loses facets.
MY = SPRING + (HI + HT) / 2
MR = 0.075
MZ = HZ + 0.005
cylinder(front, (0, MY, MZ - 0.008), (0, MY, MZ + 0.016), MR, GOLD, sides=10, caps=(False, True))
SZ = MZ + 0.016 + 0.024
cylinder(front, (0, MY - 0.028, SZ), (0, MY + 0.028, SZ), 0.02, THREAD, caps=(False, False))
for y in (MY - 0.036, MY + 0.028):
    cylinder(front, (0, y, SZ), (0, y + 0.008, SZ), 0.031, SPOOL)
box(front, (0.0, MY, SZ + 0.035), (0.008, 0.15, 0.008), STEEL, rz=-0.7)
# The window left of the door: wine-red frame, a gold sill.
LX = -0.555
span(front, (LX - 0.19, 0.13, ZF - 0.004), (LX + 0.19, 0.44, ZF + 0.018), WINE, skip=BACK)
panel(front, (LX - 0.16, 0.155), (LX + 0.16, 0.415), ZF + 0.021, GLASS)
panel(front, (LX - 0.12, 0.185), (LX + 0.12, 0.385), ZF + 0.025, WINDOW_GLOW)
box(front, (LX, 0.285, ZF + 0.03), (0.02, 0.26, 0.01), WINE, skip=(BACK, BOTTOM, TOP))
box(front, (LX, 0.35, ZF + 0.03), (0.32, 0.018, 0.01), WINE, skip=(BACK, ENDS))
span(front, (LX - 0.21, 0.105, ZF - 0.004), (LX + 0.21, 0.13, ZF + 0.05), GOLD, skip=BACK)
front.build()

# ---- the bay window ------------------------------------------------------------------------
bay = Part(ASSET, 'bay')
BX, BW, SAG = 0.545, 0.46, 0.16         # middle, width along the wall, how far it bows out
R = ((BW / 2) ** 2 + SAG ** 2) / (2 * SAG)
BCZ = ZF + SAG - R
HALF = math.asin(BW / 2 / R)
FACETS = 5
angles = [-HALF + 2 * HALF * k / FACETS for k in range(FACETS + 1)]
arc = lambda r: [(BX + r * math.sin(a), BCZ + r * math.cos(a)) for a in angles]
B0, B1, B2, B3 = 0.08, 0.1, 0.38, 0.43  # panel, sill, glass up to, head up to
prism(bay, arc(R), 0, B0, WINE)
prism(bay, arc(R + 0.018), B0, B1, GOLD)
prism(bay, arc(R + 0.006), B2, B3, WINE)
for a in angles[1:-1]:
    box(bay, (BX + (R - 0.003) * math.sin(a), (B1 + B2) / 2, BCZ + (R - 0.003) * math.cos(a)), (0.02, B2 - B1, 0.02), WINE,
        ry=a, skip=(0, 2, 3))
# Its roof: a cone of tiles from the head up to the wall under the fascia.
low = arc(R + 0.03)
high = [(BX + R * 0.85 * math.sin(a), ZF + 0.02) for a in angles]
for k in range(FACETS):
    (ax, az), (bx, bz) = low[k], low[k + 1]
    (cx, cz), (dx, dz) = high[k], high[k + 1]
    face(bay, [(ax, B3, az), (bx, B3, bz), (dx, 0.495, dz), (cx, 0.495, cz)], TILES, (0, 1, 1))
# Behind it the shop, lit: dark glass on the wall and the glow in front of it.
panel(bay, (BX - 0.21, B1), (BX + 0.21, B2), ZF + 0.004, GLASS)
panel(bay, (BX - 0.17, B1 + 0.025), (BX + 0.17, B2 - 0.02), ZF + 0.008, WINDOW_GLOW)
# The dress form in the middle of the bay: a dress on a turned torso, on a pole.
DZ = ZF + 0.08
lathe(bay, BX, DZ, [(B1 + 0.01, 0.048), (0.215, 0.034), (0.255, 0.024), (0.3, 0.033), (0.345, 0.012)], DRESS)
box(bay, (BX, 0.355, DZ), (0.012, 0.03, 0.012), FORM, skip=BOTTOM)
box(bay, (BX, B1 + 0.006, DZ), (0.07, 0.012, 0.07), FORM, ry=0.4, skip=BOTTOM)
# Folded cloth either side of it.
box(bay, (BX - 0.14, B1 + 0.012, ZF + 0.07), (0.08, 0.024, 0.055), MUSTARD, ry=0.15, skip=BOTTOM)
box(bay, (BX - 0.145, B1 + 0.036, ZF + 0.06), (0.06, 0.024, 0.045), PLUM, ry=-0.25, skip=BOTTOM)
box(bay, (BX + 0.14, B1 + 0.012, ZF + 0.07), (0.08, 0.024, 0.055), CREAM, ry=-0.2, skip=BOTTOM)
bay.build()

# ---- dressing: the flower box and the hanging sign -----------------------------------------
dress = Part(ASSET, 'dressing')
fx = SW                                 # under the right-hand upper window
span(dress, (fx - 0.12, SY[0] - 0.075, ZJ), (fx + 0.12, SY[0] - 0.03, ZJ + 0.065), TIMBER, skip=BACK)
span(dress, (fx - 0.11, SY[0] - 0.03, ZJ + 0.01), (fx + 0.11, SY[0] - 0.005, ZJ + 0.058), LEAVES, skip=(BACK, BOTTOM))
for i, x in enumerate((-0.07, 0.0, 0.07)):
    box(dress, (fx + x, SY[0], ZJ + 0.034 + 0.012 * (-1) ** i), (0.03, 0.026, 0.03),
        BLOOM_A if i % 2 == 0 else BLOOM_B, ry=0.5 * i, skip=BOTTOM)
# The sign at the left corner, out on an iron bracket: a gold coat hanger with a robe on it.
SX, SA = -0.79, 0.81                    # x of the sign, height of the arm
span(dress, (SX - 0.008, SA - 0.008, ZJ), (SX + 0.008, SA + 0.008, ZJ + 0.25), IRON, skip=BACK)
strut(dress, SX, (SA - 0.08, ZJ + 0.004), (SA, ZJ + 0.08), 0.011, IRON)
HZC = ZJ + 0.15                         # the hanger's middle: its sleeves end at z 1.08
# The hanger's hook; its shoulders are under the sleeves at this size, so they are not modelled.
box(dress, (SX, SA - 0.045, HZC), (0.007, 0.08, 0.007), GOLD, skip=(BOTTOM, TOP))
# The robe: sleeves across the shoulders, a body that widens to the hem, a gold hem and a gold
# edge down the front where it opens - which is what turns a red shape into a garment.
span(dress, (SX - 0.007, SA - 0.125, HZC - 0.1), (SX + 0.007, SA - 0.082, HZC + 0.1), WINE)
slab(dress, [(SX + 0.007, SA - 0.085, HZC - 0.06), (SX + 0.007, SA - 0.085, HZC + 0.06),
             (SX + 0.007, SA - 0.25, HZC + 0.082), (SX + 0.007, SA - 0.25, HZC - 0.082)], 0.014, WINE, (1, 0, 0))
span(dress, (SX - 0.009, SA - 0.25, HZC - 0.084), (SX + 0.009, SA - 0.238, HZC + 0.084), GOLD)
span(dress, (SX - 0.01, SA - 0.25, HZC - 0.007), (SX + 0.01, SA - 0.085, HZC + 0.007), GOLD)
dress.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(tuple(pot1 + lean2 @ Vector((0, 0.015, 0))))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.1))
ASSET.objects.link(door)

# The set's height is the tip of the chimney pot, which is what a label over it has to clear.
top_y = max((o.matrix_world @ v.co).z for o in ASSET.objects if o.type == 'MESH' for v in o.data.vertices)
bpy.context.scene['building_height'] = round(top_y, 2)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'tailor.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'tailor'})
