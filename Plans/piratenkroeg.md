# De piratenkroeg: "The Salty Kraken"

**🚧 Status: plan van 30 september 2026; gebouwd op `claude/salty-kraken`, twee punten open (zie "Stand van zaken").** Ontworpen in een planning-sessie (Fable 5.1);
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

## Stand van zaken (30 september 2026)

Gebouwd op `claude/salty-kraken` (niet gepusht; mergen doet de keeper):

- **Exterieur**: de hero-bake (`scripts/build-piratetavern.py`, 3838 van 4000 driehoeken met de arm van het bord),
  zonder `anchor.flag`, met `anchor.sign` waar het schommelende uithangbord van `feat/piratesign` aan hangt.
- **Kamer en bemanning**: `ROOMS.piratetavern` (`web/js/pirate-tavern.js`), zeven lampen, de bemanning zittend
  (`'sit'`, alleen tekenkant), Captain Spack Jarrow als opgehaald GLB (`web/js/captain.js`).
- **Quests**: de drie hoofdstukken, herhaalbare quests parallel, één spreekvenster voor elke gever.
- **Muziek**: een berekende jukebox (de eigen jig, *Drunken Sailor*, *Wellerman*, instrumentaal; de melodieën zijn
  traditioneel, de arrangementen eigen werk). *Bosun Bill* en *Grogg Mayles* uit Sea of Thieves zijn composities van
  Rare en mogen er niet in. Daarom de **eigen muziek van de keeper**: `~/.promptholm/audio/{kroeg,rave,pirates}`
  speelt hele nummers na elkaar af, alleen op de eigen pagina (`lib/music.mjs`), en komt nooit in de repo.
- **Server**: trede 52, `civic:piratetavern` uit `pirateTavernSite` (vandaag `harbourSite`), de kist die één keer
  naar achter de kroeg verhuist. Gemeten op een kopie van het live eiland: kroeg op (143,63), kist van (183,176)
  naar (143,66), verder beweegt niets, de tweede scan is byte-identiek.

Open:

1. **Het interieur** als bake: de ontwerpvraag hieronder, voor Fable.
2. **De plek op de piratenoever**: de quay-sessie richt `pirateTavernSite` daarop bij het mergen van
   `fix/quay-en-rivier`, met een regel die het kavel afleidt (het vrije waterfront-3x3 op de piratenoever met een
   weg, het dichtst bij de haven; op Hoogezand (136,282), dat de keeper goed vindt), geen vaste cel.
3. Klein: de *Wellerman* is uit het hoofd uitgeschreven; een foute noot is een regel in `TUNES` (`web/js/sound.js`).
   De keeper vond de berekende muziek dof; wie eigen nummers heeft, zet ze in de map.

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
   anker, gekruiste sabels, een scheepswiel; de hangende sloep als kroonluchter; en - idee van de keeper - een
   **piratenjukebox** als voorwerp in de zaal, waar de muziek (de berekende jukebox of de eigen nummers uit
   `~/.promptholm/audio/pirates`) zichtbaar uit komt.
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

### Eerste bake en bijsturing (30 september 2026)

`scripts/build-piratetavern-room.py` bakte de zaal als set `piratetavern_room` (82k driehoeken, nog niet
gekoppeld): scheepsplanken met spanten, de achterbar met drie boognissen, schedellampen, schat, jukebox. De
keeper, met zes referentiebeelden (piratenhol in een grot, een scheepsinterieur met trappen en bruggen, een
schatkamer vol kisten): *"een grote kale vierkante ruimte"*. Een schuilplaats is planken, touw, schedels,
kisten, tonnen - en ladders, trappen en hoogteverschil.

Besluiten:

| Vraag | Besluit | Waarom |
|---|---|---|
| Stijl | **Een kroeg in een grot**: rots achter de bar en langs de haard, overhangend als plafond boven het noordelijke deel; het hout (balken, galerijen, erker, deurwand) is erin gebouwd. | Vier van de zes referenties; en de rots breekt de doos op zonder de plattegrond te veranderen. |
| Hoogte | **Twee galerijen als decor**: een balkon boven de kelderingang met een trap langs de westwand, en een galerij in de zuidoosthoek met een ladder (de jukebox in de nis eronder). Nog niet beloopbaar. | Walk mode kent één verhoging van hele cellen; een trap is nog geen dek. Beloopbaar maken is een aparte stap. |
| Vol | Stapels kisten en tonnen langs de wanden, touw en zeildoek tussen de balken, kaarsen met dikke druipers, goud als een laag over de vloer in plaats van losse munten. | De zaal was 9 bij 7 voor settlers van 0.45 en stond netjes tegen de muren. |
| Licht | Nog steeds zeven lampen, één koel (maanlicht door het ronde raam) tegen de warme. | Het contrast warm-kaars tegen koel-water in de referenties. |
| Budget | ~~Terug naar orde 40k.~~ **Geen beperking** (keeper, later die dag): de kamer is alleen geladen als je binnen bent, en het ontwerp mag er niet door worden ingeperkt. Plafond per kitstuk 40000 (`model-rules.mjs`) als vangnet tegen een op hol geslagen bake. | Detail is wat de referenties beloven. |
| Scheepsdelen | **Herkenbare stukken schip als meubilair**, elk een eigen object in `scripts/krakenkit/` (set `krakenkit`, assets `civic_kraken_*`, budget 6000 per stuk): het hek als achterbar, een mast met ra en kraaiennest, de toog als stuk romp, tonkrukken. De keeper maakt per object een 2D-referentieblad (voor- en zijaanzicht) met een beeldmodel; elk wordt los gebouwd en gerenderd (`scripts/preview-krakenkit.py`) en daarna samen gebakken (`scripts/build-krakenkit.py`). | Een schip binnen zegt meteen "piraten" en breekt de doos beter dan rotsbulten; los per stuk kan het parallel en per stuk worden goedgekeurd. |
| Rotspilaren | **Geschrapt.** | De camera (`clampCam` in interior.js) houdt alleen de rechthoek van de zaal aan, niet wat erin staat: een pilaar tussen camera en speler verbergt de speler. Hoogte komt van boven het hoofd. |
| Kogelinslag | **Twee**: een kanonskogel vast in een wand met stervormige barsten (op de houten zuidwand of in de rots), en een doorgeslagen gat in de muur naast de kelderingang waardoor je een glimp van de kelder ziet. Deel van de kamer, geen los object. | Een klein verhaal in de muur; referentie van de keeper (een kogel in de pleister achter een gat in de steen). |

### Referenties, prompts en de stand van de kit

