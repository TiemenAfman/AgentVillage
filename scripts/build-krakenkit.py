"""The Salty Kraken's kit: the ship's parts its hall is furnished with, baked as one set.

    node scripts/blender.mjs --background --python scripts/build-krakenkit.py

Every scripts/krakenkit/<object>.py (all but geom.py) names its ASSET (`civic_kraken_<object>`)
and has a build() that models it with geom.py's helpers, standing on y = 0 with its front to +z.
This puts each in a collection of its own, saves assets/krakenkit/promptholm-krakenkit.blend and
bakes web/js/krakenkit-mesh.js. Where each stands in the room is web/js/pirate-tavern.js's.
The corners are shaded by geom.bake_ao (ambient occlusion in the vertex colours) as they are baked.
One object at a time, with renders and without a bake: scripts/preview-krakenkit.py.
"""
import bpy
import importlib
import runpy
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets/krakenkit'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, str(ROOT / 'scripts/krakenkit'))
geom = importlib.import_module('geom')
# `-- stern mast` bakes only those (a piece still being modelled can be left out); none is all.
wanted = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
done = []
for path in sorted((ROOT / 'scripts/krakenkit').glob('*.py')):
    if path.stem == 'geom' or (wanted and path.stem not in wanted):
        continue
    obj = importlib.import_module(path.stem)
    if not hasattr(obj, 'ASSET'):
        continue                      # a helper module another piece imports
    coll = bpy.data.collections.new(obj.ASSET)
    bpy.context.scene.collection.children.link(coll)
    obj.build()
    total, _ = geom.flush(obj.ASSET, coll, groups=False)
    # Each piece is shaded on its own: every asset stands at the origin, and one piece's shadow
    # on another that is never beside it in the room would be baked in for good.
    for c in done:
        c.hide_render = True
    geom.bake_ao(list(coll.objects))
    for c in done:
        c.hide_render = False
    done.append(coll)
    print(f'{obj.ASSET}: {total} triangles')
bpy.context.scene['building_height'] = 2.0
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'promptholm-krakenkit.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': 'krakenkit'})
