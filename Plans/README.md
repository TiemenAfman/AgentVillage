# Plans

Grotere ontwerpen voordat ze code worden — voor mezelf en voor Tiemen. Een plan hier is het
"waarom" en de beslissingen; de code en `CLAUDE.md` zijn de waarheid over wat er nu staat.

## Besluiten die nog niet in een eigen plan zitten

- ✅ [avonturier-beweging.md](DONE/avonturier-beweging.md) — vervormende gewrichten, passen op afgelegde afstand en aangepast lopen en rennen.
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

## Plannen

Wat af is (✅) staat in [DONE/](DONE/); hier in `Plans/` blijft wat nog open is (🚧). Een sectie
*Later* of *Open vragen* is geen onaf werk. Elk plan draagt dezelfde markering bovenaan.

### Open

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
- 🚧 [paard-in-plaats-van-fiets.md](paard-in-plaats-van-fiets.md) — plan van 29 september 2026, nog
  niet gebouwd: een paard om op te rijden dat de fiets vervangt (zelfde F-toets en `FLAG_RIDING`,
  het gezadelde `fauna_horse`, gangen als snelheidsbanden). Wacht op `touwladders-schip`, dat in
  dezelfde bestanden werkt.

- 🚧 [lokale-coop.md](lokale-coop.md) — plan van 29 september 2026, nog niet gebouwd: twee spelers achter
  één scherm (toetsenbord en pad), in één pagina met één camera die het midden volgt; splitscreen is
  fase 2 (te veel single-eye-state in `main.js`). Ernaast: de chips rechtsboven tonen hun toets of
  padknop naar het laatst gebruikte apparaat.

### Klaar

- ✅ [gebouwen-in-een-batch.md](DONE/gebouwen-in-een-batch.md) — elk gebouwlichaam van een eiland (en het
  frame van elk naambord) is een instance in één `BatchedMesh` (`record-batch.js`); het record houdt
  een stand-in en de batch neemt elke render diens zichtbaarheid en matrix over, dus filters,
  tijdlijn, popIn, de mist-cut en de planner werken ongewijzigd. Hoogezand van boven: 1.945 / 1.460
  calls → 727 / 258, 28,5 → 15 ms. De atlas is vervangen door naambord-gezichten-op-afstand; open: de telefoon.
- ✅ [verborgen-inwoners-tellen-niet.md](DONE/verborgen-inwoners-tellen-niet.md) — een inwoner voorbij
  NPC Distance, onder een imp of nog niet geplaatst was een instance op y = -999 binnen `count`, en
  de GPU tekende hem in beide passes (2 miljoen driehoeken op Hoogezand bij NPC 50). Nu staan wie
  getekend wordt aaneengesloten vooraan in elke batch (swap bij een wissel), met rokken en haar in
  eigen batches: geparkeerd is 0, en op NPC 50 scheelt het 37% van de kleurpas.
- ✅ [website.md](DONE/website.md) — promptholm.com: een lichte, statische landingspagina in `site/` met
  nieuwe screenshots uit de game en downloadknoppen die altijd naar de nieuwste release wijzen.
  Gebouwd op 29 september 2026; nog niet online (Pages en DNS aanzetten).
- ✅ [tenten-vertrekken.md](DONE/tenten-vertrekken.md) — een inwoner met alleen een tent die een week
  (`tentGraceMs`) niets gevraagd is, pakt zijn tent in en vertrekt; het aantal settlers slinkt
  mee. De ladder telt voortaan het meeste dat het dorp ooit tegelijk had (`layout.ladder`), dus
  een gehaalde mijlpaal blijft staan en de volgende duurt langer. Huizen blijven altijd staan;
  genodigden, kadehuizen, hotels en wie een eigen wijkje kreeg ook. Gebouwd op 28 september 2026.
- ✅ [sneller-tekenen.md](DONE/sneller-tekenen.md) — een AI-reviewplan naast de code gelegd: het meeste
  bestond al of brak een regel. Wel gedaan: `?stats` telt de schaduwpas, een kwaliteitsregelaar
  die zonder shader-recompile lichter tekent onder ~28 fps, vier geheugenlekken bij het ophalen van
  een gasteiland dicht (met test), en 64% minder driehoeken (het water, naamborden, schaduwen van
  settlers). Nog niet: een lage settler voor ver weg.
