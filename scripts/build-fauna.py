"""The animals. Rebuild with scripts/blender.mjs --background --python scripts/build-fauna.py.

Six animals, each a `fauna_` asset (budget 1200) in parts that move, and each part with its
Blender origin on the joint it turns about - so web/js/fauna.js hangs them straight off the
baked `at` and nothing in JS says where a hip is:

    fauna_horse  fauna_cow  fauna_sheep       four-legged: body, head (neck and all, turning at
                                              the neck's root), tail, leg fl / fr / bl / br
    fauna_chicken  fauna_gull                 two-legged: body, head, wing l / r, leg l / r
    fauna_duck                                a floating one: body, head, wing l / r - no legs,
                                              it sits on the water with its keel at y = 0

The horse follows Ideas/Images to Render/horse.png - a bay with a black mane, tail and socks, a
white blaze and a saddle; the others are drawn from what a sheep and a hen look like, at the size
of the island's villagers (RESIDENT_HEAD_Y 0.35 in web/js/villager.js): a horse's withers come to
a villager's shoulder, a sheep to its knee. Every body is a loft of eight-sided rings, which is
the coarsest round the island's flat shading still reads as round.

Written in island coordinates (x right, y up, z forward) through xyz(); the animals face +z.
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Matrix, Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/fauna'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


MATS = {}


def material(name, color):
    if name in MATS:
        return MATS[name]
    m = bpy.data.materials.new('plain:' + name)
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    MATS[name] = m
    return m


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

    def add_painted(self, points, faces, paint):
        """Faces with a material each: `paint(centre)` answers for the face with that middle, in
        island coordinates - which is what puts a cow's patches where a patch is, not in bands."""
        base = len(self.verts)
        pts = [Vector(p) for p in points]
        self.verts.extend(p - self.origin for p in pts)
        for f in faces:
            self.faces.append([base + k for k in f])
            self.mats.append(self.slot(paint(sum((pts[k] for k in f), Vector()) / len(f))))

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


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def ring(c, d, w, h, sides):
    """A ring of `sides` points round c, square to direction d: w across (x), h the other way."""
    d = Vector(d).normalized()
    u = Vector((1, 0, 0))
    v = d.cross(u).normalized()
    return [Vector(c) + u * (math.cos(2 * math.pi * k / sides) * w / 2) + v * (math.sin(2 * math.pi * k / sides) * h / 2)
            for k in range(sides)]


def loft_faces(rings, sides, caps=True):
    faces = []
    for k in range(rings - 1):
        faces += [[k * sides + i, k * sides + (i + 1) % sides, (k + 1) * sides + (i + 1) % sides, (k + 1) * sides + i]
                  for i in range(sides)]
    if caps:
        faces += [list(range(sides))[::-1], [(rings - 1) * sides + i for i in range(sides)]]
    return faces


def loft(part, sections, mat, sides=8, caps=True, paint=None):
    """Rings through (centre, direction, w, h), joined in order. `paint` colours face by face."""
    pts = [p for c, d, w, h in sections for p in ring(c, d, w, h, sides)]
    faces = loft_faces(len(sections), sides, caps)
    if paint:
        part.add_painted(pts, faces, paint)
    else:
        part.add(pts, faces, mat)


def along(points, widths, heights=None):
    """Sections along a polyline, each ring facing the way the line runs."""
    heights = heights or widths
    out = []
    for i, p in enumerate(points):
        a = Vector(points[max(0, i - 1)]); b = Vector(points[min(len(points) - 1, i + 1)])
        out.append((p, b - a, widths[i], heights[i]))
    return out


def box(part, centre, size, mat):
    c, (sx, sy, sz) = Vector(centre), size
    pts = [c + Vector((x * sx / 2, y * sy / 2, z * sz / 2))
           for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1))]
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


def fin(part, points, widths, mat, thick=0.008):
    """A flat strip of hair - a mane, a tail: a ribbon along points, `widths` tall, both faces."""
    pts, faces, n = [], [], len(points)
    for i, (p, w) in enumerate(zip(points, widths)):
        p = Vector(p)
        pts += [p + Vector((-thick, 0, 0)), p + Vector((thick, 0, 0)), p + Vector((0, w, 0))]
    for i in range(n - 1):
        a, b = i * 3, (i + 1) * 3
        faces += [[a, b, b + 2, a + 2], [a + 1, a + 2, b + 2, b + 1], [a, a + 1, b + 1, b]]
    part.add(pts, faces, mat)


def ears(part, tip_at, spread, size, mat):
    for side in (-1, 1):
        base = Vector(tip_at) + Vector((side * spread, -size, 0))
        part.add([base + Vector((-size * 0.4, 0, -size * 0.2)), base + Vector((size * 0.4, 0, -size * 0.2)),
                  base + Vector((0, 0, size * 0.3)), Vector(tip_at) + Vector((side * spread * 1.2, 0, 0))],
                 [[0, 1, 3], [1, 2, 3], [2, 0, 3], [0, 2, 1]], mat)


