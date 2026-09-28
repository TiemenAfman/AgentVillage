"""The shipyard, with the Batavia on its stocks. Rebuild with

    node scripts/blender.mjs --background --python scripts/build-shipyard.py

It writes assets/shipyard/shipyard.blend and bakes it to web/js/shipyard-mesh.js. Running it
again replaces both, so edits made by hand in the .blend are lost: this script is the source.

A VOC yard in the manner of the Oostenburg one in Amsterdam (Plans/scheepswerf.md): a timber
slipway (helling) running down into the water on piles, keel blocks along it, a tarred shed
(loods) and a pair of sheerlegs (bok) at the landward end, timber and planks stacked beside
them and a tar kettle on its hearth. On the slipway the yard builds a ship in stages, and the
stage is a number the islander writes on the building record (`spec.stage`, 0 to 4):

    0  empty stocks: the slipway and its keel blocks
    1  the keel laid, the stem and the sternpost raised and braced
    2  the frames (spanten) standing on the keel, held by ribbands, with the transom framed
       and the deck beams across
    3  the hull planked: bottom, wales, topsides, the flat transom, the decks
    4  the lower masts stepped - no rigging and no sails yet

**One hero asset, not five civic ones.** Every part is baked into the one asset `shipyard`,
and buildings.js picks what a stage shows by the part's name: a part called
`shipyard s<a>-<b> <what>` is drawn at stages a to b, and a part with no such token is the
yard itself and always drawn. The stages cannot be assets of their own, and it is the ground
rule that says so rather than taste: scripts/model-rules.mjs holds every asset's lowest point
to y = 0, and a keel laid on blocks halfway up a slipway, or a mast stepped on it, is nowhere
near the pile feet the set stands on. A hero is measured as a whole, and that is exactly the
honest reading here - it is one building, drawn once on an island, whose ship is part of it.
The whole set is inside HERO_BUDGET; what one stage draws is well under it.

**Modelled in one frame, like the docks.** y = 0 is the feet of the piles, which is the
lowest thing in the set and what the ground rule wants. The yard's own datum is LAND above
it: the ground under the shed, which is the highest ground of the six land rows once it
stands on the island (the slipway's head stands a little proud of it on its bed). The island
lowers the model by LAND (buildings.js reads LAND off the baked origin of `shipyard slipway`,
so this file is the one copy) and main.js stands the group on the land of the landward rows
(web/js/shipyard.js shipyardGround), not on the seabed the middle of a 16-long lot is over.

**The lot is 5 by 16**, x across and z along, perpendicular to the coast. The front of the
model (+z on the island, -Y in Blender) is the SEA end, because that is where a slipway
goes: the landward six rows carry the shed, the sheerlegs and the stacks, and the slipway
runs down the rest into the water. The ship is built stern to the sea, as ships were - they
were launched stern first, because the stern is the fuller end and lifts first, and a bow
that dips before the ship is afloat can dig in and trip the launch.

The hull is modelled to the numbers of the finished Batavia (Plans/mijlpalen-tot-
tweehonderd.md, "Het VOC-schip"): about 12 long at the waterline, 2.8 in the beam, a main
deck 1.1 above where her waterline will be, a high stern with a flat transom, and lower masts
reaching about 7.7 above the keel. On the stocks there is no waterline, so the bottom is
paid with the pale stuff the Batavia replica wears below it, and the join of the pale and the
tarred brown is where she will float - which is also what tests/shipyard.test.mjs measures
the length at. She lies on the ways at their own declivity, 1 in 24, as a keel is laid.

Written in island coordinates (x right, y up, z to the front) through xyz(); the ship is
drawn in a frame of her own - x across, y up from the bottom of the keel, z aft - and turned
onto the slipway by ship().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/shipyard'
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
    m['emissive'] = 1.0 if emissive else 0.0
    return m


# The colours. The yard is tarred timber and red pantiles under a white fascia, which is what
# a Dutch yard shed is; the slipway is weathered oak with its ways dark with grease; the ship
# is fresh oak where she is still a skeleton, and, planked, tarred brown above her waterline
# with black wales and pale below it.
SLIP = material('plank', 'slip deck', 0x9a7450)
WAYS = material('plankZ', 'greased ways', 0x4a3524)
BLOCK = material('plank', 'keel block', 0x7c5838)
BLOCK_DARK = material('plank', 'keel block old', 0x5e4128)
PILE = material('plank', 'yard pile', 0x5a3c28)
CAP = material('plankZ', 'pile cap', 0x6b4a2f)
BED = material('stone', 'slip bed', 0x8d8577)
TAR_WALL = material('plank', 'tarred boards', 0x3a3430)
TILES = material('roof', 'pantiles', 0xa4533a)
FASCIA = material('plank', 'white fascia', 0xe6ddc8)
PLINTH = material('stone', 'shed plinth', 0x8d8577)
INSIDE = material('plain', 'shed inside', 0x2a211b)
GLASS = material('plain', 'lantern glass', 0xffd27f, emissive=True)
IRON = material('plain', 'yard iron', 0x3a3a3f)
BARK = material('plain', 'log bark', 0x6e4a2e)
GRAIN = material('plain', 'log end grain', 0xd4a36a)
BOARDS = material('plank', 'fresh planks', 0xd2a26e)
SPAR = material('plank', 'sheerleg spar', 0x8b6a45)
ROPE = material('plain', 'yard rope', 0xb9a37e)
BRICK = material('stone', 'hearth brick', 0x9c5a44)
EMBERS = material('plain', 'embers', 0xff7a2a, emissive=True)
PITCH = material('plain', 'tar', 0x1c1714)
OAK = material('plankZ', 'keel oak', 0x7a5232)
TIMBER = material('plank', 'frame oak', 0xa27a4e)
TIMBER_Z = material('plankZ', 'ribband oak', 0xa27a4e)
BOTTOM = material('plankZ', 'white stuff', 0xd8cfb4)
HULL = material('plankZ', 'tarred strakes', 0x5a3f2c)
WALE = material('plankZ', 'wales', 0x2e2620)
DECK = material('plankZ', 'deck planks', 0xb08a5c)
TRANSOM = material('plank', 'transom', 0x6b4a32)
WINDOW = material('plain', 'stern windows', 0x2b2a2e)
MAST = material('plank', 'mast', 0x9a7a52)
TOP = material('plank', 'mast top', 0x6e5034)


# ---------------------------------------------------------------- building blocks
def newell(pts):
    """A polygon's normal by its winding: counter-clockwise seen from where it points."""
    n = Vector((0, 0, 0))
    for i, a in enumerate(pts):
        b = pts[(i + 1) % len(pts)]
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


class Part:
    """One Blender object: faces around its own origin, one material slot per face.

    `poly` orients a face by a direction it must face, because the island draws a building
    single-sided and a face wound the wrong way is not a dark face but a hole - and a hull is
    two hundred faces whose winding nobody wants to work out by hand.
    """

    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = f'shipyard {name}', Vector(origin)
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

    def poly(self, points, mat, out):
        pts = [Vector(p) for p in points]
        if newell(pts).dot(Vector(out)) < 0:
            pts.reverse()
        self.add(pts, [list(range(len(pts)))], mat)

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
        bpy.context.scene.collection.objects.link(obj)
        return obj


