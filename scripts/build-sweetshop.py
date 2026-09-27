"""The sweet shop. Rebuild with scripts/blender.mjs --background --python scripts/build-sweetshop.py.

A shop for one of the village centre's streets (Plans/knus-dorpscentrum.md), in the village's
own style: a stone footing, cream plaster between warm oak timbers, a terracotta roof at the
tavern's pitch with its ridge along the street, and a crooked stone chimney astride it. Its
front is a painted wooden shopfront in cherry red with cream trim and turquoise accents, and
over it the upper floor is jettied a hand and carries two gables side by side facing the
street, with cream bargeboards. What makes it a sweet shop from across the square:

    - two display windows either side of a turquoise door, each with two rows of sweet jars
      (the lower row on the sill, the upper on a shelf) whose contents glow at night;
    - a red-and-white candy-striped awning over the whole shopfront, with a pointed valance;
    - a giant swirl lollipop planted on the awning between the two gables - the shop's sign,
      and the only one it needs: no lettering, a sign is a picture.

One civic asset, `civic_sweetshop` (budget 1500), nothing that moves. `anchor.door` is at the
foot of the door, which is centred on x because the island's paths arrive at the middle of the
lot's front edge; `anchor.smoke` is on the chimney pot.

At the size of the village. The first version was Hogsmeade to the letter - 2.9 across and 3.3
tall, dark slate roofs at 59 degrees, built out to the edge of the lot - and on the island it
stood twice the height of the tavern and black against a village of red roofs. It is now the
tavern's size: walls 1.68 across and 1.30 deep (1.36 upstairs), eaves at 1.00, the ridge at
1.69, the gables' ridges at 1.49, the chimney pot at 1.89, the door 0.28 by 0.45. It stands
towards the street on its lot: the shopfront at z 0.78, the jettied upper floor at 0.84, the
back wall at -0.52, and the awning reaches 0.98 at most. The sides, which a neighbour stood
against when the shop filled its lot, are in the open now and are framed and glazed like the
front.

The two gables were two whole roofs side by side, ridges front to back; at this width that
made each one 0.84 across, and a gable that narrow has to be pitched at 59 degrees to be a
roof at all. So the main roof now runs along the street at the tavern's 42 degrees, and the
two gables are cross gables on its front slope, pitched at 45: the street still sees two
gables, and the roof is the village's. A cross gable's pitches are cut along the valley where
they run into the main roof (valley_z), because a plain rectangle of tiles ran on under the
main roof's verge and showed along the side wall.

Why it is as coarse as it is: the jars are what the triangles go on - twelve of them, each
five-sided (at the size a jar is seen, a dozen pixels on a close look, a sixth side buys
nothing), in two bands: the sweets, and a pale band of clear glass drawing in to the lid.
Drawn as one coloured cylinder a jar read as a tin; the glass band is what makes it a jar. Six
a window, not ten: at this size ten were a row of dots. Anything flat against a wall leaves its
back face out (`skip=BACK`), a post that runs into a beam its ends too, glass and glow are one
quad each, and the ends of roof pitches that meet under a ridge cap or in a valley are not
drawn. The awning's stripes are single sheets with a face each way - the building material
culls back faces, and a board drawn as a box would spend ten triangles on edges a centimetre
thick; the valance faces the street only. The bunting the first version had under the eaves is
gone: at this size its pennants were four pixels, and the eaves are where the gables' windows
are now.

The awning is high on purpose, for two reasons. The island is looked at from 25-35 degrees up
and every centimetre an awning projects hides more of the window below it: it projects 0.20
and ends at y 0.597, which at 30 degrees hides the window down to 0.48, and the upper row of
jars stands below that. And the island measures everything under 0.55 (WALK_CLEARANCE) as a
wall a settler walks into, part by part: an awning with its valance below that line is a wall
right across the door, so the points of the valance stop at 0.557. That is why the ground floor
is 0.68 tall where a cottage's is less: the door and the window heads at 0.5, a cornice and a
fascia, and the awning hung from under the jetty above them.

Plaster takes the wall sheet, the tiles the roof sheet, the stone the stone sheet and the
timber and the painted woodwork the plank sheets, so the island's own textures draw the
courses and the boards. Written in island coordinates (x right, y up, z to the front) through
xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/sweetshop'
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


# The village's own palette - the tavern's tiles and stone, the bakery's plaster and oak - and
# the shop's own three colours on the woodwork of its front.
STONE = material('stone', 'sweetshop footing', 0x8f8c86)
CHIMNEY = material('stone', 'sweetshop chimney', 0x968778)
PLASTER = material('wall', 'sweetshop plaster', 0xf0e2c4)
TIMBER = material('plank', 'sweetshop timber', 0x6a4426)
TIMBER_Z = material('plankZ', 'sweetshop timber', 0x6a4426)
TILES = material('roof', 'sweetshop tiles', 0xb8552f)
RIDGE_TILES = material('roof', 'sweetshop ridge', 0xc76b3d)
CHERRY = material('plank', 'sweetshop cherry red', 0xc41f37)
CREAM = material('plank', 'sweetshop cream trim', 0xf4e7c8)
TURQUOISE = material('plank', 'sweetshop turquoise', 0x22aea6)
GLASS = material('plain', 'sweetshop window', 0x283038)
WINDOW_GLOW = material('plain', 'sweetshop lit window', 0xffd88a, emissive=True)
BRASS = material('plain', 'sweetshop brass', 0xd6a93e)
AWNING_RED = material('plain', 'sweetshop awning', 0xd42a3c)
AWNING_WHITE = material('plain', 'sweetshop awning stripe', 0xf7f1e6)
IRON = material('plain', 'sweetshop iron', 0x2f3036)
JAR_GLASS = material('plain', 'sweetshop jar glass', 0xd9eeee)
CANDY = [material('plain', f'sweetshop candy {n}', c, emissive=True) for n, c in (
    ('pink', 0xff6fb0), ('yellow', 0xffd23f), ('green', 0x6fd65a), ('orange', 0xff9636), ('blue', 0x52b4ff))]
LIDS = [material('plain', f'sweetshop lid {n}', c) for n, c in (
    ('red', 0xc41f37), ('turquoise', 0x22aea6), ('brass', 0xd6a93e))]
SWIRL_WHITE = material('plain', 'sweetshop swirl white', 0xfbf6ee)
SWIRL = [material('plain', f'sweetshop swirl {n}', c) for n, c in (
    ('red', 0xe8283c), ('orange', 0xff8f2a), ('yellow', 0xffd23f), ('green', 0x5fcf55),
    ('turquoise', 0x26b8c8), ('pink', 0xff5fa8))]


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


# A box's six faces by the side they face, in its own frame, so a board against a wall can
# leave out the face nobody will ever see.
FACES = {'back': [0, 3, 2, 1], 'front': [4, 5, 6, 7], 'bottom': [0, 1, 5, 4],
         'top': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 4, 7, 3]}
BACK = ('back',)
POST = ('back', 'top', 'bottom')      # a post on a wall, running into a beam at each end
RAIL = ('back', 'left', 'right')      # a rail on a wall, running into a post at each end


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [f for k, f in FACES.items() if k not in skip], mat)


def span(part, x0, x1, y0, y1, z0, z1, mat, skip=()):
    """An axis-aligned box by its extents, which is how a shopfront is measured."""
    box(part, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), mat, skip=skip)


def plate(part, quad, n, t, mat, edges=(0, 1, 2, 3), bottom=True):
    """A slab of tiles: the quad is its underside, grown t along n. `edges` are the sides
    (quad[i] to quad[i+1]) that get an end face; a side under a ridge cap or in a valley
    has none, because nobody will ever see it."""
    q = [Vector(p) for p in quad]
    n = Vector(n).normalized()
    faces = [[4, 5, 6, 7]] + ([[0, 1, 2, 3]] if bottom else [])
    faces += [[i, (i + 1) % 4, 4 + (i + 1) % 4, 4 + i] for i in edges]
    convex(part, q + [p + n * t for p in q], faces, mat)


def sheet(part, pts, mat):
    """A flat polygon with a face each way: cloth. Points counter-clockwise seen from the front."""
    part.add(pts, [list(range(len(pts))), list(range(len(pts)))[::-1]], mat)


def pane(part, x0, x1, y0, y1, z, mat):
    """A rectangle facing +z, and nothing else: glass and glow flat on a wall."""
    part.add([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [[0, 1, 2, 3]], mat)


def side_pane(part, x, z0, z1, y0, y1, mat, s):
    """The same on a side wall, facing s (+1 is +x)."""
    pts = [(x, y0, z1), (x, y0, z0), (x, y1, z0), (x, y1, z1)]
    part.add(pts if s > 0 else pts[::-1], [[0, 1, 2, 3]], mat)


def jar(part, x, y, z, r, h, contents, lid, sides=5):
    """Sweets to two thirds, clear glass above them drawing in to the shoulder, and a lid.
    A plain coloured cylinder read as a tin; the pale band is what makes it a jar."""
    def ring(yy, rr):
        return [(x + rr * math.sin(2 * math.pi * (i + .5) / sides), yy, z + rr * math.cos(2 * math.pi * (i + .5) / sides)) for i in range(sides)]
    # No bottom: a jar stands on a shelf. The sides wind outwards and the lid is the top ring
    # counter-clockwise from above, because the building material culls back faces.
    band = [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)]
    fill = y + h * 0.6
    part.add(ring(y, r) + ring(fill, r), band, contents)
    part.add(ring(fill, r) + ring(y + h, r * 0.8), band, JAR_GLASS)
    part.add(ring(y + h, r * 0.8), [list(range(sides))], lid)


ASSET = bpy.data.collections.new('civic_sweetshop')
bpy.context.scene.collection.children.link(ASSET)

X0, X1 = -0.84, 0.84           # the side walls
ZB, ZF, ZU = -0.52, 0.78, 0.84  # back wall, the shopfront, the jettied upper floor's front
FOOT, G, EAVES = 0.08, 0.68, 1.00
ZM = (ZB + ZU) / 2             # the main ridge, along the street over the upper floor's middle
PITCH = math.radians(42)       # the main roof, the tavern's 0.57 over 0.62
RIDGE = EAVES + (ZU - ZM) * math.tan(PITCH)     # the underside of the tiles at the ridge
GX, GW = 0.42, 0.42            # the two cross gables: ridges at x = +-GX, each GW either side
APEX = EAVES + GW              # their ridges' underside: 45 degrees
T = 0.045                      # the tiles' thickness

# ---- the house: a stone footing, plaster, the timbers -----------------------------------------
house = Part(ASSET, 'house')
span(house, X0 - 0.015, X1 + 0.015, 0, FOOT, ZB - 0.015, ZF, STONE, skip=('bottom', 'front'))
span(house, X0, X1, FOOT, G, ZB, ZF, PLASTER, skip=('bottom', 'top'))
span(house, X0, X1, G, EAVES, ZB, ZU, PLASTER, skip=('top',))
# The main roof's two gable ends, on the sides.
# In this vertex order the normal points towards -x; each end must face outwards
# because the building material culls back faces.
for s in (-1, 1):
    pts = [(s * X1, EAVES, ZB), (s * X1, EAVES, ZU), (s * X1, RIDGE, ZM)]
    house.add(pts, [[2, 1, 0] if s > 0 else [0, 1, 2]], PLASTER)
# The two cross gables on the front.
for gx in (-GX, GX):
    house.add([(gx - GW, EAVES, ZU), (gx + GW, EAVES, ZU), (gx, APEX, ZU)], [[0, 1, 2]], PLASTER)

# The front of the upper floor: the bressumer it stands out on, the plate under the gables,
# posts at the corners and under the valley, and a brace in each outer bay.
span(house, X0 - 0.01, X1 + 0.01, G - 0.02, G + 0.035, ZU - 0.02, ZU + 0.025, TIMBER, skip=BACK)
span(house, X0, X1, EAVES - 0.035, EAVES, ZU, ZU + 0.022, TIMBER, skip=BACK)
span(house, -0.022, 0.022, G + 0.035, EAVES - 0.035, ZU, ZU + 0.02, TIMBER, skip=POST)
# The corner posts, one square post proud of both walls at each corner of each floor: two faces
# where a post on each wall was six. The shopfront's pilasters are the ground floor's front ones.
for s in (-1, 1):
    for z, y0, y1, zs in ((ZB, FOOT, G - 0.02, 'front'), (ZF, FOOT, G - 0.02, 'back'),
                          (ZB, G + 0.035, EAVES - 0.035, 'front'), (ZU, G + 0.035, EAVES - 0.035, 'back')):
        span(house, s * X1 - 0.022, s * X1 + 0.022, y0, y1, z - 0.022, z + 0.022, TIMBER,
             skip=('top', 'bottom', zs, 'left' if s > 0 else 'right'))
BRACE = math.atan2(0.13, EAVES - G - 0.07)
for s in (-1, 1):
    box(house, (s * 0.71, (G + EAVES) / 2, ZU + 0.01), (0.035, math.hypot(0.13, EAVES - G - 0.07), 0.02), TIMBER,
        rz=s * BRACE, skip=POST)
# A collar across each gable, a small window over it.
for gx in (-GX, GX):
    cy = EAVES + 0.08
    cw = GW * (APEX - cy) / (APEX - EAVES)
    span(house, gx - cw, gx + cw, cy - 0.018, cy + 0.018, ZU, ZU + 0.02, TIMBER, skip=BACK)

# The sides, which stand in the open now that the shop is the size of a house: a sill beam at
# the jetty, a plate under the eaves (the tie beam of the gable end), a post in the middle of
# the ground floor, and a window on each floor and one in the gable.
for s in (-1, 1):
    x, out = s * X1, ('left',) if s > 0 else ('right',)
    sx0, sx1 = (x, x + 0.022) if s > 0 else (x - 0.022, x)
    span(house, sx0, sx1, G - 0.02, G + 0.035, ZB + 0.022, ZU - 0.022, TIMBER_Z, skip=out + ('back', 'front'))
    span(house, sx0, sx1, EAVES - 0.035, EAVES, ZB + 0.022, ZU - 0.022, TIMBER_Z, skip=out + ('back', 'front'))
    span(house, sx0, sx1, FOOT, G - 0.02, -0.2, -0.16, TIMBER, skip=out + ('top', 'bottom'))
    # a brace in the back bay of each floor, the way the tavern's sides are braced
    for y0, y1, za, zb in ((FOOT, G - 0.02, -0.5, -0.2), (G + 0.035, EAVES - 0.035, -0.5, -0.1)):
        lean = math.atan2(zb - za, y1 - y0)
        box(house, (x + s * 0.011, (y0 + y1) / 2, (za + zb) / 2), (0.022, math.hypot(zb - za, y1 - y0), 0.035), TIMBER,
            rx=lean, skip=out + ('top', 'bottom'))
    for (z0, z1, y0, y1) in ((0.34, 0.6, G + 0.075, EAVES - 0.07), (0.1, 0.36, 0.24, 0.46), (ZM - 0.07, ZM + 0.07, 1.12, 1.28)):
        side_pane(house, x + s * 0.004, z0, z1, y0, y1, GLASS, s)
        side_pane(house, x + s * 0.007, z0 + 0.025, z1 - 0.025, y0 + 0.025, y1 - 0.025, WINDOW_GLOW, s)
        if y0 < EAVES:
            span(house, *(sorted((x, x + s * 0.045))), y0 - 0.025, y0, z0 - 0.02, z1 + 0.02, TIMBER_Z, skip=out + ('bottom',))

# The back: the jetty's beam carried round, a window upstairs, a window below.
span(house, X0, X1, G - 0.02, G + 0.035, ZB - 0.022, ZB, TIMBER, skip=('front',))
for (x, y, w, h) in ((0.42, 0.82, 0.22, 0.17), (-0.42, 0.82, 0.22, 0.17), (0.3, 0.34, 0.24, 0.2)):
    house.add([(x + w / 2, y - h / 2, ZB - 0.004), (x - w / 2, y - h / 2, ZB - 0.004),
               (x - w / 2, y + h / 2, ZB - 0.004), (x + w / 2, y + h / 2, ZB - 0.004)], [[0, 1, 2, 3]], GLASS)
    house.add([(x + w / 2 - 0.025, y - h / 2 + 0.025, ZB - 0.007), (x - w / 2 + 0.025, y - h / 2 + 0.025, ZB - 0.007),
               (x - w / 2 + 0.025, y + h / 2 - 0.025, ZB - 0.007), (x + w / 2 - 0.025, y + h / 2 - 0.025, ZB - 0.007)],
              [[0, 1, 2, 3]], WINDOW_GLOW)


def window(part, cx, cy, w, h, z, shutters=False, transom=True):
    i = 0.025
    pane(part, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, z + 0.003, GLASS)
    pane(part, cx - w / 2 + i, cx + w / 2 - i, cy - h / 2 + i, cy + h / 2 - i, z + 0.006, WINDOW_GLOW)
    span(part, cx - 0.009, cx + 0.009, cy - h / 2, cy + h / 2, z + 0.008, z + 0.02, TIMBER, skip=POST)
    if transom:
        span(part, cx - w / 2, cx + w / 2, cy - 0.008, cy + 0.008, z + 0.008, z + 0.02, TIMBER, skip=RAIL)
    span(part, cx - w / 2 - 0.02, cx + w / 2 + 0.02, cy - h / 2 - 0.025, cy - h / 2, z, z + 0.045, TIMBER, skip=BACK + ('bottom',))
    if shutters:
        for s in (-1, 1):
            x = cx + s * (w / 2 + 0.042)
            span(part, x - 0.04, x + 0.04, cy - h / 2, cy + h / 2, z, z + 0.016, TURQUOISE, skip=BACK + ('bottom',))


# One shuttered window upstairs under each gable, and a small one in the gable over its collar;
# the lollipop stands between them, under the valley.
for gx in (-GX, GX):
    window(house, gx, 0.84, 0.2, 0.17, ZU, shutters=True)
    window(house, gx, 1.185, 0.11, 0.12, ZU, transom=False)
house.build()

# ---- the roof: the main roof along the street, two cross gables, the chimney ------------------
roof = Part(ASSET, 'roof')
OH, OX = 0.08, 0.05            # the eaves' overhang at the back, and the verges' past the sides
XR = X1 + OX
tp = math.tan(PITCH)
up = Vector((0, math.cos(PITCH), math.sin(PITCH)))      # the front slope's outward normal
# The back slope: from the ridge down past the back wall.
plate(roof, [(-XR, RIDGE, ZM), (XR, RIDGE, ZM), (XR, EAVES - OH * tp, ZB - OH), (-XR, EAVES - OH * tp, ZB - OH)],
      (0, math.cos(PITCH), -math.sin(PITCH)), T, TILES, edges=(1, 2, 3))
# The front slope stops just behind the gables' walls: the two cross gables take the whole
# width of the front, and an eave run on in front of them was a ledge at the foot of each gable.
zf = ZU - 0.02
plate(roof, [(XR, RIDGE, ZM), (-XR, RIDGE, ZM), (-XR, EAVES + (ZU - zf) * tp, zf), (XR, EAVES + (ZU - zf) * tp, zf)],
      up, T, TILES, edges=(1, 2, 3))
# The ridge cap sits a little down into both slopes, so no light shows between it and them.
box(roof, (0, RIDGE + T / math.cos(PITCH) - 0.01, ZM), (2 * XR + 0.02, 0.06, 0.07), RIDGE_TILES)


def valley_z(y):
    """Where the main roof's underside is at height y, on the front slope."""
    return ZU - (y - EAVES) / tp


