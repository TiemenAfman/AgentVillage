# 🚧 Minder browser, meer spel

De keeper: "het spel voelt nog te veel als een browser. De UI moet logisch worden en niet zo hakkelig."
Drie delen: (1) browsergedrag uit, (2) één UI-model per modus, (3) de haperingen.

## 1. Browsergedrag — stand van zaken

Al gedaan vóór dit plan (gemeten in de bron en in de preview):

- **Tekstselectie** uit op `body`, aan in velden (`ui.css`, `user-select`).
- **Contextmenu** uit buiten velden (`page-keys.js`, en op het canvas in `main.js`).
- **ctrl+A** paginabreed uit; op voet alle ctrl+letter/cijfer (`walk.js BROWSER_KEYS`) + Keyboard Lock in fullscreen.
- **F5 en Alt+F4** vragen eerst in het desktopvenster (`desktop.js`).

Gebouwd in deze ronde (`page-keys.js`, `ui.css`, `index.html`, `src-tauri/src/lib.rs`, `tests/browser-isms.test.mjs`):

- **Zoom uit**: ctrl+wheel (ook touchpad-pinch), ctrl `+ - = 0`, pinch op touch (`touch-action: pan-x pan-y`
  op `html`, viewport `user-scalable=no`). Lijsten scrollen nog met een vinger.
- **Browsersneltoetsen uit in elke modus**, buiten velden: ctrl+F/G/P/S/U/O/H/J/D/E/L/K, F3, F7 (caret browsing),
  Alt los (Chrome zet daarmee de focus op zijn menu). Bewust gelaten: F5 (desktop.js vraagt), F11 (fullscreen
  wil je), F12 (devtools), ctrl+W/T/N (niet te onderscheppen buiten fullscreen).
- **Afbeelding/icoon slepen** uit (`dragstart`, `-webkit-user-drag`), **overscroll/bounce** uit, **tap-highlight** uit.
- **Witte flits splash → eiland** in `promptholm.exe`: WebView2 schildert wit tussen twee documenten; het venster
  krijgt nu `background_color(#0d1420)`, en `index.html` zet die kleur inline vóór de CSS laadt.
  Gecontroleerd met `cargo check`; nog niet in een gebouwde exe bekeken (`npm run app:build`).

Uitzonderingen die blijven: velden (input/textarea/select/contenteditable) houden selectie, contextmenu,
plakken en ctrl+F enz. Chat, Settings en de borden van de keeper zijn velden of bevatten ze.

Open (smaak keeper):

- ✅ **Eigen tooltip** (`web/js/tooltip.js`): elke `title` blijft staan in markup en code; bij hover verhuist de tekst
  naar `data-tip` vóór de browser zijn grijze vak toont, en na 450 ms komt onze tip (donker, gouden rand, een
  `(Enter)` aan het eind als toetskapje). Alleen muis, niet onder pointer lock, weg bij elke klik/toets/wheel.
- **Cursor**: knoppen tonen de handcursor; voorstel: overal de pijl, of een eigen cursor. ❓
- **Focusringen** na een muisklik: alleen `:focus-visible` tonen is nu al grotendeels zo; nalopen per paneel.

## 2. Eén UI-model per modus

Gemeten op een kopie van Hoogezand (441 bewoners), worktree-`serve.mjs` met `PROMPTHOLM_HOME` op de kopie,
Chrome DevTools-venster voorop, 3440x1249. Toetsen met echte bubbling vanaf `body`. De kolommen kamer en noclip zijn uit de code afgeleid, niet geteld.

| | lucht | te voet | kamer | planner | noclip |
|---|---|---|---|---|---|
| titelkaart, chips, klok, ☰ | ja | ja | ja | ja | (hud) |
| "vraag voor jou" / "nu bouwen" | ja | nee | nee | nee | – |
| tijdlijn (chronicle), Live | ja | nee | nee | nee | – |
| walk-prompt, buidel | nee | ja | ja | nee | – |
| plan-tools, ledger, plan-hud | nee | nee | nee | ja | – |
| install- en fullscreen-knop | ja | ja | ja | ja | ja |

Escape, zoals gemeten:
- **lucht**: sluit eerst wat open is (zijpaneel, kaart, inventaris), met niets open opent het het menu; nog eens = dicht. Klopt.
- **te voet**: muis los, dan omhoog naar de lucht (zonder pointer lock meteen omhoog). Klopt met CLAUDE.md.
- **kamer**: opent het menu met de kamer gepauzeerd; weg via de deur. Klopt.
- **planner**: stapt terug door zijn niveaus, dan naar de lucht.

