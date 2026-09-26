"""The greengrocer. Rebuild with scripts/blender.mjs --background --python scripts/build-grocer.py.

A small shop on the square, one of the village-centre shops that share a house style with the
tavern and the bakery: a stone plinth, cream plaster in warm oak timbers, a jettied upper floor
and a terracotta roof at the tavern's pitch. Its roofline is its own: the ridge runs to the
street, so the whole front is one gable - the upper floor, then the top of the gable jettied out
again over a beam, with posts and raking struts up to a collar, an attic window between them and
a king post over it. The shops beside it turn their ridge the other way; in a street this is the
one that stands end-on. On the ground floor the painted shopfront, in leaf green: a door in the
middle with a lit pane and a fanlight, a wide shop window either side, and one striped
green-and-cream awning hung from the jetty beam over all of it. Out front, either side of the
door, a trestle of crates - the back row tipped towards the street on a riser - full of apples,
cabbages, carrots, pears, plums, tomatoes and small pumpkins; a heap of pumpkins at one end and
sacks of potatoes at the other; and a sign on an iron arm at the corner, a green hoop with a big
pumpkin sitting in it. The market already has an open seed stall, so everything here says
*shop*: a door, glass, an upper floor somebody lives in, and the produce set out in front.

One civic asset, `civic_grocer` (budget 1500), static - nothing in it moves. `anchor.door` is at
the foot of the door, in the middle of the front, just off the doorstep, where the island's paths
arrive; `anchor.smoke` is on top of the chimney pot.

Its size is the village's, not the lot's. It was first built to fill its 3x3 lot like a terrace
house, 2.8 wide and 3.3 tall, and on the island it stood twice the size of the tavern (1.80 x
1.57 x 1.69) and the bakery beside it - the houses are 1.0-1.2 wide and 1.1-1.9 tall. So the body
is x -0.84..0.84, z -0.52..0.82, eaves at 0.93, ridge at 1.64 (40 degrees, the tavern's roof
rises 0.57 over 0.62), chimney pot at 1.80; it stands towards the street on its lot, and nothing
on the pavement passes z 1.21 or |x| 1.0. A door is 0.28 x 0.46 and a window about 0.2 across,
the tavern's and the bakery's scale, which is what makes the three read as one street.

The doorway is kept clear from x -0.30 to 0.30: the crates stand either side of it, never in
front, and each side's display is its own part, so that a footprint taken a rectangle per baked
part (footprintOf in web/js/buildings.js, with merging off) leaves the gap between them open.
The same footprint counts every vertex below WALK_CLEARANCE (0.55), so the awning and the sign,
which reach out over the pavement, keep every corner above 0.556: one dipping lower would stand
a rectangle across the doorway at the awning's front edge.

Everything is coarse on purpose. The shell is outer faces only - nobody sees inside a shop whose
windows are dark glass - and a timber, a sill or a glazing bar has only the faces that face the
street, so the triangles go where the eye goes: the produce. A fruit is a dome of ten triangles
half sunk in a crate whose lid is painted the same produce a shade darker, so three fruit on top
read as a crate full; the pumpkins that have to read on their own get a shoulder and a dimple.
What stopped reading at this size went: the strings of garlic and onions on the door posts, the
little window in the apex, the second chimney pot, the loose potatoes on the sack.

Plaster takes the wall sheet, the tiles the roof sheet, the stone the stone sheet and the timber
the plank sheets, so the island's own textures draw the courses and the boards.
Written in island coordinates (x right, y up, z to the front) through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/grocer'
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


# The tavern's palette (scripts/build-tavern.py): its cream plaster, its terracotta and the lighter
# ridge course, warm oak rather than near-black, its brick chimney and its warm footing stone.
PLASTER = material('wall', 'grocer plaster', 0xe8d4ad)
TIMBER = material('plank', 'grocer timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'grocer timber', 0x6a4426)
TILES = material('roof', 'grocer tiles', 0xb8552f)
RIDGE_TILES = material('roof', 'grocer ridge tiles', 0xc76b3d)
STONE = material('stone', 'grocer stone', 0x968778)
PIER = material('stone', 'grocer pier', 0x8f8c86)
BRICK = material('stone', 'grocer chimney', 0x9c5a44)
GREEN = material('plank', 'grocer leaf green', 0x4ea93d)
DOOR = material('plank', 'grocer door', 0x2f7a2c)
CREAM = material('plain', 'grocer cream', 0xf2e9cf)
GLASS = material('plain', 'grocer window', 0x2a2e33)
GLOW = material('plain', 'grocer lit window', 0xffd88a, emissive=True)
BRASS = material('plain', 'grocer brass', 0xc9a24a)
IRON = material('plain', 'grocer iron', 0x2e2f33)
POT = material('plain', 'grocer chimney pot', 0xae5f3c)
AWN_A = material('plain', 'grocer awning', 0x45a23a)
AWN_B = material('plain', 'grocer awning stripe', 0xf4ecd4)
CRATE = material('plank', 'grocer crate', 0xb57d45)
TRESTLE = material('plank', 'grocer trestle', 0x7a5232)
APPLE = material('plain', 'grocer apple', 0xd8342a)
GREEN_APPLE = material('plain', 'grocer green apple', 0x9fcf3e)
CABBAGE = material('plain', 'grocer cabbage', 0x6cb043)
CARROT = material('plain', 'grocer carrot', 0xf28a1e)
LEAF = material('plain', 'grocer leaf', 0x3f8f2e)
PEAR = material('plain', 'grocer pear', 0xe6cf48)
PLUM = material('plain', 'grocer plum', 0x6e3a72)
TOMATO = material('plain', 'grocer tomato', 0xe8502e)
PUMPKIN = material('plain', 'grocer pumpkin', 0xe8791a)
STALK = material('plain', 'grocer stalk', 0x5f6b2a)
POTATO = material('plain', 'grocer potato', 0xbf955c)
# What a crate's lid is painted: the same produce a shade darker, which is what the gaps between
# the fruit on top look like - so the three on top read as three, and the crate as full.
FILL = {m: material('plain', m.name.split(':', 1)[1] + ' heap', c) for m, c in (
    (APPLE, 0x9c2219), (GREEN_APPLE, 0x6e9828), (CABBAGE, 0x467e2c), (CARROT, 0xb4600f),
    (PEAR, 0xaa9528), (PLUM, 0x45224b), (TOMATO, 0xa3301b), (PUMPKIN, 0xa95212))}
SACK = material('plain', 'grocer sack', 0xcdb384)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

    def __init__(self, asset, name, origin=(0, 0, 0)):
        self.asset, self.name, self.origin = asset, f'{asset.name} {name}', Vector(origin)
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def add(self, points, faces, mat, centre=None, facing=None):
        """`mat` is one material or one per face. With `centre` (a convex shape) or `facing`
        (a flat one) every face is turned to look away from it, so a helper does not have to
        get its winding right by hand - the island draws front faces only."""
        pts = [Vector(p) for p in points]
        base = len(self.verts)
        self.verts.extend(p - self.origin for p in pts)
        mats = mat if isinstance(mat, list) else [mat] * len(faces)
        for f, m in zip(faces, mats):
            if centre is not None or facing is not None:
                n = (pts[f[1]] - pts[f[0]]).cross(pts[f[2]] - pts[f[0]])
                out = (sum((pts[i] for i in f), Vector()) / len(f) - Vector(centre)) if centre is not None else Vector(facing)
                if n.dot(out) < 0:
                    f = f[::-1]
            self.faces.append([base + i for i in f])
            self.mats.append(self.slot(m))

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


# A box's six faces by the side they face, in its own frame before it is turned. A timber on a
# wall has no back, a crate on a trestle no bottom: `skip` leaves those out, `only` keeps just
# the ones named, and `paint` gives single faces a colour of their own (a crate's lid).
FACES = {'back': [0, 3, 2, 1], 'front': [4, 5, 6, 7], 'bottom': [0, 1, 5, 4],
         'top': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 4, 7, 3]}


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=(), only=None, paint=None):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    names = [n for n in FACES if n not in skip and (only is None or n in only)]
    part.add(pts, [FACES[n] for n in names], [(paint or {}).get(n, mat) for n in names])


def wall(part, x0, x1, y0, y1, z, mat, t=0.03, faces=('front', 'top', 'left', 'right')):
    """A board or a timber on the front of a wall at `z`, `t` proud of it."""
    box(part, ((x0 + x1) / 2, (y0 + y1) / 2, z + t / 2), (x1 - x0, y1 - y0, t), mat, only=faces)


def beam(part, a, b, w, t, mat, lift=0.0, skip=()):
    """A board from a to b, `w` across and `t` thick, raised `lift` of its thickness off the
    line - a roof pitch sits on its rafters, so its underside passes through a and b."""
    a, b = Vector(a), Vector(b)
    d = b - a
    yaw = math.atan2(d.x, d.z)
    pitch = math.atan2(d.y, math.hypot(d.x, d.z))
    m = rotation(rx=-pitch, ry=yaw)
    normal = m @ Vector((0, 1, 0))
    box(part, (a + b) / 2 + normal * (t * lift), (w, t, d.length), mat, rx=-pitch, ry=yaw, skip=skip)


def quad(part, pts, mat, facing=(0, 0, 1)):
    part.add(pts, [[0, 1, 2, 3]], mat, facing=facing)


def pane(part, x0, x1, y0, y1, z, mat):
    quad(part, [(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], mat)


def side_pane(part, x, z0, z1, y0, y1, mat, f):
    """A pane on a side wall at x, facing f (-1 left, 1 right)."""
    quad(part, [(x, y0, z0), (x, y0, z1), (x, y1, z1), (x, y1, z0)], mat, facing=(f, 0, 0))


def lump(part, c, r, h, mat, n=5, turn=0.0, low=None, squash=1.0):
    """A potato: a ring of n corners with a point above and a flatter one below."""
    cx, cy, cz = c
    low = h * 0.7 if low is None else low
    ring = [(cx + r * math.cos(turn + 2 * math.pi * i / n), cy, cz + r * squash * math.sin(turn + 2 * math.pi * i / n)) for i in range(n)]
    faces = [[i, (i + 1) % n, n] for i in range(n)] + [[(i + 1) % n, i, n + 1] for i in range(n)]
    part.add(ring + [(cx, cy + h, cz), (cx, cy - low, cz)], faces, mat, centre=c)


def dome(part, c, r, h, mat, n=5, turn=0.0):
    """A fruit half sunk in a full crate: a ring of n on the lid, a smaller ring turned half a
    step above it, and a flat cap - rounder than a point for three more triangles, and the half
    of it that would be under the lid is never made."""
    cx, cy, cz = c
    low = [(cx + r * math.cos(turn + 2 * math.pi * i / n), cy, cz + r * math.sin(turn + 2 * math.pi * i / n)) for i in range(n)]
    high = [(cx + 0.6 * r * math.cos(turn + 2 * math.pi * (i + 0.5) / n), cy + h, cz + 0.6 * r * math.sin(turn + 2 * math.pi * (i + 0.5) / n)) for i in range(n)]
    faces = [[i, (i + 1) % n, n + i] for i in range(n)] + [[(i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces.append([n + i for i in range(n)])
    part.add(low + high, faces, mat, centre=(cx, cy + h * 0.3, cz))


def gourd(part, c, r, h, mat, n=6, turn=0.0):
    """A cabbage, a small pumpkin: two ribbed rings between a top and a flat-ish bottom."""
    cx, cy, cz = c
    rings = [(-0.3 * h, 0.92), (0.14 * h, 1.0)]
    pts = []
    for dy, k in rings:
        for i in range(n):
            t = turn + 2 * math.pi * i / n
            rr = r * k * (1.0 if i % 2 == 0 else 0.86)
            pts.append((cx + rr * math.cos(t), cy + dy, cz + rr * math.sin(t)))
    pts += [(cx, cy - 0.5 * h, cz), (cx, cy + 0.4 * h, cz)]
    faces = [[(i + 1) % n, i, 2 * n] for i in range(n)]
    faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    faces += [[n + i, n + (i + 1) % n, 2 * n + 1] for i in range(n)]
    part.add(pts, faces, mat, centre=c)


def pumpkin(part, c, r, h, n=8, turn=0.0):
    """The one that has to read on its own: three ribbed rings, so it has a shoulder, and a top
    sunk below the upper ring, so it has the dimple a stalk grows out of. The crates' pumpkins
    are gourd()s, at the size where nobody can tell."""
    cx, cy, cz = c
    rings = [(-0.3 * h, 0.8), (0.02 * h, 1.0), (0.3 * h, 0.72)]
    pts = []
    for dy, k in rings:
        for i in range(n):
            t = turn + 2 * math.pi * i / n
            rr = r * k * (1.0 if i % 2 == 0 else 0.88)
            pts.append((cx + rr * math.cos(t), cy + dy, cz + rr * math.sin(t)))
    pts += [(cx, cy - 0.5 * h, cz), (cx, cy + 0.2 * h, cz)]
    faces = [[(i + 1) % n, i, 3 * n] for i in range(n)]
    for j in range(2):
        faces += [[j * n + i, j * n + (i + 1) % n, (j + 1) * n + (i + 1) % n, (j + 1) * n + i] for i in range(n)]
    part.add(pts[:3 * n + 1], faces, PUMPKIN, centre=c)
    # The dimple is concave, so its faces are turned by hand: up, towards the stalk.
    part.add(pts[2 * n:3 * n] + pts[3 * n + 1:], [[i, (i + 1) % n, n] for i in range(n)], PUMPKIN, facing=(0, 1, 0))


def frustum(part, c, r0, r1, h, mat, n=6, top=None, turn=0.0, squash=1.0):
    """A sack, a pot: n sides from radius r0 at the bottom to r1 at the top, lid optional."""
    cx, cy, cz = c
    ring = lambda y, r: [(cx + r * math.cos(turn + 2 * math.pi * i / n), y, cz + r * squash * math.sin(turn + 2 * math.pi * i / n)) for i in range(n)]
    pts = ring(cy, r0) + ring(cy + h, r1)
    faces = [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    mats = [mat] * n
    if top is not None:
        faces.append([n + i for i in range(n)])
        mats.append(top)
    part.add(pts, faces, mats, centre=(cx, cy + h / 2, cz))


def cone(part, a, b, r, mat, n=4, turn=0.0):
    """A carrot: n sides from a base at a to a point at b."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u).normalized()
    ring = [a + (u * math.cos(turn + 2 * math.pi * i / n) + v * math.sin(turn + 2 * math.pi * i / n)) * r for i in range(n)]
    faces = [[i, (i + 1) % n, n] for i in range(n)] + [list(range(n))]
    part.add(ring + [b], faces, mat, centre=a + (b - a) * 0.3)


