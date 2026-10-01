"""The captain's chair (KIT.captainchair), facing +z, the chart table: dressing.py's ph_captain_chair.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/kapiteinsstoel.jpg.
"""
from geom import settle
from standin import dressing

ASSET = 'civic_kraken_captainchair'
STRETCH = (1.7408, 1.0, 1.5975)   # the stand-in to the box of Pixal3D's kapiteinsstoel (standin.py)


def build():
    dressing.ph_captain_chair()
    settle(STRETCH)