ZFR = ZU + 0.07                # the cross gables' front edge, past their walls
S45 = math.sqrt(0.5)
for gx in (-GX, GX):
    for side in (-1, 1):
        # One pitch of the gable whose ridge is at x = gx, falling towards `side`. It runs from
        # the ridge to the eave (an outer pitch, over the side wall's line by OX) or to the
        # valley at x = 0 (an inner one, just past it so the two meet), and back from the
        # front edge to where it runs into the main roof - further at the ridge than at the
        # eave, which is the valley's diagonal.
        outer = (gx > 0) == (side > 0)
        run = GW + (OX if outer else 0.012)
        xe, ye = gx + side * run, APEX - run
        zr, ze = valley_z(APEX) - 0.03, (zf if outer else ZU - 0.005)
        quad = [(gx, APEX, ZFR), (xe, ye, ZFR), (xe, ye, ze), (gx, APEX, zr)]
        n = (side * S45, S45, 0)
        # End faces on the front edge and an outer pitch's eave; none under the cap or in a
        # valley, and no underside on an inner pitch, which is the attic's ceiling.
        plate(roof, quad, n, T, TILES, edges=(0, 1) if outer else (0,), bottom=outer)
        # The bargeboard under its front edge, painted cream like the shopfront's trim.
        a, b = Vector((gx, APEX, ZFR - 0.012)), Vector((xe, ye, ZFR - 0.012))
        d = (b - a).normalized()
        if d.x < 0:
            d = -d               # so the board's own +y is the pitch's normal, and its top is under the tiles
        c = (a + b) / 2 - Vector(n) * 0.018
        box(roof, c, ((b - a).length, 0.036, 0.024), CREAM, rz=math.atan2(d.y, d.x), skip=BACK + ('top',))
    box(roof, (gx, APEX + T / S45 - 0.012, (ZFR + valley_z(APEX)) / 2 - 0.01), (0.06, 0.045, ZFR - valley_z(APEX)),
        RIDGE_TILES, skip=('back',))
