# Een open zee, een tick, en eilanden die joinen

## Context

Promptholm is vandaag één proces dat vijftien dingen tegelijk doet. `serve.mjs` (1443 regels,
~42 routes) is statische fileserver, HTTP-API, WebSocket-gameserver, SSE-bron, rescan-timer,
UDP-baken, agent-spawner, mailserver, Jira/GitHub-bord, git-client én de hele bezoek-machinerie.
De browser gaat er overal van uit dat hij praat met de server die hem geserveerd heeft: **41
root-relatieve `fetch`-aanroepen over 11 bestanden**, de WebSocket-URL uit `location.host`
(`web/js/net.js:56`), een absolute import-map (`web/index.html:72-80`), texturen via het
*relatieve* `'textures/'`, en een invite-cookie op `SameSite=Lax`.

Een buur bezoeken is daardoor een echte paginasprong: `cross()` (`web/js/main.js:1687`) stuurt de
browser naar hún server, waar je als geredigeerde `guest` aankomt.

Wat je wilt:

> *"De server wordt een open zee en een tick. De client joint met zijn data. De server vormt het
> eiland. Iedereen die joint krijgt een eigen eiland waar ze op werken. Iedereen ziet elkaar en
> elkaars eiland, elkaars voortgang en elkaars settlers."*

Twee drijfveren: **bij Tiemen blijven zonder weg te navigeren**, en **de client ergens anders
draaien** (telefoon, tweede scherm).

### Beslissingen

1. **Er is altijd een zee — ook in single player.** De client kiest bij het opstarten Single
   player / Hosten / Joinen, maar dat kiest alléén *welke* zee: een die in je eigen proces
   opstart met één eiland erin, dezelfde maar open voor anderen, of die van iemand anders. **Eén
   codepad.** De browser weet niet of hij alleen is.
2. **De zee bepaalt grotendeels.** Plaatsing, de roster, de panelen, de boten, de wereldklok —
   en **de settlers**. Hij houdt de bundels al vast, en alles wat een settler nodig heeft om te
   lopen zit daarin (`village.paths`, `village.bridges`, `town.paved`, `district.paved`); de
   loopcode leest nooit de road-graph van `world.js`, alleen die velden.
3. **Eerst LAN, daarna Portainer.** Fase 1-6 draait de zee op het LAN en houdt de bestaande
   netwerk-poort; de sleutel + TLS komen pas als hij de Docker-thuisserver op gaat. In single
   player bindt hij aan loopback.
4. **De zee heeft geen eigen eiland**, leest geen transcripts, scant nooit, en **schrijft niets
   op schijf**. Na een herstart is de wereld weer compleet zodra iedereen terug is; settlers
   beginnen dan weer bij hun deur, en dat ziet niemand.
5. **Live, ook tussen scans door** — settlers die lopen, iemand aan een bord, een boom die
   geplant wordt.
6. **Een client elders is rondlopen-en-kijken.** Alles dat de machine van de eigenaar raakt
   (tuin, bouwen, mail, tickets, agents) blijft op diens eigen pagina.

> **Dit vervangt een eerdere keuze.** Eerder stond hier dat elke islander zijn eigen settlers
> berekent. De zee doen is strikt eenvoudiger: één simulator in plaats van N, één klok,
> geen islander→zee-settlerverkeer, en — het belangrijkst — **geen tweede gezag om tegen af te
> stemmen.** Het schrapt de hele vergelijk-fase, de dubbele autoriteit en de
> `?walkcheck`-harnas uit dit plan. De prijs is een CPU-budget op de zee; zie *Wat echt moeilijk
> is*, punt 2.

### Correcties op het uitgangspunt, want de code wint

- **Het zijn 273 bewegende settlers per eiland, geen 36.** `MAX_STROLL = 36`
  (`web/js/settlers.js:25`) begrenst alleen gelijktijdige *boodschappen*; de idle-tak
  (`:816-831`) laat élke figuur eeuwig rond zijn deur drentelen. Vandaag: 114 huizen + 159
  schuren. Dit is het zwaarstwegende getal in het hele ontwerp.
- **De loopcode kan niet zoals ze is naar `shared/`.** `shared/rng.mjs` staat alleen
  `+ - * /` en `floor/abs/min/max/sqrt` toe. De loop gebruikt `Math.hypot` (8×), `Math.atan2`
  (5×) en `sin`/`cos` voor het idle-wandeldoel (`:817-818`). Drie daarvan zijn te vervangen.
- **`berthOf` kan geen vloot plaatsen.** `shared/regions.mjs:73` beantwoordt *"waar ligt dat
  eiland ten opzichte van mij"* met vier kompasrichtingen (`MAX_BERTHS = 4`). Eén gedeeld
  wereldframe vereist absolute origins, gelijk op elk scherm, en meer dan vier. Nieuwe functie.
- **`corsHeadersFor()` en `CROSS_ORIGIN_OK` zijn gebouwd en getest maar worden door `serve.mjs`
  nooit aangeroepen** (gecontroleerd: de enige hits buiten `lib/access.mjs` staan in
  `tests/access-origin.test.mjs`). De in-place join is plumbing zonder knop — en dit ontwerp
  maakt hem overbodig in plaats van af.
- Live config: `gridSize: 256`, `network.public: true`, `multiplayer.joinInPlace` afwezig.

---

## De drie processen

### De zee — `sea.mjs` + `lib/sea.mjs` + `lib/fleet.mjs`

Geen eiland, geen `data/`, geen schijf. In RAM: de vloot (één bundel per levend eiland, zijn
origin, zijn afgeleide terrein), de roster, de panelen, de boten, **de settlersimulatie**, en een
tick. Erft het argument uit de header van `lib/panelstate.mjs` woordelijk: een laatkomer moet het
bord zien waar de anderen naar kijken, en er is nergens anders om dat te onthouden.

`lib/sea.mjs` is een module, `sea.mjs` een dunne entry. Dat is wat de drie startkeuzes één
codepad laat delen:

