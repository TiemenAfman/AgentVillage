"""The shipyard, with the Batavia on its stocks. Rebuild with

    node scripts/blender.mjs --background --python scripts/build-shipyard.py

It writes assets/shipyard/shipyard.blend and bakes it to web/js/shipyard-mesh.js. Running it
again replaces both, so edits made by hand in the .blend are lost: this script is the source.

A VOC yard in the manner of the Oostenburg one in Amsterdam (Plans/DONE/scheepswerf.md): a timber
slipway (helling) running down into the water on piles, keel blocks along it, a tarred shed
(loods) and a pair of sheerlegs (bok) at the landward end, timber and planks stacked beside
them and a tar kettle on its hearth. On the slipway the yard builds the Batavia in stages, in
the Dutch order of her century - the bottom before the frames (schaalbouw, as Witsen has it) -
and the stage is a number the islander writes on the building record (`spec.stage`, 0 to 4):

    0  empty stocks: the slipway and its keel blocks
    1  the keel laid, the stem and the sternpost raised and braced, the wing transom across
    2  the bottom planking (bodemhuid): a shell of strakes round the turn of the bilge, held
       by cleats (klampen) on the outside, and not a frame yet
    3  the frames (spanten) set into that shell and rising out of it to the height of her
       sides, with ribbands along them, her deck beams and her stern timbers standing free
    4  her hull complete: the upper planking, the decks and the high stern - which is her own
       bake, drawn on these ways by buildings.js (bataviaOnStocks), not anything in this file

No masts at any stage: a ship was masted at the fitting-out quay after her launch, so she
comes to the roads at 120 rigged, and the yard never shows her with them.

**One hero asset, not five civic ones.** Every part is baked into the one asset `shipyard`,
and buildings.js picks what a stage shows by the part's name: a part called
`shipyard s<a>-<b> <what>` is drawn at stages a to b, and a part with no such token is the
yard itself and always drawn. The stages cannot be assets of their own, and it is the ground
rule that says so rather than taste: scripts/model-rules.mjs holds every asset's lowest point
to y = 0, and a keel laid on blocks halfway up a slipway is nowhere near the pile feet the set
stands on. A hero is measured as a whole, and that is exactly the honest reading here - it is
one building, drawn once on an island, whose ship is part of it.

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

Stages 1 to 3 are drawn on her own lines (the tables are copied from scripts/build-batavia.py
below, and tests/shipyard.test.mjs holds the frames to her bake), so the skeleton at 109 is
the ship that is planked up at 115 and lies on the roads at 120. She lies on the ways at their
own declivity, 1 in 24, as a keel is laid.

Written in island coordinates (x right, y up, z to the front) through xyz(); the ship is
drawn in her own frame - x across, y up from the bottom of the keel, z towards her bow, as
build-batavia.py draws her - and turned stern to the sea and onto the slipway by her().
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
# a Dutch yard shed is; the slipway is weathered oak with its ways dark with grease; the ship,
# until her own bake stands there at stage 4, is fresh oak.
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
BOARDS_Z = material('plankZ', 'bottom strakes', 0xb58a5a)
CLEAT = material('plank', 'cleat', 0x6e4c30)


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
# the ways - stern down towards the water. SHIP_Z is as far to sea as her gallery lets her go
# (it ends 0.3 inside the lot): that much room at the bow is what takes her beakhead and its
# lion clear of the sheerlegs' stay.
BLOCK_H = 0.26
SHIP_Z = 1.1
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
    z = -4.0 + i * 1.04
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
# She is the Batavia (scripts/build-batavia.py, Plans/DONE/batavia.md), and she is built the Dutch
# way of her century - the bottom first, as Witsen describes it (schaalbouw): the keel and the
# stems, then a shell of bottom planks held by cleats, then the frames set into that shell and
# rising to the height of her sides, then the upper planking, the decks and the high stern. The
# masts are stepped at the fitting-out quay after the launch, so none of them stands here.
#
# Her lines are hers, table for table: the half-beam at each height, where she ends fore and
# aft at each height, what her transom leaves of the beam, how bluff her bow is, where her
# decks break and how her rails sweep. Copied from build-batavia.py rather than imported,
# because that builder builds her the moment it is run; tests/shipyard.test.mjs holds the
# frames here to her bake, so the copy cannot drift without a test saying so. Stage 4 is not
# modelled here at all: buildings.js draws her own bake on these ways (bataviaOnStocks), so
# the hull that stands on the slipway at 115 is the hull that lies on the roads at 120.
#
# Her frame: x across (her port is +x), y up from the bottom of her keel, z towards her bow.
# her() turns her stern to the sea - a half turn about y - and lays her on the ways.
BEAM_T = [(0, .07), (.3, .78), (.65, 1.18), (1.0, 1.34), (1.3, 1.40), (1.7, 1.37), (2.1, 1.30),
          (2.6, 1.21), (3.1, 1.12), (3.9, 1.04)]
AFT_T = [(0, -5.45), (.3, -5.62), (.65, -5.8), (1.0, -5.98), (1.3, -6.08), (1.7, -6.15), (2.1, -6.2)]
FORE_T = [(0, 5.25), (.3, 5.55), (.65, 5.78), (1.0, 6.0), (1.3, 6.12), (1.7, 6.26), (2.1, 6.36)]
TRANSOM_T = [(0, 1.0), (.12, .12), (.65, .12), (1.0, .22), (1.3, .42), (1.7, .62), (2.1, .72), (3.9, .74)]
BLUFF_T = [(0, 1.25), (.65, 1.55), (1.0, 1.8), (1.3, 2.1), (2.1, 2.2)]
UM, UA = .56, .38
STATIONS = [0, .015, .04, .075, .12, .17, .25, .31, UA, .5, UM, .68, .8, .85, .89, .925, .955, .978, .993, 1.0]


def plan(u, y):
    if u >= UM:
        s = (u - UM) / (1 - UM)
        return max(0.0, 1 - s ** lerp(BLUFF_T, y)) ** .5
    if u <= UA:
        s = (UA - u) / UA
        fs = lerp(TRANSOM_T, y)
        return fs + (1 - fs) * max(0.0, 1 - s * s) ** .5
    return 1.0


def ends(y):
    return lerp(AFT_T, y), lerp(FORE_T, y)


def hull(u, y, sign=1.0):
    a, b = ends(y)
    return Vector((sign * lerp(BEAM_T, y) * plan(u, y), y, a + u * (b - a)))


def u_of(z, y):
    a, b = ends(y)
    return (z - a) / (b - a)


def side(z, y):
    return hull(min(1.0, max(0.0, u_of(z, y))), y).x


def reaches(z, y):
    """Whether her side at height y runs as far as z, rather than ending at a stem short of it."""
    a, b = ends(y)
    return a + 0.02 < z < b - 0.02


def sheer(z):
    return (z / 6.2) ** 2


# Her decks and rails: the poop, the quarterdeck, the waist and the forecastle, with the rails
# sweeping up to the taffrail aft and a little to the head forward.
Z_POOP, Z_QD, Z_FC = -3.7, -0.5, 3.2
TRANSOM_Z, STEM_Z = ends(2.1)


def aft_sweep(z):
    return 0.22 * min(1.0, max(0.0, (Z_POOP - z) / (Z_POOP - TRANSOM_Z))) ** 1.6


def fore_sweep(z):
    return 0.12 * min(1.0, max(0.0, (z - Z_FC) / (STEM_Z - Z_FC))) ** 2


def deck_and_rail(z):
    if z < Z_POOP:
        return 3.1, 3.35 + aft_sweep(z)
    if z < Z_QD:
        return 2.65, 2.9
    if z < Z_FC:
        return 2.1, 2.35
    return 2.6, 2.85 + fore_sweep(z)


TAFFRAIL = deck_and_rail(TRANSOM_Z)[1]
ENTRY_Z = 1.4        # the middle of her entry port, in the starboard waist


def her(p):
    """A point in her frame, on the slipway."""
    x, y, z = p
    return ship((-x, y, -z))


def her_dir(v):
    return her(v) - her((0, 0, 0))


def out_of(c):
    """Away from her own axis: what her skin is wound by (build-batavia.py outward())."""
    c = Vector(c)
    return c - Vector((0, min(max(c.y, 0.3), 3.0), min(max(c.z, -4.0), 4.0)))


def transom_half(y):
    return lerp(BEAM_T, y) * lerp(TRANSOM_T, y)


def prism(part, levels, mat):
    """A timber along a line of cross-sections (each four corners, the same way round), its
    sides faced away from the line's own middle and both ends capped."""
    for a, b in zip(levels, levels[1:]):
        mid = (sum(a, Vector()) + sum(b, Vector())) / 8
        for i in range(4):
            q = [a[i], a[(i + 1) % 4], b[(i + 1) % 4], b[i]]
            part.poly([her(p) for p in q], mat, her_dir(sum(q, Vector()) / 4 - mid))
    for ring, far in ((levels[0], levels[1]), (levels[-1], levels[-2])):
        part.poly([her(p) for p in ring], mat, her_dir(sum(ring, Vector()) / 4 - sum(far, Vector()) / 4))


