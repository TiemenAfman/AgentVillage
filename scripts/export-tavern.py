"""Bake the open tavern scene. Every set bakes through scripts/export-models.py now;
this is the name scripts/build-tavern.py reaches for, and the name in the README for
exporting edits made by hand:

    blender assets/tavern/agentvillage-tavern.blend --background --python scripts/export-tavern.py
"""
import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts/export-models.py'),
               init_globals={'MODEL_SET': 'tavern'})
