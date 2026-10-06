# 🚧 Open-world PvP

Plan van 6 oktober 2026, nog niet gebouwd. Alleen ontwerp: geen code.

## Waarom

Spelers kunnen al vechten: twee muisknoppen, één per hand (`SIDE_OF` in `web/js/walk.js`), een
schild dat blokkeert, en de zee die een kale `{t:'swing'}` richt vanuit de laatste pose
(`lib/combat.mjs`). Maar hun tegenstanders zijn alleen de guards en de Codex-residents van de
vulkaan. De keeper wil dat spelers elkaar ook kunnen raken, **als ze dat allebei willen**, en
dat je **eigen eiland altijd veilig** blijft. Promptholm is in de eerste plaats een plek waar je
sessies wonen. Wie dat eiland opent om te zien wat zijn agents doen, mag daar nooit worden
neergeslagen.

Bijna alles wat daarvoor nodig is, bestaat al:

- `hurt()` in `lib/health.mjs` is de enige deur voor schade. Daaronder zit al alles: regeneratie,
  eviction bij 0 hp naar `refuge`, de val of verdrinking vóór de sprong
  (`{t:'fell'}`, [vallen-en-verdrinken.md](vallen-en-verdrinken.md)) en immuniteit vanaf aankomst
  thuis (`observe`, `ARRIVE_R`). In de commentaar staat letterlijk "and later another player's swing".
- `blowOn` in `lib/hostility.mjs` werkt pantser (`SHIELD_ARMOR` per hand met een schild) en
  blokkeren (`BLOCKING` binnen `FRONT_ARC_COS`) uit, en kijkt alleen naar de pose van wie
  geraakt wordt. Wie de slag geeft, maakt niet uit.
- `afoot` en `pilotsOf` bepalen al wie geraakt kan worden: lopend, niet in een kamer, niet aan
  het roer of aan boord, niet `ASLEEP`, en wel gepost.
- `swung` gaat al naar iedereen zodra de zee een `swing` binnenkrijgt. De aankondiging van een
  slag bestaat dus al.

Dit plan voegt daarom vooral **regels** toe (wie mag wie raken, en waar), en weinig nieuwe
mechaniek.

## Besluiten

De keeper besliste op 6 oktober 2026: **de vlag is een persoonlijke instelling** (geen zee-brede
stand en geen host-schakelaar), **alleen jij bent veilig op je eigen eiland**, het uitzetten duurt
**30 s** en die tijd begint opnieuw bij elke treffer, en **te paard of op de fiets mag je vechten**,
maar een treffer laat je afstijgen.

### 1. Wie zet het aan: elke speler zelf, met een vlag

- **Per speler een vlag, zoals in WoW.** Je raakt alleen spelers met de vlag aan, en alleen zij
  raken jou. Met de vlag uit ben je voor spelers een geest: je slagen gaan door hen heen, en
  die van hen door jou. Guards en lava blijven je gewoon raken. Dat geldt **op elke zee**, de open
  zee, een gehoste en je eigen. *Waarom:* toestemming hoort bij de persoon die geraakt wordt, en een
  vlag is het kleinste dat dat uitdrukt. Een zee-brede stand ernaast zou een tweede schakelaar zijn
  die hetzelfde zegt: op een zee waar niemand de vlag aanzet, gebeurt al niets.
- **Geen zee-stand en geen host-schakelaar.** Er komt geen `SEA_PVP`, geen `ownSea.setPvp` en geen
  `/api/sea-pvp`. *Waarom:* de keeper wil het persoonlijk houden. Bewaard als later-idee onderaan,
  voor als een private zee ooit "PvP nergens" wil.
- De vlag staat bij de **zee** (`p.pvp`, in het geheugen, per verbinding). De pagina vraagt erom
  met `{t:'pvp', on}`. Een reconnect begint met de vlag uit, net als health bij een nieuwe
  verbinding. *Waarom:* wie de tab sloot midden in een gevecht, komt niet terug als doelwit. De
  pagina onthoudt de *voorkeur* (localStorage, `promptholm.pvp`) en vraagt de vlag na de welcome
  opnieuw aan. Dat valt dan onder de regel "aanzetten" hieronder.
