# Een noclip-camera om snel te kijken

**🚧 Status: plan van 2 oktober 2026, gebouwd op `claude/fervent-gould-b80348`, nog niet gecommit.**

## Aanleiding

Elke visuele controle - vaak door Claude zelf, via het browserpaneel of de Chrome DevTools MCP - gaat nu
via het lijf: eiland laden, walk mode in (`walk-btn`), teleporteren met `__state.walk.state.pos.set(...)`
(alleen met `?hunt`/`?dive`), een kamer in lopen door zijn deur (`enterInterior`) en dan de camera draaien
met nagemaakte toetsaanslagen. Traag, en het breekt zodra een deur verschuift of een muur in de weg staat.

Wat er moet komen: een vrije camera die overal heen vliegt, door muren, grond en water, die met de muis en
WASD bestuurd wordt én vanuit de console of een URL op een plek gezet kan worden, zodat een screenshot-
plek een link is.

## Beslissingen

**Een vierde mode, `state.mode === 'noclip'`, op de gewone `camera`.** De planner tekent door zijn eigen
`OrthographicCamera` en raakt `camera`/`controls` niet aan, en dat maakt weggaan gratis. Voor noclip is dat
precedent het verkeerde: alles wat op de camera let - `cullRecords`, `applyFogRange`, `edgeReach`, de
onderwaterlens, `world.recentre`, de horizon, de geluidslistener (die hangt *aan* `camera`), `postFx.render`
- leest `camera` rechtstreeks. Met een eigen camera had elk van die plekken een `eye` moeten krijgen, en
de mode bestaat juist om te zien wat de gewone camera zou zien. Dus dezelfde camera, en weggaan wordt
gratis gemaakt door vooraf alles te bewaren wat noclip aanraakt: positie, quaternion, `up`, `near`, het
orbit-doel, en op de voet `camYaw`/`camPitch` van de walk mode (die de muis onder een pointer lock nog
leest, ook gepauzeerd). Bij weggaan gaat dat allemaal terug, en de vorige mode met hem.

**Het lijf blijft staan.** Van boven is het lijf al geparkeerd (`walk.park()`) en loopt het zijn route
gewoon verder (de geparkeerde tak van `frame()`). Op de voet wordt de walk mode *gepauzeerd*, niet
geparkeerd: zo kom je bij weggaan precies terug waar je was, in dezelfde kijkrichting, ook aan een roer
of in een kamer - `exitWalk`/`enterWalk` zouden de camera laten vliegen, de boot laten stoppen en de kamer
verlaten. Een gepauzeerde walk mode stuurt zijn houding naar de zee zoals altijd: dat is het lijf, niet de
camera. **Niets van de camera gaat over de lijn**; noclip zelf praat met niemand.

**Kamers zonder deur.** `__noclip.room('piratetavern')` laadt de lazy sets (`prepareRoom`), bouwt de kamer
zoals `enterInterior` dat doet (`roomFor`, nu gedeeld) en roept `inside.peek()` aan in plaats van `enter()`:
de show en de lampen draaien, de walk mode van de kamer wordt nooit betreden, er gaat geen `net.setRoom`
uit en de peers worden niet in de kamer gezet (niemand ziet je daar, en je ziet daar niemand - bewust).
`update(dt, { eye })` slaat de walk over en beoordeelt het deksel (`judgeLid`) op het oog, in het gebied
waar het oog is. `island()` brengt je terug naar de plek op het eiland waar je de kamer in ging. Wie al op
de voet in een kamer staat en noclip aanzet, kijkt rond in díe kamer; `room()`/`island()` weigeren dan
(ga door de deur), want het lijf staat binnen.

**Wat de camera vervangt in elke lezer:**
- `objectReach` (de Object-Distance-ondergrens): van boven op de afstand tot het orbit-doel, in noclip op
  de **hoogte** van de camera boven zee - omhoog vliegen om het eiland te overzien houdt het dorp, laag
  over de grond is het de instelling, als op de voet.
