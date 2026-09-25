# Stal, dieren en de spullen van het veld

Begonnen op 25 september 2026, na de zagerij en de smidse, met dezelfde opzet: eerst model en
animatie op `/demo`, de plek op het eiland later. Uit de rondgang "wat ontbreekt er nog" (de rest
staat in `Ideas/Ideas.MD`, #15 tot #17).

## Wat er is

- **Stal** (`scripts/build-stable.py`, `civic_stable` 788 + `civic_stable_yard` 672): vakwerk
  met blauwe leien naar `Ideas/Images to Render/StableParts.png`, gedeelde staldeuren met de
  bovenhelft open, een dubbele deur, hooizolder, uithangbord, lantaarn; een wei met hek, poort,
  waterbak, hooiruif, hooibalen, zadelrek en zand. `web/js/stable.js` laat het paard los op het
  zand en zet twee kippen voor de staldeuren.
- **Dieren** (`scripts/build-fauna.py`): paard (naar `horse.png`, met zadel), koe, schaap, kip,
  meeuw, eend. `web/js/fauna.js` geeft ze gedrag: grazen, rondkijken en naar een nieuwe plek in
  hun gebied stappen (viervoeters), pikken en scharrelen (kip), dobberen en rondzwemmen (eend),
  klapwiekend rondjes vliegen met af en toe zweven (meeuw).
- **Veld en water** (`scripts/build-farmyard.py`): vogelverschrikker, hooiberg, bijenkorven,
  riet, waterlelie. `web/js/countryside.js` laat riet en vogelverschrikker wiegen, lelies deinen
  en bijen rond de korven zoemen.
- **Bakkerij** (`scripts/build-bakery.py`, `civic_bakery` 900): vakwerkwinkeltje met luifel,
  broden, krakeling, meelzakken, en een koepeloven waarvan de gloed ademt en 's nachts licht geeft.

Op `/demo`: stal en bakkerij in de rij "Civic", de rest in de nieuwe rij "Country life".

## Besluiten

- **Een nieuwe klasse `fauna_`, budget 1200** (`scripts/model-rules.mjs`, `export-models.py`,
  `assets/README.md`): een dier is geen prop (120 is te krap voor vier poten) en geen gebouw. Het
  gezadelde paard komt op 520. Net als props moeten dieren gecentreerd zijn.
- **Elk dier in bewegende delen**, elk met zijn oorsprong op zijn gewricht: romp, kop (met nek,
  draait bij de nekwortel), staart, vier poten (bij de heup), of bij vogels vleugels en pootjes.
  Het paard is een eigen asset in plaats van een deel van de stal, zodat dezelfde dieren overal
  kunnen lopen.
- **Gedrag is een kleine toestandsmachine op een eigen klok en een seed** (stil, eten, lopen),
  dus twee keer dezelfde frames geven hetzelfde veld (`tests/fauna.test.mjs`).
- **De wei komt uit de bake**: `civic_stable_yard paddock` is het zand, `stable.js` meet het en
  houdt het paard een halve paardlengte van de hekken.
- **De bakkersgloed is het enige losse deel van de bakkerij** (`isBakeryMoving`), gedimd via
  `aEmissive` zoals de kolen van de smidse.

## Later

- Plek en trede op het eiland, samen met de zagerij en de smidse.
- Dieren op het eiland zelf: schapen en koeien op de velden die de wijken al hebben, kippen bij de
  hutten, eenden op de rivier, meeuwen bij de haven. Dat vraagt per soort een regel waar hun
  gebied ligt (een veld, een stuk rivier), en wie de dieren tekent zodra ze ver weg zijn.
- Een bakker als passieve settler bij de oven, zoals de smid.

## Dieren uit plaatjes (25 september, middag)

De getekende koe leek niet op een koe, dus een deel van de dieren komt nu uit plaatjes: Trellis.2
(lokaal, via Modly) → `blender_lowpoly.py` en `grade_glb.py` uit de GLB-lane van img2threejs →
`assets/fauna/source/<naam>.glb`, en `scripts/build-fauna.py` knipt dat in dezelfde bewegende
delen als de getekende dieren, zodat `fauna.js` er niets van merkt. Een bronbestand vervangt het
getekende dier van dezelfde naam.

- **Geit, koe, schaap, varken, mus (zittend en vliegend)** uit plaatjes; paard, kip, eend en
  meeuw blijven getekend. Budget `fauna_` is naar **1200**: bij 500 werden de poten van de koe
  stokjes.
- **Wat het knippen doet** (`from_glb`): op de grond en op het midden zetten; kleuren lineariseren
  (grade_glb schrijft sRGB-getallen); elk vlak één kleur uit een palet met de tinten die het
  plaatje laat zien (een geschaduwde witte flank blijft wit); een kleur kan beperkt worden tot
  boven/onder (hoorns, hoeven); de **ongeziene kant neemt de kleuren van de geziene kant over**
  (`mirror`); poten onder de buik, weg van het midden (uier), verlengd tot in de romp en dichtgemaakt;
  poten optioneel dikker (`thicken`); schapenpoten getekend (`draw_legs`) omdat geen remesh de
  dunne schilletjes houdt; vliegende vogels in romp en twee vleugels (`wings`).
- **Lowpoly**: SMOOTH-remesh op diepte 6 werkt voor de meeste; diepte 7 blijft op een paar
  duizend driehoeken steken; het schaap versplinterde en ging wel met VOXEL. Altijd de lowpoly
  renderen en bekijken voor het knippen.
- **Meerdere aanzichten**: het varken lukte vier keer niet uit één plaatje (stekelige klomp).
  Vier aanzichten zonder naam (`trellis_generate.py --views`) worden samengevoegd zonder te weten
  welke kant wat is: een te kort varken waarvan de kop in de romp overliep. Met **benoemde
  aanzichten** (`--front/--back/--left/--right`, Trellis' `run_multiview`) stuurt elk aanzicht
  alleen zijn eigen kant: een goed varken, van de juiste lengte. Vraag de plaatjes als één
  turnaround (2x2 of een strip) op effen groen, zonder schaduw en zonder omlijning, en zet in de
  prompt niets over een "losse" kop of nek - dat tekent de generator letterlijk. Een 2x2 kwam
  terug als open mesh die bij VOXEL-remesh versplinterde; de strip gaf een dichte. Daarvoor is de
  Modly-node lokaal aangepast (`~/.modly/extensions/trellis2/generator.py`, origineel ernaast als
  `generator.py.orig-single-view`) - een update van die extensie zet dat terug.
- **Het varken heeft geen losse kop**: los geknipt gaf het een trede bij de wang en bleef er een
  oor op de romp; `fauna.js` kan zonder (`neck` weglaten in de spec).
- **Stabiele bake**: bmesh levert de stompjes en kapjes van de poten in wisselende volgorde op;
  `from_glb` sorteert ze op plek voor het wegschrijven.
- **De mus** heeft twee modellen: op de grond hipt en pikt de zittende, in de lucht klapwiekt de
  vliegende (`createSparrow` in `fauna.js`).
