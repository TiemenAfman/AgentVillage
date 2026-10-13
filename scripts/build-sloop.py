"""The sloop: every island's first boat, the ship a settler sails, walks, climbs and fights from.

    node scripts/blender.mjs --background --python scripts/build-sloop.py
    node scripts/blender.mjs --background --python scripts/build-sloop.py -- <dir> [views]

The second form also renders previews into <dir>, one PNG per view (side, quarter, stern, bow, top,
deck, cabin, port, nest, iso, pair beside the Batavia, and lines, under and keel without the sea; side,
quarter, top and pair when none are named), with settler-sized stand-ins on her decks; `nobake` among the
views renders without saving the .blend or baking the module, `nocavity` without the workbench's edge
shading. Plans/nieuwe-sloep.md has the why and the decisions; assets/pirateship/README.md what she bakes as.

She replaces the galleon that was a decimated Sketchfab download (scripts/build-pirateship.py, gone):
its gun ports were holes through the hull, its rail one yellow beam, and the rope ladder ended on top
of the bulwark where no clip can step off. The keeper bought a Sea of Thieves sloop to measure her by -
**only to measure by**: scripts/measure-sloop.py read it once into refs/sloop/measure.json (outside git,
like the model itself), and the numbers below are typed from that, as literals. Nothing of its mesh is
in here and nothing of it may ever be.

**The set and its parts keep the galleon's names** (`pirateship`, `pirateship hull`): web/js/boat.js,
web/js/models.js, scripts/build-craft.mjs and build-shipwalk.mjs find her by them, and a name on the
wire is never renamed for a new model. What she bakes as:

    pirateship hull    everything that can be touched, one material (`plain:pirateship paint`), the
                       colours as a CORNER attribute `Paint` - boat.js welds her into one geometry
                       with her ladders and guns, and that merge carries no texture sheet
    pirateship glow    her window glass and lantern lights, emissive (lit after dark)
    pirateship sail    the mainsail, a regular grid hung from its yard (the part's origin on the yard's
                       middle, every corner at or under it), which web/js/ship-motion.js furls and sets
    pirateship flag    the flag at the masthead, hung by its luff at the part's origin

**One frame, keel at y = 0** (island coordinates through xyz(): x across with +x starboard, y up, z
towards the bow), the origin in the middle of her hull, and the waterline `W` baked as
`anchor.waterline`, as the Batavia's. Faces are wound outward on purpose: the island's material is
single sided, so a bulwark seen from the deck needs faces of its own.

Byte for byte the same on every run, by construction: no bpy.ops on geometry, no join, every face
built from these numbers in one order, so `npm run models` twice changes nothing.
"""
import bpy
import json
import math
import re
import runpy
import sys
from pathlib import Path
from mathutils import Vector, Matrix

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/pirateship'
args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
PREVIEW_DIR = Path(args[0]).resolve() if args else None
VIEWS = [v for v in args[1:] if v not in ('nobake', 'nocavity')] or ['side', 'quarter', 'top', 'pair']
BAKE = 'nobake' not in args

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def lin(color):
    """An sRGB hex colour as the linear RGBA the bake carries (the exporter writes what it is given)."""
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1.0,)


# ---- the palette ------------------------------------------------------------------------
# Natural wood, as a sloop that is somebody's own and not a navy's: warm planking in two tones a
# strake, a tarred bottom, black wales, ochre trim, the deck pale.
#
# Every colour belongs to a zone, and the zones are baked with her (a `zone` index per face, the names
# and base colours on the part as `zoneNames`, scripts/export-models.py): a later piece of work can let
# a player paint her - new colour / base colour, times what each corner carries - without the bake
# knowing who paints her. A shade inside a zone (the planks' butts, the two tones a strake) is the
# corner's colour over the zone's base, so it survives a repaint.
ZONES = {
    'planks': 0x93633b,     # her topsides, strake by strake
    'bottom': 0x3a2e25,     # the tarred bottom under the water
    'boot': 0x241c17,       # the dark band at the waterline
    'wales': 0x22180f,      # the two heavy strakes
    'trim': 0xb08840,       # mouldings, window frames, the cap's edge
    'spine': 0x2e2219,      # keel, stem, sternpost
    'transom': 0x7a5230,    # the flat of the stern
    'rudder': 0x5a3a24,
    'iron': 0x2c2b2e,
    'glass': 0xffd27f,      # the island's own window glass (C.glass in web/js/buildings.js)
    'deck': 0xb89565,       # the planking walked on (its caulking is the same zone, darker)
    'inner': 0x8a5d3a,      # the inside of the bulwarks and the cabin's walls
    'cap': 0x5a3a22,        # the cap rail, stair rails and balusters
    'fittings': 0x70492b,   # stairs, beams, bulkheads, what stands on deck
    'spar': 0x8a6a45,       # mast, yard, bowsprit
    'rope': 0x4a3a2a,
    'sail': 0xe6dcc4,
    'flag': 0x1c1a1a,
    'flagmark': 0xece6d6,   # the white on the flag
}
ZONE_NAMES = list(ZONES)
PLANK_B_SHADE = 0.9         # every other strake a tone darker


def shade(zone, f):
    """A zone's base colour times f, as a hex colour."""
    c = ZONES[zone]
    r, g, b = ((c >> 16) & 255, (c >> 8) & 255, c & 255)
    return (min(255, round(r * f)) << 16) | (min(255, round(g * f)) << 8) | min(255, round(b * f))


class Part:
    """One Blender object: faces in island coordinates around its own origin, a colour and a label per
    face. The colour goes into the `Paint` attribute; the label is only counted (triangles per label)."""

    def __init__(self, name, material, origin=(0, 0, 0)):
        self.name, self.material, self.origin = f'pirateship {name}', material, Vector(origin)
        self.verts, self.faces, self.colours, self.labels, self.zones = [], [], [], [], []

    def add(self, points, colour, label, zone):
        base = len(self.verts)
        self.verts.extend(Vector(p) - self.origin for p in points)
        self.faces.append(list(range(base, base + len(points))))
        self.colours.append(lin(colour))
        self.labels.append(label)
        self.zones.append(ZONE_NAMES.index(zone))

    def build(self):
        mesh = bpy.data.meshes.new(self.name)
        mesh.from_pydata([xyz(v) for v in self.verts], [], self.faces)
        mesh.materials.append(self.material)
        attr = mesh.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
        mesh.color_attributes.active_color = attr
        for poly, c in zip(mesh.polygons, self.colours):
            poly.use_smooth = False
            for li in poly.loop_indices:
                attr.data[li].color = c
        zone = mesh.attributes.new(name='zone', type='INT', domain='FACE')
        for poly, z in zip(mesh.polygons, self.zones):
            zone.data[poly.index].value = z
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        obj['zone_names'] = json.dumps([[n, f'#{ZONES[n]:06x}'] for n in ZONE_NAMES])
        obj.location = xyz(self.origin)
        obj['building_part'] = True
        scene.collection.objects.link(obj)
        return obj

    def tris(self):
        out = {}
        for f, label in zip(self.faces, self.labels):
            out[label] = out.get(label, 0) + len(f) - 2
        return out


def material(name, emissive=False):
    m = bpy.data.materials.new(f'plain:{name}')
    m.diffuse_color = (1, 1, 1, 1)
    if emissive:
        m['emissive'] = 1.0
    return m


HULL = Part('hull', material('pirateship paint'))
GLOW = Part('glow', material('pirateship glow', emissive=True))


def newell(pts):
    n = Vector((0, 0, 0))
    for a, b in zip(pts, pts[1:] + pts[:1]):
        n.x += (a.y - b.y) * (a.z + b.z)
        n.y += (a.z - b.z) * (a.x + b.x)
        n.z += (a.x - b.x) * (a.y + b.y)
    return n


def face(pts, paint, hint, label, part=None):
    """One polygon, wound so that it faces `hint` - the island's material is single sided. A face of no
    area is dropped: the skin's rows collapse onto the keel and the stem, and that is how they end."""
    pts = [Vector(p) for p in pts]
    n = newell(pts)
    if n.length < 1e-9:
        return
    if n.dot(Vector(hint)) < 0:
        pts.reverse()
    zone, f = (paint, 1.0) if isinstance(paint, str) else paint
    (part or HULL).add(pts, shade(zone, f), label, zone)


def quad(a, b, c, d, colour, hint, label, part=None):
    """A quad that may have lost a corner: two corners on one point make it a triangle."""
    pts = []
    for p in (a, b, c, d):
        p = Vector(p)
        if not pts or (p - pts[-1]).length > 1e-7:
            pts.append(p)
    if len(pts) > 3 and (pts[-1] - pts[0]).length <= 1e-7:
        pts.pop()
    if len(pts) >= 3:
        face(pts, colour, hint, label, part)


def rotation(rx=0.0, ry=0.0, rz=0.0):
    return Matrix.Rotation(ry, 3, 'Y') @ Matrix.Rotation(rx, 3, 'X') @ Matrix.Rotation(rz, 3, 'Z')


BOX = [((-1, -1, -1), (-1, 1, -1), (-1, 1, 1), (-1, -1, 1)), ((1, -1, -1), (1, -1, 1), (1, 1, 1), (1, 1, -1)),
       ((-1, -1, -1), (-1, -1, 1), (1, -1, 1), (1, -1, -1)), ((-1, 1, -1), (1, 1, -1), (1, 1, 1), (-1, 1, 1)),
       ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1)), ((-1, -1, 1), (-1, 1, 1), (1, 1, 1), (1, -1, 1))]


def box(centre, size, colour, label, rx=0.0, ry=0.0, rz=0.0, skip=(), part=None):
    """A box about its centre; `skip` leaves out faces nobody can see (2 the bottom, 3 the top)."""
    c, m = Vector(centre), rotation(rx, ry, rz)
    for k, corners in enumerate(BOX):
        if k in skip:
            continue
        pts = [c + m @ Vector((x * size[0] / 2, y * size[1] / 2, z * size[2] / 2)) for x, y, z in corners]
        face(pts, colour, sum(pts, Vector()) / 4 - c, label, part)


def lerp_table(t, v):
    """Piecewise linear through [(key, value), ...], held flat past either end."""
    if v <= t[0][0]:
        return t[0][1]
    for (k0, v0), (k1, v1) in zip(t, t[1:]):
        if v <= k1:
            return v0 + (v1 - v0) * (v - k0) / (k1 - k0)
    return t[-1][1]


