"""The tea room. Rebuild with scripts/blender.mjs --background --python scripts/build-tearoom.py.

A tea room on a corner of the square (Plans/knus-dorpscentrum.md): a pale cream stone ground floor
wrapped in round-topped windows - three either side of the door and two round each corner -
framed in sage green; a sage door under an arched fanlight; above it a jettied upper floor of
cream plaster in oak timber, window boxes of flowers under its three windows, and a terracotta
roof with one gable over the door and a crooked brick chimney on the ridge. Beside the door a
white teapot with a gold band hangs from a curly iron bracket, and out front two little white
iron café tables each have two chairs.

It is drawn at the village's own size, not the terrace's: the first version filled its whole 3x3
lot (2.9 across, 3.45 tall under slate) and stood on the square like a hotel beside the tavern
(1.80 x 1.57 x 1.69) and the bakery. So the walls run x -0.87..+0.87 and z -0.55..+0.80, the
eaves are at 0.96, the ridge at 1.58 and the chimney pot stops under 1.9; the door is 0.27 wide
and 0.45 tall over its footing, and the roof is the tavern's pitch (43 degrees) in the
tavern's terracotta, with oak rather than near-black timber - the colours of the houses around
it, with only the paint of the shopfront its own. The café tables stay within z 1.16 and |x| 0.82.

One civic asset, `civic_tearoom` (budget 1500), and nothing that moves. The door is in the middle
of the front, because that is where the island's paths arrive, and the tables stand either side
of it so the doorway stays clear. `anchor.door` is at its foot, `anchor.smoke` on the chimney pot.

Every window is a dark pane with a smaller emissive shape just in front of it, as in
build-bakery.py: dark by day with a lit middle, and the middle is what glows at night. Here the
shapes are arches - an n-gon of a rectangle and a half circle, six segments round the top, which
is the fewest that still reads as round rather than as a bell - so that after dark the ground
floor is a row of warm round-topped lights, which is the one thing that says "tea room" from the
far side of the square. The arches are flat layers a few millimetres apart (sage frame, dark
glass, glow) rather than recesses: a solid box has no hole to put a window in, and at island
distance a recess of a hand's depth is invisible while its triangles are not. The leading that
crossed each pane and the gold teacup on a board over the door went at this size: a bar under a
centimetre wide is a flicker, and the teapot is the sign.

The house is solid boxes rather than wall slabs: nobody looks into it, and a box is twelve
triangles where four walls are forty-eight. Timber that is only ever seen from the front is drawn
without the faces that lie against the plaster. The teapot is the one round thing that is turned
on a lathe (eight sides, which is where most of its triangles go), because it is the sign and has
to read as a teapot and not as a ball; the spout points along the street so its silhouette shows
from the front, and it hangs from the upper floor with its foot at 0.59, over a settler's head
(WALK_CLEARANCE 0.55), so it is a sign and never a post to walk round. Written in island
coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/tearoom'
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


# The palette is the village's - the bakery's cream plaster and oak, the tavern's terracotta and
# brick - with this shop's own colour in the paint: sage green, with cream stone and gold beside it.
STONE = material('stone', 'tearoom cream stone', 0xe6d7b8)
FOOTING = material('stone', 'tearoom footing', 0x968778)
PLASTER = material('wall', 'tearoom plaster', 0xf0e2c4)
TIMBER = material('plank', 'tearoom timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'tearoom timber', 0x6a4426)
TILES = material('roof', 'tearoom tiles', 0xb8552f)
RIDGE_TILES = material('roof', 'tearoom ridge', 0xc76b3d)
BRICK = material('stone', 'tearoom chimney', 0x9c5a44)
POT = material('plain', 'tearoom chimney pot', 0xa35b3c)
SOOT = material('plain', 'tearoom soot', 0x1f1b18)
SAGE = material('plank', 'tearoom sage paint', 0x86a27f)
SAGE_Z = material('plankZ', 'tearoom sage paint', 0x86a27f)
SAGE_DARK = material('plank', 'tearoom sage door', 0x5e7c5c)
SAGE_FLAT = material('plain', 'tearoom sage frame', 0x86a27f)
GOLD = material('plain', 'tearoom gold', 0xd8ab44)
GLASS = material('plain', 'tearoom window', 0x2b3136)
GLOW = material('plain', 'tearoom lit window', 0xffd88a, emissive=True)
CHINA = material('plain', 'tearoom china', 0xf7f2e7)
IRON = material('plain', 'tearoom iron', 0x2e2f33)
CAFE = material('plain', 'tearoom white iron', 0xf2f0ea)
LEAVES = material('plain', 'tearoom leaves', 0x5b8b3b)
FLOWERS = [material('plain', f'tearoom flower {n}', c)
           for n, c in (('pink', 0xec7fa0), ('red', 0xd9483e), ('yellow', 0xf4cb4b), ('white', 0xf7f3ea))]


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


# A box's six faces by name, in the order hexa() lays them down, so a caller can leave out the
# ones that lie against a wall or inside another box.
FACES = {'back': [0, 3, 2, 1], 'front': [4, 5, 6, 7], 'bottom': [0, 1, 5, 4],
         'top': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 4, 7, 3]}


def hexa(part, pts, mat, omit=()):
    """Eight corners in box order: (-,-,-) (+,-,-) (+,+,-) (-,+,-) then the same at +z."""
    part.add(pts, [f for k, f in FACES.items() if k not in omit], mat)


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, omit=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    hexa(part, [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
                for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
                                (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))], mat, omit)


class Wall:
    """A wall's own frame: u along it (left to right seen from outside), v up, n out of it."""
    def __init__(self, origin, u, n):
        self.o, self.u, self.v, self.n = Vector(origin), Vector(u), Vector((0, 1, 0)), Vector(n)

    def at(self, u, v, d=0.0):
        return self.o + self.u * u + self.v * v + self.n * d

    def u_of(self, p):
        return (Vector(p) - self.o).dot(self.u)


