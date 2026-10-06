# 🚧 Spelen in de browser

Plan van 2 oktober 2026. Doel: een versie die iedereen kan spelen zonder app en zonder installatie,
gewoon een link. Gehost op de **thuisserver van de keeper** (Portainer, endpoint 3, git-stack + push-webhook,
naar buiten via Nginx Proxy Manager). Niet op Tiemens Plesk-host (seaofagents.nl, de echte website) en niet
op GitHub Pages - besloten.

## Wat het is

De telefoon-app is al precies "een pagina zonder islander": `scripts/pack-android.mjs` kopieert `web/` en
`shared/` en schrijft `window.PROMPTHOLM_STANDALONE = { sea, build }` in de kop; `STANDALONE` in `api.js`
laat `mine()` weigeren zonder te vragen; de speler is een zwerver met een sloep op een vrije ligplaats open
water. De webversie is diezelfde pagina, met drie verschillen:

1. **Geen telefoon.** `STANDALONE` betekende tot nu toe ook: touch-bediening, `body.standalone`-CSS voor
   duimen, de `phone`-graphicstier en de phone prefs. Op het web zit iemand net zo goed aan een toetsenbord
   met muis, een controller of een tablet (met of zonder toetsenbord).
2. **Een server die vervangen wordt terwijl er tabs open staan.** Een deploy mag nooit oude en nieuwe
   modules in één browsercache mengen.
3. **Bijwerken is herladen**, niet een APK installeren.

## Besluiten

### Drie betekenissen, drie namen (`web/js/device.js`)

- `STANDALONE` (api.js) blijft: **geen islander**. Alles wat daar nu aan hangt omdat er geen eiland is
  (geen planner, geen noclip, geen kamers onthouden, geen lucht om naartoe te gaan, de sloep, `namedIslands`,
  de knop terug) blijft erop hangen - voor app én web.
- `APP`: de Android-app (`STANDALONE` zonder `host: 'web'`; een APK van vóór dit draagt geen `host`, dus
  ontbreken = app). Alleen wat écht de app is: de Rust-commando's (`latest_release`, `install_update`), de
  update-*gate* en de APK-links.
- `HANDHELD`: een apparaat dat zich als telefoon/tablet gedraagt - de app, of een browser met
  `(pointer: coarse)` en zonder `(any-hover: hover)`. Dit bepaalt de graphicstier `phone`, de lichte
  pixelratio, `DETAILED` 1, schaduwen 512, het zeeleven en `IMP_LIMIT`: **de tier komt van de machine**,
  niet van "staat los". Een laptop in een browser gaat dus gewoon langs `MODEST_GPU` zoals op een eiland.
  De phone prefs (`quality: 'light'`) gelden voor elk handheld-apparaat.

### Touch naast toetsen en controller

- De touch-laag (`touchpad.js`) wordt voor elke `STANDALONE`-pagina gemaakt, maar alleen **getoond** in
  invoermodus `touch`. `body.touch` draagt alles wat voor duimen is (de cluster, toasts weg uit de hoek van
  de stick, grotere chips en kruisjes, tikbare toespraak, de skew-balk hoger, geen toetsletters op chips);
  `body.standalone` houdt wat over "geen eiland" gaat (geen walk/plan/build-knoppen, geen kroniek).
- De modus (`nextInputMode`, puur en getest): begint op `touch` voor een handheld-apparaat, anders `desk`;
  een aanraking (`pointerType` touch/pen) zet hem op `touch`, een toets, een echte muisbeweging
  (`pointerType: 'mouse'`) of een controllerknop/-stick zet hem op `desk`. Een tablet met toetsenbord doet
  dus beide, en wisselt mee. Verborgen geeft de laag `null` uit `poll()` en laat hij wat ingedrukt was los,
  zodat een duim die van het glas naar het toetsenbord gaat niet blijft lopen.
- **De app blijft precies zoals hij is**: altijd `touch`, nooit wisselen, en `body.standalone body.touch`
  samen geven dezelfde regels als voorheen `body.standalone` alleen.
- Settings → Controls toont op het web beide: de toetsentabel (`controlsSection`) en de touch-knop.

### Inpakken: `scripts/pack-web.mjs`

- Uitvoer: `dist/play/<id>/` met `<id>` = `<versie>-<commit7>` (zonder commit alleen de versie), plus
  `dist/play/version.json` (`{ version, commit, path }`) en `dist/play/index.html`, een kleine
  doorverwijzing naar `./<id>/` die query en hash meeneemt (`?stats`, `?dive` blijven werken).
- Een eigen id per build en niet alleen de versie: twee builds van dezelfde versie (een fix op de branch)
  zijn verschillende modules, en een cache die ze onder één pad kende zou ze mengen.
