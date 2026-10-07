"""The horse's closed surfaces and editable armature, called by build-fauna.py.

Coordinates and material helpers are passed in by that builder. All deformation is authored
here; the page receives ordinary baked triangles, weights and the same rest-bone positions.

The anatomy is laid on in two steps, so the bones, the leg chains and every `sole` stay exactly
where the gaits, the IK and the rider expect them: first the same lofts as before (more rings and
more sides round, the same stations), then soft bumps that move a surface outwards where a horse
carries muscle - the point of the shoulder, the quarters, the point of the hip, the withers, the
croup, the breast, the cheeks - and in where it is tucked up (the flank). Each bump is a smooth
polynomial of the distance to its centre, so a closed ring stays closed and the skin weights,
which are a function of the rest position, stay smooth. The barrel under the saddle flaps is drawn
in instead, where the rider's knees lie (tests/horseback-pose.test.mjs measures his legs against it).

The head is a skull of its own over the neck's end: superellipse sections along one straight line
(forehead to nose), wide and flat above, deep at the jowls, narrow past the jaw line, swelling at the
muzzle; bone under the skin as bumps (brow ridge, the hollow over the eye, the facial crest); and
whatever is worn on it - eyes, nostrils, cup ears, blaze, forelock, bridle - set down on its surface
by casting rays at it, so nothing floats off it or sinks in.

The coat is the vertex colour (the island has no textures; the exporter reads a colour attribute
in place of the material's flat colour): the material's colour times a shade - darker along the
topline and towards the points, lighter underneath, a few faint dapples and a fine coat noise, a
lighter band round each hoof, streaks in the mane and tail - times an ambient occlusion worked out
here by casting rays against the horse itself (BVHTree, a fixed set of directions per corner), not
by Cycles: no sampler and no thread count, so a second bake writes the same bytes.
"""
import json
import bmesh
from mathutils import noise
from mathutils.bvhtree import BVHTree

a = collection('fauna_horse')
bones = []


def joint(name, point, parent):
    bones.append(dict(name=name, at=list(point), parent=parent))
    return len(bones) - 1


joint('body', (0, .39, 0), -1)
joint('neck', (0, .435, .16), 0)
joint('head', (0, .605, .285), 1)
joint('tail', (0, .424, -.246), 0)
joint('tailTip', (0, .26, -.305), 3)
legs = []
for key, sx, front in [('fl', -1, True), ('fr', 1, True), ('bl', -1, False), ('br', 1, False)]:
    x, z = sx * .061, .163 if front else -.183
    root = joint(key + ':upper', (x, .35, z), 0)
    bend = joint(key + ':knee', (x, .191, z + (.005 if front else -.032)), root)
    end = joint(key + ':hoof', (x, .043, z + .012), bend)
    legs.append(dict(name=key, root=root, bend=bend, end=end, front=front, sole=.043))

rig = dict(bones=bones, legs=legs, neck=1, head=2, tail=3, tailTip=4)
parts = []


def smoothstep(a, b, v):
    t = max(0, min(1, (v-a)/(b-a)))
    return t*t*(3-2*t)


def blob(p, c, r, mirror=True):
    """1 at c falling to 0 at distance r, smooth all the way: (1 - d^2/r^2)^2. With `mirror` the
    centre's x is a distance from the middle, so one call shapes both sides alike."""
    x = abs(p.x) if mirror else p.x
    d2 = ((x-c[0])**2 + (p.y-c[1])**2 + (p.z-c[2])**2) / (r*r)
    return (1-d2)**2 if d2 < 1 else 0


def refine(rows):
    """Catmull-Rom midpoints between every pair of stations: twice the rings along the same
    curve, so the old outline is kept and only grows rounder."""
    out = []
    n = len(rows)
    for i in range(n-1):
        p0, p1, p2, p3 = rows[max(0, i-1)], rows[i], rows[i+1], rows[min(n-1, i+2)]
        out.append(p1)
        out.append(tuple(-.0625*a0 + .5625*a1 + .5625*a2 - .0625*a3 for a0, a1, a2, a3 in zip(p0, p1, p2, p3)))
    out.append(rows[-1])
    return out


def reshape(part, start, move):
    """Move the vertices added to `part` since index `start`: `move(p)` answers an offset for the
    point p in island coordinates."""
    for i in range(start, len(part.verts)):
        world = part.verts[i] + part.origin
        part.verts[i] = part.verts[i] + move(world)


