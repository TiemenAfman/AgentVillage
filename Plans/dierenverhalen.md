# Dierenverhalen: een kip, een geit en een mus die het eiland onthoudt

Begonnen op 26 september 2026, op de branch `codex/dierenverhalen` (Codex legde de eerste steen:
een journaal en een reducer zonder klok), verder gebouwd in `claude/dierenverhalen`. Het uitgewerkte
Engelse plan staat in [docs/next/animal-stories.md](../docs/next/animal-stories.md); dit is het
"waarom" en de beslissingen die bij het bouwen vielen. Het vervangt de regel "dieren op het eiland
zelf" onder *Later* in [stal-en-veld.md](stal-en-veld.md): de dieren die daar op `/demo` staan
lopen nu op het eiland, maar als *personen* met een naam en een geheugen, niet als decor.

## Het idee in één alinea

Open het eiland en ontdek wat de dieren hebben uitgespookt. Een handjevol dieren (hoogstens zes
per eiland) met een naam, twee of drie karaktertrekken en een lievelingsplek. Wat de settlers doen
(sessies die werken) geeft de dieren *kansen*; een dier kiest wat het ermee doet (bij een deur
pikken, een geit die iemand blijft opzoeken, een mus op een dak), zo'n ontmoeting verandert een
relatie, en een relatie die ver genoeg gaat laat een blijvend spoor achter (een nest, een uitkijkpost,
een vogelhuisje). Uit die sporen komt één eilandmysterie.

## Wie wat bezit

| | bezit | waarom |
|---|---|---|
| **islander** (`serve.mjs`) | wie de dieren zijn, hun relaties, wat er gebeurd is, sporen, het mysterie | het enige proces met een schijf; een herinnering mag niet verloren gaan |
| **zee** (`lib/sea.mjs`) | waar een dier nu loopt, en of een ontmoeting af is | beweging hoort bij de zee, net als de settlers: iedereen ziet dezelfde kip |
| **pagina** | tekenen, tussen twee woorden in laten lopen, het dossier | geen tweede beweging in de browser |

## Beslissingen

- **Het journaal is de waarheid** (`data/animal-events.jsonl`, onvervangbaar zoals `layout.json`);
  `animals.json` is een weggooi-checkpoint. Een gebeurtenis draagt haar *uitkomst* (de nieuwe
  getallen, het label, de zin voor het dagboek), zodat opnieuw afspelen nooit opnieuw dobbelt en
  een regelwijziging alleen toekomstige keuzes raakt (`rules` in elke regel).
- **Een activiteit is een kans, niet een beloning per bericht.** De cursor per settler is
  `humanTurns + assistantMsgs + toolCalls` uit `village.json`. Alleen de cursor die een kans
  *opmaakt* gaat het journaal in (samen met de intentie die hij veroorzaakte, in één regel), plus
  de nulmeting bij de komst van een dier. Een herscan of een lagere teller doet niets. Vensters van
  20 minuten; per dier één opvallende ontmoeting per venster, per eiland drie per uur, per dier één
  grote relatiewijziging per dag.
- **Relaties hebben drie getallen en vier woorden**: vertrouwdheid, vertrouwen en irritatie, en
  daaruit *bonded / tolerant / suspicious / nemesis* met hysterese (erin bij de ene drempel, eruit
  pas bij een lagere), zodat een label niet heen en weer klappert. Per dier hoogstens acht relaties;
  wie eruit valt is de minst betekenisvolle, nooit een bonded of nemesis.
- **Karakter verandert wat je ziet**: een brutale kip zoekt drukke huizen op, een schuwe de stille
  randen; een rusteloze geit staat korter stil en loopt verder van huis. Trekken zitten in het
  journaal (bij de komst) en gaan mee naar de zee, die er de beweging op afstemt.
- **Twaalf ontmoetingen** (plus rust bij stille huizen), elk met voorwaarden, een cooldown, een
  zichtbare handeling op de zee (`peck`, `nudge`, `perch`, ...) en een zin met namen en plek.
  Herhaling wordt één regel ("Bram zocht Max weer op, voor de vierde keer") in plaats van twaalf.