# ---- the hull's lines ---------------------------------------------------------------------
# From refs/sloop/measure.json (scripts/measure-sloop.py), scaled to a hull of 9 from stem to transom at
# the cap rail and set keel down, then rounded to the centimetre and cleaned of what the rays caught on
# the way (a cleat, a gun, a wale's edge) - the sections are her shape, not her fittings.
W = 0.83                # the waterline above the keel: the keeper's draught (checkpoint A, candidate h35)
SP = 0.07               # half the thickness of her spine - keel, stem and sternpost
PROUD = 0.012           # how far a strake's lower edge stands out over the one below: lapstrake

# Half her breadth at a height, station by station: (z, [(y, half), ...]). Below the first height the
# station is only the spine; the rows are min(starboard, port) of the measured sections, so a fitting
# on one side does not widen both. -4.5 is the transom's outline (measure.json `transom`), which the
# hull meets at its rake ('transom' below), not at -4.5.
STATIONS = [
    (-4.5, [(.58, SP), (.6, .52), (.7, .59), (.8, .67), (.9, .73), (1.0, .77), (1.2, .84), (1.6, .84), (2.0, .86), (2.2, .87)]),
    (-4.0, [(.55, SP), (.6, .47), (.7, .57), (.8, .65), (.9, .69), (1.0, .75), (1.2, .86), (1.6, .89), (1.8, .90), (2.2, .91)]),
    (-3.75, [(.55, SP), (.6, .43), (.7, .58), (.8, .67), (.9, .74), (1.0, .80), (1.2, .90), (1.4, .91), (1.6, .93), (1.8, .95), (2.2, .96)]),
    (-3.5, [(.45, SP), (.5, .20), (.6, .49), (.7, .63), (.8, .72), (.9, .79), (1.0, .84), (1.2, .95), (1.4, .96), (1.6, .97), (1.8, .99), (2.2, 1.0)]),
    (-3.0, [(.42, SP), (.5, .41), (.6, .61), (.7, .73), (.8, .82), (.9, .88), (1.0, .93), (1.2, 1.0), (1.4, 1.04), (1.6, 1.06), (1.8, 1.08), (2.0, 1.10), (3.0, 1.10)]),
    (-2.5, [(.33, SP), (.4, .28), (.5, .55), (.6, .72), (.7, .82), (.8, .90), (.9, .96), (1.0, 1.01), (1.2, 1.07), (1.4, 1.12), (1.6, 1.15), (1.8, 1.17), (2.0, 1.18), (3.0, 1.18)]),
    (-2.0, [(.33, SP), (.4, .45), (.5, .67), (.6, .80), (.7, .90), (.8, .97), (.9, 1.04), (1.0, 1.09), (1.2, 1.15), (1.4, 1.19), (1.6, 1.22), (1.8, 1.24), (2.0, 1.26), (3.0, 1.26)]),
    (-1.5, [(.24, SP), (.3, .27), (.4, .58), (.5, .75), (.6, .88), (.7, .97), (.8, 1.05), (.9, 1.11), (1.0, 1.16), (1.2, 1.22), (1.4, 1.26), (1.6, 1.28), (1.8, 1.29), (2.0, 1.31), (3.0, 1.31)]),
    (-1.0, [(.24, SP), (.3, .42), (.4, .67), (.5, .82), (.6, .94), (.7, 1.04), (.8, 1.11), (.9, 1.17), (1.0, 1.22), (1.2, 1.28), (1.4, 1.32), (1.6, 1.34), (1.8, 1.35), (3.0, 1.35)]),
    (-0.5, [(.24, SP), (.3, .51), (.4, .73), (.5, .88), (.6, .99), (.7, 1.08), (.8, 1.16), (.9, 1.22), (1.0, 1.26), (1.2, 1.33), (1.4, 1.37), (1.6, 1.38), (1.8, 1.39), (2.0, 1.40), (3.0, 1.40)]),
    (0.0, [(.24, SP), (.3, .56), (.4, .77), (.5, .91), (.6, 1.02), (.7, 1.12), (.8, 1.19), (.9, 1.26), (1.0, 1.30), (1.2, 1.36), (1.4, 1.40), (1.6, 1.42), (1.8, 1.43), (2.0, 1.44), (3.0, 1.44)]),
    (0.5, [(.25, SP), (.3, .58), (.4, .78), (.5, .92), (.6, 1.04), (.7, 1.13), (.8, 1.21), (.9, 1.28), (1.0, 1.33), (1.2, 1.38), (1.4, 1.42), (1.6, 1.44), (1.8, 1.44), (2.0, 1.46), (3.0, 1.46)]),
    (1.0, [(.26, SP), (.3, .58), (.4, .79), (.5, .94), (.6, 1.04), (.7, 1.13), (.8, 1.21), (.9, 1.28), (1.0, 1.33), (1.2, 1.38), (1.4, 1.42), (1.6, 1.44), (1.8, 1.45), (2.0, 1.47), (3.0, 1.47)]),
    (1.5, [(.27, SP), (.3, .54), (.4, .76), (.5, .91), (.6, 1.02), (.7, 1.11), (.8, 1.20), (.9, 1.25), (1.0, 1.31), (1.2, 1.37), (1.4, 1.40), (1.6, 1.42), (1.8, 1.43), (2.0, 1.45), (3.0, 1.45)]),
    (2.0, [(.28, SP), (.3, .47), (.4, .71), (.5, .87), (.6, .98), (.7, 1.07), (.8, 1.15), (.9, 1.21), (1.0, 1.27), (1.2, 1.33), (1.4, 1.36), (1.6, 1.38), (1.8, 1.39), (2.0, 1.42), (3.0, 1.42)]),
    (2.5, [(.31, SP), (.4, .60), (.5, .76), (.6, .88), (.7, .97), (.8, 1.06), (.9, 1.12), (1.0, 1.18), (1.2, 1.28), (1.4, 1.30), (1.6, 1.33), (1.8, 1.34), (2.0, 1.38), (3.0, 1.38)]),
    (3.0, [(.42, SP), (.5, .50), (.6, .66), (.7, .78), (.8, .87), (.9, .95), (1.0, 1.01), (1.2, 1.15), (1.4, 1.18), (1.6, 1.23), (1.8, 1.25), (2.0, 1.29), (3.0, 1.30)]),
    (3.25, [(.53, SP), (.6, .42), (.7, .60), (.8, .72), (.9, .81), (1.0, .89), (1.2, 1.04), (1.4, 1.09), (1.6, 1.15), (1.8, 1.18), (2.0, 1.22), (3.0, 1.24)]),
    (3.5, [(.66, SP), (.7, .23), (.8, .45), (.9, .60), (1.0, .70), (1.2, .91), (1.4, .97), (1.6, 1.03), (1.8, 1.07), (2.0, 1.12), (2.2, 1.15), (3.0, 1.17)]),
    (3.75, [(.84, SP), (.9, .22), (1.0, .41), (1.2, .64), (1.4, .78), (1.6, .87), (1.8, .92), (2.0, .96), (2.2, 1.01), (3.0, 1.04)]),
    (4.0, [(1.05, SP), (1.2, .29), (1.4, .56), (1.6, .64), (1.8, .69), (2.0, .75), (2.2, .79), (3.0, .82)]),
    (4.25, [(1.45, SP), (1.6, .28), (1.8, .37), (2.0, .43), (2.2, .52), (3.0, .56)]),
    (4.37, [(1.66, SP), (1.8, .15), (2.0, .23), (2.2, .33), (3.0, .36)]),
]


def station_half(points, y):
    return SP if y < points[0][0] else lerp_table(points, y)


def table_half(z, y):
    if z <= STATIONS[0][0]:
        return station_half(STATIONS[0][1], y)
    for (z0, p0), (z1, p1) in zip(STATIONS, STATIONS[1:]):
        if z <= z1:
            t = (z - z0) / (z1 - z0)
            return station_half(p0, y) * (1 - t) + station_half(p1, y) * t
    return station_half(STATIONS[-1][1], y)


# The spine: keel, forefoot and stem in one strip, its outer edge from aft along the bottom and up the
# cutwater (measure.json `deck_profile.keel`, the lowest point of each section, and the stem's head at
# the cap), its inner edge SPINE_D in. The keel drags: on the ground aft, 8 cm up amidships.
SPINE_OUT = [(-4.15, 0.0), (-3.5, 0.0), (-1.5, .045), (0.0, .078), (1.0, .098), (2.0, .122), (2.5, .15), (3.0, .253),
             (3.25, .355), (3.5, .494), (3.75, .675), (4.0, .891), (4.125, 1.037), (4.25, 1.187), (4.37, 1.38),
             (4.49, 1.644), (4.55, 2.0), (4.58, 2.35), (4.6, 2.72)]
SPINE_D = 0.17


def spine_inner():
    out = []
    n = len(SPINE_OUT)
    for i, (z, y) in enumerate(SPINE_OUT):
        a = SPINE_OUT[max(i - 1, 0)]
        b = SPINE_OUT[min(i + 1, n - 1)]
        dz, dy = b[0] - a[0], b[1] - a[1]
        length = math.hypot(dz, dy)
        nz, ny = -dy / length, dz / length          # the left normal: up under the keel, aft at the stem
        out.append((z + nz * SPINE_D, y + ny * SPINE_D))
    return out


SPINE_IN = spine_inner()


def keel_top(z):
    """The spine's inner edge at z: the lowest a strake may come there."""
    return lerp_table(SPINE_IN, z)


FOREFOOT = 2.5         # where the keel starts to turn up into the stem


def stem_z(y):
    """How far forward the planking reaches at a height: where the stem's inner edge is that high. Only
    the stem's own part of the spine answers - under it a strake simply ends on the keel's top, which
    keel_top() sees to - so a row below the forefoot reaches as far as the stem's foot."""
    bow = [p for p in SPINE_IN if p[0] >= FOREFOOT]
    if y <= bow[0][1]:
        return bow[-1][0]
    for (z0, y0), (z1, y1) in zip(bow, bow[1:]):
        if y0 <= y <= y1:
            return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    return bow[-1][0]


# The transom rakes aft as it rises (measure.json `transom_slope`: 20 degrees off upright); under its
# foot the run closes onto the sternpost.
TRANSOM_FOOT = 0.6
POST_Z = -3.98


def transom_z(y):
    return POST_Z if y < TRANSOM_FOOT else -4.02 - 0.371 * (y - 0.709)


