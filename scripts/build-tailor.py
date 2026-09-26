"""The clothes shop. Rebuild with scripts/blender.mjs --background --python scripts/build-tailor.py.

A tailor's in a shopping street (Plans/knus-dorpscentrum.md): rough stone below, cream plaster
between dark timbers above, a very steep dark slate roof with a steeper cross gable over the
door, and a crooked stone chimney. The shopfront colour is wine red with gold: a big arched hood
over the door holding a round gold medallion - a spool of thread with a needle across it, which
says the trade in three shapes - a curved bay window beside the door with a dress form and
folded cloth in it, a flower box under an upper window, and a gold coat hanger with a robe on it
hanging from an iron bracket at the corner. No letters anywhere: a baked model has no texture
to write them on, so what the shop sells has to be said in geometry.

One civic asset, `civic_tailor` (budget 1500), nothing that moves. It fills its 3x3 lot's width
(x -1.40..+1.40, the roof to 1.46) because it stands in a terrace with its neighbours shoulder
to shoulder; the bay, the hood and the sign reach forward to z 1.47 and never past the lot's
1.48. The door is in the middle of the front, where the street's path arrives, and
`anchor.door` is at its foot; `anchor.smoke` is on the chimney pot.

Where the triangles go: the shopfront and the frame, which are what is looked at. A pane of
glass and the glow in front of it are one face each, not boxes - their edges would be a
hundredth of a unit deep - and a timber or a board fixed to a wall has no face against it
(`skip=BACK`). The party walls are plain, because a neighbour stands in front of each.

Plaster takes the wall sheet, the slates the roof sheet, the stone the stone sheet and the
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


STONE = material('stone', 'tailor rubble', 0xa39a8c)
CHIMNEY = material('stone', 'tailor chimney', 0x837c72)
PLASTER = material('wall', 'tailor plaster', 0xf1e6cf)
TIMBER = material('plank', 'tailor timber', 0x4a3222)
SLATE = material('roof', 'tailor slate', 0x4b5466)
RIDGE_SLATE = material('roof', 'tailor ridge', 0x3b4250)
WINE = material('plain', 'tailor wine red', 0x7a1d2b)
WINE_DARK = material('plain', 'tailor wine shadow', 0x5c1420)
GOLD = material('plain', 'tailor gold', 0xd6a53c)
DOOR = material('plank', 'tailor door', 0x3e2619)
GLASS = material('plain', 'tailor window', 0x2e3136)
WINDOW_GLOW = material('plain', 'tailor lit window', 0xffd88a, emissive=True)
IRON = material('plain', 'tailor iron', 0x2f3036)
STEEL = material('plain', 'tailor needle', 0xd3d6dc)
THREAD = material('plain', 'tailor thread', 0x9b2335)
SPOOL = material('plain', 'tailor spool', 0x8a5a32)
DRESS = material('plain', 'tailor dress', 0x2f6c6e)
FORM = material('plain', 'tailor dress form', 0x3a2a22)
MUSTARD = material('plain', 'tailor mustard cloth', 0xd9a13f)
PLUM = material('plain', 'tailor plum cloth', 0x6a4585)
CREAM = material('plain', 'tailor cream cloth', 0xeee2c8)
POT = material('plain', 'tailor chimney pot', 0xa65a3a)
LEAVES = material('plain', 'tailor leaves', 0x4d7a36)
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


def strut(part, x, a, b, t, mat):
    """A bar in the plane x = const, from (y, z) a to b: the bracket, the hanger's shoulders."""
    dy, dz = b[0] - a[0], b[1] - a[1]
    box(part, (x, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2), (t, t, math.hypot(dy, dz)), mat, rx=math.atan2(-dy, dz))


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
X0, X1 = -1.40, 1.40          # the terrace: the lot is 1.50 either side, the neighbour's wall
ZB = -1.30                    # back wall
ZF = 1.00                     # front wall, ground floor (stone)
ZJ = 1.10                     # front wall, upper floor: jettied out over the shopfront
G1 = 0.90                     # top of the stone ground floor, sill of the upper floor
WT = 1.58                     # wall plate
EAVE = 1.64                   # top of the slates where they cross the wall line
RIDGE = 2.96                  # top of the slates at the ridge
ZR = (ZB + ZJ) / 2            # the ridge runs along x, over the middle of the upper floor
K = (RIDGE - EAVE) / (ZJ - ZR)  # the main pitch, rise over run: 1.1, about 48 degrees
XO = 1.45                     # the roof's reach over the party walls: short of the lot's 1.48
ZO = 0.13                     # and over the front and the back
ROOF_T = 0.07
GX = 0.62                     # the cross gable over the door, x -0.62..0.62 at the wall
GRIDGE = 2.84                 # its ridge, a little under the main one
KG = (GRIDGE - EAVE) / GX     # its pitch: 1.94, about 63 degrees - the steep face of the shop
GXO = 0.09                    # its reach past its own walls
GZO = 0.16                    # and past the front wall


