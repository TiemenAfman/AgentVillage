"""A Jolly Roger (KIT.jollyrogers), flat on what it hangs on: dressing.py's ph_jolly_roger, 0.5 x
0.35, its foot LIFT under its middle.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/jolly-roger.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_jollyroger'
LIFT = .175
STRETCH = (1.0, 1.2106, 4.5667)   # the stand-in to the box of Pixal3D's jolly-roger (standin.py)


def build():
    dressing.ph_jolly_roger(M((0, LIFT, 0)), w=.5, h=.35, seed=1)
    settle(STRETCH)
