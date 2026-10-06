# 🚧 Vallen en verdrinken

## Doel

Wie gevangen wordt (de balk leeg: een wachter, lava) of verdrinkt (lucht op), werd tot nu toe in
hetzelfde frame naar huis geteleporteerd. Nu gaat het lichaam eerst neer waar het stond: vallen op
het land, zinken in het water. Pas daarna de sprong naar huis. Anderen zien het ook. De Avonturier
speelt er Mixamo-clips voor, de Reiziger een procedurele val en een procedureel zinken. Plans/tweede-avonturier.md is het
plan van het lichaam zelf.

## Besluiten

- **De zee bepaalt nog steeds wanneer en waarheen.** `hurt()` (lib/health.mjs) en de evict blijven
  zoals ze waren: dezelfde refuge, hetzelfde `evicted`-bericht. De pagina stelt alleen haar eigen
  sprong uit (`evictedHere` in main.js). Zo blijven `SEA_V` en het `evicted`-formaat ongewijzigd.
- **De immuniteit begint thuis** (Martijn, 6 oktober). De 5 s (`IMMUNE_MS`) gaan pas in als het
  lichaam thuis staat, na de animatie en `sentHome`. De zee kent alleen poses: thuis is de eerste
  pose na de evict binnen `ARRIVE_R` (4) van de refuge. lib/players.mjs telt daarvoor poses
  (`p.poses`). Een pose van elders na de evict is een lichaam dat nog neergaat; dat blijft onkwetsbaar
  tot aankomst, hoogstens `ARRIVE_MAX_MS` (6 s). Een socket die na de evict geen pose stuurt, houdt
  de oude 5 s vanaf de klap. Een pagina van vóór deze wijziging springt meteen naar huis, dus daar
  lopen de 5 s als vanouds.
- **Wat een dood is.** `why` leeg (gevangen) of `'drown'`. Een gevraagde respawn (`'respawn'`) en
  een overgenomen starter (`'settled'`) zijn geen dood en springen meteen, net als iedereen op een
  boot, fiets, ladder, dek of stoel (`walk.die` geeft dan 0).
- **Eigen lichaam.** `walk.die(kind)` houdt walk mode vast: gepauzeerd, dus geen toets of knop doet
  iets, maar de muis kijkt nog rond. Het lichaam ligt stil, of zinkt in het water met `DROWN_SINK`
  naar de bodem (`bedUnder`, nooit erdoor). Eerste persoon gaat zolang naar derde persoon. De duur
  is wat het rig nodig heeft (`dyingSeconds`) plus `DEATH_REST`. Daarna doet `sentHome` wat het
  altijd deed, met zijn zwarte overgang. In het water zinkt een lichaam altijd, ook bij een klap
  van een wachter: drijvend valt niemand om.
- **De anderen.** De evict stuurt nu ook `{t:'fell', id, how}` naar iedereen behalve de
  betrokkene (lib/players.mjs). Dat gebeurt vóór de volgende pose-beat, die de refuge al in zijn rij
  heeft. peers.js houdt het lichaam vast waar het getekend stond, ongeacht wat de rijen zeggen,
  tot de dood gespeeld is. Geen pose-bit en geen `SEA_V`: een oude pagina laat een onbekende `t`
  vallen. Het is wel nieuwe zee-code, dus **de open zee moet opnieuw uitgerold worden** voordat
  anderen het zien. Tot dan ziet de stervende het zelf en blijft het lichaam voor de anderen even
  staan en verdwijnt het.
- **Het rig.** `pose.dying = { kind, t }` in classic-avatar.js zet al het andere van de pose uit
  (geen gang, zwemslag, zit of dans). Met een gebakken clip (`gait-clips.js` `die` of `drown`)
  speelt `playClips` die één keer af (`sampleOnce`). Mixamo heeft geen verdrinkclip; `drown` is
  *Floating In Air Flailing Arms*, rechtop en spartelend, en walk.js en peers.js laten het lichaam
  zinken. `die` is *Falling Forward Death*: die valt dezelfde kant op als de procedurele val van de
  Reiziger, zodat beide lichamen op dezelfde plek liggen. De heupen van een val gaan mee omlaag met
  `drop`; een verdrinkend lichaam wordt door walk.js/peers.js gezonken. Zonder clip doet
  `dyingPose` het procedureel (de Reiziger). **Val:** de knieën begeven het (`FALL.buckle`) en het lichaam valt
  versnellend voorover om de voeten (`FALL.topple`) tot 1,45 rad. **Verdrinken:** rechtop, iets
  achterover, de armen naar het oppervlak, steeds zwakker spartelend.
- **De bake** (`scripts/bake-mixamo-gait.py`): `die` en `drown` zijn getimed (`TIMED`). Een
  vermelde clip waarvan de FBX niet op deze machine staat, houdt nu zijn gebakken rijen (KEPT).
  Een nieuwe clip vraagt dus alleen zijn eigen download, en de rest van de module blijft byte voor
  byte gelijk (nagegaan door de huidige module opnieuw te serialiseren).
- **Niet uit het WoW-pakket.** De doodsclips van `/wowhead-character-extract` zijn Blizzard-IP en
  komen niet in git, een release, de APK, de webbundel of op de zee. Hooguit als lokale referentie
  voor timing.

## Gebouwd (6 oktober 2026)

- Bovenstaande in walk.js, classic-avatar.js, main.js, net.js, peers.js en lib/players.mjs;
  `tests/dying.test.mjs` (val en weer opstaan op beide lichamen, walk mode houdt vast en geeft
  terug, zinken tot de bodem, `fell` voor de anderen en niet bij een respawn).
- **De clips** met `/mixamo-fetch` op Y Bot (FBX Binary, Without Skin, 30 fps, geen keyframe
  reduction): *Falling Forward Death* (`c9cdb289-…`, 2,57 s, eindigt liggend: heupen op 0,18
  beenlengte, romp 86° voorover) als `assets/mixamo/falling-forward-death.fbx`, en *Floating In Air
  Flailing Arms* (`c9c6d01a-…`, 3,6 s) als `floating-flailing.fbx`. Gebakken met de andere negen
  als KEPT: die zijn bit voor bit gelijk gebleven, en twee keer bakken geeft dezelfde bytes.
- Bewegingsstudio: knoppen *Vallen* en *Verdrinken* (`/avatar-motion.html`), steeds opnieuw.
  Bekeken: de Reiziger valt procedureel plat voorover, de Avonturier met de clip ook; bij verdrinken
  staat de Reiziger rechtop met de armen omhoog, en spartelt de Avonturier rechtop.

## Nog open

- Een andere doodsclip kiezen kan altijd (`list --query death` geeft er 35, met *Dying*,
  *Falling Back Death* en *Death From Front Headshot*). Houd `dyingSeconds` op hoogstens 4 s,
  zodat de sprong naar huis binnen `ARRIVE_MAX_MS` (6 s) valt.
- **De open zee uitrollen** (stack 28, met de hand) voor `fell` en de immuniteit bij aankomst.
  Komt in een volgende release (todo #170).
- Op het eiland zelf nog niet in een echte sessie gezien. Martijn loopt het na de merge zelf na,
  in promptholm.exe: een wachter op de vulkaan, en verdrinken met `?dive` (todo #171).
- Wie vlak bij de eigen refuge sterft (binnen `ARRIVE_R`), telt als meteen thuis. Zijn 5 s lopen dan
  al tijdens de animatie. Dat is zeldzaam: op het eigen plein vallen geen wachters aan.