def main_y(z):
    """Top of the main front pitch at z."""
    return EAVE + (ZJ - z) * K


# ---- the body: stone below, plaster above, the attic between the gable ends -------------------
body = Part(ASSET, 'body')
span(body, (X0, 0, ZB), (X1, G1, ZF), STONE, skip=BOTTOM)
span(body, (X0, G1, ZB), (X1, WT, ZJ), PLASTER)
slab(body, [(X1, WT, ZJ), (X1, WT, ZB), (X1, RIDGE - 0.1, ZR)], X1 - X0, PLASTER, (1, 0, 0))
# The cross gable's face: a triangle of plaster flush with the upper floor, under its own roof.
slab(body, [(-GX, WT, ZJ), (GX, WT, ZJ), (0, GRIDGE - 0.07, ZJ)], 0.06, PLASTER, (0, 0, 1), bottom=False)
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
         ROOF_T, SLATE, (0, 1, 1))
slab(roof, [(-XO, RIDGE, ZR), (XO, RIDGE, ZR), (XO, EAVE - ZO * K, ZB - ZO), (-XO, EAVE - ZO * K, ZB - ZO)],
     ROOF_T, SLATE, (0, 1, -1))
box(roof, (0, RIDGE + 0.015, ZR), (2 * XO + 0.02, 0.05, 0.11), RIDGE_SLATE)
# The cross gable: two steep pitches running back until the main roof swallows them.
gz0, gz1 = ZJ + GZO, zv - 0.06
gy = EAVE - GXO * KG
for s in (-1, 1):
    slab(roof, [(s * (GX + GXO), gy, gz0), (0, GRIDGE, gz0), (0, GRIDGE, gz1), (s * (GX + GXO), gy, gz1)],
         ROOF_T, SLATE, (s, 1, 0))
    # A dark bargeboard along each rake, so the gable reads as a line against the sky.
    beam(roof, (s * (GX + GXO), gy - 0.03), (0, GRIDGE - 0.03), gz0 + 0.012, 0.07, 0.03, TIMBER, skip=())
box(roof, (0, GRIDGE + 0.01, (gz0 + gz1) / 2), (0.09, 0.05, gz0 - gz1 + 0.02), RIDGE_SLATE)
# A dormer on the right-hand pitch, which is otherwise the biggest plain thing on the house.
# Its body is a box that sinks into the main roof: what shows above the slates is the front
# and two cheeks, and the rest is hidden inside - cheaper than cutting the cheeks to shape.
DX, DW, DZ0 = 1.0, 0.36, 0.62            # middle, width, where its front wall stands
DE, DR = 2.42, 2.66                      # its eaves and ridge
dk = (DR - DE) / (DW / 2)
span(roof, (DX - DW / 2, 2.0, DZ0 - 0.34), (DX + DW / 2, DE, DZ0), PLASTER, skip=(BACK, BOTTOM, TOP))
slab(roof, [(DX - DW / 2, DE, DZ0), (DX + DW / 2, DE, DZ0), (DX, DR - 0.05, DZ0)], 0.04, PLASTER, (0, 0, 1), bottom=False)
panel(roof, (DX - 0.1, 2.17), (DX + 0.1, 2.38), DZ0 + 0.004, GLASS)
panel(roof, (DX - 0.065, 2.2), (DX + 0.065, 2.35), DZ0 + 0.008, WINDOW_GLOW)
span(roof, (DX - 0.13, 2.14, DZ0), (DX + 0.13, 2.17, DZ0 + 0.04), TIMBER, skip=BACK)
dz1 = ZJ - (DR - EAVE) / K - 0.05        # back to where the main pitch swallows its ridge
for s in (-1, 1):
    ex = DX + s * (DW / 2 + 0.05)
    slab(roof, [(ex, DE - 0.05 * dk, DZ0 + 0.07), (DX, DR, DZ0 + 0.07), (DX, DR, dz1), (ex, DE - 0.05 * dk, dz1)],
         0.05, SLATE, (s, 1, 0))