# The six faces of a hexahedron given as eight corners in this order - bottom then top, back
# (-z) then front (+z) - and which of them a caller may leave out because nothing ever sees it.
#   0 x0 y0 z0   1 x1 y0 z0   2 x1 y1 z0   3 x0 y1 z0
#   4 x0 y0 z1   5 x1 y0 z1   6 x1 y1 z1   7 x0 y1 z1
HEXA = {'back': [0, 3, 2, 1], 'front': [4, 5, 6, 7], 'bottom': [0, 1, 5, 4],
        'top': [2, 3, 7, 6], 'right': [1, 2, 6, 5], 'left': [0, 4, 7, 3]}


def hexa(part, pts, mat, omit=()):
    part.add(pts, [f for k, f in HEXA.items() if k not in omit], mat)


def box(part, lo, hi, mat, omit=()):
    (x0, y0, z0), (x1, y1, z1) = lo, hi
    hexa(part, [(x0, y0, z0), (x1, y0, z0), (x1, y1, z0), (x0, y1, z0),
                (x0, y0, z1), (x1, y0, z1), (x1, y1, z1), (x0, y1, z1)], mat, omit)


def basis(d):
    d = d.normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    return u, d.cross(u).normalized()


def rod(part, a, b, r, mat, sides=4, r1=None, caps=(False, False), turn=0.0, cap_mat=None):
    """A prism from a to b, tapering from r to r1, each face turned to face away from its axis.
    Its ends are left open unless `caps` says otherwise, in `cap_mat` if that is given - end
    grain on a log, the same timber on a post."""
    a, b = Vector(a), Vector(b)
    r1 = r if r1 is None else r1
    u, v = basis(b - a)
    ring = lambda c, rr: [c + (u * math.cos(t) + v * math.sin(t)) * rr
                          for t in (2 * math.pi * i / sides + turn for i in range(sides))]
    ra, rb = ring(a, r), ring(b, r1)
    for i in range(sides):
        j = (i + 1) % sides
        quad = [ra[i], ra[j], rb[j], rb[i]]
        mid = sum(quad, Vector()) / 4
        axis = a + (b - a) * ((mid - a).dot(b - a) / (b - a).length_squared)
        part.poly(quad, mat, mid - axis)
    if caps[0]:
        part.poly(ra, cap_mat or mat, a - b)
    if caps[1]:
        part.poly(rb, cap_mat or mat, b - a)


def lerp(table, x):
    """Piecewise linear through (x, y) pairs, flat beyond either end."""
    if x <= table[0][0]:
        return table[0][1]
    for (x0, y0), (x1, y1) in zip(table, table[1:]):
        if x <= x1:
            return y0 + (y1 - y0) * (x - x0) / (x1 - x0)
    return table[-1][1]


# ---------------------------------------------------------------- the yard's frame
# One cell is one unit is four metres. The lot is x -2.5..2.5 and z -8..8, and its middle is
# the origin, which is what main.js centres on the plot.
LAND = 1.90            # the yard's datum over the pile feet: the ground at the landward end
HALF_W, HALF_L = 2.5, 8.0

# The slipway. It falls 1 in 24 - the declivity a keel is laid at - from its head to a knee
# under the ship's stern, where it tips into the water as the afloop. A real slipway runs on at
# its own declivity well out under the water; a lot of sixteen cannot hold that and a dry keel
# both, so the last cell and a bit goes down steeply instead, far enough that its toe is under
# the sea for any land the site rule will stand the yard on.
#
# Its head stands proud of the ground on its stone bed, by as much as the declivity falls over
# the six land rows: the yard is stood on the highest ground of those rows (shipyardGround), so
# a slipway whose head was at the ground went under a flat field two rows before the beach -
# measured on the studio's own flat land, the keel blocks at z -3 stood in the grass. Raised,
# it is a hand over the datum where the land rows end and above it everywhere behind that.
HEAD_Z, KNEE_Z, TOE_Z = -5.9, 6.7, 8.0
LAND_END = -HALF_L + 6          # where the six land rows end
DECLIVITY = 1 / 24
HEAD_Y = LAND + 0.06 + (LAND_END - HEAD_Z) * DECLIVITY
KNEE_Y = HEAD_Y - (KNEE_Z - HEAD_Z) * DECLIVITY
TOE_Y = LAND - 1.25
SLIP_W = 1.75          # half its width: room for a shore's foot beside a 2.8 beam
SLIP_T = 0.12


def slip_top(z):
    if z <= KNEE_Z:
        return HEAD_Y - (z - HEAD_Z) * DECLIVITY
    return KNEE_Y + (z - KNEE_Z) * (TOE_Y - KNEE_Y) / (TOE_Z - KNEE_Z)


# The ship's frame, and where it lies on the slipway: her keel's midship point sits BLOCK_H
# over the slipway at SHIP_Z, and she is turned by the declivity so the keel lies parallel to
# the ways - stern down towards the water.
BLOCK_H = 0.26
SHIP_Z = 0.73
TILT = math.atan(DECLIVITY)
KEEL_Y0 = slip_top(SHIP_Z) + BLOCK_H
COS, SIN = math.cos(TILT), math.sin(TILT)


def ship(p):
    """Ship coordinates (x across, y up from the keel's bottom, z aft) onto the slipway."""
    x, y, z = p
    return Vector((x, KEEL_Y0 + y * COS - z * SIN, SHIP_Z + z * COS + y * SIN))


def keel_line(z):
    """How high the bottom of the keel is over the slipway's own z: parallel to the ways."""
    return KEEL_Y0 - (z - SHIP_Z) * DECLIVITY


# ---------------------------------------------------------------- the slipway (always)
slip = Part('slipway', (0, LAND, 0))
# The deck of the slipway, in two slabs meeting at the knee: the long bed the ship is built on
# and the afloop into the water. Their faces at the knee are the same face and neither is kept.
for z0, z1, omit in ((HEAD_Z, KNEE_Z, ('front',)), (KNEE_Z, TOE_Z, ('back',))):
    a, b = slip_top(z0), slip_top(z1)
    hexa(slip, [(-SLIP_W, a - SLIP_T, z0), (SLIP_W, a - SLIP_T, z0), (SLIP_W, a, z0), (-SLIP_W, a, z0),
                (-SLIP_W, b - SLIP_T, z1), (SLIP_W, b - SLIP_T, z1), (SLIP_W, b, z1), (-SLIP_W, b, z1)], SLIP, omit)
slip.build()

ways = Part('ways', (0, LAND, 0))
# The two ground ways the cradle will slide down, the whole length of the slipway and into the
# water - which is what says, from across the harbour, that this is a slipway and not a jetty.
for x in (-0.78, 0.78):
    for z0, z1, omit in ((HEAD_Z, KNEE_Z, ('front', 'bottom')), (KNEE_Z, TOE_Z, ('back', 'bottom'))):
        a, b = slip_top(z0), slip_top(z1)
        hexa(ways, [(x - 0.09, a, z0), (x + 0.09, a, z0), (x + 0.09, a + 0.05, z0), (x - 0.09, a + 0.05, z0),
                    (x - 0.09, b, z1), (x + 0.09, b, z1), (x + 0.09, b + 0.05, z1), (x - 0.09, b + 0.05, z1)], WAYS, omit)
ways.build()

