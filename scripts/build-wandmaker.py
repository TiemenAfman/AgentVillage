"""The wandwright's shop. Rebuild with scripts/blender.mjs --background --python scripts/build-wandmaker.py.

The grand old shop of the terrace: a tall stone house under a steep slate roof, a jettied
half-timbered gable over its display window, and - the thing that says what is sold here from
across the square - a two-storey glazed bay on its right front corner, a little turret of lit
panes between dark walnut mullions under a flared, pointed midnight-blue hat with a gold finial.
A long walnut fascia between two gold lines runs over the ground floor and wraps round the bay;
a dormer breaks the long front slope; an arched midnight-blue door in a walnut case stands in
the middle; an iron lamp stands beside it; and a curly iron bracket hangs out a midnight board
with a wand on it, a spark of gold at its tip. In the window, piles of narrow boxes. No
lettering anywhere: a sign is a picture.

One civic asset, `civic_wandmaker` (budget 1500), all of it static. It stands on a 3x3 lot in a
terrace, so the walls run to x = +-1.40 and only the bay, the lamp and the bracket reach past the
front wall - never past z = 1.47. `anchor.door` is at the foot of the door (x = DX, near the
lot's middle, where the paths arrive); `anchor.smoke` on the crooked chimney.

Coarse on purpose, like every civic here: the body is one closed stone prism rather than four
walls with a thickness nobody sees, flat panes are single quads wound to face out (the island
culls back faces), and the bay is an octagon of which only the five facets in front of the wall
are built. The bay's mullions are real posts, because a crease at each corner is what makes a
polygon read as glass and not as a painted drum.

Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/wandmaker'
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


STONE = material('stone', 'wandmaker stone', 0x837c71)
DRESSED = material('stone', 'wandmaker dressed stone', 0xa49d91)
PLASTER = material('wall', 'wandmaker plaster', 0xe9dfc6)
TIMBER = material('plank', 'wandmaker timber', 0x3a281c)
SLATE = material('roof', 'wandmaker slate', 0x3a424f)
RIDGE_SLATE = material('roof', 'wandmaker ridge', 0x2f3641)
HAT = material('roof', 'wandmaker bay roof', 0x25305a)
WALNUT = material('plank', 'wandmaker walnut', 0x4a2e1e)
MIDNIGHT = material('plain', 'wandmaker midnight', 0x1f2b57)
GOLD = material('plain', 'wandmaker gold', 0xd9ab3c)
GLASS = material('plain', 'wandmaker window', 0x1c222c)
IRON = material('plain', 'wandmaker iron', 0x28292e)
CLAY = material('plain', 'wandmaker chimney pot', 0x6e4636)
SOOT = material('plain', 'wandmaker flue', 0x1a1716)
WAND = material('plain', 'wandmaker wand', 0x8a5e38)
HANDLE = material('plain', 'wandmaker wand handle', 0x2a1a12)
BOXES = [material('plain', f'wandmaker box {i}', c)
         for i, c in enumerate((0x7a2f2a, 0x3d5a45, 0xcdbf9c, 0x4a4f66, 0x5e3b27))]
WINDOW_GLOW = material('plain', 'wandmaker lit window', 0xffd88a, emissive=True)
BAY_GLOW = material('plain', 'wandmaker lit bay', 0xffe2a0, emissive=True)
LAMP_GLOW = material('plain', 'wandmaker lamp', 0xffd070, emissive=True)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

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
        TOPS.append(max(v.y for v in self.verts) + self.origin.y)
        return obj


TOPS = []


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


BOX_FACES = {'-z': [0, 3, 2, 1], '+z': [4, 5, 6, 7], '-y': [0, 1, 5, 4], '+y': [2, 3, 7, 6], '+x': [1, 2, 6, 5], '-x': [0, 4, 7, 3]}
WALL = ('-z',)              # a board on the front wall: its back is against the stone
FOOT = ('-z', '-y')         # and one that also stands on the ground or a sill


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=()):
    """A box; `skip` leaves out the faces nobody can see (against a wall, on the ground)."""
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [f for k, f in BOX_FACES.items() if k not in skip], mat)


def beam(part, a, b, t, mat, wide=None):
    """A timber from a to b, `t` thick (and `wide` across, if not square)."""
    a, b = Vector(a), Vector(b)
    d = b - a
    yaw = math.atan2(d.x, d.z)
    pitch = math.atan2(d.y, math.hypot(d.x, d.z))
    box(part, (a + b) / 2, (wide or t, t, d.length), mat, rx=-pitch, ry=yaw)


def newell(pts):
    n = Vector((0, 0, 0))
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        n += Vector(((p.y - q.y) * (p.z + q.z), (p.z - q.z) * (p.x + q.x), (p.x - q.x) * (p.y + q.y)))
    return n


def poly(part, pts, mat, out):
    """One flat face, wound so that it faces `out` - the island draws front faces only."""
    pts = [Vector(p) for p in pts]
    if newell(pts).dot(Vector(out)) < 0:
        pts = pts[::-1]
    part.add(pts, [list(range(len(pts)))], mat)


def solid(part, lower, upper, mat, skip=()):
    """A convex hexahedron from two quads given in the same order; faces wound outwards."""
    pts = [Vector(p) for p in lower] + [Vector(p) for p in upper]
    mid = sum(pts, Vector()) / 8
    for key, f in (('bottom', (0, 3, 2, 1)), ('top', (4, 5, 6, 7)), ('a', (0, 1, 5, 4)),
                   ('b', (1, 2, 6, 5)), ('c', (2, 3, 7, 6)), ('d', (3, 0, 4, 7))):
        if key in skip:
            continue
        face = [pts[i] for i in f]
        poly(part, face, mat, sum(face, Vector()) / 4 - mid)


def column(part, cx, cz, y0, y1, r, mat, sides=6, top=None, turn=0.0):
    """An upright prism; `top` caps it with a face of that material."""
    ring = [(cx + r * math.cos(turn + 2 * math.pi * i / sides), cz + r * math.sin(turn + 2 * math.pi * i / sides))
            for i in range(sides)]
    for i in range(sides):
        (ax, az), (bx, bz) = ring[i], ring[(i + 1) % sides]
        poly(part, [(ax, y0, az), (bx, y0, bz), (bx, y1, bz), (ax, y1, az)], mat,
             ((ax + bx) / 2 - cx, 0, (az + bz) / 2 - cz))
    if top is not None:
        poly(part, [(x, y1, z) for x, z in ring], top, (0, 1, 0))


def front_quad(part, x0, x1, y0, y1, z, mat):
    poly(part, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, (0, 0, 1))


def back_quad(part, x0, x1, y0, y1, z, mat):
    poly(part, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat, (0, 0, -1))


def ribbon(part, path, x, wide, thick, mat):
    """A flat iron strap along a path of (y, z) points in the plane x = x: the sign's scrolls."""
    pts = [Vector((0, y, z)) for y, z in path]
    norms = []
    for i in range(len(pts)):
        a, b = pts[max(i - 1, 0)], pts[min(i + 1, len(pts) - 1)]
        d = (b - a).normalized()
        norms.append(Vector((0, -d.z, d.y)))
    ring = []
    for p, n in zip(pts, norms):
        ring.append([Vector((x - wide / 2, 0, 0)) + p + n * thick / 2, Vector((x + wide / 2, 0, 0)) + p + n * thick / 2,
                     Vector((x + wide / 2, 0, 0)) + p - n * thick / 2, Vector((x - wide / 2, 0, 0)) + p - n * thick / 2])
    for i in range(len(pts) - 1):
        a, b, n = ring[i], ring[i + 1], (norms[i] + norms[i + 1]) / 2
        for j, out in ((0, n), (1, Vector((1, 0, 0))), (2, -n), (3, Vector((-1, 0, 0)))):
            k = (j + 1) % 4
            poly(part, [a[j], a[k], b[k], b[j]], mat, out)
    for r, sign in ((ring[0], -1), (ring[-1], 1)):
        d = (pts[-1] - pts[-2]) if sign > 0 else (pts[1] - pts[0])
        poly(part, r, mat, d * sign)


