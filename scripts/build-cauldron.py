"""The cauldron maker. Rebuild with scripts/blender.mjs --background --python scripts/build-cauldron.py.

A shop in the town's terrace style (Plans/knus-dorpscentrum.md): a rubble ground floor, a
cream plastered upper floor jettied a hand over it with dark timber framing, and a very
steep slate roof - but turned the other way from its neighbours. The shops either side of
it keep their ridge along the street with a cross-gable and a dormer; this one is a
workshop, so its ridge runs front to back and the street gets one tall gable end, jettied
again over the upper floor, with a loft door in it and a hoist beam out under its peak -
rope, block and hook, for a cauldron too big for the stairs. A crooked stone chimney comes
out of the right-hand pitch: a workshop needs a draw. The shopfront is dark oak with
copper: pilasters, a fascia under a copper cornice, two big shop windows and a door in the
middle; copper gutters run along both eaves, with a downpipe down the right-hand corner.

What makes it a cauldron maker from across the square is one thing, hung where a sign
hangs: a giant copper cauldron on a stout iron bracket above the door, round-bellied with a
flared rim, three stubby legs and a bail handle hooked over the arm. Everything else is
the stock: a row of black and copper pots on the window ledges, a wobbly stack of four
cauldrons at the left front corner, and at the right one small pot sat in the coals of an
iron brazier, which glow after dark.

One civic asset, `civic_cauldron` (budget 1500), in five parts - house, roof, sign and the
wares either side of the door - all static and all merged; nothing here moves. The 3x3
lot's edge is 1.50 from the middle and the neighbours in the terrace stand right against
it, so the walls run to x = +-1.40 and the eaves and their gutters, the widest thing on it,
to 1.46. The front stays inside z = 1.46 (the sign, the stack and the brazier are the
furthest out) and the door is in the middle, where the paths arrive: the doorway itself
carries nothing, and the sign hangs above head height (its lowest foot at 0.85, well over
WALK_CLEARANCE 0.55).

Every pot is a lathe of six or eight sides and three to seven rings, no more: forty of those
triangles is a pot you can read at the island's distance, and the budget buys twelve of
them. None of them has an underside except the sign, which is the only one anybody walks
beneath. Written in island coordinates (x right, y up, z to the front) through xyz(); every
face is wound counter-clockwise seen from outside, because the building material culls
back faces - convex() and panel() make sure of it, and lathe() is wound by construction.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/cauldron'
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


STONE = material('stone', 'cauldron rubble', 0x8c857a)
PLINTH = material('stone', 'cauldron footing', 0x6d6860)
CHIMNEY = material('stone', 'cauldron chimney', 0x7e776e)
PLASTER = material('wall', 'cauldron plaster', 0xefe3c8)
TIMBER = material('plank', 'cauldron timber', 0x3a281b)
TIMBER_Z = material('plankZ', 'cauldron timber', 0x3a281b)
OAK = material('plank', 'cauldron dark oak', 0x4a2d19)
SLATE = material('roof', 'cauldron slate', 0x444c5a)
RIDGE_SLATE = material('roof', 'cauldron ridge', 0x353b46)
COPPER = material('plain', 'cauldron copper', 0xbd6b3a)
BRIGHT = material('plain', 'cauldron copper rim', 0xe39556)
IRON = material('plain', 'cauldron iron', 0x2a2a2f)
BREW = material('plain', 'cauldron pot inside', 0x1d1a18)
CLAY = material('plain', 'cauldron chimney pot', 0x9e5a3c)
GLASS = material('plain', 'cauldron window', 0x2b3036)
GLOW = material('plain', 'cauldron lit window', 0xffd48a, emissive=True)
COALS = material('plain', 'cauldron coals', 0xff7428, emissive=True)
ASH = material('plain', 'cauldron ash', 0x3b3331)
ROPE = material('plain', 'cauldron rope', 0xb49a68)


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


def newell(pts):
    n = Vector((0, 0, 0))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def convex(part, pts, faces, mat):
    """A convex solid (or part of one): every face turned to look away from its middle."""
    pts = [Vector(p) for p in pts]
    mid = sum(pts, Vector()) / len(pts)
    out = []
    for f in faces:
        fp = [pts[i] for i in f]
        if newell(fp).dot(sum(fp, Vector()) / len(fp) - mid) < 0:
            f = f[::-1]
        out.append(f)
    part.add(pts, out, mat)


# A box's faces by letter, so a face nobody can see is simply not drawn: k back (-z),
# f front, b bottom, t top, l left (-x), r right (+x) - in the box's own axes.
BOX_FACES = {'k': [0, 3, 2, 1], 'f': [4, 5, 6, 7], 'b': [0, 1, 5, 4], 't': [2, 3, 7, 6],
             'r': [1, 2, 6, 5], 'l': [0, 4, 7, 3]}


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=''):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    convex(part, pts, [f for k, f in BOX_FACES.items() if k not in skip], mat)


def strip(part, p, q, w, d, n, mat, ends=False):
    """A batten laid on a wall from p to q: w across, standing d proud of the wall along n.

    Its back is against the wall and its ends run into whatever it meets, so only its
    face and its two edges are drawn - six triangles where a box costs twelve.
    """
    p, q, n = Vector(p), Vector(q), Vector(n).normalized()
    e2 = n.cross((q - p).normalized()).normalized()
    pts = [s + e2 * side * w / 2 + n * depth for s in (p, q) for side in (-1, 1) for depth in (0, d)]
    faces = [[1, 3, 7, 5], [0, 1, 5, 4], [2, 3, 7, 6]]
    if ends:
        faces += [[0, 1, 3, 2], [4, 5, 7, 6]]
    convex(part, pts, faces, mat)


def panel(part, centre, w, h, n, mat):
    """One flat quad facing n (a horizontal axis): a pane, a plate."""
    c, n, up = Vector(centre), Vector(n), Vector((0, 1, 0))
    e1 = up.cross(n)
    part.add([c - e1 * w / 2 - up * h / 2, c + e1 * w / 2 - up * h / 2,
              c + e1 * w / 2 + up * h / 2, c - e1 * w / 2 + up * h / 2], [[0, 1, 2, 3]], mat)


def rod(part, a, b, r, mat, sides=4, top=None, bottom=None, flat=False):
    """A bar from a to b. Only the ends asked for are closed.

    `flat` lays its end rings level instead of square to the bar, for a leg or a pipe that
    leans: a square ring on a leaning leg dips its low side into the grass.
    """
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    if flat:
        u, v = (Vector((0, 0, 1)), Vector((1, 0, 0))) if d.y > 0 else (Vector((1, 0, 0)), Vector((0, 0, 1)))
    else:
        ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
        u = d.cross(ref).normalized(); v = d.cross(u).normalized()
    ring = lambda c: [c + (u * math.cos(2 * math.pi * i / sides) + v * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)]
    part.add(ring(a) + ring(b), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], mat)
    if bottom:
        part.add(ring(a), [list(range(sides))[::-1]], bottom)
    if top:
        part.add(ring(b), [list(range(sides))], top)


def knob(part, centre, r, mat, ry=1.0):
    """An octahedron: eight triangles that read as a ball at the island's distance."""
    c = Vector(centre)
    pts = [c + Vector(p) for p in ((r, 0, 0), (-r, 0, 0), (0, r * ry, 0), (0, -r * ry, 0), (0, 0, r), (0, 0, -r))]
    convex(part, pts, [[x, y, z] for x in (0, 1) for y in (2, 3) for z in (4, 5)], mat)