bed = Part('bed', (0, LAND, 0))
# On land the slipway lies on a bed of stone, which reaches down far enough that a beach falling
# away towards the water never opens a gap you can see under. Where the land gives out, piles.
BED_END = -1.6
BED_FOOT = LAND - 0.8
a, b = slip_top(HEAD_Z) - SLIP_T, slip_top(BED_END) - SLIP_T
hexa(bed, [(-SLIP_W + 0.04, BED_FOOT, HEAD_Z + 0.02), (SLIP_W - 0.04, BED_FOOT, HEAD_Z + 0.02),
           (SLIP_W - 0.04, a, HEAD_Z + 0.02), (-SLIP_W + 0.04, a, HEAD_Z + 0.02),
           (-SLIP_W + 0.04, BED_FOOT, BED_END), (SLIP_W - 0.04, BED_FOOT, BED_END),
           (SLIP_W - 0.04, b, BED_END), (-SLIP_W + 0.04, b, BED_END)], BED, ('top', 'bottom'))
bed.build()

piles = Part('piles', (0, 0, 0))
# Seven rows of two, from where the bed stops to under the toe, each with a cap beam across under
# the deck. Four-sided and open-ended: the heads are under the caps and the feet in the sea.
for z in (-0.8, 0.8, 2.4, 4.0, 5.6, 7.0, 7.8):
    under = slip_top(z) - SLIP_T
    box(piles, (-SLIP_W + 0.03, under - 0.10, z - 0.06), (SLIP_W - 0.03, under, z + 0.06), CAP, ('top',))
    for x in (-1.52, 1.52):
        rod(piles, (x, 0, z), (x, under - 0.10, z), 0.065, PILE, sides=4, turn=math.pi / 4)
piles.build()

blocks = Part('blocks', (0, LAND, 0))
# The keel blocks, a stack under every metre of keel with its top on the line the keel will lie
# on, old and new timber by turns. The stocks are what the yard is when there is no ship.
for i in range(11):
    z = -4.35 + i * 1.07
    mat = BLOCK if i % 2 else BLOCK_DARK
    lo, hi = slip_top(z - 0.09), slip_top(z + 0.09)
    klo, khi = keel_line(z - 0.09), keel_line(z + 0.09)
    hexa(blocks, [(-0.13, lo, z - 0.09), (0.13, lo, z - 0.09), (0.13, klo, z - 0.09), (-0.13, klo, z - 0.09),
                  (-0.13, hi, z + 0.09), (0.13, hi, z + 0.09), (0.13, khi, z + 0.09), (-0.13, khi, z + 0.09)], mat, ('bottom',))
blocks.build()

# ---------------------------------------------------------------- the shed (always)
# Tarred boards, red pantiles, a white fascia: open along its front towards the slipway, as a
# timber shed is, so the planks stacked inside to season can be seen from the ways. It stands on
# the landward end on the port side, with its ridge across the lot; the gate is on the other
# side, at the end of the strip that runs along the ship to the water (anchor.door).
SX0, SX1, SZ0, SZ1 = -2.36, -0.38, -7.86, -6.40
EAVES, RIDGE = LAND + 1.0, LAND + 1.52
FLOOR = LAND + 0.08
plinth = Part('shed plinth', (0, LAND, 0))
box(plinth, (SX0 - 0.03, LAND - 0.5, SZ0 - 0.03), (SX1 + 0.03, FLOOR, SZ1 + 0.03), PLINTH, ('bottom',))
plinth.build()

shed = Part('shed', (0, LAND, 0))
T = 0.04
box(shed, (SX0, FLOOR, SZ0), (SX1, EAVES, SZ0 + T), TAR_WALL)                   # the back wall
for x0, x1 in ((SX0, SX0 + T), (SX1 - T, SX1)):
    box(shed, (x0, FLOOR, SZ0 + T), (x1, EAVES, SZ1), TAR_WALL)                  # the two ends
    # and their gables, a prism of boards between the eaves and the ridge
    mid = (SZ0 + SZ1) / 2
    tri = lambda x: [(x, EAVES, SZ0), (x, EAVES, SZ1), (x, RIDGE, mid)]
    a, b = tri(x0), tri(x1)
    shed.poly(a, TAR_WALL, (-1, 0, 0))
    shed.poly(b, TAR_WALL, (1, 0, 0))
    shed.poly([a[0], a[2], b[2], b[0]], TAR_WALL, (0, 0.5, -1))
    shed.poly([a[1], b[1], b[2], a[2]], TAR_WALL, (0, 0.5, 1))
# The posts and the lintel of the open front.
for x in (SX0 + 0.05, (SX0 + SX1) / 2, SX1 - 0.05):
    rod(shed, (x, FLOOR, SZ1 - 0.04), (x, EAVES - 0.08, SZ1 - 0.04), 0.035, TAR_WALL, sides=4, turn=math.pi / 4)
box(shed, (SX0, EAVES - 0.1, SZ1 - 0.08), (SX1, EAVES, SZ1), TAR_WALL, ('top',))
shed.build()

roof = Part('shed roof', (0, LAND, 0))
# Two pitches with a hand's width of overhang all round, and the ridge capped.
OH = 0.12
mid = (SZ0 + SZ1) / 2
for zs, ze in ((SZ0 - OH, mid), (SZ1 + OH, mid)):
    ye = EAVES - OH * (RIDGE - EAVES) / (mid - SZ0)
    lo = [(SX0 - OH, ye, zs), (SX1 + OH, ye, zs), (SX1 + OH, RIDGE, ze), (SX0 - OH, RIDGE, ze)]
    hi = [(x, y + 0.05, z) for x, y, z in lo]
    out = (0, 1, -1 if zs < mid else 1)
    roof.poly(hi, TILES, out)
    roof.poly(lo, TILES, (0, -1, 0))
    roof.poly([lo[0], lo[1], hi[1], hi[0]], TILES, (0, 0, -1 if zs < mid else 1))
    roof.poly([lo[0], hi[0], hi[3], lo[3]], TILES, (-1, 0, 0))
    roof.poly([lo[1], lo[2], hi[2], hi[1]], TILES, (1, 0, 0))
roof.poly([(SX0 - OH, RIDGE + 0.05, mid - 0.05), (SX1 + OH, RIDGE + 0.05, mid - 0.05),
           (SX1 + OH, RIDGE + 0.09, mid), (SX0 - OH, RIDGE + 0.09, mid)], TILES, (0, 1, -1))
roof.poly([(SX0 - OH, RIDGE + 0.05, mid + 0.05), (SX1 + OH, RIDGE + 0.05, mid + 0.05),
           (SX1 + OH, RIDGE + 0.09, mid), (SX0 - OH, RIDGE + 0.09, mid)], TILES, (0, 1, 1))
# The white fascia along the front eaves: the one line that says Holland from across the water.
ye = EAVES - OH * (RIDGE - EAVES) / (mid - SZ0)
box(roof, (SX0 - OH, ye - 0.07, SZ1 + OH - 0.02), (SX1 + OH, ye + 0.02, SZ1 + OH + 0.01), FASCIA, ('top', 'back'))
roof.build()

store = Part('shed store', (0, LAND, 0))
# The dark of the inside, and the planks drying in it on their stickers.
box(store, (SX0 + T, FLOOR, SZ0 + T), (SX1 - T, FLOOR + 0.01, SZ1), INSIDE, ('bottom',))
box(store, (SX0 + T, FLOOR, SZ0 + T + 0.002), (SX1 - T, EAVES, SZ0 + T + 0.006), INSIDE, ('back', 'top', 'bottom'))
for i, (x0, x1, h) in enumerate(((SX0 + 0.12, SX0 + 0.95, 0.36), (SX0 + 1.05, SX1 - 0.14, 0.24))):
    box(store, (x0, FLOOR, SZ0 + 0.14), (x1, FLOOR + h, SZ1 - 0.30), BOARDS, ('bottom',))