- In de kop: `PROMPTHOLM_STANDALONE = { sea, build, host: 'web', shelf: '<id>' }`. Geen sleutel, net als de
  APK - een pagina op internet is openbaar.
- Zelfde weglatingen als de APK: de kamersets (`krakenkit`, `piratetavern_room`, 47 MB) - wie geen eiland
  heeft, heeft geen kamers. Lazy blijven ze toch; meesturen zou alleen schijf kosten. De rest is identiek aan
  wat de app draagt.
- ~~`manifest.webmanifest` met `start_url`/`scope` = `../`~~ - geen PWA meer sinds
  [minder-browser-meer-spel.md](minder-browser-meer-spel.md): spelen is de exe, de APK of `/play`.
- Alles boven 1 kB wordt **vooraf gezipt** (`.gz` ernaast, zlib niveau 9): nginx levert die met
  `gzip_static` zonder CPU op de thuisserver. Brotli zit niet in de officiële `nginx:alpine`; de winst
  (~15% extra op tekst) is een eigen image niet waard. Kan later.
- Het script importeert `lib/paths.mjs` **niet**: dat verhuist een eiland bij import (`settleHome`) en het
  draait ook in een Docker-buildstage. `OPEN_SEA` staat er daarom een tweede keer in, en een test houdt de
  twee gelijk.
- De gemeenschappelijke stappen (kopiëren minus kamersets, het script in de kop) staan in
  `scripts/pack-page.mjs`, die `pack-android.mjs` ook gebruikt - met byte voor byte dezelfde uitvoer.

### Bijwerken

- De pagina kent zijn eigen build (ingebakken) en zijn eigen `shelf`. Hij vraagt `../version.json`
  (`playUrl()` in api.js: het schap waar de pagina vanaf kwam, ook achter een subpad) bij de boot, bij elke
  welcome en elke tien minuten, `cache: 'no-store'`.
- `webNotice` (update.js, puur): staat er een andere `path` op het schap en is die versie niet ouder, dan een
  banner **"Er staat een nieuwere Promptholm klaar" met een knop Reload** (`data-update-reload`), die naar
  `../` + de eigen query gaat. Anders wat de sea zegt: een nieuwere lijn op de sea = "deze pagina wordt zo
  bijgewerkt, herlaad straks" (de sea kan vóór de webdeploy zijn); een sea die achterloopt = de bekende
  tekst. Een weigering over het protocol: nieuwer op de sea = herladen als er al iets nieuwers staat, anders
  "even geduld"; ouder = de bekende tekst.
- Geen Rust: `latest_release` en `install_update` worden alleen in de app aangeroepen (`APP`), en de gate
  (`updateGate`, APK-links) ook.
- Oude tabs blijven werken: het vorige schap blijft op de server staan (hieronder), dus een open tab die nog
  een lazy module van zijn eigen versie vraagt (de imp, een GLB), krijgt die.

### De sea

Niets te doen aan de sea zelf: `/health`, `/world` en elke JSON-route antwoorden al met
`Access-Control-Allow-Origin: *` (nooit credentials), `OPTIONS` ook, en de websocket controleert geen Origin
(`isAllowed` is standaard waar) - de app op `tauri.localhost` verbindt al zo. Een pagina op https mag wss
naar een andere host. Aan de islander-kant verandert niets: de webpagina heeft er geen.

Wél een grens om te weten: `maxPlayers` is 32 per sea (`lib/sea.mjs`, daarboven `refused: full`) en elke
webspeler is een socket. Bij een stormloop moet dat omhoog (een `SEA_MAX_PLAYERS` erbij, later).

### Hosting: een nginx-schap op de thuisserver

- `Dockerfile.play`: stage 1 `node:22-alpine` installeert alleen `three` (`npm install --no-save
  --ignore-scripts three@<versie uit package.json>`, niet de Tauri-CLI), vendort, en draait
  `node scripts/pack-web.mjs --sea $PLAY_SEA`; stage 2 `nginx:alpine` met `deploy/play/nginx.conf` en een
  startscript `deploy/play/shelf.sh` in `/docker-entrypoint.d/`.
- **Het schap is een volume** (`play-shelf`): bij elke start zet `shelf.sh` het schap uit het image erop,
  schrijft `version.json` en de doorverwijzing pas daarna (eerst de bestanden, dan de wijzer), en ruimt op
  tot de nieuwste **drie** schappen. Zo overleeft het vorige schap een redeploy, en een tab die gisteren
  opende vindt zijn modules nog.
