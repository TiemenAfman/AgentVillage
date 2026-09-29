# Werkhoudingen per tool: een settler doet wat zijn sessie doet

**🚧 Status: plan van 29 september 2026, nog niet gebouwd.**

## Aanleiding

Een settler wiens sessie loopt, staat voor zijn eigen deur en hamert. Altijd, wat de sessie ook
doet: een sessie die twintig minuten alleen bestanden leest hamert net zo hard als een die code
schrijft. Het huis vertelt het lange verhaal al wel - `ornamentsOf` in `lib/village.mjs` zet een
smederij, een houtstapel, een lantaarn, een windvaan of duiven op een huis naar de *totale*
toolmix - maar het lichaam van de settler vertelt niets. Het idee: je ziet aan een settler wat
zijn sessie de laatste tijd doet.

## Wat er al is

- **De tellingen** (`lib/parse.mjs`, `foldLine`): `agg.tools` telt per tool sinds het begin,
  daarnaast `apiErrors` en `agentSpawns`. Er is **geen tijdas**: nergens staat welke tool het
  laatst werd gebruikt, of wanneer.
- **De families staan al vast** in `ornamentsOf` (`lib/village.mjs:256`): Bash/PowerShell,
  Edit/Write/MultiEdit/NotebookEdit, Read/Grep/Glob, `mcp:claude-in-chrome` /
  `mcp:Claude_Browser`, WebSearch/WebFetch. Dezelfde indeling hoort ook de houding te bepalen,
  anders zegt het huis het een en het lichaam het ander.
- **Actief is een bit** per gebouw (`active`, `lib/village.mjs:527`; een schuur is actief als
  zijn meester dat is en hij de laatste 2 minuten iets deed, regel 690). `lib/crowd.mjs:238`
  zet zo'n settler bij het spawnen op `mode: 'hammer'`. De crowd wordt bij elke publish opnieuw
  gebouwd, en dat is elke scan (60 s): de comment op die regel zegt het zelf, "puts the hammer
  down at the next scan, a minute at most". **De fijnheid is dus de scan, niet de tool-call.**
- **Het contract met de tekenaar** is één woord per settler: `f.anim`, een index in `ANIMS`
  (`shared/settlerwire.mjs:42`). Nieuwe woorden komen achteraan; een oudere pagina leest een
  onbekend nummer als `still`. De houdingen staan in `workPose(anim, t)`
  (`web/js/settler-figures.js:343`), het gereedschap is een `InstancedMesh` met `count` 0 zolang
  niemand het vasthoudt (`toolMesh`, `TOOL_OF` op regel 665): geen draw call voor wat niemand
  gebruikt.
- **De spoken van de schuren**: een subagent heeft een eigen transcript en dus een eigen `agg`
  (`aggOf(sa.file)`, `lib/village.mjs:667`). Wat we voor een sessie uitrekenen, kan dus ook voor
  zijn leerlingen.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wat is "wat hij nu doet"? | De familie met de meeste tool-calls in de laatste `DOING_WINDOW` (120 s), bij gelijke stand de meest recente. Geen call in dat venster maar wel actief: `ponder`. Niet actief: niets. | De scan draait om de minuut. Eén woord per call zou flikkeren en tot een minuut te laat zijn; "vooral dit de laatste twee minuten" is wat er eerlijk te zeggen valt. |
