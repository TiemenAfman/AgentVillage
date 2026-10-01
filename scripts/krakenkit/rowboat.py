"""The jolly boat by the jetty (KIT.rowboat), bow to +x: dressing.py's ph_rowboat, framed on her
keel (LIFT, KIT.rowboat.gunwale). Her painter to the jetty is the room's.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/roeiboot.jpg.
"""
from geom import M, frame, settle
from standin import dressing

ASSET = 'civic_kraken_rowboat'
LIFT = .17
STRETCH = (1.0, 0.7284, 1.4219)   # the stand-in to the box of Pixal3D's roeiboot (standin.py)


def build():
    with frame(M((0, LIFT, 0))):
        dressing.ph_rowboat()
    settle(STRETCH)
