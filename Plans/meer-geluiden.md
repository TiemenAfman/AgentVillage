# Meer geluiden op het eiland

**🚧 PLAN** — van 2 oktober 2026, nog niet gebouwd.

Gevraagd: meer geluid op het eiland. Dieren, omgeving die meegaat met het uur en het weer, het
geroezemoes van de kroegen dat je buiten gedempt hoort, en de ambachten aan het werk. Doel: een
eiland dat je met je ogen dicht herkent - waar je bent (bos, haven, plein, helling van de
vulkaan), hoe laat het is en wat er gebeurt - zonder dat het ooit druk wordt.

## Hoe het zit

`web/js/sound.js` (1460 regels) is het hele geluid, en de kop ervan noemt drie regels die dit plan
overneemt:

- **Niets wordt opgehaald.** Elk geluid wordt uit een rng en een envelope berekend, één keer, in
  een `AudioBuffer`. Pas bij de klik op de chip, nooit bij het laden (2,3 MB Float32, één frame
  van 38 ms). `tests/sound.test.mjs` leest de bron en faalt op `fetch(`, `XMLHttpRequest`,
  `AudioLoader`, `decodeAudioData`, `new Audio(` en elke `import(`. De enige uitzondering is de
  eigen muziek van de keeper: main.js geeft een `makeElement` mee en sound.js speelt alleen af wat
  het krijgt.
- **Niets bestaat vóór een gebaar.** Geen context, geen listener, geen buffer tot `setOn(true)` na
  een pointerdown/keydown. `stats()` bewijst het vanaf de console.
- **Driehonderd inwoners zijn geen driehonderd bronnen.** Elke stem is één keer gemaakt, op vaste
  lengte: 4 hamers, 2 meeuwen, 1 kroeg, plus twee bedloops. Welke vier hamers kiest `nearestFirst`
  (shared/regions.mjs) met zijn tiebreak op id, en een slot is *sticky*: een bouwer houdt zijn stem.
- En een smaakregel: stil en schaars boven druk. Twijfel je of je het hoort, dan klopt het ongeveer.

Wat er nu klinkt:

| bron | soort | hoe hij zijn plek vindt |
|---|---|---|
| zee, wind | bed (niet-positioneel), loop | `coastliness`: 8 sondes op een ring, `depthAt` van de archipel |
| hamers | 4 positionele one-shots | crowd-figuren met `anim === 'hammer'`, tempo uit `f.phase` |
| meeuwen | 2 positionele one-shots | timer 17-48 s, overdag, boven de dichtstbijzijnde kade |
| kroeg-geroezemoes | 1 positionele loop | dichtstbijzijnde `tavern`/`piratetavern`-record, "busy" = stilstaande figuren + borreltafels |
| rave, shanty, keeper-tracks | lied-bed: binnen luid en open, buiten gedempt (`cut`), niets voorbij `range` | `raveHeard`/`shantyHeard`/`tavernHeard` in main.js |
| onder water | lowpass op de master-bus (20 kHz → 600 Hz) | `setUnderwater` vanuit underwater.js |

main.js vertelt sound.js alles via één snapshot (`soundSnapshot`, zes keer per seconde): nacht,
binnen, `depthAt`, de crowds van ons en elk gasteiland, kades, onze records, borreltafels, en de drie
liederen. Dat blijft de enige weg naar binnen.

## Besluiten

### Synthese blijft de regel; samples alleen als eigen map van de keeper

- **Alles in dit plan wordt berekend, zoals nu.** Een kip, een koe, krekels, regen op een dak,
  een zaag, een hoefslag en een lavarommel zijn allemaal ruis door een filter met een envelope, of
  een paar sinussen - het soort geluid dat de hamer en de meeuw al bewijzen. Geen licentievraag, geen
  binair bestand in git, geen loader, en de test hoeft niet te veranderen.
- **Gemaakt per familie, op het eerste moment dat hij nodig is, in stappen.** Niet alles bij de
  klik: de huidige set kost al 38 ms in één frame. Elke nieuwe familie (`animals`, `crafts`,
  `night`, `dawn`, `rain`, `water`, `lava`) is een generator zoals `raveSong`, die `makeMore()` een
  stap per frame laat zetten (≤ 4 ms per stap) zodra de eerste bron van die familie binnen bereik
  komt. Een pagina die nooit bij de vulkaan komt, maakt nooit een lavarommel. `stats().buffers`
  laat zien welke families er zijn.
