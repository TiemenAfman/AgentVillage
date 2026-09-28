"""The three trades of the ladder past the castle (Plans/ambachten.md,
Plans/mijlpalen-tot-tweehonderd.md). Rebuild with
scripts/blender.mjs --background --python scripts/build-workshops.py.

One set, three buildings, each split into a building and a yard like the sawmill so that no
asset comes near the civic budget of 1500:

    civic_brewery            the brick brewhouse with its tall chimney, the malt loft and its
                             hoist, the open door with the mash tun in the dark behind it, and
                             the lean-to on the right
    civic_brewery_copper     the copper under the lean-to: a brick firebox with the fire in its
                             mouth, the copper and its dome, and the vapour pipe up through the
                             roof - an asset of its own because its `anchor.smoke` is where the
                             steam comes out, and an asset has one anchor of each name
    civic_brewery_yard       the casks on their stillage, the dray with three more roped on,
                             the hop sacks - what a brewery has standing about in front of it
    civic_trainingfield      the fence on the lot line (the stable's paddock rail does the same),
                             the trodden floor, the shelter with its banner and the flagpole
                             main.js flies the island's flag from, the weapon racks, the bales
    civic_trainingfield_yard the straw dummies, the pells, the archery butts and their arrows
    civic_quarry             the rock: three cut benches stepping up into the hill, the rough
                             hill round them, the spoil at their feet
    civic_quarry_yard        the treadwheel crane, the tub on its rail, the cut blocks, the
                             stonecutter's banker, the ladder - and the parts that move, which
                             web/js/quarry.js takes out of the merge and hangs on their own
                             pivots:

        civic_quarry_yard wheel  the treadwheel and the drum the rope winds on, turning about x
                                 at its axle
        civic_quarry_yard jib    the mast and the boom, slewing about y at the mast's foot;
                                 baked pointing at the block it picks up
        civic_quarry_yard rope   from the boom's tip down to the hook; baked as long as it is at
                                 the pick, and drawn as long as quarry.js says
        civic_quarry_yard hook   the lewis at the end of the rope, origin where the rope ties on
        civic_quarry_yard block  one cut block, origin under its middle, baked on the lowest bench
                                 where the crane picks it up; drawn there, under the hook and on
                                 the tub
        civic_quarry_yard tub    the tub on its wheels, origin on the rail, baked at the rail's back
                                 end under where the crane sets a block down

Every moving part has its Blender origin on its own axis, so its baked `at` is the pivot and
quarry.js reads every distance - the drum's radius, the jib's reach, the pick and the drop, how
far the tub runs - off the bake. They live inside the yard for the sawmill's reason: an asset has
to stand on the ground (scripts/model-rules.mjs) and a rope hanging from a boom does not.

The scale is the island's and a settler's (0.43 tall): the brewhouse door is 0.66 high and wide
enough for a cask on a barrow, the treadwheel is 0.72 across so a settler could walk in it, a
dummy is a settler's height, a cask is 0.15 across (60 cm). No letters anywhere: the brewery
hangs a little cask for its sign, the way breweries did before anybody could read.

Written in island coordinates (x right, y up, z to the front, the lot's middle at the origin,
the lot 3 across) through xyz(). Every irregular shape - a rock, a sack of hops - comes out of a
seeded random.Random, so a second bake writes the same bytes.
"""
import bpy
import math
import random
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/workshops'
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
        return obj


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def anchor(asset, name, at):
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = xyz(at)
    asset.objects.link(e)


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


