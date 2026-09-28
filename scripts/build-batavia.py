"""The Batavia: a VOC spiegelretourschip lying at anchor on the island's roads.

    node scripts/blender.mjs --background --python scripts/build-batavia.py
    node scripts/blender.mjs --background --python scripts/build-batavia.py -- <dir> [views]

The second form also renders previews into <dir>, one PNG per view (side, quarter, stern,
bow, top, deck, galleon, pair, fleet; the first six and galleon when none are named), with a
sea at the waterline and settler-sized stand-ins on the decks. Back faces are culled, as the
island's material culls them, so a face wound the wrong way shows as a hole. `galleon` puts
Martijn's pirate ship (assets/pirateship) astern of her at the same waterline and `pair`
abeam, which is the comparison this ship has to win; `fleet` puts the second and third
ships beside her in their liveries. Plans/batavia.md has the why and the numbers;
Plans/mijlpalen-tot-tweehonderd.md the decisions she comes from.

The reference is the Batavia of 1628 as rebuilt at Lelystad: a long hull with a strong
tumblehome, a forecastle and a stern castle in two steps (the quarterdeck and the poop),
the flat painted transom - the spiegel - with a gallery across it, quarter galleries on
its corners and three lanterns on its crest, three masts and a bowsprit with a spritsail
yard and a spritsail topmast, and a red lion on the beakhead. She lies at anchor, so her
sails are furled on their yards, a cable runs from her starboard hawse down into the
water, the spare anchor hangs at the port cathead and her flags fly: the Prinsenvlag at
the stern, a jack forward, a flag at the main truck and pennants on the fore and mizzen.
Stripes only, no letters and no monogram - there are no textures to letter them with.

Everything is modelled here, in island units (one unit is a cell is four metres), written
in island coordinates (x across, y up, z towards the bow) through xyz(). A hero set: no
asset collections, so the whole .blend is one asset, `batavia`, and its budget is its own
(HERO_BUDGETS in scripts/model-rules.mjs).

The sizes were decided with Tiemen against the galleon every island already has (13 long
with its bowsprit, 3.9 over the rail, its top ~10.8 above the water): a hull of ~12 at the
waterline, ~15 overall with the bowsprit, ~2.8 in the beam and the main truck ~11.5 above
the water. What a person walks on is at their scale - a settler is 0.43 - and only the rig
is lower than the real 55 m: the main deck (the waist) 1.1 above the water like the
galleon's, rails of 0.25, decks stepping up by at most one ladder of steps within STEP_UP.

**One frame, keel at y = 0.** Like the docks and the galleon, the ship is modelled with
the bottom of her keel on the ground plane, so the model rules hold for her as for any
building, and the island sets her down by one number: the draught, `W` below, baked as
`anchor.waterline`. buildings.js lowers the whole ship by it and main.js floats the plot's
origin on the sea, so the waterline is the sea surface.

**What moves** is baked inside the one asset with its origin on its own axis, as the
sawmill's blade is: the five flags, each hung by the middle of its hoist and streaming aft
along -z (a ship at anchor lies head to wind, so every flag on her blows the same way).
buildings.js leaves them out of the merge (`isBataviaMoving`) and web/js/batavia.js hangs
them and makes them fly. The hull's heave, pitch and roll are that file's too.

**What is measured** is exported as anchors, so later work - walking her decks, sailing
her - reads the bake rather than a copy of these numbers (model-rules DECK_ANCHOR):

    anchor.waterline            (0, W, 0): the draught
    anchor.deck.<name>.lo|hi    opposite corners of a rectangle a body can stand on, at
                                the height a downward ray finds the planking
    anchor.stair.<name>.lo|hi   a ladder between two of them, running fore and aft: `lo`
                                is the corner at its foot, at the floor it starts from, and
                                `hi` the opposite corner at its head, at the floor it
                                reaches - each measured by a ray just past that end
    anchor.mast.<name>          where a mast stands on its deck

The liveries: the three ships an island can earn (civic:ship, :2, :3) are this bake in
three colourings, and what changes is kept in parts of its own, which buildings.js repaints
per ship: `batavia livery topsides|panel|accent` for her skin and `batavia trim
topsides|panel|accent` for everything on it. Every face in one of those three colours lands
in one of them whatever it belongs to, so a gallery panel repaints with the hull it is on;
skin and trim are kept apart because buildings.js measures where her side is off the skin
alone, and a head rail or a quarter gallery is not a side a swimmer should meet.

Faces are wound outward on purpose and checked by eye with back faces culled in the
previews: the island's building material is single sided, and a hull whose inner
bulwarks faced the sea would show the ocean through the deck.
"""
import bpy
import math
import runpy
import sys
from pathlib import Path
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/batavia'
OUT.mkdir(parents=True, exist_ok=True)
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW_DIR = Path(args[0]) if args else None
VIEWS = args[1:] or ['side', 'quarter', 'stern', 'bow', 'top', 'deck', 'galleon']

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


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


# ---- the palette ------------------------------------------------------------------------
# The replica's colours, flattened: a white-stuff bottom, tarred wales and strakes, oak
# topsides, the stern castle's green panels framed in red, gilt carving, and the inside of
# every bulwark red - as a Dutch ship of the time had it. The three livery colours are the
# first ship's; buildings.js paints the second and third.
BOTTOM = material('plain', 'batavia bottom', 0xd8cfb9)
TAR = material('plain', 'batavia tar', 0x352920)
WALE = material('plain', 'batavia wale', 0x1e1916)
TOPSIDES = material('plank', 'batavia topsides', 0x7d5735)      # livery
PANEL = material('plain', 'batavia panel', 0x2f5b3d)            # livery
ACCENT = material('plain', 'batavia accent', 0x8e2b20)          # livery
INNER = material('plain', 'batavia inner', 0x873323)
GILT = material('plain', 'batavia gilt', 0xc79634)
DECK = material('plankZ', 'batavia deck', 0xab8c60)
DARK = material('plain', 'batavia dark', 0x241d19)
SPAR = material('plain', 'batavia spar', 0x94693f)
YARD = material('plain', 'batavia yard', 0x4d3625)
CANVAS = material('plain', 'batavia canvas', 0xe6dcc4)
ROPE = material('plain', 'batavia rope', 0x3d3127)
IRON = material('plain', 'batavia iron', 0x2f2f33)
SKY = material('plain', 'batavia sky', 0x3e6a92)
LION = material('plain', 'batavia lion', 0xb8352a)
# The island's own window glass (C.glass in web/js/buildings.js), lit after dark.
GLASS = material('plain', 'batavia glass', 0xffd27f, emissive=True)
LANTERN = material('plain', 'batavia lantern', 0xffd98c, emissive=True)
ORANGE = material('plain', 'batavia orange', 0xe8741c)
WHITE = material('plain', 'batavia white', 0xf3efe5)
BLUE = material('plain', 'batavia blue', 0x274a8c)


class Part:
    """One Blender object: faces around its own origin, one material slot per face."""

    def __init__(self, name, origin=(0, 0, 0)):
        self.name, self.origin = f'batavia {name}', Vector(origin)
        self.verts, self.faces, self.mats, self.slots = [], [], [], []

    def slot(self, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        return self.slots.index(mat)

    def add(self, points, mat):
        base, s = len(self.verts), self.slot(mat)
        self.verts.extend(Vector(p) - self.origin for p in points)
        self.faces.append(list(range(base, base + len(points))))
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
        scene.collection.objects.link(obj)
        return obj


# The parts she bakes as: her skin, decks and bulwarks; everything fitted to her (the stern,
# the head, the ladders, the channels, what stands on deck); her masts, yards and rigging; and
# the three livery colours, of the skin and of everything else, which face() sorts out by
# material. A part with several colours bakes as `name:0`, `name:1`, ...
HULL = Part('hull')
FITTINGS = Part('fittings')
RIG = Part('rig')
LIVERY = {TOPSIDES: Part('livery topsides'), PANEL: Part('livery panel'), ACCENT: Part('livery accent')}
TRIM = {TOPSIDES: Part('trim topsides'), PANEL: Part('trim panel'), ACCENT: Part('trim accent')}


def newell(pts):
    n = Vector((0, 0, 0))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def face(part, pts, mat, hint):
    """One polygon, wound so that it faces `hint` - the island's material is single sided."""
    pts = [Vector(p) for p in pts]
    n = newell(pts)
    if n.length < 1e-9:
        return
    if n.dot(Vector(hint)) < 0:
        pts.reverse()
    if part is HULL:
        part = LIVERY.get(mat, part)
    elif part in (FITTINGS, RIG):
        part = TRIM.get(mat, part)
    part.add(pts, mat)


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


BOX = [((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1)), ((1, -1, -1), (1, -1, 1), (1, 1, 1), (1, 1, -1)),
       ((-1, -1, -1), (-1, -1, 1), (1, -1, 1), (1, -1, -1)), ((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)),
       ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)), ((-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1))]


