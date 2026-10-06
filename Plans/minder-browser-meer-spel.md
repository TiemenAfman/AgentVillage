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

- **`title`-tooltips** (29 in `index.html`, meer in JS): het grijze systeemvakje is het meest "browser"-ding dat
  overblijft. Voorstel: één eigen tooltip in de huisstijl (`data-tip`, zelfde vertraging), `title` weg. ❓
- **Cursor**: knoppen tonen de handcursor; voorstel: overal de pijl, of een eigen cursor. ❓
- **Focusringen** na een muisklik: alleen `:focus-visible` tonen is nu al grotendeels zo; nalopen per paneel.

## 2. Eén UI-model per modus — nog te doen

Modi: lucht (orbit), te voet, kamer, planner, noclip, telefoon/web. Bekend en elders opgepakt: **Tab** loopt door
de HUD en daarna springt de camera naar de lucht (aparte sessie, "Repareer Tab").

Nog te inventariseren en te meten: welke chips/panelen per modus zichtbaar zijn, wat Escape per modus doet,
panelen die openblijven bij een moduswissel, panelen die in een modus te openen zijn waar ze geen zin hebben.
Voorgestelde regel (❓ keeper): Escape sluit altijd eerst het bovenste paneel, dan de muis los, dan het menu;
een moduswissel sluit alle panelen behalve chat.

## 3. Haperingen — nog te meten

Te meten met de Chrome DevTools-trace (venster voorop, zie CLAUDE.md) en `?stats` op een kopie van het echte eiland:
paneel openen, walk in/uit, kamer in/uit, planner, een scan/republish, een gast-eiland dat gebouwd wordt, de
regisseur, de gold run. Per hapering oorzaak + fix, geordend op kosten/baten. Niet gedaan in deze ronde.
