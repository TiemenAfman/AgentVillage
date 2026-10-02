# 🚧 Zeetijd van de host

Plan van 2 oktober 2026.

## Waarom

De klokchip rechtsboven had een lens: klik (of H) en dít scherm toonde 07:00, 12:00, 18:30 of
22:00. De keeper wil dat niet - meermaals gevraagd, en het kwam steeds terug. De tijd is de tijd
van de zee (`worldNow()` / `worldTime()`, uit de welcome en `{t:'clock'}`), en een speler verzet
die niet voor zichzelf. Eén uitzondering: **wie de zee host mag de tijd van de zee zetten**, en
dan volgt iedereen op die zee.

## Beslissingen

- **Geen lens meer op de chip.** `onToggleTime` en de `h` in `ORBIT_KEYS` gaan weg, net als
  `data-key="H"` op de chip. Voor iedereen behalve de host doet een klik niets (geen
  pointer-cursor, de title zegt dat het de klok van de zee is). Geen "alleen in multiplayer":
  single player is hetzelfde codepad (serve.mjs joint zijn eigen zee). `?hour=` blijft, als
  ontwikkelaarslens voor screenshots, en de kroniek blijft wat ze is (een lens met eigen paneel).
- **Host** = de keeper wiens islander de zee draait waar deze pagina op zit:
  `multiplayer.sea.mode` is `single` of `host` en `ownSea` staat. `/api/hello` zegt het als
  `seaHost`, alleen tegen `role: 'islander'`. Nooit een bezoeker, nooit de telefoon (die heeft
  geen islander), nooit wie andermans zee gejoind is, en nooit de open zee in Docker (stack 28):
  die heeft geen host. `SEA_ADMIN_KEY` mag de tijd daar níet zetten - nu niet: een open wereld
  waarin één sleutel voor iedereen de nacht kan maken is een andere vraag.
- **Hoe de islander zijn zee bereikt: niet over HTTP.** `serve.mjs` maakt zijn eigen zee met
  `createSea` *in zijn eigen proces* (`ownSea`). Dus de host is gewoon wie het object in handen
  heeft, en de zee krijgt een methode (`sea.setTime`) in plaats van een route. Geen nieuwe deur
  in de zee betekent: geen sleutelcheck, geen host-token, niets dat iemand op het netwerk kan
  proberen - een route die "alleen van de host" moet komen is een slot dat we niet hoeven te
  bouwen als er geen deur is. De lijn naar huis blijft één kant op. Een test houdt vast dat de zee
  geen HTTP-route voor de klok heeft.
- **De keten:** pagina → `POST /api/sea-time` op de islander (keeper-only: achter
  `lib/access.mjs`, niet op `PUBLIC_API`; geweigerd als we niet hosten) → `ownSea.setTime` →
  de klok van de zee krijgt een verschuiving (`shift`, ms) → broadcast `{t:'clock', now, tz,
  shift}` aan iedereen die gejoind is → elke pagina zet `seaSkewMs` opnieuw, dus `worldNow()`,
  wolken, deining en maan volgen. De beat van de zee zelf (`nightAt`, `gatheringAt`) leest
  `worldTime(clock.at(), …)` en volgt dus ook: de bewoners gaan naar huis als de host het nacht
  maakt.
- **Wat de verschuiving is:** "spring naar uur h" kiest de dichtstbijzijnde h op de wandklok van
  de zee (binnen een halve dag vooruit of terug), en daarna loopt de tijd gewoon door. "Echte
  tijd" is `shift` 0. Het weer draait door op de echte klok: dat is een eigen elfminutenritme,
  geen kalender.
- **Alleen in het geheugen.** De zee schrijft niets naar schijf, dus een herstart van de zee - en
  dus van de islander, of een wissel van zeemodus - is weer echte tijd. Dat is goed zo, en het
  staat in CLAUDE.md.
- **Patch, geen minor.** Een oudere pagina leest `{t:'clock'}` al als "zet de klok gelijk"
  (`net.js` → `onFleetNews` → `seaSkewMs`) en negeert `shift`; de welcome draagt de verschoven
  `now`. Niemand leest iets verkeerd, dus geen `SEA_V`-bump, niets in layout/config/bundle. De
  open zee hoeft er niet voor herdeployed te worden: daar zet niemand de tijd.

## Bouwen

1. `lib/seaclock.mjs`: `shift`, `at()`, `setShift`, `toHour(h)`; `current()` en `tick()` op de
   verschoven tijd, `current()` met `shift`.
2. `lib/sea.mjs`: de beat op `clock.at()`, `shift` mee in de broadcast, `setTime({ hour } |
   { real: true })` op het zee-object.
3. `serve.mjs`: `seaHost` in `/api/hello`, `POST /api/sea-time`.
4. Pagina: chip zonder lens; voor de host een popover (`web/js/popover.js`) met een paar uren en
   "echte tijd"; de chip zegt `· set by host` zolang de zee verschoven is.
5. Tests: bronlezend (geen `onToggleTime`, geen `clock-chip` in `ORBIT_KEYS`, de chip-handler
   vraagt eerst `seaHost`); de klok en de zee (`setTime` broadcast, welcome verschoven, geen
   HTTP-route).