def box(part, centre, size, mat, rx=0.0, ry=0.0, rz=0.0, bottom=True):
    c, m = Vector(centre), rotation(rx, ry, rz)
    for k, corners in enumerate(BOX):
        if not bottom and k == 2:
            continue
        pts = [c + m @ Vector((x * size[0] / 2, y * size[1] / 2, z * size[2] / 2)) for x, y, z in corners]
        face(part, pts, mat, sum(pts, Vector()) / 4 - c)


def basis(d):
    d = d.normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    return u, d.cross(u).normalized()


def tube(part, centres, radii, mat, sides=6, caps=True, turn=0.0):
    """Rings round a line of centres. One frame for all of them, taken off the whole run, so
    a gently bent cable cannot twist its quads."""
    centres = [Vector(c) for c in centres]
    u, v = basis(centres[-1] - centres[0])
    rings = [[c + (u * math.cos(2 * math.pi * i / sides + turn) + v * math.sin(2 * math.pi * i / sides + turn)) * r
              for i in range(sides)] for c, r in zip(centres, radii)]
    for k in range(len(rings) - 1):
        axis = (centres[k] + centres[k + 1]) / 2
        for i in range(sides):
            q = [rings[k][i], rings[k][(i + 1) % sides], rings[k + 1][(i + 1) % sides], rings[k + 1][i]]
            face(part, q, mat, sum(q, Vector()) / 4 - axis)
    if caps:
        face(part, rings[0], mat, centres[0] - centres[1])
        face(part, rings[-1], mat, centres[-1] - centres[-2])


def rod(part, a, b, t, mat):
    """A line of rigging: four sides and no ends, which is all a rope 8 cm thick needs."""
    tube(part, [a, b], [t / 2, t / 2], mat, sides=4, caps=False, turn=math.pi / 4)


def spar(part, a, b, r0, r1, mat, sides=8, caps=True):
    tube(part, [a, b], [r0, r1], mat, sides=sides, caps=caps)


def slab(part, outline, y0, y1, mat, top=None):
    """A flat shape standing up: an outline in plan (x, z) from y0 to y1."""
    lo = [Vector((x, y0, z)) for x, z in outline]
    hi = [Vector((x, y1, z)) for x, z in outline]
    c = sum(lo, Vector()) / len(lo)
    face(part, hi, top or mat, (0, 1, 0))
    face(part, lo, mat, (0, -1, 0))
    for i in range(len(outline)):
        q = [lo[i], lo[(i + 1) % len(lo)], hi[(i + 1) % len(hi)], hi[i]]
        face(part, q, mat, sum(q, Vector()) / 4 - Vector((c.x, (y0 + y1) / 2, c.z)))


def plate(part, outline, z0, z1, mat, back=None):
    """A flat shape facing fore and aft: an outline in elevation (x, y) from z0 to z1."""
    a = [Vector((x, y, z0)) for x, y in outline]
    b = [Vector((x, y, z1)) for x, y in outline]
    c = sum(a, Vector()) / len(a)
    face(part, a, mat, (0, 0, -1) if z0 < z1 else (0, 0, 1))
    face(part, b, back or mat, (0, 0, 1) if z0 < z1 else (0, 0, -1))
    for i in range(len(outline)):
        q = [a[i], a[(i + 1) % len(a)], b[(i + 1) % len(b)], b[i]]
        face(part, q, back or mat, sum(q, Vector()) / 4 - Vector((c.x, c.y, (z0 + z1) / 2)))


# ---- the hull ---------------------------------------------------------------------------
W = 1.0              # the waterline above the keel: the draught, baked as anchor.waterline
TH = 0.06            # a bulwark's thickness

def table(t, y):
    if y <= t[0][0]:
        return t[0][1]
    for (y0, v0), (y1, v1) in zip(t, t[1:]):
        if y <= y1:
            return v0 + (v1 - v0) * (y - y0) / (y1 - y0)
    return t[-1][1]


# The hull is a function of height and of a station u along it (0 at the stern, 1 at the
# stem), and every surface below is sampled off it - so the lower hull, the bulwarks, the
# decks, the channels and the gunport lids all agree about where the side of the ship is.
# Half the beam at each height: widest at the lower wale, 0.3 above the water (2.8 across),
# then the tumblehome that makes a retourschip read as one - 2.16 across at the poop rail.
BEAM_T = [(0, .07), (.3, .78), (.65, 1.18), (1.0, 1.34), (1.3, 1.40), (1.7, 1.37), (2.1, 1.30),
          (2.6, 1.21), (3.1, 1.12), (3.9, 1.04)]
# Where she ends at each height: the sternpost raked under the counter, the stem curving
# forward. Upright above the main deck line, so every break between decks is square.
AFT_T = [(0, -5.45), (.3, -5.62), (.65, -5.8), (1.0, -5.98), (1.3, -6.08), (1.7, -6.15), (2.1, -6.2)]
FORE_T = [(0, 5.25), (.3, 5.55), (.65, 5.78), (1.0, 6.0), (1.3, 6.12), (1.7, 6.26), (2.1, 6.36)]
# What is left of the beam at the stern: nothing but the post under the water, the counter
# above it, and the transom's full width from the wing transom up.
TRANSOM_T = [(0, 1.0), (.12, .12), (.65, .12), (1.0, .22), (1.3, .42), (1.7, .62), (2.1, .72), (3.9, .74)]
# How bluff the bow is: an ellipse in plan above the water, finer below it.
BLUFF_T = [(0, 1.25), (.65, 1.55), (1.0, 1.8), (1.3, 2.1), (2.1, 2.2)]
UM, UA = .56, .38    # where the bow begins and the run aft ends


def plan(u, y):
    if u >= UM:
        s = (u - UM) / (1 - UM)
        return max(0.0, 1 - s ** table(BLUFF_T, y)) ** .5
    if u <= UA:
        s = (UA - u) / UA
        fs = table(TRANSOM_T, y)
        return fs + (1 - fs) * max(0.0, 1 - s * s) ** .5
    return 1.0


def ends(y):
    return table(AFT_T, y), table(FORE_T, y)


def hull(u, y, sign=1.0):
    a, b = ends(y)
    return Vector((sign * table(BEAM_T, y) * plan(u, y), y, a + u * (b - a)))


def u_of(z, y=2.1):
    a, b = ends(y)
    return (z - a) / (b - a)


def side(z, y):
    return hull(u_of(z, y), y).x


def inner(z, y):
    return max(0.0, side(z, y) - TH)


def sheer(z):
    return (z / 6.2) ** 2


# The decks: flat, so that a rectangle on each is a floor for later work. The rails are
# 0.25 above their deck at the breaks; each step between decks is a ladder of steps.
Z_POOP, Z_QD, Z_FC = -3.7, -0.5, 3.2
TRANSOM_Z = ends(2.1)[0]
STEM_Z = ends(2.1)[1]
GAP = (1.2, 1.6)                 # the entry port in the starboard waist bulwark
SECTIONS = [                     # name, from, to, deck, rail at the break
    ('poop', 0.0, u_of(Z_POOP), 3.1, 3.35),
    ('quarterdeck', u_of(Z_POOP), u_of(Z_QD), 2.65, 2.9),
    ('waist', u_of(Z_QD), u_of(Z_FC), 2.1, 2.35),
    ('forecastle', u_of(Z_FC), 1.0, 2.6, 2.85),
]


# The two ends sweep up. A retourschip's stern rises in a curve to the taffrail and her bow
# lifts to the head; drawn level, the poop read as a box set on a barge. Only the rails and
# the side under them rise - the decks stay flat - so the bulwark round the poop is a little
# taller aft, which is what the taffrail of a ship of the time was.
def aft_sweep(z):
    return 0.22 * min(1.0, max(0.0, (Z_POOP - z) / (Z_POOP - TRANSOM_Z))) ** 1.6


def fore_sweep(z):
    return 0.12 * min(1.0, max(0.0, (z - Z_FC) / (STEM_Z - Z_FC))) ** 2


SWEEP = {'poop': aft_sweep, 'forecastle': fore_sweep}


def rail_at(name, rail, z):
    return rail + (SWEEP[name](z) if name in SWEEP else 0.0)


# The rows of the side, keel to rail: (height, how it rises towards the ends, the colour of
# the band above it). A number is a share of the sheer, a function is its own curve. The
# wales take the sheer - it is what keeps a long flat-decked hull from reading as a barge -
# and the band above the deck line is the section's own: oak in the waist, the green panels
# of the forecastle and the stern castle, each under a red moulding.
LOWER = [(0, 0, BOTTOM), (.3, 0, BOTTOM), (.65, 0, BOTTOM), (W, 0, TAR), (1.18, .14, WALE), (1.30, .14, TAR),
         (1.76, .28, WALE), (1.86, .28, TOPSIDES), (2.08, .36, WALE), (2.18, .36, None)]
