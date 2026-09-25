# Het kasteel op twee bij twee super-cellen

**Status: gebouwd op 25 september 2026.** Onderaan staat wat er nog openstaat.

## Wat Tiemen vroeg

> Kun je de castle 4 cellen groot maken? Het is nu een erg klein kasteeltje in verhouding
> met de townhall. [...] Ik bedoel niet 1x1 gridcel maar 2x2 gridcellen, dus 4 keer zo groot.

Met een screenshot uit de planner, waarop een rood kader om het kasteel en de grond linksboven
ervan staat. De "gridcellen" van de planner zijn super-cellen: vier bij vier gewone cellen
(`PITCH`), een kavel van drie bij drie plus een laan. Het kasteel stond op zo'n kavel en was
~2,4 cel breed - even breed als het stadhuis en met opzet lager (`scripts/build-castle.py`:
"the roofline stays below the town hall's cupola"). Vier keer zo groot is dus: twee bij twee
super-cellen grond, en een model dat twee keer zo breed is.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Hoe groot is de kavel | **7 bij 7** (`CASTLE_LOT = 2 * PITCH - 1`): twee kavels en de laan ertussen, in beide richtingen. De buitenste laan blijft laan. | Dat is precies wat twee bij twee super-cellen aan bouwgrond hebben; een 8 bij 8 zou de lanen van de buren opeten, en de lanen zijn waar de wegen van de wijkjes lopen. |
| Hoe groot is het model | ~~Meegeschaald met de kavel: `w / 3`~~ - zie *Het kasteel op zijn echte maat* hieronder: **een eigen bake, `assets/greatcastle`, gebouwd op 7 bij 7**, met een poort en ramen op de maat van het stadhuis. Een 3 bij 3 houdt de oude bake. | Uniform schalen maakte de muren goed en alles waar je een gebouw aan afmeet fout: de poort werd een cel breed en anderhalve verdieping hoog. |
| De stoep eromheen | **Niet meegeschaald.** De porch wordt ná het schalen om het model gelegd, dus de trede blijft `PORCH_RISE` hoog en de rand `PORCH_OVER` breed. | Een trede van 2,33 keer zo hoog is een muur, en een settler loopt de trede op. |
| Een nieuw kasteel (100 settlers) | **Het dichtstbijzijnde blok van twee bij twee super-cellen op het rooster** rond het plein waarvan alle 49 cellen `FREE` zijn, de grond van de stad of van niemand is (geen wijkje), en het hoogteverschil binnen de kavel hooguit `CASTLE_RELIEF` (0,6) is. Niet meer via `takeCivicLot`. | De acht civic-kavels zijn drie bij drie en liggen met opzet naast het rooster; daar past een 7 bij 7 niet in. Het hoogteverschil moet mee, omdat de stoep maar `PORCH_SKIRT` (0,7) de grond in reikt en een 7 bij 7 op een helling die elke 3 bij 3 goedkeurt toch een hoek in de lucht heeft. |
| Van wie is die grond | Super-cellen die van niemand waren gaan naar **de commons** (`layout.town.commons`, en in dezelfde scan `sup.claim(…, TOWN)`). | Anders ziet een wijkje een super-cel waar een kasteel op staat als vrije grond om te claimen, en kan het er nooit een huis op kwijt. Commons is waar de stad haar grond al bijhoudt; de planner (`plan.mjs`, `survey.mjs`) leest het daar ook. |
| Een kasteel dat er al staat | **Groeit op zijn plek**, één keer, zodra dat kan: elke 7 bij 7 die zijn oude 3 bij 3 bevat, met alle nieuwe cellen `FREE` en dezelfde eisen voor grond en helling. Voorkeur: eerst een kavel die **de voorkant laat liggen waar hij lag** (de kant van de poort), dan een op het rooster, dan het dichtst bij het plein. De draaiing blijft. | "Een huis verhuist nooit vanzelf" geldt ook hier: de scanner verplaatst het kasteel niet, hij laat het uitdijen over grond die niemand gebruikt. De voorkant laten liggen betekent dat het plein en de weg naar de poort blijven waar ze waren. Gemeten op dit eiland (seed 1337): linksboven (het rode kader) loopt de grond in de hoek met 1,3 af naar de vijver en vijf cellen zijn onbebouwbaar; rechtsboven is vlak (1,4–1,7) en vrij, en houdt de voorkant op gz 121. |
| Als het niet past | **Het kasteel blijft 3 bij 3** en wordt op zijn oude maat getekend. Elke scan kijkt opnieuw (vier tot vijfentwintig kandidaten van 49 cellen, niets). | Verplaatsen naar een ander stuk grond is de planner zijn werk, niet de scanner zijn. |
| De weg naar de poort | **De oude weg blijft liggen**; de nieuwe poort krijgt een stuk weg erheen onder dezelfde naam (`path:civic:castle`), zonder cellen die al in het record staan. | Eruit halen en opnieuw leggen kan niet veilig: een weg die later over de cellen van het kasteel is gelegd heeft ze niet opgeschreven (`markPath` noteert alleen wat hij zelf bestraat), dus op papier zijn ze alleen van het kasteel en in het echt misschien de weg van een wijkje naar de stad. `castleSite` weigert elke wegcel, dus de oude weg ligt nooit onder de nieuwe kavel, en met de voorkant op zijn plek loopt hij gewoon voor de poort langs. Gemeten op seed 1337: de nieuwe poort komt uit op de oude weg en er komt geen cel bij. De filter is er omdat `markPath` een pleincel die hij al kent nog eens teruggeeft. |
| Een eigen weg dwars door de groeiplek | **Dan groeit het niet.** | Gezien in de test: een deur tegen een ander perceel wordt door `nearestWalkable` om de hoek gelegd, en die weg loopt dan door de grond waar het kasteel in wil. Die weg mag weg zijn als niemand anders er gebruik van maakt, maar dat staat nergens op (zie hierboven), dus de scanner raakt hem niet aan. |
| Deuren | `doorCell` en `outsideDoor` krijgen een breedte (`w = 3` als standaard); `scan.mjs`'s `doorOf` is `doorCell` geworden in plaats van een kopie ervan, en geeft voor elke kavel van 3 of breder een deur. | De poort van een 7 bij 7 staat in het midden van zijn voorkant, niet één cel naast de hoek. |
| Versie-poort | **Geen.** De voorwaarde (`w < CASTLE_LOT`) is de poort; een tweede scan verandert niets. | Een nieuwe poort in `layout.json` is iets wat een oudere versie verkeerd leest. Een kasteel met `w: 7` leest elke versie goed: `replayGrid` en `placeAll` vullen `w × d`, `parseBundle` neemt 1 tot 16, en een oudere pagina tekent het ongeschaalde kasteel midden op zijn kavel. |