def quadruped(name, s):
    # An animal made from a picture (below) takes the place of the drawn one.
    if (OUT / 'source' / f'{name}.glb').exists():
        return None
    a = collection(f'fauna_{name}')
    body = Part(a, 'body')
    loft(body, [((0, cy, z), (0, 0, 1), w, h) for z, cy, w, h in s['body']], None if s.get('paint') else s['coat'],
         sides=s.get('sides', 8), paint=s.get('paint'))
    for extra in s.get('extras', []):
        extra(body)
    body.build()

    neck_root = s['head'][0]
    head = Part(a, 'head', neck_root)
    loft(head, along(s['head'], s['head_w'], s['head_h']), s['coat'], paint=s.get('head_paint'))
    if s.get('snout'):
        # A rounded muzzle: a short loft of its own rather than a block on the end of the face.
        loft(head, along(*s['snout']), s['muzzle_mat'], sides=6)
    if s.get('muzzle'):
        box(head, s['muzzle'][0], s['muzzle'][1], s['muzzle_mat'])
    for x, y, z in s.get('eyes', []):
        box(head, (x, y, z), (0.01, 0.014, 0.016), material('eye', 0x151515))
    if s.get('mane'):
        fin(head, s['mane'][0], s['mane'][1], s['hair'])
    ears(head, s['ears'][0], s['ears'][1], s['ears'][2], s['ear_mat'])
    for extra in s.get('head_extras', []):
        extra(head)
    head.build()

    tail = Part(a, 'tail', s['tail'][0][0])
    if s.get('tail_round'):
        loft(tail, along(s['tail'][0], s['tail'][1]), s['tail_mat'], sides=6)
    else:
        fin(tail, s['tail'][0], s['tail'][1], s['tail_mat'], thick=s.get('tail_thick', 0.012))
    tail.build()

    for key, (x, z) in (('fl', (-1, 1)), ('fr', (1, 1)), ('bl', (-1, -1)), ('br', (1, -1))):
        top = (x * s['legs']['x'], s['legs']['top'], z * s['legs']['z'] if z > 0 else -s['legs']['zb'])
        leg = Part(a, f'leg {key}', top)
        ys, ws = s['legs']['ys'], s['legs']['ws']
        offsets = s['legs'].get('front_offsets' if z > 0 else 'back_offsets', [0] * len(ys))
        pts = [(top[0], y, top[2] + dz) for y, dz in zip(ys, offsets)]
        segs = along(pts, ws)
        # Two colours on a leg: the coat down to the knee, then the sock and the hoof.
        loft(leg, segs[:s['legs']['sock'] + 1], s['coat'], sides=6, caps=False)
        loft(leg, segs[s['legs']['sock']:], s['sock_mat'], sides=6)
        box(leg, (top[0], s['legs']['hoof'] / 2, pts[-1][2] + 0.004), (ws[-1] * 1.2, s['legs']['hoof'], ws[-1] * 1.3), s['hoof_mat'])
        leg.build()
    return a


def biped(name, s):
    a = collection(f'fauna_{name}')
    body = Part(a, 'body')
    loft(body, [((0, cy, z), (0, 0, 1), w, h) for z, cy, w, h in s['body']], s['coat'])
    for extra in s.get('extras', []):
        extra(body)
    body.build()
    head = Part(a, 'head', s['neck'])
    loft(head, along(s['head'], s['head_w']), s['head_mat'], sides=6)
    tip = Vector(s['head'][-1])
    head.add([tip + Vector((-0.008, 0.004, -0.004)), tip + Vector((0.008, 0.004, -0.004)), tip + Vector((0, -0.004, -0.004)),
              tip + Vector((0, 0, s['beak']))], [[0, 1, 3], [1, 2, 3], [2, 0, 3], [0, 2, 1]], s['beak_mat'])
    for extra in s.get('head_extras', []):
        extra(head)
    head.build()
    for side, key in ((-1, 'l'), (1, 'r')):
        at = Vector((side * s['wing'][0], s['wing'][1], s['wing'][2]))
        wing = Part(a, f'wing {key}', at)
        L, W = s['wing'][3], s['wing'][4]
        # A flat wing folded along the body, hinged at the shoulder; it opens about z.
        wing.add([at, at + Vector((side * 0.006, -0.01, -W)), at + Vector((side * L, -0.012, -W * 0.8)), at + Vector((side * L * 0.9, 0, -0.01)),
                  at + Vector((0, 0.004, 0)), at + Vector((side * 0.006, -0.006, -W)), at + Vector((side * L, -0.008, -W * 0.8)), at + Vector((side * L * 0.9, 0.004, -0.01))],
                 [[0, 1, 2, 3], [4, 7, 6, 5]], s['wing_mat'])
        wing.build()
        if s.get('legs'):
            top = Vector((side * s['legs'][0], s['legs'][1], s['legs'][2]))
            leg = Part(a, f'leg {key}', top)
            loft(leg, along([top, (top.x, 0.008, top.z)], [0.008, 0.006]), s['leg_mat'], sides=4)
            box(leg, (top.x, 0.002, top.z + 0.006), (0.014, 0.004, 0.018), s['leg_mat'])
            leg.build()
    return a


BAY, DARK, SOCK, HOOF = material('horse coat', 0x8a4f2a), material('horse mane', 0x2a1f1a), material('horse sock', 0x3b2a20), material('horse hoof', 0x4a4a4d)
LEATHER, BLAZE = material('horse saddle', 0x5a3624), material('horse blaze', 0xf0e6d6)
WOOL, FACE = material('sheep wool', 0xf2ede2), material('sheep face', 0x2e2a28)
COW_W, COW_B, PINK = material('cow white', 0xf3efe6), material('cow black', 0x2b2a2a), material('cow pink', 0xe8a7a0)
HORN = material('cow horn', 0xd9ceb0)
HEN, COMB, YELLOW = material('hen feathers', 0xc8793b), material('hen comb', 0xd33a2c), material('bird feet', 0xe8a93a)
GULL, GULL_WING = material('gull white', 0xf4f4f2), material('gull wing', 0x9aa3ab)
DRAKE, DRAKE_HEAD, DUCK_BILL = material('duck body', 0x8b6f55), material('duck head', 0x2f6b3a), material('duck bill', 0xe0a030)

# ---- the horse ---------------------------------------------------------------------------
def shell(part, rings, mat):
    """Rings of points (each the same count) lofted and capped: for sections that are no ellipse -
    a skull, a crescent ear. Answers the index of its first face, for repainting some of them."""
    first = len(part.faces)
    part.add([p for r in rings for p in r], loft_faces(len(rings), len(rings[0])), mat)
    return first


