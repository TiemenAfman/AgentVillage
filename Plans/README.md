# Plans

Grotere ontwerpen voordat ze code worden — voor mezelf en voor Tiemen. Een plan hier is het
"waarom" en de beslissingen; de code en `CLAUDE.md` zijn de waarheid over wat er nu staat.

## Besluiten die nog niet in een eigen plan zitten

- **Een onbezette boot drift terug naar zijn aanlegplaats.** Een boot die niemand aan het
  sturen heeft en die 5 minuten (`IDLE_HOME_MS` in `lib/boats.mjs`) niet is aangeraakt, gaat
  vanzelf terug naar zijn mooring — zie `driftHome()` in `lib/boats.mjs`, aangehaakt op de
  beat-loop in `lib/sea.mjs`. Dit is bewust een uitzondering op het principe uit
  `lib/boats.mjs`'s eigen kop ("een boot blijft precies waar hij is achtergelaten, alleen een
  herstart zet hem terug") — zonder dit kan het enige bootje van een eiland voorgoed aan de
  overkant blijven liggen door iemand die wegliep en niet terugkwam. Alleen een boot zonder
  piloot drift; wie zelf vaart, bepaalt zelf waar hij komt.

## Plannen

- [een-thuis-voor-het-eiland.md](een-thuis-voor-het-eiland.md): release, debug-build,
  hook en scanner delen één eiland in `~/.promptholm`, en niet in AppData, omdat Claude
  desktop daar een eigen kopie schrijft. Worktrees houden hun eigen data. Het bestaande
  eiland verhuist bij de eerste start vanzelf, gekopieerd vanaf het eiland waar de
  session-hook naartoe wijst. Gebouwd op 24 september 2026.
- [aangesproken-settler-draait-zich-om.md](aangesproken-settler-draait-zich-om.md) — een
  settler die je aanspreekt draait zich op elk scherm naar je toe: de zee stuurt wie er
  vastgehouden wordt en waar de spreker staat als eigen bericht (`fh`, alleen bij verandering),
  geen richting in elke rij; en `faceUp` noemt de settler bij zijn naam op de zee (`seaIdOf`).
  Gebouwd op 24 september 2026.
- [vulkaan-in-het-midden.md](vulkaan-in-het-midden.md) — het Codex-eiland wordt één vijandige
  vulkaan in het midden van de zee, van de zee zelf; meer islanders betekent meer bewakers, wie
  Codex-data heeft bouwt er huisjes op, lavastromen zoals de rivier. Daarbij: `hurt()` en health
  op de zee, stamina en Shift-turbo (rennen/zwemmen samen, boot apart) met rode en gele balken,
  en vrij zwemmen in open zee. Helemaal gebouwd op 23 september 2026: de vulkaan in het midden met een wachthuis, lava-imps als bewakers die meeschalen met de islanders, de Codex-huisjes van alle islanders op de helling, en health die echt telt met terugslaan en blokken.
- [klok-en-hemel-van-de-zee.md](klok-en-hemel-van-de-zee.md) — de zee als enige klok: één
  `shared/worldclock.mjs` voor uur, maand, weekdag en maanfase, `SEA_TZ` zodat de zee in Docker
  niet op UTC draait, de borrel weer echt (de zee zet `setGather`, dat sinds de crowd naar de
  zee ging nergens meer werd aangeroepen) en wolken als functie van wereldtijd. Fase 1 (de
  wereldklok en `SEA_TZ`) gebouwd op 23 september 2026.
- [wegen-tekenen.md](wegen-tekenen.md) — tool 6 in de planner: een weg met de hand tekenen, met
  een brug precies zo lang als het gat over de rivier; de oude Build-modus staat voortaan uit
  (Settings → Debug). Gebouwd op 23 september 2026.
- [wie-joint-ziet-de-host-als-mist.md](wie-joint-ziet-de-host-als-mist.md) — waarom een joiner het
  eiland van de host alleen als silhouet ziet, en de keuze om de pagina de wereld te laten
  vertalen in plaats van haar eigen eiland te verplaatsen. Gebouwd en lokaal nagekeken op 21 september 2026.
- [aanvallen-en-blokkeren.md](aanvallen-en-blokkeren.md) — linkermuisknop slaat, rechter blokkeert;
  waarom dat zonder first person kan (pointer-lock), en hoe ver een pagina de Ctrl-sneltoetsen van de
  browser kan tegenhouden (Keyboard Lock, alleen in fullscreen). Gebouwd op 22 september 2026.
- [inventory-scherm.md](inventory-scherm.md) — het avatar-paneel omgebouwd tot een RPG-inventory:
  renders van de echte meshes in de slots, een popover voor keuzes en kleuren, huid en leer als
  flesjes onder het podium. Gebouwd op 22 september 2026.
- [uitrusting-en-vasthouden.md](uitrusting-en-vasthouden.md) — settlers die iets vasthouden en
  een rugzak die uit kan, voor zowel de speler (`classic-avatar.js`) als de instanced settlers
  (`settler-figures.js`). Nog niet gebouwd: eerste stap is de rugzak losmaken van de
  speler-merge, dan hetzelfde patroon als de hoed-buckets voor de settlers.
- [wijkjes-verplaatsen.md](wijkjes-verplaatsen.md) — een planner van bovenaf: hele wijkjes
  (lobes) selecteren en verplaatsen, grond zoneren als niet-bebouwen, en land bijwinnen met een
  handmatige polder. De scanner verhuist nooit iets uit zichzelf; de keeper wel, via één deur
  (`POST /api/plan`), en de scan erna is weer byte-identiek. Bijlage: de gemeten verkenning van
  22 september 2026. Fase 1 t/m 3 gebouwd op 22 september 2026: zones, wijkjes verplaatsen,
  polderen en ont-polderen, land bijverven, en geen reload meer na Apply.
- [eiland-als-desktop-app.md](eiland-als-desktop-app.md) — het eiland als eigen venster (Tauri,
  `npm run app`): waarom de viewer geladen wordt van `localhost:4747` en níet gebundeld met Vite
  (api.js, access.mjs en de import map zouden alle drie breken), en wat de schil wél doet: de
  service starten als die er niet is en hem laten draaien als het venster dichtgaat. Gebouwd op
  22 september 2026.
