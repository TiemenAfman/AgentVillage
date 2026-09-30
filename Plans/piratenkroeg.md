# De piratenkroeg: "The Salty Kraken"

**🚧 Status: plan van 30 september 2026, in uitvoering.** Ontworpen in een planning-sessie (Fable 5.1);
het stap-voor-stap uitvoeringsplan met alle bestandsverwijzingen staat in
`~/.claude/plans/ik-wil-een-nieuwe-synchronous-seahorse.md` en wordt door een Opus-sessie uitgevoerd. Dit
document is het *waarom* en de besluiten. **De plek is gewijzigd** (zie "De plek: de piratenoever" hieronder):
niet meer de kadehaven zoals die nu is, maar de piratenoever van de haventrechter die de quay-sessie bouwt
(`quay-en-rivier.md`, op `fix/quay-en-rivier`, nog niet op deze branch). Daarom komt de server-kant (de trede,
het kavel, de kist) als **laatste**, na alles wat de haven niet raakt.

## Aanleiding

Het eiland heeft één taverne (`civic:tavern`, trede 15) met een klein interieur: kroegbaas, haard, een
karaoke-podium en een wc. Het schatkaarten-werk ([schatkaarten.md](schatkaarten.md)) zette er een piraat met
een zeekist naast die één quest-keten uitdeelt, en parkeerde de plaatsing van die kist "tot de nieuwe tavern
er is". Gevraagd: een **tweede, nieuwe taverne in piratenstijl** - de oude blijft zoals hij is - "een kroeg
waar de piraten zitten met quests", geen karaoke, rijk gedecoreerd, binnen veel ruimer dan de huidige tavern.
Referentiebeelden: een Trader-Sam's-achtige piratenbar (gesneden achterbar met paars/teal gloeiende nissen,
een hangende scheepsromp met kaarsen als kroonluchter, lange tafels met lantaarns, netten, balken) en de
Sea-of-Thieves-taverne (stenen haard met kaarsen op de schouw, scheepswiel erboven, een piraat leunend tegen
de muur).

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Plek | **Op de piratenoever van de haventrechter**, links van de trechter (de oever tegenover de stenen kademuur), een 3x3-kavel met de gevel op het water. De plek komt uit één eigen functie, `pirateTavernSite` in `lib/layout.mjs`, die vandaag nog de bestaande `harbourSite` → `coastSite` aanroept en die de quay-sessie later op de piratenoever richt (`havenBanks(...)` → `'pirate'`). Zie "De plek: de piratenoever". | Een havenkroeg waar de piraten aan land komen, aan de oever waar ook de werf en de grote schepen komen - niet aan de kade met de kraan en het pakhuis. Buiten blijft het één kavel: alle plaatsingscode is op 3x3 geschreven, en de ruimte zit toch binnen. |
| Wanneer | **Nieuwe trede op 52 settlers** (`MILESTONES`: vuurtoren 50, zagerij 55). | "Als het licht brandt, vinden de piraten de haven." Vroeg genoeg dat de quests er niet lang op wachten; het live eiland krijgt hem bij de eerstvolgende scan. |
| De piraat en zijn kist | **Verhuizen mee**: de kist "subtiel achter" de kroeg aan de landzijde (`chestSpots`, het afgeprinte ontwerp uit schatkaarten.md, gegeneraliseerd naar een gastheer), de piraat ervoor als uitsmijter. Onder 52 blijft de kist waar hij nu staat, naast de deurstap van de oude tavern; de starters van de zee ook. | Eén plek voor alles wat piraat is. De migratie "achter de oude tavern" vervalt: 23 % van de verse eilanden had daar geen plek. |
| Wie zit er binnen | **De bemanning**: zes piraten aan tafel (kapitein, navigator, bootsman, kanonnier, uitkijk, kok), een piratenbarkeep en één leunend bij de haard. Lokaal getekend als geïnstanceerde figuren met een nieuwe teken-anim `'sit'`; niet op de draad. | Het rave-precedent: meubilair, geen zee-figuren; geen `SEA_V`, geen redeploy. `ANIMS` op de draad verandert niet. |
| Quests | **Eén verhaal blijft** (Ideas.MD: geen klusjesgenerator). Elke piraat bezit één hoofdstuk; het `!` hangt boven wie aan de beurt is. Drie nieuwe hoofdstukken na *Bring It Home*: **A Round for the Crew** (kapitein: een grog bestellen), **The Drowned Chart** (navigator: twee vadem diep duiken), **Three Chests** (bootsman: drie dagkisten opgraven). Beloningen: de kleuren `kraken-purple`, `gold-leaf`, `captain-red`. | Nieuwe events `drank` en `dived`, een `times`-conditie op een stap, en een `with` per gever. |
| De dagkist | **Herhaalbare quests tellen parallel** met het verhaal. | Anders blokkeert een eiland zonder kroeg *Treasure of the Day* voorgoed zodra het verhaal op de bemanning wacht. `QUEST_STATE_V` blijft 1: een bestaand boekje gaat verder bij de kapitein. |
| Praten binnen | Het venster van de piraat (`web/js/pirate.js`) wordt één spreekvenster voor elke gever (`createQuestGiver`); de kamer-walk pauzeert zolang het open is; geen `faceUp` (dat is voor zee-figuren), de show draait de piraat zelf naar je toe. | Hergebruik in plaats van een tweede dialoogsysteem. |
| Muziek | **Een shanty-loop** in `sound.js`, berekend zoals de rave (6/8, ~100 BPM, A-dorisch, 16 maten, onder de 20 s): binnen luid en open, op de kade gedempt door de muur; de bemanning knikt mee op de tel. | Zoals al het geluid hier: berekend, niet opgehaald, en pas gemaakt als hij voor het eerst nodig is. |
| Exterieur | **Een hero-bake** (`assets/piratetavern/`, ≤ 4000 driehoeken, precedent het grote kasteel): een scheve tweelaagse vakwerk-haveninn met overstekende bovenverdieping, erker, boeg met kraakkop boven de deur, grote lantaarn, tonnen, meerpaal en een gebakken Jolly Roger. **Zonder `anchor.flag`.** | Op elke `anchors.flag` hangt main.js de districtsvlag; een piratenkroeg draagt zijn eigen vlag. |
| Ingang | Het E-bereik ligt op het kavelmidden (`r 2.6`), niet bij de deur. | `coastSite` legt de deurstap op het water; vanaf de kade naast het pand is het midden binnen bereik. |
| Licht binnen | **Precies zeven point lights**, zoals de tavern. | Het aantal lichten zit in de shader-key van het gebouwmateriaal: zeven hergebruikt het al gecompileerde programma, elk ander aantal is een hapering in de deuropening. |

