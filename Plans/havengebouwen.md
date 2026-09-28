# De havengebouwen: het pakhuis, de waag en de vissershut

**🚧 NOG NIET KLAAR** — de drie modellen zijn er en zijn tekenbaar; de treden en hun plek aan de
haven nog niet.

Begonnen op 28 september 2026, als stap 4 van `Plans/mijlpalen-tot-tweehonderd.md` ("de andere
gebouwen, één voor één, elk met een eigen kort plan"). Na het kasteel keert het dorp zich naar zee,
en dit zijn drie gebouwen voor dat tweede centrum:

| trede | wat | civicType | waar (volgens de ladder) |
|---|---|---|---|
| 113 | de vissershut | `fishery` | een *andere* haven dan de kadehaven |
| 127 | het pakhuis | `warehouse` | de kadehaven |
| 184 | de waag | `weighhouse` | de kadehaven |

## Stand van zaken

- **Eén Blender-set, drie assets**: `scripts/build-harbourhouses.py` →
  `assets/harbourhouses/harbourhouses.blend` → `web/js/harbourhouses-mesh.js`, geregistreerd in
  `web/js/models.js`. Het budget is `civic_` (1500):
  - `civic_warehouse`: 1172 driehoeken;
  - `civic_weighhouse`: 1400;
  - `civic_fishery`: 935.
- **Tekenbaar**: `civic()` in `web/js/buildings.js` tekent de drie (`HARBOUR_HOUSES`). Ze staan op
  `/demo` in de rij Civic (hut en pakhuis na het kasteel, de waag na de kraan) en in de lijst van
  `/editor`.
- **Nog niet op het eiland.** Er staat nog geen trede in `MILESTONES` en `lib/layout.mjs` kent
  nog geen plek aan de haven (`harbourSite`). Dat werk hoort bij de ladder: een trede gaat erin
  tegelijk met zijn model, en het model is er nu.
- **Maten**, gemeten op de bake, zonder de stoep (die tilt alles 0,18 op):
  - het pakhuis: 1,28 breed en 1,80 diep, en 3,80 hoog tot de kop van de tuit. Het is vier
    verdiepingen hoog: de begane grond 0,66, de verdiepingen daarboven 0,62. De kratten en
    vaten ervoor komen tot z = 1,25.
  - de waag: 1,68 breed en 1,34 diep. De trapgevel is 2,86 hoog, de windvaan op het torentje
    3,42.
  - de vissershut: de hut zelf is 0,92 bij 0,70, met de rookschuur tegen de rechtergevel. Tot de
    schoorsteen is hij 1,15 hoog. Het erf, met de netten, de boot en het rek, is 2,44 bij 2,13.
  - Alles past met de stoep erbij in een kavel van 3 bij 3 (hoogstens 1,5 vanuit het midden).
- **Tests**: `tests/harbourhouses.test.mjs` houdt voor elk van de drie vast:
  - dat de bake en het gebouw op zijn stoep binnen de kavel blijven;
  - dat het één geometrie is, met gloed in het donker;
  - dat het zijn eigen hoogte zegt;
  - dat de deur in het midden van de voorkant zit, met een vrije weg ernaartoe vanaf de voorrand
    van de kavel;
  - dat het pakhuis 3,5 tot 4 hoog is en smal;
  - dat de rookschuur van de hut rookt.

## Wat er staat

- **Het pakhuis**: een smal Amsterdams grachtenpakhuis in baksteen.
  - Bovenop een tuitgevel: de schuine kanten afgedekt met zandsteen, en een tuit met een ronde
    stenen kop.
  - Midden in de gevel een kolom luiken, met op elke verdieping twee groene deuren. Die van de
    tweede verdieping en de zolder staan open voor een donker ruim.
  - Op elke verdieping aan weerszijden een raam, en muurankers waar de balken eindigen.
  - Uit de tuit steekt de hijsbalk, onder een kapje, met een katrol en een touw. Aan het touw
    hangt een krat, halverwege op weg naar de open luiken.
  - Onderaan een groene dubbele deur met een bovenlicht, twee raampjes met tralies, een
    naambord en een lantaarn.
  - Aan de voet links kratten met een zak erop, rechts vaten en zakken.
- **De waag**: klein en deftig.
  - De begane grond is een open arcade in natuursteen: drie rondbogen voor, de middelste het
    breedst omdat de balans erin hangt, en aan elke zijkant nog een boog. Elke boog heeft een
    sluitsteen.
  - Binnen hangt de balans aan zijn hanger, met een schaal aan elk eind: kaas op de ene, koperen
    gewichten op de andere. Op de vloer staan ijzeren gewichten en een stapel kazen. Achterin is
    de wand van de waagmeester, met zijn deur en een bord.
  - Daarboven baksteen, met ramen waarvan de luiken openstaan, in de rode en crème diagonalen
    van de stad.
  - Een trapgevel van vijf treden, afgedekt met steen, met het stadswapen erin.
  - Op de nok een dakruiter: een loden voet, een open klokkenstoel op vier stijlen met de klok
    erin, en een spits in het groen van de koepel van het stadhuis, met een vergulde bol en een
    windvaan.
- **De vissershut**: een lage hut van overnaadse planken onder pannen, met de deur in het midden
    van de voorkant.
  - Tegen de rechtergevel een stenen rookschuur met een ijzeren deurtje waar de gloeiende kolen
    doorheen schijnen, en een bakstenen schoorsteen met `anchor.smoke`.
  - Achter links netten die drogen aan drie palen, in plooien en met kurken drijvers langs de
    bovenlijn. Aan hun voet ligt een hoop net.
  - Voor rechts een rek met vis die bij de staart hangt te drogen, vers en gerookt.
  - Links een roeiboot, met de boeg eerst op het strand getrokken en de riemen over de doften.
  - Bij de deur een vat haring en een vat met een deksel, bij de rookschuur kreeftenfuiken, en
    naast de deur een lantaarn.

## Besluiten

- **Eén set met drie assets, zoals de opdracht vroeg.** Dat heeft twee gevolgen.
  - Een set heeft één `building_height`, en dat is hier de gevel van het pakhuis (3,80). De winkels
    geven `models.heightOf(name)` terug, maar dat is de hoogte van de set. Voor de hut zou dat
    3,80 zijn, en dan zweeft zijn naambordje ver boven zijn dak. Daarom een eigen tak in `civic()`
    die `assetRise(name)` teruggeeft: de hoogste vertex van dat ene asset. Dit is ook de reden
    dat ze in `HARBOUR_HOUSES` staan en niet in `SHOPS`: de winkels houden hun hoogte precies
    zoals die was.
  - Blender houdt objectnamen uniek in het hele bestand. De tweede deur heet dus
    `anchor.door.001`, en de regels weigerden dat anker. `scripts/export-models.py` leest nu alleen
    het woord tussen de eerste en de tweede punt als het anker. Twee keer hetzelfde anker in één
    asset is een fout. Nagemeten: elke andere set bakt daarna byte voor byte hetzelfde.
- **Getekend en belopen als de winkels.**
  - Het zijn gewone gemeente-assets zonder bewegende delen, dus één `meshAsset` en geen eigen
    module.
  - Ze staan op de stoep van de herberg (`porchOverhang`).
  - Ze worden per onderdeel omlopen (`APART`). Dat is nagemeten: samengevoegd werden de kratten
    en vaten van het pakhuis met de muren één blok tot z = 1,22, voorbij de deur op 0,80. Bij de
    hut werden de boot, het rek en de vaten één blok tot 0,97, met de deur (op −0,22) erin.
    Alles wat laag genoeg is om tegenaan te lopen is daarom een eigen object.
- **De voorkant is +z, naar het water, en de deur zit in het midden van de voorkant.** Daar komt
  het pad aan. Kratten, vaten, de boot en het rek staan ernaast, nooit ervoor.
- **Ook de vissershut staat op de stenen stoep.** Daardoor komt er een stenen voet onder het hele
  erf, de boot en het rek inbegrepen, en die leest als een stenen aanlegplaats. De andere keuze
  was geen stoep (`NO_PORCH`) en een eigen plankier in het model. Dat plankier kan niet onder de
  grond doorlopen (de oorsprong ligt op y = 0), dus op een aflopend strand zweeft de hut dan aan
  de lage kant. De rok van de stoep is wat dat opvangt, net als bij de stal en de zagerij.
- **De netten en het rek kijken naar het water.**
  - Eerst stonden ze langs de zijkant, in de lengte. Van voren zag je ze dan op hun kant: een rij
    palen.
  - Het rek stond eerst dwars voor de hut. Uit de gebruikelijke kijkhoek stond het dan voor de
    deur. Nu staat het rechtsvoor, naast de deur.
  - Een plat net las als een gordijn. Het hangt nu in plooien en met een rafelige onderrand.
- **Rook**: de rookschuur rookt de hele dag. Daarvoor kreeg `civicFire` in `web/js/main.js` er
  `fishery` bij, zoals de bakkerij en de ketelmaker.
- **Kleuren uit het dorp.**
  - Het terracotta van de herberg en haar lichtere nok, haar baksteen en eiken, de voeten en de
    natuursteen van de winkels, het groen van de koepel van het stadhuis.
  - De baksteen van het pakhuis is een tint dieper, zoals Amsterdamse baksteen.
  - Alleen de verf is van de haven: groene luiken aan het pakhuis, rood en crème aan de waag, een
    blauwgroene roeiboot (het teal van de bibliotheek) en getaande netten.
- **Geen letters**: het naambord van het pakhuis is een plank met een donkere inleg, en de waag
  draagt een wapenschild.
- **Gloed in het donker**, zoals op elke winkel: een verlicht vlak net voor een donker vlak.
  - Het pakhuis: alle ramen, het bovenlicht, het ovaaltje in de tuit en de lantaarn.
  - De waag: de ramen en de twee lantaarns naast de middelste boog.
  - De hut: het raam, het ruitje in de deur, de lantaarn en de kolen achter het deurtje van de
    rookschuur.

## Later

- **Een visser bij de hut**, een passieve settler zoals de smid (`web/js/smithy.js`): hij boet
  netten tussen de palen, hangt vis aan het rek of zit in de boot. `anchor.door` staat er al, net
  als het rek en de boot, die hij als vaste punten kan lezen. Het is in deze ronde niet gedaan.
- **De treden en de plekken**:
  - `MILESTONES` in `lib/village.mjs`;
  - `harbourSite` in `lib/layout.mjs`, voor de hut aan een andere haven dan de kadehaven;
  - `MOVABLE_CIVICS`/`CIVIC_NAMES` in `lib/plan.mjs`;
  - de tekst in `docs/manual.md`.

  Dat is het werk van de ladder, niet van de modellen.
- **Wat zou kunnen bewegen**, met het patroon van de zagerij (een deel met zijn oorsprong op zijn
  eigen as, overgeslagen met `meshAsset(name, hex, { skip })`):
  - de krat aan het touw van het pakhuis, die op en neer gaat;
  - de balans van de waag, die even doorslaat;
  - de klok in het torentje, die luidt als de markt opengaat.
