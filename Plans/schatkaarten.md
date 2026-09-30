# Schatkaarten, een piraat en een standbeeld

**🚧 Status: plan van 29 september 2026, wordt gebouwd.** De eerste versie (fles → kaart → kist)
is herschreven na een gesprek op dezelfde dag: er komt een piraat bij de tavern die quests geeft,
een schep als eerste unlockable, en één uniek schat-standbeeld dat je vindt, op je boot legt en in
het stadscentrum neerzet. Het uitvoeringsplan met alle bestandsverwijzingen staat in de sessie;
dit document is het *waarom* en de beslissingen.

## Aanleiding

De eilandjes zijn net begaanbaar (ondiep water, solide palmen, een camera boven water,
[starter-eilanden.md](DONE/starter-eilanden.md)) en er is niets te doen op een eilandje behalve er
staan. Tegelijk heeft het inventory-scherm slots, maar geen enkele manier om er iets *bij te
vinden*. Idee: een piraat geeft je een schep en een kaart, je vaart naar een eilandje, graaft, en
vindt een standbeeld dat je naar huis brengt. Daarna spoelen er kaarten aan voor kisten met
kleuren en spullen.

## Wat er al is

- **De eilandjes zijn rekenwerk** (`shared/islets.mjs`): een rooster van `ISLET_PITCH` (96), één
  hash per vierkant, `ISLET_CHANCE` 25 %. Geen bericht, geen veld, geen `SEA_V`. Palmen en
  struiken komen uit de rng `'<id>:flora'`: daar mag **nooit** een trekking bij, anders schuift elke
  palm. Alles wat hier bij komt heeft een eigen stroom (`'<id>:treasure'`).
- **De kaart (M) en de radar** tekenen eilandjes (`mapIslets()`, `createWorldMap`,
  `createMinimap`, straal 130); raster A-P bij 1-16 (`KM` 252).
- **Bewaarders** (`KEEPERS` in `shared/palette.mjs`): kroegbaas, burgemeester, goudklerk, ... één
  figuur per gebouw-id, gelopen door de zee. Er is geen gesprek met keuzes (`ui.setSpeech` heeft
  geen knoppen); het stadhuis-register (`townhall.js`) is het patroon voor een eigen paneel.
- **Het inventory** (`inventory.js`, `avatar.js`): `HAND_ITEMS`, `PLAYER_HAT_SHAPES`, slots met
  `options`; de look staat in localStorage (`promptholm.avatar`).
- **Er is nog geen quest-systeem, en geen unlock-begrip.** `Ideas/Ideas.MD` wil geen generieke
  quests; dit is één verhaal-keten, geen klusjesgenerator.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Waar leeft wat | **Twee lagen.** Per browser (localStorage): vondsten (`promptholm.finds`), unlocks (`promptholm.unlocks`), quest-voortgang (`promptholm.quests`). Van het eiland (`data/treasure.json` van de islander): of het beeld gevonden/geplaatst is en hoeveel schatten er gevonden zijn. | Een beeld in het centrum ziet iedereen; de zee bewaart niets, dus het eiland van de keeper onthoudt het. Vervangt het eerdere "alles in localStorage". |