# ---------------------------------------------------------------- stage 1: keel and stems
# The keel, on its blocks: as wide as the flat of her bottom and a little proud of it, from
# under her sternpost to her forefoot. Its origin is her own origin laid on the ways - the
# bottom of her keel amidships - and that is how buildings.js knows where to lay her bake at
# stage 4: it reads it off this part, and her declivity off the fall of this keel.
KEEL_HALF, KEEL_H = 0.08, 0.18
keel = Part('s1-3 keel', her((0, 0, 0)))
k0, k1 = AFT_T[0][1] - 0.10, FORE_T[0][1] + 0.02
hexa(keel, [her(p) for p in [(-KEEL_HALF, 0, k0), (KEEL_HALF, 0, k0), (KEEL_HALF, KEEL_H, k0), (-KEEL_HALF, KEEL_H, k0),
                             (-KEEL_HALF, 0, k1), (KEEL_HALF, 0, k1), (KEEL_HALF, KEEL_H, k1), (-KEEL_HALF, KEEL_H, k1)]], OAK)
keel.build()

stems = Part('s1-3 stems', her((0, 0, 0)))
# The stem, a curve of timber rising out of the forefoot along her own bow and upright above
# the main deck line to the head of the forecastle; and the sternpost, raked along her own
# stern up to the counter, with the wing transom (the hekbalk) across it - the timber the whole
# flat stern will be hung on, set up with the post before anything else of the stern exists.
STEM_Y = [0, .3, .65, 1.0, 1.3, 1.7, 2.1, 2.6, 2.97]
prism(stems, [[Vector((sx, y, ends(y)[1] + dz)) for sx, dz in ((-0.065, -0.07), (0.065, -0.07), (0.065, 0.10), (-0.065, 0.10))]
              for y in STEM_Y], OAK)