# The chimney: behind the ridge on the left, and crooked - the stack leans one way and its top
# course a little more, the way a chimney does that has stood through a few winters.
CX, CZ = -0.9, -0.34
lean, lean2 = rotation(rz=0.05), rotation(rz=0.16)
c0, c1, c2 = 2.4, 3.0, 3.24
mid = Vector((CX, (c0 + c1) / 2, CZ))
box(roof, mid, (0.27, c1 - c0, 0.24), CHIMNEY, rz=0.05, skip=BOTTOM)
knee = mid + lean @ Vector((0, (c1 - c0) / 2, 0))
top = knee + lean2 @ Vector((0.02, c2 - c1, 0))
box(roof, (knee + top) / 2, (0.25, c2 - c1 + 0.02, 0.22), CHIMNEY, rz=0.16, skip=BOTTOM)
box(roof, top + lean2 @ Vector((0, 0.025, 0)), (0.33, 0.05, 0.3), CHIMNEY, rz=0.12)
pot0 = top + lean2 @ Vector((0.05, 0.05, 0))
pot1 = pot0 + lean2 @ Vector((0, 0.11, 0))
cylinder(roof, pot0, pot1, 0.045, POT, sides=6, caps=(False, True))
roof.build()

# ---- the timber frame of the upper floor, and its windows ----------------------------------
frame = Part(ASSET, 'frame')
TZ = ZJ + 0.012                          # the timbers stand proud of the plaster
span(frame, (X0, G1 - 0.02, ZJ - 0.04), (X1, G1 + 0.05, ZJ + 0.035), TIMBER)   # the jetty's sill beam
span(frame, (X0, WT - 0.06, ZJ - 0.01), (X1, WT, ZJ + 0.025), TIMBER, skip=BACK)  # the wall plate
for x in (-1.375, -GX, GX, 1.375):
    box(frame, (x, (G1 + WT) / 2, TZ), (0.055, WT - G1, 0.025), TIMBER, skip=(BACK, BOTTOM, TOP))
SIDE_W = (0.84, 1.16)                    # the two side windows of the upper floor, x either side
SY = (1.1, 1.44)
for s in (-1, 1):
    for x in (0.8, 1.2):
        box(frame, (s * x, (G1 + WT) / 2, TZ), (0.045, WT - G1, 0.025), TIMBER, skip=(BACK, BOTTOM, TOP))
    lo, hi = sorted((s * GX, s * 1.375))
    span(frame, (lo, SY[0] - 0.045, ZJ), (hi, SY[0], ZJ + 0.03), TIMBER, skip=(BACK, ENDS))     # rail under the window
    span(frame, (lo, SY[1], ZJ), (hi, SY[1] + 0.04, ZJ + 0.025), TIMBER, skip=(BACK, ENDS))     # and over it
    wx = s * sum(SIDE_W) / 2
    panel(frame, (wx - 0.16, SY[0]), (wx + 0.16, SY[1]), ZJ + 0.004, GLASS)
    panel(frame, (wx - 0.11, SY[0] + 0.05), (wx + 0.11, SY[1] - 0.05), ZJ + 0.008, WINDOW_GLOW)
    box(frame, (wx, sum(SY) / 2, ZJ + 0.012), (0.022, SY[1] - SY[0], 0.012), TIMBER, skip=(BACK, BOTTOM, TOP))