def finish(part, weight):
    obj = part.build()
    # Explicit outward winding: a closed shape with inward caps still disappears from one side.
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    assert not any(e.is_boundary or not e.is_manifold for e in bm.edges), part.name + ' has an open edge'
    bm.to_mesh(obj.data)
    bm.free()
    for poly in obj.data.polygons:
        # Keep straps, buckles and irons crisp; the coat and the draped saddle are smooth.
        label = obj.data.materials[poly.material_index].name
        poly.use_smooth = not any(s in label for s in ['brass', 'stirrup', 'bridle', 'girth'])
    groups = [obj.vertex_groups.new(name='horse:' + str(i)) for i in range(len(bones))]
    for v in obj.data.vertices:
        p = Vector((v.co.x, v.co.z, -v.co.y)) + part.origin
        for index, value in weight(p).items():
            if value > 0:
                groups[index].add([v.index], value, 'REPLACE')
    obj['skin_rig'] = 'horse'
    parts.append(obj)
    return obj


def oval(part, centre, size, mat, sides=12, bands=8):
    # Capped latitude rings without duplicated pole vertices (no degenerate triangles).
    cx, cy, cz = centre
    sx, sy, sz = size
    sections = []
    for k in range(1, bands):
        t = -math.pi/2 + math.pi*k/bands
        sections.append(((cx, cy+sy/2*math.sin(t), cz), (0, 1, 0), sx*math.cos(t), sz*math.cos(t)))
    pts = [p for c, d, w, h in sections for p in ring(c, d, w, h, sides)]
    faces = loft_faces(len(sections), sides, caps=False)
    bottom, top = len(pts), len(pts)+1
    pts += [Vector((cx, cy-sy/2, cz)), Vector((cx, cy+sy/2, cz))]
    for i in range(sides):
        faces += [[bottom, (i+1)%sides, i], [top, (len(sections)-1)*sides+i, (len(sections)-1)*sides+(i+1)%sides]]
    part.add(pts, faces, mat)


def lock(part, points, widths, heights, mat, sides=6):
    """A lock of hair: a closed tapering tube, its tip a ring a hair wide rather than a point."""
    loft(part, along(points, widths, heights), mat, sides=sides)


def hashed(i, salt):
    """A fixed number in [0, 1) per lock: a spread that is the same on every bake."""
    v = math.sin(i * 12.9898 + salt * 78.233) * 43758.5453
    return v - math.floor(v)


# ---- the body ------------------------------------------------------------------------------
body = Part(a, 'body')
loft(body, [((0, y, z), (0, 0, 1), w, h) for z, y, w, h in refine([
    (-.275,.391,.07,.1),(-.245,.395,.15,.174),(-.2,.39,.188,.206),
    (-.14,.381,.197,.21),(-.075,.375,.194,.211),(0,.376,.184,.205),
    (.07,.386,.177,.21),(.13,.402,.172,.203),(.19,.417,.139,.181),(.235,.428,.084,.12)])], BAY, sides=20)
# Taper the back beneath the saddle so the rider's inner thighs clear the coat.
for p in body.verts:
    p.x *= 1 - .38 * smoothstep(.415, .452, p.y) * (1-smoothstep(.045,.12,abs(p.z)))


def body_shape(p):
    side = 1 if p.x >= 0 else -1
    # Nothing crosses the middle: a vertex on the centre line gets no sideways push.
    out = smoothstep(0, .02, abs(p.x)) * side * (
        .021 * blob(p, (.08, .34, .172), .075)      # point of the shoulder and the triceps
        + .006 * blob(p, (.075, .4, .145), .045)   # the shoulder blade, kept forward of the knee
        + .024 * blob(p, (.088, .345, -.19), .085) # the quarters, over the stifle
        + .007 * blob(p, (.072, .42, -.14), .035)) # the point of the hip
    up = (.016 * blob(p, (0, .452, .168), .05)     # the withers, in front of the saddle
          + .009 * blob(p, (0, .44, -.215), .06)   # the croup
          - .012 * smoothstep(.335, .29, p.y) * blob(p, (0, .3, -.15), .075, mirror=False))  # flank tucked up
    # The breast: two rounded pectorals either side of a shallow groove.
    fore = .011 * blob(p, (.036, .35, .228), .045) - .004 * blob(p, (0, .35, .236), .02)
    # Behind, the quarters part either side of a groove under the tail.
    fore += .007 * blob(p, (0, .36, -.282), .035, mirror=False) - .004 * blob(p, (.04, .35, -.27), .04)
    # A belly that hangs a little behind the girth, the barrel's lowest line, and lifts to the flank.
    up -= .007 * smoothstep(.31, .275, p.y) * blob(p, (0, .275, -.02), .1, mirror=False)
    return Vector((out, up, fore))


reshape(body, 0, body_shape)
# Under the flaps the barrel is drawn in a little, where the rider's knees and the tops of his
# shins lie against it: at its full width (0.09 out at y 0.42) his legs had to go round it at 45
# degrees. Hidden by the saddle; the barrel below the flaps is as wide as it was.
for p in body.verts:
    p.x *= 1 - .3 * smoothstep(.37, .415, p.y) * smoothstep(-.085, -.04, p.z) * (1 - smoothstep(.07, .11, p.z))
