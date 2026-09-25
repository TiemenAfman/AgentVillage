# Inwoners aan het werk

## Aanleiding

Een inwoner zonder lopende sessie doet nu twee dingen: een beetje heen en weer drentelen voor
zijn eigen deur, en af en toe een wandelingetje over de wegen. Tiemen wil dat ze in die tijd
werk doen: op de akkers buiten de hekken, in de moestuinen binnen de hekken, hout hakken en
sprokkelen in het bos, en vissen.

## De moeilijkheid

De inwoners lopen op de **zee** (`shared/settlerwalk.mjs`, gestapt door `lib/crowd.mjs`), die
alleen de bundel van een eiland heeft. Maar waar de akkers, moestuinen en bomen staan wordt in
de **browser** beslist: `planFields` in `web/js/hamlets.js` en de bosstrooiing in
`web/js/world.js` leunen op eigendom, `settledDistance`, `cleared` en de hekken - allemaal
tekenwerk dat de zee niet heeft en niet hoort te krijgen.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Hoe weet de zee waar het werk is? | De pagina van de eilandhouder **meldt de werkplekken**, precies zoals ze nu al meldt waar de huizen echt staan: `reportPlacements` → `POST /api/placements` → `data/placements.json` → `bundle.work`. | Dat is het bestaande patroon voor "alleen de renderer weet dit". Een tweede kopie van `planFields` in `shared/` zou uit de pas gaan lopen met wat er getekend wordt. |
| Wat staat erin? | `fields` en `gardens` als `[gx, gz, w, d]` in cellen, `trees` als `[x, z]` lokaal. Alleen bomen binnen bereik van bewoond land (`settled.dist <= FIELD_REACH`), hooguit 500. | Cellen, geen namen: er valt niets in te redigeren (zelfde redenering als `decks`). De bosrand is waar iemand hout haalt, niet het midden van de wildernis. |
| En vissen? | Berekend **op de zee** zelf, uit `terrain.coastCells` (land naast water) binnen bereik van een weg, plus de planken van de kade (`quayFor`). | Kust en kade zijn `shared/`-kennis; daar hoeft niemand iets voor te melden. |
| Nog geen melding binnen? | Dan alleen vissen, en verder het oude gedrag. | Een eiland dat nog nooit getekend is, heeft geen akkers die de zee kent. Het heelt zichzelf zodra iemand kijkt - net als de plaatsingen. |
| Wie gaat werken? | Alleen wie `idle` is: niet aan het hameren (sessie loopt), niet uitgeleend aan een boot, niet op de borrel. Op de stroll-timer: 65 % van de keren een klus in plaats van een wandeling, als er werk binnen bereik is. | "Als ze niks aan het doen zijn." |
| Welk werk? | Gewogen loting tussen de soorten die binnen bereik van de eigen deur liggen; elke inwoner heeft een **lievelingsvak** (gehasht op het id) dat drie keer zo zwaar weegt. Binnen een soort: één van de vier dichtstbijzijnde plekken, binnen 12 (moestuin), 18 (akker, bos) of 24 cellen (vissen) van de eigen straat. Gemeten: met 18-34 cellen en 25-70 s werk liep het dorp vooral heen en weer - vijf van de 136 tegelijk aan het werk. | Zo krijgt het dorp gezichten - de visser, de houthakker - zonder dat iemand alleen maar één ding doet. |
| Hoe lang? | 45-120 s werk (vissen 70-160 s), in slagen van een paar seconden; tussen de slagen verplaatst een boer zich een stukje over zijn akker. Een houthakker hakt eerst (`chop`), sprokkelt daarna op twee of drie plekken rond de boom (`gather`) en loopt met een bos takken op de schouder naar huis (`haul`). | Een lichaam dat 60 s stilstaat op één plek leest als vastgelopen. |
| Hoeveel tegelijk? | `MAX_CHORES` = 48 naast de 36 van `MAX_STROLL`, en hooguit 2 nieuwe klussen per tick. | Een route plannen is het dure ding (`findPath` sorteert zijn open lijst); de borrel heeft om dezelfde reden `GATHER_PER_TICK`. |
| 's Nachts en op de borrel? | Geen nieuwe klussen na donker (vissen mag tot diep in de schemering); de borrel breekt het werk af en iedereen loopt eerst naar huis. | |
| Wie zegt dat het nacht of borrel is? | **De zee**, op Nederlandse tijd (`shared/daylight.mjs`: `islandClock`, `nightAt`, `borrelAt`), elke beat. De browser rekent de tafels op dezelfde klok. | Ontdekt tijdens dit werk: sinds `5bfd696` (19 september) stapte de zee elke menigte met `crowds.tick(0)` en riep niemand `setGather` aan - het was eeuwig middag en de borrel was stil. Eén tijdzone voor de hele wereld, zoals er één weer is; een zee in een container staat anders op UTC. `tests/daylight.test.mjs` houdt de nachtcurve gelijk aan de `DAY`-tabel in `world.js`. |
| De draad? | Zes animaties achteraan in `ANIMS`: `hoe`, `weed`, `chop`, `gather`, `fish`, `haul`. `haul` telt als lopen (loper-snelheid). Een oude pagina leest een onbekend nummer als `still`. | Achteraan zodat bestaande nummers niet verschuiven. |
| Verplaatsen tussen slagen? | Als `walk`, niet als `step`. | Alleen lopers gaan met 5 Hz over de draad; een `step` zou pas bij de volgende keyframe (10 s) aankomen en over die tijd uitgesmeerd worden. |
| Gereedschap? | Schoffel, bijl, hengel en een bos takken: vier extra `InstancedMesh`es voor de hele menigte, die alleen `visible` zijn als iemand ze vasthoudt. Het zwaard van een vijandig eiland gaat weg voor het gereedschap, zoals al bij de hamer. | Een bijl per persoon zou honderden draw calls zijn. |
| Valt de boom om? | **Nee**, nog niet. | De bomen worden per paginalading gestrooid en bestaan niet op de zee; een gekapte boom zou een nieuw gedeeld feit zijn met een eigen deur. Dat is een apart plan. |
| Door hekken lopen? | Het laatste stuk van de route is `findPath` over open land, dat hekken niet kent. Geaccepteerd. | Er is nergens botsing met hekken; de akkers liggen binnen `FIELD_REACH` van een weg, dus het is een paar cellen. |

## Bestanden

- `web/js/world.js` — `workSites()` op het landschap: akkers, moestuinen, bosrand.
- `web/js/main.js` — `reportPlacements` stuurt `work` mee.
- `lib/placements.mjs` — `parseWork`, opgeslagen naast `at` en `decks`.
- `lib/islandbundle.mjs` — `work` in de bundel, veld voor veld herbouwd en begrensd.
- `shared/settlerwalk.mjs` — `setWork`, `startChore`, de werkfase en `MAX_CHORES`.
- `lib/crowd.mjs` — geeft `bundle.work` en de visplekken (kust + kade) aan de walk.
- `shared/settlerwire.mjs` — de zes animaties, en `haul` als loper.
- `web/js/crowd-view.js` — werk-animaties doorgeven als het lichaam stilstaat.
- `web/js/settler-figures.js` — de houdingen en de vier gereedschappen.
- `tests/settler-chores.test.mjs`.
