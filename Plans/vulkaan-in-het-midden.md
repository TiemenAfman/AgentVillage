# De vulkaan in het midden, stamina en turbo, en vrij zwemmen

Wens (Martijn, 2026-09-23): het Codex-eiland wordt **één groot, vijandig vulkaaneiland in het
midden van de zee**. Hoe meer islanders er in de zee zijn, hoe meer vijandige Codex-agents er
rondlopen. Wie Codex-data heeft, bouwt er huisjes op. Er komen lavastromen, een turbo op de boot
en op het zwemmen/rennen met een gele staminabalk, een rode healthbalk die straks echt gaat
tellen, en de bewegingsbeperking in open zee gaat eruit. Nieuwe settler-modellen voor de
Codex-agents komen later van Martijn zelf.

Stap 0 t/m 4 van de volgorde zijn gebouwd op 23 september 2026: vrij zwemmen, stamina met Shift-turbo en de balken (`web/js/stamina.js`, `web/js/vitals.js`), en `hurt()` op de zee (`lib/health.mjs`) met de omgebouwde hostility. Daarna het vulkaanterrein met lavastromen (`shared/terrain.mjs` met `volcano: true`, `web/js/lava.js`) en de vulkaan van de zee zelf op [0,0] (`shared/volcano.mjs`, `fleet.raiseVolcano()`), met de eilanden in ringen eromheen. Stap 5 ook (dezelfde dag): het wachthuis op de flank
(`guardhouseSite()` in `shared/volcano.mjs`, voorlopig getekend als het kasteel), bewakers
`guard:<n>` die meeschalen met het aantal online islanders (`lib/guards.mjs`; Codex-eilanden
tellen niet mee, dus één islander telt één keer), lava die pijn doet (`lib/lava.mjs`) en die
de A* van de bewakers mijdt, en geen pose meer vóór de pagina haar ligplaats kent. Stap 6 ook
(dezelfde dag): elke islander stuurt een lijstje van zijn Codex-settlers door een nieuwe deur
`POST /island/:id/codex` (`packCodex`/`parseCodex`, max. 60, achter de key en het claim-token),
en de zee zet de huisjes op 134 vaste bouwplekken op de helling (`codexPlots`, hash op
`codex:<island>:<id>` met lineair doorzoeken), de rest woont in het wachthuis, en de bewoners
komen erbij in de lopende crowd (`lib/residents.mjs`). De pagina krijgt de huisjes via een
`codex`-bericht zonder `rev` te verzetten. Het Codex-eiland per islander is weg. Stap 7 is
ontwerp.

## Hoe het nu zit (gemeten in de sessie van 23-09)

- **Het Codex-eiland is altijd vijandig, hardcoded.** `codexBundle()` in `serve.mjs` zet
  `village.island.hostile = true`. Elke islander met `codexIsland.enabled` publiceert een eigen
  Codex-eiland (`CODEX_ISLAND_ID` = hash van `${ISLAND_ID}:codex`), met een eigen layout in
  `data/codex/layout.json` op seed 7331. Het publiceert bewust ná het thuiseiland, zodat thuis
  het eerste plekje in de zee krijgt.
- **De achtervolging zit op de zee**, in `lib/hostility.mjs`: elke zichtbare bewoner van een
  vijandig eiland jaagt op de dichtstbijzijnde bezoeker die loopt, op land of een steiger staat,
  en niet zwemt (`p.f & 2`, `FLAG_SWIMMING` in `web/js/net.js`), niet vaart en niet in een room
  zit. Bewoners lopen `f.speed = 2.4`, er zijn max. 3 A*-zoekacties per beat en er wordt om de
  650 ms opnieuw gepland. Bij contact (< 0.65) volgt `roster.evict(...)` naar het eigen
  dorpsplein, of voor een telefoon-wanderer naar de eigen skiff, met 5 s immuniteit.
  `p.island === island.id` telt niet als bezoeker, dus je eigen Codex-bewoners jagen nu óók op
  jou: je walker hoort bij het thuiseiland.
- **Plekken in de zee**: `nextOrigin()` in `shared/regions.mjs` geeft het eerste eiland
  `[0,0]` en de rest het eerste vrije punt op een vierkant rooster, ring voor ring
  (`ringPoints`: eerst de vier windrichtingen, dan de hoeken). De afstand tussen roosterpunten
  wordt bepaald door het **grootste** eiland dat er ligt. `clearOf()` meet op de assen.
- **Een bewoner bestaat alleen met een huis.** `createCrowd` spawnt alleen voor gebouwen met
  een bewoner (`lib/crowd.mjs:67`). De pagina kleedt een figuur aan uit het gebouw
  (`crowd-view.js:102`, `if (!spec) return`).
