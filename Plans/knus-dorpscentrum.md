# Een knus dorpscentrum, met winkelstraten

Begonnen op 26 september 2026. De vraag: meer gebouwen in het centrum (bakkerij, slager,
bibliotheek, apotheek, kledingwinkel, toverstokkenwinkel, kruidenier), en het dorp knusser
ingedeeld, zoals Hogsmeade in Hogwarts Legacy: winkels schouder aan schouder langs straten,
het plein blijft een dorpsplein, en ambachten als de zagerij staan niet in het centrum. De
planner mag ervoor wijken als het moet — dat blijkt niet nodig (zie onder).

## Stand van zaken

Gebouwd op 26 september 2026, op `claude/dorpscentrum`: de indeling (`TOWN_PLAN` in
`lib/layout.mjs`), `TOWN_VERSION` 1, de negen winkelmodellen, de slagerij uit zijn worktree,
de bakkerij en de slager met hun vuur en hun slager op het eiland, de straten in `town.paved`
en `town.streets`, en de borrel die op het plein blijft (`gatherCells`). Alle 948 tests groen;
`tests/town-plan.test.mjs` houdt de indeling vast.

Gemeten op een kopie van het live eiland (113 settlers, grid 288), met de scan van deze branch:
**geen van de 163 huizen en schuurtjes verplaatst**, de tweede scan byte-identiek. Het plan past
daar niet helemaal: de westkant van het plein en zeven van de zestien straatkavels liggen op
grond die te steil of nat is, en op de westkavel van de ring staan twee verweesde schuurtjes. De
klokkentoren en de bibliotheek staan daarom in een straat, een paar winkels op het
dichtstbijzijnde vrije blok ernaast, en de zagerij en de smidse staan nu ver in het westen.

**Waar het de dierentak raakt.** `codex/dierenverhalen` (Plans/stal-en-veld.md) maakte de
bakkerij (65) en de stal (75) tot ambachten via `TRADES`, en het live eiland heeft ze al zo
staan. Bij het samenvoegen: de bakkerij houdt trede 12 op de hoek van het plein (dat vroeg de
keeper: meer in het centrum), dus de trede op 65 en `bakery` in hun `TRADES` vervallen; de stal
houdt hun trede 75 en is hier al een ambacht. Hun bakker (`web/js/bakery-keeper.js`) hoort bij de
bakkerij, waar die ook staat. `TOWN_LAID` tilt beide mee, zodat de migratie ze op hun plek zet.

## Wat er al is

- **Het plein** groeit van 3 naar 7 breed (`SQUARE_STEPS`), met fontein, put, beeld, tafels,
  borden en meubilair op vaste plekken (`ON_SQUARE`, `FURNITURE_SPOTS`).
- **Acht kavels van 3x3 in een ring om het plein** (`CIVIC_LOTS`), met gaten van twee cellen
  ertussen. `town.lots` wordt één keer bepaald (alleen wat bij de stichting vrij was) en is
  kleverig: het live eiland heeft er 6, waarvan 2 vrij.
- **Wat het rommelig maakt** is alles eromheen: de zagerij en de smidse staan pal naast de ring
  (`TRADES` pakt het dichtstbijzijnde vrije blok van het rooster), markt, kapel en school staan
  naast hun kavel (door de keeper verplaatst), de goudkuil staat waar toevallig plek was.
- **Bakkerij**: model bestaat (`civic_bakery`, 900 driehoeken, oven met gloed), alleen op
  `/demo`, geen trede. **Slager**: alleen ongecommit werk in de worktree `slagerij` (model,
  animatie, tests; `Plans/slagerij.md` daar). **Kruidenier**: alleen de zaadkraam van de markt.
- **In de kern staat geen enkel huis** op het live eiland (107 settlers): opnieuw indelen kan
  zonder dat er een huis beweegt. Er liggen wel vier verweesde schuurtjes (twee in de kern);
  die blijven staan als obstakel, zoals alles wat een settler toebehoort.

## De indeling

Een molentje van vier winkelstraten, elk twee cellen (8 m) breed, die het plein verlaten door
één van de twee openingen per zijde, met de klok mee. Langs elke straat staan kavels van 3x3
zonder tussenruimte, met de voorkant naar de straat. De ring om het plein blijft, en is nu aan
alle kanten dicht op de openingen na: het plein is een ruimte met gevels eromheen.