| Het beeld | **Eén uniek** standbeeld (`civic:treasure`, eigen 1x1 plek op het plein) met een plaquette "Treasures found: N". | Een trofee die de teller laat zien, geen verzameling. |
| Dragen | Twee handen, traag (x0,55), geen springen/vechten/fietsen, zichtbaar voor anderen (pose-bit `CARRYING` 8192). Op de boot leggen met E; het beeld deint mee. Afleveren kan alleen op je eigen eiland (keeper). | Voelt als "aan boord tillen". Een herlaad zet het beeld terug op het eilandje: het unieke beeld raakt nooit kwijt. |
| Graven | Met een schep, ca. vier scheppen in 2,5 s, zandhoop en korrels, pose-bit `DIGGING` 16384. Bewegen of geraakt worden breekt af. | Een beurt duurt, dus een bit zoals `DANCING`; elke pagina tekent hem zelf. |
| De schep | **Eerste unlockable**: `shovel` in `HAND_ITEMS`, vergrendeld in de kiezer, ontgrendeld door de piraat. | Zo krijgt het inventory meteen een herbruikbaar unlock-mechaniek. |
| De piraat | Een klein `civic:pirate` (zeekist met vlag) naast de tavern-deur met een `KEEPERS`-entry; gesprek in een eigen paneel met Accept-knop. Geen nieuw figuur-systeem. | Een `KEEPERS`-entry is één-op-één met een gebouw; dit hergebruikt spawn, `attend`, `seaIdOf` en id-redactie. Een nieuw civic is een nieuw plot: een minor. |
| Quests zichtbaar | Logboek-paneel (chip + toets K), kruis op de wereldkaart, ring op de radar, uitroepteken boven de piraat. | Volgt het dierenjournaal, de kaart en de radar. |
| Quest-keten | Data in `shared/quests.mjs`: *The First Dig* (schep + kaart), *Bring It Home* (beeld naar huis), *Treasure of the Day* (fles-kaarten, herhaalbaar). | Een nieuwe quest is een regel data. |
| Eerste jacht | De eerste kaart volgt uit een vaste seed van het eiland, niet uit de dagfles. | Reproduceerbaar en niet afhankelijk van dat er die dag gewerkt is. |
| Fles-kaarten | Zoals eerder: een fles op het strand bij de landing, hoogstens één per wereld-dag, alleen op dagen dat er op het eiland gewerkt is; `worldTime()` krijgt een `day`. | Rekenwerk uit de klok van de zee, niets op te slaan. |
| Welk eilandje | `pickIslet` op 150 tot 900 eenheden van je berth, de kaart onthoudt het **id**; is het eilandje weg, dan slaapt de kaart. | Het id overleeft dat de vloot verandert. |
| Nieuwe kleuren/hoeden | In `PLAYER_SWATCHES`/`PLAYER_HAT_SHAPES`, **nooit** in `SWATCHES`/`HAT_SHAPES`. | De settlers trekken hun uiterlijk uit die lijsten met `rng.pick`; één toevoeging verandert het gezicht van de hele bevolking. |
| Look niet filteren op bezit | `normalizeAvatar` en `lookOf` blijven ruim; alleen de kiezer is vergrendeld. | Het is decor; een vervalste look kost niemand iets. |

## Modulaire uitrusting

De piraat brengt een hele reeks spullen mee die we nog niet allemaal tekenen: een piratenhoed
(tricorn, bandana), ooglap, baard, haak (vervangt een hand), houten been, verrekijker en een
papegaai op de schouder. Ze staan als **data** in één catalogus, `shared/equipment.mjs`:
`{ id, slot, name, unlock, status }` met `status` `'live'` (getekend, in de kiezer) of
`'planned'` (alleen data). `HAND_ITEMS` en `PLAYER_HAT_SHAPES` worden daaruit afgeleid; een nieuw
slot (face, leg, shoulder) komt pas in `INVENTORY_SLOTS` als er een live stuk in zit. Een stuk
tekenen later is één regel data en één tekenfunctie (`render`-sleutel in `classic-avatar.js`).
Alleen de schep is nu live.

## Idee: scheepsaanpassing bij de docks

Bij de kade komt een **werf-paneel** (E bij het dock, patroon `townhall.js`/`pirate.js`) waar je
je boot een kleur geeft: romp, zeil en bies, later ook een tekstuur (planken, gestreept,
piratenvlag). Verf is het tweede soort unlockable naast de uitrusting: dezelfde catalogus
(`shared/equipment.mjs`, slot `boat`) en dezelfde vergrendelde tegels, dus nieuwe verf komt uit
quests, kisten of de piraat. Nog niet uitgezocht, dus te verifiëren voor het gebouwd wordt:

- **Van wie is de verf?** Voorstel: van de *speler*, als onderdeel van de look
  (`spec.boat = { hull, sail, trim }`, `{t:'look'}` draagt het al naar anderen), en toegepast op
  elke romp die die speler bestuurt (`seatOf`/piloot). De zee kent per boot alleen
  `{x, z, yaw, pilot}` (`lib/boats.mjs`) en hoeft dan niets te weten: geen `SEA_V`, geen
  redeploy. Nadeel: een afgemeerde, onbezette boot toont de standaardkleur.