def wpoly(part, wall, pts, d, mat):
    """A flat face on a wall, `d` out from it, its 2D outline counter-clockwise from outside."""
    part.add([wall.at(u, v, d) for u, v in pts], [list(range(len(pts)))], mat)


def rect(u0, v0, u1, v1):
    return [(u0, v0), (u1, v0), (u1, v1), (u0, v1)]


def wbox(part, wall, u0, u1, v0, v1, d0, d1, mat, omit=('back',)):
    """A box standing on a wall; the face against the wall is left out unless asked for."""
    hexa(part, [wall.at(u, v, d) for u, v, d in ((u0, v0, d0), (u1, v0, d0), (u1, v1, d0), (u0, v1, d0),
                                                 (u0, v0, d1), (u1, v0, d1), (u1, v1, d1), (u0, v1, d1))],
         mat, omit)


def wbar(part, wall, a, b, w, d0, d1, mat, ends=True):
    """A strip from a to b (wall coordinates), w wide: a brace, a glazing bar, a stroke of gold.
    A brace butts into the rails at both ends, so it can go without its end faces."""
    a, b = Vector((a[0], a[1])), Vector((b[0], b[1]))
    t = (b - a).normalized()
    s = Vector((-t.y, t.x)) * (w / 2)
    q = [a - s, b - s, b + s, a + s]
    if d1 - d0 < 1e-6:
        wpoly(part, wall, [(p.x, p.y) for p in q], d0, mat)
        return
    hexa(part, [wall.at(p.x, p.y, d) for d in (d0, d1) for p in q], mat,
         omit=('back',) if ends else ('back', 'left', 'right'))


def arch(cu, v0, spring, r, segs=5):
    """A round-topped outline: the two bottom corners, then the half circle from right to left."""
    return [(cu - r, v0), (cu + r, v0)] + [(cu + r * math.cos(math.pi * k / segs), spring + r * math.sin(math.pi * k / segs))
                                           for k in range(segs + 1)]


def half_disc(cu, spring, r, segs=5):
    return [(cu + r * math.cos(math.pi * k / segs), spring + r * math.sin(math.pi * k / segs)) for k in range(segs + 1)]