store.build()

lantern = Part('shed lantern', (SX1 - 0.02, LAND + 0.86, SZ1 + 0.10))
# A lantern on an iron bracket off the corner post towards the slipway, lit after dark.
LX, LY, LZ = SX1 - 0.02, LAND + 0.86, SZ1 + 0.10
box(lantern, (LX - 0.015, LY + 0.14, SZ1 - 0.06), (LX + 0.015, LY + 0.17, LZ + 0.02), IRON)
box(lantern, (LX - 0.045, LY - 0.06, LZ - 0.045), (LX + 0.045, LY + 0.06, LZ + 0.045), GLASS, ('top',))
lantern.poly([(LX - 0.06, LY + 0.06, LZ - 0.06), (LX + 0.06, LY + 0.06, LZ - 0.06),
              (LX + 0.06, LY + 0.06, LZ + 0.06), (LX - 0.06, LY + 0.06, LZ + 0.06)], IRON, (0, -1, 0))
for a, b in (((-1, -1), (1, -1)), ((1, -1), (1, 1)), ((1, 1), (-1, 1)), ((-1, 1), (-1, -1))):
    lantern.poly([(LX + a[0] * 0.06, LY + 0.06, LZ + a[1] * 0.06), (LX + b[0] * 0.06, LY + 0.06, LZ + b[1] * 0.06),
                  (LX, LY + 0.14, LZ)], IRON, (a[0] + b[0], 0.5, a[1] + b[1]))
lantern.build()

# ---------------------------------------------------------------- timber and planks (always)
# Across the gap from the shed: logs for the saw and planks off it, each a pile a settler
# walks round, with the strip to the gate beyond them.
logs = Part('logs', (0, LAND, 0))
for row, xs in enumerate(((0.52, 0.80, 1.08), (0.66, 0.94), (0.80,))):
    for i, x in enumerate(xs):
        y = LAND + 0.13 + row * 0.235
        rod(logs, (x, y, -7.86), (x, y, -6.52 - 0.05 * ((i + row) % 2)), 0.13, BARK, sides=6,
            caps=(True, True), cap_mat=GRAIN, turn=(i + row) * 0.4)
logs.build()

planks = Part('planks', (0, LAND, 0))
# A stack of sawn planks on stickers, each course a little off the one under it.
for k in range(4):
    y0 = LAND + 0.04 + k * 0.085
    dx = 0.02 * (k % 2)
    box(planks, (1.30 + dx, y0, -7.88), (1.74 + dx, y0 + 0.06, -6.50), BOARDS, ('bottom',))
    for z in (-7.62, -6.78):
        box(planks, (1.28, y0 - 0.025, z - 0.05), (1.78, y0, z + 0.05), SPAR, ('bottom', 'top'))
planks.build()

# ---------------------------------------------------------------- the sheerlegs (always)
# Two spars lashed at the head, straddling the head of the slipway and leaning out over the bow,
# with a tackle hanging from them and a stay back to a holdfast in the gap between the shed and
# the stacks - what lifts a stem or a mast into a hull. They stand between the shed and the
# stacks and the slipway's head.
FOOT_Z, APEX = -6.12, Vector((0, LAND + 4.3, -5.55))
bok = Part('sheerlegs', (0, LAND, 0))
for x in (-1.58, 1.58):
    rod(bok, (x, LAND - 0.02, FOOT_Z), APEX + Vector((0, 0.1, 0)), 0.075, SPAR, sides=5, r1=0.05)
    box(bok, (x - 0.12, LAND - 0.02, FOOT_Z - 0.12), (x + 0.12, LAND + 0.05, FOOT_Z + 0.12), BLOCK_DARK, ('bottom',))
box(bok, (-0.12, APEX.y - 0.08, APEX.z - 0.07), (0.12, APEX.y + 0.06, APEX.z + 0.07), ROPE)
HOOK = LAND + 3.4
rod(bok, (0, APEX.y - 0.08, APEX.z), (0, HOOK + 0.2, APEX.z), 0.012, ROPE, sides=3)
box(bok, (-0.05, HOOK + 0.08, APEX.z - 0.035), (0.05, HOOK + 0.24, APEX.z + 0.035), PILE)
box(bok, (-0.015, HOOK - 0.02, APEX.z - 0.015), (0.015, HOOK + 0.08, APEX.z + 0.015), IRON)
HOLDFAST = (0, LAND, -7.93)
rod(bok, (0, APEX.y, APEX.z - 0.05), (0, LAND + 0.46, -7.91), 0.012, ROPE, sides=3)
rod(bok, HOLDFAST, (0, LAND + 0.5, -7.93), 0.05, PILE, sides=4, caps=(False, True), turn=math.pi / 4)
bok.build()

# ---------------------------------------------------------------- the tar kettle (always)
# On a brick hearth beside the ship's bow, on the far side from the gate: pitch for the seams,
# kept hot. Its fire glows at night and its smoke is the yard's chimney (anchor.smoke).
KX, KZ = -2.08, -4.55
kettle = Part('tar kettle', (KX, LAND, KZ))
box(kettle, (KX - 0.27, LAND - 0.3, KZ - 0.27), (KX + 0.27, LAND + 0.28, KZ + 0.27), BRICK, ('bottom',))
kettle.poly([(KX - 0.11, LAND + 0.03, KZ + 0.272), (KX + 0.11, LAND + 0.03, KZ + 0.272),
             (KX + 0.11, LAND + 0.17, KZ + 0.272), (KX - 0.11, LAND + 0.17, KZ + 0.272)], EMBERS, (0, 0, 1))
rod(kettle, (KX, LAND + 0.28, KZ), (KX, LAND + 0.50, KZ), 0.2, IRON, sides=8, r1=0.22)
ring = [Vector((KX + math.cos(t) * 0.2, LAND + 0.46, KZ + math.sin(t) * 0.2)) for t in (2 * math.pi * i / 8 for i in range(8))]
kettle.poly(ring, PITCH, (0, 1, 0))
rod(kettle, (KX - 0.22, LAND + 0.51, KZ), (KX + 0.22, LAND + 0.51, KZ), 0.012, IRON, sides=3)
kettle.build()

spares = Part('spare shores', (0, LAND, 0))
# Shores not yet wanted, lying on the ground behind the kettle.
for i, x in enumerate((-2.34, -2.18, -2.26)):
    y = LAND + 0.05 + (0.09 if i == 2 else 0)
    rod(spares, (x, y, -3.9), (x - 0.03, y, -2.2), 0.05, SPAR, sides=4, turn=math.pi / 4 + i)
spares.build()


# ================================================================ the ship
# Her lines, in her own frame: y up from the bottom of the keel, z aft, x to starboard. Every
# row below is a level line round the hull at one height (the sheer, the top one, rises to the
# bow and steps up aft to the high stern), and every one of them runs from the stem to the
# sternpost - or, above the wing transom, to the flat transom.
KEEL_TOP = 0.14         # the rabbet: where the planking meets the keel
WL = 0.95               # where she will float: the main deck is 1.1 over it
WING = 1.30             # the wing transom, the lower edge of the flat stern
STEM_HALF = 0.05
# The stem's fore edge, (height, z): it rakes forward from the forefoot.
STEM = [(KEEL_TOP, -5.30), (0.40, -5.70), (WL, -6.00), (1.60, -6.25), (2.30, -6.47), (2.72, -6.56)]


