"""The library. Rebuild with scripts/blender.mjs --background --python scripts/build-library.py.

A village bookshop-library on the square, at the tavern's size and under the tavern's
terracotta: a rough stone ground floor with four tall arched reading-room windows and a small
recessed doorway in bottle green and gold, a jettied cream plaster upper floor in warm oak, and
instead of one big gable two small ones side by side, each with a round window in its apex. A
round drum sign hangs out over the door on an iron arm - an open book, two pale pages on a
green face - and the pavement has three stacks of books and a bench on it.

Why it is the size it is. The first cut filled its 3x3 lot (2.9 across, 3.4 to the chimney
pots) under a near-black slate roof with 58 degree gables, and on the island it stood twice
the height of the tavern and the town hall beside it. So it is now measured off the tavern
and the bakery: a body 1.70 wide and 1.36 deep, the tie beam at 0.95, the main ridge at 1.59
on a 43 degree pitch (the tavern's is 42.6), the two gables at about 45, a door 0.44 tall and
0.24 wide, and the tavern's terracotta (0xb8552f) with its lighter ridge (0xc76b3d) over the
bakery's plaster and oak. At that pitch the gables no longer reach the main ridge, so they
read as two gables standing in front of the roof rather than filling it - which is what a
real pair of front gables does. What was fiddly at the old size went: the collars and studs
in the gables, the transoms in the arched windows, the third pot, one book of every stack.
The sides are no longer party walls - at 1.70 on a 3.00 lot there is a gap either side - so
the frame goes round the corners and each gable end has a small window.

One civic asset, `civic_library` (budget 1500), and nothing in it moves. The body stands
towards the street: the stone front at z = 0.76 (the upper floor at 0.82), the back wall at
-0.54, and the pavement dressing stops at z = 1.09 (the sign's drum; the books at 0.99). The door
is in the middle of the front, where the island's paths arrive, with `anchor.door` at its foot;
`anchor.smoke` is on a chimney pot, above everything, and `building_height` is that pot's top.

The books and the bench are below head height, so footprintOf() in web/js/buildings.js walls them
off. Each stack is an object of its own so that no single part spans the doorway, and the stacks
stand far enough either side of it (x -0.46, -0.31, +0.33) that a walker still fits between them.

Why the shapes are what they are:
  - The main roof's front pitch starts just behind the gable walls instead of at the eaves, or
    its eave would run across both gables as a horizontal band; it shows in the V between them.
  - Each gable pitch is cut off where it runs under the main roof, along the valley, rather than
    carried back square: carried back, its outer eave stuck out of the side wall as a ledge that
    stopped halfway along the house.
  - The gables are 3 cm apart in height and the chimney leans: a village like this is a little
    crooked, and a crooked chimney is the cheapest way to say it.
  - Oak bargeboards run up every rake, as on the tavern: without them a gable's tiled edge is
    the same colour as its pitch and the pair of gables loses its outline against the roof.
  - Window panes are flat polygons, not boxes: a pane is only ever seen from the front. A dark
    pane with a smaller lit one just in front is the bakery's window; the lit one is `emissive`
    and glows after dark.
  - Faces nobody can see - the back of a timber against the plaster, the underside of anything
    standing on the ground, the ends of a brace buried in a post - are left off (`drop`). That is
    what pays for the book stacks and the sign within the budget.
  - The sign is a drum on its side, faces to +-x like every shop sign hung out over a pavement,
    with the book on both faces: seen from along the street, which is how a terrace is seen. It
    hangs with its bottom at 0.62, above a settler's head, so it walls nothing off.
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


# The village's own palette - the tavern's stone and tiles, the bakery's plaster and oak - so the
# library reads as one of them from across the square; only the doorway is its own.
STONE = material('stone', 'library rubble', 0x968778)
FOOTING = material('stone', 'library footing', 0x8f8c86)
DRESSED = material('stone', 'library dressed stone', 0xc4b89f)
PLASTER = material('wall', 'library plaster', 0xf0e2c4)
TIMBER = material('plank', 'library timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'library timber', 0x6a4426)
TILES = material('roof', 'library tiles', 0xb8552f)
RIDGE_TILE = material('roof', 'library ridge', 0xc76b3d)
GREEN = material('plain', 'library bottle green', 0x1d4a34)
DOOR = material('plank', 'library green door', 0x1b4531)
GOLD = material('plain', 'library gold', 0xc9a044)
GLASS = material('plain', 'library window', 0x2b3036)
GLOW = material('plain', 'library lit window', 0xffd488, emissive=True)
PAGE = material('plain', 'library pages', 0xf2e9d0)
IRON = material('plain', 'library iron', 0x343638)
CHIMNEY = material('stone', 'library chimney', 0x8f8c86)
POT = material('plain', 'library chimney pot', 0xa35b3c)
BENCH = material('plank', 'library bench', 0x845335)
BENCH_Z = material('plankZ', 'library bench', 0x845335)
BOOK = {name: material('plain', f'library book {name}', hex) for name, hex in (
    ('red', 0x9a3d34), ('blue', 0x3d5c86), ('green', 0x4f7a4a), ('ochre', 0xc4933c),
    ('brown', 0x7b5433), ('teal', 0x3f7474))}


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


def pitch(part, corners, t, mat, hide=()):
    """A roof pitch from the four corners of its underside (one plane), `t` thick upwards.
    `hide` names the edges (by the corner they start from, 0..3) whose face nobody sees: one
    under the ridge tile, under a bargeboard, or run in under the main roof."""
    corners = [Vector(c) for c in corners]
    n = newell(corners).normalized()
    if n.y < 0:
        n = -n
    edges = {0: 2, 1: 4, 2: 3, 3: 5}       # corner i -> the BOX_FACES side from corner i to i+1
    part.solid(corners + [c + n * t for c in corners], [f for i, f in enumerate(BOX_FACES) if i not in {edges[e] for e in hide}], mat)


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


def arch(cx, y0, spring, half, segs=4):
    """A round-headed window's outline in x, y: square foot, semicircular head. Four segments
    to the half circle: at a window 0.17 across a fifth and sixth were never seen."""
    pts = [(cx - half, y0), (cx + half, y0)]
    pts += [(cx + half * math.cos(math.pi * k / segs), spring + half * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
    return pts


def ring_xy(cx, cy, r, sides=8, turn=math.pi / 8):
    return [(cx + r * math.cos(turn + 2 * math.pi * k / sides), cy + r * math.sin(turn + 2 * math.pi * k / sides)) for k in range(sides)]


def rect_xy(x0, y0, x1, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


def at_z(outline, z):
    return [(x, y, z) for x, y in outline]


def at_x(outline_zy, x):
    return [(x, y, z) for z, y in outline_zy]


ASSET = bpy.data.collections.new('civic_library')
bpy.context.scene.collection.children.link(ASSET)

# The body. ZR is the back of the door's recess, ZF the stone front, ZJ the jettied upper floor.
X0, X1 = -0.85, 0.85
ZB, ZR, ZF, ZJ = -0.54, 0.69, 0.76, 0.82
# FOOT the plinth, GF the top of the stone floor, EAVES the underside of the tiles at the wall
# line (the tie beam's top), RIDGE the underside of the tiles at the ridge.
FOOT, GF, EAVES, RIDGE = 0.035, 0.63, 0.95, 1.585
ZMID = (ZB + ZJ) / 2
# The two front gables: middle, half width, apex. They fill the front between them.
GABLES = ((-0.425, 0.425, 1.39), (0.425, 0.425, 1.36))
WINDOWS = (-0.64, -0.38, 0.38, 0.64)
SPRING = 0.38            # where the ground-floor arches start to turn
BACK, FRONT, BOTTOM, TOP = 'back', 'front', 'bottom', 'top'

house = Part(ASSET, 'house')
span(house, (X0 - 0.015, 0, ZB - 0.015), (X1 + 0.015, FOOT, ZF + 0.02), FOOTING, drop=(BOTTOM,))
span(house, (X0, FOOT, ZB), (X1, GF, ZR), STONE, drop=(BOTTOM, TOP, FRONT))
span(house, (X0, FOOT, ZR), (-0.14, GF, ZF), STONE, drop=(BOTTOM, TOP, BACK))
span(house, (0.14, FOOT, ZR), (X1, GF, ZF), STONE, drop=(BOTTOM, TOP, BACK))
span(house, (-0.14, 0.5, ZR), (0.14, GF, ZF), STONE, drop=(TOP, BACK))
# A dressed-stone sill course the windows stand on, broken by the doorway.
for s in (-1, 1):
    span(house, (min(s * 0.2, s * 0.77), 0.07, ZF), (max(s * 0.2, s * 0.77), 0.09, ZF + 0.022), DRESSED, drop=(BACK, BOTTOM))
# Dressed quoins up both front corners, long and short in turn round the corner.
for s in (-1, 1):
    for k, (y0, y1) in enumerate(((FOOT, 0.22), (0.25, 0.41), (0.44, 0.6))):
        along, back = (0.1, 0.05) if k % 2 == 0 else (0.055, 0.09)
        xa, xb = s * (X1 - along), s * (X1 + 0.008)
        span(house, (min(xa, xb), y0, ZF - back), (max(xa, xb), y1, ZF + 0.008), DRESSED, drop=(BOTTOM, TOP, BACK))

# The reading-room windows: a green arched frame on the stone, a dark pane, the lit pane just in
# front of it, and a mullion - the four tall arches are what says "library" from the square.
for cx in WINDOWS:
    prism(house, at_z(arch(cx, 0.09, SPRING, 0.085), ZF), (0, 0, 0.02), GREEN, back=False)
    house.flat(at_z(arch(cx, 0.105, SPRING, 0.066), ZF + 0.022), (0, 0, 1), GLASS)
    house.flat(at_z(arch(cx, 0.125, SPRING, 0.048), ZF + 0.025), (0, 0, 1), GLOW)
    span(house, (cx - 0.008, 0.105, ZF + 0.022), (cx + 0.008, SPRING + 0.066, ZF + 0.032), GREEN, drop=(BACK, BOTTOM, TOP))

# The doorway: green pilasters that are also the reveals of the recess, gold caps, a green fascia
# with a gold rule top and bottom, a cornice; inside, a boarded green door with a lit pane in it.
for s in (-1, 1):
    span(house, (min(s * 0.14, s * 0.19), 0, ZR), (max(s * 0.14, s * 0.19), 0.47, ZF + 0.035), GREEN, drop=(BACK, BOTTOM, TOP))
    span(house, (min(s * 0.135, s * 0.195), 0.47, ZR), (max(s * 0.135, s * 0.195), 0.5, ZF + 0.042), GOLD, drop=(BACK,))
span(house, (-0.22, 0.5, ZF - 0.02), (0.22, 0.585, ZF + 0.042), GREEN, drop=(BACK, TOP))
for y in (0.515, 0.57):
    house.flat(at_z(rect_xy(-0.19, y - 0.005, 0.19, y + 0.005), ZF + 0.044), (0, 0, 1), GOLD)
span(house, (-0.24, 0.585, ZF - 0.02), (0.24, 0.605, ZF + 0.058), GREEN, drop=(BACK,))
span(house, (-0.14, FOOT, ZR), (0.14, 0.5, ZR + 0.008), GREEN, drop=(BACK, BOTTOM, TOP))
span(house, (-0.12, FOOT, ZR + 0.008), (0.12, 0.47, ZR + 0.024), DOOR, drop=(BACK, BOTTOM, TOP))
house.flat(at_z(rect_xy(-0.05, 0.34, 0.05, 0.43), ZR + 0.026), (0, 0, 1), GLOW)
house.flat(at_z(rect_xy(0.065, 0.215, 0.083, 0.233), ZR + 0.026), (0, 0, 1), GOLD)
span(house, (-0.16, 0, ZF), (0.16, 0.025, ZF + 0.06), DRESSED, drop=(BACK, BOTTOM))

# The jetty: the upper floor stands 6 cm proud on a beam carried by four brackets.
span(house, (X0 - 0.015, GF - 0.03, ZF - 0.02), (X1 + 0.015, GF + 0.02, ZJ + 0.03), TIMBER, drop=(BACK,))
for x in (-0.8, -0.51, 0.51, 0.8):
    beam(house, (x, 0.49, ZF - 0.008), (x, GF - 0.025, ZJ + 0.008), 0.03, 0.032, TIMBER_Z, side=(1, 0, 0), ends=False)

# The upper floor: plaster in a warm oak frame - corner and middle posts, a rail under the
# windows, a tie beam at the eaves, St Andrew's crosses beside the middle and a brace to each corner.
R0, R1 = 0.675, 0.695    # the rail under the windows
T0, T1 = 0.92, 0.96      # the tie beam
span(house, (X0, GF, ZB), (X1, EAVES, ZJ), PLASTER, drop=(BOTTOM, TOP))
for x, w in ((-0.83, 0.035), (0, 0.04), (0.83, 0.035)):
    span(house, (x - w / 2, GF + 0.02, ZJ), (x + w / 2, T0, ZJ + 0.02), TIMBER, drop=(BACK, BOTTOM, TOP))
span(house, (X0, R0, ZJ), (X1, R1, ZJ + 0.025), TIMBER, drop=(BACK,))
span(house, (X0 - 0.015, T0, ZJ), (X1 + 0.015, T1, ZJ + 0.028), TIMBER, drop=(BACK, TOP))
for s in (-1, 1):
    for a, b in (((0.025, R1), (0.255, T0)), ((0.025, T0), (0.255, R1)), ((0.81, R1), (0.6, T0))):
        beam(house, (s * a[0], a[1], ZJ + 0.01), (s * b[0], b[1], ZJ + 0.01), 0.026, 0.02, TIMBER, ends=False, back=False)
    gx = s * 0.425
    span(house, (gx - 0.155, 0.705, ZJ), (gx + 0.155, 0.905, ZJ + 0.022), TIMBER, drop=(BACK, BOTTOM))
    house.flat(at_z(rect_xy(gx - 0.13, 0.725, gx + 0.13, 0.885), ZJ + 0.024), (0, 0, 1), GLASS)
    house.flat(at_z(rect_xy(gx - 0.105, 0.74, gx + 0.105, 0.87), ZJ + 0.027), (0, 0, 1), GLOW)
    span(house, (gx - 0.007, 0.725, ZJ + 0.024), (gx + 0.007, 0.885, ZJ + 0.032), TIMBER, drop=(BACK, BOTTOM, TOP))
    span(house, (gx - 0.13, 0.81, ZJ + 0.024), (gx + 0.13, 0.822, ZJ + 0.032), TIMBER, drop=(BACK, 'left', 'right'))

# The gables: plaster triangles on the tie beam, a round window high in each and a short king
# post under it.
for gx, hw, apex in GABLES:
    # Only its face: everything behind it is under the roof, and its slopes are the roof's underside.
    house.flat([(gx - hw, EAVES, ZJ), (gx + hw, EAVES, ZJ), (gx, apex, ZJ)], (0, 0, 1), PLASTER)
    oy = apex - 0.225
    span(house, (gx - 0.012, T1, ZJ), (gx + 0.012, oy - 0.07, ZJ + 0.018), TIMBER, drop=(BACK, BOTTOM, TOP))
    house.flat(at_z(ring_xy(gx, oy, 0.078), ZJ + 0.004), (0, 0, 1), TIMBER)
    house.flat(at_z(ring_xy(gx, oy, 0.062), ZJ + 0.008), (0, 0, 1), GLASS)
    house.flat(at_z(ring_xy(gx, oy, 0.048), ZJ + 0.011), (0, 0, 1), GLOW)
    house.flat(at_z(rect_xy(gx - 0.007, oy - 0.062, gx + 0.007, oy + 0.062), ZJ + 0.014), (0, 0, 1), TIMBER)
    house.flat(at_z(rect_xy(gx - 0.062, oy - 0.007, gx + 0.062, oy + 0.007), ZJ + 0.014), (0, 0, 1), TIMBER)
# The ends of the main roof. A 1.70 library on a 3.00 lot shows them between itself and its
# neighbours, so the frame's sole plate, rail and tie beam go round the corner and along them,
# a post stands under the ridge, and a small window lights the attic.
for s in (-1, 1):
    house.flat([(s * X1, EAVES, ZB), (s * X1, RIDGE - 0.02, ZMID), (s * X1, EAVES, ZJ)], (s, 0, 0), PLASTER)
    xa, xb = sorted((s * X1, s * (X1 + 0.02)))
    inner = ('left',) if s > 0 else ('right',)
    for y0, y1, z1, under in ((GF - 0.03, GF + 0.02, ZF - 0.02, ()), (R0, R1, ZJ, ()), (T0, T1, ZJ, (TOP,))):
        span(house, (xa, y0, ZB - 0.015), (xb, y1, z1), TIMBER_Z, drop=inner + under)
    span(house, (xa, GF + 0.02, ZMID - 0.018), (xb, T0, ZMID + 0.018), TIMBER, drop=inner + (BOTTOM, TOP))
    xs = s * (X1 + 0.004)
    house.flat(at_x(rect_xy(ZMID - 0.075, 1.07, ZMID + 0.075, 1.22), xs), (s, 0, 0), TIMBER)
    house.flat(at_x(rect_xy(ZMID - 0.055, 1.09, ZMID + 0.055, 1.2), xs + s * 0.004), (s, 0, 0), GLASS)
    house.flat(at_x(rect_xy(ZMID - 0.035, 1.11, ZMID + 0.035, 1.18), xs + s * 0.008), (s, 0, 0), GLOW)
# The back: the frame's bands, a boarded door and a window under each gable, so a turned lot is
# not a blank wall.
span(house, (X0 - 0.015, GF - 0.03, ZB - 0.02), (X1 + 0.015, GF + 0.02, ZB), TIMBER, drop=(FRONT,))
span(house, (X0 - 0.015, T0, ZB - 0.025), (X1 + 0.015, T1, ZB), TIMBER, drop=(FRONT, TOP))
span(house, (-0.02, GF + 0.02, ZB - 0.018), (0.02, T0, ZB), TIMBER, drop=(FRONT, BOTTOM, TOP))
span(house, (0.25, FOOT, ZB - 0.015), (0.47, 0.44, ZB), DOOR, drop=(FRONT, BOTTOM))
span(house, (0.23, 0.44, ZB - 0.022), (0.49, 0.465, ZB), TIMBER, drop=(FRONT,))
for gx in (-0.425, 0.425):
    span(house, (gx - 0.12, 0.71, ZB - 0.02), (gx + 0.12, 0.9, ZB), TIMBER, drop=(FRONT, BOTTOM))
    house.flat(at_z(rect_xy(gx - 0.1, 0.73, gx + 0.1, 0.88), ZB - 0.022), (0, 0, -1), GLASS)
    house.flat(at_z(rect_xy(gx - 0.08, 0.745, gx + 0.08, 0.865), ZB - 0.025), (0, 0, -1), GLOW)
house.build()

# ---- the roof ------------------------------------------------------------------------------
roof = Part(ASSET, 'roof')
T = 0.04                  # tile thickness
XR = 0.91                 # the main roof's reach past the side walls
tan_main = (RIDGE - EAVES) / (ZJ - ZMID)
lift_main = T * math.hypot(1, tan_main)   # a pitch's thickness, measured upright
back_dir = Vector((0, RIDGE - EAVES, ZMID - ZB)).normalized()
back_eave = Vector((0, EAVES, ZB)) - back_dir * 0.1
pitch(roof, [(-XR, back_eave.y, back_eave.z), (XR, back_eave.y, back_eave.z), (XR, RIDGE, ZMID), (-XR, RIDGE, ZMID)], T, TILES, hide=(1, 2, 3))
# The front pitch starts behind the gable walls: it is only seen in the V between the gables.
# Far enough behind that its top edge, which leans forward with the pitch, stays behind the
# plaster: 2 cm back it came through the gables as a red line across both.
fz = ZJ - 0.04
fy = EAVES + 0.04 * tan_main
pitch(roof, [(-XR, fy, fz), (XR, fy, fz), (XR, RIDGE, ZMID), (-XR, RIDGE, ZMID)], T, TILES, hide=(0, 1, 2, 3))
span(roof, (-XR - 0.01, RIDGE + 0.02, ZMID - 0.04), (XR + 0.01, RIDGE + lift_main + 0.03, ZMID + 0.04), RIDGE_TILE, drop=(BOTTOM,))
for s in (-1, 1):
    x = s * (XR + 0.011)
    for y0, z0 in ((back_eave.y, back_eave.z), (fy, fz)):
        beam(roof, (x, y0 + lift_main / 2 - 0.008, z0), (x, RIDGE + lift_main / 2 - 0.008, ZMID), 0.05, 0.022, TIMBER,
             side=(s, 0, 0), ends=False, back=False)


def under_main(y):
    """How far back a gable pitch whose top surface is at height y can go before the main
    roof's front pitch closes over it: that line is the valley."""
    return ZJ - (y - EAVES) / tan_main - 0.01