- **Aanzetten gaat meteen. Uitzetten duurt `PVP_OFF_MS` (30 s)**, en die wachttijd begint opnieuw
  bij elke PvP-treffer die je geeft of krijgt. *Waarom:* zo kun je de vlag niet weghalen op het
  moment dat je verliest. WoW gebruikt vijf minuten, maar dat is hier te lang voor een eiland waar
  je ook gewoon wilt bouwen. De zee bevestigt privé met `{t:'pvp', on, offIn}`, zodat de HUD de
  aftelling kan tonen.
- Een vlag wisselen mag hoogstens eens per 2 s (`PVP_TOGGLE_MS`). Anders wordt een
  `join`-broadcast per frame mogelijk.
- **Hoe anderen het zien: in de identity, niet als pose-bit.** De zee zet `pvp: true` in
  `identity(p)` en stuurt bij elke wijziging een `join` (zoals bij `look`). Peers.js kleurt het
  naambordje rood en zet er gekruiste zwaarden voor. *Waarom geen bit:* een pose-bit is een claim
  van de client, en de vlag is het oordeel van de zee. Bovendien is `POSE_MASK` al 32767 (tot en
  met `DIGGING` 16384), dus een nieuw bit 32768 wordt door elke huidige zee weggemaskeerd. Een
  veld in de identity negeert een oudere pagina gewoon.
- De welcome draagt `pvp: true` als teken dat de zee de vlag kent. Ontbreekt het, dan is het een
  zee van vóór dit plan, en toont de pagina de schakelaar grijs met "deze zee kent nog geen PvP".

### 2. Veilige zones: alleen jij, op je eigen eiland

De zee beslist het, met één functie, `sanctuary(p)` in een nieuwe `lib/pvp.mjs`, die zegt of `p`
op dit moment voor spelers onaantastbaar is. **Je eigen eiland** is het eiland van je islander
(`p.island`), gemeten als het getekende grid (`origin ± terrain.half`) plus een rand van
`SAFE_MARGIN` (8 cellen). Met die rand vallen de steiger, de kade, het resort, de Kraken op zijn
rots en de ligplaatsen van de boten erbinnen. De **reach** (`room`, ruimte om te groeien) daarbuiten
is open water. Anders zou een eiland van 40 een vrijplaats van 384 zijn.

Wat dat betekent op een eiland met een eigenaar en bezoekers:

- **De eigenaar is er veilig, ook met de vlag aan.** Ook iedereen die vanaf hetzelfde eiland
  speelt (een tweede pagina van dezelfde keeper, met dezelfde `p.island`) is daar eigenaar.
- **Een bezoeker zonder vlag is overal veilig** voor spelers, dus ook hier. Dat volgt uit de vlag
  en heeft geen aparte regel nodig.
- **Een bezoeker mét vlag is op andermans eiland een doelwit.** Hij kan geraakt worden door elke
  andere speler met de vlag die er staat: een andere bezoeker, of de eigenaar.
- **De eigenaar slaat alleen met zijn eigen vlag aan.** Zonder vlag gaan zijn slagen door
  bezoekers heen, net als overal. *Waarom:* de vlag is wederzijdse toestemming, en een eigenaar
  die bezoekers kan raken zonder zelf iets te riskeren, is een val.
- **Wie vanuit thuis slaat, verliest zijn vrijplaats even.** Een eigenaar die een speler raakt, is
  `PVP_COMBAT_MS` (10 s) na zijn laatste treffer niet meer onaantastbaar op zijn eigen eiland. De
  bezoeker kan dus terugslaan. *Waarom:* anders is je eigen eiland een schietschijf waarop alleen
  de eigenaar mag schieten. Zo blijft "je eigen eiland is altijd veilig" waar voor wie zich er
  rustig houdt, en dat is het geval waar het om gaat: wie zijn eiland opent om zijn agents te zien.