def fore_z(y):
    return lerp(STEM, y)


def aft_z(y):
    if y <= WING:
        return 5.62 + (y - KEEL_TOP) * (0.60 / (WING - KEEL_TOP))    # the sternpost, raking aft
    return 6.22 + (y - WING) * 0.20                                   # the transom, raking too


# Half the breadth amidships at each height: widest a little above the waterline (2.8 over the
# wales, 2.7 on the waterline) and then drawing in towards the rail - the tumblehome these
# ships had, which is what makes a VOC hull read as one rather than as a barge.
BREADTH = [(KEEL_TOP, 0.07), (0.32, 0.80), (0.60, 1.17), (WL, 1.35), (1.15, 1.40), (WING, 1.40),
           (1.75, 1.33), (1.88, 1.30), (2.30, 1.20), (3.40, 1.08)]
# And the transom's half breadth: the flat stern is nearly as wide as the ship, as it was.
TRANSOM_HALF = [(WING, 0.98), (1.75, 1.03), (1.88, 1.03), (2.30, 0.98), (3.30, 0.84)]
MIDSHIP = 0.46          # where along her the section is fullest, a little forward of the middle
# The sheer: forecastle rail, waist, quarterdeck, poop and taffrail.
SHEER = [(0.0, 2.72), (0.10, 2.66), (0.21, 2.60), (0.27, 2.32), (0.62, 2.30), (0.68, 2.62), (0.84, 3.00), (1.0, 3.30)]


def fullness(y):
    """How bluff the ends are at a height: fine low down, round and full above the water."""
    fore = (lerp([(KEEL_TOP, 1.5), (0.32, 1.7), (0.60, 1.9), (WL, 2.1), (1.15, 2.3)], y),
            lerp([(KEEL_TOP, 1.0), (0.32, 0.9), (0.60, 0.75), (WL, 0.6), (1.15, 0.5)], y))
    aft = (lerp([(KEEL_TOP, 1.4), (0.32, 1.5), (0.60, 1.7), (WL, 2.0), (1.15, 2.3)], y),
           lerp([(KEEL_TOP, 1.3), (0.32, 1.2), (0.60, 1.0), (WL, 0.8), (1.15, 0.65)], y))
    return fore, aft


def half_breadth(t, y):
    """Half the breadth at height y, at t along the row (0 the stem, 1 the stern)."""
    B = lerp(BREADTH, y)
    fore, aft = fullness(y)
    if t <= MIDSHIP:
        u = (MIDSHIP - t) / MIDSHIP
        f = (1 - u ** fore[0]) ** fore[1]
    else:
        u = (t - MIDSHIP) / (1 - MIDSHIP)
        if y < WING - 1e-9:
            f = max(0.0, 1 - u ** aft[0]) ** aft[1]
        else:
            f = 1 - (1 - lerp(TRANSOM_HALF, y) / B) * u ** 2.6
    return max(STEM_HALF, B * f)


ROW_Y = [KEEL_TOP, 0.32, 0.60, WL, 1.15, WING, 1.75, 1.88, None]   # None: the sheer
SHEER_ROW = len(ROW_Y) - 1


def row_point(r, t):
    y = lerp(SHEER, t) if ROW_Y[r] is None else ROW_Y[r]
    z = fore_z(y) + (aft_z(y) - fore_z(y)) * t
    return Vector((half_breadth(t, y), y, z))


def row_t_at(r, z):
    """Where along row r it passes a given z, by bisection: every row runs stem to stern."""
    lo, hi = 0.0, 1.0
    for _ in range(40):
        mid = (lo + hi) / 2
        if row_point(r, mid).z < z:
            lo = mid
        else:
            hi = mid
    return (lo + hi) / 2


COLUMNS = 17            # stations round the shell, closer together towards the ends
TS = [0.5 - 0.5 * math.cos(math.pi * j / (COLUMNS - 1)) for j in range(COLUMNS)]
GRID = [[row_point(r, t) for t in TS] for r in range(len(ROW_Y))]


def mirror(p):
    return Vector((-p.x, p.y, p.z))


def outward(p):
    """Which way is out from the hull at a point on it, for orienting faces - see Part.poly."""
    return Vector((p.x, p.y - 1.1, p.z * 0.3))


def shell_band(part, r, mat, scale=1.0):
    """The planking between rows r and r+1, both sides, as seen from outside."""
    for side in (1, -1):
        for j in range(COLUMNS - 1):
            q = [GRID[r][j], GRID[r][j + 1], GRID[r + 1][j + 1], GRID[r + 1][j]]
            q = [Vector((p.x * side * scale, p.y, p.z)) for p in q]
            mid = sum(q, Vector()) / 4
            part.poly([ship(p) for p in q], mat, ship_dir(outward(mid)))


def ship_dir(v):
    """A direction in the ship's frame, turned onto the slipway with her."""
    return ship(v) - ship((0, 0, 0))


# ---------------------------------------------------------------- stage 1: keel and stems
keel = Part('s1-4 keel', (0, LAND, 0))
# The keel on its blocks, its heel under the sternpost.
KEEL_HALF = 0.07
kpts = [(-KEEL_HALF, 0, -5.30), (KEEL_HALF, 0, -5.30), (KEEL_HALF, KEEL_TOP + 0.02, -5.30), (-KEEL_HALF, KEEL_TOP + 0.02, -5.30),
        (-KEEL_HALF, 0, 5.76), (KEEL_HALF, 0, 5.76), (KEEL_HALF, KEEL_TOP + 0.02, 5.76), (-KEEL_HALF, KEEL_TOP + 0.02, 5.76)]
hexa(keel, [ship(p) for p in kpts], OAK)
keel.build()

stems = Part('s1-4 stems', (0, LAND, 0))
# The stem, a curve of timber rising and raking forward out of the forefoot, 0.13 deep fore and
# aft outside the rabbet, and the sternpost raking aft out of the heel. Faces are oriented, not
# counted on fingers: see Part.poly.
STEM_DEPTH = 0.13
prev = None
for k, (y, z) in enumerate(STEM):
    pts = [Vector((-0.06, y, z + 0.08)), Vector((0.06, y, z + 0.08)),
           Vector((0.06, y, z - STEM_DEPTH)), Vector((-0.06, y, z - STEM_DEPTH))]
    if k == 0:
        # down to the bottom of the keel at the forefoot
        base = [Vector((p.x, 0.0, p.z)) for p in pts]
        prev = base
    for i in range(4):
        q = [prev[i], prev[(i + 1) % 4], pts[(i + 1) % 4], pts[i]]
        mid = sum(q, Vector()) / 4
        centre = (sum(prev, Vector()) + sum(pts, Vector())) / 8
        stems.poly([ship(p) for p in q], OAK, ship_dir(mid - centre))
    prev = pts