ASSET = bpy.data.collections.new('civic_wandmaker')
bpy.context.scene.collection.children.link(ASSET)

# ---- the measures ----------------------------------------------------------------------
X0, X1, Z0, Z1 = -1.40, 1.40, -1.30, 1.05      # the stone body; the ridge runs along x
MIDZ = (Z0 + Z1) / 2
EAVES, RIDGE = 1.80, 3.02                      # the slate's underside at the walls and the ridge
K = (RIDGE - EAVES) / (Z1 - MIDZ)              # rise per unit run of the main roof (~46 degrees)
SLATE_T = 0.05
FAS0, FAS1 = 0.88, 1.02                        # the walnut fascia over the ground floor
DX = 0.12                                      # the door - near the lot's middle, clear of the bay
GX0, GX1 = -1.40, -0.30                        # the jettied gable over the display window
GC, GW = (GX0 + GX1) / 2, (GX1 - GX0) / 2
GZ, GY0, PEAK = Z1 + 0.06, FAS1 + 0.025, 2.78
KC = (PEAK - EAVES) / GW                       # its pitch, ~61 degrees: the steep one
TX, TZ, TA = 1.02, 1.02, 0.39                  # the bay: axis and apothem of its octagon
LX, LZ = -0.19, 1.34                           # the lamp
SX = 0.45                                      # the plane of the hanging sign


