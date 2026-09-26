"""The wandwright's shop. Rebuild with scripts/blender.mjs --background --python scripts/build-wandmaker.py.

The odd old shop of the street: a cream plaster house in oak timber under a terracotta roof, a
jettied half-timbered gable over its display window, and - the thing that says what is sold here
from across the square - a two-storey glazed bay on its right front corner, a little turret of lit
panes between walnut mullions under a flared, pointed midnight-blue hat with a gold finial. A
walnut fascia between two gold lines runs over the ground floor and wraps round the bay; an
arched midnight-blue door in a walnut case stands in the middle; an iron lamp stands beside it;
and a curly iron bracket hangs out a midnight board with a wand on it, a spark of gold at its tip.
In the window, piles of narrow boxes. No lettering anywhere: a sign is a picture.

It is drawn at the village's size, not the terrace's. The first version filled its 3x3 lot - a
2.9 wide stone house with a slate roof to 3.0 and a turret to 3.46 - and stood twice the height of
the tavern (1.80 x 1.57 x 1.69) and the bakery beside it, in near-black slate and timber the
village has nowhere else. So the walls run x -0.86..+0.86 and z -0.55..+0.80, the eaves are at
0.96, the ridge at 1.58, the chimney pot stops at 1.87, and only the hat's finial rises past that,
to 2.06, because the turret is the one thing about this shop that is allowed to stand out. The
door is a door of the village's size (0.26 wide, 0.46 tall), the roof the tavern's pitch (43
degrees; the gable over the window 45) in its terracotta, the timber the bakery's oak. The shop
keeps its own colours where a shop does: the walnut front, the midnight door, the blue hat and
the gold.

One civic asset, `civic_wandmaker` (budget 1500), all of it static. Only the bay, the lamp and the
sign reach past the front wall, the sign's arm furthest, to z = 1.09. `anchor.door` is at the foot of the
door (x = DX, near the lot's middle, where the paths arrive); `anchor.smoke` on the crooked chimney.

Coarse on purpose, like every civic here: the body is one closed plaster prism rather than four
walls with a thickness nobody sees, flat panes are single quads wound to face out (the island
culls back faces), and the bay is an octagon of which only the five facets in front of the wall
are built. The bay's mullions are real posts, because a crease at each corner is what makes a
polygon read as glass and not as a painted drum. At this size a glazing bar, a gold line or a box
in the window is a centimetre or two, so those are flat quads on the glass rather than boxes -
their depth was never more than a pixel - and the dormer and the doorstep went: a dormer between
the gable and the hat left no roof to read, and a step is a solid where anchor.door stands.

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


# The village's palette - the tavern's cream and terracotta, the bakery's oak, the footing stone
# every house stands on - and the shop's own in its front: walnut, midnight blue and gold.
PLASTER = material('wall', 'wandmaker plaster', 0xe8d4ad)
FOOTING = material('stone', 'wandmaker footing', 0x968778)
DRESSED = material('stone', 'wandmaker dressed stone', 0xab9d8b)
TIMBER = material('plank', 'wandmaker timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'wandmaker timber', 0x6a4426)
TILES = material('roof', 'wandmaker tiles', 0xb8552f)
RIDGE_TILES = material('roof', 'wandmaker ridge', 0xc76b3d)
HAT = material('roof', 'wandmaker bay roof', 0x2c3a6e)
WALNUT = material('plank', 'wandmaker walnut', 0x5a3822)
MIDNIGHT = material('plain', 'wandmaker midnight', 0x223066)
GOLD = material('plain', 'wandmaker gold', 0xd9ab3c)
GLASS = material('plain', 'wandmaker window', 0x2b3136)
IRON = material('plain', 'wandmaker iron', 0x2e2f33)
CLAY = material('plain', 'wandmaker chimney pot', 0xa35b3c)
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
WALL = ('-z',)              # a board on the front wall: its back is against the plaster
FOOT = ('-z', '-y')         # and one that also stands on the ground or a sill
POST = ('-z', '-y', '+y')   # and one that butts into a beam at both ends


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=()):
    """A box; `skip` leaves out the faces nobody can see (against a wall, on the ground)."""
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [f for k, f in BOX_FACES.items() if k not in skip], mat)


def beam(part, a, b, t, mat, wide=None, wall=None, ends=True):
    """A timber from a to b, `t` across in the plane it leans in (and `wide` deep, if not square).
    `wall` is the direction of the wall it is fixed to, whose face is left out; without `ends`
    so are its two ends, for a brace that butts into a post and a rail."""
    a, b = Vector(a), Vector(b)
    d = b - a
    yaw = math.atan2(d.x, d.z)
    pitch = math.atan2(d.y, math.hypot(d.x, d.z))
    skip = () if ends else ('-z', '+z')
    if wall is not None:
        across = rotation(-pitch, yaw) @ Vector((1, 0, 0))
        skip += ('+x',) if across.dot(Vector(wall)) > 0 else ('-x',)
    box(part, (a + b) / 2, (wide or t, t, d.length), mat, rx=-pitch, ry=yaw, skip=skip)


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


def side_quad(part, x, z0, z1, y0, y1, mat, s):
    poly(part, [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)], mat, (s, 0, 0))


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


ASSET = bpy.data.collections.new('civic_wandmaker')
bpy.context.scene.collection.children.link(ASSET)

# ---- the measures ----------------------------------------------------------------------
X0, X1, Z0, Z1 = -0.86, 0.86, -0.55, 0.80      # the plaster body; the ridge runs along x
MIDZ = (Z0 + Z1) / 2
EAVES, RIDGE = 0.96, 1.58                      # the tiles' underside at the walls and the ridge
K = (RIDGE - EAVES) / (Z1 - MIDZ)              # rise per unit run of the main roof (0.92, 43 degrees)
TILE_T = 0.035
PLINTH = 0.10                                  # the footing stone the plaster stands on
FAS0, FAS1 = 0.50, 0.585                       # the walnut fascia over the ground floor
DX = 0.06                                      # the door - near the lot's middle, clear of the bay
GX0, GX1 = -0.86, -0.20                        # the jettied gable over the display window
GC, GW = (GX0 + GX1) / 2, (GX1 - GX0) / 2
GZ, GY0 = Z1 + 0.035, FAS1 + 0.016
PEAK = EAVES + GW                              # its pitch is 45 degrees: a touch steeper, not a spire
KC = (PEAK - EAVES) / GW
TX, TZ, TA = X1 - 0.24, Z1, 0.24               # the bay: axis and apothem of its octagon
LX, LZ = -0.16, 1.02                           # the lamp, in the gap between window and door
SX = 0.28                                      # the plane of the hanging sign
HALF = math.tan(math.pi / 8)
BAY_BACK = TZ - TA * HALF                      # where the bay's side facet leaves the side wall


def roof_y(z):
    """The underside of the main roof over the point z, front slope or back."""
    return EAVES + (Z1 - z) * K if z >= MIDZ else RIDGE - (MIDZ - z) * K


# ---- the house: one plaster prism on a stone footing, its back and the chimney ------------
house = Part(ASSET, 'house')
front_quad(house, X0, X1, 0, EAVES, Z1, PLASTER)
back_quad(house, X0, X1, 0, EAVES, Z0, PLASTER)
for x, s in ((X0, -1), (X1, 1)):
    poly(house, [(x, 0, Z0), (x, 0, Z1), (x, EAVES, Z1), (x, EAVES, Z0)], PLASTER, (s, 0, 0))
    poly(house, [(x, EAVES, Z0), (x, EAVES, Z1), (x, RIDGE, MIDZ)], PLASTER, (s, 0, 0))
box(house, (0, PLINTH / 2, MIDZ), (X1 - X0 + 0.024, PLINTH, Z1 - Z0 + 0.024), FOOTING, skip=('-y',))
# Two lit windows upstairs and a plank door at the back, so the house is not a blind box from
# the yard.
for x in (-0.42, 0.42):
    back_quad(house, x - 0.09, x + 0.09, 0.66, 0.88, Z0 - 0.003, GLASS)
    back_quad(house, x - 0.068, x + 0.068, 0.682, 0.858, Z0 - 0.006, WINDOW_GLOW)
box(house, (0.56, 0.18, Z0 - 0.008), (0.17, 0.36, 0.016), WALNUT, skip=('+z', '-y'))
# The chimney on the left party wall behind the ridge, built crooked: the upper stack leans
# off the lower one and its cap sits askew, which is most of what "old" means from the square.
CX, CZ = -0.60, -0.28
box(house, (CX, 1.40, CZ), (0.17, 0.52, 0.15), FOOTING, skip=('-y',))
box(house, (CX + 0.014, 1.72, CZ), (0.16, 0.13, 0.14), FOOTING, rz=-0.11, skip=('-y',))
box(house, (CX + 0.03, 1.795, CZ + 0.006), (0.2, 0.028, 0.18), DRESSED, rz=-0.11, ry=0.08)
PX, PZ = CX + 0.04, CZ - 0.02
column(house, PX, PZ, 1.80, 1.87, 0.028, CLAY, top=SOOT)
house.build()

# ---- the timber frame on the two sides ---------------------------------------------------
# A corner post at either end, one in the middle, the floor rail and the top plate, a chevron of
# braces in the back half and a window in the front half: the tavern's framing, so the side a
# corner lot shows is a framed wall and not a blank one. The right side's front post stands
# behind the bay, whose side facet is where that corner would be.
sides = Part(ASSET, 'sides')
for s in (-1, 1):
    x = s * (X1 + 0.008)
    inner = '-x' if s > 0 else '+x'
    zf = (Z1 if s < 0 else BAY_BACK) - 0.02
    for z in (zf, Z0 + 0.02, MIDZ):
        box(sides, (x, (PLINTH + EAVES) / 2, z), (0.016, EAVES - PLINTH, 0.034), TIMBER, skip=(inner, '-y', '+y'))
    zhi = Z1 if s < 0 else BAY_BACK
    box(sides, (x, FAS1 + 0.012, (Z0 + zhi) / 2), (0.016, 0.028, zhi - Z0), TIMBER_Z, skip=(inner,))
    box(sides, (x, EAVES - 0.016, (Z0 + zhi) / 2), (0.016, 0.032, zhi - Z0), TIMBER_Z, skip=(inner,))
    beam(sides, (x, PLINTH + 0.02, Z0 + 0.045), (x, FAS1 - 0.004, MIDZ - 0.03), 0.024, TIMBER_Z, wide=0.014, wall=(-s, 0, 0), ends=False)
    beam(sides, (x, FAS1 + 0.03, MIDZ - 0.03), (x, EAVES - 0.034, Z0 + 0.045), 0.024, TIMBER_Z, wide=0.014, wall=(-s, 0, 0), ends=False)
    # The window upstairs, and a small one down, both in the front half.
    wz = 0.42
    box(sides, (x, 0.765, wz), (0.016, 0.24, 0.21), TIMBER, skip=(inner,))
    xs = x + s * 0.0085
    side_quad(sides, xs, wz - 0.083, wz + 0.083, 0.667, 0.863, GLASS, s)
    side_quad(sides, xs + s * 0.002, wz - 0.063, wz + 0.063, 0.687, 0.843, WINDOW_GLOW, s)
    side_quad(sides, xs + s * 0.004, wz - 0.007, wz + 0.007, 0.667, 0.863, TIMBER_Z, s)
    box(sides, (x, 0.3, wz), (0.016, 0.2, 0.19), TIMBER, skip=(inner,))
    side_quad(sides, xs, wz - 0.074, wz + 0.074, 0.22, 0.38, GLASS, s)
    side_quad(sides, xs + s * 0.002, wz - 0.054, wz + 0.054, 0.24, 0.36, WINDOW_GLOW, s)
    # The gable above: a king post up the middle and a collar across it.
    box(sides, (x, (EAVES + RIDGE - 0.02) / 2, MIDZ), (0.016, RIDGE - 0.02 - EAVES, 0.03), TIMBER, skip=(inner, '-y'))
    half = (Z1 - MIDZ) * (RIDGE - 1.28) / (RIDGE - EAVES) - 0.02
    box(sides, (x, 1.265, MIDZ), (0.016, 0.03, 2 * half), TIMBER_Z, skip=(inner, '-z', '+z'))
sides.build()

# ---- the roof: the main slopes, cut round the gable, and the gable's own pair ------------
roof = Part(ASSET, 'roof')
DV = TILE_T * math.sqrt(1 + K * K)
OH = 0.07


def slope(x0, x1, za, zb):
    lower = [(x0, roof_y(za), za), (x1, roof_y(za), za), (x1, roof_y(zb), zb), (x0, roof_y(zb), zb)]
    solid(roof, lower, [(x, y + DV, z) for x, y, z in lower], TILES)


slope(GX1, X1 + 0.03, Z1 + OH, MIDZ)            # the front slope right of the gable
slope(X0 - 0.03, GX1, Z1 - 0.04, MIDZ)          # behind the gable; the gable's roof covers the rest
slope(X0 - 0.03, X1 + 0.03, MIDZ, Z0 - OH)      # the back
box(roof, (0, RIDGE + DV + 0.01, MIDZ), (X1 - X0 + 0.08, 0.035, 0.07), RIDGE_TILES, skip=('-y',))


def pitched(xl, xr, xc, ye, yp, zf, zeave, zridge, dv):
    """A little gable roof whose ridge runs along z: two slabs from the front `zf` back into the
    main roof, each cut along its valley (back to `zeave` at the eave, `zridge` at the ridge) so
    no tile hangs out of the main roof behind it."""
    for xe in (xl, xr):
        lower = [(xe, ye, zf), (xc, yp, zf), (xc, yp, zridge), (xe, ye, zeave)]
        solid(roof, lower, [(x, y + dv, z) for x, y, z in lower], TILES)


def valley(y):
    """Where a roof top at height y dives under the main roof's top, as a z."""
    return Z1 - (y - EAVES - DV) / K