- `focusPoint` (`pickDetailed`, de eilandjes) en `setWaterFocus`: de camera zelf.
- Zeebodem en zeeleven (`seaFloorFrame`): actief zodra de onderwaterlens aan is, op de camera.
- De onderwaterlens keek al naar de camera; dat werkt vanzelf.
- `followShadow`: om een punt een paar eenheden voor de camera, zo breed als hij hoog hangt.
- De regisseur: alleen in `'orbit'`, dus vanzelf uit. De labels, de kaart van boven en de klik op een
  gebouw (pointer-handlers) zijn ook orbit-only of krijgen een `noclip`-uitzondering zoals `plan`.

**Aan/uit.** Uit tenzij Settings → Island → Debug → *Noclip camera* aan staat (per browser,
`promptholm.debug.noclip`, als Build mode) of de URL `?noclip` of `?cam=` heeft. Dan schakelt **`` ` ``**
(de backquote, `e.code === 'Backquote'`, dus ook als dode toets op een internationale indeling) hem aan en
uit; Escape laat eerst de muis los (zoals walk mode) en gaat daarna uit noclip. `window.__noclip` bestaat
alleen als noclip mag.

**Besturing.** WASD/pijltjes vliegen langs de kijkrichting (dus met de pitch mee), Space/E omhoog en
Shift/Q omlaag (recht verticaal), het wiel of `+`/`-` maakt sneller of trager (×1,2 per stap, 0,1 tot 400
eenheden per seconde; buiten 8, binnen 1,5, apart onthouden). Pointer lock bij binnenkomen (de toets is een
gebaar); weigert de browser hem (de desktop-app's paneel), dan kijk je door te slepen. Geen botsing, geen
grond, geen water.

**Console en URL.** `__noclip.go({ x, y, z, yaw, pitch })` (alles optioneel, in scènecoördinaten van wat er
getekend wordt: het eiland, of de kamer), `get()`, `lookAt(x, y, z)`, `room(naam)` (een promise),
`island()`, `exit()`, `speed(n)`, `link()` (de URL van deze plek), `save(naam)`/`recall(naam)`/`spots()`
(bladwijzers per browser, `promptholm.noclip.spots`) en `hud(false)` (alles behalve het beeld weg, voor een
schone screenshot). De URL-vorm is `?cam=x,y,z,yaw,pitch&room=piratetavern`: na het opstarten (als
`?nointro`, zonder menu en zonder vlucht). Yaw volgt walk.js: kijkrichting `(sin yaw, cos yaw)`, pitch
positief omhoog.

**Frames terwijl het paneel verborgen is.** Het browserpaneel tekent tussen screenshots geen frames. Elke
`go()`, `lookAt()`, `room()`, `island()` en `hud()` tekent daarom zelf (`frame()`, buiten
`requestAnimationFrame`) en geeft een promise. Gemeten: één frame in de aanroep zelf kwam er een screenshot
te laat uit (soms wel, soms niet), dus een frame meteen, een tweede in de volgende taak, en een pixel
teruglezen (`readPixels`, een synchronisatiepunt met de GPU) voor de promise afloopt. Daarna 3 van 3
screenshots meteen goed. Dus: `await __noclip.go(...)`, dan de screenshot.

**Geverifieerd** op een kopie van Hoogezand (worktree-islander met `PROMPTHOLM_HOME` op de kopie): `?cam`,
`?room=piratetavern`, `go`, `room`/`island`, onder water (lens, zeebodem, kelp), van 120 hoog het hele dorp
zonder cut, `` ` `` + W vanuit orbit, en heen en terug vanuit orbit en walk mode met precies dezelfde
camera, kijkrichting en lijf.

## Wat waar staat

- `web/js/noclip.js`: het pure deel (`stepNoclip`, `lookFrom`, `nudgeSpeed`, `parseCam`/`formatCam`,
  `camLink`, `applyPose`/`poseOf`) en `createNoclip`, de toetsen, de muis en de lock.
- `web/js/main.js`: `enterNoclip`/`exitNoclip`/`noclipRoom`/`noclipIsland`, de lezers hierboven,
  `window.__noclip`, `?cam`/`?room`.
- `web/js/interior.js`: `peek()`/`unpeek()`, `update(dt, { eye })`, `view` (een beginstand in de kamer).
- `web/js/ui.js`: de chip onder Debug.
- `tests/noclip.test.mjs`.

## Open

- Geen controller in noclip.
- Peers in een bekeken kamer worden niet getekend.