# Where her side ends at the top, stern to stem: the stern well's low bulwark (2.0), the cabin's walls
# up to the quarterdeck's rail (2.95, the break at -3.05 square), down along the stair to the waist, the
# waist's bulwark 0.30 over the main deck (CAP below), and the bow rising to its head.
DECK = 2.034            # the main deck (measure.json decks.main)
QUARTER = 2.604         # the quarterdeck over the cabin
FLOOR = 1.354           # the cabin's floor and the stern well's: sunk 0.68 under the main deck
CABIN_AFT, CABIN_FORE = -3.05, -1.37
CAP = DECK + 0.30       # the waist's bulwark: over STEP_UP (0.25), under a jump (0.38)
SHEER = [(-4.6, 2.12), (-4.0, 2.02), (-3.06, 2.0), (-3.04, 2.95), (CABIN_FORE, 2.95), (-0.4, CAP),
         (1.5, CAP + .02), (3.25, CAP + .08), (3.75, 2.52), (4.2, 2.58), (4.6, 2.66)]


def sheer(z):
    return lerp_table(SHEER, z)


# Columns along her, fixed in z so every edge between two is plumb - a port's jambs, a deck's break -
# clamped between the transom and the stem at each height, where they collapse onto the ends.
COLUMNS = [-4.0, -3.75, -3.5, -3.25, -3.06, -3.04, -2.75, -2.5, -2.25, -2.0, -1.75, -1.5, CABIN_FORE, -1.0, -0.65,
           -0.3, 0.0, 0.3, 0.8, 1.15, 1.75, 2.0, 2.4, 2.8, 3.1, 3.4, 3.6, 3.8, 4.0, 4.15, 4.3, 4.4]
# Rows up her side, keel to cap: one strake each, the wales two rows apiece.
WALE_LO = [(1.2, 1.3), (1.9, 2.0)]
# The deck and a gun port's sill are rows of their own, so an opening in the bulwark has a straight foot.
SILL = DECK + 0.06
ROWS = [0.0, .32, .44, .56, .68, W, .95, 1.08, 1.2, 1.3, 1.45, 1.6, 1.75, 1.9, 2.0, DECK, SILL, 2.18, 2.34, 2.52, 2.7, 2.95]

# The openings in the waist's bulwark, a pair of each (Plans/nieuwe-sloep.md, Besluiten): the entry port by
# the mast, abaft the gun, cut down to the deck so a rope ladder ends on the planks and not on a rail; and
# the gun port, cut from a hand over the deck up to the cap rail, which runs on over it. Their jambs are
# columns of COLUMNS, so they stand plumb.
ENTRY = (0.3, 0.8)
GUNPORT = (1.15, 1.75)


def opening(c0, c1):
    """The foot of the opening between two columns (the bulwark is open above it), or None."""
    if (c0, c1) == ENTRY:
        return DECK
    if (c0, c1) == GUNPORT:
        return SILL
    return None


def skin_point(col, y, sign):
    """Where the skin is in column `col` (a z in COLUMNS, or the 'aft' or 'fore' end) at row height y.
    The ends move with the height, so the height is settled first (twice is enough: the sheer and the
    keel are gentle where an end is steep), and a point on the spine is exactly on it - a strake a hair
    wider than the keel at the keel's own top leaves a slit along her bottom."""
    def where(y):
        a, b = transom_z(y), stem_z(y)
        return a if col == 'aft' else b if col == 'fore' else min(max(col, a), b)
    for _ in range(2):
        z = where(y)
        y = min(max(y, keel_top(z)), sheer(z))
    z = where(y)
    if col == 'fore' or z >= stem_z(y) - 1e-9 or y <= keel_top(z) + 1e-9:
        x = SP
    else:
        x = max(SP, table_half(z, y))
    return Vector((sign * x, y, z))


def outward(c):
    """Away from her own axis: what every piece of her skin is wound by."""
    return c - Vector((0, min(max(c.y, 0.4), 2.6), min(max(c.z, -3.6), 3.6)))


def strake_colour(j, k):
    y = ROWS[j]
    if y < W - 1e-9:
        return 'bottom'
    if y < .95 - 1e-9:
        return 'boot'
    if any(abs(y - lo) < 1e-9 for lo, _ in WALE_LO):
        return 'wales'
    # Butts: each plank a shade of its own, by row and column, so a strake reads as boards end to end;
    # and every other strake a tone darker.
    return ('planks', (1.0 if j % 2 else PLANK_B_SHADE) * (0.92 + ((j * 73856093 ^ k * 19349663) % 9) * 0.02))


# ---- the skin -----------------------------------------------------------------------------
COLS = ['aft'] + COLUMNS + ['fore']
for sign in (1.0, -1.0):
    for k, (c0, c1) in enumerate(zip(COLS, COLS[1:])):
        for j in range(len(ROWS) - 1):
            y0, y1 = ROWS[j], ROWS[j + 1]
            if opening(c0, c1) is not None and y0 >= opening(c0, c1) - 1e-9:
                continue
            a0, a1 = skin_point(c0, y0, sign), skin_point(c1, y0, sign)
            b0, b1 = skin_point(c0, y1, sign), skin_point(c1, y1, sign)
            # Lapstrake: the strake's lower edge stands PROUD out over the one below it, and a narrow face
            # under that edge closes the step - above the water only, where it can be seen.
            lap = PROUD if y0 > 0.6 and not any(abs(y0 - hi) < 1e-9 for _, hi in WALE_LO) else 0.0
            # Not at the transom: the strakes' ends lie flush in its edge, or the corner opens a slit.
            pa0 = a0 + Vector((sign * lap if abs(a0.x) > SP + 1e-6 and c0 != 'aft' else 0, 0, 0))
            pa1 = a1 + Vector((sign * lap if abs(a1.x) > SP + 1e-6 and c1 != 'aft' else 0, 0, 0))
            c = sum([a0, a1, b0, b1], Vector()) / 4
            quad(pa0, pa1, b1, b0, strake_colour(j, k), outward(c), 'skin')
            if lap:
                quad(a0, a1, pa1, pa0, strake_colour(j, k), (0, -1, 0), 'skin')

# The wales: two heavy strakes standing WALE_OUT proud of the skin, black, the upper at the deck line.
WALE_OUT = 0.035
for lo, hi in WALE_LO:
    for sign in (1.0, -1.0):
        for c0, c1 in zip(COLS[1:-1], COLS[2:-1]):
            p = [skin_point(c, y, sign) for c in (c0, c1) for y in (lo, hi)]
            if any(abs(q.x) <= SP + 1e-6 for q in p):
                continue
            o = [q + Vector((sign * WALE_OUT, 0, 0)) for q in p]
            quad(o[0], o[2], o[3], o[1], 'wales', (sign, 0, 0), 'wales')
            quad(p[1], p[3], o[3], o[1], 'wales', (0, 1, 0), 'wales')
            quad(p[0], p[2], o[2], o[0], 'wales', (0, -1, 0), 'wales')

# The transom: one flat face across both sides at the rake, from its foot to the cap, banded like the
# sides so the strakes run round the corner, the wales across it in black.
for j in range(len(ROWS) - 1):
    y0, y1 = ROWS[j], ROWS[j + 1]
    if y1 <= TRANSOM_FOOT:
        continue
    a, b = skin_point('aft', max(y0, TRANSOM_FOOT), 1), skin_point('aft', y1, 1)
    if b.y <= a.y + 1e-6:
        continue
    colour = 'wales' if any(abs(y0 - lo) < 1e-9 for lo, _ in WALE_LO) else ('boot' if y0 < .95 else 'transom')
    quad((-a.x, a.y, a.z), (a.x, a.y, a.z), (b.x, b.y, b.z), (-b.x, b.y, b.z), colour, (0, 0, -1), 'transom')

# The spine: keel, forefoot and stem as a strip SP either side of the middle, the sternpost aft of the
# run, plumb under the transom's foot.
for (z0, y0), (z1, y1), (zi0, yi0), (zi1, yi1) in zip(SPINE_OUT, SPINE_OUT[1:], SPINE_IN, SPINE_IN[1:]):
    for s in (1, -1):
        quad((s * SP, y0, z0), (s * SP, y1, z1), (s * SP, yi1, zi1), (s * SP, yi0, zi0), 'spine', (s, 0, 0), 'spine')
    quad((-SP, y0, z0), (SP, y0, z0), (SP, y1, z1), (-SP, y1, z1), 'spine', (0, -(z1 - z0), (y1 - y0)), 'spine')
top_o, top_i = SPINE_OUT[-1], SPINE_IN[-1]
quad((-SP, top_o[1], top_o[0]), (SP, top_o[1], top_o[0]), (SP, top_i[1], top_i[0]), (-SP, top_i[1], top_i[0]), 'spine', (0, 1, 0), 'spine')
box((0, 0.36, POST_Z - 0.07), (2 * SP, 0.72, 0.14), 'spine', 'spine', skip=(2,))
box((0, 0.02, -4.08), (2 * SP, 0.04, 0.14), 'spine', 'spine', skip=(3,))

# The rudder, hung on the post and the transom: a blade a hand thick, its leading edge on the rake, iron
# straps where it hinges, its head under the stern well's floor.
RUDDER_EDGE = [(0.04, -4.14), (TRANSOM_FOOT, -4.14), (1.0, transom_z(1.0) - .03), (1.62, transom_z(1.62) - .03)]
RUDDER_AFT = [(0.04, -4.62), (0.9, -4.66), (1.3, -4.6), (1.62, transom_z(1.62) - .22)]
for (y0, z0), (y1, z1), (ya0, za0), (ya1, za1) in zip(RUDDER_EDGE, RUDDER_EDGE[1:], RUDDER_AFT, RUDDER_AFT[1:]):
    for s in (1, -1):
        quad((s * .03, y0, z0), (s * .03, y1, z1), (s * .03, ya1, za1), (s * .03, ya0, za0), 'rudder', (s, 0, 0), 'rudder')
    quad((-.03, ya0, za0), (.03, ya0, za0), (.03, ya1, za1), (-.03, ya1, za1), 'rudder', (0, 0, -1), 'rudder')