- **De eerlijke uitzondering is levende wezens die je herkent**: de meeuw heet in de kop al "de
  enige stem waar een opname beter zou zijn", en een koe en een geit horen daarbij. Daarvoor - en
  alleen daarvoor - een *latere, optionele* fase: `HOME/audio/sfx/<naam>.ogg` van de keeper zelf,
  naast de bestaande `kroeg`/`rave`/`pirates`-mappen, net zo keeper-only (`/api/music`-patroon, niet
  op `PUBLIC_API`), nooit in git en nooit in een release. main.js haalt en decodeert ze ná de boot
  (het imp-/HD-pakket-patroon: alleen gevraagd als de familie nodig is, een mislukking één keer
  gezegd, niets wacht erop) en geeft sound.js kant-en-klare `AudioBuffer`s via `setSamples(name,
  buffer)` - zoals `makeElement`. sound.js zelf blijft dan nog steeds zonder `decodeAudioData`. Een
  sample vervangt een berekende stem met dezelfde naam; zonder sample speelt de berekende. Advies
  voor de bron: alleen CC0 (bijv. Freesound met het CC0-filter), en de keeper houdt zelf bij waar
  elk bestand vandaan komt (`HOME/audio/sfx/SOURCES.txt`).

### Eén nieuw soort stem: de plek-stem, met vaste pools per familie

De hamer-pool wordt het patroon voor alles wat positioneel is. Twee soorten:

- **One-shots** (een slag, een kakel, een bel): een pool per familie, sticky per bron-id, `fire()`
  zoals nu (eerst `play()`, dan `updateMatrixWorld`).
- **Loops met een plek** (zaagblad, rivier, lava, geroezemoes): één bron per loop-familie, waarvan
  de *houder* naar het dichtstbijzijnde punt van die bron schuift (een rivier is een lijn, geen
  punt) en waarvan het volume op afstand glijdt. Gestart bij het eerste "hoorbaar", gestopt pas als
  de gain echt op nul is - de kroeg doet het al zo.

Een bron wordt **nooit** door een tekenmodule aangeroepen. Sound leest; de rest weet er niets van.
Een module die iets laat gebeuren dat je moet horen op het moment dat je het ziet, geeft daarvoor
een goedkope, alleen-lezen **cue**: een teller of een klok. De snapshot verzamelt de cues binnen
bereik, sound.js vergelijkt met wat hij vorige keer zag en speelt het verschil.

| cue | waar | wat sound.js ermee doet |
|---|---|---|
| `smithy.blows` (telt al) + `smithy.mode` | `web/js/smithy.js` | een teller die opliep is een slag op het aambeeld (`IMPACT_S` na de zwaai, dus de cue wordt gezet bij de inslag, niet bij de start) |
| `feedAt(t)` | `web/js/sawmill.js` | het blad loopt altijd (loop), onder last als er een stam doorheen gaat: hoger, harder, met de gil van het hout |
| `tripAt(plan, now)` | `web/js/timberrun.js` | paard loopt → hoefslagen op het tempo van `HORSE_SPEED` en de pas uit fauna.js, wielen op afgelegde afstand; laden/lossen → planken |
| `focus()` / fase | `web/js/goldrun.js` | het karretje over de weg, het smelten bij de goudsmid, staven die op de stapel tikken |
| cast-toestand | `web/js/fisher.js` | het zoeven van de werp en de plons van de dobber |
| bakker/slager (rec.baker, rec.butcher) | `bakery-keeper.js`, `butcher.js` | het hakmes op het blok; bij de bakker de ovenklep en het knetteren van het vuur |
| `f.anim` | crowd-figuren (crowd-view.js) | `'hammer'` zoals nu; erbij `'chop'` (bijl), `'hoe'`/`'weed'` (schoffel in de aarde), `'barrow'`/`'carry'` (piepend wiel), `'load'` (staven in de kruiwagen) |
| act-woord | `state.herd.actOf(id)` (animal-view) | `peck`, `scratch`, `chirp`, `butt`, `fly` → kakel, krab, tjilp, bonk, vleugelslag |
| ambient kuddes | `web/js/herds.js` (sheep, cow, chicken, duck, gull) | af en toe een blaat, loei, kakel, kwaak - op een eigen trage klok per dier, de dichtstbijzijnde eerst |