DECKLINE = 8                     # the index of the deck-line wale, where the bulwarks begin
BAND = {'waist': TOPSIDES, 'forecastle': PANEL, 'quarterdeck': PANEL, 'poop': PANEL}
UPPER = {
    'waist': [(2.35, 0, None)],
    'forecastle': [(2.78, fore_sweep, ACCENT), (2.85, fore_sweep, None)],
    'quarterdeck': [(2.83, 0, ACCENT), (2.9, 0, None)],
    'poop': [(2.83, 0, ACCENT), (2.9, 0, PANEL), (3.28, aft_sweep, ACCENT), (3.35, aft_sweep, None)],
}


def rows_of(name):
    return LOWER[:-1] + [(LOWER[-1][0], LOWER[-1][1], BAND[name])] + UPPER[name]


# Along the hull, denser where the plan curves; the breaks between decks and the jambs of the
# entry port are stations of their own, exactly, so that two decks meet on one line.
BREAKS = [u_of(Z_POOP), u_of(Z_QD), u_of(Z_FC), u_of(GAP[0]), u_of(GAP[1])]
STATIONS = sorted(BREAKS + [u for u in (0, .015, .04, .075, .12, .17, .25, .31, UA, .5, UM, .68, .8, .85, .89, .925,
                                        .955, .978, .993, 1.0) if all(abs(u - b) > 0.01 for b in BREAKS)])


def row_point(u, row, sign):
    base, lift = row[0], row[1]
    z = hull(u, base).z
    y = base + (lift(z) if callable(lift) else lift * sheer(z))
    return hull(u, y, sign)


def outward(c):
    """Away from the ship's own axis: good enough to wind every piece of her skin by."""
    return c - Vector((0, min(max(c.y, 0.3), 3.0), min(max(c.z, -4.0), 4.0)))


def in_gap(u0, u1):
    return u0 >= u_of(GAP[0]) - 1e-9 and u1 <= u_of(GAP[1]) + 1e-9


def inboard(v, sign):
    return Vector((sign * max(0.0, abs(v.x) - TH), v.y, v.z))


for name, ua, ub, deck, rail in SECTIONS:
    rows = rows_of(name)
    cols = [u for u in STATIONS if ua - 1e-9 <= u <= ub + 1e-9]
    top = lambda u: rail_at(name, rail, hull(u, rail).z)
    for sign in (1.0, -1.0):
        for u0, u1 in zip(cols, cols[1:]):
            gap = name == 'waist' and sign < 0 and in_gap(u0, u1)
            # the outer skin, band by band
            for j in range(len(rows) - 1):
                if gap and j >= DECKLINE:
                    continue
                q = [row_point(u0, rows[j], sign), row_point(u1, rows[j], sign),
                     row_point(u1, rows[j + 1], sign), row_point(u0, rows[j + 1], sign)]
                face(HULL, q, rows[j][2], outward(sum(q, Vector()) / 4))
            if gap:
                # The deck runs out to the skin through the entry port.
                a, b = hull(u0, deck, sign), hull(u1, deck, sign)
                face(HULL, [inboard(a, sign), a, b, inboard(b, sign)], DECK, (0, 1, 0))
                continue
            # the inside of the bulwark, red as it was, from the rail down to the deck
            t0, t1 = top(u0), top(u1)
            q = [inboard(v, sign) for v in (hull(u0, deck, sign), hull(u1, deck, sign), hull(u1, t1, sign), hull(u0, t0, sign))]
            face(HULL, q, INNER, -outward(sum(q, Vector()) / 4))
            # the rail cap
            a, b = hull(u0, t0, sign), hull(u1, t1, sign)
            face(HULL, [a, b, inboard(b, sign), inboard(a, sign)], ACCENT, (0, 1, 0))
    for u0, u1 in zip(cols, cols[1:]):
        # the deck, across both sides at once
        a, b = hull(u0, deck), hull(u1, deck)
        wa, wb = max(0.0, a.x - TH), max(0.0, b.x - TH)
        face(HULL, [(-wa, deck, a.z), (wa, deck, a.z), (wb, deck, b.z), (-wb, deck, b.z)], DECK, (0, 1, 0))
        a, b = hull(u0, 0), hull(u1, 0)
        face(HULL, [(-a.x, 0, a.z), (a.x, 0, a.z), (b.x, 0, b.z), (-b.x, 0, b.z)], BOTTOM, (0, -1, 0))

# The stern: the counter, and the transom from the wing transom to the taffrail - one flat
# face across both sides, in the same bands as the sides so the wales run round the corner.
rows = rows_of('poop')
for j in range(len(rows) - 1):
    a, b = row_point(0, rows[j], 1), row_point(0, rows[j + 1], 1)
    face(HULL, [(-a.x, a.y, a.z), (a.x, a.y, a.z), (b.x, b.y, b.z), (-b.x, b.y, b.z)], rows[j][2], (0, 0, -1))
TAFFRAIL = rail_at('poop', 3.35, TRANSOM_Z)
# its inner face above the poop deck
a, b = hull(0, 3.1), hull(0, TAFFRAIL)
face(HULL, [(-a.x + TH, 3.1, a.z + TH), (a.x - TH, 3.1, a.z + TH), (b.x - TH, TAFFRAIL, b.z + TH),
            (-b.x + TH, TAFFRAIL, b.z + TH)], INNER, (0, 0, 1))


def bulkhead(z, lo, hi, facing, mat):
    ys = [lo] + [y for y in (2.6, 3.1) if lo < y < hi] + [hi]
    for y0, y1 in zip(ys, ys[1:]):
        face(HULL, [(-inner(z, y0), y0, z), (inner(z, y0), y0, z), (inner(z, y1), y1, z), (-inner(z, y1), y1, z)],
             mat, (0, 0, facing))


def wall_ends(z, lo, hi, facing):
    for sign in (1, -1):
        face(HULL, [(sign * inner(z, lo), lo, z), (sign * side(z, lo), lo, z), (sign * side(z, hi), hi, z),
                    (sign * inner(z, hi), hi, z)], TOPSIDES, (0, 0, facing))


# The breaks: the forecastle's bulkhead faces aft over the waist, the quarterdeck's and the
# poop's face forward. Above the lower rail, the higher deck's side wall ends square.
bulkhead(Z_FC, 2.1, 2.6, -1, PANEL)
wall_ends(Z_FC, 2.35, 2.85, -1)
bulkhead(Z_QD, 2.1, 2.65, 1, PANEL)
wall_ends(Z_QD, 2.35, 2.9, 1)
bulkhead(Z_POOP, 2.65, 3.1, 1, PANEL)
wall_ends(Z_POOP, 2.9, 3.35, 1)
# The jambs of the entry port.
for z, facing in ((GAP[0], 1), (GAP[1], -1)):
    lo = row_point(u_of(z), LOWER[DECKLINE], -1).y
    face(HULL, [(-inner(z, lo), lo, z), (-side(z, lo), lo, z), (-side(z, 2.35), 2.35, z), (-inner(z, 2.35), 2.35, z)],
         TOPSIDES, (0, 0, facing))


def on_bulkhead(z, facing, x, y0, y1, w, mat):
    zz = z + facing * 0.008
    face(FITTINGS, [(x - w / 2, y0, zz), (x + w / 2, y0, zz), (x + w / 2, y1, zz), (x - w / 2, y1, zz)], mat, (0, 0, facing))


# Doors under the forecastle and the quarterdeck, and into the great cabin under the poop.
for x in (-0.3, 0.3):
    on_bulkhead(Z_FC, -1, x, 2.1, 2.46, 0.2, DARK)
    on_bulkhead(Z_QD, 1, x, 2.1, 2.54, 0.22, DARK)
    on_bulkhead(Z_FC, -1, x, 2.47, 2.5, 0.26, GILT)
    on_bulkhead(Z_QD, 1, x, 2.55, 2.58, 0.28, GILT)
on_bulkhead(Z_POOP, 1, 0, 2.65, 3.04, 0.26, DARK)
on_bulkhead(Z_POOP, 1, 0, 3.045, 3.075, 0.32, GILT)
for x in (-0.33, 0.33):
    on_bulkhead(Z_POOP, 1, x, 2.8, 2.96, 0.14, GLASS)


# ---- the ladders between the decks ------------------------------------------------------
# Solid steps, a block each, because a block is a floor for whoever walks them later and an
# open tread over the dark is a gap to fall through. Every rise is well inside STEP_UP (0.45
# in web/js/walk.js): 0.10 to 0.11 a step.
STAIRS = {}      # name -> (x0, x1, z foot, z head, y foot, y head)


def ladder(name, x0, x1, zf, zh, yf, yh, n):
    run = zh - zf
    for k in range(1, n + 1):
        top = yf + k * (yh - yf) / (n + 1)
        za, zb = zf + (k - 1) * run / n, zf + k * run / n
        box(FITTINGS, ((x0 + x1) / 2, (yf + top) / 2, (za + zb) / 2), (x1 - x0, top - yf, abs(zb - za)), YARD, bottom=False)
    STAIRS[name] = (x0, x1, zf, zh, yf, yh)


