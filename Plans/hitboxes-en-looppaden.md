# Hitboxes en looppaden buiten

**🚧 Status: plan van 1 oktober 2026. Fase 1 t/m 5 gebouwd op `claude/gracious-lehmann-ab4896`;
open: alleen *Later*.** De keeper koos bij alle drie de open vragen het voorstel.

## Aanleiding

De keeper, in walk mode: "objecten moeten betere hitboxes en looppaden krijgen". Buiten kent walk mode
twee dingen: **blockers** (as-uitgelijnde rechthoeken of cirkels, `inside()` in `web/js/walk.js`) en
**vloeren** (celhoogtes in `levels`, per cel van vier meter, via `handOutDecks` in `main.js`; en
rechthoekige `surfaces`, tot nu toe alleen in kamers en op de Kraken-trap). Veel van wat er buiten staat
valt tussen die twee in: het is er niet, het is een doos om iets ronds, of het is een vloer waar je
doorheen zakt.

Twee parallelle sessies raken hetzelfde gebied. Dit plan blijft van hun delen af:

- **Muren en gebouwen** (de footprint van `buildings.js`: `footprintOf`, `mergeRects`, `APART`, `ROUND`,
  de solids van civics en huizen). Wat ik daar gemeten heb staat hieronder als overdracht, niet als werk.
- **Trappen** (de Salty Kraken op `claude/salty-kraken-exterieur`: `built.surfaces`, `surfacesOf` in
  `main.js`, blockers met `y0`/`y1` die met het gebouw meeliften, en `STEP_DOWN` zodat je van een rand
  valt in plaats van teleporteert). Dit plan bouwt daarop voort en verandert er niets aan.

## Wat er nu is (inventaris)

| Wat | Waar | Solide? | Beloopbaar? | Probleem |
|---|---|---|---|---|
| Gebouwen en civics | `blockersOf` (main.js) ← `built.solids` (buildings.js `footprintOf`) | rechthoeken, `ROUND` als cirkel | nee (veranda niet) | Gedraaide gebouwen krijgen de **omhullende AABB** (`hx = |hx·c| + |hz·s|`). Zie overdracht. |
| Veranda/stoep onder een gebouw | `porch()` in buildings.js, `built.porch` | — | **nee** | Elk gebouw staat 0.18 omhoog op een stoep, maar je voeten blijven op het gras: je zakt 0.18 in de steen. |
| Props (met de hand geplaatst) | `propFootprint` (props.js) | vierkant van `r`, hekken/kar/waslijn als rij vierkantjes | bruggen via `deckCells` | Een **bank** (1.3 × 0.42, gedraaid) is een vierkant van 0.9: te kort én te breed. **Put, standbeeld, kampvuur** zijn vierkanten om iets ronds. Een **boom** blokt een vierkant van 0.84 om een stam van 0.12. Een **waslijn** blokt over de hele lijn terwijl je onder de lijn door loopt. |
| Steiger-prop (`dock`) | props.js | nee | **nee** | Getekend op dekhoogte, maar niet in `deckCells`: je waadt naast/door je eigen steiger. |
| Bos, rotsen, keien | `createLandscape` (world.js): `trees`, `rocks` (keien tot schaal 1.6, rotspieken) | **nee** | nee | Je loopt dwars door elke boom en elke rots. Rots A is 0.35·s hoog, slab B 0.21·s: prima om op te staan. |
| Boomgaarden | `orchardTrees` (hamlets.js) | nee | — | Idem. |
| Grenzen van wijkjes, erven en akkers | `buildBorders` (hamlets.js): `runs` + `posts` | **nee** | — | Rail 0.30–0.34, schutting 0.36–0.46, heg 0.46–0.54, muur 0.50–0.58 hoog; niets houdt je tegen. De route van het geparkeerde lichaam (`findPath` met `crossing`) rekent een grens als 12 stappen extra, juist omdat hij er doorheen loopt. |
| Palmen op eilandjes | `islets.blockers()` | stamcirkel | — | Goed. Struiken bewust niet. |
| Plein-bloembed | `squareBed` | cirkel | — | Goed. |
| Gasteilanden | `guest-island.js blockers()` | alleen gebouwen | bruggen via `decks` | Hun **props** (bomen, hekken, steigers) en hun **bos** blokken niet, hun veranda's ook niet. |
| Kaden, steigers van de haven, resort-dek | `levels` per cel (QUAY_DECK) | — | ja | Goed genoeg: celbreed. |
| Boten aan de steiger, de vloot | — | **nee** | alleen het galjoen (eigen hitbox) | Je zwemt dwars door een Benchy. (*Later*.) |