# Cream bargeboards on the main roof's gable ends too, so the side reads like the front: each
# hangs a little under its rake, flush with the verge.
for s in (-1, 1):
    bx = s * (XR - 0.009)
    for za, ya in ((ZB - OH, EAVES - OH * tp), (zf, EAVES + (ZU - zf) * tp)):
        a, b = Vector((bx, ya - 0.012, za)), Vector((bx, RIDGE - 0.012, ZM))
        d = (b - a).normalized()
        if d.z < 0:
            d = -d
        box(roof, (a + b) / 2, (0.022, 0.04, (b - a).length), CREAM, rx=math.atan2(-d.y, d.z),
            skip=(('left',) if s > 0 else ('right',)) + ('top',))

# The chimney: rough stone astride the ridge towards the right, leaning a little off true, as a
# chimney this old does.
CX, CZ, tilt = 0.5, ZM - 0.04, -0.06
base, top = RIDGE - 0.2, 1.8
stack = rotation(rz=tilt)
mid = Vector((CX, base, CZ)) + stack @ Vector((0, (top - base) / 2, 0))
box(roof, mid, (0.18, top - base, 0.17), CHIMNEY, rz=tilt, skip=('bottom',))
crown = Vector((CX, base, CZ)) + stack @ Vector((0, top - base + 0.02, 0))
box(roof, crown, (0.23, 0.04, 0.22), CHIMNEY, rz=tilt)
pot_a = crown + stack @ Vector((0.015, 0.02, 0))
pot_b = crown + stack @ Vector((0.02, 0.068, 0))
sides = 5
ring = lambda c, r: [c + Vector((r * math.sin(2 * math.pi * (i + .5) / sides), 0, r * math.cos(2 * math.pi * (i + .5) / sides))) for i in range(sides)]
roof.add(ring(pot_a, 0.036) + ring(pot_b, 0.032), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], CHIMNEY)
roof.add(ring(pot_b, 0.032), [list(range(sides))], IRON)     # the flue's black mouth
roof.build()