def ellipsoid(part, c, ax, ay, az, mat, sides=10, bands=6):
    """oval() with its three half-axes any way round (ay the pole): an eye in its socket, a
    nostril slanted on the muzzle."""
    c, ax, ay, az = Vector(c), Vector(ax), Vector(ay), Vector(az)
    rings = []
    for k in range(1, bands):
        t = -math.pi / 2 + math.pi * k / bands
        rings.append([c + ay * math.sin(t) + (ax * math.cos(2 * math.pi * j / sides)
                                               + az * math.sin(2 * math.pi * j / sides)) * math.cos(t)
                      for j in range(sides)])
    pts = [p for r in rings for p in r]
    faces = loft_faces(len(rings), sides, caps=False)
    bottom, top, n = len(pts), len(pts) + 1, len(rings)
    pts += [c - ay, c + ay]
    for i in range(sides):
        faces += [[bottom, (i + 1) % sides, i], [top, (n - 1) * sides + i, (n - 1) * sides + (i + 1) % sides]]
    part.add(pts, faces, mat)


def strap(part, pts, normals, widths, t, mat, closed=False):
    """A flat strap, `widths` wide (one number or one per point) and `t` thick, lying on the
    surface whose normal each point is given. Any direction: loft's rings keep their width along
    x, so a browband across the face or a noseband round it came out as a sliver."""
    n = len(pts)
    widths = widths if isinstance(widths, (list, tuple)) else [widths] * n
    rings = []
    for i, (p, nm, w) in enumerate(zip(pts, normals, widths)):
        a = pts[(i - 1) % n] if closed else pts[max(0, i - 1)]
        b = pts[(i + 1) % n] if closed else pts[min(n - 1, i + 1)]
        d = (Vector(b) - Vector(a)).normalized()
        nm = (Vector(nm) - d * Vector(nm).dot(d)).normalized()
        s = d.cross(nm).normalized()
        p = Vector(p)
        rings.append([p + s * w / 2 + nm * t / 2, p - s * w / 2 + nm * t / 2,
                      p - s * w / 2 - nm * t / 2, p + s * w / 2 - nm * t / 2])
    faces = loft_faces(n, 4, caps=not closed)
    if closed:
        faces += [[(n - 1) * 4 + k, (n - 1) * 4 + (k + 1) % 4, (k + 1) % 4, k] for k in range(4)]
    part.add([q for r in rings for q in r], faces, mat)


def slab(part, rows, mat, periodic=False):
    """A thin closed sheet from rows of (inner, outer) point pairs: a saddle cloth, a flap, a
    girth (`periodic`, round the barrel). Every rim is closed, so it stays a solid."""
    nr, nc = len(rows), len(rows[0])
    pts = [q[0] for r in rows for q in r] + [q[1] for r in rows for q in r]
    N = nr * nc
    I = lambda i, j: i * nc + (j % nc)
    cols = nc if periodic else nc - 1
    faces = []
    for i in range(nr - 1):
        for j in range(cols):
            faces.append([I(i, j), I(i + 1, j), I(i + 1, j + 1), I(i, j + 1)])
            faces.append([N + I(i, j), N + I(i, j + 1), N + I(i + 1, j + 1), N + I(i + 1, j)])
    for j in range(cols):
        faces.append([I(0, j), I(0, j + 1), N + I(0, j + 1), N + I(0, j)])
        faces.append([I(nr - 1, j), N + I(nr - 1, j), N + I(nr - 1, j + 1), I(nr - 1, j + 1)])
    if not periodic:
        for i in range(nr - 1):
            faces.append([I(i, 0), N + I(i, 0), N + I(i + 1, 0), I(i + 1, 0)])
            faces.append([I(i, nc - 1), I(i + 1, nc - 1), N + I(i + 1, nc - 1), N + I(i, nc - 1)])
    part.add(pts, faces, mat)


# Where the stirrup irons hang (x out from the middle, the tread's foot, z) - where the
# Adventurer's feet come down with his thighs close along the saddle (HORSEBACK_OF in
# web/js/classic-avatar.js). web/js/fauna.js saddleOf reads them back off the bake.
IRON = (0.116, 0.3435, 0.015)