- **Op een eiland dat niet van jou is kun je nergens mee iets doen.** `interactables()` in
  `main.js` wordt alleen uit `state.byId` gevuld, dus uit het eigen eiland. Huizen op een
  gasteiland zijn decor en obstakel.
- **Een rivier heeft geen eigen wateroppervlak.** `carveRiver` graaft de bedding onder
  zeeniveau en het ene zeevlak op y = 0 (`world.js`, "sea, the lake and the rivers") schijnt
  erdoorheen. `riverCourse` volgt wel de helling van bron naar zee.
- **Er is nog geen health.** Slaan met de linkermuisknop is alleen een animatie
  (`classicAvatar.attack()`, zie `aanvallen-en-blokkeren.md`); er gaat geen treffer over de lijn.
- **Snelheden**: lopen 3.4, rennen 6.6 (Shift, alleen te voet: `walk.js:712`), zwemmen 1.9,
  boot 9.5 (`BOAT_TOP`). Stamina bestaat nog niet. Shift doet in de boot niets.
- **Vast in open zee**: `blocked()` (`walk.js:523`) weigert elke stap in water als er binnen
  `SWIM_REACH` (2.0) geen land ligt. Wie door een bug in open zee terechtkomt, kan geen kant op.
- **Een islander is offline** als de tray-exe (`promptholm-island.exe`) stopt of de laptop
  dichtgaat. Het venster sluiten telt niet. Na het wegvallen van de socket blijft een eiland
  nog `GRACE_MS` (45 s, `lib/fleet.mjs`) staan.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Hoeveel Codex-eilanden? | **Precies één**: de vulkaan, in het midden. Islanders publiceren geen eigen Codex-eiland meer. | Eén vijandig middelpunt waar iedereen omheen ligt. |