# The middle: a window over the hood, braced by two timbers that lean in towards it.
CY = (1.25, 1.49)
panel(frame, (-0.19, CY[0]), (0.19, CY[1]), ZJ + 0.004, GLASS)
panel(frame, (-0.13, CY[0] + 0.05), (0.13, CY[1] - 0.05), ZJ + 0.008, WINDOW_GLOW)
box(frame, (0, sum(CY) / 2, ZJ + 0.012), (0.022, CY[1] - CY[0], 0.012), TIMBER, skip=(BACK, BOTTOM, TOP))
span(frame, (-0.23, CY[0] - 0.04, ZJ), (0.23, CY[0], ZJ + 0.04), TIMBER, skip=BACK)
span(frame, (-0.23, CY[1], ZJ), (0.23, CY[1] + 0.035, ZJ + 0.025), TIMBER, skip=BACK)
for s in (-1, 1):
    beam(frame, (s * 0.59, G1 + 0.05), (s * 0.23, CY[1]), TZ, 0.05, 0.025, TIMBER, skip=(BACK, ENDS))
# The gable: a collar and a king post, and a round window under the collar.
GAPEX = GRIDGE - 0.07
collar = 2.2
cw = GX * (GAPEX - collar) / (GAPEX - WT)
box(frame, (0, collar, TZ), (2 * cw, 0.05, 0.025), TIMBER, skip=BACK)
box(frame, (0, (collar + GAPEX) / 2, TZ), (0.05, GAPEX - collar, 0.025), TIMBER, skip=(BACK, BOTTOM, TOP))
ring = lambda r, z, n=8: [(r * math.cos(2 * math.pi * (i + .5) / n), 1.9 + r * math.sin(2 * math.pi * (i + .5) / n), z) for i in range(n)]
face(frame, ring(0.13, ZJ + 0.006), TIMBER, (0, 0, 1))
face(frame, ring(0.105, ZJ + 0.01), GLASS, (0, 0, 1))
face(frame, ring(0.07, ZJ + 0.014), WINDOW_GLOW, (0, 0, 1))
# The back, towards the lane behind the terrace: a band of timber over the stone, a plate
# under the eaves and three posts, two windows and a back door, so it is not a blank wall.
span(frame, (X0, G1 - 0.02, ZB - 0.03), (X1, G1 + 0.05, ZB), TIMBER, skip=FRONT)
span(frame, (X0, WT - 0.06, ZB - 0.025), (X1, WT, ZB), TIMBER, skip=FRONT)
for x in (-1.375, 0, 1.375):
    box(frame, (x, (G1 + WT) / 2, ZB - 0.012), (0.055, WT - G1, 0.025), TIMBER, skip=(FRONT, BOTTOM, TOP))
for x in (-0.7, 0.7):
    panel(frame, (x - 0.16, 1.1), (x + 0.16, 1.42), ZB - 0.004, GLASS, out=-1)
    panel(frame, (x - 0.11, 1.15), (x + 0.11, 1.37), ZB - 0.008, WINDOW_GLOW, out=-1)
    span(frame, (x - 0.2, 1.06, ZB - 0.04), (x + 0.2, 1.1, ZB), TIMBER, skip=FRONT)
span(frame, (0.5, 0.02, ZB - 0.02), (0.8, 0.58, ZB), DOOR, skip=FRONT)
span(frame, (0.47, 0.58, ZB - 0.035), (0.83, 0.62, ZB), TIMBER, skip=FRONT)
span(frame, (0.46, 0, ZB - 0.12), (0.84, 0.02, ZB), STONE, skip=(FRONT, BOTTOM))
frame.build()