def lathe(part, base, profile, sides, mats, cap=None, rot=None, phase=0.0):
    """A turned shape: rings of (radius, height) from the bottom up around a vertical axis.

    A first radius of 0 closes the bottom to a point; a last ring is closed with `cap`
    (the pot's contents, level with its rim). Wound outwards by construction: going up the
    profile, the outside is on the right.
    """
    base, rot = Vector(base), rot or Matrix.Identity(3)
    if not isinstance(mats, (list, tuple)):
        mats = [mats] * (len(profile) - 1)
    rings = []
    for r, y in profile:
        if r == 0:
            rings.append([base + rot @ Vector((0, y, 0))])
        else:
            rings.append([base + rot @ Vector((r * math.cos(phase + 2 * math.pi * k / sides), y,
                                               r * math.sin(phase + 2 * math.pi * k / sides))) for k in range(sides)])
    for j in range(len(rings) - 1):
        lo, hi = rings[j], rings[j + 1]
        if len(lo) == 1:
            part.add(lo + hi, [[0, 1 + k, 1 + (k + 1) % sides] for k in range(sides)], mats[j])
        else:
            part.add(lo + hi, [[k, sides + k, sides + (k + 1) % sides, (k + 1) % sides] for k in range(sides)], mats[j])
    if cap is not None and len(rings[-1]) > 1:
        part.add(rings[-1], [list(range(sides))[::-1]], cap)


