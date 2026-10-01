"""The brass glass on its tripod (kind `telescope`), looking along +x: dressing.py's ph_telescope.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/telescoop.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_telescope'
LIFT = .0027                # its lowest coin or foot sinks into the boards that much (kraken-dressing.js KIT_KINDS)
STRETCH = (1.1956, 1.0, 1.3031)   # the stand-in to the box of Pixal3D's telescoop (standin.py)


def build():
    with frame(M((0, LIFT, 0))):
        dressing.ph_telescope()
    settle(STRETCH)