def roof_y(z):
    """The underside of the main roof over the point z, front slope or back."""
    return EAVES + (Z1 - z) * K if z >= MIDZ else RIDGE - (MIDZ - z) * K


# ---- the house: one stone prism, its back windows and the chimney ------------------------
house = Part(ASSET, 'house')
front_quad(house, X0, X1, 0, EAVES, Z1, STONE)
back_quad(house, X0, X1, 0, EAVES, Z0, STONE)
for x, s in ((X0, -1), (X1, 1)):
    poly(house, [(x, 0, Z0), (x, 0, Z1), (x, EAVES, Z1), (x, EAVES, Z0)], STONE, (s, 0, 0))
    poly(house, [(x, EAVES, Z0), (x, EAVES, Z1), (x, RIDGE, MIDZ)], STONE, (s, 0, 0))
box(house, ((X0 + 0.63) / 2, 0.03, Z1 + 0.012), (0.63 - X0, 0.06, 0.03), DRESSED, skip=FOOT)
# Two lit windows and a plank door at the back, so the house is not a blind box from the yard.
for x in (-0.55, 0.55):
    back_quad(house, x - 0.14, x + 0.14, 1.2, 1.56, Z0 - 0.003, GLASS)
    back_quad(house, x - 0.11, x + 0.11, 1.225, 1.535, Z0 - 0.007, WINDOW_GLOW)
    box(house, (x, 1.19, Z0 - 0.02), (0.32, 0.035, 0.04), DRESSED, skip=('+z',))
box(house, (0.9, 0.27, Z0 - 0.01), (0.28, 0.54, 0.02), WALNUT, skip=('+z', '-y'))
# The chimney on the left party wall behind the ridge, built crooked: the upper stack leans
# off the lower one and its cap sits askew, which is most of what "old" means from the square.
CX, CZ = -1.06, -0.56
box(house, (CX, 2.72, CZ), (0.30, 0.64, 0.26), STONE, skip=('-y',))
box(house, (CX + 0.022, 3.18, CZ), (0.28, 0.32, 0.24), STONE, rz=-0.11)
box(house, (CX + 0.05, 3.35, CZ + 0.01), (0.34, 0.045, 0.30), DRESSED, rz=-0.11, ry=0.08)
PX, PZ = CX + 0.06, CZ - 0.03
column(house, PX, PZ, 3.37, 3.47, 0.045, CLAY, top=SOOT)
house.build()

# ---- the roof: the main slopes, cut round the gable, and the gable's own steep pair ------
roof = Part(ASSET, 'roof')
DV = SLATE_T * math.sqrt(1 + K * K)
OH = 0.09


def slope(x0, x1, za, zb):
    lower = [(x0, roof_y(za), za), (x1, roof_y(za), za), (x1, roof_y(zb), zb), (x0, roof_y(zb), zb)]
    solid(roof, lower, [(x, y + DV, z) for x, y, z in lower], SLATE)


slope(GX1, X1 + 0.03, Z1 + OH, MIDZ)            # the front slope right of the gable
slope(X0 - 0.03, GX1, Z1 - 0.05, MIDZ)          # behind the gable; the gable's roof covers the rest
slope(X0 - 0.03, X1 + 0.03, MIDZ, Z0 - OH)      # the back
box(roof, (0, RIDGE + DV + 0.012, MIDZ), (2.88, 0.045, 0.1), RIDGE_SLATE, skip=('-y',))


def pitched(xl, xr, xc, ye, yp, zf, zeave, zridge, dv):
    """A little gable roof whose ridge runs along z: two slabs from the front `zf` back into the
    main roof, each cut along its valley (back to `zeave` at the eave, `zridge` at the ridge) so
    no slate hangs out of the main roof behind it."""
    for xe in (xl, xr):
        lower = [(xe, ye, zf), (xc, yp, zf), (xc, yp, zridge), (xe, ye, zeave)]
        solid(roof, lower, [(x, y + dv, z) for x, y, z in lower], SLATE)


def valley(y):
    """Where a roof top at height y dives under the main roof's top, as a z."""
    return Z1 - (y - EAVES - DV) / K