quad((-.03, .04, -4.14), (.03, .04, -4.14), (.03, .04, -4.62), (-.03, .04, -4.62), 'rudder', (0, -1, 0), 'rudder')
y, z0, z1 = RUDDER_EDGE[-1][0], RUDDER_EDGE[-1][1], RUDDER_AFT[-1][1]
quad((-.03, y, z0), (.03, y, z0), (.03, y, z1), (-.03, y, z1), 'rudder', (0, 1, 0), 'rudder')
for y in (0.3, 0.75, 1.25):
    z = lerp_table([(p[0], p[1]) for p in RUDDER_EDGE], y)
    box((0, y, z - 0.09), (0.08, 0.035, 0.2), 'iron', 'rudder')


# ---- the decks ------------------------------------------------------------------------------
# Three levels: the main deck (DECK) from the break to the bow; the cabin's floor (FLOOR), sunk 0.68
# under it, one plane from the foot of the companion to the transom - the cabin under the quarterdeck and
# the open stern well behind it; and the quarterdeck (QUARTER) over the cabin. Between the break (-0.3)
# and the cabin (-1.37) the companion goes down in the middle, between two walkways at the main deck's
# height that run aft to the cabin's front; the stair to the quarterdeck climbs the port one.
# Plank tops are at the deck's own height, their caulking a hair under it, so whatever stands on a deck
# (a walk map, a ray) finds the number written here.
TH = 0.06               # a bulwark's thickness, skin to inner face
CAP_T = 0.035           # the cap rail's thickness over the bulwark, and how far it overhangs either face
CAP_OVER = 0.015
WALK_X = 0.6            # the walkways' inner edge, either side of the companion
# The companion's foot and head. The keeper's reference has it between -0.9 and -0.3, which is 0.68 down in
# 0.6 - steeper than a body's footprint is held up on (shared/hullwalk.mjs: no ground more than STEP_DOWN
# under any side of it), so it was walked as a gap between treads; its foot is 0.15 further aft instead.
COMPANION = (-1.05, -0.3)
STAIR_X = (-1.30, -0.62)
STAIR_FOOT, STAIR_HEAD = 0.29, -0.88
DOOR_X, DOOR_H = 0.28, 0.8
BACK_Z = (-3.06, -3.02)         # the cabin's back wall, between it and the stern well
CALK = 0.004


def side_x(col, y):
    return abs(skin_point(col, y, 1).x)


def inner_x(col, y):
    return max(0.0, side_x(col, y) - TH)


def col_z(col, y):
    return skin_point(col, y, 1).z


def clip(poly, axis, edge, greater):
    result = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ina = a[axis] >= edge if greater else a[axis] <= edge
        inb = b[axis] >= edge if greater else b[axis] <= edge
        if ina:
            result.append(a)
        if ina != inb:
            result.append(a.lerp(b, (edge - a[axis]) / (b[axis] - a[axis])))
    return result


def planked(outline, y, label='deck'):
    """Planking over a convex outline [(x, z), ...] at height y: boards fore and aft, butts staggered a
    third of a board so they never line up in a chequer, each board its own shade, on dark caulking CALK
    under them that shows in the seams (build-pirateship.py's deck, kept)."""
    poly = [Vector((x, y, z)) for x, z in outline]
    face([p - Vector((0, CALK, 0)) for p in poly], ('deck', 0.42), (0, 1, 0), label)
    width, length, gap = 0.18, 1.15, 0.007
    xs, zs = [p.x for p in poly], [p.z for p in poly]
    for row in range(math.floor(min(xs) / width), math.floor(max(xs) / width) + 1):
        stagger = (row % 3) * length / 3
        for col in range(math.floor((min(zs) - stagger) / length), math.floor((max(zs) - stagger) / length) + 1):
            tile = poly
            for axis, edge, greater in ((0, row * width + gap / 2, True), (0, (row + 1) * width - gap / 2, False),
                                        (2, col * length + stagger + gap / 2, True), (2, (col + 1) * length + stagger - gap / 2, False)):
                tile = clip(tile, axis, edge, greater)
                if len(tile) < 3:
                    break
            if len(tile) < 3:
                continue
            tone = 0.88 + ((row * 73856093 ^ col * 19349663) % 11) * 0.024
            face(tile, ('deck', tone), (0, 1, 0), label)


def outline(cols, y):
    """The deck between the inner faces at height y over a run of columns, stern to bow: a convex ring."""
    right = [(inner_x(c, y), col_z(c, y)) for c in cols]
    return right + [(-x, z) for x, z in reversed(right)]


def floor_of(c1):
    return FLOOR if c1 != 'fore' and c1 <= CABIN_FORE + 1e-9 else DECK


def cols_of(z0, z1):
    return [c for c in COLUMNS if z0 - 1e-9 <= c <= z1 + 1e-9]


# The main deck, the entry ports' floors out to the skin, the walkways, the sunk floor and the quarterdeck.
planked(outline(cols_of(COMPANION[1], 4.4) + ['fore'], DECK), DECK)
for sign in (1.0, -1.0):
    a, b = ENTRY
    planked([(sign * inner_x(a, DECK), a), (sign * side_x(a, DECK), a), (sign * side_x(b, DECK), b), (sign * inner_x(b, DECK), b)], DECK)
    run = cols_of(CABIN_FORE, COMPANION[1])
    planked([(sign * WALK_X, c) for c in run] + [(sign * inner_x(c, DECK), c) for c in reversed(run)], DECK)
planked(outline(['aft'] + cols_of(-4.0, CABIN_FORE), FLOOR), FLOOR)
planked([(-WALK_X, CABIN_FORE), (WALK_X, CABIN_FORE), (WALK_X, COMPANION[0]), (-WALK_X, COMPANION[0])], FLOOR)
QD = outline(cols_of(-3.04, CABIN_FORE), QUARTER)
planked(QD, QUARTER)
# Under the quarterdeck, seen from the cabin: its underside and the beams that carry it - the lowest a
# hand under 1.15 over the floor, so nobody's head is in them.
face([Vector((x, QUARTER - 0.04, z)) for x, z in QD], 'fittings', (0, -1, 0), 'quarterdeck')
qf = inner_x(CABIN_FORE, QUARTER)
quad((-qf, QUARTER - 0.04, CABIN_FORE), (qf, QUARTER - 0.04, CABIN_FORE), (qf, QUARTER, CABIN_FORE), (-qf, QUARTER, CABIN_FORE), 'fittings', (0, 0, 1), 'quarterdeck')
for z in (-2.82, -2.42, -2.02, -1.62):
    w = inner_x(z, QUARTER - 0.07)
    box((0, QUARTER - 0.07, z), (2 * w, 0.06, 0.07), 'fittings', 'quarterdeck', skip=(3,))


# ---- the bulwarks from inside, the cap rail ---------------------------------------------------
def inner_point(col, y, sign):
    p = skin_point(col, y, sign)
    return Vector((sign * max(0.0, abs(p.x) - TH), p.y, p.z))


TOP = 9.0       # any height over the sheer: skin_point clamps it to the top of her side
for sign in (1.0, -1.0):
    for c0, c1 in zip(COLS, COLS[1:]):
        foot, op = floor_of(c1), opening(c0, c1)
        if op == DECK:
            continue
        ys = [foot] + [r for r in ROWS if r > foot + 1e-9]
        if op is not None:
            ys = [y for y in ys if y <= op + 1e-9]
        for y0, y1 in zip(ys, ys[1:]):
            q = [inner_point(c0, y0, sign), inner_point(c1, y0, sign), inner_point(c1, y1, sign), inner_point(c0, y1, sign)]
            quad(*q, 'inner', (-sign, 0, 0), 'bulwark')
        # the cap rail along the top
        o0, o1 = skin_point(c0, TOP, sign), skin_point(c1, TOP, sign)
        i0, i1 = inner_point(c0, TOP, sign), inner_point(c1, TOP, sign)
        out = lambda p, d: p + Vector((sign * d, 0, 0))
        up = Vector((0, CAP_T, 0))
        quad(out(o0, CAP_OVER) + up, out(o1, CAP_OVER) + up, out(i1, -CAP_OVER) + up, out(i0, -CAP_OVER) + up, 'cap', (0, 1, 0), 'cap')
        quad(out(o0, CAP_OVER), out(o1, CAP_OVER), out(o1, CAP_OVER) + up, out(o0, CAP_OVER) + up, 'cap', (sign, 0, 0), 'cap')
        quad(out(i0, -CAP_OVER), out(i1, -CAP_OVER), out(i1, -CAP_OVER) + up, out(i0, -CAP_OVER) + up, 'cap', (-sign, 0, 0), 'cap')
        if op is not None:
            # the gun port's sill and jambs, square through the bulwark, and the cap's underside over it
            quad(skin_point(c0, op, sign), skin_point(c1, op, sign), inner_point(c1, op, sign), inner_point(c0, op, sign), 'inner', (0, 1, 0), 'ports')
            quad(o0, o1, i1, i0, 'cap', (0, -1, 0), 'ports')
            for c, d in ((c0, 1), (c1, -1)):
                quad(skin_point(c, op, sign), inner_point(c, op, sign), inner_point(c, TOP, sign), skin_point(c, TOP, sign), 'inner', (0, 0, d), 'ports')
    # The entry port: its jambs from the deck, the cap's ends, and a post either side, a hand over the
    # cap with a knob to hold.
    for c, d in ((ENTRY[0], 1), (ENTRY[1], -1)):
        quad(skin_point(c, DECK, sign), inner_point(c, DECK, sign), inner_point(c, TOP, sign), skin_point(c, TOP, sign), 'inner', (0, 0, d), 'entry')
        o, i = skin_point(c, TOP, sign) + Vector((sign * CAP_OVER, 0, 0)), inner_point(c, TOP, sign) - Vector((sign * CAP_OVER, 0, 0))
        quad(o, i, i + Vector((0, CAP_T, 0)), o + Vector((0, CAP_T, 0)), 'cap', (0, 0, d), 'cap')
        x = sign * (inner_x(c, DECK) - 0.035)
        z = c - d * 0.035
        top = CAP + 0.12
        box((x, (DECK + top) / 2, z), (0.06, top - DECK, 0.06), 'cap', 'entry', skip=(2,))
        box((x, top + 0.03, z), (0.08, 0.06, 0.08), 'cap', 'entry', skip=(2,))

# The transom from inside the stern well, and the cap across its head.
ys = [FLOOR] + [r for r in ROWS if r > FLOOR + 1e-9]
for y0, y1 in zip(ys, ys[1:]):
    a, b = inner_point('aft', y0, 1), inner_point('aft', y1, 1)
    if b.y <= a.y + 1e-6:
        continue
    quad((-a.x, a.y, a.z + TH), (a.x, a.y, a.z + TH), (b.x, b.y, b.z + TH), (-b.x, b.y, b.z + TH), 'inner', (0, 0, 1), 'bulwark')