| Van wie is de vulkaan? | **Van de zee zelf**, gemaakt bij het opstarten uit een vaste seed, altijd op `[0,0]`, nooit opgeruimd. | Hij moet altijd blijven staan, ook zonder host. Hij volgt helemaal uit de seed, dus de zee schrijft nog steeds niets naar schijf. Dit verlaat bewust het principe "de zee heeft geen eigen eiland" (CLAUDE.md bijwerken). |
| Huisjes op de vulkaan | Elke islander met Codex-data stuurt een lijstje van zijn Codex-settlers (geredigeerd id, stijl, soort, actief). De **zee** zet de huizen op vaste bouwplekken op de hellingen, **door elkaar** voor alle spelers. De plek volgt uit een hash van het id; is die bezet, dan wordt er in een vaste volgorde doorgezocht. | Niemand kan er iets mee doen, dus een huis hoeft niet voor altijd op dezelfde plek te staan. Een hash in plaats van de volgorde zorgt dat een nieuw huis de rest niet laat verspringen. Door elkaar geeft een leuk effect. |
| Layout per islander? | **Nee.** `data/codex/layout.json` is niet meer nodig (reservekopie bewaren en dan laten staan). | De zee plant. De regel "een huis verhuist nooit vanzelf" geldt niet voor vulkaanhuizen. |
| Id's over spelers heen | De zee zet het island-id ervoor (`codex:<island>:<id>`). | Twee islanders kunnen allebei een `house:s3` hebben. |
| Islander offline | Zijn huizen en bewoners verdwijnen na de gewone grace van 45 s. De vulkaan blijft staan. | |
| Pool vol | De laatste huizen krijgen geen plek. Hun bewoners doen wel mee, vanuit het wachthuis. | |
| Wie is doelwit? | **Elke speler**, ook wie huizen op de vulkaan heeft. | De vulkaan is van niemand. De uitzondering `p.island === island.id` verdwijnt. |
| Waar schaalt het aantal agents mee? | Met het aantal **online islanders** (eilanden in de fleet met een live islander-socket, de vulkaan zelf niet meegeteld). Orbit of walk maakt niet uit. | Dezelfde islander levert de huizen en de extra agents. Een telefoonspeler maakt de vulkaan dus niet zwaarder, maar wordt wel gejaagd. |
| Agents | De bewoners van de huisjes **plus** bewakers zonder eigen huis: `basis + k × islanders`, met een plafond. De bewakers wonen in **één centraal wachthuis** op de vulkaan (niet in de krater), dat de zee op een vaste plek zet. | `view.enrol` weigert bij een volle crowd, en het A*-budget is 3 per beat, dus een plafond is nodig. |
| Levens van agents | Bewakers en bewoners hebben **health**. Bij 0 vallen ze om en verdwijnen. | Zodra spelers kunnen slaan (stap 7). |
| Respawn | Na **20 s**. Een bewaker komt terug **uit het wachthuis**; een bewoner van een Codex-huisje bij zijn eigen huis. | |
| Islander disconnect | De bewakers die er al zijn **gaan niet dood** en verdwijnen niet. Het doelaantal (`basis + k × islanders`) zakt wel meteen. Sterft er daarna een bewaker terwijl er meer zijn dan het doelaantal, dan **komt hij niet terug**. Pas als het aantal onder het doel zit, respawnt er weer een. | Geen bewakers die ineens uit het niets verdwijnen, en toch zakt het aantal vanzelf naar het nieuwe niveau. |
| Snelheid bewakers | **4.5** (was 2.4). | Tussen lopen (3.4) en rennen (6.6): met sprinten loop je ze uit, als je stamina op is halen ze je in. |
| Zwemmen bewakers | Ze mogen **een klein stukje** zwemmen, bijvoorbeeld tot 2 cellen uit de kust. Een zwemmer binnen die strook is ook een doelwit. | Zwemmen mag geen volledig veilige vluchtroute zijn vlak onder de kust. Verder de zee in ben je veilig. |
| Lava | Eén of twee **echte lavastromen**, net als de rivier: van de kraterrand bergafwaarts naar de zee. | |
| Lava aanraken | Via `hurt()` (zie hieronder). Nu betekent dat: terug naar je dorpsplein (of je skiff). | |
| Bewakers en lava | De A* ziet lava-cellen als niet-beloopbaar. | Een stroom wordt zo iets waarmee je ze kunt afschudden. |
| Health | Op de **zee**, in geheugen, per speler. Eén functie `hurt(speler, hoeveel, oorzaak)` voor alles wat pijn doet: lava, bewakers, later ook spelers. **Nu** zet `hurt` je altijd meteen terug; **straks** trekt hij levens af en volgt de evict pas bij 0. | Alleen de zee weet dat je geraakt bent, dus een client kan zich niet zelf heel verklaren. Als de healthbar komt verandert er niets aan de aanroepers. |
| Health herstellen | Vanzelf, **na 3 s zonder combat**. Elke `hurt()` telt als combat, lava ook. | De zee stuurt je health en het moment dat het herstel begint privé naar je toe. De pagina laat de balk dan zelf vloeiend vollopen, zonder dat de zee elke frame iets hoeft te sturen. |
| Turbo | **Shift**, net als rennen. Te voet = rennen, in het water = zwem-turbo, in de boot = boot-turbo. Op de telefoon doet de bestaande ren-knop (`stick.run`) hetzelfde. | Eén toets, drie betekenissen, afhankelijk van waar je bent. |
| Stamina | **Twee potjes**: één voor **rennen + zwemmen samen**, één voor de **boot**. Allebei laden ze op de achtergrond op. | Zo besloten. |
| Waar draait stamina? | Op de **pagina**. | Rennen is nu al onbeperkt en de zee controleert geen snelheid, dus valsspelen wordt er niet makkelijker door. Een snelheidscontrole op de zee kan later. |
| Lege stamina | Terug naar de gewone snelheid. Turbo kan pas weer vanaf **25 %**. | Anders flikkert de turbo aan en uit als je Shift ingedrukt houdt. |
| De balken | Rood = health, geel = stamina. Eén component in de HUD. De gele balk toont het potje van wat je nu doet (te voet/zwemmend of in de boot). Is een balk vol, dan **vervaagt hij langzaam** naar onzichtbaar (na ±1,5 s); zodra hij zakt is hij meteen weer zichtbaar. | |
| Open zee | De bewegingsbeperking in open water gaat er **helemaal uit**. | Wie door een bug in open zee belandt, zit nu vast. Gevolg: je kunt van eiland naar eiland zwemmen. Dat is prima: het gaat langzaam (1.9 tegen 9.5 in de boot), en daarvoor is de boot er. |

## Voorstel per onderdeel

### 1. Vrij zwemmen in open zee (`web/js/walk.js`)

De check `groundAt(...) < 0.06 && !shoreWithinReach(...)` in `blocked()` gaat eruit, en daarmee
`shoreWithinReach`, `PROBE` en `SWIM_REACH`, want niets anders gebruikt die. De comments die
de oude regel uitleggen (`walk.js:33`, `walk.js:722`, `boat.js:4`) worden bijgewerkt. Dit staat
los van de rest en kan als eerste.

### 2. Stamina, turbo en de balken (alleen de pagina)