De cue-velden worden aan de modules toegevoegd als ze er nog niet zijn - één veld, geen gedrag.

### Wat gelijk moet lopen en wat niet

Alles in dit plan is cosmetisch en van de pagina: niets op de draad, geen veld in een bundle, de zee
weet het niet. Twee soorten timing:

- **Wat je ziet gebeuren, klinkt op dat moment** - een slag, een peck, een werp, de wagen die
  rijdt. Dat leest de cue van precies dat wat getekend wordt, dus het loopt per scherm met het
  beeld. Waar het beeld al op de klok van de zee loopt (timberrun.js, de rave), loopt het geluid
  daarmee vanzelf mee, en twee spelers naast elkaar horen de wagen op dezelfde plek.
- **Wat ongezien is, mag per pagina toevallig zijn**: een koe loeit, een krekel tjirpt, een uil
  roept. `Math.random()` zoals de meeuw nu; twee spelers vergelijken geen oren.

### Omgeving: het uur en het weer zijn bedden, de rest heeft een plek

- **Het uur komt van de zee**, via `worldNow()` → `worldTime()` (shared/worldclock.mjs) en
  `nightAt` (shared/daylight.mjs), zoals alles op de pagina. De snapshot krijgt `hour` erbij naast
  `night`; nooit `new Date().getHours()` (tests/worldclock.test.mjs vangt dat al).
  - **Ochtendkoor** (5:00-8:30, uitlopend tot 10:00): een bed van vogels, alleen landinwaarts en
    sterker bij bomen, zwakker bij regen. Berekend: losse tjilpjes en fluitjes (frequentiezwaai met
    formant, zoals de meeuw maar klein) op onregelmatige tijden in een loop van ~20 s.
  - **Krekels 's nachts** (vanaf `night > 0.5`): een bed in het gras, weg bij de zee
    (`coastliness` hoog) en weg bij regen. Een pulserende toon rond 4,5 kHz, gemoduleerd.
  - **Een uil**, zeldzaam (eens in de paar minuten), positioneel in het bos. Hetzelfde
    meeuw-patroon, 's nachts.
  - Overdag af en toe een **koekoek of merel** in het bos, net zo schaars.
- **Het weer** (`web/js/weather.js`: `clear | overcast | rain | fog`, van de zee):
  - **Regen** is een bed: ruis door een band, harder buiten. **Regen op daken** is datzelfde bed
    helderder en tikkeriger naarmate er meer records binnen ~10 eenheden staan (een telling die de
    snapshot al kan doen), en binnen in een kamer juist als dof getrommel boven je (de kamer is de
    plek waar je het dak hoort). Geen positionele bron per huis.
  - **Bewolkt en regen** maken de wind een stap harder en lager; **mist** maakt alles stiller en
    doffer (lowpass op de beds, zoals de nacht nu al doet), en laat - zeldzaam - de **misthoorn**
    van de vuurtoren horen als die er staat.
  - Geen onweer: weather.js kent het niet, en een donderslag die op een ander scherm niet klinkt
    (geen bliksem op de draad) is een raar verschil. Kan later als de zee het woord krijgt.
- **Bos**: de wind krijgt naast `coastliness` een `woodsiness` - de bomendichtheid rond de camera.
  Niet door elke boom te lopen: een grof raster (één getal per 8x8 cellen) dat main.js één keer per
  landschap maakt uit `createLandscape().solids()` (de stammen), en dat de snapshot uitleest. Meer
  bos = meer `leaves` in de wind (die component is er al) en een zacht ruisen bij windvlagen.
- **Stromend water**: een loop met een plek, langs de rivier en bij de trechter van de haven. De
  rivier is een lijst cellen die het terrein al kent; de houder schuift naar de dichtstbijzijnde
  rivercel binnen bereik. Kabbelen = ruis door een paar resonanties die langzaam verschuiven. De
  haven zelf heeft geen kabbel nodig - daar is de zee al.
