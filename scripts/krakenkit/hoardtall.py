"""The tall heap of gold on the bar terrace (kind `hoard-tall`): a cone of coins with a crown on it,
the drawing's treasure for the middle of the hall. A new stand-in, there was no tall heap before.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/goudbult-hoog.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_hoardtall'
LIFT = .0343                # its lowest coin sinks into the boards that much (kraken-dressing.js KIT_KINDS)
STRETCH = (0.988, 1.0, 0.9353)   # the stand-in to the box of Pixal3D's goudbult-hoog (standin.py)


def build():
    with frame(M((0, LIFT, 0))):
        dressing.heap((0, 0, 0), .2, .5, coins=60, seed=1201, gems=8)
        dressing.crown((0, .49, 0), s=1.25, seed=1202)
        dressing.scatter(0, 0, 0, .19, .3, 30, 1203)
    settle(STRETCH)