def saddle(p):
    """An English saddle laid on the barrel it sits on: every piece is draped - a ray from the
    barrel's middle out to the coat at that height and angle, and on outwards by the piece's own
    offset - so cloth, panels, flaps and girth hug the curve instead of standing off it as boxes.
    The rider's thighs lie along it, which is the point: with the old box flaps (0.11 out either
    side) the Adventurer's legs went round them at 45 degrees and reached the irons straight.

    The seat is dished - low behind the middle, up to a rolled cantle behind and a narrow
    twist and pommel in front - and its lowest middle is what saddleOf reads as the seat."""
    from mathutils.bvhtree import BVHTree
    pad = material('horse saddle pad', 0x416d72)
    brass = material('horse tack brass', 0xc6a263)
    girth = material('horse girth', 0x8d6f4c)
    steel = material('horse stirrup iron', 0xa7abae)
    tree = BVHTree.FromPolygons([tuple(v) for v in p.verts], p.faces)

    def on(z, deg, off, cy=0.37):
        a = math.radians(deg)
        d = Vector((math.sin(a), math.cos(a), 0))
        return tree.ray_cast(Vector((0, cy, z)), d, 1.0)[0] + d * off

    def lerp_table(table, z):
        for (z0, v0), (z1, v1) in zip(table, table[1:]):
            if z <= z1:
                t = (z - z0) / (z1 - z0)
                return v0 + (v1 - v0) * t * t * (3 - 2 * t)
        return table[-1][1]

    # The cloth: a rounded oblong from the withers to behind the cantle, down to the girth.
    rows = []
    for k in range(8):
        z = -0.09 + 0.184 * k / 7
        e = abs((z - 0.002) / 0.092)
        span = 68 - 16 * e ** 4
        rows.append([(on(z, d, 0.0012), on(z, d, 0.0048)) for d in [span * (j / 4 - 1) for j in range(9)]])
    slab(p, rows, pad)
    # The seat and the panels under it, as one dished shell: how high its middle stands at each z,
    # and how far round the barrel it reaches (narrowest at the twist, just behind the pommel).
    HEIGHT = [(-0.082, 0.497), (-0.074, 0.506), (-0.062, 0.5), (-0.045, 0.491), (-0.02, 0.4865),
              (0.005, 0.4875), (0.03, 0.491), (0.05, 0.497), (0.064, 0.503), (0.076, 0.5), (0.084, 0.494)]
    REACH = [(-0.082, 28), (-0.06, 35), (-0.03, 34), (0.0, 31), (0.03, 25), (0.055, 21), (0.084, 18)]
    rows = []
    for k in range(10):
        z = -0.082 + 0.166 * k / 9
        top = on(z, 0, 0).y
        rise, reach = max(0.006, lerp_table(HEIGHT, z) - top), lerp_table(REACH, z)
        row = []
        for j in range(7):
            d = reach * (j / 3 - 1)
            f = 1 - (d / reach) ** 2
            row.append((on(z, d, 0.004), on(z, d, 0.006 + (rise - 0.006) * f ** 0.6)))
        rows.append(row)
    slab(p, rows, LEATHER)
    for side in (-1, 1):
        # A skirt over the stirrup bar, under the front of the seat.
        slab(p, [[(on(z, side * d, 0.0062), on(z, side * d, 0.0082)) for z in (-0.004, 0.018, 0.04, 0.056)]
                 for d in (30, 36, 42, 47)], LEATHER)
        # The flap: thin, lying flat on the cloth, cut forward as it goes down, rounded at the foot,
        # ending above the irons (y 0.39) so it stays out of what saddleOf reads as an iron.
        rows = []
        for k in range(7):
            t = k / 6
            d = 34 + 40 * t
            front, back = 0.058 + 0.026 * t, -0.044 + 0.022 * t - 0.012 * t ** 6
            front -= 0.016 * t ** 6
            rows.append([(on(z, side * d, 0.0052), on(z, side * d, 0.0078))
                         for z in [back + (front - back) * j / 5 for j in range(6)]])
        slab(p, rows, LEATHER)
        # A knee roll along the flap's front edge.
        edge = [on(0.052 + 0.026 * t - 0.016 * t ** 6, side * (38 + 33 * t), 0.0108) for t in (0, .25, .5, .75, 1)]
        loft(p, along(edge, [0.006, 0.008, 0.008, 0.007, 0.004], [0.012, 0.015, 0.015, 0.013, 0.006]), LEATHER, sides=6)
        # The leather from the bar down over the flap to the iron, behind the knee.
        ix, iy, iz = IRON
        top = iy + 0.031
        down = [on(iz, side * d, 0.0094) for d in (38, 50, 62, 73)]
        down.append(Vector((side * ix, top + 0.006, iz)))
        strap(p, down, [Vector((side, 0.25, 0))] * len(down), 0.010, 0.0024, LEATHER)
        # The iron: an arch in the plane across the horse, the foot going through it along z, on a
        # flat tread.
        arch = [(-0.0165, 0.006), (-0.017, 0.016), (-0.014, 0.025), (-0.007, 0.0302), (0, 0.031),
                (0.007, 0.0302), (0.014, 0.025), (0.017, 0.016), (0.0165, 0.006)]
        strap(p, [Vector((side * ix + dx, iy + dy, iz)) for dx, dy in arch], [Vector((0, 0, 1))] * len(arch),
              0.0042, 0.0075, steel)
        box(p, (side * ix, iy + 0.0035, iz), (0.04, 0.007, 0.017), steel)
        box(p, (side * ix, top + 0.002, iz), (0.007, 0.006, 0.006), steel)
        # Buckles where the girth meets its straps under the flap's foot.
        for z in (0.034, 0.05):
            g = on(z, side * 78, 0.0062)
            box(p, (g.x, g.y, z), (0.004, 0.007, 0.006), brass)
    # The girth, round the belly behind the elbow from under one flap to under the other (over the
    # top it showed through the cloth).
    slab(p, [[(on(z, d, 0.0011), on(z, d, 0.0042)) for d in range(40, 321, 14)] for z in (0.03, 0.054)],
         girth)


runpy.run_path(str(ROOT / 'scripts/horse-model.py'), init_globals=globals())

# ---- the cow ------------------------------------------------------------------------------
# Proportions off a side-on outline of a cow: the body twice as long as it is deep and dead level
# along the back, legs two thirds of the body's depth, and the head carried HIGH - a thick neck
# rising off the top of the shoulders to the poll, above the line of the back, and from there a
# short deep face down to a broad round muzzle. (The first go put the neck halfway down the chest
# and ran the face forward and down from it: an anteater.)
#
# Black patches where a patch is: a face is black when its middle falls inside one of these
# blobs on the hide (x, y, z, radius), white otherwise.
COW_BLOBS = [(0.13, 0.31, 0.05, 0.1), (-0.13, 0.29, -0.13, 0.1), (0.0, 0.39, -0.05, 0.08),
             (-0.12, 0.24, 0.14, 0.07), (0.12, 0.22, -0.2, 0.07)]
cow_hide = lambda c: COW_B if any((c - Vector(b[:3])).length < b[3] for b in COW_BLOBS) else COW_W
# The face white down the middle and black round the eyes and ears, the way a Holstein's is;
# the neck black on top.
cow_face = lambda c: COW_B if (abs(c.x) > 0.03 and c.y > 0.4) or (c.z < 0.25 and c.y > 0.36) else COW_W


