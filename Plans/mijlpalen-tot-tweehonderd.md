# De ladder tot tweehonderd: de haven, het VOC-schip en de vloot

Begonnen op 28 september 2026. **Status: gebouwd op de branch `mijlpalen-tot-tweehonderd` (28 september), nog niet op main en nog niet op het eiland.** Onderaan staat wat
Tiemen nog moet beslissen.

## Wat Tiemen vroeg

> ja, zet een voorstel voor 100–150 in Plans/ neem ook een betere verdeling mee. de spreiding mag
> wel van 0-200. ik wil ook een groot schip zoals die van de voc bij 120-ish inwoners en misschien
> moet de vloot uitgebreid worden bij nog meer inwoners omdat het centrum vol is.

## Stand van zaken

De ladder (`MILESTONES` in `lib/village.mjs`) heeft 30 treden: 29 tellen settlers, de school telt
leerlingen.

| stuk | treden | afstand |
|---|---|---|
| 0–50 | 18 | 2 à 3 |
| 51–100 | 9 | 5, en dan 10 naar het kasteel |
| 101–150 | 1 (de poldermolen, helemaal aan het eind) | **50** |
| 151–200 | 1 (de kraan op 165) | daarna alleen elke 25 een polder |

Het echte eiland (28 september): 112 settlers, 28 van de 30 vrijgespeeld. Het tempo is 10 → 112 in
18,4 dagen, zo'n **5,5 per dag**, en opvallend gelijkmatig (90 → 112 in 3,9 dagen is 5,6 per dag).
Een gat van g settlers is dus g/5,5 dagen: vanaf nu ongeveer een week niets tot de poldermolen, en
na de kraan (over ~10 dagen) is de ladder op.

Wat verder op aantallen telt vult 100–150 ook niet: `SQUARE_STEPS` (30, 90), `FAIRWAY_AT` 25,
`BRIDGE_AT` 90, `POLDER_AT` 150 plus elke `POLDER_EVERY` 25, en het meubilair op leerlingen
(`FURNITURE`, tot het laatste terras op 330).