# A cauldron's profile, as fractions of its radius and height: a rounded bottom, the belly
# a little under half way, a waisted shoulder and a rim that flares back out. The cheap one
# drops the shoulder, which a pot a hand across does not miss.
POT = [(0.62, 0.0), (1.0, 0.42), (0.86, 0.8), (0.96, 1.0)]
SMALL_POT = [(0.74, 0.0), (1.0, 0.45), (0.86, 1.0)]


def pot(part, base, r, h, mat, sides=6, shape=POT, tilt=(0.0, 0.0), phase=0.0):
    lathe(part, base, [(r * a, h * b) for a, b in shape], sides, mat, cap=BREW,
          rot=rotation(rx=tilt[0], rz=tilt[1]), phase=phase)


def legs(part, base, r, h, spread, mat, angles=(30, 150, 270), feet=None):
    """Three stubby legs under a pot whose body starts h above `base`, splayed a little.

    Only the sign's have soles (`feet`): it is the one pot anybody sees from below.
    """
    base = Vector(base)
    for deg in angles:
        t = math.radians(deg)
        c, s = math.cos(t), math.sin(t)
        rod(part, base + Vector((c * spread * 1.25, 0, s * spread * 1.25)),
            base + Vector((c * spread, h + 0.02, s * spread)), r, mat, bottom=feet, flat=True)


ASSET = bpy.data.collections.new('civic_cauldron')
bpy.context.scene.collection.children.link(ASSET)

X0, X1 = -1.40, 1.40          # the party walls; the neighbours stand against these
ZB = -1.30                    # the back wall
ZF = 1.00                     # the stone front of the ground floor
ZU = 1.05                     # the plaster front of the upper floor, jettied a hand over it
ZG = 1.09                     # and the gable, jettied a little further over that
G = 0.84                      # where the stone stops and the plaster starts
EAVES, APEX = 1.50, 2.90      # the side walls' top; the apex is the roof's underside
PITCH = math.atan2(APEX - EAVES, X1)         # about 45 degrees over the full width of the lot
TR = 0.06                     # slate thickness
# The roof runs from behind the back wall to past the gable. It cannot overhang the party
# walls by more than a finger: the neighbour's wall is 0.2 away and nothing may pass 1.48.
RZ0, RZ1, OH = ZB - 0.08, ZG + 0.12, 0.02
FRONT = Vector((0, 0, 1))         # the normal of everything facing the street

# ---- the house --------------------------------------------------------------------------
house = Part(ASSET, 'house')
box(house, (0, G / 2, (ZB + ZF) / 2), (X1 - X0, G, ZF - ZB), STONE, skip='b')
box(house, (0, 0.035, (ZB + ZF) / 2), (X1 - X0 + 0.03, 0.07, ZF - ZB + 0.03), PLINTH, skip='b')
# The upper floor and the back gable are one pentagonal prism along z; its two roof faces
# are never seen and its front pentagon is only drawn up to the eaves, because the front
# gable stands a little proud of it as a prism of its own.
up = [(x, y, z) for z in (ZB, ZU) for x, y in ((X0, G), (X1, G), (X1, EAVES), (0, APEX), (X0, EAVES))]
convex(house, up, [[0, 1, 2, 3, 4], [0, 1, 6, 5], [1, 2, 7, 6], [0, 4, 9, 5], [5, 6, 7, 9]], PLASTER)
gab = [(x, y, z) for z in (ZU, ZG) for x, y in ((X0, EAVES), (X1, EAVES), (0, APEX))]
convex(house, gab, [[3, 4, 5], [0, 1, 4, 3]], PLASTER)