ASSET = bpy.data.collections.new('civic_grocer')
bpy.context.scene.collection.children.link(ASSET)

# ---- the measurements ---------------------------------------------------------------------
X0, X1 = -0.84, 0.84          # the side walls
ZB = -0.52                     # the back wall
ZF = 0.78                      # the ground floor's front
ZU = 0.82                      # the upper floor's front, jettied out over it
PL = 0.14                      # the stone plinth, as high as the tavern's
G = 0.64                       # the first floor, where the jetty beam runs
GB_H = 0.045                   # that beam's height
# Eaves on the side walls and the ridge running to the street: a pitch of 40 degrees, and the whole
# front is one gable. A little lower than the apothecary's 44, because this is the one shop that
# shows the street its full height: at 1.70 it stood over the tavern beside it.
EAVES, RIDGE = 0.93, 1.64
SLOPE = (RIDGE - EAVES) / X1
UP = 1.02                      # where the top of the gable is jettied out again
ZG = ZU + 0.035                # the face of that top part
RT = 0.04                      # tile thickness
XR = 0.94                      # how far the eaves reach past the side walls: the tavern's 0.1
GF, GB = ZG + 0.1, ZB - 0.1    # the roof's front and back edges, past the gables
COLLAR = 1.34                  # the collar across the top of the gable