DVC = TILE_T * math.sqrt(1 + KC * KC)
CZF = GZ + 0.06                                 # the gable roof's front
pitched(GX0 - 0.03, GX1 + 0.03, GC, EAVES - 0.03 * KC, PEAK, CZF, Z1 - 0.06, valley(PEAK + DVC) - 0.08, DVC)
box(roof, (GC, PEAK + DVC + 0.008, (CZF + valley(PEAK + DVC)) / 2), (0.05, 0.03, CZF - valley(PEAK + DVC)), RIDGE_TILES, skip=('-y',))
roof.build()

# ---- the jettied gable: plaster between oak timbers, standing out over the fascia -------
gable = Part(ASSET, 'gable')
poly(gable, [(GX0, GY0, GZ), (GX1, GY0, GZ), (GX1, EAVES, GZ), (GC, PEAK, GZ), (GX0, EAVES, GZ)], PLASTER, (0, 0, 1))
for x, s in ((GX0, -1), (GX1, 1)):
    poly(gable, [(x, GY0, Z1), (x, GY0, GZ), (x, EAVES, GZ), (x, EAVES, Z1)], PLASTER, (s, 0, 0))
poly(gable, [(GX0, GY0, Z1), (GX1, GY0, Z1), (GX1, GY0, GZ), (GX0, GY0, GZ)], PLASTER, (0, -1, 0))
TZF = GZ + 0.006
box(gable, (GC, GY0 + 0.016, GZ + 0.008), (GX1 - GX0, 0.032, 0.016), TIMBER, skip=WALL)        # the bressumer
box(gable, (GC, EAVES - 0.014, GZ + 0.008), (GX1 - GX0, 0.028, 0.016), TIMBER, skip=WALL)      # the tie beam
for x in (GX0 + 0.017, GX1 - 0.017, GC - 0.145, GC + 0.145):
    box(gable, (x, (GY0 + EAVES + 0.004) / 2, TZF), (0.03 if abs(x - GC) > 0.2 else 0.024, EAVES - GY0 - 0.06, 0.012),
        TIMBER, skip=POST)