# The saddle is draped on the barrel as it now is (scripts/build-fauna.py `saddle`).
saddle(body)
finish(body, lambda p: {0: 1})

# ---- the head and neck ---------------------------------------------------------------------
head = Part(a, 'head', bones[1]['at'])
NECK = [(0,.385,.13),(0,.425,.165),(0,.458,.188),(0,.506,.224),(0,.553,.253),
        (0,.595,.282),(0,.605,.311),(0,.59,.344),(0,.568,.377),(0,.54,.416)]
NECK_W = [.145,.133,.128,.113,.092,.08,.079,.073,.062,.063]
NECK_H = [.17,.178,.17,.147,.122,.112,.112,.103,.082,.07]
# The neck alone, to the poll: the skull is a shell of its own laid over the neck's end. The last
# station is drawn in a little (0.074 by 0.1, not 0.08 by 0.112) so the whole of the end lies inside
# the skull's back: at full size its top corner stood 4 cm behind the poll and its sides out past the
# jowls - a step from every side, and a slot of background between the two when the head turned.
NECK_END = (.066, .088)
rows = refine([(*p, w, h) for p, w, h in zip(NECK[:6], NECK_W[:5] + [NECK_END[0]], NECK_H[:5] + [NECK_END[1]])])
loft(head, along([r[:3] for r in rows], [r[3] for r in rows], [r[4] for r in rows]), BAY, sides=20)
# The crest of the neck carries a little muscle under the mane.
reshape(head, 0, lambda p: Vector((0, .006 * blob(p, (0, .55, .2), .07, mirror=False)
                                   * smoothstep(-.01, .02, p.y - .45 - (p.z - .14) * 1.1), 0)))

# The skull. A straight line from behind the poll (HA) to the end of the nose (HB), and round it
# sections that are no ellipse: a superellipse whose upper half is as wide as the forehead and lower
# half as wide as the jaw, deeper below the line than above it where the cheeks hang, squarer where a
# head is flat-sided. Past the cheek the depth below the line drops at once - the jaw line - to the
# narrow face, swells again at the muzzle and closes at the lips. The top of every section lies on one
# straight line: a straight profile from the forehead down the nose. The first head was the neck's own
# loft carried on round the bend: an ellipse all the way, a tube with a muzzle stuck on.
HA, HB = Vector((0, .612, .292)), Vector((0, .533, .452))
HD, HL = (HB - HA).normalized(), (HB - HA).length
HV = HD.cross(Vector((1, 0, 0))).normalized()   # up off the face: the forehead's own normal
X = Vector((1, 0, 0))
# The back of the skull runs on past the poll, along its own line (which rises behind it), as far
# as the crest's end: it is the cap over the neck's end, so the two meet with an overlap rather than a
# seam. At s -0.32 the neck's top-back corner; at s -0.01 its sides, 0.037 out.
SKULL = [  # along the line, up, down, forehead width, jaw width, squareness
    (-.34, .006, .008, .012, .014, 2), (-.28, .018, .03, .036, .042, 2.1), (-.2, .03, .04, .056, .06, 2.2),
    (-.1, .042, .052, .072, .074, 2.3), (0, .048, .064, .078, .08, 2.4), (.1, .05, .064, .086, .086, 2.6),
    (.22, .048, .064, .096, .09, 2.9), (.34, .043, .055, .082, .076, 2.7), (.44, .038, .042, .068, .058, 2.5), (.6, .033, .033, .057, .05, 2.3),
    (.72, .031, .031, .055, .052, 2.2), (.8, .032, .034, .06, .058, 2.2), (.88, .034, .04, .066, .066, 2.2),
    (.95, .029, .036, .06, .06, 2.1), (1, .014, .02, .034, .034, 2)]
MUZZLE_AT = .8   # a ring of the refined loft lies here, so the muzzle's edge is one clean line


def axis(s):
    return HA + HD * (HL * s)


def skull_ring(s, up, down, wt, wb, n, sides=18):
    c, e, out = axis(s), 2 / n, []
    for k in range(sides):
        f = 2 * math.pi * k / sides
        cs, sn = math.cos(f), math.sin(f)
        w = (wb + (wt - wb) * (1 + cs) / 2) / 2
        out.append(c + X * (math.copysign(abs(sn) ** e, sn) * w)
                   + HV * (math.copysign(abs(cs) ** e, cs) * (up if cs >= 0 else down)))
    return out


skull_from = len(head.verts)
first = shell(head, [skull_ring(*r) for r in refine(SKULL)], BAY)
muzzle = material('horse muzzle', 0x594537)
for i in range(first, len(head.faces)):
    c = sum((head.verts[k] + head.origin for k in head.faces[i]), Vector()) / len(head.faces[i])
    if (c - HA).dot(HD) / HL > MUZZLE_AT:
        head.mats[i] = head.slot(muzzle)