## Wat er veranderd is

- `lib/layout.mjs` - `CASTLE_LOT`, `CASTLE_RELIEF`, `lotOf`, `castleSite`, `claimForTown`,
  `growCastle`; `doorCell`/`outsideDoor` met breedte; de milestone-lus, de civic-road-relay en
  de frontage lezen `p.w` in plaats van een vaste 3.
- `scan.mjs` - `doorOf` is `doorCell`.
- `web/js/buildings.js` - het kasteel schaalt met zijn kavel. (Later dezelfde dag vervangen door
  een eigen bake, zie *Het kasteel op zijn echte maat*.)
- `tests/castle.test.mjs` - de deuren, een nieuw kasteel op drie seeds, het groeien, het
  niet-groeien en het model. `tests/layout-measure.test.mjs` telt een civic-kavel vanaf 3 breed.

## Gemeten op het eiland zelf

Een kopie van `data/layout.json` + `cache.json` gescand met de oude en de nieuwe code (zelfde
`banished`/`arrivals`/`assignments`): het kasteel gaat van `{123,119} 3x3` naar
`{123,115} 7x7`, rot 2, voorkant op gz 121 zoals hij was; **geen ander perceel en geen andere
weg verandert**, de commons blijven 43 super-cellen (alle vier waren al van de stad), en een
tweede scan is byte-voor-byte gelijk.

`tests/layout-measure.test.mjs` faalt op deze data op drie punten (44 huizen niet naar het
plein, 10 civic-wegen tegen 9 kavels, `road:quay:0` 97 cellen) - **met en zonder deze
wijziging**, dezelfde drie in de hele suite, dus dat is het wegennet van het live eiland en
niet het kasteel.

## Het kasteel op zijn echte maat

**Gebouwd op 25 september 2026**, dezelfde dag, na Tiemen:

> pas the castle aan zodat de deuren in verhouding staan. het kasteel is 4 keer zo groot
> gemaakt maar past daarom niet bij de rest van het dorp

Het uniforme `w / 3` hierboven schaalde niet alleen de muren maar alles: de poort werd 1,00 breed
en 1,50 hoog, tegen de dubbele deur van het stadhuis van 0,48 bij 0,72 - bijna vier settlers
hoog. De ramen waren zo groot als die deur, het wapenschild boven de poort breder dan de gevel
van een huis. Een deur is een mens breed, wie hem ook bouwt (`build-village.py` zegt dat al van
de kerk): een groter gebouw heeft meer ramen en meer verdiepingen, geen grotere.

| Vraag | Besluit | Waarom |
|---|---|---|
| Schalen of opnieuw bouwen | **Opnieuw bouwen, op zijn echte maat**: `scripts/build-greatcastle.py` → `assets/greatcastle/greatcastle.blend` → `web/js/greatcastle-mesh.js`, een eigen hero-set (4000 driehoeken; hij gebruikt er 3849). | Een schaal kan een poort niet kleiner maken dan de muur eromheen. Hetzelfde kasteel - bakstenen donjon onder een crème bovenzaal, vier ronde torens met pannendaken, een stenen poortgebouw ervoor - met de massa van het 7/3-kasteel en elk detail op de maat van het stadhuis. |
| Hoe groot is de poort | **0,56 bij 0,86**, tegen 0,48 bij 0,72 van het stadhuis. `tests/castle.test.mjs` houdt hem tussen 1 en 1,35 keer die deur. | Een kasteelpoort is grootser dan een raadhuisdeur, maar met een hand, niet met een verdieping. De test meet de gebakken onderdelen zelf, zodat een volgende bake dit niet stil terugdraait. |
| De ramen | **Die van het stadhuis** (ruit 0,16 bij 0,25, kozijn, middenstijl, dorpel), twee rijen op elke gevel die de torens openlaten: drie vakken achter en op beide zijkanten, één naast het poortgebouw aan elke kant van de voorkant. Drie per toren, alleen naar buiten. | Verdiepingen zijn wat een groot gebouw van ver als groot laat lezen. Een raam aan de voorkant van een achtertoren kijkt de donjon in; het oude kasteel had ze wel, hier niet. |
| Hoe hoog | **Iets lager dan het geschaalde**: dakgoot 2,44 (was 3,03), torens tot 4,5, de vlag op 5,16. Nog steeds ruim anderhalf keer het stadhuis (2,91). | Drie verdiepingen van dorpsramen - een bakstenen begane grond waar de poort in past en twee crème erboven op de 0,72 van het stadhuis - is wat een donjon van deze breedte draagt; de torens hebben er één meer. De plattegrond is die van het 7/3-kasteel, 4,7 breed op zijn 7 bij 7, dus de kavel en de laan eromheen veranderen niet. |
| Het wapenschild | **Een schild**, brons met een groen veld, geen vierkant. | Een bronzen vierkant boven de poort las van over het plein als nog een raam. |
| De 3 bij 3 | **Houdt de oude bake**, ongewijzigd. `buildings.js` kiest op `plot.w`: 7 of breder is het grote kasteel, al het andere het oude. | Het wachthuis op de vulkaan wordt als dat kasteel getekend (`GUARDHOUSE_LOOKS_LIKE`), en `GUARDHOUSE_REACH` is eraan gemeten; een kasteel dat nog niet kon groeien blijft wat het was. Het grote kasteel op 3/7 tekenen gaf een speelgoedpoort. |
| Versie-poort | **Geen.** | Er verandert niets in `layout.json`, `config.json` of een bundel; het is alleen wat de pagina tekent, en een oudere pagina tekent een 7 bij 7 zoals hij dat al deed. |

## Open

- De achtste civic-kavel. De acht kavels rond het plein waren precies het stadhuis en de zeven
  drie-bij-drie mijlpalen; het kasteel neemt er nu geen meer, dus op een nieuw eiland blijft
  er één `RESERVED` liggen. Het is grasland naast het plein; een volgende mijlpaal kan hem
  krijgen.
- Het bos. `createLandscape` strooit één keer per paginalading, dus bomen die op de nieuwe
  grond stonden staan er tot de volgende reload (zelfde beperking als bij de planner).