for s in (-1, 1):
    beam(gable, (GC + s * (GW - 0.036), GY0 + 0.036, TZF), (GC + s * 0.158, EAVES - 0.03, TZF), 0.022, TIMBER, wide=0.012,
         wall=(0, 0, -1), ends=False)
    # The attic's two posts and, over them, the collar; then barge boards under the tiles.
    box(gable, (GC + s * 0.085, (EAVES + 1.165) / 2, TZF), (0.022, 1.165 - EAVES, 0.012), TIMBER, skip=POST)
    beam(gable, (GC + s * (GW + 0.03), EAVES - 0.03 * KC - 0.02, GZ + 0.045), (GC, PEAK - 0.012, GZ + 0.045), 0.024, TIMBER,
         wall=(0, 0, -1))
box(gable, (GC, 1.178, TZF), (2 * (PEAK - 1.19) / KC, 0.026, 0.012), TIMBER, skip=WALL)
# The upper window, a cross of glazing bars, and the little lit window up in the peak.
front_quad(gable, GC - 0.11, GC + 0.11, 0.655, 0.885, GZ + 0.003, GLASS)
front_quad(gable, GC - 0.088, GC + 0.088, 0.677, 0.863, GZ + 0.006, WINDOW_GLOW)
front_quad(gable, GC - 0.007, GC + 0.007, 0.655, 0.885, GZ + 0.009, TIMBER)
front_quad(gable, GC - 0.11, GC + 0.11, 0.793, 0.807, GZ + 0.009, TIMBER)
box(gable, (GC, 0.645, GZ + 0.016), (0.26, 0.02, 0.032), TIMBER, skip=WALL)
front_quad(gable, GC - 0.05, GC + 0.05, 0.99, 1.15, GZ + 0.003, GLASS)
front_quad(gable, GC - 0.032, GC + 0.032, 1.008, 1.132, GZ + 0.006, WINDOW_GLOW)
front_quad(gable, GC - 0.006, GC + 0.006, 0.99, 1.15, GZ + 0.009, TIMBER)
gable.build()

