"""The bicycle a settler rides. Rebuild with scripts/blender.mjs --background --python scripts/build-bicycle.py.

Modelled after Ideas/Images to Render/bicycle_parts.png: a low-poly blue frame, black tyres
on grey rims, a black saddle, bars and cranks. One hero set (no asset collections), because
it is one thing, but in seven moving parts, each with its Blender origin on the axis it
turns about - which is what lets web/js/bicycle.js hang every part on its own pivot straight
from the baked `at`, with no second copy of where an axle is:

    bicycle frame          still: tubes, head tube, saddle, the chain's two runs
    bicycle wheel rear     spins about x at the rear axle (the sprocket turns with it)
    bicycle wheel front    spins about x at the front axle, and steers with the fork
    bicycle steer          fork, stem and bars; turns about the head tube, origin in its middle
    bicycle crank          chainring and both arms, about x at the bottom bracket
    bicycle pedal left     each pedal on its own spindle, so it can stay level while the
    bicycle pedal right    crank goes round (bicycle.js puts it at the arm's end every frame)

The steering axis is the line from the steer origin to the front axle: the fork legs run down
it, so bicycle.js reads the head angle off the two baked origins instead of a constant here.

Sized to the settler, not to metres: the figure is 0.62 tall with its hips at 0.157
(PLAYER_SCALE), so the saddle stands at hip height and the bars where the hands can reach.
Written in island coordinates (x right, y up, z forward) and handed to Blender through xyz().
"""
import bpy
import math
import runpy
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/bicycle'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)


def xyz(p):
    return Vector((p[0], -p[2], p[1]))


def material(name, color):
    m = bpy.data.materials.new('plain:' + name)
    rgb = [((color >> s) & 255) / 255 for s in (16, 8, 0)]
    rgb = [v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb]
    m.diffuse_color = (*rgb, 1)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    return m


BLUE = material('bike blue', 0x2d6fd4)
TYRE = material('bike tyre', 0x1e1e21)
RIM = material('bike rim', 0xaeb2b7)
SPOKE = material('bike spoke', 0xcfd2d6)
BLACK = material('bike black', 0x2a2a2e)
CHAIN = material('bike chain', 0x8a8e93)
AMBER = material('bike reflector', 0xe0892a)

# ---- the geometry, in island units -------------------------------------------------
TYRE_R = 0.095                       # outer radius: the tyre stands on y = 0
TYRE_T = 0.013                       # the tyre's own tube
RIM_R = 0.071
REAR = Vector((0, TYRE_R, -0.165))   # axles
BB = Vector((0, 0.074, -0.018))      # bottom bracket
SEAT = Vector((0, 0.196, -0.068))    # where the seat tube meets the top tube
HEAD_TOP = Vector((0, 0.238, 0.100))
HEAD_BOTTOM = Vector((0, 0.186, 0.118))
AXIS = (HEAD_BOTTOM - HEAD_TOP).normalized()   # down the steerer, towards the road
# The front axle on the steering axis, at wheel height: the fork has no offset, so the axis
# through the head tube is the line bicycle.js steers about.
FRONT = HEAD_BOTTOM + AXIS * ((TYRE_R - HEAD_BOTTOM.y) / AXIS.y)
STEER = (HEAD_TOP + HEAD_BOTTOM) / 2
CRANK_L = 0.036                      # crank arm, axle to pedal spindle
TUBE = 0.0085


class Part:
    """One Blender object: faces collected around its own origin, one material per face."""

    def __init__(self, name, origin):
        self.name, self.origin = 'bicycle ' + name, Vector(origin)
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
        bpy.context.scene.collection.objects.link(obj)
        return obj


def basis(d):
    """Two unit vectors square to `d`, the same pair every time for the same `d`."""
    d = d.normalized()
    ref = Vector((1, 0, 0)) if abs(d.x) < 0.9 else Vector((0, 1, 0))
    u = d.cross(ref).normalized()
    return u, d.cross(u).normalized()


def tube(part, a, b, r, mat, sides=6, caps=False, r2=None):
    a, b = Vector(a), Vector(b)
    u, v = basis(b - a)
    ring = lambda c, rr: [c + (u * math.cos(t) + v * math.sin(t)) * rr
                          for t in (2 * math.pi * i / sides + math.pi / sides for i in range(sides))]
    pts = ring(a, r) + ring(b, r if r2 is None else r2)
    faces = [[i, (i + 1) % sides, sides + (i + 1) % sides, sides + i] for i in range(sides)]
    if caps:
        faces += [list(range(sides))[::-1], list(range(sides, 2 * sides))]
    part.add(pts, faces, mat)