def udder(p):
    loft(p, along([(0, 0.165, -0.14), (0, 0.125, -0.14)], [0.075, 0.05], [0.07, 0.05]), PINK, sides=6)
    for x, z in ((-0.018, -0.155), (0.018, -0.155), (-0.018, -0.125), (0.018, -0.125)):
        box(p, (x, 0.115, z), (0.01, 0.02, 0.01), PINK)


quadruped('cow', {
    'coat': COW_W, 'hair': COW_B, 'tail_mat': COW_B, 'sock_mat': COW_W, 'hoof_mat': COW_B, 'ear_mat': COW_B,
    'sides': 10,
    # Level-backed and deep, from the pin bones at the back to the chest.
    'body': [(-0.27, 0.3, 0.15, 0.16), (-0.24, 0.285, 0.24, 0.23), (-0.08, 0.27, 0.26, 0.25),
             (0.08, 0.27, 0.25, 0.25), (0.2, 0.28, 0.22, 0.23), (0.26, 0.29, 0.13, 0.16)],
    'paint': cow_hide, 'head_paint': cow_face,
    'extras': [udder],
    # Neck root inside the front of the body, up to the poll, then the face down to the muzzle.
    'head': [(0, 0.31, 0.2), (0, 0.37, 0.25), (0, 0.43, 0.29), (0, 0.405, 0.335), (0, 0.37, 0.365)],
    'head_w': [0.16, 0.13, 0.12, 0.11, 0.1], 'head_h': [0.2, 0.16, 0.11, 0.1, 0.08],
    'snout': ([(0, 0.365, 0.365), (0, 0.355, 0.39)], [0.105, 0.095], [0.075, 0.062]), 'muzzle_mat': PINK,
    'eyes': [(-0.056, 0.415, 0.315), (0.056, 0.415, 0.315)],
    'ears': ((0, 0.435, 0.285), 0.075, 0.026),
    'head_extras': [lambda p: [box(p, (side * 0.035, 0.465, 0.285), (0.013, 0.03, 0.013), HORN) for side in (-1, 1)]],
    'tail': ([(0, 0.35, -0.27), (0, 0.25, -0.29), (0, 0.13, -0.29)], [0.012, 0.012, 0.045]), 'tail_thick': 0.006,
    'legs': {'x': 0.075, 'z': 0.15, 'zb': 0.18, 'top': 0.2, 'ys': [0.2, 0.09, 0.03], 'ws': [0.068, 0.05, 0.046],
             'sock': 1, 'hoof': 0.03},
})

# ---- the sheep ---------------------------------------------------------------------------
quadruped('sheep', {
    'coat': WOOL, 'hair': WOOL, 'tail_mat': WOOL, 'sock_mat': FACE, 'hoof_mat': FACE, 'ear_mat': FACE,
    'body': [(-0.14, 0.17, 0.1, 0.1), (-0.11, 0.17, 0.17, 0.15), (0.02, 0.175, 0.18, 0.16), (0.11, 0.18, 0.16, 0.15), (0.15, 0.185, 0.09, 0.1)],
    'head': [(0, 0.2, 0.13), (0, 0.215, 0.18), (0, 0.19, 0.23)],
    'head_w': [0.07, 0.055, 0.04], 'head_h': [0.07, 0.06, 0.045],
    'muzzle': ((0, 0.2, 0.2), (0.05, 0.045, 0.055)), 'muzzle_mat': FACE,
    'ears': ((0, 0.225, 0.18), 0.04, 0.015),
    'tail': ([(0, 0.19, -0.145), (0, 0.15, -0.16)], [0.03, 0.025]),
    'legs': {'x': 0.045, 'z': 0.09, 'zb': 0.09, 'top': 0.12, 'ys': [0.12, 0.05, 0.015], 'ws': [0.036, 0.026, 0.024],
             'sock': 0, 'hoof': 0.015},
})

# ---- the hen, the gull, the duck ----------------------------------------------------------
biped('chicken', {
    'coat': HEN, 'head_mat': HEN, 'beak_mat': YELLOW, 'wing_mat': material('hen wing', 0xa55e2c), 'leg_mat': YELLOW,
    'body': [(-0.05, 0.085, 0.03, 0.04), (-0.035, 0.08, 0.065, 0.065), (0.015, 0.075, 0.07, 0.07), (0.045, 0.085, 0.05, 0.055)],
    'extras': [lambda p: p.add([(-0.01, 0.1, -0.045), (0.01, 0.1, -0.045), (0, 0.14, -0.07)], [[0, 1, 2], [0, 2, 1]], material('hen tail', 0x6b3a1c))],
    'neck': (0, 0.1, 0.04), 'head': [(0, 0.1, 0.04), (0, 0.135, 0.055), (0, 0.145, 0.065)], 'head_w': [0.035, 0.032, 0.026], 'beak': 0.018,
    'head_extras': [lambda p: p.add([(0, 0.155, 0.05), (0, 0.175, 0.062), (0, 0.155, 0.075)], [[0, 1, 2], [0, 2, 1]], COMB)],
    'wing': (0.033, 0.09, 0.03, 0.02, 0.07), 'legs': (0.015, 0.05, 0.0),
})
biped('gull', {
    'coat': GULL, 'head_mat': GULL, 'beak_mat': YELLOW, 'wing_mat': GULL_WING, 'leg_mat': material('gull feet', 0xd9a07a),
    'body': [(-0.08, 0.075, 0.02, 0.02), (-0.04, 0.07, 0.05, 0.045), (0.02, 0.07, 0.055, 0.05), (0.05, 0.075, 0.04, 0.04)],
    'neck': (0, 0.085, 0.045), 'head': [(0, 0.085, 0.045), (0, 0.11, 0.06), (0, 0.112, 0.075)], 'head_w': [0.032, 0.03, 0.024], 'beak': 0.022,
    'wing': (0.024, 0.085, 0.035, 0.1, 0.09), 'legs': (0.012, 0.05, 0.0),
})
biped('duck', {
    'coat': DRAKE, 'head_mat': DRAKE_HEAD, 'beak_mat': DUCK_BILL, 'wing_mat': material('duck wing', 0x6d5642),
    'body': [(-0.06, 0.03, 0.03, 0.025), (-0.045, 0.027, 0.065, 0.05), (0.02, 0.025, 0.07, 0.05), (0.05, 0.03, 0.045, 0.04)],
    'neck': (0, 0.045, 0.045), 'head': [(0, 0.045, 0.045), (0, 0.075, 0.055), (0, 0.08, 0.068)], 'head_w': [0.03, 0.03, 0.024], 'beak': 0.026,
    'wing': (0.032, 0.05, 0.02, 0.02, 0.06), 'legs': None,
})