# ---- the shopfront: fascia, display window, the door and the window over it -------------
shop = Part(ASSET, 'shopfront')
FX1 = TX - TA / math.cos(math.pi / 8) + 0.02     # the fascia runs into the bay, which wraps it on
box(shop, ((X0 + FX1) / 2, (FAS0 + FAS1) / 2, Z1 + 0.014), (FX1 - X0, FAS1 - FAS0, 0.028), WALNUT, skip=WALL)
for y in (FAS0 + 0.012, FAS1 - 0.022):                                   # two gold lines
    front_quad(shop, X0, FX1, y, y + 0.01, Z1 + 0.030, GOLD)
box(shop, ((X0 + FX1) / 2, FAS1 + 0.008, Z1 + 0.022), (FX1 - X0, 0.016, 0.044), WALNUT, skip=WALL)
# The display window between two walnut pilasters with gold capitals, on a midnight stall riser.
WX0, WX1 = -0.78, -0.27
WC = (WX0 + WX1) / 2
for x in (WX0 - 0.03, WX1 + 0.03):
    box(shop, (x, FAS0 / 2, Z1 + 0.018), (0.055, FAS0, 0.036), WALNUT, skip=FOOT)
    box(shop, (x, FAS0 - 0.02, Z1 + 0.02), (0.063, 0.014, 0.04), GOLD, skip=FOOT)