DVC = SLATE_T * math.sqrt(1 + KC * KC)
CZF = GZ + 0.08                                 # the gable roof's front
pitched(GX0 - 0.04, GX1 + 0.04, GC, EAVES - 0.04 * KC, PEAK, CZF, Z1 - 0.1, valley(PEAK + DVC) - 0.12, DVC)
box(roof, (GC, PEAK + DVC + 0.01, (CZF + valley(PEAK + DVC)) / 2), (0.07, 0.04, CZF - valley(PEAK + DVC)), RIDGE_SLATE, skip=('-y',))
# A dormer over the door, a lit window in plaster under its own steep little roof, to break the
# long front slope between the gable and the bay's hat.
MX, MW, MZ = DX, 0.2, 0.66
MB, ME, MP = roof_y(MZ) - 0.01, 2.47, 2.72
KM = (MP - ME) / MW
DVM = SLATE_T * math.sqrt(1 + KM * KM)
pitched(MX - MW - 0.035, MX + MW + 0.035, MX, ME - 0.035 * KM, MP, MZ + 0.06, valley(ME) - 0.06, valley(MP + DVM) - 0.1, DVM)
roof.build()

dormer = Part(ASSET, 'dormer')
poly(dormer, [(MX - MW, MB, MZ), (MX + MW, MB, MZ), (MX + MW, ME, MZ), (MX, MP, MZ), (MX - MW, ME, MZ)], PLASTER, (0, 0, 1))
for s in (-1, 1):
    x = MX + s * MW
    poly(dormer, [(x, MB, MZ), (x, ME, MZ), (x, ME, valley(ME) - 0.02)], PLASTER, (s, 0, 0))
MT = roof_y(MZ) + DV                            # where the slates meet the dormer's face
front_quad(dormer, MX - 0.11, MX + 0.11, MT + 0.035, ME - 0.02, MZ + 0.003, GLASS)
front_quad(dormer, MX - 0.085, MX + 0.085, MT + 0.055, ME - 0.04, MZ + 0.007, WINDOW_GLOW)
box(dormer, (MX, (MT + ME) / 2 + 0.0075, MZ + 0.012), (0.014, ME - MT - 0.055, 0.012), TIMBER, skip=WALL)
box(dormer, (MX, MT + 0.02, MZ + 0.02), (2 * MW, 0.03, 0.04), TIMBER, skip=WALL)
box(dormer, (MX, ME, MZ + 0.012), (2 * MW, 0.03, 0.024), TIMBER, skip=WALL)
dormer.build()

# ---- the jettied gable: plaster between dark timbers, standing out over the fascia ------
gable = Part(ASSET, 'gable')
poly(gable, [(GX0, GY0, GZ), (GX1, GY0, GZ), (GX1, EAVES, GZ), (GC, PEAK, GZ), (GX0, EAVES, GZ)], PLASTER, (0, 0, 1))
for x, s in ((GX0, -1), (GX1, 1)):
    poly(gable, [(x, GY0, Z1), (x, GY0, GZ), (x, EAVES, GZ), (x, EAVES, Z1)], PLASTER, (s, 0, 0))
poly(gable, [(GX0, GY0, Z1), (GX1, GY0, Z1), (GX1, GY0, GZ), (GX0, GY0, GZ)], PLASTER, (0, -1, 0))
TZF = GZ + 0.009
box(gable, (GC, GY0 + 0.025, GZ + 0.012), (GX1 - GX0, 0.05, 0.024), TIMBER, skip=WALL)          # the bressumer
box(gable, (GC, EAVES, GZ + 0.011), (GX1 - GX0, 0.045, 0.022), TIMBER, skip=WALL)                # the tie beam
for x in (GX0 + 0.03, GX1 - 0.03, GC - 0.25, GC + 0.25):
    box(gable, (x, (GY0 + 0.05 + EAVES) / 2, TZF), (0.05 if abs(x - GC) > 0.3 else 0.04, EAVES - GY0 - 0.05, 0.018), TIMBER, skip=WALL)
for s in (-1, 1):
    beam(gable, (GC + s * (GW - 0.055), GY0 + 0.07, TZF), (GC + s * 0.27, EAVES - 0.05, TZF), 0.018, TIMBER, wide=0.04)
    # The attic's two posts and, over them, the collar; then barge boards under the slates.
    box(gable, (GC + s * 0.14, (EAVES + 2.42) / 2, TZF), (0.035, 2.42 - EAVES, 0.018), TIMBER, skip=WALL)
    beam(gable, (GC + s * (GW + 0.04), EAVES - 0.04 * KC - 0.035, GZ + 0.06), (GC, PEAK - 0.02, GZ + 0.06), 0.035, TIMBER, wide=0.035)
