# Plans

Grotere ontwerpen voordat ze code worden — voor mezelf en voor Tiemen. Een plan hier is het
"waarom" en de beslissingen; de code en `CLAUDE.md` zijn de waarheid over wat er nu staat.

- 🚧 [minder-browser-meer-spel.md](minder-browser-meer-spel.md) — browsergedrag uit (zoom, sneltoetsen, slepen, witte flits), één UI-model per modus, de haperingen.

## Besluiten die nog niet in een eigen plan zitten

- ✅ [avonturier-beweging.md](DONE/avonturier-beweging.md) — vervormende gewrichten, passen op afgelegde afstand en aangepast lopen en rennen.
- ✅ [avonturier-handen-en-aansluitingen.md](DONE/avonturier-handen-en-aansluitingen.md) — schouders, nek, twee ogen en beweeglijke ontspannen vingers.
- ✅ [verfijnde-hoedjes.md](DONE/verfijnde-hoedjes.md) — zeven opnieuw gemodelleerde hoofddeksels.

- ✅ [ambachtelijke-reiziger.md](DONE/ambachtelijke-reiziger.md) — concept 3 in het spel en de inventory, met gladde vormen en passende uitrusting.

- ✅ [hoofdpersoon-varianten.md](DONE/hoofdpersoon-varianten.md) — drie verfijnde Blender-concepten met renders ter vergelijking.

- ✅ [graphics-afstanden.md](DONE/graphics-afstanden.md) — vier losse schuifregelaars (View, Object, NPC
  en Shadow Distance) in plaats van één `camera.far` op 1400. Huizen komen door de mist
  tevoorschijn: de nevel (nu op afstand, niet diepte) sluit nooit verder dan Object Distance, en
  een huis wordt pas daarachter uit de render list gehaald. Standaard hoog op een gewone machine,
  lager op integrated graphics en de telefoon; alleen wat iemand zelf verschuift wordt bewaard.
  Bewoners dithereren weg, buiten bereik niet bijgewerkt maar níet vergeten.

- **Een onbezette boot drift terug naar zijn aanlegplaats.** Een boot die niemand aan het
  sturen heeft en die 5 minuten (`IDLE_HOME_MS` in `lib/boats.mjs`) niet is aangeraakt, gaat
  vanzelf terug naar zijn mooring — zie `driftHome()` in `lib/boats.mjs`, aangehaakt op de
  beat-loop in `lib/sea.mjs`. Dit is bewust een uitzondering op het principe uit
  `lib/boats.mjs`'s eigen kop ("een boot blijft precies waar hij is achtergelaten, alleen een
  herstart zet hem terug") — zonder dit kan het enige bootje van een eiland voorgoed aan de
  overkant blijven liggen door iemand die wegliep en niet terugkwam. Alleen een boot zonder
  piloot drift; wie zelf vaart, bepaalt zelf waar hij komt.

- 🚧 [tweede-avonturier.md](tweede-avonturier.md) — tweede karakter op basis van het gekozen Sketchfab-model, met eigen uiterlijk en selectie in de inventory. Sinds 0.10.0 op main; open: nog niet in een echte sessie op het eiland nagelopen (fiets, zwemmen, zitten, eerste persoon).
- 🚧 [vallen-en-verdrinken.md](vallen-en-verdrinken.md) — wie gevangen wordt of verdrinkt, valt of zinkt eerst en springt pas daarna naar huis; anderen zien het via de zee (`fell`). Gebouwd: de Reiziger procedureel, de Avonturier met Mixamo's *Falling Forward Death* en *Floating (Flailing Arms)*; open: de open zee uitrollen, op het eiland zelf nalopen.

## Plannen

Wat af is (✅) staat in [DONE/](DONE/); hier in `Plans/` blijft wat nog open is (🚧). Een sectie
*Later* of *Open vragen* is geen onaf werk. Elk plan draagt dezelfde markering bovenaan.

### Open

- 🚧 [start-op-land.md](start-op-land.md) — wie geen eiland heeft (app en web) begint op land: op het
  plein van een vrije starter, anders op een eilandje bij een spelerseiland, anders bij de vulkaan, met
  de eigen skiff afgemeerd voor de kust; bij het claimen van de starter een vriendelijk bericht en de
  skiff buiten het land van de nieuwkomer.