box(shop, (WC, 0.075, Z1 + 0.012), (WX1 - WX0, 0.15, 0.024), MIDNIGHT, skip=FOOT)
box(shop, (WC, 0.162, Z1 + 0.026), (WX1 - WX0 + 0.03, 0.024, 0.052), WALNUT, skip=WALL)
box(shop, (WC, 0.478, Z1 + 0.016), (WX1 - WX0, 0.024, 0.032), WALNUT, skip=WALL)
front_quad(shop, WX0, WX1, 0.174, 0.466, Z1 + 0.003, GLASS)
front_quad(shop, WX0 + 0.02, WX1 - 0.02, 0.19, 0.45, Z1 + 0.006, WINDOW_GLOW)
front_quad(shop, WX0, WX1, 0.372, 0.384, Z1 + 0.009, WALNUT)
for x in (WC - 0.13, WC, WC + 0.13):
    front_quad(shop, x - 0.006, x + 0.006, 0.384, 0.466, Z1 + 0.009, WALNUT)
# The piles of narrow boxes on the sill, dark against the lit pane - the shop's own stock.
# Two teetering towers and a little heap between them, each box a touch askew: a quad each on
# the glass, turned a few degrees in its own plane.
JITTER = (0.0, 0.008, -0.006, 0.01, -0.004)
n = 0
for x, high in ((WC - 0.15, 5), (WC + 0.14, 4), (WC, 2)):
    for i in range(high):
        cx, cy, a = x + JITTER[i], 0.174 + 0.017 * i + 0.0085, 0.05 * JITTER[(i + 2) % 5] / 0.01
        c, sn = math.cos(a), math.sin(a)
        corners = [(cx + u * c - v * sn, cy + u * sn + v * c, Z1 + 0.012) for u, v in ((-0.043, -0.0085), (0.043, -0.0085), (0.043, 0.0085), (-0.043, 0.0085))]
        poly(shop, corners, BOXES[n % len(BOXES)], (0, 0, 1))
        n += 1
