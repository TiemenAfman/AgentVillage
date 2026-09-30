# De piratenkroeg: "The Salty Kraken"

**🚧 Status: plan van 30 september 2026, nog niet gebouwd.** Ontworpen in een planning-sessie (Fable 5.1);
het stap-voor-stap uitvoeringsplan met alle bestandsverwijzingen staat in
`~/.claude/plans/ik-wil-een-nieuwe-synchronous-seahorse.md` en wordt door een Opus-sessie uitgevoerd. Dit
document is het *waarom* en de besluiten.

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
| Plek | **Aan de kadehaven**, een 3x3-kavel met de gevel op het water, geplaatst zoals het pakhuis en de waag (`harbourSite` → `coastSite`; in `AT_THE_WATER`, `QUAYSIDE`, `FACES_WATER`, `CLAIMS_LAND`). | Een havenkroeg waar de piraten aan land komen. Buiten blijft het één kavel: alle plaatsingscode is op 3x3 geschreven, en de ruimte zit toch binnen. |
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

**De kapitein is een eigen model.** Martijn leverde een gerigde FBX (15 delen, 4608 driehoeken, T-pose, zeven
textures, geen animaties). Hij wordt naar het recept van het piratenschip gebakken tot één statische mesh: in
Blender geposeerd (armen omlaag, een hand op de kaartentafel), de textures per vlak als vertex-kleur
gesampled, 0.55 hoog, hero-set `captain` met een eigen budget (5000). In de kroeg staat hij aan de kaartentafel
op de erker en draait naar je toe als je hem aanspreekt; geen instanced figuur, wel dezelfde spreek-interactable.
De bron blijft buiten de repo (gitignore) - zie Risico's.

## Fasen

0. Dit document; `Plans/README.md`.
1. **Server**: trede 52, kavel aan de kade, `chestSpots` + gastheer-regel, éénmalige migratie van de kist,
   tests (`tests/pirate-tavern-layout.test.mjs`). Een nieuw plot in `layout.json`: een **minor**.
2. **Bake**: `scripts/build-piratetavern.py`, `web/js/piratetavern-mesh.js`, `buildings.js`, `/demo`.
3. **Kamer en bemanning**: `web/js/pirate-tavern.js`, `'sit'` in `settler-figures.js`, haken in `interior.js`.
4. **Quests en spreken**: `shared/quests.mjs`, `quest-log.js`, `pirate.js` → `createQuestGiver`, main.js.
5. **Shanty**: `sound.js`, `shantyHeard()` in main.js.
6. **Docs**: `docs/manual.md`, CLAUDE.md.

## Risico's

- **Het live eiland**: heeft de kadehaven geen vrij waterfront-3x3 met een weg aan de deur, dan blijft de
  kroeg `unplaced` (het pakhuis-risico van 28-29 september). Eerst meten op een kopie van `~/.promptholm`.
- **Geen kist-spot bij de kroeg** (alle ringcellen weg, pier, water of steil): de kist blijft bij de oude
  tavern en het blok probeert elke scan opnieuw.
- **Duikdiepte twee** ligt in open zee (bodem −2.5, geulen tot −3.5) - vanaf de haven kan dat een eind zwemmen zijn.
- **De shanty onder 20 s** houden: de geluidstest kent de rave-buffer aan zijn duur.
- **De kapitein**: de FBX lijkt een game-rip van een Disney-personage; de bron en textures horen niet in een
  publieke repo. Alleen de gebakken, geposeerde en in eigen vertex-kleuren geverfde mesh erin (nog steeds een
  afgeleide - Martijns keuze), en de rig van 615 naamloze botten poseren is proberen en renderen.

## Later, niet nu

- Ooglap, haak, houten been en papegaai voor de bemanning zodra de catalogus (`shared/equipment.mjs`) ze tekent.
- Een kaartspel of dobbelspel aan tafel; de dagkist bij de bootsman kopen voor munten.
- Een bovenverdieping die je op kunt (een trap is voor walk mode nog geen dek).