**Gemeten bij het schrijven: de kraan komt op het echte eiland nooit.** Hij wil
`layout.districts.quay` (`lib/layout.mjs:3293`: "No quay district means no planks, and the crane
waits"), en dit eiland heeft geen kade-wijk: er is nooit een Cowork-taak geweest die er een
stichtte. Wel vier havens met elk een steiger van vijf planken (`layout.harbours`, n/e/s/w). Dat
lost dit plan meteen mee op, zie "De kadehaven" hieronder.

## De regel voor de verdeling

Het gat groeit met één settler per 25: **afstand ≈ 2 + n/25**. Dan staat trede k op
n = 50·(e^(k/25) − 1), en is het aantal treden tot n gelijk aan 25·ln(1 + n/50):

| tot | volgens de regel | nu | voorstel |
|---|---|---|---|
| 50 | 17 | 18 | 18 |
| 100 | 27 | 27 | 28 |
| 150 | 35 | 28 | 35 |
| 200 | 40 | 29 | 40 |

Het stuk 0–100 volgt de regel dus al: het is met de hand in stappen opgebouwd en ligt er toch op,
op één trede na. Het probleem zit alleen boven de 100. "Een betere verdeling" betekent in dit plan
dan ook drie dingen:

- de ladder loopt op dezelfde kromme door tot 200, met elf nieuwe treden;
- tussen de treden groeit er per settler iets;
- daardoor duurt geen stuk langer dan ~9 settlers (bij het huidige tempo minder dan twee dagen)
  zonder dat er iets nieuws verschijnt.

**Geen bestaande trede verschuift.** Nagelezen in de code (niet op het eiland geprobeerd): een
trede waarvan `at` boven het aantal van het eiland komt, gaat weer op slot (`unlocked: !!nth`,
`lib/village.mjs:615-622`). Maar zijn kavel blijft in `layout.json` staan: gestempeld, met zijn pad
en zijn straat geplaveid. Het eiland toont dan een lege kavel met een weg ernaartoe. Als het aantal
het nieuwe getal haalt, komt het gebouw op dezelfde plek terug en laat `main.js` de toast van de
mijlpaal nog een keer zien. Op het echte eiland zou dat gelden voor elke trede die boven 112 komt
te liggen.

Daar komt bij dat de eerste 50 de haak van een nieuw eiland zijn: elke twee à drie sessies iets.
Juist daar zou je treden weghalen. Wil Tiemen toch spreiden, dan staat de regel ervoor onder Open
(`was`).

## Waarom niet in het centrum

- Het plein groeit sinds 90 niet meer (`SQUARE_STEPS`), en de acht kavels van de ring zijn alle
  acht vergeven (`RING_OF`).
- Op papier zijn er van de zestien straatkavels zes vrij (#8–#13). Op het echte eiland is na de
  verplaatsingen van de bewaarder alleen straatkavel #6 op [-6,7] nog helemaal open. De rest ligt
  deels in de rivier of aan de kust, is geplaveid, of er staat een huis, de windmolen of de school.
  Al een tweede nieuwe 3x3 in het dorp valt terug op `findBlockAround`. Dat kijkt niet naar de
  eigenaar van de grond en geeft de kavel ook niet aan het dorp.
- Elke nieuwe trede gaat daarom naar een van drie plekken:
  - **de kadehaven** (hieronder);
  - **het water**: de rede;
  - **buiten het dorp**: `TRADES`/`TRADE_RING`, zoals de zagerij.

  De haven wordt het tweede centrum, en het water is de ruimte die het land niet meer heeft.

## De kadehaven

Het woord in dit plan voor de haven waar de haven-gebouwen komen:

- de haven van de kade-wijk als die er is;
- anders de haven van de kade die het eiland al liet zien (`standingQuay`: de kant waar de eerste
  boot van het eiland ligt);
- anders de haven het dichtst bij het dorp (`nearestHarbour`).

Op het echte eiland is dat waarschijnlijk de noordhaven: de landing ([180,88]) ligt ten noorden van
het plein ([144,144]). Dat wordt nagemeten in stap 1.

De kraan krijgt dezelfde terugval, zodat hij ook zonder kade-wijk een plek vindt. Hij zoekt dan
naast de helling van die haven (`road:harbour:<n>`), met dezelfde regels als nu: niet op de planken,
niet op de helling zelf, met de arm naar het water.

## De nieuwe ladder, 90–200

| trede | wat | civicType | waar | |
|---|---|---|---|---|
| 90 | De plankenbrug | `bridge` | | bestaat |
| **95** | **De scheepswerf** | `shipyard` | kadehaven, met een helling het water in | nieuw |
| 100 | Het kasteel | `castle` | | bestaat |
| **106** | De brouwerij | `brewery` | `TRADES` | nieuw |
| **113** | De vissershut | `fishery` | een *andere* haven dan de kadehaven | nieuw |
| **120** | **De Oost-Indiëvaarder** | `ship` | de rede voor de kadehaven | nieuw |
| **127** | Het pakhuis | `warehouse` | kadehaven | nieuw |
| **134** | Het oefenveld | `trainingfield` | `TRADES` | nieuw |
| **142** | De steengroeve | `quarry` | hoge, rotsige grond (eigen regel, zoals de windmolen) | nieuw |
| 150 | De poldermolen, en de eerste polder | `poldermill` | | bestaat |
| **158** | Het tweede schip | `ship` | de rede | nieuw |
| 165 | De havenkraan | `crane` | kadehaven (met de terugval hierboven) | bestaat |
| 175 | De tweede polder | — | | bestaat (`POLDER_EVERY`) |
| **184** | De waag | `weighhouse` | kadehaven | nieuw |
| **192** | Het derde schip: de retourvloot | `ship` | de rede | nieuw |
| **200** | Het kroniekhuis | `chronicle` | `TRADES`, of naast het kasteel | nieuw |

Het verhaal: na het kasteel keert het dorp zich naar zee. De werf legt op 95 een kiel, en 25
settlers later gaat het schip te water. Het schip brengt de handel mee waar de haven van leeft
(pakhuis, kraan, waag). De steengroeve levert de steen voor de eerste dijk. En de ladder eindigt
waar het dorp zijn eigen geschiedenis gaat opschrijven.

Waarom elk gebouw er staat:

- **Brouwerij**: de kroeg tapt sinds `Plans/bier-en-dronken.md` bier, en dat moet ergens vandaan
  komen.
- **Vissershut** (`Ideas/Ideas.MD` §15): netten, een droogrek, een roeiboot en een visser, een
  passieve settler zoals de smid. Bewust aan een andere haven, zodat elke haven iets eigens krijgt.
- **Oefenveld** (§16, `Ideas/Images to Render/trainingarea.png`): strooien poppen en een
  zwaardenrek, bij het vechten uit `Plans/aanvallen-en-blokkeren.md`.
- **Steengroeve** (§15): de steen voor de dijk van 150, op de hoogste rotsige grond.
- **Waag**: weegt wat de schepen brengen, met een torentje.
- **Kroniekhuis** (§10, §17): de kroniek als gebouw. Klikken opent `history.js`, zoals het stadhuis
  zijn register opent.

**Een trede gaat pas in `MILESTONES` als zijn model er is.** Een onbekend of ongemodelleerd
civicType wordt als stenen blokje van 0,5 getekend (de `default:` in `civic()`,
`web/js/buildings.js:1643`). De tabel is het doel, en de ladder vult zich in ladder-volgorde naarmate
de modellen gebakken worden.

## Tussen de treden

Dingen die per settler groeien, zodat de stukken tussen de treden niet leeg zijn:

- **Het schip op de helling.** De werf laat de romp in stadia zien, in de Hollandse volgorde van
  haar eeuw (schaalbouw, zoals Witsen het beschrijft): kiel en stevens, de bodemhuid (de
  onderste gangen van de huid, met klampen bijeengehouden en nog zonder spant), de spanten die in
  die bodem worden gezet en tot de hoogte van de zijden oprijzen, en de romp: de bovenhuid, de
  dekken en het hoge achterschip. Dan gaat hij te water. De masten komen er pas na de
  tewaterlating in, aan de kade waar het schip wordt afgebouwd, dus op de rede ligt hij op 120
  meteen getuigd. Voor het eerste schip is dat 95, 102, 109, 115 en 120. Daarna begint de werf
  meteen aan het volgende:
  - het tweede schip: 133, 140, 147, 153, te water op 158;
  - het derde schip: 167, 174, 181, 187, te water op 192.

  Zo is er van 95 tot 192 elke zes à zeven settlers iets aan de helling veranderd. Eén functie
  (`yardStage(n)`, naast `MILESTONES`) rekent het uit. De islander schrijft het resultaat als klein
  veld `stage` (0–4) op het record van de werf, strikt in `parseBundle`. Het moet een veld zijn: de
  bundel draagt geen aantal settlers (`stats` staat er bewust niet in), dus een bezoeker kan het
  niet zelf uitrekenen. Een oudere zee laat het veld vallen, en haar pagina's tekenen dan de lege
  helling.

  Een romp van ~12 past niet op een 3x3. De werf krijgt een kavel van **5 bij 16**, loodrecht op
  de kust:
  - de landkant (minstens zes rijen, strand mag) draagt de loods, de bok en de stapels hout;
  - de helling loopt de zeekant in het water af;
  - de voorkant (+Z) is de zeekant.

  16 is weer de grens van `parseBundle`.
- **De vloot** (130–180): elke vijf settlers een boot, zie hieronder. Op het echte eiland zijn dat
  elf boten in elf stapjes.
- **De polders** (150, 175, 200) en **het meubilair** (op leerlingen, tot 330): bestaan al.

## Het VOC-schip

**Naast het galjoen.** Sinds 28 september (origin/main, Martijn) is de eerste boot van elk eiland
een piratengaljoen dat vaart en waar je over het dek loopt. Dat blijft zo, en mag later ook eerder
of anders verschijnen (Tiemen). De Batavia is het schip dat het dorp verdient en zelf bouwt:
groter, en voor anker.

| Vraag | Besluit | Waarom |
|---|---|---|
| Wat voor schip | Een **spiegelretourschip**, met de Batavia (1628, de replica in Lelystad) als referentie: een hoog achterschip met de platte, beschilderde spiegel en een galerij, drie masten, een boegspriet met blinde, lantaarns op de hek | het schip waar iedereen aan denkt bij "VOC" |
| Hoe groot | **Groter dan het galjoen. Gebouwd: 11,98 bij de waterlijn (48 m), 15,14 over alles met de boegspriet, 2,80 breed, de top van de grote mast 11,50 boven het water.** Alles wat je belopen kunt is op mensenmaat: de kuil (het hoofddek) 1,10 boven het water, zoals die van het galjoen (1,108), bak, halfdek en achterdek 1,60, 1,65 en 2,10, relingen van 0,25, treden van 0,10–0,11 (ruim binnen `STEP_UP`). De ra's zijn korter dan echt (2,35 per kant in plaats van ~3,1), zodat drie schepen op vijf cellen van elkaar elkaar niet raken. (Besloten met Tiemen, 28 september; eerst 10 en 9, tot bleek dat het galjoen al 13 lang is.) | Settlers hebben de maat van het eiland: 0,43 eenheid is 1,72 m, bij 4 m per eenheid. Gemeten op de bakes, in eenheden: de speler 0,45, de deur van het stadhuis 0,72, een huis (`house`) 2,6 hoog, het stadhuis 3,8, het grote kasteel 5 breed en 6 hoog, de Benchy 1,3 lang. Het galjoen dat elk eiland sinds 28 september heeft (`boat:<region>`, Martijn, `scripts/build-pirateship.py`) is 13 lang met de boegspriet, 3,9 breed over de reling (7 over ra's en zeilen), met de top ~10,8 boven het water. Een verdiend schip dat kleiner is dan het gratis schip is geen beloning. De Batavia heeft echte VOC-verhoudingen: langer en slanker dan het galjoen, en hoger getuigd. Op ware grootte (45 m romp, 55 m mast) werd de mast 13,8, twee keer de nieuwe vuurtoren (hieronder); 11,5 houdt het silhouet van het eiland heel. |
| Varen of niet | **Voor anker**, op de rede. Varen komt later, op de techniek die Martijn voor het galjoen bouwde (`CRAFTS` in `shared/crafts.mjs`, `stepOnDeck`, `shipBerth`). (Besloten met Tiemen, 28 september.) | Aan een steiger past hij niet. Een steiger is hoogstens vijf planken (`QUAY_REACH`), en ligplaatsen liggen vast op 2,0 van elkaar (`berthOf`); het galjoen ligt om die reden ook in diep water buiten zijn ligplaats (`shipBerth`). Het klopt ook historisch: VOC-schepen lagen op de rede van Texel, en de lading ging met lichters aan wal. |
| Waar | **De rede**: een strook water van 4 bij 16 cellen, 8 tot 20 cellen van de kop van de kadehaven. De rede ligt evenwijdig aan de kust (de boeg langs de kust, een kwartslag van de steiger), en elke cel moet aan zes eisen voldoen (zie direct onder de tabel). Van de plekken die daaraan voldoen, wint de strook waarvan het midden het dichtst bij de kop ligt. Is er geen plek, dan de volgende haven in `HARBOUR_SIDES`-volgorde. | een gewone plekregel, zoals die van de vuurtoren en de kraan |
| Hoe het in de layout staat | **Als civic-kavel**: `layout.plots['civic:ship']` = `{ gx, gz, w: 4, d: 16, rot }` (bij een oneven `rot` zijn `w` en `d` omgewisseld), zonder deur, en plakkerig zoals elk kavel. Het tweede en derde schip zijn `civic:ship:2` en `civic:ship:3`, met hetzelfde civicType; een trede noemt zijn gebouw met `civicId` (`civicIdOf` in `lib/village.mjs`). | Zo tekenen de bundel, elke pagina en elke bezoeker het via `buildings`, zonder nieuw veld. `planFairway` en `polderCandidate` weigeren al elke cel waar iets op staat, dus onder het schip wordt geen vaargeul gegraven en geen polder ingedijkt. De kroniek, de toast en het dossier komen gratis mee. `parseBundle` neemt een `w`/`d` tot **16** aan, ook als ze verschillen (`plot()`, `lib/islandbundle.mjs`). 16 is dus ook de grens: een langer kavel laat een oudere zee het hele eiland weigeren. Het is het eerste niet-vierkante civic-kavel: `lotOf` geeft `{ w, d }`. |
| Groei | Een groeistap die het water van de rede tot land maakt, verplaatst het schip opzettelijk, net als de kade, de vuurtoren en de kraan (`doomedBy`) | aanwas maakt alleen zee land die aan open water grenst, precies waar de rede ligt |
| Botsen | **Gebouwd anders dan gepland: geen levels, maar platen met een hoogte.** `shipSolids()` meet haar huid in platen van één eenheid; lopers en zwemmers botsen erop als op elke blokker, en elke plaat draagt `hull` (1,1), die `hullOver` in `web/js/boat.js` aan de boeg van de Benchy en de probes van het galjoen geeft, zodat een boot tegen haar zij stuit als tegen een oever. De uitjes van de zee varen eromheen: `openWater` in `shared/boating.mjs` kent de kavels die op water liggen. | Levels zijn een cel groot, en haar zij ligt 0,6 binnen de rand van het kavel: een level op haar cellen hield een Benchy 0,6 te vroeg tegen of liet zijn boeg 0,4 in haar romp, en een level ernaast was een vloer in de lucht. Een oudere zee vaart haar bootjes door het schip heen, maar dat is alleen cosmetisch. |
| Aan boord | **Later.** De dekken, de trappen en een staatsietrap met een vlonder op de waterlijn zijn gemodelleerd en als ankers uit de bake geëxporteerd (`deck.*`, `stair.*`). Een `CRAFTS.batavia` op die ankers, zoals het galjoen, is de weg. | Blokkers hebben geen hoogte, dus de romp houdt ook wie op het dek staat tegen, en levels per cel kunnen geen helling maken. |
| Model | `scripts/build-batavia.py` → `assets/batavia/batavia.blend` → `web/js/batavia-mesh.js`: 6181 driehoeken, met een eigen hero-budget van 8000 (`HERO_BUDGETS.batavia`; het galjoen heeft 15000). De zeilen zijn opgegeid. De vijf vlaggen zijn bewegende delen (één extra draw call per schip). De hek-lantaarns en de ramen van de kajuit gloeien 's nachts. De dekken en trappen zijn ankers, en `anchor.waterline` is haar diepgang (1,00), het ene getal waarmee ze gezakt wordt. De drie schepen zijn één bake in drie kleuren: eiken en groen, blauw en goud, rood en zwart. | één materiaal, dus één draw call voor de romp |
| Beweging | Het schip deint en slingert een beetje op de eigen klok van de pagina, met een fase uit zijn id, en de vlaggen waaien. Niets gaat over de lijn. | cosmetisch, zoals de rook |
| Naam | Het eerste schip is **de Batavia** (Tiemens naam ervoor). Voorstel voor het tweede en derde: naar de twee grootste wijken. | VOC-schepen heetten naar steden en kamers (Amsterdam, Batavia) || Hoe het in de layout staat | **Als civic-kavel**: `layout.plots['civic:ship']` = `{ gx, gz, w: 4, d: 16, rot }` (bij een oneven `rot` zijn `w` en `d` omgewisseld), zonder deur, en plakkerig zoals elk kavel. Het tweede en derde schip zijn `civic:ship:2` en `civic:ship:3`, met hetzelfde civicType. | Zo tekenen de bundel, elke pagina en elke bezoeker het via `buildings`, zonder nieuw veld. `planFairway` en `polderCandidate` weigeren al elke cel waar iets op staat, dus onder het schip wordt geen vaargeul gegraven en geen polder ingedijkt. De kroniek, de toast en het dossier komen gratis mee. `parseBundle` neemt een `w`/`d` tot **16** aan, ook als ze verschillen (`plot()`, `lib/islandbundle.mjs:342`). 16 is dus ook de grens: een langer kavel laat een oudere zee het hele eiland weigeren. Het is wel het eerste niet-vierkante civic-kavel: `lotOf`, het stempelen (`d: w`, `lib/layout.mjs:3352`) en alles wat alleen `p.w` leest, moet `p.d` leren. || Waar | **De rede**: een strook water van 4 bij 16 cellen, 8 tot 20 cellen van de kop van de kadehaven. De rede ligt evenwijdig aan de kust (vanaf de kade zie je het schip van opzij), en elke cel moet aan zes eisen voldoen (zie direct onder de tabel). Van de plekken die daaraan voldoen, wint de dichtste bij de kop. Is er geen plek, dan de volgende haven. | een gewone plekregel, zoals die van de vuurtoren en de kraan || Varen of niet | **Voor anker**, op de rede. Varen komt later, op de techniek die Martijn voor het galjoen bouwde (`CRAFTS` in `shared/crafts.mjs`, `stepOnDeck`, `shipBerth`). (Besloten met Tiemen, 28 september.) | Aan een steiger past hij niet. Een steiger is hoogstens vijf planken (`QUAY_REACH`), en ligplaatsen liggen vast op 2,0 van elkaar (`berthOf`); het galjoen ligt om die reden ook in diep water buiten zijn ligplaats (`shipBerth`). Het klopt ook historisch: VOC-schepen lagen op de rede van Texel, en de lading ging met lichters aan wal. || Hoe groot | **Groter dan het galjoen: een romp van ~12 eenheden (48 m), ~15 met de boegspriet, ~2,8 breed, de top van de grote mast ~11,5 boven het water.** Alles wat je belopen kunt is op mensenmaat: het hoofddek ~1,1 boven het water (zoals de kuil van het galjoen, 1,108), een reling van ~0,25 (1 m), treden binnen `STEP_UP`. (Besloten met Tiemen, 28 september; eerst 10 en 9, tot bleek dat het galjoen al 13 lang is.) | Settlers hebben de maat van het eiland: 0,43 eenheid is 1,72 m, bij 4 m per eenheid. Gemeten op de bakes, in eenheden: de speler 0,45, de deur van het stadhuis 0,72, een huis (`house`) 2,6 hoog, het stadhuis 3,8, het grote kasteel 5 breed en 6 hoog, de Benchy 1,3 lang. Het galjoen dat elk eiland sinds 28 september heeft (`boat:<region>`, Martijn, `scripts/build-pirateship.py`) is 13 lang met de boegspriet, 3,9 breed over de reling (7 over ra's en zeilen), met de top ~10,8 boven het water. Een verdiend schip dat kleiner is dan het gratis schip is geen beloning. De Batavia heeft echte VOC-verhoudingen: langer en slanker dan het galjoen, en hoger getuigd. Op ware grootte (45 m romp, 55 m mast) werd de mast 13,8, twee keer de nieuwe vuurtoren (hieronder); 11,5 houdt het silhouet van het eiland heel. |# De ladder tot tweehonderd: de haven, het VOC-schip en de vloot

De zes eisen voor elke cel van de rede:

- het is water dieper dan `REDE_DEPTH` (voorstel −0,4; de zee zakt aan de kust al naar −0,6);
- het hangt aan open water;
- het is geen vaargeul;
- het ligt niet binnen twee cellen van een steiger, ligplaats of helling;
- het ligt niet in de gang voor de kop (`seawardDirection`);
- het ligt niet waar het galjoen ligt (`shipBerth`, naar `shared/` verhuisd zodat de layout en de pagina dezelfde som maken), met zijn draaicirkel erbij.

## De vuurtoren

> maak de vuurtoren ook hoger. trek m niet uit, zorg dat de verhoudingen kloppen

De vuurtoren (50) is nu 3,9 hoog (16 m), nauwelijks hoger dan het stadhuis, en naast een mast van
9 zou hij een schuurtje zijn. Hij wordt opnieuw gebouwd (`scripts/build-lighthouse.py`), niet
geschaald:

- **Ongeveer 7 hoog (28 m)**: het hoogste op het land, net onder de mast van het schip, zoals een
  echte vuurtoren naast een retourschip.
- **Meer verdiepingen, niet hogere.**
  - De deur blijft op mensenmaat (~0,72, die van het stadhuis).
  - De ramen blijven zo groot als nu, maar er komen er meer, per verdieping een band.
  - De omloop krijgt een reling van ~0,25.
  - De lantaarnkamer is zo groot dat er iemand in kan staan.
- **De voet wordt breder, met een taps verloop** (hoogte ~4,5 à 5 keer de voet), anders wordt het
  een schoorsteen. Hij blijft op zijn ene cel (`SMALL`), en de plekregel verandert niet.
- **Alles wat de vuurtoren leest, gaat mee**: het licht en de bundel van `web/js/beacon.js`, en
  elke plek die zijn hoogte of ankers gebruikt (het mysterie bij de vuurtoren uit
  `Plans/dierenverhalen.md`). Het budget is een hero (4000); de huidige zit op 1714.

**Gebouwd op 28 september (branch `wp-vuurtoren`).** Gemeten op de bake en op wat `buildBuilding`
tekent:

- 6,52 hoog in het model en 6,70 op zijn opstap (27 m). De bounding box met de fundering onder
  de grond erbij is 7,40, waar de oude 3,90 was. Het grote kasteel is 5,34, het stadhuis 3,09.
- Een voet van 1,44 (1,39 tussen de vlakken), dus 6,70 is 4,8 keer de voet. De schacht loopt taps
  van 1,20 naar 0,80. De omloop is 1,36 breed, met een reling van 0,25.
- Acht verdiepingen van 0,47 (de oude band was 0,46), rood en crème zoals de oude vier. Op elke
  verdieping zitten twee ramen, precies de oude, per verdieping een kwartslag verdraaid, zoals een
  wenteltrap. De deur is 0,34 bij 0,72, dus zo hoog als die van het stadhuis, in een stenen voet
  van 0,88.
- De lantaarn heeft 0,66 glas, is 0,72 breed en heeft een vloer tot het dak van 0,91. De lamp
  staat erin: `BEACON_RISE` leest nu de lens (`Lighthouse lamp lens`, op 5,46), en
  `BEACON_THROAT` de straal van het glas.
- 2282 driehoeken.

Wat meeging:

- `web/js/beacon.js` rekent de hoek van de bundel uit (`BEAM_DROP`) in plaats van 0,06 te
  onthouden, en de keel van de bundel komt van het glas.
- De opstap volgt de kapel-regel (`[0, 0]`), anders was hij 1,9 in het vierkant geweest.
- De vuurtoren is `ROUND` voor het lopen.
- `lib/animal-places.mjs` kent `DRAWN_REACH` (1,0). Anders stond de kip bij de deur op de
  opstap, en kon het laatste spoor van het mysterie 0,6 uit het midden terechtkomen, in de steen.
- `tests/lighthouse.test.mjs` houdt dit allemaal samen.

Een spoor dat al in `data/animal-events.jsonl` staat, blijft staan waar het ligt. Dat is een
dagboek, en het verschuift niet.

## De vloot

"Vloot" betekent hier de boten van het eiland, niet `lib/fleet.mjs`: dat is de lijst van eilanden
van de zee.

Nu heeft elke haven plaats voor drie boten (`BOATS_PER_HARBOUR`). Er komt er alleen een bij als de
bewaarder op B drukt. Het echte eiland heeft vier havens en één boot: `data/boats.json` bestaat
niet, dus er ligt alleen de boot van de oude kade.

1. **De vloot groeit vanzelf** (stap 2). Hiervoor verandert er niets aan de zee.
   - `earnedBoats(settlers)` komt in `shared/quay.mjs`, naast `BOATS_PER_HARBOUR`, de enige kopie.
   - Vanaf 130 komt er elke vijf settlers een boot bij. Ze worden rondgedeeld in de volgorde van
     `HARBOUR_SIDES`, beginnend bij de kadehaven. `null`-kanten worden overgeslagen, en een haven
     krijgt er hoogstens drie.
   - `scan.mjs:491` (waar `harbours[].boats` geschreven wordt) neemt het grootste van gebouwd en
     verdiend. B blijft de manier om vóór te bouwen, nooit eronder.
   - Het aantal blijft ≤ 3. Elke zee en elke pagina, ook de oude, leidt dus met `mooringsFor`
     dezelfde boten af.
   - Op het echte eiland: van 1 naar 12 boten tussen 130 en 180.
2. **Meer schepen op de rede** (158 en 192). Het tweede en derde schip gaan naast het eerste voor
   anker, vijf cellen uit elkaar (een kavel van vier breed en één cel water), en krijgen hun plek als ze verdiend worden. Het is hetzelfde
   model in andere kleuren, met een andere vlag. Een fluitschip als eigen model kan later.
3. **Meer boten tegelijk op het water** (de kant van de zee). `MAX_OUT` in `shared/boating.mjs`
   (nu 2) groeit mee met de crowd die de zee zelf laat lopen: 2 plus één per 40 settlers boven de
   100, tot hoogstens 4. Een oudere zee houdt het op 2.
4. **Niet in deze ronde: meer dan drie boten per haven.**
   - `parseBundle` weigert de *hele* bundel als `boats` boven de 3 komt
     (`whole(raw.boats, 0, BOATS_PER_HARBOUR)`). Een eiland dat dat doet, verdwijnt dus van elke
     zee die nog niet bijgewerkt is.
   - En `berthOf` zet elke boot vanaf k=2 op dezelfde plek.

   Daar is een tweede steiger per haven voor nodig, en een zee die eerst uitgerold is: een eigen
   plan.

## Stappen

1. **De ladder, de werf en het schip.**
   - Eerst meten, op een kopie van het echte eiland (grid 288, 112 settlers) en op de seeds 5,
     2024 en 1337:
     - welke haven de kadehaven wordt;
     - of er een rede past, en hoe ver van de kop;
     - of er een kavel verschuift;
     - of de tweede scan byte-identiek is.

     Zet de server stil vóór het meten.
   - Dan het bouwen:
     - de plekregels: `harbourSite` voor de werf (later ook het pakhuis en de waag: een 3x3-blok
       aan de kust met de voorkant naar het water, dicht bij de helling van de kadehaven) en
       `redeSite`;
     - de terugval van de kraan;
     - het niet-vierkante kavel;
     - de twee modellen;
     - `stage` in de bundel;
     - de botsers en de afscherming voor de uitjes.
   - Treden 95 en 120 gaan in `MILESTONES`. Op het echte eiland komt de werf meteen, al in het
     stadium van de spanten (112), met de romp af op 115 en de tewaterlating op 120.
   - Een tewaterlating als lokale animatie voor wie kijkt, met de romp die de helling af glijdt en
     naar de rede vaart, mag erbij: `sailIn` (`main.js:4516`) is het voorbeeld.
2. **De vloot die vanzelf groeit**: `earnedBoats`. Er is geen model voor nodig en er verandert
   niets aan de zee, dus dit kan ook vóór of tegelijk met stap 1.
3. **Aan boord van het schip**: de dekken en trappen als `decks`.
4. **De andere gebouwen**, één voor één in ladder-volgorde, elk met een eigen kort plan zoals
   `Plans/zagerij.md`. Een trede gaat erin tegelijk met zijn model.
5. **Het tweede en derde schip, en meer boten tegelijk op het water** (de kant van de zee).

Wat mee moet veranderen:

- **Tests.**
  - `tests/trades.test.mjs`: de nieuwe ambachten hebben elk een eigen trede nodig.
  - Nieuwe tests voor `redeSite`, `earnedBoats`, `yardStage`, een kavel van 4x16 door
    `parseBundle`, de kraan zonder kade-wijk, en de uitjes die om het schip heen varen.
  - `tests/harbour-crane.test.mjs` houdt 150 < kraan < 175 vast en blijft groen.
- **De lijsten waar elk nieuw civicType in moet**:
  - `SHOPS` of de switch in `civic()`;
  - `TOWN_LAID` (als het in het dorp staat), `TRADES`, `SMALL`;
  - `MOVABLE_CIVICS`/`CIVIC_NAMES` (`lib/plan.mjs`);
  - `web/js/demo.js`, `web/js/editor.js`;
  - `KEEPERS`, als er een bewaarder bij hoort.
- **Tekst**:
  - `docs/manual.md`: 930, 936 ("the last one the ladder has") en 939-940;
  - het commentaar in `lib/village.mjs` (84-101);
  - `README.md:158`.

**Release: de volgende minor (0.7), geen 0.6.x.** Drie dingen kan een oudere 0.6 op hetzelfde
eiland niet goed lezen, en dat is precies wat de patch-regel verbiedt:

- een nieuw kavel in `layout.json`;
- nieuwe velden in de bundel;
- nieuwe civicTypes, die zij als stenen blokje tekent.

`SEA_V` hoeft niet omhoog: alles is een toevoeging die een oude zee negeert of accepteert.

## Open

- ~~**De maat.**~~ **Besloten (28 september): groter dan het galjoen, een romp van ~12 en een mast van ~11,5.** Het eerste voorstel (6,5) ging uit van een ingekrompen eiland; het tweede (10 en 9) was kleiner dan het galjoen dat intussen op origin/main stond. Zie "Hoe groot".
- ~~**De naam** van het schip.~~ **De Batavia** (Tiemen). De tweede en derde hebben nog geen naam;
  in de ladder heten ze "The second ship" en "The third ship".
- ~~**De romp op de helling en de afgebouwde Batavia verschillen achteruit.**~~ **Opgelost
  (28 september).** In stadium 4 staat nu de bake van de Batavia zelf op de helling
  (`bataviaOnStocks` in `web/js/buildings.js`): dezelfde romp, met het achterschip naar zee en op
  de helling van 1 op 24 gelegd, zonder tuig en in kaal hout. Wie op 115 de werf ziet en op 120 de
  rede, ziet dus hetzelfde schip, alleen geschilderd en getuigd. Stadium 1 tot 3 zijn op haar
  lijnen getekend. Zie `Plans/scheepswerf.md`.
- **Bestaande treden.** Wil Tiemen 0–100 toch spreiden, bijvoorbeeld het theehuis, de bibliotheek en
  de toverstokkenwinkel uit het drukke stuk 30–45 halen? Dan met de `was`-regel:
  - een omgenummerde trede houdt zijn oude getal als `was`;
  - hij telt als vrijgespeeld als het eiland het nieuwe getal heeft gehaald, of als het zijn kavel
    al heeft én het oude getal heeft gehaald;
  - de datum is dan de vroegste van die twee.

  Dan verdwijnt niets wat er staat, en krijgen alleen nieuwe eilanden de nieuwe volgorde. Het kost
  één veld per verschoven trede, en geen veld in de layout.
- **B.** Blijft het de manier om vóór te bouwen, of kan het weg nu de vloot vanzelf groeit?
- **Varen.** Het schip dat eens per week uitvaart en terugkomt (de retourvloot als gebeurtenis)
  hoort bij fase 2–6 van `lopen-op-de-boot.md`. Daarvoor is nodig:
  - een craft-soort voor het schip (`shared/crafts.mjs`);
  - `stepBoat` met lengte, breedte en diepgang;
  - een dieptecheck, die er nog nergens is.
- **Weer op slot gaat nu al.** Het aantal settlers kan dalen (het echte eiland heeft zes
  verbannenen). Een mijlpaal gaat dan weer op slot, laat zijn kavel leeg staan en laat zijn toast
  opnieuw zien als hij terugkomt. Dat is niet het probleem van dit plan, maar de `was`-regel zou het
  meteen oplossen.

## Gemeten en besloten bij het bouwen van de kern (28 september)

De ladder, de kavels, de plekregels en `stage` staan op de branch `wp-kern`. Gemeten op een kopie
van `layout.json` en `village.json` van het echte eiland (grid 288, 114 settlers, geen kade-wijk,
vier havens), met het model opgeblazen tot 200 settlers, één settler per scan:

| wat | waar | afstand |
|---|---|---|
| kadehaven | de noordhaven, kop [154,41] | |
| werf | [143,35], 5x16, rot 0 (zee op het noorden) | 9 van de wal van de kadehaven |
| Batavia | [166,20], 16x4 | 18 van de kop |
| tweede en derde schip | [166,15] en [166,10], ernaast | 23 en 28 van de kop |
| kraan | [150,44] | 4 van de wal |
| pakhuis, waag | [160,42], [159,36], voorkant naar het water | 8 en 9 van de wal |
| vissershut | [232,195], aan de oosthaven | 8 van die kop |
| brouwerij, oefenveld, kroniekhuis | [135,127], [147,127], [151,127] | 16 van het plein |
| steengroeve | [240,138] | 98 van het plein |

Niets verschoof, geen huis raakte zijn weg kwijt (`stranded`), de tweede scan was byte voor byte
gelijk, en alleen de poldermolen wacht (het eiland kan nog groeien, dus de polderladder wacht
ook). Op de seeds 5, 2024 en 1337 (grid 128, 200 settlers in stappen van 5) vindt alles een plek;
op 2024 staan het pakhuis en de waag aan de volgende haven, omdat de kade van de kadehaven dan
al van gehuchten is. Op een eiland dat groeit (32 op 64, ruimte tot 384) verplaatst een ring de
werf, de schepen en de havengebouwen opzettelijk, net als de vuurtoren, en nooit een huis.

Besloten waar het plan niets over zei:

- **De kadehaven zonder kade-wijk**: de haven waar de eerste boot ligt is de haven van de kade die
  elke pagina uit de landing afleidt, en als die geen van de vier is, de haven aan *diezelfde kant*
  van het dorp. Op het echte eiland ligt het galjoen aan een kade van zichzelf ([209,66]), die na
  het groeien geen haven meer is; zonder die regel werd het de oosthaven, 120 cellen verderop.
- **Afstand tot de kop** is de afstand van de kop tot de dichtste cel van de strook (Chebyshev),
  8 tot 20; van de strookjes die mogen, wint het midden het dichtst bij de kop. De boeg wijst langs
  de kust, een kwartslag gedraaid van de richting van de steiger.
- **De gang voor een kop** is twee cellen aan weerszijden van de lijn van de steiger, van de kop tot
  de rand van het grid. **De draaicirkel van het galjoen** is 7 (de helft van haar 13, plus een halve
  cel). **Ligplaatsen** zijn alle drie van elke haven, boten of niet, omdat de vloot erin groeit.
- **Schip twee en drie** mogen tot 4 cellen langs het eerste schuiven: op seed 5 nam de draaicirkel
  van het galjoen net de laatste cel van het vak naast de Batavia. Is er naast haar geen plek, dan
  zoeken ze een rede zoals zij.
- **Een cel water rond elk schip en de werf**: niets staat er direct tegenaan.
- **De werf**: zes rijen droog (strand mag, geen hoek boven 1.2, zodat de teen van de helling in
  het water blijft), vier rijen open zee, de zes ertussen strand, waterlijn of getijdewater. De
  poort is de `anchor.door` van het model (lokaal 2.2 bij -8), niet het midden van de landkant.
  De werf en de havengebouwen blijven van de grond van gehuchten af, zoals de ambachten.
- **De havengebouwen** staan op land met het vak vóór hun voorkant in open water; zonder plek bij de
  kadehaven gaan ze naar de volgende haven. **De vissershut** gaat naar de andere haven die het
  dichtst bij het dorp ligt, anders naar elke kust.
- **De steengroeve** buiten het dorpsplan (TOWN_REACH, zoals een nieuw kasteel): op een eiland van
  128 is de heuvel vaak de rug van het dorp zelf, en op seed 5 stond hij anders tussen twee straten.
- **Polders**: de ladder slaat ook een polder over die een schip in een vijver zou opsluiten, en
  een polder van de bewaarder die dat doet, of eroverheen gaat, wordt geweigerd.