GABLE_FRONT = ZJ + 0.08
for gx, hw, apex in GABLES:
    lift = T * math.hypot(hw, apex - EAVES) / hw          # a pitch's thickness, measured upright
    for s in (-1, 1):
        foot = Vector((gx + s * hw, EAVES, 0))
        top = Vector((gx, apex, 0))
        if abs(foot.x) > 0.6:
            foot = foot - (top - foot).normalized() * 0.05    # the verge over the side wall
        pitch(roof, [(foot.x, foot.y, GABLE_FRONT), (top.x, top.y, GABLE_FRONT),
                     (top.x, top.y, under_main(top.y + lift)), (foot.x, foot.y, under_main(foot.y + lift))], T, TILES, hide=(0, 1, 2))
        # An oak bargeboard up the rake, over the tiles' edge.
        beam(roof, (foot.x, foot.y + lift / 2 - 0.012, GABLE_FRONT + 0.01), (top.x, top.y + lift / 2 - 0.012, GABLE_FRONT + 0.01),
             0.045, 0.02, TIMBER, ends=False, back=False)
    span(roof, (gx - 0.03, apex + lift - 0.01, under_main(apex + lift + 0.03)), (gx + 0.03, apex + lift + 0.025, GABLE_FRONT + 0.012),
         RIDGE_TILE, drop=(BOTTOM,))
    span(roof, (gx - 0.011, apex + lift + 0.02, GABLE_FRONT - 0.012), (gx + 0.011, apex + lift + 0.1, GABLE_FRONT + 0.01), TIMBER, drop=(BOTTOM,))