| De zes woorden | schrijven (Edit, Write, ...) = `hammer`, ongewijzigd; lezen (Read, Grep, Glob) = `read`; commando's (Bash, PowerShell) = `stoke`; het web (WebSearch, WebFetch, de browser-mcp's) = `scout`; anderen aanroepen (Agent, Task, Workflow) = `beckon`; tussen twee calls door of alleen tekst = `ponder`. Elke andere tool valt onder schrijven. | `hammer` blijft het gewone werk en het antwoord op "wat betekent het hameren ook alweer" in de handleiding. De rest is precies de lijst uit `ornamentsOf`, plus de twee toestanden die geen tool hebben. |
| Hoe ze eruitzien | `read`: een boek omhoog in de linkerhand, de rechter slaat om, het hoofd knikt. `stoke`: twee handen aan een lange pook die naar de deur toe steekt en terugtrekt. `scout`: een hand plat boven de ogen, het lijf draait langzaam links-rechts. `beckon`: de rechterarm zwaait in een grote boog, elke seconde of anderhalf. `ponder`: één arm omhoog tot de hand bij de kin, het gewicht verschuift. | Geen ellebogen in deze rig (zie de opmerking bij `HOLD_ARM_X` in `classic-avatar.js`), dus alles is een hoek per arm en been, zoals `workPose`. De waarden worden in `/demo` op het oog afgesteld, net als `RIDE_LEG` bij de fiets. |
| Gereedschap | Twee nieuwe gereedschappen in `settler-figures.js`: `books` en `pokers`, `instanced` met `count` 0 en `visible` false zolang niemand ze vasthoudt (het patroon van `hoes`, `axes`, `rods`). `scout`, `beckon` en `ponder` hebben er geen nodig. | Twee meshes voor de hele crowd, geen twee per settler; nul draw calls op een eiland waar niemand leest of stookt. |
| Onderweg naar de bundel | Een optioneel veld `doing` op het bouwrecord: één van de zes woorden, `null`/afwezig betekent hameren. `building()` in `lib/islandbundle.mjs` krijgt het naast `ornaments` en `stage`, met dezelfde vorm als `yardStage` (afwezig in plaats van null). Het is een afgeleid woord uit toolnamen, nooit een toolnaam of invoer. | `tools` reist bewust nooit (de lijst bovenaan `building()`); `ornaments` wel, omdat het een afgeleid woord is. `doing` is hetzelfde soort ding. Een zee van vóór dit laat het veld vallen en tekent hameren. |
| **`SOFT_BUILDING_FIELDS`** | `doing` moet in `web/js/islandsig.js` bij `active` en `lastAt`. | Anders leest elke wisseling van houding als "het eiland van de buurman is anders" en herbouwt elke kijker diens landschap: 550 ms, drie keer per minuut (de kop van dat bestand vertelt precies dat verhaal). Dit is de plek waar het stil misgaat, dus er komt een test die faalt als het veld ontbreekt. |
| Aan de kant van de zee | `lib/crowd.mjs` geeft `spec.doing` al mee via `spec` aan `walk.spawn`; in de hamer-tak van `shared/settlerwalk.mjs` (rond regel 1160) wordt `f.anim = 'hammer'` een opzoeking in een tabel `WORK_ANIM[f.spec.doing] || 'hammer'`. `f.mode` blijft `'hammer'`: de goudtochten (`startGold`, `f.active`) en de borrel-regels hangen aan de mode, niet aan het woord. | Eén regel in het pad van de crowd, en alles wat aan `mode === 'hammer'` hangt blijft werken. Geen klok, geen `sin`: het woord komt uit de bundel, dus twee machines stappen hetzelfde. |
| Op de lijn | Vijf woorden achteraan `ANIMS` (13 tot en met 17), niet in `MOVING`. Ze reizen als vastgepinde rijen, één per `KEYFRAME_S`, precies als `hammer` nu. | Nul extra bytes per rij; een oudere pagina toont `still` in plaats van `hammer`, wat de afspraak bij `ANIMS` al zegt. |
| Aan de kant van de pagina | `crowd-view.js:58` (`AT_WORK`) en de twee regels 633-635: de nieuwe woorden gedragen zich als `hammer` (een werker bij zijn deur is nooit "bewegend", de kruiwagen staat ernaast). Eén set `AT_DOOR` voor de zes in plaats van drie losse vergelijkingen met `'hammer'`. | Nu is `hammer` op die regels een uitzondering; zes uitzonderingen worden een set. `f.mode === 'hammer'` en `barrowAtHome` lezen `AT_DOOR.has(f.anim)`. |
| Geluid | Alleen `hammer` klinkt (`sound.js:808` en `:958` testen `f.anim !== 'hammer'`), en dat blijft zo. `stoke` kan later een schrapend geluid krijgen. | Een lezer die klinkt als een smid is erger dan een stille lezer. |
| De regisseur | `WORK_WORDS` in `main.js:1459` krijgt zes onderschriften ("A settler reading", "A settler stoking a fire", ...). Zonder dat kiest de regisseur nooit een lezer. | De regisseur kiest een figuur waarvan `anim` in `WORK_WORDS` staat. |
| Schuren | Dezelfde functie op de `agg` van de subagent: een leerling leest of zoekt bij zijn schuur. | De `agg` ligt er al; het kost één aanroep. |
| Codex | Niet: `lib/codex-sources.mjs` heeft andere toolnamen en geen `recent`. Codex-settlers blijven hameren. | Geen gok op een tabel die we niet kennen. |
| Waar komt de tijdas vandaan? | `foldLine` houdt `agg.recent` bij: de laatste 8 aanroepen als `[ts, familie]`, met de tijd van de regel zelf (`o.timestamp`). Een assistent-bericht met alleen tekst telt als `ponder`. **`AGG_VERSION` gaat niet omhoog.** | Een bump leest elk transcript opnieuw (sommige zijn 20 MB+). Een oude cache-entry heeft gewoon geen `recent` en vult zich met de nieuwe regels; wie het leest, behandelt afwezig als leeg. `recent` is ~180 bytes per sessie (of schuur) in `data/cache.json`, dus 8 en niet 50. |
| Een snellere weg? | Niet nu. Een hook op elke tool-call (`PostToolUse`) zou elke sessie op de machine raken en de regel "the hook must never disturb a session" op de proef stellen; `scripts/setup.mjs` zet nu alleen `SessionStart` en `SessionEnd`. Een deurtje zoals `POST /island/:id/parcel`, waar de islander alleen het woord per settler pusht zonder `rev` te verschuiven, kan later als de minuut te grof blijkt. | De minuut is een keuze met een reden, niet een tekort: zie de eerste rij. |