Dan de motor zelf:

- **Alleen as-uitgelijnd.** Een rechthoek kan niet draaien, dus alles wat schuin staat wordt zijn
  omhullende doos. Op 45° is dat twee keer het oppervlak van een bank.
- **Geen "iets met een bovenkant".** Een krat, een kei, een stoep, een plint is óf een muur op elke hoogte
  (je springt er niet op), óf niets. `y0`/`y1` bestaan (`atHeight`, uit verdiepingen-binnen.md): een blocker
  laat je door als je voeten er boven zijn, maar er is geen vloer bovenop, dus je valt er weer doorheen.
- **Lineair zoeken.** `blocked()` loopt per stap alle blockers langs (op Hoogezand ~1.200 rechthoeken). Met
  het bos erbij worden het er duizenden, per frame, meerdere keren per frame.

### Overdracht aan de muren-sessie (gemeten, niet mijn werk)

Per civic het deel van de solids waar binnen 0.1 geen geometrie onder hoofdhoogte staat (`emptyPct`,
gerasterd op 4 cm, script in de scratchpad van deze sessie): trainingfield **40%** (één blok van 9 m²),
grocer (en de andere winkels, `APART`) **54%**, stable 32%, sawmill 29%, shipyard 26%, goldmine 23%,
butcher 23%, brewery 21%, watertower 17%, chapel 16%, smithy 12%; ship 73% (bewust: romplatten). Alles
onder de 10% is in orde (huizen, stadhuis, kroeg, put, fontein, markt, tafels). En: gedraaide gebouwen
krijgen de omhullende AABB in `blockersOf` — met de georiënteerde rechthoek hieronder kan dat exact.

## Besluiten (voorstel)