# The chimney on the ridge by the right-hand wall, and it leans: a lower stack, a leaning upper
# one, a dressed cap and two pots.
CX, CZ, LEAN = 0.6, 0.06, -0.08
box(roof, (CX, 1.58, CZ), (0.16, 0.28, 0.16), CHIMNEY, drop=(BOTTOM,))
box(roof, (CX + 0.012, 1.765, CZ), (0.15, 0.09, 0.15), CHIMNEY, rz=LEAN, drop=(BOTTOM,))
box(roof, (CX + 0.02, 1.82, CZ), (0.19, 0.025, 0.19), DRESSED, rz=LEAN)
POTS = ((CX - 0.01, CZ + 0.025), (CX + 0.06, CZ - 0.025))
for px, pz in POTS:
    cylinder(roof, (px, 1.83, pz), (px + 0.005, 1.885, pz), 0.024, POT, caps=(False, True))

# The sign: an iron arm out of the middle post with a stay over it, two hangers, and a gold drum
# on its side with a green face each way and an open book on each face.
SY, SZ, R = 0.7, ZJ + 0.19, 0.075
ARM = 0.8
span(roof, (-0.008, ARM, ZJ + 0.02), (0.008, ARM + 0.016, ZJ + 0.26), IRON, drop=(BACK,))
beam(roof, (0, 0.9, ZJ + 0.02), (0, ARM + 0.012, ZJ + 0.22), 0.012, 0.012, IRON, side=(1, 0, 0), ends=False)
for dz in (-0.04, 0.04):
    span(roof, (-0.005, SY + math.sqrt(R * R - dz * dz) - 0.006, SZ + dz - 0.005), (0.005, ARM + 0.002, SZ + dz + 0.005), IRON, drop=(BOTTOM, TOP))