# ---- the shopfront --------------------------------------------------------------------------
shop = Part(ASSET, 'shopfront')
SILL, HEAD = 0.17, 0.505
WINDOWS = ((-0.765, -0.21), (0.21, 0.765))
for x, w in ((-0.80, 0.08), (-0.175, 0.07), (0.175, 0.07), (0.80, 0.08)):      # pilasters
    span(shop, x - w / 2, x + w / 2, 0.0, HEAD, ZF, ZF + 0.04, CHERRY, skip=BACK + ('top', 'bottom'))
span(shop, X0 - 0.01, X1 + 0.01, HEAD, HEAD + 0.035, ZF, ZF + 0.06, CREAM, skip=BACK)     # cornice
span(shop, X0, X1, HEAD + 0.035, G - 0.02, ZF, ZF + 0.03, CHERRY, skip=BACK + ('bottom',))  # fascia
for x0, x1 in WINDOWS:
    span(shop, x0, x1, 0.02, SILL - 0.02, ZF, ZF + 0.03, CHERRY, skip=BACK + ('bottom',))  # stallriser
    span(shop, x0 + 0.05, x1 - 0.05, 0.05, SILL - 0.05, ZF + 0.03, ZF + 0.036, TURQUOISE, skip=BACK + ('bottom',))
    span(shop, x0 - 0.01, x1 + 0.01, SILL - 0.02, SILL, ZF, ZF + 0.1, CREAM, skip=BACK)   # sill: the lower shelf
    pane(shop, x0, x1, SILL, HEAD, ZF + 0.003, GLASS)
    pane(shop, x0 + 0.025, x1 - 0.025, SILL + 0.02, HEAD - 0.025, ZF + 0.006, WINDOW_GLOW)
    span(shop, x0, x1, 0.31, 0.325, ZF + 0.008, ZF + 0.09, CREAM, skip=BACK)         # the upper shelf