def half(y):
    """Half the width of the front gable at height y."""
    return min(X1, (RIDGE - y) / SLOPE)


# ---- the shell: outer faces only ----------------------------------------------------------
house = Part(ASSET, 'house')
for x, f in ((X0, -1), (X1, 1)):
    quad(house, [(x, 0, ZB), (x, 0, ZF), (x, PL, ZF), (x, PL, ZB)], STONE, facing=(f, 0, 0))
    quad(house, [(x, PL, ZB), (x, PL, ZF), (x, G, ZF), (x, G, ZB)], PLASTER, facing=(f, 0, 0))
    quad(house, [(x, G, ZB), (x, G, ZU), (x, EAVES, ZU), (x, EAVES, ZB)], PLASTER, facing=(f, 0, 0))
    # A small window upstairs in each side, flat: the sides are seen across the square, but the
    # front is what the shop is.
    side_pane(house, x + f * 0.002, 0.02, 0.22, 0.7, 0.87, GLASS, f)
    side_pane(house, x + f * 0.004, 0.05, 0.19, 0.73, 0.84, GLOW, f)
quad(house, [(X0, 0, ZB), (X1, 0, ZB), (X1, PL, ZB), (X0, PL, ZB)], STONE, facing=(0, 0, -1))
house.add([(X0, PL, ZB), (X1, PL, ZB), (X1, EAVES, ZB), (0, RIDGE, ZB), (X0, EAVES, ZB)], [[0, 1, 2, 3, 4]],
          PLASTER, facing=(0, 0, -1))
