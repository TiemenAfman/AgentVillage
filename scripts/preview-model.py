"""Render one PNG per Blender asset, so a shape can be looked at without Blender.

    blender --background --python scripts/preview-model.py                  everything
    blender --background --python scripts/preview-model.py -- props         one set
    blender --background --python scripts/preview-model.py -- prop_barrel   one asset

or `npm run models:preview [-- props prop_barrel]`, which finds Blender for you.

The renders go to assets/<set>/renders/<asset>.png and are gitignored: they are made
from a .blend that is committed, so anybody can make them again and nobody has to
download them. They exist to be looked at and pasted into a report - which is the only
review a shape ever gets before it is standing on the island.

Workbench rather than Cycles, and on purpose. Workbench draws what the island draws: flat
faces in their material colour with no light of its own, which is the island's own look
(one material, vertex colours, flat shading). Cavity shading puts a line in every crease,
so the facets of a barrel and the courses of a chimney read on a 640-pixel thumbnail. And
it takes a tenth of a second per asset instead of half a minute, so previewing a whole set
is something you do every time rather than once.
"""
import bpy
import runpy
import sys
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
EXPORT = runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'HELPERS_ONLY': True})
asset_of, blend_of, model_sets = EXPORT['asset_of'], EXPORT['blend_of'], EXPORT['model_sets']

# Where the camera stands, as a direction rather than a place: obliquely from above, from
# the front right, which is the view assets/tavern/tavern-preview.png was rendered from
# and roughly the angle the island itself is looked at (web/js/demo.js drops its camera at
# 26 up and 40 back). Blender coordinates, so -Y is the island's +Z and the front of the
# model. High enough to read a roof, low enough to see a door.
VIEW = Vector((3, -4, 2.1)).normalized()
MARGIN = 1.12          # how much air to leave around the asset
SIZE = 640


def workbench(scene):
    """The island's own look, headless: material colour, flat faces, creases picked out."""
    scene.render.engine = 'BLENDER_WORKBENCH'
    shading = scene.display.shading
    shading.light = 'STUDIO'
    shading.color_type = 'MATERIAL'     # the colour the material carries, not a random hue
    shading.show_shadows = True
    shading.shadow_intensity = 0.28
    # Cavity is what makes a facet visible without a light rig: WORLD darkens real creases,
    # SCREEN draws the silhouette of one form against another, and a small model needs both.
    shading.show_cavity = True
    shading.cavity_type = 'BOTH'
    shading.cavity_ridge_factor = 1.0
    shading.cavity_valley_factor = 1.4
    shading.curvature_ridge_factor = 0.8
    shading.curvature_valley_factor = 0.8
    shading.background_type = 'VIEWPORT'
    shading.background_color = (0.10, 0.12, 0.10)
    scene.display.render_aa = '16'
    # Standard, not AgX: a material's viewport colour is stored linear in these files -
    # it is what the exporter bakes into the vertex colours - and Standard is the plain
    # sRGB encode, which is exactly what three.js does with those colours on the way to
    # the screen. So oak #845335 renders as 131, 82, 52 and a preview can be held against
    # the hex in scripts/build-<set>.py. AgX would be prettier and would lie.
    scene.view_settings.view_transform = 'Standard'
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'


def box_of(objects):
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for obj in objects:
        for corner in obj.bound_box:
            p = obj.matrix_world @ Vector(corner)
            lo = Vector(min(a, b) for a, b in zip(lo, p))
            hi = Vector(max(a, b) for a, b in zip(hi, p))
    return lo, hi


def frame(scene, objects):
    """One ortho camera, sized to what it is looking at, aimed at the middle of it."""
    lo, hi = box_of(objects)
    middle = (lo + hi) / 2
    reach = (hi - lo).length / 2 or 0.5
    camera = bpy.data.objects.new('Preview camera', bpy.data.cameras.new('Preview camera'))
    scene.collection.objects.link(camera)
    camera.location = middle + VIEW * (reach * 4 + 1)
    camera.rotation_euler = (middle - camera.location).to_track_quat('-Z', 'Y').to_euler()
    camera.data.type = 'ORTHO'
    # Twice the reach is the whole asset corner to corner; the margin keeps it off the edge.
    camera.data.ortho_scale = reach * 2 * MARGIN
    camera.data.clip_start = 0.001
    camera.data.clip_end = reach * 12 + 20
    scene.camera = camera
    return camera


def assets_in(scene, set_name):
    """asset -> the objects that make it up, by the same rule the exporter bakes by."""
    found = {}
    for obj in scene.objects:
        if obj.type != 'MESH' or not obj.get('building_part'):
            continue
        found.setdefault(asset_of(obj) or set_name, []).append(obj)
    return found


def render_set(set_name, wanted):
    source = blend_of(ROOT / 'assets' / set_name)
    bpy.ops.wm.open_mainfile(filepath=str(source))
    scene = bpy.context.scene
    workbench(scene)
    assets = assets_in(scene, set_name)
    if not assets:
        raise ValueError(f'{set_name}: no building_part meshes in {source.name}')
    out = ROOT / 'assets' / set_name / 'renders'
    done = []
    for asset, objects in sorted(assets.items()):
        if wanted and asset not in wanted:
            continue
        # Everything else out of shot, the studio floor and the lights included: a preview
        # is of one asset, and a set will hold a yard full of them.
        keep = set(objects)
        for obj in scene.objects:
            obj.hide_render = obj not in keep
        camera = frame(scene, objects)
        out.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(out / f'{asset}.png')
        bpy.ops.render.render(write_still=True)
        bpy.data.objects.remove(camera, do_unlink=True)
        done.append(asset)
        print(f'rendered {set_name}/{asset} -> assets/{set_name}/renders/{asset}.png')
    return done


args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
# An argument is either a set or an asset, and which it is needs no flag: the sets are the
# folders under assets/, and anything else is the name of a thing inside one.
known = model_sets()
sets = [a for a in args if a in known]
wanted = {a for a in args if a not in known}
rendered = []
for name in (sets or known):
    rendered += render_set(name, wanted)
if wanted and not rendered:
    raise ValueError('no such asset: ' + ', '.join(sorted(wanted)))
print(f'{len(rendered)} preview(s) rendered')
