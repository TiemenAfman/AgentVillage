# 🚧 Het galjoen houdt haar vaart, en een log in de HUD

Plan van 8 oktober 2026. De keeper, letterlijk: *"boot moet snelheid behouden (misschien?) en pas als je
er af springt uitrollen? zo kan je de kannon/harpoen bedienen als je alleen bent."* en *"misschien een
kleine snelheidsmeter in de HUD voor iedereen die op de boot is"*.

De reden is de kanonnen ([kanonnen.md op claude/elastic-chandrasekhar-414110]) en het harpoen
([harpoen.md op claude/angry-mestorf-47e82c]): alleen aan boord moet je het roer kunnen loslaten om een
wapen te bemannen, en tot nu toe rolde ze dan in ~45 s uit.

## Wat er gebouwd is

### 1. Zeilstanden en de zeilen blijven staan

Besluit van de keeper (8 oktober): **zeilstand-knoppen**, en springt wie losliet eraf terwijl er nog crew
is, dan **blijven de zeilen staan** en vaart die crew haar verder.

- **Aan het roer** van een zware romp (`heavyHull`: een craft met `sail.runOut`, dus het galjoen) zijn W en
  S geen gashendel meer maar een stap zeil bij of af (`sailStep` in boat.js). Er zijn zes stappen
  (`SAIL_STEPS`): −1 (zeilen tegen, achteruit), 0, ¼, ½, ¾ en vol. Eén druk is één stap. Houd je de
  toets vast, dan volgt na 0,45 s nog een stap en daarna elke 0,3 s (`SAIL_REPEAT_*` in walk.js). De stand
  blijft staan zonder dat je een toets vasthoudt. Shift is turbo, maar alleen onder vol zeil. A en D
  sturen zoals altijd. De roeiboot en de skiff roei je nog met W/S als gashendel.
- De stand is `b.underSail`, een aandeel van `sail.top`. Ze wordt gestapt als vaste gashendel
  (`stepUnderSail`).
- **Het roer pakken** houdt de stand die er is. Een schip zonder bekende stand (uitrollend na een sprong,
  of nooit bezeild) krijgt de stap die bij haar vaart past, nooit meer (`setSail`). Zo ligt ze niet ineens
  stil.
- **E aan het roer** (`leaveHelm`): de stand blijft staan. Ze houdt haar vaart en koers, met het roer
  midscheeps. Dat geldt op het dek, zittend, in de mast en op haar ladder.
- **Aan de grond** worden de zeilen gestreken (`b.aground`), anders duwt de stand haar het zand in.
- **Eraf** (`letRun`) worden ze op je eigen pagina gestreken en rolt ze uit. Staat er nog crew aan boord,
  dan neemt die het over (zie 3).
- **Escape van het dek** (`exitWalk`) stopt haar zoals voorheen.

### 2. Wie stapt de romp, en de zee

De pagina van wie het roer losliet (de **kustvaarder**, `b.coast.by` in lib/boats.mjs) stapt haar en
stuurt haar positie (`ownHull()`, `movedBoat`). Wie verder aan boord staat, volgt haar track.

- `moved` in lib/boats.mjs neemt bij een zware romp (`holdsSail`) de positie van de kustvaarder aan
  **zolang hij crew is**. Gaat hij van boord, dan telt de `runOut` vanaf dat moment. Een boot zonder
  `runOut` houdt de korte `COAST_MS`.
- **Een patch, geen minor.** `letgo` krijgt een optioneel `sail` (de stand, gecontroleerd op −1..1). De
  bootstatus (`state()`) krijgt `coast` (wie haar vaart) en `sail`, maar alleen zolang niemand aan het
  roer staat. Een oude zee negeert `sail`, een oude pagina negeert `coast`. Geen `SEA_V`, geen nieuw
  bericht. **Wel een redeploy van de open zee** (stack 28): zonder die neemt de zee na 60 s geen positie
  meer aan.

### 3. Meer mensen aan boord