POST_Y = [0, .3, .65, 1.0, 1.3, 1.7, 2.1, 2.3]
prism(stems, [[Vector((sx, y, ends(y)[0] + dz)) for sx, dz in ((-0.065, 0.06), (0.065, 0.06), (0.065, -0.10), (-0.065, -0.10))]
              for y in POST_Y], OAK)
WING_Y = 1.3
w, zw = transom_half(WING_Y), ends(WING_Y)[0]
hexa(stems, [her(p) for p in [(-w, WING_Y - 0.07, zw - 0.04), (w, WING_Y - 0.07, zw - 0.04), (w, WING_Y + 0.07, zw - 0.04),
                              (-w, WING_Y + 0.07, zw - 0.04), (-w, WING_Y - 0.07, zw + 0.08), (w, WING_Y - 0.07, zw + 0.08),
                              (w, WING_Y + 0.07, zw + 0.08), (-w, WING_Y + 0.07, zw + 0.08)]], OAK)
stems.build()

braces = Part('s1-2 braces', (0, LAND, 0))
# While there is nothing to hold them, the stem and the sternpost are held up by shores of their
# own from either side of the slipway: sideways is how a single timber on a keel falls, and
# ahead of the stem are the head of the slipway and the sheerlegs' feet.
for y, z, lean in ((1.9, ends(1.9)[1], 0.6), (2.1, ends(2.1)[0], -0.6)):
    for s in (1, -1):
        top = her((s * 0.07, y, z))
        foot = Vector((math.copysign(SLIP_W - 0.2, top.x), 0, top.z + lean))
        foot.y = slip_top(foot.z) - 0.01
        rod(braces, foot, top, 0.045, SPAR, sides=4, turn=math.pi / 4)
braces.build()

