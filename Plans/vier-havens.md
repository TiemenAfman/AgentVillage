# Vier havens, wegen naar het plein, meer boten per haven

Wens (Martijn, 2026-09-23): elk eiland krijgt **vier** kades in plaats van één, elke kade een
**weg naar het plein**, en per kade kun je **meerdere boten maken**.

## Hoe het nu zit (gemeten, zie de verkenning in de sessie van 23-09)

- **Eén kade, om twee redenen tegelijk.** Alle Cowork-sessies wonen in één district
  `{id:'quay'}` (`lib/village.mjs:316`), en `planksOf(village)` in `shared/quay.mjs` pakt het
  *eerste* district met een `pier`. `pickPier` (`lib/layout.mjs`) kiest één kustcel (score:
  noordkant, dicht bij de stad, midden van een stuk kust), `pierCells` legt max. 5 planken, en
  die zijn daarna sticky in `layout.districts.quay.pier`. `QUAY_VERSION` (2) is de poort.
- **Drie partijen rekenen dezelfde kade uit** zonder bericht ertussen: de pagina
  (`dockFor`/`buildDocks` in `main.js`), de zee (`lib/fleet.mjs` → `mooringFor`) en de
  settler-uitjes (`lib/crowd.mjs`, dat nu *zonder* planken rekent - een bestaand verschil).
  De bundel draagt `pier`/`shore`/`deck` en `landing`, geen boten.
- **Eén boot per eiland.** `mooringFor` geeft één `{id:'boat:<regio>'}`; `lib/boats.mjs` houdt
  precies de boten van de ligplaatsen bij, schrijft niets weg, en brengt een verlaten boot na
  5 min terug. `takeBoatAt` in `main.js` zoekt de ene boot van de regio. `tests/fleet.test.mjs`
  zegt letterlijk "every island brings one boat".
- **De kade heeft geen eigen weg naar het plein**; het quay-district krijgt als elk dorpje een
  `road:quay:<n>` vanaf zijn perceel, de planken zelf hangen er via het `deck` aan. Precedent
  voor een extra sticky weg: `road:polder:<n>:approach`.
- **Maken/kopen** bestaat al: de beurs in `data/garden.json` (`buySeed`-patroon), het
  bouwmenu, en de deur `POST /island/:id/parcel` voor "wat er op een eiland staat" zonder
  `rev` te bewegen. Er is een `dock`-prop, maar die is puur decor.

## Voorstel

1. **Vier havens, één per windstreek.** De huidige kade blijft haven 1, precies waar hij ligt
   (een huis verhuist nooit vanzelf). De andere drie kiest `pickPier` per kwadrant van de kust
   (N/O/Z/W vanuit het stadscentrum), met dezelfde score, en ze zijn net zo sticky. Een kwadrant
   zonder bruikbare open-waterkust krijgt geen haven (en een lege plek in `layout.harbours` onthoudt
   dat we het gevraagd hebben, zoals `fairway: {cells: []}`). Opgeslagen als een lijst `layout.harbours`
   naast het quay-district, niet als vier districten: de Cowork-sessies blijven in één dorpje
   wonen, de haven is infrastructuur. Nieuwe poort `HARBOUR_VERSION`, de kleinste die het doet.
2. **Een weg per haven naar het plein**: `road:harbour:<n>:approach`, gerouteerd zoals de
   polderweg (van de walkant van de planken naar `SQUARE`), sticky, en `stranded` in
   `lib/plan.mjs` hoort ook een haven zonder weg te weigeren.