# At the back, over the yard: a window up in the gable, one downstairs, and a door.
for (x0, x1, y0, y1), dz, mat in (((-0.1, 0.1, 1.0, 1.18), 0.002, GLASS), ((-0.075, 0.075, 1.025, 1.155), 0.004, GLOW),
                                  ((-0.6, -0.42, 0.3, 0.48), 0.002, GLASS), ((-0.575, -0.445, 0.325, 0.455), 0.004, GLOW),
                                  ((0.34, 0.56, 0.03, 0.47), 0.002, DOOR)):
    quad(house, [(x0, y0, ZB - dz), (x1, y0, ZB - dz), (x1, y1, ZB - dz), (x0, y1, ZB - dz)], mat, facing=(0, 0, -1))
pane(house, X0, X1, 0, G, ZF, STONE)
# The front gable in two: the upper floor, and the top jettied out over it on a beam of its own.
house.add([(X0, G, ZU), (X1, G, ZU), (X1, EAVES, ZU), (half(UP), UP, ZU), (-half(UP), UP, ZU), (X0, EAVES, ZU)],
          [[0, 1, 2, 3, 4, 5]], PLASTER, facing=(0, 0, 1))
house.add([(-half(UP), UP, ZG), (half(UP), UP, ZG), (0, RIDGE, ZG)], [[0, 1, 2]], PLASTER, facing=(0, 0, 1))
# The stone piers at the corners of the shopfront, a little proud of it.
for s in (-1, 1):
    box(house, (s * 0.8, G / 2, ZF + 0.015), (0.08, G, 0.03), PIER, skip=('back', 'bottom', 'top'))
# A doorstep.
box(house, (0, 0.015, ZF + 0.04), (0.36, 0.03, 0.08), STONE, skip=('back', 'bottom'))
house.build()

# ---- the timber frame -----------------------------------------------------------------------
frame = Part(ASSET, 'frame')
# The jetty beam the upper floor stands out on, a post at each corner and two either side of the
# middle window, up to the beam the top of the gable stands out on.
box(frame, (0, G + GB_H / 2, (ZF + ZU + 0.02) / 2), (2 * X1 + 0.03, GB_H, ZU + 0.02 - ZF), TIMBER, skip=('back',))
for x in (-0.815, 0.815):
    box(frame, (x, (G + GB_H + EAVES) / 2, ZU + 0.015), (0.05, EAVES - G - GB_H, 0.03), TIMBER, only=('front', 'left', 'right'))
for x in (-0.31, 0.31):
    wall(frame, x - 0.02, x + 0.02, G + GB_H, UP - 0.04, ZU, TIMBER, t=0.025, faces=('front', 'left', 'right'))