## De plek: de piratenoever (gewijzigd 30 september 2026)

Het oorspronkelijke besluit was "aan de kadehaven", met het pakhuis en de waag. Tegelijk met dit plan gooit
de quay-sessie (`quay-en-rivier.md`, branch `fix/quay-en-rivier`) de haven om:

- de haven wordt een **trechter in de riviermonding** (`layout.works.haven`), grondwerk met profielen
  (`layout.works`);
- de **rechteroever** wordt een stenen kademuur met de kraan aan het eind en het pakhuis aan het zuideinde; het
  quay-bassin verdwijnt;
- de **linkeroever** is de *piratenoever*: daar komen de scheepswerf en de grote schepen, en - wens van de
  keeper - de Salty Kraken, links van de trechter. De quay-sessie bouwt en reserveert daar niets behalve de
  voetafdruk van het havenprofiel (de oeverhelling), die de kroeg vrij moet laten.

Wat daaruit volgt:

1. **Eén functie beslist de plek**: `pirateTavernSite(...)` in `lib/layout.mjs`. Vandaag roept hij de
   bestaande `harbourSite`/`coastSite` aan (zodat de trede nu al ergens aan het water staat en getest kan
   worden); de quay-sessie richt hem later op de piratenoever met `havenBanks(...)` → `'pirate'`.
   `harbourSite` en `coastSite` zelf veranderen hier niet.
2. **De server-kant komt als laatste en smal**: de trede, het civic-type, de lijst-entries en die ene functie.
   Vóór dat werk wordt met de quay-sessie afgestemd welke functies en regels van `lib/layout.mjs` geraakt
   worden. Alles daarbuiten (de bake, de kamer, de bemanning, de quests, de shanty, de docs) raakt de haven
   niet en wordt eerst gebouwd.
3. **Meten van de plek wacht op de quay-sessie**: de kroeg op het live eiland meten heeft pas zin als de
   trechter en de oevers er liggen. Tot dan is de plaatsing op de piratenoever het open punt van dit plan.