def tube(part, a, b, r1, r2, mat, sides=6, cap_a=None, cap_b=None, phase=0.0):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c, r: [c + (u * math.cos(2 * math.pi * i / sides + phase) + v * math.sin(2 * math.pi * i / sides + phase)) * r
                         for i in range(sides)]
    part.add(ring(a, r1) + ring(b, r2), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if cap_a:
        part.add(ring(a, r1), [list(range(sides))[::-1]], cap_a)
    if cap_b:
        part.add(ring(b, r2), [list(range(sides))], cap_b)


def rod(part, a, b, r, mat, sides=3):
    tube(part, a, b, r, r, mat, sides)


def cone(part, base, apex, r, mat, sides=5):
    base, apex = Vector(base), Vector(apex)
    d = (apex - base).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = [base + (u * math.cos(2 * math.pi * i / sides) + v * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)]
    part.add(ring + [apex], [[i, (i + 1) % sides, sides] for i in range(sides)], mat)


def lathe(part, cx, cz, rings, mats, sides=8, bottom=None, top=None):
    """A turned shape round a vertical axis: rings of (y, r), one material per band between them."""
    pts = [(cx + math.cos(2 * math.pi * k / sides) * r, y, cz + math.sin(2 * math.pi * k / sides) * r)
           for y, r in rings for k in range(sides)]
    for j, mat in enumerate(mats):
        part.add(pts, [[j * sides + (i + 1) % sides, j * sides + i, (j + 1) * sides + i, (j + 1) * sides + (i + 1) % sides]
                       for i in range(sides)], mat)
    if bottom:
        part.add(pts[:sides], [list(range(sides))], bottom)
    if top:
        part.add(pts[-sides:], [list(range(sides))[::-1]], top)


def tet(part, c, s, mat, phase=0.0):
    """A flower: four triangles standing on their point, so what shows from above is a flat head
    of colour. The right way up they read as a row of little party hats."""
    c = Vector(c)
    head = [c + Vector((s * math.cos(phase + 2 * math.pi * k / 3), 0.3 * s, s * math.sin(phase + 2 * math.pi * k / 3)))
            for k in range(3)]
    part.add(head + [c - Vector((0, s, 0))], [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]], mat)


def strip(part, a, b, w, across, mat):
    """One quad from a to b, w wide along `across`: a chair leg of bent iron, seen from any side."""
    a, b, h = Vector(a), Vector(b), Vector(across).normalized() * (w / 2)
    part.add([a - h, b - h, b + h, a + h], [[0, 1, 2, 3]], mat)


def strap(part, x, curve, w, mat):
    """Flat strap iron bent on edge in the plane x = const: a band of quads along a (z, y) curve.
    Its flat faces look along the street, which is how a sign bracket is forged and seen; from
    straight ahead it is a line, which is all a real one is from there too."""
    pts = [Vector((0, y, z)) for z, y in curve]
    out = []
    for i, p in enumerate(pts):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        n = Vector((0, -t.z, t.y)) * (w / 2)
        out.append((p - n, p + n))
    verts = [Vector((x, 0, 0)) + q for pair in out for q in pair]
    part.add(verts, [[2 * i, 2 * i + 2, 2 * i + 3, 2 * i + 1] for i in range(len(pts) - 1)], mat)


ASSET = bpy.data.collections.new('civic_tearoom')
bpy.context.scene.collection.children.link(ASSET)

# ---- the measurements ---------------------------------------------------------------------
# The ground floor is a touch narrower and shallower than the floor above it, which leans out
# over the pavement on a beam (a jetty): XG/ZG below, XU/ZU above. XR is the roof's reach.
XG, XU, XR = 0.84, 0.87, 0.92
ZB, ZG, ZU = -0.55, 0.755, 0.80
FOOT = 0.035
BEAM0, BEAM1 = 0.52, 0.575         # the jetty beam the upper floor stands on
GF = 0.53
EAVES, RIDGE = 0.96, 1.58
TOP = 0.925                        # the underside of the top plate under the eaves
ZM, HALF = (ZU + ZB) / 2, (ZU - ZB) / 2
SLOPE = (RIDGE - EAVES) / HALF     # 0.92, so the pitch is 43 degrees: the tavern's 0.57 over 0.62
OV, T = 0.08, 0.035                # the roof's overhang, and the tiles' thickness
CX, CROSS = 0.38, 1.34             # the front gable's half width and the height of its ridge (45)
CZ = ZU + 0.02                     # its face, a hair proud of the wall below it

FRONT_G = Wall((0, 0, ZG), (1, 0, 0), (0, 0, 1))
FRONT_U = Wall((0, 0, ZU), (1, 0, 0), (0, 0, 1))
GABLE = Wall((0, 0, CZ), (1, 0, 0), (0, 0, 1))
BACK = Wall((0, 0, ZB), (-1, 0, 0), (0, 0, -1))
SIDES_G = [Wall((XG, 0, 0), (0, 0, -1), (1, 0, 0)), Wall((-XG, 0, 0), (0, 0, 1), (-1, 0, 0))]
SIDES_U = [Wall((XU, 0, 0), (0, 0, -1), (1, 0, 0)), Wall((-XU, 0, 0), (0, 0, 1), (-1, 0, 0))]