def prober(part, faces_from):
    """Where the skull's surface is, `s` along its line and `deg` round it (0 the forehead, 90 the
    side): everything worn on the head - eyes, nostrils, ears, blaze, bridle - is set down there,
    so none of it floats off the new shape or sinks into it."""
    tree = BVHTree.FromPolygons([v + part.origin for v in part.verts], part.faces[faces_from:first_end])

    def nearest(p):
        loc, nrm, _, _ = tree.find_nearest(p)
        foot = HA + HD * (p - HA).dot(HD)
        return loc, (nrm if nrm.dot(loc - foot) > 0 else -nrm)

    def hit(s, deg, off=0, lift=0):
        r = math.radians(deg)
        d = (HV * math.cos(r) + X * math.sin(r)).normalized()
        loc, nrm, _, _ = tree.ray_cast(axis(s) + HV * lift, d, 1.0)
        nrm = nrm if nrm.dot(d) > 0 else -nrm
        return loc + nrm * off, nrm
    hit.nearest = nearest
    return hit


def near(p, c, r):
    d2 = (p - c).length_squared / (r * r)
    return (1 - d2) ** 2 if d2 < 1 else 0


def tube_loop(part, pts, normals, a, b, mat, sides=8):
    """A closed tube round a closed loop of points, its section an ellipse `a` across the surface and
    `b` up off it (the surface's normal at each point): a nostril's rim, a ring. Wrapped both ways,
    so it is a closed solid with no caps."""
    n = len(pts)
    rings = []
    for i in range(n):
        p, nm = Vector(pts[i]), Vector(normals[i])
        t = (Vector(pts[(i + 1) % n]) - Vector(pts[i - 1])).normalized()
        nm = (nm - t * nm.dot(t)).normalized()
        side = t.cross(nm).normalized()
        rings.append([p + side * (a * math.cos(2 * math.pi * k / sides)) + nm * (b * math.sin(2 * math.pi * k / sides))
                      for k in range(sides)])
    faces = [[i * sides + k, i * sides + (k + 1) % sides, ((i + 1) % n) * sides + (k + 1) % sides,
              ((i + 1) % n) * sides + k] for i in range(n) for k in range(sides)]
    part.add([q for r in rings for q in r], faces, mat)


first_end = len(head.faces)
on = prober(head, first)
EYE_S, EYE_DEG = .22, 66
eye_at = on(EYE_S, EYE_DEG)


def skull_shape(p):
    """Bone under the skin, on the right side and mirrored: the ridge over the eye, the hollow above
    it, the facial crest along the cheek below it, the round of the jowl, the chin."""
    side = 1 if p.x >= 0 else -1
    q = Vector((abs(p.x), p.y, p.z))
    e, n = eye_at
    move = n * (.006 * near(q, e + HV * .015 - HD * .004, .02)
                - .004 * near(q, e + HV * .021 - HD * .03, .016)
                + .004 * near(q, e - HV * .022 + HD * .03, .03)
                + .003 * near(q, axis(.16) - HV * .04 + X * .04, .035))
    move -= HV * (.005 * near(q, axis(.92) - HV * .04, .022))
    return Vector((move.x * side * smoothstep(0, .012, abs(p.x)), move.y, move.z))


reshape(head, skull_from, skull_shape)
on = prober(head, first)
eye = material('horse eye', 0x17120f)
glint = material('horse eye glint', 0xc5b6a0)
bridle = material('horse bridle', 0x493025)
brass = material('horse tack brass', 0xc6a263)
bit = material('horse bit', 0xb9bcbe)   # smooth-shaded steel, unlike the buckles' flat brass
inside = material('horse ear', 0x3a2418)


def frame(n, fwd=HD, up=HV):
    f = (fwd - n * fwd.dot(n)).normalized()
    return f, n.cross(f) if n.cross(f).dot(up) > 0 else f.cross(n)