o, i = skin_point('aft', TOP, 1), inner_point('aft', TOP, 1)
t = o.y + CAP_T
quad((-o.x - CAP_OVER, t, o.z - CAP_OVER), (o.x + CAP_OVER, t, o.z - CAP_OVER), (i.x + CAP_OVER, t, i.z + TH + CAP_OVER),
     (-i.x - CAP_OVER, t, i.z + TH + CAP_OVER), 'cap', (0, 1, 0), 'cap')
quad((-o.x - CAP_OVER, o.y, o.z - CAP_OVER), (o.x + CAP_OVER, o.y, o.z - CAP_OVER), (o.x + CAP_OVER, t, o.z - CAP_OVER),
     (-o.x - CAP_OVER, t, o.z - CAP_OVER), 'cap', (0, 0, -1), 'cap')

# The gun ports' lids, hinged at the cap and swung up and out 55 degrees; and two closed ports a side,
# lids shut flush in a dark frame.
LID_OPEN = math.radians(55)
CLOSED_PORTS = ((-0.95, -0.55), (2.5, 2.9))
for sign in (1.0, -1.0):
    zc = sum(GUNPORT) / 2
    hinge = skin_point(zc, TOP, sign) + Vector((sign * 0.02, 0, 0))
    h = hinge.y - SILL
    down = Vector((sign * math.sin(LID_OPEN), -math.cos(LID_OPEN), 0))
    centre = hinge + down * (h / 2) + Vector((sign * math.cos(LID_OPEN), math.sin(LID_OPEN), 0)) * 0.015
    box(centre, (0.03, h, GUNPORT[1] - GUNPORT[0] - 0.02), ('planks', 0.85), 'ports', rz=sign * LID_OPEN)
    for z0, z1 in CLOSED_PORTS:
        frame = [skin_point(z, y, sign) + Vector((sign * 0.014, 0, 0)) for z, y in ((z0, SILL), (z1, SILL), (z1, CAP - 0.02), (z0, CAP - 0.02))]
        face(frame, 'wales', (sign, 0, 0), 'ports')
        mid = sum(frame, Vector()) / 4
        face([mid + (p - mid) * 0.82 + Vector((sign * 0.008, 0, 0)) for p in frame], ('planks', 0.85), (sign, 0, 0), 'ports')


# ---- the break: walkways, the companion, the cabin's walls --------------------------------------
QL = QUARTER - 0.04


def wall_edge(col, y0, y1):
    """The hull's inner face at a column from y0 up to y1, as (x, y) on every row between: a bulkhead's
    edge has to follow the curve the bulwark takes there, or a straight edge leaves a slit beside it."""
    ys = [y0] + [r for r in ROWS if y0 + 1e-9 < r < y1 - 1e-9] + [y1]
    return [(inner_x(col, y), y) for y in ys]



for sign in (1.0, -1.0):
    # the walkways' inner faces, down to the sunk floor
    quad((sign * WALK_X, FLOOR, CABIN_FORE), (sign * WALK_X, FLOOR, COMPANION[1]), (sign * WALK_X, DECK, COMPANION[1]),
         (sign * WALK_X, DECK, CABIN_FORE), 'fittings', (-sign, 0, 0), 'break')
    # the cabin's front over the walkways, up to the quarterdeck, and the walkways' ends under it
    for z, d, y0 in ((CABIN_FORE - 0.02, -1, FLOOR), (CABIN_FORE + 0.02, 1, DECK)):
        edge = wall_edge(CABIN_FORE, y0, QL)
        face([(sign * WALK_X, y0, z)] + [(sign * x, y, z) for x, y in edge] + [(sign * WALK_X, QL, z)], 'fittings', (0, 0, d), 'break')
    quad((sign * WALK_X, FLOOR, CABIN_FORE - 0.02), (sign * WALK_X, FLOOR, CABIN_FORE + 0.02), (sign * WALK_X, QL, CABIN_FORE + 0.02),
         (sign * WALK_X, QL, CABIN_FORE - 0.02), 'fittings', (-sign, 0, 0), 'break')

# The companion down to the cabin: six risers of 0.113 between the walkways, open to the cabin's front.
RISE_C = (DECK - FLOOR) / 6
RUN_C = (COMPANION[1] - COMPANION[0]) / 6
for k in range(1, 7):
    za, zb = COMPANION[0] + (k - 1) * RUN_C, COMPANION[0] + k * RUN_C
    top = FLOOR + k * RISE_C
    box((0, (FLOOR + top) / 2, (za + zb) / 2), (2 * WALK_X - 0.02, top - FLOOR, zb - za), ('fittings', 1.12 if k % 2 else 1.0), 'stairs', skip=(2,))

# The stair to the quarterdeck up the port walkway, five risers of 0.114, and the landing at its head.
RISE_Q = (QUARTER - DECK) / 5
RUN_Q = (STAIR_FOOT - STAIR_HEAD) / 5
SX = (STAIR_X[0] + STAIR_X[1]) / 2
for k in range(1, 6):
    za, zb = STAIR_FOOT - k * RUN_Q, STAIR_FOOT - (k - 1) * RUN_Q
    top = DECK + k * RISE_Q
    box((SX, (DECK + top) / 2, (za + zb) / 2), (STAIR_X[1] - STAIR_X[0], top - DECK, zb - za), ('fittings', 1.12 if k % 2 else 1.0), 'stairs', skip=(2,))
box((SX, (DECK + QUARTER) / 2, (CABIN_FORE + STAIR_HEAD) / 2), (STAIR_X[1] - STAIR_X[0], QUARTER - DECK, STAIR_HEAD - CABIN_FORE), 'fittings', 'stairs', skip=(2,))

# The cabin's back wall, between it and the stern well, with a door.
wb = lambda y: inner_x(-3.04, y)
for z, d in ((BACK_Z[0], -1), (BACK_Z[1], 1)):
    for s in (1, -1):
        edge = wall_edge(-3.04, FLOOR, QUARTER)
        face([(s * DOOR_X, FLOOR, z)] + [(s * x, y, z) for x, y in edge] + [(s * DOOR_X, QUARTER, z)], 'fittings', (0, 0, d), 'cabin')
    quad((-DOOR_X, FLOOR + DOOR_H, z), (DOOR_X, FLOOR + DOOR_H, z), (DOOR_X, QUARTER, z), (-DOOR_X, QUARTER, z), 'fittings', (0, 0, d), 'cabin')
for s in (1, -1):
    quad((s * DOOR_X, FLOOR, BACK_Z[0]), (s * DOOR_X, FLOOR, BACK_Z[1]), (s * DOOR_X, FLOOR + DOOR_H, BACK_Z[1]), (s * DOOR_X, FLOOR + DOOR_H, BACK_Z[0]),
         'fittings', (-s, 0, 0), 'cabin')
quad((-DOOR_X, FLOOR + DOOR_H, BACK_Z[0]), (DOOR_X, FLOOR + DOOR_H, BACK_Z[0]), (DOOR_X, FLOOR + DOOR_H, BACK_Z[1]), (-DOOR_X, FLOOR + DOOR_H, BACK_Z[1]),
     'fittings', (0, -1, 0), 'cabin')
quad((-wb(QUARTER), QUARTER, BACK_Z[0]), (wb(QUARTER), QUARTER, BACK_Z[0]), (wb(QUARTER), QUARTER, BACK_Z[1]), (-wb(QUARTER), QUARTER, BACK_Z[1]),
     'fittings', (0, 1, 0), 'cabin')


# ---- rails where a deck ends in a drop ----------------------------------------------------------
def rod(a, b, t, paint, label):
    """A square rod from a to b, t thick, no ends: rails and posts."""
    a, b = Vector(a), Vector(b)
    d = (b - a).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized() * (t / 2)
    v = d.cross(u).normalized() * (t / 2)
    ring = [u + v, -u + v, -u - v, u - v]
    for i in range(4):
        q = [a + ring[i], a + ring[(i + 1) % 4], b + ring[(i + 1) % 4], b + ring[i]]
        face(q, paint, sum(q, Vector()) / 4 - (a + b) / 2, label)


RAIL_H = 0.3            # a balustrade's top over the deck it guards: as high as the waist's bulwark
RAILS = []              # (floor, a, b) of each run, for the anchors


def balustrade(a, b, floor):
    """A rail RAIL_H over `floor` from a to b ((x, z) each), on posts about a quarter apart."""
    a3, b3 = Vector((a[0], floor + RAIL_H, a[1])), Vector((b[0], floor + RAIL_H, b[1]))
    rod(a3, b3, 0.05, 'cap', 'rails')
    n = max(1, round((b3 - a3).length / 0.25))
    for k in range(n + 1):
        p = a3.lerp(b3, k / n)
        rod((p.x, floor, p.z), p, 0.035, 'cap', 'rails')
    RAILS.append((floor, a, b))


balustrade((STAIR_X[1], CABIN_FORE), (inner_x(CABIN_FORE, QUARTER), CABIN_FORE), QUARTER)          # the quarterdeck's front
balustrade((-inner_x(-3.04, QUARTER), BACK_Z[1]), (inner_x(-3.04, QUARTER), BACK_Z[1]), QUARTER)   # its back
balustrade((STAIR_X[1], STAIR_HEAD), (STAIR_X[1], CABIN_FORE), QUARTER)                             # the landing's edge
balustrade((WALK_X, COMPANION[1]), (WALK_X, CABIN_FORE), DECK)                                      # the starboard walkway
# the stair's own rail, rising with it from its foot to the landing
rod((STAIR_X[1], DECK + RAIL_H, STAIR_FOOT), (STAIR_X[1], QUARTER + RAIL_H, STAIR_HEAD), 0.05, 'cap', 'rails')
for z, y in ((STAIR_FOOT, DECK), ((STAIR_FOOT + STAIR_HEAD) / 2, DECK + 2 * RISE_Q)):
    rod((STAIR_X[1], y, z), (STAIR_X[1], y + RAIL_H + (QUARTER - DECK) * (STAIR_FOOT - z) / (STAIR_FOOT - STAIR_HEAD) - (y - DECK), z), 0.035, 'cap', 'rails')


