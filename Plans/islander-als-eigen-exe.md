# De islander als eigen exe, het venster als interface

## Waarom

De Tauri-app deed twee dingen tegelijk: het eiland tonen, en `node serve.mjs` starten als de
poort stil was. Dat tweede was onzichtbaar - geen icoon, geen manier om het eiland te stoppen
of te herstarten behalve `stop-island.cmd` - en het hing ook nog: `start()` wachtte met
`output()` op de go-between, en node erfde diens stdout/stderr-pipes, dus de splash bleef op
"Starting the island" staan tot node stopte (gemeten, gefixt in `island.rs`).

## Besluit

Twee exe's uit dezelfde crate (`src-tauri`), één build:

| exe | rol |
|---|---|
| `promptholm-island.exe` | **de islander**: start `node serve.mjs --supervised`, tray-icoon, geen venster, geen WebView |
| `promptholm.exe` | **de interface**: WebView2 op `http://localhost:<port>/`, verder niets |

- De islander-exe *is* de islander: zijn leven is dat van node. Hij houdt node's stdin open;
  `--supervised` laat `serve.mjs` netjes `shutdown()` doen als die pipe dichtgaat. Stop via de
  tray = pipe dicht (en na een paar seconden alsnog een kill), en een gekilde islander-exe
  laat geen verweesde node achter.
- De zee zit in node (`createSea`, alleen bij `single`/`host`; bij `join` gaat hij dicht) en
  komt dus vanzelf mee. Geen apart proces.
- Tray-menu: *Open Promptholm* (start het venster), *Open in browser*, *Herstart*, *Stop /
  Start*, *Open log*, *Afsluiten* (stopt het eiland en de tray).
- Eén islander per poort (named mutex). Luistert er al iets op de poort dat niet van ons is
  (een handmatige `node serve.mjs`), dan neemt de tray het over: tonen kan, *Stop* killt de
  pid op de poort zoals `stop-island.cmd` dat doet.
- Het venster start bij een stille poort `promptholm-island.exe` (via de bestaande go-between,
  zodat een tree-kill van het venster het eiland niet raakt), en valt terug op node zelf als
  die exe er niet naast staat.
- Geen van beide exe's heeft een console, ook in debug.

## Opgeruimd

De start/stop-scripts (`start-island*.cmd`, `start-island-hidden.vbs`, `stop-island.cmd`),
`Installers/` (Rust-installatie-notities, nu een regel in de README) en alle Tauri-iconen
behalve `icons/icon.ico` zijn weg. Er stond op deze machine geen scheduled task meer; opstarten
bij inloggen is een snelkoppeling naar `promptholm-island.exe` in `shell:startup`.

## Geen installer

`npm run app:build` is `tauri build --no-bundle` en NSIS staat uit (`bundle.active: false`):
een geïnstalleerde kopie in Program Files vindt de checkout niet zonder `PROMPTHOLM_ROOT`, en
`serve.mjs` en `data/` stáán in de checkout. De twee exe's in `target/release/` vinden hem
vanzelf (`CARGO_MANIFEST_DIR`). `npm run app` bouwt eerst de islander, omdat `tauri dev`
alleen de bin draait die het start en het venster anders naar node zonder tray terugvalt.

## Releases

`.github/workflows/release.yml`: een tag `v*` bouwt beide exe's op `windows-latest` en hangt
`promptholm-windows-x64.zip` (+ `.sha256`) aan een GitHub-release, zodat wie de repo heeft
geen Rust nodig heeft. Alleen de exe's, geen broncode: ze draaien de checkout waarin ze
uitgepakt worden (`<checkout>in\`, gitignored) en vinden die door omhoog te lopen. De tag
moet gelijk zijn aan `version` in `src-tauri/tauri.conf.json`. Niet gesigneerd, dus
SmartScreen vraagt de eerste keer.

## Een release is een map, geen checkout (0.1.1)

v0.1.0 bleek alleen te werken als je de zip in een checkout uitpakte: op het bureaublad
vond de viewer niets om te starten. Nu is de zip de hele app: beide exe's naast elkaar en
het eiland in `app\` ernaast (`scripts/pack-release.mjs`, lijst op naam zoals
`Dockerfile.sea`). Alleen Node moet op de machine staan; ontbreekt die, dan zegt de
islander dat in een melding.

- **Waar de eigen bestanden staan.** `app\release.json` markeert een release; dan staan
  `config.json`, `data\` en `.env` in `%LOCALAPPDATA%\Promptholm` (`HOME` in
  `lib/paths.mjs`, `home()` in `island.rs`), zodat een nieuwe versie eroverheen uitpakken of
  de map verplaatsen het eiland niet opnieuw sticht. Een checkout houdt ze bij zich.
- **Eerste start** = `setup.mjs --first-run`: config stichten en de hook zetten, maar een
  bestaande Promptholm-hook laten staan (die kan van een checkout op dezelfde machine zijn).
- **`checkout.txt`** in `%LOCALAPPDATA%\Promptholm`: de islander noteert waar hij draaide,
  zodat een losse exe elders het eiland nog vindt. En een viewer zonder iets om te starten
  wacht 8 s op de poort voor hij opgeeft - een herstart duurt ~1 s.
