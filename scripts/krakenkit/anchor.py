"""The anchor on the south wall (KIT.anchor), its back on the wall at z = 0: dressing.py's
ph_anchor, framed on the foot of its arms (LIFT).
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/anker.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_anchor'
LIFT = .2527
STRETCH = (1.4488, 1.0, 4.8955)   # the stand-in to the box of Pixal3D's anker (standin.py)


def build():
    dressing.ph_anchor(M((0, -LIFT, 0)))
    settle(STRETCH)