- **Een ontmoeting telt pas als de zee zegt dat hij gebeurd is.** De islander stuurt een intentie
  (`POST /island/:id/animals`, met sleutel en `fleet.vouch` zoals de Codex-deur); de zee laat het
  dier erheen lopen en meldt `{t:'animal', a:'done'}` over de socket die de islander zelf opende.
  Aangenomen alleen voor een openstaande actie van dit eiland en deze verbindingsgeneratie
  (`gen`, telt op bij elke welcome). Na een herverbinding stuurt de islander alles opnieuw en loopt
  het dier opnieuw; dubbel tellen kan niet, want een actie die niet meer openstaat doet niets. Er
  komt geen inkomende route bij de islander: de zee praat alleen terug over de lijn die er al is.
- **Eigen berichttypen `herd` en `af`**, niet `{t:'island', a:'animals'}`: een oudere pagina leest
  elke onbekende `island`-`a` als vlootrij en zou haar vloot stukmaken; een onbekende `t` negeert
  ze. Een oudere zee kent de dierendeur niet (404): de islander zegt dat één keer en probeert het
  bij de volgende welcome opnieuw. Geen `SEA_V`-ophoging, want niemand leest iets verkeerd.
- **Posities zijn eiland-lokaal**, zoals bij de settlers; de oorsprong van een regio gaat er op de
  pagina bij, op één plek. Vijf keer per seconde voor wie beweegt, iedereen elke twee seconden;
  met hoogstens zes dieren per eiland is dat een paar honderd bytes per seconde, los van hoeveel
  settlers er zijn.
- **Getekend in batches**: elk (soort, lichaamsdeel) is één `InstancedMesh`, dus alle kippen van
  alle eilanden kosten evenveel draw calls als één kip. Gemeten in plaats van aangenomen: zie
  *Metingen* hieronder. Alleen op eilanden die in detail getekend worden (`DETAILED`).
- **`fauna.js` houdt zijn geometrie en gewrichtsanimatie**; de beweging is eruit gehaald
  (`animalPose`: stand, handeling en snelheid in, hoeken per gewricht uit). `/demo` en de stal
  lopen nog zelf rond via dezelfde pose, zodat het model nog steeds los te bekijken is; op het
  eiland beweegt een dier alleen nog door wat de zee zegt.
- **Zichtbaar voor bezoekers**: naam, soort, wat het nu doet en een korte openbare zin; relaties met
  settlers alleen onder de geredigeerde namen (`house:s3`). Het dagboek, de echte huis-ids en de
  getallen blijven bij de islander (`/api/animals`, niet op `PUBLIC_API`).
- **Sporen gaan door dezelfde controle als een tuinbed** (`whyNot` uit `lib/garden.mjs`: niet in
  zee, rivier, strand of bestrating, niet te steil) en nooit op een kavel. Geen plek? Dan blijft de
  ontdekking bewaard en wordt de plaatsing bij elke scan opnieuw geprobeerd, onder hetzelfde id.
  Nooit een huis verzetten, nooit een layout-versie ophogen voor een dier.
- **Het mysterie** heeft drie vaste stappen (een vreemde pootafdruk, vondsten op verschillende
  plekken, een onthuld detail bij een bestaand herkenningspunt) met vaste ids; verschillende
  settlers kunnen bijdragen, en één settler die steeds terugkomt komt er ook, alleen trager.
- **Terwijl de islander uit staat gebeurt er niets.** Na een lange afwezigheid één zacht vignet,
  vastgelegd op het moment van terugkomen; geen verzonnen reeks, geen honger, geen dood.

## Stappen

1. Journaal, reducer en het contract (snapshot, intenties, voltooiing, redactie) met synthetische
   fixtures; stale-lock-herstel.
2. De kip helemaal: `shared/animalwalk.mjs` (ticks, geen goniometrie), de kudde op de zee, de
   islander aangesloten, de pagina die tekent en een dossier.
3. Geit en mus, karakter, relatiewijzigingen, cooldowns, het maximum van zes.
4. Sporen: nest, uitkijkpost, vogelhuisje, en één combinatie-ontdekking.
5. Het mysterie.

## Metingen

(Wordt ingevuld tijdens het bouwen.)
