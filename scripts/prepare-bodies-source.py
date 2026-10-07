"""Copy what scripts/build-bodies.py reads out of Quaternius's two free kits into assets/bodies/source/
(Plans/basislichamen-en-outfits.md). Run once, by hand, with the unpacked zips beside it:

    python scripts/prepare-bodies-source.py D:/Promptholm/sources/quaternius

Both kits are CC0 (assets/bodies/CREDITS.md). The zips are 400 MB between them and stay outside
git; what is copied is the glTF of each body, hairstyle and outfit the bake uses, with only its
base-colour textures, scaled to 1024 - the bake samples them into corner colours, so the normal,
roughness and ORM maps and the 4096 originals carry nothing it reads. The glTF is rewritten to
name only the textures that are copied, so Blender's importer does not go looking for the rest.
"""
import json
import shutil
import sys
from pathlib import Path

from PIL import Image

SRC = Path(sys.argv[1])
ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets/bodies/source'
UBC = SRC / 'ubc/Universal Base Characters[Standard]'
MCO = SRC / 'mco/Modular Character Outfits - Fantasy[Standard]/Exports/glTF (Godot-Unreal)'
FILES = [
    UBC / 'Base Characters/Godot - UE/Superhero_Female_FullBody.gltf',
    UBC / 'Base Characters/Godot - UE/Superhero_Male_FullBody.gltf',
    UBC / 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Long.gltf',
    UBC / 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_SimpleParted.gltf',
    UBC / 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buns.gltf',
    UBC / 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_Buzzed.gltf',
    UBC / 'Hairstyles/Rigged to Head Bone/glTF (Godot -Unreal)/Hair_BuzzedFemale.gltf',
    MCO / 'Outfits/Female_Peasant.gltf',
    MCO / 'Outfits/Male_Peasant.gltf',
]
# The base-colour maps by the name a glTF gives them; the bodies' light skin, not the dark one the
# glTF names (the skin is dyed at runtime either way, from a lighter start the shading is finer).
BASE = {
    'T_Superhero_Female_Dark_BaseColor.png': UBC / 'Base Characters/Textures/T_Superhero_Female_Light_BaseColor.png',
    'T_Superhero_Male_Dark.png': UBC / 'Base Characters/Textures/T_Superhero_Male_Ligh.png',
    'T_Hair_1_BaseColor.png': UBC / 'Hairstyles/Textures/T_Hair_1_BaseColor.png',
    'T_Hair_2_BaseColor.png': UBC / 'Hairstyles/Textures/T_Hair_2_BaseColor.png',
    'T_Eye_Brown.png': UBC / 'Base Characters/Textures/T_Eye_Brown.png',
    'T_Peasant_BaseColor.png': MCO / 'Modular Parts/T_Peasant_BaseColor.png',
}
SIZE = 1024

OUT.mkdir(parents=True, exist_ok=True)
for f in FILES:
    g = json.loads(f.read_text(encoding='utf-8'))
    keep = {}
    for i, img in enumerate(g.get('images', [])):
        if img.get('uri') in BASE:
            keep[i] = img['uri']
    remap = {old: new for new, old in enumerate(sorted(keep))}
    g['images'] = [{'uri': keep[i]} for i in sorted(keep)]
    textures = []
    tex_map = {}
    for t, tex in enumerate(g.get('textures', [])):
        if tex.get('source') in remap:
            tex_map[t] = len(textures)
            textures.append({**tex, 'source': remap[tex['source']]})
    g['textures'] = textures
    for m in g.get('materials', []):
        pbr = m.get('pbrMetallicRoughness', {})
        base = pbr.get('baseColorTexture')
        m.pop('normalTexture', None)
        m.pop('occlusionTexture', None)
        m.pop('emissiveTexture', None)
        pbr.pop('metallicRoughnessTexture', None)
        if base and base['index'] in tex_map:
            base['index'] = tex_map[base['index']]
        else:
            pbr.pop('baseColorTexture', None)
        m.pop('extensions', None)
    g.pop('extensionsUsed', None)
    g.pop('extensionsRequired', None)
    (OUT / f.name).write_text(json.dumps(g, indent=1), encoding='utf-8')
    shutil.copyfile(f.with_suffix('.bin'), OUT / f.with_suffix('.bin').name)
    for uri in keep.values():
        dest = OUT / uri
        if not dest.exists():
            im = Image.open(BASE[uri]).convert('RGBA')
            if max(im.size) > SIZE:
                im = im.resize((SIZE, SIZE), Image.LANCZOS)
            im.save(dest, optimize=True)
    print(f.name, '->', list(keep.values()))