- ✅ [esc-menu-en-knoppenbalk.md](DONE/esc-menu-en-knoppenbalk.md) — de knoppen rechtsboven in twee
  groepen met iconen, en een Esc-menu dat de instellingen ís: vier tabbladen, waarvan alleen
  *Island* van de keeper is (de rest stond achter de keeper-knop en was van de browser).
  Gebouwd op 29 september 2026.
- ✅ [mijlpalen-tot-tweehonderd.md](DONE/mijlpalen-tot-tweehonderd.md) — de ladder op dezelfde kromme
  door tot 200 (afstand ≈ 2 + n/25; 0–100 lag er al op, erboven gaapte een gat van 50): elf
  nieuwe treden bij de haven, op het water en buiten het dorp, want het centrum is vol. De werf
  bouwt vanaf 95 in stadia aan de Batavia, die op 120 op de rede voor anker gaat (en een tweede
  en derde schip op 158 en 192); vanaf 130 groeit de vloot vanzelf tot drie boten per haven; de
  vuurtoren is op zijn echte maat herbouwd; de kraan staat nu ook zonder kade-wijk. Geen
  bestaande trede verschuift. Gebouwd en op het eiland gezet op 28 september
  2026; nog niet: over de Batavia lopen, haar laten varen. De gebouwen hebben elk een eigen plan:
  - ✅ [batavia.md](DONE/batavia.md) — het spiegelretourschip: 12 op de waterlijn, 15 over alles, de
    grote mast 11,5 boven het water; drie kleuren uit één bake, deinend, met waaiende vlaggen en een
    zij waar zwemmers en boten tegenaan komen. Nog niet te belopen.
  - ✅ [scheepswerf.md](DONE/scheepswerf.md) — de werf op 5 bij 16 cellen, met de romp in vijf stadia
    op de helling in de Hollandse volgorde (kiel, bodemhuid, spanten, romp; masten na de tewaterlating).
  - ✅ [havengebouwen.md](DONE/havengebouwen.md) — het pakhuis (127), de waag (184) en de vissershut
    (113). De visser bij de hut is er ook.
    - ✅ [strandpaden.md](DONE/strandpaden.md) — een havengebouw krijgt alleen een kavel waar een weg bij
      de deur komt (`coastSite` probeert `civicRoad` eerst). Lukt dat bij geen enkele haven, dan
      mag de deur op één cel strand uitkomen. Het zand dat de weg oversteekt wordt bestraat en
      elke scan teruggezet (`paths[].strand`). Op seeds 1–40 en op Hoogezand komen bewoners nu
      bij elke civic-deur. Nieuw veld in layout.json, dus een minor.
  - ✅ [ambachten.md](DONE/ambachten.md) — de brouwerij (106), het oefenveld (134) en de steengroeve
    (142), met een tredmolenkraan die blokken op een karretje zet.
  - ✅ [kroniekhuis.md](DONE/kroniekhuis.md) — de laatste trede (200): een klik of E bij de deur speelt
    de kroniek af.
- ✅ [knus-dorpscentrum.md](DONE/knus-dorpscentrum.md) — het centrum als Hogsmeade: een ring van
  gebouwen om het plein en vier winkelstraten eruit, met de ambachten erbuiten; negen nieuwe
  winkels (kruidenier, apotheek, kledingwinkel, bibliotheek, theehuis, toverstokkenwinkel,
  snoepwinkel, uilenpost, ketelmaker), plus de bakkerij en de slagerij. `TOWN_VERSION` deelt een
  bestaand centrum één keer opnieuw in; geen huis beweegt. Gebouwd op 26 september 2026.
- ✅ [dierenverhalen.md](DONE/dierenverhalen.md) — een kip, een geit en een mus (tot zes per eiland) met
  een naam, karakter en een geheugen: de islander onthoudt (`data/animal-events.jsonl`,
  onvervangbaar), de zee laat ze lopen, een ontmoeting telt pas als de zee zegt dat hij gebeurd
  is. Relaties in vier woorden, sporen op het eiland (nest, uitkijkpost, vogelhuisje, de
  Feathered Corner) en één mysterie bij de vuurtoren. Gebouwd op 26 september 2026.