for sign, sname in ((1, 'port'), (-1, 'starboard')):
    xs = sorted((sign * 0.6, sign * 0.92))
    ladder(f'fore-{sname}', xs[0], xs[1], 2.6, Z_FC, 2.1, 2.6, 4)
    ladder(f'quarter-{sname}', xs[0], xs[1], 0.1, Z_QD, 2.1, 2.65, 4)
    xs = sorted((sign * 0.55, sign * 0.85))
    ladder(f'poop-{sname}', xs[0], xs[1], -3.2, Z_POOP, 2.65, 3.1, 3)


def breast_rail(z, deck, facing, gaps):
    """The rail across the front of a raised deck, open at the heads of its ladders."""
    zz = z - facing * 0.03
    w = inner(z, deck)
    edges = [-w] + [v for g in gaps for v in g] + [w]
    for a, b in zip(edges[::2], edges[1::2]):
        box(FITTINGS, ((a + b) / 2, deck + 0.23, zz), (b - a, 0.04, 0.05), ACCENT)
        n = max(1, round((b - a) / 0.26))
        for k in range(n + 1):
            x = a + 0.02 + (b - a - 0.04) * k / n
            rod(FITTINGS, (x, deck, zz), (x, deck + 0.21, zz), 0.03, GILT)


breast_rail(Z_FC, 2.6, -1, [(-0.92, -0.6), (0.6, 0.92)])
breast_rail(Z_QD, 2.65, 1, [(-0.92, -0.6), (0.6, 0.92)])
breast_rail(Z_POOP, 3.1, 1, [(-0.85, -0.55), (0.55, 0.85)])

# ---- the stern --------------------------------------------------------------------------
def on_transom(pts, mat, off=0.008):
    """Paint on the stern, just proud of it: upright above the deck line, raked below."""
    face(FITTINGS, [(x, y, ends(y)[0] - off) for x, y in pts], mat, (0, 0, -1))


def rect(x0, x1, y0, y1):
    return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]


# The lower transom: a gilt moulding at the wing transom and one under the gallery, the two
# stern ports, and the rudder head between them.
for y in (1.62, 2.52):
    w = hull(0, y).x - 0.02
    on_transom(rect(-w, w, y, y + 0.06), GILT)
for x in (-0.45, 0.45):
    on_transom(rect(x - 0.1, x + 0.1, 2.08, 2.28), DARK)
    on_transom(rect(x - 0.13, x + 0.13, 2.28, 2.31), ACCENT, 0.01)
# The great cabin's windows behind the gallery, and the hut's above it, lit after dark.
for x in (-0.64, -0.21, 0.21, 0.64):
    on_transom(rect(x - 0.16, x + 0.16, 2.68, 2.96), GLASS)
on_transom(rect(-0.74, 0.74, 3.09, TAFFRAIL - 0.12), SKY)
for x in (-0.42, 0, 0.42):
    on_transom(rect(x - 0.1, x + 0.1, 3.15, 3.33), GLASS, 0.01)

# The gallery: a balcony across the transom at the great cabin's floor, its rail and its roof.
GZ0, GZ1, GW = TRANSOM_Z, TRANSOM_Z - 0.2, 0.86
box(FITTINGS, (0, 2.605, (GZ0 + GZ1) / 2), (2 * GW, 0.05, GZ0 - GZ1), YARD)
box(FITTINGS, (0, 2.575, (GZ0 + GZ1) / 2 + 0.01), (2 * GW - 0.06, 0.03, GZ0 - GZ1 - 0.02), GILT)
box(FITTINGS, (0, 2.845, GZ1 + 0.02), (2 * GW, 0.035, 0.04), ACCENT)
for s in (-1, 1):
    box(FITTINGS, (s * (GW - 0.02), 2.845, (GZ0 + GZ1) / 2), (0.04, 0.035, GZ0 - GZ1), ACCENT)
    rod(FITTINGS, (s * (GW - 0.02), 2.63, GZ1 + 0.02), (s * (GW - 0.02), 3.02, GZ1 + 0.02), 0.035, GILT)
for k in range(9):
    x = -GW + 0.12 + k * (2 * GW - 0.24) / 8
    rod(FITTINGS, (x, 2.63, GZ1 + 0.02), (x, 2.83, GZ1 + 0.02), 0.025, GILT)
slab(FITTINGS, rect(-GW - 0.04, GW + 0.04, GZ0, GZ1 - 0.06), 3.02, 3.065, ACCENT)

# The crest over the transom, arched, a painted sky on it and the arms in the middle; the
# lanterns stand on it.
CX, T0, ARCH = hull(0, TAFFRAIL).x - 0.02, TAFFRAIL - 0.05, 0.46
crest = [(x, TAFFRAIL + ARCH * max(0.0, 1 - (x / CX) ** 2) ** 0.8) for x in [CX * (k / 6 - 1) for k in range(0, 13)]]
crest = [(-CX, TAFFRAIL - 0.02)] + crest[1:-1] + [(CX, TAFFRAIL - 0.02)]
plate(FITTINGS, [(-CX, T0)] + crest + [(CX, T0)], TRANSOM_Z + 0.002, TRANSOM_Z + TH, GILT, back=INNER)
inset = [(x * 0.86, T0 + (y - T0) * 0.82) for x, y in crest]
on_transom([(-CX * 0.86, TAFFRAIL + 0.01)] + inset[1:-1] + [(CX * 0.86, TAFFRAIL + 0.01)], SKY, 0.004)
SY = TAFFRAIL + 0.08
shield = [(-0.16, SY + 0.3), (0.16, SY + 0.3), (0.16, SY + 0.13), (0, SY), (-0.16, SY + 0.13)]
on_transom(shield, GILT, 0.008)
on_transom([(x * 0.72, SY + 0.16 + (y - SY - 0.16) * 0.72) for x, y in shield], ACCENT, 0.011)
LANTERNS = [(0, TAFFRAIL + ARCH + 0.01, 0.1, 0.22), (-CX, TAFFRAIL, 0.072, 0.16), (CX, TAFFRAIL, 0.072, 0.16)]
for x, y, r, h in LANTERNS:
    z = TRANSOM_Z - 0.03
    rod(FITTINGS, (x, y - 0.02, z + 0.03), (x, y + 0.05, z), 0.03, IRON)
    tube(FITTINGS, [(x, y + 0.05, z), (x, y + 0.08, z)], [r * 0.8, r], IRON)
    tube(FITTINGS, [(x, y + 0.08, z), (x, y + 0.08 + h, z)], [r, r * 1.08], LANTERN, sides=6)
    tube(FITTINGS, [(x, y + 0.08 + h, z), (x, y + 0.08 + h + r * 0.9, z)], [r * 1.2, 0.012], GILT, sides=6)
    tube(FITTINGS, [(x, y + 0.1 + h + r * 0.9, z), (x, y + 0.14 + h + r * 0.9, z)], [0.02, 0.012], GILT, sides=4)

# The quarter galleries, a turret of windows on each stern corner.
QZ0, QZ1 = TRANSOM_Z + 0.06, TRANSOM_Z + 0.86
QG0, QG1 = 2.42, 3.22
for s in (1, -1):
    xin = min(side(QZ0, 2.4), side(QZ1, 3.1)) - 0.04
    xo = max(side(QZ0, 2.9), side(QZ1, 2.9)) + 0.16
    xs = sorted((s * xin, s * xo))
    slab(FITTINGS, rect(xs[0], xs[1], QZ0, QZ1), QG0, QG1, PANEL)
    for zc in (QZ0 + 0.22, QZ1 - 0.22):
        face(FITTINGS, [(s * (xo + 0.004), 2.66, zc - 0.13), (s * (xo + 0.004), 2.66, zc + 0.13),
                        (s * (xo + 0.004), 2.98, zc + 0.13), (s * (xo + 0.004), 2.98, zc - 0.13)], GLASS, (s, 0, 0))
    face(FITTINGS, [(s * (xo + 0.003), 3.05, QZ0), (s * (xo + 0.003), 3.05, QZ1),
                    (s * (xo + 0.003), 3.11, QZ1), (s * (xo + 0.003), 3.11, QZ0)], GILT, (s, 0, 0))
    # its roof, a little dome of four facets, and the drop under it
    top = Vector((s * (xin + xo) / 2, QG1 + 0.3, (QZ0 + QZ1) / 2))
    bot = Vector((s * (xin + xo) / 2, QG0 - 0.26, (QZ0 + QZ1) / 2))
    ring_hi = [Vector((s * xin, QG1, QZ0)), Vector((s * (xo + 0.03), QG1, QZ0 - 0.03)),
               Vector((s * (xo + 0.03), QG1, QZ1 + 0.03)), Vector((s * xin, QG1, QZ1))]
    ring_lo = [Vector((s * xin, QG0, QZ0)), Vector((s * xo, QG0, QZ0)), Vector((s * xo, QG0, QZ1)), Vector((s * xin, QG0, QZ1))]
    for a, b in zip(ring_hi, ring_hi[1:] + ring_hi[:1]):
        face(FITTINGS, [a, b, top], ACCENT, (a + b) / 2 - Vector((s * xin, 3.0, (QZ0 + QZ1) / 2)))
    for a, b in zip(ring_lo, ring_lo[1:] + ring_lo[:1]):
        face(FITTINGS, [a, b, bot], GILT, (a + b) / 2 - Vector((s * xin, 2.6, (QZ0 + QZ1) / 2)))