```
      x:  -12      -6        0        6       12
 -12  ..............iii==mmm.........
 -11  ..............iii==mmm.........
 -10  ..............iii==mmm.........        #  het plein (7x7)
  -9  .........GGG..aaa==eee.........        =  straat, twee cellen breed
  -8  .........GGG..aaa==eee.........        H  stadhuis     V  herberg
  -7  .........GGG..aaa==eee.........        P  kapel        K  klokkentoren
  -6  ...ppphhhLLL..HHH==MMM.........        M  markthal     B  bakkerij
  -5  ...ppphhhLLL..HHH==MMM.........        E  theehuis     L  bibliotheek
  -4  ...ppphhhLLL..HHH==MMM.........        a..p straatkavels, in de volgorde
  -3  ...=========#######............             waarin ze vollopen
  -2  ...=========#######............        G  goudkuil, achter de bibliotheek
  -1  ...llldddKKK#######VVVbbbjjj...
   0  ...llldddKKK#######VVVbbbjjj...
   1  ...llldddKKK#######VVVbbbjjj...
   2  ............#######=========...
   3  ............#######=========...
   4  .........EEE==PPP..BBBfffnnn...
   5  .........EEE==PPP..BBBfffnnn...
   6  .........EEE==PPP..BBBfffnnn...
   7  .........ggg==ccc..............
   8  .........ggg==ccc..............
   9  .........ggg==ccc..............
  10  .........ooo==kkk..............
  11  .........ooo==kkk..............
  12  .........ooo==kkk..............
```

- **De ring (8)** is voor wat bij het plein hoort: stadhuis, herberg, kapel en klokkentoren in
  het midden van elke zijde, met de voorkant naar het plein; markthal, bakkerij, theehuis en
  bibliotheek op de hoeken, met de voorkant naar de straat die naast ze begint.
- **De straten (16)** zijn voor de winkels. Ze lopen vol vanaf het plein naar buiten, om en om
  over de vier straten (`a` tot en met `p`), dus alle vier de straten groeien tegelijk. School
  en watertoren pakken juist de buitenste vrije kavel: geen toren midden in een winkelrij.
- **De twee andere openingen per zijde** blijven steegjes waar de wegen van de wijkjes binnen
  kunnen komen. De straten zijn gewoon plein voor de router: een weg die een straat bereikt, is er.
- **De goudkuil** staat achter de bibliotheek, naast het plein zoals `Plans/goudkuil.md` wil,
  en niet op een straatkavel.
- **Ambachten** (zagerij, smidse; later stal en de werkplaats van de slager) staan buiten de
  straten: het dichtstbijzijnde vrije blok van het rooster op minstens vier super-cellen van
  het centrum, op grond van de stad of van niemand, en die grond gaat naar de meent
  (`claimForTown`, zoals het kasteel). Het kasteel blijft waar het staat.
- **Alles op het 3x3-rooster van nu**, dus de planner blijft werken: de nieuwe winkels komen in
  `MOVABLE_CIVICS`, en slepen, draaien en de survey doen wat ze al deden. Smallere gevels (2
  breed) zouden een tiental aannames over `w === d === 3` breken; dat is het niet waard.

## Wat er gebouwd wordt, en wanneer

Treden in `MILESTONES`, in de gaten van de ladder (bestaande treden blijven waar ze zijn):

| trede | gebouw | civicType | plek |
|---|---|---|---|
| 12 | bakkerij | `bakery` | ring, hoek ZO |
| 18 | kruidenier | `grocer` | straat |
| 22 | apotheek | `apothecary` | straat |
| 28 | kledingwinkel | `tailor` | straat |
| 33 | bibliotheek | `library` | ring, hoek NW |
| 38 | theehuis | `tearoom` | ring, hoek ZW |
| 42 | toverstokkenwinkel | `wandmaker` | straat |
| 48 | slagerij | `butcher` | straat |
| 65 | snoepwinkel | `sweetshop` | straat |
| 80 | ketelmaker | `cauldron` | straat |
| 85 | uilenpost | `owlpost` | straat (niet 75: dat is de trede van de stal) |

Besloten op 26 september: alle vier de extra's uit Hogsmeade (theehuis, snoepwinkel, uilenpost,
ketelmaker), en de slager meteen mee: zijn werk uit de worktree `slagerij` is gecommit op
`claude/slagerij` en gemerged. Een eiland met meer settlers krijgt alle treden die het al
gehaald heeft in één scan. Straatgebruikers zijn er daarmee tien (acht winkels, school,
watertoren); zes straatkavels blijven over voor later.