# ---------------------------------------------------------------- stage 2: the bottom shell
# Her bottom planking, laid before a single frame: strakes from the keel round the turn of the
# bilge, on her own lines to a height a little over the bottom's own three rows, rising a hand
# towards the ends. Planked both faces and along its top edge, because at this stage you look
# into it from above, and closed at the stern where it comes in to the post.
SHELL_T = 0.04
SHELL_ROWS = [(0.0, 0.0), (0.3, 0.0), (0.65, 0.0), (0.84, 0.18)]      # height, and how much of the sheer


def shell_point(u, row, sign=1.0):
    base, lift = row
    z = hull(u, base).z
    return hull(u, base + lift * sheer(z), sign)


def inboard(v, sign):
    return Vector((sign * max(0.0, abs(v.x) - SHELL_T), v.y, v.z))


shell = Part('s2-3 bottom', her((0, 0, 0)))
for sign in (1.0, -1.0):
    for u0, u1 in zip(STATIONS, STATIONS[1:]):
        for r in range(len(SHELL_ROWS) - 1):
            q = [shell_point(u0, SHELL_ROWS[r], sign), shell_point(u1, SHELL_ROWS[r], sign),
                 shell_point(u1, SHELL_ROWS[r + 1], sign), shell_point(u0, SHELL_ROWS[r + 1], sign)]
            c = sum(q, Vector()) / 4
            shell.poly([her(p) for p in q], BOARDS_Z, her_dir(out_of(c)))
            shell.poly([her(inboard(p, sign)) for p in q], BOARDS_Z, her_dir(-out_of(c)))
        a, b = shell_point(u0, SHELL_ROWS[-1], sign), shell_point(u1, SHELL_ROWS[-1], sign)
        shell.poly([her(p) for p in (a, b, inboard(b, sign), inboard(a, sign))], BOARDS_Z, her_dir(Vector((0, 1, 0))))
for r in range(len(SHELL_ROWS) - 1):
    a, b = shell_point(0, SHELL_ROWS[r]), shell_point(0, SHELL_ROWS[r + 1])
    q = [Vector((-a.x, a.y, a.z)), a, b, Vector((-b.x, b.y, b.z))]
    shell.poly([her(p) for p in q], BOARDS_Z, her_dir(Vector((0, 0, -1))))
    shell.poly([her(p + Vector((0, 0, SHELL_T))) for p in q], BOARDS_Z, her_dir(Vector((0, 0, 1))))
shell.build()

cleats = Part('s2-2 cleats', her((0, 0, 0)))
# The cleats (klampen) that hold the bottom strakes to each other until the frames are in: a
# short batten nailed across the upper seams on the outside, every metre and a half or so.
for sign in (1.0, -1.0):
    for u in (0.2, 0.31, 0.44, 0.56, 0.68, 0.8, 0.89):
        lo, hi = hull(u, 0.52, sign), shell_point(u, SHELL_ROWS[-1], sign) - Vector((0, 0.03, 0))
        n = Vector((sign, 0, 0))
        back = [lo + Vector((0, 0, -0.05)), lo + Vector((0, 0, 0.05)), hi + Vector((0, 0, 0.05)), hi + Vector((0, 0, -0.05))]
        front = [p + n * 0.025 for p in back]
        c = (lo + hi) / 2 + n * 0.0125
        cleats.poly([her(p) for p in front], CLEAT, her_dir(n))
        for i in range(4):
            q = [back[i], back[(i + 1) % 4], front[(i + 1) % 4], front[i]]
            cleats.poly([her(p) for p in q], CLEAT, her_dir(sum(q, Vector()) / 4 - c))
cleats.build()

shores = Part('s2-4 shores', (0, LAND, 0))
# Five shores a side from the edge of the slipway to the turn of her bilge: what holds a hull on
# a single line of blocks upright, from the first strakes of the bottom until the cradle is
# built under her for the launch.
for z in (-3.9, -2.0, 0.0, 2.0, 3.9):
    for s in (1, -1):
        top = her((s * (side(z, 0.75) + 0.03), 0.78, z))
        foot = Vector((math.copysign(SLIP_W - 0.12, top.x), 0, top.z))
        foot.y = slip_top(foot.z) - 0.01
        rod(shores, foot, top, 0.045, SPAR, sides=4, turn=math.pi / 4)
shores.build()

