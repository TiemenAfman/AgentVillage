"""The sea floor's own things: kelp, coral, rocks, shells, a starfish and two fish. Rebuild with
node scripts/blender.mjs --background --python scripts/build-sea.py

Eleven assets for the diver's world (Plans/onderwater-zwemmen.md, "Leven"), each under the budget
of its name prefix (scripts/model-rules.mjs) and standing with its lowest vertex on y = 0, which
for a plant or a shell is the sand and for a fish is the belly - the page lifts a fish to its
depth by that one number:

    flora_kelp_a        three blades, 1.5 tall         54   budget 60
    flora_kelp_b        two wide blades and a sprig    58   budget 60
    flora_coral_fan     a sea fan, two crossed         58   budget 60
    flora_coral_branch  a staghorn, five prongs        58   budget 60
    flora_coral_dome    a brain coral, lumpy           54   budget 60
    flora_rock_sea_a    a jagged boulder               34   budget 40   (flora_rock: the rock's own)
    flora_rock_sea_b    a flat shelf and two pebbles   37   budget 40
    prop_shell          a scallop                      52   budget 120
    prop_starfish       five arms                      40   budget 120
    fauna_fish_a        a striped reef fish            84   budget 1200, aimed at 150
    fauna_fish_b        a slim shoaling fish           76   budget 1200, aimed at 150

Why so coarse. A kelp forest is a few hundred instances and the fish are a hundred at once, and the
shadow pass is not counted by ?stats; nothing here casts a shadow, but the colour pass alone is
900 kelp x 54 = 49k triangles at the full tier. So detail is spent on the silhouette - a blade
that waves, a fan with scalloped lobes, a rock with a shoulder - and never on a surface.

What each shape leaves to the page:

    kelp    Blades are flat, so every face is written twice (front and back) instead of asking the
            material for DoubleSide, which makes a blade 4s - 2 triangles for s segments. Five or
            six rings up the tallest blade is the vertical resolution the sway shader wants
            (position.y is the sway weight: 0 at the clean base, 1.5 at the tip). The base ring is
            exactly y = 0 and each blade's foot is a hand's width across, so a clump roots itself.
    coral   The fan and the branch are the two that read from every side: the fan by being two
            plates crossed, the branch by being solid three-sided prongs (flat ones vanish edge
            on). The dome is an antiprism ring stack, so its triangles alternate and it looks
            grown rather than turned.
    fish    Nose to +Z, a six-sided section along the body, the belly on y = 0. The body is closed;
            the fins are flat and written twice. The bands of colour are faces, not vertex paint:
            a material per stripe costs nothing (grouped() merges them all into one slot).

Materials are `plain:` for everything that lives, `stone:` for the rocks. Not `bark:` or
`foliage:`: those two sheets belong to the forest and the hedge, and kelp is neither.

Written in island coordinates (x right, y up, z to the front) through xyz(), the way
build-farmyard.py does. xyz() is a quarter turn and not a mirror, so a face wound anticlockwise
here is still anticlockwise in the bake - and Part.tri() winds every solid away from a point
inside it, so no face of a rock or a fish is inside out. Nothing is random: the lumps on the dome
and the rocks come from a small congruential generator with a fixed seed, so a second bake is
byte for byte the first.
"""
import bpy
import math
import runpy
from math import cos, sin, pi, radians
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/sea'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.preferences.filepaths.save_version = 0


def xyz(p):
    """Island coordinates in, Blender coordinates out."""
    return Vector((p[0], -p[2], p[1]))


def material(name, color, sheet='plain'):
    m = bpy.data.materials.new(f'{sheet}:{name}')
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    shader = m.node_tree.nodes['Principled BSDF']
    shader.inputs['Base Color'].default_value = (*rgb, 1)
    shader.inputs['Roughness'].default_value = .9
    m['emissive'] = 0.0
    return m


