"""A heap of gold (every prop of kind `hoard`): dressing.py's hoard().
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/goudbult.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_hoard'
LIFT = .0209                # its lowest coin or foot sinks into the boards that much (kraken-dressing.js KIT_KINDS)
STRETCH = (1.0001, 0.8182, 1.0719)   # the stand-in to the box of Pixal3D's goudbult (standin.py)


def build():
    with frame(M((0, LIFT, 0))):
        dressing.hoard(.24, .17, seed=1000)
    settle(STRETCH)