# Timber on the front of the upper floor: the bressumer the jetty rests on, corner posts,
# a post either side of each window, a brace in each outer bay and a V in the middle one,
# which the sign hangs in front of.
front = lambda a, b, w=0.05, d=0.022, z=ZU, ends=False: strip(
    house, (a[0], a[1], z), (b[0], b[1], z), w, d, FRONT, TIMBER, ends)
front((X0, 0.875), (X1, 0.875), w=0.06, d=0.032, ends=True)
for s in (-1, 1):
    # corner posts, proud of both the front and the side; the back ones likewise
    box(house, (s * 1.3805, (0.905 + EAVES) / 2, ZU - 0.019), (0.061, EAVES - 0.905, 0.082), TIMBER, skip='bkt' + ('l' if s > 0 else 'r'))
    box(house, (s * 1.3805, (0.905 + EAVES) / 2, ZB + 0.019), (0.061, EAVES - 0.905, 0.082), TIMBER, skip='bft' + ('l' if s > 0 else 'r'))
    for x in (0.53, 0.97):
        front((s * x, 0.905), (s * x, EAVES))
    front((s * 1.33, 0.905), (s * 1.0, EAVES), w=0.045)
    front((s * 0.07, 0.905), (s * 0.5, EAVES), w=0.045)
    # the upper windows: a frame proud of the wall, the pane, the glow in front of it, a
    # cross of glazing bars and a sill
    wx, wy = s * 0.75, (0.905 + EAVES) / 2 - 0.01
    box(house, (wx, wy, ZU + 0.015), (0.39, 0.38, 0.03), TIMBER, skip='k')
    panel(house, (wx, wy, ZU + 0.031), 0.31, 0.30, FRONT, GLASS)
    panel(house, (wx, wy, ZU + 0.034), 0.24, 0.23, FRONT, GLOW)
    strip(house, (wx, wy - 0.15, ZU + 0.034), (wx, wy + 0.15, ZU + 0.034), 0.022, 0.012, FRONT, TIMBER)
    strip(house, (wx - 0.155, wy + 0.01, ZU + 0.034), (wx + 0.155, wy + 0.01, ZU + 0.034), 0.022, 0.012, FRONT, TIMBER)
    box(house, (wx, wy - 0.208, ZU + 0.035), (0.46, 0.035, 0.07), TIMBER, skip='k')

# The front gable: a tie beam over the jetty, posts either side of a loft door, a collar
# over it, a king post to the apex and a brace up each side.
front((X0, EAVES + 0.03), (X1, EAVES + 0.03), w=0.06, d=0.03, z=ZG, ends=True)
for s in (-1, 1):
    front((s * 0.26, EAVES + 0.06), (s * 0.26, 2.26), z=ZG)
    front((s * 1.0, EAVES + 0.06), (s * 0.29, 2.05), w=0.045, z=ZG)
front((-0.56, 2.28), (0.56, 2.28), w=0.045, z=ZG)
front((0, 2.30), (0, APEX - 0.04), z=ZG)
# The loft door: two leaves of dark oak with a copper strap across, under the hoist.
box(house, (0, 1.83, ZG + 0.012), (0.42, 0.46, 0.024), OAK, skip='k')
strip(house, (0, 1.61, ZG + 0.024), (0, 2.05, ZG + 0.024), 0.012, 0.006, FRONT, TIMBER)
strip(house, (-0.2, 1.74, ZG + 0.024), (0.2, 1.74, ZG + 0.024), 0.022, 0.008, FRONT, COPPER)

# The sides, which the neighbours mostly hide: a sill beam and a plate under the eaves.
for s in (-1, 1):
    side = Vector((s, 0, 0))
    sx = s * X1
    flank = lambda a, b, w=0.05: strip(house, (sx, a[1], a[0]), (sx, b[1], b[0]), w, 0.022, side, TIMBER_Z)
    flank((ZB, 0.875), (ZU, 0.875), w=0.06)
    flank((ZB, EAVES - 0.025), (ZU, EAVES - 0.025))