# ---- the house ----------------------------------------------------------------------------
body = Part(ASSET, 'body')
box(body, (0, GF / 2, (ZB + ZG) / 2), (2 * XG, GF, ZG - ZB), STONE, omit=('bottom', 'top'))
box(body, (0, FOOT / 2, (ZB + ZG) / 2), (2 * XG + 0.03, FOOT, ZG - ZB + 0.03), FOOTING, omit=('bottom',))
box(body, (0, (GF + EAVES) / 2, (ZB + ZU) / 2), (2 * XU, EAVES - GF, ZU - ZB), PLASTER, omit=('bottom', 'top'))
# The jetty: a beam along the front and one down each side, closing the gap under the overhang.
# The front one is the shop's fascia, painted sage with a gold line along it, which is what ties
# the arched windows and the door together into one shopfront.
FZ = ZU + 0.01
box(body, (0, (BEAM0 + BEAM1) / 2, (ZG + FZ) / 2), (2 * XU + 0.02, BEAM1 - BEAM0, FZ - ZG), SAGE, omit=('back', 'top'))
wpoly(body, Wall((0, 0, FZ), (1, 0, 0), (0, 0, 1)), rect(-XU - 0.01, 0.541, XU + 0.01, 0.553), 0.002, GOLD)
for s in (-1, 1):
    box(body, (s * (XG + XU + 0.01) / 2, (BEAM0 + BEAM1) / 2, (ZB + ZU) / 2),
        (XU + 0.01 - XG, BEAM1 - BEAM0, ZU - ZB), TIMBER_Z, omit=('top', 'left' if s > 0 else 'right'))
# The gable ends, the plaster triangles under the roof at either side.
for wall in SIDES_U:
    wpoly(body, wall, [(wall.u_of((0, 0, z)), y) for z, y in ((ZU, EAVES), (ZB, EAVES), (ZM, RIDGE))][::1 if wall.u.z < 0 else -1], 0, PLASTER)
# The front gable's triangle.
wpoly(body, GABLE, [(-CX, EAVES), (CX, EAVES), (0, CROSS)], 0, PLASTER)
body.build()

# ---- the roof -----------------------------------------------------------------------------
roof = Part(ASSET, 'roof')


def main_slab(xa, xb, front, overhang=True, omit=()):
    """One pitch between ridge and eave, bottom face on the line from the ridge to the wall top.
    The face along the ridge is never drawn: it lies against the other pitch, under the cap."""
    ov = OV if overhang else 0.0
    ze = (ZU + ov) if front else (ZB - ov)
    ye = EAVES - SLOPE * ov
    if not front:
        xa, xb = xb, xa            # keep the corners right-handed, so the faces face out
    pts = []
    for z, y in ((ZM, RIDGE), (ze, ye)):
        pts += [(xa, y, z), (xb, y, z), (xb, y + T, z), (xa, y + T, z)]
    hexa(roof, pts, TILES, omit=('back',) + tuple(omit))


# The front pitch is cut in three round the front gable: its middle stops at the wall, where
# the gable's own roof takes over, or its overhang would run across the gable's foot.
main_slab(-XR, -CX, True)
main_slab(-CX, CX, True, overhang=False, omit=('left', 'right'))
main_slab(CX, XR, True)
main_slab(-XR, XR, False)
box(roof, (0, RIDGE + T + 0.01, ZM), (2 * XR + 0.02, 0.04, 0.07), RIDGE_TILES, omit=('bottom',))
# The front gable's roof: two pitches from its ridge down to the main eave line, running back
# until they are lost inside the main roof.
GZF, GZB = ZU + OV + 0.01, 0.25
for s in (-1, 1):
    zs = (GZB, GZF) if s > 0 else (GZF, GZB)
    pts = []
    for z in zs:
        pts += [(0, CROSS, z), (s * CX, EAVES, z), (s * CX, EAVES + T, z), (0, CROSS + T, z)]
    # Left out: the face along its ridge (against the other pitch) and its far end, buried in
    # the main roof.
    hexa(roof, pts, TILES, omit=('left', 'back' if s > 0 else 'front'))
