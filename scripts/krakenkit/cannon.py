"""The snug's gun (kind `cannon`), muzzle to +x: dressing.py's ph_cannon.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/kanon.jpg.
"""
from geom import settle
from standin import dressing

ASSET = 'civic_kraken_cannon'
STRETCH = (1.0, 1.1196, 0.9799)   # the stand-in to the box of Pixal3D's kanon (standin.py)


def build():
    dressing.ph_cannon()
    settle(STRETCH)