# ---------------------------------------------------------------- stage 3: the frames
# Thirteen frames set into the bottom shell and rising out of it to the height of her sides:
# each one timber from rail to rail across a floor over the keel, a section through her at one
# z on her own lines, just inside the planking it will carry. A three-sided timber, its outer
# face towards the skin and its back ridged inwards - the least that reads as a timber rather
# than a slat from every side. Out over the rake of the stem and the post, where her lower
# heights have already ended, a frame starts at the lowest height that reaches it, on the stem
# or the post, rather than dropping a leg into the air.
FRAME_Z = [-5.75 + k * (11.35 / 12) for k in range(13)]
FRAME_Y = [0.3, 0.65, 1.0, 1.7, 2.1, 3.1]
RIB_W, RIB_D, RIB_IN = 0.045, 0.075, SHELL_T + 0.005


def frame_section(z):
    """Her side at z, heights up to her rail there, just inside her planking."""
    top = deck_and_rail(z)[1]
    ys = [y for y in FRAME_Y if y < top - 0.05 and reaches(z, y)] + ([top] if reaches(z, min(top, 2.1)) else [])
    return [Vector((side(z, y) - RIB_IN, y, z)) for y in ys]


frames = Part('s3-3 frames', her((0, 0, 0)))
for z in FRAME_Z:
    pts = frame_section(z)
    floor_y = KEEL_H + 0.02 if reaches(z, 0.0) else pts[0].y
    line = [Vector((-p.x, p.y, p.z)) for p in reversed(pts)] + [Vector((0, floor_y, z))] + pts
    inward = []
    for i in range(len(line)):
        a, b = line[max(0, i - 1)], line[min(len(line) - 1, i + 1)]
        t = Vector((b.x - a.x, b.y - a.y, 0)).normalized()
        inward.append(Vector((-t.y, t.x, 0)))       # left of the way the line runs, -x to +x, is into her
    for i in range(len(line) - 1):
        a, b = line[i], line[i + 1]
        ia, ib = a + inward[i] * RIB_D, b + inward[i + 1] * RIB_D
        af, aa = a + Vector((0, 0, -RIB_W)), a + Vector((0, 0, RIB_W))
        bf, ba = b + Vector((0, 0, -RIB_W)), b + Vector((0, 0, RIB_W))
        out = -(inward[i] + inward[i + 1])
        frames.poly([her(p) for p in (af, bf, ba, aa)], TIMBER, her_dir(out))
        frames.poly([her(p) for p in (aa, ba, ib, ia)], TIMBER, her_dir(Vector((0, 0, 1)) - out * 0.3))
        frames.poly([her(p) for p in (af, ia, ib, bf)], TIMBER, her_dir(Vector((0, 0, -1)) - out * 0.3))
    for k in (0, len(line) - 1):
        end = line[k]
        frames.poly([her(p) for p in (end + Vector((0, 0, -RIB_W)), end + Vector((0, 0, RIB_W)), end + inward[k] * RIB_D)],
                    TIMBER, her_dir(Vector((0, 1, 0))))
frames.build()

ribbands = Part('s3-3 ribbands', her((0, 0, 0)))
# Battens bent round the frames along the lines of her two wales, sweeping with her sheer as
# the wales will: what holds the skeleton to its shape until it is planked, and what shows her
# lines from the quay.
for base, lift in ((1.18, 0.14), (1.76, 0.28)):
    run = [Vector((side(z, base + lift * sheer(z)), base + lift * sheer(z), z)) for z in FRAME_Z if reaches(z, base)]
    for sign in (1, -1):
        for a, b in zip(run, run[1:]):
            a2, b2 = Vector((a.x * sign, a.y, a.z)), Vector((b.x * sign, b.y, b.z))
            lo, hi = Vector((0, -0.05, 0)), Vector((0, 0.03, 0))
            ribbands.poly([her(p) for p in (a2 + lo, b2 + lo, b2 + hi, a2 + hi)], TIMBER_Z, her_dir(Vector((sign, 0, 0))))
            inset = Vector((-sign * 0.045, 0, 0))
            ribbands.poly([her(p) for p in (a2 + hi, b2 + hi, b2 + hi + inset, a2 + hi + inset)], TIMBER_Z,
                          her_dir(Vector((0, 1, 0))))
ribbands.build()