stems.poly([ship(p) for p in prev], OAK, ship_dir(Vector((0, 1, -0.3))))
# The sternpost: from the heel of the keel to the wing transom, and on up the middle of the
# stern to the taffrail, which is the post the whole transom is hung on.
sp = [(KEEL_TOP * 0, 5.62), (WING, aft_z(WING)), (3.30, aft_z(3.30))]
for (y0, z0), (y1, z1) in zip(sp, sp[1:]):
    a = [Vector((-0.06, y0, z0 - 0.02)), Vector((0.06, y0, z0 - 0.02)), Vector((0.06, y0, z0 + 0.12)), Vector((-0.06, y0, z0 + 0.12))]
    b = [Vector((-0.06, y1, z1 - 0.02)), Vector((0.06, y1, z1 - 0.02)), Vector((0.06, y1, z1 + 0.10)), Vector((-0.06, y1, z1 + 0.10))]
    centre = (sum(a, Vector()) + sum(b, Vector())) / 8
    for i in range(4):
        q = [a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]]
        stems.poly([ship(p) for p in q], OAK, ship_dir(sum(q, Vector()) / 4 - centre))
    top = b
stems.poly([ship(p) for p in top], OAK, ship_dir(Vector((0, 1, 0))))
stems.build()

braces = Part('s1-2 braces', (0, LAND, 0))
# While there is nothing to hold them, the stem and the sternpost are held up by shores of their
# own, from the slipway on either side.
# From the sides rather than from ahead: ahead of the stem is the head of the slipway and the
# sheerlegs' feet, and it is sideways that a single timber on a keel falls.
for y, z, lean in ((1.9, fore_z(1.9) - 0.05, 0.6), (2.2, aft_z(2.2) + 0.05, -0.6)):
    for side in (1, -1):
        top = ship((side * 0.065, y, z))
        foot = Vector((side * (SLIP_W - 0.2), 0, top.z + lean))
        foot.y = slip_top(foot.z) - 0.01
        rod(braces, foot, top, 0.045, SPAR, sides=4, turn=math.pi / 4)
braces.build()

# ---------------------------------------------------------------- stage 2: the frames
# Thirteen frames from the stem to the sternpost, each one rib from rail to rail across a floor
# over the keel. A frame is a section through the hull at one z - the rows are found where they
# pass it - drawn as a three-sided timber, its outer face on the skin the planking will lie on
# and its back ridged inwards: the least that reads as a timber rather than as a slat from
# every side. Rows 4 and 7, the edges of the wales, are skipped, because a rib with a knot at
# every strake is twice the triangles and the eye does not follow it.
#
# The first and last stand out over the rake of the stem and the sternpost, where the lower
# rows have already ended: those frames start at the lowest row that reaches them, on the stem
# or the post, rather than dropping a leg into the air ahead of the forefoot. Twelve from the
# forefoot to the heel left a bare cell at either end, and the skeleton read as a box.
FRAME_ROWS = [0, 2, 3, 5, 6, SHEER_ROW]
FRAME_Z = [-5.45 + k * (11.3 / 12) for k in range(13)]
RIB_W, RIB_D = 0.045, 0.075


def reaches(r, z):
    """Whether row r runs as far as z, rather than ending at the stem or the post short of it."""
    ends = [row_point(r, 0).z, row_point(r, 1).z]
    return ends[0] + 0.02 < z < ends[1] - 0.02


def section(z):
    return [row_point(r, row_t_at(r, z)) for r in FRAME_ROWS if reaches(r, z)]


frames = Part('s2-2 frames', (0, LAND, 0))
for z in FRAME_Z:
    pts = section(z)
    # Port rail down to the floor across the keel - or across the stem or the post, out at the
    # ends - and up to the starboard rail, in one plane.
    floor = Vector((0, pts[0].y + (0.06 if pts[0].y <= KEEL_TOP else 0.0), z))
    line = [mirror(p) for p in reversed(pts)] + [floor] + pts
    line = [Vector((p.x * 0.985, p.y, z)) for p in line]
    inward = []
    for i, p in enumerate(line):
        a, b = line[max(0, i - 1)], line[min(len(line) - 1, i + 1)]
        t = Vector((b.x - a.x, b.y - a.y, 0)).normalized()
        # left of the direction of travel, port to starboard, is into the hull
        inward.append(Vector((-t.y, t.x, 0)))
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]
        ia, ib = a + inward[i] * RIB_D, b + inward[i + 1] * RIB_D
        af, aa = a + Vector((0, 0, -RIB_W)), a + Vector((0, 0, RIB_W))
        bf, ba = b + Vector((0, 0, -RIB_W)), b + Vector((0, 0, RIB_W))
        mid = (a + b) / 2
        out = -(inward[i] + inward[i + 1])
        frames.poly([ship(p) for p in (af, bf, ba, aa)], TIMBER, ship_dir(out))
        frames.poly([ship(p) for p in (aa, ba, ib, ia)], TIMBER, ship_dir(Vector((0, 0, 1)) - out * 0.3))
        frames.poly([ship(p) for p in (af, ia, ib, bf)], TIMBER, ship_dir(Vector((0, 0, -1)) - out * 0.3))
    for end, k in ((line[0], 0), (line[-1], len(line) - 1)):
        tip = end + inward[k] * RIB_D
        frames.poly([ship(p) for p in (end + Vector((0, 0, -RIB_W)), end + Vector((0, 0, RIB_W)), tip)], TIMBER,
                    ship_dir(Vector((0, 1, 0))))
frames.build()

ribbands = Part('s2-2 ribbands', (0, LAND, 0))
# Battens bent round the frames at the height of the main wale and at the sheer, which is what
# holds a skeleton to its shape until it is planked - and what shows its lines from the quay.
for r in (5, SHEER_ROW):
    run = [row_point(r, row_t_at(r, z)) for z in FRAME_Z]
    for side in (1, -1):
        for a, b in zip(run, run[1:]):
            a2, b2 = Vector((a.x * side * 1.01, a.y, a.z)), Vector((b.x * side * 1.01, b.y, b.z))
            lo, hi = Vector((0, -0.05, 0)), Vector((0, 0.03, 0))
            out = Vector((side, 0, 0))
            ribbands.poly([ship(p) for p in (a2 + lo, b2 + lo, b2 + hi, a2 + hi)], TIMBER_Z, ship_dir(out))
            inset = Vector((-side * 0.05, 0, 0))
            ribbands.poly([ship(p) for p in (a2 + hi, b2 + hi, b2 + hi + inset, a2 + hi + inset)], TIMBER_Z, ship_dir(Vector((0, 1, 0))))
ribbands.build()

beams = Part('s2-2 beams', (0, LAND, 0))
# The main deck's beams across every other frame, and the stern's own framing: the wing
# transom, the two fashion pieces up its edges and the rail across its top.
DECK_Y = 2.05
for z in FRAME_Z[2:9:2]:
    w = min(row_point(7, row_t_at(7, z)).x, row_point(SHEER_ROW, row_t_at(SHEER_ROW, z)).x) * 0.97
    pts = [(-w, DECK_Y - 0.08, z - 0.05), (w, DECK_Y - 0.08, z - 0.05), (w, DECK_Y, z - 0.05), (-w, DECK_Y, z - 0.05),
           (-w, DECK_Y - 0.08, z + 0.05), (w, DECK_Y - 0.08, z + 0.05), (w, DECK_Y, z + 0.05), (-w, DECK_Y, z + 0.05)]
    hexa(beams, [ship(p) for p in pts], TIMBER, ('left', 'right'))