# The back: the bressumer, a window upstairs, a window in the stone below.
back = -FRONT
strip(house, (X0, 0.875, ZB), (X1, 0.875, ZB), 0.06, 0.022, back, TIMBER)
for (x, y, w, h) in ((0.6, 1.16, 0.3, 0.3), (-0.55, 0.46, 0.3, 0.26)):
    panel(house, (x, y, ZB - 0.004), w, h, back, GLASS)
    panel(house, (x, y, ZB - 0.008), w * 0.72, h * 0.72, back, GLOW)

# ---- the shopfront: dark oak and copper ----------------------------------------------
box(house, (0, 0.76, ZF + 0.025), (2.60, 0.12, 0.05), OAK, skip='kt')                 # fascia
box(house, (0, 0.8325, ZF + 0.0375), (2.66, 0.025, 0.075), COPPER, skip='k')         # cornice
strip(house, (-1.3, 0.706, ZF + 0.05), (1.3, 0.706, ZF + 0.05), 0.012, 0.008, FRONT, COPPER)
for s in (-1, 1):
    box(house, (s * 1.22, 0.35, ZF + 0.025), (0.11, 0.70, 0.05), OAK, skip='kbt')      # pilasters
    box(house, (s * 0.225, 0.35, ZF + 0.025), (0.08, 0.70, 0.05), OAK, skip='kbt')
    box(house, (s * 1.22, 0.684, ZF + 0.033), (0.13, 0.032, 0.066), COPPER, skip='k')  # their caps
    # The shop window: a stall riser and the glass in three panes (the ledge is the wares').
    wx = s * 0.715
    box(house, (wx, 0.15, ZF + 0.015), (0.90, 0.30, 0.03), OAK, skip='kbrl')
    panel(house, (wx, 0.5175, ZF + 0.004), 0.90, 0.365, FRONT, GLASS)
    panel(house, (wx, 0.52, ZF + 0.008), 0.72, 0.27, FRONT, GLOW)
    for x in (0.565, 0.865):
        strip(house, (s * x, 0.335, ZF + 0.008), (s * x, 0.70, ZF + 0.008), 0.024, 0.022, FRONT, OAK)
    strip(house, (s * 0.265, 0.61, ZF + 0.008), (s * 1.165, 0.61, ZF + 0.008), 0.022, 0.022, FRONT, OAK)
# The door: dark oak with a lit pane, a copper kick plate and a copper knob, under a lintel.
box(house, (0, 0.335, ZF + 0.012), (0.34, 0.67, 0.024), OAK, skip='kb')
panel(house, (0, 0.50, ZF + 0.025), 0.18, 0.15, FRONT, GLASS)
panel(house, (0, 0.50, ZF + 0.028), 0.13, 0.10, FRONT, GLOW)
panel(house, (0, 0.06, ZF + 0.025), 0.30, 0.07, FRONT, COPPER)
knob(house, (0.12, 0.33, ZF + 0.036), 0.02, COPPER)
strip(house, (-0.185, 0.686, ZF), (0.185, 0.686, ZF), 0.03, 0.04, FRONT, OAK)
# Copper gutters along both eaves, and a downpipe from the right one down the corner -
# outside the party wall line, where a terrace's downpipes run.
for s in (-1, 1):
    box(house, (s * 1.435, EAVES - 0.035, (RZ0 + RZ1) / 2 - 0.01), (0.045, 0.045, RZ1 - RZ0 - 0.04), COPPER, skip='k')
rod(house, (1.435, EAVES - 0.05, RZ1 - 0.04), (1.435, 1.30, ZF + 0.03), 0.018, COPPER, flat=True)
rod(house, (1.435, 1.30, ZF + 0.03), (1.435, 0.0, ZF + 0.03), 0.018, COPPER, flat=True)
house.build()

