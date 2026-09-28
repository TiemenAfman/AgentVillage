"""The chronicle house. Rebuild with scripts/blender.mjs --background --python scripts/build-chronicle.py.

The last rung of the ladder (Plans/mijlpalen-tot-tweehonderd.md, rung 200; Plans/kroniekhuis.md):
the building where the village writes down its own history, and the one that opens the chronicle
the bar at the bottom of the screen already is. So it is the island's museum and archive in the
Dutch classicist manner of a seventeenth-century town's weigh house or its Mauritshuis: a brick
hall on a sandstone plinth, pale stone pilasters at the corners and a pale entablature all round,
a portico of four columns under a pediment in front, tall round-headed windows on every side, a
hipped terracotta roof, and on its ridge an octagonal lantern under a patina dome carrying a bronze
armillary sphere. In the tympanum, in bronze, an open book with a quill across it - the one sign
the island needs to say what the building is for, since no board on the island carries letters.

Why it is the size it is. It is the capstone, so it has to read as the grandest thing in town
short of the town hall, and it must not outgrow the town hall: that one is 1.93 across, 1.56 deep
and 2.91 to the top of its finial as baked (web/js/townhall-mesh.js, measured when this was
written). So this is 1.91 across the corners of its eaves, 1.55 deep from the back eave to the
front of the pediment, and 2.44 to the top of the sphere; tests/chronicle.test.mjs holds all
three under the town hall's. The hall is one tall storey rather than two ordinary ones - a reading room, not a
house - with its walls 0.90 high above the plinth (3.6 m), columns 0.90 tall, a door 0.26 wide
with its leaves 0.48 high and a fanlight over them (the town hall's door recess is 0.48 by 0.72;
a settler is 0.43), and window openings 0.55 tall. The lantern stands 0.28 clear of the ridge,
which is what makes it a lantern and not a chimney pot, and the sphere is 0.30 across, which is
as small as a ring can be and still be seen from where the island is usually looked at.

It has no step of its own in front of the portico: the civic porch buildings.js puts under it
is already two courses in front of the portico's floor, and a third made the house 1.63 deep,
deeper than the town hall. For the same reason the hall is 1.07 deep and the pediment's tiles
stand only 0.01 proud of its cornice: at 1.10 and 0.02 it measured 1.60.

The brick is the village's own (0x9c5a44 on the school's base and the chapel), the roof the
tavern's terracotta (0xb8552f) with its lighter ridge, and the patina the town hall's dome
(0x4f7d6a), so it belongs to the same town; what is its own is the pale sandstone, which is what
says "classical" from across the square, and the bronze.

One civic asset, `civic_chronicle` (budget 1500), and nothing in it moves. The front faces +z:
the brick front at z = 0.50, the columns at 0.74, the front of the portico's floor at 0.86 -
behind the 0.96 that keeps the door cell clear for a walker (tests/chronicle.test.mjs).
`anchor.door` is at the foot of the portico; there is no smoke anchor, because an archive is the one building in town that
keeps its fire away from its paper.

Why the shapes are what they are:
  - The portico's middle pair of columns stands 0.36 apart, wider than the outer pairs (0.27),
    so the door is seen whole between them from straight in front: at an even 0.30 the gap
    between two shafts would be narrower than the door.
  - The pediment's roof runs back into the main roof and the lantern's drum until its ridge is
    under the tiles, rather than stopping at the wall: stopped at the wall, its ridge would stand
    out of the main pitch as a step with nothing under it.
  - The main roof is one closed solid (four pitches and their ridge) on a thin eave board, not
    four pitches with a thickness each: nobody sees the inside of a hipped roof, and the eave
    board is the only edge of it that shows.
  - The book is flat bronze on the pale tympanum, like the library's sign: in relief it would
    cost as much as a window and read no better from the square. The lines on its pages are not
    letters, only the suggestion of writing, and the quill says the book is still being written.
  - The sphere's three rings are tubes with a three-sided section: a flat band seen edge-on
    disappears, and a four-sided one costs a third more for nothing anybody can tell apart.
    They are the meridian, the horizon and the equator, and not the ecliptic a real one also
    has: the equator is seen edge-on exactly when the meridian is seen face-on, and an ecliptic
    23.5 degrees off the equator is edge-on with it, so the first cut showed one ring and two
    lines from the front-right. The horizon reads as a ring from anywhere above it, and of the
    other two there is always one that is open; the whole instrument is turned 30 degrees about
    the vertical so that from the front it is both.
  - Faces nobody can see - the back of anything against the brick, the underside of anything
    standing on the ground, the tops of what the roof or the cornice closes over - are left off
    (`drop`), which is what pays for the nine windows within the budget.
  - Every solid is wound outward (`solid` turns each face away from its middle): the island
    draws buildings front-face only, and the torus of a ring is not convex, so the rings and the
    windows' reveals are wound against their own centre line instead (`tube`).
Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/chronicle'
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


BRICK = material('stone', 'chronicle brick', 0x9c5a44)
PLINTH = material('stone', 'chronicle plinth', 0xa99d86)
SANDSTONE = material('stone', 'chronicle sandstone', 0xd9cba9)
CORNICE = material('plain', 'chronicle cornice', 0xe4d8bb)
TILES = material('roof', 'chronicle tiles', 0xb8552f)
RIDGE_TILE = material('roof', 'chronicle ridge', 0xc76b3d)
PATINA = material('plain', 'chronicle patina', 0x4f7d6a)
BRONZE = material('plain', 'chronicle bronze', 0x9a6d34)
GILT = material('plain', 'chronicle gilt pages', 0xd9b867)
QUILL = material('plain', 'chronicle quill', 0xf1ead8)
GLOBE = material('plain', 'chronicle globe', 0x3f6f8a)
DOOR = material('plank', 'chronicle door', 0x4a2e1c)
STILE = material('plain', 'chronicle door stile', 0x2e1c10)
BRASS = material('plain', 'chronicle brass', 0xc9a044)
IRON = material('plain', 'chronicle iron', 0x343638)
GLASS = material('plain', 'chronicle window', 0x2b3036)
GLOW = material('plain', 'chronicle lit window', 0xffd488, emissive=True)


def newell(pts):
    """A polygon's normal by Newell's rule: counter-clockwise seen from where it points."""
    n = Vector((0, 0, 0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


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

    def solid(self, points, faces, mat):
        """A convex solid (or some of its faces), every face turned away from its middle."""
        pts = [Vector(p) for p in points]
        mid = sum(pts, Vector()) / len(pts)
        out = []
        for f in faces:
            fp = [pts[i] for i in f]
            centre = sum(fp, Vector()) / len(fp)
            out.append(list(f) if newell(fp).dot(centre - mid) >= 0 else list(f)[::-1])
        self.add(pts, out, mat)

    def flat(self, points, normal, mat):
        """One planar polygon facing `normal`: a pane, a painted face."""
        pts = [Vector(p) for p in points]
        f = list(range(len(pts)))
        self.add(pts, [f if newell(pts).dot(Vector(normal)) >= 0 else f[::-1]], mat)

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


# A box's faces, and the names `drop` leaves them off by (in the box's own frame).
BOX_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
FACE = {'back': 0, 'front': 1, 'bottom': 2, 'top': 3, 'right': 4, 'left': 5}
CORNERS = ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))
BACK, FRONT, BOTTOM, TOP, RIGHT, LEFT = 'back', 'front', 'bottom', 'top', 'right', 'left'


def span(part, lo, hi, mat, drop=()):
    """An axis-aligned box from one corner to the other: most of a building is these."""
    pts = [Vector([(l if s < 0 else h) for s, l, h in zip(c, lo, hi)]) for c in CORNERS]
    part.solid(pts, [f for i, f in enumerate(BOX_FACES) if i not in {FACE[d] for d in drop}], mat)


def beam(part, a, b, width, depth, mat, side=(0, 0, 1), ends=True, back=True):
    """A timber from a to b: `depth` along `side`, `width` across both. `ends=False` for one
    whose ends are buried in what it joins; `back=False` for one lying on something at -side."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    s = Vector(side)
    s = (s - d * s.dot(d)).normalized()
    u = d.cross(s).normalized()
    ring = lambda p: [p + s * (i * depth / 2) + u * (j * width / 2) for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6]]
    if back:
        faces.append([3, 0, 4, 7])
    if ends:
        faces += [[0, 1, 2, 3], [4, 5, 6, 7]]
    part.solid(ring(a) + ring(b), faces, mat)