4. **Mergen doet de keeper**; wie als tweede merget lost de conflicten in `lib/layout.mjs` met de hand op.

## De zaal

Noord boven, deur zuid; de hal 9 x 7 (tavern 6 x 5, rave 10 x 8), plafond 1.9 (tavern 1.25). **Geen doos**:
de plattegrond is hoekerig - een unie van vier rechthoeken (de camera blijft in de dichtstbijzijnde, zoals bij
de wc van de tavern), met in- en uitspringende hoeken en twee delen onder een laag plafond. Eén samengevoegde
mesh plus een los dak (dat weg mag als de camera erdoorheen moet), een pulserend vuur, en de `show` voor wat
beweegt.

- **Noord: de bar.** Lange toog met koperen voetrail, een keg met kraan erop, vijf krukken. Erachter een hoge
  achterbar met **drie boognissen** die paars en teal gloeien, vol flessen, in de middelste een schedel met
  een kroon, een scheepje-in-een-fles, een open juwelenkistje, een hangende olielamp. Old Meg tapt (loopt langs
  de toog naar wie bestelt). Om het westeind van de toog heen loop je door een stenen boog de
  **rumkelder-nis** in: laag tongewelf, een rek met **zes kegs** in een piramide, een vat met kraan, een lantaarn,
  en achter een ijzeren tralie een **open schatkist** met goud dat eroverheen stroomt en munten op de vloer.
- **West: de haard.** Grote stenen schouw met vijf kaarsen op de schouwbalk, een scheepswiel erboven, een
  jewelled cutlass en een flintlock aan de muur, houtstapel, kleed, rood gordijn. One-Eyed Finn leunt ernaast.
- **Oost: de kapiteinserker.** Een uitgebouwde erker met het ronde roedenvenster, een verhoging van hele
  cellen met reling, een kaartentafel met zeekaart, kompas, zilveren kandelaar en gouden goblets, de gesneden
  stoel van de kapitein met een **goudhoop** ernaast, een wereldbol met een parelsnoer eroverheen. Geen
  microfoon, geen scherm.
- **Zuidwest: de snug.** Een lage hoek achter een halfmuur: het kanon op de deur gericht, **twee kegs als
  krukken** om een kegtafeltje, een zak dubloenen, een kratje flessen.
- **Midden: drie schraagtafels** met banken, kaarsen in flessen, kroezen, dobbelstenen, een oesterschelp met
  parel. Hier zit de bemanning; wie er niet zit is een vrije bank voor de speler.
- **Plafond:** zware balken, een **hangende sloep als kroonluchter** met druipkaarsen, lantaarns aan
  kettingen; laag en gewelfd boven de kelder-nis, laag met balken boven de snug.
- **Muren en hoeken:** teerplanken met pleister erboven, twee visnetten met glazen vlotters, touwrollen,
  patrijspoorten, een roedenraam, een "WANTED"-bord, de zeekist, tonnen en kratten (bestaande props via
  `meshAsset`). Goud glimt door de lantaarns, niet door emissive; alleen edelstenen mogen gloeien.

## De bemanning

| id | Naam | Zit | Hoofdstuk |
|---|---|---|---|
| `captain` | **Captain Spack Jarrow** | aan de kaartentafel op de erker | *A Round for the Crew* |
| `navigator` | Quill | kruk aan de kaartentafel | *The Drowned Chart* |
| `bosun` | Bosun Tarr | tafel 1, noordbank | *Three Chests* |
| `lookout` | Sparrow | tafel 1, zuidbank | sfeer |
| `gunner` | Powder Annie | tafel 2 | sfeer |
| `cook` | Salt Pete | tafel 3 | sfeer |
| (buiten) `pirate` | The pirate, bij zijn kist | voor de deur | *The First Dig*, *Bring It Home* (bestaand) |

Namen en sfeerregels zijn data in `shared/quests.mjs` (`CREW`); looks en stoelen staan bij de kamer. Hoeden
alleen uit `HAT_SHAPES` (`wide` leest als tricorn, `band` als bandana): die lijst en `SWATCHES` blijven
onaangeraakt, want de hele bevolking trekt eruit.