def box(part, centre, size, mat, yaw=0.0):
    c, (sx, sy, sz) = Vector(centre), size
    cs, sn = math.cos(yaw), math.sin(yaw)
    pts = []
    for x, y, z in ((-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)):
        px, pz = x * sx / 2, z * sz / 2
        pts.append(c + Vector((px * cs + pz * sn, y * sy / 2, -px * sn + pz * cs)))
    part.add(pts, [[0, 3, 2, 1], [4, 5, 6, 7], [0, 1, 5, 4], [2, 3, 7, 6], [1, 2, 6, 5], [0, 4, 7, 3]], mat)


def torus(part, centre, major, minor, mat, segs=20, sides=4, tread=False):
    """A ring about the x axis - a tyre or a rim. `tread` turns a corner of the tube's
    section straight out, so the tyre touches y = 0 exactly rather than on a flat."""
    c, pts = Vector(centre), []
    for i in range(segs):
        t = 2 * math.pi * i / segs
        e = Vector((0, math.cos(t), math.sin(t)))
        for j in range(sides):
            f = 2 * math.pi * j / sides + (0 if tread else math.pi / sides)
            pts.append(c + e * (major + minor * math.cos(f)) + Vector((minor * math.sin(f), 0, 0)))
    faces = [[i * sides + j, i * sides + (j + 1) % sides, ((i + 1) % segs) * sides + (j + 1) % sides,
              ((i + 1) % segs) * sides + j] for i in range(segs) for j in range(sides)]
    part.add(pts, faces, mat)


def disc(part, centre, radii, width, mat):
    """A flat plate about the x axis whose outline runs through `radii` - a toothed ring, a cog."""
    c, n = Vector(centre), len(radii)
    ring = lambda dx: [c + Vector((dx, math.cos(2 * math.pi * i / n) * r, math.sin(2 * math.pi * i / n) * r))
                       for i, r in enumerate(radii)]
    pts = ring(-width / 2) + ring(width / 2)
    faces = [list(range(n))[::-1], list(range(n, 2 * n))]
    faces += [[i, (i + 1) % n, n + (i + 1) % n, n + i] for i in range(n)]
    part.add(pts, faces, mat)


def loft(part, sections, mat):
    """Closed rings of equal length, joined in order and capped - the saddle."""
    n, pts = len(sections[0]), [Vector(p) for s in sections for p in s]
    faces = [list(range(n))[::-1], [len(pts) - n + i for i in range(n)]]
    for k in range(len(sections) - 1):
        faces += [[k * n + i, k * n + (i + 1) % n, (k + 1) * n + (i + 1) % n, (k + 1) * n + i] for i in range(n)]
    part.add(pts, faces, mat)


def wheel(name, at, sprocket=False):
    p = Part(name, at)
    torus(p, at, TYRE_R - TYRE_T, TYRE_T, TYRE, tread=True)
    torus(p, at, RIM_R, 0.0055, RIM, segs=20, sides=3)
    tube(p, at + Vector((-0.024, 0, 0)), at + Vector((0.024, 0, 0)), 0.011, BLACK, caps=True)
    # Twelve spokes, laced from the two hub flanges to the middle of the rim so they cross.
    for i in range(12):
        t = 2 * math.pi * i / 12
        e = Vector((0, math.cos(t), math.sin(t)))
        side = 0.014 if i % 2 else -0.014
        tube(p, at + Vector((side, 0, 0)) + e * 0.01, at + e * (RIM_R - 0.004), 0.0022, SPOKE, sides=3)
    if sprocket:
        disc(p, at + Vector((0.036, 0, 0)), [0.02 if i % 2 else 0.016 for i in range(16)], 0.006, CHAIN)
    return p


frame = Part('frame', (0, 0, 0))
top_join = HEAD_TOP + AXIS * 0.012
down_join = HEAD_BOTTOM - AXIS * 0.01
tube(frame, SEAT, top_join, TUBE, BLUE)
tube(frame, BB, down_join, TUBE * 1.15, BLUE)
tube(frame, BB, SEAT + Vector((0, 0.008, -0.003)), TUBE, BLUE)
tube(frame, HEAD_TOP - AXIS * 0.006, HEAD_BOTTOM + AXIS * 0.004, 0.0125, BLUE, caps=True)
tube(frame, BB + Vector((-0.03, 0, 0)), BB + Vector((0.03, 0, 0)), 0.0125, BLUE, caps=True)
for side in (-1, 1):
    drop = REAR + Vector((side * 0.026, 0, 0))
    tube(frame, SEAT + Vector((side * 0.01, -0.012, -0.004)), drop, 0.0055, BLUE)
    tube(frame, BB + Vector((side * 0.02, 0, -0.008)), drop, 0.0055, BLUE)
    box(frame, drop, (0.006, 0.02, 0.016), BLUE)