- **De vulkaan**: een diepe rommel (onder 80 Hz, ruis met een trage golf) als bed dat aanzwelt naar
  de krater toe, en een borrel-loop met een plek bij de dichtstbijzijnde lavastroom
  (`lavaLines` in web/js/lava.js). Op een telefoon die geen bas heeft: de borrel draagt het.

### De kroegen buiten: geroezemoes door de muur, en de borrel op het plein

Het model van de liederen blijft: **binnen luid en open, buiten gedempt, niets voorbij `range`.**

- **De bron hangt bij de deur, niet in het midden van het gebouw.** Voor de dorpskroeg de deur van
  het record, voor de Salty Kraken `PUB_GATE` (de voet van de trap). Bij de deur is het filter
  het meest open (~1,2 kHz), langs de muur dicht (~600 Hz): de demping komt uit de afstand tot de
  deur, niet uit een raycast.
- **Twee bronnen in plaats van één.** Nu gaat het geroezemoes naar de dichtstbijzijnde van de twee
  kroegen; straks heeft elke kroeg zijn eigen loop (dorp: praten en een lach; Kraken: lager, rauwer,
  met een "arr" en meer gestamp). Er is op een eiland nooit meer dan één van elk.
- **Klinken van glazen** als one-shots door hetzelfde filter, vaker naarmate het drukker is
  (`busy` zoals nu). De clink uit `shantySong` is het model.
- **Binnen** krijgt de dorpskroeg (die geen eigen lied heeft) het geroezemoes ongedempt als bed,
  plus de clinks; in de Kraken ligt het onder de jukebox. Speelt de keeper eigen tracks in de kroeg,
  dan blijft het geroezemoes eronder, zachter.
- **De borrel** (`gatheringAt` in shared/daylight.mjs: koffie, lunch, thee, vrijdagmiddagborrel)
  krijgt een eigen loop op het plein, naar het midden van de borreltafels (`state.borrel`), harder
  en met meer clinks op vrijdag. Buiten een gathering is het plein stil op de hamers na.
- **Volgen wie er is.** De kroeg zoemt pas als er iemand staat, zoals nu; 's avonds is het
  drukker. De Kraken heeft altijd zijn bemanning, dus die zoemt altijd zacht.

### Afstand, bereik en "achter een muur"

- **Afstand**: het `exponential`-model van nu, met per familie een `ref`, een `rolloff` en een harde
  `range` waarachter de bron niet geplaatst wordt. In de laatste 20% van het bereik glijdt het
  volume naar nul, zodat een bron die uit de pool valt geen klik maakt.
- **Geen raycasts voor geluid.** Occlusie is drie eenvoudige regels:
  1. binnen hoor je buiten niets dan het gedempte bed (`INDOOR_DUCK`) - geen hamers, geen dieren,
     wel regen op het dak;
  2. een bron *in* een gebouw (geroezemoes, de oven, het smidsvuur) gaat door een filter dat opengaat
     naar de deur toe;
  3. onder water: zie hieronder.
  Een heuvel tussen jou en een bron dempt niets. Dat is een bewuste keuze: op een eiland van 40-384
  cellen is de afstand al bijna alles, en een `findPath`-achtige zichtlijn per stem per pick is
  geld voor iets dat niemand mist.
- **Van boven** (orbit): de luisteraar hangt aan de camera, dus van hoog boven hoor je weinig van de
  placed voices - dat is goed. Wel moet het bed van de camera ín het eiland komen (de grond onder
  het richtpunt), anders hoort de regisseur niets. De snapshot krijgt `ear` erbij: in walk mode de
  camera, van boven het richtpunt van de orbit-camera met een extra afstand. Te checken of
  `coastliness` daar nu al verkeerd zit.

### Onder water

- De lowpass op de master-bus blijft het hoofdmechanisme: alles wat boven water klinkt, klinkt
  erdoor gedempt.
- Bovendien **zakken de bedden van boven water** (wind, vogels, krekels, regen, geroezemoes) met de
  diepte weg naar ~0,25: geluid gaat slecht door het oppervlak. De zee zelf wordt een dof, laag
  ruisen in plaats van branding.
