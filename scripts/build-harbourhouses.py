"""The harbour's own buildings. Rebuild with
scripts/blender.mjs --background --python scripts/build-harbourhouses.py.

Three civic assets for the second centre the village grows once the castle stands and it turns to
the sea (Plans/mijlpalen-tot-tweehonderd.md, Plans/havengebouwen.md), each one building on a
three by three lot whose front, +z, faces the water:

    civic_warehouse    het pakhuis (127): a tall, narrow canal warehouse in brick
    civic_weighhouse   de waag (184): a small, stately weigh house with an open arcade
    civic_fishery      de vissershut (113): a fisherman's timber hut on the shore

None of them has a part that moves, so each is drawn whole by one branch of `civic()` in
web/js/buildings.js, the way the shops are. The set's `building_height` is the warehouse's gable;
the island asks each asset for its own rise instead, because three buildings of 1.2, 3.4 and 3.8
share this one number.

The scale is the village's: a settler is 0.43 tall, the town hall's door 0.72, a shop's ground
floor about 0.66, a storey upstairs 0.62. Doors and windows are at a person's size and the
buildings are a little lower than life, so a warehouse of four storeys and a spout gable comes
out at 3.8 where the real ones on the Amsterdam canals are nearer twenty metres - five of ours.

The warehouse. A canal warehouse is a brick box one bay wide and several deep, and everything
that makes it a warehouse is on its front: a column of loading doors up the middle (luiken, two
wooden leaves each, green, some open on a dark hold), a window either side on every floor, iron
wall anchors where the floor beams end, and above the eaves a spout gable (tuitgevel) - rakes
coped in sandstone climbing to a narrow spout with a round stone head. Out of the top of the spout
comes the hoisting beam (hijsbalk) under its little hood, with a pulley and a rope, and a crate
halfway up the front on its way to the second floor, whose leaves stand open for it. At its foot
crates, barrels and sacks, either side of the door and never in front of it. The rakes are
pitched with the roof, and the roof's ridge runs back from the spout, which hides it; the gable's
corners start 0.12 above the eaves so the rakes clear the tiles all the way up. The body is 1.28
wide and 1.80 deep - narrow and tall, 3.8 to the head of the spout - and the lot's reach is spent
on depth and on the crates in front, which stop at z 1.25.

The weigh house. The Dutch waag is small and public: an open arcade on the ground floor where the
great beam scale (balans) hangs and goods are weighed, a room over it, a stepped gable (trapgevel)
to the street, and a turret on the ridge with the bell that rang the market open. The arcade is
dressed stone - three round arches in front, the middle one widest because the scale hangs in it,
one more in each side - with a keystone to each arch, and it is modelled open: a floor, a ceiling,
the weighmaster's wall at the back with his door, and inside it the scale on its hanger, a wooden
pan at each end of the beam, cheese on one and brass weights on the other, iron weights and a
stack of cheeses on the floor. Above it brick, windows with opened shutters in the town's red and
cream, a stepped gable of five courses coped in stone with the town's shield in it, and the turret:
a lead-clad base astride the ridge, an open bell chamber on four posts with the bell in it, and a
patinated spire with a gilded ball and vane - the town hall's copper again. 1.68 wide, 1.34 deep,
the gable 2.86, the vane 3.4.

The fisherman's hut. A low clapboard hut under pantiles with a stone smokehouse against its end
and a brick chimney out of that, which is where `anchor.smoke` is: the fish are smoked all day.
Round it what a fisherman keeps on the shore - nets drying on three poles with cork floats along
their heads and one heaped at their feet, a rack of fish hung by the tail to dry, a rowing boat
pulled up bow first beside the hut with its oars across the thwarts, a barrel of herring and a
lidded one, lobster pots stacked by the smokehouse, a lantern by the door. The hut's door is in the
middle of the lot's front so the path arrives at it; the boat, the rack and everything else stand
off that line. 2.4 across the lot, 1.2 to the chimney pot.

What the three share, and why the shapes are as coarse as they are:
  - One material each, one draw call: the sheet is the material's name prefix, and night glow is a
    material of its own (`emissive`), a lit pane just in front of a dark one, as on every shop.
  - Faces nobody sees are left off (`drop`): the backs of boards on a wall, the undersides of what
    stands on the ground, the end of a roof run in under a gable. Panes, anchors and frames are flat
    polygons, because they are only ever seen from the front. Cloth - the nets - is one polygon with
    a face each way, because the building material culls back faces.
  - Everything low enough to walk into (below WALK_CLEARANCE, 0.55) is its own object, and the
    island walks round these three part by part (APART in buildings.js), so a crate beside the door
    is a crate and not a wall across it.
  - Every convex piece is wound outwards by `solid`, every flat one by the normal it is given.

Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/harbourhouses'
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


# ---- the palette ---------------------------------------------------------------------------
# The village's own: the tavern's terracotta and its lighter ridge, its brick and oak, the shops'
# plaster, footing and dressed stone, the town hall's patina. Only the paint is the harbour's.
TILES = material('roof', 'harbour tiles', 0xb8552f)
RIDGE_TILE = material('roof', 'harbour ridge', 0xc76b3d)
BRICK = material('stone', 'harbour brick', 0x9c5a44)
DEEP_BRICK = material('stone', 'warehouse brick', 0x8c4d3a)   # the warehouse's, a shade deeper
SANDSTONE = material('stone', 'harbour sandstone', 0xcdbf9f)
DRESSED = material('stone', 'harbour dressed stone', 0xc4b89f)
HARDSTONE = material('stone', 'harbour blue stone', 0x7f8384)
FOOTING = material('stone', 'harbour footing', 0x8f8c86)
PLASTER = material('wall', 'harbour plaster', 0xe8d4ad)
TIMBER = material('plank', 'harbour timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'harbour timber', 0x6a4426)
OAK = material('plank', 'harbour oak', 0x845335)
PINE = material('plank', 'harbour crate pine', 0xa27a4c)
PINE_Z = material('plankZ', 'harbour crate pine', 0xa27a4c)
GREEN = material('plank', 'harbour shutter green', 0x2f5b40)
FRAME = material('plain', 'harbour white frame', 0xf0e6d0)
CREAM = material('plank', 'harbour cream', 0xf2e8d8)
RED = material('plank', 'harbour shutter red', 0xb3362e)
GLASS = material('plain', 'harbour window', 0x2b3036)
GLOW = material('plain', 'harbour lit window', 0xffd488, emissive=True)
DARK = material('plain', 'harbour hold', 0x1e1813)
IRON = material('plain', 'harbour iron', 0x343638)
ROPE = material('plain', 'harbour rope', 0xc2a875)
SACK = material('plain', 'harbour sack', 0xb99a68)
SACK_PALE = material('plain', 'harbour pale sack', 0xd8c7a0)
LEAD = material('plain', 'harbour lead', 0x7c8589)
PATINA = material('plain', 'harbour patina', 0x4f7d6a)
GOLD = material('plain', 'harbour gold', 0xc9a044)
BRONZE = material('plain', 'harbour bell', 0xa9843a)
CHEESE = material('plain', 'harbour cheese', 0xe6b73e)
SHIELD = material('plain', 'harbour shield', 0xb3362e)
# The fisherman's: weathered clapboard, a boat in the library's teal, nets, cork, fish.
BOARDS = material('plank', 'fishery boards', 0x6b5540)
BOARDS_Z = material('plankZ', 'fishery boards', 0x6b5540)
HULL = material('plank', 'fishery hull', 0x3f7474)
HULL_IN = material('plankZ', 'fishery hull inside', 0x8a6a48)
NET = material('plain', 'fishery tanned net', 0x8e6440)
CORK = material('plain', 'fishery cork float', 0xeee3c8)
FISH = material('plain', 'fishery fresh fish', 0xb9c2c6)
SMOKED = material('plain', 'fishery smoked fish', 0xc28a45)
WICKER = material('plain', 'fishery pot netting', 0xa89266)
EMBER = material('plain', 'fishery embers', 0xff8636, emissive=True)


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
        """A convex solid (or some of its faces), every face turned away from its middle: the
        building material culls back faces, so a face wound the wrong way is a hole."""
        pts = [Vector(p) for p in points]
        mid = sum(pts, Vector()) / len(pts)
        out = []
        for f in faces:
            fp = [pts[i] for i in f]
            centre = sum(fp, Vector()) / len(fp)
            out.append(list(f) if newell(fp).dot(centre - mid) >= 0 else list(f)[::-1])
        self.add(pts, out, mat)

    def flat(self, points, normal, mat):
        """One planar polygon facing `normal`: a pane, an anchor, a painted face."""
        pts = [Vector(p) for p in points]
        f = list(range(len(pts)))
        self.add(pts, [f if newell(pts).dot(Vector(normal)) >= 0 else f[::-1]], mat)

    def cloth(self, points, mat):
        """A polygon with a face each way: a net, a flag, a fish."""
        f = list(range(len(points)))
        self.add(points, [f, f[::-1]], mat)

    def top(self):
        return max(v.y for v in self.verts) + self.origin.y

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


def beam(part, a, b, width, depth, mat, side=(0, 0, 1), ends=True):
    """A timber, a rope or a chain from a to b: `depth` along `side`, `width` across both."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    s = Vector(side)
    s = (s - d * s.dot(d)).normalized()
    u = d.cross(s).normalized()
    ring = lambda p: [p + s * (i * depth / 2) + u * (j * width / 2) for i, j in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    faces = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
    if ends:
        faces += [[0, 1, 2, 3], [4, 5, 6, 7]]
    part.solid(ring(a) + ring(b), faces, mat)


def prism(part, base, vec, mat, back=True):
    """A convex outline pushed along `vec`. `back=False` leaves off the cap it started from."""
    n = len(base)
    base = [Vector(p) for p in base]
    top = [p + Vector(vec) for p in base]
    faces = [list(range(n, 2 * n))] + [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    if back:
        faces.append(list(range(n)))
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


def cylinder(part, a, b, r, mat, sides=6, caps=(False, False), turn=0.0):
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(turn + 2 * math.pi * i / sides) + v * math.sin(turn + 2 * math.pi * i / sides)) * r for i in range(sides)]
    faces = [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)]
    if caps[0]:
        faces.append(list(range(sides)))
    if caps[1]:
        faces.append(list(range(sides, 2 * sides)))
    part.solid(ring(a) + ring(b), faces, mat)


