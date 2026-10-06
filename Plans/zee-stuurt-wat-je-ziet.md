# 🚧 De zee stuurt wat je ziet

Plan van 2 oktober 2026; fase 1 gebouwd op 6 oktober 2026 (branch `claude/elastic-stonebraker-df6e74`, nog niet
gemerged, open zee nog niet geredeployd). Fase 2 is open.

## Waarom

De zee stuurde elke socket de crowd-rijen van **elk** eiland in de wereld. Een pagina tekent mensen alleen binnen
haar NPC Distance van de camera, en alleen op de eilanden die ze heel tekent (`DETAILED`: 4 op desktop, 2 modest,
1 op de telefoon); de rest is silhouet (`horizon.js`). Een islander tekent helemaal niets. Het meeste verkeer werd
dus weggegooid. Het doel: veel meer spelers (telefoons op mobiele data, een toekomstige browser-`/play` voor
zwervers zonder eigen eiland) die de zee weinig kosten.

Wat níét verschuift: autoriteit. Health, guards, combat, lava, adem en boten blijven van de zee.

**P2P/WebRTC is overwogen en afgewezen.** TURN relayt in de praktijk toch (dus geen besparing op de server),
upload wordt O(n²) op telefoons, IP-adressen van spelers liggen bloot, en het is een tweede codepad naast de zee.

## Gemeten vóór (2 oktober 2026)

**Open zee** (`scripts/sea-listen.mjs`, één kijker zonder lijf, 60 s, 6 eilanden, 884 settlers):

| bericht | kB/s per kijker |
|---|---|
| `f` (crowd-rijen) | 12,53 (94%) |
| `af` (dieren) | 0,55 |
| `s` (pose-beat, niemand liep: `{"t":"s","a":[]}` 15×/s) | 0,24 |
| `roster` | 0,07 |
| **totaal** | **13,4** (60 berichten/s) |

Per eiland: Hoogezand (600 settlers) 7,0 kB/s, BierRum (188) 4,9, de vulkaan 0,55, de starters ~0,02.
Join-dump: ~62 kB (welcome 12, `fr` 17, `f` 30).

Container (Portainer, stack 28): ~50 kB/s uit, ~9,5 kB/s in, 2% CPU, 110 MiB. Twee van die sockets waren
islanders, die **alles** kregen (net zoveel als een pagina) en het negeerden: `lib/seaclient.mjs` leest alleen
`refused`, `animal` en `welcome`.

**Lokaal** (`scripts/sea-load.mjs`, K kopieën van Hoogezand, 4 kijkers, 15 s): lineair in settlers en kijkers.

| eilanden | settlers | per kijker | zee uit |
|---|---|---|---|
| 1 | 604 | 3,6 kB/s | 14 kB/s |
| 2 | 1204 | 6,9 | 28 |
| 4 | 2404 | 13,6 | 54 |
| 2 (+2 islanders, 8 kijkers) | 1204 | 7,1 (islander ook 7,1) | 71 |

Vuistregel: ~6–12 B/s per settler per kijker (overdag meer lopers). Zee-uit = kijkers × alle settlers × dat.
Twintig eilanden van 300 settlers is 36–72 kB/s per kijker; met 32 kijkers ruim 1–2 MB/s.

## Besluiten (fase 1)

1. **De pagina zegt welke eilanden ze tekent, als lijst van id's** — `{t:'want', i:[ids]}`, en dezelfde lijst
   als `want` in het `join`-bericht zodat de join-dump er meteen naar is. Niet het focuspunt + bereik dat eerst in
   de opdracht stond, en waarom:
   - een lijst is exact: hij bevat `DETAILED` (een eiland zonder crowd view tekent niemand, hoe dichtbij ook),
     wat een punt + straal niet kan uitdrukken;
   - hij is vrij van frames: geen `homeOrigin`-vertaling, dus geen klasse tekenfouten op de lijn;
   - de pagina vraagt pas als haar crowd view bestaat, dus de dump valt nooit in het niets (met een punt kon de zee
     de dump sturen voordat de pagina het eiland had opgebouwd);
   - de zee rekent geen geometrie per socket per beat.
   Een focuspunt is wél nodig voor fase 2 (spelers), en komt dan als eigen veld.
2. **Wanneer is een eiland gewild** (`syncWant` in `web/js/main.js`, elke 400 ms op de frame): er is een crowd view
   (thuis, of een gast die heel getekend wordt) en de box van het eiland ligt binnen NPC Distance van de **camera**
   — dezelfde vlakke afstand en hetzelfde oog als `beyond` in `crowd-view.js`, zodat een lijf nooit binnen bereik is
   terwijl zijn eiland niet gewild is. Plus `NPC_PAD`, `WANT_PAD` 32 (bootjes tot 13 van de ligplaats, guards die
   uit de kust zwemmen) en `WANT_HYST` 48 om los te laten (geen flapperen langs de rand). NPC 0 (planner) = alles.
   Niet het focuspunt van `pickDetailed`: de cut die ertoe doet is die tegen de camera.