| keuze | wat er gebeurt |
|---|---|
| **Single player** | `serve.mjs` start `lib/sea.mjs` in-proces op loopback, publiceert zichzelf, en de pagina joint hem. Eén eiland in de vloot. |
| **Hosten** | hetzelfde, maar gebonden aan het LAN en met een adres dat je doorgeeft. |
| **Joinen** | geen eigen zee; `lib/seaclient.mjs` verbindt met het adres van een ander. |

**De keuze hoort bij de islander, niet bij de pagina.** Single player en Hosten starten
allebei een zee in het proces van `serve.mjs`, dus alleen een machine mét een islander kan
ze aanbieden. Een telefoon of tweede scherm heeft er geen: die ziet geen drie knoppen maar
alleen de serverlijst hieronder, en joint als zwerver zonder eigen eiland. Dat is exact het
`hasIslander`-onderscheid uit fase 1, en het is de reden dat die splitsing er moest zijn.

**Joinen is een serverkeuze, geen adresveld.** Drie bronnen, samen één lijst:

1. **Het lokale netwerk afzoeken.** Dit redt `lib/neighbours.mjs` van de sloop — het
   UDP-multicastbaken (`239.255.47.47:47474`) blijft, maar kondigt voortaan een *zee* aan in
   plaats van een eiland. Nul configuratie op het LAN, precies waar het al voor gebouwd is.
   Corrigeert wat verderop onder *Wat waarheen gaat* staat: het baken vervalt niet, het
   verandert van lading.
2. **Een vaste, bekende zee**: `AgentVillage.freeddns.org` (kan nog veranderen, dus het hoort
   in `config.json` en niet in de code).
3. **Zelf een adres toevoegen**, bewaard in `config.json`, zodat een IP of hostnaam die je
   één keer intypt er de volgende keer gewoon staat.

Elke regel toont wat `GET /world` antwoordt — naam, aantal eilanden, aantal spelers — dus de
lijst zegt of er iemand is voordat je kiest. Een zee die niet antwoordt blijft staan met de
reden erbij, want "weg" en "nog aan het kijken" zijn verschillende dingen.

De browser ziet in alle drie de gevallen precies hetzelfde: een `welcome`, een vloot, een tick.
Er is geen offline-modus om apart te onderhouden en geen tweede tekenpad — het verschil tussen
alleen zijn en met z'n zessen zijn is het aantal rijen in `world.islands`.

| route | |
|---|---|
| `GET /world` | het manifest: protocolversie, tick, en per eiland `{id, name, keeper, origin, seed, gridSize, polders, terrainHash, rev, live}`. Enkele honderden bytes per eiland. |
| `GET /island/:id` | die bundel heel (gemeten: 206 kB voor 318 gebouwen). |
| `POST /island/:id` | publiceren, met token. Cap `MAX_BERTH_BYTES` (2 MB, bestaat al). |
| `GET /health` | voor Portainer. |
| `WS /ws` | alles wat leeft. `lib/ws.mjs` ongewijzigd — binair geweigerd, 2 kB payload-cap, en precies dáárom gaat de bundel over HTTP. |

**De handshake**, één vorm voor beide soorten client:

```
→ { t:'join', v:SEA_V, key, as:'client'|'islander',
    island:<id|null>, name, style, token, want:{ radius } }
← { t:'welcome', v:SEA_V, id, you, tickMs, now:<wereldklok>,
    world:{ gap:SEA_GAP, islands:[…] }, players:[…], panels:[…], boats:[…] }
← { t:'refused', why:'version'|'key'|'claimed'|'full' }
```

- `as:'islander'` **claimt** `island`; een tweede claim op een levend id krijgt `claimed`. Het id
  blijft `beaconId(port, hostname)` (`lib/islandbundle.mjs:85`) en is dus raadbaar — de claim
  hangt aan `token`, dat de islander bij het starten munt en via `/api/hello` aan zijn eigen
  same-origin pagina geeft.
- `as:'client'` **hecht zich aan** een eiland, zodat je naam boven de juiste kust staat.
  `island:null` is een zwerver: een telefoon die aan niemand hangt. Krijgt de wereld en een
  lichaam, en schrijft nergens.
- `want.radius` is de interesse-straal voor settler-verkeer. Hoort hier vanaf fase 2, niet later
  aangeschroefd — zie *Wat moeilijk is*.

**De tick** (66 ms, de bestaande `config.multiplayer.tickMs`):

```
← { t:'s', a:[ … ] }                     spelers, WERELD-frame, rijen ongewijzigd
← { t:'f', i:<islandId>, ev:[ … ], key:[ … ] }   settlers: gebeurtenissen + roulerend ijkpunt,
                                                 LOKAAL-frame, geen vaste beat
← { t:'roster'|'join'|'leave'|'ui'|'drove'|'boat'|'said' }   ongewijzigd
← { t:'island', a:'joined'|'gone'|'patch'|'rev' }            de vloot verandert
```

Settler-rijen zijn **lokaal** (`-half..+half`), dus onafhankelijk van de ligplaats en klein.
`room` wordt `<islandId>:<slug>` — twee eilanden hebben allebei een `tavern`, en `room()`
(`lib/players.mjs:56`) accepteert nu een kale slug.

### De islander — de afgeslankte `serve.mjs` + `lib/seaclient.mjs`

Alles dat deze machine raakt, plus één nieuwe uitgaande taak. Luistert op loopback zoals nu en is
**nooit van buiten bereikbaar** — dat is wat `lib/access.mjs` weer strikt maakt.

`lib/seaclient.mjs` (~150 regels): één WebSocket-*client*. Node 22+ heeft een globale `WebSocket`,
dus nog steeds nul dependencies. Zelfde jittered-backoff als `web/js/net.js:116`. Publiceert de
bundel bij start en bij elke scan die `generatedAt` verandert, en patcht bij prop/tuin-schrijfacties.
Meer niet — de settlers zijn van de zee, dus er gaat geen positieverkeer omhoog.

### De client