- **Alternatief**: verf per boot-id op het eiland (`data/boats.json`, `lib/boatyard.mjs`), zodat
  een afgemeerde boot zijn kleur houdt en elke bezoeker hem ziet; dan wel keeper-only en via de
  bundle (strikt in `parseBundle`).
- **Tekenen**: `createBoat` (`web/js/boat.js`) bouwt één mesh per craft; kleur per instantie vraagt
  vertex-kleuren of een materiaal-uniform, geen nieuwe draw call per boot. Het galjoen heeft
  drie kleuren uit één bake (Batavia) als voorbeeld.
- **Textures later**: een `pattern`-id in dezelfde `boat`-spec, getekend via de bestaande
  bouwmateriaal-sheets (`plank`, `plankZ`) of een kleine eigen sheet; geen losse afbeeldingen
  laden (Nothing is fetched at boot).

## Fasen

1. **Fundament**: `day` in de wereldklok, `shared/treasure.mjs` (kaart, plek, beloning, fles),
   `isletById`, `shared/quests.mjs`, met tests.
2. **Bake**: `assets/treasure/` met het beeld, een klein draagmodel, de schep, de zeekist van de
   piraat en een zandhoop.
3. **Unlocks en catalogus**: `shared/equipment.mjs`, `unlocks.js`, de schep in het inventory,
   vergrendelde tegels.
4. **De piraat en de quests**: `civic:pirate` + `KEEPERS`-entry, het paneel, het Logboek en de
   markeringen op kaart en radar.
5. **Het eilandje**: fles, kaart, graven met animatie, het beeld uit het zand.
6. **Dragen en de boot**: `state.carry`, `CARRYING`/`DIGGING` op de lijn, het beeld op de boot.
7. **Afleveren en tellen**: `data/treasure.json`, `POST /api/treasure`, `village.treasure`,
   bundle, `civic:treasure` en de plaquette.
8. **Docs**: dit plan, `Plans/README.md`, CLAUDE.md, `docs/manual.md`.

## Risico's

- **De open zee moet opnieuw worden gedeployd** voor de nieuwe pose-bits (`POSE_MASK` 8191 →
  32767); een oude zee maskeert ze weg. Het bundleveld `village.treasure` moet eerst getoetst
  worden tegen een oude `parseBundle`.
- **Nieuwe civics en plots** (`civic:pirate`, `civic:treasure`) staan in `layout.json`: een minor.
- **De telefoon** heeft geen eiland en dus geen plein; hij kan optillen en varen, niet afleveren.
- Quest-voortgang is per browser; wie de quest op andermans eiland doet, kan het beeld niet
  afleveren.

## Later, niet nu

- Een gedeelde jacht (wie het eerst graaft): toestand op de zee, dus een eigen deur.
- Kaarten bij de kroegbaas voor munten; een kaart uit een visvangst.
- Een wrak op de zeebodem voor de duikstand (`state.diving` bestaat al).
- Een kaart aan een vriend geven (G geeft nu een biertje).
- De rest van de piratenspullen tekenen (ooglap, baard, haak, houten been, papegaai,
  verrekijker, hoeden) als live stukken in de catalogus.
## Stand van de pagina-kant (29 september 2026)

Gebouwd en in een echte pagina doorlopen (fles, kaart, eilandje, graven, beeld, tillen, boot, plein,
plaquette, kist, teller): `web/js/treasure.js` (regels), `treasure-site.js` (tekenen), bedrading in
`main.js` (`startTreasureHunt`), `PLAYER_SWATCHES` met vergrendelde kleurtegels in de kiezer, het
gebakken beeld in de armen en op de boot. Tests: `treasure-hunt`, `treasure-walk`, `treasure-site`,
`treasure-unlock-ids`.

Bewust nog open:
- Staat het beeld al in het centrum, dan graaft de eerste-jachtkaart van een tweede browser een gewone
  kist; de `bring-it-home`-keten van die browser kan dan niet verder.