# ---- the roof, the hoist, the chimney --------------------------------------------------
roof = Part(ASSET, 'roof')
for s in (1, -1):
    a = Vector((0, APEX, 0))
    e = Vector((s * X1, EAVES, 0))
    d = (e - a).normalized()
    n = Vector((-d.y * s, abs(d.x), 0))
    length = (e - a).length + OH
    c = a + d * (length / 2) + n * (TR / 2)
    box(roof, (c.x, c.y, (RZ0 + RZ1) / 2), (length, TR, RZ1 - RZ0), SLATE, rz=-s * PITCH)
    # a dark bargeboard under each rake of the gable, so the roofline reads from the street
    bb = a + d * (length / 2) - n * 0.03
    box(roof, (bb.x, bb.y, RZ1 - 0.035), (length - 0.04, 0.06, 0.03), TIMBER, rz=-s * PITCH, skip='k')
box(roof, (0, APEX + 0.045, (RZ0 + RZ1) / 2), (0.08, 0.08, RZ1 - RZ0 + 0.02), RIDGE_SLATE, rz=math.pi / 4)

# The hoist beam: a square baulk out of the gable under its peak, a block at its end, a
# rope and a hook - how a cauldron too big for the stairs goes up to the loft.
HY = 2.47
box(roof, (0, HY, (ZG + 1.42) / 2), (0.065, 0.065, 1.42 - ZG), TIMBER, skip='k')
box(roof, (0, HY - 0.075, 1.375), (0.045, 0.09, 0.07), OAK)
rod(roof, (0, HY - 0.12, 1.375), (0, 1.80, 1.375), 0.008, ROPE)
rod(roof, (0, 1.75, 1.395), (0, 1.80, 1.375), 0.013, IRON, bottom=IRON)

# The chimney comes out of the right-hand pitch near the ridge: a broad lower stack, an
# upper one that leans the other way - the crook - a cap and two pots.
CX, CZ = 0.40, -0.55
box(roof, (CX, 2.62, CZ), (0.34, 0.60, 0.32), CHIMNEY, rz=-0.04, skip='b')
box(roof, (CX + 0.02, 3.03, CZ + 0.01), (0.31, 0.24, 0.29), CHIMNEY, rz=0.06, skip='b')
box(roof, (CX + 0.028, 3.165, CZ + 0.01), (0.38, 0.05, 0.35), CHIMNEY, rz=0.06)
for dx in (-0.075, 0.085):
    rod(roof, (CX + 0.028 + dx, 3.18, CZ), (CX + 0.028 + dx * 1.05, 3.29, CZ), 0.043, CLAY, sides=6, top=BREW)
SMOKE = (CX + 0.03, 3.32, CZ)
roof.build()

# ---- the sign: a giant copper cauldron on an iron bracket over the door ----------------
sign = Part(ASSET, 'sign')
SZ, SR, SB, SH = 1.26, 0.21, 0.89, 0.31      # the pot's axis out from the wall, radius, bottom, height
ARM = SB + SH + 0.145                        # the arm, just under the gable's tie beam
box(sign, (0, 1.35, ZU + 0.011), (0.10, 0.20, 0.022), IRON, skip='k')                # wall plate
box(sign, (0, ARM, (ZU + 1.385) / 2), (0.036, 0.036, 1.385 - ZU), IRON, skip='k')    # the arm
rod(sign, (0, 1.44, ZU + 0.02), (0, ARM + 0.012, 1.25), 0.012, IRON)                  # its stay
knob(sign, (0, ARM, 1.40), 0.032, COPPER)                                             # finial
rod(sign, (0, ARM - 0.015, SZ), (0, SB + SH + 0.105, SZ), 0.009, IRON)                 # hook
# It is a little wider across the street than it is deep: the wall behind and the lot's
# edge in front leave it 0.21 of radius that way, and across there is room to be giant.
WIDE = 1.15
lathe(sign, (0, SB, SZ),
      [(0, 0), (SR * 0.6, SH * 0.05), (SR * 0.95, SH * 0.28), (SR, SH * 0.52), (SR * 0.87, SH * 0.83),
       (SR * 0.98, SH * 0.92), (SR * 0.98, SH), (SR * 0.8, SH)],
      8, [COPPER] * 5 + [BRIGHT] * 2, cap=BREW, rot=Matrix.Diagonal((WIDE, 1, 1)), phase=math.pi / 8)
