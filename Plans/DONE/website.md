# agentsofthesea.com: een landingspagina

**✅ Status: pagina gebouwd op 29 september 2026 (`site/`), live op https://agentsofthesea.com.**
Het domein promptholm.com is er nooit gekomen; de site wordt buiten deze repo om uitgerold
(zie "Online" onderaan).

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
- **Engels.** De game, de README en de handleiding zijn Engels; de site is voor
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

## Online

- De site staat op **https://agentsofthesea.com** (nginx bij mijndomein.nl). Iets buiten deze
  repo zet hem daar neer: een push naar `main` op GitHub stond op 8 oktober 2026 binnen twee
  minuten live. Wat dat precies is, staat niet in de repo.
- De GitHub Pages-workflow (`.github/workflows/site.yml`) en `site/CNAME` zijn op 8 oktober
  2026 weggehaald: Pages stond nooit aan op de repo, elke run faalde sinds 29 september, en
  promptholm.com bestaat niet.