| Vraag | Voorstel | Waarom |
|---|---|---|
| Vorm | Een blocker of surface mag een **`yaw`** hebben (dezelfde hoek als `group.rotation.y`); `inside()` en `surfaceY()` draaien het punt terug naar het eigen frame. `c`/`s` worden één keer uitgerekend bij `setBlockers`/`setSurfaces`. Een surface mag ook **`r`** hebben (een ronde bovenkant). | Eén vorm voor alles wat schuin staat, van bank tot huis. Goedkoop: vier vermenigvuldigingen. |
| Iets met een bovenkant | Een blocker met **`top: true`** is een muur onder `y1` en een vloer óp `y1` (walk.js maakt de surface zelf, zelfde vorm). | Een krat, kei of stoep is één ding, niet een blocker plus een losse surface die uit elkaar kan lopen. |
| Opstappen | Een `top` binnen **`STEP_ONTO` = 0.2** boven je voeten stap je gewoon op (stoep 0.18, lage kei, bruggetje); hoger moet je springen (sprong reikt 0.384). Niet `STEP_UP` (0.45): dat is een hele bank hoog, en je zou ongewild op elke bank en elk krat klimmen. | Een stoep hoort een stoep te zijn, een krat een sprong. |
| Overheen springen | **`hop: true`**: een muur op de grond, open in de lucht; wie er al in staat (een te korte sprong) loopt eruit. Grenzen onder **`HOP_H` = 0.4** zijn een hop (rails en de lage schuttingen), heggen en muren niet. Een geparkeerd lichaam op een route springt een hop zelf. | Op hoogte alleen lukte het niet, gemeten: op loopsnelheid (0.65/s) draagt een sprong je 0.3 ver en ben je maar een vijfde daarvan boven de rail, terwijl lichaam plus rail 0.42 breed is. |
| Zoeken | Een **rooster van 2 bij 2** (`bucket`) in walk.js, opgebouwd bij `setBlockers`/`setSurfaces`; een vorm staat in elk vakje dat hij (plus `BODY_R`) raakt. `blocked`, `groundAt` en `roomFor` vragen alleen het eigen vakje. Een test houdt het gelijk aan de lineaire versie. | Het bos maakt er duizenden van; en het maakt de ~1.200 van nu ook goedkoper. |
| Bomen | Een **stamcirkel**: eik `0.1·s`, den `0.2·s` (zijn onderste kegel begint op 0.28, onder hoofdhoogte). Geen canopy. Een route door een cel waarvan het midden in een stam valt gaat via een vrij plekje een derde cel ernaast (`ROUTE_SPOTS` in main.js). | Gemeten op de bake (`flora_oak_a` voet 0.08, `flora_pine_a` 0.06 met rok vanaf 0.28). Op Hoogezand is 20% van de landcellen in het midden bezet, maar maar 1,6% helemaal. |
| Rotsen | Kei = cirkel met **`top`** op zijn eigen hoogte (`0.35·s` / slab `0.21·s`); rotspieken = cirkel zonder top (te hoog). Grassprieten en struiken blijven doorloopbaar. | Een kei om op te staan is precies het soort looppad dat nu ontbreekt. |
| Grenzen | Elke run uit `buildBorders` wordt dunne rechthoeken **per vak (cel-rand)**, `y0` = grond, `y1` = grond + `h`; poortpalen kleine vierkanten, de poortopening blijft open. `buildBorders` geeft ze naast de geometrie terug. **Zie open vraag 1.** | De runs bestaan al, met dikte en hoogte: het is aflezen, geen nieuwe vorm. |
| Route van het geparkeerde lichaam | Een grens die je niet overspringt wordt in `findPath` een **dichte rand** (de bestaande `step(a, b)`), in plaats van 12 stappen extra; rails blijven gewoon doorloopbaar voor de route. | Anders loopt het lichaam van boven een route die de voeten niet kunnen lopen, en staat het vast tegen een heg. |
| Veranda's | `built.porch` (nu bij elk gebouw, geschaald mee - elk huis is 0.96-1.04 van zichzelf en kreeg er voorheen geen) wordt twee **alleen-vloeren** (`floor: true` in de blockerlijst, `solids.js porchFloor`): de bovenste tree op 0.18 en de onderste op 0.08, elk een lichaamsbreedte (0.16) ruimer, want de bovenste steekt maar 0.12 buiten de muur. STEP_UP snapt de voeten erop en eraf. Niet via `setSurfaces`, zodat het de `surfacesOf` van de Kraken-branch niet in de weg zit. | De keeper: "snap op de stoep". De bovenste tree is pas bij de deur te halen als de muren-sessie `yaw` in `blockersOf` zet: de omhullende doos van een gedraaid huis steekt voorbij de stoep. |
| Steiger-prop | **Niet hier**: steigers, kades, pieren en boardwalks zijn van de sessie "Repareer vallen van kaderanden en steigers". De steiger-prop blijft zonder blocker en zonder dek. | Afgesproken met de Kraken-sessie. |
| Gasteilanden | Dezelfde bronnen, met hun `origin` erbij: `g.props`, hun landschap, hun grenzen niet (die tekenen ze niet). | Anders loop je bij de buren weer door alles heen. |
| De zee en de settlers | **Onveranderd.** `shared/settlerwalk.mjs` en de zee lezen geen blockers; settlers blijven door bos lopen. | Dit is walk mode van de speler. Een botsende crowd is een ander plan (de zee kent geen props). |

## Fasen

1. **Motor** (`web/js/walk.js`): `yaw` op blockers en surfaces, `r` op surfaces, `top` + `STEP_ONTO`, het
   rooster. Niets anders gebruikt het nog, dus het eiland loopt precies als nu.
   Test `tests/walk-solids.test.mjs` (harnas van `tests/diving-walk.test.mjs`): langs een bank op 45°
   lopen waar de AABB zou blokkeren; om een cirkel heen; een stoep van 0.18 op stappen, een krat van 0.3
   niet maar wel erop springen en blijven staan; over een rail van 0.32 springen, niet over een heg van 0.5;
   rooster = lineair op 2.000 willekeurige vormen.
