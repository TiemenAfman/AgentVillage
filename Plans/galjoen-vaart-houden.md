# 🚧 Het galjoen houdt haar vaart, en een log in de HUD

Plan van 8 oktober 2026. De keeper, letterlijk: *"boot moet snelheid behouden (misschien?) en pas als je
er af springt uitrollen? zo kan je de kannon/harpoen bedienen als je alleen bent."* en *"misschien een
kleine snelheidsmeter in de HUD voor iedereen die op de boot is"*.

De reden is de kanonnen ([kanonnen.md op claude/elastic-chandrasekhar-414110]) en het harpoen
([harpoen.md op claude/angry-mestorf-47e82c]): alleen aan boord moet je het roer kunnen loslaten om een
wapen te bemannen, en tot nu toe rolde ze dan in ~45 s uit.

## Wat er gebouwd is

### 1. De zeilen blijven staan

- **E aan het roer** (`leaveHelm` in walk.js) zet de zeilen op de vaart die ze had: `b.underSail` =
  `v / sail.top`, tussen 0 en 1 (`setSail` in boat.js). Alleen voor een zware romp (`heavyHull`: een craft
  met `sail.runOut`, dus het galjoen); een roeiboot heeft geen dek om op te lopen en krijgt nooit zeilen.
- **Aan boord** stapt de pagina haar met die fractie als vaste gashendel en het roer midscheeps
  (`stepUnderSail`). Overal waar walk.js de romp stapte met `{}` (op het dek, zittend, op de touwladder,
  in de mast) doet het nu dat. Ze houdt dus haar snelheid en haar koers, ook minutenlang.
- **Het roer bij loslaten: recht.** Het roer midscheeps; `yawLag` laat een draai die nog gaande was
  uitlopen, zoals altijd.
- **Turbo** wordt niet vastgehouden: wie loslaat op turbosnelheid houdt `top` (fractie 1), de drag brengt
  haar daar.
- **Aan de grond** (`b.aground`) worden de zeilen gestreken. Anders zou de vaste gashendel haar voor altijd
  het zand in duwen.
- **Eraf** (over de reling, via de touwladder naar beneden, losgelaten op de ladder: `letRun`) worden de
  zeilen gestreken en rolt ze uit zoals voorheen (`runOut`, drag).
- **Terug aan het roer** (`board`) worden ze gestreken: de gashendel is weer van jou.
- **Escape van het dek** (`exitWalk`) stopt haar zoals voorheen (`v = 0`, zeilen gestreken). Dat blijft
  logisch: je vliegt omhoog en het schip blijft liggen waar je bent, zodat je haar terugvindt.

Geen zeilstand-knoppen: de vaart bij loslaten ís de zeilstand. Wil je langzamer, dan neem je eerst gas
terug en laat je dan los. Een eigen zeilstand (W/S bij het roer als zeilen bij- of wegnemen) is een
ontwerpkeuze die bij de keeper ligt.

### 2. Wie stapt de romp, en de zee

De pagina van wie het roer losliet (de **kustvaarder**, `b.coast.by` in lib/boats.mjs) stapt haar en
stuurt haar positie, zoals al bij het uitrollen (`ownHull()` in main.js, `movedBoat`). Wie verder aan boord
staat, volgt haar track (`hullFollowed`).

De zee nam die positie tot nu toe maar `runOut` (60 s) na het loslaten aan. Daarna bevroor ze voor
iedereen terwijl haar eigen pagina doorvoer. Daarom is **`moved` in lib/boats.mjs** aangepast: bij een
zware romp (`holdsSail`) mag de kustvaarder haar bewegen **zolang hij crew is**, en `leave` zet de
`runOut` pas in op het moment dat hij van boord gaat. Een boot zonder `runOut` houdt de korte `COAST_MS`.

Gevolg: **de open zee moet worden geredeployd** (stack 28, met de hand). Geen `SEA_V`, geen nieuw bericht,
dus het is een patch. Een zee van vóór dit neemt na 60 s geen positie meer aan. Anderen zien haar dan stil
liggen terwijl ze op je eigen scherm doorvaart.

### 3. Meer mensen aan boord

- **Een tweede aan het roer**: die neemt het over (`take`); vanaf dan is het zijn woord, dat van de
  kustvaarder wordt niet meer gelezen (getest). Zijn eigen pagina stapt haar, de oude kustvaarder volgt.
- **Een tweede op het dek, de kustvaarder springt eraf**: de zeilen worden gestreken en ze rolt uit, ook
  al staat er nog iemand. Overnemen van de zeilen door een ander crewlid zou een nieuw zeebericht vragen.
  Hij kan het roer pakken. Open, zie hieronder.
- **Twee kustvaarders** bestaan niet: `coast.by` is één speler.

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
- Staan de zeilen, dan krijgt de balk een canvaswit verloop (`.sails`) en een tooltip.
- Op de telefoon staat de vitals-strip al links van de duimknoppen (harbour.css); de log volgt die maat.
- **Uit te zetten**: Settings → On foot → *Speed on boats* (`promptholm.log`, per browser, standaard aan,
  `body.no-log`).

## Samenhang met het harpoen en de kanonnen

- Het harpoen-plan trekt een schip met `stepBoat(… pull)` op een **losgelaten romp**, en hield rekening met
  de 60 s `runOut`. Die grens geldt nu niet meer zolang de harpoenier aan boord is. De trek hoort in
  **`stepUnderSail`** (boat.js), die alle vier de dek-stappen in walk.js nu gebruiken. Daar komt een
  `pull` bij, die aan `stepBoat` wordt doorgegeven.
- Trekt het touw haar langzamer of sneller, dan moeten de zeilen dat niet terugdraaien: `underSail` is
  een gashendel en geen snelheidsslot. Een trek erbovenop werkt dus vanzelf. Een trek tegen de vaart in
  wint alleen als hij sterker is dan `sail.accel`. Te meten zodra het harpoen trekt.
- De kanonnen bemannen gebeurt vanaf het dek, dus ook daar staan de zeilen.

## Open

- De zeilen overdragen aan een ander crewlid als de kustvaarder van boord gaat.
- Een zeilstand bij het roer (W/S), als de keeper dat wil.
- De eenheid van de log (knopen, m/s of alleen een balk).