# ---- the animals made from a picture --------------------------------------------------------
# Some animals are not drawn here but generated: a picture of one (Ideas/Images to Render) through
# Trellis.2 and the GLB lane's blender_lowpoly.py (img2threejs, integrations/glb_lane) gives a
# closed low-poly mesh with the picture's colours baked into its vertices, standing on y = 0 and
# facing +z, saved as assets/fauna/source/<name>.glb. Here it is cut into the same moving parts the
# drawn animals have, so web/js/fauna.js moves it without knowing where it came from:
#
#   legs   every face whose middle is below `leg_top` (a share of the height), four ways by side
#          and by end; each leg turns at the middle of its top
#   head   every face ahead of `neck` (a share of the length, from the front) and above the legs;
#          it turns at the root of the neck
#   tail   every face behind `tail` (a share of the length, from the back) above `tail_y`, if asked
#
# A cut leaves a hole where the part came away, and a leg swinging opens it: so every cut edge is
# capped, and each leg is first stretched up past its cut by `stub`, into the body, so that what
# shows at the hip when it swings is more leg rather than the cap.
AI = {
    # leg_top just under the belly: any higher and the flank comes away with the hind legs.
    # `palette`: the picture's own colours without its lighting (the island lights the mesh), each
    # with the shades it shows in the picture, lit and in shadow. A face gets the colour one of
    # whose shades is nearest its baked colour - so a shadowed white flank stays white and is not
    # taken for a black patch that happens to be as dark. A colour may be kept to where it belongs
    # (`only`: below / above a share of the height): the side the picture does not show comes back
    # from the generator darker and blotched, and a goat is dark only at its horns and hooves.
    'goat': {'leg_top': 0.3, 'neck': 0.3, 'neck_y': 0.45, 'tail': 0.08, 'tail_y': 0.6, 'stub': 0.04, 'mirror': 'right',
             'palette': [(0xc8b19c, [0xcbb5a2, 0xaf9885, 0x8a7866, 0x584b3a]),
                         (0x584b3a, [0x584b3a, 0x3a3228], {'below': 0.06, 'above': 0.8})]},
    # A leg has to stand clear of the middle (`leg_x`, a share of the width): the udder hangs as low
    # as the hind legs' tops, between them. The tail hangs to the hocks, so it is cut before them.
    'cow': {'leg_top': 0.3, 'leg_x': 0.12, 'neck': 0.24, 'neck_y': 0.45, 'tail': 0.05, 'tail_y': 0.2, 'stub': 0.04, 'mirror': 'right',
            'thicken': 1.3,
            'palette': [(0xf0f0ec, [0xf0f0ee, 0xd2d3d3, 0xadaeaf, 0x8e8f91]),
                        (0x38383b, [0x505055, 0x3a3a3e, 0x2a2a2d, 0x6c6c72]),
                        (0xd9a396, [0xd9a59a, 0xc08a7e, 0xa87468], {'below': 0.45}),
                        (0xd8cca4, [0xdcd0a8, 0xbcae88], {'above': 0.85})]},
    # A sheep is a ball of wool on short black legs, its black face well out in front. The legs
    # are thin shells in the generated mesh that no remesh keeps, so they are drawn instead
    # (`draw_legs`: shares of the width and the length from the middle, and the top as a share of
    # the height), and whatever of the generated ones survived is dropped.
    'sheep': {'leg_top': 0.28, 'leg_x': 0.1, 'neck': 0.28, 'neck_y': 0.35, 'stub': 0.04, 'mirror': 'right',
              'draw_legs': {'x': 0.22, 'z': 0.24, 'top': 0.42, 'w': 0.034, 'colour': 0x2e2a28},
              'palette': [(0xefeae0, [0xf2eee6, 0xd8d3ca, 0xb8b2a8, 0x9a948a]),
                          (0x35312f, [0x3e3a38, 0x2a2624, 0x55504c, 0x6a6460])]},
    # A sparrow on the wing: a body and two wings, each hinged at the shoulder (`wings`: where the
    # wing starts, as a share of the span from the middle). web/js/fauna.js flies it, and puts the
    # sitting sparrow down in its place when it lands.
    # The pig came from a strip of four views, each named by its side (trellis_generate.py
    # --front/--back/--left/--right; one side view mirrored for the other): one picture gave a
    # spiked lump four times over, and the views fused unnamed (--views) a pig squashed short with
    # its head run into its body. It came back closed, so VOXEL remesh (260) keeps the curl of its
    # tail. Pink all over; its eyes are too small to survive the low-poly pass.
    # No head of its own: a pig has no neck to turn it on, and cut loose it showed a step at the
    # cheek and kept an ear behind on the body.
    'pig': {'leg_top': 0.2, 'leg_x': 0.12, 'tail': 0.06, 'tail_y': 0.45, 'stub': 0.04,
            'thicken': 1.1,
            'palette': [(0xf0c4bc, [0xf2c8c0, 0xdcaea6, 0xc2948c, 0xa87a74]),
                        (0x2a2224, [0x2a2224, 0x3c3032], {'above': 0.5})]},
    # And on the ground: a body and a head that pecks. Its feet are too small to survive the
    # low-poly pass, and a sparrow sitting down hides them anyway.
    'sparrow': {'leg_top': 0, 'neck': 0.34, 'neck_y': 0.45, 'mirror': 'right',
                'palette': [(0x9a8f86, [0x9e948b, 0x857a70, 0x6c6258]),
                            (0xd0c9bf, [0xd4cdc3, 0xbab3a9]),
                            (0x4a4038, [0x4e443c, 0x3a322c])]},
    'sparrow_flying': {'wings': 0.3, 'mirror': 'right',
                       'palette': [(0x9a8f86, [0x9e948b, 0x857a70, 0x6c6258]),
                                   (0xc9c2b8, [0xcfc8be, 0xb4ada3]),
                                   (0x4a4038, [0x4e443c, 0x3a322c])]},
}