cylinder(roof, (-0.022, SY, SZ), (0.022, SY, SZ), R, GOLD, sides=8, caps=(True, True))
for s in (-1, 1):
    disc = [(s * 0.023, SY + 0.061 * math.sin(2 * math.pi * k / 8), SZ + 0.061 * math.cos(2 * math.pi * k / 8)) for k in range(8)]
    roof.flat(disc, (s, 0, 0), GREEN)
    for side in (-1, 1):
        # A page in the plane of the face: inner edge at the spine, outer edge lifted - the two
        # together are the open-book picture every bookshop hangs out - on a red cover that shows
        # below and beyond the pages, which is what stops the pair reading as a pair of eyes.
        z_in, z_out = SZ + side * 0.0025, SZ + side * 0.049
        cover = [(SZ, SY - 0.029), (z_out + side * 0.008, SY - 0.016), (z_out + side * 0.008, SY + 0.019), (SZ, SY + 0.006)]
        roof.flat([(s * 0.025, y, z) for z, y in cover], (s, 0, 0), BOOK['red'])
        page = [(z_in, SY - 0.02), (z_out, SY - 0.0075), (z_out, SY + 0.025), (z_in, SY + 0.014)]
        roof.flat([(s * 0.027, y, z) for z, y in page], (s, 0, 0), PAGE)