legs(sign, (0, SB - 0.04, SZ), 0.022, 0.04, SR * 0.55, IRON, feet=IRON)
# The bail: an arch of four bars from lug to lug across the front, hooked at its crown.
hw, y0 = SR * WIDE * 1.02, SB + SH * 0.9
hh = SB + SH + 0.105 - y0                    # its crown is where the hook comes down to
arc = [(hw * math.cos(math.pi * k / 4), y0 + hh * math.sin(math.pi * k / 4)) for k in range(5)]
for (xa, ya), (xb, yb) in zip(arc, arc[1:]):
    rod(sign, (xa, ya, SZ), (xb, yb, SZ), 0.011, IRON)
for s in (-1, 1):
    knob(sign, (s * hw, y0, SZ), 0.022, IRON)
sign.build()

# ---- the wares --------------------------------------------------------------------------
# Two parts, one either side of the door, and not for tidiness: the island measures what
# a settler bumps into part by part (footprintOf in buildings.js), and one part holding
# both corners would be one rectangle straight across the doorstep.
left, right = Part(ASSET, 'wares left'), Part(ASSET, 'wares right')
# The ledges: a deep oak shelf under each window, three pots on it, black and copper by
# turns, the middle one the biggest.
for s, wares in ((-1, left), (1, right)):
    box(wares, (s * 0.72, 0.3175, ZF + 0.075), (0.94, 0.035, 0.15), OAK, skip='k')
    for i, x in enumerate((0.415, 0.715, 1.015)):
        r, h = (0.068, 0.095) if i == 1 else (0.055, 0.078)
        mat = (COPPER, IRON)[(i + (s > 0)) % 2]
        pot(wares, (s * x, 0.335, ZF + 0.08), r, h, mat, shape=SMALL_POT, phase=0.3 * i)
# The stack at the left front corner: four cauldrons each sat in the mouth of the one
# below, none of them quite straight.
wares = left
SX, SZ2 = -1.17, 1.28
stack = [(0.16, 0.21, IRON, (0.0, 0.0), (0.0, 0.0), 8, POT),
         (0.12, 0.16, COPPER, (-0.04, 0.07), (0.02, -0.01), 6, POT),
         (0.09, 0.12, IRON, (0.05, -0.09), (-0.012, 0.012), 6, SMALL_POT),
         (0.065, 0.09, COPPER, (-0.06, 0.15), (0.01, 0.0), 6, SMALL_POT)]
y = 0.035
legs(wares, (SX, 0, SZ2), 0.02, 0.035, 0.16 * 0.62 * 0.9, IRON)
for r, h, mat, tilt, off, sides, shape in stack:
    pot(wares, (SX + off[0], y, SZ2 + off[1]), r, h, mat, sides=sides, shape=shape, tilt=tilt, phase=0.4)
    y += h - 0.028
left.build()
# The brazier at the right front corner: an iron bowl of coals on three legs, and a small
# copper cauldron sat in the coals, which glow after dark all round it.
wares = right
BX, BZ = 1.17, 1.28
lathe(wares, (BX, 0.12, BZ), [(0.075, 0.0), (0.165, 0.085), (0.142, 0.085), (0.085, 0.105)], 6,
      [IRON, IRON, COALS], cap=COALS)
legs(wares, (BX, 0, BZ), 0.015, 0.1, 0.085, IRON, angles=(90, 210, 330))
knob(wares, (BX + 0.115, 0.212, BZ + 0.03), 0.024, COALS, ry=0.6)
knob(wares, (BX - 0.08, 0.212, BZ + 0.09), 0.022, ASH, ry=0.6)
pot(wares, (BX, 0.215, BZ), 0.095, 0.13, COPPER, phase=0.2)
right.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(SMOKE)
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.1))
ASSET.objects.link(door)

# The tallest thing on it, which is the chimney's pots.
top = max(o.matrix_world.translation.z + max(v.co.z for v in o.data.vertices)
          for o in ASSET.objects if o.type == 'MESH')
bpy.context.scene['building_height'] = math.ceil(top * 100) / 100
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'cauldron.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'cauldron'})