# The door, turquoise, with a lit pane and a brass knob, on a stone step, under a fanlight.
span(shop, -0.14, 0.14, 0.025, 0.475, ZF, ZF + 0.022, TURQUOISE, skip=BACK)
pane(shop, -0.085, 0.085, 0.28, 0.43, ZF + 0.024, GLASS)
pane(shop, -0.065, 0.065, 0.30, 0.41, ZF + 0.027, WINDOW_GLOW)
span(shop, 0.085, 0.11, 0.21, 0.235, ZF + 0.022, ZF + 0.045, BRASS, skip=BACK)
span(shop, -0.14, 0.14, 0.475, HEAD, ZF, ZF + 0.035, CREAM, skip=BACK)
span(shop, -0.2, 0.2, 0.0, 0.025, ZF, ZF + 0.08, STONE, skip=BACK + ('bottom',))

# The awning: seven stripes from under the jetty to a pointed valance, bent once so its front
# drops more steeply than its back, like cloth over a frame. The points of the valance stay
# over 0.55, WALK_CLEARANCE: anything lower is measured as a wall a settler bumps into, and an
# awning that low would have shut the door.
AW = [(ZF + 0.03, 0.665), (ZF + 0.15, 0.62), (ZF + 0.2, 0.597)]    # (z, y) from the wall out
n = 7
w = 1.62 / n
for i in range(n):
    x0, x1 = -0.81 + i * w, -0.81 + (i + 1) * w
    cloth = AWNING_RED if i % 2 == 0 else AWNING_WHITE
    for (za, ya), (zb, yb) in zip(AW, AW[1:]):
        sheet(shop, [(x0, yb, zb), (x1, yb, zb), (x1, ya, za), (x0, ya, za)], cloth)
    z, y = AW[-1]
    shop.add([(x0, y - 0.022, z), ((x0 + x1) / 2, y - 0.04, z), (x1, y - 0.022, z), (x1, y, z), (x0, y, z)], [[0, 1, 2, 3, 4]], cloth)