box(gable, (GC, 2.42, TZF), (2 * (PEAK - 2.42) / KC, 0.04, 0.02), TIMBER, skip=WALL)
box(gable, (GC, 1.625, TZF), (0.5, 0.035, 0.018), TIMBER, skip=WALL)
# The upper window, a cross of glazing bars, and the little lit window up in the peak.
front_quad(gable, GC - 0.2, GC + 0.2, 1.2, 1.605, GZ + 0.003, GLASS)
front_quad(gable, GC - 0.17, GC + 0.17, 1.225, 1.58, GZ + 0.007, WINDOW_GLOW)
box(gable, (GC, 1.40, GZ + 0.013), (0.016, 0.40, 0.014), TIMBER, skip=WALL)
box(gable, (GC, 1.45, GZ + 0.013), (0.40, 0.016, 0.014), TIMBER, skip=WALL)
box(gable, (GC, 1.19, GZ + 0.022), (0.46, 0.03, 0.045), TIMBER, skip=WALL)
front_quad(gable, GC - 0.09, GC + 0.09, 2.02, 2.30, GZ + 0.003, GLASS)
front_quad(gable, GC - 0.065, GC + 0.065, 2.04, 2.28, GZ + 0.007, WINDOW_GLOW)
box(gable, (GC, 2.16, GZ + 0.013), (0.014, 0.28, 0.012), TIMBER, skip=WALL)
gable.build()

# ---- the shopfront: fascia, display window, the door and the window over it -------------
shop = Part(ASSET, 'shopfront')
FX1 = TX - TA + 0.03                             # the fascia runs into the bay, which wraps it on
box(shop, ((X0 + FX1) / 2, (FAS0 + FAS1) / 2, Z1 + 0.018), (FX1 - X0, FAS1 - FAS0, 0.036), WALNUT, skip=WALL)
for y in (FAS0 + 0.018, FAS1 - 0.018):                                   # two gold lines
    box(shop, ((X0 + FX1) / 2, y, Z1 + 0.04), (FX1 - X0, 0.012, 0.012), GOLD, skip=WALL)
box(shop, ((X0 + FX1) / 2, FAS1 + 0.0125, Z1 + 0.03), (FX1 - X0, 0.025, 0.06), WALNUT, skip=WALL)
# The display window between two walnut pilasters with gold capitals, on a midnight stall riser.
WX0, WX1 = -1.28, -0.40
WC = (WX0 + WX1) / 2
for x in (WX0 - 0.05, WX1 + 0.05):
    box(shop, (x, (0.05 + FAS0) / 2, Z1 + 0.025), (0.1, FAS0 - 0.05, 0.05), WALNUT, skip=FOOT)
    box(shop, (x, FAS0 - 0.03, Z1 + 0.028), (0.108, 0.022, 0.058), GOLD, skip=WALL)
box(shop, (WC, 0.155, Z1 + 0.012), (WX1 - WX0, 0.21, 0.024), MIDNIGHT, skip=FOOT)
box(shop, (WC, 0.28, Z1 + 0.035), (WX1 - WX0 + 0.04, 0.04, 0.07), WALNUT, skip=WALL)
box(shop, (WC, 0.86, Z1 + 0.02), (WX1 - WX0, 0.04, 0.04), WALNUT, skip=WALL)
front_quad(shop, WX0, WX1, 0.30, 0.84, Z1 + 0.003, GLASS)
front_quad(shop, WX0 + 0.03, WX1 - 0.03, 0.32, 0.82, Z1 + 0.007, WINDOW_GLOW)
box(shop, (WC, 0.60, Z1 + 0.013), (WX1 - WX0, 0.022, 0.014), WALNUT, skip=WALL)
for x in (WC - 0.22, WC, WC + 0.22):
    box(shop, (x, 0.72, Z1 + 0.013), (0.018, 0.24, 0.014), WALNUT, skip=WALL)
# The piles of narrow boxes on the sill, dark against the lit pane - the shop's own stock.
# Two teetering towers and a little heap between them, each box a touch askew.
JITTER = (0.0, 0.011, -0.008, 0.013, -0.005, 0.009)
stock = [(-1.10, 6), (-0.61, 5), (-0.855, 2)]
n = 0
for x, high in stock:
    for i in range(high):
        box(shop, (x + JITTER[i], 0.312 + 0.024 * i, Z1 + 0.029), (0.14, 0.024, 0.026), BOXES[n % len(BOXES)],
            ry=0.07 * JITTER[(i + 3) % 6] / 0.013, skip=FOOT)
        n += 1