def ring_at(c, r, y, sides, turn=0.0):
    return [Vector((c[0] + r * math.cos(turn + 2 * math.pi * i / sides), y, c[2] + r * math.sin(turn + 2 * math.pi * i / sides))) for i in range(sides)]


def frustum(part, c, r0, r1, h, mat, sides=6, top=True, turn=0.0):
    """Upright and round, wider at the foot than the head (or the other way): a weight, a
    cheese, a bell. No bottom, because everything of this kind stands on something."""
    lo, hi = ring_at(c, r0, c[1], sides, turn), ring_at(c, r1, c[1] + h, sides, turn)
    faces = [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)]
    if top:
        faces.append(list(range(sides, 2 * sides)))
    part.solid(lo + hi, faces, mat)


def cone(part, c, r, h, mat, sides=8, turn=0.0):
    """A spire: a ring and a point, and nothing underneath."""
    pts = ring_at(c, r, c[1], sides, turn) + [Vector((c[0], c[1] + h, c[2]))]
    part.solid(pts + [Vector((c[0], c[1] - 0.001, c[2]))], [[i, (i + 1) % sides, sides] for i in range(sides)], mat)


def barrel(part, c, r, h, mat, hoop, lid=None, sides=6, turn=0.3):
    """Staves bellied out at the middle, one iron hoop under the rim, a lid (or what is in it)."""
    rings = [ring_at(c, r * 0.86, c[1], sides, turn), ring_at(c, r, c[1] + h * 0.5, sides, turn), ring_at(c, r * 0.86, c[1] + h, sides, turn)]
    for lo, hi in zip(rings, rings[1:]):
        part.solid(lo + hi, [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    part.flat(rings[2] if lid is None else ring_at(c, r * 0.8, c[1] + h - 0.025, sides, turn), (0, 1, 0), lid or mat)
    band = [ring_at(c, r * 0.93, c[1] + h * 0.78, sides, turn), ring_at(c, r * 0.905, c[1] + h * 0.86, sides, turn)]
    part.solid(band[0] + band[1], [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], hoop)


def lump(part, c, w, d, h, mat, ry=0.0):
    """A block drawn in at the top: a heap of net, or the body of a sack."""
    m = rotation(ry=ry)
    lo = [Vector(c) + m @ Vector((x * w / 2, 0, z * d / 2)) for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    hi = [Vector(c) + m @ Vector((x * w * 0.34, h, z * d * 0.34)) for x, z in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    part.solid(lo + hi, [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7], [4, 5, 6, 7]], mat)


def mound(part, c, w, d, h, mat, sides=6, ry=0.0):
    """A soft heap on the ground - a net somebody has dropped - round rather than a block."""
    m = rotation(ry=ry)
    ring = lambda k, y: [Vector(c) + m @ Vector((k * w / 2 * math.cos(2 * math.pi * i / sides), y, k * d / 2 * math.sin(2 * math.pi * i / sides)))
                         for i in range(sides)]
    bands = [ring(1, 0), ring(.72, h * .62), ring(.3, h)]
    for lo, hi in zip(bands, bands[1:]):
        part.solid(lo + hi, [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    part.flat(bands[-1], (0, 1, 0), mat)


def sack(part, c, w, d, h, mat, ry=0.0):
    """A filled sack, and its tied neck."""
    lump(part, c, w, d, h, mat, ry)
    box(part, Vector(c) + Vector((0, h + 0.012, 0)), (w * 0.2, 0.03, d * 0.2), mat, ry=ry, drop=('bottom',))


class Face:
    """One wall of a building seen from outside: `u` runs to the right along it, `y` up, and `d`
    out of it. Windows, doors and anchors are written in this frame, so a window on the back is
    the same call as a window on the front."""
    NAMES = {(0, 0, -1): 'back', (0, 0, 1): 'front', (-1, 0, 0): 'left', (1, 0, 0): 'right'}

    def __init__(self, origin, u, n):
        self.o, self.u, self.n = Vector(origin), Vector(u), Vector(n)

    def p(self, u, y, d=0.0):
        return self.o + self.u * u + Vector((0, y, 0)) + self.n * d

    def pane(self, part, u0, u1, y0, y1, d, mat):
        part.flat([self.p(u0, y0, d), self.p(u1, y0, d), self.p(u1, y1, d), self.p(u0, y1, d)], self.n, mat)

    def poly(self, part, pts, d, mat):
        part.flat([self.p(u, y, d) for u, y in pts], self.n, mat)

    def block(self, part, u0, u1, y0, y1, d0, d1, mat, drop=()):
        a, b = self.p(u0, y0, d0), self.p(u1, y1, d1)
        lo = [min(a[k], b[k]) for k in range(3)]
        hi = [max(a[k], b[k]) for k in range(3)]
        # `drop` in the wall's own words, 'back' being the side against the wall.
        world = {'back': -self.n, 'front': self.n, 'left': -self.u, 'right': self.u}
        names = []
        for k in drop:
            if k in ('top', 'bottom'):
                names.append(k)
            else:
                v = world[k]
                names.append(self.NAMES[(round(v.x), round(v.y), round(v.z))])
        span(part, lo, hi, mat, drop=names)


def window(part, f, cu, y0, y1, w, cross=True, bars=0, stone=SANDSTONE, lit=True):
    """A dark pane with a lit one just in front of it, a painted frame, a stone lintel and sill."""
    f.pane(part, cu - w / 2, cu + w / 2, y0, y1, .004, GLASS)
    if lit:
        f.pane(part, cu - w / 2 + .022, cu + w / 2 - .022, y0 + .022, y1 - .022, .007, GLOW)
    if cross:
        f.pane(part, cu - .008, cu + .008, y0 + .015, y1 - .015, .010, FRAME)
        ym = y0 + (y1 - y0) * .62
        f.pane(part, cu - w / 2 + .015, cu + w / 2 - .015, ym - .008, ym + .008, .010, FRAME)
    for k in range(bars):
        bu = cu - w / 2 + w * (k + 1) / (bars + 1)
        f.pane(part, bu - .006, bu + .006, y0 + .01, y1 - .01, .012, IRON)
    f.block(part, cu - w / 2 - .03, cu + w / 2 + .03, y1, y1 + .04, -.005, .03, stone, drop=('back', 'bottom'))
    f.block(part, cu - w / 2 - .02, cu + w / 2 + .02, y0 - .03, y0, -.005, .04, stone, drop=('back', 'bottom'))


def anchor(part, f, cu, yc, h=0.13):
    """A wall anchor: the iron end of a floor beam, tied through the brick."""
    f.pane(part, cu - .011, cu + .011, yc - h / 2, yc + h / 2, .006, IRON)


def empty(asset, name, at):
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = xyz(at)
    asset.objects.link(e)


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def arcade(part, f, cu, r, spring, top, depth, mat, segs=6, key=None):
    """The wall over one round arch, `depth` thick behind face f: its front, its back and the
    soffit of the arch between them. Below the springing the piers either side are the wall."""
    pts = [(cu + r * math.cos(math.pi * k / segs), spring + r * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
    for (u0, y0), (u1, y1) in zip(pts, pts[1:]):
        part.flat([f.p(u0, y0), f.p(u1, y1), f.p(u1, top), f.p(u0, top)], f.n, mat)
        part.flat([f.p(u0, y0, -depth), f.p(u1, y1, -depth), f.p(u1, top, -depth), f.p(u0, top, -depth)], -f.n, mat)
        inward = f.u * (cu - (u0 + u1) / 2) + Vector((0, spring - (y0 + y1) / 2, 0))
        part.flat([f.p(u0, y0), f.p(u1, y1), f.p(u1, y1, -depth), f.p(u0, y0, -depth)], inward, mat)
    if key:
        f.block(part, cu - .035, cu + .035, spring + r - .035, spring + r + .055, -.005, .02, key, drop=('back',))


def lantern(part, f, cu, y, d=0.0):
    """A wall lantern on an iron arm, lit after dark."""
    f.block(part, cu - .01, cu + .01, y + .1, y + .12, d, d + .07, IRON)
    f.block(part, cu - .03, cu + .03, y, y + .015, d + .04, d + .10, IRON)
    f.block(part, cu - .025, cu + .025, y + .015, y + .08, d + .045, d + .095, GLOW, drop=('bottom',))
    f.block(part, cu - .035, cu + .035, y + .08, y + .1, d + .035, d + .105, IRON, drop=('bottom',))


def shutters(part, f, cu, y0, y1, w):
    """A window's two leaves swung open against the brick, in the town's red and cream: each
    leaf halved corner to corner, the way the shutters of a public building are painted."""
    lw = w / 2
    for s in (-1, 1):
        a, b = cu + s * (w / 2 + .03), cu + s * (w / 2 + .03 + lw)
        u0, u1 = min(a, b), max(a, b)
        f.block(part, u0, u1, y0, y1, 0, .014, RED, drop=('back',))
        f.poly(part, [(u0, y0), (u1, y0), (u1, y1)] if s > 0 else [(u0, y0), (u1, y0), (u0, y1)], .018, CREAM)


def ball(part, c, r, mat):
    c = Vector(c)
    pts = [c + Vector(v) * r for v in ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))]
    part.solid(pts, [[0, 2, 4], [4, 2, 1], [1, 2, 5], [5, 2, 0], [0, 4, 3], [4, 1, 3], [1, 5, 3], [5, 0, 3]], mat)


# =============================================================================================
# The warehouse
# =============================================================================================
WH = collection('civic_warehouse')
W_X = 0.64                       # the side walls: 1.28 across
W_ZF, W_ZB = 0.70, -1.10         # the front to the water, the back; 1.80 deep
W_PLINTH = 0.10
W_STOREYS = (0.10, 0.76, 1.38, 2.00)   # the floor of each storey; the ground floor is taller
W_EAVES = 2.62
W_CORNER = 2.74                  # where the rakes start, a little over the eaves
W_XS, W_YS = 0.26, 3.30          # the shoulders, where the spout rises out of the gable
W_YT = 3.54                      # the spout's straight sides end and its stone head begins
W_GT = 0.12                      # the gable's thickness, which shows above the roof
W_SLOPE = (W_YS - W_CORNER) / (W_X - W_XS)   # 55.8 degrees, and the roof is pitched the same
W_RIDGE = W_EAVES + W_X * W_SLOPE             # the underside of the tiles at the ridge
T = 0.05                         # tile thickness
front = Face((0, 0, W_ZF), (1, 0, 0), (0, 0, 1))
back = Face((0, 0, W_ZB), (-1, 0, 0), (0, 0, -1))
right = Face((W_X, 0, 0), (0, 0, -1), (1, 0, 0))
left = Face((-W_X, 0, 0), (0, 0, 1), (-1, 0, 0))

walls = Part(WH, 'walls')
span(walls, (-W_X, W_PLINTH, W_ZB), (W_X, W_EAVES, W_ZF), DEEP_BRICK, drop=('top', 'bottom'))
span(walls, (-W_X - .02, 0, W_ZB - .02), (W_X + .02, W_PLINTH, W_ZF + .02), HARDSTONE, drop=('bottom',))
# The gable: a trapezoid to the shoulders and the spout above it, two convex pieces because the
# outline turns in at the shoulders, and the half-round head in sandstone, standing a little proud.
zg = W_ZF - W_GT
prism(walls, [(-W_X, W_EAVES, zg), (W_X, W_EAVES, zg), (W_X, W_CORNER, zg), (W_XS, W_YS, zg), (-W_XS, W_YS, zg), (-W_X, W_CORNER, zg)],
      (0, 0, W_GT), DEEP_BRICK)
prism(walls, [(-W_XS, W_YS, zg), (W_XS, W_YS, zg), (W_XS, W_YT, zg), (-W_XS, W_YT, zg)], (0, 0, W_GT), DEEP_BRICK)
HEAD = 6
prism(walls, [(W_XS * math.cos(math.pi * k / HEAD), W_YT + W_XS * math.sin(math.pi * k / HEAD), zg - .01) for k in range(HEAD + 1)],
      (0, 0, W_GT + .025), SANDSTONE)
# The back gable is only ever seen from behind.
walls.flat([(W_X, W_EAVES, W_ZB), (-W_X, W_EAVES, W_ZB), (0, W_RIDGE, W_ZB)], (0, 0, -1), DEEP_BRICK)


def rake(part, a, b, t, z0, z1, mat):
    """A stone coping laid along a gable's edge from a to b (x, y), t thick, over z0..z1."""
    a, b = Vector((a[0], a[1], 0)), Vector((b[0], b[1], 0))
    d = (b - a).normalized()
    n = Vector((-d.y, d.x, 0))
    if n.y < 0:
        n = -n
    prism(part, [(p.x, p.y, z0) for p in (a, b, b + n * t, a + n * t)], (0, 0, z1 - z0), mat)


for s in (-1, 1):
    rake(walls, (s * (W_X + .03), W_CORNER - .03 * W_SLOPE), (s * W_XS, W_YS), .05, zg - .015, W_ZF + .02, SANDSTONE)
    # the foot the rake stands on, and the block at the shoulder where the spout begins
    span(walls, (min(s * (W_X - .09), s * (W_X + .035)), W_EAVES - .05, zg - .02), (max(s * (W_X - .09), s * (W_X + .035)), W_CORNER + .01, W_ZF + .03),
         SANDSTONE, drop=('bottom',))
    span(walls, (min(s * W_XS, s * (W_XS + .1)), W_YS - .03, zg - .02), (max(s * W_XS, s * (W_XS + .1)), W_YS + .07, W_ZF + .03), SANDSTONE)
walls.build()

roof = Part(WH, 'roof')
OX = 0.06
zf, zb = zg, W_ZB - 0.06
cap = T * math.sqrt(1 + W_SLOPE ** 2)
for s in (-1, 1):
    xe, ye = s * (W_X + OX), W_EAVES - OX * W_SLOPE
    # The front end is hidden against the gable's back and the ridge edge under the cap.
    pitch(roof, [(xe, ye, zb), (0, W_RIDGE, zb), (0, W_RIDGE, zf), (xe, ye, zf)], T, TILES, hide=(1, 2))
    # a timber fascia along the eave, so the roof has an edge seen from the quay
    span(roof, (min(s * (W_X + .005), s * (W_X + .03)), W_EAVES - .09, zb + .02), (max(s * (W_X + .005), s * (W_X + .03)), W_EAVES - .02, zf),
         TIMBER_Z, drop=('top',))
box(roof, (0, W_RIDGE + cap - .005, (zf + zb) / 2), (.07, .05, zf - zb), RIDGE_TILE, drop=('front',))
roof.build()

# ---- the front: the door, the loading doors, the windows -------------------------------------
face = Part(WH, 'front')
# The door: two green leaves under a lit fanlight, in a blue-stone frame, on a step.
DW, DT = 0.16, 0.62
front.block(face, -DW - .04, -DW, W_PLINTH, DT + .05, -.005, .03, HARDSTONE, drop=('back', 'bottom'))
front.block(face, DW, DW + .04, W_PLINTH, DT + .05, -.005, .03, HARDSTONE, drop=('back', 'bottom'))
front.block(face, -DW - .04, DW + .04, DT, DT + .05, -.005, .035, HARDSTONE, drop=('back', 'bottom'))
for s in (-1, 1):
    front.block(face, min(s * .004, s * DW), max(s * .004, s * DW), W_PLINTH, .52, 0, .018, GREEN, drop=('back', 'bottom'))
front.pane(face, -DW, DW, .52, DT, .004, GLASS)
front.pane(face, -DW + .02, DW - .02, .535, DT - .015, .007, GLOW)
front.pane(face, -.007, .007, .52, DT, .01, FRAME)
front.block(face, -DW - .06, DW + .06, 0, .05, 0, .09, HARDSTONE, drop=('back', 'bottom'))
# Either side a barred window, and over the door the name board: a plank and a dark inlay.
for s in (-1, 1):
    window(face, front, s * 0.44, 0.24, 0.52, 0.18, cross=False, bars=2)
front.block(face, -.30, .30, .675, .745, 0, .02, OAK, drop=('back', 'bottom'))
front.pane(face, -.25, .25, .69, .73, .022, DARK)


def hatch(part, f, cu, y0, y1, w, opened):
    """A loading door (luik): a dark hold behind two green leaves, in a painted frame under a
    sandstone lintel. Open, the leaves are swung right back against the brick either side."""
    f.pane(part, cu - w / 2, cu + w / 2, y0, y1, .003, DARK)
    f.poly(part, [(cu - w / 2 - .022, y0), (cu - w / 2, y0), (cu - w / 2, y1), (cu - w / 2 - .022, y1)], .005, FRAME)
    f.poly(part, [(cu + w / 2, y0), (cu + w / 2 + .022, y0), (cu + w / 2 + .022, y1), (cu + w / 2, y1)], .005, FRAME)
    f.block(part, cu - w / 2 - .035, cu + w / 2 + .035, y1, y1 + .045, -.005, .03, SANDSTONE, drop=('back', 'bottom'))
    f.block(part, cu - w / 2 - .03, cu + w / 2 + .03, y0 - .03, y0, -.005, .035, SANDSTONE, drop=('back', 'bottom'))
    for s in (-1, 1):
        if opened:
            a, b = cu + s * (w / 2 + .024), cu + s * (w + .024)
        else:
            a, b = cu + s * .004, cu + s * w / 2
        f.block(part, min(a, b), max(a, b), y0 + .005, y1 - .005, 0, .018, GREEN, drop=('back',))


# Up the middle a loading door to every floor, the second standing open for the crate on the rope;
# a window either side of each. The attic's hatch is in the gable, right under the beam, and open.
for n, y in enumerate(W_STOREYS[1:], start=1):
    hatch(face, front, 0, y + .08, y + .48, .26, opened=(n == 2))
    for s in (-1, 1):
        window(face, front, s * 0.44, y + .12, y + .42, 0.18)
hatch(face, front, 0, W_EAVES + .08, W_EAVES + .44, .24, opened=True)
# A little oval of glass in the spout, over the beam.
front.poly(face, [(.05 * math.cos(2 * math.pi * k / 8), 3.64 + .065 * math.sin(2 * math.pi * k / 8)) for k in range(8)], .004, GLASS)
front.poly(face, [(.032 * math.cos(2 * math.pi * k / 8), 3.64 + .045 * math.sin(2 * math.pi * k / 8)) for k in range(8)], .008, GLOW)
# The iron anchors where the floor beams end, one near each edge of every floor line.
for y in W_STOREYS[1:] + (W_EAVES,):
    for s in (-1, 1):
        anchor(face, front, s * 0.585, y - 0.02)
# A lantern on an iron arm beside the door.
lantern(face, front, .235, .40)
face.build()

# ---- the sides and the back: plain brick, a window to each floor, the anchors ---------------
sides = Part(WH, 'sides')
for f in (left, right):
    for y in W_STOREYS[1:]:
        window(sides, f, 0.15, y + .14, y + .40, 0.15, cross=False)
    for y in W_STOREYS[1:] + (W_EAVES,):
        for u in (-0.62, 0.62):
            anchor(sides, f, u, y - 0.02)
for y in (W_STOREYS[1], W_STOREYS[3]):
    window(sides, back, 0, y + .14, y + .42, 0.18, cross=True)
sides.build()

# ---- the hoist: the beam out of the spout, its hood, the pulley, the rope and a crate on it --
hoist = Part(WH, 'hoist')
BY = 3.40
TIP = W_ZF + 0.44
span(hoist, (-.035, BY - .035, W_ZF), (.035, BY + .035, TIP), TIMBER, drop=('back',))
for s in (-1, 1):
    pitch(hoist, [(s * .085, BY + .05, W_ZF), (0, BY + .13, W_ZF), (0, BY + .13, TIP + .05), (s * .085, BY + .05, TIP + .05)], .018, TIMBER, hide=(1,))
hoist.flat([(-.085, BY + .05, TIP + .05), (.085, BY + .05, TIP + .05), (0, BY + .13, TIP + .05)], (0, 0, 1), TIMBER)
PZ = TIP - .035
span(hoist, (-.022, BY - .085, PZ - .03), (.022, BY - .035, PZ + .03), IRON, drop=('top',))
cylinder(hoist, (-.012, BY - .115, PZ), (.012, BY - .115, PZ), .045, IRON, sides=8, caps=(True, True))
RZ = PZ + .045
HOOK = 1.99
beam(hoist, (0, BY - .115, RZ), (0, HOOK, RZ), .014, .014, ROPE, ends=False)
span(hoist, (-.012, HOOK - .04, RZ - .012), (.012, HOOK, RZ + .012), IRON)
CRATE_Y = 1.64
for s in (-1, 1):
    beam(hoist, (0, HOOK - .035, RZ), (s * .1, CRATE_Y + .18, RZ), .01, .01, ROPE, ends=False)
span(hoist, (-.11, CRATE_Y, RZ - .1), (.11, CRATE_Y + .18, RZ + .1), PINE)
hoist.build()

# ---- at its foot: crates on the left, barrels and sacks on the right -------------------------
crates = Part(WH, 'crates')
box(crates, (-0.38, .11, W_ZF + .15), (.22, .22, .22), PINE, drop=('bottom',))
box(crates, (-0.60, .12, W_ZF + .23), (.24, .24, .24), PINE_Z, ry=.18, drop=('bottom',))
box(crates, (-0.58, .24 + .095, W_ZF + .22), (.19, .19, .19), PINE, ry=-.12, drop=('bottom',))
sack(crates, (-0.38, .22, W_ZF + .15), .15, .11, .12, SACK_PALE, ry=.3)
crates.build()
barrels = Part(WH, 'barrels')
barrel(barrels, (0.38, 0, W_ZF + .14), .09, .25, OAK, IRON)
barrel(barrels, (0.58, 0, W_ZF + .20), .095, .26, OAK, IRON, lid=TIMBER)
barrels.build()
sacks = Part(WH, 'sacks')
sack(sacks, (0.40, 0, W_ZF + .40), .16, .12, .15, SACK, ry=.4)
sack(sacks, (0.57, 0, W_ZF + .44), .15, .12, .14, SACK_PALE, ry=-.3)
sacks.build()

empty(WH, 'door', (0, 0, W_ZF + .1))
W_TOP = max(W_YT + W_XS, BY + .13 + .018)     # the spout's head, over the hood of the beam


# =============================================================================================
# The weigh house
# =============================================================================================
WG = collection('civic_weighhouse')
G_X = 0.84
G_ZF, G_ZB = 0.72, -0.62
G_WT = 0.10                       # the walls' thickness, which the arches show
G_PL = 0.05                       # the footing, whose top is the hall's floor
G_GF = 0.92                       # the arcade's height, and the floor of the room over it
G_EAVES = 1.52
G_SLOPE = 1.0                     # 45 degrees, under a stepped gable that clears it
G_RIDGE = G_EAVES + G_X * G_SLOPE
G_GT = 0.12                       # the stepped gable's thickness
G_INNER = -0.12                   # the weighmaster's wall, the back of the hall
G_SCALE = 0.28                    # where the beam scale hangs, in the middle of the hall
gfront = Face((0, 0, G_ZF), (1, 0, 0), (0, 0, 1))
gback = Face((0, 0, G_ZB), (-1, 0, 0), (0, 0, -1))
gright = Face((G_X, 0, 0), (0, 0, -1), (1, 0, 0))
gleft = Face((-G_X, 0, 0), (0, 0, 1), (-1, 0, 0))


# ---- the arcade: dressed stone, three arches to the front and one to each side --------------
arc = Part(WG, 'arcade')
span(arc, (-G_X - .02, 0, G_ZB - .02), (G_X + .02, G_PL, G_ZF + .02), FOOTING, drop=('bottom',))
FRONT_ARCHES = ((-0.57, 0.17, 0.56), (0.0, 0.27, 0.50), (0.57, 0.17, 0.56))   # centre, radius, springing
SIDE_ARCH = (0.22, 0.25, 0.52)                                                   # centre (z), radius, springing
for s in (-1, 1):
    # the piers between the front arches, the corners, and the closed back half of each side
    span(arc, (min(s * .27, s * .40), G_PL, G_ZF - G_WT), (max(s * .27, s * .40), G_GF, G_ZF), DRESSED, drop=('top', 'bottom'))
    z1 = SIDE_ARCH[0] + SIDE_ARCH[1]
    span(arc, (min(s * (G_X - G_WT), s * G_X), G_PL, z1), (max(s * (G_X - G_WT), s * G_X), G_GF, G_ZF), DRESSED, drop=('top', 'bottom'))
    z0 = SIDE_ARCH[0] - SIDE_ARCH[1]
    span(arc, (min(s * (G_X - G_WT), s * G_X), G_PL, G_ZB), (max(s * (G_X - G_WT), s * G_X), G_GF, z0), DRESSED, drop=('top', 'bottom'))
for cu, r, spring in FRONT_ARCHES:
    arcade(arc, gfront, cu, r, spring, G_GF, G_WT, DRESSED, key=SANDSTONE)
arcade(arc, gright, -SIDE_ARCH[0], SIDE_ARCH[1], SIDE_ARCH[2], G_GF, G_WT, DRESSED, key=SANDSTONE)
arcade(arc, gleft, SIDE_ARCH[0], SIDE_ARCH[1], SIDE_ARCH[2], G_GF, G_WT, DRESSED, key=SANDSTONE)
# The weighmaster's wall at the back of the hall, with his door and the board of what things cost.
span(arc, (-G_X + G_WT, G_PL, G_INNER - .1), (G_X - G_WT, G_GF, G_INNER), PLASTER, drop=('top', 'bottom'))
inner = Face((0, 0, G_INNER), (1, 0, 0), (0, 0, 1))
inner.block(arc, .26, .46, G_PL, .50, 0, .015, TIMBER, drop=('back', 'bottom'))
inner.block(arc, .24, .48, .50, .53, 0, .02, OAK, drop=('back', 'bottom'))
inner.block(arc, -.46, -.22, .40, .58, 0, .015, OAK, drop=('back', 'bottom'))
inner.pane(arc, -.43, -.25, .42, .56, .017, DARK)
# His office behind it is shut: a back wall between the sides, with his own door and a window.
span(arc, (-G_X + G_WT, G_PL, G_ZB), (G_X - G_WT, G_GF, G_ZB + G_WT), DRESSED, drop=('top', 'bottom'))
gback.block(arc, .20, .40, G_PL, .52, 0, .015, TIMBER, drop=('back', 'bottom'))
gback.block(arc, .18, .42, .52, .56, -.005, .025, SANDSTONE, drop=('back', 'bottom'))
window(arc, gback, -.35, .30, .56, .2, cross=False, bars=2)
# The ceiling, boarded, and the beam the scale hangs from.
arc.flat([(-G_X + G_WT, G_GF, G_INNER), (G_X - G_WT, G_GF, G_INNER), (G_X - G_WT, G_GF, G_ZF - G_WT), (-G_X + G_WT, G_GF, G_ZF - G_WT)],
         (0, -1, 0), TIMBER_Z)
span(arc, (-G_X + G_WT, G_GF - .05, G_SCALE - .03), (G_X - G_WT, G_GF, G_SCALE + .03), TIMBER, drop=('top',))
# A lantern either side of the middle arch.
for s in (-1, 1):
    lantern(arc, gfront, s * .335, .56)
arc.build()

# ---- the scale: a beam on its hanger, a pan at each end, cheese against brass ---------------
sc = Part(WG, 'scale')
Z = G_SCALE
span(sc, (-.012, .66, Z - .012), (.012, G_GF - .05, Z + .012), IRON, drop=('top',))
box(sc, (0, .645, Z), (.05, .045, .04), IRON)
span(sc, (-.235, .622, Z - .014), (.235, .642, Z + .014), IRON)
box(sc, (0, .69, Z), (.012, .07, .012), GOLD)          # the tongue that says when it is level
PAN_Y = .15
for s in (-1, 1):
    x = s * .215
    for dx in (-.08, .08):
        beam(sc, (x, .625, Z), (x + dx, PAN_Y + .02, Z), .01, .01, IRON, ends=False)
    span(sc, (x - .09, PAN_Y, Z - .09), (x + .09, PAN_Y + .02, Z + .09), OAK, drop=('bottom',))
frustum(sc, (-.215, PAN_Y + .02, Z), .062, .062, .045, CHEESE, sides=8, top=False)
frustum(sc, (-.21, PAN_Y + .065, Z + .004), .058, .058, .04, CHEESE, sides=8, turn=.2)
frustum(sc, (.215, PAN_Y + .02, Z), .05, .036, .055, GOLD, sides=6)
frustum(sc, (.215, PAN_Y + .075, Z), .03, .022, .04, GOLD, sides=6)
sc.build()

# ---- on the hall's floor: iron weights by the left pier, cheeses stacked by the right -------
wt = Part(WG, 'weights')
for x, w, h in ((-.60, .10, .075), (-.48, .08, .06), (-.38, .065, .05)):
    span(wt, (x - w / 2, G_PL, .04 - w * .4), (x + w / 2, G_PL + h, .04 + w * .4), IRON, drop=('bottom',))
    span(wt, (x - w * .28, G_PL + h, .04 - .006), (x + w * .28, G_PL + h + .018, .04 + .006), IRON, drop=('bottom',))
for k in range(3):
    frustum(wt, (.55 + .006 * k, G_PL + k * .046, .06), .068, .068, .046, CHEESE, sides=8, top=(k == 2), turn=k * .3)
wt.build()

# ---- the room over it: brick, a stone string course, shuttered windows ---------------------
hs = Part(WG, 'house')
span(hs, (-G_X, G_GF, G_ZB), (G_X, G_EAVES, G_ZF), BRICK, drop=('top', 'bottom'))
span(hs, (-G_X - .025, G_GF - .02, G_ZB - .025), (G_X + .025, G_GF + .035, G_ZF + .025), DRESSED, drop=('bottom',))
for s in (-1, 1):
    window(hs, gfront, s * .42, 1.04, 1.40, .26)
    shutters(hs, gfront, s * .42, 1.04, 1.40, .26)
    window(hs, gback, s * .42, 1.06, 1.38, .22)
for f in (gleft, gright):
    for u in (-.30, .30):
        window(hs, f, u, 1.06, 1.38, .2)
    anchor(hs, f, -.66, 1.46)
    anchor(hs, f, .56, 1.46)
hs.build()

# ---- the stepped gable: five courses, each coped in stone, the town's shield in it ----------
gb = Part(WG, 'gable')
LEVELS = ((G_EAVES, 1.80, G_X), (1.80, 2.06, 0.66), (2.06, 2.32, 0.48), (2.32, 2.58, 0.30), (2.58, 2.86, 0.14))
gz0 = G_ZF - G_GT
for y0, y1, hw in LEVELS:
    span(gb, (-hw, y0, gz0), (hw, y1, G_ZF), BRICK, drop=('bottom', 'top'))
for k, (y0, y1, hw) in enumerate(LEVELS):
    nxt = LEVELS[k + 1][2] if k + 1 < len(LEVELS) else None
    if nxt is None:
        span(gb, (-hw - .03, y1, gz0 - .02), (hw + .03, y1 + .05, G_ZF + .025), DRESSED, drop=('bottom',))
    else:
        for s in (-1, 1):
            a, b = s * nxt, s * (hw + .03)
            span(gb, (min(a, b), y1, gz0 - .02), (max(a, b), y1 + .045, G_ZF + .025), DRESSED, drop=('bottom',))
GTOP = LEVELS[-1][1] + .05
span(gb, (-.035, GTOP, G_ZF - G_GT / 2 - .035), (.035, GTOP + .05, G_ZF - G_GT / 2 + .035), DRESSED, drop=('bottom',))
cone(gb, (0, GTOP + .05, G_ZF - G_GT / 2), .05, .13, DRESSED, sides=4, turn=math.pi / 4)
for s in (-1, 1):
    window(gb, gfront, s * .36, 1.58, 1.75, .15, cross=False)
    anchor(gb, gfront, s * .72, 1.66)
window(gb, gfront, 0, 1.86, 2.02, .18)
gfront.block(gb, -.09, .09, 2.09, 2.30, 0, .015, DRESSED, drop=('back', 'bottom'))
gfront.poly(gb, [(-.065, 2.275), (.065, 2.275), (.065, 2.17), (0, 2.115), (-.065, 2.17)], .019, SHIELD)
gfront.pane(gb, -.065, .065, 2.205, 2.23, .022, GOLD)
gfront.poly(gb, [(.03 * math.cos(2 * math.pi * k / 6), 2.45 + .03 * math.sin(2 * math.pi * k / 6)) for k in range(6)], .004, DARK)
gb.build()

# ---- the roof, and the turret with the bell on its ridge ------------------------------------
rf = Part(WG, 'roof')
zf, zb = gz0, G_ZB - .06
cap = T * math.sqrt(1 + G_SLOPE ** 2)
for s in (-1, 1):
    xe, ye = s * (G_X + OX), G_EAVES - OX * G_SLOPE
    pitch(rf, [(xe, ye, zb), (0, G_RIDGE, zb), (0, G_RIDGE, zf), (xe, ye, zf)], T, TILES, hide=(1, 2))
    span(rf, (min(s * (G_X + .005), s * (G_X + .03)), G_EAVES - .09, zb + .02), (max(s * (G_X + .005), s * (G_X + .03)), G_EAVES - .02, zf),
         TIMBER_Z, drop=('top',))
box(rf, (0, G_RIDGE + cap - .005, (zf + zb) / 2), (.07, .05, zf - zb), RIDGE_TILE, drop=('front',))
rf.flat([(G_X, G_EAVES, G_ZB), (-G_X, G_EAVES, G_ZB), (0, G_RIDGE, G_ZB)], (0, 0, -1), BRICK)
rf.build()

tr = Part(WG, 'turret')
TZ = -0.24
span(tr, (-.12, 2.14, TZ - .12), (.12, 2.60, TZ + .12), LEAD, drop=('bottom',))
for sx in (-1, 1):
    for sz in (-1, 1):
        span(tr, (sx * .105 - .018, 2.60, TZ + sz * .105 - .018), (sx * .105 + .018, 2.86, TZ + sz * .105 + .018), FRAME, drop=('top', 'bottom'))
span(tr, (-.135, 2.86, TZ - .135), (.135, 2.90, TZ + .135), FRAME)
span(tr, (-.01, 2.755, TZ - .01), (.01, 2.86, TZ + .01), IRON, drop=('top',))
frustum(tr, (0, 2.635, TZ), .058, .03, .12, BRONZE, sides=6)
cone(tr, (0, 2.90, TZ), .20, .36, PATINA, sides=8)
ball(tr, (0, 3.29, TZ), .032, GOLD)
span(tr, (-.006, 3.31, TZ - .006), (.006, 3.42, TZ + .006), IRON, drop=('bottom',))
tr.cloth([(0, 3.355, TZ), (.08, 3.365, TZ), (.08, 3.395, TZ), (0, 3.405, TZ)], GOLD)
tr.build()

empty(WG, 'door', (0, 0, G_ZF + .1))


# =============================================================================================
# The fisherman's hut
# =============================================================================================
FH = collection('civic_fishery')
H_X0, H_X1 = -0.46, 0.46        # the hut's two ends
H_ZB, H_ZF = -1.02, -0.32       # its back, and the front with the door in it
H_FOOT = 0.05
H_EAVES = 0.60
H_ZM = (H_ZB + H_ZF) / 2        # the ridge runs along x, so the door is under an eave
H_SLOPE = math.tan(math.radians(38))
H_RIDGE = H_EAVES + (H_ZF - H_ZM) * H_SLOPE
hfront = Face((0, 0, H_ZF), (1, 0, 0), (0, 0, 1))
hleft = Face((H_X0, 0, 0), (0, 0, 1), (-1, 0, 0))

# ---- the hut: clapboard on a stone footing, under pantiles, a door in the middle ------------
hut = Part(FH, 'hut')
span(hut, (H_X0 - .025, 0, H_ZB - .025), (H_X1 + .025, H_FOOT, H_ZF + .025), FOOTING, drop=('bottom',))
# The boards run along each wall: the long walls on the plank sheet, the ends on plankZ.
span(hut, (H_X0, H_FOOT, H_ZB), (H_X1, H_EAVES, H_ZF), BOARDS, drop=('top', 'bottom', 'left', 'right'))
span(hut, (H_X0, H_FOOT, H_ZB), (H_X1, H_EAVES, H_ZF), BOARDS_Z, drop=('top', 'bottom', 'front', 'back'))
for x, s in ((H_X0, -1), (H_X1, 1)):
    hut.flat([(x, H_EAVES, H_ZB), (x, H_EAVES, H_ZF), (x, H_RIDGE, H_ZM)], (s, 0, 0), BOARDS_Z)
    for z in (H_ZB, H_ZF):
        span(hut, (x - .022, H_FOOT, z - .022), (x + .022, H_EAVES, z + .022), TIMBER, drop=('top', 'bottom'))
hfront.block(hut, -.125, .125, H_FOOT, .51, 0, .012, FRAME, drop=('back', 'bottom'))
hfront.block(hut, -.10, .10, H_FOOT, .485, .012, .026, GREEN, drop=('back', 'bottom'))
hfront.pane(hut, -.055, .055, .35, .44, .028, GLASS)
hfront.pane(hut, -.04, .04, .36, .43, .031, GLOW)
span(hut, (-.24, 0, H_ZF), (.24, .045, H_ZF + .20), OAK, drop=('bottom',))
window(hut, hfront, .30, .27, .46, .16, stone=FRAME)
window(hut, hleft, H_ZM, .28, .46, .16, stone=FRAME)
lantern(hut, hfront, -.22, .33)
hut.build()

rfh = Part(FH, 'roof')
OXH, OHZ = .07, .08
for s in (-1, 1):
    ze, ye = H_ZM + s * ((H_ZF - H_ZM) + OHZ), H_EAVES - OHZ * H_SLOPE
    pitch(rfh, [(H_X0 - OXH, ye, ze), (H_X1 + OXH, ye, ze), (H_X1 + OXH, H_RIDGE, H_ZM), (H_X0 - OXH, H_RIDGE, H_ZM)], T, TILES, hide=(2,))
    # white bargeboards up both verges, under the tiles
    for x in (H_X0 - OXH + .012, H_X1 + OXH - .012):
        beam(rfh, (x, ye - .012, ze), (x, H_RIDGE - .012, H_ZM), .024, .045, FRAME, side=(0, 1, 0))
box(rfh, (0, H_RIDGE + T * math.sqrt(1 + H_SLOPE ** 2) - .005, H_ZM), (H_X1 - H_X0 + 2 * OXH + .02, .05, .07), RIDGE_TILE)
rfh.build()

# ---- the smokehouse against the right end, and its chimney: the fish are smoked all day -----
smk = Part(FH, 'smokehouse')
SX0, SX1 = H_X1, H_X1 + .36
SZ0, SZ1 = H_ZB + .06, H_ZB + .46
prism(smk, [(SX0, 0, SZ0), (SX1, 0, SZ0), (SX1, .46, SZ0), (SX0, .56, SZ0)], (0, 0, SZ1 - SZ0), BRICK)
pitch(smk, [(SX0, .56, SZ0 - .05), (SX1 + .05, .445, SZ0 - .05), (SX1 + .05, .445, SZ1 + .05), (SX0, .56, SZ1 + .05)], .04, TILES)
CX, CZ = SX1 - .1, (SZ0 + SZ1) / 2 - .04
span(smk, (CX - .07, .40, CZ - .065), (CX + .07, 1.10, CZ + .065), BRICK, drop=('bottom',))
span(smk, (CX - .09, 1.10, CZ - .085), (CX + .09, 1.145, CZ + .085), DRESSED)
sface = Face((0, 0, SZ1), (1, 0, 0), (0, 0, 1))
sface.block(smk, SX0 + .08, SX1 - .08, .06, .36, 0, .012, IRON, drop=('back', 'bottom'))
sface.pane(smk, SX0 + .12, SX1 - .12, .085, .125, .014, EMBER)
smk.build()

# ---- the nets, drying on three poles behind the boat, cork floats on their heads ------------
# They face the water, as the lot does: strung along z down the side, they were a row of poles
# edge-on to anybody on the quay.
nets = Part(FH, 'nets')
NZ = -1.14
POLES = (-1.22, -0.90, -0.58)
for x in POLES:
    cylinder(nets, (x, 0, NZ), (x, .94, NZ), .022, TIMBER, sides=5, caps=(False, True))


def sag(t, xa, xb, high, low):
    """A point on a line hung between two poles: t from 0 to 1, lowest (and most blown out) in the
    middle."""
    k = 1 - (2 * t - 1) ** 2
    return (xa + (xb - xa) * t, high - (high - low) * k, NZ + .03 * k)


# Each net hangs in folds from its head rope - every other fold stands out from the line of the
# poles - and its foot is ragged where the lead line drags it down. Flat, a net was a curtain.
FOLDS = 5
for xa, xb in zip(POLES, POLES[1:]):
    xa, xb = xa + .03, xb - .03
    top, bot = [], []
    for k in range(FOLDS):
        t, out = k / (FOLDS - 1), k % 2
        x, y, z = sag(t, xa, xb, .88, .80)
        top.append((x, y, z + .02 * out))
        x, y, z = sag(t, xa, xb, .42, .32)
        bot.append((x, y - .035 * out, z + .045 * out))
    for k in range(FOLDS - 1):
        nets.cloth([bot[k], bot[k + 1], top[k + 1], top[k]], NET)
    for x, y, z in top[1:-1]:
        box(nets, (x, y + .004, z + .004), (.036, .028, .03), CORK)
nets.build()
heap = Part(FH, 'heap')
mound(heap, (-0.90, 0, -0.84), .3, .22, .08, NET, ry=.3)
heap.build()

# ---- the rack of fish drying by the tail, at the front on the right, towards the water ------
# Far enough right that from the square's usual angle it stands beside the door, not before it.
rack = Part(FH, 'rack')
RKZ, RX0, RX1, RTOP = 0.80, 0.66, 1.16, 0.70
for x in (RX0, RX1):
    for dz in (-.13, .13):
        beam(rack, (x, .003, RKZ + dz), (x, RTOP + .035, RKZ + dz * .12), .03, .03, TIMBER, side=(1, 0, 0), ends=False)
for y in (RTOP, RTOP - .22):
    beam(rack, (RX0 - .04, y, RKZ), (RX1 + .04, y, RKZ), .026, .026, TIMBER, side=(0, 0, 1))


def fish(part, tail, across, length, mat):
    """One fish hung head down by its tail, flat: the tail's fork, then the body."""
    t, a, down = Vector(tail), Vector(across), Vector((0, 1, 0))
    part.cloth([t - a * .022, t + a * .022, t - down * .03], mat)
    part.cloth([t - down * .03, t + a * .027 - down * .075, t - down * length, t - a * .027 - down * .075], mat)


for i in range(5):
    fish(rack, (RX0 + .05 + i * .1, RTOP - .012, RKZ + .018), (1, 0, 0), .14 + .01 * (i % 2), SMOKED if i % 3 == 1 else FISH)
for i in range(4):
    fish(rack, (RX0 + .10 + i * .1, RTOP - .232, RKZ - .018), (1, 0, 0), .13 + .012 * (i % 2), SMOKED if i % 2 else FISH)
rack.build()

# ---- the rowing boat, pulled up bow first beside the hut, oars across the thwarts -----------
boat = Part(FH, 'boat')
BC = Vector((-0.74, 0, 0.40))
BOAT = rotation(ry=0.22, rz=0.07)          # turned a little, and listing on its keel
# Stations from the bow (up the beach, towards the hut) to the transom (towards the water):
# where along the boat, half its beam, the gunwale's height and the keel's.
STATIONS = ((-0.56, 0.0, .25, .02), (-0.32, .13, .21, 0), (0.02, .175, .20, 0), (0.34, .165, .20, 0), (0.54, .11, .22, .045))


def hull_ring(z, hw, gy, ky, inset=0.0):
    """Gunwale, chine, keel, chine, gunwale across one station, left to right, in the boat's frame."""
    k = 1 - inset
    lift = inset * .25
    return [Vector((-hw * k, gy, z)), Vector((-hw * .68 * k, ky + .06 + lift, z)), Vector((0, ky + lift, z)),
            Vector((hw * .68 * k, ky + .06 + lift, z)), Vector((hw * k, gy, z))]


def placed(p):
    return BC + BOAT @ p


outer = [hull_ring(*s) for s in STATIONS]
inner = [hull_ring(*s, inset=.16) for s in STATIONS]
for a, b, ia, ib in zip(outer, outer[1:], inner, inner[1:]):
    for j in range(4):
        q = [a[j], b[j], b[j + 1], a[j + 1]]
        mid = sum(q, Vector()) / 4
        axis = Vector((0, .13, mid.z))
        boat.flat([placed(p) for p in q], BOAT @ (mid - axis), HULL)
        qi = [ia[j], ib[j], ib[j + 1], ia[j + 1]]
        mid = sum(qi, Vector()) / 4
        boat.flat([placed(p) for p in qi], BOAT @ (Vector((0, .13, mid.z)) - mid), HULL_IN)
    for j in (0, 4):
        boat.flat([placed(p) for p in (a[j], b[j], ib[j], ia[j])], BOAT @ Vector((0, 1, 0)), CREAM)
boat.flat([placed(p) for p in outer[-1]], BOAT @ Vector((0, 0, 1)), HULL)
boat.flat([placed(p) for p in inner[-1]], BOAT @ Vector((0, 0, -1)), HULL_IN)
for z, hw in ((-0.12, .15), (0.26, .15)):
    box(boat, placed(Vector((0, .15, z))), (hw * 2 * .84, .02, .07), OAK, ry=0.22, rz=0.07, drop=('bottom',))
for x in (-.045, .05):
    box(boat, placed(Vector((x, .185, 0.04))), (.024, .022, .92), OAK, ry=0.22, rz=0.07, drop=('bottom',))
    box(boat, placed(Vector((x, .188, 0.47))), (.075, .012, .19), OAK, ry=0.22, rz=0.07, drop=('bottom',))
boat.build()

# ---- by the door: a barrel of herring and a lidded one; lobster pots by the smokehouse ------
kegs = Part(FH, 'barrels')
barrel(kegs, (0.32, 0, H_ZF + .13), .085, .23, OAK, IRON, lid=FISH)
barrel(kegs, (0.49, 0, H_ZF + .06), .08, .21, OAK, IRON, lid=TIMBER)
kegs.build()


def creel(part, c, length, width, h, ry=0.0):
    """A lobster pot: a board base and a half round of netting over it, open at neither end."""
    m, c = rotation(ry=ry), Vector(c)
    at = lambda x, y, z: c + m @ Vector((x, y, z))
    box(part, at(0, .01, 0), (length, .02, width), TIMBER, ry=ry, drop=('bottom',))
    segs = 4
    arc = [(width / 2 * math.cos(math.pi * k / segs), .02 + h * math.sin(math.pi * k / segs)) for k in range(segs + 1)]
    for (z0, y0), (z1, y1) in zip(arc, arc[1:]):
        part.flat([at(-length / 2, y0, z0), at(length / 2, y0, z0), at(length / 2, y1, z1), at(-length / 2, y1, z1)],
                  m @ Vector((0, (y0 + y1) / 2 - .02, (z0 + z1) / 2)), WICKER)
    for s in (-1, 1):
        part.flat([at(s * length / 2, y, z) for z, y in arc], m @ Vector((s, 0, 0)), WICKER)
    # two hoops of wood over the netting, which is what makes it a pot rather than a loaf
    for hx in (-length * .28, length * .28):
        for (z0, y0), (z1, y1) in zip(arc, arc[1:]):
            grow = lambda z, y: (z * 1.05, .02 + (y - .02) * 1.05)
            (za, ya), (zb, yb) = grow(z0, y0), grow(z1, y1)
            part.flat([at(hx - .01, ya, za), at(hx + .01, ya, za), at(hx + .01, yb, zb), at(hx - .01, yb, zb)],
                      m @ Vector((0, (y0 + y1) / 2 - .02, (z0 + z1) / 2)), TIMBER)


pots = Part(FH, 'pots')
creel(pots, (1.01, 0, -0.84), .21, .14, .11, ry=1.62)
creel(pots, (1.00, 0, -0.60), .21, .14, .11, ry=1.45)
creel(pots, (1.00, .13, -0.72), .20, .13, .10, ry=1.55)
pots.build()

empty(FH, 'smoke', (CX, 1.19, CZ))
empty(FH, 'door', (0, 0, H_ZF + .1))


# =============================================================================================
# The set
# =============================================================================================
# The warehouse's spout is the tallest thing in the set; buildings.js asks each asset for its own.
bpy.context.scene['building_height'] = round(W_TOP, 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'harbourhouses.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'harbourhouses'})
