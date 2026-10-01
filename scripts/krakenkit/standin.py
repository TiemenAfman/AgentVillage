"""The room's stand-ins as kit pieces: the pieces that make the Salty Kraken's look were each a plain
placeholder in scripts/krakenroom/dressing.py (`ph_*`, one function apiece), drawn into the hall's
bake. A piece the HD pack has a Pixal3D model of has to be a kit piece instead - the pack replaces a
kit piece and nothing else (Plans/piratenkroeg.md, "The HD pack") - so each has a module here that
draws dressing.py's own function and says what it is called: the bake looks as it did, and the
function is still the one place to replace with a finished model. Not a piece itself (no ASSET).

Every such module ends in geom.settle(STRETCH): it stands on y = 0 (a LIFT its frame takes, repeated
in kraken-layout.js KIT), and STRETCH takes it per axis to the box of its HD model, so the two stand
in the same room - the keeper's call: the stand-in to the model's size, never the model squashed.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'krakenroom'))
import dressing  # noqa: E402,F401