GZR = ZU - (CROSS - EAVES) / SLOPE     # where the gable's ridge meets the main roof
box(roof, (0, CROSS + T + 0.008, (GZR + GZF) / 2), (0.055, 0.035, GZF - GZR), RIDGE_TILES, omit=('bottom',))
# The chimney: brick like the tavern's, on the ridge near the left gable, leaning a little the
# way old ones do. The pot is the tallest thing on the building and stops under 1.9.
CHX, CHZ, CHY0, CHY1, LEAN = -0.55, ZM - 0.02, 1.38, 1.78, 0.04
cm = rotation(rx=-0.03, rz=LEAN)
ch_c = Vector((CHX, (CHY0 + CHY1) / 2, CHZ))
box(roof, ch_c, (0.15, CHY1 - CHY0, 0.16), BRICK, rx=-0.03, rz=LEAN, omit=('bottom',))
ch_top = ch_c + cm @ Vector((0, (CHY1 - CHY0) / 2, 0))
box(roof, ch_top + Vector((0, 0.012, 0)), (0.19, 0.03, 0.2), FOOTING, rx=-0.04, rz=LEAN + 0.03, omit=('bottom',))
pot0 = ch_top + Vector((0.02, 0.025, 0.0))
pot1 = pot0 + Vector((-0.005, 0.06, 0))
tube(roof, pot0, pot1, 0.034, 0.028, POT, sides=6, cap_b=SOOT)
roof.build()

# ---- the timber frame ---------------------------------------------------------------------
frame = Part(ASSET, 'timber')
for x in (-XU + 0.02, XU - 0.02):
    for z in (ZU - 0.02, ZB + 0.02):
        inside = ('left' if x > 0 else 'right', 'back' if z > 0 else 'front')   # in the plaster
        box(frame, (x, (BEAM1 + EAVES) / 2, z), (0.045, EAVES - BEAM1, 0.045), TIMBER, omit=('bottom', 'top') + inside)
# The front of the upper floor: posts at the gable's corners, a sill rail under the windows, a
# top plate under the eaves, and a steep brace in every narrow panel beside a window.
SILL_RAIL = (0.615, 0.64)
wbox(frame, FRONT_U, -XU - 0.004, XU + 0.004, TOP, EAVES, 0, 0.018, TIMBER)
wbox(frame, FRONT_U, -XU, XU, *SILL_RAIL, 0, 0.014, TIMBER, omit=('back', 'left', 'right'))
for x in (-CX, CX):
    wbox(frame, FRONT_U, x - 0.018, x + 0.018, BEAM1, TOP, 0, 0.016, TIMBER, omit=('back', 'top', 'bottom'))
UPPER = [-0.62, 0.0, 0.62]         # the three windows upstairs
WIN_W = 0.095
for x0, x1 in ((-XU + 0.043, UPPER[0] - WIN_W), (UPPER[0] + WIN_W, -CX - 0.018), (-CX + 0.018, -WIN_W)):
    for a, b in (((x0 + 0.012, SILL_RAIL[1]), (x1 - 0.012, TOP)), ((-x0 - 0.012, SILL_RAIL[1]), (-x1 + 0.012, TOP))):
        wbar(frame, FRONT_U, a, b, 0.03, 0, 0.012, TIMBER, ends=False)
# The sides: a post in the middle, a sill rail and a top plate, and one brace in the long back
# panel, so a corner lot shows a framed gable and not a blank one.
for wall in SIDES_U:
    um = wall.u_of((0, 0, ZM))
    u_front, u_back = wall.u_of((0, 0, ZU)), wall.u_of((0, 0, ZB))
    lo, hi = min(u_front, u_back), max(u_front, u_back)
    wbox(frame, wall, um - 0.018, um + 0.018, BEAM1, TOP, 0, 0.016, TIMBER_Z, omit=('back', 'top', 'bottom'))
    wbox(frame, wall, lo, hi, TOP, EAVES, 0, 0.018, TIMBER_Z)
    wbox(frame, wall, lo, hi, *SILL_RAIL, 0, 0.014, TIMBER_Z, omit=('back', 'left', 'right'))
    ub = wall.u_of((0, 0, ZB + 0.05))
    wbar(frame, wall, (ub, SILL_RAIL[1]), (um + (0.03 if ub < um else -0.03), TOP), 0.03, 0, 0.012, TIMBER_Z, ends=False)
    # The gable above: a king post up the middle and a collar across it.
    wbox(frame, wall, um - 0.016, um + 0.016, EAVES, RIDGE - 0.02, 0, 0.014, TIMBER_Z, omit=('back', 'bottom'))
    half = HALF * (RIDGE - 1.28) / (RIDGE - EAVES) - 0.02
    wbox(frame, wall, um - half, um + half, 1.25, 1.28, 0, 0.014, TIMBER_Z, omit=('back', 'left', 'right'))