Twee adressen, `MINE` en `SEA`. Tekent de wereld; schrijft alleen naar `MINE`.

---

## Wat waarheen gaat

| taak | naar |
|---|---|
| statische `web/`, `/shared/` | islander (en optioneel de zee — zie skew-risico) |
| `/village.json` heel, SSE `/events` (`update`, `props`, `garden`, `reload`) | islander |
| rescan-timer + `scan.mjs` | islander; triggert nu ook een republish |
| WS-server, `players.mjs`, `panelstate.mjs`, `boats.mjs`, `ws.mjs` | **zee** |
| de loophelft van `settlers.js` + `boating.js` | **zee** (via `shared/settlerwalk.mjs`) |
| `/api/assign`, `/found`, `/banish`, `/adopt`, `dispatch.mjs`, mail, git, Jira, GitHub | islander, ongewijzigd |
| tuin (`garden.mjs`), props (`props.mjs`) | islander schrijft; de bundel draagt; `patch` maakt live |
| `/api/where`, `/api/say`, `/api/transcript`, `/api/sessions`, `/display`, `/vendor`, `/log`, `/shot`, `/model-save`, `/folders`, `/rescan`, `/reload` | islander |
| `/api/hello` | islander; groeit met `sea:{url}`, `token`, `islandId` |
| UDP-baken `lib/neighbours.mjs` | **vervalt** |
| `lib/guests.mjs`, `lib/journal.mjs`, `lib/visits.mjs` + de zeven visit-routes | **vervalt** |
| `CROSS_ORIGIN_OK`, `joinInPlace`, `/api/island` uit `PUBLIC_API` | **vervalt** |
| `cross()`, `visitNeighbour()`, `sendIslandTo()`, `askToVisit()`, `?arrive=` | **vervalt** |

**`lib/islandbundle.mjs` blijft en wordt het middelpunt** — het *is* "de client joint met zijn
data", en `parseBundle` is precies de whitelistende herbouwer die je aan de kant wilt hebben die
een leugen moet overleven. `lib/guestview.mjs` blijft ook, want `buildBundle` roept het aan.

Wat wél weg kan, kan weg omdat de aanleiding verdwijnt: die machinerie bestond om **een host
andermans eiland te laten vasthouden en muteren**. In de zee houdt niemand andermans eiland op
schijf en muteert niemand ooit andermans bestanden — jouw browser post naar jouw eigen islander,
punt. Daarmee is er niets om naar huis te dragen, dus het journaal is een oplossing zonder
probleem. **Maar sloop pas in fase 6**, als alles ernaast bewezen werkt; de prose in die headers
(vooral het *waarom niet persisteren* van `panelstate.mjs` en `guests.mjs`) verhuist eerst naar de
header van de zee.

`serve.mjs` wordt ~1443 → ~950 regels. `sea.mjs` + `lib/sea.mjs` ~400, `lib/fleet.mjs` ~250.

---

## De transportlaag van de client

`web/js/api.js`:

```js
export function mine(path, init)   // mijn islander.  credentials: 'same-origin'
export function sea(path, init)    // de zee.         credentials: 'omit'
export const SEA_WS                // ws(s)://<zee>/ws
export const hasIslander           // false op een telefoon of een zee-geserveerde pagina
```

Geen router die het doel uit het pad afleidt: een padtabel is een tweede plek om iets te vergeten,
en `/api/island` naast `/api/islands` is precies het soort bijna-botsing dat hier al eerder is
misgegaan. **Elke aanroep zegt zelf tegen welke machine hij praat.** De ~38 worden mechanisch
`mine(…)`, drie worden `sea(…)`, en een grep-test houdt de lijn: onder `web/js/` mag geen kale
`fetch('/` meer staan.

De module bezit ook het ding dat 40 losse `catch`-blokken niet kunnen: **"mijn islander is
onbereikbaar" is een modus, geen fout.** Vandaag krijgt een gast een 403 met JSON-body en een
externe client een TCP-fout; `mine()` maakt daar één `IslanderUnreachable` van, zet `hasIslander`
één keer op false en vuurt één event af. Zonder dit is kijk-modus veertig bugs.

**De same-origin-aannames die moeten sneuvelen:**

| aanname | nu | vervanging |
|---|---|---|
| WebSocket-URL | `location.host` (`net.js:56`) | `SEA_WS` als parameter in `createNet`; `net.js` leest `location` niet meer |
| import-map | `"shared/": "/shared/"` (`index.html:72-80`) | `"./shared/"`. Dit is geen cross-origin-probleem maar een **subpad**-probleem: het breekt zodra een reverse proxy het eiland op `/island/` zet, wat de waarschijnlijke Docker-vorm is |
| texturen | `'textures/'` in `buildings.js:60`, `hamlets.js:449`, `world.js:126` — opgelost tegen het *document*, werkt nu alleen doordat de pagina op `/` staat | één `web/js/assets.js` met `ASSET_BASE = new URL('../textures/', import.meta.url)` — opgelost tegen de *module*, dus per definitie waar de code vandaan kwam. Geen config, en strikt correcter dan wat er staat |
| invite-cookie | `KEY_COOKIE`, same-origin | blijft, voor de eigen pagina. De zee zet nooit een cookie; de sleutel rijdt mee in het join-bericht, altijd `credentials:'omit'` — de regel die `access.mjs:183` al opschreef |
| manifest / service worker | absoluut, scope `/` | relatief, anders start een vanaf de zee geïnstalleerde app op de verkeerde plek |
| `location.reload()` als redmiddel | 6 plekken (`main.js:167,181,226,3708`, `index.html:56`, `editor.js:1177`) | splitsen in drie: **de zee viel weg** → backoff, wereld herbouwt bij de volgende `welcome` (precies wat "de zee onthoudt niets" oplevert), nooit herladen; **mijn islander viel weg** → SSE retryt, wereld blijft tekenen, privépanelen grijzen uit en zeggen waarom, nooit herladen; **de code veranderde** → een echte reload, en dat is de enige die overblijft |
| `state.guest` als één boolean | `main.js:3567` | twee losse feiten: `hasIslander` (mag ik een machine aanraken?) en `seaRole` (wie ben ik in de wereld?). Vandaag dezelfde vraag, op een telefoon niet |

