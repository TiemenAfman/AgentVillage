# The boat, out of 3DBenchy.
#
# Every other model set on this island is authored in Blender and baked by
# scripts/export-models.py. This one is not: its source is somebody else's STL - the
# 3DBenchy print benchmark - and there is nothing to author. So it takes the same road by a
# different vehicle: trimesh instead of Blender, and it writes exactly the module
# export-models.py writes, so web/js/models.js and tests/models.test.mjs cannot tell the
# difference and neither can the island.
#
#   python scripts/build-benchy.py          -> web/js/benchy-mesh.js
#
# Needs trimesh, fast-simplification and scikit-image (for marching cubes). Nothing on the
# island needs any of them: web/js/benchy-mesh.js is committed and is what the page loads.
#
# Three things about the STL decide how this works.
#
# The Benchy is 225,706 triangles and the island's ceiling for a hero asset is 4,000
# (scripts/model-rules.mjs). Decimating it directly floors at about 13,300 however hard it
# is pushed: the mesh has non-manifold vertices the collapser will not touch. So it is
# remeshed first, through its own voxels, which gives a closed surface a quadric decimator
# can take all the way down - and, as it happens, a faceted one, which is the island's
# own idiom rather than a compromise.
#
# The remesh is deliberately NOT `.fill()`ed. Filling closes the cabin, and the cabin is the
# point: a settler stands in it. The surface voxels alone keep it a shell with its cavity.
#
# And the scale is not chosen, it is measured. The cabin floor and the underside of its roof
# are found by probing, and the boat is scaled so that the gap between them holds a standing
# settler with headroom. Getting that from the drawing rather than from a number in a file
# is what stops a later change to the figure's height from quietly burying its head in the
# roof.
import json
import math
import sys
from pathlib import Path

import numpy as np
import trimesh
import fast_simplification as fs

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'web' / 'js' / 'benchy-mesh.js'
SRC = ROOT / 'assets' / 'benchy' / '3dbenchy.stl'

# How coarse the remesh is, and how many triangles survive it. 0.7 mm on a 60 mm hull keeps
# the bow's flare and the funnel; 2400 leaves a third of the hero budget spare for whoever
# wants to put a lantern on it later.
PITCH = 0.7
TRIANGLES = 2400

# What has to fit inside. The settler walk mode steers stands 0.54 units tall (see the EYE
# comment in web/js/walk.js), and a head a whisker under a beam reads as a bug even when it
# is not - so the cabin is scaled to hold the figure plus a hand's width of air.
SETTLER_HEIGHT = 0.54
HEADROOM = 0.08

# The island stores linear colour: scripts/export-models.py hands over what Blender has in
# its own linear space, so a value picked by eye in sRGB has to be converted or every
# surface comes out pale.
def srgb(hex_value):
    out = []
    for shift in (16, 8, 0):
        c = ((hex_value >> shift) & 0xFF) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return out


# A tug's paint, by height up the hull rather than by any marking in the STL - the STL has
# no materials at all. The bands are read off the Benchy's own shape: a boot-topping at the
# waterline, topsides to the sheer, a cream deckhouse, a dark roof and a black funnel.
BANDS = [
    (0.12, srgb(0x2E2A28)),   # the keel and the boot-topping, below the waterline
    (0.30, srgb(0x8C3A2E)),   # the hull, painted red the way a working boat is
    (0.42, srgb(0x6E4A32)),   # the rubbing strake and the deck edge
    (0.62, srgb(0xE6DCC6)),   # the deckhouse, cream
    (0.84, srgb(0x4A5158)),   # its roof, slate
    (1.01, srgb(0x23201F)),   # and the funnel
]


def load_hull():
    if not SRC.exists():
        sys.exit(f'No STL at {SRC}. Put 3dbenchy.stl there; see the header of this file.')
    m = trimesh.load(SRC)
    m.merge_vertices()
    m.update_faces(m.nondegenerate_faces())
    m.update_faces(m.unique_faces())
    m.remove_unreferenced_vertices()
    return m


# Straight up through the middle of the cabin: solid hull, then air, then the roof. The two
# numbers wanted are the top of the floor and the underside of the roof.
def cabin_gap(mesh, x=0.0, y=0.0):
    zs = np.arange(mesh.bounds[0][2], mesh.bounds[1][2], 0.25)
    inside = mesh.contains(np.column_stack([np.full(len(zs), x), np.full(len(zs), y), zs]))
    floor = None
    for z, solid in zip(zs, inside):
        if solid:
            floor = z
        elif floor is not None:
            break
    if floor is None:
        sys.exit('No floor under the middle of the cabin; the STL is not a Benchy.')
    roof = None
    for z, solid in zip(zs, inside):
        if z > floor and solid:
            roof = z
            break
    if roof is None:
        sys.exit('No roof over the cabin; the remesh has closed it.')
    return floor, roof