# The rudder, hung on the sternpost, its head up into the counter.
rz = lambda y: ends(y)[0] - 0.012
rudder = [(0.05, rz(0.05)), (0.05, rz(0.05) - 0.34), (1.0, rz(1.0) - 0.26), (1.9, rz(1.9) - 0.14), (2.0, rz(2.0) - 0.02)]
pts = [(y, z) for y, z in rudder]
for s in (1, -1):
    face(FITTINGS, [(s * 0.035, y, z) for y, z in pts], TAR, (s, 0, 0))
for (y0, z0), (y1, z1) in zip(pts, pts[1:] + pts[:1]):
    q = [(0.035, y0, z0), (0.035, y1, z1), (-0.035, y1, z1), (-0.035, y0, z0)]
    c = Vector(((0, (y0 + y1) / 2, (z0 + z1) / 2)))
    face(FITTINGS, q, TAR, c - Vector((0, 1.0, rz(1.0) - 0.15)))

# ---- the sides: wales' ports, channels, catheads ----------------------------------------
def on_side(sign, z0, z1, y0, y1, mat, off=0.012):
    pts = []
    for z, y in ((z0, y0), (z1, y0), (z1, y1), (z0, y1)):
        pts.append((sign * (side(z, y) + off), y, z))
    face(FITTINGS, pts, mat, (sign, 0, 0))


LADDER_Z = (GAP[1] - 0.1, 3.3)          # the accommodation ladder, which the ports leave clear
for sign in (1, -1):
    for z in [-4.6 + k for k in range(10)]:
        if sign < 0 and LADDER_Z[0] - 0.15 < z < LADDER_Z[1] + 0.15:
            continue
        yc = 1.53 + 0.21 * sheer(z)
        on_side(sign, z - 0.1, z + 0.1, yc - 0.1, yc + 0.1, ACCENT)
    for z in (-1.3, -2.3, -3.25, -4.35):
        on_side(sign, z - 0.08, z + 0.08, 2.5, 2.66, ACCENT)
    # the hawse holes, two on each bow
    for z in (5.62, 5.84):
        on_side(sign, z - 0.05, z + 0.05, 2.1, 2.2, DARK, 0.01)

CHANNELS = {'main': (-0.35, 1.05, 2.26), 'fore': (3.7, 4.85, 2.5), 'mizzen': (-3.85, -2.8, 2.72)}
for sign in (1, -1):
    for z0, z1, y in CHANNELS.values():
        zs = [z0 + (z1 - z0) * k / 4 for k in range(5)]
        a = [Vector((sign * (side(z, y) - 0.02), y, z)) for z in zs]
        b = [Vector((sign * (side(z, y) + 0.19), y, z)) for z in zs]
        for i in range(4):
            for yy, n in ((y + 0.04, 1), (y, -1)):
                face(FITTINGS, [a[i] + Vector((0, yy - y, 0)), b[i] + Vector((0, yy - y, 0)),
                                b[i + 1] + Vector((0, yy - y, 0)), a[i + 1] + Vector((0, yy - y, 0))], YARD, (0, n, 0))
            face(FITTINGS, [b[i], b[i + 1], b[i + 1] + Vector((0, 0.04, 0)), b[i] + Vector((0, 0.04, 0))], YARD, (sign, 0, 0))

# The catheads, a beam out over each bow to hang an anchor from.
CAT = {}
for sign in (1, -1):
    a = Vector((sign * 0.55, 2.74, 5.12))
    b = Vector((sign * 1.08, 2.82, 5.42))
    box(FITTINGS, (a + b) / 2, (0.1, 0.1, (b - a).length), YARD, ry=math.atan2(b.x - a.x, b.z - a.z))
    box(FITTINGS, b + Vector((0, 0, 0)), (0.12, 0.12, 0.05), GILT, ry=math.atan2(b.x - a.x, b.z - a.z))
    CAT[sign] = b

# The spare anchor, catted on the port bow: shank, stock, arms and flukes.
ax, az = CAT[1].x, CAT[1].z
rod(FITTINGS, (ax, 2.76, az), (ax, 1.82, az), 0.05, IRON)
box(FITTINGS, (ax, 2.62, az), (0.44, 0.06, 0.06), YARD)
for s in (-1, 1):
    tip = Vector((ax, 2.04, az + s * 0.25))
    rod(FITTINGS, (ax, 1.8, az), tip, 0.045, IRON)
    box(FITTINGS, tip + Vector((0, -0.02, -s * 0.02)), (0.1, 0.1, 0.02), IRON, rx=s * 0.9)
tube(FITTINGS, [(ax, 2.72, az), (ax, 2.8, az)], [0.04, 0.04], IRON, sides=6)

# ---- the beakhead ----------------------------------------------------------------------
knee = [(6.06, 1.15), (6.55, 1.42), (6.92, 1.72), (7.12, 2.0), (7.16, 2.14), (6.95, 2.2), (6.4, 2.28)]
pts = [(y, z) for z, y in knee]
for s in (1, -1):
    face(FITTINGS, [(s * 0.045, y, z) for y, z in pts], TOPSIDES, (s, 0, 0))
for (y0, z0), (y1, z1) in zip(pts, pts[1:] + pts[:1]):
    q = [(0.045, y0, z0), (0.045, y1, z1), (-0.045, y1, z1), (-0.045, y0, z0)]
    face(FITTINGS, q, GILT, Vector((0, (y0 + y1) / 2, (z0 + z1) / 2)) - Vector((0, 1.85, 6.6)))
# the grating on top of the head, and the head rails sweeping down to the lion's back
slab(FITTINGS, [(-0.42, 6.28), (0.42, 6.28), (0.1, 7.02), (-0.1, 7.02)], 2.18, 2.22, YARD, top=DARK)
for s in (1, -1):
    for y0 in (2.66, 2.42):
        pts = [Vector((s * side(5.7, y0), y0, 5.7)), Vector((s * 0.32, y0 - 0.2, 6.5)), Vector((s * 0.1, y0 - 0.3, 7.02))]
        for p, q in zip(pts, pts[1:]):
            rod(FITTINGS, p, q, 0.045, ACCENT)
# The red lion, rearing, with a gilt crown.
box(FITTINGS, (0, 2.32, 7.26), (0.15, 0.36, 0.17), LION, rx=-0.55)
box(FITTINGS, (0, 2.58, 7.4), (0.2, 0.18, 0.12), LION, rx=-0.3)
box(FITTINGS, (0, 2.6, 7.47), (0.13, 0.13, 0.14), LION, rx=-0.2)
box(FITTINGS, (0, 2.555, 7.56), (0.07, 0.06, 0.05), LION)
box(FITTINGS, (0, 2.7, 7.46), (0.1, 0.05, 0.1), GILT)
for s in (1, -1):
    rod(FITTINGS, (s * 0.05, 2.42, 7.36), (s * 0.05, 2.5, 7.56), 0.045, LION)
    rod(FITTINGS, (s * 0.05, 2.12, 7.18), (s * 0.05, 1.98, 7.24), 0.05, LION)

# ---- on deck ----------------------------------------------------------------------------
# Two hatches with gratings in the waist, the main capstan, the windlass on the forecastle
# for the cable, and the belfry over the forecastle's break.
for z0, z1, w in ((1.08, 1.58, 0.36), (2.08, 2.5, 0.3)):
    box(FITTINGS, (0, 2.135, (z0 + z1) / 2), (2 * w, 0.07, z1 - z0), YARD, bottom=False)
    face(FITTINGS, [(-w + 0.04, 2.172, z0 + 0.04), (w - 0.04, 2.172, z0 + 0.04), (w - 0.04, 2.172, z1 - 0.04),
                    (-w + 0.04, 2.172, z1 - 0.04)], DARK, (0, 1, 0))
tube(FITTINGS, [(0, 2.1, -0.18), (0, 2.28, -0.18)], [0.11, 0.09], YARD, sides=8)
tube(FITTINGS, [(0, 2.28, -0.18), (0, 2.33, -0.18)], [0.15, 0.15], YARD, sides=8)
for s in (1, -1):
    box(FITTINGS, (s * 0.52, 2.78, 4.85), (0.08, 0.36, 0.08), YARD, bottom=False)