for side in [-1, 1]:
    # The eye in its socket: lids round it, the eye standing a little proud of them, a glint.
    P, N = on(EYE_S, side * EYE_DEG)
    f, u = frame(N)
    ellipsoid(head, P - N * .004, f * .012, u * .0085, N * .0075, DARK, sides=8, bands=5)
    ellipsoid(head, P - N * .0005, f * .0085, u * .0062, N * .0052, eye, sides=8, bands=5)
    ellipsoid(head, P + N * .0042 + u * .002 + f * .002, f * .0018, u * .0018, N * .0012, glint, sides=8, bands=4)
    # A nostril: a comma on the front of the muzzle - a round head low and in, a tail curling up and
    # out - its outline laid on the skin point by point, a soft rolled rim round it and the dark
    # opening sunk inside the rim. The first was two faceted octagons, a button on the nose.
    P, N = on(.9, side * 50, lift=.006)
    f, u = frame(N)
    slant = (u * .85 - f * .5).normalized()
    across = slant.cross(N).normalized()
    if across.dot(X) * side < 0:
        across = -across
    outline = []
    for k in range(16):
        t = 2 * math.pi * k / 16
        c, sn = math.cos(t), math.sin(t)
        # A teardrop along the slant (its head at -1, its tail at +1), the tail bent outwards.
        wide = .0058 * sn * (.62 - .38 * c)
        bend = .004 * (1 + c) ** 2 / 4
        outline.append(P + slant * (.0105 * c) + across * (wide + bend))
    surf = [on.nearest(q) for q in outline]
    tube_loop(head, [q for q, _ in surf], [n for _, n in surf], .0026, .0019, muzzle, sides=6)
    mid = sum((q for q, _ in surf), Vector()) / len(surf)
    shell(head, [[mid + (q - mid) * .86 - n * .0006 for q, n in surf],
                 [mid + (q - mid) * .45 - n * .0042 for q, n in surf]], DARK)
    # The line of the mouth between the lips.
    mouth = [on(s, side * d, .0006) for s, d in [(.8, 126), (.86, 129), (.92, 137), (.97, 150)]]
    strap(head, [m[0] for m in mouth], [m[1] for m in mouth], .003, .0015, DARK)
    # An ear: a cup, not a cone - each section a crescent open forwards and out, the inside of it
    # dark, tapering to a tip.
    B0, N0 = on(.06, side * 40)
    base = B0 - N0 * .008
    up = Vector((side * .2, .96, .16)).normalized()
    fo = Vector((side * .4, 0, 1))
    fo = (fo - up * fo.dot(up)).normalized()
    g = up.cross(fo)
    rings = []
    for t, R in [(0, .011), (.25, .0135), (.55, .012), (.8, .0075), (1, .0035)]:
        c = base + up * (.052 * t)
        cup = [c + fo * (R * math.cos(math.radians(40 + 35 * k))) + g * (R * math.sin(math.radians(40 + 35 * k)))
                for k in range(9)]
        cup += [c + fo * (.32 * R + .6 * R * math.cos(math.radians(285 - 35 * k)))
                 + g * (.6 * R * math.sin(math.radians(285 - 35 * k))) for k in range(7)]
        if t == 1:
            # The tip closes on a convex ring, and not too small a one: a crescent's cap is concave,
            # and at 1.2 mm three of its points were near enough in line that the exporter dropped
            # the triangle between them as degenerate - an open edge on one ear.
            cup = cup[:9] + [c + fo * (R * math.cos(math.radians(320 + 10 * (k + 1))))
                             + g * (R * math.sin(math.radians(320 + 10 * (k + 1)))) for k in range(7)]
        rings.append(cup)
    ear = shell(head, rings, BAY)
    for k in range(len(rings) - 1):
        for i in range(9, 15):
            head.mats[ear + k * 16 + i] = head.slot(inside)
    # The bit's ring at the corner of the mouth, where the cheekpiece comes down to it: a round ring
    # (sixteen round, six in section) standing just off the cheek, in the cheek's own plane.
    P, N = on(.82, side * 124, .0032)
    f, u = frame(N)
    loop = [P + (f * math.cos(2 * math.pi * k / 16) + u * math.sin(2 * math.pi * k / 16)) * .0068 for k in range(16)]
    tube_loop(head, loop, [N] * 16, .0016, .0016, bit, sides=6)

# The lower lip and the chin under the muzzle.
ellipsoid(head, axis(.93) - HV * .029, X * .018, HD * .014, HV * .009, muzzle, sides=8, bands=5)
# A blaze down the face, on its top line.
blaze = [on(s, 0, .0012) for s in (.16, .3, .45, .6, .74, .85, .93)]
strap(head, [b[0] for b in blaze], [b[1] for b in blaze], [.012, .02, .017, .013, .012, .011, .008], .003, BLAZE)
# The bridle, each strap set on the skin: the headpiece down one cheek, over the poll behind the
# ears and down the other; the browband across the forehead in front of them; the noseband.
cheek = [(.04, 92), (.14, 98), (.3, 100), (.48, 104), (.66, 112), (.8, 120)]
head_stall = ([on(s, -d, .0016) for s, d in reversed(cheek)] + [on(.04, d, .0016) for d in range(-72, 73, 24)]
              + [on(s, d, .0016) for s, d in cheek])