- **Gaat de kustvaarder over de reling of weg** (`leave`, of `release` als de tab dicht gaat) en staat er
  nog crew: `handOn` noemt de eerste daarvan als nieuwe kustvaarder, met de oude stand. Die pagina
  (main.js `onBoatFromServer`) neemt haar over: `v` uit de track (`hullSpeed`), `underSail` uit `sail`
  (of de stap die bij die vaart past), track weg. Vanaf dan stapt die pagina haar. De pagina die
  sprong, ziet dat iemand anders haar vaart en stopt met uitrollen (`walk.stopRunning`).
- `hullFollowed` volgt de door de zee genoemde kustvaarder (`b.coast`). Wie haar niet vaart, stapt haar
  dus ook nooit even zelf tussen twee pakketten. Monsters van een schip met kustvaarder zijn niet `final`.
- **Een tweede aan het roer** neemt het over (`take`): `coast` verdwijnt, zijn pagina vaart, met de stand
  die er stond.
- **Bekend gat bij gemengde versies.** Staat er alleen crew met een pagina van vóór dit, dan wijst de
  nieuwe zee hem toch aan. Die pagina stapt haar niet, de springer stopt met uitrollen, en ze ligt stil
  tot iemand het roer pakt.

### 4. De log in de HUD

Een rij onder de vitals (`.vital.log`, `setLog` in vitals.js): ⛵ (galjoen) of 🚣 (roeiboot/skiff), een
zeegroene balk (snelheid ÷ `top`, turbo maakt hem vol) en de knopen. Zichtbaar voor iedereen op een boot
(`ownHull()`: aan het roer, op het dek, op haar touwladder), in walk mode buiten, dus in `body[data-mode="foot"]`.

- De snelheid komt uit `hullSpeed` (boat.js): van een romp die iemand anders stapt uit haar track (afstand
  over de hele track ÷ tijd, zodat één laat pakket het getal niet halveert), anders uit haar eigen `v`.
  Zo ziet iedereen aan boord hetzelfde.
- **Knopen**, met 1 eenheid = 4 m: `KNOTS_PER_UNIT` = 4 × 3600 / 1852 ≈ 7,78. Het galjoen op topsnelheid
  (13) is ~101 kn, en de roeiboot (9,5) ~74 kn. Speelsnelheid, geen echte. Als dat te gek leest, kan
  de eenheid "m/s" of alleen een balk worden: keuze voor de keeper.
- Op een schip staat de zeilstand naast de knopen ("62.7 kn · ½", ↶ voor achteruit, – voor geen). Een
  gezet zeil maakt de balk canvaswit (`.sails`), en een tooltip zegt de stand voluit.
- Op de telefoon staat de vitals-strip al links van de duimknoppen (harbour.css); de log volgt die maat.
- **Uit te zetten**: Settings → On foot → *Speed on boats* (`promptholm.log`, per browser, standaard aan,
  `body.no-log`).

## Samenhang met het harpoen en de kanonnen

- Het harpoen-plan trekt een schip met `stepBoat(… pull)` op een **losgelaten romp**, en hield rekening met
  de 60 s `runOut`. Die grens geldt nu niet meer zolang de harpoenier aan boord is. De trek hoort in
  **`stepUnderSail`** (boat.js), die het roer en alle vier de dek-stappen in walk.js nu gebruiken. Daar komt een
  `pull` bij, die aan `stepBoat` wordt doorgegeven.
- Trekt het touw haar langzamer of sneller, dan draaien de zeilen dat niet terug: `underSail` is een
  gashendel en geen snelheidsslot. Een trek erbovenop werkt dus vanzelf. Een trek tegen de vaart in
  wint alleen als hij sterker is dan `sail.accel`. Te meten zodra het harpoen trekt.
- De kanonnen bemannen gebeurt vanaf het dek, dus ook daar staan de zeilen.

## Open

- In-game nalopen met twee spelers op één schip (de overdracht is alleen headless en op de zee getest).
- De `sail.accel` van het galjoen bepaalt hoe snel een nieuwe stap doorwerkt (6 s tot vol). Of dat bij
  zeilen goed voelt, is nog niet bekeken.
- De eenheid van de log (knopen, m/s of alleen een balk).