- ✅ [kroegbaas-en-burgemeester.md](DONE/kroegbaas-en-burgemeester.md) — de bewaarders van een gebouw:
  kroegbaas, burgemeester, goudklerk, schooldirecteur en pastoor, onder het id van hun gebouw en
  gelopen door de zee (`KEEPERS` in `shared/palette.mjs`). Gebouwd op 25 september 2026.
- ✅ [andere-spelers-zoals-jij.md](DONE/andere-spelers-zoals-jij.md) — andere spelers met dezelfde rig
  als jij, in hun eigen uiterlijk en uitrusting (`{t:'look'}`), met liggen, hurken en zitten als
  pose-bits en slaan en drinken als gebeurtenissen. Gebouwd op 25 september 2026.
- ✅ [lopen-op-de-boot.md](DONE/lopen-op-de-boot.md) — tot vijf spelers vrij rondlopen op een varende
  boot (het piratenschip): je plek ten opzichte van de romp (`state.deck`), een plat dek uit
  het model, en op de lijn romp en lokale plek samen zoals `encodeRides` het voor settlers al
  doet, zodat niemand naast de boot zweeft. Aan boord kom je zonder toets: een touwladder
  aan elke kant, en eraf ga je door over de reling te springen of langs de ladder. Gebouwd
  op 29 september 2026 (fase 0 en 1 op de 25e).
- ✅ [karakter-blijft-staan.md](DONE/karakter-blijft-staan.md) — ga je terug naar de lucht, dan blijft
  je karakter staan met een Zzz boven zijn hoofd (pose-bit `ASLEEP`) in plaats van weg te
  teleporteren; van boven klik je op de grond of kies je *Walk here* bij een gebouw en hij loopt
  erheen, en bij het opstarten sta je op het plein. Gebouwd op 28 september 2026; de open zee moet
  nog geredeployd voor de Zzz bij anderen.
- ✅ [een-thuis-voor-het-eiland.md](DONE/een-thuis-voor-het-eiland.md): release, debug-build,
  hook en scanner delen één eiland in `~/.promptholm`, en niet in AppData, omdat Claude
  desktop daar een eigen kopie schrijft. Worktrees houden hun eigen data. Het bestaande
  eiland verhuist bij de eerste start vanzelf, gekopieerd vanaf het eiland waar de
  session-hook naartoe wijst. Gebouwd op 24 september 2026.
- ✅ [aangesproken-settler-draait-zich-om.md](DONE/aangesproken-settler-draait-zich-om.md) — een
  settler die je aanspreekt draait zich op elk scherm naar je toe: de zee stuurt wie er
  vastgehouden wordt en waar de spreker staat als eigen bericht (`fh`, alleen bij verandering),
  geen richting in elke rij; en `faceUp` noemt de settler bij zijn naam op de zee (`seaIdOf`).
  Gebouwd op 24 september 2026.
- ✅ [vulkaan-in-het-midden.md](DONE/vulkaan-in-het-midden.md) — het Codex-eiland wordt één vijandige
  vulkaan in het midden van de zee, van de zee zelf; meer islanders betekent meer bewakers, wie
  Codex-data heeft bouwt er huisjes op, lavastromen zoals de rivier. Daarbij: `hurt()` en health
  op de zee, stamina en Shift-turbo (rennen/zwemmen samen, boot apart) met rode en gele balken,
  en vrij zwemmen in open zee. Helemaal gebouwd op 23 september 2026: de vulkaan in het midden met een wachthuis, lava-imps als bewakers die meeschalen met de islanders, de Codex-huisjes van alle islanders op de helling, en health die echt telt met terugslaan en blokken.
- ✅ [klok-en-hemel-van-de-zee.md](DONE/klok-en-hemel-van-de-zee.md) — de zee als enige klok: één
  `shared/worldclock.mjs` voor uur, maand, weekdag en maanfase, `SEA_TZ` zodat de zee in Docker
  niet op UTC draait, de borrel weer echt (de zee zet `setGather`, dat sinds de crowd naar de
  zee ging nergens meer werd aangeroepen) en wolken als functie van wereldtijd. Fase 1 (de
  wereldklok en `SEA_TZ`) gebouwd op 23 september 2026.
