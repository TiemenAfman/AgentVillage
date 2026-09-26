"""The library. Rebuild with scripts/blender.mjs --background --python scripts/build-library.py.

A village bookshop-library for a terrace on the square: a rough stone ground floor with four tall
arched reading-room windows and a small recessed doorway in bottle green and gold, a jettied
cream plaster upper floor in dark timber, and instead of one big gable two small steep ones side
by side under a dark slate roof, each with a round window in its apex. A round drum sign hangs
out over the door on an iron arm - an open book, two pale pages on a green face - and the pavement
has three stacks of books and a bench on it. Not yet placed on the island; it stands on /demo.

One civic asset, `civic_library` (budget 1500), and nothing in it moves. It stands on a 3x3 lot
with neighbours right beside it, so the body stops at x = +-1.40 and only the roofs' verges reach
past it, to 1.47 at most (the lot edge is 1.50); the front wall is at z = 1.02 (the upper floor at
1.10) and the pavement dressing stops at 1.45 (the sign's arm; the books at 1.32). The door is in
the middle of the front, where the island's paths arrive, with `anchor.door` at its foot;
`anchor.smoke` is on a chimney pot, above everything, and `building_height` is that pot's top.

The books and the bench are below head height, so footprintOf() in web/js/buildings.js walls them
off - and, being within WALK_GAP of the front, merges them with it into one solid reaching z = 1.32
across the whole width: a walker stops at the pavement's edge, not at the door. Each stack is an
object of its own so that at least no single part spans the doorway (see the pavement below).

Why the shapes are what they are:
  - The two front gables fill the whole width and reach almost to the main ridge, so the front
    reads as two gables and not as two dormers on one big roof. The main roof shows only in the V
    between them; its front pitch starts just behind the gable walls instead of at the eaves, or
    its eave would run across both gables as a horizontal band.
  - Each gable pitch is cut off where it runs under the main roof, along the valley, rather than
    carried back square: carried back, its outer eave stuck out of the side wall as a ledge that
    stopped halfway along the house.
  - The gables are 6 cm apart in height and the chimney leans: a village like this is a little
    crooked, and a crooked chimney is the cheapest way to say it.
  - Window panes are flat polygons, not boxes: the island's building material is double sided,
    and a pane is only ever seen from the front. A dark pane with a smaller lit one just in front
    is the bakery's window; the lit one is `emissive` and glows after dark.
  - Faces nobody can see - the back of a timber against the plaster, the underside of anything
    standing on the ground, the ends of a brace buried in a post - are left off (`drop`). That is
    what pays for the book stacks and the sign within the budget.
  - The sign is a drum on its side, faces to +-x like every shop sign hung out over a pavement,
    with the book on both faces: seen from along the street, which is how a terrace is seen.
Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/library'
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


STONE = material('stone', 'library rubble', 0x958c7e)
FOOTING = material('stone', 'library footing', 0x6c665e)
DRESSED = material('stone', 'library dressed stone', 0xbdb3a0)
PLASTER = material('wall', 'library plaster', 0xf0e6cc)
TIMBER = material('plank', 'library timber', 0x3e2a1c)
TIMBER_Z = material('plankZ', 'library timber', 0x3e2a1c)
SLATE = material('roof', 'library slate', 0x46505c)
RIDGE_TILE = material('roof', 'library ridge', 0x383f49)
GREEN = material('plain', 'library bottle green', 0x1d4a34)
DOOR = material('plank', 'library green door', 0x1b4531)
GOLD = material('plain', 'library gold', 0xc9a044)
GLASS = material('plain', 'library window', 0x2b3036)
GLOW = material('plain', 'library lit window', 0xffd488, emissive=True)
PAGE = material('plain', 'library pages', 0xf2e9d0)
IRON = material('plain', 'library iron', 0x2f3034)
CHIMNEY = material('stone', 'library chimney', 0x857d72)
POT = material('plain', 'library chimney pot', 0xa35b3c)
BENCH = material('plank', 'library bench', 0x80552f)
BENCH_Z = material('plankZ', 'library bench', 0x80552f)
BOOK = {name: material('plain', f'library book {name}', hex) for name, hex in (
    ('red', 0x9a3d34), ('blue', 0x3d5c86), ('green', 0x4f7a4a), ('ochre', 0xc4933c),
    ('plum', 0x70496c), ('brown', 0x7b5433), ('teal', 0x3f7474))}


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
        """A convex solid (or some of its faces), every face turned away from its middle.

        The island's material is double sided and flat shaded, so it would not care; the
        preview's studio light does, and a face lit from behind renders black there.
        """
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


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


# A box's faces, and the names `drop` leaves them off by (in the box's own frame).
BOX_FACES = [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]]
FACE = {'back': 0, 'front': 1, 'bottom': 2, 'top': 3, 'right': 4, 'left': 5}


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, drop=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.solid(pts, [f for i, f in enumerate(BOX_FACES) if i not in {FACE[d] for d in drop}], mat)


def span(part, lo, hi, mat, drop=()):
    """An axis-aligned box from one corner to the other: most of a building is these."""
    box(part, [(a + b) / 2 for a, b in zip(lo, hi)], [b - a for a, b in zip(lo, hi)], mat, drop=drop)


def beam(part, a, b, width, depth, mat, side=(0, 0, 1), ends=True, back=True):
    """A timber from a to b: `depth` along `side`, `width` across both. `ends=False` for one
    whose ends are buried in what it joins; `back=False` for one lying on a wall at -side."""
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


def prism(part, base, vec, mat, back=True):
    """A convex outline pushed along `vec`. `back=False` leaves off the cap it started from,
    for a frame standing against a wall whose back nobody sees."""
    n = len(base)
    base = [Vector(p) for p in base]
    top = [p + Vector(vec) for p in base]
    faces = [list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    if back:
        faces.append(list(range(n)))
    part.solid(base + top, faces, mat)


def pitch(part, corners, t, mat):
    """A roof pitch from the four corners of its underside (one plane), `t` thick upwards."""
    corners = [Vector(c) for c in corners]
    n = newell(corners).normalized()
    if n.y < 0:
        n = -n
    part.solid(corners + [c + n * t for c in corners], BOX_FACES, mat)


def cylinder(part, a, b, r, mat, sides=6, caps=(False, False)):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(2 * math.pi * i / sides) + v * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)]
    faces = [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)]
    if caps[0]:
        faces.append(list(range(sides)))
    if caps[1]:
        faces.append(list(range(sides, 2 * sides)))
    part.solid(ring(a) + ring(b), faces, mat)


def arch(cx, y0, spring, half, segs=6):
    """A round-headed window's outline in x, y: square foot, semicircular head."""
    pts = [(cx - half, y0), (cx + half, y0)]
    pts += [(cx + half * math.cos(math.pi * k / segs), spring + half * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
    return pts


def ring_xy(cx, cy, r, sides=8, turn=math.pi / 8):
    return [(cx + r * math.cos(turn + 2 * math.pi * k / sides), cy + r * math.sin(turn + 2 * math.pi * k / sides)) for k in range(sides)]


def rect_xy(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def at_z(outline, z):
    return [(x, y, z) for x, y in outline]


ASSET = bpy.data.collections.new('civic_library')
bpy.context.scene.collection.children.link(ASSET)

# The body. ZR is the back of the door's recess, ZF the stone front, ZJ the jettied upper floor.
X0, X1 = -1.40, 1.40
ZB, ZR, ZF, ZJ = -1.30, 0.88, 1.02, 1.10
FOOT, GF, EAVES, RIDGE = 0.06, 0.92, 1.58, 2.88
ZMID = (ZB + ZJ) / 2
# The two front gables: middle, half width, apex. They fill the front between them.
GABLES = ((-0.70, 0.70, 2.74), (0.70, 0.70, 2.68))
WINDOWS = (-1.04, -0.57, 0.57, 1.04)
SPRING = 0.60            # where the ground-floor arches start to turn
BACK, FRONT, BOTTOM, TOP = 'back', 'front', 'bottom', 'top'

house = Part(ASSET, 'house')
span(house, (-1.42, 0, -1.32), (1.42, FOOT, ZF + 0.03), FOOTING, drop=(BOTTOM,))
span(house, (X0, FOOT, ZB), (X1, GF, ZR), STONE, drop=(BOTTOM, TOP, FRONT))
span(house, (X0, FOOT, ZR), (-0.15, GF, ZF), STONE, drop=(BOTTOM, TOP, BACK))
span(house, (0.15, FOOT, ZR), (X1, GF, ZF), STONE, drop=(BOTTOM, TOP, BACK))
span(house, (-0.15, 0.74, ZR), (0.15, GF, ZF), STONE, drop=(TOP, BACK))
# A dressed-stone sill course the windows stand on, broken by the doorway.
for s in (-1, 1):
    span(house, (min(s * 0.23, s * 1.24), 0.13, ZF), (max(s * 0.23, s * 1.24), 0.17, ZF + 0.035), DRESSED, drop=(BACK, BOTTOM))
# Dressed quoins up both front corners, long and short in turn round the corner.
for s in (-1, 1):
    for k, (y0, y1) in enumerate(((FOOT, 0.28), (0.34, 0.56), (0.62, 0.84))):
        along, back = (0.16, 0.08) if k % 2 == 0 else (0.09, 0.15)
        xa, xb = s * (X1 - along), s * (X1 + 0.012)
        span(house, (min(xa, xb), y0, ZF - back), (max(xa, xb), y1, ZF + 0.012), DRESSED, drop=(BOTTOM, TOP))

# The reading-room windows: a green arched frame on the stone, a dark pane, the lit pane just in
# front of it, a mullion, and a transom where the arch springs.
for cx in WINDOWS:
    prism(house, at_z(arch(cx, 0.145, SPRING, 0.175), ZF), (0, 0, 0.025), GREEN, back=False)
    house.flat(at_z(arch(cx, 0.17, SPRING, 0.14), ZF + 0.027), (0, 0, 1), GLASS)
    house.flat(at_z(arch(cx, 0.20, SPRING, 0.11), ZF + 0.030), (0, 0, 1), GLOW)
    span(house, (cx - 0.011, 0.17, ZF + 0.027), (cx + 0.011, SPRING + 0.14, ZF + 0.04), GREEN, drop=(BACK, BOTTOM))
    span(house, (cx - 0.14, SPRING - 0.01, ZF + 0.027), (cx + 0.14, SPRING + 0.01, ZF + 0.04), GREEN, drop=(BACK,))

# The doorway: green pilasters that are also the reveals of the recess, gold caps, a green fascia
# with a gold rule top and bottom, a cornice; inside, a boarded green door under a fanlight.
for s in (-1, 1):
    span(house, (min(s * 0.15, s * 0.23), 0, ZR), (max(s * 0.15, s * 0.23), 0.70, ZF + 0.05), GREEN, drop=(BACK, BOTTOM))
    span(house, (min(s * 0.14, s * 0.24), 0.66, ZR), (max(s * 0.14, s * 0.24), 0.70, ZF + 0.06), GOLD, drop=(BACK,))
span(house, (-0.30, 0.70, 0.98), (0.30, 0.84, ZF + 0.06), GREEN, drop=(BACK, TOP))
for y in (0.725, 0.815):
    house.flat(at_z(rect_xy(-0.26, y - 0.007, 0.26, y + 0.007), ZF + 0.062), (0, 0, 1), GOLD)
span(house, (-0.33, 0.84, 0.98), (0.33, 0.875, ZF + 0.08), GREEN, drop=(BACK,))
span(house, (-0.15, FOOT, ZR), (0.15, 0.74, ZR + 0.012), GREEN, drop=(BACK, BOTTOM, TOP))
span(house, (-0.13, FOOT, ZR + 0.012), (0.13, 0.55, ZR + 0.03), DOOR, drop=(BACK, BOTTOM, TOP))
span(house, (-0.15, 0.55, ZR + 0.012), (0.15, 0.57, ZR + 0.035), GOLD, drop=(BACK,))
fan = [(0.13 * math.cos(math.pi * k / 4), 0.57 + 0.13 * math.sin(math.pi * k / 4)) for k in range(5)]
house.flat(at_z(fan, ZR + 0.014), (0, 0, 1), GLASS)
house.flat(at_z([(x * 0.75, 0.57 + (y - 0.57) * 0.75) for x, y in fan], ZR + 0.017), (0, 0, 1), GLOW)
house.flat(at_z(rect_xy(0.07, 0.29, 0.095, 0.315), ZR + 0.032), (0, 0, 1), GOLD)
span(house, (-0.22, 0, ZF), (0.22, 0.04, ZF + 0.10), DRESSED, drop=(BACK, BOTTOM))

# The jetty: the upper floor stands 8 cm proud on a beam carried by four brackets.
span(house, (-1.42, 0.90, 1.00), (1.42, 0.98, ZJ + 0.04), TIMBER, drop=(BACK,))
for x in (-1.31, -0.805, 0.805, 1.31):
    beam(house, (x, 0.72, ZF - 0.01), (x, 0.905, ZJ + 0.01), 0.04, 0.045, TIMBER_Z, side=(1, 0, 0), ends=False)

# The upper floor: plaster in a dark frame - corner and middle posts, a rail under the windows, a
# tie beam at the eaves, St Andrew's crosses beside the middle and a brace to each corner.
span(house, (X0, GF, ZB), (X1, EAVES, ZJ), PLASTER, drop=(BOTTOM, TOP))
for x, w in ((-1.375, 0.05), (0, 0.06), (1.375, 0.05)):
    span(house, (x - w / 2, 0.98, ZJ), (x + w / 2, 1.56, ZJ + 0.03), TIMBER, drop=(BACK, BOTTOM, TOP))
span(house, (X0, 1.075, ZJ), (X1, 1.11, ZJ + 0.04), TIMBER, drop=(BACK,))
span(house, (-1.42, 1.555, ZJ), (1.42, 1.615, ZJ + 0.04), TIMBER, drop=(BACK,))
for s in (-1, 1):
    for a, b in (((0.03, 1.11), (0.45, 1.555)), ((0.03, 1.555), (0.45, 1.11)), ((1.35, 1.11), (0.95, 1.555))):
        beam(house, (s * a[0], a[1], ZJ + 0.015), (s * b[0], b[1], ZJ + 0.015), 0.035, 0.03, TIMBER, ends=False, back=False)
    gx = s * 0.70
    span(house, (gx - 0.25, 1.11, ZJ), (gx + 0.25, 1.52, ZJ + 0.035), TIMBER, drop=(BACK, BOTTOM))
    house.flat(at_z(rect_xy(gx - 0.215, 1.14, gx + 0.215, 1.49), ZJ + 0.037), (0, 0, 1), GLASS)
    house.flat(at_z(rect_xy(gx - 0.18, 1.165, gx + 0.18, 1.465), ZJ + 0.04), (0, 0, 1), GLOW)
    span(house, (gx - 0.01, 1.14, ZJ + 0.037), (gx + 0.01, 1.49, ZJ + 0.048), TIMBER, drop=(BACK, BOTTOM, TOP))
    span(house, (gx - 0.215, 1.38, ZJ + 0.037), (gx + 0.215, 1.40, ZJ + 0.048), TIMBER, drop=(BACK,))

# The gables: plaster triangles on the tie beam, a collar with two studs under it, and a round
# window high in each.
for gx, hw, apex in GABLES:
    # Only its face: everything behind it is under the roof, and its slopes are the roof's underside.
    house.flat([(gx - hw, EAVES, ZJ), (gx + hw, EAVES, ZJ), (gx, apex, ZJ)], (0, 0, 1), PLASTER)
    cy = 1.98
    half = hw * (apex - cy - 0.02) / (apex - EAVES)
    span(house, (gx - half, cy, ZJ), (gx + half, cy + 0.04, ZJ + 0.03), TIMBER, drop=(BACK,))
    for dx in (-0.26, 0.26):
        span(house, (gx + dx - 0.017, 1.615, ZJ), (gx + dx + 0.017, cy, ZJ + 0.03), TIMBER, drop=(BACK, BOTTOM, TOP))
    oy = apex - 0.44
    house.flat(at_z(ring_xy(gx, oy, 0.125), ZJ + 0.004), (0, 0, 1), TIMBER)
    house.flat(at_z(ring_xy(gx, oy, 0.10), ZJ + 0.008), (0, 0, 1), GLASS)
    house.flat(at_z(ring_xy(gx, oy, 0.078), ZJ + 0.011), (0, 0, 1), GLOW)
    house.flat(at_z(rect_xy(gx - 0.009, oy - 0.10, gx + 0.009, oy + 0.10), ZJ + 0.014), (0, 0, 1), TIMBER)
    house.flat(at_z(rect_xy(gx - 0.10, oy - 0.009, gx + 0.10, oy + 0.009), ZJ + 0.014), (0, 0, 1), TIMBER)
# The ends of the main roof, party walls to the neighbours. The frame's sole plate, rail and tie
# beam go round the corner and along them, with a post at the back: from the square the sides are
# glimpsed between the houses, and a blank one there reads as a house with only a front. (Faced in
# stone they were tried and read as a dark slab beside the shopfront.)
for s in (-1, 1):
    house.flat([(s * X1, EAVES, ZB), (s * X1, RIDGE, ZMID), (s * X1, EAVES, ZJ)], (s, 0, 0), PLASTER)
    xa, xb = sorted((s * X1, s * (X1 + 0.03)))
    for y0, y1, z1 in ((GF, 0.98, 1.00), (1.075, 1.11, ZJ + 0.04), (1.555, 1.615, ZJ + 0.04)):
        span(house, (xa, y0, ZB - 0.02), (xb, y1, z1), TIMBER_Z, drop=('left',) if s > 0 else ('right',))
    span(house, (xa, 0.98, ZB - 0.02), (xb, 1.555, ZB + 0.03), TIMBER, drop=('left',) if s > 0 else ('right',))
# The back: a boarded door and two small windows over it, so a turned lot is not a blank wall.
span(house, (0.36, FOOT, ZB - 0.02), (0.60, 0.56, ZB), DOOR, drop=(FRONT, BOTTOM))
span(house, (0.33, 0.56, ZB - 0.03), (0.63, 0.60, ZB), TIMBER, drop=(FRONT,))
for gx in (-0.70, 0.70):
    span(house, (gx - 0.18, 1.14, ZB - 0.03), (gx + 0.18, 1.46, ZB), TIMBER, drop=(FRONT,))
    house.flat(at_z(rect_xy(gx - 0.15, 1.17, gx + 0.15, 1.43), ZB - 0.032), (0, 0, -1), GLASS)
    house.flat(at_z(rect_xy(gx - 0.12, 1.195, gx + 0.12, 1.405), ZB - 0.035), (0, 0, -1), GLOW)
house.build()

# ---- the roof ------------------------------------------------------------------------------
roof = Part(ASSET, 'roof')
T = 0.05                  # slate thickness
tan_main = (RIDGE - EAVES) / (ZJ - ZMID)
back_dir = Vector((0, RIDGE - EAVES, ZMID - ZB)).normalized()
back_eave = Vector((0, EAVES, ZB)) - back_dir * 0.10
pitch(roof, [(-1.44, back_eave.y, back_eave.z), (1.44, back_eave.y, back_eave.z), (1.44, RIDGE, ZMID), (-1.44, RIDGE, ZMID)], T, SLATE)
# The front pitch starts behind the gable walls: it is only seen in the V between the gables.
fz = ZJ - 0.02
fy = EAVES + 0.02 * tan_main
pitch(roof, [(-1.44, fy, fz), (1.44, fy, fz), (1.44, RIDGE, ZMID), (-1.44, RIDGE, ZMID)], T, SLATE)
span(roof, (-1.45, RIDGE + 0.01, ZMID - 0.055), (1.45, RIDGE + 0.08, ZMID + 0.055), RIDGE_TILE, drop=(BOTTOM,))


def under_main(y):
    """How far back a gable pitch whose top surface is at height y can go before the main
    roof's front pitch closes over it: that line is the valley."""
    return ZJ - (y - EAVES) / tan_main - 0.012


GABLE_FRONT = ZJ + 0.11
for gx, hw, apex in GABLES:
    lift = T * math.hypot(hw, apex - EAVES) / hw          # a pitch's thickness, measured upright
    for s in (-1, 1):
        foot = Vector((gx + s * hw, EAVES, 0))
        top = Vector((gx, apex, 0))
        if abs(foot.x) > 1.0:
            foot = foot - (top - foot).normalized() * 0.04    # the verge over the party wall
        pitch(roof, [(foot.x, foot.y, GABLE_FRONT), (top.x, top.y, GABLE_FRONT),
                     (top.x, top.y, under_main(top.y + lift)), (foot.x, foot.y, under_main(foot.y + lift))], T, SLATE)
    span(roof, (gx - 0.045, apex + 0.02, under_main(apex + 0.09)), (gx + 0.045, apex + 0.09, GABLE_FRONT + 0.01), RIDGE_TILE, drop=(BOTTOM,))
    span(roof, (gx - 0.016, apex + 0.08, GABLE_FRONT - 0.025), (gx + 0.016, apex + 0.22, GABLE_FRONT + 0.007), TIMBER, drop=(BOTTOM,))

# The chimney on the ridge by the right-hand wall, and it leans: a lower stack, a leaning upper
# one, a dressed cap and two pots.
CX, CZ, LEAN = 1.10, -0.13, -0.10
box(roof, (CX, 2.76, CZ), (0.26, 0.52, 0.26), CHIMNEY, drop=(BOTTOM,))
box(roof, (CX + 0.02, 3.12, CZ), (0.24, 0.24, 0.24), CHIMNEY, rz=LEAN, drop=(BOTTOM,))
box(roof, (CX + 0.035, 3.255, CZ), (0.30, 0.04, 0.30), DRESSED, rz=LEAN)
POTS = ((CX - 0.02, CZ + 0.035), (CX + 0.10, CZ - 0.035))
for px, pz in POTS:
    cylinder(roof, (px, 3.27, pz), (px + 0.009, 3.37, pz), 0.038, POT, caps=(False, True))

# The sign: an iron arm out of the middle post with a brace under it, two hangers, and a gold drum
# on its side with a green face each way and an open book on each face.
SY, SZ, R = 0.84, 1.31, 0.12
span(roof, (-0.011, 1.01, ZJ + 0.03), (0.011, 1.035, 1.44), IRON, drop=(BACK,))
beam(roof, (0, 1.20, ZJ + 0.03), (0, 1.02, 1.36), 0.018, 0.018, IRON, side=(1, 0, 0), ends=False)
for dz in (-0.06, 0.06):
    span(roof, (-0.008, SY + math.sqrt(R * R - dz * dz) - 0.01, SZ + dz - 0.008), (0.008, 1.012, SZ + dz + 0.008), IRON, drop=(BOTTOM, TOP))
cylinder(roof, (-0.035, SY, SZ), (0.035, SY, SZ), R, GOLD, sides=10, caps=(True, True))
for s in (-1, 1):
    disc = [(s * 0.037, SY + 0.098 * math.sin(2 * math.pi * k / 10), SZ + 0.098 * math.cos(2 * math.pi * k / 10)) for k in range(10)]
    roof.flat(disc, (s, 0, 0), GREEN)
    for side in (-1, 1):
        # A page in the plane of the face: inner edge at the spine, outer edge lifted - the two
        # together are the open-book picture every bookshop hangs out - on a red cover that shows
        # below and beyond the pages, which is what stops the pair reading as a pair of eyes.
        z_in, z_out = SZ + side * 0.004, SZ + side * 0.078
        cover = [(SZ, SY - 0.046), (z_out + side * 0.012, SY - 0.026), (z_out + side * 0.012, SY + 0.03), (SZ, SY + 0.01)]
        roof.flat([(s * 0.040, y, z) for z, y in cover], (s, 0, 0), BOOK['red'])
        page = [(z_in, SY - 0.032), (z_out, SY - 0.012), (z_out, SY + 0.04), (z_in, SY + 0.022)]
        roof.flat([(s * 0.043, y, z) for z, y in page], (s, 0, 0), PAGE)
roof.build()

# ---- the pavement --------------------------------------------------------------------------
# Each stack and the bench are objects of their own: the bake makes a part per object and colour,
# and buildings.js walls off every part's rectangle below head height - one 'red books' part with a
# book each side of the door would be a wall across the doorway.
STACKS = (
    ('books left', (-0.49, 1.17), (
        ('red', 0.15, 0.040, 0.110, 0.10), ('blue', 0.14, 0.034, 0.105, -0.14), ('ochre', 0.145, 0.046, 0.108, 0.22),
        ('green', 0.13, 0.034, 0.100, -0.06), ('plum', 0.12, 0.032, 0.092, 0.32))),
    ('books by the door', (-0.29, 1.23), (
        ('brown', 0.14, 0.038, 0.105, -0.25), ('teal', 0.135, 0.034, 0.100, 0.06))),
    ('books right', (0.41, 1.18), (
        ('blue', 0.15, 0.042, 0.110, -0.15), ('green', 0.14, 0.036, 0.104, 0.12), ('ochre', 0.135, 0.034, 0.100, -0.28),
        ('red', 0.125, 0.036, 0.094, 0.18))),
)
pavement = []
for name, (x, z), books in STACKS:
    yard = Part(ASSET, name)
    y = 0.0
    for colour, w, h, d, turn in books:
        box(yard, (x, y + h / 2, z), (w, h, d), BOOK[colour], ry=turn, drop=(BOTTOM,))
        y += h
    if len(books) == 2:
        # And one lying open on the short stack: a red cover, two pages bowed up from the spine.
        bx, bz, turn = x, z, 0.4
        box(yard, (bx, y + 0.006, bz), (0.17, 0.012, 0.12), BOOK['red'], ry=turn, drop=(BOTTOM,))
        m = rotation(ry=turn)
        for side in (-1, 1):
            pts = [(side * 0.005, 0.014, -0.05), (side * 0.078, 0.026, -0.05), (side * 0.078, 0.026, 0.05), (side * 0.005, 0.014, 0.05)]
            yard.flat([Vector((bx, y, bz)) + m @ Vector(p) for p in pts], (0, 1, 0), PAGE)
    yard.build()
    pavement.append(yard)
# The bench under the right-hand windows, its back to the wall.
BX, BZ = 0.95, 1.13
yard = Part(ASSET, 'bench')
box(yard, (BX, 0.155, BZ), (0.46, 0.03, 0.13), BENCH)
for dx in (-0.19, 0.19):
    box(yard, (BX + dx, 0.07, BZ), (0.03, 0.14, 0.11), BENCH_Z, drop=(BOTTOM, TOP))
box(yard, (BX, 0.245, ZF + 0.04), (0.46, 0.11, 0.022), BENCH, rx=-0.12)
yard.build()
pavement.append(yard)

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((POTS[0][0] + 0.009, 3.40, POTS[0][1]))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.10))
ASSET.objects.link(door)

# The tallest thing the set holds, which is the chimney pot: nameplates float above it.
top = max(v.y for p in (house, roof, *pavement) for v in p.verts)
bpy.context.scene['building_height'] = round(top + 0.005, 2)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'library.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'library'})
