# 🚧 De Windows-app werkt zichzelf bij

> Status: **gebouwd, 2 oktober 2026, nog niet op Windows geprobeerd** (de tray compileert voor
> `x86_64-pc-windows-gnu`; de wissel is getest op een nep-release, `tests/selfupdate.test.mjs`). Aanleiding: de keeper (Martijn) bij 0.8.1: de Windows-app kreeg geen
> melding van een nieuwe, onverplichte patch, en *"de Windows-versie kan zichzelf wel patchen"*. Gekozen:
> een knop in de banner die de release zelf ophaalt, controleert, uitpakt en het eiland herstart.

## Waarom

Tot 0.8.1 hoorde de desktoppagina alleen van een nieuwe versie via de welcome van de zee, en dan per
lijn (major.minor): een patch werd nooit gemeld. 0.8.1 zet daar `islandNotice` naast (de islander
vraagt GitHub, `lib/latest-release.mjs`), maar dan nog is bijwerken: de zip downloaden, uitpakken over
de oude map, de tray stoppen en opnieuw starten. De telefoon doet dat al met één knop
(`install_update` in `src-android/src/lib.rs`); de desktop kan het met minder, want de islander zelf
is node en draait in de map die vervangen moet worden.

## Hoe

**Wie doet het: de islander (node), niet Rust.** Bijna alles wat een patch verandert is JavaScript in
`app\` (`lib/`, `shared/`, `web/`, `serve.mjs`). Node houdt die bestanden niet open (gelezen bij het
importeren, `sendFile` met `readFileSync`), dus ze kunnen vervangen worden terwijl het eiland draait.
`lib/selfupdate.mjs`, achter een keeper-route `POST /api/update/install` (niet op `PUBLIC_API`, en
`lib/access.mjs` eist loopback + Host + Origin, dus geen andere site kan hem afvuren):

1. **Alleen een release op Windows.** `app\release.json` moet er zijn (een checkout werkt zichzelf bij
   met `git pull`, en een sandbox-worktree mag nooit zijn eigen map overschrijven) en `process.platform`
   is `win32`. De nieuwste versie komt van GitHub en moet nieuwer zijn dan `BUILD.version`.
2. **Downloaden op het vaste tag, niet `latest/download`**: `releases/download/v<versie>/
   promptholm-windows-x64.zip` en de `.sha256` ernaast, zodat een release die tussendoor verschijnt de
   zip en zijn hash niet uit elkaar trekt. De sha256 moet kloppen, anders gebeurt er niets.
3. **Uitpakken naast de map**, in `<top>\.update-<versie>\new`, met Windows' eigen `tar.exe` (bsdtar,
   sinds Windows 10 1803; pakt zip uit). Geen nieuwe dependency. Daarna nagaan: `app\release.json` zegt
   precies die versie, en `app\serve.mjs` en `promptholm.exe` zijn er.
4. **Wisselen, met de weg terug.** Per onderdeel van de release (`promptholm.exe`, `README.txt` en alles
   in `app\`): het oude wordt naar `.update-<versie>\old` verplaatst, het nieuwe op zijn plek gezet.
   Een draaiende exe kan niet overschreven maar wél hernoemd worden, dus die gaan ook naar `old`. Gaat
   er halverwege iets mis, dan gaat alles wat al verplaatst was terug, in omgekeerde volgorde.
   `config.json` en `data\` staan in `~/.promptholm` en worden nooit aangeraakt.
5. **Herstarten.** Node antwoordt de pagina, en sluit dan af met exitcode `RESTART_CODE` (75). De tray
   start node daarop opnieuw, nu met de nieuwe code (Rust: `Keeper::state` ziet die code, wacht tot de
   poort vrij is en roept `start()`). Een tray van vóór dit plan kent die code niet en zou het eiland
   gestopt laten; daarom zet de nieuwe tray `PROMPTHOLM_TRAY_RESTARTS=1` in de omgeving van node, en
   zonder die vlag start node zelf een losse opvolger (detached, niet supervised) voordat hij stopt.
   De oude tray adopteert die als "started elsewhere", zoals bij een eiland dat met de hand gestart is.
6. **Opruimen** bij de volgende start: `.update-*` mappen en de oude exes erin weg, met stilte bij
   `EBUSY` (een oude tray-exe die nog draait wordt de keer daarna opgeruimd).

**De pagina.** De banner van `islandNotice` krijgt een knop *Install v…* wanneer `/api/latest-release`
`canInstall: true` zegt (release, Windows, nieuwer). Een klik: knop uit, "Updating…", de POST; daarna
gaat het eiland weg en komt terug, en de pagina laadt opnieuw zodra `/api/hello` een nieuwe `build`
noemt. Een fout komt in de banner, in woorden, en het eiland draait door op wat het was.

## Beslissingen

- **De exes worden vervangen, maar pas actief bij de volgende start.** De tray die de update doet is de
  oude exe (nu `…\old\promptholm-island.exe`); hij start de nieuwe node. Pas na Quit en opnieuw starten
  (of een herstart van Windows) draaien de nieuwe exes. Rust verandert zelden in een patch, en de tray
  zichzelf laten vervangen (mutex, knock, een go-between die wacht) is veel risico voor weinig.
  Het tooltip leest `release.json` opnieuw bij elke statuswissel, dus het noemt meteen de nieuwe versie.
- **Geen automatische update.** Altijd een klik van de keeper: er kan een sessie of een open paneel
  zijn dat een herstart niet verdient (dezelfde reden als de Y/n van `watch-island.mjs`).
- **De eerste keer is met de hand**: een versie zonder deze code kan zichzelf niet bijwerken. Vanaf de
  eerste release met dit plan gaat elke volgende met een klik.
- **Een patch.** Een route, een banner en een exitcode; niets in `layout.json`, `config.json`, de bundel
  of het protocol. Een oudere tray met een nieuwere node werkt (de opvolger hierboven).

## Open vragen

- Een update die midden in een scan of een spawned agent valt: de herstart is dezelfde als die uit het
  traymenu, dus net zo (on)schadelijk. Waarschuwen in de banner als er een agent loopt?
- Antivirus kan een net uitgepakte, ongetekende exe in quarantaine zetten; dan ontbreekt
  `promptholm.exe` na de wissel. Stap 3 controleert dat hij er is vóór de wissel, maar niet erna.
- Niet te testen in de cloud-sessie: Windows' `tar.exe`, het hernoemen van een draaiende exe en de tray.
  De tests draaien de wissel op een nep-release in een tijdelijke map, met een injecteerbare uitpakker.
