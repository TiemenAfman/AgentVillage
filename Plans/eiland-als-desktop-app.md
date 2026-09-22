# Het eiland als eigen venster: een Tauri-app naast de service

## Aanleiding

Het eiland draait als service (`serve.mjs`, gestart door de scheduled task) en wordt bekeken
in een browser — `start-island-app.cmd` opent daarvoor een Chrome-venster in `--app`-modus,
zodat het eruitziet als een programma in plaats van een tabblad. Martijn wil een echte
desktop-app: een eigen venster, eigen icoon in de taakbalk, te starten zonder dat Chrome er
tussen zit. Er lagen twee aanzetten: `AgentVillage_APP/` (het kale `create-tauri-app`-
sjabloon met een "greet"-formulier, losse `package.json`) en `src-tauri/` in de repo-root met
een `vite.config.js` die `web/` als Vite-root bundelt naar `dist/`.

## De ene vraag: bundelen of laden?

Tauri kan de viewer op twee manieren in zijn venster krijgen, en de keuze bepaalt alles.

**Bundelen** (wat het sjabloon doet): Vite bouwt `web/` naar `dist/`, Tauri serveert dat op
`http://tauri.localhost` en de pagina praat met de islander op `localhost:4747`. Dat breekt op
vier plekken tegelijk, en drie ervan zijn invarianten uit `CLAUDE.md`:

- `web/js/api.js` bepaalt `mine()` uit `import.meta.url`; gebundeld wordt dat
  `http://tauri.localhost/…` en elke call naar het eiland gaat naar de verkeerde machine.
- `lib/access.mjs` eist Host én Origin van dezelfde machine. Een `Origin: http://tauri.localhost`
  op een `Host: localhost:4747` is precies de aanval die het afweert — en `classify()` loopt
  voor élke route, dus ook een GET krijgt een 403.
- "No build step" en "nothing is fetched at boot": een import map voor `three` en `shared/`
  is het contract; Vite vervangt dat door een bundle die bij elke wijziging opnieuw gebouwd
  moet worden, terwijl `/api/reload` juist open pagina's `web/js/` laat herladen.
- De viewer wordt een kopie die bevriest op het moment van bouwen, terwijl de service ernaast
  doorgroeit.

**Laden**: het venster is een WebView2 die `http://localhost:4747/` opent — hetzelfde wat het
Chrome-venster doet. Nul wijzigingen in `web/`, alle invarianten blijven zoals ze zijn, de
app is een schil van een paar honderd regels Rust. Het enige wat de app toevoegt boven Chrome
is wat een schil hoort te doen: **zorgen dat de service er is** voordat het venster hem opent.