KELP = material('kelp', 0x5c8a3a)
KELP_TIP = material('kelp_tip', 0xa3b552)
FAN = material('coral_pink', 0xe0688c)
FAN_DARK = material('coral_pink_dark', 0xb03c68)
BRANCH = material('coral_orange', 0xe8743b)
BRANCH_TIP = material('coral_orange_tip', 0xf3b063)
DOME = material('coral_dome', 0xb98a3e)
DOME_TOP = material('coral_dome_top', 0xe3c46b)
ROCK = material('rock', 0x7d8388, 'stone')
ROCK_MOSS = material('rock_moss', 0x6f8a70, 'stone')
SHELL = material('shell', 0xefd9c8)
SHELL_RIM = material('shell_rim', 0xd99b8c)
STAR = material('starfish', 0xe4762f)
STAR_TIP = material('starfish_tip', 0xf0a35a)
EYE = material('fish_eye', 0x0c1116)
FISH_A = material('fish_a', 0xee8a2b)
FISH_A_STRIPE = material('fish_a_stripe', 0xf5efe0)
FISH_A_FIN = material('fish_a_fin', 0xd5601d)
FISH_B = material('fish_b', 0x3f78ad)
FISH_B_BELLY = material('fish_b_belly', 0xd3e0e8)
FISH_B_FIN = material('fish_b_fin', 0x2b567f)


class Rng:
    """A fixed-seed congruential generator, so a lumpy rock is the same rock on every machine."""

    def __init__(self, seed):
        self.s = seed & 0x7fffffff

    def next(self):
        self.s = (self.s * 1103515245 + 12345) & 0x7fffffff
        return self.s / 0x80000000

    def sym(self, a):
        return (self.next() * 2 - 1) * a


class Part:
    """One mesh: triangles only, so the count is what is written here and not what Blender's
    triangulation of an n-gon happens to come to."""

    def __init__(self, coll, name):
        self.coll, self.name = coll, f'{coll.name} {name}'
        self.tris, self.mats, self.slots = [], [], []

    def _push(self, a, b, c, mat):
        if mat not in self.slots:
            self.slots.append(mat)
        self.tris.append((a, b, c))
        self.mats.append(self.slots.index(mat))

    def tri(self, a, b, c, mat, away_from=None, toward=None, both=False):
        """One triangle. `away_from` (a point, or a function of the face's middle giving one) winds
        it outward from inside a solid; `toward` winds it to face a direction; `both` writes the
        reverse as well, which is how a flat blade or fin is seen from either side."""
        a, b, c = Vector(a), Vector(b), Vector(c)
        n = (b - a).cross(c - a)
        mid = (a + b + c) / 3
        if away_from is not None:
            o = away_from(mid) if callable(away_from) else Vector(away_from)
            if n.dot(mid - o) < 0:
                b, c = c, b
        elif toward is not None and n.dot(Vector(toward)) < 0:
            b, c = c, b
        self._push(a, b, c, mat)
        if both:
            self._push(a, c, b, mat)

    def quad(self, a, b, c, d, mat, **kw):
        self.tri(a, b, c, mat, **kw)
        self.tri(a, c, d, mat, **kw)

    def zip(self, A, B, mat, away_from):
        """The band between two rings of any lengths, ordered round the same axis: len(A) + len(B)
        triangles, each ring's next vertex taken in turn by how far round it has got."""
        nA, nB = len(A), len(B)
        i = j = 0
        while i < nA or j < nB:
            if i < nA and (j >= nB or (i + 1) * nB <= (j + 1) * nA):
                self.tri(A[i % nA], A[(i + 1) % nA], B[j % nB], mat, away_from=away_from)
                i += 1
            else:
                self.tri(A[i % nA], B[(j + 1) % nB], B[j % nB], mat, away_from=away_from)
                j += 1

    def cap(self, ring, mat, away_from):
        for k in range(1, len(ring) - 1):
            self.tri(ring[0], ring[k], ring[k + 1], mat, away_from=away_from)

    def apex(self, ring, top, mat, away_from):
        for k in range(len(ring)):
            self.tri(ring[k], ring[(k + 1) % len(ring)], top, mat, away_from=away_from)

    def build(self):
        mesh = bpy.data.meshes.new(self.name)
        verts, faces = [], []
        for (a, b, c) in self.tris:
            faces.append((len(verts), len(verts) + 1, len(verts) + 2))
            verts += [xyz(a), xyz(b), xyz(c)]
        mesh.from_pydata(verts, [], faces)
        for mat in self.slots:
            mesh.materials.append(mat)
        for poly, m in zip(mesh.polygons, self.mats):
            poly.material_index = m
        mesh.update()
        obj = bpy.data.objects.new(self.name, mesh)
        obj['building_part'] = True
        self.coll.objects.link(obj)
        return obj

    def lowest(self):
        return min(v.y for t in self.tris for v in t)