# Every face below winds outward, counter-clockwise seen from outside, because the island draws
# one side of a face only - and Blender's viewport, which draws both, would show a face turned
# inside out as if nothing were wrong. The shapes that are regular wind themselves; `face` is for
# the ones that are not (a rock, a rim), and turns a polygon to look the way it is told to.
def face(part, pts, mat, out):
    pts = [Vector(p) for p in pts]
    n = Vector((0, 0, 0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n += Vector(((a.y - b.y) * (a.z + b.z), (a.z - b.z) * (a.x + b.x), (a.x - b.x) * (a.y + b.y)))
    if n.dot(Vector(out)) < 0:
        pts = pts[::-1]
    part.add(pts, [list(range(len(pts)))], mat)


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


def beam(part, a, b, t, mat, w=None):
    """A square timber from a to b, `t` thick (and `w` wide, if it is not square). An end given
    on the ground (y = 0) is lifted until its lowest corner is: a leg at a slant otherwise sinks
    its heel a few millimetres into the grass, and the bake refuses an asset below the ground."""
    a, b = Vector(a), Vector(b)
    d = b - a
    sink = (t / 2) * math.hypot(d.x, d.z) / d.length
    if a.y == 0:
        a.y += sink
    if b.y == 0:
        b.y += sink
    d = b - a
    box(part, (a + b) / 2, (w or t, t, d.length), mat, rx=-math.atan2(d.y, math.hypot(d.x, d.z)), ry=math.atan2(d.x, d.z))


def basis(d):
    d = d.normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    return u, d.cross(u).normalized()


def rings(part, a, b, radii, mats, sides=8, cap0=None, cap1=None, turn=0.0):
    """A turned shape from a to b: `radii` spaced evenly along the axis, a material for each band
    between two of them (or one for all). A cask is five radii and four bands; a cylinder two."""
    a, b = Vector(a), Vector(b)
    u, v = basis(b - a)
    n, k = sides, len(radii)
    ring = lambda c, r: [c + (u * math.cos(t) + v * math.sin(t)) * r
                         for t in (2 * math.pi * i / n + turn for i in range(n))]
    loops = [ring(a + (b - a) * (j / (k - 1)), r) for j, r in enumerate(radii)]
    for j in range(k - 1):
        mat = mats[j] if isinstance(mats, (list, tuple)) else mats
        part.add(loops[j] + loops[j + 1], [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)], mat)
    if cap0 is not None:
        part.add(loops[0], [list(range(n))[::-1]], cap0)
    if cap1 is not None:
        part.add(loops[-1], [list(range(n))], cap1)


def cylinder(part, a, b, r, mat, sides=6, cap=None, turn=0.0):
    rings(part, a, b, (r, r), mat, sides=sides, cap0=cap, cap1=cap, turn=turn)


def cone(part, a, b, r, mat, sides=6, cap=None, turn=0.0):
    """From a ring of `r` at a to a point at b: a spearhead, a roof on a pole, a tuft of grass."""
    a, b = Vector(a), Vector(b)
    u, v = basis(b - a)
    ring = [a + (u * math.cos(t) + v * math.sin(t)) * r for t in (2 * math.pi * i / sides + turn for i in range(sides))]
    part.add(ring + [b], [[i, (i + 1) % sides, sides] for i in range(sides)], mat)
    if cap is not None:
        part.add(ring, [list(range(sides))[::-1]], cap)


def cask(part, a, b, r, sides=8):
    """A cask from a to b, `r` at the belly: an iron hoop at each chime, staves bellying out
    between them, a head at each end. Seventy-six triangles at eight sides, which is what lets
    the brewery have a dozen of them standing about."""
    rings(part, a, b, (0.86 * r, 0.9 * r, r, 0.9 * r, 0.86 * r), (HOOPS, STAVES, STAVES, HOOPS),
          sides=sides, cap0=HEADS, cap1=HEADS, turn=math.pi / sides)


def prism(part, outline, y0, y1, side, top=None):
    """An (x, z) outline standing from y0 to y1, with no underside - it faces the ground. `side`
    is a material, or a function of an edge's two ends that answers with one."""
    area = sum(outline[i][0] * outline[(i + 1) % len(outline)][1] - outline[(i + 1) % len(outline)][0] * outline[i][1]
               for i in range(len(outline)))
    if area < 0:
        outline = outline[::-1]
    n = len(outline)
    pts = [(x, y0, z) for x, z in outline] + [(x, y1, z) for x, z in outline]
    for i in range(n):
        mat = side(outline[i], outline[(i + 1) % n]) if callable(side) else side
        part.add(pts, [[i, n + i, n + (i + 1) % n, (i + 1) % n]], mat)
    part.add(pts, [list(range(n, 2 * n))[::-1]], top or side)


def ridge(part, inner, outer, y0, side, top, back=None, turf=None, splay=0.0):
    """A mass of rock between two edges, each a list of (x, z, height) of the same length: the
    inner edge is the face the quarry sees, the outer the hillside falling away behind it. The
    top between them is cut into triangles, so every station can have a height of its own and
    the facets are the rock. `back` is the outer side's material, if it is not `side`.

    `turf`, if given, grows on the outer two thirds of the top, on a line of its own a little
    proud of the slope - a green triangle in every other slot of one band came out a sawtooth.
    `splay` pushes the foot of the inner face out that far, so the face leans back like rock
    rather than standing up like a wall."""
    m = len(inner)
    top_of = lambda p: Vector((p[0], p[2], p[1]))
    lo_out = lambda p: Vector((p[0], y0, p[1]))
    away = lambda i: Vector((inner[i][0] - outer[i][0], 0, inner[i][1] - outer[i][1])).normalized()
    foot = lambda i: Vector((inner[i][0], y0, inner[i][1])) + away(i) * splay
    lines = [inner, outer]
    if turf is not None:
        brow = [((2 * a[0] + d[0]) / 3, (2 * a[1] + d[1]) / 3, 0.55 * a[2] + 0.45 * d[2] + 0.03) for a, d in zip(inner, outer)]
        lines = [inner, brow, outer]
    for band in range(len(lines) - 1):
        near, far = lines[band], lines[band + 1]
        mat = top if band == 0 else turf
        for i in range(m - 1):
            face(part, [top_of(near[i]), top_of(near[i + 1]), top_of(far[i])], mat, (0, 1, 0))
            face(part, [top_of(near[i + 1]), top_of(far[i + 1]), top_of(far[i])], mat, (0, 1, 0))
    for i in range(m - 1):
        a, b, c, d = inner[i], inner[i + 1], outer[i + 1], outer[i]
        face(part, [foot(i), foot(i + 1), top_of(b), top_of(a)], side, away(i) + away(i + 1))
        face(part, [lo_out(d), lo_out(c), top_of(c), top_of(d)], back or side, -(away(i) + away(i + 1)))
    for i, j in ((0, 1), (m - 1, m - 2)):
        out = Vector((inner[i][0] - inner[j][0], 0, inner[i][1] - inner[j][1]))
        face(part, [foot(i), lo_out(outer[i])] + [top_of(line[i]) for line in lines[::-1]], side, out)


def lump(part, centre, rx, rz, h, mat, rng, sides=6, jitter=0.25, top_mat=None):
    """A stone, a heap of hops, spoil: a ring of `sides` on the ground, a smaller ring part way
    up, a peak, every point pushed about a little by `rng`. Flat shaded, the pushing is what
    makes the facets read as a rock and not as a turned pot."""
    cx, cy, cz = centre
    turn = rng.uniform(0, 2 * math.pi)
    lo, mid = [], []
    for i in range(sides):
        t = turn + 2 * math.pi * i / sides
        k = 1 + rng.uniform(-jitter, jitter)
        lo.append((cx + math.cos(t) * rx * k, cy, cz - math.sin(t) * rz * k))
        t2 = t + math.pi / sides
        k2 = 0.7 * (1 + rng.uniform(-jitter, jitter))
        mid.append((cx + math.cos(t2) * rx * k2, cy + h * (0.6 + rng.uniform(-0.12, 0.12)), cz - math.sin(t2) * rz * k2))
    peak = (cx + rng.uniform(-0.2, 0.2) * rx, cy + h, cz + rng.uniform(-0.2, 0.2) * rz)
    n = sides
    # lo[i], lo[i+1] and mid[i] (a half step on, between them) make a triangle standing on the
    # ground; mid[i], lo[i+1], mid[i+1] fill the gap above it.
    faces = []
    for i in range(n):
        faces.append([i, (i + 1) % n, n + i])
        faces.append([n + i, (i + 1) % n, n + (i + 1) % n])
    part.add(lo + mid, faces, mat)
    part.add(mid + [peak], [[i, (i + 1) % n, n] for i in range(n)], top_mat or mat)


def disc(part, centre, r, mat, sides=10, facing=(0, 0, 1)):
    """One flat face of `sides` looking along `facing`: the rings painted on an archery butt."""
    c, d = Vector(centre), Vector(facing).normalized()
    u, v = basis(d)
    ring = [c + (u * math.cos(t) + v * math.sin(t)) * r for t in (2 * math.pi * i / sides for i in range(sides))]
    part.add(ring, [list(range(sides))], mat)


def wheel(part, centre, axis, r, width, rim, hub=None, sides=10):
    """A cart wheel: a disc of `sides` and, if it has one, a hub standing proud of it."""
    c, ax = Vector(centre), Vector(axis).normalized() * (width / 2)
    rings(part, c - ax, c + ax, (r, r), rim, sides=sides, cap0=rim, cap1=rim)
    if hub is not None:
        cylinder(part, c - ax * 1.8, c + ax * 1.8, r * 0.28, hub, sides=6, cap=hub)


def rim(part, centre, axis, r_in, r_out, width, mat, sides):
    """A flat ring about `axis`: the rim of a treadwheel. Eight triangles a segment, where the
    same ring out of beams is twelve."""
    c, ax = Vector(centre), Vector(axis).normalized()
    u, v = basis(ax)
    w = ax * (width / 2)
    for i in range(sides):
        d0, d1 = [u * math.cos(2 * math.pi * k / sides) + v * math.sin(2 * math.pi * k / sides) for k in (i, i + 1)]
        out = (d0 + d1).normalized()
        face(part, [c + d0 * r_out - w, c + d1 * r_out - w, c + d1 * r_out + w, c + d0 * r_out + w], mat, out)
        face(part, [c + d0 * r_in - w, c + d1 * r_in - w, c + d1 * r_in + w, c + d0 * r_in + w], mat, -out)
        for s in (-1, 1):
            face(part, [c + d0 * r_out + w * s, c + d1 * r_out + w * s, c + d1 * r_in + w * s, c + d0 * r_in + w * s], mat, ax * s)


# The village's palette, from the tavern and the shops (scripts/build-tavern.py,
# scripts/build-grocer.py): its brick, its warm oak and its footing stone, so none of the three reads as something that came from another game.
BRICK = material('stone', 'workshops brick', 0x9c5a44)
FOOTING = material('stone', 'workshops footing', 0x968778)
OAK = material('plank', 'workshops oak', 0x845335)
OAK_Z = material('plankZ', 'workshops oak', 0x845335)
TIMBER = material('plank', 'workshops timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'workshops timber', 0x6a4426)
WEATHERED = material('plank', 'workshops weathered boards', 0x8d6a45)
WEATHERED_Z = material('plankZ', 'workshops weathered boards', 0x8d6a45)
DOOR = material('plain', 'workshops door', 0x5c3a22)
DARK = material('plain', 'workshops inside', 0x2b2320)
IRON = material('plain', 'workshops iron', 0x303236)
STEEL = material('plain', 'workshops steel', 0x9aa0a6)
BRASS = material('plain', 'workshops brass', 0xc9a24a)
GLOW = material('plain', 'workshops lit window', 0xffcf7a, emissive=True)
LAMP = material('plain', 'workshops lamp', 0xffd58a, emissive=True)
STAVES = material('plain', 'workshops staves', 0x9a6436)
HOOPS = material('plain', 'workshops hoops', 0x4a4644)
HEADS = material('plain', 'workshops cask heads', 0xb58150)
ROPE = material('plain', 'workshops rope', 0x9b7d4f)
BARK = material('plain', 'workshops bark', 0x7a4a2a)
GRAIN = material('plain', 'workshops end grain', 0xc98f55)

# ---- the brewery ------------------------------------------------------------------------
COPPER = material('plain', 'brewery copper', 0xd4843f)
COPPER_DARK = material('plain', 'brewery copper rim', 0xa55a2c)
# Slate over the brick, the smithy's and the butcher's roof: under the tavern's terracotta the
# brewhouse was one red-brown lump from across the island, brick and tile the same colour.
SLATE = material('roof', 'brewery slate', 0x4b4f58)
SLATE_RIDGE = material('roof', 'brewery ridge', 0x383a40)
FIRE = material('plain', 'brewery fire', 0xff8a34, emissive=True)
PAVING = material('stone', 'brewery paving', 0x8f8c86)
SACKING = material('plain', 'brewery sacking', 0xb89a66)
SACK_TIE = material('plain', 'brewery sack tie', 0x7d6440)
HOPS = material('plain', 'brewery hops', 0x8db04a)
HOPS_DARK = material('plain', 'brewery hop leaves', 0x5f8a35)
MALT = material('plain', 'brewery malt sack', 0xd9c79a)

BREW = collection('civic_brewery')
HX0, HX1, HZ0, HZ1 = -1.3, 0.2, -1.25, -0.1      # the brewhouse's walls, outside faces
MIDX = (HX0 + HX1) / 2
EAVES, RIDGE = 0.9, 1.5                          # a storey, and a malt loft under the tiles
T = 0.05
DOOR_W, DOOR_H = 0.5, 0.66                       # a cask on a barrow goes through this
LX1, LZ0, LZ1 = 1.25, -1.15, -0.15               # the lean-to, right of the hall
LEAN_HI, LEAN_LO = 0.86, 0.66
CX, CZ = 0.8, -1.3                               # the chimney, behind the lean-to
STACK_TOP = 2.5

walls = Part(BREW, 'walls')
# A footing course keeps the brick out of the wet, and shows past it all round.
box(walls, (MIDX, 0.04, (HZ0 + HZ1) / 2), (HX1 - HX0 + 0.04, 0.08, HZ1 - HZ0 + 0.04), FOOTING)
box(walls, (MIDX, EAVES / 2, HZ0 + T / 2), (HX1 - HX0, EAVES, T), BRICK)
for x in (HX0 + T / 2, HX1 - T / 2):
    box(walls, (x, EAVES / 2, (HZ0 + HZ1) / 2), (T, EAVES, HZ1 - HZ0 - 2 * T), BRICK)
# The front, built round the big door rather than through it.
jamb = (HX1 - HX0 - DOOR_W) / 2
for side in (-1, 1):
    box(walls, (MIDX + side * (DOOR_W + jamb) / 2, EAVES / 2, HZ1 - T / 2), (jamb, EAVES, T), BRICK)
box(walls, (MIDX, (EAVES + DOOR_H) / 2, HZ1 - T / 2), (DOOR_W, EAVES - DOOR_H, T), BRICK)
# The gables, a brick triangle at each end between the eaves and the ridge.
for z in (HZ0, HZ1 - T):
    walls.add([(HX0, EAVES, z), (HX1, EAVES, z), (MIDX, RIDGE, z),
               (HX0, EAVES, z + T), (HX1, EAVES, z + T), (MIDX, RIDGE, z + T)],
              [[0, 2, 1], [3, 4, 5], [0, 1, 4, 3]], BRICK)
walls.build()

front = Part(BREW, 'front')
# The big door stands open, both leaves swung straight out, so what the street sees is the dark
# of the brewhouse and the mash tun standing in it.
box(front, (MIDX, 0.004, (HZ0 + HZ1) / 2), (HX1 - HX0 - 2 * T, 0.008, HZ1 - HZ0 - 2 * T), DARK)
box(front, (MIDX, EAVES / 2, HZ0 + T + 0.004), (HX1 - HX0 - 2 * T, EAVES - 0.01, 0.008), DARK)
LEAF = DOOR_W / 2
for side in (-1, 1):
    x = MIDX + side * (DOOR_W / 2 + 0.075)
    box(front, (x, DOOR_H / 2 - 0.01, HZ1 + LEAF / 2 + 0.01), (0.022, DOOR_H - 0.03, LEAF), DOOR)
    for y in (0.14, DOOR_H - 0.16):
        box(front, (x - side * 0.014, y, HZ1 + LEAF / 2 + 0.01), (0.012, 0.03, LEAF - 0.02), TIMBER_Z)
        box(front, (x + side * 0.016, y, HZ1 + 0.05), (0.012, 0.016, 0.08), IRON)
# The stone round the door: jambs, a lintel with a keystone.
for side in (-1, 1):
    box(front, (MIDX + side * (DOOR_W / 2 + 0.03), DOOR_H / 2, HZ1 + 0.012), (0.06, DOOR_H, 0.03), FOOTING)
box(front, (MIDX, DOOR_H + 0.04, HZ1 + 0.015), (DOOR_W + 0.16, 0.08, 0.04), FOOTING)
box(front, (MIDX, DOOR_H + 0.05, HZ1 + 0.03), (0.07, 0.11, 0.03), FOOTING)
# Windows either side of the door, two down the left wall and two in the back, lit warm after
# dark; stone sills and lintels, because brick has no other way to say where a window stops.
WIN_W, WIN_H, WIN_Y = 0.16, 0.24, 0.3
def window(part, x, z, out):
    """A window on the wall face at (x, z), looking along `out`: (0, 1) front, (0, -1) back,
    (-1, 0) left."""
    ox, oz = out
    at = lambda d: (x + ox * d, z + oz * d)
    span = lambda w, t: (t, w) if ox else (w, t)
    for d, (w, h, t), y, mat in ((0.006, (WIN_W, WIN_H, 0.012), WIN_Y + WIN_H / 2, GLOW),
                                  (0.014, (0.016, WIN_H, 0.01), WIN_Y + WIN_H / 2, TIMBER),
                                  (0.02, (WIN_W + 0.06, 0.03, 0.04), WIN_Y - 0.015, FOOTING),
                                  (0.012, (WIN_W + 0.06, 0.05, 0.025), WIN_Y + WIN_H + 0.025, FOOTING)):
        px, pz = at(d)
        sx, sz = span(w, t)
        box(part, (px, y, pz), (sx, h, sz), mat)
for x in (HX0 + 0.2, HX1 - 0.2):
    window(front, x, HZ1, (0, 1))
    window(front, x + (0.1 if x < MIDX else -0.1), HZ0, (0, -1))
for z in (HZ0 + 0.3, HZ1 - 0.3):
    window(front, HX0, z, (-1, 0))
front.build()

loft = Part(BREW, 'loft')
# The malt loft's door high in the front gable, open, and the hoist beam over it with a sack
# on its way up - the thing that says brewery before the chimney does.
box(loft, (MIDX, 1.1, HZ1 + 0.004), (0.2, 0.24, 0.012), DARK)
box(loft, (MIDX, 0.975, HZ1 + 0.02), (0.26, 0.03, 0.045), TIMBER)
box(loft, (MIDX, 1.235, HZ1 + 0.015), (0.26, 0.03, 0.035), TIMBER)
box(loft, (MIDX - 0.12, 1.1, HZ1 + 0.1), (0.02, 0.22, 0.18), WEATHERED_Z)
beam(loft, (MIDX, 1.36, HZ1 - 0.05), (MIDX, 1.36, HZ1 + 0.24), 0.045, TIMBER)
cylinder(loft, (MIDX - 0.015, 1.33, HZ1 + 0.2), (MIDX + 0.015, 1.33, HZ1 + 0.2), 0.025, IRON, sides=6, cap=IRON)
box(loft, (MIDX, 1.1, HZ1 + 0.2), (0.008, 0.44, 0.008), ROPE)
rings(loft, (MIDX, 0.74, HZ1 + 0.2), (MIDX, 0.88, HZ1 + 0.2), (0.05, 0.06, 0.035), MALT, sides=6, cap0=MALT)
loft.build()

roof = Part(BREW, 'roof')
pitch = math.atan2(RIDGE - EAVES, (HX1 - HX0) / 2)
span = math.hypot((HX1 - HX0) / 2, RIDGE - EAVES) + 0.1
depth = HZ1 - HZ0 + 0.18
for side in (-1, 1):
    box(roof, (MIDX + side * (HX1 - HX0) / 4, (EAVES + RIDGE) / 2 + 0.024, (HZ0 + HZ1) / 2), (span, 0.04, depth), SLATE, rz=-side * pitch)
box(roof, (MIDX, RIDGE + 0.04, (HZ0 + HZ1) / 2), (0.08, 0.04, depth + 0.01), SLATE_RIDGE)
# Barge boards down both gables, so the slate has an edge.
for z in (HZ0 - 0.09, HZ1 + 0.09):
    for side in (-1, 1):
        beam(roof, (MIDX + side * ((HX1 - HX0) / 2 + 0.06), EAVES - 0.04, z), (MIDX, RIDGE + 0.05, z), 0.035, TIMBER)
# The louvred vent on the ridge a brewhouse lets its steam out of, with a little roof of its own.
VX, VZ = MIDX, HZ0 + 0.35
box(roof, (VX, RIDGE + 0.1, VZ), (0.18, 0.16, 0.18), WEATHERED)
for y in (RIDGE + 0.06, RIDGE + 0.12):
    box(roof, (VX, y, VZ), (0.19, 0.012, 0.19), TIMBER)
cone(roof, (VX, RIDGE + 0.18, VZ), (VX, RIDGE + 0.3, VZ), 0.16, SLATE, sides=4, turn=math.pi / 4, cap=TIMBER)
roof.build()

# The chimney: a square brick stack well clear of the ridge, tapering a little, with stone
# bands and a corbelled crown. It is what the brewery is seen by from across the island.
stack = Part(BREW, 'chimney')
rings(stack, (CX, 0, CZ), (CX, STACK_TOP - 0.1, CZ), (0.2, 0.15), BRICK, sides=4, turn=math.pi / 4)
for y in (0.0, 1.05):
    rings(stack, (CX, y, CZ), (CX, y + 0.07, CZ), (0.215, 0.21 - 0.05 * y / 1.05), FOOTING, sides=4, turn=math.pi / 4, cap1=FOOTING)
rings(stack, (CX, STACK_TOP - 0.1, CZ), (CX, STACK_TOP, CZ), (0.18, 0.18), FOOTING, sides=4, turn=math.pi / 4, cap1=DARK)
stack.build()
anchor(BREW, 'smoke', (CX, STACK_TOP + 0.08, CZ))

lean = Part(BREW, 'lean-to')
# The open shed over the copper: its roof falls from the brewhouse wall to two posts, its back
# is brick against the chimney, and its floor is paved, because a brewer spills.
box(lean, ((HX1 + LX1) / 2, 0.01, (LZ0 + LZ1) / 2), (LX1 - HX1, 0.02, LZ1 - LZ0), PAVING)
box(lean, ((HX1 + LX1) / 2, LEAN_LO / 2 + 0.05, LZ0 + T / 2), (LX1 - HX1, LEAN_LO + 0.1, T), BRICK)
lean.add([(HX1, LEAN_LO + 0.1, LZ0), (LX1, LEAN_LO + 0.1, LZ0), (HX1, LEAN_HI, LZ0),
          (HX1, LEAN_LO + 0.1, LZ0 + T), (LX1, LEAN_LO + 0.1, LZ0 + T), (HX1, LEAN_HI, LZ0 + T)],
         [[0, 2, 1], [3, 4, 5]], BRICK)
slope = math.atan2(LEAN_HI - LEAN_LO, LX1 - HX1)
run = math.hypot(LX1 - HX1 + 0.1, LEAN_HI - LEAN_LO)
box(lean, ((HX1 + LX1) / 2 + 0.03, (LEAN_HI + LEAN_LO) / 2 + 0.02, (LZ0 + LZ1) / 2 + 0.03),
    (run, 0.035, LZ1 - LZ0 + 0.14), SLATE, rz=-slope)
for z in (LZ0 + 0.03, LZ1 - 0.03):
    box(lean, (LX1 - 0.03, LEAN_LO / 2, z), (0.05, LEAN_LO, 0.05), OAK)
box(lean, (LX1 - 0.03, LEAN_LO - 0.02, (LZ0 + LZ1) / 2), (0.06, 0.05, LZ1 - LZ0), OAK_Z)
box(lean, ((HX1 + LX1) / 2, (LEAN_HI + LEAN_LO) / 2 - 0.03, LZ1 - 0.03), (LX1 - HX1, 0.04, 0.05), OAK, rz=-slope)
# The firewood the copper burns, stacked in the corner beside it.
for row, (count, y) in enumerate(((3, 0.058), (2, 0.128), (1, 0.198))):
    for i in range(count):
        z = -1.05 + (i + row * 0.5) * 0.08
        cylinder(lean, (1.02, y, z), (1.2, y, z), 0.038, BARK, sides=6, cap=GRAIN, turn=(i + row) * 0.5)
# Hops hung to dry along the front beam, the brewer's own garland, and a lantern on the corner
# post for the copper after dark.
beam_y = lambda x: LEAN_HI - (x - HX1) / (LX1 - HX1) * (LEAN_HI - LEAN_LO) - 0.07
for i, x in enumerate((0.34, 0.5, 0.66, 0.82, 0.98)):
    y = beam_y(x) - 0.01 * (i % 2)
    cone(lean, (x, y, LZ1 - 0.03), (x + 0.005, y - 0.09, LZ1 - 0.03), 0.035, HOPS if i % 2 else HOPS_DARK, sides=4, turn=i)
box(lean, (LX1 - 0.03, 0.5, LZ1 + 0.01), (0.012, 0.012, 0.05), IRON)
box(lean, (LX1 - 0.03, 0.45, LZ1 + 0.045), (0.045, 0.065, 0.045), LAMP)
box(lean, (LX1 - 0.03, 0.488, LZ1 + 0.045), (0.058, 0.012, 0.058), IRON)
lean.build()

inside = Part(BREW, 'mash tun')
# The mash tun, seen through the open door: a broad hooped vat with its oar standing in it.
TX, TZ = MIDX, HZ1 - 0.4
rings(inside, (TX, 0.0, TZ), (TX, 0.34, TZ), (0.22, 0.23, 0.24), (HOOPS, STAVES), sides=10, cap1=DARK)
beam(inside, (TX + 0.05, 0.2, TZ), (TX + 0.14, 0.55, TZ + 0.1), 0.02, OAK)
inside.build()

sign = Part(BREW, 'sign')
# An iron arm off the corner of the brewhouse, and a little cask hanging from it: the sign.
SGX, SGY, SGZ = HX1 - 0.03, 0.78, HZ1 + 0.24
box(sign, (SGX, SGY, (HZ1 + SGZ) / 2), (0.016, 0.016, SGZ - HZ1 + 0.02), IRON)
beam(sign, (SGX, SGY - 0.14, HZ1 + 0.01), (SGX, SGY - 0.01, SGZ - 0.04), 0.012, IRON)
box(sign, (SGX, SGY - 0.04, SGZ - 0.02), (0.004, 0.06, 0.004), IRON)
cask(sign, (SGX - 0.06, SGY - 0.11, SGZ - 0.02), (SGX + 0.06, SGY - 0.11, SGZ - 0.02), 0.045, sides=6)
sign.build()

COPPER_SET = collection('civic_brewery_copper')
# The copper: a brick firebox with its fire showing at the mouth, the copper on top under a
# dome, and a vapour pipe up through the lean-to's roof that the steam comes out of.
KX, KZ = 0.74, -0.56
kettle = Part(COPPER_SET, 'copper')
box(kettle, (KX, 0.11, KZ), (0.42, 0.22, 0.42), BRICK)
box(kettle, (KX, 0.08, KZ + 0.212), (0.14, 0.1, 0.006), DARK)
box(kettle, (KX, 0.065, KZ + 0.215), (0.1, 0.05, 0.006), FIRE)
box(kettle, (KX, 0.145, KZ + 0.218), (0.18, 0.025, 0.02), IRON)
rings(kettle, (KX, 0.22, KZ), (KX, 0.42, KZ), (0.19, 0.2, 0.19), (COPPER_DARK, COPPER), sides=10)
rings(kettle, (KX, 0.42, KZ), (KX, 0.52, KZ), (0.19, 0.15, 0.08), COPPER, sides=10, cap1=BRASS)
cylinder(kettle, (KX, 0.52, KZ), (KX, 0.92, KZ), 0.03, COPPER, sides=6)
rings(kettle, (KX, 0.92, KZ), (KX, 0.98, KZ), (0.045, 0.055), COPPER_DARK, sides=6, cap1=DARK)
# A tap at the front and the brewer's oar leant against the brick.
cylinder(kettle, (KX + 0.1, 0.28, KZ + 0.17), (KX + 0.1, 0.28, KZ + 0.26), 0.012, BRASS, sides=4)
beam(kettle, (KX - 0.26, 0.0, KZ + 0.16), (KX - 0.14, 0.62, KZ + 0.12), 0.018, OAK)
box(kettle, (KX - 0.255, 0.08, KZ + 0.16), (0.06, 0.12, 0.012), OAK, rz=0.2)
kettle.build()
anchor(COPPER_SET, 'smoke', (KX, 1.02, KZ))

# ---- the brewery's yard ------------------------------------------------------------------
BYARD = collection('civic_brewery_yard')
R_CASK, L_CASK = 0.075, 0.2

casks = Part(BYARD, 'casks')
# Six casks on a stillage left of the door, lying with their heads to the street, three and
# two and one. Two stand on end by the lean-to, waiting to be filled.
STILL_Z = 0.02
for x in (-1.24, -0.76):
    box(casks, (x, 0.015, STILL_Z + L_CASK / 2), (0.04, 0.03, L_CASK + 0.06), TIMBER_Z)
for z in (STILL_Z + 0.03, STILL_Z + L_CASK - 0.03):
    box(casks, (-1.0, 0.015, z), (0.52, 0.03, 0.035), TIMBER)
for row, xs in enumerate(((-1.16, -1.0, -0.84), (-1.08, -0.92), (-1.0,))):
    y = 0.03 + R_CASK + row * R_CASK * 1.72
    for x in xs:
        cask(casks, (x, y, STILL_Z), (x, y, STILL_Z + L_CASK), R_CASK)
for x, z in ((0.12, 0.1), (0.3, 0.04)):
    cask(casks, (x, 0, z), (x, L_CASK, z), R_CASK)
casks.build()

dray = Part(BYARD, 'dray')
# The dray, out on the right with its shafts down on the ground and three casks roped on: the
# beer going to the tavern.
BX0, BX1, BZ0, BZ1, BED = 0.38, 0.92, 0.6, 0.98, 0.2
box(dray, ((BX0 + BX1) / 2, BED, (BZ0 + BZ1) / 2), (BX1 - BX0, 0.03, BZ1 - BZ0), WEATHERED)
for z in (BZ0 + 0.01, BZ1 - 0.01):
    box(dray, ((BX0 + BX1) / 2, BED + 0.045, z), (BX1 - BX0, 0.06, 0.02), TIMBER)
for x in (BX0 + 0.01, BX1 - 0.01):
    box(dray, (x, BED + 0.045, (BZ0 + BZ1) / 2), (0.02, 0.06, BZ1 - BZ0), TIMBER_Z)
AX = 0.62
box(dray, (AX, 0.14, (BZ0 + BZ1) / 2), (0.04, 0.04, BZ1 - BZ0 + 0.12), IRON)
for z in (BZ0 - 0.045, BZ1 + 0.045):
    wheel(dray, (AX, 0.14, z), (0, 0, 1), 0.14, 0.025, OAK, IRON)
for z, dz in ((BZ0 + 0.07, 0.03), (BZ1 - 0.07, -0.03)):
    beam(dray, (BX1 - 0.05, BED - 0.01, z), (1.3, 0.0, z + dz), 0.03, OAK)
box(dray, (BX0 + 0.02, 0.1, (BZ0 + BZ1) / 2), (0.03, 0.2, 0.03), OAK)
for x in (0.52, 0.78):
    cask(dray, (x, BED + 0.015 + R_CASK, BZ0 + 0.09), (x, BED + 0.015 + R_CASK, BZ0 + 0.29), R_CASK)
cask(dray, (0.65, BED + 0.015 + R_CASK * 2.7, BZ0 + 0.09), (0.65, BED + 0.015 + R_CASK * 2.7, BZ0 + 0.29), R_CASK)
box(dray, (0.65, BED + 0.015 + R_CASK * 3.66, BZ0 + 0.19), (0.3, 0.008, 0.008), ROPE)
dray.build()

sacks = Part(BYARD, 'hop sacks')
# The hops, come in from the fields in sacking: two lying, two standing, and one open with the
# green cones heaped on top of it.
rng = random.Random('brewery hop sacks')
for x, z in ((1.0, 0.12), (1.2, 0.08)):
    rings(sacks, (x, 0.0, z), (x, 0.2, z), (0.07, 0.078, 0.06, 0.03), (SACKING, SACKING, SACK_TIE), sides=6, cap0=SACKING, cap1=SACK_TIE)
for x, z in ((1.12, 0.32), (1.34, 0.36)):
    rings(sacks, (x - 0.1, 0.065, z), (x + 0.1, 0.065, z), (0.045, 0.065, 0.06, 0.035), SACKING, sides=6, cap0=SACKING, cap1=SACK_TIE)
rings(sacks, (1.36, 0.0, 0.06), (1.36, 0.15, 0.06), (0.075, 0.08, 0.07), SACKING, sides=6, cap0=SACKING)
lump(sacks, (1.36, 0.14, 0.06), 0.085, 0.085, 0.09, HOPS, rng, sides=6, top_mat=HOPS_DARK)
for x, z in ((1.24, 0.2), (1.3, -0.04)):
    lump(sacks, (x, 0.0, z), 0.045, 0.04, 0.04, HOPS, rng, sides=5)
sacks.build()

# ---- the training field -----------------------------------------------------------------
STRAW = material('plain', 'training straw', 0xd8b25a)
STRAW_DARK = material('plain', 'training old straw', 0xb58d3c)
EARTH = material('plain', 'training trodden earth', 0xc4a978)
WORN = material('plain', 'training worn earth', 0xab9062)
SWARD = material('plain', 'training sward', 0x7fa24a)
TURF = material('plain', 'training grass', 0x6f9a3e)
BANNER = material('plain', 'training banner', 0x2f5fa8)
BANNER_PALE = material('plain', 'training banner device', 0xe8dcbc)
RED = material('plain', 'training red', 0xb3322a)
WHITE = material('plain', 'training white', 0xefe8d8)
LEATHER = material('plain', 'training leather', 0x6b3f25)
PRACTICE = material('plain', 'training practice wood', 0xc39a62)
FLETCH = material('plain', 'training fletching', 0xe9e4d6)
BASE_STONE = material('stone', 'training stone', 0x8e9093)
SHIELD_BLUE = material('plain', 'training shield', 0x3a67b0)

FIELD = collection('civic_trainingfield')
L = 1.5                    # the lot line; the fence stands on it, as the stable's paddock does
POST = 0.036               # so half a post, 0.018, is over the line and nothing else is
GATE = 0.3                 # the gate's half-width, in the middle of the front

floor = Part(FIELD, 'floor')
box(floor, (0, 0.003, 0), (2 * L - 0.04, 0.006, 2 * L - 0.04), EARTH)
# Worn where feet keep going: before the dummies, along the shooting line, in from the gate.
for cx, cz, sx, sz in ((-0.7, 0.02, 0.95, 1.35), (0.82, 0.62, 1.0, 0.36), (0.0, 1.12, 0.6, 0.7)):
    box(floor, (cx, 0.0075, cz), (sx, 0.003, sz), WORN)
# The grass the feet do not reach, in patches in the corners and along the rails, as in
# Ideas/Images to Render/trainingarea.png, and in tufts at the foot of the posts.
rng = random.Random('training sward')
for cx, cz, rx, rz in ((1.2, -0.45, 0.2, 0.34), (-0.1, -1.3, 0.34, 0.14), (0.62, 1.28, 0.26, 0.16), (-1.28, -0.35, 0.16, 0.3), (1.28, 0.25, 0.16, 0.2)):
    outline = [(cx + math.cos(a) * rx * (1 + rng.uniform(-0.3, 0.2)), cz - math.sin(a) * rz * (1 + rng.uniform(-0.3, 0.2)))
               for a in (2 * math.pi * i / 7 for i in range(7))]
    prism(floor, outline, 0.0, 0.01, SWARD)
rng = random.Random('training grass')
for i in range(12):
    t = (i // 3) / 4 + 0.1
    x, z = [(-1.3 + 2.6 * t, -1.43), (1.43, -1.2 + 2.3 * t), (-1.43, -0.6 + 1.0 * t)][i % 3]
    cone(floor, (x, 0.006, z), (x + rng.uniform(-0.02, 0.02), 0.06 + rng.uniform(0, 0.03), z), 0.03, TURF, sides=3, turn=rng.uniform(0, 3))
floor.build()

fence = Part(FIELD, 'fence')
ticks = (-L, -L / 2, 0.0, L / 2, L)
posts = set()
for t in ticks:
    posts |= {(t, -L), (-L, t), (L, t)}
posts |= {(-L / 2, L), (L / 2, L), (-GATE, L), (GATE, L)}
for x, z in sorted(posts):
    tall = 0.33 if abs(x) == GATE and z == L else 0.27
    box(fence, (x, tall / 2, z), (POST, tall, POST), TIMBER)
for y in (0.1, 0.21):
    box(fence, (0, y, -L), (2 * L, 0.024, 0.02), TIMBER)
    for x in (-L, L):
        box(fence, (x, y, 0), (0.02, 0.024, 2 * L), TIMBER_Z)
    for side in (-1, 1):
        box(fence, (side * (L + GATE) / 2, y, L), (L - GATE, 0.024, 0.02), TIMBER)
# The gate, swung in: it opens into the field and not across the lane.
gate_ang = 1.1
gx, gz = math.cos(gate_ang), -math.sin(gate_ang)
g0 = Vector((-GATE + 0.02, 0, L - 0.01))
for y in (0.09, 0.22):
    box(fence, (g0.x + gx * 0.27, y, g0.z + gz * 0.27), (0.54, 0.024, 0.02), OAK, ry=gate_ang)
beam(fence, (g0.x + gx * 0.03, 0.09, g0.z + gz * 0.03), (g0.x + gx * 0.5, 0.22, g0.z + gz * 0.5), 0.018, OAK)
box(fence, (g0.x + gx * 0.53, 0.155, g0.z + gz * 0.53), (0.024, 0.17, 0.024), OAK, ry=gate_ang)
fence.build()

shelter = Part(FIELD, 'shelter')
# The shelter in the back corner: open to the field, boarded at the back and on the fence side,
# a plank roof falling to the back. A settler stands up in it (0.72 at the front).
SX0, SX1, SZ0, SZ1 = -1.38, -0.62, -1.38, -0.9
S_HI, S_LO = 0.72, 0.58
for x in (SX0, SX1):
    for z, h in ((SZ0, S_LO), (SZ1, S_HI)):
        box(shelter, (x, h / 2, z), (0.045, h, 0.045), TIMBER)
box(shelter, ((SX0 + SX1) / 2, S_LO / 2, SZ0 + 0.012), (SX1 - SX0, S_LO, 0.02), WEATHERED)
box(shelter, (SX0 + 0.012, S_LO / 2, (SZ0 + SZ1) / 2), (0.02, S_LO, SZ1 - SZ0), WEATHERED_Z)
box(shelter, ((SX0 + SX1) / 2, S_HI - 0.02, SZ1), (SX1 - SX0 + 0.04, 0.04, 0.04), TIMBER)
tilt = math.atan2(S_HI - S_LO, SZ1 - SZ0)
box(shelter, ((SX0 + SX1) / 2, (S_HI + S_LO) / 2 + 0.03, (SZ0 + SZ1) / 2 + 0.02),
    (SX1 - SX0 + 0.12, 0.03, math.hypot(SZ1 - SZ0 + 0.14, S_HI - S_LO)), OAK_Z, rx=-tilt)
# On the back wall two shields on pegs; on the chest two helmets; a water barrel beside it.
for x, mat in ((-1.2, SHIELD_BLUE), (-0.96, RED)):
    rings(shelter, (x, 0.42, SZ0 + 0.022), (x, 0.42, SZ0 + 0.042), (0.075, 0.075), mat, sides=8, cap1=mat)
    cylinder(shelter, (x, 0.42, SZ0 + 0.042), (x, 0.42, SZ0 + 0.054), 0.022, STEEL, sides=6, cap=STEEL)
box(shelter, (-0.96, 0.08, SZ0 + 0.12), (0.34, 0.16, 0.16), OAK)
box(shelter, (-0.96, 0.165, SZ0 + 0.12), (0.35, 0.02, 0.17), TIMBER)
for x in (-1.06, -0.86):
    rings(shelter, (x, 0.175, SZ0 + 0.12), (x, 0.255, SZ0 + 0.12), (0.05, 0.048, 0.02), STEEL, sides=6)
cask(shelter, (-0.72, 0, SZ0 + 0.14), (-0.72, 0.2, SZ0 + 0.14), 0.07)
# The banner down the open corner post, and the flagpole over it: main.js flies the island's
# flag there (anchor.flag), in the colour of its district.
box(shelter, (SX1 + 0.035, 0.46, SZ1), (0.012, 0.24, 0.13), BANNER)
box(shelter, (SX1 + 0.042, 0.47, SZ1), (0.004, 0.08, 0.06), BANNER_PALE)
box(shelter, (SX1 + 0.035, 0.585, SZ1), (0.02, 0.015, 0.15), TIMBER_Z)
cylinder(shelter, (SX1, S_HI, SZ1), (SX1, 1.12, SZ1), 0.014, TIMBER, sides=5)
cone(shelter, (SX1, 1.12, SZ1), (SX1, 1.15, SZ1), 0.022, BRASS, sides=5)
shelter.build()
anchor(FIELD, 'flag', (SX1 + 0.01, 1.03, SZ1))

racks = Part(FIELD, 'racks')
# The weapon rack along the left rail, spears and a poleaxe standing in it; the sword rack along
# the front, three wooden practice swords point down.
RZ0, RZ1, RX = 0.5, 1.05, -1.32
for z in (RZ0, RZ1):
    box(racks, (RX, 0.16, z), (0.035, 0.32, 0.035), TIMBER)
for y in (0.06, 0.28):
    box(racks, (RX, y, (RZ0 + RZ1) / 2), (0.05, 0.03, RZ1 - RZ0 + 0.04), TIMBER_Z)
for i, z in enumerate((0.6, 0.72, 0.84, 0.96)):
    top = 0.56 if i % 2 else 0.6
    beam(racks, (RX + 0.012, 0.04, z), (RX + 0.03, top, z), 0.013, OAK)
    if i == 2:
        box(racks, (RX + 0.03, top - 0.05, z + 0.04), (0.006, 0.07, 0.07), STEEL)
    cone(racks, (RX + 0.03, top, z), (RX + 0.032, top + 0.07, z), 0.014, STEEL, sides=4)
WX0, WX1, WZ = -1.18, -0.7, 1.2
for x in (WX0, WX1):
    box(racks, (x, 0.13, WZ), (0.03, 0.26, 0.03), TIMBER)
box(racks, ((WX0 + WX1) / 2, 0.22, WZ), (WX1 - WX0 + 0.04, 0.03, 0.04), TIMBER)
box(racks, ((WX0 + WX1) / 2, 0.05, WZ), (WX1 - WX0, 0.03, 0.05), TIMBER)
for x in (-1.08, -0.96, -0.84):
    box(racks, (x, 0.2, WZ + 0.02), (0.022, 0.26, 0.008), PRACTICE)
    box(racks, (x, 0.34, WZ + 0.02), (0.07, 0.014, 0.018), LEATHER)
    box(racks, (x, 0.38, WZ + 0.02), (0.018, 0.06, 0.018), LEATHER)
racks.build()

bales = Part(FIELD, 'bales')
# Straw bales in the front corner and by the shelter, to sit on and to stuff the dummies from,
# and the bench on the shooting line.
for x, z, y, ry in ((1.22, 1.24, 0.0, 0.0), (1.0, 1.27, 0.0, 0.15), (1.12, 1.25, 0.1, 0.08), (-0.46, -1.3, 0.0, 1.5)):
    box(bales, (x, y + 0.05, z), (0.19, 0.1, 0.12), STRAW, ry=ry)
    for dx in (-0.05, 0.05):
        box(bales, (x + dx * math.cos(ry), y + 0.05, z - dx * math.sin(ry)), (0.01, 0.102, 0.122), STRAW_DARK, ry=ry)
for x in (0.5, 1.05):
    box(bales, (x, 0.055, 0.84), (0.03, 0.11, 0.1), TIMBER)
box(bales, (0.775, 0.12, 0.84), (0.66, 0.025, 0.12), OAK)
bales.build()

# ---- the training field's yard ------------------------------------------------------------
FYARD = collection('civic_trainingfield_yard')


def dummy(part, x, z, rng, helmet=False, tunic=None, shield=False):
    """A straw man on a post, a settler's height: a stone for a foot, a straw body bound at the
    waist, arms out on a cross-bar, a bound sack for a head - and a helmet and a tunic on the
    ones the recruits have been told to go for."""
    box(part, (x, 0.025, z), (0.1, 0.05, 0.1), BASE_STONE)
    box(part, (x, 0.14, z), (0.028, 0.2, 0.028), TIMBER)
    turn = rng.uniform(-0.3, 0.3)
    rings(part, (x, 0.13, z), (x, 0.34, z), (0.04, 0.062, 0.058, 0.05), (STRAW_DARK, STRAW, STRAW), sides=6, turn=turn)
    rings(part, (x, 0.34, z), (x, 0.365, z), (0.05, 0.02), STRAW, sides=6, turn=turn)
    box(part, (x, 0.3, z), (0.3, 0.032, 0.032), STRAW, ry=turn)
    for s in (-1, 1):
        box(part, (x + s * 0.155 * math.cos(turn), 0.3, z - s * 0.155 * math.sin(turn)), (0.02, 0.04, 0.04), ROPE, ry=turn)
    rings(part, (x, 0.355, z), (x, 0.44, z), (0.035, 0.045, 0.03), STRAW, sides=6, turn=turn, cap1=STRAW)
    if tunic:
        rings(part, (x, 0.2, z), (x, 0.33, z), (0.068, 0.064), tunic, sides=6, turn=turn)
    else:
        rings(part, (x, 0.22, z), (x, 0.24, z), (0.064, 0.064), ROPE, sides=6, turn=turn)
    if helmet:
        rings(part, (x, 0.41, z), (x, 0.47, z), (0.05, 0.045, 0.02), STEEL, sides=6, turn=turn)
    if shield:
        cx, cz = x - 0.12 * math.cos(turn), z + 0.12 * math.sin(turn) + 0.045
        rings(part, (cx, 0.26, cz), (cx, 0.26, cz + 0.015), (0.07, 0.07), OAK, sides=7, cap1=OAK)
        cylinder(part, (cx, 0.26, cz + 0.015), (cx, 0.26, cz + 0.025), 0.02, IRON, sides=5, cap=IRON)


dummies = Part(FYARD, 'dummies')
rng = random.Random('training dummies')
dummy(dummies, -0.95, -0.4, rng)
dummy(dummies, -0.3, -0.1, rng, helmet=True, tunic=RED)
dummy(dummies, -0.88, 0.42, rng, helmet=True, tunic=LEATHER, shield=True)
dummies.build()

pells = Part(FYARD, 'pells')
# Pells: plain posts to cut at, banded in iron, with pegs to parry round.
for x, z, h, turn in ((0.02, -0.72, 0.5, 0.0), (-0.5, 0.86, 0.44, 0.6)):
    box(pells, (x, h / 2, z), (0.07, h, 0.07), OAK, ry=turn)
    for y in (0.06, h - 0.05):
        box(pells, (x, y, z), (0.078, 0.02, 0.078), IRON, ry=turn)
    for y, a in ((0.34, 0.0), (0.26, 1.9), (0.18, 3.6)):
        a += turn
        beam(pells, (x, y, z), (x + math.sin(a) * 0.1, y - 0.01, z + math.cos(a) * 0.1), 0.018, TIMBER)
pells.build()

butts = Part(FYARD, 'butts')
# The archery butts along the back: straw bosses with their rings painted on, standing on
# easels, the middle one hung under a little roof. Arrows in them, and one that missed.
TZ, TY, TR = -1.12, 0.27, 0.12
def butt(part, x, y, z):
    rings(part, (x, y, z - 0.05), (x, y, z), (TR, TR), STRAW, sides=10, cap0=STRAW_DARK, cap1=STRAW)
    for k, (r, mat) in enumerate(((0.09, RED), (0.06, WHITE), (0.03, RED))):
        disc(part, (x, y, z + 0.002 * (k + 1)), r, mat, sides=10 if r > 0.05 else 6)
for x in (0.36, 1.24):
    butt(butts, x, TY, TZ)
    for s in (-1, 1):
        beam(butts, (x + s * 0.11, 0.0, TZ - 0.02), (x + s * 0.05, 0.42, TZ - 0.12), 0.022, TIMBER)
    beam(butts, (x, 0.0, TZ - 0.32), (x, 0.4, TZ - 0.12), 0.022, TIMBER)
    box(butts, (x, TY - TR - 0.005, TZ - 0.035), (0.26, 0.02, 0.035), TIMBER)
MX = 0.8
butt(butts, MX, 0.3, TZ)
for s in (-1, 1):
    box(butts, (MX + s * 0.17, 0.26, TZ - 0.03), (0.035, 0.52, 0.035), TIMBER)
box(butts, (MX, 0.52, TZ - 0.03), (0.4, 0.035, 0.04), TIMBER)
for s in (-1, 1):
    box(butts, (MX + s * 0.05, 0.46, TZ - 0.025), (0.006, 0.1, 0.006), ROPE)
    box(butts, (MX, 0.6, TZ - 0.03 + s * 0.075), (0.48, 0.02, 0.17), OAK, rx=s * 0.55)
for x, y, lean in ((0.33, 0.29, 0.1), (0.4, 0.24, -0.2), (0.78, 0.33, 0.15), (0.84, 0.28, -0.1), (0.8, 0.26, 0.3), (1.2, 0.3, 0.0)):
    a, b = (x, y, TZ + 0.005), (x + lean * 0.05, y + 0.02, TZ + 0.14)
    beam(butts, a, b, 0.007, PRACTICE)
    box(butts, (b[0], b[1], b[2] - 0.015), (0.024, 0.006, 0.03), FLETCH)
beam(butts, (1.02, 0.0, -0.62), (1.03, 0.05, -0.5), 0.007, PRACTICE)
# The quiver barrel on the shooting line, with a sheaf of arrows in it.
cask(butts, (1.3, 0, 0.66), (1.3, 0.18, 0.66), 0.06, sides=6)
for i in range(4):
    a = i * 1.6
    beam(butts, (1.3 + math.sin(a) * 0.02, 0.1, 0.66 + math.cos(a) * 0.02),
         (1.3 + math.sin(a) * 0.05, 0.34, 0.66 + math.cos(a) * 0.05), 0.007, PRACTICE)
butts.build()

# ---- the quarry -------------------------------------------------------------------------
ROCK = material('stone', 'quarry rock', 0x8f897c)
ROCK_TOP = material('stone', 'quarry weathered rock', 0x7d786d)
CUT = material('plain', 'quarry fresh cut', 0xd8ceb4)
TREAD = material('plain', 'quarry bench', 0xc6bb9f)
DUST = material('plain', 'quarry dust', 0xcfc6ae)
ASHLAR = material('plain', 'quarry ashlar', 0xdcd2b8)
ASHLAR_B = material('plain', 'quarry ashlar warm', 0xd0c3a3)
GROOVE = material('plain', 'quarry groove', 0xa39a84)
MOSS = material('plain', 'quarry grass', 0x6f9a3e)
BUSH = material('plain', 'quarry bush', 0x557f33)

QUARRY = collection('civic_quarry')
# The benches the quarrymen have cut, stepping up into the hill: each a flat tread and a sawn
# face. A face is straight where it is being worked and bends back at its ends into the rough
# rock, and no two are cut alike - the lowest has a notch where a block came out, the second is
# two cuts a hand apart in height, the third stops short of the left flank - because three even
# steps across the whole lot read as a stair on a lawn and not as a working face.
A_TOP, A_FACE = 0.32, -0.5
B_TOP, B_FACE = 0.64, -0.8
B2_TOP, B2_FACE = 0.7, -0.86
C_TOP, C_FACE = 0.98, -1.06
BENCHES = ((A_TOP, A_FACE), (B_TOP, B_FACE), (C_TOP, C_FACE))
EDGE = 1.46                 # every rock stays this far inside the lot line
# The benches stop short of the lot line (BACK) under the hill, which falls away to the line
# itself; a side of theirs back there is inside the hill, and every other side is a sawn face.
BACK = 1.3
cut_or_rough = lambda a, b: ROCK if (abs(a[0]) >= BACK and abs(b[0]) >= BACK) or (a[1] <= -BACK and b[1] <= -BACK) else CUT

rock = Part(QUARRY, 'benches')
box(rock, (0, 0.004, 0.0), (2 * EDGE, 0.008, 2 * EDGE), DUST)
prism(rock, [(-BACK, -BACK), (BACK, -BACK), (BACK, -0.7), (1.12, -0.6), (0.6, -0.6), (0.6, A_FACE),
             (-0.55, A_FACE), (-1.05, -0.54), (-BACK, -0.62)], 0.0, A_TOP, cut_or_rough, top=TREAD)
prism(rock, [(-BACK, -BACK), (0.2, -BACK), (0.2, B_FACE), (-0.6, B_FACE), (-1.04, -0.84), (-BACK, -0.92)],
      A_TOP - 0.01, B_TOP, cut_or_rough, top=TREAD)
prism(rock, [(0.2, -BACK), (BACK, -BACK), (BACK, -0.96), (1.1, B2_FACE), (0.2, B2_FACE)],
      A_TOP - 0.01, B2_TOP, cut_or_rough, top=TREAD)
prism(rock, [(-0.7, -BACK), (BACK, -BACK), (BACK, -1.16), (1.1, C_FACE), (-0.5, C_FACE), (-0.7, -1.14)],
      B_TOP - 0.01, C_TOP, cut_or_rough, top=TREAD)
# The joints in the faces: a bedding plane along each, and the upright cuts between the blocks
# still to come out, staggered course on course like the stone they will be laid as.
def joints(z, x0, x1, y0, bed, y1, lower, upper):
    box(rock, ((x0 + x1) / 2, bed, z + 0.003), (x1 - x0, 0.01, 0.006), GROOVE)
    for xs, ya, yb in ((lower, y0, bed), (upper, bed, y1)):
        for x in xs:
            box(rock, (x, (ya + yb) / 2, z + 0.003), (0.01, yb - ya, 0.006), GROOVE)
joints(A_FACE, -0.55, 0.6, 0.0, 0.17, A_TOP, (-0.3, 0.15), (-0.05, 0.4))
joints(B_FACE, -0.6, 0.2, A_TOP, 0.49, B_TOP, (-0.25,), (-0.02,))
joints(B2_FACE, 0.2, 1.1, A_TOP, 0.52, B2_TOP, (0.55,), (0.8,))
joints(C_FACE, -0.5, 1.1, B_TOP, 0.83, C_TOP, (-0.1,), (0.35, 0.85))
# The next block marked out on the second bench, and one cut loose on the other half of it,
# waiting for the crane.
for x0, x1, z in ((-0.5, -0.1, -0.87), (-0.5, -0.1, -1.0)):
    box(rock, ((x0 + x1) / 2, B_TOP + 0.002, z), (x1 - x0, 0.006, 0.012), GROOVE)
for x in (-0.5, -0.3, -0.1):
    box(rock, (x, B_TOP + 0.002, -0.935), (0.012, 0.006, 0.13), GROOVE)
box(rock, (0.74, B2_TOP + 0.06, -0.97), (0.2, 0.12, 0.14), ASHLAR_B, ry=0.06)
rock.build()

rough = Part(QUARRY, 'hill')
# The hill the benches are cut into: rough rock over the top bench and down both flanks, the
# faces the quarry sees tall and turf on the hillside behind them falling away, lower towards
# the front, so the workings read as a bay cut into a hill.
crest_x = (-EDGE, -1.05, -0.7, -0.35, 0.0, 0.35, 0.75, 1.1, EDGE)
crest_in = [(x, zi, h) for x, zi, h in zip(crest_x, (-1.2, -1.24, -1.18, -1.23, -1.2, -1.26, -1.21, -1.24, -1.2),
                                           (1.0, 1.46, 1.36, 1.5, 1.4, 1.47, 1.38, 1.44, 0.96))]
crest_out = [(x, -EDGE, h) for x, h in zip(crest_x, (0.7, 0.78, 0.84, 0.8, 0.9, 0.82, 0.86, 0.78, 0.68))]
ridge(rough, crest_in, crest_out, 0.0, ROCK, ROCK_TOP, turf=MOSS, splay=0.06)
left_z = (-1.3, -1.05, -0.8, -0.55, -0.3, -0.05, 0.2, 0.45)
left_in = [(x, z, h) for z, x, h in zip(left_z, (-1.08, -1.02, -1.1, -1.04, -1.12, -1.06, -1.14, -1.24),
                                        (1.42, 1.3, 1.08, 0.94, 0.72, 0.58, 0.4, 0.22))]
left_out = [(-EDGE, z, h) for z, h in zip(left_z, (0.8, 0.72, 0.62, 0.52, 0.42, 0.32, 0.22, 0.12))]
ridge(rough, left_in, left_out, 0.0, ROCK, ROCK_TOP, turf=MOSS, splay=0.1)
right_z = (-1.3, -1.05, -0.8, -0.55, -0.32)
right_in = [(x, z, h) for z, x, h in zip(right_z, (1.12, 1.16, 1.1, 1.18, 1.24), (1.38, 1.18, 1.02, 0.74, 0.44))]
right_out = [(EDGE, z, h) for z, h in zip(right_z, (0.76, 0.66, 0.56, 0.42, 0.24))]
ridge(rough, right_in, right_out, 0.0, ROCK, ROCK_TOP, turf=MOSS, splay=0.1)
# Boulders on the crest and at the foot of the flanks, and two bushes that have got a hold.
rng = random.Random('quarry boulders')
# The heights are the hill's own at each spot, worked out from the stations above.
for x, y, z, r in ((-0.2, 1.06, -1.36, 0.1), (0.55, 0.96, -1.4, 0.08), (-1.3, 0.79, -0.75, 0.09),
                   (-0.98, 0.0, 0.3, 0.09), (1.08, 0.0, -0.28, 0.08), (1.34, 0.79, -0.95, 0.07)):
    lump(rough, (x, max(0.0, y - 0.03), z), r, r * 0.85, r * 0.9, ROCK_TOP, rng, sides=5, top_mat=ROCK)
lump(rough, (-0.62, 0.94, -1.38), 0.12, 0.1, 0.16, BUSH, rng, sides=5)
lump(rough, (0.95, 0.9, -1.4), 0.1, 0.09, 0.14, BUSH, rng, sides=5)
for x, z, y in ((-1.36, -0.45, 0.6), (-1.38, 0.1, 0.33), (1.38, -0.62, 0.57), (0.2, -1.4, 0.96)):
    cone(rough, (x, y - 0.04, z), (x + rng.uniform(-0.02, 0.02), y + 0.1, z), 0.05, BUSH, sides=3, turn=rng.uniform(0, 3))
rough.build()

rubble = Part(QUARRY, 'spoil')
# Spoil at the foot of the faces.
rng = random.Random('quarry spoil')
for x, z, r in ((-0.9, -0.36, 0.08), (-0.95, 0.95, 0.12), (-0.25, -0.4, 0.06), (0.62, -0.42, 0.05), (1.02, -0.5, 0.06)):
    lump(rubble, (x, 0.0, z), r, r * 0.8, r * 0.6, DUST if r > 0.1 else ROCK, rng, sides=5)
rubble.build()

# ---- the quarry's yard -------------------------------------------------------------------
QYARD = collection('civic_quarry_yard')
BLOCK = (0.2, 0.12, 0.14)                 # a cut block: 80 by 50 by 55 cm
RAIL_X, RAIL_Z0, RAIL_Z1, GAUGE = 0.0, -0.3, 1.3, 0.14
SLEEPER, RAIL_H = 0.015, 0.012
RAIL_TOP = SLEEPER + RAIL_H
TUB_BACK = -0.1                           # where the tub waits under the crane
TUB_R = 0.04                              # its wheels
TUB_BOT, TUB_TOP = RAIL_TOP + TUB_R + 0.008, RAIL_TOP + TUB_R + 0.14
# The crane: the pick is a block on the lowest bench, the drop is on the tub at its back end,
# and the mast stands where the two are the same reach away - which is what lets the jib slew
# from one to the other and let the rope straight down onto either.
PICK = Vector((0.46, BENCHES[0][0], -0.64))
DROP = Vector((RAIL_X, TUB_TOP, TUB_BACK))
mid = (PICK + DROP) / 2
normal = Vector((DROP.z - PICK.z, 0, -(DROP.x - PICK.x))).normalized()
if normal.x < 0:
    normal = -normal
MAST = Vector((mid.x, 0, mid.z)) + normal * 0.62
REACH = (Vector((PICK.x, 0, PICK.z)) - MAST).length
TIP_Y, MAST_H = 1.05, 1.24
toward = (Vector((PICK.x, 0, PICK.z)) - MAST).normalized()
TIP = MAST + toward * REACH + Vector((0, TIP_Y, 0))
AXLE = Vector((1.12, 0.4, 0.16))          # the treadwheel's axle, along x
DRUM_R, TREAD_R = 0.045, 0.36

rail = Part(QYARD, 'rail')
n = 8
for i in range(n + 1):
    z = RAIL_Z0 + (RAIL_Z1 - RAIL_Z0) * i / n
    box(rail, (RAIL_X, SLEEPER / 2, z), (GAUGE + 0.08, SLEEPER, 0.04), TIMBER)
for s in (-1, 1):
    box(rail, (RAIL_X + s * GAUGE / 2, SLEEPER + RAIL_H / 2, (RAIL_Z0 + RAIL_Z1) / 2), (0.014, RAIL_H, RAIL_Z1 - RAIL_Z0), IRON)
# A stop at the back, so the tub does not run into the face.
box(rail, (RAIL_X, 0.07, RAIL_Z0 - 0.02), (GAUGE + 0.06, 0.05, 0.05), OAK)
for s in (-1, 1):
    box(rail, (RAIL_X + s * (GAUGE / 2 + 0.03), 0.05, RAIL_Z0 - 0.02), (0.03, 0.1, 0.03), TIMBER)
rail.build()

tub = Part(QYARD, 'tub', (RAIL_X, RAIL_TOP, TUB_BACK))
# The tub: a flaring box of boards on four iron wheels, with the rubble it carries under the
# block it is given; baked at the rail's back end.
tz = TUB_BACK
hb, hbz, ht, htz = 0.08, 0.1, 0.105, 0.13
pts = [(RAIL_X - hb, TUB_BOT, tz - hbz), (RAIL_X + hb, TUB_BOT, tz - hbz), (RAIL_X + hb, TUB_BOT, tz + hbz), (RAIL_X - hb, TUB_BOT, tz + hbz),
       (RAIL_X - ht, TUB_TOP, tz - htz), (RAIL_X + ht, TUB_TOP, tz - htz), (RAIL_X + ht, TUB_TOP, tz + htz), (RAIL_X - ht, TUB_TOP, tz + htz)]
tub.add(pts, [[0, 1, 2, 3], [0, 4, 5, 1], [1, 5, 6, 2], [2, 6, 7, 3], [3, 7, 4, 0]], WEATHERED)
tub.add([(RAIL_X - ht + 0.012, TUB_TOP - 0.02, tz - htz + 0.012), (RAIL_X + ht - 0.012, TUB_TOP - 0.02, tz - htz + 0.012),
         (RAIL_X + ht - 0.012, TUB_TOP - 0.02, tz + htz - 0.012), (RAIL_X - ht + 0.012, TUB_TOP - 0.02, tz + htz - 0.012)],
        [[3, 2, 1, 0]], ROCK)
for z in (tz - htz - 0.002, tz + htz + 0.002):
    box(tub, (RAIL_X, TUB_TOP - 0.015, z), (2 * ht + 0.01, 0.02, 0.008), IRON)
for s in (-1, 1):
    for dz in (-0.065, 0.065):
        wheel(tub, (RAIL_X + s * GAUGE / 2, RAIL_TOP + TUB_R, tz + dz), (1, 0, 0), TUB_R, 0.016, IRON, sides=6)
tub.build()

block = Part(QYARD, 'block', PICK)
# One block, baked lying on the bench where the crane picks it up. quarry.js draws it there,
# under the hook, and on the tub.
box(block, PICK + Vector((0, BLOCK[1] / 2, 0)), BLOCK, ASHLAR)
block.build()

HOOK_H = 0.07
hook = Part(QYARD, 'hook', PICK + Vector((0, BLOCK[1] + HOOK_H, 0)))
# The lewis: a shackle where the rope ties on, and two iron legs gripping the block's ends.
hk = hook.origin
box(hook, hk + Vector((0, -0.012, 0)), (0.03, 0.024, 0.012), IRON)
for s in (-1, 1):
    beam(hook, hk + Vector((0, -0.02, 0)), hk + Vector((s * 0.09, -HOOK_H + 0.02, 0)), 0.01, IRON)
    box(hook, hk + Vector((s * 0.105, -HOOK_H + 0.01, 0)), (0.012, 0.04, 0.03), IRON)
hook.build()

rope = Part(QYARD, 'rope', TIP)
box(rope, Vector((TIP.x, (TIP.y + hk.y) / 2, TIP.z)), (0.008, TIP.y - hk.y, 0.008), ROPE)
rope.build()

jib = Part(QYARD, 'jib', MAST)
# The mast turns on its foot and carries the boom with it: a derrick. Built pointing at the
# pick, which is how quarry.js knows the angle it rests at.
foot = Vector((MAST.x, 0.04, MAST.z))
box(jib, foot + Vector((0, MAST_H / 2, 0)), (0.055, MAST_H, 0.055), OAK)
box(jib, foot + Vector((0, MAST_H + 0.01, 0)), (0.07, 0.03, 0.07), IRON)
heel = foot + toward * 0.04 + Vector((0, 0.24, 0))
beam(jib, heel, TIP, 0.045, OAK)
beam(jib, foot + Vector((0, MAST_H, 0)), TIP + Vector((0, 0.02, 0)), 0.012, ROPE)
beam(jib, foot + Vector((0, 0.62, 0)), foot + toward * (REACH * 0.45) + Vector((0, 0.24 + (TIP_Y - 0.24) * 0.45, 0)), 0.03, TIMBER)
box(jib, TIP, (0.05, 0.05, 0.05), IRON)
jib.build()

crane = Part(QYARD, 'crane')
# What does not turn: the cross of timbers the mast stands in, the two A-frames the treadwheel
# hangs in, and the rope from the drum to the mast head - which ends on the mast's own axis, so
# it is the same rope whichever way the jib points.
for a in (0.0, math.pi / 2):
    box(crane, (MAST.x, 0.02, MAST.z), (0.4, 0.04, 0.06), TIMBER, ry=a + 0.4)
box(crane, (MAST.x, 0.06, MAST.z), (0.1, 0.05, 0.1), FOOTING)
for x in (AXLE.x - 0.17, AXLE.x + 0.17):
    for s in (-1, 1):
        beam(crane, (x, 0.0, AXLE.z + s * 0.3), (x, AXLE.y + 0.03, AXLE.z), 0.04, TIMBER)
    box(crane, (x, 0.12, AXLE.z), (0.04, 0.035, 0.48), TIMBER_Z)
    box(crane, (x, AXLE.y + 0.03, AXLE.z), (0.06, 0.05, 0.08), IRON)
beam(crane, (AXLE.x - 0.19, AXLE.y + DRUM_R, AXLE.z), (MAST.x, MAST_H + 0.04, MAST.z), 0.01, ROPE)
crane.build()

tread = Part(QYARD, 'wheel', AXLE)
# The treadwheel: two rims of ten, treads across them to walk on, spokes to the drum the rope
# winds on. 0.72 across, so a settler could walk in it.
SIDES = 10
for x in (AXLE.x - 0.11, AXLE.x + 0.11):
    rim(tread, (x, AXLE.y, AXLE.z), (1, 0, 0), TREAD_R - 0.035, TREAD_R, 0.03, WEATHERED, SIDES)
    for a in (0.3, 0.3 + math.pi / 2):
        beam(tread, (x, AXLE.y + math.sin(a) * (TREAD_R - 0.03), AXLE.z + math.cos(a) * (TREAD_R - 0.03)),
             (x, AXLE.y - math.sin(a) * (TREAD_R - 0.03), AXLE.z - math.cos(a) * (TREAD_R - 0.03)), 0.028, TIMBER)
for i in range(SIDES):
    a = 2 * math.pi * (i + 0.5) / SIDES
    r = (TREAD_R - 0.035) * math.cos(math.pi / SIDES) - 0.008
    box(tread, (AXLE.x, AXLE.y + math.sin(a) * r, AXLE.z + math.cos(a) * r), (0.25, 0.016, 0.05), OAK, rx=-a + math.pi / 2)
cylinder(tread, (AXLE.x - 0.2, AXLE.y, AXLE.z), (AXLE.x + 0.2, AXLE.y, AXLE.z), DRUM_R, TIMBER, sides=8, cap=GRAIN)
tread.build()

stack = Part(QYARD, 'blocks')
# The blocks the tub has brought down, stacked by the lane to go: two courses and a third
# begun, in two stones' worth of colour.
SX, SZ = 0.6, 1.02
k = 0
for layer, cells in enumerate((((0, 0), (1, 0), (2, 0), (0, 1), (1, 1), (2, 1)), ((0.5, 0), (1.5, 0), (0.5, 1)), ((1, 0.5),))):
    for cx, cz in cells:
        x = SX + (cx - 1) * (BLOCK[0] + 0.012)
        z = SZ + (cz - 0.5) * (BLOCK[2] + 0.012)
        box(stack, (x, BLOCK[1] / 2 + layer * BLOCK[1], z), BLOCK, ASHLAR if k % 3 else ASHLAR_B, ry=0.04 * ((k * 7) % 3 - 1))
        k += 1
stack.build()

banker = Part(QYARD, 'banker')
# The stonecutter's banker: a heavy bench at standing height, a block on it being squared, his
# mallet and a chisel, and the chips round his feet.
BKX, BKZ = -0.62, 0.62
for dx in (-0.2, 0.2):
    for dz in (-0.1, 0.1):
        box(banker, (BKX + dx, 0.1, BKZ + dz), (0.05, 0.2, 0.05), TIMBER)
box(banker, (BKX, 0.225, BKZ), (0.5, 0.05, 0.28), OAK)
box(banker, (BKX, 0.07, BKZ), (0.42, 0.03, 0.2), TIMBER)
box(banker, (BKX - 0.05, 0.25 + 0.055, BKZ), (0.2, 0.11, 0.15), ASHLAR_B, ry=0.1)
cylinder(banker, (BKX + 0.12, 0.278, BKZ + 0.06), (BKX + 0.12, 0.278, BKZ + 0.12), 0.028, OAK, sides=6, cap=GRAIN)
beam(banker, (BKX + 0.12, 0.262, BKZ + 0.06), (BKX + 0.22, 0.258, BKZ - 0.04), 0.012, TIMBER)
beam(banker, (BKX + 0.16, 0.255, BKZ - 0.08), (BKX + 0.08, 0.255, BKZ - 0.1), 0.008, STEEL)
rng = random.Random('quarry chips')
for i in range(3):
    x, z = BKX + rng.uniform(-0.3, 0.3), BKZ + rng.uniform(0.16, 0.3)
    lump(banker, (x, 0.0, z), 0.035, 0.03, 0.02, ASHLAR, rng, sides=4)
banker.build()

ladder = Part(QYARD, 'ladder')
# A ladder up the lowest face, and a pick leant beside it.
LXL, LZF = -0.42, BENCHES[0][1] + 0.01
foot_z, top_y = LZF + 0.14, BENCHES[0][0] + 0.12
for dx in (-0.06, 0.06):
    beam(ladder, (LXL + dx, 0.0, foot_z), (LXL + dx, top_y, LZF + 0.01), 0.022, OAK)
for i in range(4):
    f = (i + 0.7) / 4.5
    box(ladder, (LXL, top_y * f, foot_z + (LZF + 0.01 - foot_z) * f), (0.12, 0.016, 0.016), TIMBER)
beam(ladder, (-0.2, 0.0, LZF + 0.1), (-0.17, 0.3, LZF + 0.02), 0.014, OAK)
box(ladder, (-0.17, 0.3, LZF + 0.02), (0.012, 0.02, 0.14), IRON, rx=0.25)
ladder.build()

# The tallest thing in the set is the brewery's chimney; buildings.js asks each asset its own.
bpy.context.scene['building_height'] = STACK_TOP
print('quarry crane: mast', tuple(round(v, 4) for v in MAST), 'reach', round(REACH, 4),
      'drop off by', round(abs((Vector((DROP.x, 0, DROP.z)) - MAST).length - REACH), 6))
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'workshops.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'workshops'})