# The door: an arched midnight double door in a walnut case, a lit fanlight, a stone step.
box(shop, (DX, 0.0225, Z1 + 0.08), (0.52, 0.045, 0.16), DRESSED, skip=FOOT)
DH, DR = 0.58, 0.155
box(shop, (DX, (0.045 + DH) / 2, Z1 + 0.012), (2 * DR, DH - 0.045, 0.024), MIDNIGHT, skip=FOOT)
box(shop, (DX, (0.045 + DH) / 2, Z1 + 0.026), (0.016, DH - 0.06, 0.006), WALNUT, skip=WALL)
for s in (-1, 1):
    box(shop, (DX + s * 0.045, 0.32, Z1 + 0.03), (0.022, 0.022, 0.014), GOLD, skip=WALL)
    box(shop, (DX + s * (DR + 0.02), (0.045 + DH) / 2, Z1 + 0.022), (0.04, DH - 0.045, 0.044), WALNUT, skip=FOOT)
# The fanlight is a fan of four triangles, the lit one inside the dark one.
for r, z, mat in ((DR, Z1 + 0.003, GLASS), (DR - 0.03, Z1 + 0.007, WINDOW_GLOW)):
    for i in range(4):
        a0, a1 = math.pi * i / 4, math.pi * (i + 1) / 4
        poly(shop, [(DX, DH, z), (DX + r * math.cos(a0), DH + r * math.sin(a0), z),
                    (DX + r * math.cos(a1), DH + r * math.sin(a1), z)], mat, (0, 0, 1))
box(shop, (DX, DH + 0.07, Z1 + 0.012), (0.014, 0.14, 0.012), WALNUT, skip=WALL)
box(shop, (DX, DH + 0.005, Z1 + 0.02), (2 * DR + 0.02, 0.025, 0.03), WALNUT, skip=WALL)
RI, RO, ZF = DR, DR + 0.04, Z1 + 0.044
for i in range(4):
    a0, a1 = math.pi * i / 4, math.pi * (i + 1) / 4
    c0, c1 = Vector((math.cos(a0), math.sin(a0), 0)), Vector((math.cos(a1), math.sin(a1), 0))
    o = Vector((DX, DH, 0))
    poly(shop, [o + c0 * RI + Vector((0, 0, ZF)), o + c0 * RO + Vector((0, 0, ZF)),
                o + c1 * RO + Vector((0, 0, ZF)), o + c1 * RI + Vector((0, 0, ZF))], WALNUT, (0, 0, 1))
    poly(shop, [o + c0 * RO + Vector((0, 0, Z1)), o + c1 * RO + Vector((0, 0, Z1)),
                o + c1 * RO + Vector((0, 0, ZF)), o + c0 * RO + Vector((0, 0, ZF))], WALNUT, c0 + c1)
    poly(shop, [o + c0 * RI + Vector((0, 0, Z1)), o + c1 * RI + Vector((0, 0, Z1)),
                o + c1 * RI + Vector((0, 0, ZF)), o + c0 * RI + Vector((0, 0, ZF))], WALNUT, -(c0 + c1))
box(shop, (DX, DH + RO + 0.01, Z1 + 0.035), (0.06, 0.07, 0.06), DRESSED, skip=WALL)
# The window over the door, in a dressed-stone surround.
front_quad(shop, DX - 0.14, DX + 0.14, 1.22, 1.60, Z1 + 0.003, GLASS)
front_quad(shop, DX - 0.11, DX + 0.11, 1.245, 1.575, Z1 + 0.007, WINDOW_GLOW)
box(shop, (DX, 1.41, Z1 + 0.013), (0.016, 0.38, 0.014), WALNUT, skip=WALL)
box(shop, (DX, 1.46, Z1 + 0.013), (0.28, 0.016, 0.014), WALNUT, skip=WALL)
box(shop, (DX, 1.63, Z1 + 0.02), (0.36, 0.06, 0.04), DRESSED, skip=WALL)
box(shop, (DX, 1.20, Z1 + 0.025), (0.34, 0.035, 0.05), DRESSED, skip=WALL)
shop.build()

# ---- the bay: a glazed octagon two storeys high, under a pointed hat --------------------
bay = Part(ASSET, 'bay')
HALF = math.tan(math.pi / 8)
FACETS = range(5)                                # +x, the two front diagonals' worth, +z, -x