Gevonden en **gerepareerd**:
- Met het menu open stapelden **M (kaart)**, een **chip** (Quests, Animals) en **P (planner)** zich *onder/boven*
  het menu: twee lagen tegelijk op het scherm. Nu: het menu is een pauze, de letters uit de lucht doen niets
  zolang het openstaat, en een geklikte chip laat het menu eerst wijken (`main.js`, `nav-chips`-capture).

Nog open:
- **Tab** door de HUD + camera naar de lucht: aparte sessie ("Repareer Tab").
- ✅ De ronde knoppen rechtsonder (installeren, volledig scherm) zijn weg: installeren is er niet meer (geen PWA) en
  volledig scherm is Settings → Display of Alt+Enter.
- ✅ **Chips per modus** (`body[data-mode]`, gezet in ui.js `syncSidebar`, regels onderaan ui.css): lucht alles;
  te voet (en in een kamer) Fly up, Say, Map, Inventory, Quests + klok en ☰, en de eilandkaart linksboven weg;
  planner alleen Done (geen inklap-pijl, geen eilandkaart, de Plan-tools schuiven naar boven). De toetsen blijven
  werken waar ze iets betekenen.
- ✅ **Fades**: zijpanelen schoven al in; nu faden ook het menu, de dialoogkaarten en popovers in, en de kaart en de
  inventaris komen 8 px omhoog (160-200 ms, alleen opacity/transform). Sluiten blijft direct. `prefers-reduced-motion` zet het uit.
- ✅ **Volledig scherm** (`web/js/display.js`): Settings → This screen → *Display* (Windowed / Borderless fullscreen),
  de knop rechtsonder en **Alt+Enter** (in het venster ook F11). In `promptholm.exe` gaat het venster zelf randloos over
  het scherm (`promptholm://fullscreen/on|off` → `set_fullscreen`, dezelfde deur als de bevestigde close) en onthoudt het
  dat voor de volgende start; in een tab is het de Fullscreen API.
- ✅ **Geen PWA meer**: spelen is de exe, de APK of `/play`. Manifest, `sw.js` en de installeerknop zijn weg; een
  eerder geregistreerde worker meldt de pagina zelf af (`unregisterWorkers`).

## 3. Haperingen (gemeten)

Basis: 20 ms per frame (50 fps), p95 20 ms, in de lucht en te voet. Gemeten met frame-tijden uit `requestAnimationFrame`
en `long-animation-frame` (welke script). Volgorde = baten/kosten.

| actie | langste frame | oorzaak | status |
|---|---|---|---|
| **eerste keer een kamer in** (Salty Kraken) | 1748 ms + 565 + 896 | lazy set parsen (`models.js` 1245 ms, `piratetavern_room-mesh.js` 474), daarna bouwen + shaders | **gerepareerd**: de sets worden in een worker geparsed (`lazy-set-worker.js`, typed arrays overgedragen), vanaf de start van de boot; de kamer wordt gebouwd en `renderer.compile`d achter het laadscherm (`warmRooms`, ~0,8 s extra laadtijd, max 3 s wachten). Nu één frame van ~250 ms: het HD-pakket dat bij binnenkomst een GLB laadt |
| **daarna terug naar het eiland** | 391 / 480 / 629 ms | shaders opnieuw gecompileerd na de eerste kamer | **weg** (max 60 ms) sinds de kamer vooraf gecompileerd wordt; de lampen hoefden niet gelijk |
| tweede keer kamer in | 39 ms | – | goed |
| **kaart openen (M)** | 155–167 ms, elke keer | `resize()` gooide bij elke opening de grondkaart weg (~150 ms hoogtes opzoeken) | **gerepareerd**: alleen bij een echte maatwijziging; nu alleen de eerste opening (221 ms), daarna 0 |
| inventaris openen | 119–124 ms, elke keer | twee nieuwe WebGL-contexten per bezoek (studio.js, bewust: contexten worden teruggegeven) + 70 ms in een setTimeout | open: één context houden voor de hele sessie en hergebruiken (blijft binnen het maximum van ~16) |
| planner in | 47–90 ms (één frame) | eerste render van de orthocamera, overlay opbouwen | klein; laten |
| lopen in | 120 ms (één frame, eerste keer) | avatar/walk-mode opbouwen | klein; laten |
| menu, quests, dieren | ≤ 50 ms | – | goed |

Niet gemeten in deze ronde (de kopie draait `--no-rescan` en zonder buren): een scan/republish die binnenkomt,
een gast-eiland dat gebouwd wordt, de regisseur en de gold run. Volgende stap: een tweede islander op de lokale
zee, en `/api/reload`-achtige rescan op de kopie.
