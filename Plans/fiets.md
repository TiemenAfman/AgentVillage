# Een fiets om op te rijden

Begonnen op 24 september 2026. Referentie: `Ideas/Images to Render/bicycle_parts.png` (een
lowpoly blauwe fiets in losse onderdelen). Doel: een werkend, bruikbaar model: je stapt op
in walk-mode, fietst over het eiland, en andere spelers zien je fietsen.

## Wat het doet

- **F** in walk-mode: op de fiets of eraf. Op het land, met je voeten op de grond, en niet
  in een boot, op een kruk, liggend, zwemmend of in een kamer. Eraf zetten doet je naast de
  fiets neer; de fiets zelf gaat mee in je tas. Er staat dus nooit een fiets van iemand
  anders ergens geparkeerd, en de server hoeft niets over fietsen te onthouden.
- W/S trappen en remmen (S bij stilstand is achteruit lopen met de fiets), A/D sturen,
  Shift gaat staand op de pedalen en kost het lichaamsuithoudingsvermogen, net als rennen.
- Water is een muur: de fiets stopt aan de waterlijn. Gebouwen en mensen zijn dezelfde
  muren als voor je voeten (`blocked` in walk.js), met langs de muur glijden en snelheid
  kwijt bij een botsing.
- Andere spelers zien je op een fiets, met draaiende wielen.

## Besluiten

- **Het model gaat door de gewone Blender-pijplijn**: `scripts/build-bicycle.py` schrijft
  `assets/bicycle/bicycle.blend`, `npm run models -- bicycle` bakt het naar
  `web/js/bicycle-mesh.js`. Geen GLB en geen loader (de regel "nothing is fetched at boot").
  Het is een hero-asset van één set (`HERO_BUDGET` 4000), met een eigen, veel lager doel
  van ~1500 driehoeken, omdat elke fietsende peer er één tekent.
- **Losse onderdelen die bewegen**: `bicycle frame`, `bicycle wheel rear`,
  `bicycle wheel front`, `bicycle steer` (vork, stuurpen, stuur), `bicycle crank`
  (kettingblad, cranks, pedalen). Elk Blender-object heeft zijn oorsprong op zijn eigen as
  (naaf, trapas, balhoofd), zodat `at` uit de bake meteen het draaipunt is.
- **Op schaal van de settler, niet in meters.** De figuur is 0.62 hoog met de heup op 0.157:
  een fiets in meters (wiel 0.165 bij 1 unit = 4 m) zou passen, maar het zadel moet op
  heuphoogte en het stuur waar de handen komen. Dus een stevige, korte fiets met grote
  wielen, net als het plaatje.
- **`state.bike`, niet `state.vehicle`.** `vehicle` betekent overal in main.js en net.js
  "de boot" (hull-sync, afmeren, uithoudingsvermogen van de boot). Een tweede soort
  voertuig daarin zou elke `aboard()` laten liegen. `stepBike` in `web/js/bicycle.js` is,
  net als `stepBoat`, een pure functie (geen THREE, geen klok), zodat
  `tests/bicycle.test.mjs` onder Node kan rijden.
- **Pose**: `classic-avatar.js` krijgt `riding` met de trapfase: benen draaien om de heup
  met de crank mee, armen naar voren naar het stuur, lijf op het zadel.
- **Multiplayer via de pose-vlag**: `FLAG_RIDING = 128` in net.js, `POSE.RIDING` en
  `POSE_MASK = 255` in `lib/players.mjs`, en peers.js tekent een fiets onder een peer met die
  vlag. Geen nieuw bericht en geen serverstaat.
  **Let op:** de vlag komt pas bij anderen aan als de zee (`sea.mjs`, de container) met deze
  `lib/players.mjs` draait; tot die tijd maskeert de oude zee hem weg en zien anderen je als
  een snel lopende settler. Niets breekt.
- **Geen zwaard of schild op de fiets**: `net.swing()` en `FLAG_BLOCKING` weigeren al met
  een voertuig; dat geldt ook voor de fiets.

## Later, niet nu

- Geparkeerde fietsen die blijven staan (en die een ander kan pakken) vragen serverstaat
  zoals de vloot in `lib/boats.mjs`. Pas doen als de fiets zelf bevalt.
- Een fietsenrek op het plein als decor.