def from_glb(name, path, spec):
    import bmesh
    isl = lambda v: Vector((v.x, v.z, -v.y))           # Blender -> island
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.data.objects if o not in before and o.type == 'MESH']
    for o in bpy.data.objects:
        o.select_set(o in meshes)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    src = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    # On the ground by its own lowest point: the low-poly pass puts the floor where the generated
    # mesh had it, and decimating lifts the hooves a hair off it.
    floor = min(v.co.z for v in src.data.vertices)
    # And on the middle of its footprint, which is where the island puts an animal down: the
    # low-poly pass centres on the body, and a head held out in front moves that off the middle.
    xs = [v.co.x for v in src.data.vertices]; ys = [v.co.y for v in src.data.vertices]
    src.data.transform(Matrix.Translation((-(min(xs) + max(xs)) / 2, -(min(ys) + max(ys)) / 2, -floor)))
    for o in bpy.data.objects:
        if o not in before and o is not src:
            bpy.data.objects.remove(o, do_unlink=True)
    # The GLB lane's grade_glb.py writes the graded colours as sRGB numbers into COLOR_0, where
    # the bake reads linear ones: taken as they are, the goat came out 1.6x too light, silver
    # instead of beige. Linearised here, they match the reference picture's own mean.
    lin = lambda c: c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
    for attr in src.data.color_attributes:
        for d in attr.data:
            r, g, b, al = d.color
            d.color = (lin(r), lin(g), lin(b), al)
    if spec.get('palette'):
        # One flat colour per face, off the palette. With a few hundred vertices, a colour per
        # vertex smears over faces the size of a leg, and the odd vertex the bake got wrong turns
        # a whole flank white or brown; the pictures are flat-faceted anyway.
        tolin = lambda hx: tuple(lin(((hx >> sh) & 255) / 255) for sh in (16, 8, 0))
        pal = [(tolin(e[0]), tolin(shade), e[2] if len(e) > 2 else None) for e in spec['palette'] for shade in e[1]]
        H_ = max(v.co.z for v in src.data.vertices)
        allowed = lambda only, y: only is None or y < only.get('below', -1) * H_ or y > only.get('above', 2) * H_
        baked = src.data.color_attributes.active_color
        flat = src.data.color_attributes.new('flat', 'FLOAT_COLOR', 'CORNER')
        for poly in src.data.polygons:
            if baked is None:
                c = (1, 1, 1)
            elif baked.domain == 'CORNER':
                cs = [baked.data[li].color for li in poly.loop_indices]
                c = [sum(x[k] for x in cs) / len(cs) for k in range(3)]
            else:
                cs = [baked.data[vi].color for vi in poly.vertices]
                c = [sum(x[k] for x in cs) / len(cs) for k in range(3)]
            y = sum(src.data.vertices[vi].co.z for vi in poly.vertices) / len(poly.vertices)
            fits = [e for e in pal if allowed(e[2], y)]
            colour = min(fits, key=lambda e: sum((c[k] - e[1][k]) ** 2 for k in range(3)))[0]
            for li in poly.loop_indices:
                flat.data[li].color = (*colour, 1.0)
        # The side the picture did not show (`mirror`: the animal's right, -x, for a picture taken
        # from its left front) is the generator's guess, darker and blotched: an animal is near
        # enough the same both sides, so that side takes its colours from the side that was seen.
        if spec.get('mirror'):
            sign = -1 if spec['mirror'] == 'right' else 1
            seen = [(sum((isl(src.data.vertices[vi].co) for vi in poly.vertices), Vector()) / len(poly.vertices), poly)
                    for poly in src.data.polygons]
            left = [(c, poly) for c, poly in seen if c.x * sign < 0]
            for c, poly in seen:
                if c.x * sign <= 0:
                    continue
                want = Vector((-c.x, c.y, c.z))
                twin = min(left, key=lambda e: (e[0] - want).length_squared)[1]
                colour = flat.data[twin.loop_indices[0]].color
                for li in poly.loop_indices:
                    flat.data[li].color = colour
        for attr in [x for x in src.data.color_attributes if x.name != 'flat']:
            src.data.color_attributes.remove(attr)
        src.data.color_attributes.active_color = src.data.color_attributes['flat']
    src.data.materials.clear()
    src.data.materials.append(material(f'{name} coat', 0xffffff))
    for poly in src.data.polygons:
        poly.material_index = 0

    verts = [isl(v.co) for v in src.data.vertices]
    ys, zs = [v.y for v in verts], [v.z for v in verts]
    H, zf, zb = max(ys), max(zs), min(zs)
    L = zf - zb
    leg_top, neck_z, tail_z = spec.get('leg_top', 0) * H, zf - spec.get('neck', 0) * L, zb + spec.get('tail', 0) * L
    mid_z = (zf + zb) / 2

    def centre(poly):
        return sum((verts[i] for i in poly.vertices), Vector()) / len(poly.vertices)

    W = max(v.x for v in verts) - min(v.x for v in verts)
    groups = {}
    for poly in src.data.polygons:
        c = centre(poly)
        if spec.get('wings') is not None:
            key = ('wing ' + ('r' if c.x < 0 else 'l')) if abs(c.x) > spec['wings'] * W / 2 else 'body'
        elif spec.get('neck') and c.z > neck_z and c.y > spec['neck_y'] * H:
            key = 'head'
        elif spec.get('tail') and c.z < tail_z and c.y > spec['tail_y'] * H and abs(c.x) < 0.2 * W:
            key = 'tail'
        elif c.y < leg_top and abs(c.x) > spec.get('leg_x', 0) * W:
            key = 'leg ' + ('f' if c.z > mid_z else 'b') + ('r' if c.x > 0 else 'l')
        else:
            key = 'body'
        groups.setdefault(key, set()).add(poly.index)

    a = collection(f'fauna_{name}')
    drawn = spec.get('draw_legs')
    if drawn:
        for key in [k for k in groups if k.startswith('leg')]:
            del groups[key]
        xm = (max(v.x for v in verts) + min(v.x for v in verts)) / 2
        zm = (zf + zb) / 2
        dark = material(f'{name} legs', drawn['colour'])
        for key, sx, sz in (('fl', -1, 1), ('fr', 1, 1), ('bl', -1, -1), ('br', 1, -1)):
            top = (xm + sx * drawn['x'] * W, drawn['top'] * H, zm + sz * drawn['z'] * L)
            leg = Part(a, f'leg {key}', top)
            loft(leg, along([top, (top[0], 0.012, top[2]), (top[0], 0.0, top[2])],
                            [drawn['w'], drawn['w'] * 0.8, drawn['w'] * 0.9]), dark, sides=6)
            leg.build()
    for key, faces in sorted(groups.items()):
        obj = src.copy()
        obj.data = src.data.copy()
        obj.name = obj.data.name = f'fauna_{name} {key}'
        bm = bmesh.new()
        bm.from_mesh(obj.data)
        bm.faces.ensure_lookup_table()
        bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.index not in faces], context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
        # A list, in mesh order: summed out of a set, the rim colour came out a bit different each bake.
        kept = list(bm.faces)
        original = set(kept)
        cut = [e for e in bm.edges if e.is_boundary]
        pts = [isl(v.co) for v in bm.verts]
        if key.startswith('leg') and cut:
            # Up into the body past the cut, then closed.
            new = bmesh.ops.extrude_edge_only(bm, edges=cut)['geom']
            moved = [g for g in new if isinstance(g, bmesh.types.BMVert)]
            bmesh.ops.translate(bm, verts=moved, vec=Vector((0, 0, spec['stub'] * H)))
            cut = [e for e in bm.edges if e.is_boundary]
        if cut:
            bmesh.ops.holes_fill(bm, edges=cut, sides=0)
        # What the cut added - the caps, the stubs - is coloured like the rim it grew from; left
        # alone it would be black, which is what a new face's corners are.
        layer = bm.loops.layers.float_color.active or bm.loops.layers.color.active
        if layer is not None:
            rim = [l[layer] for f in kept for l in f.loops if l.edge.is_boundary or l.link_loop_prev.edge.is_boundary]
            rim = rim or [l[layer] for f in kept for l in f.loops]
            avg = [sum(c[k] for c in rim) / len(rim) for k in range(4)]
            for f in bm.faces:
                if f not in original:
                    for l in f.loops:
                        l[layer] = avg
        # The stubs and caps come out of bmesh in an order that differs from bake to bake (the
        # same triangles, shuffled): put them in one by where they are, so the bake is stable.
        place = lambda co: (round(co.x, 5), round(co.y, 5), round(co.z, 5))
        rank = {v: i for i, v in enumerate(sorted(bm.verts, key=lambda v: place(v.co)))}
        bm.verts.sort(key=lambda v: rank[v])
        rank = {f: i for i, f in enumerate(sorted(bm.faces, key=lambda f: sorted(place(v.co) for v in f.verts)))}
        bm.faces.sort(key=lambda f: rank[f])
        bm.to_mesh(obj.data)
        bm.free()
        # The joint it turns about, in island coordinates, then back into Blender's.
        if key.startswith('leg'):
            pivot = Vector((sum(p.x for p in pts) / len(pts), leg_top, sum(p.z for p in pts) / len(pts)))
        elif key == 'head':
            root = [p for p in pts if p.z < neck_z + 0.02 * L] or pts
            pivot = Vector((0, sum(p.y for p in root) / len(root), neck_z))
        elif key == 'tail':
            pivot = Vector((0, max(p.y for p in pts), max(p.z for p in pts)))
        elif key.startswith('wing'):
            # The shoulder: where the wing meets the body, on its inner edge.
            root = sorted(pts, key=lambda p: abs(p.x))[:max(3, len(pts) // 8)]
            pivot = Vector((sum(p.x for p in root) / len(root), sum(p.y for p in root) / len(root), sum(p.z for p in root) / len(root)))
        else:
            pivot = Vector((0, 0, 0))
        b_pivot = Vector((pivot.x, -pivot.z, pivot.y))
        obj.data.transform(Matrix.Translation(-b_pivot))
        if key.startswith('leg') and spec.get('thicken', 1) != 1:
            # Few triangles leave a leg a stick: fattened about its own upright axis - below the
            # cut only, or the stub up inside the body comes out through its flank as a tab.
            k = spec['thicken']
            for v in obj.data.vertices:
                if v.co.z < 0:
                    v.co.x *= k
                    v.co.y *= k
        obj.location = b_pivot
        obj['building_part'] = True
        a.objects.link(obj)
    bpy.data.objects.remove(src, do_unlink=True)


for name, spec in AI.items():
    source = OUT / 'source' / f'{name}.glb'
    if source.exists():
        from_glb(name, source, spec)

bpy.context.scene['building_height'] = 0.7
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'fauna.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'fauna'})