def collection(name):
    c = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(c)
    return c


def ring(n, r, y, phase=0.0, at=(0.0, 0.0), rng=None, radial=0.0, angular=0.0, lift=0.0):
    """A ring of n points round the y axis, optionally knocked about: radius by up to `radial`
    of itself, angle by up to `angular` of a step, height by up to `lift`."""
    pts = []
    for k in range(n):
        a = phase + 2 * pi * k / n
        rr, yy = r, y
        if rng is not None:
            a += rng.sym(angular) * 2 * pi / n
            rr = r * (1 + rng.sym(radial))
            yy = y + rng.sym(lift)
        pts.append(Vector((at[0] + cos(a) * rr, yy, at[1] + sin(a) * rr)))
    return pts


# ---- kelp ---------------------------------------------------------------------------------
def kelp_blade(part, base, theta, height, width, lean, wave, phase, twist, factors):
    """One flat blade rooted at `base`, wide in the direction theta, leaning and waving out of its
    own plane, written on both faces. `factors` is its width at each ring up the blade: the last
    ring is followed by a single tip point. The top two segments are the pale end of the frond."""
    s = len(factors)
    n = Vector((-sin(theta), 0, cos(theta)))

    def centre(t):
        off = lean * t * t + wave * sin(2 * pi * 1.2 * t + phase) * (0.35 + t)
        return Vector(base) + Vector((0, height * t, 0)) + n * off

    rings = []
    for k, f in enumerate(factors):
        t = k / s
        a = theta + twist * t
        d = Vector((cos(a), 0, sin(a)))
        c = centre(t)
        rings.append((c - d * width * f / 2, c + d * width * f / 2))
    tip = centre(1.0)
    for k in range(s - 1):
        mat = KELP_TIP if k >= s - 2 else KELP
        (l0, r0), (l1, r1) = rings[k], rings[k + 1]
        part.quad(l0, r0, r1, l1, mat, both=True)
    part.tri(rings[-1][0], rings[-1][1], tip, KELP_TIP, both=True)


a = collection('flora_kelp_a')
p = Part(a, 'blades')
F5 = [0.62, 0.95, 1.0, 0.86, 0.5]
kelp_blade(p, (0.00, 0, 0.00), radians(20), 1.50, 0.16, 0.10, 0.08, 0.0, 0.5, F5)
kelp_blade(p, (0.05, 0, -0.04), radians(115), 1.18, 0.14, -0.09, 0.07, 1.7, -0.4, F5)
kelp_blade(p, (-0.05, 0, 0.03), radians(-40), 0.92, 0.12, 0.08, 0.07, 3.1, 0.6, F5)
kelp_a = p
p.build()

a = collection('flora_kelp_b')
p = Part(a, 'blades')
F6 = [0.6, 0.9, 1.0, 1.0, 0.85, 0.5]
F4 = [0.6, 1.0, 0.9, 0.5]
kelp_blade(p, (0.02, 0, 0.00), radians(70), 1.20, 0.20, -0.12, 0.07, 0.8, 0.5, F6)
kelp_blade(p, (-0.04, 0, -0.03), radians(-15), 0.98, 0.18, 0.10, 0.08, 2.4, -0.5, F6)
kelp_blade(p, (0.03, 0, 0.05), radians(150), 0.70, 0.11, 0.07, 0.05, 4.0, 0.4, F4)
kelp_b = p
p.build()