strap(head, [h[0] for h in head_stall], [h[1] for h in head_stall], .0065, .0026, bridle)
brow = [on(.12, d, .0016) for d in [-78 + 19.5 * k for k in range(9)]]
strap(head, [b[0] for b in brow], [b[1] for b in brow], .006, .0026, bridle)
nose = [on(.62, d, .0016) for d in range(0, 360, 24)]
strap(head, [b[0] for b in nose], [b[1] for b in nose], .0075, .0026, bridle, closed=True)


def crest(t):
    """Where the top of the neck is, from the withers (t 0) to the poll (t 1): the loft's own
    centre line and depth, offset to its upper edge, and which way is up-and-back off it."""
    s = 2 + 4 * t
    i = min(int(s), 5)
    f = s - i
    c = Vector(NECK[i]).lerp(Vector(NECK[i+1]), f)
    d = (Vector(NECK[i+1]) - Vector(NECK[i])).normalized()
    h = NECK_H[i] + (NECK_H[i+1] - NECK_H[i]) * f
    v = d.cross(Vector((1, 0, 0))).normalized()
    return c + v * (h / 2), d, v


# A full mane: seventeen locks along the crest, rising off it and falling back and over, most of
# them to the right as a mane lies, each a closed tube so nothing is an open ribbon.
for i in range(11):
    t = i / 10
    base, d, v = crest(t)
    sx = -1 if i % 4 == 1 else 1
    L = (.05 + .02 * hashed(i, 1)) * (1 - .3 * t)
    x = Vector((sx, 0, 0))
    down = Vector((0, -1, 0))
    lock(head, [base - v * .012,
                base + v * .007 - d * L * .25 + x * .008,
                base - d * L * .55 + x * .022 + down * L * .12,
                base - d * L * .8 + x * (.03 + .008 * hashed(i, 2)) + down * L * .42],
         [.032, .038, .03, .006], [.018, .015, .011, .003], DARK)
# Under the locks a roll of hair along the crest, so the mane has a body from either side.
roll = [crest(k / 8) for k in range(9)]
lock(head, [c + v * .004 for c, d, v in roll], [.026, .03, .03, .03, .028, .026, .024, .022, .01],
     [.022, .026, .026, .024, .022, .02, .018, .016, .008], DARK, sides=8)
# The forelock: three locks from between the ears down over the forehead.
# Laid on the forehead's surface, like the blaze and the bridle.
for deg, reach in [(0, 1), (-14, .8), (14, .85)]:
    lock(head, [on(s * reach, deg * (1 - s), off)[0] for s, off in [(0, .004), (.09, .0065), (.19, .005), (.28, .003)]],
         [.026, .026, .018, .004], [.014, .012, .008, .003], DARK)


def head_weights(p):
    neck = smoothstep(.432,.515,p.y)
    skull = smoothstep(.545,.604,p.y) if p.z < .325 else smoothstep(.29,.355,p.z)
    # The jowl hangs lower than that line was drawn for, under the old head: whatever lies forward
    # of the skull's back plane goes with the head too, blending out over the throatlatch.
    skull = max(skull, smoothstep(0, .03, (p - HA).dot(HD)))
    return {0: 1-neck, 1: neck*(1-skull), 2: neck*skull}


finish(head, head_weights)

# ---- the tail ------------------------------------------------------------------------------
tail = Part(a, 'tail', bones[3]['at'])
# The dock, and the hair falling off it as a mass with strands coming out of its lower half.
loft(tail, along([(0,.437,-.243),(0,.416,-.262),(0,.39,-.279),(0,.355,-.293)],
                 [.033,.042,.045,.04], [.035,.036,.037,.034]), DARK, sides=8)
loft(tail, along([(0,.405,-.268),(0,.35,-.296),(.003,.285,-.309),(.006,.22,-.316),(.008,.17,-.316),(.009,.14,-.31)],
                 [.042,.058,.062,.055,.04,.012], [.036,.044,.046,.04,.028,.01]), DARK, sides=8)
for i in range(7):
    xs = (i - 3) / 3 * .026 + (hashed(i, 3) - .5) * .006
    ys = .3 - .06 * hashed(i, 4)
    ye = .1 + .05 * hashed(i, 5)
    zz = -.31 - .018 * hashed(i, 6)
    lock(tail, [(xs * .4, ys, -.303), (xs * .75, ys - .07, zz + .004), (xs, ye + .045, zz), (xs * 1.1, ye, zz + .006)],
         [.022, .02, .013, .003], [.018, .015, .01, .003], DARK, sides=6)
finish(tail, lambda p: {3: 1-smoothstep(.34,.18,p.y), 4:smoothstep(.34,.18,p.y)})

