"""The greengrocer. Rebuild with scripts/blender.mjs --background --python scripts/build-grocer.py.

A narrow shop in a terrace, one of the village-centre shops that share a house style: a rough
stone ground floor, a jettied upper floor of cream plaster between dark timbers, a very steep
blue-grey slate roof and a crooked stone chimney. Its roofline is its own: the ridge runs to the
street, so the whole front is one tall gable - the upper floor, then the top of the gable
jettied out again over a beam, posts and raking struts up to a collar, an attic window, and a
little window high in the apex under a king post. The shops beside it turn their ridge the other
way with a cross-gable over the front; in a street this is the one that stands end-on. On the
ground floor the painted shopfront, in leaf green: a door in the middle with a lit pane and a
fanlight, a wide shop window either side of it, and one striped green-and-cream awning over all
of it. Out front, either side of the door, a trestle of crates - the back row tipped towards
the street on a riser - full of apples, cabbages, carrots, pears, plums, tomatoes and small
pumpkins; a heap of pumpkins at one end and sacks of potatoes at the other; strings of garlic
and onions hung on the door posts; and a sign on an iron bracket at the corner, a green hoop
with a big pumpkin sitting in it. The market already has an open seed stall, so everything here
says *shop*: a door, glass, an upper floor somebody lives in, and the produce set out in front.

One civic asset, `civic_grocer` (budget 1500), static - nothing in it moves. `anchor.door`
is at the foot of the door, in the middle of the front, just off the doorstep, where the
island's paths arrive; `anchor.smoke` is on top of the chimney.

It stands on a 3x3 lot in a terrace, so it is as wide as the lot allows (x -1.40..1.40 for the
body, the eaves to 1.47, nothing past 1.48) with its neighbours against its party walls, and
everything out front stays inside z 1.46. The doorway is kept clear from x -0.32 to 0.32: the
crates stand either side of it, never in front, and each side's display is its own part, so
that a footprint taken a rectangle per baked part (footprintOf in web/js/buildings.js, with
merging off) leaves the gap between them open.

Everything is coarse on purpose. The shell is outer faces only - nobody sees inside a shop
whose windows are dark glass - and a timber, a sill or a glazing bar has only the faces that
face the street, so the triangles go where the eye goes: the produce. A fruit is a dome of
thirteen triangles half sunk in a crate whose lid is painted the same produce a shade darker,
so three fruit on top read as a crate full; the pumpkins that have to read on their own get a
shoulder and a dimple.

Plaster takes the wall sheet, the slates the roof sheet, the stone the stone sheet and the
timber the plank sheets, so the island's own textures draw the courses and the boards.
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


PLASTER = material('wall', 'grocer plaster', 0xefe4ca)
TIMBER = material('plank', 'grocer timber', 0x4a3222)
TIMBER_Z = material('plankZ', 'grocer timber', 0x4a3222)
SLATE = material('roof', 'grocer slate', 0x455064)
STONE = material('stone', 'grocer stone', 0x928b80)
PIER = material('stone', 'grocer pier', 0xa39b8e)
CHIMNEY = material('stone', 'grocer chimney', 0x837b72)
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
GARLIC = material('plain', 'grocer garlic', 0xf1e8d6)
ONION = material('plain', 'grocer onion', 0xc5813a)
CORD = material('plain', 'grocer cord', 0x8a7350)


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


def lump(part, c, r, h, mat, n=5, turn=0.0, low=None, squash=1.0):
    """A fruit: a ring of n corners with a point above and a flatter one below."""
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
    """A pumpkin: two ribbed rings between a dimpled top and a flat-ish bottom."""
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
X0, X1 = -1.40, 1.40          # the party walls; the neighbours stand against these
ZB = -1.30                     # the back wall
ZF = 1.00                      # the ground floor's front
ZU = 1.10                      # the upper floor's front, jettied out over it
G = 0.80                       # the first floor, where the jetty beam runs
EAVES, RIDGE = 1.36, 3.0       # low eaves on the party walls and the ridge running to the street:
SLOPE = (RIDGE - EAVES) / X1   # a pitch of 49.5 degrees, and the whole front is one gable
UP = 1.69                      # where the top of the gable is jettied out again
ZG = ZU + 0.07                 # the face of that top part
RT = 0.05                      # slate thickness
# How far the eaves reach past the party walls. Little, because a pitch's outer end is square to
# the slates, so its top corner stands 0.04 further out than its foot, and 1.48 is the lot.
XR = 1.43
GF, GB = ZG + 0.12, ZB - 0.12  # the roof's front and back edges, past the gables
COLLAR = 2.30                  # the collar across the top of the gable


def half(y):
    """Half the width of the front gable at height y."""
    return min(X1, (RIDGE - y) / SLOPE)


# ---- the shell: outer faces only ----------------------------------------------------------
house = Part(ASSET, 'house')
for x, f in ((X0, -1), (X1, 1)):
    quad(house, [(x, 0, ZB), (x, 0, ZF), (x, G, ZF), (x, G, ZB)], STONE, facing=(f, 0, 0))
    quad(house, [(x, G, ZB), (x, G, ZU), (x, EAVES, ZU), (x, EAVES, ZB)], PLASTER, facing=(f, 0, 0))
quad(house, [(X0, 0, ZB), (X1, 0, ZB), (X1, G, ZB), (X0, G, ZB)], STONE, facing=(0, 0, -1))
house.add([(X0, G, ZB), (X1, G, ZB), (X1, EAVES, ZB), (0, RIDGE, ZB), (X0, EAVES, ZB)], [[0, 1, 2, 3, 4]],
          PLASTER, facing=(0, 0, -1))
pane(house, X0, X1, 0, G, ZF, STONE)
# The front gable in two: the upper floor, and the top jettied out over it on a beam of its own.
house.add([(X0, G, ZU), (X1, G, ZU), (X1, EAVES, ZU), (half(UP), UP, ZU), (-half(UP), UP, ZU), (X0, EAVES, ZU)],
          [[0, 1, 2, 3, 4, 5]], PLASTER, facing=(0, 0, 1))
house.add([(-half(UP), UP, ZG), (half(UP), UP, ZG), (0, RIDGE, ZG)], [[0, 1, 2]], PLASTER, facing=(0, 0, 1))
# The stone piers at the corners of the shopfront, a little proud of it.
for s in (-1, 1):
    box(house, (s * 1.33, G / 2, ZF + 0.025), (0.14, G, 0.05), PIER, skip=('back', 'bottom', 'top'))
# A doorstep.
box(house, (0, 0.02, ZF + 0.06), (0.46, 0.04, 0.12), STONE, skip=('back', 'bottom'))
house.build()

# ---- the timber frame of the upper floor ---------------------------------------------------
frame = Part(ASSET, 'frame')
# The jetty beam the upper floor stands out on, a rail under its windows, a post at each corner,
# and two either side of the middle window, up to the beam the top of the gable stands out on.
box(frame, (0, G + 0.035, ZF + 0.07), (2.84, 0.07, 0.15), TIMBER, skip=('back',))
wall(frame, X0 + 0.05, X1 - 0.05, 0.99, 1.025, ZU, TIMBER, faces=('front', 'top'))
for x in (-1.375, 1.375):
    box(frame, (x, (G + 0.07 + EAVES) / 2, ZU + 0.002), (0.06, EAVES - G - 0.07, 0.07), TIMBER, only=('front', 'left', 'right'))
for x in (-0.52, 0.52):
    wall(frame, x - 0.025, x + 0.025, G + 0.07, UP - 0.07, ZU, TIMBER, t=0.036, faces=('front', 'left', 'right'))
# No wider than the gable is at its top, or its ends come up through the slates.
box(frame, (0, UP - 0.035, (ZU + ZG) / 2 + 0.005), (2 * half(UP) - 0.02, 0.07, ZG - ZU + 0.06), TIMBER, skip=('back',))
# Along the party walls, which only show at the end of a terrace: the plate under the eaves and
# the floor line where the stone stops.
for s in (-1, 1):
    x = s * (X1 + 0.015)
    box(frame, (x, EAVES - 0.02, (ZB + ZU) / 2), (0.03, 0.04, ZU - ZB), TIMBER_Z, only=('left', 'right', 'bottom'))
    box(frame, (x, G + 0.02, (ZB + ZU) / 2), (0.03, 0.04, ZU - ZB), TIMBER_Z, only=('left', 'right', 'top'))
# The top of the gable: two posts either side of the attic window up to a collar, raking struts
# from the ends of the beam to the collar, and a king post over the little window in the apex.
for x in (-0.3, 0.3):
    wall(frame, x - 0.025, x + 0.025, UP, COLLAR, ZG, TIMBER, t=0.03, faces=('front', 'left', 'right'))
wall(frame, -half(COLLAR + 0.035) + 0.02, half(COLLAR + 0.035) - 0.02, COLLAR, COLLAR + 0.035, ZG, TIMBER,
     t=0.034, faces=('front', 'top', 'bottom'))
wall(frame, -0.02, 0.02, 2.66, 2.9, ZG, TIMBER, t=0.03, faces=('front', 'left', 'right'))
for s in (-1, 1):
    # a strut in the plane of the gable: its local x is the depth, and it runs inwards, so the
    # side against the plaster is 'left' on the right and 'right' on the left
    beam(frame, (s * 0.98, UP + 0.005, ZG + 0.015), (s * 0.33, COLLAR, ZG + 0.015), 0.035, 0.03, TIMBER,
         skip=('back', 'left' if s > 0 else 'right'))
frame.build()

# ---- windows upstairs -----------------------------------------------------------------------
upstairs = Part(ASSET, 'windows')


def window(part, x, y0, y1, w, lights=2, shutters=False, z=ZU):
    """Dark glass with a smaller lit pane just in front of it, glazing bars over both and a sill."""
    pane(part, x - w / 2, x + w / 2, y0, y1, z + 0.004, GLASS)
    pane(part, x - w / 2 + 0.035, x + w / 2 - 0.035, y0 + 0.035, y1 - 0.035, z + 0.008, GLOW)
    for k in range(1, lights):
        bx = x - w / 2 + w * k / lights
        wall(part, bx - 0.012, bx + 0.012, y0, y1, z + 0.008, TIMBER, t=0.012, faces=('front',))
    ty = y0 + (y1 - y0) * 0.58
    wall(part, x - w / 2, x + w / 2, ty - 0.012, ty + 0.012, z + 0.008, TIMBER, t=0.016, faces=('front', 'top'))
    wall(part, x - w / 2 - 0.02, x + w / 2 + 0.02, y1, y1 + 0.03, z, TIMBER, t=0.025, faces=('front', 'top'))
    box(part, (x, y0 - 0.015, z + 0.03), (w + 0.08, 0.03, 0.06), TIMBER, only=('front', 'top'))
    if shutters:
        for s in (-1, 1):
            sx = x + s * (w / 2 + 0.035 + 0.075)
            wall(part, sx - 0.075, sx + 0.075, y0 - 0.005, y1 + 0.01, z, GREEN, t=0.018, faces=('front', 'left', 'right'))
            wall(part, sx - 0.06, sx + 0.06, (y0 + y1) / 2 - 0.01, (y0 + y1) / 2 + 0.01, z + 0.018, CREAM, t=0.006, faces=('front',))


for s in (-1, 1):
    window(upstairs, s * 0.9, 1.06, 1.44, 0.3, lights=2, shutters=True)
window(upstairs, 0, 1.06, 1.44, 0.46, lights=3)
window(upstairs, 0, 1.86, 2.18, 0.4, lights=2, z=ZG)
# and the little one high up in the apex
pane(upstairs, -0.07, 0.07, 2.44, 2.6, ZG + 0.004, GLASS)
pane(upstairs, -0.045, 0.045, 2.465, 2.575, ZG + 0.008, GLOW)
wall(upstairs, -0.09, 0.09, 2.6, 2.63, ZG, TIMBER, t=0.025, faces=('front', 'top'))
box(upstairs, (0, 2.425, ZG + 0.025), (0.19, 0.03, 0.05), TIMBER, only=('front', 'top'))
upstairs.build()

# ---- the shopfront ---------------------------------------------------------------------------
shop = Part(ASSET, 'shopfront')
TOP = 0.755                    # the fascia's top, under the awning's roller
for x0, x1 in ((-1.26, -1.19), (-0.30, -0.16), (0.16, 0.30), (1.19, 1.26)):
    wall(shop, x0, x1, 0, TOP, ZF, GREEN, t=0.045, faces=('front', 'left', 'right'))
wall(shop, -1.26, 1.26, 0.70, TOP, ZF, GREEN, t=0.055, faces=('front', 'bottom'))
for s in (-1, 1):
    a, b = sorted((s * 0.30, s * 1.19))
    wall(shop, a, b, 0, 0.215, ZF, GREEN, t=0.03, faces=('front',))
    box(shop, ((a + b) / 2, 0.23, ZF + 0.035), (b - a + 0.02, 0.03, 0.07), CREAM, only=('front', 'top'))
    pane(shop, a, b, 0.245, 0.70, ZF + 0.003, GLASS)
    pane(shop, a + 0.05, b - 0.05, 0.28, 0.665, ZF + 0.006, GLOW)
    for bx in (a + (b - a) / 3, a + 2 * (b - a) / 3):
        wall(shop, bx - 0.014, bx + 0.014, 0.245, 0.70, ZF + 0.006, GREEN, t=0.014, faces=('front',))
    wall(shop, a, b, 0.575, 0.6, ZF + 0.006, GREEN, t=0.018, faces=('front', 'top'))
# The door: a darker green leaf with a lit pane, a brass knob, and a fanlight over it.
wall(shop, -0.16, 0.16, 0.04, 0.64, ZF, DOOR, t=0.02, faces=('front',))
pane(shop, -0.09, 0.09, 0.42, 0.585, ZF + 0.021, GLASS)
pane(shop, -0.07, 0.07, 0.435, 0.57, ZF + 0.024, GLOW)
wall(shop, -0.16, 0.16, 0.225, 0.245, ZF + 0.02, GREEN, t=0.008, faces=('front', 'top'))
box(shop, (0.11, 0.32, ZF + 0.03), (0.025, 0.025, 0.02), BRASS, skip=('back',))
wall(shop, -0.16, 0.16, 0.64, 0.655, ZF, GREEN, t=0.035, faces=('front', 'top', 'bottom'))
pane(shop, -0.15, 0.15, 0.655, 0.70, ZF + 0.004, GLASS)
pane(shop, -0.13, 0.13, 0.665, 0.692, ZF + 0.007, GLOW)
shop.build()

# ---- the awning --------------------------------------------------------------------------------
# Fourteen strips, alternately green and cream, from a roller box under the jetty beam down to a
# scalloped valance - each strip its own slanted slab, so the stripes are geometry and not paint.
awning = Part(ASSET, 'awning')
box(awning, (0, 0.775, ZF + 0.04), (2.54, 0.045, 0.08), TRESTLE, skip=('back',))
A0, A1 = (0.785, ZF + 0.07), (0.655, 1.43)      # (y, z) of its top edge at the wall and at the front
VAL = 0.045
N = 14
for i in range(N):
    x0, x1 = -1.26 + 2.52 * i / N, -1.26 + 2.52 * (i + 1) / N
    m = AWN_A if i % 2 == 0 else AWN_B
    quad(awning, [(x0, A0[0], A0[1]), (x1, A0[0], A0[1]), (x1, A1[0], A1[1]), (x0, A1[0], A1[1])], m, facing=(0, 1, 0.4))
    xm = (x0 + x1) / 2
    awning.add([(x0, A1[0], A1[1]), (x1, A1[0], A1[1]), (x1, A1[0] - VAL, A1[1]), (xm, A1[0] - VAL - 0.028, A1[1]), (x0, A1[0] - VAL, A1[1])],
               [[0, 1, 2, 3, 4]], m, facing=(0, 0, 1))
# Its underside is one sheet: only somebody standing under it sees it, and then in its shadow.
quad(awning, [(-1.26, A0[0] - 0.012, A0[1]), (1.26, A0[0] - 0.012, A0[1]), (1.26, A1[0] - 0.012, A1[1]), (-1.26, A1[0] - 0.012, A1[1])],
     AWN_A, facing=(0, -1, -0.4))
# The two cheeks, so the ends of the awning read as cloth and not as a cut.
for x, f in ((-1.26, -1), (1.26, 1)):
    awning.add([(x, A0[0], A0[1]), (x, A1[0], A1[1]), (x, A1[0] - VAL, A1[1]), (x, A0[0] - 0.04, A0[1])], [[0, 1, 2, 3]], AWN_A, facing=(f, 0, 0))
awning.build()

# ---- the roof -------------------------------------------------------------------------------
# Two pitches from a ridge that runs to the street, each one slab from the ridge to the party
# wall and from past the back gable to past the front one; barge boards down the front edge,
# which is the line that makes the whole shop read as one tall gable; an iron finial on top.
roof = Part(ASSET, 'roof')
zc, zl = (GF + GB) / 2, GF - GB
for s in (-1, 1):
    beam(roof, (0, RIDGE, zc), (s * XR, RIDGE - XR * SLOPE, zc), zl, RT, SLATE, lift=0.5, skip=('back',))
box(roof, (0, RIDGE + 0.04, zc), (0.1, 0.05, zl + 0.02), SLATE, skip=('bottom',))
for s in (-1, 1):
    beam(roof, (0, RIDGE + 0.075, GF + 0.012), (s * 1.4, RIDGE - 1.4 * SLOPE + 0.02, GF + 0.012), 0.05, 0.03, TIMBER, skip=('back',))
cone(roof, (0, RIDGE + 0.07, GF - 0.02), (0, RIDGE + 0.21, GF - 0.02), 0.02, IRON, n=4)
roof.build()

# ---- the chimney -----------------------------------------------------------------------------
# Out of the right-hand pitch towards the back, leaning a little - houses here have settled.
chimney = Part(ASSET, 'chimney')
CX, CZ, LEAN = 0.42, -0.62, 0.06
C0 = Vector((CX, 2.3, CZ))
H = 0.9
tilt = rotation(rz=-LEAN, rx=0.03)
box(chimney, C0 + tilt @ Vector((0, H / 2, 0)), (0.24, H, 0.24), CHIMNEY, rz=-LEAN, rx=0.03, skip=('bottom',))
CT = C0 + tilt @ Vector((0, H, 0))
box(chimney, CT + tilt @ Vector((0, 0.025, 0)), (0.3, 0.05, 0.3), CHIMNEY, rz=-LEAN, rx=0.03, skip=('bottom',))
for dx in (-0.055, 0.055):
    p = CT + tilt @ Vector((dx, 0.05, 0))
    frustum(chimney, p, 0.04, 0.032, 0.1, POT, n=5, top=IRON)
chimney.build()

# ---- the sign --------------------------------------------------------------------------------
# An iron arm off the corner post with a round green board hung from it, face to the side as a
# real hanging sign is; the pumpkin on it is solid and stands out either side, so from the front,
# where the board is only its edge, what you see hanging there is still a pumpkin.
sign = Part(ASSET, 'sign')
SX, SY, SZ, SR = 1.33, 1.065, 1.285, 0.14
ARM = 1.24                     # under the eaves, which come down low at the corner
box(sign, (SX, ARM, (ZU + 1.46) / 2), (0.028, 0.028, 1.46 - ZU), IRON, skip=('back',))
beam(sign, (SX, 1.34, ZU + 0.02), (SX, ARM + 0.005, 1.33), 0.018, 0.018, IRON)
for dz in (-0.075, 0.075):
    box(sign, (SX, (ARM + SY + SR) / 2, SZ + dz), (0.01, ARM - SY - SR, 0.01), IRON, only=('left', 'right'))
# The sign is an open hoop, not a board: a board through the middle of the pumpkin hid its stalk
# in the wood and cut it in two halves, one on each face. In a hoop it hangs whole.
RI, T2 = SR - 0.026, 0.013
ring = lambda r: [(SY + r * math.sin(2 * math.pi * (i + 0.5) / 8), SZ + r * math.cos(2 * math.pi * (i + 0.5) / 8)) for i in range(8)]
outer, inner = ring(SR), ring(RI)
for f in (-1, 1):
    pts = [(SX + f * T2, y, z) for y, z in outer] + [(SX + f * T2, y, z) for y, z in inner]
    sign.add(pts, [[i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i] for i in range(8)], GREEN, facing=(f, 0, 0))
pts = [(SX - T2, y, z) for y, z in outer] + [(SX + T2, y, z) for y, z in outer]
sign.add(pts, [[i, (i + 1) % 8, 8 + (i + 1) % 8, 8 + i] for i in range(8)], GREEN, centre=(SX, SY, SZ))
# sitting on the hoop's bottom bar
pumpkin(sign, (SX, SY - 0.043, SZ), 0.09, 0.12, n=8, turn=0.2)
box(sign, (SX, SY + 0.022, SZ - 0.005), (0.026, 0.06, 0.026), STALK, rx=-0.3, skip=('bottom',))
for f in (1, -1):
    sign.add([(SX, SY + 0.027, SZ), (SX + 0.05, SY + 0.062, SZ + 0.04), (SX - 0.01, SY + 0.022, SZ + 0.085)], [[0, 1, 2]], LEAF, facing=(0.3, 1, 0) if f > 0 else (-0.3, -1, 0))
sign.build()

# ---- strings of garlic and onions on the door posts ---------------------------------------------
for name, s, mat in (('garlic', -1, GARLIC), ('onions', 1, ONION)):
    string = Part(ASSET, name)
    x = s * 0.235
    wall(string, x - 0.004, x + 0.004, 0.38, 0.62, ZF + 0.045, CORD, t=0.004, faces=('front',))
    for k in range(3):
        # round at the bottom and drawn to a point at the top, which is what makes it an onion
        lump(string, (x + (0.012 if k % 2 else -0.012), 0.555 - k * 0.07, ZF + 0.078), 0.034, 0.045, mat, n=5, turn=0.4 * k, low=0.024)
    string.build()

# ---- the displays either side of the door ---------------------------------------------------------
# A trestle, a riser at its back, two crates tipped towards the street on the riser and two flat
# in front. Each side is its own part: one part is one footprint rectangle on the island, and one
# rectangle over both sides would stand in the doorway.
ROW = {'back': (1.2, 0.3, 0.35), 'front': (1.36, 0.215, 0.0)}   # z, y of the middle, tilt
CW, CD, CH = 0.4, 0.16, 0.09


def crate(part, x, row, fill, fruit):
    z, y, tilt = ROW[row]
    c = Vector((x, y, z))
    m = rotation(rx=tilt)
    # A tipped crate has its back against the riser, which nobody sees.
    box(part, c, (CW, CH, CD), CRATE, rx=tilt, skip=('bottom', 'back') if tilt else ('bottom',), paint={'top': FILL[fill]})
    for lx, lz, kind in fruit:
        # Fruit stand upright on a tipped lid, so they sink a little into it to sit on its low side.
        at = c + m @ Vector((lx, CH / 2, lz)) - Vector((0, 0.065 * math.tan(tilt), 0))
        kind(part, at)


def fruit(mat, r=0.06, n=5):
    return lambda part, at: dome(part, (at.x, at.y - 0.004, at.z), r, 0.8 * r, mat, n=n, turn=at.x * 7)


def leafy(mat, r=0.075):
    return lambda part, at: gourd(part, (at.x, at.y + 0.45 * r, at.z), r, 1.2 * r, mat, n=6, turn=at.x * 5)


def carrots(part, at):
    for k, (dx, dz) in enumerate(((-0.13, -0.02), (-0.04, 0.02), (0.05, -0.02), (0.14, 0.02))):
        base = Vector((at.x + dx, at.y + 0.02, at.z - 0.05 + dz))
        cone(part, base, base + Vector((0.02 * (k - 1.5), -0.01, 0.13)), 0.022, CARROT, n=4, turn=k)
        cone(part, base, base + Vector((0.01 * (k - 1.5), 0.03, -0.05)), 0.018, LEAF, n=3, turn=k)


def three(kind, spread=0.13, dz=0.03):
    return [(-spread, dz, kind), (0.0, -dz, kind), (spread, dz, kind)]


for side, s in (('left', -1), ('right', 1)):
    part = Part(ASSET, f'display {side}')
    xs = sorted((s * 0.36, s * 1.2))
    xm = (xs[0] + xs[1]) / 2
    box(part, (xm, 0.155, 1.28), (xs[1] - xs[0], 0.03, 0.3), TRESTLE, skip=('bottom', 'back'))
    for lx in (xs[0] + 0.04, xs[1] - 0.04):
        box(part, (lx, 0.07, 1.28), (0.03, 0.14, 0.26), TRESTLE, skip=('top', 'bottom', 'back'))
    box(part, (xm, 0.2, 1.2), (xs[1] - xs[0] - 0.04, 0.06, 0.13), TRESTLE, skip=('bottom', 'back'))
    inner, outer = s * 0.57, s * 0.99
    if s < 0:
        crate(part, outer, 'back', APPLE, three(fruit(APPLE)))
        crate(part, inner, 'back', CABBAGE, [(-0.095, 0.0, leafy(CABBAGE)), (0.095, 0.0, leafy(CABBAGE, 0.07))])
        crate(part, outer, 'front', CARROT, [(0, 0, carrots)])
        crate(part, inner, 'front', PEAR, three(fruit(PEAR, 0.055)))
    else:
        crate(part, inner, 'back', GREEN_APPLE, three(fruit(GREEN_APPLE)))
        crate(part, outer, 'back', PUMPKIN, [(-0.095, 0.0, leafy(PUMPKIN, 0.075)), (0.095, 0.0, leafy(PUMPKIN, 0.07))])
        crate(part, inner, 'front', PLUM, three(fruit(PLUM, 0.05)))
        crate(part, outer, 'front', TOMATO, three(fruit(TOMATO, 0.055)))
    part.build()

# ---- at the ends: pumpkins on the right, sacks of potatoes on the left ----------------------------
heap = Part(ASSET, 'pumpkins')
PUMPKINS = (((1.33, 0.065, 1.22), 0.1, 0.13), ((1.37, 0.05, 1.375), 0.075, 0.1), ((1.3, 0.155, 1.32), 0.062, 0.085))
for i, (c, r, h) in enumerate(PUMPKINS):
    pumpkin(heap, c, r, h, n=6, turn=0.45 * i)
    cone(heap, (c[0], c[1] + 0.2 * h, c[2]), (c[0] + 0.012, c[1] + 0.2 * h + 0.055, c[2]), 0.013, STALK, n=3)
heap.build()

sacks = Part(ASSET, 'sacks')
frustum(sacks, (-1.32, 0, 1.2), 0.09, 0.075, 0.2, SACK, n=6, top=None, squash=0.85)
cone(sacks, (-1.32, 0.19, 1.2), (-1.315, 0.27, 1.205), 0.07, SACK, n=6)
frustum(sacks, (-1.33, 0, 1.38), 0.085, 0.08, 0.14, SACK, n=6, top=POTATO, turn=0.5, squash=0.8)
for dx, dz in ((-0.03, -0.02), (0.03, 0.02)):
    lump(sacks, (-1.33 + dx, 0.15, 1.38 + dz), 0.035, 0.025, POTATO, n=4, turn=dx * 30, low=0.02)
sacks.build()

# ---- anchors ------------------------------------------------------------------------------------
smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(CT + tilt @ Vector((0, 0.16, 0)))
ASSET.objects.link(smoke)
# At the foot of the door, just off the doorstep (which reaches ZF + 0.12).
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.14))
ASSET.objects.link(door)

# The tallest thing it has, which is the chimney pots.
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