def facet(k, apothem, y0, y1, mat, inset=None):
    """One facet of the octagon at this apothem; with `inset`, a pane on the part not in the wall."""
    phi = k * math.pi / 4
    n = Vector((math.cos(phi), 0, math.sin(phi)))
    t = Vector((-math.sin(phi), 0, math.cos(phi)))
    w = apothem * HALF
    s0, s1 = -w, w
    if inset is not None:
        s0, s1 = s0 + inset, s1 - inset
        if k == 0:
            s0 = max(s0, Z1 - TZ + inset)
        if k == 4:
            s1 = min(s1, TZ - Z1 - inset)
    c = Vector((TX, 0, TZ)) + n * apothem
    poly(bay, [c + t * s0 + Vector((0, y0, 0)), c + t * s1 + Vector((0, y0, 0)),
               c + t * s1 + Vector((0, y1, 0)), c + t * s0 + Vector((0, y1, 0))], mat, n)


def octagon(apothem, y, mat, out):
    r = apothem / math.cos(math.pi / 8)
    poly(bay, [(TX + r * math.cos(math.pi / 8 + i * math.pi / 4), y, TZ + r * math.sin(math.pi / 8 + i * math.pi / 4))
               for i in range(8)], mat, out)


for k in FACETS:
    facet(k, TA + 0.02, 0, 0.26, DRESSED)
    facet(k, TA, 0.26, 1.62, WALNUT)
    for y0, y1, bar in ((0.30, 0.83, 0.585), (1.06, 1.56, 1.33)):
        facet(k, TA + 0.004, y0, y1, GLASS, inset=0.022)
        facet(k, TA + 0.008, y0 + 0.025, y1 - 0.025, BAY_GLOW, inset=0.042)
        facet(k, TA + 0.012, bar, bar + 0.025, WALNUT)
    facet(k, TA + 0.035, FAS0, FAS1, WALNUT)       # the fascia, carried round
    facet(k, TA + 0.04, FAS0 + 0.012, FAS0 + 0.024, GOLD)
    facet(k, TA + 0.04, FAS1 - 0.024, FAS1 - 0.012, GOLD)
    facet(k, TA + 0.03, 1.62, 1.72, WALNUT)        # the cornice under the hat, and its gold line
    facet(k, TA + 0.035, 1.645, 1.657, GOLD)
octagon(TA + 0.02, 0.26, DRESSED, (0, 1, 0))
octagon(TA + 0.035, FAS1, WALNUT, (0, 1, 0))
octagon(TA + 0.03, 1.62, WALNUT, (0, -1, 0))
# The mullions at the four corners in front of the wall.
for i in range(1, 5):
    a = math.pi / 8 + (i - 1) * math.pi / 4
    r = (TA + 0.006) / math.cos(math.pi / 8)
    box(bay, (TX + r * math.cos(a), 0.94, TZ + r * math.sin(a)), (0.034, 1.36, 0.034), WALNUT, ry=-a, skip=('-x', '-y', '+y'))
# The hat: a flared skirt kicked out over the cornice, then eight steep facets to a point well
# over the ridge, and a gold finial on it. The kick is what turns a cone into a wizard's hat.
HAT_A, HAT_Y, KICK_A, KICK_Y, HAT_TOP = TA + 0.05, 1.70, TA - 0.03, 1.80, 3.26
ring = lambda apothem, y: [(TX + apothem / math.cos(math.pi / 8) * math.cos(math.pi / 8 + i * math.pi / 4), y,
                            TZ + apothem / math.cos(math.pi / 8) * math.sin(math.pi / 8 + i * math.pi / 4)) for i in range(8)]
skirt, kick = ring(HAT_A, HAT_Y), ring(KICK_A, KICK_Y)
for i in range(8):
    j = (i + 1) % 8
    am = math.pi / 4 * (i + 1)
    out = (math.cos(am), 0.4, math.sin(am))
    poly(bay, [skirt[i], skirt[j], kick[j], kick[i]], HAT, out)
    poly(bay, [kick[i], kick[j], (TX, HAT_TOP, TZ)], HAT, out)
octagon(HAT_A, HAT_Y, HAT, (0, -1, 0))
tip = [(TX, 3.46, TZ), (TX, 3.22, TZ)]
mid = [(TX + 0.034 * math.cos(math.pi / 4 + i * math.pi / 2), 3.30, TZ + 0.034 * math.sin(math.pi / 4 + i * math.pi / 2)) for i in range(4)]
for i in range(4):
    a, b = Vector(mid[i]), Vector(mid[(i + 1) % 4])
    out = (a + b) / 2 - Vector((TX, 3.30, TZ))
    poly(bay, [a, b, tip[0]], GOLD, out + Vector((0, 0.2, 0)))
    poly(bay, [a, b, tip[1]], GOLD, out - Vector((0, 0.2, 0)))