- Eén **onderwater-bed**: een lage drone met af en toe een tik en een kraak (garnalen, grind). En
  **bellen** als one-shots bij elke duiker die uitademt - sea-life.js heeft al een bellenpool die
  door `peers.divers()` en de eigen walker gevoed wordt; dezelfde momenten zijn de cue.
- Vissen maken geen geluid. Kelp ook niet.

### Het budget

Harde plafonds, zoals nu: array-lengtes, geen budget dat geteld wordt. Per tier (`full` / `modest` /
`phone`, dezelfde tiers als graphics-settings.js):

| familie | full | modest | phone |
|---|---|---|---|
| hamers + werkers (chop, hoe, barrow, load) | 4 + 4 | 3 + 2 | 2 + 1 |
| ambachten (smid, zaag, bakker, slager, visser, goud, wagen) | 4 | 3 | 2 |
| dieren (verhaaldieren, kuddes, paarden) | 4 | 3 | 2 |
| meeuwen, uil, misthoorn | 3 | 2 | 1 |
| loops met een plek (2 kroegen, borrel, zaagblad, rivier, lava) | 6 | 4 | 3 |
| bedden (zee, wind, ochtend, nacht, regen, onder water) | 6 | 6 | 4 (ochtend en nacht als één) |
| **positionele bronnen samen** | **≤ 29** | **≤ 19** | **≤ 12** |

- **Panning**: three's `PositionalAudio` gebruikt HRTF, en dat is per bron de duurste node in de
  graph. Op `modest` en `phone` zet sound.js `panner.panningModel = 'equalpower'`. Op `full` alleen
  de dichtstbijzijnde paar op HRTF? Eerst meten; misschien is equalpower overal goed genoeg.
- **Een bron die niet speelt kost niets.** Pools bestaan, maar alleen wat afgaat heeft een lopende
  `AudioBufferSourceNode`. Het aantal dat tegelijk *speelt* is meestal een handvol.
- **CPU aan de JS-kant**: de pick blijft zes keer per seconde en loopt de crowd één keer door voor
  alle families samen (nu alleen voor hamers en de kroeg; straks één pass die elke figuur in zijn
  emmer gooit). De `nearestFirst` per familie op de paar kandidaten binnen bereik.
- **Geheugen**: per familie een paar honderd kB tot ~1 MB Float32 op 11 of 22 kHz (de beds op 11
  kHz zoals nu). Alles samen hooguit ~6 MB extra, alleen wat gemaakt is. Op de telefoon de beds op
  8 kHz.
- `stats()` krijgt per familie `cap`, `placed` en `playing`, zodat "driehonderd inwoners,
  negentien stemmen" net zo controleerbaar blijft vanaf de console.

### Volume in Settings

- Settings → **This screen** krijgt een sectie **Sound**: een master-schuif plus **Ambience** (zee,
  wind, vogels, krekels, regen, water, lava), **Effects** (hamers, ambachten, dieren, kroegen) en
  **Music** (rave, shanty, de tracks van de keeper). Per browser, zoals de chip zelf
  (`promptholm.sound.mix`, alleen wat verschoven is), via dezelfde try/catch rond localStorage.
- In de graph: drie `GainNode`s als bussen tussen de stemmen en `listener.getInput()`. three
  verbindt elke `Audio.gain` in de constructor met de listener; bij het bouwen wordt die verbinding
  verlegd naar de bus van de familie (`audio.gain.disconnect(); audio.gain.connect(bus)`). Te
  controleren tegen de gevendorde three (r170) vóór er iets op gebouwd wordt.
- De Sound-chip blijft aan/uit. De schuiven werken ook als het geluid uit staat (ze bewaren alleen).
- Op de telefoon dezelfde sectie; `phoneprefs.js` hoeft het niet apart te houden.

### Tests

`tests/sound.test.mjs` blijft wat het is en groeit mee:

- de bestaande "nothing is fetched"-test blijft ongewijzigd groen - dat is de toets dat de synthese
  de regel bleef (en voor de samples-fase: sound.js krijgt buffers, decodeert niets);