Wat er elders geldt:

| Waar | PvP? | Waarom |
|---|---|---|
| **Je eigen eiland** (grid + rand) | **veilig voor jou**, behalve 10 s na een eigen treffer | zie hierboven |
| **Andermans eiland** | met vlag: doelwit | de keeper koos "alleen je eigen" |
| **Starters** (`starter: true`) | **veilig voor wanderers** (`island: null`), voor islanders gewoon andermans grond | Een wanderer heeft geen eigen eiland; de starter is waar hij begint ([start-op-land.md](start-op-land.md)) en is daarmee het dichtst bij "je eigen". Een islander die er staat, is er op bezoek. Zie de open vraag hieronder. |
| **Eilandjes** (`shared/islets.mjs`) | PvP met vlag | De zee kent ze niet: ze zijn van de pagina en voor de zee is het open water. Het eerste gebied buiten de vulkaan waar twee spelers *staand* kunnen vechten. |
| **Open water** (zwemmend) | PvP met vlag, maar alleen vanaf land of een eilandje te raken | `combat.swing` weigert al slagen tijdens het zwemmen (`POSE.SWIMMING`). Een zwemmer slaat dus niet, maar kan binnen `SWING_RISE` vanaf de kant wel geraakt worden, net als door een guard. Een duiker dieper dan 1,2 is buiten bereik (hetzelfde losse eindje als bij de guards). |
| **Aan boord** (roer, dek, ladder) | **veilig** in fase 1 | `afoot` en `pilotsOf` sluiten aan boord al uit. Enteren op de galjoen is een eigen ontwerp (fase 4). |
| **Te paard / op de fiets** | PvP met vlag, **afstijgen bij een treffer** (besluit van de keeper) | De zee kan niemand van een paard trekken, want `RIDING` is een claim. Daarom stuurt de zee de geraakte privé `{t:'pvp', a:'struck'}`, en walk.js stijgt af (`rides()`). Een ruiter die zelf slaat, mag dat: `afoot` laat `RIDING` al toe. *Waarom afstijgen:* anders is het paard een vluchtauto die nooit stilstaat. |
| **De vulkaan** | PvP met vlag, **geen** gedwongen PvP | Niemands eiland, dus niemands vrijplaats. De vulkaan is vijandig voor guards, niet voor spelers: wie er zonder vlag komt, heeft niet om spelers gevraagd. Met vlag is het de natuurlijke arena. |
| **Kamers en interieurs** (de Salty Kraken, de taverne) | **veilig** | `p.room` maakt je al niet-`afoot`. Een kroeg is waar je na een gevecht samen drinkt. |
| **`ASLEEP`** (geparkeerd lichaam) | veilig | Er stuurt niemand, dus wie het raakt, raakt een pop. |

Wat de vrijplaats níét doet: hij beschermt niet tegen guards of lava. Die regels blijven zoals ze
zijn. En spawn camping blijft onmogelijk: `refuge` is je eigen plein (je vrijplaats) of, voor een
wanderer, zijn skiff (aan boord).

### 3. Gevechtsregels

- **Richten zoals nu.** `combat.targetOf(p)` krijgt spelers als derde soort doelwit, naast
  guards en residents. Het doel is de dichtstbijzijnde binnen `SWING_REACH` 0,9 en
  `FRONT_ARC_COS`, met een vlag, niet `sanctuary`, `afoot` en niet immuun. Bij een gelijke
  afstand gaat een agent vóór een speler. *Waarom:* een gevecht met guards waarbij je
  medestrijder toevallig dichterbij staat, mag geen per-ongeluk-PvP worden. Daarom geldt ook:
  **vlag of niet, op de vulkaan raak je met één slag maar één doel.**