# The back: its top plate, enough that the eaves line runs all the way round.
wbox(frame, BACK, -XU - 0.004, XU + 0.004, TOP, EAVES, 0, 0.018, TIMBER)
# The front gable: oak barge boards tucked under the front edge of its roof, a collar and a
# short king post. On the gable's face instead, a board stuck out past the tiles at its foot
# and read from three-quarters as a stick poking out of the roof.
BW = 0.035
for s in (-1, 1):
    # Half a board's width in from the roof's edge, so its top edge lies along the tiles.
    down = Vector((-s * (CROSS - EAVES), -CX)).normalized() * (BW / 2)
    a, b = Vector((s * CX, EAVES)) + down, Vector((0, CROSS)) + down
    wbar(frame, GABLE, (a.x, a.y), (b.x, b.y), BW, GZF - CZ - 0.028, GZF - CZ - 0.004, TIMBER)
cy0, cy1 = 1.19, 1.215
chalf = CX * (CROSS - cy1) / (CROSS - EAVES)
wbox(frame, GABLE, -chalf, chalf, cy0, cy1, 0, 0.014, TIMBER)
wbox(frame, GABLE, -0.016, 0.016, cy1, CROSS - 0.03, 0, 0.014, TIMBER, omit=('back', 'bottom'))
frame.build()

# ---- the shopfront ------------------------------------------------------------------------
shop = Part(ASSET, 'shopfront')
SILL, SPRING = 0.10, 0.33
PR, GR, LR = 0.085, 0.066, 0.05    # the frame's, the glass's and the glow's half width


def light(part, wall, cu):
    """One round-topped window: sage frame, dark glass and the lit middle."""
    wpoly(part, wall, arch(cu, SILL, SPRING, PR), 0.004, SAGE_FLAT)
    wpoly(part, wall, arch(cu, SILL + 0.018, SPRING, GR), 0.008, GLASS)
    wpoly(part, wall, arch(cu, SILL + 0.034, SPRING, LR), 0.012, GLOW)


FRONT_LIGHTS = [0.325, 0.53, 0.735]
for s in (-1, 1):
    for x in FRONT_LIGHTS:
        light(shop, FRONT_G, s * x)
    wbox(shop, FRONT_G, *sorted((s * 0.225, s * 0.835)), SILL - 0.024, SILL, 0, 0.032, SAGE, omit=('back', 'bottom'))
# Round each corner: two more on each side wall, close to the front.
for wall in SIDES_G:
    us = [wall.u_of((0, 0, z)) for z in (0.57, 0.36)]
    for u in us:
        light(shop, wall, u)
    wbox(shop, wall, min(us) - 0.1, max(us) + 0.1, SILL - 0.024, SILL, 0, 0.032, SAGE_Z, omit=('back', 'bottom'))
# The door: sage, under an arched fanlight, in a sage frame that stands out from the stone. It is
# 0.27 by 0.45 over the footing, its frame's crown a hair under the fascia - a door of the
# village's size, which is what makes the building read as a shop in that village rather than
# the same drawing enlarged.
DR, DRO, DSP, DB = 0.135, 0.165, 0.35, FOOT
wbox(shop, FRONT_G, -DR, DR, DB, DSP, 0, 0.012, SAGE_DARK)
wpoly(shop, FRONT_G, half_disc(0, DSP, DR), 0.005, GLASS)
wpoly(shop, FRONT_G, half_disc(0, DSP, DR - 0.022), 0.009, GLOW)
wbox(shop, FRONT_G, -DR, DR, DSP - 0.01, DSP + 0.01, 0, 0.02, SAGE)
for u0, u1 in ((-DR + 0.024, -0.008), (0.008, DR - 0.024)):
    wpoly(shop, FRONT_G, rect(u0, 0.08, u1, 0.30), 0.014, SAGE)
inner = [(-DR, DB)] + [(DR * math.cos(math.pi - math.pi * k / 5), DSP + DR * math.sin(math.pi - math.pi * k / 5)) for k in range(6)] + [(DR, DB)]
outer = [(-DRO, DB)] + [(DRO * math.cos(math.pi - math.pi * k / 5), DSP + DRO * math.sin(math.pi - math.pi * k / 5)) for k in range(6)] + [(DRO, DB)]
DF = 0.024
for k in range(len(inner) - 1):
    wpoly(shop, FRONT_G, [inner[k], inner[k + 1], outer[k + 1], outer[k]], DF, SAGE_FLAT)