# ---- corals -------------------------------------------------------------------------------
def frustum(part, p0, p1, r0, r1, mat, tip_mat=None, apex_len=0.0, spin=0.0, cap=False):
    """A three-sided tapering prong from p0 to p1. With `apex_len` it ends in a point that far
    beyond p1 (in tip_mat), with `cap` in a flat triangle. A prong is three-sided because that is
    the cheapest thing solid enough to be seen from every side."""
    axis = (Vector(p1) - Vector(p0)).normalized()
    ref = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    A = [Vector(p0) + (u * cos(spin + 2 * pi * k / 3) + v * sin(spin + 2 * pi * k / 3)) * r0 for k in range(3)]
    B = [Vector(p1) + (u * cos(spin + 2 * pi * k / 3) + v * sin(spin + 2 * pi * k / 3)) * r1 for k in range(3)]
    inside = (Vector(p0) + Vector(p1)) / 2
    for k in range(3):
        part.quad(A[k], A[(k + 1) % 3], B[(k + 1) % 3], B[k], mat, away_from=inside)
    if apex_len:
        top = Vector(p1) + axis * apex_len
        for k in range(3):
            part.tri(B[k], B[(k + 1) % 3], top, tip_mat or mat, away_from=inside)
    elif cap:
        part.tri(B[0], B[1], B[2], mat, away_from=inside)
    return axis


def pyramid(part, q, direction, r, length, mat, spin=0.0):
    """A thorn: three triangles standing on a ring round q that lies inside whatever it grows out of."""
    axis = Vector(direction).normalized()
    ref = Vector((0, 1, 0)) if abs(axis.y) < 0.9 else Vector((1, 0, 0))
    u = axis.cross(ref).normalized()
    v = axis.cross(u).normalized()
    A = [Vector(q) + (u * cos(spin + 2 * pi * k / 3) + v * sin(spin + 2 * pi * k / 3)) * r for k in range(3)]
    part.apex(A, Vector(q) + axis * length, mat, away_from=Vector(q))


def sea_fan(part, yaw, scale):
    """One fan: nine points round a hinge, the long lobes forward and the notches back so it is
    corrugated and not a card, both faces, and five dark spokes standing proud of the long lobes."""
    hinge = Vector((0, 0.06, 0))
    rim = []
    for i in range(9):
        phi = radians(-58 + 116 * i / 8)
        long_lobe = i % 2 == 0
        R = 0.44 if long_lobe else 0.35
        rim.append(Vector((R * sin(phi), 0.06 + R * cos(phi), 0.018 if long_lobe else -0.018)))

    def T(v):
        v = v * scale
        return Vector((v.x * cos(yaw) + v.z * sin(yaw), v.y, -v.x * sin(yaw) + v.z * cos(yaw)))

    front = Vector((sin(yaw), 0, cos(yaw)))     # the fan's +z, turned with it
    for i in range(8):
        part.tri(T(hinge), T(rim[i]), T(rim[i + 1]), FAN, toward=front)
        part.tri(T(hinge), T(rim[i]), T(rim[i + 1]), FAN, toward=-front)
    for i in range(0, 9, 2):
        for side in (1, -1):
            o = Vector((0, 0, 0.006 * side))
            part.tri(T(hinge + o + Vector((-0.016, 0, 0))), T(hinge + o + Vector((0.016, 0, 0))), T(rim[i] + o),
                     FAN_DARK, toward=front * side)


a = collection('flora_coral_fan')
p = Part(a, 'fan')
frustum(p, (0, 0, 0), (0, 0.07, 0), 0.030, 0.022, FAN_DARK, spin=pi / 2)
sea_fan(p, 0.0, 1.0)
sea_fan(p, radians(65), 0.72)
fan_part = p
p.build()

a = collection('flora_coral_branch')
p = Part(a, 'branches')
frustum(p, (0, 0, 0), (0, 0.20, 0), 0.060, 0.045, BRANCH, cap=True, spin=0.3)
foot = Vector((0, 0.17, 0))
# azimuth, tilt from the vertical, length, radius at the foot: the four that lean out, then the
# one that stands up in the middle
PRONGS = [(radians(20), radians(30), 0.36, 0.038), (radians(110), radians(38), 0.30, 0.036),
          (radians(200), radians(26), 0.42, 0.040), (radians(290), radians(44), 0.26, 0.034),
          (0.0, radians(8), 0.44, 0.045)]
for k, (az, tilt, length, r0) in enumerate(PRONGS):
    d = Vector((sin(tilt) * cos(az), cos(tilt), sin(tilt) * sin(az)))
    frustum(p, foot, foot + d * length, r0, 0.02, BRANCH, BRANCH_TIP, apex_len=0.03, spin=0.5 * k)
    if k in (0, 2):
        # a thorn a little over halfway up, leaning outward
        q = foot + d * length * 0.55
        out = Vector((cos(az), 0.6, sin(az)))
        pyramid(p, q, out, 0.020, 0.10, BRANCH_TIP, spin=0.2)