beams = Part('s3-3 beams', her((0, 0, 0)))
# Her deck beams across every other frame, each at the height of the deck it will carry, so the
# steps of the forecastle, the quarterdeck and the poop are there before a plank of them is.
for z in FRAME_Z[1::2]:
    deck = deck_and_rail(z)[0]
    if not reaches(z, deck):
        continue
    w = side(z, deck) - RIB_IN - 0.02
    hexa(beams, [her(p) for p in [(-w, deck - 0.08, z - 0.05), (w, deck - 0.08, z - 0.05), (w, deck, z - 0.05), (-w, deck, z - 0.05),
                                  (-w, deck - 0.08, z + 0.05), (w, deck - 0.08, z + 0.05), (w, deck, z + 0.05), (-w, deck, z + 0.05)]],
         TIMBER, ('left', 'right'))
beams.build()

stern = Part('s3-3 stern timbers', her((0, 0, 0)))
# Her stern standing free above the planked bottom: the fashion pieces up the edges of the flat
# transom from the counter to the taffrail, the post up its middle, and beams across it at her
# main deck, at the poop and under the taffrail - the frame her spiegel will be planked on.
EDGE_Y = [1.0, 1.3, 1.7, 2.1, 2.6, 3.1, TAFFRAIL]
for s in (1, -1):
    for y0, y1 in zip(EDGE_Y, EDGE_Y[1:]):
        rod(stern, her((s * (transom_half(y0) - 0.04), y0, ends(y0)[0] + 0.02)),
            her((s * (transom_half(y1) - 0.04), y1, ends(y1)[0] + 0.02)), 0.05, TIMBER, sides=4, turn=math.pi / 4)
rod(stern, her((0, 2.3, TRANSOM_Z + 0.02)), her((0, TAFFRAIL, TRANSOM_Z + 0.02)), 0.055, TIMBER, sides=4, turn=math.pi / 4)
for y in (2.1, 3.1, TAFFRAIL - 0.05):
    w = transom_half(y) - 0.02
    z0 = ends(y)[0]
    hexa(stern, [her(p) for p in [(-w, y - 0.05, z0 - 0.02), (w, y - 0.05, z0 - 0.02), (w, y + 0.05, z0 - 0.02), (-w, y + 0.05, z0 - 0.02),
                                  (-w, y - 0.05, z0 + 0.08), (w, y - 0.05, z0 + 0.08), (w, y + 0.05, z0 + 0.08), (-w, y + 0.05, z0 + 0.08)]],
         TIMBER)
stern.build()

ladder = Part('s3-4 ladder', (0, LAND, 0))
# A ladder up her starboard side from the slipway to her entry port in the waist: the way the
# shipwrights go aboard while she is on the stocks, and on the gate's side of the yard.
top = her((-(side(ENTRY_Z, 2.1) + 0.03), 2.12, ENTRY_Z))
foot = Vector((SLIP_W - 0.09, 0, top.z - 0.02))
foot.y = slip_top(foot.z)
for dz in (-0.11, 0.11):
    rod(ladder, foot + Vector((0, 0, dz)), top + Vector((0, 0, dz)), 0.018, SPAR, sides=4, turn=math.pi / 4)
for k in range(1, 9):
    p = foot + (top - foot) * (k / 9)
    rod(ladder, p + Vector((0, 0, -0.11)), p + Vector((0, 0, 0.11)), 0.012, SPAR, sides=3)
ladder.build()

# ---------------------------------------------------------------- anchors
# anchor.smoke is the kettle's, and anchor.door the gate of the yard: the landward end of the
# strip right of the stacks, which runs free along the ship to the water and is where a road
# should arrive. The model's front is the sea, and a door there would be a door into it.
GATE_X = 2.2
for name, at in (('smoke', (KX, LAND + 0.62, KZ)), ('door', (GATE_X, LAND, -HALF_L))):
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = xyz(at)
    bpy.context.scene.collection.objects.link(e)

# The tallest thing in the set, over the pile feet: the head of the sheerlegs. At stage 4 her
# own bake stands a little higher, with the lanterns on her crest, and buildings.js measures what
# it drew rather than reading this.
bpy.context.view_layer.update()
bpy.context.scene['building_height'] = round(max(
    (o.matrix_world @ Vector(c)).z for o in bpy.context.scene.objects if o.get('building_part') for c in o.bound_box), 4)

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