Besluit: **laden.** De Vite-route en het tweede sjabloon gaan weg.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Waar staat de app? | `src-tauri/` in de repo-root; `npm run app` / `npm run app:build` in de bestaande `package.json`. `AgentVillage_APP/` en `vite.config.js` verwijderd. | Eén `package.json`, één `node_modules`, de `@tauri-apps/cli` stond er al. Het scaffold had bovendien een tweede `dev`-script (`vite`) over `node serve.mjs --open` heen geschreven — `npm run dev` deed niet meer wat de docs zeggen. |
| Wat laadt het venster? | Eerst een eigen splash (`src-tauri/splash/index.html`, "het eiland wordt gezocht/gestart"); zodra de poort antwoordt `navigate()` naar `http://localhost:<poort>/`. | Een WebView2 op een dichte poort is een wit vlak met een Edge-foutpagina. De splash is het enige stukje UI dat de app zelf heeft. |
| Wie start de service? | De app, als er niets luistert: `node serve.mjs --no-open` in de repo-root, zonder console (`CREATE_NO_WINDOW`), uitvoer achter `data/server.log` — precies wat `start-island-hidden.vbs` doet. | Zelfde spelregels als de scheduled task, zodat een crash op dezelfde plek een spoor laat. |
| Stopt de app de service bij sluiten? | **Nee.** Een service die de app zelf startte blijft draaien, net als na `start-island-app.cmd`. Ook bij een *tree-kill* van het venster (`taskkill /T`, "End process tree", de terminal van `npm run app` sluiten): de app start node via een tweede kopie van zijn eigen exe (`--spawn-island`) die meteen weer stopt, zodat node's parent al dood is voordat iemand de boom afloopt. | De islander is de lange helft: scan, sea, mail, agents. Het venster is er alleen om te kijken. Stoppen blijft `stop-island.cmd`. Dezelfde truc als `start-island-hidden.vbs` met wscript. |
| Nooit meer dan één islander? | De app start er alleen één als de poort stil is, en `serve.mjs` stopt zelf op `EADDRINUSE`. Binnen één venster houdt een `busy`-vlag een tweede "Try again" tegen zolang de eerste nog wacht. | Twee starters die tegelijk beginnen laten zo alsnog één islander over; de verliezer heeft nog niets gescand of geschreven, want dat gebeurt pas ná `listen`. |
| Hoe vindt de app de repo? | `SETTLERS_ROOT` → de map boven `CARGO_MANIFEST_DIR` (ingebakken bij het bouwen) → omhoog vanaf de exe, zoekend naar `serve.mjs`. Geen van drie → alleen verbinden, nooit starten; de splash zegt dat. | Dev en een build op deze machine werken zonder configuratie; een losse exe op een andere machine krijgt een duidelijke zin in plaats van een spinner. |
| Welke poort? | `--port` → `PORT` → `config.json:port` → 4747, in díe volgorde. `--url` verbindt met een eiland elders en start niets. | Dezelfde volgorde als `serve.mjs`, anders kijkt de app naar een andere poort dan waar de service op luistert. |
| Externe links (Jira, GitHub, Remote)? | `on_new_window` → systeembrowser, venster geweigerd; `on_navigation` staat alleen `localhost`/`127.0.0.1`/`::1` en de splash toe, alles anders gaat naar de systeembrowser. | Zonder dit navigeert een `<a href>` het hele venster naar Jira zonder terug-knop, en `window.open` doet niets. |
| GPU | `--force-high-performance-gpu` in `additional_browser_args`, náást Tauri's eigen `--disable-features=…` (die vlag vervangt de default, dus die moet mee). | Dezelfde reden als in `start-island-app.cmd`: op de laptop met twee kaarten kiest Chromium de zuinige, en die is hier de kaart waarvan de driver omvalt. |
| Icoon | `cargo tauri icon web/icons/island-512.png` — het eilandje dat de PWA al heeft. | Eén bron voor het icoon. |
| Fullscreen / Keyboard Lock | Niet in deze stap. `requestFullscreen` vult in WebView2 de webview, niet het venster (wry luistert niet naar `ContainsFullScreenElementChanged`). | Een bruggetje (init-script + `remote`-capability + `setFullscreen`) is klein maar apart te bekijken; eerst het venster zelf. |

## Bestanden

- `src-tauri/src/lib.rs` — het venster (`WebviewWindowBuilder`, extern URL na de splash), de
  twee commands `retry` en `open_log`, de navigatie- en new-window-handlers.
- `src-tauri/src/island.rs` — `plan()` (poort, URL, repo-root), `listening()`, `start()`,
  `wait()`: alles wat over de service gaat, zonder Tauri erin.
- `src-tauri/splash/index.html` — de wachtpagina; luistert naar `island:status` en
  `island:failed`.
- `src-tauri/tauri.conf.json` — `frontendDist: "splash"`, geen `devUrl`, geen vensters in de
  config (die worden in Rust gebouwd omdat `additional_browser_args` en `on_new_window`
  alleen daar bestaan), bundle-target `nsis`.
- `package.json` — `app`, `app:build`; `vite` eruit, `dev` weer `node serve.mjs --open`.
- `Installers/rust_cargo_tauri/INSTRUCTIONS.txt` — stap 3/4 verwijzen naar de repo-root.

## Verificatie

`cargo tauri dev` met het eiland uit: splash → "Starting the island from D:\…" → binnen een
paar seconden het eiland in het venster; `netstat` laat `node` op 4747 zien en
`data/server.log` de start. Venster sluiten: `node` blijft luisteren. App opnieuw: splash
staat er hooguit een tel, geen tweede `node`. Een Jira-link op het prikbord opent de
systeembrowser en het venster blijft op het eiland. `npm run dev` start weer de server.

Gemeten op 22 september 2026 met de debug-exe: poort 4747 antwoordde 2 s na het starten,
`node` draaide als `serve.mjs --no-open --port 4747` zonder consolevenster met de app als
parent, het eiland tekende op de RTX 4090 (`page: island drawing on: … NVIDIA …` in de log).
App gesloten → `node` bleef luisteren; app opnieuw gestart → één `serve.mjs`-proces, eiland
direct in beeld. De externe-link-route is nog niet met de hand aangeklikt.

Valkuil onderweg: `cargo build` viel om op een pad onder het verwijderde `AgentVillage_APP/`
— de build-script-uitvoer van `tauri` stond nog in de cache met dat absolute pad.
`cargo clean -p tauri -p tauri-build -p agentvillage` (geen volledige clean, de target-map is
3 GB) en opnieuw bouwen loste het op.