branch_part = p
p.build()

a = collection('flora_coral_dome')
p = Part(a, 'dome')
rng = Rng(4711)
here = Vector((0, 0.13, 0))
# (y, radius) up the dome; each ring is half a step turned from the one below, so the bands are
# an antiprism and the triangles alternate
levels = [(0.0, 0.30), (0.12, 0.345), (0.24, 0.28), (0.32, 0.14)]
rings = []
for j, (y, r) in enumerate(levels):
    rings.append(ring(8, r, y, phase=(j % 2) * pi / 8, rng=rng, radial=0.07,
                      lift=0.0 if j == 0 else 0.010, angular=0.15))
for j in range(3):
    p.zip(rings[j], rings[j + 1], DOME if j < 2 else DOME_TOP, here)
p.cap(rings[3], DOME_TOP, here)
dome_part = p
p.build()


# ---- rocks --------------------------------------------------------------------------------
a = collection('flora_rock_sea_a')
p = Part(a, 'boulder')
rng = Rng(9001)
here = Vector((0, 0.20, 0))
R = [ring(6, 0.30, 0.0, 0.10, rng=rng, radial=0.15, angular=0.12),
     ring(6, 0.37, 0.19, 0.55, rng=rng, radial=0.15, angular=0.12, lift=0.025),
     ring(5, 0.25, 0.37, 0.30, at=(0.04, -0.03), rng=rng, radial=0.15, angular=0.12, lift=0.025),
     ring(4, 0.12, 0.47, 1.00, at=(0.05, -0.04), rng=rng, radial=0.15, angular=0.12, lift=0.02)]
p.zip(R[0], R[1], ROCK, here)
p.zip(R[1], R[2], ROCK, here)
p.zip(R[2], R[3], ROCK_MOSS, here)
p.cap(R[3], ROCK_MOSS, here)
rock_a = p
p.build()

a = collection('flora_rock_sea_b')
p = Part(a, 'shelf')
rng = Rng(3141)
here = Vector((0, 0.08, 0))
R = [ring(7, 0.33, 0.0, 0.2, rng=rng, radial=0.12, angular=0.12),
     ring(7, 0.38, 0.11, 0.65, rng=rng, radial=0.12, angular=0.12, lift=0.015),
     ring(5, 0.21, 0.19, 0.40, at=(-0.03, 0.02), rng=rng, radial=0.12, angular=0.12, lift=0.01)]
p.zip(R[0], R[1], ROCK, here)
p.zip(R[1], R[2], ROCK_MOSS, here)
p.cap(R[2], ROCK_MOSS, here)
# two pebbles, each four triangles up to a point, standing on the sand beside the shelf
for (x, z, r, h) in ((0.48, -0.12, 0.08, 0.10), (-0.46, 0.20, 0.065, 0.08)):
    base = ring(4, r, 0.0, 0.5, at=(x, z), rng=rng, radial=0.1, angular=0.1)
    p.apex(base, Vector((x, h, z)), ROCK, Vector((x, h * 0.4, z)))
rock_b = p
p.build()


# ---- a shell and a starfish ---------------------------------------------------------------
a = collection('prop_shell')
p = Part(a, 'valve')
R = 0.095
hinge_z = -0.05
angs = [radians(-75 + 150 * i / 8) for i in range(9)]


def at(rad, y, i):
    return Vector((sin(angs[i]) * rad, y, hinge_z + cos(angs[i]) * rad))


ridge = [i % 2 == 0 for i in range(9)]
Ht, Hb = Vector((0, 0.034, hinge_z)), Vector((0, 0, hinge_z))
M = [at(0.55 * R, 0.050 if ridge[i] else 0.040, i) for i in range(9)]
O = [at(R, 0.028 if ridge[i] else 0.010, i) for i in range(9)]
Ob = [at(R, 0.0, i) for i in range(9)]
inside = Vector((0, 0.012, 0))
for i in range(8):
    p.tri(Ht, M[i], M[i + 1], SHELL, away_from=inside)
    p.quad(M[i], M[i + 1], O[i + 1], O[i], SHELL_RIM, away_from=inside)
    p.quad(O[i], O[i + 1], Ob[i + 1], Ob[i], SHELL_RIM, away_from=inside)
    p.tri(Hb, Ob[i], Ob[i + 1], SHELL, away_from=inside)