shop.build()

# ---- what is in the window, and what hangs out front ----------------------------------------
sweets = Part(ASSET, 'sweets')
k = 0
for wi, (x0, x1) in enumerate(WINDOWS):
    for row, y in enumerate((SILL, 0.325)):
        for i in range(3):
            x = x0 + (x1 - x0) * (i + 0.5) / 3
            h = (0.095, 0.08, 0.1, 0.085, 0.075)[(i + row * 2 + wi) % 5]
            r = 0.048 if h < 0.09 else 0.043
            jar(sweets, x, y, ZF + 0.05, r, h, CANDY[(k * 2 + row) % len(CANDY)], LIDS[k % len(LIDS)])
            k += 1

# The lollipop: a swirl disc on a white stick planted in the awning, between the two gables.
# The swirl is twelve wedges, white between colours, each bent round by the same twist at every
# ring - which is all a spiral is.
LX, LY, LZ, LR, LT = 0.0, 0.86, 0.935, 0.125, 0.03
N, RINGS, TWIST = 10, 2, 1.0


def swirl_point(kk, j, z):
    r = LR * j / RINGS
    a = 2 * math.pi * kk / N + TWIST * j / RINGS
    return (LX + r * math.cos(a), LY + r * math.sin(a), z)


front = LZ + LT / 2
for kk in range(N):
    mat = SWIRL_WHITE if kk % 2 else SWIRL[(kk // 2) % len(SWIRL)]
    sweets.add([(LX, LY, front), swirl_point(kk, 1, front), swirl_point(kk + 1, 1, front)], [[0, 1, 2]], mat)
    for j in range(1, RINGS):
        sweets.add([swirl_point(kk, j, front), swirl_point(kk, j + 1, front), swirl_point(kk + 1, j + 1, front), swirl_point(kk + 1, j, front)],
                   [[0, 1, 2, 3]], mat)
rim_f = [swirl_point(kk, RINGS, front) for kk in range(N)]
rim_b = [swirl_point(kk, RINGS, LZ - LT / 2) for kk in range(N)]
# The rim, and no back: the disc's back faces the wall a hand's breadth behind it.
sweets.add(rim_f + rim_b, [[kk, N + kk, N + (kk + 1) % N, (kk + 1) % N] for kk in range(N)], SWIRL_WHITE)
span(sweets, LX - 0.013, LX + 0.013, 0.605, LY - 0.04, LZ - 0.013, LZ + 0.013, SWIRL_WHITE, skip=('bottom', 'back'))
sweets.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(tuple(pot_b + Vector((0, 0.015, 0))))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.1))
ASSET.objects.link(door)

bpy.context.scene['building_height'] = round(max(p.top() for p in (house, roof, shop, sweets)), 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'sweetshop.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'sweetshop'})
