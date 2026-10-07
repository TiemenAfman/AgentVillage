# Een destillaat van het eiland: alleen kijken hoe het groeit

**🚧 Status: plan van 7 oktober 2026, op `claude/destillaat-eiland-non-play-981343`.**

## Aanleiding

Tiemen wil het eiland zonder het spel: een eiland dat alleen laat zien hoe het groeit naarmate er
gewerkt wordt - nieuwe sessies worden huizen, gehuchten groeien, mijlpalen verschijnen - met de
camera-regisseur die er vanzelf langs vliegt. Geen lopen, geen boten, geen kroeg, geen quests,
geen zee met anderen. De planner (plan mode) blijft wel: de keeper mag gehuchten verplaatsen.

## Wat hij koos (7 oktober)

- **Vorm: een uitgeklede kopie van de repo**, geen modus van deze islander. Een eigen map met een
  eigen git, die alleen bevat wat het kijken nodig heeft.
- **Bewoners lopen wel rond, via een lokale zee in hetzelfde proces.** Sinds er geen
  browsersimulatie meer is (CLAUDE.md, "There is no local simulation left in the browser") loopt
  een bewoner alleen als een zee hem loopt; single player is al "een zee op loopback in eigen
  proces". Dat houdt het destillaat: `createSea` op 127.0.0.1, geen `--open`, geen netwerk.
- **Groei live, geen replay.** De kroniek (de replay-knop, het kroniekhuis als deur) gaat eruit.
  Wat binnenkomt verschijnt zoals nu: `applyVillage`, `popIn`, een aankomst waar de regisseur
  heen vliegt.

## Beslissingen

**Waar: een zustermap, `C:\Development\- Anders\Promptholm-Destillaat`, met een eigen `git init`.**
Niet onder deze repo: het is een eigen product, en de coördinator-regels hier (alleen hij merget naar
`main`) gaan niet over een tweede repo.

**Wat erin gaat is de import-sluiting van slanke ingangen, niet een boom met dingen eruit geknipt.**
Drie ingangen worden opnieuw (kleiner) geschreven - `serve.mjs`, `web/index.html`, `web/js/main.js` -
en `scripts/distill.mjs` in déze repo kopieert precies de bestanden die die ingangen (transitief)
importeren, plus `scan.mjs` en wat die importeert, `package.json` (alleen three) en de vendor-stap.
Zo is "uitgekleed" een eigenschap van de grafiek en geen handwerk dat bij elke wijziging op main
opnieuw moet. Een module die via een ander pad nog walk.js of interior.js binnenhaalt komt mee als
dood gewicht; dat is goedkoper dan elke gedeelde module ontvlechten, en de lijst die het script
schrijft (`DISTILLED.txt`) laat zien wat er meekwam.

**De server: scannen, tekenen, de planner, de lokale zee. Verder niets.** Wat blijft van `serve.mjs`:
de scan op een timer (60 s), `village.json` / `layout.json` serveren, SSE `/events` (`village`,
`arrive`), `/api/hello` (zonder sleutel, zonder zeekeuze), `/api/plan` + `/api/plan/survey` +
`/api/plan/undo` (onder de scanqueue, zoals nu), `/api/crowd-ids` (de lokale zee spreekt
geredigeerde namen), en de zee: `createSea` op loopback met de vulkaan en zonder starters,
`createSeaClient` die het ene eiland publiceert. Weg: agents (`/api/assign`, dispatch), mail, de
noticeboards (Jira, GitHub), git, chat, props bouwen, de tuin, schatkaart, muziek, sfx, HD-pak,
lokale modellen, zelf-bijwerken, statusline/goudput-lezing, dieren, Codex, de thuisverhuizing.
`lib/access.mjs` blijft (loopback + Host + Origin) - de planner is een schrijfroute.

**Het eiland: een eigen thuis, gezaaid uit het echte.** `PROMPTHOLM_HOME` van het destillaat staat
standaard op `~/.promptholm-destillaat`. Bestaat daar nog geen `config.json`, dan kopieert de eerste
start `config.json`, `data/layout.json` en `data/arrivals.jsonl` uit `~/.promptholm` (het recept uit
CLAUDE.md voor "een branch op het echte eiland zonder het aan te raken": geen locks, geen logs,
`multiplayer.sea` op single, `network.public` uit). Daarna groeit het zelf mee uit dezelfde
transcripten in `~/.claude/projects`. Waarom niet hetzelfde thuis: twee scanners op één
`layout.json`, en een planner-zet in het destillaat zou dan een echte verhuizing op het levende eiland
zijn. Het prijskaartje: een zet in de planner van het destillaat blijft in het destillaat.

