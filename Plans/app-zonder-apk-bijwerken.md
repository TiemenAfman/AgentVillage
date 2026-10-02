# 🚧 De telefoon-app werkt de pagina bij zonder nieuwe APK

> Status: **stap 0 gebouwd, 2 oktober 2026, nog niet op een telefoon geprobeerd.** `src-android/src/bundle.rs`
> zet een `Overlay` voor de ingebakken assets (`Context::set_assets`, Tauri 2.11.6): elk bestand eerst uit
> `<app data>/bundles/<current>/`, anders uit de APK. Zonder `bundles/current` is het de ingebakken pagina.
> De proef-APK (release-workflow met de hand, `bundle_proof`, feature `bundle-proof`, nooit gepubliceerd)
> schrijft zelf een proefbundel met een rode balk die zegt of een module van schijf draait, of
> `latest_release` antwoordt en of de opener werkt. Een gewone build ruimt een achtergebleven proef op. Aanleiding: Play Protect blokkeerde 0.8.1 als
> "Schadelijke app geblokkeerd" omdat de app zelf APK's downloadde en installeerde (`install_update`,
> `REQUEST_INSTALL_PACKAGES`; eruit in 0.8.2, de knop geeft de APK nu aan de browser). De keeper
> (Martijn): *"Er zijn genoeg games die data apart ingame downloaden, de apk blijft dan klein. Kunnen wij
> dat niet?"* en *"Dan hoeven we niet steeds de apk te releasen. Alleen maar data package klaar te zetten?"*

## Waarom

Alles wat de app laat zien is `web/` + `shared/` in een webview (`scripts/pack-android.mjs` kopieert het
naar `src-android/dist/`). Bijna elke release verandert alleen dat: de fietsknop, de stuurgevoeligheid,
botsen met bomen - JavaScript. Toch moet de telefoon er nu elke keer een hele APK voor installeren, via de
browser, met "sta je browser toe apps te installeren" de eerste keer. En een app die zelf APK's
installeert, wordt door Play Protect als dropper geblokkeerd.