for i in (0, 8):
    p.quad(Ht, O[i], Ob[i], Hb, SHELL_RIM, away_from=inside)
shell_part = p
p.build()

a = collection('prop_starfish')
p = Part(a, 'body')
inside = Vector((0, 0.012, 0))
Ct, Cb = Vector((0, 0.030, 0)), Vector((0, 0, 0))
tips, notches, ridges = [], [], []
for k in range(5):
    t = pi / 2 + 2 * pi * k / 5
    n = t + pi / 5
    tips.append(Vector((cos(t) * 0.090, 0.0, sin(t) * 0.090)))
    notches.append(Vector((cos(n) * 0.038, 0.008, sin(n) * 0.038)))
    ridges.append(Vector((cos(t) * 0.058, 0.022, sin(t) * 0.058)))
for k in range(5):
    T, Mr = tips[k], ridges[k]
    Lft, Rgt = notches[(k - 1) % 5], notches[k]
    p.tri(Ct, Lft, Mr, STAR, away_from=inside)
    p.tri(Ct, Mr, Rgt, STAR, away_from=inside)
    p.tri(Lft, T, Mr, STAR_TIP, away_from=inside)
    p.tri(Mr, T, Rgt, STAR_TIP, away_from=inside)
    # under the star: one wedge to the centre for each half arm, and the sliver of side between a
    # notch (a few millimetres up) and the flat underside
    p.tri(Cb, Vector((Lft.x, 0, Lft.z)), T, STAR, away_from=inside)
    p.tri(Cb, T, Vector((Rgt.x, 0, Rgt.z)), STAR, away_from=inside)
    p.tri(Lft, Vector((Lft.x, 0, Lft.z)), T, STAR, away_from=inside)
    p.tri(Rgt, T, Vector((Rgt.x, 0, Rgt.z)), STAR, away_from=inside)
star_part = p
p.build()


# ---- two fish -----------------------------------------------------------------------------
def hexring(z, wx, cy, hy):
    """A six-sided section of the body: back, both shoulders, belly, both flanks."""
    return [Vector((0, cy + hy, z)), Vector((wx, cy + hy * 0.45, z)), Vector((wx, cy - hy * 0.45, z)),
            Vector((0, cy - hy, z)), Vector((-wx, cy - hy * 0.45, z)), Vector((-wx, cy + hy * 0.45, z))]


def fish_body(part, nose, sections, centre_y, mat_of):
    """The closed body: a point at the nose, a band to each next section, a flat tail end. mat_of
    says which material a strip of a band is (band 0 is the nose's, the last is the tail end)."""
    rings = [hexring(*s) for s in sections]
    here = Vector((0, centre_y, 0))
    for i in range(6):
        part.tri(nose, rings[0][i], rings[0][(i + 1) % 6], mat_of(0, i), away_from=here)
    for b in range(len(rings) - 1):
        for i in range(6):
            part.quad(rings[b][i], rings[b][(i + 1) % 6], rings[b + 1][(i + 1) % 6], rings[b + 1][i],
                      mat_of(b + 1, i), away_from=here)
    last = rings[-1]
    for k in range(1, 5):
        part.tri(last[0], last[k], last[k + 1], mat_of(len(rings), 0), toward=Vector((0, 0, -1)))


def side_plate(part, pts, mat):
    """A flat fin in the plane x = 0 given as a polygon in (z, y), written on both faces."""
    v = [Vector((0, y, z)) for (z, y) in pts]
    for k in range(1, len(v) - 1):
        part.tri(v[0], v[k], v[k + 1], mat, both=True)


def eyes(part, z, y, x, size):
    for side in (1, -1):
        h = size / 2
        a, b = Vector((side * x, y - h, z - h)), Vector((side * x, y - h, z + h))
        c, d = Vector((side * x, y + h, z + h)), Vector((side * x, y + h, z - h))
        part.quad(a, b, c, d, EYE, toward=Vector((side, 0, 0)))