- **Schade: `PVP_HIT` 12.** Dat zit tussen `GUARD_HIT` 10 en `PLAYER_HIT` 25 (dat laatste is
  bedoeld om agents te vellen, met 100 hp en zonder regeneratie). Met 100 hp, `SWING_MS` 450 en
  `REGEN_AFTER_MS` 3000 duurt een gevecht tussen twee spelers zonder schild 9 slagen, minstens
  ~4 s. Dat is lang genoeg om terug te slaan, te blokkeren of te vluchten. De schade is plat,
  om dezelfde reden als bij `PLAYER_HIT`: wat iemand vasthoudt, bereikt de zee niet.
- **Schilden en blokkeren werken beide kanten op**, via dezelfde `blowOn(victim, PVP_HIT, x, z)`
  met de positie van de aanvaller als (x, z): pantser per schild-hand, `BLOCK_FRACTION` 0,3
  achter een geheven schild. Maar **`SHIELD_ARMOR` telt in PvP hoogstens één keer** (één hand),
  omdat de schild-bits een claim zijn (zie 4).
- **Windup `PVP_WINDUP_MS` 300.** `swung` gaat zoals nu meteen naar iedereen, want dat is de
  aankondiging. Het doelwit wordt gekozen op het moment van de slag, maar de schade wordt pas
  na 300 ms bepaald, vanuit waar beiden dán staan (`SWING_REACH` + `REACH_SLACK`) en of het
  schild dán omhoog is. Dat is hetzelfde patroon als `GUARD_WINDUP_MS`. *Waarom korter dan 550:*
  de zwaai van een speler duurt 0,45 s, en de klap moet vallen op het moment dat je hem ziet
  treffen, niet erna. Het is net genoeg om een schild op te heffen of een stap terug te zetten.
- **Niet stapelen: `MAX_PVP_ATTACKERS` 2.** Per slachtoffer houdt de zee bij wie er in de laatste
  `PVP_ENGAGE_MS` (3 s) een treffer heeft gegeven. Een derde aanvaller in dat venster raakt
  voor 0: `swung` is wel te zien, maar er gaat geen health af. *Waarom 2 en niet 3 zoals guards:*
  een speler met een zwaard is gevaarlijker dan een guard, en 3 tegen 1 is binnen 1,5 s klaar.
  Met 2 tegen 1 kun je nog vluchten. Guards tellen hier niet mee, en spelers niet bij
  `MAX_ATTACKERS`: het zijn twee aparte limieten.
- **Bij 0 hp: zoals nu.** `hurt(victim, amount, { kind: 'player', by: attacker.id, island })`
  → de bestaande eviction, met `fell` naar iedereen. Het lichaam valt neer, springt naar
  `refuge` (het eigen plein, je vrijplaats, of de skiff van een wanderer, aan boord) en
  is immuun vanaf aankomst. Het `evicted`-bericht krijgt `by` met de naam van de winnaar
  (`by` bestaat al voor `settled`). De toast zegt "Gevloerd door X".
- **Geen buit en geen verlies.** Er verdwijnt geen item, goud, schatkaart of stuk standbeeld.
  *Waarom:* bezit staat in localStorage en `treasure.json` van de pagina. De zee kan dat dus
  niet eerlijk overdragen, en alles wat ze zou "geven", kan een client ook beweren te hebben
  gekregen. Uitzondering die al bestaat: wie het **standbeeld draagt** (`CARRYING`) en valt,
  laat het liggen zoals nu bij een dood (`dropped`). Dat blijft zo, en het wordt geen buit.
- **Griefing:**
  - *Spawn camping kan niet:* `refuge` is altijd je eigen eiland (je vrijplaats) of aan boord
    (skiff).
  - *Nieuwkomers:* de vlag staat standaard uit. Daarnaast kan de vlag pas aan na
    `PVP_FRESH_MS` (2 min) op een verbinding, zodat niemand in zijn eerste minuut per ongeluk
    in een gevecht stapt. De pagina zegt dan "nog N s".
  - *Revanchebeveiliging:* wie B heeft geveld, kan B `PVP_REMATCH_MS` (2 min) lang niet raken,
    tenzij B eerst A raakt. Zo kan A niet steeds wachten tot B terug is van zijn plein.
  - *Wie de vlag na een dood behoudt:* de vlag blijft aan. Je komt toch op je eigen eiland uit, en
    wie stopt, zet hem uit (met de cooldown).