- De kist heeft geen eigen bake (een doos-en-band uit `treasure-site.js`); de fles ook niet.
- Een beeld dat op een boot ligt terwijl je er niet aan boord bent, kan alleen terug in de armen door aan boord
  te gaan en weer aan land te stappen.
- Geluid bij het graven ontbreekt (`sound.js` heeft er geen).
- Hoeden en de verrekijker zijn nog `planned`: een kist kan ze wel geven, maar er is geen tegel en geen model.

## Wacht op de nieuwe tavern: de kist van de piraat "subtiel achter de tavern" (30 september 2026)

Wens van Martijn: de kist met de piratenvlag staat nu één cel langs de voorkant van de tavern-deurstap
(`ALONG_FRONT` in `lib/layout.mjs`), op het plein, en valt te veel op. Hij moet **achter de tavern** komen, als
een plekje dat je moet ontdekken, en kleiner zijn. Er is ontworpen, gemeten en deels gebouwd, maar de tavern
zelf wordt opnieuw gemaakt (mogelijk andere plek, footprint, rotatie, interieur), dus de **plaatsing is
teruggedraaid** tot die er is. Wat er wél staat: de kleinere bake (hieronder). Dit is wat er ligt als de
plaatsing weer wordt opgepakt.

### Wat er is gemeten (scratch-kopie van het eiland, en verse eilanden)

- Op het echte eiland (tavern `gx 180, gz 175`, rot 3, deur west) staat de kist nu al op de oude plek
  (`179,177`): de live `layout.json` bevat hem dus, een migratie is echt nodig.
- Achter de tavern (oost, `x = 183`, `z 175..177`) ligt op het echte eiland de ring-bestrating van de tavern
  (`frontageOf`), vrij en met alleen open grond erachter: de cel recht achter het midden van de achterwand,
  `[183,176]`, met de keeper op `[184,176]`, werkt daar.
- **Op een gewoon (vers) eiland is het niet zo:** de eerste straatkavel van de oostelijke winkelstraat
  (`STREET_LOTS[1]`, `at [7,-1]`) ligt precies achter de tavern, `RESERVED` voor een winkel (of al bezet,
  schouder aan schouder met de tavern). De ring achter de tavern wordt dan niet eens bestraat. Wat overblijft
  is de steeg aan de noordzijde (de kant van `ALONG_FRONT`): de ring-cellen naast de achterste helft van de
  zijmuur, en daar loopt vaak de hamlet-weg door.
- Gemeten op 200 verse eilanden (10 seeds x 2 groottes x 5 dorpsgroottes x 1 of 4 projecten): recht achter
  het midden 10 %, achter-midden-zijkant 12 %, **achterste helft van de steeg-zijde 53 %**, achterhoek 2 %,
  en **23 % helemaal ingesloten** (winkel erachter, weg door de steeg, straat aan de andere kant).

### Ontwerp (afgeprint, niet meer in de tree)

1. **Cel-regel, één lijst voor stad en starters**: `chestSpots(tavern)` in `shared/treasure.mjs`, pure
   geometrie uit `rot` (met `DOOR_DIR` als data, door de test vastgehouden): spots `[u, v]` vanaf het midden
   van de 3x3-kavel, `u` langs de kijkrichting (negatief = achter), `v` langs de voorkant naar de `aside`-kant:
   `[-2,0] [-2,1] [-2,-1] [-1,2] [-2,2] [-1,-2] [-2,-2] [0,2] [0,-2]`, allemaal cellen van de
   bestratingsring, nooit de deurstap. Per spot ook de `rot` (van de tavernmuur af: achter = `rot+2`, zijkant
   = `rot+1`/`rot+3`) en de keeper-cel (de volgende cel verder).