# The door: an arched midnight double door in a walnut case, a lit fanlight over it.
DR, DH = 0.13, 0.33
box(shop, (DX, DH / 2, Z1 + 0.008), (2 * DR, DH, 0.016), MIDNIGHT, skip=FOOT)
front_quad(shop, DX - 0.006, DX + 0.006, 0.02, DH - 0.01, Z1 + 0.018, WALNUT)
for s in (-1, 1):
    front_quad(shop, DX + s * 0.03 - 0.009, DX + s * 0.03 + 0.009, 0.18, 0.198, Z1 + 0.019, GOLD)
    box(shop, (DX + s * (DR + 0.017), DH / 2, Z1 + 0.018), (0.034, DH, 0.036), WALNUT, skip=FOOT)
# The fanlight is a fan of four triangles, the lit one inside the dark one.
for r, z, mat in ((DR, Z1 + 0.003, GLASS), (DR - 0.022, Z1 + 0.007, WINDOW_GLOW)):
    for i in range(4):
        a0, a1 = math.pi * i / 4, math.pi * (i + 1) / 4
        poly(shop, [(DX, DH, z), (DX + r * math.cos(a0), DH + r * math.sin(a0), z),
                    (DX + r * math.cos(a1), DH + r * math.sin(a1), z)], mat, (0, 0, 1))
front_quad(shop, DX - 0.006, DX + 0.006, DH, DH + DR - 0.01, Z1 + 0.01, WALNUT)
box(shop, (DX, DH + 0.004, Z1 + 0.014), (2 * DR + 0.01, 0.018, 0.028), WALNUT, skip=WALL)
RI, RO, ZF = DR, DR + 0.032, Z1 + 0.036
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
# The window over the door, and the oak of the upper floor between the gable and the bay: a top
# plate under the eaves and a post either side of the window.
front_quad(shop, DX - 0.1, DX + 0.1, 0.655, 0.885, Z1 + 0.003, GLASS)
front_quad(shop, DX - 0.078, DX + 0.078, 0.677, 0.863, Z1 + 0.006, WINDOW_GLOW)
front_quad(shop, DX - 0.007, DX + 0.007, 0.655, 0.885, Z1 + 0.009, TIMBER)
front_quad(shop, DX - 0.1, DX + 0.1, 0.793, 0.807, Z1 + 0.009, TIMBER)
box(shop, (DX, 0.645, Z1 + 0.016), (0.25, 0.02, 0.032), TIMBER, skip=WALL)
box(shop, ((GX1 + FX1) / 2, EAVES - 0.016, Z1 + 0.008), (FX1 - GX1, 0.032, 0.016), TIMBER, skip=WALL)
for x in (DX - 0.145, DX + 0.145):
    box(shop, (x, (FAS1 + 0.016 + EAVES - 0.032) / 2, Z1 + 0.007), (0.028, EAVES - 0.048 - FAS1, 0.014), TIMBER, skip=POST)