for y0, y1 in ((WING - 0.05, WING + 0.07), (3.20, 3.30), (2.24, 2.32)):
    w0, w1 = lerp(TRANSOM_HALF, y0), lerp(TRANSOM_HALF, y1)
    z0, z1 = aft_z(y0), aft_z(y1)
    pts = [(-w0, y0, z0 - 0.06), (w0, y0, z0 - 0.06), (w1, y1, z1 - 0.06), (-w1, y1, z1 - 0.06),
           (-w0, y0, z0 + 0.04), (w0, y0, z0 + 0.04), (w1, y1, z1 + 0.04), (-w1, y1, z1 + 0.04)]
    hexa(beams, [ship(p) for p in pts], TIMBER)
for side in (1, -1):
    a = Vector((side * (lerp(TRANSOM_HALF, WING) - 0.04), WING, aft_z(WING)))
    b = Vector((side * (lerp(TRANSOM_HALF, 3.30) - 0.04), 3.30, aft_z(3.30)))
    rod(beams, ship(a), ship(b), 0.05, TIMBER, sides=4, turn=math.pi / 4)
beams.build()

shores = Part('s2-4 shores', (0, LAND, 0))
# Five shores a side from the edge of the slipway to the turn of the bilge: what holds a hull
# upright on a single line of blocks until the cradle is built under it for the launch.
for z in (-3.7, -1.7, 0.3, 2.3, 4.2):
    t = row_t_at(3, z)
    hull = row_point(3, t)
    for side in (1, -1):
        top = ship(Vector((side * (hull.x + 0.03), hull.y + 0.05, hull.z)))
        foot = Vector((side * (SLIP_W - 0.12), slip_top(top.z) - 0.01, top.z))
        rod(shores, foot, top, 0.045, SPAR, sides=4, turn=math.pi / 4)
shores.build()

ladder = Part('s2-4 ladder', (0, LAND, 0))
# A ladder up her starboard side from the slipway to the rail in the waist, on the side of the
# gate: the way the shipwrights go aboard, and the thing that gives the hull its size.
LADDER_Z = -0.4
rail = row_point(SHEER_ROW, row_t_at(SHEER_ROW, LADDER_Z))
top = ship((rail.x + 0.02, rail.y + 0.12, rail.z))
foot = Vector((SLIP_W - 0.08, 0, top.z - 0.02))
foot.y = slip_top(foot.z)
for dz in (-0.11, 0.11):
    rod(ladder, foot + Vector((0, 0, dz)), top + Vector((0, 0, dz)), 0.018, SPAR, sides=4, turn=math.pi / 4)
for k in range(1, 9):
    p = foot + (top - foot) * (k / 9)
    rod(ladder, p + Vector((0, 0, -0.11)), p + Vector((0, 0, 0.11)), 0.012, SPAR, sides=3)
ladder.build()

# ---------------------------------------------------------------- stage 3: the planked hull
# The shell in eight bands: three of bottom, paid pale to the waterline; a strake of tarred
# brown; the main wale; the topsides; the channel wale; the upper works to the rail. Each band
# is a strip of quads between two rows, so the colour changes exactly on a row and the join of
# pale and brown is the waterline the test measures.
bottom = Part('s3-4 bottom', (0, LAND, 0))
for r in (0, 1, 2):
    shell_band(bottom, r, BOTTOM)
bottom.build()

topsides = Part('s3-4 topsides', (0, LAND, 0))
for r in (3, 5, 7):
    shell_band(topsides, r, HULL)
topsides.build()

wales = Part('s3-4 wales', (0, LAND, 0))
for r in (4, 6):
    shell_band(wales, r, WALE)
wales.build()

bulwark = Part('s3-4 bulwark', (0, LAND, 0))
# The inside of the upper works and the cap on the rail. Without them, a hull seen from above
# has no far side: the shell is drawn from outside only, and its inner face is a hole.
INNER = 0.955
for side in (1, -1):
    for j in range(COLUMNS - 1):
        a, b = GRID[7][j], GRID[7][j + 1]
        c, d = GRID[SHEER_ROW][j + 1], GRID[SHEER_ROW][j]
        q = [Vector((p.x * side * INNER, p.y, p.z)) for p in (a, b, c, d)]
        mid = sum(q, Vector()) / 4
        bulwark.poly([ship(p) for p in q], HULL, ship_dir(-outward(mid)))
        o = [Vector((p.x * side, p.y, p.z)) for p in (d, c)]
        i = [Vector((p.x * side * INNER, p.y, p.z)) for p in (c, d)]
        bulwark.poly([ship(p) for p in (o[0], o[1], i[0], i[1])], WALE, ship_dir(Vector((0, 1, 0))))
bulwark.build()

transom = Part('s3-4 transom', (0, LAND, 0))
# The flat stern, raked, from the wing transom to the taffrail, with the cabin's windows in it.
rows = list(range(5, len(ROW_Y)))
for r0, r1 in zip(rows, rows[1:]):
    a, b = GRID[r0][-1], GRID[r1][-1]
    transom.poly([ship(p) for p in (mirror(a), a, b, mirror(b))], TRANSOM, ship_dir(Vector((0, 0.2, 1))))
# Its top is crowned rather than cut straight across, as a transom's is: an arc of the same
# plane standing above the taffrail, faced both ways because the poop deck looks at its back.
CROWN = [(-0.84, 0.0), (-0.45, 0.13), (0.0, 0.18), (0.45, 0.13), (0.84, 0.0)]
crown = [Vector((x, 3.30 + h, aft_z(3.30 + h))) for x, h in CROWN]
transom.poly([ship(p) for p in crown], TRANSOM, ship_dir(Vector((0, 0.2, 1))))
transom.poly([ship(p) for p in crown], TRANSOM, ship_dir(Vector((0, -0.2, -1))))
for x in (-0.62, -0.26, 0.26, 0.62):
    y0, y1 = 2.55, 2.85
    pts = [Vector((x - 0.12, y0, aft_z(y0) + 0.012)), Vector((x + 0.12, y0, aft_z(y0) + 0.012)),
           Vector((x + 0.12, y1, aft_z(y1) + 0.012)), Vector((x - 0.12, y1, aft_z(y1) + 0.012))]
    transom.poly([ship(p) for p in pts], WINDOW, ship_dir(Vector((0, 0.2, 1))))
# The rudder, hung on the sternpost before she is launched.
# Its fore edge is the sternpost's aft face, from the heel to where it goes up under the counter.
R0, R1 = (0.02, 5.75), (WING, aft_z(WING) + 0.12)
rpts = [(-0.05, R0[0], R0[1]), (0.05, R0[0], R0[1]), (0.05, R1[0], R1[1]), (-0.05, R1[0], R1[1]),
        (-0.05, R0[0], R0[1] + 0.30), (0.05, R0[0], R0[1] + 0.30), (0.05, R1[0], R1[1] + 0.30), (-0.05, R1[0], R1[1] + 0.30)]
hexa(transom, [ship(p) for p in rpts], OAK)
transom.build()

decks = Part('s3-4 decks', (0, LAND, 0))
# Four decks at four heights: the forecastle, the main deck in the waist, the quarterdeck and the
# poop under the taffrail. Each is a strip across the hull at its height, as wide as the hull
# is there, with a bulkhead where one steps up to the next.
DECKS = [(0.02, 0.22, 2.40), (0.22, 0.66, DECK_Y), (0.66, 0.82, 2.36), (0.82, 0.995, 2.74)]


