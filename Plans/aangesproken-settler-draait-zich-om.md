# Een aangesproken settler draait zich om, op elk scherm

**Status: gebouwd en nagekeken op 24 september 2026.** Onderaan staat hoe.

## Aanleiding

Spreek je een settler aan (`faceUp` in `web/js/main.js`, of een biertje geven), dan houdt de
zee hem vast: `lib/crowd.mjs attend` → `shared/settlerwalk.mjs attend`, en de stap zet
`face(f, attend - pos, 0.12)`. Op de zee staat hij dus stil en draait hij naar je toe. Maar een
crowd-rij op de draad (`encodeCrowd`) is alleen `[idx, x, z, anim]` — geen richting — en
`crowd-view.js draw` draait een lichaam alleen als het beweegt (`if (moving) f.face = …`).
Een vastgehouden settler blijft dus kijken naar waar hij heen liep, voor iedereen, ook voor
wie hem aanspreekt. Nagekeken op 24 september 2026: na de `seaIdOf`-fix bevriest zijn `to` en
wordt `said` 'still', maar er komt geen richting binnen.

Daarbij: `faceUp` stuurt nog de id van de pagina (`house:<uuid>`), die de zee niet kent — de
zee kent onze settlers als `house:s3`. Zonder `seaIdOf` daar wordt een gesprek niet eens
vastgehouden; alleen het bier gebruikt het al.

## De opties

| | Wat | Kost op de draad | Wie ziet het |
|---|---|---|---|
| (a) | Wie vastgehouden wordt en waar de spreker staat, als eigen zeldzaam bericht | 53 B bij het begin van een gesprek en 40 B bij het einde, per kijker | iedereen |
| (b) | Een richting in de rij, alleen voor vastgehouden/stilstaande rijen | een stilstaande rij gaat maar eens per `KEYFRAME_S` over de draad, dus de draai komt tot 10 s te laat — of hij moet elke beat mee (`absence = losgelaten`, zoals de bootjes): 15 B op een beat die toch al gaat, 67 B op een beat die anders stil was, dus tot ~1 kB/s per kijker zolang er gepraat wordt. Tegen 1,3 kB/s voor de hele crowd. En een ander rij-formaat is iets wat een oude pagina verkeerd leest: `SEA_V` omhoog. | iedereen |
| (c) | Alleen op de pagina van de spreker | niets | alleen de spreker |

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Welke optie? | **(a)**, als één bericht `{t:'fh', i, h}` per eiland met de **hele** set: `h` is plat `[idx, x, z, …]`, het punt waar de spreker staat, in het eigen frame van het eiland en op dezelfde `GRID` als een positie (`encodeHeld`/`decodeHeld` in `shared/settlerwire.mjs`). | Een gesprek duurt seconden tot minuten en het punt verandert daarin niet; iets wat niet verandert hoort niet op de beat. Een hele set in plaats van "begin"/"einde" maakt elk bericht zelfstandig waar: niets om uit de pas te raken. |
| Wanneer gaat het de deur uit? | De zee leidt de set **elke beat af uit de walk zelf** (`f.attend` van elke zichtbare figuur die niet in een boot staat) en stuurt hem alleen als hij anders is dan wat ze die eilanden het laatst zei. Plus één keer per eiland bij het joinen, na de roster en de posities — ook als hij leeg is. | `f.attend` wordt op meer plekken gewist dan via `release` (een bewaker die valt, een Codex-bewoner die verhuist of weggaat, een herbouwde crowd na een publish), en een compact van de vulkaan-crowd nummert indices om. Afleiden uit de waarheid vangt ze allemaal zonder één haakje per plek. Kost: één extra ronde over de figuren per crowd per beat (gemeten, zie onder). |
| Index of id? | **Index**, net als `f`. | Voor ons eigen eiland is de id op de zee een geredigeerde naam (`house:s3`); de index hoeft niet vertaald te worden en de view heeft hem al. Een index die verschuift, verschuift in de afgeleide set mee. |
| Punt of richting? | **Punt.** De pagina zet `f.face = punt - getekende positie`, `f.turn = 0.12` — precies wat de walk op de zee schrijft. | Geen `atan2` nodig in `shared/`, en het blijft kloppen terwijl het lichaam nog zijn laatste pas uitglijdt. |
| Wanneer draait het lichaam op de pagina? | Pas als het stilstaat. Zolang het nog naar het laatste woord glijdt, kijkt het in de looprichting. | De zee stopt hem direct; de pagina loopt een bericht achter. Tijdens die laatste pas al naar de spreker kijken leest als een zijstap. |
| Losgelaten | De volgende `fh` zonder die index: de view vergeet de spreker, het lichaam houdt de richting waar het naar keek tot het weer gaat lopen. | Terugdraaien naar een eerdere richting is niets wat de walk ook doet. |
| Versie | **`SEA_V` blijft 3.** Een nieuw berichttype: `net.js` laat een onbekende `t` vallen (`default: break`), een oude pagina ziet dus wat ze altijd zag. Een oude zee stuurt nooit `fh`, en een nieuwe pagina doet dan wat ze deed. | Alleen ophogen als een oude peer iets verkeerd zou lezen. |
| Eilanden die nog niet getekend zijn | De laatste `fh` per eiland wordt bewaard tot de gast-crowd bestaat (zoals `crowdRosters`); voor ons eigen eiland bewaard op `state` en opnieuw gegeven na een reseed (zoals `homeRoster`). | Het join-bericht komt altijd vóór de bundle binnen is. |
| `faceUp` | Stuurt `seaIdOf(id)`, net als het bier. | Anders houdt de zee niemand vast. |