---

## De settlers naar de zee

De moeilijkste helft. `web/js/settlers.js` (894 regels, 42 kB) doet tekenen en lopen tegelijk.

De zee draait één simulatie per eiland uit de bundel die hij al vasthoudt. De islander doet hier
niets: die levert de bundel, en de wegen zitten erin. Wat de zee daarnaast nodig heeft is het
terrein (leidt hij af met `makeTerrain` uit seed + polders, wat hij bij het aanmeren toch al doet)
en de dekken — bruggen uit `village.bridges`, de kade uit `shared/quay.mjs`, en zelfgebouwde
bruggen uit de props in de bundel.

**De snede is drieledig**, niet tweeledig: pure loop, tekenwerk, en de lijm die geen van beide
bezit.

- **Naar Node:** `findPath` (`:176`, al puur en met `terrain` als argument), `roadRoute`,
  `nearestRoadCell`, `nearestSquareCell`, `gateOf`, `setRoads`, `setDecks`, `groundOrDeck`,
  `walkRoute`, `startStroll`, `startGather`, `walkIn`, het hele uitleen-protocol
  (`available`/`charter`/`routeTo`/`sendOut`/`carry`/`release`), `attend`/`unattend`, en de
  bewegingshelft van `update` (`:726-834`).
- **Blijft in de browser:** de mesh-bouw, `paintGeo`, `figureGeometry` (vier andere importeurs) en
  de matrix-helft van `update` (`:837` en verder).
- **Wordt gehalveerd:** `add` (`:271`) en `settlerLook` (`:123`). De view krijgt een eigen
  rng-tak (`hash32(id + ':gait')`) zodat geen van beide helften de trekking van de ander kan
  verschuiven — doe die splitsing in fase 0, terwijl niemand het verschil kan zien.

**Het lastigste van de snede staat niet in de opdracht: de closures.** `f.onDone`,
`f.strollHome` en `f.aboard` zijn functiewaardes, en een simulatie die vergeleken, herstart en
hervat moet kunnen worden mag er geen dragen. Elk wordt een getagd record
(`f.after = { kind:'stroll-home', route, home }`). Dit is de grootste mechanische ingreep.

**Waar hij woont: `shared/settlerwalk.mjs`**, na vier substituties:

| nu | waarom fout | vervanging |
|---|---|---|
| `Math.hypot` ×8 | niet exact gespecificeerd | `Math.sqrt(dx*dx+dz*dz)` — IEEE-exact en toegestaan |
| `cos/sin` voor het idle-doel (`:817-818`) | transcendent, voedt **positie** | rejection-sampling van een eenheidsvector: trek `u,v` in `[-1,1]` tot `u²+v² ≤ 1`, schaal met `r/√(u²+v²)`. Nog steeds uniform in richting |
| `atan2` ×5 (yaw) | transcendent | **yaw verlaat de sim.** Niets leest yaw terug in positie; de renderer heeft opeenvolgende posities en leidt de koers zelf af. Scheelt vijf call-sites en één draadveld |
| `sin/cos` in bob/gait | — | blijft, want dat staat in de *renderer*, die deze regel niet heeft |

Plus twee kleine nieuwe bewoners van `shared/`: `shared/roads.mjs` (`roadCells` uit `main.js:2196`
en `squareCells` uit `world.js:1132`, beide pure `village.json`-lezers die toevallig in
browserbestanden wonen) en `shared/palette.mjs` (`PALETTE` uit `buildings.js` — Node kan dat
bestand niet importeren, het bouwt een `TextureLoader` op import-tijd).

**Wat níet meekan is `dt`.** Twee runtimes die wandklok-dt optellen lopen meteen uiteen. Dus:

```js
const DT = 0.05;        // 20 Hz, één double, overal dezelfde double
sim.advance(ticks);     // de aanroeper houdt de accumulator
```

**En `shared/` is hier geen nettigheid maar de dragende keuze.** Omdat de client de loop
vooruitrekent uit gebeurtenissen (zie het draadformaat hieronder), moeten Node en de browser weer
wél bit-identiek zijn — anders drijft elke kijker een eigen kant op tussen twee ijkpunten. De vier
substituties zijn dus niet optioneel. Dat een pure, tick-gedreven loop daarbij rechtstreeks te
testen is zonder `document`-stub en zonder shared-loader, is winst die je er gratis bij krijgt en
op zichzelf een assertie waard.

Eén ding om op te schrijven: `deckCells` (`web/js/props.js:484`) gebruikt `sin`/`cos` van `p.rot`.
Zolang alleen de zee die berekent is dat geen probleem — maar reken hem daar dan ook uit en stuur
de dekkaart mee in de roster, in plaats van elke kant hem te laten afleiden. Twee engines die in
de laatste bit verschillen is aan een celgrens een andere sleutel, en dat is een settler die in
een rivier staat.

**Het draadformaat: stuur gebeurtenissen, niet posities.** De loop is een algoritme dat aan beide
kanten staat, dus de zee hoeft niet te vertellen *waar* iemand is — alleen *wat* er gebeurt. De
client rekent de rest zelf uit, en een periodiek ijkpunt zet de afwijking terug. Drie soorten
verkeer:

1. **Gebeurtenissen**, zeldzaam en gezaghebbend. `{idx, tick, kind, …}` voor het beginnen van een
   route, gecharterd worden, aan boord gaan, het borreluur, een dorpsherbouw. Voor een route gaat
   **het pad mee, niet de bestemming** — dat is het belangrijkste detail van dit ontwerp, want
   daarmee blijft `findPath` (het dure stuk, met zijn sorteer-per-pop en guard 12000) volledig aan
   de zeekant en is de gebeurtenis zelfstandig reproduceerbaar.
