"""The chart table on the captain's deck (KIT.charttable): dressing.py's ph_chart_table with what
stands on it. The chart is the room's, so it lies on the HD model as well.
A stand-in until the keeper has drawn it (standin.py); in the HD pack it is Pixal3D's model of
refs/krakenkit/objecten/kaartentafel.jpg.
"""
from geom import settle
from standin import dressing

ASSET = 'civic_kraken_charttable'
# Its top as high as the HD model's (0.31 there, by a ray down onto it), so the room's chart lies on
# either: kraken-layout.js KIT.charttable.top. Not by a stretch up, which would put the stand-in's top
# at 0.245 and its candlestick through the roof of the model's.
TOP = .31
STRETCH = (1.0, 1.0, 0.9367)   # the stand-in to the box of Pixal3D's kaartentafel (standin.py)


def build():
    dressing.ph_chart_table(top=TOP)
    settle(STRETCH)