## Gemeten

Op een dorp van 274 (script met `createWalk` + `encodeHeld`, 20 000 beats):

- Eén gesprek: `{"t":"fh","i":"<16 hex>","h":[273,1302,1601]}` = **53 B**; loslaten `"h":[]` = **40 B**.
  Beide één keer per kijker, niet per beat.
- De set afleiden (`encodeHeld` + `join`) kost **~1 µs per beat** per crowd, tegen 4,6 µs voor
  `encodeCrowd` zelf; bij 15 beats/s is dat 0,0015% van een core.
- Ter vergelijking (b): 15 B extra op een beat die toch gaat, 67 B voor een beat die anders stil
  was; tot ~1 kB/s per kijker zolang er gepraat wordt.
- Bij het joinen gaat er per eiland altijd één `fh` mee, ook leeg: een pagina die terugkomt (herstart
  van de zee, andere zee) kan nog het woord van de vorige zee vasthouden, en niets anders
  vertelt haar dat het voorbij is.

## Bestanden

- `shared/settlerwire.mjs` — `encodeHeld`, `decodeHeld`.
- `lib/sea.mjs` — de afgeleide set per beat, `fh` bij verandering en bij het joinen.
- `web/js/net.js` — `fh` naar `onCrowd({ kind: 'held' })`.
- `web/js/crowd-view.js` — `held(rows)`, en in `draw` de draai naar de spreker.
- `web/js/main.js` — routeren (thuis, gast, nog niet opgebouwde gast), `seaIdOf` in `faceUp`.
- Tests: `tests/settler-wire.test.mjs`, `tests/sea-attend.test.mjs`, `tests/crowd-view.test.mjs`.

## Nagekeken

- `node --test "tests/*.test.mjs"`: 739 van 739 groen. Nieuw: vier in `settler-wire` (heen en
  terug, niet in een boot, een lege set laat iedereen los, wat het kost), twee in `sea-attend`
  (een toeschouwer én de spreker krijgen de set, één keer en niet elke beat, een late joiner
  krijgt hem bij het joinen, weggaan en een herpublicatie geven een lege set; en de join-dump
  draagt altijd een `fh`), vier in `crowd-view` (draait naar de spreker op het tempo van de
  walk, pas na de laatste pas, blijft staan na loslaten, een set die vóór het lichaam binnenkomt
  blijft bewaard). Met de `fh`-broadcast of de draai in `draw` uitgezet falen ze.
- In de browser (worktree-islander op een eigen zee): `state.net.attend(seaId, …)` op een
  stilstaande settler met de spreker recht achter hem → `fh` kwam binnen, `yaw` liep van 0 via
  2,51 naar 3,10 (de spreker, ≈ π); na `unattend` bleef hij zo staan.