- **Telefoon en touch:** die spelers hebben handknoppen (`walk.hand`) en richten met de stick,
  dus ze zijn trager en minder precies. Het wordt niet gecompenseerd: de vlag is vrijwillig, en
  de telefoon toont bij het aanzetten één keer "anderen spelen vaak met muis en toetsenbord".
  Een speler met touch krijgt geen andere schade. *Waarom:* de zee weet niet wie touch gebruikt,
  en een bonus op basis van een claim kan iedereen claimen.

### 4. Gezag en valsspelen

Alles wordt op de zee beslist: het doelwit, het bereik, de schade, de cooldown, de vrijplaats,
de vlag. De pagina stuurt alleen `{t:'swing', side}` en `{t:'pvp', on}`. Wat de zee daarnaast
gelooft, zijn de claims van de pose: positie, yaw en de bits. Het ergste dat een liegende pagina
kan doen:

- **Teleporteren naar iemand toe.** Ze claimt naast het slachtoffer te staan en slaat. Een slag
  is daardoor hoogstens `PVP_HIT` per `SWING_MS`, en dat blijft eerlijk begrensd. Erger is dat
  een leugenaar uit het niets toeslaat. Daarom komt er **voor wie de vlag aan heeft een
  sprongcheck**: een pose die verder sprong dan `PVP_MAX_SPEED` (sprint plus marge, ~12 eenheden/s
  over de tijd tussen poses) wordt wel geaccepteerd (een respawn, de wereldrand, op een paard),
  maar zet `p.jumpedAt`. Slagen tegen spelers binnen `PVP_JUMP_MS` (1 s) daarna gaan nergens heen.
  De sprongen die de zee zelf veroorzaakt (eviction, `wrapShift` aan de rand) worden niet
  meegeteld.
- **Zich onaantastbaar claimen.** Een `r` (kamer), `ASLEEP` of `SWIMMING` claimen, of in een
  vrijplaats staan. Dat lost zich grotendeels zelf op: wie zich zo onaantastbaar maakt, kan ook
  zelf niet slaan, en wie vanaf zijn eigen eiland slaat, verliest daar 10 s zijn vrijplaats
  (regel 2). Maar heen en weer wisselen tussen
  slaan en "in een kamer zitten" moet dicht. Daarom geldt **een gevechtsslot**: binnen
  `PVP_COMBAT_MS` (10 s) na een PvP-treffer, gegeven of gekregen, negeert de zee voor het
  *geraakt worden* de claims `room` en `ASLEEP`. Aan boord blijft gelden, want dat is de waarheid
  van de zee (boten zijn van de zee). Een vrijplaats blijft gelden, maar die is een positie, dus
  de sprongcheck hierboven.
- **Twee schilden en `BLOCKING` claimen.** Met de huidige regels gaat er dan 0,5 × 0,3 = 15% van
  een slag door. Daarom telt **in PvP het pantser hoogstens één keer** (0,75 × 0,3 = 22,5% als
  geblokkeerd wordt, anders 75%). Een eerlijke speler met één schild merkt geen verschil.
- **Sneller slaan:** onmogelijk, want `SWING_MS` geldt per speler op de zee en de bucket in
  `lib/players.mjs` zit daarvoor.
- **De vlag faken op de pagina:** dat zegt niets, want de zee houdt hem bij.

Wat bewust open blijft: een pagina die eerlijk naast iemand staat maar een andere yaw claimt
dan ze tekent. Een guard heeft daar ook last van, en het levert niets op wat draaien ook niet
oplevert.

### 5. Wire en versies

Nieuw, en alles is een toevoeging:

| Richting | Bericht | Wat |
|---|---|---|
| pagina → zee | `{t:'pvp', on}` | vlag aan of uit |
| zee → speler | `{t:'pvp', on, offIn?, freshIn?}` | je vlag zoals de zee hem ziet (privé) |
| zee → iedereen | `identity.pvp` in `join` | wie de vlag heeft (naambordje) |
| zee → iedereen | `{t:'pvp', a:'hit', id, by, hp, max}` | een PvP-treffer, voor balkjes en geluid bij omstanders |
| zee → geraakte | `{t:'pvp', a:'struck', by, from:[x,z]}` | richting van de klap en afstijgen. `health` volgt zoals nu |
| zee → speler | welcome `pvp: true` | deze zee kent de vlag |
| zee → speler | `evicted` met `by` | wie je velde (het veld bestaat al) |

- **`SEA_V` blijft 3.** Een oudere pagina laat een onbekende `t` en een extra identity-veld vallen.
  Die zet nooit een vlag, wordt dus nooit door spelers geraakt, en ziet niemand rood. Een oudere
  zee laat `{t:'pvp'}` vallen (onbekende `t`) en stuurt geen `pvp` in de welcome,
  zodat de nieuwe pagina de schakelaar grijs toont. Geen wereld met gemengde versies raakt
  iemand die er niet om vroeg.
- **Patch of minor:** volgens de regels mag het een **patch** zijn: geen layout-gate, niets in
  `layout.json`, `config.json` of een bundel. De vlag leeft in het geheugen van de zee, per
  verbinding, en een herstart van de zee zet iedereen op uit tot de pagina hem opnieuw vraagt.
- **De open zee moet met de hand worden geredeployed** (stack 28, geen webhook). Dat moet vóór
  spelers de schakelaar daar kunnen gebruiken. Er hoeft geen env-var bij: de vlag is persoonlijk.

### 6. UI

- **De schakelaar:** Settings → On foot → *Open-world PvP* (aan/uit, met eronder in één zin
  de regel: "Alleen spelers met de vlag raken elkaar. Op je eigen eiland ben je veilig." Op een zee
  van vóór dit plan is hij grijs).
  Daarnaast een actie `pvp` in `ACTIONS` van `web/js/keybinds.js`, **zonder** standaardtoets
  (net als Ctrl). *Waarom geen chip op de HUD:* de chips te voet zijn bewust kaal gehouden
  ([minder-browser-meer-spel.md](minder-browser-meer-spel.md)), en een knop die je per ongeluk
  aantikt, is precies wat de cooldown moet voorkomen. Wel een **indicator** op de HUD zolang de
  vlag aan staat: gekruiste zwaarden bij de health-balk, met de aftelling bij het uitzetten
  ("PvP uit over 23 s"), een gedimde stand op je eigen eiland ("thuis, veilig") en een
  waarschuwing zodra je daar 10 s je vrijplaats kwijt bent omdat je zelf sloeg.
- **Feedback als je geraakt wordt:** een rode flits aan de rand van het scherm aan de kant van
  `from` (een richtingsindicator), de balk die zakt (bestaat al), en de eerste keer per gevecht
  een toast "X valt je aan". Wie anderen raakt, ziet een balkje boven het doel, op dezelfde manier
  als `web/js/agent-bars.js` (één InstancedMesh, dus geen extra draw calls per speler), gevuld uit
  `{t:'pvp', a:'hit'}`.
- **Verlies:** de val van [vallen-en-verdrinken.md](vallen-en-verdrinken.md), daarna de toast
  "Gevloerd door X", en voor de winnaar "Je velde X".
- **Geluid:** een nieuw part in `MIX_PARTS`, **`['combat', 'Fights', 'ambience']`**, dat ook de
  bestaande zwaard- en guardgeluiden draagt als die er komen. De klappen (raak, geblokkeerd, val)
  worden berekend zoals de rest. De geraakte hoort ze ongepositioneerd, omstanders gepositioneerd
  via een cue in `soundSnapshot()`, zoals in [meer-geluiden.md](meer-geluiden.md). De families
  komen in `SFX_FAMILIES`, zodat de keeper ze met eigen opnames kan vervangen.

### 7. Fasen