# ---- the rig: mast, crow's nest, yard, standing rigging, bowsprit -------------------------------
# measure.json `mast`, `nest`, `yard`, `bowsprit`: one mast stepped in the waist, a top at 8.52 with a
# rim, a yard at 7.48 carrying the one square sail, and a bowsprit to 6.91.
def tube(centres, radii, paint, label, sides=10, caps=True, part=None):
    """Rings round a line of centres, one frame for the whole run."""
    centres = [Vector(c) for c in centres]
    d = (centres[-1] - centres[0]).normalized()
    ref = Vector((0, 1, 0)) if abs(d.y) < 0.9 else Vector((1, 0, 0))
    u = d.cross(ref).normalized()
    v = d.cross(u).normalized()
    rings = [[c + (u * math.cos(2 * math.pi * i / sides) + v * math.sin(2 * math.pi * i / sides)) * r for i in range(sides)]
             for c, r in zip(centres, radii)]
    for k in range(len(rings) - 1):
        axis = (centres[k] + centres[k + 1]) / 2
        for i in range(sides):
            q = [rings[k][i], rings[k][(i + 1) % sides], rings[k + 1][(i + 1) % sides], rings[k + 1][i]]
            face(q, paint, sum(q, Vector()) / 4 - axis, label, part)
    if caps:
        face(rings[0], paint, centres[0] - centres[1], label, part)
        face(rings[-1], paint, centres[-1] - centres[-2], label, part)


MAST_Z = 0.545
MAST_R = 0.096
TRUCK = 11.19
NEST_FLOOR = 8.523                      # the top of the nest's planking
# The reference's top is 0.62 across the half; a body here needs its footprint (shared/hullwalk.mjs FOOT_R)
# held up between the mast, the hole and the rim, and at 0.62 there was one place to stand, on the seat.
NEST_R = 0.78
NEST_RIM = 0.3                          # its rim over the floor
YARD_Y, YARD_Z, YARD_HALF = 7.475, 0.712, 2.61
tube([(0, DECK, MAST_Z), (0, NEST_FLOOR, MAST_Z), (0, 10.4, MAST_Z), (0, TRUCK - 0.05, MAST_Z)],
     [MAST_R, 0.082, 0.05, 0.03], 'spar', 'mast')
box((0, TRUCK - 0.025, MAST_Z), (0.09, 0.05, 0.09), 'spar', 'mast')
for y in (DECK + 0.02, 3.6, 5.2, 6.8, NEST_FLOOR - 0.22):
    r = MAST_R - (MAST_R - 0.082) * (y - DECK) / (NEST_FLOOR - DECK) + 0.012
    tube([(0, y - 0.03, MAST_Z), (0, y + 0.03, MAST_Z)], [r, r], 'iron', 'mast', caps=False)

# The yard, slung just before the mast, tapering to its arms.
tube([(-YARD_HALF, YARD_Y, YARD_Z), (0, YARD_Y, YARD_Z), (YARD_HALF, YARD_Y, YARD_Z)], [0.035, 0.06, 0.035], 'spar', 'yard', sides=8)

# The crow's nest: a twelve-sided top round the mast, its floor an annulus with the lubber's hole on the
# after side, where the pins come up, its rim NEST_RIM high on short posts and a block to sit on before
# the mast. No face lies over the hole: a body comes up through it.
NEST_SIDES = 12
HOLE = (0.2, MAST_Z - 0.46)             # half its breadth, and its after edge; its fore edge is the mast
ring = lambda r, y: [Vector((r * math.sin(2 * math.pi * (i + 0.5) / NEST_SIDES), y, MAST_Z + r * math.cos(2 * math.pi * (i + 0.5) / NEST_SIDES)))
                     for i in range(NEST_SIDES)]
outer_top, outer_bot = ring(NEST_R, NEST_FLOOR), ring(NEST_R, NEST_FLOOR - 0.06)
inner_top, inner_bot = ring(MAST_R - 0.02, NEST_FLOOR), ring(MAST_R - 0.02, NEST_FLOOR - 0.06)
for i in range(NEST_SIDES):
    j = (i + 1) % NEST_SIDES
    for top in (True, False):
        o, n = (outer_top, inner_top) if top else (outer_bot, inner_bot)
        poly = [n[i], o[i], o[j], n[j]]
        # cut the hole out of every sector of the floor that reaches it
        cut = [Vector(p) for p in poly]
        pieces = [cut]
        if any(p.z < MAST_Z and abs(p.x) < NEST_R for p in cut):
            out = []
            for piece in pieces:
                left = clip(piece, 0, -HOLE[0], False)
                right = clip(piece, 0, HOLE[0], True)
                mid = clip(clip(piece, 0, -HOLE[0], True), 0, HOLE[0], False)
                aft = clip(mid, 2, HOLE[1], False)
                fore = clip(mid, 2, MAST_Z, True)
                out += [p for p in (left, right, aft, fore) if len(p) >= 3]
            pieces = out
        for piece in pieces:
            face(piece, ('deck', 0.95), (0, 1 if top else -1, 0), 'nest')
    face([outer_bot[i], outer_bot[j], outer_top[j], outer_top[i]], 'fittings', (outer_top[i] + outer_top[j]) / 2 - Vector((0, NEST_FLOOR, MAST_Z)), 'nest')
# the hole's own sides
for a, b, d in (((-HOLE[0], HOLE[1]), (HOLE[0], HOLE[1]), (0, 0, 1)), ((-HOLE[0], HOLE[1]), (-HOLE[0], MAST_Z), (1, 0, 0)),
                ((HOLE[0], HOLE[1]), (HOLE[0], MAST_Z), (-1, 0, 0))):
    quad((a[0], NEST_FLOOR - 0.06, a[1]), (b[0], NEST_FLOOR - 0.06, b[1]), (b[0], NEST_FLOOR, b[1]), (a[0], NEST_FLOOR, a[1]), 'fittings', d, 'nest')
# the rim: boards round the edge, inside and out, and a cap on them
rim_o, rim_i = ring(NEST_R, NEST_FLOOR + NEST_RIM), ring(NEST_R - 0.04, NEST_FLOOR + NEST_RIM)
rim_if = ring(NEST_R - 0.04, NEST_FLOOR)
for i in range(NEST_SIDES):
    j = (i + 1) % NEST_SIDES
    out = (rim_o[i] + rim_o[j]) / 2 - Vector((0, NEST_FLOOR, MAST_Z))
    face([outer_top[i], outer_top[j], rim_o[j], rim_o[i]], ('planks', 0.95), out, 'nest')
    face([rim_if[i], rim_if[j], rim_i[j], rim_i[i]], 'inner', -out, 'nest')
    face([rim_o[i], rim_o[j], rim_i[j], rim_i[i]], 'cap', (0, 1, 0), 'nest')
# the trestles under it, and the seat
for s in (1, -1):
    box((s * 0.2, NEST_FLOOR - 0.12, MAST_Z), (0.06, 0.06, 1.0), 'fittings', 'nest')
box((0, NEST_FLOOR - 0.12, MAST_Z + 0.25), (0.9, 0.05, 0.06), 'fittings', 'nest')
SEAT = (0, NEST_FLOOR + 0.12, MAST_Z + 0.27)
box((0, NEST_FLOOR + 0.06, MAST_Z + 0.27), (0.36, 0.12, 0.16), 'fittings', 'nest', skip=(2,))

# The pins up the mast's after face (Plans/nieuwe-sloep.md: no rope ladder aloft): rods across it every
# RUNG_STEP from the planks to under the nest's floor, cut to the climb as every ladder is
# (shared/deck.mjs), with whoever climbs RUNG_FROM behind the line they hold.
_DECK_SRC = (ROOT / 'shared/deck.mjs').read_text(encoding='utf8')


def _deck(name):
    return float(re.search(rf'^export const {name} = ([\d.]+);', _DECK_SRC, re.M).group(1))


RUNG_STEP, RUNG_FROM, RUNG_R = _deck('RUNG_STEP'), _deck('RUNG_FROM'), _deck('RUNG_R')
CLIMB_OUT = _deck('CLIMB_OUT')          # a climber's feet outside a rope ladder's ropes
PIN_Z = MAST_Z - MAST_R - RUNG_R + 0.004    # the line the pins lie on, against the mast's after face
PIN_HALF = 0.15
PINS = []
k = 1
while DECK + k * RUNG_STEP + RUNG_R <= NEST_FLOOR - 0.06:
    y = DECK + k * RUNG_STEP + RUNG_R
    PINS.append(y)
    rod((-PIN_HALF, y, PIN_Z), (PIN_HALF, y, PIN_Z), 2 * RUNG_R, 'fittings', 'pins')
    k += 1

# Shrouds: three a side from under the top to channels outside her bulwark, abaft the entry port so a
# ladder hangs clear of them, and six ratlines across each set; a forestay to the bowsprit's end; braces
# from the yard's arms to the quarterdeck's rail, wide of the pins.
ROPE_T = 0.02
CHANNEL_Y = 2.16
for sign in (1.0, -1.0):
    cz = (-0.55, 0.2)
    cx = side_x(0.0, CHANNEL_Y)
    box((sign * (cx + 0.06), CHANNEL_Y, sum(cz) / 2), (0.14, 0.04, cz[1] - cz[0]), 'fittings', 'rigging')
    heads, feet = [], []
    for z in (-0.4, -0.15, 0.08):
        head = Vector((sign * 0.1, NEST_FLOOR - 0.16, MAST_Z + (z - MAST_Z) * 0.08))
        foot = Vector((sign * (cx + 0.11), CHANNEL_Y + 0.02, z))
        rod(head, foot, ROPE_T, 'rope', 'rigging')
        heads.append(head)
        feet.append(foot)
    for n in range(1, 7):
        t = 0.08 + n * 0.1
        pts = [f.lerp(h, t) for f, h in zip(feet, heads)]
        rod(pts[0], pts[-1], ROPE_T * 0.7, 'rope', 'rigging')
    rod(Vector((sign * YARD_HALF * 0.95, YARD_Y, YARD_Z)), Vector((sign * 0.9, QUARTER + RAIL_H, BACK_Z[1] + 0.05)), ROPE_T * 0.8, 'rope', 'rigging')

BOWSPRIT = (Vector((0, 2.32, 4.02)), Vector((0, 3.37, 6.91)))
tube([BOWSPRIT[0], BOWSPRIT[1]], [0.085, 0.05], 'spar', 'bowsprit', sides=8)
box((0, (DECK + 2.45) / 2, 4.02), (0.3, 2.45 - DECK, 0.14), 'fittings', 'bowsprit', skip=(2,))            # the bitts it is stepped in
for t in (0.12, 0.18, 0.24):
    p = BOWSPRIT[0].lerp(BOWSPRIT[1], t)
    tube([p - Vector((0, 0, 0.02)), p + Vector((0, 0, 0.02))], [0.1, 0.1], 'rope', 'bowsprit', sides=8, caps=False)