3. **Loslaten = vergeten.** `crowd.forget()` wist `to`/`from` van elk lijf en haalt de rompen weg (een romp heeft
   geen NPC-cut). Rijen die nog onderweg zijn worden in `onCrowdMessage` weggegooid. Een lijf zonder `to` tekent
   `draw()` niet (de bestaande regel tegen mensen op het plein), dus terug in bereik staat niemand op een oude plek.
4. **Opnieuw willen = alles in één keer.** De zee stuurt bij elk nieuw gewild eiland meteen `f` met `slices: 1`,
   de rides en `fh` (`sendCrowd` in `lib/sea.mjs`), dus de mensen verschijnen waar ze staan, niet in het midden
   en niet over tien seconden. Een crowd view die opnieuw is gemaakt onder een id dat al gewild was (reseed, gast
   opnieuw opgebouwd) wordt even losgelaten en opnieuw gewild, zodat ook die meteen alles krijgt — dat was
   voorheen tien seconden druppelen.
5. **Per berichttype:**
   - `f`, `fh`: alleen naar wie het eiland wil (`toWatchers`).
   - `fr` (roster): naar elke pagina — klein, alleen bij een dorpswijziging, en nodig om rijen bij nadering te lezen.
   - `af`, `herd`: naar elke pagina — dieren hebben geen NPC-cut (`animal-view.js`) en zouden bevriezen; samen
     een paar honderd bytes per seconde.
   - weather, clock, island, boat, agent, said, ui: ongewijzigd naar iedereen (klein, of overal nodig).
6. **Een islander krijgt niets dat alleen een pagina tekent**: geen `f`, `fh`, `fr`, `af`, `herd`, en ook geen
   `s` of `roster` (`watching: false` in `lib/players.mjs`). Besloten aan `as` alleen, dus het werkt voor elke
   islander die al draait.
7. **Een lege pose-beat gaat één keer uit**, niet 15× per seconde (`saidNobody` in `lib/players.mjs`). De ene
   lege haalt de laatste loper van elk scherm (`peers.js`); een pagina die later joint heeft niemand getekend.
8. **Meter**: `lib/wiremeter.mjs` telt per berichttype berichten en bytes op elke `send` (gewikkeld in `onOpen`),
   in geheugen; `/health` geeft `wire` plus `sockets` en `wanting`. Twee metingen na elkaar zijn een tempo.

## Compatibiliteit: een patch

Geen `SEA_V`-bump, niets in layout, config of bundle.

- Oude pagina, nieuwe zee: zegt niets, `want` blijft `null`, krijgt alles zoals vroeger.
- Nieuwe pagina, oude zee: `want` wordt genegeerd (één token uit de bucket), de zee stuurt alles; de pagina gooit
  rijen van niet-gewilde eilanden weg en vergeet ze, dus het beeld klopt, alleen de bytes blijven.
- Oude islander, nieuwe zee: krijgt minder, leest dat toch niet.

De besparing komt pas als **de open zee geredeployd is** (stack 28, handmatig). Nodig voor correctheid is dat niet.

## Gemeten na

`scripts/sea-load.mjs`, 4 kopieën van Hoogezand (2404 settlers), 4 kijkers + 2 islanders, 15 s:

| kijkers zeggen | per kijker | per islander | zee uit |
|---|---|---|---|
| niets (oude pagina) | 13,4 kB/s | 0 (was 13,4) | 53,5 kB/s |
| één eiland | 3,5 | 0 | 14,1 |
| geen eiland (`[]`) | 0,13 (was 0,37) | 0 | 0,5 |

Voor de open zee van 2 oktober betekent dat: de twee islanders (~27 kB/s van de ~50) vallen weg; een telefoon op
Hoogezand (NPC 200) krijgt ~7 kB/s in plaats van 13,4, op een starter of op zee ~0,1–0,6.

In de browser (kopie van het eiland, eigen zee, NPC Distance 100): weg van Hoogezand zwemmend naar de vulkaan
kregen alle 67 bewoners van de vulkaan hun plek in één frame, niemand stond in het midden; ver genoeg weg werd
Hoogezand losgelaten (0 posities), en terug in bereik kregen alle 600 in één keer hun plek, opnieuw niemand in
het midden. `/health` toonde `wanting: 1`.

## Fase 2 (open)

Alleen als de cijfers het rechtvaardigen:

- **Spelers** (`s`): elke loper gaat 15×/s naar elke socket, ~50 B per rij, dus O(spelers²): 32 lopende spelers is
  ~24 kB/s per socket en ~770 kB/s voor de zee. Voor `/play` met veel zwervers is dít de volgende kostenpost. Dat
  vraagt wél een focuspunt van de kijker (de camera, in wereldcoördinaten via `homeOrigin` zoals poses), een
  bereik, en een lager tempo voor verre spelers.
- **Goedkopere rijen**: delta's, of een lager tempo (keyframes en lopers) voor eilanden die wel gewild maar ver
  weg zijn. Pas als een grote zee met veel lopers het nodig maakt.
- **Dieren** (`af`) per eiland filteren zodra `animal-view.js` een NPC-cut heeft.