2. **Niets voor de drentelaars.** Het idle-wandeldoel wordt getrokken uit `f.rng`, en dat is een
   per-settler geseede stroom. Zolang beide kanten evenveel trekkingen hebben gedaan, kiezen ze
   hetzelfde doel. 237 van de 273 figuren kosten dus **nul bytes**.
3. **Een ijkpunt**, roulerend. Elke ~10 s is elke settler één keer aan de beurt met
   `{idx, qx, qz, n}` — positie gekwantiseerd op 1/64 unit, plus `n`, het aantal rng-trekkingen.
   Dat laatste kan omdat `mulberry32` (`shared/rng.mjs:16`) precies één uint32 aan toestand heeft
   die met een vaste stap opschuift: de stand *is* een teller. Eén getal zet een afgedreven of
   laat binnengekomen client exact terug in het gareel.

| | bytes/s |
|---|---|
| gebeurtenissen, ~2/s × ~40 B | ~0,1 kB/s |
| ijkpunten, 273 × ~6 B verspreid over 10 s | ~0,16 kB/s |
| **per eiland, per kijker** | **~0,3 kB/s** |

Ter vergelijking: naïef alles op 10 Hz met string-ids is 273 × 10 × ~45 B = **123 kB/s**, en zelfs
posities-voor-lopers-alleen is ~4,4 kB/s. Bij acht eilanden is dat het verschil tussen 2,4 kB/s en
35 kB/s. Dat contrast hoort in de header van de encoder.

**Dit is geen tweede gezag.** De zee blijft de enige die beslist; de client *voorspelt* en wordt
gecorrigeerd — hetzelfde onderscheid dat `web/js/peers.js` al maakt wanneer het een peer
extrapoleert en daarna terugzet. Wat het wél kost, staat bij *Wat echt moeilijk is*, punt 12:
afdrijving is onzichtbaar tot ze lelijk is, en de rekentijd verhuist van de zee naar de client.

De roster draagt **geen kleuren**: de verre kant roept `settlerLook(buildingId, style, kind)` aan
— dezelfde gedeelde functie, dezelfde hash — en krijgt hetzelfde gezicht. Dat is al de belofte die
het bestand zelf doet (`:118-122`).

De ontvangstkant hergebruikt `web/js/peers.js` (`LAG_MS = 120` is twee beats, ongewijzigd), met
twee verschillen: settlers gronden op `groundOrDeck` van *hun* regio (ze lopen op steigerplanken),
en er is geen fade-in. **Zet settlers niet in `peers.js` zelf** — dat is één mesh plus een
canvas-naambordje per peer, gecapt op zestien, en 273 daarvan is exact de fout die `CLAUDE.md`
al optekent voor de naambordjes van het gasteiland.

---

## Gezag, en wat er gebeurt als een islander wegvalt

- **Elke client bezit zijn eigen lichaam.** Ongewijzigd; het argument in de header van
  `lib/players.mjs` staat woord voor woord nog.
- **Elke islander bezit de vórm van zijn eiland** — wat de scanner uit de transcripts maakt. Hij
  publiceert het en muteert het; de zee rekent nooit een dorp uit.
- **Elke islander bezit alles op zijn eigen schijf. Geen bericht van de zee veroorzaakt ooit een
  schrijfactie.** Dit is de invariant die `journal.mjs`/`visits.mjs` overbodig maakt en hoort in
  `CLAUDE.md`.
- **De zee bezit alles wat leeft:** plaatsing, roster, panelen, boten, de wereldklok en de
  settlers. De middelste drie zijn de huidige modules letterlijk; de rest is nieuw.
- **Er is nooit twee gezag over één ding.** Dat is de hele winst van de zee-keuze: geen
  vergelijking, geen afstemming, geen "welke kant heeft gelijk".
- **Plaatsing is stabiel:** een eiland dat een origin heeft, houdt hem als er een nieuwkomer bij
  komt — anders schuift ieders wereld onder zijn voeten weg. Dezelfde redenering die
  `createArchipelago.replace()` (`regions.mjs:196`) al op `levelBase` toepast.

**Valt een islander weg, dan blijft zijn eiland gewoon leven** — de zee bezit de settlers, dus die
lopen door. Dat is een gratis eigenschap van deze keuze en precies wat je wilt als je je eigen
`serve.mjs` herstart om een bestand op te slaan: niemand ziet iets. Wat stopt, is nieuwe *vorm*:
geen scan, geen nieuw huis, geen geplante boom.

1. **Socket weg** → `live:false`, alles blijft staan en lopen, het naambordje zegt dat de keeper
   er niet is.
2. **Respijt op (~45 s)** → bundel weg, sim gestopt, origin vrij, `{t:'island', a:'gone'}`,
   moorings opnieuw afgeleid. `net.js:88-93` kent "een boot die losgeslagen is omdat zijn eiland
   weg is" al.
3. **Stond er iemand op?** Die zwemt — buiten elke regio is de hoogte `OPEN_SEA`. Zijn eigen
   client hoort dat te merken en hem naar huis te laten varen in plaats van te doen alsof. Eén
   kleine expliciete handler; zonder die leest het als een crash.

**Valt de zee weg**, dan is het ernstiger, want dan valt de hele wereld weg. De browser heeft
`shared/settlerwalk.mjs` aan boord en **laat hem ~15 s vrij doorlopen** vanaf de laatste snapshot,
zodat een korte hik niet iedereen laat bevriezen; daarna faden de settlers (hergebruik `peers.js`'
`leaving`/`FADE_S`) en zegt de pagina wat er aan de hand is. Niet langer dan dat vrij laten lopen:
zonder gebeurtenisstroom drijft de sim af, en settlers die door hun eigen muur lopen wordt terecht
de simulatie verweten. In single player is dit het geval "mijn eigen proces viel om", en dan is
een echte reload wél het juiste antwoord.

---

## Fasering

Elke fase laat een eiland achter waar je diezelfde avond mee werkt.

