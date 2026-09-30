"""The ship's lantern (prompt 8): the hall's own lantern, stood on its own as the kit's example.
Every object here is a module with ASSET and build(); see scripts/build-krakenkit.py."""
from geom import lantern

ASSET = 'civic_kraken_lantern'


def build():
    lantern((0, .048 * 1.25, 0), s=1.25)   # its base on the ground