for k in range(len(outer) - 1):
    a, b = outer[k], outer[k + 1]
    shop.add([FRONT_G.at(a[0], a[1], 0), FRONT_G.at(b[0], b[1], 0), FRONT_G.at(b[0], b[1], DF), FRONT_G.at(a[0], a[1], DF)],
             [[0, 1, 2, 3]], SAGE_FLAT)
cone(shop, FRONT_G.at(0.095, 0.19, 0.012), FRONT_G.at(0.095, 0.19, 0.03), 0.012, GOLD, sides=4)
# No doorstep: a shop is walked round part by part (APART in buildings.js), so a step would be a
# solid of its own right where anchor.door is, and the porch the island sets every shop on is
# the step already.
shop.build()

# ---- upstairs -----------------------------------------------------------------------------
up = Part(ASSET, 'upstairs')


def window(part, wall, cu, v0=0.655, v1=0.885, w=WIN_W):
    """A casement: an oak frame, the pane, its lit middle, and a mullion and transom over it."""
    wbox(part, wall, cu - w, cu + w, v0, v1, 0, 0.02, TIMBER, omit=('back', 'bottom'))
    wpoly(part, wall, rect(cu - w + 0.022, v0 + 0.022, cu + w - 0.022, v1 - 0.022), 0.022, GLASS)
    wpoly(part, wall, rect(cu - w + 0.042, v0 + 0.042, cu + w - 0.042, v1 - 0.042), 0.025, GLOW)
    wbar(part, wall, (cu, v0 + 0.022), (cu, v1 - 0.022), 0.014, 0.028, 0.028, TIMBER)
    wbar(part, wall, (cu - w + 0.022, v0 + 0.15), (cu + w - 0.022, v0 + 0.15), 0.013, 0.028, 0.028, TIMBER)


def flower_box(part, wall, cu, k0):
    wbox(part, wall, cu - 0.12, cu + 0.12, 0.588, 0.636, 0, 0.052, SAGE, omit=('back', 'bottom'))
    wbox(part, wall, cu - 0.105, cu + 0.105, 0.636, 0.654, 0.008, 0.046, LEAVES, omit=('back', 'bottom', 'left', 'right'))
    for k, du in enumerate((-0.07, 0.0, 0.07)):
        tet(part, wall.at(cu + du, 0.66, 0.027 + 0.008 * ((k + k0) % 2)), 0.024, FLOWERS[(k + k0) % 4], phase=0.7 * k)


for k, x in enumerate(UPPER):
    window(up, FRONT_U, x)
    flower_box(up, FRONT_U, x, k)
for wall in SIDES_U:
    window(up, wall, wall.u_of((0, 0, 0.46)))
window(up, BACK, BACK.u_of((0.4, 0, 0)))
# The attic light in the front gable: a small arch, under the collar.
wpoly(up, GABLE, arch(0, 0.99, 1.08, 0.065), 0.004, TIMBER)
wpoly(up, GABLE, arch(0, 1.006, 1.08, 0.048), 0.008, GLASS)
wpoly(up, GABLE, arch(0, 1.02, 1.08, 0.034), 0.012, GLOW)
up.build()

# ---- the teapot on its bracket ------------------------------------------------------------
tea = Part(ASSET, 'teapot')
# The pot's axis, the height of its foot and its scale: a sign is bigger than the thing it
# means, and it hangs off the upper floor so its foot is over head height (WALK_CLEARANCE 0.55).
TX, TZ, TB, K = 0.27, ZU + 0.21, 0.595, 0.8
ARM_Y, ARM_Z1 = 0.748, ZU + 0.30
rod(tea, (TX, ARM_Y, ZU + 0.008), (TX, ARM_Y, ARM_Z1), 0.008, IRON, sides=4)
# The ironwork that holds the arm up, as strap: a quarter round from the wall out to the arm, a
# scroll curled up inside it, and a curl at the arm's tip.
Z0 = ZU + 0.004
quarter = [(Z0 + 0.16 * math.sin(math.pi / 2 * k / 5), ARM_Y + 0.16 * math.cos(math.pi / 2 * k / 5)) for k in range(6)]
strap(tea, TX, quarter, 0.012, IRON)
scroll = [(Z0 + 0.067 + (0.045 - 0.006 * k) * math.cos(math.radians(-90 + 62 * k)),
           ARM_Y + 0.051 + (0.045 - 0.006 * k) * math.sin(math.radians(-90 + 62 * k))) for k in range(6)]