def extrude(part, base, vec, mat, caps=(True, True)):
    """A convex outline pushed along `vec`, with or without the cap it started from and the
    one it ends at: a reveal on a wall has neither the first nor, under a roof, the last."""
    n = len(base)
    base = [Vector(p) for p in base]
    top = [p + Vector(vec) for p in base]
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    if caps[0]:
        faces.append(list(range(n)))
    if caps[1]:
        faces.append(list(range(n, 2 * n)))
    part.solid(base + top, faces, mat)


def pitch(part, corners, t, mat, hide=()):
    """A roof pitch from the four corners of its underside (one plane), `t` thick upwards.
    `hide` names the edges (by the corner they start from, 0..3) whose face nobody sees."""
    corners = [Vector(c) for c in corners]
    n = newell(corners).normalized()
    if n.y < 0:
        n = -n
    edges = {0: 2, 1: 4, 2: 3, 3: 5}       # corner i -> the BOX_FACES side from corner i to i+1
    part.solid(corners + [c + n * t for c in corners], [f for i, f in enumerate(BOX_FACES) if i not in {edges[e] for e in hide}], mat)


def frustum(part, a, b, r0, r1, mat, sides=8, caps=(False, False)):
    """A round shaft from a (radius r0) to b (radius r1): a column tapers, a rod does not."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c, r: [c + (u * math.cos(2 * math.pi * (i + 0.5) / sides) + v * math.sin(2 * math.pi * (i + 0.5) / sides)) * r for i in range(sides)]
    faces = [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)]
    if caps[0]:
        faces.append(list(range(sides)))
    if caps[1]:
        faces.append(list(range(sides, 2 * sides)))
    part.solid(ring(a, r0) + ring(b, r1), faces, mat)


def tube(part, centre, normal, radius, r, mat, segs=12, sides=3, frame=None):
    """A ring of `radius` about `centre` in the plane square to `normal`, as a tube of `sides`
    round a section of radius `r`. Not convex, so every quad is wound outward from the tube's
    own centre line rather than from the middle of the whole thing, which `solid` would do and
    which would turn the inside of the ring inside out."""
    c = Vector(centre)
    n = Vector(normal).normalized()
    ref = Vector((0, 1, 0)) if abs(n.y) < 0.9 else Vector((1, 0, 0))
    u = n.cross(ref).normalized(); v = n.cross(u).normalized()
    pts, faces = [], []
    for i in range(segs):
        a = 2 * math.pi * i / segs
        radial = u * math.cos(a) + v * math.sin(a)
        for j in range(sides):
            b = 2 * math.pi * j / sides
            pts.append(c + radial * radius + (radial * math.cos(b) + n * math.sin(b)) * r)
    for i in range(segs):
        i2 = (i + 1) % segs
        a = 2 * math.pi * (i + 0.5) / segs
        spine = c + (u * math.cos(a) + v * math.sin(a)) * radius
        for j in range(sides):
            j2 = (j + 1) % sides
            f = [i * sides + j, i2 * sides + j, i2 * sides + j2, i * sides + j2]
            fp = [pts[k] for k in f]
            mid = sum(fp, Vector()) / 4
            faces.append(f if newell(fp).dot(mid - spine) >= 0 else f[::-1])
    part.add(pts, faces, mat)


def ball(part, centre, r, mat, segs=6, bands=3):
    """A low sphere: a pole, `bands - 1` rings, a pole. Convex, so `solid` winds it."""
    c = Vector(centre)
    pts = [c + Vector((0, -r, 0))]
    for k in range(1, bands):
        phi = math.pi * k / bands - math.pi / 2
        for i in range(segs):
            a = 2 * math.pi * (i + 0.5 * (k % 2)) / segs
            pts.append(c + Vector((math.cos(phi) * math.cos(a), math.sin(phi), math.cos(phi) * math.sin(a))) * r)
    pts.append(c + Vector((0, r, 0)))
    faces = [[0, 1 + (i + 1) % segs, 1 + i] for i in range(segs)]
    for k in range(bands - 2):
        lo, hi = 1 + k * segs, 1 + (k + 1) * segs
        for i in range(segs):
            faces.append([lo + i, lo + (i + 1) % segs, hi + (i + 1) % segs])
            faces.append([lo + i, hi + (i + 1) % segs, hi + i])
    top = len(pts) - 1
    last = 1 + (bands - 2) * segs
    faces += [[last + i, last + (i + 1) % segs, top] for i in range(segs)]
    part.solid(pts, faces, mat)


def octagon(cx, cz, r, y, turn=math.pi / 8):
    """Eight corners about (cx, cz) at height y. With the default turn the faces, not the
    corners, face the four axes - so a window put on 'the front face' is square to the front."""
    return [(cx + r * math.cos(turn + math.pi * k / 4), y, cz + r * math.sin(turn + math.pi * k / 4)) for k in range(8)]


class Wall:
    """A wall face as a frame: `origin` on the face, `along` it horizontally, `out` of it. A
    window is drawn once in (u, y, d) and put on any of the four faces through this."""
    def __init__(self, origin, along, out):
        self.o, self.u, self.n = Vector(origin), Vector(along), Vector(out)

    def at(self, u, y, d=0.0):
        return self.o + self.u * u + Vector((0, y, 0)) + self.n * d

    def outline(self, pts, d):
        return [self.at(u, y, d) for u, y in pts]

    def box(self, part, u0, u1, y0, y1, d0, d1, mat, drop=()):
        pts = [self.at(u0 if cu < 0 else u1, y0 if cy < 0 else y1, d0 if cd < 0 else d1) for cu, cy, cd in CORNERS]
        part.solid(pts, [f for i, f in enumerate(BOX_FACES) if i not in {FACE[x] for x in drop}], mat)


def arch(cx, y0, spring, half, segs=4):
    """A round-headed opening in (u, y): square foot, semicircular head. Four segments to the
    half circle: at 0.2 across a fifth and sixth were never seen."""
    pts = [(cx - half, y0), (cx + half, y0)]
    pts += [(cx + half * math.cos(math.pi * k / segs), spring + half * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
    return pts


def half_disc(cx, spring, half, segs=4):
    return [(cx + half * math.cos(math.pi * k / segs), spring + half * math.sin(math.pi * k / segs)) for k in range(segs + 1)]


def rect(u0, y0, u1, y1):
    return [(u0, y0), (u1, y0), (u1, y1), (u0, y1)]


ASSET = bpy.data.collections.new('civic_chronicle')
bpy.context.scene.collection.children.link(ASSET)

# The hall. X is its half width, ZB its back and ZF its brick front; P the top of the plinth
# it stands on, WT the top of the brick, where the pale entablature starts.
X, ZB, ZF = 0.86, -0.57, 0.50
P, WT = 0.10, 1.00
ARCH_TOP, CORNICE_TOP = 1.10, 1.16      # architrave and frieze, then the cornice over them
EAVE = 1.19                             # the underside of the tiles: the eave board is between
RIDGE = 1.54
ROOF_X, ROOF_ZB, ROOF_ZF = 0.94, -0.65, 0.58
ZC = (ROOF_ZB + ROOF_ZF) / 2            # the ridge, and the lantern standing on it
RIDGE_HALF = ROOF_X - (ROOF_ZF - ROOF_ZB) / 2
# The portico: its columns, where they stand, how far it reaches.
COLUMNS = (-0.45, -0.18, 0.18, 0.45)
ZCOL = 0.74
PX = 0.56                               # the portico's entablature, either side of the middle
PZ = 0.82                               # and its front
FRONT_EDGE = 0.86                       # the front of the portico's floor, and of the house

house = Part(ASSET, 'house')
# The plinth, a course of darker stone the whole hall stands on.
span(house, (-X - 0.03, 0, ZB - 0.03), (X + 0.03, P, ZF + 0.03), PLINTH, drop=(BOTTOM,))
# The brick, one box: every opening in it is a frame standing proud of the face.
span(house, (-X, P, ZB), (X, WT, ZF), BRICK, drop=(BOTTOM, TOP))
# Sandstone pilasters up the four corners, 0.10 on the front or back and 0.12 round the side.
for sx in (-1, 1):
    for sz, z0, z1 in ((1, ZF - 0.11, ZF + 0.015), (-1, ZB - 0.015, ZB + 0.11)):
        xa, xb = sorted((sx * (X - 0.09), sx * (X + 0.015)))
        inner = (LEFT if sx > 0 else RIGHT, BACK if sz > 0 else FRONT)
        span(house, (xa, P, z0), (xb, WT, z1), SANDSTONE, drop=(BOTTOM, TOP) + inner)
# The entablature all round, and the cornice over it that the roof sits on.
span(house, (-X - 0.02, WT, ZB - 0.02), (X + 0.02, ARCH_TOP, ZF + 0.02), SANDSTONE, drop=(BOTTOM, TOP))
span(house, (-X - 0.07, ARCH_TOP, ZB - 0.07), (X + 0.07, CORNICE_TOP, ZF + 0.07), CORNICE, drop=(TOP,))

# The windows. Every one is the same round-headed opening in a sandstone surround, with a
# keystone and a sill: a dark pane and, just in front of it, the lit one that glows after dark,
# crossed by a mullion and a transom. The ones beside the portico are narrower, because there
# is only 0.21 of brick between the portico and the corner pilaster.
Y0, SPRING = 0.25, 0.72


def window(wall, cu, half):
    open_half, lit_half = half - 0.02, half - 0.034
    extrude(house, wall.outline(arch(cu, Y0 - 0.015, SPRING, half), 0), wall.n * 0.022, SANDSTONE, caps=(False, True))
    house.flat(wall.outline(arch(cu, Y0, SPRING, open_half), 0.024), wall.n, GLASS)
    house.flat(wall.outline(arch(cu, Y0 + 0.015, SPRING, lit_half), 0.027), wall.n, GLOW)
    house.flat(wall.outline(rect(cu - 0.007, Y0 + 0.01, cu + 0.007, SPRING + open_half), 0.03), wall.n, SANDSTONE)
    house.flat(wall.outline(rect(cu - lit_half, 0.52, cu + lit_half, 0.534), 0.03), wall.n, SANDSTONE)
    wall.box(house, cu - 0.024, cu + 0.024, SPRING + half - 0.03, SPRING + half + 0.035, 0, 0.034, SANDSTONE, drop=(BACK, BOTTOM))
    wall.box(house, cu - half - 0.015, cu + half + 0.015, Y0 - 0.045, Y0 - 0.015, 0, 0.045, SANDSTONE, drop=(BACK, BOTTOM))


FRONT_WALL = Wall((0, 0, ZF), (1, 0, 0), (0, 0, 1))
BACK_WALL = Wall((0, 0, ZB), (-1, 0, 0), (0, 0, -1))
RIGHT_WALL = Wall((X, 0, 0), (0, 0, -1), (1, 0, 0))
LEFT_WALL = Wall((-X, 0, 0), (0, 0, 1), (-1, 0, 0))
for s in (-1, 1):
    window(FRONT_WALL, s * 0.675, 0.078)
for cu in (-0.48, 0, 0.48):
    window(BACK_WALL, cu, 0.1)
# Along each side, centred on the hall's middle (z = -0.035); `along` runs the other way on
# the two sides, so the same two offsets land on the same two places on each.
for wall, sign in ((RIGHT_WALL, -1), (LEFT_WALL, 1)):
    for z in (-0.255, 0.185):
        window(wall, sign * z, 0.1)

# The door: a round-headed sandstone frame, two dark oak leaves with a stile between them and
# brass knobs, a lit fanlight over a stone transom.
DOOR_HALF, DOOR_SPRING = 0.13, 0.58
extrude(house, FRONT_WALL.outline(arch(0, P, DOOR_SPRING, DOOR_HALF + 0.04), 0), (0, 0, 0.03), SANDSTONE, caps=(False, True))
house.flat(FRONT_WALL.outline(rect(-DOOR_HALF, P, DOOR_HALF, DOOR_SPRING), 0.032), (0, 0, 1), DOOR)
house.flat(FRONT_WALL.outline(half_disc(0, DOOR_SPRING + 0.012, DOOR_HALF - 0.012), 0.032), (0, 0, 1), GLOW)
house.flat(FRONT_WALL.outline(rect(-DOOR_HALF, DOOR_SPRING - 0.004, DOOR_HALF, DOOR_SPRING + 0.014), 0.034), (0, 0, 1), SANDSTONE)
house.flat(FRONT_WALL.outline(rect(-0.006, P, 0.006, DOOR_SPRING - 0.004), 0.034), (0, 0, 1), STILE)
for s in (-1, 1):
    house.flat(FRONT_WALL.outline(rect(s * 0.022 - 0.009, 0.33, s * 0.022 + 0.009, 0.348), 0.036), (0, 0, 1), BRASS)
# Two lanterns either side of the door, on iron brackets, lighting the portico after dark.
for s in (-1, 1):
    x = s * 0.285
    span(house, (x - 0.006, 0.575, ZF), (x + 0.006, 0.587, ZF + 0.045), IRON, drop=(BACK,))
    span(house, (x - 0.025, 0.49, ZF + 0.02), (x + 0.025, 0.565, ZF + 0.07), GLOW)
    span(house, (x - 0.033, 0.565, ZF + 0.012), (x + 0.033, 0.585, ZF + 0.078), IRON)
house.build()

# ---- the portico ---------------------------------------------------------------------------
portico = Part(ASSET, 'portico')
# Its floor is the plinth carried forward.
span(portico, (-PX - 0.02, 0, ZF + 0.03), (PX + 0.02, P, FRONT_EDGE), PLINTH, drop=(BOTTOM, BACK))
for x in COLUMNS:
    span(portico, (x - 0.06, P, ZCOL - 0.06), (x + 0.06, P + 0.035, ZCOL + 0.06), SANDSTONE, drop=(BOTTOM,))
    frustum(portico, (x, P + 0.035, ZCOL), (x, 0.955, ZCOL), 0.044, 0.037, SANDSTONE)
    span(portico, (x - 0.056, 0.955, ZCOL - 0.056), (x + 0.056, WT, ZCOL + 0.056), CORNICE, drop=(TOP,))
# Pilasters on the brick behind the outer pair, as a real portico's antae are.
for x in (COLUMNS[0], COLUMNS[-1]):
    span(portico, (x - 0.05, P, ZF), (x + 0.05, WT, ZF + 0.03), SANDSTONE, drop=(BACK, BOTTOM, TOP))
# The entablature it carries - its underside is the portico's ceiling - and the cornice.
span(portico, (-PX, WT, ZF), (PX, ARCH_TOP, PZ), SANDSTONE, drop=(BACK, TOP))
span(portico, (-PX - 0.04, ARCH_TOP, ZF), (PX + 0.04, CORNICE_TOP, PZ + 0.04), CORNICE, drop=(BACK,))
portico.build()

# ---- the roof, the pediment and the book -------------------------------------------------
roof = Part(ASSET, 'roof')
# The eave board, then the hipped roof as one closed solid over it.
span(roof, (-ROOF_X, CORNICE_TOP, ROOF_ZB), (ROOF_X, EAVE, ROOF_ZF), TILES, drop=(TOP,))
e = [(-ROOF_X, EAVE, ROOF_ZF), (ROOF_X, EAVE, ROOF_ZF), (ROOF_X, EAVE, ROOF_ZB), (-ROOF_X, EAVE, ROOF_ZB)]
r = [(-RIDGE_HALF, RIDGE, ZC), (RIDGE_HALF, RIDGE, ZC)]
roof.solid(e + r, [[0, 1, 5, 4], [2, 3, 4, 5], [3, 0, 4], [1, 2, 5]], TILES)
# Ridge and hips in the lighter tile, lying on the edges they cover.
span(roof, (-RIDGE_HALF - 0.02, RIDGE - 0.015, ZC - 0.035), (RIDGE_HALF + 0.02, RIDGE + 0.03, ZC + 0.035), RIDGE_TILE, drop=(BOTTOM,))
for (ex, _, ez), (rx, _, rz) in ((e[0], r[0]), (e[1], r[1]), (e[2], r[1]), (e[3], r[0])):
    a, b = Vector((ex, EAVE, ez)), Vector((rx, RIDGE, rz))
    lift = Vector((0, 0.012, 0))
    beam(roof, a + lift, b + lift, 0.038, 0.03, RIDGE_TILE, side=(0, 1, 0), ends=False, back=False)

# The pediment. Its raking cornice runs from the ends of the portico's cornice to the apex; the
# tympanum is set back behind it, and its tiles lie on it and run back until they are under the
# main roof and inside the lantern's drum.
APEX = 1.43
FOOT_X = PX + 0.05
SLOPE = (APEX - CORNICE_TOP) / FOOT_X
TYMP_Z = PZ - 0.02
lift = 0.025 / math.cos(math.atan(SLOPE))     # half the raking cornice's height, measured upright
roof.flat([(-PX - 0.01, CORNICE_TOP, TYMP_Z), (PX + 0.01, CORNICE_TOP, TYMP_Z), (0, APEX - lift - 0.002, TYMP_Z)], (0, 0, 1), SANDSTONE)
for s in (-1, 1):
    beam(roof, (s * FOOT_X, CORNICE_TOP, TYMP_Z + 0.03), (0, APEX, TYMP_Z + 0.03), 0.05, 0.06, CORNICE, back=False)
TOP_OF_RAKE = APEX + lift
PITCH_T = 0.035
for s in (-1, 1):
    fx = s * (FOOT_X + 0.03)
    fy = TOP_OF_RAKE - (FOOT_X + 0.03) * SLOPE
    pitch(roof, [(fx, fy, PZ + 0.05), (0, TOP_OF_RAKE, PZ + 0.05), (0, TOP_OF_RAKE, 0.0), (fx, fy, 0.0)], PITCH_T, TILES, hide=(1, 2))
ridge_y = TOP_OF_RAKE + PITCH_T / math.cos(math.atan(SLOPE))
span(roof, (-0.025, ridge_y - 0.02, 0.05), (0.025, ridge_y + 0.02, PZ + 0.03), RIDGE_TILE, drop=(BOTTOM,))
# A plain sandstone block on the apex, where a classical front puts its acroterion. It comes
# down over the joint of the two raking cornices and out past the tiles, because square-ended
# they leave a notch at the apex, and the pitches' dark undersides showed through it.
span(roof, (-0.035, APEX - 0.035, TYMP_Z - 0.005), (0.035, TOP_OF_RAKE + 0.075, PZ + 0.06), CORNICE)

# The book, in bronze on the tympanum: a cover showing round two gilt pages whose inner edges dip
# to the spine, a few engraved lines on each page, and a quill lying across the right-hand one.
# As wide as the tympanum lets it be: its outer corners are what meet the raking cornice first,
# so it sits low, a hair over the horizontal cornice, and grows sideways rather than up.
BY, BZ, BW = 1.18, TYMP_Z, 0.17
for s in (-1, 1):
    cover = [(s * 0.004, BY - 0.01), (s * BW, BY + 0.006), (s * BW, BY + 0.108), (s * 0.004, BY + 0.088)]
    roof.flat([(x, y, BZ + 0.003) for x, y in cover], (0, 0, 1), BRONZE)
    page = [(s * 0.012, BY), (s * (BW - 0.013), BY + 0.014), (s * (BW - 0.013), BY + 0.098), (s * 0.012, BY + 0.08)]
    roof.flat([(x, y, BZ + 0.006) for x, y in page], (0, 0, 1), GILT)
    for k in range(3):
        y_in, y_out = BY + 0.028 + k * 0.02, BY + 0.04 + k * 0.02
        line = [(s * 0.03, y_in - 0.0035), (s * (BW - 0.035), y_out - 0.0035), (s * (BW - 0.035), y_out + 0.0035), (s * 0.03, y_in + 0.0035)]
        roof.flat([(x, y, BZ + 0.008) for x, y in line], (0, 0, 1), BRONZE)
# Its tip stops short of the raking cornice, which the tympanum narrows under towards the foot.
quill = [(0.03, BY + 0.028), (0.045, BY + 0.021), (0.2, BY + 0.112), (0.18, BY + 0.122)]
roof.flat([(x, y, BZ + 0.011) for x, y in quill], (0, 0, 1), QUILL)
roof.build()

# ---- the lantern and the armillary sphere ------------------------------------------------
lantern = Part(ASSET, 'lantern')
DRUM_R, DRUM_Y0, DRUM_Y1 = 0.19, 1.40, 1.82
extrude(lantern, octagon(0, ZC, DRUM_R, DRUM_Y0), (0, DRUM_Y1 - DRUM_Y0, 0), SANDSTONE, caps=(False, False))
# A lit slit in every face, so the lantern is a lantern after dark from any side.
face_d = DRUM_R * math.cos(math.pi / 8) + 0.003
for k in range(8):
    a = math.pi * k / 4
    out = Vector((math.cos(a), 0, math.sin(a)))
    along = Vector((-math.sin(a), 0, math.cos(a)))
    c = Vector((0, 0, ZC)) + out * face_d
    lantern.flat([c + along * du + Vector((0, y, 0)) for du, y in ((-0.026, 1.6), (0.026, 1.6), (0.026, 1.76), (-0.026, 1.76))], out, GLOW)
extrude(lantern, octagon(0, ZC, 0.225, DRUM_Y1), (0, 0.04, 0), CORNICE)
# The dome: four eight-sided rings closed at the top, in the town hall's patina.
rings = [(0.205, DRUM_Y1 + 0.04), (0.19, 1.93), (0.145, 2.0), (0.07, 2.05)]
v = []
for rr, yy in rings:
    v.extend(octagon(0, ZC, rr, yy))
v.append((0, 2.07, ZC))
faces = []
for j in range(len(rings) - 1):
    for i in range(8):
        a, b = j * 8 + i, j * 8 + (i + 1) % 8
        faces.append([a, b, b + 8, a + 8])
top = len(v) - 1
for i in range(8):
    faces.append([(len(rings) - 1) * 8 + i, (len(rings) - 1) * 8 + (i + 1) % 8, top])
lantern.solid(v, faces, PATINA)
# A bronze stem and collar, and on it the sphere: the meridian ring standing on the collar, the
# horizon ring round its middle, the equator square to the polar axis, a rod for the axis and
# the earth in the middle.
SPH_R, SPH_T = 0.14, 0.013
STEM_TOP = 2.13
C = Vector((0, STEM_TOP + SPH_R + SPH_T, ZC))
frustum(lantern, (0, 2.05, ZC), (0, STEM_TOP - 0.012, ZC), 0.024, 0.018, BRONZE, sides=6)
frustum(lantern, (0, STEM_TOP - 0.014, ZC), (0, STEM_TOP + 0.004, ZC), 0.042, 0.03, BRONZE, sides=6, caps=(True, True))
turn = Matrix.Rotation(math.radians(-30), 3, 'Y')
tilt = math.radians(38)                       # how far the polar axis leans from upright
along = turn @ Vector((1, 0, 0))              # the meridian's plane is `along` and upright
axis = (along * math.sin(tilt) + Vector((0, 1, 0)) * math.cos(tilt)).normalized()
tube(lantern, C, turn @ Vector((0, 0, 1)), SPH_R, SPH_T, BRONZE)
tube(lantern, C, (0, 1, 0), SPH_R, SPH_T, BRONZE)
tube(lantern, C, axis, SPH_R * 0.9, SPH_T * 0.9, BRONZE)
frustum(lantern, C - axis * (SPH_R + 0.03), C + axis * (SPH_R + 0.03), 0.007, 0.007, BRONZE, sides=4, caps=(True, True))
ball(lantern, C, 0.045, GLOBE)
lantern.build()

door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, FRONT_EDGE))
ASSET.objects.link(door)

# The tallest thing the set holds, which is the top of the sphere: nameplates float above it.
top = max((p.origin + vv).y for p in (house, portico, roof, lantern) for vv in p.verts)
bpy.context.scene['building_height'] = round(top + 0.005, 2)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'chronicle.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'chronicle'})
