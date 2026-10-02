# Het eiland op een schijf naar keuze

**🚧 OPEN** - gebouwd op `claude/eiland-op-eigen-schijf` (2 oktober 2026), nog niet in een release; zie *Stand*.

## Waarom

Het eiland woont altijd in `%USERPROFILE%\.promptholm` ([DONE/een-thuis-voor-het-eiland.md](DONE/een-thuis-voor-het-eiland.md)),
dus op C:. Op veel pc's is C: een kleine SSD en staat de rest op D:. Het eiland zelf is klein (config,
`data/` ~10 MB), maar wat er nu bij komt niet: het HD-pakket is ~450 MB en groeit met elk stuk, de
eigen modellen (`models/`) en muziek (`audio/`) ook. Een speler moet kunnen kiezen waar dat staat.

`PROMPTHOLM_HOME` bestaat al, maar is geen oplossing voor spelers. Een omgevingsvariabele zet je niet
zomaar, en de session-hook draait zonder onze omgeving: daarom wordt `HOME` alleen uit bestanden
beslist. Wat er nu op de keeper's pc staat (2 oktober 2026) is een noodoplossing zonder code: een
directory junction `~/.promptholm` -> `D:\Promptholm`, met daarin `hd` -> `D:\git\Martijn\PromptholmHD\pack`.
Dat werkt, maar is breekbaar: een `rm -rf` of `Remove-Item -Recurse` volgt de junction en wist het
doel, en een kopie van `~/.promptholm` (de proefmap-truc in CLAUDE.md) kopieert alles mee.

## Voorstel

### 1. Een verwijzing op de vaste plek

`~/.promptholm` blijft de plek waar iedereen eerst kijkt, maar mag een **verwijzing** zijn: een
bestand `~/.promptholm/home.txt` met één regel, het absolute pad van het echte thuis. `HOME` wordt:

1. `PROMPTHOLM_HOME` als die gezet is (tests, proefmappen), zoals nu;
2. de checkout zelf als die een linked worktree is, zoals nu;
3. **het pad in `~/.promptholm/home.txt`**, als dat bestand er is;
4. anders `~/.promptholm`, zoals nu.

Dezelfde regel in `lib/paths.mjs` (`HOME`) en `src-tauri/src/island.rs` (`home()`), en ze blijven gelijk
(tests/home.test.mjs). `checkout.txt` blijft in `~/.promptholm` zelf: dat moet een losse exe vinden
vóór er een thuis bekend is. Een verwijzing en geen junction, omdat een bestand niets kan wissen,
zichtbaar is in Verkenner, en ook op een ander systeem werkt.

**Wijst `home.txt` naar een map zonder `config.json`** (de schijf is weg, een USB-schijf zit er niet in,
de map is gewist), dan sticht het eiland **niets**. Een leeg eiland stichten naast het echte is precies
de fout die het eerste thuis-plan moest voorkomen. De server stopt met een melding, de tray zegt het in
een messagebox (zoals "geen node"), en de session-hook doet stil niets en eindigt met 0.

### 2. Verplaatsen in Settings

Settings -> Eiland -> **Map van het eiland**: het huidige pad en een knop *Verplaatsen…*. Alleen de
keeper ziet hem: `POST /api/home/move { to }`, achter `lib/access.mjs` zoals elke schrijfroute. De
server:

1. keurt het doel: bestaat niet of is leeg, is schrijfbaar, ligt niet in een git-checkout of worktree
   (dan zou het een zandbak worden), niet onder `%APPDATA%` of `%LOCALAPPDATA%` (de MSIX-omleiding uit
   het eerste thuis-plan), en heeft genoeg vrije ruimte;
2. kopieert onder `moving.lock`, met dezelfde code als `settleHome` (logs, locks en tmp niet; `config.json`
   als laatste), en vergelijkt elk bestand na het kopiëren;
3. schrijft pas daarna `home.txt` en herstart het eiland (tray: restart; met losse node: stoppen met de
   melding dat het opnieuw gestart moet worden).

Het oude thuis blijft staan met een `MOVED.txt` die zegt waarheen. Weggooien doet de speler zelf.

### 3. Een eigen pad voor het HD-pakket

`config.json` krijgt `hd: { dir }`, met als standaard `HOME/hd`. Dan kan het pakket op een grote schijf
staan terwijl het eiland klein blijft, of een pakket dat een speler zelf heeft uitgepakt worden gebruikt.
Lezers: `serve.mjs` (`/api/hd`, `/api/hd/<name>.glb`), `tests/hd-pack.test.mjs` (`hdDir`, nu
`PROMPTHOLM_HD_DIR` -> HOME), de `/kitstuk`-skill (`hd_dir`), en straks de knoppen
*Install / Update / Remove* uit Plans/piratenkroeg.md ("Where the pack lives"). In Settings een tweede
veld onder de eilandmap.

## Stand (2 oktober 2026)

Gebouwd zoals hierboven, met deze keuzes:

- **Geen installer.** Een release blijft een zip die je uitpakt waar je wilt, zonder beheerdersrechten:
  het zijn maar een paar bestanden. Het pad kies je alleen in Settings.
- **De herstart is die van het zelf bijwerken** (`restartForUpdate` in serve.mjs, `RESTART_CODE` 75 uit
  lib/selfupdate.mjs): onder de tray start die node opnieuw, zonder tray start node een opvolger na drie seconden.
- **Het kopiëren loopt in de scan-wachtrij** (`exclusive`), en `movedAway` houdt latere scans tegen tot de
  herstart. Wat toch schreef (een dierengebeurtenis, de tuin) vangt de vergelijking na het kopiëren: dan gaat
  de verhuizing niet door en wijst er niets nieuws.
- **Een junction in het eiland blijft een junction** (een HD-pakket op een andere schijf): opnieuw gelegd naar
  hetzelfde doel, niet doorgekopieerd.
- **Terug naar `~/.promptholm` zelf kan nog niet**: daar staat het oude eiland nog, en het doel moet leeg zijn.
  Wie terug wil, haalt `home.txt` weg.
- Getest: `tests/home-move.test.mjs`, nieuwe gevallen in `tests/home.test.mjs`, en een verhuizing van begin
  tot eind op een kopie (bestanden over, `home.txt`, herstart op de nieuwe map, en een ontbrekende map die
  niets sticht). De tray is gecompileerd, maar zijn messagebox is nog niet met de hand gezien.

## Open vragen

- **Een oudere release op een verplaatst eiland.** Oude code kent `home.txt` niet en vindt in
  `~/.promptholm` geen `config.json`. `settleHome` kopieert dan het eiland waar de hook naar wijst, of het
  oude thuis, en dat is een oude kopie. Dus een minor, nooit een patch, en het is de vraag of de stub-map
  iets moet bevatten waar oude code op stopt in plaats van te stichten.
- Moet de verwijzing in `home.txt` staan of in een kleine `config.json` in de stub? Een `config.json` in
  de stub zou oude code een (leeg) eiland laten draaien. Daarom nu `home.txt`.
- De release-map zelf (`promptholm.exe` en `app\`) kan al overal staan: de zip pak je uit waar je wilt.
  Hoeft er nog iets?