**Beelden** staan buiten git in `D:\git\Martijn\AgentVillage\refs\krakenkit\` (lokaal, `/refs/` staat in
`.git/info/exclude`; er zitten foto's van anderen tussen, die horen niet in de publieke repo): `sfeer/` (de
piratenholen en grotten, de schatkamer, Trader Sam's achterbar als scheepshek, een toog met tonkrukken, de
kogelinslag met doorkijkgat), `objecten/` (de 2D-referentiebladen per object) en `renders/` (de eerste 82k-bake
met zijn `.blend` en script, de schets van de grotkroeg). Nog niet op schijf, want midden in een beurt geplakt:
de referentiebladen van het **hek**, de **mast** en de **kanonpoort** - die moet de keeper nog in `objecten/`
zetten.

**Prompts** voor een referentieblad (het stijlblok gaat voor elke objectprompt; maten in meters, een settler is
1,8 m):

> Game asset reference sheet: the same object shown twice side by side, left an orthographic FRONT view, right
> an orthographic SIDE view, no perspective, same scale, aligned on one ground line. Stylized low-poly, flat
> shaded, chunky simple shapes with small bevels, no fine texture or grain, clear silhouette. Dark oak and tarred
> wood, brass and gold trim, iron fittings. Even flat lighting, plain neutral grey background. No people, no
> text, no letters, no watermark.

Minder cartoon: *"No outlines, no cel shading. Rendered as a 3D stylized low-poly game model with realistic
proportions, weathered and slightly crooked wood, muted colours."* De objectprompts zelf (hek, mast, toog,
tonkruk, kanonpoort, boegbeeld, trap met reling, lantaarn, schedellamp, open schatkist, jukebox) beschrijven
wat erop moet en de maat; de uitgewerkte versies staan in de sessie van 30 september.

**De kit** (`scripts/krakenkit/<object>.py`, stand 30 september 's avonds). Vaste stukken zijn een asset die
pirate-tavern.js op `KIT` in de layout zet; stukken met een wisselende maat zijn functies die de zaal (`shell.py`,
`dressing.py`) aanroept, met een voorbeeldasset voor de preview:

| Object | Asset / functie | Stand |
|---|---|---|
| Hek als achterbar | `civic_kraken_stern` | 5788; detailronde nog te doen |
| Mast met ra en kraaiennest | `civic_kraken_mast` | 18438, 5 hoog tot in de nok |
| Toog als stuk romp | `civic_kraken_counter` | 12262 |
| Tonkruk, kanonpoort, boegbeeld, schedellampen, jukebox | `_stool`, `_gunport`, `_figurehead`, `_skulllamp`, `_skullsconce`, `_jukebox` | gebouwd |
| Kaarsensloep (kroonluchter) | `civic_kraken_sloop` | 12260; hangt twee keer boven de kuil |
| Gebroken boeg | `civic_kraken_bow` | 14124; op 0,8 uit de noordgevel, boegbeeld op de steven, schedellamp aan zijn voet |
| Stuurwiel-kroon | `civic_kraken_wheel` | 14402; plat boven de kuil |
| Roer als uithangbord | `civic_kraken_rudder` | 5602; boven de voorkant van de bar |
| Luiktafel | `hatch.hatch_top()`, `civic_kraken_hatch` | op de zes tafels (~4500 per blad, de helft het touw) |
| Galerijdek | `deck.deck_section()`, `deck.stump_post()` | gebouwd, **nog niet in shell.py** |
| Loopplank en touwbrug | `walkway.gangplank()`, `walkway.rope_bridge()` | gebouwd, **nog niet in shell.py** |
| Spant en ribben | `frames.truss()`, `frames.rib()`, `frames.rib_arch()` | gebouwd, **nog niet in shell.py** |

Een kitstuk begint op y = 0 bij zijn laagste punt; waar de zaal iets aan vastmaakt (vlammen, ketting, balk) staat als
constante in de module (`FLAME_Y`, `RING_TOP`, `BEAM_Y` ...) en, waar JS het nodig heeft, nog eens in `KIT` in de
layout. De zaal zit op **391k van de 400k** driehoeken (`HERO_BUDGETS`); de galerijen, trappen en het dak uit de kit
kosten meer dan de huidige van de schil, dus bij het inbouwen moet er elders iets af (het touw van de luiktafels is
2250 per tafel) of het budget omhoog, en de module is al 47 MB.

**Licht** (30 september, naar het advies van de keeper: "donkere, filmische piratenkroeg bij nacht", niet feller
maar in lagen). Het lichtplan staat in `LIGHTS` in de layout: warm en laag bij de sloepen, de haard (de sterkste,
roodst, flikkert), de schedellamp en de kapitein; het paars van de nissen als brandpunt achterin; de maan hoog boven
het atrium met een zachte afval (decay 1) plus een koele hemisphere als fill van boven; de hoeken buiten elk bereik.
Bloom en god rays zitten in three.js, niet in de bake (`web/js/room-glow.js`): een halo rond elk gloeiend deel, uit
de geometrie zelf gelezen, en bundels maanlicht onder de dakramen (`SKYLIGHTS`, `SHAFTS`). Additief en zonder eigen
licht, dus het programma en de zeven lampen blijven zoals ze zijn. Echte bloom (UnrealBloomPass) zou postprocessing
vendoren en een tweede renderpad naast het eiland vragen. Met de keeper live bijgesteld in de DevTools-Chrome.

**Het haardvuur** (30 september, gevonden door de keeper in Tahsin Önemli's *Tarnished House*): geen twee kegels
meer maar `web/js/hearth-fire.js` - een vlam die per pixel door ruis in een doos wordt geray-marcht, gloeiende
sintels op de vuurbodem, vonken die de schoorsteen in gaan en twee halo's, allemaal additief en zonder eigen licht;
de haardlamp (`hearth: true` in `LIGHTS`) flikkert mee op het ritme van het vuur. Maten in `HEARTH_FIRE`. Tarnished
House is GPL-3.0, dus daar is niets uit overgenomen: de vlam is een port van het MIT-origineel waar die van hen op
gebaseerd is (mattatz' THREE.Fire), met een eigen profiel - het MIT-plaatje is een traan op zijn punt en las in de
haard als een zwevende bal - en een verschoven startpunt per pixel tegen de strepen van vaste stappen. Hun model
(een Dark Souls-kampvuur, CC-BY maar het ontwerp van FromSoftware) komt niet in git.

**De referenties van de tweede ronde** staan in `objecten/` onder hun eigen naam (`sloep-kroonluchter`, `boeg`,
`galerijdek` met twee alternatieven, `loopplank`, `stuurwiel-kroon`, `roer`, `spant`, `luiktafel`, `touwbrug`,
`ribben`). Nieuwe beelden maakt Claude voortaan zelf met FLUX op de 4090 (`/blenderai`, `python -m blendai imagine
"..." --style raw --batch 4`); de prompts beginnen met "Stylized game prop art:", vragen een driekwart- en een
zijaanzicht naast elkaar (een vooraanzicht lukt de generator slecht) en de stijlregel tegen cartoon.

**Groter, als cascade rond een atrium** (30 september, later): de keeper vond de zaal van 9 x 7 met twee verdiepingen
boven elkaar te klein en te laag, en wees op het richtpunt: dat is geen stapel verdiepingen maar een **cascade van
terrassen rond een open midden**. Besluiten: een grot van **18 x 14** onder een **rotsgewelf van 5**; de kuil
(+0,6) als atrium met zes tafels, twee sloepen als kroonluchter en de mast in het midden; het barterras (+1,5) met als
voorkant de zijkant van een scheepsromp naar de kuil; het kapiteinsdek (+2,1) boven het ruim in het oosten; een
uitkijk en een galerij op de rots (+3,0); twee touwbruggen over het atrium naar het kraaiennest; de grond (0) als
laagste terras met de kelder, de haard, het kanon, de deur en het bassin. Niets lager dan de grond (walk mode leest
alles onder 0,06 als water). "Een mooi ruim beeld dat niet veel decoratie per niveau vergt": minder props, met
bedoeling geplaatst. De maten staan in `web/js/kraken-layout.js`; schets 6 in de refs.

**Tweede ronde referentiebladen** (30 september, voor de zaal met verdiepingen): tot er een tekening is, staat er een
eenvoudige plaatshouder van de juiste maat, elk in een eigen functie in `scripts/krakenroom/shell.py` of `dressing.py`,
zodat hij los vervangen kan worden. Bestandsnamen in `refs\krakenkit\objecten\`: `sloep` (kroonluchter),
`schatkist`, `kanon`, `scheepstrap`, `haard`, `rotsboog`, `kapiteinsstoel`, `kaartentafel`, `globe`, `telescoop`,
`hangmat`, `anker`, `jolly-roger`, `stuurwiel`, `touwbrug`, `deur`. De prompts staan in de sessie van 30 september;
ze gebruiken het stijlblok hierboven plus de regel tegen cartoon.

**Nog in de kamer te verwerken** (uit de gesprekken): de grotkroeg van schets 2 (rots noord en west, rotsplafond
over het noorden, bassin met steiger en roeiboot in het zuidoosten met maanlicht door een rotsboog, galerij
boven het water, balkon met trap boven de kelder, jukebox tussen de zuidramen), de kogelinslag en het
doorkijkgat, een L-vormige toog als die de zaal beter breekt, stapels kisten en tonnen, touw en zeildoek, kaarsen
met dikke druipers, goud als een laag op de vloer.

**Het uiterlijk**: meer vorm (budget per kitstuk 15000) en schaduw in de vertexkleuren (`geom.bake_ao`, ambient
occlusion uit Cycles). De Blender-previews tonen de plankstructuur van het eiland niet, dus het oordeel valt in
het spel. Is het daar te kaal, dan is de volgende stap texturen (een GLB zoals de kapitein, met een eigen
materiaal onder de zeven lampen) - meer werk en een risico op stijlbreuk met de rest van het eiland.

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
