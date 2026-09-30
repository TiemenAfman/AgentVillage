"""The Salty Kraken's hall: the cave, its storeys and everything standing in it, baked as one hero set.

Run: node scripts/blender.mjs --background --python scripts/build-piratetavern-room.py
Hand edits are lost: this writes assets/piratetavern_room/promptholm-piratetavern_room.blend from
scratch and bakes web/js/piratetavern_room-mesh.js in the same run.

Two modules make it (Plans/piratenkroeg.md, Plans/verdiepingen-binnen.md):
- scripts/krakenroom/shell.py - the architecture: rock and ship's timber, the floors and storeys, the
  stairs and ladders, the rails, the pool under the sea arch, the cellar, the hearth, the ceiling;
- scripts/krakenroom/dressing.py - what stands and hangs in it: tables, crates, barrels, hoards,
  candles, nets, sailcloth, the sloop chandelier.
Both read the one layout, web/js/kraken-layout.js (and web/js/kraken-dressing.js, where the props
stand), through scripts/kraken-layout-json.mjs, so what is drawn here stands exactly where
web/js/pirate-tavern.js lets you walk, sit and bump. The ship's parts (stern, hull counter, mast,
stools, gun ports...) are their own set, scripts/build-krakenkit.py, placed by pirate-tavern.js.

Part names say what the game does with them: `Kraken roof ...` is the lid, taken off when the camera
has to rise through the ceiling; `Kraken room ...` and `Kraken near ...` are the hall (`near` is
only for the cutaway preview, scripts/preview-krakenroom.py). The corners are shaded by
geom.bake_ao, as the kit's are. There is no budget to design to (the keeper: indoors the triangle
count must not limit the design); HERO_BUDGETS holds a ceiling against a runaway bake.
"""
import bpy
import importlib
import json
import runpy
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SET = 'piratetavern_room'
OUT = ROOT / 'assets' / SET
OUT.mkdir(parents=True, exist_ok=True)
L = json.loads(subprocess.run(['node', str(ROOT / 'scripts/kraken-layout-json.mjs')], capture_output=True, text=True, check=True).stdout)

bpy.ops.wm.read_factory_settings(use_empty=True)
sys.path.insert(0, str(ROOT / 'scripts/krakenkit'))
sys.path.insert(0, str(ROOT / 'scripts/krakenroom'))
geom = importlib.import_module('geom')
for name in ('shell', 'dressing'):
    importlib.import_module(name).build(L)
total, top = geom.flush('Kraken')
print(f'{SET}: {total} triangles')
for label, n in top:
    print(f'  {n:6d}  {label}')
geom.bake_ao(list(bpy.context.scene.objects))

bpy.context.scene['building_height'] = round(L['TOP'] + 0.1, 3)
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(OUT / f'promptholm-{SET}.blend'))
runpy.run_path(str(ROOT / 'scripts/export-models.py'), init_globals={'MODEL_SET': SET, 'DIGITS': 4})