shop.build()

# ---- the bay: a glazed octagon two storeys high, under a pointed hat --------------------
bay = Part(ASSET, 'bay')
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


BAY_TOP = 0.87                                   # the walnut stops, the cornice starts
for k in FACETS:
    facet(k, TA + 0.012, 0, PLINTH + 0.02, FOOTING)
    facet(k, TA, PLINTH + 0.02, BAY_TOP, WALNUT)
    for y0, y1 in ((0.16, 0.47), (0.615, 0.845)):
        facet(k, TA + 0.003, y0, y1, GLASS, inset=0.016)
        facet(k, TA + 0.006, y0 + 0.018, y1 - 0.018, BAY_GLOW, inset=0.03)
    facet(k, TA + 0.026, FAS0, FAS1, WALNUT)       # the fascia, carried round
    facet(k, TA + 0.03, FAS0 + 0.012, FAS0 + 0.022, GOLD)
    facet(k, TA + 0.03, FAS1 - 0.022, FAS1 - 0.012, GOLD)
    facet(k, TA + 0.022, BAY_TOP, 0.925, WALNUT)   # the cornice under the hat, and its gold line
    facet(k, TA + 0.026, 0.885, 0.894, GOLD)
octagon(TA + 0.012, PLINTH + 0.02, FOOTING, (0, 1, 0))
octagon(TA + 0.026, FAS1, WALNUT, (0, 1, 0))
octagon(TA + 0.022, BAY_TOP, WALNUT, (0, -1, 0))
# The mullions at the four corners in front of the wall.
for i in range(1, 5):
    a = math.pi / 8 + (i - 1) * math.pi / 4
    r = (TA + 0.004) / math.cos(math.pi / 8)
    box(bay, (TX + r * math.cos(a), (PLINTH + 0.02 + BAY_TOP) / 2, TZ + r * math.sin(a)), (0.022, BAY_TOP - PLINTH - 0.02, 0.022),
        WALNUT, ry=-a, skip=('-x', '-y', '+y'))
# The hat: a flared skirt kicked out over the cornice, then eight steep facets to a point over
# the ridge, and a gold finial on it. The kick is what turns a cone into a wizard's hat. Its tip
# is the one thing on the building allowed over the chimney, and it stops at 2.06.
HAT_A, HAT_Y, KICK_A, KICK_Y, HAT_TOP = TA + 0.035, 0.915, TA - 0.02, 0.965, 1.90
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
FIN = 1.93
tip = [(TX, 2.06, TZ), (TX, 1.885, TZ)]
mid = [(TX + 0.022 * math.cos(math.pi / 4 + i * math.pi / 2), FIN, TZ + 0.022 * math.sin(math.pi / 4 + i * math.pi / 2)) for i in range(4)]
for i in range(4):
    a, b = Vector(mid[i]), Vector(mid[(i + 1) % 4])
    out = (a + b) / 2 - Vector((TX, FIN, TZ))
    poly(bay, [a, b, tip[0]], GOLD, out + Vector((0, 0.2, 0)))
    poly(bay, [a, b, tip[1]], GOLD, out - Vector((0, 0.2, 0)))
bay.build()

# ---- the lamp beside the door ---------------------------------------------------------
# Taller than a settler (0.55), so its light is over their heads, and in the gap between the
# window's pilaster and the door's case, clear of the way in.
lamp = Part(ASSET, 'lamp')
box(lamp, (LX, 0.02, LZ), (0.045, 0.04, 0.045), IRON, skip=('-y',))
column(lamp, LX, LZ, 0.04, 0.50, 0.011, IRON, sides=5)
q = lambda h, y: [(LX - h, y, LZ - h), (LX + h, y, LZ - h), (LX + h, y, LZ + h), (LX - h, y, LZ + h)]
solid(lamp, q(0.019, 0.50), q(0.028, 0.58), LAMP_GLOW)
cap = q(0.037, 0.58)
for i in range(4):
    a, b = Vector(cap[i]), Vector(cap[(i + 1) % 4])
    poly(lamp, [a, b, (LX, 0.628, LZ)], IRON, (a + b) / 2 - Vector((LX, 0.58, LZ)) + Vector((0, 0.03, 0)))