rod(Vector((0, 10.35, MAST_Z + 0.04)), BOWSPRIT[1] + Vector((0, 0.03, 0)), ROPE_T, 'rope', 'rigging')
rod(Vector((0, TRUCK - 0.3, MAST_Z - 0.03)), Vector((0, 2.95 + CAP_T, transom_z(2.1) + 0.12)), ROPE_T, 'rope', 'rigging')


# ---- on deck: capstan, hatch, the wheel, lanterns, the cabin's furniture -----------------------
CAPSTAN_Z = 2.15
tube([(0, DECK, CAPSTAN_Z), (0, DECK + 0.22, CAPSTAN_Z), (0, DECK + 0.3, CAPSTAN_Z)], [0.12, 0.09, 0.12], 'fittings', 'deckgear', sides=10)
for a in range(4):
    ang = a * math.pi / 4
    d = Vector((math.cos(ang), 0, math.sin(ang))) * 0.26
    rod(Vector((0, DECK + 0.27, CAPSTAN_Z)) - d, Vector((0, DECK + 0.27, CAPSTAN_Z)) + d, 0.03, 'fittings', 'deckgear')
HATCH = (-0.35, 0.35, 2.6, 2.98)
box((0, DECK + 0.025, sum(HATCH[2:]) / 2), (HATCH[1] - HATCH[0], 0.05, HATCH[3] - HATCH[2]), 'fittings', 'deckgear', skip=(2,))
for k in range(1, 5):
    x = HATCH[0] + (HATCH[1] - HATCH[0]) * k / 5
    box((x, DECK + 0.055, sum(HATCH[2:]) / 2), (0.02, 0.01, HATCH[3] - HATCH[2] - 0.04), ('fittings', 0.6), 'deckgear', skip=(2,))

# The wheel on the quarterdeck where the reference has it, faced fore and aft, the pilot behind it: a rim of
# twelve, eight spokes with handles, on a two-legged stand - no plinth, the pilot stands on the planks.
HELM_Z = -2.495
WHEEL_Y, WHEEL_R = QUARTER + 0.46, 0.27
ax = Vector((0, WHEEL_Y, HELM_Z))
pts = [ax + Vector((WHEEL_R * math.sin(2 * math.pi * i / 12), WHEEL_R * math.cos(2 * math.pi * i / 12), 0)) for i in range(12)]
for i in range(12):
    rod(pts[i], pts[(i + 1) % 12], 0.03, 'cap', 'wheel')
for i in range(8):
    d = Vector((math.sin(2 * math.pi * i / 8), math.cos(2 * math.pi * i / 8), 0))
    rod(ax, ax + d * (WHEEL_R + 0.07), 0.022, 'cap', 'wheel')
tube([ax - Vector((0, 0, 0.05)), ax + Vector((0, 0, 0.05))], [0.04, 0.04], 'iron', 'wheel', sides=8)
for s in (1, -1):
    box((s * 0.08, (QUARTER + WHEEL_Y) / 2, HELM_Z + 0.08), (0.05, WHEEL_Y - QUARTER, 0.05), 'fittings', 'wheel', skip=(2,))
box((0, WHEEL_Y - 0.03, HELM_Z + 0.08), (0.2, 0.06, 0.07), 'fittings', 'wheel')
HELM_STAND = (0, QUARTER, HELM_Z - 0.3)
# The binnacle before it, with a light.
box((0, QUARTER + 0.17, HELM_Z + 0.42), (0.16, 0.34, 0.16), 'fittings', 'wheel', skip=(2,))
box((0, QUARTER + 0.38, HELM_Z + 0.42), (0.1, 0.08, 0.1), 'glass', 'wheel', part=GLOW)


def lantern(at, label='lanterns'):
    p = Vector(at)
    box(p + Vector((0, 0.07, 0)), (0.1, 0.1, 0.1), 'glass', label, part=GLOW)
    box(p + Vector((0, 0.14, 0)), (0.13, 0.03, 0.13), 'iron', label)
    box(p + Vector((0, 0.005, 0)), (0.12, 0.01, 0.12), 'iron', label)


# The stern lantern on its post over the transom's middle, one at the quarterdeck's front, one hung under
# the quarterdeck in the cabin.
tail = skin_point('aft', TOP, 1)
box((0, tail.y + CAP_T + 0.12, tail.z + 0.06), (0.04, 0.24, 0.04), 'iron', 'lanterns', skip=(2,))
lantern((0, tail.y + CAP_T + 0.24, tail.z + 0.06))
lantern((inner_x(CABIN_FORE, QUARTER) - 0.1, QUARTER + RAIL_H + 0.025, CABIN_FORE))
box((0.3, QL - 0.08, -2.2), (0.012, 0.16, 0.012), 'iron', 'lanterns')
lantern((0.3, QL - 0.3, -2.2))

# The cabin's furniture, solid to the floor so nothing is walked under: a bunk along her starboard side, a
# chart table to port, a sea chest by the door.
bx = inner_x(-2.5, FLOOR + 0.3)
box(((0.66 + bx) / 2, FLOOR + 0.15, -2.45), (bx - 0.66, 0.3, 0.8), 'fittings', 'cabin', skip=(2,))
box(((0.66 + bx) / 2, FLOOR + 0.33, -2.45), (bx - 0.7, 0.06, 0.74), ('deck', 0.95), 'cabin', skip=(2,))
box((-0.62, FLOOR + 0.2, -2.3), (0.4, 0.4, 0.6), 'fittings', 'cabin', skip=(2,))
box((-0.62, FLOOR + 0.415, -2.3), (0.46, 0.03, 0.66), ('deck', 0.9), 'cabin', skip=(2,))
box((-0.75, FLOOR + 0.12, -1.75), (0.22, 0.24, 0.36), ('planks', 0.75), 'cabin', skip=(2,))


# ---- the sail and the flag: parts of their own, moved by web/js/ship-motion.js --------------------
SAIL = Part('sail', material('pirateship sail'), origin=(0, YARD_Y, YARD_Z))
FLAG = Part('flag', material('pirateship flag'), origin=(0, TRUCK - 0.35, MAST_Z - 0.06))
SAIL_COLS, SAIL_ROWS, SAIL_DROP, SAIL_BELLY = 10, 14, 3.9, 0.22


def sail_point(q, r):
    k = r / SAIL_ROWS
    half = YARD_HALF * 0.92 + 0.12 * k
    return Vector((-half + 2 * half * q / SAIL_COLS, YARD_Y - 0.05 - SAIL_DROP * k, YARD_Z + 0.06 + SAIL_BELLY * math.sin(math.pi * k) * (1 - (2 * q / SAIL_COLS - 1) ** 2 * 0.5)))