tube(FITTINGS, [(-0.48, 2.76, 4.85), (0.48, 2.76, 4.85)], [0.08, 0.08], SPAR, sides=8)
for s in (1, -1):
    rod(FITTINGS, (s * 0.13, 2.6, 3.34), (s * 0.13, 3.0, 3.34), 0.04, YARD)
box(FITTINGS, (0, 3.02, 3.34), (0.34, 0.04, 0.08), ACCENT)
tube(FITTINGS, [(0, 2.95, 3.34), (0, 2.8, 3.34)], [0.02, 0.07], GILT, sides=8)

# ---- the accommodation ladder ----------------------------------------------------------
# Down the starboard side from the entry port to a float at the waterline, which is how you
# would come aboard from a boat. A platform through the port, open treads with two strings
# and a man-rope, and the float - drawn now, walked later (Plans/batavia.md).
LX0, LX1 = -1.74, -1.46
FLOAT_Y = W + 0.1
box(FITTINGS, ((LX0 - side(sum(GAP) / 2, 2.1) + 0.04) / 2 - 0.0, 2.075, sum(GAP) / 2),
    (abs(LX0 + side(sum(GAP) / 2, 2.1)) + 0.04, 0.05, GAP[1] - GAP[0]), YARD)
N_TREADS = 9
zh, zf = GAP[1] - 0.05, LADDER_Z[1]
for k in range(1, N_TREADS + 1):
    t = k / (N_TREADS + 1)
    y = 2.1 - t * (2.1 - FLOAT_Y)
    z = zh + t * (zf - zh)
    box(FITTINGS, ((LX0 + LX1) / 2, y - 0.015, z), (LX1 - LX0, 0.03, 0.13), YARD)
for x in (LX0, LX1):
    rod(FITTINGS, (x, 2.1, zh), (x, FLOAT_Y, zf), 0.04, YARD)
for k in range(4):
    t = k / 3
    rod(FITTINGS, (LX0, 2.1 - t * 1.0, zh + t * (zf - zh)), (LX0, 2.1 - t * 1.0 + 0.3, zh + t * (zf - zh)), 0.02, YARD)
rod(FITTINGS, (LX0, 2.4, zh), (LX0, FLOAT_Y + 0.3, zf), 0.018, ROPE)
FLOAT = (-2.1, -1.44, zf - 0.02, zf + 0.5)
box(FITTINGS, ((FLOAT[0] + FLOAT[1]) / 2, FLOAT_Y - 0.03, (FLOAT[2] + FLOAT[3]) / 2),
    (FLOAT[1] - FLOAT[0], 0.06, FLOAT[3] - FLOAT[2]), YARD)
for x in (FLOAT[0] + 0.1, FLOAT[1] - 0.1):
    box(FITTINGS, (x, FLOAT_Y - 0.1, (FLOAT[2] + FLOAT[3]) / 2), (0.12, 0.1, FLOAT[3] - FLOAT[2] - 0.04), TAR)
STAIRS['side'] = (LX0, LX1, zf, zh, FLOAT_Y, 2.1)

# ---- the anchor cable ------------------------------------------------------------------
# From the lower starboard hawse, ahead and down into the water: she lies to it.
hx = -(side(5.62, 2.15) + 0.01)
tube(RIG, [(hx, 2.15, 5.62), (hx - 0.18, 1.5, 6.75), (hx - 0.3, 0.98, 7.7), (hx - 0.38, 0.55, 8.5)],
     [0.024, 0.024, 0.024, 0.024], ROPE, sides=6)

# ---- masts, yards and furled sails ------------------------------------------------------
# (deck, z, lower mast top, its top's height and radius, topmast top, crosstrees, topgallant
# top, truck). The main truck is 11.5 above the water, the fore 10.3, the mizzen 7.7.
MASTS = {
    'fore': dict(z=4.35, deck=2.6, lower=5.8, top=5.5, tr=0.4, topmast=8.95, cross=8.65, tg=11.15, truck=11.32, r=0.095),
    'main': dict(z=0.35, deck=2.1, lower=6.3, top=6.0, tr=0.46, topmast=9.75, cross=9.45, tg=12.32, truck=12.5, r=0.105),
    'mizzen': dict(z=-3.25, deck=2.65, lower=6.1, top=5.85, tr=0.3, topmast=8.55, cross=None, tg=None, truck=8.72, r=0.075),
}
for m in MASTS.values():
    z, r = m['z'], m['r']
    spar(RIG, (0, m['deck'], z), (0, m['lower'], z), r, r * 0.8, SPAR)
    # the top: a round platform with a rim, as the Dutch built them
    tube(RIG, [(0, m['top'] - 0.05, z), (0, m['top'], z)], [m['tr'], m['tr']], YARD, sides=8)
    for k in range(8):
        a = 2 * math.pi * k / 8
        b = 2 * math.pi * (k + 1) / 8
        p0 = Vector((math.cos(a) * m['tr'], m['top'], z + math.sin(a) * m['tr']))
        p1 = Vector((math.cos(b) * m['tr'], m['top'], z + math.sin(b) * m['tr']))
        up = Vector((0, 0.13, 0))
        c = Vector((0, m['top'], z))
        face(RIG, [p0, p1, p1 + up, p0 + up], ACCENT, (p0 + p1) / 2 - c)
        face(RIG, [p0 * 0.93 + c * 0.07, p1 * 0.93 + c * 0.07, p1 * 0.93 + c * 0.07 + up, p0 * 0.93 + c * 0.07 + up],
             ACCENT, c - (p0 + p1) / 2)
    box(RIG, (0, m['lower'] + 0.03, z + 0.03), (0.16, 0.08, 0.26), YARD)
    tm = m['topmast']
    spar(RIG, (0, m['top'] - 0.05, z + 0.08), (0, tm, z + 0.08), r * 0.62, r * 0.45, SPAR)
    if m['cross']:
        box(RIG, (0, m['cross'], z + 0.08), (0.62, 0.035, 0.05), YARD)
        box(RIG, (0.18, m['cross'] + 0.035, z + 0.08), (0.04, 0.035, 0.34), YARD)
        box(RIG, (-0.18, m['cross'] + 0.035, z + 0.08), (0.04, 0.035, 0.34), YARD)
        spar(RIG, (0, m['cross'] - 0.05, z + 0.16), (0, m['tg'], z + 0.16), r * 0.38, r * 0.27, SPAR, sides=6)
        head, hz = m['tg'], z + 0.16
    else:
        head, hz = tm, z + 0.08
    tube(RIG, [(0, head, hz), (0, head + 0.05, hz)], [0.04, 0.04], YARD, sides=6)
    rod(RIG, (0, head + 0.05, hz), (0, m['truck'], hz), 0.022, SPAR)
    m['head'], m['hz'] = head, hz


def furled(y, z, half, r):
    """A sail furled on its yard: a bundle of canvas lying on top of it, fattest amidships."""
    xs = [-0.9, -0.45, 0, 0.45, 0.9]
    rr = [0.45, 0.85, 1.0, 0.85, 0.45]
    tube(RIG, [(x * half, y + r * 0.7, z - 0.01) for x in xs], [k * r for k in rr], CANVAS, sides=6)


def yard(y, z, half, r, sail=True):
    spar(RIG, (0, y, z), (half, y, z), r, r * 0.55, YARD, caps=False)
    spar(RIG, (0, y, z), (-half, y, z), r, r * 0.55, YARD, caps=False)
    if sail:
        furled(y, z, half * 0.92, r * 1.6 + 0.02)


# The yards are shorter than the real ones (her main yard was ~25 m, 3.1 a side) on purpose:
# the three ships an island earns lie five cells apart on the roads (a plot of four and a cell
# of water), and a main yard over 2.5 a side would lock yardarms with the next ship's. 2.35
# leaves room for her roll.
YARDS = [  # mast, height, half length, radius, carries a sail
    ('main', 5.85, 2.35, 0.06, True), ('main', 8.95, 1.85, 0.048, True), ('main', 11.3, 1.15, 0.036, True),
    ('fore', 5.3, 2.15, 0.056, True), ('fore', 8.15, 1.65, 0.045, True), ('fore', 10.3, 1.0, 0.034, True),
    ('mizzen', 5.5, 1.5, 0.042, False), ('mizzen', 7.85, 1.0, 0.036, True),
]
for mast, y, half, r, sail in YARDS:
    m = MASTS[mast]
    zz = m['z'] + (0.2 if y < m['top'] else 0.24)
    yard(y, zz, half, r, sail)
