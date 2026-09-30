# 🚧 De Quay op zee: een recreatie-oord voor de kust

> Status: **gebouwd op 30 september 2026, niet gecommit** (zie "Gebouwd" onderaan). Het bouwt voort op
> [quay-en-rivier.md](quay-en-rivier.md), fase 3 (één haven met een stenen kade). De preview die de keeper
> goedkeurde staat in de scratchpad (`oord\quay-op-zee.html`), het gebouwde resultaat in
> `oord\quay-op-zee-gebouwd.html` en `oord\d-gebouwd.png`. Open: kades op nieuwe eilanden zijn zeldzaam, de
> open zee moet eerst met deze code draaien, en de echte island migreren.

## Waarom

In fase 3 wordt de monding één haven van echt water: een stenen kade aan de oostkant, de werf, het galjoen en
de rede aan de westkant (de piratenoever). De negen paalwoningen van het quay-district blijven daarin midden in
de haven staan, op palen in het water. Dat is precies de plek waar de boten moeten liggen.

Martijn (30 september 2026): *"laten we de waterhuisjes buiten de kust plaatsen, een soort recreatie-oord. Dat
geeft ons meer havenruimte voor de boten."* Het oord **is** het quay-district. Het zijn dezelfde huizen (de
Cowork-taken, `harbour: isCowork` in `lib/village.mjs`), alleen op een andere plek. De naam blijft voorlopig
**The Quay**, ook in "9 at the quay" in de kop.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wat verhuist | **Alleen de huizen** (en hun paden en schuurtjes). `districts.quay.pier`/`shore` blijven bij de kade (optie A, keeper 30-09). De stenen kade, kraan, pakhuis en werf blijven waar fase 3 ze zet. | De pier is de plank van de zuidhaven: `standingQuay`, `kadehaven`, `waterfront`, `quaysOf`/`mooringsFor`, boot 0 en het galjoen lezen hem. De preview mat dat een verhuisde pier het galjoen uit het schepenwater haalde. |
| Welke plek | **Variant A**: de baai achter de landtong oost van het kade-eind, voet (191,311), steiger 5 naar het oosten, vlonder op x = 196, kam met een tweede vlonder (x = 204). Maar **afgeleid** door `resortSite`, niet vastgezet. | Keuze van de keeper op de preview; de regel moet ook op andere eilanden iets geldigs geven. |
| Palen | **Langer**: tot -1,00 (boardwalk-set `DECK` 1,24 → 1,44). | Met palen tot -0,80 passen er 10 kavels bij de haven, met -1,00 twintig. |
| Waar het record staat | **`layout.resort`**, top-level, alleen in de layout. | Niet in `works` (strikt in `checkWorks`/`parseBundle`: oudere zeeën zouden het eiland weigeren voor iets dat geen grond verandert), niet op `districts.quay` (`migrateParcels` houdt van een district alleen de planken; de planner verschuift districten per super-cel). Het oord bereikt de bundle via de huizen (`plot.quay`) en het dek (`districts[].deck`). |
| Waar | Op zee, net voor de kust aan de **kade-kant** (oost) van de monding, niet op de piratenoever. | De westkant is van de werf, het galjoen, de rede en de piratenkroeg (een andere sessie bouwt daar). |
| Hoe bereikbaar | Een steiger vanaf het strand naar een vlonder, met de huizen aan weerszijden. | Zoals de schets. Een wandelaar en de settlers lopen erheen over planken. |
| Naam | "The Quay" blijft. | Keuze van de keeper; hernoemen kan later los. |
| Groei | Het water rond het oord wordt vastgehouden zoals de haventrechter. Een ring groeit er omheen en maakt er een lagune van die open blijft naar zee. | "Een huis verhuist nooit vanzelf." De huizen verhuisden tot nu toe bij elke ring (`unsettleQuay` in `growStep`). Dat moet nu juist stoppen. |
| De haven erna | Waar de huizen stonden, komen steigers vanaf de kade met ligplaatsen. | Dat is het doel: ruimte voor de boten. |