# ---- the shopfront: fascia, hood, door, the left window ------------------------------------
front = Part(ASSET, 'front')
span(front, (X0, 0.78, ZF - 0.01), (X1, G1, ZF + 0.04), WINE, skip=BACK)
span(front, (X0, 0.765, ZF + 0.02), (X1, 0.785, ZF + 0.05), GOLD, skip=BACK)
# The door, in a recess painted wine red, under a fanlight.
HI, HO, SPRING = 0.30, 0.44, 0.62       # the hood: inner and outer half-width, where the arch springs
HT = 0.55                               # the outer arch's rise: taller than it is wide, a hood
HZ = ZF + 0.32                          # how far the hood stands out
panel(front, (-HI, 0), (HI, SPRING), ZF + 0.003, WINE_DARK)
span(front, (-0.17, 0.03, ZF + 0.003), (0.17, 0.6, ZF + 0.03), DOOR, skip=BACK)
panel(front, (-0.07, 0.4), (0.07, 0.54), ZF + 0.034, WINDOW_GLOW)
cylinder(front, (0.12, 0.3, ZF + 0.03), (0.12, 0.3, ZF + 0.05), 0.014, GOLD, caps=(False, True))
span(front, (-HI, 0.6, ZF), (HI, SPRING + 0.025, ZF + 0.035), WINE, skip=BACK)
fan = lambda r, z, n=8: [(r * math.cos(math.pi * i / n), SPRING + r * math.sin(math.pi * i / n), z) for i in range(n + 1)]
face(front, fan(HI - 0.01, ZF + 0.004), GLASS, (0, 0, 1))
face(front, fan(HI - 0.07, ZF + 0.01), WINDOW_GLOW, (0, 0, 1))
span(front, (-HI, 0, ZF), (HI, 0.025, HZ), STONE, skip=(BACK, BOTTOM))    # the step, the hood's floor
for s in (-1, 1):
    lo, hi = sorted((s * HI, s * HO))
    span(front, (lo, 0, ZF), (hi, SPRING, HZ), WINE, skip=(BACK, BOTTOM, TOP))
    span(front, (lo - 0.015, 0, ZF), (hi + 0.015, 0.07, HZ + 0.015), WINE_DARK, skip=(BACK, BOTTOM))
    span(front, (lo - 0.012, SPRING - 0.04, ZF), (hi + 0.012, SPRING, HZ + 0.012), GOLD, skip=BACK)
# The arch: a band from the inner half-circle to a taller outer curve, extruded out from the
# wall, so it is thick at the crown - which is where the medallion hangs.
N = 8
inner = [(HI * math.cos(math.pi * i / N), SPRING + HI * math.sin(math.pi * i / N)) for i in range(N + 1)]
outer = [(HO * math.cos(math.pi * i / N), SPRING + HT * math.sin(math.pi * i / N)) for i in range(N + 1)]
for i in range(N):
    (ax, ay), (bx, by) = inner[i], inner[i + 1]
    (cx, cy), (dx, dy) = outer[i], outer[i + 1]
    face(front, [(ax, ay, HZ), (bx, by, HZ), (dx, dy, HZ), (cx, cy, HZ)], WINE, (0, 0, 1))
    face(front, [(ax, ay, ZF), (bx, by, ZF), (bx, by, HZ), (ax, ay, HZ)], WINE_DARK, (-(ax + bx), SPRING * 2 - ay - by, 0))
    face(front, [(cx, cy, ZF), (dx, dy, ZF), (dx, dy, HZ), (cx, cy, HZ)], WINE, (cx + dx, cy + dy - SPRING * 2, 0))
    # a gold edge along the front of the outer curve
    face(front, [(cx * 0.9, SPRING + (cy - SPRING) * 0.93, HZ + 0.006), (dx * 0.9, SPRING + (dy - SPRING) * 0.93, HZ + 0.006),
                 (dx, dy, HZ + 0.006), (cx, cy, HZ + 0.006)], GOLD, (0, 0, 1))
# The medallion at the crown: a gold disc, a spool of wine-red thread on it, a needle across.
MY = SPRING + (HI + HT) / 2
MR = 0.125
MZ = HZ + 0.006
cylinder(front, (0, MY, MZ - 0.01), (0, MY, MZ + 0.024), MR, GOLD, sides=12, caps=(False, True))
SZ = MZ + 0.024 + 0.04
cylinder(front, (0, MY - 0.045, SZ), (0, MY + 0.045, SZ), 0.034, THREAD, caps=(False, False))
for y in (MY - 0.058, MY + 0.045):
    cylinder(front, (0, y, SZ), (0, y + 0.013, SZ), 0.052, SPOOL)