Een app mag wel **data** downloaden; Play Protect let op het installeren van apps, niet daarop. En
JavaScript voor een webview downloaden is zelfs voor de Play Store toegestaan (code in een interpreter
zonder directe toegang tot Android-API's). Dus: de app haalt een nieuwe **pagina-bundel** op en draait die,
en een nieuwe APK is alleen nog nodig als de schil zelf verandert (`src-android/src/lib.rs`, het manifest,
Tauri zelf) - zelden.

## Wat het antwoord op de vraag is

Ja: voor een release die alleen `web/` en `shared/` raakt, is een **bundel klaarzetten** genoeg; de
telefoons halen hem zelf op. De release-workflow bouwt de APK wel bij elke tag (die blijft de manier om de
app voor het eerst te krijgen, en de ingebakken terugval), maar wie de app al heeft hoeft hem niet
opnieuw te installeren. Alleen als de bundel een nieuwere schil nodig heeft, gaat de oude kaart "installeer
de nieuwe versie" omhoog, zoals nu.

## Beslissingen

**1. Wat de bundel is.** `promptholm-web-<versie>.zip` met precies wat `dist/` nu is (zelfde
pack-script, één bron), plus `bundle.json` ernaast:
`{ version, shell, sha256, size }` - `shell` is de laagste `SHELL_V` (zie 4) waar hij op draait.
Als release-asset naast de APK, dus via de vaste `releases/latest/download/promptholm-web.json` en
`...zip`. Geen eigen server.

**2. Ondertekend, niet alleen een hash.** De bundel is code die in de app draait. Een sha256 uit
dezelfde download bewijst niets; wie de download in handen heeft, levert ook de hash. Dus `bundle.json`
draagt een **ed25519-handtekening** over zijn eigen inhoud, gemaakt in de release-workflow met een secret
(`BUNDLE_SIGNING_KEY`), en de publieke sleutel staat in `lib.rs`. Rust controleert de handtekening, dan de
sha256 en de grootte van de zip, dan pas wordt iets uitgepakt. Schade als het toch misgaat is beperkt (de
app heeft sinds 0.8.2 alleen `INTERNET`), maar het blijft code van iemand anders in onze app.

**3. Nooit terug in versie.** Een bundel die niet nieuwer is dan wat er draait, en niet nieuwer dan de in de
APK ingebakken kopie, wordt genegeerd. Zo zet een oude bundel een net geïnstalleerde nieuwere APK niet
terug, en kan niemand een oude, getekende bundel met een bekende fout opnieuw aanbieden.

**4. Schil en pagina hebben een contract: `SHELL_V`.** Een geheel getal in `lib.rs` (wat de schil de pagina
biedt: de commando's `latest_release`, straks `bundle_*`, de opener-rechten) en een kopie in `web/js/`,
door een test gelijk gehouden zoals `SEA_PROTOCOL`. Een bundel met `shell` hoger dan de schil wordt niet
gebruikt; de app toont dan de bestaande kaart voor de APK. Ophogen alleen als een pagina iets van de schil
nodig heeft wat een oudere niet heeft.

**5. Ophalen op de achtergrond, wisselen bij de volgende start.** Nooit midden in een sessie: de pagina die
draait blijft draaien. De app vraagt bij de start (en ten hoogste eens per uur, zoals `latest_release`)
naar `bundle.json`, downloadt een nieuwere in stukken naar `app_data_dir/bundles/<versie>.part`, controleert
(2), pakt uit naar `bundles/<versie>/`, en zet pas dan `current` om. De pagina krijgt een melding "nieuwe
versie klaar - herstart" met een knop die de webview herlaadt.

**6. Een bundel die niet opstart, valt terug.** Wat nu het meest kapot kan gaan is de boot (het scherm dat op
"Charting the island…" bleef hangen). Dus de pagina meldt zich `bundle_ok` zodra `state.ui.boot(true)`
gebeurt. Komt die melding na een start met een nieuwe bundel niet binnen 30 s, dan gaat de volgende start
op de vorige goede bundel (en anders de ingebakken kopie), en wordt de mislukte versie niet opnieuw
geprobeerd. Altijd bewaard: de ingebakken kopie in de APK, plus de laatste goede bundel.

**7. Hoe de bundel geserveerd wordt: eerst uitzoeken.** De pagina moet op dezelfde origin blijven
(`tauri.localhost`): daar mag hij de schil aanroepen (`capabilities/default.json` geldt voor de ingebakken
pagina), en `api.js`/`assets.js` rekenen hun basis uit vanaf `import.meta.url`. Twee kandidaten:
- **Een eigen `Assets`-bron in de Tauri-context** (`Context::set_assets`) die eerst in `bundles/current/`
  kijkt en anders de ingebakken bestanden geeft. Zelfde origin, geen CORS, niets aan de pagina te
  veranderen. Voorkeur, als het op Android werkt.
- **De ingebakken `index.html` als lader**, met een import map die naar een eigen URI-schema
  (`register_asynchronous_uri_scheme_protocol`) wijst. Werkt zeker, maar dan is de `index.html` die draait
  altijd die van de APK, en markup die bij nieuwe JS hoort komt niet mee.

Stap 0 is een proef op een echte telefoon: een bundel die alleen een andere titel heeft, via de eerste
kandidaat, en kijken of de opener en `latest_release` dan nog werken.

**8. De versie die de app noemt is die van de bundel.** `build` in `PROMPTHOLM_STANDALONE` komt uit de
bundel; `updateGate` vergelijkt de bundelversie met GitHub en met de zee. De APK-kaart gaat alleen nog
omhoog als (4) zegt dat de schil te oud is.

## Stappen

0. De proef uit 7, op een telefoon. Bepaalt de rest.
1. `SHELL_V` in `lib.rs` en `web/js/`, met een test.
2. Release-workflow: `pack-android` -> zip -> `bundle.json` -> tekenen -> assets naast de APK. Het secret
   aanmaken (`BUNDLE_SIGNING_KEY`), publieke sleutel in `lib.rs`.
3. `lib.rs`: ophalen, controleren (handtekening, sha256, grootte, versie), uitpakken (geen pad buiten de
   map: zip-slip), `current` omzetten, de bundel serveren, `bundle_ok` en de terugval.
4. De pagina: "klaar - herstart"-melding, `bundle_ok` na de boot, versie uit de bundel.
5. Tests: handtekening en zip-slip in Rust; in Node de gate met bundel- en schilversies.

## Later

- **Alleen wat veranderd is downloaden.** `bundle.json` met een hash per bestand, en de app haalt alleen
  de bestanden op die anders zijn. De zip is nu ~44 MB onuitgepakt (de gebakken meshes, waarvan
  `piratetavern-mesh.js` 10 MB), dus dit is de volgende winst - maar eerst moet de hele weg werken.
- **De APK zelf kleiner.** Pas als (5) en (6) betrouwbaar zijn, kunnen grote sets uit de APK naar de bundel.
  Zolang niet: de app moet ook zonder netwerk opstarten op wat hij bij zich heeft.

## Open vragen

- Werkt `Context::set_assets` op Android in de Tauri-versie die we hebben (7)?
- Waar staat de privésleutel naast GitHub - wie kan een bundel tekenen als het secret weg is? Zonder die
  sleutel kan geen telefoon meer een bundel aannemen, alleen nog een nieuwe APK (met een nieuwe publieke
  sleutel).