2. **Props** (`web/js/props.js`): `propSolids(p)` per vorm (bank georiënteerd, put/beeld/kampvuur rond,
   boom als stam, kei/krat/ton met top, kar georiënteerd; de steiger niet, zie hierboven), plus
   `g.props` op gasteilanden. `propFootprint` blijft voor de ghost en de workbench (die willen "past het
   hier", niet "waar botst het"). Test `tests/prop-solids.test.mjs` + een headless loop over een steiger.
3. **Bos** (`web/js/world.js` `createLandscape` → `solids()`, ook `orchardTrees`): stammen en keien; bij
   `fellTrees` opnieuw aangeven. Gasteilanden via hun eigen landschap. Meten: aantal vormen en de tijd van
   `blocked` op een kopie van Hoogezand, voor en na.
4. **Grenzen** (`web/js/hamlets.js` `buildBorders` → `solids` + dichte randen; `walkBodyTo` in main.js).
   Vóór het aanzetten meten op een kopie van `~/.promptholm`: vanaf elke voordeur een route naar het plein
   met de randen dicht. Een huis dat dan opgesloten zit is een bug in de poorten, geen reden om de heg
   open te laten.
5. **Veranda's**: `porchFloor` in `main.js porchOf` en `guest-island.js`; test met een echt huis in
   `walk-solids`.

Elke fase is los te mergen; 1 is de enige die de rest nodig heeft. Geen layout-gate, geen bundle-veld,
geen `SEA_V`: alles is pagina, dus het mag in een patch.

## Wat er gebouwd is

- `web/js/solids.js` (nieuw, puur): `insideSolid` (cirkel, rechthoek, gedraaide rechthoek), `surfaceHeight`
  (ook rond en gedraaid), `topOf`, `createSolidIndex` (emmers van 2 × 2, zoekt met pad · √2 omdat een
  gedraaide rechthoek met een vierkant in zijn eigen frame groeit).
- `web/js/walk.js`: blockers en surfaces via de index, `top` + `STEP_ONTO`, `hop` (+ eruit lopen, + de
  route springt), en `park()` neemt nu de blockers die main.js meegeeft - die werden genegeerd, dus een
  lichaam dat na het opstarten geparkeerd stond liep zijn routes (en zocht ze) dwars door alle huizen.
- `web/js/props.js` `propSolids` per vorm (`propFootprint` blijft voor de ghost en de modeltest). Onderweg
  gevonden: het oude blok van een `panel` stond dwars op het bord.
- `web/js/hamlets.js` `buildBorders(…, out)` → `solids` + `closed` (`edgeKey`); `web/js/world.js`
  `createLandscape` → `solids()` (bomen, boomgaard, keien, grenzen; opnieuw na vellen, herplanten, nieuwe
  grenzen of nieuwe grond) en `closedEdges()`; `guest-island.js` geeft die van de buren mee (id `land`).
- `main.js`: `walkableBlockers` neemt props van de buren en het landschap mee, `walkBodyTo` houdt dichte
  grenzen dicht en omzeilt een stam in het midden van een cel.
- `/demo` → Hitbox tekent rond rond, gedraaid gedraaid en zo hoog als `y1`.
- Tests: `walk-solids`, `prop-solids`, `boundary-solids`; `volcano-guest` telt de keien van de vulkaan niet
  als gebouw.

Gemeten op een kopie van Hoogezand: 31.861 blockers (28k cirkels, 2.163 met een top, 1.690 hops, 900 dichte
celparen), 2,5 µs per `blocked()`. Van de 408 voordeuren zijn er 11 niet vanaf het plein te bereiken, met én
zonder de grenzen dicht dezelfde 11 (op het water of op een dek): de grenzen sluiten niemand in.

## Later

- Boten aan de steiger en de vloot als bewegende blockers (zoals `peerBlockers`), zodat je niet door een
  Benchy zwemt.
- Bankjes en tafels waar je op gaat zitten (`sitOn` bestaat al) — een ander plan.