**Fase 0 — settlers ontwarren, ter plekke.** Geen architectuur, geen netwerk. Splits
`web/js/settlers.js` in `settler-figures.js` en `settler-walk.js`, met `settlers.js` als facade
die de huidige API exact exporteert, zodat geen van de ~45 call-sites verandert. De rng-tak en de
closures→records hier. **Dit is het meeste werk en geen van het risico**; stopt het project hier,
dan is het nog steeds beter af.

**Fase 1 — de adressen. Geen nieuw proces.** `web/js/api.js`, `web/js/assets.js`,
`createNet({url})`, relatieve import-map en manifest, `state.guest` gesplitst, de drie
herstelpaden uit elkaar, de grep-test. Elk doel wijst nog naar dezelfde origin, dus op
`localhost:4747` verandert er niets.
→ *Zichtbare winst:* het eiland overleeft een subpad en een andere host — te bewijzen met een
willekeurige reverse proxy, en door het op de telefoon te laden en de **texturen** te zien komen.

**Fase 2 — de zee bestaat, en single player draait er al op.** `lib/sea.mjs` met de vier routes en
de socket, `lib/fleet.mjs` met plaatsing voor N, `seededName` van `lib/village.mjs:108` naar
`lib/words.mjs` (de zee mag die 26 kB scanner-aggregator niet importeren), `lib/players.mjs` krijgt
eiland-attributie en eiland-gescope panel- en room-sleutels, `lib/seaclient.mjs` publiceert. De
startkeuze Single/Hosten/Joinen, waarbij **Single player meteen de echte route is**: één eiland in
een in-proces zee op loopback.
→ *De winst is dubbel.* Zichtbaar: jouw islander en `island-buur` op één zee, en **het eiland van
de buur staat naast het jouwe en je loopt ernaartoe zonder dat de pagina wegnavigeert.** Beide
drijfveren in één fase. Onzichtbaar maar belangrijker: vanaf hier draait je dagelijkse eiland al
over de zee-route, dus alles daarna wordt op de gewone weg getest in plaats van in een
speciale modus.

**Fase 3 — plaatsing voor velen, en het tekenbudget.** `placeFleet()` in `shared/regions.mjs`,
`horizon.js` gevoed uit het manifest en gedegradeerd tot verre-LOD (een betere baan dan geruchten
tekenen), `want.radius` doet echt werk. Meten met `?stats` tegen het 1,6×-budget.

**Fase 4 — de settlers verhuizen naar de zee.** De loop uit fase 0/1 naar
`shared/settlerwalk.mjs`, de zee bouwt per eiland een sim uit de bundel en stapt hem op 20 Hz, en
zendt `{t:'f'}`. De browser tekent alleen nog. Meet hier het CPU-verbruik van de zee bij 1, 2 en
8 eilanden voordat je verder gaat. **Weersta** de tussenstap waarin de browser van de eigenaar
zijn eigen settlerposities omhoog publiceert: het werkt, het kost twee dagen, en het gaat integraal
de prullenbak in.

### Het gezag omdraaien — wat er nog ligt, opgemeten

Fase 4 is af op één stap na: ons eigen eiland tekent nog uit zijn eigen simulatie terwijl
de zee er ook een draait. Twee versies van dezelfde menigte; die van de zee is wat anderen
zien. Niet zichtbaar kapot, wel maar één van de twee waar.

Wat het precies vraagt, gemeten in plaats van geschat:

1. **`web/js/boating.js` → `shared/boating.mjs`.** 316 regels, en het importeert **alleen
   `clamp` uit `shared/rng.mjs`** — geen three.js, geen document. Al zijn afhankelijkheden
   worden ingespoten (`terrain`, `settlers`, `dock`, `fleet`, `rng`), dus het is al
   draagbaar. Het gebruikt acht dingen uit het uitleen-protocol: `available`, `charter`,
   `routeTo`, `sendOut`, `carry`, `release`, `has`, `where`.
2. **Een adapter voor de boten.** `boating.js` verwacht `fleet.take(id)`,
   `fleet.release(boat)` en `fleet.bob(boat, clock)`; de zee heeft `lib/boats.mjs` met
   `take`/`drop`/`moved`/`moor`. Dat is een dun laagje, geen herschrijving.
3. **`attend` en `unattend` worden socketberichten.** Exact twee aanroepplekken in
   `main.js` (369 en 373). Op loopback is de rondreis ~1 ms; ontwerp het als
   *verstuurd-en-bevestigd*, niet als iets dat direct terugkoppelt, of fase 7 voelt later
   als een regressie.
4. **De browser stopt met zijn eigen sim** en tekent ons eiland uit `crowd-view.js`, net
   als een gasteiland. `createFigures` heeft `figureAt`, dus hover en dossier verhuizen
   mee; `facetoface.js` leest `subject.pos`, `subject.y` en `subject.look`, en die staan
   alle drie op een figuur van de view.

Waar het pijn kan doen: tussen stap 4 en stap 3 zijn je eigen bewoners even niet
aanspreekbaar. Doe ze in die volgorde — eerst boating en attend naar de zee, dán het
tekenen omdraaien — of je hebt een eiland waar je niemand meer gedag kunt zeggen.

**Fase 5 — live al het andere.** Prop- en bedpatches over de zee, panelen en boten over eilanden
heen, de wereldklok uit `welcome`.

*Hier valt de beslissing over de tijdbalk.* Terugspoelen hoeft niet te vervallen en is nu al
puur client-side: `web/js/history.js` stuurt niets, het projecteert het dorp op een eerder
moment en laat het door dezelfde functies tekenen die het heden tekenen. Het botst op één
punt met de wereldklok — `main.js:1865` geeft `state.chronicle.t` terug in plaats van
`Date.now()`, dus je hemel reist mee terug en die van de anderen niet. Dat is prima zolang
het *jouw* blik op het verleden is. Wat wél een keuze vraagt: de levende dingen — andermans
lichamen, de settlers van andere eilanden, de boten — lopen dan rond in een dorp van mei.
Voorstel: verberg ze zodra je van **Live** af bent, op de plek waar de peers getekend worden.
Dat is eerlijker dan ze door een verleden laten lopen dat ze nooit hebben meegemaakt, en het
is één regel.

