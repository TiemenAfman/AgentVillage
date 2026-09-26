"""The sweet shop. Rebuild with scripts/blender.mjs --background --python scripts/build-sweetshop.py.

A narrow two-storey shop for the village centre's terrace (Plans/knus-dorpscentrum.md): a rough
stone ground floor carrying a painted wooden shopfront in cherry red with cream trim and
turquoise accents, a jettied upper floor of white plaster between dark timbers, and over it two
steep dark slate gables side by side facing the street, with cream bargeboards and a crooked
stone chimney astride one ridge. What makes it a sweet shop from across the square:

    - two display windows either side of a turquoise door, each with two rows of sweet jars
      (the lower row on the sill, the upper on a shelf) whose contents glow at night;
    - a red-and-white candy-striped awning over the whole shopfront, with a pointed valance;
    - a giant swirl lollipop planted on the awning in the middle of the upper floor - the
      shop's sign, and the only one it needs: no lettering, a sign is a picture;
    - a string of coloured bunting under the eaves.

One civic asset, `civic_sweetshop` (budget 1500), nothing that moves. `anchor.door` is at the
foot of the door, which is centred on x because the island's paths arrive at the middle of the
lot's front edge; `anchor.smoke` is on the chimney pot.

It stands in a terrace, so the body spans x -1.40..1.40 and the roof and the bunting stay
inside |x| 1.46: a neighbour stands right beside it. The front of the ground floor is at z 1.00,
the jettied upper floor at 1.10, the awning, the lollipop and the bunting reach 1.40 at most.

Why it is as coarse as it is: the jars are what the triangles go on - twenty of them, each
five-sided (at the size a jar is seen, a dozen pixels on a close look, a sixth side buys
nothing), in two bands: the sweets, and a pale band of clear glass drawing in to the lid.
Drawn as one coloured cylinder a jar read as a tin; the glass band is what makes it a jar.
Anything flat against a wall leaves its back face out (`skip=BACK`), glass and glow are one
quad each, and the ends of roof pitches that meet under a ridge cap or in the valley are not
drawn: nobody ever sees those faces, and two triangles a piece over some sixty pieces is what
paid for the glass bands. The awning's stripes, the bunting and its string are single sheets
with a face each way - the building material culls back faces, and a board drawn as a box
would spend ten triangles on edges a centimetre thick; the valance faces the street only.

The awning is high on purpose: it hangs from under the jetty and ends at y 0.84, because the
island is looked at from 25-35 degrees up and every centimetre an awning projects hides more of
the window below it. Worked out for a front edge at the height of the window head, the upper
row of jars would be hidden from the island's camera altogether; at 0.84 it shows.

Plaster takes the wall sheet, the slates the roof sheet, the stone the stone sheet and the
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


STONE = material('stone', 'sweetshop rubble', 0xa39a8c)
CHIMNEY = material('stone', 'sweetshop chimney', 0x857d72)
PLASTER = material('wall', 'sweetshop plaster', 0xf2eadb)
TIMBER = material('plank', 'sweetshop timber', 0x4a3224)
TIMBER_Z = material('plankZ', 'sweetshop timber', 0x4a3224)
SLATE = material('roof', 'sweetshop slate', 0x4a5463)
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
FLAGS = [material('plain', f'sweetshop flag {n}', c) for n, c in (
    ('pink', 0xff6fb0), ('yellow', 0xffd23f), ('turquoise', 0x26b8c8), ('orange', 0xff9636),
    ('green', 0x6fd65a), ('red', 0xe8283c))]


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


# A box's six faces by the side they face, in its own frame, so a board against a wall can
# leave out the face nobody will ever see.
FACES = {'back': [0, 3, 2, 1], 'front': [4, 5, 6, 7], 'bottom': [0, 1, 5, 4],
         'top': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 4, 7, 3]}
BACK = ('back',)


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, skip=()):
    c, (sx, sy, sz), m = Vector(centre), size, rotation(rx, ry, rz)
    pts = [c + m @ Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [f for k, f in FACES.items() if k not in skip], mat)


def span(part, x0, x1, y0, y1, z0, z1, mat, skip=()):
    """An axis-aligned box by its extents, which is how a shopfront is measured."""
    box(part, ((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), (x1 - x0, y1 - y0, z1 - z0), mat, skip=skip)


def sheet(part, pts, mat):
    """A flat polygon with a face each way: cloth, flags, string. Points counter-clockwise
    seen from the front."""
    part.add(pts, [list(range(len(pts))), list(range(len(pts)))[::-1]], mat)


def pane(part, x0, x1, y0, y1, z, mat):
    """A rectangle facing +z, and nothing else: glass and glow flat on a wall."""
    part.add([(x0, y0, z), (x1, y0, z), (x1, y1, z), (x0, y1, z)], [[0, 1, 2, 3]], mat)


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

X0, X1 = -1.40, 1.40          # the body; the lot edge is 1.50 and a neighbour stands beside it
ZB, ZF, ZU = -1.30, 1.00, 1.10  # back wall, the stone front, the jettied upper floor's front
G, EAVES, RIDGE = 1.00, 1.72, 2.90
GX = 0.70                     # the two front gables: ridges at x = +-GX, the valley between at 0

# ---- the house: stone below, plaster above, the timbers ------------------------------------
house = Part(ASSET, 'house')
span(house, X0, X1, 0, G, ZB, ZF, STONE, skip=('bottom', 'top'))
span(house, X0, X1, G, EAVES, ZB, ZU, PLASTER, skip=('top',))
# The two gable ends on the front, and the same two on the back.
for gx in (-GX, GX):
    house.add([(gx - GX, EAVES, ZU), (gx + GX, EAVES, ZU), (gx, RIDGE, ZU)], [[0, 1, 2]], PLASTER)
    house.add([(gx - GX, EAVES, ZB), (gx + GX, EAVES, ZB), (gx, RIDGE, ZB)], [[2, 1, 0]], PLASTER)
# The jetty: the bressumer the upper floor stands out on, the plate under the gables, the posts
# at the corners and under the valley, and a brace in each outer bay.
span(house, X0, X1, G, G + 0.07, ZU - 0.04, ZU + 0.03, TIMBER, skip=BACK)
span(house, X0, X1, EAVES - 0.06, EAVES, ZU - 0.01, ZU + 0.03, TIMBER, skip=BACK)
for x in (-1.37, 0, 1.37):
    span(house, x - 0.03, x + 0.03, G + 0.07, EAVES - 0.06, ZU, ZU + 0.03, TIMBER, skip=BACK)
lean = math.atan2(0.22, EAVES - G - 0.13)
for s in (-1, 1):
    box(house, (s * 1.23, (G + EAVES) / 2, ZU + 0.013), (0.05, math.hypot(0.22, EAVES - G - 0.13), 0.026), TIMBER, rz=s * lean, skip=BACK)
# Nothing on the sides: in a terrace a neighbour stands against each of them.


def window(part, cx, cy, w, h, z, shutters=False, transom=True):
    i = 0.035
    pane(part, cx - w / 2, cx + w / 2, cy - h / 2, cy + h / 2, z + 0.003, GLASS)
    pane(part, cx - w / 2 + i, cx + w / 2 - i, cy - h / 2 + i, cy + h / 2 - i, z + 0.006, WINDOW_GLOW)
    span(part, cx - 0.012, cx + 0.012, cy - h / 2, cy + h / 2, z + 0.01, z + 0.028, TIMBER, skip=BACK)
    if transom:
        span(part, cx - w / 2, cx + w / 2, cy - 0.011, cy + 0.011, z + 0.01, z + 0.028, TIMBER, skip=BACK)
    span(part, cx - w / 2 - 0.03, cx + w / 2 + 0.03, cy - h / 2 - 0.035, cy - h / 2, z, z + 0.06, TIMBER, skip=BACK)
    if shutters:
        for s in (-1, 1):
            x = cx + s * (w / 2 + 0.07)
            span(part, x - 0.062, x + 0.062, cy - h / 2, cy + h / 2, z, z + 0.022, TURQUOISE, skip=BACK)


# A column of two windows under each gable - shuttered on the upper floor, a small one in the
# gable over a collar - and the lollipop between the columns, under the valley.
for gx in (-GX, GX):
    window(house, gx * 1.03, 1.29, 0.36, 0.32, ZU, shutters=True)
    window(house, gx, 2.1, 0.24, 0.28, ZU, transom=False)
    cy = 2.45
    cw = GX * (RIDGE - cy) / (RIDGE - EAVES)
    span(house, gx - cw, gx + cw, cy - 0.025, cy + 0.025, ZU, ZU + 0.03, TIMBER, skip=BACK)
house.build()

# ---- the roof: two steep gables side by side, the chimney ----------------------------------
# The roofline is the one thing a street of these shops tells apart from across the square: the
# neighbours have a ridge along the street with one cross gable, so this one turns its ridges
# the other way and shows the street two gables, a scalloped silhouette over a sweet shop.
# Each pitch is 59 degrees, because a gable only 1.4 across has to be steep to be tall.
roof = Part(ASSET, 'roof')
T = 0.05
rise = RIDGE - EAVES
pitch = math.atan2(rise, GX)
slope = math.hypot(GX, rise)
ZF_R, ZB_R = ZU + 0.08, ZB - 0.06     # the pitches' front and back edges, past the gable walls


def gable_pitch(part, gx, side, s1, skip=()):
    """One pitch of the gable whose ridge is at x = gx, falling towards `side` (+1 is +x) from
    just past the ridge to s1 along the slope. The box's local +x runs down the slope on a
    pitch falling towards +x and up it on one falling towards -x, so its ridge end is local
    'left' on the first and 'right' on the second - and that end is under the ridge cap."""
    d = Vector((side * GX / slope, -rise / slope, 0))
    n = Vector((side * rise / slope, GX / slope, 0))
    s0 = -0.03
    c = Vector((gx, RIDGE, (ZF_R + ZB_R) / 2)) + d * ((s0 + s1) / 2) + n * (T / 2)
    box(part, c, (s1 - s0, T, ZF_R - ZB_R), SLATE, rz=-side * pitch, skip=(('left',) if side > 0 else ('right',)) + tuple(skip))
    # The bargeboard under its front edge, painted cream like the shopfront's trim: it is what
    # draws the scallop against the sky.
    bc = Vector((gx, RIDGE, 0)) + d * ((s0 + s1) / 2) - n * 0.02
    box(part, (bc.x, bc.y, ZF_R - 0.02), (s1 - s0, 0.055, 0.03), CREAM, rz=-side * pitch, skip=BACK)


for gx in (-GX, GX):
    out = 1 if gx > 0 else -1
    gable_pitch(roof, gx, out, slope + 0.03)
    # The inner pitch runs just past the valley and under its neighbour, so its low end is
    # never seen either, nor its underside, which is the attic's ceiling.
    gable_pitch(roof, gx, -out, slope + 0.03, skip=(('right',) if -out > 0 else ('left',)) + ('bottom',))
    box(roof, (gx, RIDGE + T / math.cos(pitch) - 0.012, (ZF_R + ZB_R) / 2 + 0.01), (0.1, 0.05, ZF_R - ZB_R + 0.02), SLATE)
# The chimney: rough stone astride the right gable's ridge, leaning a little off true, as a
# chimney this old does.
CX, CZ, tilt = GX + 0.02, -0.62, -0.07
base, top = 2.55, 3.13
stack = rotation(rz=tilt)
mid = Vector((CX, base, CZ)) + stack @ Vector((0, (top - base) / 2, 0))
box(roof, mid, (0.24, top - base, 0.22), CHIMNEY, rz=tilt, skip=('bottom',))
crown = Vector((CX, base, CZ)) + stack @ Vector((0, top - base + 0.03, 0))
box(roof, crown, (0.3, 0.06, 0.28), CHIMNEY, rz=tilt)
pot_a = crown + stack @ Vector((0.03, 0.03, 0))
pot_b = crown + stack @ Vector((0.035, 0.12, 0))
sides = 5
ring = lambda c, r: [c + Vector((r * math.sin(2 * math.pi * (i + .5) / sides), 0, r * math.cos(2 * math.pi * (i + .5) / sides))) for i in range(sides)]
roof.add(ring(pot_a, 0.05) + ring(pot_b, 0.045), [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)], CHIMNEY)
roof.add(ring(pot_b, 0.045), [list(range(sides))], IRON)     # the flue's black mouth
roof.build()

# ---- the shopfront --------------------------------------------------------------------------
shop = Part(ASSET, 'shopfront')
SILL, HEAD = 0.28, 0.74
WINDOWS = ((-1.24, -0.31), (0.31, 1.24))
for x in (-1.29, -0.26, 0.26, 1.29):                     # pilasters
    span(shop, x - 0.05, x + 0.05, 0.0, HEAD, ZF, ZF + 0.06, CHERRY, skip=BACK)
span(shop, -1.36, 1.36, HEAD, HEAD + 0.05, ZF, ZF + 0.085, CREAM, skip=BACK)     # cornice
span(shop, -1.34, 1.34, HEAD + 0.05, 0.97, ZF, ZF + 0.045, CHERRY, skip=BACK)    # fascia
for x0, x1 in WINDOWS:
    span(shop, x0, x1, 0.03, SILL - 0.03, ZF, ZF + 0.045, CHERRY, skip=BACK)     # stallriser
    span(shop, x0 + 0.06, x1 - 0.06, 0.075, SILL - 0.075, ZF + 0.045, ZF + 0.055, TURQUOISE, skip=BACK)
    span(shop, x0 - 0.01, x1 + 0.01, SILL - 0.03, SILL, ZF, ZF + 0.13, CREAM, skip=BACK)  # sill: the lower shelf
    pane(shop, x0, x1, SILL, HEAD, ZF + 0.003, GLASS)
    pane(shop, x0 + 0.035, x1 - 0.035, SILL + 0.03, HEAD - 0.035, ZF + 0.006, WINDOW_GLOW)
    span(shop, x0, x1, 0.465, 0.485, ZF + 0.012, ZF + 0.12, CREAM, skip=BACK)     # the upper shelf
# The door, turquoise, with a lit pane and a brass knob, on a stone step.
span(shop, -0.21, 0.21, 0.035, 0.66, ZF, ZF + 0.03, TURQUOISE, skip=BACK)
pane(shop, -0.12, 0.12, 0.38, 0.6, ZF + 0.032, GLASS)
pane(shop, -0.095, 0.095, 0.405, 0.575, ZF + 0.035, WINDOW_GLOW)
span(shop, 0.125, 0.155, 0.32, 0.35, ZF + 0.03, ZF + 0.06, BRASS, skip=BACK)
span(shop, -0.21, 0.21, 0.66, HEAD, ZF, ZF + 0.05, CREAM, skip=BACK)
span(shop, -0.3, 0.3, 0.0, 0.035, ZF, ZF + 0.13, STONE, skip=BACK + ('bottom',))

# The awning: eleven stripes from under the jetty to a pointed valance, bent once so its front
# drops more steeply than its back, like cloth over a frame.
AW = [(1.03, 0.985), (1.30, 0.905), (1.40, 0.845)]    # (z, y) from the wall out
n = 11
w = 2.64 / n
for i in range(n):
    x0, x1 = -1.32 + i * w, -1.32 + (i + 1) * w
    cloth = AWNING_RED if i % 2 == 0 else AWNING_WHITE
    for (za, ya), (zb, yb) in zip(AW, AW[1:]):
        sheet(shop, [(x0, yb, zb), (x1, yb, zb), (x1, ya, za), (x0, ya, za)], cloth)
    z, y = AW[-1]
    shop.add([(x0, y - 0.05, z), ((x0 + x1) / 2, y - 0.085, z), (x1, y - 0.05, z), (x1, y, z), (x0, y, z)], [[0, 1, 2, 3, 4]], cloth)
span(shop, -1.33, 1.33, 0.975, 1.0, ZF, ZF + 0.05, CREAM, skip=BACK)
shop.build()

# ---- what is in the window, and what hangs out front ----------------------------------------
sweets = Part(ASSET, 'sweets')
k = 0
for wi, (x0, x1) in enumerate(WINDOWS):
    for row, y in enumerate((SILL, 0.485)):
        for i in range(5):
            x = x0 + (x1 - x0) * (i + 0.5) / 5
            h = (0.11, 0.09, 0.12, 0.1, 0.085)[(i + row * 2 + wi) % 5]
            r = 0.047 if h < 0.1 else 0.042
            jar(sweets, x, y, ZF + 0.065, r, h, CANDY[(k * 2 + row) % len(CANDY)], LIDS[k % len(LIDS)])
            k += 1

# The lollipop: a swirl disc on a white stick planted in the awning, in the middle of the upper
# floor. The swirl is twelve wedges, white between colours, each bent round by the same twist
# at every ring - which is all a spiral is.
LX, LY, LZ, LR, LT = 0.0, 1.33, 1.25, 0.215, 0.045
N, RINGS, TWIST = 12, 3, 1.1


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
span(sweets, LX - 0.018, LX + 0.018, 0.912, LY - 0.05, LZ - 0.018, LZ + 0.018, SWIRL_WHITE, skip=('bottom', 'back'))

# Bunting under the eaves: a string sagging from corner to corner and a pennant every so often,
# skipping the few the lollipop would hide.
BZ, BTOP, SAG = ZU + 0.06, 1.61, 0.075


def string_y(x):
    return BTOP - SAG * (1 - (x / 1.36) ** 2)


xs = [-1.36 + 2.72 * i / 6 for i in range(7)]
for xa, xb in zip(xs, xs[1:]):
    ya, yb = string_y(xa), string_y(xb)
    sheet(sweets, [(xa, ya - 0.007, BZ), (xb, yb - 0.007, BZ), (xb, yb + 0.007, BZ), (xa, ya + 0.007, BZ)], CREAM)
f = 0
for i in range(15):
    x = -1.26 + 2.52 * i / 14
    if abs(x) < LR + 0.02:
        continue
    fw, fh = 0.075, 0.095
    sheet(sweets, [(x - fw / 2, string_y(x - fw / 2), BZ + 0.004), (x, string_y(x) - fh, BZ + 0.004), (x + fw / 2, string_y(x + fw / 2), BZ + 0.004)],
          FLAGS[f % len(FLAGS)])
    f += 1
sweets.build()

smoke = bpy.data.objects.new('anchor.smoke', None)
smoke.location = xyz(tuple(pot_b + Vector((0, 0.02, 0))))
ASSET.objects.link(smoke)
door = bpy.data.objects.new('anchor.door', None)
door.location = xyz((0, 0, ZF + 0.1))
ASSET.objects.link(door)

bpy.context.scene['building_height'] = round(max(p.top() for p in (house, roof, shop, sweets)), 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'sweetshop.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'sweetshop'})