2. **Wat 'vrij en loopbaar' is, gemeten en niet aangenomen** (in `placeAll`, het blok "the pirate's sea
   chest"): de spot is `SQUARE` (ring-bestrating, dus geen `RESERVED`-straatkavel en geen water), niets staat
   erop, geen deurstap, **geen cel van een `layout.paths`/`layout.roads`/`town.streets`** (een kist op een
   vastgelegd padcel sluit dat pad: het scannen daarna legt het weer anders); de keeper-cel is open grond
   (`FREE`/`PATH`/`SQUARE`, niets erop, geen deurstap); en de spot raakt andere bestrating of pad.
3. **Terugval**: een ingesloten tavern houdt de kist bij de deurstap (de twee oude cellen, met de oude
   `SQUARE && !taken`-toets), want een zichtbare kist is beter dan geen piraat. Starters (`starterBundle`,
   tavern rot 2): dezelfde lijst, toets = `terrain.isBuildable` voor kist en keeper-cel; `starterTown`
   garandeert grond maar tot `cz - 6`, dus recht erachter is er niet altijd.
4. **Migratie zonder versie-gate**, als een kleine, gerichte lift in `placeAll` (naast `migrateQuay`): een kist
   die op één van de twee oude cellen staat (en `rot === tavern.rot`) wordt *vóór* het terugspelen van alle
   plots van de plots gehaald, en in het pirate-blok weer neergezet op de eerste vrije spot erachter, anders
   op zijn eigen cel terug. Vroeg tillen is bewust: de cel die hij vrijlaat is dan kaal in het rooster van
   déze scan en krijgt zijn bestrating in diezelfde scan (later verplaatsen liet de vrijgekomen cel pas een
   scan later bestraten, dus de scan na de verhuizing was niet byte-identiek). Terugzetten gaat op dezelfde
   positie in de volgorde van `layout.plots` (`putBackAt`), anders wijzigt een kist die elke scan
   opgetild en teruggezet wordt de bytes voor alles wat erna komt. Alleen `civic:pirate` beweegt,
   `diff.plots.otherMoved` blijft leeg. `opCivic` (de keeper draait/verplaatst de tavern) gooit de kist al weg
   en `placeAll` zet hem dan met dezelfde regel achter de nieuwe deur.
5. **De keeper en zijn standplaats**: de kist kijkt van de muur af, dus `spawn` (`shared/settlerwalk.mjs`,
   `post: 'pirate'`, `reach = w/2 + 0.35 = 0.85`, geen `aside`) zet hem één cel voorbij de kist, op de
   keeper-cel van `chestSpots`. **Niets in de quests hangt aan de plek, alleen aan `post: 'pirate'`** (en aan
   `civic:pirate` als id): de standplaats is dus los te maken van de kist als hij later naar binnen (de
   tavern-interieur) verhuist, zonder dat `shared/quests.mjs`, `quest-log.js`, `pirate.js` of het uitroepteken
   (`quest-mark.js`, zoekt de record met `keeperOf(...).post === 'pirate'`) verandert.
6. Tests die erbij hoorden (`tests/pirate.test.mjs`): geometrie van de lijst op alle rots, keeper op de cel die
   `chestSpots` zegt en buiten de tavern, starters 0-5 op dezelfde lijst, kist achter het midden-lijn en niet
   op een weg, migratie vanaf de oude cel (rest byte-gelijk, `layout.paths` gelijk, scan erna no-op),
   ingesloten tavern houdt de oude cel, en het draaien van de tavern zet de kist achter de nieuwe deur.

### Wat wél is gedaan

- `civic_pirate` opnieuw gebakken, alleen die asset (`scripts/build-treasure.py`): kist op 0,72 van het oude
  formaat, **mast 0,72** hoog (was 1,35), **vlag 0,20 x 0,13** (was 0,34 x 0,22, een derde van het doek) met de
  schedel op 0,59 van zijn formaat (leesbaar van een paar stappen, niet verder). 838 driehoeken (zelfde
  aantal), afmetingen x ±0,21, y 0..0,73, z -0,13..0,24. `civic_treasure`, carry, schep en zandhoop ongewijzigd.
- De terugvalbox in `web/js/buildings.js` (`case 'pirate'`) ook op 0,72, hoogte 0,72. `tests/pirate.test.mjs`
  eist voor de kist nu een hoogte boven 0,5 in plaats van boven 1.