**Fase 6 — de sloop, en de beveiligingswinst.** `neighbours.mjs`, `guests.mjs`, `journal.mjs`,
`visits.mjs`, de zeven routes, `CROSS_ORIGIN_OK`, `joinInPlace`, `/api/island` uit `PUBLIC_API`,
`cross()` c.s. `lib/access.mjs` gaat terug naar alle drie de checks zonder uitzonderingen, en de
enige schrijfroute op de publieke allowlist verdwijnt. Twee `CLAUDE.md`-invarianten herschrijven.

**Fase 7 — de zee naar Portainer.** Dockerfile, git-stack + push-webhook (de conventie daar),
de sleutel, TLS via Nginx Proxy Manager, de versiebanner.

---

## Verificatie

```bash
npm install
node --test "tests/*.test.mjs"
node --test tests/models.test.mjs
```

Quote de glob (Windows expandeert hem niet). Twee assertions in `tests/layout-measure.test.mjs`
falen tegen de live `data/layout.json` op deze machine en staan hier los van — check tegen een
schone tree voordat je er achteraan gaat. En de val uit `docs/branches.md`: **stop de server
vóór je iets aan de layout meet** (`stop-island.cmd`), anders loopt zijn rescan door je meting.

| fase | draaien | waar naar kijken | tests erbij |
|---|---|---|---|
| 0 | `settlers` | het dorp loopt exact zoals het liep | `tests/settler-walk.test.mjs`: determinisme (20 000 ticks, `advance(1)×n` vs `advance(7)×m`, **bit voor bit**), weg-volgen op synthetisch terrein, `keepHome` tot op de millimeter, `MAX_STROLL` nooit boven 36, borrel heen en terug, uitlenen |
| 1 | `settlers`, daarna `island-worktree` vanaf de telefoon op `http://<lan-ip>:<poort>/` | boot komt door; **texturen laden** (dat is de `ASSET_BASE`-assertie); lopen, borden, mail, tuin; geen 404 in de console | `tests/api-base.test.mjs`: `mine`/`sea` tegen meerdere bases, plus de grep-assertie dat geen kale `fetch('/` overleeft |
| 2 | nieuwe `sea`-config op 4750; `settlers` (4747) en `island-buur` (4748) er allebei op; twee browsers | twee lichamen op één eiland; dan het eiland van de buur ernaast; boten, borden en chat kruisen | `tests/sea-join.test.mjs` (handshake, verkeerde sleutel/versie, dubbele claim, vol); `tests/fleet.test.mjs` (een derde eiland verplaatst de eerste twee niet; N=8 zonder overlap) |
| 3 | dezelfde drie, `?stats`, `?join=self` werkt nog | draw calls tegen 1,6×; fog- en camerabereik; silhouetten op afstand | `placeFleet` in `tests/regions.test.mjs` |
| 4 | met de port geland; CPU van de zee bij 1, 2 en 8 eilanden meten | settlers van een ander die hun eigen paden lopen; de drift-overlay | `tests/settler-wire.test.mjs` (round-trip, kwantisatiefout ≤ 1/128, een **genoemd bytebudget** als getal, onbekende `idx` genegeerd); `tests/settler-predict.test.mjs` — een client die alleen gebeurtenissen krijgt blijft 60 s binnen een genoemde tolerantie van de zee, en een client die **midden in de stroom** instapt convergeert binnen één ijkronde; `tests/settler-parity.test.mjs` — **neem het ijkbestand op ná de vier substituties**, anders jaag je dagen op een verschil dat per definitie niet te matchen is |
| 5 | plant een boom op het ene eiland | verschijnt op het andere, én bij een *late* joiner | `tests/sea-patch.test.mjs` |
| 6 | `settlers` alleen, zonder zee | het eiland werkt met de zee plat; `access.mjs` weigert alles niet-loopback zonder uitzondering | de cross-origin-blok in `tests/access-origin.test.mjs` wordt striktheid-assertie |

---

## Wat echt moeilijk is

1. **Het tekenbudget, met afstand het grootste.** `CLAUDE.md` tekent op dat 41 naambordjes op
   **één** gasteiland de call-count van 1,35× naar 1,76× brachten tegen een budget van 1,6× — en
   dat was mét `signs:false`, zonder bos, velden, slijtage en settlers. "Iedereen ziet elkaars
   eiland" bij N=8 rendert niet op het huidige pad. De interesse-straal en horizon-als-LOD in
   fase 3 zijn geen polish maar dragend.
2. **273 settlers, niet 36 — en de zee moet ze allemaal stappen.** Dit is de prijs van de
   zee-keuze en het enige echt nieuwe risico dat ze introduceert. Bij acht eilanden zijn het
   ~2200 figuren op 20 Hz in één Node-event-loop die ook HTTP doet. Het lopen zelf is goedkope
   rekenkunde; het gevaar is `findPath`, dat zijn open-lijst bij elke pop sorteert (guard 12000,
   `settlers.js:184`). In de browser is een piek een gemiste frame, op de zee is het een late
   tick voor **iedereen** — en bij een dorpsherbouw worden 273 gates en elke `roadNear`-cache
   tegelijk ongeldig (`setRoads`, `:412-413`). Twee maatregelen, allebei vanaf het begin: begroot
   een paar paden per tick in een wachtrij in plaats van ze allemaal meteen te doen, en laat
   `want.radius` ook de *simulatie* begrenzen, niet alleen het verkeer — een eiland waar niemand
   in de buurt is hoeft alleen zijn boodschappen te lopen. **Meet dit in fase 4 bij 1, 2 en 8
   eilanden voordat je verder gaat**; het is het getal dat bepaalt of de Docker-bak meekan.
   Los daarvan blijft de bandbreedte prima (~18 kB/s per client) maar is het *animeren* van
   ~288 vreemde settlers bovenop je eigen menigte dat niet — zie punt 1.