## Het ontwerp

### 1. De plek: `resortSite`

Een pure keuze op de grond, één keer gedaan en daarna sticky. Hij staat in `layout.works` naast `haven`, met
hetzelfde `undefined`/`null`-onderscheid als de vaargeul. Eisen:
- **Diepte:** open zee, ondiep genoeg voor palen en diep genoeg dat het water blijft na profielgraven. De
  precieze band (bijv. −0,2 tot −0,9) meten we op de live-grond. Er komt een constante met uitleg.
- **Vrij van:**
  - de haventrechter (`works.haven`);
  - de lanen van het galjoen en de rede (`shipBerth`, `redeCell`, `REDE_FAR`, `GALLEON_ROOM`);
  - de ankerplaats;
  - de vaargeul;
  - de pier-lanen van alle vier de havens.
- **Kade-kant:** aan de kade-kant van de as van de trechter (`havenBank` → `'quay'`).
- **Bereikbaar:** binnen een steigerlengte (constante) van droog strand dat niemand gebruikt en dat bij een weg
  naar het plein uitkomt.
- **Volgorde:** de score is een afweging tussen afstand tot de kade (dichtbij, maar buiten de havenmond),
  diepte en ruimte voor groei van het district (`MAX_LOBES`). Een tie-break met een hash op de seed maakt het
  deterministisch.

### 2. Het oord zelf

- **Kavels:** 3x3-kavels op het water langs een vlonder-ruggengraat. De huizen staan op palen zoals nu. De
  hoogte van het dek is `QUAY_DECK`, met hetzelfde getal als de kade (fase 3: 113/256).
- **Vlonders:** de steiger en de vlonder zijn paden op water. Daarvoor is het bestaande mechanisme voor
  vlonder-over-water uit fase 3 nodig (quay-paden op water blijven PATH in de replay, en de afleiding van
  `rec.deck` neemt ze mee). Een eigen `path:`- of `road:`-record houdt ze sticky.
- **Groei van het district:** een nieuwe Cowork-taak krijgt een kavel aan de vlonder. Die wordt langer, of er
  komt een tweede tak. Dit vervangt voor dit district het parcel- en lobe-mechanisme op land (`ensureParcel`
  met `allowBeach`, `QUAY_LEASH`, `annexes`).
- **Extra's:** een badvlot, een strandje met parasols bij de steiger, bootjes. Dat is tekenwerk op de pagina,
  zoals de rest van de aankleding, en er gaat niets van over de lijn.

### 3. De haven ontkoppelen van het district

Nu is het quay-district op meerdere plekken de bron van "waar is de haven". Die moeten naar de kade wijzen,
anders reist de zuidhaven met de huizen mee de zee op:
- **`standingQuay`:** de planken van het district maken nu de haven van die kant. De haven blijft de pier bij
  de kade.
- **`kadehaven`:** is nu "de haven van het quay-district". Wordt de haven aan de kade (fase 3 geeft die een
  vaste plek).
- **Andere lezers:** de kraan, `quaysOf`/`mooringsFor` (shared/quay.mjs), het galjoen (de ligplaats van boot
  0) en `earnedBoats`, dat vanaf de kadehaven uitdeelt. Alles wat nu `districts.quay.pier` leest, gaat naar
  `layout.harbours`.
- **Bundle:** een oudere pagina of zee leidt de haven nog uit het district af. Zet de pier daarom in de bundle
  als `harbours`-slot, dat de strikte `parseBundle` al kent. Dan zien oudere lezers dezelfde haven.

### 4. Migratie van de live-island

- **Het mechanisme:** `QUAY_VERSION` 2 → 3, via `migrateQuay` (vanuit `placeAll`, omdat de grond gevraagd moet
  worden). `unsettleQuay` leegt het district en het district wordt opnieuw gesticht op `resortSite`. Dit is de
  kleinste poort die het werk doet (CLAUDE.md), zonder `PARCEL_VERSION` en zonder `LAYOUT_VERSION`.
