# Promptholm.com: een landingspagina

**✅ Status: pagina gebouwd op 29 september 2026 (`site/`); nog niet online - Pages en DNS
moeten nog aangezet worden** (handmatig: Settings → Pages → Source "GitHub Actions" met het custom
domain, en DNS voor promptholm.com).

## Wat Tiemen vroeg

> Maak voor mij een landingpage/website voor promptholm. Maak het licht en zorg ervoor dat je
> de laatste release kan downloaden. Promptholm.com. Gebruik screenshots uit de game en
> presenteer het alsof het geweldig is.

## Besluiten

- **Een map `site/`, statisch, geen build.** Net als het eiland zelf: wat in de map staat is wat
  geserveerd wordt. `index.html`, `style.css`, `main.js` en `img/`. Niets eruit wordt door de
  islander of de release gebruikt, en `scripts/pack-release.mjs` en `Dockerfile.sea` kopiëren
  op naam, dus de map komt nergens in mee.
- **Licht, en alleen licht.** Het palet komt uit het eiland: bleek water als pagina, het
  diepe zeeblauw als inkt, de lagune als accent en één dakpanrood voor de knoppen. De game
  zelf levert de kleur via de screenshots. De titelkaart van de game (donker glas, goud) ligt
  als enige donkere vlak over de hero-afbeelding, omdat dat is hoe het eiland er echt uitziet.
- **Engels.** De game, de README en de handleiding zijn Engels; promptholm.com is voor
  iedereen.
- **Downloaden zonder dat de pagina mee hoeft te bewegen.** De knoppen wijzen naar
  `releases/latest/download/promptholm-windows-x64.zip` en `…/promptholm-android.apk`, die
  GitHub altijd naar de nieuwste release laat wijzen. `main.js` vraagt daarnaast de API om
  versie, datum en grootte, en neemt de exacte asset-URL over als die antwoordt; zonder API
  (offline, rate limit) staat er `v0.6.4` en werken de links gewoon. Een nieuwe tag vraagt dus
  geen wijziging aan de site - alleen de assetnamen moeten blijven zoals `release.yml` ze maakt.
- **Alles wat de pagina belooft staat in de code.** Nagelopen tegen `docs/manual.md` en
  `CLAUDE.md`: de huisstappen (1, 3, 9, 21, 51, 121 beurten), de mijlpalen (5 tot 200 uit
  `MILESTONES`), de pauzes (tien uur, half één, drie uur, vrijdagmiddag). Twee dingen uit de
  README bleken niet meer te kloppen en staan er dus niet in: het eiland is standaard wél op het
  netwerk te bekijken (`network.public: true`, geredigeerd), en "nothing leaves the computer" is
  "your work never leaves the computer" geworden, want wie een zee joint stuurt een
  geredigeerde bundel.
- **Niet gelieerd aan Anthropic** staat in de footer: de pagina noemt Claude op elke regel.

## De screenshots

Nieuw gemaakt van een synthetisch eiland van 175 sessies over elf repo's (zodat de burcht, de
werf en de schepen er staan), plus `walking.png` en `village.png` uit `docs/screenshots/`.
Recept, voor als ze opnieuw moeten:

1. Nep-transcripten in een lege `PROMPTHOLM_CLAUDE_HOME` (`projects/<slug>/<uuid>.jsonl`,
   regels met `type`, `cwd`, `timestamp`, `message.content[].tool_use`, `origin.kind: human`),
   cwd's als `D:\git\<naam>`. Scannen vanuit een map **buiten** een git-checkout: op Linux
   loopt `findRoot` in `lib/repos.mjs` van `D:\git\x` naar `.` en vindt anders de `.git` van de
   checkout, en dan is alles één wijk.
2. `PROMPTHOLM_HOME` naar een eigen map met een `config.json` (`foundedAt` in het verleden,
   `gridSize: 128`), dan `node serve.mjs --no-open`.
3. Playwright met Chromium (`--use-angle=swiftshader --enable-unsafe-swiftshader`), `?nointro&hour=16`
   en `?hour=21`; een route op `js/main.js` die `window.__pv = { camera, controls, state }`
   achteraan plakt, zodat de camera per shot gezet kan worden, en `state.youMarker.update`
   gedempt. UI verbergen met `body > *:not(#stage):not(#panels) { visibility: hidden }`.
   Een frame duurt in software seconden: schermafdrukken met een timeout van minuten.
4. Omzetten naar WebP op 1600 en 800 breed; `og.jpg` 1200 x 630.

**8 oktober 2026: het overzicht opnieuw, op een eiland met ruimte.** Het synthetische eiland was op
128 gesticht en de 175 huizen stonden er schouder aan schouder ("te klein voor de inhoud", Tiemen).
`aerial`, `town`, `night`, `castle`, `hamlet`, `harbour`, `interface` en `og.jpg` komen nu van een
kopie van Tiemens eigen eiland BierRum (288, gegroeid, zeventien wijken ver uit elkaar), zonder
bootjes. De close-ups (`square`, `night-square`, `lighthouse`, `ships`, `signs`, `walking`, `village`)
zijn van het oude eiland gebleven. Recept:

1. `~/.promptholm` kopiëren zonder `*.lock`, `*.log`, `audio/` en `data/sea-token.json`; in de kopie
   `multiplayer.sea` = `{ mode: 'single', url: null, key: null, port: <vrij> }` en `network.public`
   false, dan vanuit een worktree `PROMPTHOLM_HOME=<kopie> node serve.mjs --port <vrij> --no-rescan --no-open`.
2. Chrome headless (`--headless=new --use-angle=d3d11`, venster 1600 x 900) over CDP, `?noclip&nointro&hour=16`
   (`hour=21` voor de nacht, `18` voor de burcht in de avond). `Fetch` plakt achter `js/main.js`
   `window.__state = state; window.__camera = camera; window.__controls = controls;`. Camera met
   `await __noclip.go({x,y,z})` + `await __noclip.lookAt(...)`, `__noclip.hud(false)`; de boten weg met
   `b.craft.object.visible = false` voor elke `__state.boats` en `group.visible = false` op elk record
   `civic:ship*`. Voor `interface` zonder noclip, camera via `__controls`, en `#right-column, #toasts`
   verborgen: daar staan de echte sessietitels van de keeper.
3. Poses (lokale coördinaten): overzicht van (0,140,150) naar (0,0,-15); stad en nacht van (-4,21,40) naar
   (-10,0,-6), zodat de Salty Kraken niet achter de titelkaart valt; burcht (-18,12,32) naar (-6,2,-40);
   gehucht (-28,26,-28) naar (-4,0,-60); haven (18,32,-78) naar (0,0,-112).
4. WebP met Chrome's eigen encoder (`canvas.toDataURL('image/webp', 0.62)` op 1600, 0.7 op 800,
   JPEG 0.72 voor `og.jpg`).

## Online zetten (nog te doen)

- `.github/workflows/site.yml` publiceert `site/` bij een push naar main die `site/` raakt.
- Eenmalig: Settings → Pages → Source "GitHub Actions", custom domain `promptholm.com`.
- DNS van promptholm.com naar GitHub Pages (A-records op de apex, of ALIAS/ANAME).