- ✅ [wegen-tekenen.md](DONE/wegen-tekenen.md) — tool 6 in de planner: een weg met de hand tekenen, met
  een brug precies zo lang als het gat over de rivier; de oude Build-modus staat voortaan uit
  (Settings → Debug). Gebouwd op 23 september 2026.
- ✅ [groot-kasteel.md](DONE/groot-kasteel.md) — het kasteel op twee bij twee super-cellen: een kavel van
  7 bij 7 en het model 7/3 zo groot. Een nieuw kasteel neemt het dichtstbijzijnde vrije, vlakke
  blok van de stad; een bestaand kasteel groeit op zijn plek met de voorkant waar hij was, of
  blijft zoals het was. Gebouwd en op het eiland toegepast op 25 september 2026.
- ✅ [goudkuil.md](DONE/goudkuil.md) — een sleufsilo met honderd goudstaven naast het plein: het
  5-uurs usage limit, één staaf per procent, dat slinkt terwijl je werkt. Het getal komt uit
  de statusLine van Claude Code (de enige plek waar het staat) en verlaat de machine niet;
  settlers die aan het werk gaan halen eerst een staaf en dragen die naar huis, en die ronde
  overleeft het herbouwen van de crowd. Gebouwd op 24 september 2026.
- ✅ [regisseur.md](DONE/regisseur.md) — laat je het eiland een poos met rust, dan gaat de camera zelf
  kijken waar wat gebeurt: een net aangekomen inwoner, de goudvracht, de houtkar, de werf, een
  werkende inwoner, een verhaaldier, en de nieuwe visser bij de vissershut. Elke aanraking stopt hem.
  Gebouwd op 28 september 2026.
- ✅ [houtkar.md](DONE/houtkar.md) — de zagerij levert hout aan de werf met paard en wagen, op de klok
  van de zee zodat elk scherm dezelfde rit ziet, en drie werknemers op de werf: een
  scheepstimmerman langs de romp, een teerkoker bij de ketel en een drager die planken sjouwt en
  de wagen lost. Gebouwd op 28 september 2026.
- ✅ [goudmijn.md](DONE/goudmijn.md) — een goudmijn met het weeklimiet als erts (één klomp per procent)
  en een goudsmid bij de kuil: als het vijfuursvenster omslaat duwt de mijnwerker een kar over
  de weg naar de goudsmid, die smelt en de staven met de kruiwagen naar de kuil brengt. Gebouwd
  op 28 september 2026, op main; het eiland draait het pas na een herstart.
- ✅ [huis-naar-eigen-wijkje.md](DONE/huis-naar-eigen-wijkje.md) — de planner-op `rehome`: één huis naar
  een wijkje met een eigen naam (Lovely Meteor → Crypto), bewaard in `layout.rehomed` naast het plot.
  Gebouwd en op het eiland toegepast op 23 september 2026.
- ✅ [inwoners-aan-het-werk.md](DONE/inwoners-aan-het-werk.md) — ledige inwoners schoffelen op de akkers,
  wieden in de moestuin, hakken en sprokkelen hout en vissen; waarom de pagina de werkplekken meldt
  (zoals de huisposities) en de zee alleen de visplekken zelf uitrekent. Gebouwd op 23 september 2026.
- ✅ [wie-joint-ziet-de-host-als-mist.md](DONE/wie-joint-ziet-de-host-als-mist.md) — waarom een joiner het
  eiland van de host alleen als silhouet ziet, en de keuze om de pagina de wereld te laten
  vertalen in plaats van haar eigen eiland te verplaatsen. Gebouwd en lokaal nagekeken op 21 september 2026.
- ✅ [aanvallen-en-blokkeren.md](DONE/aanvallen-en-blokkeren.md) — linkermuisknop slaat, rechter blokkeert;
  waarom dat zonder first person kan (pointer-lock), en hoe ver een pagina de Ctrl-sneltoetsen van de
  browser kan tegenhouden (Keyboard Lock, alleen in fullscreen). Gebouwd op 22 september 2026.
- ✅ [inventory-scherm.md](DONE/inventory-scherm.md) — het avatar-paneel omgebouwd tot een RPG-inventory:
  renders van de echte meshes in de slots, een popover voor keuzes en kleuren, huid en leer als
  flesjes onder het podium. Gebouwd op 22 september 2026.
