"""A hammock (KIT.hammocks, scaled to each span): dressing.py's ph_hammock between two hooks
kraken-layout.js HAMMOCK.len apart along z, at HAMMOCK.hook over its lowest point (LIFT). The
slings up to the deck are the room's.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/hangmat.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_hammock'
LIFT = .2610
LEN = 1.25                  # kraken-layout.js HAMMOCK.len
STRETCH = (2.1946, 1.7703, 0.9998)   # the stand-in to the box of Pixal3D's hangmat (standin.py)


def build():
    with frame(M((0, LIFT, 0))):
        dressing.ph_hammock((0, 0, -LEN / 2), (0, -.03, LEN / 2), .24, seed=1)
    settle(STRETCH)
