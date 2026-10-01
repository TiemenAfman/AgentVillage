"""The ship's wheel on the chimney breast (KIT.helm), its face to +z: dressing.py's ph_wheel, its
hub LIFT over its lowest spoke. Not civic_kraken_wheel, which is the wheel chandelier over the pit.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/stuurwiel.jpg.
"""
from geom import settle
from standin import dressing

ASSET = 'civic_kraken_helm'
LIFT = .26
STRETCH = (1.1827, 1.0, 1.33)   # the stand-in to the box of Pixal3D's stuurwiel (standin.py)


def build():
    dressing.ph_wheel((0, LIFT, 0), 0)
    settle(STRETCH)