# No wider than the gable is at its top, or its ends come up through the tiles.
box(frame, (0, UP - 0.02, (ZU + ZG) / 2 + 0.005), (2 * half(UP) - 0.02, 0.04, ZG - ZU + 0.04), TIMBER, skip=('back',))
# Along the sides: the plate under the eaves, the floor line, a post at the back corner and one
# in the middle, as the tavern's sides have.
for s in (-1, 1):
    x, out = s * (X1 + 0.012), 'right' if s > 0 else 'left'     # the face away from the wall
    box(frame, (x, EAVES - 0.02, (ZB + ZU) / 2), (0.024, 0.04, ZU - ZB), TIMBER_Z, only=(out, 'bottom'))
    box(frame, (x, G + 0.02, (ZB + ZU) / 2), (0.024, 0.04, ZU - ZB), TIMBER_Z, only=(out, 'top', 'bottom'))
    box(frame, (x, (PL + EAVES) / 2, 0.36), (0.024, EAVES - PL, 0.045), TIMBER, only=(out, 'front', 'back'))
    # The back corner post stands proud of both walls, so one post shows on the side and the back.
    box(frame, (s * (X1 - 0.015), (PL + EAVES) / 2, ZB + 0.015), (0.054, EAVES - PL, 0.054), TIMBER, only=(out, 'back'))
# Across the back: the floor line, a tie beam at the eaves and two posts, so the back is framed
# like the tavern's rather than a blank gable - it is what the road behind the square sees.
box(frame, (0, G + 0.02, ZB - 0.012), (2 * X1, 0.04, 0.024), TIMBER, only=('back', 'top', 'bottom'))
box(frame, (0, EAVES - 0.02, ZB - 0.012), (2 * X1, 0.04, 0.024), TIMBER, only=('back', 'top', 'bottom'))
for x in (-0.3, 0.26):
    box(frame, (x, (PL + EAVES - 0.04) / 2, ZB - 0.01), (0.04, EAVES - 0.04 - PL, 0.02), TIMBER, only=('back', 'left', 'right'))
# The top of the gable: two posts either side of the attic window up to a collar, raking struts
# from the ends of the beam to the collar, and a king post from the collar to the ridge.
for x in (-0.17, 0.17):
    wall(frame, x - 0.02, x + 0.02, UP, COLLAR, ZG, TIMBER, t=0.025, faces=('front', 'left', 'right'))
wall(frame, -half(COLLAR + 0.03) + 0.015, half(COLLAR + 0.03) - 0.015, COLLAR, COLLAR + 0.03, ZG, TIMBER,
     t=0.028, faces=('front', 'top', 'bottom'))
wall(frame, -0.018, 0.018, COLLAR + 0.03, RIDGE - 0.1, ZG, TIMBER, t=0.025, faces=('front', 'left', 'right'))
for s in (-1, 1):
    # a strut in the plane of the gable: its local x is the depth, and it runs inwards, so the
    # side against the plaster is 'left' on the right and 'right' on the left
    beam(frame, (s * 0.66, UP + 0.005, ZG + 0.0125), (s * 0.2, COLLAR, ZG + 0.0125), 0.03, 0.025, TIMBER,
         skip=('back', 'left' if s > 0 else 'right'))
frame.build()

# ---- windows upstairs -----------------------------------------------------------------------
upstairs = Part(ASSET, 'windows')


def window(part, x, y0, y1, w, lights=2, shutters=False, z=ZU):
    """Dark glass with a smaller lit pane just in front of it, glazing bars over both and a sill."""
    pane(part, x - w / 2, x + w / 2, y0, y1, z + 0.004, GLASS)
    pane(part, x - w / 2 + 0.03, x + w / 2 - 0.03, y0 + 0.03, y1 - 0.03, z + 0.008, GLOW)
    for k in range(1, lights):
        bx = x - w / 2 + w * k / lights
        wall(part, bx - 0.01, bx + 0.01, y0, y1, z + 0.008, TIMBER, t=0.01, faces=('front',))
    ty = y0 + (y1 - y0) * 0.58
    wall(part, x - w / 2, x + w / 2, ty - 0.01, ty + 0.01, z + 0.008, TIMBER, t=0.012, faces=('front', 'top'))
    wall(part, x - w / 2 - 0.015, x + w / 2 + 0.015, y1, y1 + 0.025, z, TIMBER, t=0.02, faces=('front', 'top'))
    box(part, (x, y0 - 0.012, z + 0.025), (w + 0.06, 0.024, 0.05), TIMBER, only=('front', 'top'))
    if shutters:
        for s in (-1, 1):
            sx = x + s * (w / 2 + 0.025 + 0.045)
            wall(part, sx - 0.045, sx + 0.045, y0 - 0.005, y1 + 0.005, z, GREEN, t=0.014, faces=('front', 'left', 'right'))


for s in (-1, 1):
    window(upstairs, s * 0.56, 0.73, 0.91, 0.18, lights=2, shutters=True)
window(upstairs, 0, 0.73, 0.91, 0.26, lights=3)
window(upstairs, 0, 1.1, 1.27, 0.22, lights=2, z=ZG)
upstairs.build()

# ---- the shopfront ---------------------------------------------------------------------------
shop = Part(ASSET, 'shopfront')
TOP = 0.605                    # the fascia's top, under the jetty beam's awning
for x0, x1 in ((-0.755, -0.7), (-0.2, -0.14), (0.14, 0.2), (0.7, 0.755)):
    wall(shop, x0, x1, 0, TOP, ZF, GREEN, t=0.035, faces=('front', 'left', 'right'))
