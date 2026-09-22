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