# The mizzen's lateen yard, slung fore and aft beside the mast with its sail furled along it.
la, lb = Vector((0.13, 3.75, -1.3)), Vector((0.13, 7.25, -5.4))
spar(RIG, la, (la + lb) / 2, 0.035, 0.05, YARD)
spar(RIG, (la + lb) / 2, lb, 0.05, 0.03, YARD)
d = (lb - la).normalized()
tube(RIG, [la + d * 0.5 + Vector((0, 0.07, 0)), (la + lb) / 2 + Vector((0, 0.1, 0)), lb - d * 0.6 + Vector((0, 0.07, 0))],
     [0.04, 0.085, 0.035], CANVAS, sides=6)

# The bowsprit, rising at thirty degrees over the head, its spritsail yard slung under it
# and the spritsail topmast standing on its end.
BS0, BS1 = Vector((0, 2.62, 5.12)), Vector((0, 4.62, 8.62))
spar(RIG, BS0, BS1, 0.08, 0.042, SPAR)
bs = lambda z: BS0 + (BS1 - BS0) * ((z - BS0.z) / (BS1.z - BS0.z))
yard(bs(7.7).y - 0.34, 7.7, 1.6, 0.042)
rod(RIG, bs(7.7), bs(7.7) - Vector((0, 0.3, 0)), 0.03, ROPE)
tube(RIG, [(0, 4.55, 8.52), (0, 4.6, 8.52)], [0.16, 0.16], YARD, sides=8)
spar(RIG, (0, 4.55, 8.52), (0, 5.75, 8.52), 0.035, 0.025, SPAR, sides=6)
yard(5.45, 8.6, 0.95, 0.03)
rod(RIG, (0, 5.75, 8.52), (0, 6.08, 8.52), 0.018, SPAR)

# ---- standing rigging -------------------------------------------------------------------
ROPE_T = 0.02
SHROUDS = {'main': 5, 'fore': 4, 'mizzen': 3}
for name, n in SHROUDS.items():
    m = MASTS[name]
    z0, z1, cy = CHANNELS[name]
    for sign in (1, -1):
        feet = []
        for k in range(n):
            z = z0 + 0.12 + (z1 - z0 - 0.24) * k / max(1, n - 1)
            feet.append(Vector((sign * (side(z, cy) + 0.16), cy + 0.04, z)))
        head = Vector((sign * 0.1, m['top'] - 0.1, m['z']))
        for f in feet:
            rod(RIG, f, head, ROPE_T, ROPE)
        for t in (0.2, 0.4, 0.6, 0.8):
            a, b = feet[0].lerp(head, t), feet[-1].lerp(head, t)
            rod(RIG, a, b, 0.012, ROPE)
        # the topmast shrouds, from the rim of the top to the topmast head
        for dz in (-0.14, 0.0, 0.14):
            rod(RIG, (sign * (m['tr'] - 0.04), m['top'] + 0.1, m['z'] + dz), (sign * 0.07, m['topmast'] - 0.12, m['z'] + 0.08),
                0.016, ROPE)
        if m['cross']:
            for dz in (-0.1, 0.1):
                rod(RIG, (sign * 0.28, m['cross'] + 0.04, m['z'] + 0.08 + dz), (sign * 0.04, m['tg'] - 0.1, m['z'] + 0.16),
                    0.012, ROPE)
        # a backstay from the topmast head to the channel's after end
        rod(RIG, (sign * 0.08, m['topmast'] - 0.2, m['z'] + 0.08),
            (sign * (side(z0 + 0.05, cy) + 0.14), cy + 0.04, z0 + 0.05), 0.016, ROPE)

STAYS = [
    ((0, 6.05, 0.4), (0.3, 2.95, 5.8)),                    # main stay, past the foremast to the bow
    ((0, 9.6, 0.43), (0, 5.62, 4.28)),                     # main topmast stay, to the fore top
    ((0, 12.1, 0.51), (0, 8.9, 4.43)),                     # main topgallant stay
    ((0, 5.55, 4.4), bs(6.9)),                             # fore stay, to the bowsprit
    ((0, 8.8, 4.43), bs(8.3)),                             # fore topmast stay
    ((0, 11.0, 4.51), (0, 5.72, 8.52)),                    # fore topgallant stay, to the spritsail topmast
    ((0, 5.75, -3.2), (0, 3.6, 0.25)),                     # mizzen stay, to the mainmast
    ((0, 8.4, -3.17), (0, 6.1, 0.3)),                      # mizzen topmast stay, to the main top
]
for a, b in STAYS:
    rod(RIG, a, b, 0.022, ROPE)

# The ensign staff on the poop, the jack's on the spritsail topmast, the flags' own staffs.
ENSIGN_Z = TRANSOM_Z + 0.1
rod(RIG, (0, 3.1, ENSIGN_Z), (0, 5.36, ENSIGN_Z - 0.02), 0.035, SPAR)

# ---- the flags --------------------------------------------------------------------------
FLAGS = []


def flag(name, hoist, length, height, stripes, segs, taper=0.0):
    """A flag hung by the middle of its hoist, flying aft: stripes top to bottom, cut into
    `segs` along the fly so that batavia.js can wave it, and faced both ways - the island's
    material is single sided and a flag is seen from both. `taper` narrows it to a pennant."""
    hoist = Vector(hoist)
    p = Part(name, origin=hoist)
    n = len(stripes)
    for k, mat in enumerate(stripes):
        for s in range(segs):
            def at(t, frac):
                h = height * (1 - taper * t)
                return Vector((0, hoist.y + h / 2 - frac * h, hoist.z - t * length))
            q = [at(s / segs, k / n), at((s + 1) / segs, k / n), at((s + 1) / segs, (k + 1) / n), at(s / segs, (k + 1) / n)]
            face(p, q, mat, (1, 0, 0))
            face(p, q, mat, (-1, 0, 0))
    FLAGS.append(p)


TRICOLOUR = [ORANGE, WHITE, BLUE]
flag('flag ensign', (0, 5.0, ENSIGN_Z - 0.02), 1.05, 0.66, TRICOLOUR, 6)
flag('flag jack', (0, 5.9, 8.52), 0.46, 0.3, TRICOLOUR, 4)
flag('flag main', (0, 12.26, MASTS['main']['hz']), 0.72, 0.44, TRICOLOUR, 5)
flag('pennant fore', (0, 11.26, MASTS['fore']['hz']), 1.7, 0.14, TRICOLOUR, 8, taper=0.9)
flag('pennant mizzen', (0, 8.66, MASTS['mizzen']['hz']), 1.35, 0.12, TRICOLOUR, 7, taper=0.9)

# ---- build ------------------------------------------------------------------------------
static = [p.build() for p in (HULL, *LIVERY.values(), FITTINGS, *TRIM.values(), RIG)]
for p in FLAGS:
    p.build()

# ---- measured: the decks, the ladders, the masts ----------------------------------------
bpy.context.view_layer.update()
deps = bpy.context.evaluated_depsgraph_get()
trees = [BVHTree.FromObject(o, deps) for o in static]


def ray_down(x, z, above):
    """The first surface under (x, above, z), in island units, or None."""
    best = None
    for t in trees:
        hit = t.ray_cast(xyz((x, above, z)), Vector((0, 0, -1)))
        if hit[0] is not None and (best is None or hit[0].z > best):
            best = hit[0].z
    return best


def anchor(name, p):
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = xyz(p)
    scene.collection.objects.link(e)


def measured(name, x0, x1, z0, z1, design):
    """The planking under a rectangle, found by rays at its corners, edges and middle. A ray
    may land on a ladder, a post or a hatch standing on the deck, but none may fall through
    it, and most have to find the planking at the height it was built at."""
    xs, zs = (x0 + 0.03, (x0 + x1) / 2, x1 - 0.03), (z0 + 0.03, (z0 + z1) / 2, z1 - 0.03)
    hits = [ray_down(x, z, design + 0.2) for x in xs for z in zs]
    if any(y is None or y < design - 1e-4 for y in hits) or sum(abs(y - design) < 1e-4 for y in hits) < 6:
        raise ValueError(f'batavia: the deck {name} is at {hits}, not {design}')
    return design


def deck_rect(name, deck, z0, z1, x0=None, x1=None):
    """The widest rectangle between the bulwarks over [z0, z1], a hand's breadth clear."""
    if x0 is None:
        half = min(inner(z0 + (z1 - z0) * k / 8, deck) for k in range(9)) - 0.04
        x0, x1 = -half, half
    y = measured(name, x0, x1, z0, z1, deck)
    anchor(f'deck.{name}.lo', (x0, y, z0))
    anchor(f'deck.{name}.hi', (x1, y, z1))
    return (x0, x1, z0, z1, y)