bay.build()

# ---- the lamp beside the door ---------------------------------------------------------
lamp = Part(ASSET, 'lamp')
box(lamp, (LX, 0.03, LZ), (0.07, 0.06, 0.07), IRON)
column(lamp, LX, LZ, 0.06, 0.845, 0.017, IRON)
box(lamp, (LX, 0.852, LZ), (0.056, 0.02, 0.056), IRON)
q = lambda h, y: [(LX - h, y, LZ - h), (LX + h, y, LZ - h), (LX + h, y, LZ + h), (LX - h, y, LZ + h)]
solid(lamp, q(0.03, 0.862), q(0.044, 0.975), LAMP_GLOW)
cap = q(0.058, 0.975)
for i in range(4):
    a, b = Vector(cap[i]), Vector(cap[(i + 1) % 4])
    poly(lamp, [a, b, (LX, 1.05, LZ)], IRON, (a + b) / 2 - Vector((LX, 0.975, LZ)) + Vector((0, 0.05, 0)))
poly(lamp, cap, IRON, (0, -1, 0))
box(lamp, (LX, 1.065, LZ), (0.016, 0.035, 0.016), IRON)
lamp.build()

# ---- the sign: a curly iron bracket and a midnight board with a wand on it ---------------
sign = Part(ASSET, 'sign')
ARM_Y, ARM_Z = 1.625, 1.43
box(sign, (SX, 1.54, Z1 + 0.008), (0.05, 0.22, 0.016), IRON, skip=WALL)
box(sign, (SX, ARM_Y, (Z1 + ARM_Z) / 2), (0.018, 0.018, ARM_Z - Z1), IRON, skip=WALL)
ribbon(sign, [(1.45, Z1 + 0.012), (1.525, 1.115), (1.58, 1.185), (1.615, 1.265)], SX, 0.016, 0.016, IRON)
ribbon(sign, [(ARM_Y, ARM_Z - 0.01), (1.648, 1.452), (1.675, 1.450), (1.686, 1.426), (1.671, 1.405), (1.651, 1.412)],
       SX, 0.016, 0.014, IRON)
BY0, BY1, BZ0, BZ1 = 1.25, 1.53, 1.13, 1.43
for z in (BZ0 + 0.05, BZ1 - 0.05):
    box(sign, (SX, (BY1 + ARM_Y) / 2, z), (0.008, ARM_Y - BY1, 0.008), IRON)
BYC, BZC = (BY0 + BY1) / 2, (BZ0 + BZ1) / 2
box(sign, (SX, BYC, BZC), (0.022, BY1 - BY0, BZ1 - BZ0), GOLD)
box(sign, (SX, BYC, BZC), (0.036, BY1 - BY0 - 0.028, BZ1 - BZ0 - 0.028), MIDNIGHT)
# The wand, through the board so it shows on both faces: handle low at the front, tip up by
# the wall, where the gold spark is.
HND = Vector((0, BYC - 0.085, BZC + 0.095))
TIP = Vector((0, BYC + 0.075, BZC - 0.075))
d = (TIP - HND)
ang = math.atan2(-d.y, d.z)
L = d.length
u = d.normalized()
box(sign, (SX, *(HND + u * (0.05 + L / 2 - 0.025))[1:]), (0.044, 0.013, L - 0.05), WAND, rx=ang)
box(sign, (SX, *(HND + u * 0.035)[1:]), (0.05, 0.022, 0.07), HANDLE, rx=ang)
box(sign, (SX, *(HND + u * 0.074)[1:]), (0.052, 0.026, 0.012), GOLD, rx=ang)
for s in (-1, 1):
    x = SX + s * 0.028
    ty, tz = TIP.y + 0.012, TIP.z - 0.012
    for size, thin, turn in ((0.055, 0.014, 0.0), (0.03, 0.009, math.pi / 4)):
        for a in (turn, turn + math.pi / 2):
            cy, cz = math.sin(a), math.cos(a)
            poly(sign, [(x, ty + cy * size, tz + cz * size), (x, ty - cz * thin, tz + cy * thin),
                        (x, ty - cy * size, tz - cz * size), (x, ty + cz * thin, tz - cy * thin)], GOLD, (s, 0, 0))
sign.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((PX, 3.50, PZ))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DX, 0, Z1 + 0.12))
ASSET.objects.link(door)

# The set's height is its highest point - the chimney pot, a centimetre over the bay's finial -
# which is where the island hangs a label over it.
bpy.context.scene['building_height'] = round(max(TOPS), 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'wandmaker.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'wandmaker'})