- `walk.js`: `state.stamina = { body, boat }` (0..1). Rennen en de zwem-turbo gebruiken `body`,
  de boot-turbo `boat`. De zwem-turbo gaat bijvoorbeeld van 1.9 naar 3.2.
- `web/js/boat.js`: `stepBoat(b, { throttle, turn, turbo })`. Turbo verhoogt `BOAT_TOP` en
  `BOAT_ACCEL` tijdelijk (voorstel ×1,6, dus ≈15). `stepBoat` blijft puur.
- Voorstel voor de getallen:
  - **body**: 6 s volle sprint, 1 s na loslaten begint het opladen, na 5 s vol;
  - **boat**: 4 s turbo, 1 s na loslaten begint het opladen, na 6 s vol;
  - voor allebei de drempel van 25 %.
- Een nieuwe HUD-component met twee balken: health (rood) en stamina (geel), met de fade.
  De regels voor ≤480px gaan in `harbour.css`, niet in `ui.css` (zie CLAUDE.md).

### 3. Health en `hurt()` op de zee (`lib/`)

- Een nieuw moduletje, bijvoorbeeld `lib/health.mjs`, met `hurt(speler, hoeveel, oorzaak)`.
  Het houdt de health per speler in geheugen bij (verdwijnt met de speler) en start het herstel
  na 3 s zonder combat. **Voorlopig**: elke `hurt` is meteen `roster.evict(...)`.
- `lib/hostility.mjs` roept `hurt` aan in plaats van zelf te evicten. Verder:
  - de uitzondering `p.island === island.id` weg;
  - bewakers op 4.5;
  - een strook van ±2 cellen water langs de kust telt voor de A* als beloopbaar, en een zwemmer
    in die strook is ook doelwit (de `p.f & 2`-uitzondering geldt alleen nog verder uit de kust);
  - lava-cellen zijn voor de A* niet beloopbaar.
- De lava-check: per tick kijkt de zee of een lopende speler met zijn voeten op een lava-cel
  staat. Wie vaart of via een brug of steiger erboven staat, raakt de lava niet. Deze check komt
  naast de hostility-tick en gebruikt dezelfde filters.
- Het bericht naar de speler (health, begin van het herstel) gaat privé, zoals nu de
  "je bent gevangen"-melding.

### 4. Het vulkaanterrein (`shared/terrain.mjs`)

- Een optie `volcano: true` naast `open`, zodat gewone eilanden precies zo blijven hashen als nu.
- Een brede kegel rond het midden met een krater erin (een kleinere bump eraf), met de bestaande
  `fbm2`-noise voor ruggen. Alleen `sqrt` en `smoothstep`, geen `sin`/`cos`/`pow` (de regel van
  `shared/`).
- **De helling moet beloopbaar blijven**: `slope()` bepaalt waar je kunt lopen en bouwen. Een te
  steile kegel kun je niet beklimmen, en de bewakers dan ook niet. Eventueel paden omhoog.
- **Lavastromen**:
  - de route komt uit `riverCourse`, met de start op de kraterrand;
  - een ondiepe geul die de helling volgt (±0,5 onder de grond ernaast), in plaats van
    `carveRiver` onder zeeniveau;
  - het levert `lavaCells` en `lavaBankCells` op, zoals `riverCells`: die zijn niet bebouwbaar,
    en de zee gebruikt ze voor de schade.
- Grootte: voorstel grid 128. Nog te bepalen.

### 5. De vulkaan tekenen (`web/js/world.js`, `horizon.js`)