def main():
    raw = load_hull()
    print(f'3DBenchy: {len(raw.faces)} triangles, {np.round(raw.extents, 1)} mm')

    # Remeshed through its own voxels. Not filled - see the header.
    #
    # `marching_cubes` hands the mesh back in VOXEL INDEX space, not in the millimetres the
    # STL was drawn in, so it has to be put back through the grid's own transform. Skip that
    # and everything still looks right - the shape is identical, the cabin is still hollow -
    # while every length is 1/PITCH too big, which at 0.7 is a boat forty per cent too long
    # with a cabin far too roomy for the settler it was measured for. Caught by printing the
    # finished hull's extents and not recognising them.
    grid = raw.voxelized(pitch=PITCH)
    shell = grid.marching_cubes
    shell.apply_transform(grid.transform)
    shell.merge_vertices()
    verts, faces = fs.simplify(np.asarray(shell.vertices), np.asarray(shell.faces),
                               target_count=TRIANGLES)
    mesh = trimesh.Trimesh(verts, faces, process=False)
    print(f'  remeshed at {PITCH} mm -> {len(shell.faces)}, decimated -> {len(mesh.faces)}')

    # Measured on the ORIGINAL, not on the remesh. The remesh is a shell - two surfaces a
    # voxel apart - so `contains` inside its walls answers about the wall rather than about
    # the room, and the probe finds no floor at all. The remesh follows the hull to within a
    # voxel, so the original's cabin is the remesh's cabin to well under a millimetre.
    floor, roof = cabin_gap(raw)
    gap = roof - floor
    scale = (SETTLER_HEIGHT + HEADROOM) / gap
    print(f'  cabin floor {floor:.1f} mm, roof {roof:.1f} mm, gap {gap:.1f} mm -> scale {scale:.5f}')

    # The island's frame: a model faces +Z, up is +Y, and the origin sits on the ground in
    # the middle of the footprint. The Benchy has its bow at +X and up at +Z, so the axes
    # are cycled - which is a rotation and not a mirror, so the hull does not come out
    # inside out.
    v = np.asarray(mesh.vertices, dtype=np.float64)
    game = np.column_stack([v[:, 1], v[:, 2], v[:, 0]]) * scale
    lo, hi = game.min(axis=0), game.max(axis=0)
    game[:, 0] -= (lo[0] + hi[0]) / 2
    game[:, 2] -= (lo[2] + hi[2]) / 2
    game[:, 1] -= lo[1]              # the keel on the ground, as every asset here must be
    height = float(game[:, 1].max())
    # Where a rider's feet go: the cabin floor, in the island's own units, measured up from
    # the keel that now sits on y = 0.
    deck = float((floor - raw.bounds[0][2]) * scale)

    # Flat shading is what the island draws with, so the triangles are written out as a soup
    # rather than indexed: one colour per triangle, taken from the height of its middle, and
    # therefore no vertex having to belong to two bands at once.
    tri = game[np.asarray(mesh.faces)]
    positions, colors = [], []
    for corners in tri:
        mid_y = float(corners[:, 1].mean())
        colour = BANDS[-1][1]
        for limit, rgb in BANDS:
            if mid_y <= limit * height:
                colour = rgb
                break
        for corner in corners:
            positions.extend(float(round(c, 4)) for c in corner)
            colors.extend(round(c, 6) for c in colour)

    data = {
        'parts': {
            'benchy hull': {
                'positions': positions,
                'colors': colors,
                # A painted hull is not planking and not plaster. `plain` is the sheet for a
                # surface that is its own colour, which is what a boat's paint is.
                'sheet': 'plain',
                'emissive': 0,
                'at': [0.0, 0.0, 0.0],
            },
        },
        # The funnel is a chimney, and main.js already knows what to do with one of those.
        'anchors': {'smoke': [0.0, round(height, 4), round(float(game[:, 2].min()) * 0.55, 4)]},
        'height': round(height, 4),
    }

    OUT.write_text(
        '// Generated by scripts/build-benchy.py from assets/benchy/3dbenchy.stl.\n'
        f'export const BENCHY = {json.dumps(data, separators=(",", ":"))};\n',
        encoding='utf-8', newline='\n')
    print(f'  wrote {OUT.relative_to(ROOT)}: {len(mesh.faces)} triangles, '
          f'{height:.2f} tall, deck at {deck:.3f}, {OUT.stat().st_size // 1024} kB')
    print(f'  a settler of {SETTLER_HEIGHT} stands in a cabin {gap * scale:.2f} high')


if __name__ == '__main__':
    main()
