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

## Op het eiland (26 september)

- **Klaar: plek en trede.** De bakkerij op **65** settlers (tussen de smidse, 60, en het
  standbeeld, 70) en de stal op **75** (de eerste trede in het gat tussen het standbeeld en de
  brug, 90). De bakkerij eerst: het kleine winkeltje, en wat een stad met een molen sinds 30 als
  volgende wil; de stal met zijn wei is het grotere erf. Allebei in `TRADES` (`lib/layout.mjs`),
  dus net als de zagerij en de smidse het dichtstbijzijnde vrije 3x3-blok op het rooster van de
  stad, nooit een kavel rond het plein. Op seeds 5, 2024 en 1337 komen ze 8 à 9 cellen van het plein
  naast de andere werkplaatsen.
- **Nagemeten dat 3x3 past.** `findBlockAround` geeft alleen 3x3, dus eerst de bakes gemeten: de
  bakkerij reikt 0,86 van zijn midden, de stal 1,518 - de palen van het buitenste hek staan precies
  op de kavelgrens (1,5), dus een halve paal steekt erover. Geen groter kavel nodig.
  `tests/trades.test.mjs` houdt elke bake aan de `w` van zijn kavel (niet aan een aangenomen 3) en
  dat de kavels rond het plein met en zonder werkplaatsen hetzelfde bezet raken. De opstap
  (`porch`, 0,23 rondom) steekt bij de stal 0,25 en bij de zagerij 0,15 in de steeg; dat is alleen
  beeld (lopers botsen op de voetafdruk van vóór de opstap) en is zo gelaten.
- Geen versiepoort: een nieuwe trede zet een nieuw kavel en verschuift niets. Beide mogen door de
  keeper verplaatst worden (`MOVABLE_CIVICS` in `lib/plan.mjs`), zoals de zagerij en de smidse.
- `main.js` hangt paard en kippen (`attachStable`), de ovengloed (`attachBakery`) en de bakker aan
  het gebouw zoals de zagerij en de smidse, op ons eiland en op dat van een buur; `disposeRecord` en
  `guest-island.js` ruimen ze op. De schoorsteen van de oven rookt zoals die van de smidse. Paard en
  kippen blijven decor uit `fauna.js`, geen verhaaldieren (die zijn van de zee en
  `web/js/animal-view.js`).
- **Klaar: de bakker** (`web/js/bakery-keeper.js`, `tests/bakery-keeper.test.mjs`). De spelersrig
  (`createClassicAvatar`) in het wit met een witte muts, op de maat van de smid, met een schieter
  (broodschep) in de rechtervuist. Overdag: deeg erop, de schieter de oven in, even wachten, er komt
  brood uit, dat wordt weggezet, en een adem later het volgende. 's Nachts gaat hij langs de
  voorkant naar de winkeldeur (`anchor.door`) en naar binnen, en 's ochtends komt hij terug; de
  schemergrenzen zijn die van de smid, dus ze gaan tegelijk naar binnen. De oven zelf blijft 's
  nachts gloeien: een stenen oven houdt zijn warmte vast.
- **Waar hij staat komt uit de bake én uit de rig**: de mond is de oorsprong van
  `civic_bakery glow`; hoe ver hij ervandaan staat rekent hij bij het maken uit met zijn eigen arm,
  zodat de schieter op volle lengte 0,09 de mond in gaat (midden op de mond, gemeten) en
  teruggetrokken 0,09 ervoor hangt. Eerst kantelde de schieter mee met zijn voorover leunen en ging
  hij onder de mond door de stenen drempel; nu houdt hij zijn hoek ten opzichte van de grond.
- Op `/demo` staan de vier werkplaatsen nu met hun trede in de rij "Civic", en de stal en de
  bakkerij op de hoogte van hun opstap (ze hingen er 0,18 onder).

## Later

- ~~Dieren op het eiland zelf~~ **Klaar (26 september): `web/js/herds.js`**, `tests/herds.test.mjs`.
  Decor, geen verhaaldieren: niemand onthoudt ze, de zee weet niet van ze, en ze zitten in een
  eigen batch (niet in die van `animal-view.js`, anders is een naamloze kip een dossier zonder
  iemand). Welk dier waar staat rekent elke pagina uit uit wat ze van een eiland al heeft - terrein,
  dorp of bundel, en de velden die de eigen pagina van de keeper heeft opgemeten - dus iedereen ziet
  dezelfde kudde in hetzelfde veld; hoe ze daarbinnen rondscharrelen is de pagina's eigen klok
  (`createBrain`/`stepBrain`, het brein van `fauna.js` zonder Object3D, dat de demo en de stal ook
  lopen). De regels, per soort:
  - **Schapen of koeien** in één omheind veld per wijk (twee bij zes velden of meer): de rechthoeken
    van de eigen veldmeting (`workSites().fields`, en bij een buur de `work.fields` van zijn bundel -
    dezelfde meting, door zijn keeper gepost). Een veld hoort bij de wijk met het dichtstbijzijnde
    midden. 3-4 schapen of 2-3 koeien, naar oppervlak begrensd; een lichaamslengte binnen het hek.
  - **Kippen**: 2-3 voor één op de drie hutten, op de rij cellen voor de deur (`DOOR_DIR[rot]`),
    alleen op land. Gekozen op het kavel, nooit op het huis-id - een bezoeker ziet dat geredigeerd.
  - **Eenden**: 2-3 op hoogstens drie plekken: het meer als daar water staat, dan rivierhoeken met
    water aan alle vier kanten, getest door de grond eromheen af te tasten, 8 uit elkaar, en met
    land binnen drie cellen (een rivier heeft oevers, een open ligplaats niet).
  - **Meeuwen**: 2-4 in gestapelde kringen voor de kop van elke kade (`quaysOf`), eerst twee per
    kade, dan de rest.
  - Elke keuze is een hash van de seed en de plek, nooit een trekking op volgorde, dus een veld of
    hut elders verschuift niemand. Hoogstens 40 per eiland (16 wei, 9 kippen, 6 eenden, 9
    meeuwen); het levende eiland komt precies op 40. Niets op de vulkaan.
  - **Wie ze tekent als ze ver weg zijn: niemand.** Alleen eilanden die main.js heel tekent
    (`DETAILED`) krijgen een kudde, en voorbij 110 van het oog wordt een dier niet gestapt en niet
    getekend. Gemeten: 40 dieren kosten 29 draw calls (schaap 6, koe 7, kip 6, eend 4, meeuw 6 -
    per soort, niet per dier: 80 op twee eilanden kost hetzelfde), op het levende eiland 1012 -> 1040
    in `?stats`; 0,08 ms per frame voor 40.
  - Het brein laat een dier lopen zodra het ongeveer (45°) de goede kant op kijkt, dus zijn pad
    buigt; in de strook voor een hut liep een kip er zijwaarts uit. `herds.js` zet elk dier na elke
    stap terug binnen zijn gebied (een hek dat het brein niet kent) in plaats van `fauna.js` te
    veranderen, zodat de demo precies blijft lopen als hij liep.
- Een staljongen bij het paard, of het paard dat 's avonds naar binnen gaat, op dezelfde manier.

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
