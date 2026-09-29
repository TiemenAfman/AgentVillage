# Ingangen verplaatsen en toekennen

**✅ GEBOUWD** (29 september 2026) — de gedeelde som, `layout.gates`, de aanrijroutes, de `gate`-actie en de Gate-tool staan. Een vijfde fase (bruggen als vastgelegde ingang) is bewust geschrapt, zie *Besloten*. Bouwt voort op [ingangen-en-bruggen.md](ingangen-en-bruggen.md), dat
beschrijft wat er al staat (afgeleide ingangen, bord op de hekrand, planner-markeringen, bruggen als weg).

## Waarom

Ingangen worden nu **afgeleid** uit de wegen (`hamletEntrances`): waar het wegennet de rand van het land
kruist, één per windstreek, hooguit vier naar grootte. Dat is goed zolang de wegen liggen zoals de keeper
ze wil, en fout zodra dat niet zo is:

- Sybolt heeft twee ingangen terwijl zijn grootte er drie toestaat, en de keeper kan er geen **toekennen**
  zonder eerst een weg te trekken die toevallig de goede kant kruist.
- De afleiding kiest per kant de kruising *het dichtst bij het midden* (na de eigen weg en een brug). Dat
  is een gok: een huispad, een hoek van het hek of een weg die langs de grens loopt kan winnen van de
  plek die de keeper bedoelt - zo stond een bord op de hekrand een eind van de brug.
- Een weg die langs de grens loopt in plaats van erdoorheen (Sybolt Zuid: het pad van de scheepswerf
  gaat pas een cel binnen de grens rechtsaf) geeft een ingang zonder recht stuk voor een poort.

De keeper moet zeggen kunnen: *hier* is de ingang van dit dorp, aan deze kant.

## Beslissingen

- **Opgeslagen, per dorp en windstreek, in `layout.json`:** `layout.gates[districtId][side] = { at: [gx, gz] }`
  (`side` is `n|e|s|w`, `at` de cel op het land van het dorp waar het hek opengaat). Een kant zonder
  gegeven valt terug op de afgeleide ingang, zodat een eiland zonder `gates` er precies zo uitziet als nu.
  Een ingang die de keeper zet is **stabiel** (verhuist niet met een nieuwe weg); de afgeleide blijft
  afgeleid.
- **Ook sluiten:** `{ closed: true }` op een kant zet de ingang daar uit, ook als er een weg langs loopt
  - de weg blijft, alleen het hek en de poort gaan dicht. Het maximum blijft `maxEntrances(population)`;
  het aantal open kanten (opgeslagen + afgeleide) komt daar nooit boven.
- **Eén deur, zoals alles wat de keeper doet:** een nieuwe planner-actie `gate` in `lib/plan.mjs`
  (`POST /api/plan`), toegepast op dezelfde plek als `road` en `civic`, onder de scanrij, eerst op een
  kopie geprobeerd, alles-of-niets. Geen ander pad schrijft `layout.gates`.
- **De weg volgt.** Een opgeslagen ingang zonder weg naar het plein krijgt er bij de scan een: een
  aanrijroute `road:gate:<district>:<kant>` van de ingangscel naar het plein, geroute na de dorpswegen
  (`routePath`, `isGoal: SQUARE`, `markRoad`, dus hij vlecht aan bestaande wegen), vast net als
  `road:polder:<n>:approach`. Wordt de ingang later verplaatst of gesloten, dan gaat zijn aanrijroute mee
  weg (zoals `unpolder` de zijne opruimt); de wegen die het dorp zelf legde blijven.
- **Bord, hek en planner volgen de opgeslagen plek.** `hamletEntrances` levert voor een kant met een
  gegeven exact die plek (met `next` = de cel erbuiten in de richting van de rand), en de rest van de
  keten - `hamletSignSites` (bord op de hekrand), `setBridgeRoads`/de hekopening in `world.js`, de
  planner-markeringen - verandert niet. Het hek gaat open op de cel van de ingang, ook als daar geen
  weg ligt: `world.js` krijgt de ingangen mee als extra "weg" voor `buildBorders`, net als bruggen nu.
- **Een brug is geen vaste ingang.** Een handgebouwde brug ligt er toevallig: de keeper zette haar waar het
  uitkwam, en ze telt als weg voor de afleiding zolang ze staat (`bridgeRoadCellsOf`). Ze wordt nooit
  opgeslagen als ingang en legt geen wegen aan. Wil de keeper er een weg heen, dan zet hij de ingang van
  het dorp op de landing (de Gate-tool: de cel is de rand van het land, en de aanrijroute legt de weg naar
  het plein) of trekt hij een weg met de Road-tool.
