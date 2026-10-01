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
| Exterieur | ~~Een scheve vakwerk-haveninn van ≤ 4000 driehoeken.~~ **Render 17 letterlijk: een galjoen dat heel op een rots staat, met krakenarmen**, ~72k driehoeken, op een kavel van **5 x 3** (zie "Het exterieur"). **Zonder `anchor.flag`.** | Pleister is niet piraterig, en het interieur werd een kroeg uit scheepsdelen; op elke `anchors.flag` hangt main.js de districtsvlag, en een piratenkroeg draagt zijn eigen vlag. |
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

- **Exterieur**: het gestrande galjoen van render 17 (`scripts/build-piratetavern.py`, 71.615 driehoeken), zonder
  `anchor.flag`, met `anchor.sign` op het achterkasteel waar het schommelende uithangbord van `feat/piratesign`
  aan hangt. Op `claude/salty-kraken-exterieur`; wacht op het kavel van 5 x 3 (zie "Het exterieur").
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
3. **Het kavel van 5 x 3** voor het nieuwe exterieur, aan de serverkant (zie "Het exterieur", opdracht).
4. Klein: de *Wellerman* is uit het hoofd uitgeschreven; een foute noot is een regel in `TUNES` (`web/js/sound.js`).
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
| Kaarsenton (`kaarsen-druipers`) | SD `civic_kraken_candlebarrel`, HD `HOME/hd/candlebarrel.glb` | SD met de hand, 17182, via `kit()` in de kuil tegen de barwand (`KIT.candlebarrel`); de plas loopt uit tot de omtrek van de HD (pascontrole `shared/hdfit.mjs`). HD: Pixal3D 48k met eigen textuur, gemaakt met `/kitstuk` (voorkant 90°, schedels goud, acht vlammen) |
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
De vulling eronder is een kitstuk, `scripts/krakenkit/firebasket.py` (`civic_kraken_firebasket`, ~3100
driehoeken): een smeedijzeren vuurkorf op vier palen met messing knoppen en gekrulde voeten, drie
kruislings verkoolde eiken blokken met gloeiende haarscheurtjes, en as met snippers, houtskool en
gloeiende kooltjes - naar de FLUX-referentie `refs/krakenkit/objecten/haard/haardvulling-flux-15-4palen-messing.png`
(gekozen uit zestien, het hout op verzoek donkerder). De haardijzers en blokken in `dressing.py hearth()`
zijn eruit.

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
zodat hij los vervangen kan worden. De referenties zijn op 30 september 's avonds gemaakt met `/perchance`
(studio-render in plaats van concept art: driekwart van iets boven, echte materialen, effen grijs, cartoon en
contourlijnen in de negatieve prompt; de klikpagina's met de exacte prompts staan als `_renders*.html` naast de
beelden). Alles in `refs\krakenkit\objecten\`; `-alt` is een tweede keuze die de keeper ook goed vond:

| Beeld | Plaatshouder | Wat we eruit halen |
|---|---|---|
| `schatkist` (+`-alt`) | `ph_chest_open` | bolle deksel met rood fluweel, ijzeren banden, munten over de voorrand |
| `goudbult`, `goudbult-hoog` | `hoard`, `k_hoard*` (`geom.heap`) | losse, scheef liggende munten in terrassen met een rafelige rand en uitloop over de planken, in plaats van één gladde klomp; de hoge als schat voor het midden (kegel met kroon, een kist weggezakt in de voet), zonder de kaarsen die de generator erin zette en minder strak dan zijn muntkolommen. De edelstenen blijven zoals ze zijn |
| `kanon` | `ph_cannon` | loop met ringen, kogels, touwwerk; het onderstel is een veldkanon, bij het bouwen de lage scheepsaffuit op vier kleine schijven houden |
| `kaartentafel` (+`-alt`) | `ph_chart_table` | gedraaide poten met regel, kaart, kompas, zandloper; `-alt` heeft een ijzeren rand om het blad |
| `kapiteinsstoel` (+`-alt`) | `ph_captain_chair` | troon met schedel en rood fluweel; `-alt` is lichter |
| `globe` | `ph_globe` | meridiaan- en horizonring op een gedraaide voet |
| `telescoop` | `ph_telescope` | houten buis met messing ringen op een driepoot |
| `roeiboot` (+`-alt`) | `ph_rowboat` | overnaadse romp met blauwgroene band, riemen, lantaarn op de steven, landvast |
| `hangmat` | `ph_hammock` | doek tussen twee spreidhouten, waaier van lijnen naar een ring |
| `stuurwiel` | `ph_wheel` | acht spaken met handvatten, messing naaf; zonder de voet, het hangt aan de schoorsteen |
| `anker` (+`-alt`) | `ph_anchor` | beide zijn goed zoals ze zijn, ook de korte schacht: rechtop aan de muur, liggend met touw op de vloer |
| `jolly-roger` | `ph_jolly_roger` | gerafelde losse lap aan een stokje (de eerste pogingen spijkerden hem steeds op een plank) |
| `scheepstrap` | `shell.ships_ladder` | steile trap met ijzeren beslag; de tweede leuning zelf toevoegen |
| `rotsboog` | `shell.sea_arch` | brokkelige rots met mos aan de voet, lantaarn aan een ketting |
| `deur` | `shell.door`, `door_leaf` | eiken planken onder een boog, hengsels, kijkluikje, trekring, stenen omlijsting |
| `haard/` | `shell.hearth`, `dressing.hearth` | FLUX-varianten van de vulling; afgerond in een eigen sessie |
| `sloep-kroonluchter`, `touwbrug` | kit (`sloop.py`, `walkway.py`) | uit de eerste ronde, al gebouwd |

`hangmat-afgekeurd` en `scheepstrap-afgekeurd` zijn de mislukte eerste pogingen, bewaard als voorbeeld van wat er
fout ging.

**Nog in de kamer te verwerken** (uit de gesprekken): de grotkroeg van schets 2 (rots noord en west, rotsplafond
over het noorden, bassin met steiger en roeiboot in het zuidoosten met maanlicht door een rotsboog, galerij
boven het water, balkon met trap boven de kelder, jukebox tussen de zuidramen), de kogelinslag en het
doorkijkgat, een L-vormige toog als die de zaal beter breekt, stapels kisten en tonnen, touw en zeildoek, kaarsen
met dikke druipers, goud als een laag op de vloer.

**Het uiterlijk**: meer vorm (budget per kitstuk 15000) en schaduw in de vertexkleuren (`geom.bake_ao`, ambient
occlusion uit Cycles). De Blender-previews tonen de plankstructuur van het eiland niet, dus het oordeel valt in
het spel. Is het daar te kaal, dan is de volgende stap texturen (een GLB zoals de kapitein, met een eigen
materiaal onder de zeven lampen) - meer werk en een risico op stijlbreuk met de rest van het eiland.

## The HD pack: textured kit pieces beside the bake (1 October 2026)

**🚧 The game's side is built on `claude/hd-pakket` (from `main` 3c95ae5), not committed; the pack's own
repository is not set up yet, and the skill that makes a piece end to end is planned here, not built.**
Written in English at the keeper's asking; it was a plan of its own (`hd-pakket.md`) until he folded it into
this one.

### Why

The game keeps its hand-made low-poly bakes (`scripts/krakenkit/*.py` -> `web/js/krakenkit-mesh.js`: small,
in git, vertex colours, the sheets, baked AO). For the bigger pieces Pixal3D (through Modly,
`D:\git\Martijn\BlenderAI`, skill `/blenderai`) makes textured models that hold what a bake cannot - the
barrel of candles was the case: 48k triangles and one 2048 texture kept the staves, eye sockets and runs of
wax that neither a hand-built piece nor the same mesh in corner colours could. Such models are big (the
barrel: 9.7 MB) and not the house style, so they go **in a git of their own** - the main repository stays
fast and the installers stay small, the Windows zip and the APK alike - and reach a player as an optional
pack in `HOME/hd/`. Without it, on the phone, for a visitor, and whenever one piece goes wrong, every room
is exactly the bake.

### Decisions

**The keeper's answers (1 October).** The 4090 PC *is* the development PC, this laptop: the whole chain runs
here. The pack lives in a git of its own, which is **not set up yet** - and whether it keeps its GLBs in
Git LFS or as release assets of that repository is still open (variants below). **No budgets**: an HD piece
has no triangle, material or texture limit; the keeper tweaks each one himself, and the test only reports
what a piece costs. The SD base of the barrel (which of the two hand-built versions) is still to choose.

**1. Forced SD - Auto - Forced HD** (built). A fifth graphics setting, `detail`, in
`web/js/graphics-settings.js` (`GRAPHICS_CHOICES`, `clampGraphic` answers the word or null), remembered per
browser in `promptholm.graphics.v3` only when chosen, written only through `onGraphicsSetting`, every tier
starting on `'auto'`. `hdWanted(detail, tier, { deviceMemory })`: `'sd'` never, `'hd'` always (on `modest`
too), `'auto'` on a `full` machine that does not say it has under 8 GB (`navigator.deviceMemory`; WebGL has
no honest VRAM figure, and the renderer string is already the tier). Settings -> Graphics shows three chips
under the sliders and which pack is installed; not in the app. Forced HD with no pack is the bake, said once
per page.

**A switch is live.** A room is built once and kept, and its still parts are one merged mesh. So a kit
piece the pack lists **leaves the merge** (`pirate-tavern.js` `kit()` -> `def.pieces`) and is drawn as its
own mesh with its own halos; its HD model, once landed, is a sibling (`createHdPieces` in
`web/js/hd-pieces.js`, used by `interior.js`). Switching is visibility on the two and their halos
(`inside.setDetail`, from `applyGraphics('detail')` for every built room). A piece on the lid hangs in a
group that is shown and hidden with the lid. With no pack the room is exactly what it was. The manifest
(`GET /api/hd`) is asked for once after the boot, beside the imp; a room built before it arrives is all bake
until the next page load.

**2. The contract with the bake** (built). An HD model replaces one baked asset at every place it stands
(seven stools are seven copies of one geometry). It must stand in the bake's frame: foot on y = 0, front to
+z, the same outline within `HD_FIT` - 3 cm or a tenth of the extent per face (`shared/hdfit.mjs`), because
the KIT spot, the blockers and the camera's boom are all fitted to the bake. It brings no light (the seven
lamps are the room's); its glow is a material named in the manifest (`flame`), from which its halos are
made, and the bake's halos for that piece are hidden while it shows. The page checks every model it loads
and keeps the bake for one that does not fit, said once; `tests/hd-pack.test.mjs` makes the same check on
whatever pack is on this machine (and skips without one), off the GLB's JSON chunk alone.

The manifest, `HOME/hd/hd-manifest.json`:

```json
{ "v": 1, "pack": "hd-1",
  "pieces": [{ "asset": "civic_kraken_candlebarrel", "file": "candlebarrel.glb",
               "at": { "x": 0, "y": 0, "z": 0, "turn": 0, "s": 1 },
               "materials": { "skulls": "gilt", "flame": "flame" },
               "roughness": 0.38, "tone": 16777215 }] }
```

`at` takes the GLB's frame to the bake's in whole quarter turns (shared/ has no sin or cos; a prepared model
needs no more). A bad piece is dropped and named, the rest stands; an unknown field is ignored.

**3. Materials** (built). The building material is a `MeshStandardMaterial` too, so a GLB's own material is
lit by the same seven lamps under the same fog; no shadows (rooms have none). Roles: `gilt` (gold metal),
`metal`, both with one small warm room to reflect, made once for every piece (the room's scene has no
environment, and metal with nothing to mirror reads black); `flame` (emissive, a halo per flame); and a
per-piece `tone` multiply for a texture lighter or darker than the bakes beside it, set by eye. No budgets
(above); the test prints triangles, materials and texture sizes per piece. KTX2 textures would quarter the
memory but need a vendored transcoder: later, if a room ever gets heavy.

**4. Where the pack lives** (open). A git of its own, beside AgentVillage, **not a submodule** (every new
worktree would start with it empty, and the game only needs the pack, not its sources); `/hd/` is in
AgentVillage's `.gitignore`. When it is set up:

| | A. that repo, GLBs in Git LFS | B. that repo holds manifest, scripts and sources; GLBs and zip as its release assets |
|---|---|---|
| quota | free ~1 GB storage and ~1 GB bandwidth a month; every version kept | none; 2 GB a file, downloads unmetered |
| a new GLB version | storage grows by its size | a new `hd-<n>` release; old ones can go |
| needs | `git lfs` here | `gh` here |
| history of a GLB | in git | only what the releases keep |

In both, a player downloads a **release asset** (`promptholm-hd-pack.zip` + `.sha256`), never an LFS object.
Publishing is a command on this PC (`gh release create hd-<n>`), not a GitHub runner; whether the game's
`release.yml` then fetches the newest pack and hangs it beside each game release, or the command attaches it
itself, is decided with A/B. Then come the islander's **Install / Update / Remove** buttons (keeper-only,
download beside its own release, check the `.sha256`, unpack into `HOME/hd.new/` and rename it over `hd/`,
with a small unzip of our own in `lib/`). Until then the chain below writes straight into `HOME/hd/` - the
keeper's own pack, nothing copied by hand - and nothing is published. The pack is versioned on its own: an
old pack on a new release takes HD for every piece whose bake still fits, the bake for the rest.

**5. Licences.** Perchance's terms (18 July 2026) say in their FAQ that generated images may be used freely,
commercially too, without attribution, and that Perchance claims no copyright; the FAQ overrides the
boilerplate's "personal, non-commercial use" (said of generators, and the image answer is as explicit). Which
image model it runs, and under what licence, it does not say. Pixal3D's code is MIT; **before the first
public pack**, check the licence of its weights (often not the code's). Only Perchance images go in - never a
model made from the photos of others' work in `refs/krakenkit/`. A `LICENSES.md` goes in the zip.

**6. A patch.** Everything is `web/js/`, two keeper-only GET routes and `HOME/hd/`: nothing in
`layout.json`, `config.json`, a bundle or the wire, no `SEA_V`, no layout gate. An older page ignores the
fifth setting; an older islander has no `/api/hd`, which the page reads as no pack. No sea redeploy.

**7. The first piece: the barrel of candles.** Both versions are uncommitted in other worktrees, only read
from here:
- SD, the hand-built kit piece `civic_kraken_candlebarrel`: in `epic-hellman-880db8` (12:51, ~14k
  triangles) and a later version in `heuristic-tu-9a07ec` (14:43, ~17k, thicker runs, two candles on the
  boards, already baked into that worktree's `krakenkit-mesh.js`); `geom.py`'s `ao=False` and the
  `preview-krakenkit.py` line are the same in both. **To choose.**
- HD, Pixal3D's mesh: `web/models/kaarsen-pixal3d-50k.glb` + `web/js/candlebarrel.js` +
  `scripts/prepare-candlebarrel.py` in `heuristic-tu-9a07ec`. Read with `glbInfo`: 0.57 x 0.37 x 0.57,
  48,113 triangles, 3 materials, one 2048 texture.

In order: (1) the SD piece lands - the chosen `candlebarrel.py`, the `geom.py`/preview change, the rebake,
`KIT.candlebarrel` (with the larger reach, 0.29), its blocker and a `kit('civic_kraken_candlebarrel', …)`
line, so the barrel stands in every Kraken; whoever holds those worktrees commits it. (2) The HD route (this
branch). (3) The barrel into the pack: `candlebarrel.glb` and a manifest line (`skulls: gilt`,
`flame: flame` - `candlebarrel.js`'s material logic is now `hd-pieces.js`'s roles), in `HOME/hd/` and later
the pack's repository. The GLB in `web/models/`, `candlebarrel.js` and the lines that load it are never
committed to AgentVillage.

**8. Decimating** only when the keeper wants a piece lighter: BlenderAI's `mscripts/quadric_decimate.py` as a
step of that piece's prepare, its target in the script, the texture baked back. The raw output stays where
Pixal3D wrote it.

### The skill: a kit piece from a picture, end to end (planned, not built)

The chain as one skill, fully automatic unless the keeper asks for it in phases - in his words: first see
the RAW, then the 50k (or what he said), and only then the baking. Run whole, it goes on from phase to
phase; asked for in phases, it stops after each and shows what it made.

**Where it lives: a personal skill**, `~/.claude/skills/kitstuk/`, beside `/blenderai` and `/perchance`,
which it calls. It is bound to this machine - the 4090, BlenderAI's folder, the Perchance round through the
keeper's own browser - and a project skill would sit in Tiemen's list doing nothing he can run. What it
calls in AgentVillage stays ordinary, readable scripts: a generic `scripts/prepare-hd.py` (the prepare,
below), `scripts/krakenkit/*.py` for an SD bake, `tests/hd-pack.test.mjs` for the fit. When the pack's
repository exists, the packing and publishing move there. A new skill means the cheat sheet
(`~/.claude/Claude-Code-spiekbriefje.html`) and the skill list in the global CLAUDE.md are updated with it.

**Phases:**

0. **The reference image.** Not automatic: Perchance sits behind Cloudflare Turnstile and the keeper clicks.
   The skill starts from an image it is given (a path in `refs/krakenkit/objecten/`), or calls `/perchance`
   and waits for the keeper's download.
1. **RAW**: generate only (`blendai generate --model pixal3d/generate`, the first half of `blendai pixal3d`)
   and render the raw mesh from four sides. Stop here when phased.
2. **N k**: `blendai pixal3d <image> --generated <raw> --target-tris N`, 50k unless the keeper says
   otherwise, the texture baked back. Four renders again. Stop when phased.
3. **Bake** - three ways out; the skill picks by what exists:
   - **(a) HD** (the default): the GLB into the kit's frame by `scripts/prepare-hd.py` (prepare-candlebarrel.py
     made generic: front, foot, height, the split by place into named materials), into `HOME/hd/` with its
     manifest line. An HD piece always stands in for a bake, so:
   - **(b) SD-auto**, automatically *as well* when the asset has no bake yet: the Pixal3D mesh down to a kit
     piece with its texture as corner colours (`candlebarrel_ai.py` made generic; its source then goes into
     `assets/`, never `refs/`, or it bakes on this laptop only).
   - **(c) SD by hand**, only when asked: Claude builds the piece in `scripts/krakenkit/` with the Pixal3D mesh
     as the mould. Costs tokens and rounds; not automatic.

**The right colours.** In (a) and (b) they are Pixal3D's texture. In (c) they are read off the texture per
part - the mean colour of each region (as `blendai colorize` does), never by eye.

**What is still by hand, and how far the skill can take it:**
- *The front* (Pixal3D's azimuth differs per image: the barrel 145 degrees, grot3 55). Automatic: render the
  mesh at twelve azimuths and pick the one most like the reference (silhouette overlap, then colour); in
  phases the pick is shown for the keeper to confirm.
- *The split by place* (skulls, flames). Flames can be found by themselves - small, bright, warm, upright
  clusters in the texture. What else is a material of its own (gold skulls) stays a question: the keeper
  names it, or points at it on a front render, which gives the pick coordinates `prepare-hd.py` takes.
- *The height*: the bake's when there is one (the fit check demands it anyway); otherwise one number from the
  keeper.

**A space check before building.** On the barrel, collisions and floating cost most rounds - candles through
the skulls, wax hanging over the rim in the air. So before a bake: in the piece's own frame, every part
touches another or the floor and none passes through another (this matters most for (c), built from
primitives); and in the room, the piece's box at its KIT spot stands on a floor and overlaps no blocker,
wall or other kit piece.

**The last step: see it in `/demo`, at E by the Salty Kraken** - inside the room, not loose on the field,
because a kit piece is judged under the room's seven lamps and beside its neighbours, and the field has
neither (`/demo` now takes the HD pack too; `?sd` shows the bake). Plus the standing checks: bake twice for
the same bytes, `tests/models.test.mjs`, and the fit of HD against SD (`tests/hd-pack.test.mjs`).

### What is not in it

No HD outside: every building on an island is one instance in one `BatchedMesh` with one material, and a
textured building is a draw call of its own again. No HD of a room's shell (its floors are walked, its boxes
are the camera's): kit pieces only.

## Het exterieur: een galjoen dat op een rots is gelopen (30 september 2026)

**Status: gebouwd op `claude/salty-kraken-exterieur` (vanaf `claude/salty-kraken`), niet gemerged; wacht op het
kavel van 5 x 3.** De vakwerkherberg paste niet meer bij het interieur (een kroeg uit scheepsdelen in een grot), en
pleister vond de keeper niet piraterig. Gewerkt in poorten, met eerst renders en dan pas bouwen:

1. **2D.** Referentiebladen uit Perchance (`/perchance`). De eerste ronde had drie gehelen en vier details. Daaruit
   bleven de bolle hekgevel (08), de houten trap op de rots (12) en het kraaiennest als kamertje met ramen (14)
   over. De tweede ronde bestond uit samenstellingen, en de keeper koos **17**: een heel schip op een rots, met de
   lange flank naar het water en een trap langs de rots naar de deur bij de achtersteven.
2. **Blokmodel** (`refs/krakenkit/exterieur/blok/`, grijze vormen naast een settler, de taverne en het echte bord).
   Op 3 x 3 was het schip een speelgoedbootje, dus werd het kavel **5 x 3**. De trap van ~40° was te steil; eerst
   werd het de houten trap van 12, daarna één vlucht strak langs de rots. Het bord kwam **op de flank**, niet op de
   achtersteven. De keeper voegde **3° slagzij** toe.
3. **Detail.** Een eigen ontwerp van 13k, een HD-versie van 56k, en daarna, omdat de keeper het beeld zelf wilde,
   **17 letterlijk, met krakens**: 71.615 driehoeken. Het budget van 4000 liet de keeper los (*"ik wil een prachtig
   gebouw"*).
4. **Oordeel op `/demo`**: goedgekeurd (*"dit is hem"*).

Wat het is, uit 17: een diepe, bolle romp op een rots van 0.7, masten tot ~5 hoog (twintig meter, zoals het beeld).
De romp heeft 18 plankgangen per kant die elk een richel hoger staan dan de gang eronder, drie berghouten met bouten
en opgelapte planken. Daarop:
- de voormast midscheeps met een gebold onderzeil en een marszeil;
- de achtermast op het achterkasteel met een vechtmars, een opgerold onderzeil en een groot marszeil;
- bruine, gescheurde zeilen, en wanten met webbelingen;
- de grote Jolly Roger aan een schuine stok bij de boeg en een zwaluwstaart op de voormast;
- lantaarns onder de boegspriet, achter het schip en naast de deur;
- een schoorbalk van de boeg naar de rots;
- op het achterkasteel een koepeltje, een schuine spriet en twee zeeduivels;
- de steile plankentrap naar een boogdeur met een schedel.

Door de keeper toegevoegd: vier krakenarmen die uit de rots langs de romp klimmen en over de reling haken. Wat 17
niet laat zien, is ingevuld: de landkant spiegelt de waterkant, en het touwwerk is dat van een echt schip.

| Besluit | Waarom |
|---|---|
| Kavel **5 x 3** (5 langs het water) | Op 3 x 3 las het schip als een speelgoedbootje. Een schip diagonaal op het kavel of tot de kavelrand gaf maar +12 tot 27%. |
| ~72k driehoeken, `HERO_BUDGETS.piratetavern` 95000 | Een gebouw heeft geen eigen textuur, alleen vertexkleur en zes gedeelde vellen. Wat 17 als naden en bouten toont, moet dus geometrie zijn. Het is één instantie in de batch: geen draw call, wel driehoeken. |
| Bord op de voorste hoek van het achterkasteel, `PIRATE_SIGN_YAW` −90° | De arm staat naar het water en het bord is langs de kade te lezen. Verder naar achteren verstopte de zijgalerij het. Het bord hangt loodrecht: de slagzij geldt niet voor het bord. |
| `anchor.door` op de grond aan de voet van de trap | Daar staat een settler om naar binnen te gaan, binnen het E-bereik vanuit het kavelmidden. De test houdt die plek vrij van solids. |
| Geen porch (`NO_PORCH`) | De rots is de voet. Een stenen trede eromheen las als een sokkel onder een wrak. |
| Trap, dek en masten zijn nog decor | Het dek ligt als echte vloer binnen de verschansing, zodat het later beloopbaar kan worden met de `build-shipwalk.mjs`-aanpak van het piratenschip. |

Afgewezen:
- **de rots of grot als silhouet**: de keeper wilde een huis van een kapot schip;
- **een scheepshuis op palen** (refs 01 en 02): gaf de richting aan, maar was te veel huis;
- **de naald met de kraken (21) en de dubbele naald (18)**: de voorkeur van de ontwerper, maar de keeper koos 17;
- **het schip in twee helften (06)**: twee schepen op één kavel;
- **het eigen ontwerp van 13k**: te kaal van dichtbij;
- **de HD-versie van 56k**: niet letterlijk 17.

De tussenversies staan in de sessie-scratchpad. Alle beelden staan in `refs/krakenkit/exterieur/` (buiten git,
beelden van derden): `17-samen-heel-schip.jpg` is het richtpunt, en de renders staan in `blok/`, `detail/`, `hd/`
en `letterlijk/`.

**Opdracht voor de serverkant, vóór het mergen** (in `lib/layout.mjs`, de quay-sessie of een eigen sessie):
- `lotOf('piratetavern')` → `{ w: 5, d: 3 }`, en `pirateTavernSite`/`coastSite` moeten dan een waterkant van 5 lang
  vinden.
- Het plot dat al staat (het live eiland heeft er een van 3 x 3): één keer laten groeien, zoals `growCastle` doet,
  alleen over vrije cellen, en anders één keer verhuizen.
- `chestSpots` rekent met `w`/`d` in plaats van 3.
- Tests op een kopie van het live eiland.
- Een nieuw formaat in `layout.json`, dus een **minor**. `parseBundle` accepteert tot 16, dus 5 x 3 geeft geen
  probleem voor de zee.

Tot dat er is, overlapt het schip op een kavel van 3 x 3 zijn buren. Op `/demo` doet het dat ook, omdat het
werkblad uitgaat van kavels van 3.

### Bijsturing na het eerste oordeel in het spel (1 oktober 2026)

Op een kopie van Hoogezand vond de keeper het schip *"veel te klein"*. De trap kon je *"niet eens omhoog"*, en de
kroeg stond tegen de stenen kade: *"een piraat hoort op het strand"*. Besluiten:

| Besluit | Waarom |
|---|---|
| **2,5×**: het schip en de rots, op een kavel van **11 x 6** (vervangt het kavel van 5 x 3). De deur, de treden, de leuningen, de lantaarns bij de deur en het bord blijven op settler-maat | Een landmark van zo'n 50 m, op de schaal van de Batavia. Wat je aanraakt blijft even groot als jij. |
| **Een beloopbare zigzagtrap**: een onderste trap van de voet (oost) naar een bordes (west), en een bovenste trap terug naar het stoepje bij de deur. Het gebouw geeft die als `surfaces` (vloeren en hellingen, zoals in de kamers) aan de walk van het eiland. De rots eronder wordt onder de treden afgevlakt | Walk mode kende buiten alleen celhoogtes. De kamers hebben al rechthoekige vloeren en hellingen, dus dat werkt ook op het eiland. |
| **De muren van dit gebouw hebben een hoogte** (`y0`/`y1` per blok, door `blockersOf` meegegeven). De delen van de trap tellen niet als muur; onder het bordes en de bovenste trap staat een laag blok | Wie op de trap staat, loopt over de rots eronder. Wie eronder loopt, komt er niet doorheen. |
| **E werkt bij de deur**, bovenaan de trap (`floor` op het doel) | Je gaat naar binnen door de trap op te lopen, niet vanaf het strand. |
| **Op het strand, een blokje van de stenen kade af** (`pirateTavernSite` gebruikt `kadeSite` niet meer) | Een piratenkroeg hoort aan het zand, niet aan de kraan en het pakhuis. |
| **Eénmalig verhuizen** op een eiland waar de kroeg al achter de kade staat | Een plot verhuist nooit vanzelf. Dit is een bewuste, eenmalige verhuizing, zoals die van de kist, gemeten op een kopie van het live eiland. Een nieuwe kavelmaat en een verhuizing: een **minor**. |

**Kosten**: `web/js/piratetavern-mesh.js` is 11,7 MB (het oude exterieur was 0,5 MB, het piratenschip is 4,6 MB)
en laadt mee bij het opstarten, ook in de APK. De precisie per set van de interieurbranch (`11f2248`, "Geef de
exporter een precisie per set") kan dat flink kleiner maken, zodra die hier ligt.

### Het kavel op het strand (1 oktober 2026)

**Gebouwd op `claude/salty-kraken-kavel` (vanaf `claude/salty-kraken-exterieur` @456dc72).** Dit vervangt de "Opdracht voor
de serverkant" hierboven: het kavel werd 11 x 6 in plaats van 5 x 3, en de kroeg die al staat verhuist in plaats van
te groeien.

| Besluit | Waarom |
|---|---|
| `PUB_LOT` = **11 x 6** in `lotOf` (`w` langs de voorkant van het model, `d` de diepte), `stamped` bij een oneven rot, zoals de schepen en de werf | Dat is waar het model voor gebakken is. `parseBundle` neemt tot 16, dus de zee heeft er geen last van. |
| **`pirateTavernSite` zoekt zelf**, zonder `harbourSite`/`kadeSite`/`coastSite`: land of zand, niet op het dorpsplan, niet bij steigers en hellingen (`wf.near`), niet in de trechter of de ring eromheen (`havenKeys`), minstens `PUB_KADE_CLEAR` (4) cellen van de stenen kade | "Een piraat hoort op het strand" en "een blokje van de kade af". |
| **De voorkant aan het water**: minstens 6 van de 11 kolommen zien water binnen 5 cellen, over open land (een weg mag, er mag niets staan); de trede van de trap op land | Eerst gevraagd: 8 kolommen binnen 4 cellen, alleen zand. Dat vond op de eilanden van 128 op één seed op zes een kavel: de kust is daar meestal gras tot één steile oevercel, en een strand van 11 lang is een bult in de kust. Op het live eiland loopt een weg over de hele piratenoever en mondt de rivier langs die oever uit in de trechter; allebei moesten meetellen, anders stond de kroeg bij de noordhaven, 220 cellen van de kade. |
| **Reliëf tot 1,5**, en de pagina zet de rots op **het laagste punt van de voorkant** (`pirateTavernGround`, web/js/pirate-ground.js) | Zes diep vanaf de waterlijn loopt de grond vrijwel altijd meer dan 1 op. Zo komt de trap uit op het zand en loopt de achterkant van de rots de duin in; de rots is 1,75 hoog en de romp begint op 1,8. |
| Rangorde: eerst hoe dicht het water is, dan hoeveel zand, dan pas de afstand tot de kadehaven | Op afstand gerangschikt stond hij in het gras, met de zee er schuin naast. |
| **De deur is de voet van de trap** (`PUB_GATE` = `anchor.door`, op de voorrand van het kavel; `plotDoor`), en de weg is een strandpad daarheen | Een kolonist stapt daar naar binnen, en de rots staat in het midden van de voorkant. |
| **Eénmalige verhuizing** van een kroeg op het oude 3 x 3-kavel (`!fitsLot`): bovenaan `placeAll` opgetild (naast de kist), opnieuw geplaatst, de oude weg weg, en als het snoeien iets afsneed nog één ronde in dezelfde scan. Past hij nergens, dan terug op zijn plek en volgende scan opnieuw. `layout.before-pub-<ts>.json` als backup | Een huis verhuist nooit vanzelf; dit is een bewuste migratie met `fitsLot` als poort, zodat de scan erna dezelfde bytes geeft. |
| **Een groeiring voor de kroeg**, één per ring (`layout.pubRing`): past hij nergens op een eiland dat nog mag groeien, dan groeit het één ring | Op een eiland dat klein gesticht is (40 op 64) is bij 52 settlers elke kust van een gehucht; het oude 3 x 3 paste ertussen, 11 x 6 niet. Gemeten: zonder ring had 3 van de 6 seeds zelfs bij 80 settlers geen kroeg, met ring 8 van de 8 op de scan van 52. De teller zorgt dat een kroeg die een ring niet helpt, niet elke scan een ring kost. |
| **Het uitzicht blijft water**: de strook vóór de kroeg (2 x `PUB_SHORE` diep, een cel breder) hoort bij `keptWater`, dus de polderladder graaft er niet | Gemeten op seed 2024: bij 175 settlers polderde de tweede polder de zee vóór de kroeg droog. Het strand werd weiland en het strandpad een weg op bouwgrond. Aan een haven had de kroeg die bescherming vanzelf. |
| `chestSpots` rekent met `w`/`d`: op een 3 x 3 dezelfde cellen als altijd, op 11 x 6 achter de lange achterkant en naast de korte zijkanten | Een kist die al achter een 3 x 3 staat, blijft daar staan zolang de kroeg niet verhuist. |

Gemeten op een kopie van `~/.promptholm` (zee `single`, `network.public` false, `PROMPTHOLM_HOME` op de kopie), met
de oude en de nieuwe code direct na elkaar: de kroeg gaat van (171,309) 3 x 3 achter de kade naar **(148,253), rot 2**,
op het strand aan de kop van de trechter bij de riviermonding, zo'n tien cellen van de kade; de kist gaat mee naar
(153,252). Verder verschillen alleen de weg van de kroeg en `town.commons` (het kavel wordt dorpsgrond). De twee
scans daarna zijn byte-identiek. Op de ladder van 128 (twaalf seeds) krijgt elk eiland een kavel.

Een nieuwe kavelmaat in `layout.json`: een **minor**. Niet gebouwd: een test voor het terugzetten als er nergens
strand is (op de ladder vindt elke seed een kavel, dus dat pad is alleen met de hand nagelopen).

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