- 🚧 [app-zonder-apk-bijwerken.md](app-zonder-apk-bijwerken.md) — de telefoon-app haalt een ondertekende
  pagina-bundel op (web/ + shared/) en draait die vanaf de volgende start, met terugval op de ingebakken
  kopie; een nieuwe APK alleen nog als de schil verandert.
- 🚧 [spelen-in-de-browser.md](spelen-in-de-browser.md) — Promptholm spelen zonder app of installatie: de
  telefoonpagina zonder islander als web-schap (`play/<id>/` + een deur + `version.json`) op de thuisserver
  (nginx, git-stack op de branch `play`), met toetsen, controller én touch naast elkaar, de graphicstier
  van de machine, en bijwerken = een banner met Reload. Gebouwd; de stack, NPM en het domein zijn nog
  handwerk.
- 🚧 [zee-stuurt-wat-je-ziet.md](zee-stuurt-wat-je-ziet.md) — de zee stuurt een eiland zijn mensen alleen naar wie
  ze tekent: de pagina zegt welke eilanden (`want`), een islander krijgt niets, een lege pose-beat gaat één keer.
  Gemeten: een kijker op de open zee kreeg 13,4 kB/s, 94% crowd-rijen; één eiland gewild is 3,5, geen 0,13.
  Fase 1 gebouwd en uitgerold (open zee en `/play`, 6 oktober 2026). Fase 2 (spelers `s` filteren) wacht tot `s`
  in `/health` → `wire` groter wordt dan `f`.
- 🚧 [meer-geluiden.md](meer-geluiden.md) — plan van 2 oktober 2026, nog niet gebouwd: meer geluid op het
  eiland, allemaal berekend zoals nu (eigen samples van de keeper hooguit als laatste, optionele fase).
  Geroezemoes en klinkende glazen door de kroegdeur en de borrel op het plein, de ambachten op een
  alleen-lezen cue van wat getekend wordt (smid, zaag, bakker, werkers in de crowd), ochtendkoor,
  krekels, regen op daken en bos, dieren, rivier en vulkaan, en een mixer in Settings. Vaste pools per
  tier, niets op de draad.
- 🚧 [zeetijd-van-de-host.md](zeetijd-van-de-host.md) — de klokchip is geen lens meer: iedereen ziet de
  tijd van de zee, en alleen wie de zee host (single of host, eigen islander) zet die tijd voor iedereen,
  via een popover op de chip. In het geheugen van de zee; een herstart is weer echte tijd. Een patch.
- 🚧 [zelf-bijwerken.md](zelf-bijwerken.md) — de Windows-app werkt zichzelf bij: een knop in de banner
  haalt de release op, controleert de sha256, pakt hem uit over de map (data blijft in `~/.promptholm`)
  en herstart het eiland; de nieuwe exes draaien vanaf de volgende start.