- Grondkleur op hoogte: strand, dan donker gesteente en as, bovenaan kaal. Geen bos op de vulkaan.
- De lava: een lint-mesh langs elke route, net boven de bodem van de geul, met een shader die de
  textuur bergafwaarts laat schuiven: gloeiend oranje in het midden, donkere korst aan de randen,
  zelf-lichtgevend (dus 's nachts zichtbaar). Eén draw call voor alle stromen samen. De oevers
  zijn zwart basalt in plaats van riet.
- Rook uit de krater, en stoom waar de lava de zee raakt: een paar sprites of low-poly blobs,
  zoals de wolken.
- `horizon.js` moet de vulkaanvorm ook kennen voor het silhouet op afstand.
- De vulkaan-bewoners dragen al wapens (`armed` in `crowd-view.js`); de nieuwe settler-modellen
  van Martijn komen er later bij als een eigen soort in `settler-figures.js` (één material,
  één draw call per soort).

### 6. De zee houdt de vulkaan in stand (`lib/sea.mjs`, `lib/fleet.mjs`, `shared/regions.mjs`)

- Bij het opstarten zet de zee de vulkaan in de fleet op `[0,0]`, vóór er iemand joint. Er hoort
  geen claim-token bij en hij wordt nooit opgeruimd. Een herstart maakt exact hetzelfde terrein.
- `nextOrigin` behandelt het midden apart: de eerste ring ligt op de straal van de vulkaan, en de
  andere eilanden houden onderling hun eigen maat. Anders zet één groot middeneiland het hele
  rooster uit elkaar, want de afstand volgt nu het grootste eiland. `tests/fleet-placement.test.mjs`
  moet mee.
- Een eiland houdt zijn plek zodra het er een heeft (bestaande invariant, blijft staan).

### 7. Het wachthuis en de bewakers (`lib/crowd.mjs`, `web/js/crowd-view.js`)

- Eén centraal **wachthuis** op de vulkaan, door de zee op een vaste plek gezet (een eigen
  gebouwsoort, dus een model erbij). Alle bewakers horen daarbij: hun deur is die van het
  wachthuis. Zo passen ze in het bestaande model "een figuur hoort bij een gebouw", en hoeft
  `createCrowd` alleen te leren dat één gebouw meer dan één bewoner kan hebben.
- De pagina kleedt de bewakers aan uit hun eigen id (`guard:<n>`), niet uit het gebouw, anders
  zien ze er allemaal hetzelfde uit.
- Het doelaantal is `basis + k × islanders`, met een plafond. Voorstel: basis 4, k 3, plafond 24.
  Getallen nog te bepalen.
- Het doel wordt alleen **naar boven** direct bijgewerkt: komt er een islander bij, dan komen er
  meteen bewakers uit het wachthuis. Gaat er een islander weg, dan blijft iedereen leven. Pas bij
  de volgende dood wordt gekeken of er respawnt: alleen als het aantal onder het doel zit.
- Respawn na 20 s, uit het wachthuis voor bewakers en bij hun eigen huis voor bewoners van een
  Codex-huisje. De timers staan in geheugen op de zee, net als de achtervolging.

### 8. Codex-huisjes op de vulkaan (`serve.mjs`, een nieuwe zee-deur)

- De `codexClient` in `serve.mjs` publiceert geen eigen eiland meer. Hij stuurt alleen het
  lijstje Codex-settlers naar de zee, door een nieuwe deur met een strikte parser (zoals
  `parseParcel`), achter dezelfde key-check. Wat er nu naar de zee gaat is al geredigeerd; dat
  blijft zo (geen prompts, paden of transcripts).
- De zee zet de huizen op de bouwplekken (hash op het id) en de bewoners in de crowd.
- **Niet de hele crowd opnieuw opbouwen** bij elk lijstje: met tien islanders die elk per minuut
  scannen zou de vulkaan nooit stilstaan, want bij een rebuild loopt iedereen terug naar zijn
  deur. Alleen de figuren van die ene islander vervangen, en niet aan `rev` komen, net als
  `parcel` nu.

## Volgorde

0. Open zee vrijgeven (1). Klein, los, direct te mergen.
1. Stamina, turbo en de balken (2). Alleen de pagina, los van de vulkaan.
2. `hurt()` en de health op de zee, hostility omgebouwd: iedereen doelwit, 4.5, zwemstrook (3).
   Werkt meteen op het bestaande Codex-eiland.
3. Vulkaanterrein en lava in `shared/` (4), en het tekenen (5). Te beoordelen met een los
   prototype voordat het in de zee komt.
4. De zee houdt de vulkaan op `[0,0]` en `nextOrigin` rond het midden (6).
5. Het wachthuis en de bewakers die meeschalen met het aantal islanders (7).
6. Codex-huisjes van alle islanders op de vulkaan (8). Het oude Codex-eiland per islander
   verdwijnt hiermee.
7. Nieuwe settler-modellen (van Martijn), en daarna de healthbar echt laten tellen: `hurt` trekt
   levens af, blokken met rechts vermindert schade van bewakers, lava doet schade per seconde.
   Tegelijk krijgen agents levens: een slag van een speler gaat als treffer naar de zee, een
   agent bij 0 valt om, en respawnt na 20 s volgens de regels hierboven.

## Nog open

- Getallen: grootte van de vulkaan, aantal bouwplekken, `basis`/`k`/plafond voor bewakers,
  stamina-duur, turbo-factor, hoeveel een bewaker/lava straks aan health kost en hoe snel die
  herstelt.
- Wat de telefoon-app ziet als je gevangen wordt door lava of een bewaker: je skiff, zoals nu.
- CLAUDE.md bijwerken zodra stap 4 en 6 gebouwd zijn: de zee heeft dan een eigen eiland, en de
  regel "een huis verhuist nooit" geldt niet voor de vulkaan.
