"""The globe on its stand (kind `globe`): dressing.py's ph_globe.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/globe.jpg.
"""
from geom import settle
from standin import dressing

ASSET = 'civic_kraken_globe'
STRETCH = (1.458, 1.0, 1.6937)   # the stand-in to the box of Pixal3D's globe (standin.py)


def build():
    dressing.ph_globe()
    settle(STRETCH)
