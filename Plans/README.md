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

- [kroegbaas-en-burgemeester.md](kroegbaas-en-burgemeester.md) — de bewaarders van een gebouw:
  kroegbaas, burgemeester, goudklerk, schooldirecteur en pastoor, onder het id van hun gebouw en
  gelopen door de zee (`KEEPERS` in `shared/palette.mjs`). Gebouwd op 25 september 2026.
- [groot-kasteel.md](groot-kasteel.md) — het kasteel op twee bij twee super-cellen: een kavel van
  7 bij 7 en het model 7/3 zo groot. Een nieuw kasteel neemt het dichtstbijzijnde vrije, vlakke
  blok van de stad; een bestaand kasteel groeit op zijn plek met de voorkant waar hij was, of
  blijft zoals het was. Gebouwd en op het eiland toegepast op 25 september 2026.
- [goudkuil.md](goudkuil.md) — een sleufsilo met honderd goudstaven naast het plein: het
  5-uurs usage limit, één staaf per procent, dat slinkt terwijl je werkt. Het getal komt uit
  de statusLine van Claude Code (de enige plek waar het staat) en verlaat de machine niet;
  settlers die aan het werk gaan halen eerst een staaf en dragen die naar huis, en die ronde
  overleeft het herbouwen van de crowd. Gebouwd op 24 september 2026.
- [huis-naar-eigen-wijkje.md](huis-naar-eigen-wijkje.md) — de planner-op `rehome`: één huis naar
  een wijkje met een eigen naam (Lovely Meteor → Crypto), bewaard in `layout.rehomed` naast het plot.
  Gebouwd en op het eiland toegepast op 23 september 2026.
- [inwoners-aan-het-werk.md](inwoners-aan-het-werk.md) — ledige inwoners schoffelen op de akkers,
  wieden in de moestuin, hakken en sprokkelen hout en vissen; waarom de pagina de werkplekken meldt
  (zoals de huisposities) en de zee alleen de visplekken zelf uitrekent. Gebouwd op 23 september 2026.
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