**De kapitein is een eigen model, en hij blijft zoals hij is.** Uit drie aangeleverde kandidaten koos Martijn
het getextureerde low-poly GLB (10.247 driehoeken, vier ingebedde textures, statisch, al in een sta-pose) - niet
decimeren en niet naar vlakke vertex-kleuren omzetten, want "de rest wordt rommelig" (gemeten met renders naast
elkaar op 30 september). Een textured mesh kan niet door de bake, dus hij gaat de ene route die het project
daarvoor heeft: opgehaald zoals de lava-imp (`web/js/imp.js`) - `web/models/spack-jarrow.glb`, pas geladen bij
de eerste stap de kroeg in, nooit bij boot, één keer, een mislukte load één keer gemeld en niets dat erop
wacht; tot hij er is staat een gewone bemanningsfiguur op zijn plek. 0.55 hoog, op de erker naast de
kaartentafel, draait naar je toe als je hem aanspreekt; dezelfde spreek-interactable als de rest van de
bemanning. Niets aan het model veranderd: zijn ogen (losse oogbol-meshes onder een kohl-schaduw) leken van
veraf dicht, maar de originele stand is goedgekeurd. Zie Risico's over de herkomst.

## Ontwerpvraag voor Fable: het interieur als bake (30 september 2026)

**Status: open, voor een Fable-sessie.** De zaal hierboven is gebouwd zoals het plan zei, uit JS-primitieven in
`web/js/pirate-tavern.js` (commit `6787b64` op `claude/salty-kraken`), en de keeper keurde hem af: *"het is
allemaal te cheap"*. Zijn punten, letterlijk en uitgelegd:

- **"Veel pleistermuur, dat is niet pirate-y."** De muren zijn geteerde planken tot de heup en oker pleister
  erboven; dat is de dorpstavern. Een piratenkroeg is hout: scheepsplanken, spanten, balken, touw.