- **Wat verhuist:** alleen de 9 huizen en hun schuurtjes en paden. `diff.plots.otherMoved` moet verder leeg
  zijn.
- **Back-up:** vóór de verhuizing, zoals `backUpBeforeWorks` (`layout.before-works-<ts>.json`). De hash
  verandert alleen als het oord grond nodig heeft (een strandje of steigervoet).
- **Release:** een nieuw layout-veld en een nieuwe poort maken het een minor, samen met fase 1–3. De open zee
  (stack 28) moet eerst met deze code draaien.

### 5. De haven na de verhuizing

Waar de huizen stonden, komen steigers vanaf de kade met ligplaatsen. Tot nu toe had elke haven `BOATS_PER_HARBOUR`
(3) boten, één copy. Hier kiezen we tussen twee routes:
- (a) de steigers zijn aankleding, en de 3 boten van de kadehaven liggen eraan;
- (b) de kadehaven krijgt meer ligplaatsen.

Route (b) raakt `BOATS_PER_HARBOUR`, `boats.json` en het getal dat een oudere zee afmeert, dus dat is een
minor-kwestie. Voorkeur: (a) eerst.

## Volgorde

1. Fase 3 af (kade, één haven, werf en schepen op de piratenoever).
2. Preview: `resortSite` op de live-grond, met kaartjes (nu, oord, na één ring) en metingen (diepte, afstanden
   tot de lanen, strandvoet). Stopmoment: de keeper keurt de plek goed.
3. De ontkoppeling uit §3 met tests. Er mag nog niets verhuizen: de zuidhaven moet blijven waar hij is, ook als
   het district in een test op een andere plek staat.
4. Het oord (§1, §2): site, vlonders, kavels, groei van het district, het water vasthouden bij een ring.
5. De migratie (§4) op een kopie van de live-island. Daarna de pagina: huizen op het water, steiger, strandje,
   de ghost weg.