strap(tea, TX, scroll, 0.01, IRON)
tip = [(ARM_Z1 - 0.016 + (0.029 - 0.0045 * k) * math.cos(math.radians(-55 + 68 * k)),
        ARM_Y + 0.024 + (0.029 - 0.0045 * k) * math.sin(math.radians(-55 + 68 * k))) for k in range(5)]
strap(tea, TX, tip, 0.009, IRON)
P = lambda dx, dy: (TX + dx * K, TB + dy * K, TZ)
rings = [(TB + y * K, r * K) for y, r in ((0, 0.052), (0.028, 0.083), (0.058, 0.092), (0.074, 0.092), (0.12, 0.04))]
lathe(tea, TX, TZ, rings, [CHINA, CHINA, GOLD, CHINA], sides=8, bottom=CHINA, top=CHINA)
cone(tea, P(0, 0.12), P(0, 0.148), 0.022 * K, GOLD)
rod(tea, P(0, 0.148), (TX, ARM_Y, TZ), 0.004, IRON)
tube(tea, P(0.07, 0.036), P(0.172, 0.126), 0.024 * K, 0.011 * K, CHINA, sides=5)
handle = [P(-0.078, 0.1), P(-0.138, 0.098), P(-0.142, 0.042), P(-0.082, 0.028)]
for a, b in zip(handle, handle[1:]):
    rod(tea, a, b, 0.013 * K, CHINA)
tea.build()

# ---- the café tables ----------------------------------------------------------------------
# One part per table, and that is load-bearing: the island walks round a shop by the rectangle
# of each baked part, and one part holding both tables was one rectangle from table to table,
# straight across the doorway.
TABLE_Z, TERRACE = 1.08, []
for side, tx in (('left', -0.62), ('right', 0.62)):
    cafe = Part(ASSET, f'terrace {side}')
    # The top is a hexagon and nothing else: its edge, a centimetre thick at this size, is under
    # a pixel from anywhere a camera stands.
    cafe.add([(tx + 0.075 * math.cos(math.pi * k / 3), 0.15, TABLE_Z + 0.075 * math.sin(math.pi * k / 3)) for k in range(6)][::-1],
             [list(range(6))], CAFE)
    rod(cafe, (tx, 0.016, TABLE_Z), (tx, 0.15, TABLE_Z), 0.009, CAFE)
    tube(cafe, (tx, 0.0, TABLE_Z), (tx, 0.022, TABLE_Z), 0.042, 0.011, CAFE, sides=4)
    # The chairs are bent iron, and drawn as it: a seat, a back and four legs that are one quad
    # each, the legs turned corner-wise. Each chair is swung a little towards the wall, so it
    # looks out over its table at the street - and so its back is not edge-on from the front,
    # where a flat back would vanish and leave four legs.
    for a in (math.radians(-25), math.radians(205)):
        o, p = Vector((math.cos(a), 0, math.sin(a))), Vector((-math.sin(a), 0, math.cos(a)))
        c, SEAT = Vector((tx, 0, TABLE_Z)) + o * 0.15, 0.092
        at = lambda do, dp, y=SEAT: c + o * do + p * dp + Vector((0, y, 0))
        ring = lambda r, y, degs: [at(r * math.cos(math.radians(g)), r * math.sin(math.radians(g)), y) for g in degs]
        cafe.add(ring(0.048, SEAT, range(0, 360, 60))[::-1], [list(range(6))], CAFE)
        # A bistro chair's back is a hoop round the seat's far side: three quads, so there is
        # no side from which it is edge-on and gone.
        hoop = (-72, -24, 24, 72)
        cafe.add(ring(0.046, SEAT, hoop) + ring(0.058, SEAT + 0.1, hoop), [[k, k + 1, 5 + k, 4 + k] for k in range(3)], CAFE)
        for do in (-0.038, 0.038):
            for dp in (-0.038, 0.038):
                leg = o * do + p * dp
                strip(cafe, at(do * 1.12, dp * 1.12, 0.0), at(do, dp), 0.011, (-leg.z, 0, leg.x), CAFE)
    cafe.build()
    TERRACE.append(cafe)

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(pot1 + Vector((0, 0.02, 0)))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZG + 0.10))
ASSET.objects.link(door)

# The tallest thing is the chimney pot, and the scene says so rather than a guess at it.
top = max(v.y for p in (body, roof, frame, shop, up, tea, *TERRACE) for v in p.verts)
bpy.context.scene['building_height'] = round(top, 2)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'tearoom.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'tearoom'})