# Seat post and saddle, black like the reference.
post_top = SEAT + (SEAT - BB).normalized() * 0.022
tube(frame, SEAT, post_top, 0.0065, BLACK)
sy = post_top.y + 0.004
saddle = []
for z, w, h in ((-0.034, 0.024, 0.013), (-0.014, 0.022, 0.012), (0.012, 0.011, 0.01), (0.036, 0.007, 0.008)):
    z += post_top.z + 0.004
    saddle.append([(-w, sy, z), (w, sy, z), (w * 1.05, sy + h * 0.7, z), (w * 0.55, sy + h, z),
                   (-w * 0.55, sy + h, z), (-w * 1.05, sy + h * 0.7, z)])
loft(frame, saddle, BLACK)
# The chain: its two runs from the top and bottom of the chainring to the sprocket, on the
# drive side. Still, on purpose - a moving chain at this size is noise, and the ring and the
# sprocket turning at either end of it already read as a drive.
cx = 0.036
for s in (1, -1):
    tube(frame, BB + Vector((cx, 0.032 * s, 0.003)), REAR + Vector((cx, 0.0185 * s, -0.004)), 0.0028, CHAIN, sides=3)

rear = wheel('wheel rear', REAR, sprocket=True)
front = wheel('wheel front', FRONT)

steer = Part('steer', STEER)
crown = HEAD_BOTTOM + AXIS * 0.006
box(steer, crown, (0.056, 0.012, 0.02), BLUE)
for side in (-1, 1):
    tube(steer, crown + Vector((side * 0.022, 0, 0)), FRONT + Vector((side * 0.021, 0, 0)), 0.0065, BLUE, r2=0.005)
    box(steer, FRONT + Vector((side * 0.021, 0, 0)), (0.006, 0.016, 0.014), BLUE)
# Steerer up out of the head tube, then the stem forward to the bar clamp.
riser = HEAD_TOP - AXIS * 0.03
tube(steer, HEAD_TOP - AXIS * 0.004, riser, 0.0085, BLACK, caps=True)
clamp = riser + Vector((0, 0.012, 0.03))
tube(steer, riser, clamp, 0.008, BLACK)
tube(steer, clamp + Vector((-0.012, 0, 0)), clamp + Vector((0.012, 0, 0)), 0.01, BLACK, caps=True)
for side in (-1, 1):
    bend = clamp + Vector((side * 0.045, 0.004, -0.004))
    end = clamp + Vector((side * 0.1, 0.006, -0.018))
    tube(steer, clamp, bend, 0.0055, BLACK)
    tube(steer, bend, end, 0.0055, BLACK)
    grip = bend + (end - bend) * 0.4
    tube(steer, grip, end + (end - bend).normalized() * 0.004, 0.0095, BLACK, caps=True)

crank = Part('crank', BB)
disc(crank, BB + Vector((cx, 0, 0)), [0.034 if i % 2 else 0.029 for i in range(28)], 0.005, BLACK)
tube(crank, BB + Vector((-0.036, 0, 0)), BB + Vector((0.044, 0, 0)), 0.0055, BLACK)
for side in (-1, 1):
    # Right arm down, left arm up: the pair are half a turn apart, as they are on a real crank.
    tip = BB + Vector((side * 0.046, -side * CRANK_L, 0))
    tube(crank, BB + Vector((side * 0.044, 0, 0)), tip, 0.0055, BLACK, caps=True, r2=0.0045)
    pedal = Part('pedal ' + ('right' if side > 0 else 'left'), tip + Vector((side * 0.014, 0, 0)))
    box(pedal, pedal.origin, (0.026, 0.008, 0.022), BLACK)
    box(pedal, pedal.origin + Vector((0, 0, 0.0115)), (0.02, 0.005, 0.002), AMBER)
    box(pedal, pedal.origin + Vector((0, 0, -0.0115)), (0.02, 0.005, 0.002), AMBER)
    pedal.build()

for p in (frame, rear, front, steer, crank):
    p.build()

bpy.context.scene['building_height'] = round(clamp.y + 0.02, 3)
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'bicycle.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'bicycle'})
