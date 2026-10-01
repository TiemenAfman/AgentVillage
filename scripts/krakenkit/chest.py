"""The open treasure chest (every prop of kind `chest`, kraken-dressing.js): dressing.py's
ph_chest_open, its gold run out over the front.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/schatkist.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_chest'
LIFT = .0019                # its lowest coin or foot sinks into the boards that much (kraken-dressing.js KIT_KINDS)
STRETCH = (1.0, 0.8398, 0.6114)   # the stand-in to the box of Pixal3D's schatkist (standin.py)


def build():
    with frame(M((0, LIFT, 0))):
        dressing.ph_chest_open(.42, .26, .2, seed=1000)
    settle(STRETCH)