box(front, (0.0, MY, SZ + 0.058), (0.011, 0.25, 0.011), STEEL, rz=-0.7)
beam(front, (0.03, MY + 0.03), (0.082, MY + 0.095), SZ + 0.04, 0.008, 0.008, THREAD, skip=())
# The window left of the door: wine-red frame, a gold sill.
LX = -0.96
span(front, (LX - 0.3, 0.2, ZF - 0.004), (LX + 0.3, 0.74, ZF + 0.02), WINE, skip=BACK)
panel(front, (LX - 0.26, 0.24), (LX + 0.26, 0.7), ZF + 0.024, GLASS)
panel(front, (LX - 0.2, 0.3), (LX + 0.2, 0.64), ZF + 0.028, WINDOW_GLOW)
box(front, (LX, 0.47, ZF + 0.034), (0.028, 0.46, 0.012), WINE, skip=BACK)
box(front, (LX, 0.58, ZF + 0.034), (0.52, 0.024, 0.012), WINE, skip=BACK)
span(front, (LX - 0.33, 0.165, ZF - 0.004), (LX + 0.33, 0.205, ZF + 0.07), GOLD, skip=BACK)
front.build()

# ---- the bay window ------------------------------------------------------------------------
bay = Part(ASSET, 'bay')
BX, BW, SAG = 0.9, 0.76, 0.30           # middle, width along the wall, how far it bows out
R = ((BW / 2) ** 2 + SAG ** 2) / (2 * SAG)
BCZ = ZF + SAG - R
HALF = math.asin(BW / 2 / R)
FACETS = 5
angles = [-HALF + 2 * HALF * k / FACETS for k in range(FACETS + 1)]
arc = lambda r: [(BX + r * math.sin(a), BCZ + r * math.cos(a)) for a in angles]
B0, B1, B2, B3 = 0.2, 0.24, 0.7, 0.78   # panel, sill, glass up to, head up to
prism(bay, arc(R), 0, B0, WINE)
prism(bay, arc(R + 0.03), B0, B1, GOLD)
prism(bay, arc(R + 0.01), B2, B3, WINE)
for a in angles[1:-1]:
    box(bay, (BX + (R - 0.005) * math.sin(a), (B1 + B2) / 2, BCZ + (R - 0.005) * math.cos(a)), (0.03, B2 - B1, 0.03), WINE,
        ry=a, skip=(0, 2, 3))
# Its roof: a cone of slates from the head up to the wall under the jetty.
low = arc(R + 0.05)
high = [(BX + R * 0.85 * math.sin(a), ZF + 0.03) for a in angles]
for k in range(FACETS):
    (ax, az), (bx, bz) = low[k], low[k + 1]
    (cx, cz), (dx, dz) = high[k], high[k + 1]
    face(bay, [(ax, B3, az), (bx, B3, bz), (dx, 0.92, dz), (cx, 0.92, cz)], SLATE, (0, 1, 1))
# Behind it the shop, lit: dark glass on the wall and the glow in front of it.
panel(bay, (BX - 0.36, B1), (BX + 0.36, B2), ZF + 0.004, GLASS)
panel(bay, (BX - 0.3, B1 + 0.04), (BX + 0.3, B2 - 0.03), ZF + 0.008, WINDOW_GLOW)
# The dress form in the middle of the bay: a dress on a turned torso, on a pole.
DZ = ZF + 0.13
lathe(bay, BX, DZ, [(B1 + 0.02, 0.085), (0.37, 0.06), (0.44, 0.042), (0.51, 0.058), (0.57, 0.05), (0.6, 0.02)], DRESS)
box(bay, (BX, 0.615, DZ), (0.02, 0.05, 0.02), FORM, skip=BOTTOM)
box(bay, (BX, B1 + 0.01, DZ), (0.12, 0.02, 0.12), FORM, ry=0.4, skip=BOTTOM)
# Folded cloth either side of it.
box(bay, (BX - 0.24, B1 + 0.02, ZF + 0.12), (0.13, 0.04, 0.09), MUSTARD, ry=0.15, skip=BOTTOM)
box(bay, (BX - 0.25, B1 + 0.06, ZF + 0.1), (0.1, 0.04, 0.075), PLUM, ry=-0.25, skip=BOTTOM)
box(bay, (BX + 0.24, B1 + 0.02, ZF + 0.12), (0.13, 0.04, 0.09), CREAM, ry=-0.2, skip=BOTTOM)
bay.build()