DECK_RECTS = {
    'waist': deck_rect('waist', 2.1, Z_QD, Z_FC),
    'forecastle': deck_rect('forecastle', 2.6, Z_FC, 4.2),
    'forecastle-mid': deck_rect('forecastle-mid', 2.6, 4.2, 5.0),
    'forecastle-bow': deck_rect('forecastle-bow', 2.6, 5.0, 5.75),
    'quarterdeck': deck_rect('quarterdeck', 2.65, Z_POOP, Z_QD),
    'poop': deck_rect('poop', 3.1, -5.2, Z_POOP),
    'poop-aft': deck_rect('poop-aft', 3.1, TRANSOM_Z + TH + 0.02, -5.2),
    'gangway': deck_rect('gangway', 2.1, GAP[0], GAP[1], LX0, -side(GAP[0], 2.1) + 0.06),
}
# The float is measured off its own top, which is not the deck the gangway is.
fy = [ray_down(x, z, FLOAT_Y + 0.2) for x in (FLOAT[0] + 0.05, FLOAT[1] - 0.05) for z in (FLOAT[2] + 0.05, FLOAT[3] - 0.05)]
if any(y is None or abs(y - FLOAT_Y) > 1e-4 for y in fy):
    raise ValueError(f'batavia: the float is at {fy}, not {FLOAT_Y}')
anchor('deck.float.lo', (FLOAT[0], FLOAT_Y, FLOAT[2]))
anchor('deck.float.hi', (FLOAT[1], FLOAT_Y, FLOAT[3]))

for name, (x0, x1, zf, zh, yf, yh) in STAIRS.items():
    step = 0.04 if zh > zf else -0.04
    foot = ray_down((x0 + x1) / 2, zf - step, yf + 0.05)
    head = ray_down((x0 + x1) / 2, zh + step * 2, yh + 0.05)
    if foot is None or head is None or abs(foot - yf) > 1e-4 or abs(head - yh) > 1e-4:
        raise ValueError(f'batavia: the ladder {name} runs from {foot} to {head}, not {yf} to {yh}')
    inboard, outboard = (x0, x1) if abs(x0) < abs(x1) else (x1, x0)
    anchor(f'stair.{name}.lo', (inboard, foot, zf))
    anchor(f'stair.{name}.hi', (outboard, head, zh))

for name, m in MASTS.items():
    anchor(f'mast.{name}', (0, m['deck'], m['z']))
anchor('waterline', (0, W, 0))

top = max((o.matrix_world @ Vector(c)).z for o in scene.objects if o.type == 'MESH' for c in o.bound_box)
scene['building_height'] = top
scene.unit_settings.system = 'NONE'
scene.unit_settings.scale_length = 1
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'batavia.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'batavia'})

tris = 0
for o in scene.objects:
    if o.type == 'MESH':
        o.data.calc_loop_triangles()
        tris += len(o.data.loop_triangles)
print(f'batavia: {tris} triangles, top {top:.3f} ({top - W:.3f} above the water)', flush=True)
for name, r in DECK_RECTS.items():
    print(f'  deck {name}: x {r[0]:.3f}..{r[1]:.3f} z {r[2]:.3f}..{r[3]:.3f} at {r[4]:.3f} ({r[4] - W:.3f} above the water)')

# ---- previews ---------------------------------------------------------------------------
if PREVIEW_DIR:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    # Vertex colours for the previews only, after the bake: workbench shows the galleon's
    # painted mesh by its vertex colours, so this ship has to be shown the same way.
    for o in list(scene.objects):
        if o.type != 'MESH':
            continue
        attr = o.data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
        o.data.color_attributes.active_color = attr
        for poly in o.data.polygons:
            c = o.data.materials[poly.material_index].diffuse_color
            for li in poly.loop_indices:
                attr.data[li].color = c
    sea = bpy.data.meshes.new('sea')
    sea.from_pydata([xyz((-40, W, -40)), xyz((40, W, -40)), xyz((40, W, 40)), xyz((-40, W, 40))], [], [[0, 3, 2, 1]])
    so = bpy.data.objects.new('sea', sea)
    scene.collection.objects.link(so)
    sa = sea.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
    for d in sa.data:
        d.color = (0.05, 0.18, 0.26, 1)

    def figure(p, colour=(0.55, 0.12, 0.08, 1)):
        """A settler for scale: 0.43 tall, like the island's own."""
        m = bpy.data.meshes.new('settler')
        pts, faces = [], []
        for c, s in (((0, 0.1, 0), (0.1, 0.2, 0.07)), ((0, 0.28, 0), (0.13, 0.16, 0.08)), ((0, 0.39, 0), (0.08, 0.08, 0.08))):
            base = len(pts)
            for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
                pts.append(xyz((p[0] + c[0] + x * s[0] / 2, p[1] + c[1] + y * s[1] / 2, p[2] + c[2] + z * s[2] / 2)))
            faces += [[base + i for i in f] for f in ((0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (2, 6, 7, 3), (1, 5, 6, 2), (0, 3, 7, 4))]
        m.from_pydata(pts, [], faces)
        m.update()
        for poly in m.polygons:
            poly.flip() if poly.normal.dot(poly.center - xyz((p[0], p[1] + 0.25, p[2]))) < 0 else None
        o = bpy.data.objects.new('settler', m)
        scene.collection.objects.link(o)
        a = m.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
        for d in a.data:
            d.color = colour
        return o

    for p in ((0.5, 2.1, 1.9), (-0.9, 2.1, 0.9), (0.3, 2.65, -2.1), (-0.3, 3.1, -4.6), (0.2, 2.6, 3.9), (-1.6, FLOAT_Y, 3.35)):
        figure(p)
    galleon = None
    if 'galleon' in VIEWS or 'pair' in VIEWS:
        with bpy.data.libraries.load(str(ROOT / 'assets/pirateship/pirateship.blend')) as (src, dst):
            dst.objects = [n for n in src.objects if n == 'pirateship hull']
        galleon = dst.objects[0]
        scene.collection.objects.link(galleon)
        galleon.hide_render = True
    # The fleet: the second and third ships beside her, repainted the way buildings.js
    # repaints them (SHIP_LIVERIES there is the one copy; these are only for looking at).
    fleet = []
    if 'fleet' in VIEWS:
        def lin(c):
            return [(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4) for v in (((c >> s) & 255) / 255 for s in (16, 8, 0))]
        LIVERIES = [{'topsides': 0x4b3b2d, 'panel': 0x2d4b7c, 'accent': 0xc49a36},
                    {'topsides': 0x6c4a2f, 'panel': 0x8c2d24, 'accent': 0x262220}]
        ours = [o for o in scene.objects if o.type == 'MESH' and o.name.startswith('batavia ')]
        for k, livery in enumerate(LIVERIES):
            for o in ours:
                c = o.copy()
                c.data = o.data.copy()
                c.location = o.location + xyz(((k + 1) * 5.5, 0, 0))
                role = o.name.split(' ')[-1] if o.name.startswith(('batavia livery', 'batavia trim')) else None
                if role in livery:
                    for d in c.data.color_attributes.active_color.data:
                        d.color = (*lin(livery[role]), 1)
                scene.collection.objects.link(c)
                c.hide_render = True
                fleet.append(c)

    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = True
    sh.shadow_intensity = 0.3
    sh.show_cavity = True
    sh.cavity_type = 'BOTH'
    sh.show_backface_culling = True
    sh.background_type = 'VIEWPORT'
    sh.background_color = (0.62, 0.74, 0.86)
    scene.display.render_aa = '16'
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x, scene.render.resolution_y = 1600, 1000
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    scene.collection.objects.link(cam)
    scene.camera = cam
    SHOTS = {   # where the camera stands and what it looks at, island coordinates, and the lens
        'side': ((-30, 6.0, 0.9), (0, 6.0, 0.9), 45),
        'quarter': ((-15, 7.0, -14), (0, 4.8, 0.5), 30),
        'stern': ((-4.5, 4.4, -10.5), (0, 3.0, -5.6), 45),
        'bow': ((-5.5, 4.6, 12.5), (0, 3.2, 5.6), 40),
        'galleon': ((-42, 6.5, -7.5), (0, 5.2, -7.5), 40),
        'pair': ((4.5, 10, -30), (4.5, 4.4, 0), 34),
        'top': ((0, 34, 0.01), (0, 0, 0), 50),
        'deck': ((0.6, 3.75, -5.6), (0, 2.8, 2.5), 22),
        'fleet': ((-14, 9, -24), (6, 3.6, -1), 34),
    }
    for view in VIEWS:
        for c in fleet:
            c.hide_render = view != 'fleet'
        if galleon:
            galleon.hide_render = view not in ('galleon', 'pair')
            # at the same waterline (its keel is 1.469 under its water): astern of her for the
            # side view, abeam to port for the pair, each as far from the camera as she is
            galleon.location = xyz((0, W - 12.29 * 7 / 58.56, -16.0) if view == 'galleon' else (9.0, W - 12.29 * 7 / 58.56, 0))
        eye, look, lens = SHOTS[view]
        cam.data.lens = lens
        cam.location = xyz(eye)
        cam.rotation_euler = (xyz(look) - xyz(eye)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(PREVIEW_DIR / f'batavia-{view}.png')
        bpy.ops.render.render(write_still=True)