- nginx: `gzip_static on` + `gzip on` voor wat er niet vooraf gezipt is; `Cache-Control: public,
  max-age=31536000, immutable` onder `/play/<id>/`; `no-cache` op `/play/`, `/play/index.html` en
  `/play/version.json`; `/` verwijst naar `/play/`. `application/javascript` voor `.js` en `.mjs`.
- `docker-compose.play.yml`: `pull_policy: build` (zelfbouwend, net als de sea - anders breekt de webhook op
  "pull access denied"), poort 4760 voor het LAN, `PLAY_SEA` als build-arg uit de stack-environment.
- **Welke ref**: de stack volgt de branch **`play`**, en `release.yml` zet die bij elke gepubliceerde
  release op de tag (job `play`, `git push --force origin <sha>:refs/heads/play`). Zo krijgt het web
  releases en niet elke commit op `main`, en de conventie (git-stack + push-webhook) blijft: de push naar
  `play` is de webhook. Een push met de `GITHUB_TOKEN` start geen workflow, maar een repository-webhook
  vuurt wel. Die webhook in GitHub kan alleen Tiemen maken (zie de sea, stack 28); tot die er is, is het
  een handmatige redeploy na een release, net als de sea nu.
- **Domein - open vraag voor de keeper.** Voorstel: dezelfde host als de open sea,
  `https://agentvillage.xeroxmsj.freeddns.org/play/`, met een *Custom Location* `/play` in NPM naar de
  play-container. Dan is de sea zelfs same-origin en is er geen extra certificaat. Alternatief: een eigen
  subdomein (`play.xeroxmsj.freeddns.org` bestaat niet zomaar bij freeddns - dat moet daar aangemaakt) of
  later een redirect vanaf seaofagents.nl/play (Tiemens site en DNS, zijn beslissing).

### Bandbreedte

Gemeten op de pack van 0.8.1 (zie hieronder, *Metingen*): een eerste bezoek haalt wat de boot laadt,
gezipt. Een herbezoek op dezelfde versie kost alleen `index.html` + `version.json` (immutable cache). Een
nieuwe versie is opnieuw de hele boot. Bij een upload van ~50 Mbit/s (≈ 6 MB/s) is één nieuwe speler een
paar seconden van de lijn; tien tegelijk delen die lijn.

## Metingen

Gebouwd op 2–3 oktober 2026, op 0.8.1 (`c633e4d`):

- Eén schap is **42,6 MB** ruw en **7,1 MB** gezipt (alles erop, niet alleen wat de boot laadt - dat is
  dus de bovengrens van een eerste bezoek). Zonder de kamersets; met zou het ~47 MB ruw meer zijn.
- Bij 50 Mbit/s upload (≈ 6 MB/s) is één nieuwe speler ~1,2 s van de lijn; 100 nieuwe spelers op een dag
  zijn ~0,7 GB. Een herbezoek op dezelfde versie: twee kleine bestanden. Een nieuwe release: iedereen één
  keer opnieuw de ~7 MB.
- `pack-android.mjs` op `pack-page.mjs` geeft byte voor byte dezelfde `src-android/dist/` (alle 301
  bestanden md5-vergeleken).
- Lokaal geprobeerd met `scripts/serve-play.mjs` (4760) tegen een losse `node sea.mjs --port 4761`: de pagina
  verbindt cross-origin, start in de sloep, desk-modus zonder duimknoppen; een synthetische aanraking zet
  `body.touch` en de laag aan, een toets weer uit. Een nieuwer schap in `version.json` geeft de banner,
  Reload gaat via de deur naar het nieuwe schap met de query erbij. Op het mobiele preset start de pagina
  in touch.
- Niet geprobeerd: de Docker-image zelf (geen Docker op deze laptop) - `shelf.sh` en `nginx.conf` zijn
  ongetest tot de eerste deploy.

## Handmatige stappen (niet door Claude)

Vastgelegd met `/todo`:

1. Portainer → Stacks → Add stack → Repository: deze repo, ref `refs/heads/play`, compose-pad
   `docker-compose.play.yml`, environment `PLAY_SEA=https://agentvillage.xeroxmsj.freeddns.org/`,
   automatische updates: Webhook.
2. De Portainer-webhook als GitHub push-webhook op de repo (Tiemen), of na elke release met de hand
   redeployen.
3. NPM: op de proxy-host van de open sea een Custom Location `/play` → `http://<server>:4760` (of een eigen
   proxy-host op het gekozen domein), met "Cache Assets" **uit** (nginx zet de headers zelf).
4. De eerste keer: `play` moet bestaan - de release-job maakt hem, of `git push origin main:play` met de
   hand.

## Later

- Brotli, als de lijn het knelpunt wordt.
- `SEA_MAX_PLAYERS`.
- De Kraken-kamersets voor wie ooit een eiland op het web heeft (nooit, nu).