def deck_edge(t, y):
    """The inside of the hull at height y, at t along it: between rows 7 and the sheer."""
    lo, hi = row_point(7, t), row_point(SHEER_ROW, t)
    k = (y - lo.y) / (hi.y - lo.y)
    return Vector((lo.x + (hi.x - lo.x) * k, y, lo.z + (hi.z - lo.z) * k)) * 1.0


for t0, t1, y in DECKS:
    steps = [t0 + (t1 - t0) * k / 4 for k in range(5)]
    for a, b in zip(steps, steps[1:]):
        pa, pb = deck_edge(a, y), deck_edge(b, y)
        pa.x *= INNER
        pb.x *= INNER
        decks.poly([ship(p) for p in (mirror(pa), pa, pb, mirror(pb))], DECK, ship_dir(Vector((0, 1, 0))))
for (t, y_lo, y_hi, face) in ((0.22, DECK_Y, 2.40, 1), (0.66, DECK_Y, 2.36, -1), (0.82, 2.36, 2.74, -1)):
    lo, hi = deck_edge(t, y_lo), deck_edge(t, y_hi)
    lo.x *= INNER
    hi.x *= INNER
    decks.poly([ship(p) for p in (mirror(lo), lo, hi, mirror(hi))], TRANSOM, ship_dir(Vector((0, 0, face))))
decks.build()

fittings = Part('s3-4 fittings', (0, LAND, 0))
# Two hatches and the capstan in the waist, so that the longest deck on the island is not one
# flat board from the forecastle to the quarterdeck.
for z, hx, hz in ((-3.1, 0.28, 0.25), (-1.55, 0.36, 0.36)):
    pts = [(-hx, DECK_Y, z - hz), (hx, DECK_Y, z - hz), (hx, DECK_Y + 0.08, z - hz), (-hx, DECK_Y + 0.08, z - hz),
           (-hx, DECK_Y, z + hz), (hx, DECK_Y, z + hz), (hx, DECK_Y + 0.08, z + hz), (-hx, DECK_Y + 0.08, z + hz)]
    hexa(fittings, [ship(p) for p in pts], WALE, ('bottom',))
rod(fittings, ship((0, DECK_Y, 1.35)), ship((0, DECK_Y + 0.2, 1.35)), 0.12, OAK, sides=8)
rod(fittings, ship((0, DECK_Y + 0.2, 1.35)), ship((0, DECK_Y + 0.25, 1.35)), 0.17, OAK, sides=8, caps=(True, True))
fittings.build()

beak = Part('s3-4 beak', (0, LAND, 0))
# The beakhead under where the bowsprit will be: a wedge out ahead of the stem.
a, b, c = Vector((0, 1.55, fore_z(1.55) - 0.1)), Vector((0, 2.30, fore_z(2.30) - 0.1)), Vector((0, 2.05, fore_z(2.05) - 0.75))
hw = 0.07
wedge = [a + Vector((-hw, 0, 0)), b + Vector((-hw, 0, 0)), c + Vector((-hw * 0.5, 0, 0)),
         a + Vector((hw, 0, 0)), b + Vector((hw, 0, 0)), c + Vector((hw * 0.5, 0, 0))]
beak.poly([ship(p) for p in wedge[:3]], HULL, ship_dir(Vector((-1, 0, 0))))
beak.poly([ship(p) for p in wedge[3:]], HULL, ship_dir(Vector((1, 0, 0))))
beak.poly([ship(p) for p in (wedge[0], wedge[2], wedge[5], wedge[3])], HULL, ship_dir(Vector((0, -1, -1))))
beak.poly([ship(p) for p in (wedge[1], wedge[4], wedge[5], wedge[2])], WALE, ship_dir(Vector((0, 1, -0.3))))
beak.build()

# ---------------------------------------------------------------- stage 4: the lower masts
# Fore, main and mizzen, stepped and standing with their tops on, and nothing on them yet. They
# stand square to her keel, so on the stocks they lean aft with her by the declivity.
MASTS = [('fore', -4.25, 6.95, 0.13, 0.36), ('main', -0.35, 7.70, 0.155, 0.42), ('mizzen', 3.55, 6.00, 0.10, 0.30)]
masts = Part('s4-4 masts', (0, LAND, 0))
for name, z, top, r, top_r in MASTS:
    rod(masts, ship((0, 1.9, z)), ship((0, top, z)), r, MAST, sides=6, r1=r * 0.68, caps=(False, True))
    yt = top - 0.75
    ring_lo = [Vector((math.cos(a) * top_r, yt, z + math.sin(a) * top_r)) for a in (2 * math.pi * i / 6 for i in range(6))]
    ring_hi = [p + Vector((0, 0.06, 0)) for p in ring_lo]
    masts.poly([ship(p) for p in ring_hi], TOP, ship_dir(Vector((0, 1, 0))))
    masts.poly([ship(p) for p in ring_lo], TOP, ship_dir(Vector((0, -1, 0))))
    for i in range(6):
        j = (i + 1) % 6
        q = [ring_lo[i], ring_lo[j], ring_hi[j], ring_hi[i]]
        mid = sum(q, Vector()) / 4
        masts.poly([ship(p) for p in q], TOP, ship_dir(Vector((mid.x, 0, mid.z - z))))
    cap = [(-0.09, top - 0.05, z - 0.14), (0.09, top - 0.05, z - 0.14), (0.09, top + 0.05, z - 0.14), (-0.09, top + 0.05, z - 0.14),
           (-0.09, top - 0.05, z + 0.12), (0.09, top - 0.05, z + 0.12), (0.09, top + 0.05, z + 0.12), (-0.09, top + 0.05, z + 0.12)]
    hexa(masts, [ship(p) for p in cap], TOP)
masts.build()

# ---------------------------------------------------------------- anchors
# anchor.smoke is the kettle's, and anchor.door the gate of the yard: the landward end of the
# strip right of the stacks, which runs free along the ship to the water and is where a road
# should arrive. The model's front is the sea, and a door there would be a door into it.
GATE_X = 2.2
for name, at in (('smoke', (KX, LAND + 0.62, KZ)), ('door', (GATE_X, LAND, -HALF_L))):
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = xyz(at)
    bpy.context.scene.collection.objects.link(e)

# The tallest thing in the set: the mainmast's cap, over the pile feet.
bpy.context.scene['building_height'] = round(max(ship((0, top + 0.05, z)).y for _, z, top, _, _ in MASTS), 4)

# A studio to open the file in, out of the bake because nothing in it is a building_part: the
# sea at the height it stands at when the yard is on the lowest land it may be given
# (YARD_FLOOR in web/js/shipyard.js), and a strip of land under the landward rows.
bpy.ops.mesh.primitive_plane_add(size=1, location=xyz((0, LAND - 0.65, 6.0)))
water = bpy.context.object
water.name = 'Studio water'
water.scale = (40, 28, 1)
wm = bpy.data.materials.new('Studio water')
wm.diffuse_color = (.06, .17, .24, 1)
water.data.materials.append(wm)
bpy.ops.mesh.primitive_cube_add(size=1, location=xyz((0, LAND - 0.35, -5.0)))
land = bpy.context.object
land.name = 'Studio land'
land.scale = (12, 6, 0.7)
lm = bpy.data.materials.new('Studio land')
lm.diffuse_color = (.2, .3, .1, 1)
land.data.materials.append(lm)

bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'shipyard.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'shipyard'})