- **"De schedel aan de bar is echt een armatuur, geen muur."** In de referentie (Trader Sam's) is de schedel een
  lamp, hangend of als wandlamp, met licht in de oogkassen. Nu is het een bolletje met een kroontje in een nis.
- **"Ik mis treasure en alles."** De schat zit achter tralies in de kelder en op de erker; in de zaal zelf, waar
  je binnenkomt, ligt bijna niets. Het moet overal liggen: kisten die openstaan met goud dat eroverheen stroomt,
  hopen munten, kroezen en kandelaars van goud, juwelen.
- En wat de screenshot van de achterbar liet zien: de achterbar is één doos van 3,6 breed; de nissen zijn platte,
  fel gloeiende rechthoeken (ze lezen als schermpjes) met piepkleine dingen erin; de toog is een kale plank;
  krukken en lantaarns zijn dunne cilinders.

**Waarom het zo uitpakte:** primitieven zonder bevels, zeszijdige cilinders en gloeivlakken zijn het plafond van
wat JS-dozen kunnen. Het exterieur (`scripts/build-piratetavern.py`) ziet er wél goed uit, omdat Blender echte
vormen, bevels en detail geeft.

**De vraag aan Fable:** ontwerp de aankleding van de zaal opnieuw, als bake, en laat de keeper renders goedkeuren
voordat er iets de kamer in gaat. Denk aan:

1. **Een eigen hero-set** voor het interieur (bijvoorbeeld `assets/piratetavern_room/`, asset `piratetavern_room`,
   `scripts/build-piratetavern-room.py`), met een eigen budget in `HERO_BUDGETS` (`scripts/model-rules.mjs`; de
   Batavia heeft 8000, het piratenschip 30000). Wat groot is en vaststaat - muren, achterbar, toog, haard,
   plafond, trappen van het dek - mag één set zijn, zolang de kamer dezelfde plattegrond houdt.
2. **Wat erin moet**, uit de referenties en de punten hierboven: scheepsplanken met spanten en zware balken in
   plaats van pleister; een gesneden achterbar met echte boognissen (diepte, een gewelfde bovenkant, flessen op
   planken, een zachte gloed ín de nis in plaats van een gloeiend vlak); een schedellamp (hangend boven de toog,
   en/of twee wandlampen) met een kaars en gloeiende oogkassen; open schatkisten met goud dat eroverheen stroomt
   (minstens één die je ziet als je binnenkomt), goudhopen, munten op toog en tafels, gouden kroezen en
   kandelaars, juwelen; een stoere toog met een koperen voetrail en panelen; tonnen en kegs; netten, touw, een
   anker, gekruiste sabels, een scheepswiel; de hangende sloep als kroonluchter.
3. **De spelregels die blijven** (die liggen vast in de kamerdata en de tests, `tests/pirate-tavern-room.test.mjs`):
   precies **zeven PointLights** (de shader-key van het gebouwmateriaal); niets **breder dan een hand** gloeit
   vol (`INDOOR_GLOW`: vlakken ≤ 0.65, vlammen 1), goud glimt door de lampen, alleen edelstenen gloeien; de
   stoelen, blockers, `areas`, het dek (hele cellen), de `talkers` en de bemanningsshow (`'sit'`, Spack Jarrow,
   het `!`) blijven data in `pirate-tavern.js`. Alleen `parts` en `roof` (wat getekend wordt) gaan naar de bake.
   Blockers blijven met de hand gegeven, niet afgemeten (de reden staat in de kop van `interior.js`).
4. **De schaal**: een settler is 0.45, tafels 0.2 hoog, banken 0.135, krukken 0.19, plafond 1.9 (kelder 1.2,
   snug 1.25). Zie "De zaal" en de plattegrond in het uitvoeringsplan.
5. **Het proces**: renders naast de referentiebeelden, de keeper kiest, dan pas bakken en koppelen. De koppeling
   zelf (bake importeren in `models.js`, `meshAsset` in `buildPirateTavern`, tests) mag een Opus-sessie doen.

Ondertussen gaan de quests (fase D), de shanty (E) en de docs door; die hangen niet van het uiterlijk af.

## Fasen

Bewust in deze volgorde, want alleen de server-kant raakt de haven (zie "De plek"):

0. Dit document; `Plans/README.md`.
1. **Bake**: `scripts/build-piratetavern.py`, `web/js/piratetavern-mesh.js`, `buildings.js`, `/demo`.
2. **Kamer en bemanning**: `web/js/pirate-tavern.js`, `'sit'` in `settler-figures.js`, haken in `interior.js`,
   Captain Spack Jarrow (`web/js/captain.js`).
3. **Quests en spreken**: `shared/quests.mjs`, `quest-log.js`, `pirate.js` → `createQuestGiver`, main.js.
4. **Shanty**: `sound.js`, `shantyHeard()` in main.js.
5. **Docs** (wat niet over de plek gaat): `docs/manual.md`, CLAUDE.md.
6. **Server, als laatste**: trede 52, `civic:piratetavern` met de plek uit `pirateTavernSite`, `chestSpots` +
   gastheer-regel, éénmalige migratie van de kist, tests (`tests/pirate-tavern-layout.test.mjs`). Een nieuw
   plot in `layout.json`: een **minor**. Afgestemd met de quay-sessie; het richten op de piratenoever doet die
   sessie.

## Risico's

- **Het live eiland**: heeft de piratenoever (of, zolang die er niet is, de kadehaven) geen vrij waterfront-3x3
  met een weg aan de deur, dan blijft de kroeg `unplaced` (het pakhuis-risico van 28-29 september). Meten op
  een kopie van `~/.promptholm`, en pas als de quay-sessie klaar is.
- **Twee sessies in `lib/layout.mjs`**: de quay-sessie schrijft de haven om. De kroeg raakt daar alleen de
  lijsten, de trede en `pirateTavernSite`; `harbourSite`, `coastSite` en de haven-functies blijven onaangeraakt.
- **Geen kist-spot bij de kroeg** (alle ringcellen weg, pier, water of steil): de kist blijft bij de oude
  tavern en het blok probeert elke scan opnieuw.
- **Duikdiepte twee** ligt in open zee (bodem −2.5, geulen tot −3.5) - vanaf de haven kan dat een eind zwemmen zijn.
- **De shanty onder 20 s** houden: de geluidstest kent de rave-buffer aan zijn duur.
- **De kapitein**: een Disney-likeness van onbekende herkomst die als GLB in de publieke repo komt, zoals
  `hostile-settler.glb` - Martijns keuze. Het tweede opgehaalde model naast de imp: de imp-regels (niets bij
  boot, één keer, falen één keer gemeld, niets wacht) gelden onverkort. Vijf draw calls in één kamer.

## Later, niet nu

- Ooglap, haak, houten been en papegaai voor de bemanning zodra de catalogus (`shared/equipment.mjs`) ze tekent.
- Een kaartspel of dobbelspel aan tafel; de dagkist bij de bootsman kopen voor munten.
- Een bovenverdieping die je op kunt (een trap is voor walk mode nog geen dek).
