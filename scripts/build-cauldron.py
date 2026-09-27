"""The cauldron maker. Rebuild with scripts/blender.mjs --background --python scripts/build-cauldron.py.

A shop for one of the village centre's streets (Plans/knus-dorpscentrum.md), in the village's
own style: a rubble ground floor on a stone footing, a cream plastered upper floor jettied a
hand over it with warm oak framing, and a terracotta roof at the tavern's pitch - but turned
the other way from its neighbours. The other shops keep their ridge along the street; this one
is a workshop, so its ridge runs front to back and the street gets one gable end, jettied again
over the upper floor, with a loft door in it and a hoist beam out under its peak - rope, block
and hook, for a cauldron too big for the stairs. A crooked stone chimney comes out of the
right-hand pitch: a workshop needs a draw. The shopfront is dark oak with copper: pilasters, a
fascia under a copper cornice, two shop windows and a door in the middle; copper gutters run
along both eaves, with a downpipe down the right-hand front corner.

What makes it a cauldron maker from across the square is one thing, hung where a sign hangs: a
giant copper cauldron on a stout iron bracket above the door, round-bellied with a flared rim,
three stubby legs and a bail handle hooked over the arm. Everything else is the stock: a pair
of black and copper pots on each window ledge, a wobbly stack of three cauldrons at the left
front corner, and at the right one small pot sat in the coals of an iron brazier, which glow
after dark.

One civic asset, `civic_cauldron` (budget 1500), in five parts - house, roof, sign and the wares
either side of the door - all static and all merged; nothing here moves. `anchor.door` is at the
foot of the door, which is in the middle, where the paths arrive; `anchor.smoke` is between the
chimney's pots.

At the size of the village. The first version was Hogsmeade to the letter - 2.9 across and 3.3
tall, a black slate roof, built out to the edge of the lot - and on the island it stood twice
the height of the tavern and dark against a village of red roofs. It is now the tavern's size:
walls 1.70 across and 1.30 deep, eaves at 0.92, the ridge at 1.71, the chimney pots at 1.90,
the door 0.27 by 0.45; the pitch is 40 degrees, the tavern's 42 near enough, where it was 45
over twice the width. It stands towards the street on its lot: the shopfront at z 0.78, the
upper floor at 0.82, the gable at 0.85, the back wall at -0.52; the sign and the stack are the
furthest out, at 1.17. The sides, which the neighbours hid when the shop filled its lot, are in
the open now and carry timbers and windows. The doorway itself carries nothing, and the sign
hangs above head height - its lowest foot at 0.59, over WALK_CLEARANCE 0.55, so it is not
measured as a wall in front of the door.

Every pot is a lathe of six or eight sides and three to seven rings, no more: forty of those
triangles is a pot you can read at the island's distance. At this size the window ledges hold
two pots each rather than three and the stack is three high rather than four, because a pot a
few centimetres across is a dot and a dot is not stock. None of them has an underside except
the sign, which is the only one anybody walks beneath. Written in island coordinates (x right,
y up, z to the front) through xyz(); every face is wound counter-clockwise seen from outside,
because the building material culls back faces - convex() and panel() make sure of it, and
lathe() is wound by construction.
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


# The village's own palette - the tavern's stone, plaster and tiles, the bakery's oak - and the
# shop's own dark oak and copper on its front.
STONE = material('stone', 'cauldron rubble', 0x968778)
PLINTH = material('stone', 'cauldron footing', 0x8f8c86)
CHIMNEY = material('stone', 'cauldron chimney', 0x968778)
PLASTER = material('wall', 'cauldron plaster', 0xe8d4ad)
TIMBER = material('plank', 'cauldron timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'cauldron timber', 0x6a4426)
OAK = material('plank', 'cauldron dark oak', 0x4a2d19)
TILES = material('roof', 'cauldron tiles', 0xb8552f)
RIDGE_TILES = material('roof', 'cauldron ridge', 0xc76b3d)
COPPER = material('plain', 'cauldron copper', 0xbd6b3a)
BRIGHT = material('plain', 'cauldron copper rim', 0xe39556)
IRON = material('plain', 'cauldron iron', 0x2a2a2f)
BREW = material('plain', 'cauldron pot inside', 0x1d1a18)
CLAY = material('plain', 'cauldron chimney pot', 0x9e5a3c)
GLASS = material('plain', 'cauldron window', 0x2b3036)
GLOW = material('plain', 'cauldron lit window', 0xffd48a, emissive=True)
COALS = material('plain', 'cauldron coals', 0xff7428, emissive=True)
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


def legs(part, base, r, h, spread, mat, angles=(30, 150, 270), feet=None, sides=3):
    """Three stubby legs under a pot whose body starts h above `base`, splayed a little.
    Three-sided: a leg a centimetre thick is a line, whatever its section.

    Only the sign's have soles (`feet`): it is the one pot anybody sees from below.
    """
    base = Vector(base)
    for deg in angles:
        t = math.radians(deg)
        c, s = math.cos(t), math.sin(t)
        rod(part, base + Vector((c * spread * 1.25, 0, s * spread * 1.25)),
            base + Vector((c * spread, h + 0.015, s * spread)), r, mat, bottom=feet, flat=True, sides=sides)


ASSET = bpy.data.collections.new('civic_cauldron')
bpy.context.scene.collection.children.link(ASSET)

X0, X1 = -0.85, 0.85          # the side walls
ZB = -0.52                    # the back wall
ZF = 0.78                     # the stone front of the ground floor
ZU = 0.82                     # the plaster front of the upper floor, jettied a hand over it
ZG = 0.85                     # and the gable, jettied a little further over that
G = 0.60                      # where the stone stops and the plaster starts
EAVES = 0.92                  # the side walls' top
PITCH = math.radians(40)      # the tavern's pitch, near enough
APEX = EAVES + X1 * math.tan(PITCH)       # the roof's underside at the ridge
TR = 0.045                    # the tiles' thickness
# The roof runs from behind the back wall to past the gable, and a hand past the side walls.
RZ0, RZ1, OH = ZB - 0.07, ZG + 0.08, 0.05
FRONT = Vector((0, 0, 1))         # the normal of everything facing the street

# ---- the house --------------------------------------------------------------------------
house = Part(ASSET, 'house')
box(house, (0, G / 2, (ZB + ZF) / 2), (X1 - X0, G, ZF - ZB), STONE, skip='bt')
box(house, (0, 0.03, (ZB + ZF) / 2), (X1 - X0 + 0.03, 0.06, ZF - ZB + 0.03), PLINTH, skip='b')
# The upper floor and the back gable are one pentagonal prism along z; its two roof faces
# are never seen and its front pentagon is only drawn up to the eaves, because the front
# gable stands a little proud of it as a prism of its own. Its underside is the jetty's.
up = [(x, y, z) for z in (ZB, ZU) for x, y in ((X0, G), (X1, G), (X1, EAVES), (0, APEX), (X0, EAVES))]
convex(house, up, [[0, 1, 2, 3, 4], [0, 1, 6, 5], [1, 2, 7, 6], [0, 4, 9, 5], [5, 6, 7, 9]], PLASTER)
gab = [(x, y, z) for z in (ZU, ZG) for x, y in ((X0, EAVES), (X1, EAVES), (0, APEX))]
convex(house, gab, [[3, 4, 5], [0, 1, 4, 3]], PLASTER)

# Timber on the front of the upper floor: the bressumer the jetty rests on, corner posts,
# a post either side of each window, a brace in each outer bay and a V in the middle one,
# which the sign hangs in front of.
front = lambda a, b, w=0.035, d=0.018, z=ZU, ends=False: strip(
    house, (a[0], a[1], z), (b[0], b[1], z), w, d, FRONT, TIMBER, ends)
front((X0, G + 0.022), (X1, G + 0.022), w=0.045, d=0.025, ends=True)
TOP = EAVES - 0.01
for s in (-1, 1):
    # corner posts, proud of both the front and the side; the back ones likewise
    box(house, (s * (X1 - 0.004), (G + 0.045 + TOP) / 2, ZU - 0.013), (0.044, TOP - G - 0.045, 0.06), TIMBER, skip='bkt' + ('l' if s > 0 else 'r'))
    box(house, (s * (X1 - 0.004), (G + 0.045 + TOP) / 2, ZB + 0.013), (0.044, TOP - G - 0.045, 0.06), TIMBER, skip='bft' + ('l' if s > 0 else 'r'))
    for x in (0.32, 0.6):
        front((s * x, G + 0.045), (s * x, TOP))
    front((s * 0.8, G + 0.045), (s * 0.63, TOP), w=0.03)
    front((s * 0.04, G + 0.045), (s * 0.29, TOP), w=0.03)
    # the upper windows: a frame proud of the wall, the pane, the glow in front of it, a
    # cross of glazing bars and a sill
    wx, wy = s * 0.46, (G + 0.045 + TOP) / 2
    box(house, (wx, wy, ZU + 0.01), (0.23, 0.2, 0.02), TIMBER, skip='kb')
    panel(house, (wx, wy, ZU + 0.021), 0.18, 0.155, FRONT, GLASS)
    panel(house, (wx, wy, ZU + 0.024), 0.14, 0.115, FRONT, GLOW)
    # glazing bars as one quad each: a bar a centimetre proud has no edge anybody can see
    panel(house, (wx, wy, ZU + 0.027), 0.014, 0.155, FRONT, TIMBER)
    panel(house, (wx, wy + 0.005, ZU + 0.028), 0.18, 0.014, FRONT, TIMBER)
    box(house, (wx, wy - 0.11, ZU + 0.022), (0.27, 0.022, 0.044), TIMBER, skip='kb')

# The front gable: a tie beam over the jetty, posts either side of a loft door, a collar
# over it, a king post to the apex and a brace up each side.
front((X0, EAVES + 0.02), (X1, EAVES + 0.02), w=0.04, d=0.022, z=ZG, ends=True)
LOFT = 1.11                   # the loft door's middle
for s in (-1, 1):
    front((s * 0.17, EAVES + 0.04), (s * 0.17, 1.27), z=ZG)
    front((s * 0.62, EAVES + 0.04), (s * 0.19, 1.19), w=0.03, z=ZG)
front((-0.36, 1.285), (0.36, 1.285), w=0.03, z=ZG)
front((0, 1.3), (0, APEX - 0.03), z=ZG)
# The loft door: two leaves of dark oak with a copper strap across, under the hoist.
box(house, (0, LOFT, ZG + 0.009), (0.27, 0.29, 0.018), OAK, skip='kb')
panel(house, (0, LOFT, ZG + 0.02), 0.008, 0.29, FRONT, TIMBER)
panel(house, (0, LOFT - 0.07, ZG + 0.021), 0.25, 0.014, FRONT, COPPER)

# The sides, which stand in the open now that the shop is the size of a house: a sill beam,
# a plate under the eaves, a post and a brace, a window upstairs and one in the stone below.
for s in (-1, 1):
    side = Vector((s, 0, 0))
    sx = s * X1
    flank = lambda a, b, w=0.035: strip(house, (sx, a[1], a[0]), (sx, b[1], b[0]), w, 0.018, side, TIMBER_Z)
    flank((ZB + 0.03, G + 0.022), (ZU - 0.03, G + 0.022), w=0.045)
    flank((ZB + 0.03, EAVES - 0.018), (ZU - 0.03, EAVES - 0.018))
    flank((-0.12, G + 0.045), (-0.12, EAVES - 0.035))
    flank((ZB + 0.05, G + 0.045), (-0.15, EAVES - 0.035), w=0.03)
    panel(house, (sx + s * 0.004, 0.76, 0.34), 0.24, 0.16, side, GLASS)
    panel(house, (sx + s * 0.007, 0.76, 0.34), 0.18, 0.11, side, GLOW)
    panel(house, (sx + s * 0.004, 0.33, 0.06), 0.18, 0.16, side, GLASS)
    panel(house, (sx + s * 0.007, 0.33, 0.06), 0.13, 0.11, side, GLOW)
    box(house, (sx + s * 0.02, 0.24, 0.06), (0.04, 0.03, 0.24), STONE, skip='b' + ('l' if s > 0 else 'r'))

# The back: the bressumer, a tie beam across the gable, a window upstairs, a window in the
# stone below.
back = -FRONT
strip(house, (X0, G + 0.022, ZB), (X1, G + 0.022, ZB), 0.045, 0.018, back, TIMBER)
strip(house, (X0, EAVES - 0.018, ZB), (X1, EAVES - 0.018, ZB), 0.036, 0.018, back, TIMBER)
for (x, y, w, h) in ((0.36, 0.77, 0.2, 0.17), (-0.36, 0.3, 0.2, 0.17)):
    panel(house, (x, y, ZB - 0.004), w, h, back, GLASS)
    panel(house, (x, y, ZB - 0.008), w * 0.72, h * 0.7, back, GLOW)

# ---- the shopfront: dark oak and copper ----------------------------------------------
HEAD = 0.47                   # the window heads and the door's
box(house, (0, 0.527, ZF + 0.02), (1.60, 0.075, 0.04), OAK, skip='kt')                   # fascia
box(house, (0, 0.577, ZF + 0.03), (1.66, 0.025, 0.06), COPPER, skip='k')                # cornice
for s in (-1, 1):
    box(house, (s * 0.775, HEAD / 2 + 0.01, ZF + 0.02), (0.07, HEAD + 0.02, 0.04), OAK, skip='kbt')    # pilasters
    box(house, (s * 0.17, HEAD / 2 + 0.01, ZF + 0.02), (0.05, HEAD + 0.02, 0.04), OAK, skip='kbt')
    box(house, (s * 0.775, HEAD - 0.012, ZF + 0.026), (0.085, 0.02, 0.052), COPPER, skip='kb')  # their caps
    # The shop window: a stall riser and the glass in three panes (the ledge is the wares'),
    # the glazing bars one quad each.
    wx = s * 0.4675
    box(house, (wx, 0.085, ZF + 0.01), (0.545, 0.17, 0.02), OAK, skip='kbrl')
    panel(house, (wx, (0.17 + HEAD) / 2, ZF + 0.004), 0.545, HEAD - 0.17, FRONT, GLASS)
    panel(house, (wx, (0.17 + HEAD) / 2 + 0.005, ZF + 0.008), 0.44, 0.22, FRONT, GLOW)
    for x in (0.375, 0.56):
        panel(house, (s * x, (0.17 + HEAD) / 2, ZF + 0.012), 0.016, HEAD - 0.17, FRONT, OAK)
    panel(house, (wx, 0.39, ZF + 0.013), 0.545, 0.014, FRONT, OAK)
# The door: dark oak with a lit pane, a copper kick plate and a copper knob, under a lintel.
box(house, (0, 0.245, ZF + 0.012), (0.27, 0.45, 0.024), OAK, skip='kb')
panel(house, (0, 0.36, ZF + 0.025), 0.13, 0.1, FRONT, GLASS)
panel(house, (0, 0.36, ZF + 0.028), 0.09, 0.065, FRONT, GLOW)
panel(house, (0, 0.05, ZF + 0.025), 0.23, 0.05, FRONT, COPPER)
panel(house, (0.09, 0.23, ZF + 0.026), 0.022, 0.022, FRONT, COPPER)
strip(house, (-0.145, 0.48, ZF), (0.145, 0.48, ZF), 0.02, 0.03, FRONT, OAK)
# Copper gutters along both eaves, and a downpipe from the right one down the front corner.
GX = X1 + OH - 0.012
GY = EAVES - OH * math.tan(PITCH) - 0.02
for s in (-1, 1):
    box(house, (s * GX, GY, (RZ0 + RZ1) / 2 - 0.01), (0.032, 0.032, RZ1 - RZ0 - 0.03), COPPER, skip='k')
rod(house, (GX, GY - 0.015, ZF - 0.02), (X1 + 0.018, GY - 0.12, ZF - 0.02), 0.012, COPPER, flat=True)
rod(house, (X1 + 0.018, GY - 0.12, ZF - 0.02), (X1 + 0.018, 0.0, ZF - 0.02), 0.012, COPPER, flat=True)
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
    # the slab's end at the ridge is under the cap: local -x on the right pitch, +x on the left
    box(roof, (c.x, c.y, (RZ0 + RZ1) / 2), (length, TR, RZ1 - RZ0), TILES, rz=-s * PITCH, skip='l' if s > 0 else 'r')
    # a bargeboard under each rake of the gable, so the roofline reads from the street
    bb = a + d * (length / 2) - n * 0.018
    box(roof, (bb.x, bb.y, RZ1 - 0.02), (length - 0.03, 0.036, 0.022), TIMBER, rz=-s * PITCH, skip='kt')
box(roof, (0, APEX + 0.04, (RZ0 + RZ1) / 2), (0.055, 0.055, RZ1 - RZ0 + 0.02), RIDGE_TILES, rz=math.pi / 4)

# The hoist beam: a square baulk out of the gable under its peak, a block at its end, a
# rope and a hook - how a cauldron too big for the stairs goes up to the loft.
HY, HZ = 1.4, 1.12
box(roof, (0, HY, (ZG + HZ + 0.03) / 2), (0.045, 0.045, HZ + 0.03 - ZG), TIMBER, skip='k')
box(roof, (0, HY - 0.05, HZ), (0.032, 0.06, 0.045), OAK, skip='t')
rod(roof, (0, HY - 0.08, HZ), (0, LOFT - 0.04, HZ), 0.006, ROPE, sides=3)
rod(roof, (0, LOFT - 0.075, HZ + 0.012), (0, LOFT - 0.04, HZ), 0.009, IRON, bottom=IRON)

# The chimney comes out of the right-hand pitch near the ridge: a broad lower stack, an
# upper one that leans the other way - the crook - a cap and two pots.
CX, CZ = 0.26, -0.3
box(roof, (CX, 1.47, CZ), (0.2, 0.36, 0.19), CHIMNEY, rz=-0.04, skip='b')
box(roof, (CX + 0.012, 1.74, CZ + 0.006), (0.18, 0.16, 0.17), CHIMNEY, rz=0.06, skip='b')
box(roof, (CX + 0.017, 1.83, CZ + 0.006), (0.22, 0.03, 0.2), CHIMNEY, rz=0.06)
for dx in (-0.045, 0.05):
    rod(roof, (CX + 0.017 + dx, 1.84, CZ), (CX + 0.017 + dx * 1.05, 1.895, CZ), 0.026, CLAY, sides=5, top=BREW)
SMOKE = (CX + 0.02, 1.92, CZ)
roof.build()

# ---- the sign: a giant copper cauldron on an iron bracket over the door ----------------
sign = Part(ASSET, 'sign')
SZ, SR, SB, SH = ZU + 0.19, 0.11, 0.62, 0.17   # the pot's axis out from the wall, radius, bottom, height
ARM = SB + SH + 0.08                          # the arm, just under the gable's tie beam
box(sign, (0, 0.8, ZU + 0.008), (0.06, 0.12, 0.016), IRON, skip='k')                  # wall plate
box(sign, (0, ARM, (ZU + SZ + 0.12) / 2), (0.024, 0.024, SZ + 0.12 - ZU), IRON, skip='k')   # the arm
rod(sign, (0, 0.76, ZU + 0.012), (0, ARM - 0.01, SZ - 0.01), 0.008, IRON, sides=3)        # its stay
knob(sign, (0, ARM, SZ + 0.135), 0.02, COPPER)                                          # finial
rod(sign, (0, ARM - 0.01, SZ), (0, SB + SH + 0.05, SZ), 0.006, IRON, sides=3)            # hook
# It is a little wider across the street than it is deep: across there is room to be giant.
# The rim is one flared band and the lip inside it, the belly three rings.
WIDE = 1.15
lathe(sign, (0, SB, SZ),
      [(0, 0), (SR * 0.6, SH * 0.05), (SR * 0.95, SH * 0.28), (SR, SH * 0.52), (SR * 0.87, SH * 0.83),
       (SR * 0.98, SH), (SR * 0.8, SH)],
      8, [COPPER] * 4 + [BRIGHT] * 2, cap=BREW, rot=Matrix.Diagonal((WIDE, 1, 1)), phase=math.pi / 8)
legs(sign, (0, SB - 0.025, SZ), 0.013, 0.025, SR * 0.55, IRON, feet=IRON)
# The bail: an arch of four bars from lug to lug across the front, hooked at its crown.
hw, y0 = SR * WIDE * 1.02, SB + SH * 0.9
hh = SB + SH + 0.05 - y0                     # its crown is where the hook comes down to
arc = [(hw * math.cos(math.pi * k / 4), y0 + hh * math.sin(math.pi * k / 4)) for k in range(5)]
for (xa, ya), (xb, yb) in zip(arc, arc[1:]):
    rod(sign, (xa, ya, SZ), (xb, yb, SZ), 0.007, IRON, sides=3)
sign.build()

# ---- the wares --------------------------------------------------------------------------
# Two parts, one either side of the door, and not for tidiness: the island measures what
# a settler bumps into part by part (footprintOf in buildings.js), and one part holding
# both corners would be one rectangle straight across the doorstep. The ledges stop 0.26
# either side of the middle, so the way to the door stays a body wide.
left, right = Part(ASSET, 'wares left'), Part(ASSET, 'wares right')
# The ledges: a deep oak shelf under each window, two pots on it, black and copper by turns.
for s, wares in ((-1, left), (1, right)):
    box(wares, (s * 0.49, 0.1825, ZF + 0.045), (0.46, 0.025, 0.09), OAK, skip='k')
    for i, x in enumerate((0.37, 0.6)):
        r, h = (0.05, 0.07) if i == 1 else (0.042, 0.058)
        mat = (COPPER, IRON)[(i + (s > 0)) % 2]
        pot(wares, (s * x, 0.195, ZF + 0.047), r, h, mat, sides=5, shape=SMALL_POT, phase=0.3 * i)
# The stack at the left front corner: three cauldrons each sat in the mouth of the one
# below, none of them quite straight. Only the one at the bottom is big enough to show its
# waist.
wares = left
SX, SZ2 = -0.74, 1.04
stack = [(0.12, 0.15, IRON, (0.0, 0.0), (0.0, 0.0), 8, POT),
         (0.09, 0.115, COPPER, (-0.04, 0.07), (0.012, -0.006), 6, SMALL_POT),
         (0.065, 0.085, IRON, (0.05, -0.09), (-0.008, 0.008), 6, SMALL_POT)]
y = 0.025
legs(wares, (SX, 0, SZ2), 0.013, 0.025, 0.12 * 0.62 * 0.9, IRON)
for r, h, mat, tilt, off, sides, shape in stack:
    pot(wares, (SX + off[0], y, SZ2 + off[1]), r, h, mat, sides=sides, shape=shape, tilt=tilt, phase=0.4)
    y += h - 0.02
left.build()
# The brazier at the right front corner: an iron bowl of coals on three legs, and a small
# copper cauldron sat in the coals, which glow after dark all round it.
wares = right
BX, BZ = 0.74, 1.04
lathe(wares, (BX, 0.08, BZ), [(0.05, 0.0), (0.12, 0.06), (0.103, 0.06), (0.06, 0.075)], 6,
      [IRON, IRON, COALS], cap=COALS)
legs(wares, (BX, 0, BZ), 0.01, 0.065, 0.06, IRON, angles=(90, 210, 330))
knob(wares, (BX + 0.08, 0.146, BZ + 0.02), 0.017, COALS, ry=0.6)
pot(wares, (BX, 0.148, BZ), 0.068, 0.095, COPPER, phase=0.2)
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