# ---- dressing: the flower box and the hanging sign -----------------------------------------
dress = Part(ASSET, 'dressing')
fx = sum(SIDE_W) / 2                    # under the right-hand upper window
span(dress, (fx - 0.2, SY[0] - 0.085, ZJ), (fx + 0.2, SY[0] - 0.01, ZJ + 0.11), TIMBER, skip=BACK)
span(dress, (fx - 0.18, SY[0] - 0.01, ZJ + 0.015), (fx + 0.18, SY[0] + 0.03, ZJ + 0.1), LEAVES, skip=(BACK, BOTTOM))
for i, x in enumerate((-0.14, -0.07, 0.0, 0.07, 0.14)):
    box(dress, (fx + x, SY[0] + 0.045, ZJ + 0.055 + 0.02 * (-1) ** i), (0.045, 0.04, 0.045),
        BLOOM_A if i % 2 == 0 else BLOOM_B, ry=0.5 * i, skip=BOTTOM)
# The sign at the left corner, out on an iron bracket: a gold coat hanger with a robe on it.
SX, SA = -1.3, 1.34                    # x of the sign, height of the arm
span(dress, (SX - 0.012, SA - 0.012, ZJ), (SX + 0.012, SA + 0.012, ZJ + 0.36), IRON, skip=BACK)
strut(dress, SX, (SA - 0.12, ZJ + 0.005), (SA, ZJ + 0.12), 0.016, IRON)
HZC = ZJ + 0.22                        # the hanger's middle: its sleeves end at z 1.47
box(dress, (SX, SA - 0.035, HZC), (0.01, 0.06, 0.01), GOLD)
for s in (-1, 1):
    strut(dress, SX, (SA - 0.065, HZC), (SA - 0.14, HZC + s * 0.12), 0.014, GOLD)
span(dress, (SX - 0.008, SA - 0.15, HZC - 0.125), (SX + 0.008, SA - 0.13, HZC + 0.125), GOLD)
# The robe: sleeves across the shoulders, a body that widens to the hem, a gold hem and a gold
# edge down the front where it opens - which is what turns a red shape into a garment.
span(dress, (SX - 0.01, SA - 0.2, HZC - 0.15), (SX + 0.01, SA - 0.135, HZC + 0.15), WINE)
slab(dress, [(SX + 0.01, SA - 0.14, HZC - 0.09), (SX + 0.01, SA - 0.14, HZC + 0.09),
             (SX + 0.01, SA - 0.4, HZC + 0.125), (SX + 0.01, SA - 0.4, HZC - 0.125)], 0.02, WINE, (1, 0, 0))
span(dress, (SX - 0.012, SA - 0.4, HZC - 0.127), (SX + 0.012, SA - 0.385, HZC + 0.127), GOLD)
span(dress, (SX - 0.013, SA - 0.4, HZC - 0.01), (SX + 0.013, SA - 0.14, HZC + 0.01), GOLD)
dress.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(tuple(pot1 + lean2 @ Vector((0, 0.02, 0))))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.1))
ASSET.objects.link(door)

# The set's height is the tip of the chimney pot, which is what a label over it has to clear.
top_y = max((o.matrix_world @ v.co).z for o in ASSET.objects if o.type == 'MESH' for v in o.data.vertices)
bpy.context.scene['building_height'] = round(top_y, 2)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'tailor.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'tailor'})