3. **Meer boten per haven, gemaakt door de keeper**: bij een haven "Bouw een boot" (E),
   **gratis**, max. **3 per haven** (besloten 23-09; een kade van 5 planken heeft plek voor 3
   ligplaatsen). Opgeslagen per haven in `layout.json`
   (`harbours[n].boats: [{id, madeAt}]`), zodat het de zee overleeft die niets wegschrijft; de
   islander publiceert ze via de bundel (nieuw veld, streng in `parseBundle`), de zee meert ze.
   Boot-ids `boat:<regio>-h<n>-<k>` (de huidige `BOAT_ID`-regex staat geen `:` toe na `boat:`).
   Een bundel zonder havenlijst (oudere islander) krijgt van de zee de ene boot van nu, zodat
   een wereld met gemengde versies blijft varen.
4. **Eén bron voor de rekensom**: `shared/quay.mjs` krijgt `harboursOf(village)` en
   `mooringsFor(...)` die alle drie de partijen gebruiken; `lib/crowd.mjs` gaat daarbij ook de
   planken volgen (het bestaande verschil).

## Volgorde

a. havens + wegen (layout, poort, tests) → b. tekenen + lopen op vier kades (pagina) →
c. meerdere ligplaatsen per haven in shared/ + de zee (fleet, boats, wire) → d. boot bouwen
(prompt bij de haven, opslaan, publish). Elk stap apart te mergen; na (b) zie je al vier havens.

## Besloten (23-09)

- Plek: één haven per windstreek, automatisch, sticky; de huidige kade blijft haven 1.
- Boot maken: gratis, max. 3 per haven.

## Open vragen

- Mag een bezoeker een boot van een ander eiland pakken (nu: ja, wie er eerst is)?
- Kan de keeper een haven verplaatsen in de planner (nu niet in dit plan)?

## Stand (23-09)

- **(a) klaar.** `layout.harbours` (null = nooit gevraagd), gekozen door `planHarbours` met
  `pickPier` per windstreek; de staande kade (het quay-district, of anders de van de landing
  afgeleide kade die de pagina en de zee al tekenden) is de haven van zijn eigen kant. Elke
  haven heeft een helling `road:harbour:<n>` over het strand (strand is BLOCKED, dus afgedwongen
  zoals de dijkweg van een polder) en een weg `road:harbour:<n>:approach` naar het plein,
  gepland ná de eigen brug van het eiland (anders bouwt de weg de brug en ziet `planBridge` de
  rivier al overgestoken). Gemeten op een kopie van Hoogezand: vier havens, 0 huizen verplaatst,
  0 bestaande wegen veranderd, brug blijft, tweede scan byte-identiek; de huidige kade is de
  oostelijke haven. `village.json` draagt `island.harbours`.
- **(b) klaar.** `quaysOf` in `shared/quay.mjs` (één lijst voor pagina en straks zee; zonder
  havens de ene kade van vroeger); `docksFor`/`buildDocks` tekenen alle vier, ids
  `dock:<regio>:<kant>`; de prompt noemt de haven en zegt "no boat here" waar er geen ligt.
- **(c) klaar.** `mooringsFor` in `shared/quay.mjs`: de eerste boot houdt `boat:<regio>` en
  zijn oude ligplaats (oudere pagina's en zeeën vinden hem zo), de rest is
  `boat:<regio>-<kant><k>` op drie ligplaatsen per haven (weerszijden van de kop, en naast het
  midden). De bundel draagt `island.harbours` met `boats`, streng in `parseBundle` (0..3, een
  kant, planken); `lib/fleet.mjs` houdt per eiland de hele lijst ligplaatsen bij.
- **(d) klaar.** B bij een eigen haven → `POST /api/harbour/boat` (alleen de keeper) → telling in
  `data/boats.json` (`lib/boatyard.mjs`, een eigen bestand zodat `layout.json` één schrijver
  houdt) → rescan → publish. De prompt zegt "B build a boat (1 of 3)"; `harbourSig` in
  `applyVillage` laat de nieuwe boot verschijnen zonder herladen. Gemeten op een testserver:
  twee boten bij noord, de oude bij oost, een vreemde Origin krijgt 403.
- **Niet gedaan:** een haven verplaatsen in de planner; boten weer weghalen.