wall(shop, -0.755, 0.755, 0.55, TOP, ZF, GREEN, t=0.04, faces=('front', 'bottom'))
for s in (-1, 1):
    a, b = sorted((s * 0.2, s * 0.7))
    wall(shop, a, b, 0, 0.13, ZF, GREEN, t=0.022, faces=('front',))
    box(shop, ((a + b) / 2, 0.14, ZF + 0.025), (b - a + 0.016, 0.02, 0.05), CREAM, only=('front', 'top'))
    pane(shop, a, b, 0.15, 0.55, ZF + 0.003, GLASS)
    pane(shop, a + 0.035, b - 0.035, 0.175, 0.525, ZF + 0.006, GLOW)
    for bx in (a + (b - a) / 3, a + 2 * (b - a) / 3):
        wall(shop, bx - 0.011, bx + 0.011, 0.15, 0.55, ZF + 0.006, GREEN, t=0.012, faces=('front',))
    wall(shop, a, b, 0.445, 0.465, ZF + 0.006, GREEN, t=0.014, faces=('front', 'top'))
# The door: a darker green leaf with a lit pane, a brass knob, and a fanlight over it.
wall(shop, -0.14, 0.14, 0.03, 0.49, ZF, DOOR, t=0.016, faces=('front',))
pane(shop, -0.075, 0.075, 0.32, 0.45, ZF + 0.017, GLASS)
pane(shop, -0.055, 0.055, 0.335, 0.435, ZF + 0.02, GLOW)
wall(shop, -0.14, 0.14, 0.17, 0.188, ZF + 0.016, GREEN, t=0.007, faces=('front', 'top'))
box(shop, (0.095, 0.25, ZF + 0.025), (0.022, 0.022, 0.018), BRASS, skip=('back',))
wall(shop, -0.14, 0.14, 0.49, 0.505, ZF, GREEN, t=0.028, faces=('front', 'top', 'bottom'))
pane(shop, -0.13, 0.13, 0.505, 0.55, ZF + 0.004, GLASS)
pane(shop, -0.11, 0.11, 0.513, 0.542, ZF + 0.007, GLOW)
shop.build()

# ---- the awning --------------------------------------------------------------------------------
# Twelve strips, alternately green and cream, from a roller on the face of the jetty beam down to
# a scalloped valance - each strip its own slanted slab, so the stripes are geometry and not
# paint. Hung from the beam rather than under it, so it has a fall and still clears 0.55 at its
# lowest scallop (see the docstring).
awning = Part(ASSET, 'awning')
AX = 0.755
box(awning, (0, G + 0.02, ZU + 0.035), (2 * AX + 0.02, 0.035, 0.03), TRESTLE, skip=('back',))
A0, A1 = (G + 0.035, ZU + 0.05), (0.6, 1.07)      # (y, z) of its top edge at the beam and at the front
VAL = 0.028
N = 12
for i in range(N):
    x0, x1 = -AX + 2 * AX * i / N, -AX + 2 * AX * (i + 1) / N
    m = AWN_A if i % 2 == 0 else AWN_B
    quad(awning, [(x0, A0[0], A0[1]), (x1, A0[0], A0[1]), (x1, A1[0], A1[1]), (x0, A1[0], A1[1])], m, facing=(0, 1, 0.4))
    xm = (x0 + x1) / 2
    awning.add([(x0, A1[0], A1[1]), (x1, A1[0], A1[1]), (x1, A1[0] - VAL, A1[1]), (xm, A1[0] - VAL - 0.014, A1[1]), (x0, A1[0] - VAL, A1[1])],
               [[0, 1, 2, 3, 4]], m, facing=(0, 0, 1))
# Its underside is one sheet: only somebody standing under it sees it, and then in its shadow.
quad(awning, [(-AX, A0[0] - 0.01, A0[1]), (AX, A0[0] - 0.01, A0[1]), (AX, A1[0] - 0.01, A1[1]), (-AX, A1[0] - 0.01, A1[1])],
     AWN_A, facing=(0, -1, -0.4))
# The two cheeks, so the ends of the awning read as cloth and not as a cut.
for x, f in ((-AX, -1), (AX, 1)):
    awning.add([(x, A0[0], A0[1]), (x, A1[0], A1[1]), (x, A1[0] - VAL, A1[1]), (x, A0[0] - 0.03, A0[1])], [[0, 1, 2, 3]], AWN_A, facing=(f, 0, 0))
awning.build()

# ---- the roof -------------------------------------------------------------------------------
# Two pitches from a ridge that runs to the street, each one slab from the ridge to past the side
# wall and from past the back gable to past the front one; a ridge course of lighter tiles; barge
# boards down the front edge, which is the line that makes the whole shop read as one gable; an
# iron finial on top.
roof = Part(ASSET, 'roof')
zc, zl = (GF + GB) / 2, GF - GB
for s in (-1, 1):
    beam(roof, (0, RIDGE, zc), (s * XR, RIDGE - XR * SLOPE, zc), zl, RT, TILES, lift=0.5, skip=('back',))
box(roof, (0, RIDGE + 0.03, zc), (0.09, 0.045, zl + 0.02), RIDGE_TILES, skip=('bottom',))
for s in (-1, 1):
    beam(roof, (0, RIDGE + 0.055, GF + 0.01), (s * X1, RIDGE - X1 * SLOPE + 0.015, GF + 0.01), 0.045, 0.025, TIMBER, skip=('back',))