- per familie: de buffer is eindig, binnen de rails, en een loop heeft geen naad (zoals de bed-test);
- een familie bestaat niet voordat er iets van binnen bereik was;
- driehonderd inwoners aan het hakken, schoffelen en kruien zijn nog steeds hooguit `cap` stemmen;
- een cue die oploopt geeft precies één slag; een cue die gelijk blijft geen;
- binnen hoor je geen hamer en geen dier, wel regen;
- onder water zakken de bedden van boven;
- de mix-bussen: master/ambience/effects/music op nul maakt de juiste stemmen stil en de rest niet.

## Volgorde van oplevering

Elke fase is los af te leveren en los te horen. De kleinste met de meeste winst eerst.

1. **De kroegen buiten en de borrel.** Bouwt op wat er al is (de murmur-loop, `busy`, de liederen):
   de bron naar de deur, een filter dat opengaat bij de deur, een tweede bron voor de Kraken met een
   eigen stem, clinks, het geroezemoes binnen in de dorpskroeg, en een loop op het plein tijdens
   `gatheringAt`. Erbij de **mix-bussen en de schuiven in Settings**, omdat elke volgende fase ze
   nodig heeft en ze klein zijn.
2. **Ambachten.** De smid (cue `blows`), het zaagblad (`feedAt`), de bakker en de slager, en de
   werkers in de crowd (`chop`, `hoe`/`weed`, `barrow`/`carry`, `load`) als veralgemening van de
   hamer-pool. Hier komt de "cue"-afspraak voor het eerst in de code.
3. **Het uur en het weer.** Ochtendkoor, krekels, uil, regen (met daken), mist (misthoorn), bos
   (`woodsiness`). Allemaal bedden of zeldzame one-shots, dus goedkoop; het raster voor het bos is
   het enige nieuwe in main.js.
4. **Dieren.** De verhaaldieren op hun act-woorden, de kuddes van herds.js op hun eigen trage klok,
   het paard van de stal en de meeuwen op de plekken van de ambient meeuwen in plaats van alleen
   boven de kade.
5. **Water en vuur.** De rivier en de trechter, de vulkaan (rommel en borrel), en het onderwater-bed
   met bellen.
6. **De rondes.** De houtkar (hoeven, wielen, lossen), de goudrun (karretje, smelten, staven), de
   visser (werp en plons). Laatst, omdat ze zeldzaam zijn en het meeste uitzoekwerk vragen om in de
   pas te lopen met het beeld.
7. **Optioneel: eigen samples van de keeper** (`HOME/audio/sfx/`), alleen als blijkt dat een
   berekende koe of geit echt niet te doen is.

Na elke fase: de open zee hoeft niet geredeployd (niets op de draad), en het is een patch - geen
`SEA_V`, geen layout-gate, niets in `layout.json`, `config.json` of een bundle.

## Open vragen voor de keeper

1. **Samples, ja of nee?** Het plan gaat uit van alleen synthese, met fase 7 als ontsnapping. Wil je
   dat het eiland ooit opnames gebruikt, en zo ja: alleen uit je eigen map (nooit in git), of mag een
   CC0-set wél mee in de repo en de release?
2. **Hoeveel is genoeg?** Het budget hierboven is een plafond, geen doel. Hoor je liever een paar
   dingen goed (kroeg, smid, zee) of overal een beetje?
3. **Gasteilanden.** De hamers van een buureiland hoor je nu al (de crowds van gasten zitten in de
   snapshot), maar de records van een gast niet. Moeten de smid en de kroeg van een buur ook klinken
   als je daar rondloopt? Dat betekent de records van een gasteiland in de snapshot, binnen bereik.
4. **Van boven.** Moet het eiland van boven (orbit, de regisseur) ook klinken - en zo ja, zoals een
   microfoon boven het richtpunt, of juist stiller dan op de grond?
5. **De vulkaan**: dreigend (een bas die je voelt) of sfeervol (borrelen en sissen)? Op een
   laptopspeaker is alleen het tweede te horen.
6. **Onweer** kan pas als de zee er een woord voor heeft (`lib/weather.mjs`). Wil je dat als eigen
   plan?
7. **Muziek-schuif**: telt jouw eigen muziek (`HOME/audio`) onder dezelfde Music-schuif als de rave
   en de shanty, of wil je die apart?