- **Maximaal één ingang per kant.** Een windstreek heeft één ingang, dus hooguit vier per dorp, minder naar
  grootte (`maxEntrances`). Een tweede gate op dezelfde kant *vervangt* de eerste, in het concept en op het
  eiland; er is geen "tweede ingang aan één kant" en dus geen naam daarvoor.

## Wat de keeper ziet

Een planner-tool **Gate** (toets 7, na Road):

- Elke ingang van het gekozen dorp staat op de rand met zijn balk en pijlen, zoals nu.
- Een ingang **aanwijzen en slepen** langs de rand van het eigen land; de cel volgt de rand cel voor cel, en
  wordt rood waar het niet mag (water, een huis, een dijk of zone, een cel die geen rand van het land is).
- Een lege kant **aanklikken** zet er een ingang neer, tot het maximum voor de grootte; **Delete** op een
  gekozen ingang sluit hem (`closed`) of, als hij niet opgeslagen was, schrijft dat op.
- De **weg-preview**: een stippellijn van de ingang naar het plein, zoals de route-markering van de
  wandelaar, zodat je ziet welke weg er gelegd wordt voordat je Apply drukt. Bij Apply staat dat in het
  overzicht van de stappen ("Sybolt: nieuwe ingang oost, 14 cellen weg, 1 brug").
- De ledger noemt wat de server weigert, in woorden ("een huis staat op 183,217", "er is al een ingang
  aan de noordkant en dit dorp mag er maar twee").

## Validatie (server, `opGate`)

De cel moet op het eigen land van het dorp liggen, aan de rand (minstens één buur van een ander bezitter,
zee of rivier telt niet), vrij van een plot, geen dijk of zone, geen pier, en de kant moet kloppen (de
windstreek van de cel ten opzichte van het midden van het land, dezelfde som als de afleiding: er is
maar één, `sideOf`, en die verhuist naar `shared/`). Het aantal open kanten blijft ≤ `maxEntrances`. Een
aanrijroute die geen weg naar het plein vindt (een dorp dat op een eiland zit zonder brug) weigert de hele
stap - een ingang naar nergens is geen ingang.

## Versie

Een nieuw veld in `layout.json` (`gates`) en een nieuw soort pad (`road:gate:*`): een oudere 0.4.x die dat
leest, plant de stad opnieuw. Dus de volgende minor, geen patch. Geen laag-gate nodig: geen huis of schuur
verhuist, en zonder `gates` is er geen verschil met nu. De zee en de bundel hoeven niets te weten: ingangen
zijn een zaak van de eigenaar (borden en het hek zijn pagina-kant), en `layout.gates` gaat niet in het
bundle.

## Fasen

Gebouwd op 29 september 2026: 1 t/m 4. Wat er afweek van het plan staat bij elke fase.

1. **De som in `shared/`.** `sideOf` en de randcel-logica uit `hamlet-sign-placement.js` naar
   `shared/entrances.mjs` (zonder three, in Node en browser hetzelfde), zodat client en server nooit
   twee versies hebben. Tests: dezelfde als nu, tegen de verplaatste functie.
2. **`layout.gates` lezen.** `hamletEntrances` neemt `layout.gates` (uit `village`, dus in `village.json`)
   en laat een opgeslagen kant winnen; een `closed` kant valt weg. Nog geen tool: `gates` met de hand in
   `layout.json` zetten en zien dat bord, hek en planner volgen.
3. **De aanrijroutes.** `placeAll` legt `road:gate:*` na de dorpswegen, vast en teruggetrokken bij verplaatsen of
   sluiten. Test: een eiland met een opgeslagen ingang zonder weg krijgt er een die het plein bereikt, en
   een tweede scan verandert niets (de scan blijft een zuivere functie van het model).
4. **De actie `gate` en de tool.** `opGate` in `lib/plan.mjs`, de Gate-tool in `plan-mode.js` met slepen,
   preview en ledger; `tests/plan-gate.test.mjs` naast de andere plan-tests.

Geschrapt: een vijfde fase, bruggen als vastgelegde ingang met een automatische aansluiting. Een brug ligt er
toevallig (zie *Besloten*), dus er hangt geen eigen ingang en geen eigen weg aan.

## Open vragen (de rest is besloten)

- Wat is een ingang voor een dorp dat *geen* weg naar het plein heeft omdat het op een eiland van zijn
  eigen ligt (polder, ver eiland)? De server weigert nu de stap; misschien wil de keeper hier juist een
  steiger of poort zonder weg.
- Moet een gesloten ingang het bord weghalen, of blijft er een bord dat "Closed" zegt? (Nu: weg.)
- Verhuist een opgeslagen ingang mee als het hele dorp verplaatst wordt met `lobe`-acties (`plan.mjs`)? Ja
  hoort het: de cel schuift met de super-cel-delta mee, net als de weg en het land.
