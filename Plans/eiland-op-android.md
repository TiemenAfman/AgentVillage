# Het eiland op Android

Een APK die de open zee joint — geen islander, geen LAN, geen hosten, en universeel: hij
hoort bij niemands eiland. Je start midden op zee in een bootje; geen planner, geen bouwen,
geen overzicht vanuit de lucht.

## Waarom web/ hier wél gebundeld wordt

De desktop-window bundelt niets (`Plans/eiland-als-desktop-app.md`): zijn pagina hoort bij
de islander op 4747, en bundelen brak `mine()`, `lib/access.mjs` en de import map tegelijk.
Op een telefoon is er geen islander en komt er nooit een, dus alle drie de redenen vallen
weg. `scripts/pack-android.mjs` kopieert `web/` + `shared/` naar `src-android/dist/` en
schrijft `window.PROMPTHOLM_STANDALONE = { sea, key }` in de head van die kopie van
`index.html`. Een door een islander geserveerde pagina heeft dat nooit, dus daar verandert
niets.

## Beslissingen

- **`STANDALONE` in `web/js/api.js`.** `mine()` gooit dan meteen `IslanderUnreachable` in
  plaats van te fetchen: `http://tauri.localhost` beantwoordt elk pad met *iets*, en een
  404 van "de islander" is de keeper-modus. Zo loopt de bestaande "geen islander"-tak in
  `boot()` — gast, geen keeper-tools — zonder tweede codepad.
- **Thuis is water.** De scène is gebouwd rond een thuis op de oorsprong; dat weghalen is
  een tweede tekenpad. `standaloneHome()` geeft een leeg dorp op een terrein dat overal open
  zee is (`makeTerrain(…, { open: true })` — echte eilanden hashen ongewijzigd), op de
  ligplaats die een nieuw eiland zou krijgen (`nextOrigin`), dus vrij van iedereen. Elk
  eiland in de vloot is dan een gast. Eerst werd een eiland uit de vloot geleend (Hoogezand),
  maar dan hoort de APK bij één speler.
- **Een wanderer, en terug in je boot.** `state.islandId` is null, dus `join` noemt geen
  eiland. Een vijandig eiland (Codex) jaagt dan toch op je zolang je een skiff hebt:
  `lib/hostility.mjs` stuurt een wanderer terug naar die skiff in plaats van naar een
  thuisplein, met de boot-id in het `evicted`-bericht, en `onEvicted` zet je er meteen in.
  Zonder skiff is er geen thuis en laat de zee je met rust.
- **Een skiff, bij de zee.** Een speler zonder eiland heeft geen ligplaats, dus
  `lib/boats.mjs` kent nu een tweede soort boot: `boat:w-<player id>`, gemaakt door
  `{t:'boat', a:'launch'}` met de eigenaar aan de helmstok, alleen door die eigenaar te
  varen, en weg (`sink`, een `gone` naar iedereen) zodra die de verbinding verbreekt. De id
  is die van de socket, dus één per verbinding en niet te claimen onder andermans naam.
  `castOffOnArrival()` lanceert hem na de welcome op een willekeurig punt midden in de
  ligplaats (anders spawnt de tweede telefoon in de romp van de eerste), boeg naar de kust;
  een reconnect is een nieuwe id, dus `relaunchSkiff()` zet hem via `onWelcome` terug onder
  de nieuwe naam. Andere pagina's tekenen een skiff zodra de zee hem noemt (`skiffFor` in
  `onBoatFromServer`); `launchBoats()` ruimt hem niet op.
- **Wat er live moet.** De zee (Docker) moet de nieuwe `lib/` draaien, anders negeert hij
  `launch` en is de boot weer alleen lokaal. En een desktop-speler ziet skiffs pas als zijn
  islander de nieuwe `web/js/` serveert; de APK heeft ze al aan boord.
- **Geen lucht.** `exitWalk()` en `enterPlan()` doen niets in standalone; de chips Walk,
  Build, Plan, Overview en New settler, de toetsenbalk en de fabs verdwijnen via
  `body.standalone` (een class, omdat andere setters `hidden` later teruggeven).
- **Touch als gamepad.** `web/js/touchpad.js` pollt in precies de vorm van `gamepad.js`
  (linkerhelft zwevende stick, rechterhelft slepen om te kijken, knoppen A en X), dus
  walk mode, roeien en sturen werken zonder touch-code in `walk.js`.
- **De key zit in de APK.** De open zee is keyed; de pack neemt `--key`,
  `PROMPTHOLM_SEA_KEY` of `multiplayer.sea.key` uit `config.json` als die dezelfde zee is.
  Een APK is een zip: geef hem alleen aan wie de key toch al mag hebben.
- **Eigen crate `src-android/`**, niet een target van `src-tauri/`: dat zijn twee Windows-
  exes rond een islander (tray-icon, tao, windows-sys, node als kind).

## Bouwen

JDK 21 (Gradle 8.14 draait niet op 25), Android SDK platform 35 + build-tools 35 + NDK 27,
`rustup target add aarch64-linux-android`. Dan, met `JAVA_HOME`, `ANDROID_HOME` en
`NDK_HOME` gezet:

    npm run android:apk

Levert een debug-gesigneerde APK in
`src-android/gen/android/app/build/outputs/apk/universal/debug/` — 137 MB, want de `.so`
is niet gestript. Kleiner (≈10 MB): `tauri android build --apk --target aarch64` in
`src-android/`, dan `zipalign -p 4` en `apksigner sign` met `~/.android/debug.keystore`
(alias `androiddebugkey`, wachtwoord `android`) uit build-tools 35.

## Nog niet

- Een release-gesigneerde APK (keystore) en een CI-job.
- Een zee kiezen in de app zelf; nu is het wat de pack erin schreef.
- Panels/boards op een telefoon: ze openen, maar zijn niet op touch ontworpen.