for r in range(SAIL_ROWS):
    for q in range(SAIL_COLS):
        c = [sail_point(q, r), sail_point(q + 1, r), sail_point(q + 1, r + 1), sail_point(q, r + 1)]
        tone = ('sail', 0.94 if (q // 2) % 2 else 1.0)         # cloths sewn side by side
        face(c, tone, (0, 0, 1), 'sail', SAIL)
        face(c, tone, (0, 0, -1), 'sail', SAIL)
# The flag: black, with a skull over crossed bones in white, drawn in its own cells (no texture to paint it
# with), seen from both sides.
JOLLY = ["................",
         "......XXXX......",
         ".....XXXXXX.....",
         ".....X.XX.X.....",
         "......XXXX......",
         "....XX.XX.XX....",
         "......XXXX......",
         "....XX....XX...."]
FLAG_COLS, FLAG_ROWS, FLAG_LEN, FLAG_H = 16, 8, 1.0, 0.5
fy, fz = FLAG.origin.y, FLAG.origin.z
for r in range(FLAG_ROWS):
    for q in range(FLAG_COLS):
        c = [Vector((0, fy - FLAG_H * rr / FLAG_ROWS, fz - FLAG_LEN * qq / FLAG_COLS)) for qq, rr in ((q, r), (q + 1, r), (q + 1, r + 1), (q, r + 1))]
        paint = 'flagmark' if JOLLY[r][q] == 'X' else 'flag'
        face(c, paint, (1, 0, 0), 'flag', FLAG)
        face(c, paint, (-1, 0, 0), 'flag', FLAG)


# ---- the lights: the transom's and the cabin's windows ------------------------------------------
# Glass is its own part (`pirateship glow`, lit after dark) laid a hair proud of the planking, in a frame
# of ochre trim a hair under it. Two lights in the transom over the stern well's floor, two a side in the
# cabin's walls, as high as the reference has them.
def light(corners, normal):
    """A window: `corners` on the planking (four points, anticlockwise seen from outside) and the way out."""
    n = Vector(normal).normalized()
    mid = sum((Vector(c) for c in corners), Vector()) / 4
    frame = [mid + (Vector(c) - mid) * 1.0 + n * 0.006 for c in corners]
    grow = [mid + (Vector(c) - mid) * 1.3 + n * 0.004 for c in corners]
    face(grow, 'trim', n, 'lights')
    face([p + n * 0.006 for p in frame], 'glass', n, 'lights', GLOW)


def transom_point(x, y):
    return Vector((x, y, transom_z(y)))


TRANSOM_N = Vector((0, 0.371, -1)).normalized()     # square to the raked transom, aft and a little up
for cx in (-0.34, 0.34):
    y0, y1 = 1.48, 1.74
    light([transom_point(cx - .12, y0), transom_point(cx + .12, y0), transom_point(cx + .12, y1), transom_point(cx - .12, y1)], TRANSOM_N)
for sign in (1.0, -1.0):
    for z0, z1 in ((-2.72, -2.42), (-2.08, -1.78)):
        y0, y1 = 2.16, 2.42
        pts = [skin_point(z, y, sign) + Vector((sign * PROUD, 0, 0)) for z, y in ((z0, y0), (z1, y0), (z1, y1), (z0, y1))]
        light(pts, (sign, 0, 0))


# ---- what she measures of herself -----------------------------------------------------------
def anchor(name, p):
    e = bpy.data.objects.new(f'anchor.{name}', None)
    e.location = xyz(p)
    scene.collection.objects.link(e)


anchor('waterline', (0, W, 0))


def pair(kind, name, lo, hi):
    anchor(f'{kind}.{name}.lo', lo)
    anchor(f'{kind}.{name}.hi', hi)


def narrowest(y, z0, z1, k=12):
    """The least inner half-breadth at height y between z0 and z1: a rectangle inside every bit of it."""
    return min(inner_x(z0 + (z1 - z0) * i / k, y) for i in range(k + 1)) - 0.02


# The planking, as rectangles a body can stand on (scripts/build-craft.mjs reads them into the craft; a
# walk map is cut from the triangles themselves). A ramp is its foot's corner and its head's opposite one.
for name, z0, z1 in (('waist', STAIR_FOOT + 0.02, 2.4), ('fore', 2.4, 3.4), ('bow', 3.4, 4.0)):
    w = narrowest(DECK, z0, z1)
    pair('deck', name, (-w, DECK, z0), (w, DECK, z1))
# the break, beside the foot of the quarterdeck's stair
pair('deck', 'break', (STAIR_X[1] + 0.02, DECK, COMPANION[1]), (narrowest(DECK, COMPANION[1], STAIR_FOOT), DECK, STAIR_FOOT))
pair('deck', 'walkway', (WALK_X + 0.02, DECK, CABIN_FORE), (narrowest(DECK, CABIN_FORE, COMPANION[1]), DECK, COMPANION[1]))
pair('deck', 'companion', (-(WALK_X - 0.02), FLOOR, CABIN_FORE), (WALK_X - 0.02, FLOOR, COMPANION[0]))
w = narrowest(FLOOR, BACK_Z[1], CABIN_FORE)
pair('deck', 'cabin', (-w, FLOOR, BACK_Z[1]), (w, FLOOR, CABIN_FORE))
WELL_AFT = transom_z(FLOOR) + TH + 0.03
w = narrowest(FLOOR, WELL_AFT, BACK_Z[0])
pair('deck', 'well', (-w, FLOOR, WELL_AFT), (w, FLOOR, BACK_Z[0]))
w = narrowest(QUARTER, BACK_Z[1], CABIN_FORE)
pair('deck', 'quarter', (-w, QUARTER, BACK_Z[1]), (w, QUARTER, CABIN_FORE))
pair('deck', 'stairhead', (STAIR_X[0], QUARTER, CABIN_FORE), (STAIR_X[1], QUARTER, STAIR_HEAD))
pair('stair', 'companion', (-(WALK_X - 0.02), FLOOR, COMPANION[0]), (WALK_X - 0.02, DECK, COMPANION[1]))
pair('stair', 'quarter', (STAIR_X[1], DECK, STAIR_FOOT), (STAIR_X[0], QUARTER, STAIR_HEAD))

# The bulwarks as runs of rail on the floor they stand on: her side curves, and a run is a straight line,
# so a run is cut wherever her inner face has moved a hand off where it started (and at every opening
# and change of floor), and stands at the narrowest of it, inside the bulwark rather than out over the sea.
rail_n = 0


def rail(floor, a, b):
    global rail_n
    rail_n += 1
    anchor(f'rail.{rail_n}.a', (a[0], floor, a[1]))
    anchor(f'rail.{rail_n}.b', (b[0], floor, b[1]))


BULWARK_RUNS = [(FLOOR, ['aft'] + cols_of(-4.0, -3.06)), (FLOOR, cols_of(-3.04, CABIN_FORE)), (QUARTER, cols_of(-3.04, CABIN_FORE)),
                (DECK, cols_of(CABIN_FORE, ENTRY[0])), (DECK, cols_of(ENTRY[1], 4.0))]
for sign in (1.0, -1.0):
    for floor, cols in BULWARK_RUNS:
        run = [cols[0]]
        for c in cols[1:] + [None]:
            if c is not None and abs(inner_x(c, floor) - inner_x(run[0], floor)) < 0.06:
                run.append(c)
                continue
            if c is not None:
                run.append(c)
            if len(run) > 1:
                x = sign * min(inner_x(q, floor) for q in run)
                rail(floor, (x, col_z(run[0], floor)), (x, col_z(run[-1], floor)))
            run = [c]
for floor, a, b in RAILS:
    rail(floor, a, b)

# The mast, its top and the way up the pins: `lo` the climber's stand on the planks, RUNG_FROM behind the
# pins, `hi` where they step off on the top's floor beside the hole; the seat before the mast.
anchor('mast.main', (0, DECK, MAST_Z))
# The top's floor before the mast (behind it is the hole), out past its rim, which build-craft reads in it.
pair('deck', 'nest', (-0.5, NEST_FLOOR, MAST_Z + 0.12), (0.5, NEST_FLOOR, MAST_Z + 0.75))
pair('climb', 'mast', (0, DECK, PIN_Z - RUNG_FROM), (0.46, NEST_FLOOR, MAST_Z))
anchor('nest', SEAT)

# The rope ladders at the entry ports, hung outside her side, their foot under the water and their head on
# the deck inside the port.
LADDER_Z = sum(ENTRY) / 2
for sign, side in ((1.0, 'starboard'), (-1.0, 'port')):
    ropes = side_x(LADDER_Z, DECK) + 0.04
    pair('climb', f'side-{side}', (sign * (ropes + CLIMB_OUT), W - 0.6, LADDER_Z), (sign * (inner_x(LADDER_Z, DECK) - 0.35), DECK, LADDER_Z))

# What is manned: the guns square out of their ports, the gunner inboard of the carriage; the harpoon on
# the bow on her middle line, pointing over the stem.
GUN_Z = sum(GUNPORT) / 2
for sign, side in ((1.0, 's'), (-1.0, 'p')):
    pair('mount', f'cannon-{side}', (sign * 0.5, DECK, GUN_Z), (sign * (inner_x(GUN_Z, DECK) - 0.35), DECK, GUN_Z))
pair('mount', 'harpoon', (0, DECK, 3.25), (0, DECK, 3.7))
anchor('helm', HELM_STAND)
anchor('cargo', (0, DECK, 1.0))

# The entry ports, a gap in the bulwark down to the deck: starboard first.
for n, sign in ((1, 1.0), (2, -1.0)):
    pair('port', str(n), (sign * inner_x(ENTRY[0], DECK), DECK, ENTRY[0]), (sign * inner_x(ENTRY[1], DECK), DECK, ENTRY[1]))

# ---- bake ----------------------------------------------------------------------------------
parts = [p for p in (HULL, GLOW, SAIL, FLAG) if p.faces]
objs = [p.build() for p in parts]
top = max((o.matrix_world @ Vector(c)).z for o in objs for c in o.bound_box)
scene['building_height'] = top
scene.unit_settings.system = 'NONE'
scene.unit_settings.scale_length = 1

total = {}
for p in parts:
    for label, n in p.tris().items():
        total[f'{p.name.split(" ", 1)[1]}/{label}'] = n
print('sloop triangles by label:', ', '.join(f'{k} {v}' for k, v in sorted(total.items())), flush=True)
print(f'sloop: {sum(total.values())} triangles, top {top:.3f} ({top - W:.3f} above the water)', flush=True)

if BAKE:
    OUT.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'pirateship.blend'))
    runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'pirateship'})

# ---- previews ------------------------------------------------------------------------------
if PREVIEW_DIR:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
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

    for p in ((0.4, DECK, 1.9), (-0.5, DECK, 0.9), (0.3, FLOOR, -2.2), (0.0, FLOOR, -3.7), (-0.4, QUARTER, -2.3), (0.9, DECK, -0.8)):
        figure(p)
    batavia = []
    if 'pair' in VIEWS:
        with bpy.data.libraries.load(str(ROOT / 'assets/batavia/batavia.blend')) as (src, dst):
            dst.objects = [n for n in src.objects if n.startswith('batavia ')]
        for o in dst.objects:
            if o is None or o.type != 'MESH':
                continue
            scene.collection.objects.link(o)
            attr = o.data.color_attributes.new(name='Paint', type='FLOAT_COLOR', domain='CORNER')
            o.data.color_attributes.active_color = attr
            for poly in o.data.polygons:
                c = o.data.materials[poly.material_index].diffuse_color
                for li in poly.loop_indices:
                    attr.data[li].color = c
            o.location = o.location + xyz((7.0, W - 1.0, 0))
            o.hide_render = True
            batavia.append(o)

    scene.render.engine = 'BLENDER_WORKBENCH'
    sh = scene.display.shading
    sh.light = 'STUDIO'
    sh.color_type = 'VERTEX'
    sh.show_shadows = True
    sh.shadow_intensity = 0.3
    sh.show_cavity = 'nocavity' not in args
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
        'side': ((-26, 3.0, 0.6), (0, 3.0, 0.6), 45),
        'quarter': ((-12, 6.0, -11), (0, 2.6, 0.3), 30),
        'stern': ((-3.5, 3.8, -9.5), (0, 2.0, -3.5), 40),
        'bow': ((-4.5, 3.6, 10.5), (0, 2.2, 3.5), 40),
        'top': ((0, 30, 0.01), (0, 0, 0), 40),
        'deck': ((0.4, 3.3, 4.6), (0, 2.1, -1.5), 24),
        'cabin': ((0.3, 1.85, -0.6), (0, 1.75, -3.0), 20),
        'port': ((-4.5, 2.6, 2.2), (-1.4, 2.2, 1.0), 30),
        'nest': ((-3.0, 10.5, -3.0), (0, 8.8, 0.5), 30),
        'iso': ((-11, 9.5, 10), (0, 3.5, 0), 34),
        'pair': ((3.5, 6.5, -24), (3.5, 3.0, 0), 34),
        'lines': ((-22, 1.6, 0.4), (0, 1.6, 0.4), 50),
        'under': ((-8, -2.5, 7), (0, 0.9, 0), 32),
        'keel': ((-2.0, 0.1, 0.5), (0, 0.15, 0.0), 30),
    }
    for view in VIEWS:
        for o in batavia:
            o.hide_render = view != 'pair'
        so.hide_render = view in ('lines', 'under', 'keel')
        eye, look, lens = SHOTS[view]
        cam.data.lens = lens
        cam.location = xyz(eye)
        cam.rotation_euler = (xyz(look) - xyz(eye)).to_track_quat('-Z', 'Y').to_euler()
        scene.render.filepath = str(PREVIEW_DIR / f'sloop-{view}.png')
        bpy.ops.render.render(write_still=True)