# ---- the legs ------------------------------------------------------------------------------
for leg in legs:
    root, knee, foot = [Vector(bones[leg[k]]['at']) for k in ['root','bend','end']]
    part = Part(a, 'leg '+leg['name'], root)
    front = leg['front']
    inner = -1 if root.x > 0 else 1   # towards the horse's middle
    # Extra rings around carpus/hock and fetlock deform without the old angular cut-outs.
    pts = [root+Vector((0,.045,0)),root,root.lerp(knee,.3),root.lerp(knee,.7),knee,
           knee.lerp(foot,.2),knee.lerp(foot,.6),foot+Vector((0,.018,0)),foot,foot+Vector((0,-.015,.012))]
    # The top ring narrower than before, so the leg goes into the body rather than ending on it
    # as a sleeve; the body's own shoulder and quarters stand over the join.
    widths = [.056,.074,.065,.04,.036,.029,.024,.029,.035,.038] if front else [.07,.092,.076,.042,.037,.03,.025,.03,.035,.037]
    heights = [w*(1.3 if i == 0 else 1.16) for i, w in enumerate(widths)]
    loft(part, along(pts, widths, heights), BAY, sides=12,
         paint=lambda p: SOCK if p.y < .136 else BAY)

    def leg_shape(p, knee=knee, front=front, root=root):
        if front:
            # The forearm's muscle in front and outside, and the flat bony front of the knee.
            return Vector((0, 0, .006 * blob(p, (0, .29, root.z + .03), .05, mirror=False)
                           + .004 * blob(p, (0, knee.y + .005, knee.z + .02), .02, mirror=False)))
        # The point of the hock behind, and the gaskin swelling above it.
        return Vector((0, 0, -.009 * blob(p, (0, knee.y + .012, knee.z - .022), .022, mirror=False)
                       - .006 * blob(p, (0, .27, root.z - .035), .045, mirror=False)))

    reshape(part, 0, leg_shape)
    # A rounded wall, sloping toe and level sole; the hoof is weighted rigidly below the fetlock.
    # More rings than its shape needs: a coronet band is drawn in the vertex colour.
    z=foot.z+.012
    loft(part, [((root.x,y,z+dz),(0,1,0),w,h) for y,w,h,dz in [
        (0,.047,.06,.006),(.006,.051,.064,.006),(.014,.05,.061,.005),(.022,.047,.056,.003),
        (.028,.043,.05,.001),(.031,.041,.046,0),(.039,.033,.034,-.003)]], HOOF, sides=12)
    # Feathering at the back of the fetlock.
    lock(part, [(root.x, .076, foot.z - .008), (root.x, .058, foot.z - .018), (root.x, .042, foot.z - .022)],
         [.018, .02, .005], [.014, .016, .004], SOCK)
    # The chestnut on the inside of the leg: above the knee in front, below the hock behind.
    if front:
        oval(part, (root.x + inner * .0175, .245, knee.z + .002), (.006, .013, .008), DARK, sides=6, bands=4)
    else:
        oval(part, (root.x + inner * .013, .152, knee.z + .008 - .006), (.005, .01, .007), DARK, sides=6, bands=4)

    def weights(p, leg=leg, root=root, knee=knee):
        hip = smoothstep(root.y+.035,root.y-.04,p.y)
        bend = smoothstep(knee.y+.045,knee.y-.04,p.y)
        hoof = smoothstep(.08,.045,p.y)
        return {0:1-hip,leg['root']:hip*(1-bend),leg['bend']:hip*bend*(1-hoof),leg['end']:hip*bend*hoof}

    finish(part, weights)


# ---- the coat ------------------------------------------------------------------------------
def coat(objects):
    """Write each corner's colour: its material's colour, shaded, times its occlusion."""
    verts, polys, offsets = [], [], []
    for obj in objects:
        offsets.append(len(verts))
        verts += [obj.matrix_world @ v.co for v in obj.data.vertices]
        polys += [[offsets[-1] + i for i in poly.vertices] for poly in obj.data.polygons]
    tree = BVHTree.FromPolygons(verts, polys)
    # Thirty-two directions over a hemisphere, cosine-weighted, the same for every corner.
    golden = math.pi * (3 - math.sqrt(5))
    dirs = []
    for k in range(32):
        r = math.sqrt((k + .5) / 32)
        dirs.append((r * math.cos(k * golden), r * math.sin(k * golden), math.sqrt(1 - r * r)))
    reach = .05

    def occlusion(co, n):
        t = n.cross(Vector((0, 0, 1)))
        if t.length < .1:
            t = n.cross(Vector((1, 0, 0)))
        t.normalize()
        b = n.cross(t)
        origin = co + n * 2e-4
        # A corner buried inside another shell (a leg's top in the body, the neck's root in the
        # chest) meets that shell's inside first. Nobody sees it, but the faces that come out of
        # it would carry its darkness out over the join as a jagged smear, so it is left unshaded:
        # the crease itself is darkened by the corners outside it that look at the other shell.
        first = tree.ray_cast(origin, n, 1.0)
        if first[0] is not None and first[1].dot(n) > 0:
            return 0
        hits = 0
        for dx, dy, dz in dirs:
            if tree.ray_cast(origin, t * dx + b * dy + n * dz, reach)[0] is not None:
                hits += 1
        return hits / len(dirs)

    for obj in objects:
        mesh = obj.data
        occ = [occlusion(obj.matrix_world @ v.co, v.normal) for v in mesh.vertices]
        attr = mesh.color_attributes.new('coat', 'FLOAT_COLOR', 'CORNER')
        mesh.color_attributes.active_color = attr
        leg_part = ' leg ' in obj.name
        for poly in mesh.polygons:
            mat = mesh.materials[poly.material_index]
            label = mat.name
            base = mat.diffuse_color
            for li in poly.loop_indices:
                vi = mesh.loops[li].vertex_index
                v = mesh.vertices[vi]
                w = obj.matrix_world @ v.co
                q = Vector((w.x, w.z, -w.y))
                n = Vector((v.normal.x, v.normal.z, -v.normal.y))
                f = shade(label, q, n, leg_part)
                if not any(s in label for s in ['eye', 'glint', 'brass', 'bit']):
                    # Capped, so the deepest crease (under the mane, in the girth) is shaded, not black.
                    f *= 1 - .7 * min(occ[vi], .45)
                attr.data[li].color = tuple(round(min(1, c * f), 4) for c in base[:3]) + (1,)