roof.build()

# ---- the pavement --------------------------------------------------------------------------
# Each stack and the bench are objects of their own: the bake makes a part per object and colour,
# and buildings.js walls off every part's rectangle below head height - one 'red books' part with a
# book each side of the door would be a wall across the doorway.
STACKS = (
    ('books left', (-0.46, 0.9), (
        ('red', 0.095, 0.026, 0.07, 0.1), ('blue', 0.088, 0.024, 0.066, -0.14), ('ochre', 0.084, 0.028, 0.064, 0.22))),
    ('books by the door', (-0.31, 0.94), (
        ('brown', 0.088, 0.024, 0.066, -0.25), ('teal', 0.085, 0.022, 0.062, 0.06))),
    ('books right', (0.33, 0.91), (
        ('blue', 0.095, 0.026, 0.07, -0.15), ('green', 0.088, 0.022, 0.065, 0.12), ('ochre', 0.084, 0.022, 0.062, -0.28))),
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
        box(yard, (bx, y + 0.004, bz), (0.105, 0.008, 0.075), BOOK['red'], ry=turn, drop=(BOTTOM,))
        m = rotation(ry=turn)
        for side in (-1, 1):
            pts = [(side * 0.003, 0.009, -0.031), (side * 0.048, 0.016, -0.031), (side * 0.048, 0.016, 0.031), (side * 0.003, 0.009, 0.031)]
            yard.flat([Vector((bx, y, bz)) + m @ Vector(p) for p in pts], (0, 1, 0), PAGE)
    yard.build()
    pavement.append(yard)
# The bench under the right-hand windows, its back to the wall.
BX, BZ = 0.56, ZF + 0.075
yard = Part(ASSET, 'bench')
box(yard, (BX, 0.125, BZ), (0.34, 0.02, 0.085), BENCH)
for dx in (-0.13, 0.13):
    box(yard, (BX + dx, 0.0575, BZ), (0.02, 0.115, 0.07), BENCH_Z, drop=(BOTTOM, TOP))
box(yard, (BX, 0.19, ZF + 0.022), (0.34, 0.07, 0.014), BENCH, rx=-0.12)
yard.build()
pavement.append(yard)

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz((POTS[0][0] + 0.005, 1.89, POTS[0][1]))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.1))
ASSET.objects.link(door)

# The tallest thing the set holds, which is the chimney pot: nameplates float above it.
top = max(v.y for p in (house, roof, *pavement) for v in p.verts)
bpy.context.scene['building_height'] = round(top + 0.005, 2)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'library.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'library'})