def fin_pair(part, root_front, root_back, tip, mat):
    """A pectoral fin on each flank: a triangle, both faces."""
    for side in (1, -1):
        part.tri(Vector((side * root_front[0], root_front[1], root_front[2])),
                 Vector((side * root_back[0], root_back[1], root_back[2])),
                 Vector((side * tip[0], tip[1], tip[2])), mat, both=True)


# fish A: a deep, striped reef fish 0.28 long, belly on y = 0 at its deepest section
a = collection('fauna_fish_a')
p = Part(a, 'body')
sections_a = [(0.095, 0.020, 0.078, 0.045), (0.045, 0.032, 0.072, 0.072), (0.000, 0.034, 0.075, 0.075),
              (-0.050, 0.025, 0.080, 0.055), (-0.095, 0.014, 0.080, 0.028)]
fish_body(p, Vector((0, 0.075, 0.130)), sections_a, 0.075,
          lambda band, strip: FISH_A_STRIPE if band in (1, 3) else FISH_A)
dorsal_base = [(0.045, 0.140), (0.000, 0.146), (-0.050, 0.131), (-0.095, 0.104)]
dorsal_top = [(0.030, 0.175), (-0.010, 0.215), (-0.060, 0.185), (-0.095, 0.125)]
for k in range(3):
    zb0, yb0 = dorsal_base[k]
    zb1, yb1 = dorsal_base[k + 1]
    zt0, yt0 = dorsal_top[k]
    zt1, yt1 = dorsal_top[k + 1]
    quad = [Vector((0, yb0, zb0)), Vector((0, yb1, zb1)), Vector((0, yt1, zt1)), Vector((0, yt0, zt0))]
    p.quad(*quad, FISH_A_FIN, both=True)
side_plate(p, [(-0.090, 0.100), (-0.150, 0.135), (-0.125, 0.080), (-0.150, 0.025), (-0.090, 0.060)], FISH_A_FIN)
fin_pair(p, (0.033, 0.070, 0.035), (0.033, 0.060, 0.012), (0.078, 0.045, -0.010), FISH_A_FIN)
eyes(p, 0.075, 0.095, 0.0263, 0.013)
fish_a = p
p.build()

# fish B: a slim, two-tone shoaling fish 0.30 long
a = collection('fauna_fish_b')
p = Part(a, 'body')
sections_b = [(0.110, 0.014, 0.046, 0.028), (0.050, 0.022, 0.045, 0.045), (-0.020, 0.022, 0.045, 0.045),
              (-0.070, 0.012, 0.042, 0.026), (-0.105, 0.007, 0.040, 0.014)]
fish_body(p, Vector((0, 0.045, 0.150)), sections_b, 0.045,
          lambda band, strip: FISH_B if strip in (5, 0) else FISH_B_BELLY)
side_plate(p, [(0.035, 0.088), (-0.030, 0.088), (-0.020, 0.135)], FISH_B_FIN)
side_plate(p, [(-0.048, 0.076), (-0.078, 0.063), (-0.066, 0.102)], FISH_B_FIN)
side_plate(p, [(-0.105, 0.054), (-0.150, 0.090), (-0.130, 0.040), (-0.150, 0.000), (-0.105, 0.026)], FISH_B_FIN)
fin_pair(p, (0.020, 0.048, 0.060), (0.020, 0.042, 0.045), (0.045, 0.030, 0.035), FISH_B_FIN)
eyes(p, 0.100, 0.050, 0.0163, 0.009)
fish_b = p
p.build()


# ---- the count, before Blender is asked -----------------------------------------------------
BUDGET = {kelp_a: 60, kelp_b: 60, fan_part: 60, branch_part: 60, dome_part: 60, rock_a: 40, rock_b: 40,
          shell_part: 120, star_part: 120, fish_a: 150, fish_b: 150}
for part, budget in BUDGET.items():
    tris = len(part.tris)
    print(f'{part.coll.name}: {tris} triangles of {budget}')
    assert tris <= budget, f'{part.name} is {tris} triangles, over {budget}'
    assert abs(part.lowest()) < 1e-6, f'{part.name} does not stand on y = 0 ({part.lowest()})'

bpy.context.scene['building_height'] = 1.5
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'sea.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'sea'})