def shade(label, q, n, leg_part):
    grain = noise.noise(q * 150)
    if 'coat' in label:
        f = 1.08 - .2 * smoothstep(.36, .47, q.y)                        # darker along the topline
        f *= 1 - .08 * smoothstep(.03, 0, abs(q.x)) * smoothstep(.4, .45, q.y) * smoothstep(.2, .1, q.z)  # dorsal line
        f *= 1 + .1 * max(0, -n.y) - .04 * max(0, n.y)                   # lighter underneath
        if leg_part:
            f *= .74 + .26 * smoothstep(.14, .28, q.y)                    # darkening into the points
        if q.z > .37:
            f *= 1 - .16 * smoothstep(.38, .43, q.z)                      # and into the muzzle
        if q.y > .27 and q.z < .3:
            # A few faint dapples on the barrel and the quarters.
            f *= 1 + .08 * smoothstep(.25, .55, noise.noise(q * 36)) * smoothstep(.3, .36, q.y)
        return f * (1 + .035 * grain)
    if 'muzzle' in label:
        return (1 + .3 * smoothstep(.53, .508, q.y)) * (1 + .04 * grain)   # the lips paler
    if 'mane' in label:
        streak = noise.noise(Vector((q.x * 140, q.y * 10, q.z * 140)))
        f = .88 + .16 * streak
        return f * (1 + .3 * smoothstep(.24, .1, q.y))                     # sun on the tail's ends
    if 'sock' in label:
        return (.88 + .14 * smoothstep(.05, .13, q.y)) * (1 + .04 * grain)
    if 'hoof' in label:
        band = smoothstep(.018, .024, q.y) * smoothstep(.032, .027, q.y)
        return (.86 + .5 * band + .08 * smoothstep(.008, 0, q.y)) * (1 + .05 * noise.noise(Vector((q.x * 300, q.y * 20, q.z * 300))))
    if 'blaze' in label:
        return 1 + .03 * grain
    if 'saddle pad' in label:
        return 1 + .03 * grain
    if 'saddle' in label:
        # Leather: mottled, and polished paler where the rider sits on it.
        worn = smoothstep(.47, .49, q.y) * max(0, n.y)
        return (.93 + .07 * noise.noise(q * 70)) * (1 + .14 * worn)
    if 'girth' in label:
        return .92 + .08 * noise.noise(Vector((q.x * 60, q.y * 60, q.z * 900)))   # woven along its length
    return 1


coat(parts)

# The .blend has the same real bones and weights as the browser, available for posing.
armature = bpy.data.armatures.new('Horse armature')
arm = bpy.data.objects.new('Horse armature',armature)
a.objects.link(arm)
bpy.context.view_layer.objects.active=arm
arm.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
for i,b in enumerate(bones):
    eb=armature.edit_bones.new('horse:'+str(i))
    eb.head=xyz(b['at'])
    child=next((c for c in bones if c['parent']==i),None)
    eb.tail=xyz(child['at']) if child else eb.head+Vector((0,0,.025))
    if b['parent']>=0: eb.parent=armature.edit_bones['horse:'+str(b['parent'])]
bpy.ops.object.mode_set(mode='OBJECT')
arm.show_in_front=True
for obj in parts:
    mod=obj.modifiers.new('Horse joints','ARMATURE'); mod.object=arm
bpy.context.scene['skin_rigs']=json.dumps({'horse':rig})