- 🚧 [noclip-camera.md](noclip-camera.md) — een vrije debugcamera (`` ` ``, `?noclip`, `?cam=x,y,z,yaw,pitch&room=`)
  die door alles heen vliegt, met `window.__noclip` (`go`, `lookAt`, `room`, `island`, bladwijzers) om
  graphics snel te bekijken zonder het lijf te besturen; tekent meteen een frame voor een screenshot.
- 🚧 [eiland-op-eigen-schijf.md](eiland-op-eigen-schijf.md) — het eiland en het HD-pakket op een schijf naar
  keuze: een verwijzing `~/.promptholm/home.txt`, *Verplaatsen…* in Settings, en een eigen pad voor het pakket.
- 🚧 [hitboxes-en-looppaden.md](hitboxes-en-looppaden.md) — buiten wordt walk mode preciezer: gedraaide en
  ronde vormen, dingen met een bovenkant om op te stappen of te springen (kei, krat, ton), een zoekrooster,
  en als bron de props, het bos en de keien, en de grenzen van wijkjes (rails spring je over, heggen en muren
  alleen door de poort). En je staat op de stoep van een gebouw. Gebouwd op 1 oktober 2026. Muren van gebouwen,
  trappen en steigers zijn van andere sessies.

- 🚧 [muren-met-hitboxes.md](muren-met-hitboxes.md) — gebouwen zo solide als ze eruitzien: muren per vlak
  gemeten in plaats van één blok per part (de poort van het grote kasteel in te lopen, de goudkuil open),
  gedraaide gebouwen als gedraaide rechthoek, en nooit vast in een gebouw. Gebouwd, nog niet gecommit.
- 🚧 [camera-botsing.md](camera-botsing.md) — gebouwd, nog niet gecommit: de follow-camera hangt aan een arm
  die stopt bij de box van elk onderdeel van een gebouw, bij blockers met een hoogte en bij planken als plaat.
  Buiten van 6–17% naar ≤ 0,5% van de standen door een gebouw heen, binnen (Kraken) van 37% naar 2%; geen
  sprong meer bij de kelderboog en vloerranden, lijf weg bij een korte arm, kruinen erdoor. ~40 µs per frame.
- 🚧 [toetsen-en-bindings.md](toetsen-en-bindings.md) — Ctrl bindbaar en alle ctrl+letters uit op de
  wandelmodus (ctrl+A in elke modus), op en neer duiken met de muis, en Settings → Controls als
  tabel met primaire toets, secundaire toets en controllerknop per actie (grijs zonder controller,
  met de naam van de controller in de kop). Open: een binding set, apart op en neer binden.
- 🚧 [onderwater-zwemmen.md](onderwater-zwemmen.md) — de zee wordt een plek: duiken vanaf het
  oppervlak (`diving.js`), een zeebodem als teken- en botslaag naast het terrein (geulen tot -3.5,
  banken tot -1.0, nooit `H`), een onderwaterlook met het oppervlak van onderen, verdrinken door de
  zee (`breath`), anderen die je op diepte zien, en leven (kelp, koraal, vissen, bellen).
- 🚧 [naambord-gezichten-op-afstand.md](naambord-gezichten-op-afstand.md) — plan, nog niet gebouwd: het
  beletterde gezicht van een naambordje alleen tekenen waar het groot genoeg is om te lezen (in
  pixels op het scherm, met een fade), met een crème vlakje in de batch voor van veraf. Van boven
  ~4 ms (gemeten plafond), zonder atlas, zonder verlies aan scherpte.
- 🚧 [uitrusting-en-vasthouden.md](uitrusting-en-vasthouden.md) — settlers die iets vasthouden en
  een rugzak die uit kan, voor zowel de speler (`classic-avatar.js`) als de instanced settlers
  (`settler-figures.js`). Voor de speler is het grotendeels gebouwd (rugzak, handitems, pantser);
  open: de rugzak en het `equip`-veld voor de instanced settlers, en `/equip`.
- 🚧 [eiland-op-android.md](eiland-op-android.md) — Het eiland op Android. Open: een zee kiezen in de
  app, borden met touch, een bewaarder op andermans eiland aanspreken, en een test op een toestel.
- 🚧 [werkhoudingen-per-tool.md](werkhoudingen-per-tool.md) — plan van 29 september 2026, nog niet
  gebouwd: een settler doet wat zijn sessie doet, in plaats van altijd te hameren.
- 🚧 [schatkaarten.md](schatkaarten.md) — plan van 29 september 2026, nog niet gebouwd: iets te
  vinden op de eilandjes.
- 🚧 [piratenkroeg.md](piratenkroeg.md) — de Salty Kraken, gebouwd op `claude/salty-kraken`: een tweede kroeg
  aan het water (trede 52) met een piratenbemanning aan tafel die de quests geeft, de kist van de piraat erachter,
  een jukebox met shanties (en eigen muziek per kamer in `~/.promptholm/audio`) en een eigen bake met uithangbord.
  Open: het interieur (een grotkroeg uit scheepsdelen, `scripts/krakenkit/`, in aanbouw op
  `claude/salty-kraken-interieur`) en de plek op de piratenoever, die de quay-sessie
  (`quay-en-rivier.md`, op `fix/quay-en-rivier`) bij het mergen instelt. Hoofdstuk *The HD pack*: getextureerde
  Pixal3D-kitstukken uit `~/.promptholm/hd/` naast de bake, met Forced SD / Auto / Forced HD onder Settings →
  Graphics (spelkant gebouwd op `claude/hd-pakket`), een eigen git voor het pakket (nog niet opgezet) en een
  skill voor de hele keten (gepland).
- 🚧 [kraken-op-zee.md](kraken-op-zee.md) — de Salty Kraken gaat van het strand een eindje de zee in: op een rots
  in ondiep water, met een loopplank van het zand naar de voet van de trap (afgeleid uit het plot, gelopen als
  steiger), rotsen die uit het water oprijzen in plaats van op de grond te staan, en de tentakel in de rots.
  Eénmalige verhuizing van de kroeg die al op het strand staat; een minor.
- 🚧 [kraken-dek.md](kraken-dek.md) — het dek van de Salty Kraken beloopbaar: middendek en beide kasteeldaken met ladders,
  een deur in het achterkasteel naar het luik in het kraaiennest binnen, en een ladder langs de romp vanaf de trap.
- 🚧 [bloom-en-aa.md](bloom-en-aa.md) — bloom en anti-aliasing als instelling (Settings → Graphics): three's
  postprocessing gevendord, bloom eerst alleen in kamers, AA MSAA / SMAA / uit.
- 🚧 [verdiepingen-binnen.md](verdiepingen-binnen.md) — beloopbare verdiepingen en trappen in kamers (voor de
  Salty Kraken): vloeren en hellingen als rechthoeken (`surfaces`), blockers met een hoogte, en een camera die
  onder een vloer blijft.
- 🚧 [quay-en-rivier.md](quay-en-rivier.md) — plan van 29 september 2026: de vaargeul is door de
  groeiring van open zee afgesneden, er zitten ringplassen ingesloten en de quay is een rechthoekig
  bassin in een heuvel. Groei breekt geen water meer (fase 1), een vaste haven-sectie in de
  riviermonding als trechter (fase 2), één haven met een stenen kade aan de oostkant en de werf en de grote
  schepen op de piratenoever (fase 3), en migratie van de live-island (fase 4). Fase 0 t/m 3 zijn gebouwd,
  niet gecommit; open: de brug, de plek van de piratenkroeg en fase 4.
- 🚧 [quay-op-zee.md](quay-op-zee.md) — plan van 30 september 2026: het quay-district (The Quay) gaat de
  haven uit en komt als recreatie-oord op zee aan de kade-kant te liggen, zodat de haven vrij is voor boten.
  Bouwt voort op quay-en-rivier fase 3. Gebouwd (niet gecommit): variant A in de baai oost van het
  kade-eind (`layout.resort`, afgeleid door `resortSite`), de pier blijft bij de kade (optie A),
  `QUAY_VERSION` 3, langere palen, een ring houdt het oord open. Open: kade op nieuwe eilanden is zeldzaam,
  de open zee redeployen, de echte island migreren.
- 🚧 [eigen-karakters-en-paard.md](eigen-karakters-en-paard.md) — plan van 1 oktober 2026, nog niet gebouwd:
  een eigen paard en eigen personages, vrij van Blizzard-IP (WoW alleen als referentie van getallen), met
  een rig-bake (skelet + clips als gewone module, geen loader), rijden in plaats van de fiets, één
  Promptholm-skelet voor elk personage en `/character` om te kiezen. Bouwt voort op het paard-plan hieronder.
- 🚧 [paard-in-plaats-van-fiets.md](paard-in-plaats-van-fiets.md) — plan van 29 september 2026, nog
  niet gebouwd: een paard om op te rijden dat de fiets vervangt (zelfde F-toets en `FLAG_RIDING`,
  het gezadelde `fauna_horse`, gangen als snelheidsbanden). Wacht op `touwladders-schip`, dat in
  dezelfde bestanden werkt.

- 🚧 [lokale-coop.md](lokale-coop.md) — plan van 29 september 2026, nog niet gebouwd: twee spelers achter
  één scherm (toetsenbord en pad), in één pagina met één camera die het midden volgt; splitscreen is
  fase 2 (te veel single-eye-state in `main.js`). Ernaast: de chips rechtsboven tonen hun toets of
  padknop naar het laatst gebruikte apparaat.

- 🚧 [open-world-pvp.md](open-world-pvp.md) — plan van 6 oktober 2026, nog niet gebouwd: spelers raken
  elkaar alleen als ze allebei hun persoonlijke PvP-vlag aan hebben (WoW-stijl, uitzetten duurt 30 s, opnieuw
  bij elke treffer), op elke zee. Alleen jij bent veilig op je eigen eiland; wie thuis slaat, is 10 s te raken.
  `PVP_HIT` via `hurt()` en `blowOn`, windup, hoogstens twee aanvallers, afstijgen bij een treffer. Geen `SEA_V`-bump.