6. Steigers en ligplaatsen in de haven (§5a).
7. Docs: `CLAUDE.md` (de alinea's over de haven en "a house never moves by itself" met deze uitzondering),
   `docs/manual.md` en dit plan naar `Plans/DONE/`.

## Tests die er moeten komen

- `resortSite` kiest op meerdere seeds een plek die aan alle eisen van §1 voldoet, of `null` met reden.
- Na de migratie staan alle huizen van het district in het oord en is `otherMoved` leeg. De zuidhaven,
  kadehaven, kraan en het galjoen blijven waar ze waren. Een tweede scan verandert niets.
- Na één groeiring verhuist er geen huis van het oord, het water eromheen blijft open naar zee en er ontstaan
  geen ringplassen.
- Een nieuw Cowork-huis komt aan de vlonder. Bij `MAX_LOBES` of te weinig ruimte volgt een nette terugval,
  nooit de commons op land.
- Bundle-roundtrip: een oudere lezer (zonder de nieuwe velden) ziet dezelfde haven en boten.

## Open vragen

- **Plek:** oost van de monding, zoals de schets? Of een andere kust als de live-grond daar te diep of te
  ondiep is?
- **Steigerlengte en afstand:** hoeveel cellen mag de steiger vanaf het strand lang zijn?
- **Vorm van het oord:** één rechte vlonder zoals de schets, of een T of een ring naarmate het groeit?
- **Kroeg:** komt de piratenkroeg (andere sessie) ooit naar het oord kijken? Zo niet, dan is er geen overlap.
- **Hernoemen:** "The Quay" houden of later een eigen naam ("The Resort")? Een eigen naam raakt het label en
  de kop, niet het district-id.

## Gebouwd (30 september 2026, niet gecommit)

### Wat er is

- **`resortSite(layout, terrain, model)`** (lib/layout.mjs): de regels en de score van de preview, als pure functie op
  de layout en de grond: voet op vrij strand van niemand aan de kade-kant, steiger 5-14, lots in de band -0,15..-1,00
  (`RESORT_PILE_FOOT`), buiten trechter+6 en kade/kraan+6, vaargeul, alle digs, `wf.near`, de pierlanen, de draaicirkel,
  het schepenwater, polders en een cel water rond wat er staat; weg via `routePath` naar het plein met hooguit 60 nieuwe
  cellen; score met hash-tie-break op de seed. Geeft `{ site }` of `{ site: null, reason }`. Op Hoogezand cel voor cel de
  preview: voet (191,311), steiger (192..196,311), 20 kavels, badvlot-water (196,338), strandpad 3 cellen.
- **`planResort`** (na `planKade`, elke pass): één keer, `undefined`/`null` zoals de vaargeul, wacht zolang het eiland
  nog kan groeien; **`moveToResort`** zet elk huis van het district op het volgende vrije kavel (`lot: n`), neemt hun
  voorpaden en schuurtjes mee en geeft het perceel op land terug als er niets meer op staat.
- **Record** `layout.resort = { foot, out, shape, jetty, deck, lots: [{gx,gz,rot}], raft, strand }`; `growCanvas` schuift het.
- **Dek**: `resortCells(layout).drawn` (kortste weg binnen het volgroeide dek van de steiger naar elke bezette
  deurstap) gaat in `districts.quay.deck`, groeit met het district; in de replay (`markResort`, placeAll en `replayGrid`)
  is dat PATH en de rest van het dek plus elk vrij kavel RESERVED; `keptWater` en `fairwayHeld` houden het hele
  volgroeide oord plus een ring vast. Weg: `road:quay:resort` (strandpad als `strand`, zoals een slipway).
- **Groei**: `growStep` geeft `resortWater` (volgroeid oord + 1 cel, alleen water) aan `settleRing` als kanaal én als
  vooraf beslist lane (`settle.lane` → `seed`), en het komt als gewone `lane` op de stap. Geen nieuw stapveld, geen
  WATER_VERSION-bump. Nagemeten: dezelfde stap met het oord als eigen veld (de sandbox van de preview) geeft dezelfde
  hash, 55c22da7.
- **District**: een quay met oord sticht geen perceel (districtlus), een nieuw Cowork-huis neemt het volgende kavel
  (huizenlus) en na het laatste kavel de commons (zonder op een ring te wachten, niet op palen), `guest` = kavels <
  bevolking. De planner weigert `move` en `parcel` van de quay met een oord.
- **Migratie**: `QUAY_VERSION` 3. `migrateQuay` vanaf 2 vraagt alleen `moveToResort` opnieuw (de verhuizing zelf is die
  van `planResort`); de tak die de planken opnieuw kiest is nu `=== 1`. `backUpBeforeResort` (scan.mjs) bewaart
  `layout.before-resort-<ts>.json` bij de scan die het oord neerzet.
- **Kade op nieuwe eilanden** (punt 6 van de bouwopdracht): de kade hing aan het perceel van het quay-district, en dat
  ligt op een nieuw eiland bij de haven die het dichtst bij het dorp ligt, niet bij de trechter. Nu: `kadeHarbour` (de
  haven in de ring van de trechter, die van het district eerst), en naast een andere haven of een te breed perceel het
  perceel zoals Hoogezand het heeft (`KADE_PARCEL`) langs de droge rijen door de oprit (≥ `KADE_RUN_MIN`). Een quay-huis in
  de weg mag, als het oord een kavel voor elk huis heeft; weigeringen wachten zolang het eiland kan groeien; na een
  groeistap telt `havenPass` opnieuw.
- **Palen**: `scripts/build-boardwalk.py` `DECK` 1,24 → 1,44 (hele set: `models.heightOf` leest de hoogte per set), dus
  paalwoningen en vlonders staan tot -1,00. `npm run models -- boardwalk` idempotent, 58 sets binnen budget.
- **Pagina**: `web/js/resort-dressing.js` vindt het oord in het dek (nat, huizen erop, raakt een strand) en legt een
  badvlot voorbij de punt van de vlonder en parasols op het strand, in dezelfde dek-geometrie (`resortParts`, geen eigen
  draw call). `createQuayKade` geeft de kade vingersteigers waar de huizen stonden (aankleding, route (a):
  `BOATS_PER_HARBOUR` blijft 3), getekend in de muur-mesh. `sailIn` vaart een oordhuis naar zijn eigen voordek.
- **Bundle**: `guestVillage` hernoemde het district-id `quay` ook als sleutel en waarde, dus `plot.quay` zeilde als
  `plot['p:d0']` en elk kadehuis stond op andere pagina's en op de zee op de grond (ook vóór dit plan). Het id `quay` wordt
  niet meer hernoemd; nu gaan de negen huizen op palen en `kind: 'quay'` mee.

### Gemeten (kopie `home-copy-oord-build`, echte scan tweemaal)

- Hash 9d792cbd → 9d792cbd (het oord verandert geen grond). `quayV` 2 → 3. De negen huizen van (155..163, 271..283)
  naar kavels 0-8: (197,310) (193,313) (197,314) (193,317) (197,318) (193,321) (197,322) (193,325) (197,326).
  Andere plots verplaatst: 0 (twee vertrokken tenten en drie nieuwe sessies komen van de live transcripts).
  Paden weg: `road:quay:0` en de voorpaden van de huizen; erbij: `road:quay:resort` (26 cellen, 3 strandpad).
  Dek van het district 58 → 61 (oord 21 van 58 getekend). De tweede scan is een no-op. Back-up geschreven.
- Kadehaven, pier en wal, alle ligplaatsen/boot 0, galjoen, kraan, eerste haven en verdiende boten: gelijk. Bundle:
  vast punt, haven en ligplaatsen gelijk, 9 huizen op palen.
- Kavels gemiddeld -0,23 tot -0,96, diepste hoek -0,98; 43 van 324 hoeken lagen dieper dan de oude -0,80.
- Eén extra ring (r 180, grid 384): 81/81 kavelcellen en 99/99 groeikavelcellen open water, dek 58/58, masker 398/398,
  voet blijft strand, 0 trechtercellen land, ringplassen 16 → 16, kade 141/141 op niveau. Echte scan erna: 0 oordhuizen
  verplaatst (vuurtoren, visserij en weeghuis verhuizen, zoals zonder oord); tweede scan alleen de volgorde van
  `road:polder:3` (zoals in fase 3), derde een no-op.
- Nieuwe eilanden (zeven Cowork-huizen): 90210 op 128 (niet gegroeid), seed 8 en seed 51 gesticht op 96 (1 en 2 ringen)
  krijgen kade en oord, alle huizen op een kavel, tweede scan een no-op (`tests/resort.test.mjs`). Maar van 30 seeds
  gesticht op 40 (150 inwoners) krijgt geen enkele een kade, en van 40 gesticht op 96 (200 inwoners) twee.

### Open

- **Kades op nieuwe eilanden zijn zeldzaam**: de trechter loopt niet binnen ~27° van een gridas, er ligt geen haven in,
  of de civics van het dorp staan waar de kade moet. Zonder kade geen oord; het district houdt dan zijn perceel. Dat is
  een fase-3-vraag (de kade), geen oordvraag.
- **De open zee** (stack 28) moet met deze code draaien voordat de live island publiceert (settlerwalk, `works`,
  `plot.quay` in de bundle), en daarna de echte island migreren (na akkoord; back-up gaat vanzelf).
- **Oudere code op een v3-layout** neemt de pier-tak van `migrateQuay` (zij kent alleen 2) en kiest de planken opnieuw:
  alleen een minor, nooit een patch.
- Het badvlot op de pagina schuift mee met de getekende vlonder; de layout houdt het water van het volgroeide oord vrij.
- De brug, de piratenkroeg: zie quay-en-rivier.