3. **`boating.js` is geen buur maar een afhankelijke.** Tien call-sites in het uitleen-protocol.
   De loop kan niet verhuizen zonder hem, en hij sleept `lib/boats.mjs` mee (169 regels,
   geschreven, door `serve.mjs` nooit geïmporteerd). Begroot dat als een eigen fase.
4. **"Joint met zijn data" is een momentopname, "live" is een stroom, en die twee combineren niet
   gratis.** Een herpublicatie is 206 kB, dus het gewone geval moet een patch zijn — maar
   `createGuestIsland` bouwt grond en gebouwen in één pass en heeft **geen incrementeel pad**. Eén
   huis erbij kost nu een volledige mesh-herbouw van dat eiland. Props zijn makkelijk (eigen
   tekenpad). Dit is de stille prijs van eis 4.
5. **De zee is veel zwakker beveiligd dan de islander, en dat mag alleen omdat hij niets
   vasthoudt.** De drie checks van `access.mjs` gaan niet mee: geen loopback-socket, geen bekende
   Host, geen matchende Origin. Wat overblijft zijn de LAN-check (fase 1-6) en straks een sleutel,
   plus de caps die `players.mjs` en `islandbundle.mjs` al hebben. Straal bij een gekaapte zee:
   schreeuwen, een nepeiland parkeren, een naam imiteren. Geen bestand, geen spawn, geen
   transcript. Zet dat in de header van de zee zoals `access.mjs` dat voor zichzelf doet.
6. **Tijd van de dag.** Elke pagina rekent nu zijn eigen uur uit. Twee spelers in verschillende
   tijdzones zien in hetzelfde beeld het ene eiland bij daglicht en het andere bij nacht. Eén
   getal in `welcome`, bijna gratis, en diep raar als je het overslaat.
7. **Versie-skew tussen drie partijen.** `joinIsland` *waarschuwt* nu bij een afwijkende
   terrain-hash (`main.js:1284`); met een zee kan de code van de pagina en de producent van de
   bundel op verschillende commits zitten, en dan worden eilanden in de verkeerde vorm getekend.
   Promoveer de waarschuwing tot een zichtbare banner die noemt wie uit de pas loopt. Serveert de
   zee ook `web/`, dan wordt dit erger in plaats van beter — maar de Docker-bak is de enige
   machine die altijd aan staat, dus: serveren, en de banner goed maken.
8. **Interieurs.** Room-slugs worden eiland-gescoped, en een client krijgt routinematig te horen
   dat iemand in een kamer zit die hij nooit gebouwd heeft. `peers.js:249` verbergt die al — maar
   het betekent dat je vanaf jouw eiland niemand in andermans kroeg kunt zien. Klein, permanent
   gat in "iedereen ziet elkaar".
9. **"Elkaars voortgang" stopt bij de borden.** Panel-*toestand* is van de zee en dus gedeeld;
   panel-*inhoud* — Jira, GitHub, git — wordt gelezen met de credentials van één islander
   (`board.js:233`). Niet op de zee zetten. Laat het bord buiten die machine leeg renderen mét de
   zin *"dit bord wordt van Martijns machine gelezen"*, in plaats van een leeg bord dat op kapot
   lijkt. Huizen, districten, lopende settlers, geplante bomen en groeiende bedden kruisen wél.
10. **`CAPACITY = 640` en slot-uitputting.** `remove` (`:337-342`) verbergt alleen; slots worden
    nooit teruggewonnen. Dat gaf niet zolang een reload alles reset — een langlevende pagina die
    eilanden ziet komen en gaan raakt op. Slot-recycling is nieuw werk.
11. **Alles wat een settler aanraakt wordt een rondreis.** `attend` (E op een settler drukken),
    `charter`, het borreluur en `walkIn` bij een nieuwe bewoner worden client → zee, of
    islander → zee. Op loopback is dat ~1 ms en voelt niemand iets — maar dat geldt alléén zolang
    je eigen zee op je eigen machine draait. Zodra hij op Portainer staat, zit er een netwerk
    tussen jou en het aanspreken van je eigen settler. Ontwerp die interacties als
    *"verstuurd, en bevestigd als het gebeurd is"* en niet als iets dat direct terugkoppelt,
    anders voelt fase 7 als een regressie terwijl er niets veranderd is.
12. **Afdrijving is onzichtbaar tot ze lelijk is.** Gebeurtenissen-in-plaats-van-posities betekent
    dat de client zelf rekent, en elke kleine divergentie (een gemiste gebeurtenis, een
    rng-trekking die aan één kant wél gebeurde) groeit stil door tot iemand door een muur loopt.
    Twee dingen die daarom vanaf het begin mee moeten: het roulerende ijkpunt is **niet
    optioneel** — het is wat de fout begrenst in plaats van erop te hopen — en er hoort een
    dev-overlay bij (in de geest van `?stats`) die de grootste afwijking tussen voorspelling en
    ijkpunt toont, zodat een regressie zichtbaar is voordat een speler hem vindt. Reken er ook op
    dat de *rekentijd verhuist*: bij acht eilanden stapt de browser ~2200 figuren in plaats van
    273. Dat is goedkope rekenkunde vergeleken met de matrix-updates die hij toch al doet, en
    `findPath` blijft aan de zeekant — maar het is wel de reden dat `want.radius` ook hier geldt:
    een eiland waar je niet in de buurt bent hoeft niet voorspeld te worden.
13. **Wat er weggegooid wordt:** ~46 kB recent, zorgvuldig becommentarieerde broncode
    (`guests.mjs`, `journal.mjs`, `visits.mjs`), `neighbours.mjs`, twee testbestanden, zeven
    routes en de paginasprong. Dat is veel goed werk. **Oogst de redeneringen uit die headers
    vóór de sloop** — het *waarom niet persisteren* van `panelstate.mjs` en `guests.mjs` is
    precies het argument dat de zee in zijn eigen header nodig heeft. Verhuis het proza, sloop
    de code.