## Bestanden

- `lib/parse.mjs` - `agg.recent` in `newAgg` en `foldLine`, en de familie-tabel (of een export
  uit `lib/village.mjs` als die de enige plek moet blijven; `ornamentsOf` gebruikt dezelfde).
- `lib/village.mjs` - `TOOL_FAMILY` als één tabel voor `ornamentsOf` en `doingOf(agg, now)`;
  `doing` op het huis en op de schuur.
- `lib/islandbundle.mjs` - `doing` in `building()`, strikt naar zes woorden.
- `web/js/islandsig.js` - `doing` in `SOFT_BUILDING_FIELDS`.
- `shared/settlerwire.mjs` - vijf woorden achteraan `ANIMS`.
- `shared/settlerwalk.mjs` - `WORK_ANIM`, de hamer-tak.
- `web/js/crowd-view.js` - `AT_DOOR` in plaats van de hamer-uitzondering.
- `web/js/settler-figures.js` - vijf houdingen in `workPose`, `books` en `pokers`.
- `web/js/main.js` - `WORK_WORDS`.
- `docs/manual.md` - regel 1037 ("Scaffolding and hammering") en de alinea op regel 1090: de zes
  houdingen en wat ze betekenen.

## Tests

`tests/doing.test.mjs`, zonder loader en zonder `document`, zoals `settler-chores.test.mjs`:

- `foldLine` vult `agg.recent` en houdt er acht; een oude cache-entry zonder `recent` breekt niet.
- `doingOf` kiest de meerderheid in het venster, de nieuwste bij gelijkspel, `ponder` bij een
  actieve sessie zonder calls, niets bij een inactieve.
- Een bundel met `doing` overleeft `buildBundle` -> `parseBundle`; een onbekend woord wordt
  geweigerd; zonder veld komt hameren.
- `drawnSignature` van twee bundels die alleen in `doing` verschillen is gelijk.
- De walk: een actieve settler met `doing: 'read'` heeft `anim === 'read'`; met een goudtocht
  eromheen komen `barrow`, `load` en `carry` nog steeds voorbij en daarna weer `read`.
- De draad: `encodeCrowd` -> `decodeCrowd` geeft elk woord terug, en een tabel met de oude
  dertien woorden leest de nieuwe als `still`.
- Bron-checks: geen `Math.sin`, `cos` of `pow` in wat `shared/` erbij krijgt; `AT_DOOR` bevat
  alle zes.

## Volgorde

1. `agg.recent` en `doingOf` met hun tests. Nog niets zichtbaar; `village.json` toont het al.
2. De bundel, `islandsig` en de walk. Op een testeiland zie je het woord op de lijn.
3. De houdingen en de twee gereedschappen, in `/demo` afgesteld naast de bestaande werkers.
4. Handleiding en onderschriften.

## Later

- Een fijner woord dan de minuut, via een eigen deurtje (zie de laatste rij).
- Een fout laten zien: `apiErrors` maakt al een bliksemafleider (`lightningrod`) als huisdecor;
  een tool die faalt (`is_error` in het resultaat) leest niemand uit. Rook boven een settler die
  de laatste minuten veel faalde, zou een zevende woord zijn en een eigen plan.
- Wat een schuur bij `beckon` doet: de leerling die net is aangeroepen kort laten opkijken.
- `stoke` met een eigen schraapgeluid.
