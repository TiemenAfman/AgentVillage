# Eén thuis voor het eiland: `~/.promptholm`

## Waarom

Tot nu toe hing het van de code af waar het eiland woonde: een checkout (en dus elke
debug-build) in zichzelf (`<checkout>/config.json`, `<checkout>/data/`), een uitgepakte
release in `%LOCALAPPDATA%\Promptholm`. Wie allebei heeft, zoals Martijn en Tiemen, heeft
twee eilanden: een nieuwe release sticht bij de eerste start een leeg eiland naast het echte,
en dat valt niet te testen met je eigen dorp. Een eiland dat een release heeft gebouwd, kan
een debug-build omgekeerd ook niet lezen.

Het moet één map zijn voor release, debug, de session-hook en de scanner. Die map is
**niet** AppData, en dat is gemeten, geen smaak. De Claude-desktop-app is een MSIX-pakket
en Windows leidt elke AppData-schrijfactie van alles wat die app start om naar zijn eigen
`LocalCache`. Dat raakt de session-hook, die bij elke sessie een volledige `scan()` doet
en dus `layout.json` schrijft, en een islander die een Claude-sessie herstart. Met het
eiland in AppData onderhoudt Claude desktop een tweede `layout.json` die niemand anders
ziet. Twee kopieën van het enige onvervangbare bestand lopen dan uit elkaar, en huizen
"verschuiven". De profielmap wordt niet omgeleid, net als `~/.claude`.

## Besluit

`HOME` (config.json, data/, .env) is, in deze volgorde:

1. `PROMPTHOLM_HOME` als die gezet is (tests, proefmappen), zoals al gold;
2. de checkout zelf als dat een **linked worktree** is (`.git` is daar een bestand, geen
   map). Een worktree blijft een zandbak met een eigen eiland en een eigen zee-token.
   Anders praat een preview-server uit `.claude/worktrees/` met het echte eiland en
   publiceert hij onder dezelfde naam op de zee;
3. anders `~/.promptholm` (`%USERPROFILE%\.promptholm`), voor release en checkout gelijk.

Dezelfde regel staat in `lib/paths.mjs` (`HOME`) en `src-tauri/src/island.rs` (`home()`),
en ze moeten gelijk blijven. De Rust-kant beslist vóór node draait (de log van de tray).
`checkout.txt` van de tray verhuist mee.

## Verhuizen bij de eerste start

Heeft `~/.promptholm` nog geen `config.json`, dan verhuist het eiland er vanzelf heen. Dat
gebeurt bij het importeren van `lib/paths.mjs`, dus in elk proces dat het eiland kan
schrijven: server, scanner, setup en hook. Een lijst aanroepers die je kunt vergeten, is er
niet. De bron is de eerste van deze drie met een `config.json`:

1. het eiland waar de session-hook naartoe wijst (`~/.claude/settings.json`,
   `on-session.mjs`), gerekend met de oude regel: het eiland waar de sessies de hele tijd
   naartoe zijn gegaan, dus het echte. Bij een ontwikkelaar is dat de checkout, want
   `setup --first-run` laat een bestaande hook staan;
2. het eigen oude thuis: de checkout zelf, of `%LOCALAPPDATA%\Promptholm` voor een release;
3. `%LOCALAPPDATA%\Promptholm`, voor een verse checkout op een machine met een
   release-eiland.

Gekopieerd, niet verplaatst: de oude map blijft staan als backup en krijgt een `MOVED.txt`
die zegt waarheen. Mee gaan `config.json`, `.env` en `data/`, behalve logs, locks,
tmp-bestanden en `data/print`: dat schrijft `export-stl` onder de checkout, en het is geen
eiland. `config.json` gaat als laatste, want dat is het teken dat het eiland er woont. Een
kopie die halverwege stopt, wordt de volgende keer dus opnieuw geprobeerd.

`node --test` start veel processen tegelijk, en de hook en de server kunnen samen starten.
Daarom kopieert er één, onder `moving.lock` (`wx`, verlopen na twee minuten of als de pid
dood is), en wachten de rest tot `config.json` er staat. Mislukt het kopiëren, dan draait
dat proces op de oude plek en probeert het volgende het opnieuw. Nooit sticht het een leeg
eiland naast een echt eiland dat alleen nog niet over is.

## Wat het kost

- Een oudere release (0.4.0 en eerder) gebruikt nog `%LOCALAPPDATA%\Promptholm`. Pas een
  release met deze code deelt het thuis.
- Draai geen oudere code op het gedeelde thuis dan de code die het laatst schreef:
  `loadLayout` vergelijkt `LAYOUT_VERSION` met `!==` en gooit het dorp dan weg, en een
  andere `PARCEL_VERSION` plant de huizen opnieuw. Dat gold al voor wie een oude checkout
  uitcheckte. Nieuw is alleen dat een release en een checkout nu op hetzelfde eiland lopen.
  Daarom de afspraak: **binnen een minor (0.4.x) blijft alles compatibel met het eiland en
  de zee**, zonder layout-grendel en zonder `SEA_V`. Zo'n wijziging wordt de volgende
  minor. Een patch is dan een client-side fix, en de pagina meldt een patch-verschil niet
  meer (`compareLines` in `web/js/update.js`).
- Het eiland in de checkout blijft na de verhuizing staan maar wordt niet meer gelezen.
  Wie daar `config.json` bewerkt, verandert niets; daarvoor is `MOVED.txt`.