cone(roof, (0, RIDGE + 0.05, GF - 0.02), (0, RIDGE + 0.14, GF - 0.02), 0.016, IRON, n=4)
roof.build()

# ---- the chimney -----------------------------------------------------------------------------
# Brick, as the tavern's is, out of the right-hand pitch towards the back, leaning a little -
# houses here have settled.
chimney = Part(ASSET, 'chimney')
CX, CZ, LEAN = 0.36, -0.22, 0.04
C0 = Vector((CX, 1.2, CZ))
H = 0.5
tilt = rotation(rz=-LEAN, rx=0.02)
box(chimney, C0 + tilt @ Vector((0, H / 2, 0)), (0.17, H, 0.17), BRICK, rz=-LEAN, rx=0.02, skip=('bottom',))
CT = C0 + tilt @ Vector((0, H, 0))
box(chimney, CT + tilt @ Vector((0, 0.018, 0)), (0.21, 0.036, 0.21), PIER, rz=-LEAN, rx=0.02, skip=('bottom',))
frustum(chimney, CT + tilt @ Vector((0, 0.036, 0)), 0.035, 0.029, 0.065, POT, n=6, top=IRON)
chimney.build()

# ---- the sign --------------------------------------------------------------------------------
# An iron arm off the corner post with a round green hoop hung from it, face to the side as a
# real hanging sign is; the pumpkin in it is solid and stands out either side, so from the front,
# where the hoop is only its edge, what you see hanging there is still a pumpkin. It hangs high
# enough to clear the awning's end and WALK_CLEARANCE both.
sign = Part(ASSET, 'sign')
SX, SY, SZ, SR = 0.8, 0.79, 1.02, 0.1
ARM = 0.915
ARM_Z = 1.16
box(sign, (SX, ARM, (ZU + ARM_Z) / 2), (0.022, 0.022, ARM_Z - ZU), IRON, skip=('back',))
beam(sign, (SX, ARM - 0.12, ZU + 0.015), (SX, ARM - 0.005, ZU + 0.2), 0.015, 0.015, IRON, skip=('back', 'front'))
for dz in (-0.055, 0.055):
    box(sign, (SX, (ARM + SY + SR) / 2, SZ + dz), (0.008, ARM - SY - SR, 0.008), IRON, only=('left', 'right'))
# The sign is an open hoop, not a board: a board through the middle of the pumpkin hid its stalk
# in the wood and cut it in two halves, one on each face. In a hoop it hangs whole.
RI, T2 = SR - 0.02, 0.011
ring = lambda r: [(SY + r * math.sin(2 * math.pi * (i + 0.5) / 8), SZ + r * math.cos(2 * math.pi * (i + 0.5) / 8)) for i in range(8)]
outer, inner = ring(SR), ring(RI)
for f in (-1, 1):
    pts = [(SX + f * T2, y, z) for y, z in outer] + [(SX + f * T2, y, z) for y, z in inner]
    sign.add(pts, [[i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i] for i in range(8)], GREEN, facing=(f, 0, 0))
pts = [(SX - T2, y, z) for y, z in outer] + [(SX + T2, y, z) for y, z in outer]
sign.add(pts, [[i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i] for i in range(8)], GREEN, centre=(SX, SY, SZ))
# sitting on the hoop's bottom bar
pumpkin(sign, (SX, SY - 0.03, SZ), 0.066, 0.088, n=6, turn=0.2)
cone(sign, (SX, SY + 0.004, SZ), (SX, SY + 0.05, SZ - 0.014), 0.013, STALK, n=3)
for f in (1, -1):
    sign.add([(SX, SY + 0.02, SZ), (SX + 0.038, SY + 0.046, SZ + 0.03), (SX - 0.008, SY + 0.016, SZ + 0.064)], [[0, 1, 2]], LEAF, facing=(0.3, 1, 0) if f > 0 else (-0.3, -1, 0))
sign.build()

# ---- the displays either side of the door ---------------------------------------------------------
# A trestle, a riser at its back, two crates tipped towards the street on the riser and two flat
# in front. Each side is its own part: one part is one footprint rectangle on the island, and one
# rectangle over both sides would stand in the doorway.
ROW = {'back': (ZF + 0.12, 0.175, 0.35), 'front': (ZF + 0.225, 0.125, 0.0)}   # z, y of the middle, tilt
CW, CD, CH = 0.2, 0.1, 0.055


def crate(part, x, row, fill, fruit):
    z, y, tilt = ROW[row]
    c = Vector((x, y, z))
    m = rotation(rx=tilt)
    # A tipped crate has its back against the riser and a flat one against the tipped one behind
    # it, and nobody sees either.
    box(part, c, (CW, CH, CD), CRATE, rx=tilt, skip=('bottom', 'back'), paint={'top': FILL[fill]})
    for lx, lz, kind in fruit:
        # Fruit stand upright on a tipped lid, so they sink a little into it to sit on its low side.
        at = c + m @ Vector((lx, CH / 2, lz)) - Vector((0, 0.04 * math.tan(tilt), 0))
        kind(part, at)


# Four corners and not five: at 0.036 across a fruit is a dot of colour from anywhere a settler
# stands, and the fifth corner was a sixth of the whole shop.
def fruit(mat, r=0.036, n=4):
    return lambda part, at: dome(part, (at.x, at.y - 0.003, at.z), r, 0.8 * r, mat, n=n, turn=at.x * 7)