poly(lamp, cap, IRON, (0, -1, 0))
lamp.build()

# ---- the sign: a curly iron bracket and a midnight board with a wand on it ---------------
# The board hangs from 0.64, over a settler's head, so it is a sign and not a post to walk round.
sign = Part(ASSET, 'sign')
ARM_Y, ARM_Z = 0.90, Z1 + 0.26
box(sign, (SX, 0.845, Z1 + 0.005), (0.03, 0.13, 0.01), IRON, skip=WALL)
box(sign, (SX, ARM_Y, (Z1 + ARM_Z) / 2), (0.012, 0.012, ARM_Z - Z1), IRON, skip=WALL)
ribbon(sign, [(0.795, Z1 + 0.008), (0.838, Z1 + 0.05), (0.874, Z1 + 0.11), (ARM_Y - 0.006, Z1 + 0.16)], SX, 0.01, 0.01, IRON)
ribbon(sign, [(ARM_Y, ARM_Z - 0.006), (ARM_Y + 0.02, ARM_Z + 0.016), (ARM_Y - 0.004, ARM_Z + 0.024)], SX, 0.01, 0.009, IRON)
BY0, BY1, BZ0, BZ1 = 0.64, 0.81, Z1 + 0.07, Z1 + 0.25
for z in (BZ0 + 0.03, BZ1 - 0.03):
    box(sign, (SX, (BY1 + ARM_Y) / 2, z), (0.005, ARM_Y - BY1, 0.005), IRON, skip=('-y', '+y'))
BYC, BZC = (BY0 + BY1) / 2, (BZ0 + BZ1) / 2
box(sign, (SX, BYC, BZC), (0.014, BY1 - BY0, BZ1 - BZ0), GOLD)
box(sign, (SX, BYC, BZC), (0.022, BY1 - BY0 - 0.018, BZ1 - BZ0 - 0.018), MIDNIGHT)
# The wand, through the board so it shows on both faces: handle low at the front, tip up by
# the wall, where the gold spark is.
HND = Vector((0, BYC - 0.05, BZC + 0.057))
TIP = Vector((0, BYC + 0.045, BZC - 0.045))
d = (TIP - HND)
ang = math.atan2(-d.y, d.z)
L = d.length
u = d.normalized()
box(sign, (SX, *(HND + u * (0.03 + L / 2 - 0.015))[1:]), (0.03, 0.008, L - 0.03), WAND, rx=ang)
box(sign, (SX, *(HND + u * 0.021)[1:]), (0.034, 0.013, 0.042), HANDLE, rx=ang)
box(sign, (SX, *(HND + u * 0.045)[1:]), (0.035, 0.016, 0.008), GOLD, rx=ang)
for s in (-1, 1):
    x = SX + s * 0.018
    ty, tz = TIP.y + 0.008, TIP.z - 0.008
    for size, thin, turn in ((0.034, 0.009, 0.0), (0.019, 0.006, math.pi / 4)):
        for a in (turn, turn + math.pi / 2):
            cy, cz = math.sin(a), math.cos(a)
            poly(sign, [(x, ty + cy * size, tz + cz * size), (x, ty - cz * thin, tz + cy * thin),
                        (x, ty - cy * size, tz - cz * size), (x, ty + cz * thin, tz - cy * thin)], GOLD, (s, 0, 0))
sign.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((PX, 1.89, PZ))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((DX, 0, Z1 + 0.1))
ASSET.objects.link(door)

# The set's height is its highest point - the tip of the bay's finial, over the chimney pot -
# which is where the island hangs a label over it.
bpy.context.scene['building_height'] = round(max(TOPS), 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'wandmaker.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'wandmaker'})