**De modellen** volgen de huisstijl van het dorp dat er al stond, met één ding van Hogsmeade
erbij: stenen voet, crème pleister met eikenhouten vakwerk, een terracotta pannendak op zo'n 45
graden zoals de herberg en de bakkerij, een scheve schoorsteen (`anchor.smoke`), en per winkel
één sterke kleur in de pui en één herkenbaar ding als uithangbord in geometrie (geen letters:
gebakken modellen hebben geen textuur). **Op de maat van het dorp**: zo groot als de herberg
(1,8 × 1,6 × 1,7), dus 1,6–1,8 breed, 1,2–1,4 diep, nok op 1,5–1,75, naar de straat toe op hun
kavel, voordeur midden op de voorgevel (`anchor.door`). De eerste versie was Hogsmeade letterlijk
- donkere leien daken, 2,9 breed en 3,4 hoog, tot de rand van de kavel - en stak twee keer zo
groot en zwart af tegen de vakwerkhuizen met hun rode daken; de keeper zag het op het eiland en
dezelfde dag zijn ze op deze maat opnieuw gebakken. Eén set per winkel (`scripts/build-<set>.py` →
`assets/<set>/` → `web/js/<set>-mesh.js`), gemaakt door parallelle agents; de registratie
(`models.js`, `buildings.js`, `/demo`, `tests/models.test.mjs`) doe ik in één keer. Geen
beschermde namen of herkenbare combinaties (geen monogram, geen tweelingtorentjes in roze en
groen, geen slogans).

## De migratie: `TOWN_VERSION`

Geen bestaande poort deelt de stad opnieuw in zonder de huizen: `SQUARE_VERSION` ruimt alleen
overlap op, `PARCEL_VERSION` plant alle huizen opnieuw. Dus een nieuwe, zo klein mogelijke:

- Voor een layout met `townV` onder `TOWN_VERSION`: weg met de 3x3-plots van de stad (stadhuis,
  markt, herberg, klokkentoren, school, watertoren, kapel, zagerij, smidse, goudkuil), de
  brievenbus, hun `path:civic:*` en `town.lots`. Daarna zetten de gewone lussen alles terug
  volgens de indeling hierboven, in dezelfde scan.
- **Blijft**: het plein en zijn midden (`town.centre` — het ankerpunt van het rooster hangt eraan,
  dus verschuiven zou elk wijkje verschuiven), alles óp het plein, het kasteel, molen,
  vuurtoren, poldermolen, kraan, brug, kantoortjes, alle huizen en schuurtjes, de wegen van de
  wijkjes en van de keeper.
- Een kavel wordt alleen genomen als al zijn cellen vrij zijn; een huis of schuurtje is een
  obstakel en het gebouw schuift door naar de volgende plek van zijn soort, en anders naar
  `findBlockAround` zoals nu.
- Wat de keeper eerder met de hand verplaatste (markt, kapel en school op het live eiland) gaat
  één keer terug naar de indeling. Daarna kan hij weer schuiven.
- Het is een layout-poort, dus de volgende release is **0.6.0**, geen 0.5.x-patch.
- Nieuwe eilanden dragen `townV` vanaf de stichting (`emptyLayout`) en krijgen de indeling vanzelf.
  Daar wordt ook vastgehouden wat nog komen moet: de kavels en straten van het schema die op de
  grond van de stad liggen (de kern, en de meent zodra die groeit) zijn `RESERVED` vanaf de
  eerste scan, zoals de ring nu al. Anders kan een huis dat in zijn eigen wijkje geen plek vindt
  en op de meent terugvalt precies op een toekomstige winkel gaan staan — en een huis beweegt
  nooit meer. Wat buiten de grond van de stad valt, wordt vastgehouden zodra de meent er komt.

Meten, zoals `docs/branches.md` het vraagt: op een kopie van de live `layout.json`, met het
eiland gestopt. Geen huis of schuurtje verplaatst (`diffLayouts`), geen huis zonder weg naar
het plein, de tweede scan byte-identiek, en de indeling zoals het schema.

## Later, niet in deze ronde

- Winkeliers als bewaarders van hun gebouw (`KEEPERS`, zoals de kroegbaas): de bakker achter
  zijn oven, de apotheker in de deur.
- Een naambord met echte letters boven de deur (`anchor.sign` + `createNameplate`): kost een
  canvas en drie meshes per winkel, en niets op de eilanden van buren.
- De stal, het veld en de dieren (`Plans/stal-en-veld.md`) als ambacht buiten de straten.