**De pagina: orbit, regisseur, planner.** `state.mode` kent alleen `'orbit' | 'plan'`. Wat blijft:
renderer, `createWorld`, de records en hun batch (`record-batch.js`), gehuchten, wegen, bruggen,
dokken (als decor), de bewegende delen van gebouwen (`attachExtras`: molens, klok, fontein, smidse,
zagerij, Batavia...), houtkar en goudrun als decor, `crowd-view.js` voor de bewoners, het weer en de
klok van de lokale zee, de vier afstanden (zonder schuifregelaars: de tier van de machine), de
regisseur (`director.js`) en de planner (`plan-mode.js`, `plan-overlay.js`, `plan-panel.js`). De HUD:
de naam van het eiland, het aantal bewoners, de volgende mijlpaal, één knop "Plan" (U) en een
schakelaar "Regisseur". De regisseur staat aan en begint na `IDLE_S` zoals nu; elke muisbeweging
pakt de camera terug.
Wat eruit gaat: walk mode en alles wat een lijf nodig heeft (`walk.js`, fiets, paard, duiken, adem,
gezondheid, gevecht), kamers (`interior.js`, de Kraken binnen, de taverne, de rave), noclip, de
inventory, quests en de schatkaart, boten varen, chat en gesprekken, de markt, de postbus, het
bord, de zeekeuze en het hoofdmenu, de wereldkaart, de horizon en andere eilanden (single player:
alleen de vulkaan staat in de zee, en die wordt niet getekend), eilandjes, de zeebodem en het leven
daarop, update-banners, de telefoon en touch, geluid (later eventueel alleen de achtergrond).

**De regisseur kiest uit wat er nog is.** `directorShots()` noemt nu ook de visser, de smid, de
bakker, de slager en story animals. Wat in het destillaat niet bestaat valt eruit (dieren); wat
leeft van de zeeklok (houtkar, smid) blijft, want de lokale zee geeft die klok.

## Fasen

1. ✅ Dit plan.
2. ✅ `scripts/distill.mjs`: de sluiting kopiëren naar de doelmap, `DISTILLED.txt` erbij; een tweede
   run ruimt op wat de vorige kopieerde en niet meer nodig is.
3. ✅ De slanke `serve.mjs` (~440 regels tegen 2111) en `start.mjs`, die het thuis zet vóór
   `lib/paths.mjs` geïmporteerd wordt en het de eerste keer zaait.
4. ✅ De slanke `web/js/main.js` (~3670 regels tegen 9751) + `web/js/watch-net.js` (een eigen,
   kijk-alleen lijn naar de zee in plaats van `net.js`, dat aan lijf en spelers vastzit) + `index.html`.
   Gesneden door `boot()`, `frame()`, de handlers, de vlootsync en de bewoners-router te herschrijven
   en daarna alles weg te halen waar niets meer naar verwees (met ESLint `no-undef` als vangnet).
5. ✅ Geproefd in het browserpaneel: het eiland staat, 196 bewoners komen van de lokale zee, de
   regisseur pakt een shot ("The butcher at the counter"), de planner opent met zijn survey en een dry
   run komt door de scanqueue terug, en een rescan komt via `/events` als nieuwe village binnen.

Wat er overbleef: 242 bestanden in het destillaat; walk.js, interior.js, net.js, peers, quests,
schatkaart, noclip-mode, zeebodem en eilandjes zitten er niet meer in. `ui.js` is de kopie van het
eiland - het zoekt elke knop op id - dus wat niets doet is in `index.html` met CSS verborgen en krijgt
van `main.js` lege handlers, in plaats van ui.js zelf te ontvlechten. Via `ui.js` (Settings → Debug)
en `dance.js` komen `noclip.js` en `sound.js` nog als dood gewicht mee.

## Open

- Geluid: de achtergrond (zee, vogels, werk) zou passen bij kijken; `sound.js` vraagt veel cues uit
  `soundSnapshot()`. Eerst zonder.
- Een eigen venster (Tauri) of alleen de browser: eerst `npm run dev` in de browser.
- Terug naar main: het destillaat volgt main niet vanzelf. `scripts/distill.mjs` opnieuw draaien
  verfrist de gekopieerde modules; de drie ingangen zijn van het destillaat zelf.