- ✅ [wijkjes-verplaatsen.md](DONE/wijkjes-verplaatsen.md) — een planner van bovenaf: hele wijkjes
  (lobes) selecteren en verplaatsen, grond zoneren als niet-bebouwen, en land bijwinnen met een
  handmatige polder. De scanner verhuist nooit iets uit zichzelf; de keeper wel, via één deur
  (`POST /api/plan`), en de scan erna is weer byte-identiek. Bijlage: de gemeten verkenning van
  22 september 2026. Fase 1 t/m 3 gebouwd op 22 september 2026: zones, wijkjes verplaatsen,
  polderen en ont-polderen, land bijverven, en geen reload meer na Apply.
- ✅ [wijkjes-samenvoegen.md](DONE/wijkjes-samenvoegen.md) — een project houdt één stuk land: de scan
  sticht geen annex meer, een ingesloten wijkje groeit breder (`growLobe`) en wat al in stukken
  stond haalt de planner met `merge` weer bij elkaar. Gebouwd op 28 september 2026; één
  ontwerpkeuze is nog open (het eerste project bij het plein wordt ingesloten).
- ✅ [eiland-als-desktop-app.md](DONE/eiland-als-desktop-app.md) — het eiland als eigen venster (Tauri,
  `npm run app`): waarom de viewer geladen wordt van `localhost:4747` en níet gebundeld met Vite
  (api.js, access.mjs en de import map zouden alle drie breken), en wat de schil wél doet: de
  service starten als die er niet is en hem laten draaien als het venster dichtgaat. Gebouwd op
  22 september 2026.
- ✅ [starter-eilanden.md](DONE/starter-eilanden.md) — de zee legt zelf drie kleine eilandjes neer met
  alleen een plein, een kroeg en een stadhuis (en dus een kroegbaas en een burgemeester), zodat
  een telefoonspeler altijd iets heeft om naartoe te varen. Een nieuw eiland neemt de ligplaats
  van de eerste vrije starter over. Plan van 26 september 2026; gebouwd. Erbij de onclaimbare
  decoratie-eilandjes (zandplaten met palmen, door elke pagina zelf uitgerekend): sinds 29
  september met ondiep water rond het zand, een boot die erop vastloopt en grond om op te staan,
  allemaal via één zeebodem-haak in het archipel.
- ✅ [bier-en-dronken.md](DONE/bier-en-dronken.md) — Bier in de hand, drinken met de muis, en wat het met je doet
- ✅ [dansen.md](DONE/dansen.md) — Zelf dansen
- ✅ [eiland-laten-groeien.md](DONE/eiland-laten-groeien.md) — Het eiland laten groeien
- ✅ [fiets.md](DONE/fiets.md) — Een fiets om op te rijden
- ✅ [gebouwen-verplaatsen.md](DONE/gebouwen-verplaatsen.md) — Gebouwen rond het plein verplaatsen en draaien
- ✅ [ik-wil-graag-mutliplayer-splendid-nest.md](DONE/ik-wil-graag-mutliplayer-splendid-nest.md) — Een open zee, een tick, en eilanden die joinen
- ✅ [islander-als-eigen-exe.md](DONE/islander-als-eigen-exe.md) — De islander als eigen exe, het venster als interface
- ✅ [rave-in-het-kasteel.md](DONE/rave-in-het-kasteel.md) — Een rave in het kasteel
- ✅ [ronde-wereld.md](DONE/ronde-wereld.md) — Een ronde wereld: een kaart met maat, een rand die je rondvaart
- ✅ [slagerij.md](DONE/slagerij.md) — De slagerij
- ✅ [smidse.md](DONE/smidse.md) — De smidse
- ✅ [stal-en-veld.md](DONE/stal-en-veld.md) — Stal, dieren en de spullen van het veld
- ✅ [ingangen-en-bruggen.md](DONE/ingangen-en-bruggen.md) — De naam op een poort boven elke weg die een dorp in- of uitgaat, en handgebouwde bruggen als weg
- ✅ [ingangen-verplaatsen.md](DONE/ingangen-verplaatsen.md) — De keeper legt zelf vast waar de ingang van een dorp is: Gate-tool, `layout.gates`, één per kant
- ✅ [vier-havens.md](DONE/vier-havens.md) — Vier havens, wegen naar het plein, meer boten per haven
- ✅ [zagerij.md](DONE/zagerij.md) — De zagerij