def leafy(mat, r=0.045):
    return lambda part, at: gourd(part, (at.x, at.y + 0.45 * r, at.z), r, 1.2 * r, mat, n=5, turn=at.x * 5)


def carrots(part, at):
    for k, (dx, dz) in enumerate(((-0.06, -0.012), (0.0, 0.012), (0.06, -0.012))):
        base = Vector((at.x + dx, at.y + 0.012, at.z - 0.03 + dz))
        cone(part, base, base + Vector((0.012 * (k - 1), -0.006, 0.08)), 0.014, CARROT, n=4, turn=k)
        cone(part, base, base + Vector((0.006 * (k - 1), 0.02, -0.03)), 0.012, LEAF, n=3, turn=k)


def three(kind, spread=0.062, dz=0.015):
    return [(-spread, dz, kind), (0.0, -dz, kind), (spread, dz, kind)]


for side, s in (('left', -1), ('right', 1)):
    part = Part(ASSET, f'display {side}')
    xs = sorted((s * 0.3, s * 0.76))
    xm = (xs[0] + xs[1]) / 2
    box(part, (xm, 0.09, ZF + 0.17), (xs[1] - xs[0], 0.02, 0.18), TRESTLE, skip=('bottom', 'back'))
    for lx in (xs[0] + 0.025, xs[1] - 0.025):
        box(part, (lx, 0.04, ZF + 0.17), (0.02, 0.08, 0.16), TRESTLE, skip=('top', 'bottom', 'back'))
    box(part, (xm, 0.12, ZF + 0.12), (xs[1] - xs[0] - 0.03, 0.04, 0.08), TRESTLE, skip=('bottom', 'back'))
    inner, outer = s * 0.41, s * 0.645
    if s < 0:
        crate(part, outer, 'back', APPLE, three(fruit(APPLE)))
        crate(part, inner, 'back', CABBAGE, [(-0.048, 0.0, leafy(CABBAGE)), (0.048, 0.0, leafy(CABBAGE, 0.042))])
        crate(part, outer, 'front', CARROT, [(0, 0, carrots)])
        crate(part, inner, 'front', PEAR, three(fruit(PEAR, 0.034)))
    else:
        crate(part, inner, 'back', GREEN_APPLE, three(fruit(GREEN_APPLE)))
        crate(part, outer, 'back', PUMPKIN, [(-0.048, 0.0, leafy(PUMPKIN, 0.045)), (0.048, 0.0, leafy(PUMPKIN, 0.042))])
        crate(part, inner, 'front', PLUM, three(fruit(PLUM, 0.031)))
        crate(part, outer, 'front', TOMATO, three(fruit(TOMATO, 0.034)))
    part.build()

# ---- at the ends: pumpkins on the right, sacks of potatoes on the left ----------------------------
# One big pumpkin with its shoulder, dimple and stalk, and two small ones leaning on it that are
# gourd()s, as the crates' are.
heap = Part(ASSET, 'pumpkins')
c, r, h = (0.88, 0.04, ZF + 0.14), 0.06, 0.08
pumpkin(heap, c, r, h, n=6)
cone(heap, (c[0], c[1] + 0.2 * h, c[2]), (c[0] + 0.008, c[1] + 0.2 * h + 0.035, c[2]), 0.009, STALK, n=3)
gourd(heap, (0.9, 0.03, ZF + 0.25), 0.046, 0.06, PUMPKIN, n=5, turn=0.45)
gourd(heap, (0.855, 0.095, ZF + 0.2), 0.04, 0.05, PUMPKIN, n=5, turn=0.9)
heap.build()

# The open sack's mouth is painted potatoes, which from the square is what a sack of them is.
sacks = Part(ASSET, 'sacks')
frustum(sacks, (-0.88, 0, ZF + 0.14), 0.055, 0.046, 0.12, SACK, n=6, top=None, squash=0.85)
cone(sacks, (-0.88, 0.114, ZF + 0.14), (-0.877, 0.165, ZF + 0.143), 0.043, SACK, n=6)
frustum(sacks, (-0.89, 0, ZF + 0.25), 0.052, 0.049, 0.085, SACK, n=6, top=POTATO, turn=0.5, squash=0.8)
lump(sacks, (-0.89, 0.085, ZF + 0.25), 0.03, 0.02, POTATO, n=4, turn=0.4, low=0.01)
sacks.build()

# ---- anchors ------------------------------------------------------------------------------------
smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(CT + tilt @ Vector((0, 0.11, 0)))
ASSET.objects.link(smoke)
# At the foot of the door, just off the doorstep (which reaches ZF + 0.08).
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.1))
ASSET.objects.link(door)

# The tallest thing it has, which is the chimney pot.
top = max((o.matrix_world @ v.co).z for o in ASSET.objects if o.type == 'MESH' for v in o.data.vertices)
bpy.context.scene['building_height'] = round(top, 3)
tris = 0
for o in ASSET.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
        print(f'  {o.name}: {len(o.data.loop_triangles)} triangles')
print(f'civic_grocer: {tris} triangles, building_height {round(top, 3)}')
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'grocer.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'grocer'})