1. **Vlag en vrijplaats, staand gevecht.** `lib/pvp.mjs` (`sanctuary`, de vlag, `PVP_FRESH_MS`),
   `{t:'pvp', on}`, identity-veld, `pvp: true` in de welcome,
   spelers als doel in `combat.targetOf` met `PVP_HIT`, `blowOn` met pantser één keer, windup,
   `MAX_PVP_ATTACKERS`, `hurt(…, { kind:'player', by })`. De pagina krijgt de schakelaar in
   Settings, een rood naambordje en de toasts. Dat is genoeg om op een eilandje of de vulkaan
   met z'n tweeën te vechten.
   *Tests* (`tests/pvp.test.mjs`, met `afloat` en `talk` uit `tests/support/sea.mjs`, en een zee
   met `starters: false` behalve waar het om starters gaat): twee spelers met vlag buiten een
   vrijplaats raken elkaar en de derde slag van een derde aanvaller doet 0. Zonder vlag aan één
   kant gebeurt niets. Op zijn eigen eiland (grid + rand) is de eigenaar niet te raken, een
   bezoeker met vlag daar wel (door een andere bezoeker en door de eigenaar met vlag), en een
   eigenaar die thuis slaat, is daarna 10 s te raken. Een wanderer op een starter is niet te
   raken, een islander daar wel. Een eigenaar zonder vlag raakt niemand. Een treffer na de windup mist als het doel buiten bereik is
   gestapt, en wordt verminderd achter een geheven schild. Twee schild-bits tellen als één. Bij
   0 hp volgen `evicted` met `by` en `fell`, en daarna immuniteit. Een agent gaat vóór een speler
   op gelijke afstand. `SEA_V` is onveranderd en een onbekende `t` op een oude pagina doet niets.
   En `tests/sea-image.test.mjs` blijft groen (`lib/pvp.mjs` ligt in `lib/`).
2. **Uitzetten met cooldown, misbruik.** `PVP_OFF_MS` met reset bij een treffer, `PVP_TOGGLE_MS`,
   revanchebeveiliging, gevechtsslot (`room`/`ASLEEP` genegeerd), sprongcheck, afstijgen bij
   `struck`. *Tests:* de vlag blijft 30 s staan na een treffer, `ASLEEP` midden in een gevecht
   beschermt niet, een sprong van 50 eenheden blokkeert slagen 1 s, en A raakt B niet binnen
   2 min na een vloer tenzij B eerst slaat.
3. **Gevoel.** Balkjes boven spelers, richtingsflits, het `combat`-part en de SFX-families,
   HUD-indicator met aftelling. *Tests:* `tests/sound-samples.test.mjs` voor de nieuwe families,
   en een test die de bron leest op `pvp` in `ACTIONS` zonder standaardtoets.
4. **Later, met eigen ontwerp:** enteren en vechten op een dek (de galjoen, crew 5), en of een
   speler die PvP-geveld wordt iets anders verdient dan "terug naar huis".

## Later-ideeën

- **Een zee-brede stand.** `pvp: 'off' | 'flag'` per zee: de host via een methode op `ownSea`
  (zoals de zeeklok in [zeetijd-van-de-host.md](zeetijd-van-de-host.md)), de open zee via een
  env-var `SEA_PVP`. Niet gebouwd: de keeper wil de vlag persoonlijk houden, en een zee waar
  niemand hem aanzet, heeft al geen PvP. Alleen nodig als een private zee ooit "PvP nergens"
  wil, ook voor wie de vlag aanzet.

## Open vragen voor de keeper

1. **Is een starter veilig voor wanderers?** Het plan zegt: een wanderer (telefoon of web, geen
   eigen eiland) is op een starter veilig, omdat dat is waar hij begint en hij geen eigen eiland
   heeft. Een islander is daar op bezoek en dus met vlag een doelwit. Het alternatief is dat een
   starter niemands eiland is, net als de vulkaan, en een wanderer dan nergens op land veilig is
   (alleen aan boord van zijn skiff).
