# 🚧 Twee selecteerbare personages

## Doel

Voeg het door Tiemen gekozen Sketchfab-model als tweede personage toe naast de huidige reiziger. Bewaar het huidige personage als standaard. Pas het nieuwe model in Blender aan tot een eigen eilandavonturier en behoud lopen, rennen en de inventory.

## Bron

- Model: Link, door 1_clicks_ (@ZENTA-_-).
- https://sketchfab.com/3d-models/link-c14d3de2cfc546ad94c3c9be4f24496a
- De modelpagina vermeldt Download 3D Model en CC Attribution. Bewaar de precieze licentie, maker, bronlink en wijzigingen bij de geïmporteerde bestanden.
- Verkrijg het originele model via de officiële download. Controleer daarna formaat, textures, onderdelen, botten, huidgewichten en eventuele animaties. Als hiervoor een ingelogde download nodig is, vraag het gedownloade archief aan Tiemen; ga niet uit van toegang tot de viewerbestanden.

## Werkwijze

1. Werk op branch `feat/tweede-avonturier`. Sla dit plan vóór de implementatie op en commit het afzonderlijk.
2. Importeer de download in Blender en bewaar een bewerkbare bron plus een reproduceerbaar bewerkings-/exportscript. Meet schaal, oriëntatie, materialen en rig voordat de runtimevorm wordt gekozen.
3. Geef de nieuwe avonturier een eigen uiterlijk: donkerder haar, minder puntige oren, een aangepaste haarlijn en gezichtsvorm, een andere kraag en riem, en een palet met leisteenblauw, zand en bruin. Vervang herkenbare emblemen en eventuele kenmerkende hoofddeksels/accessoires door eenvoudige eilanduitrusting. Behoud de kwaliteit en beweeglijkheid van het bronmodel.
4. Voeg in de inventory twee zichtbare karakterkeuzes met previews toe: Reiziger en Avonturier. De gebruiker kan direct wisselen, opslaan en annuleren. Bestaande opgeslagen outfits openen op de Reiziger; bewaar kledingkeuzes passend per karakter waar de pasvorm verschilt.
5. Breid de avatarfabriek en opslag uit met een genormaliseerde karakter-id en een veilige standaard voor onbekende waarden. Controleer de multiplayer-overdracht en compatibiliteit, zonder eilanddata of protocolversie te wijzigen.
6. Gebruik voor beide modellen de bestaande afstandgestuurde loop- en renbewegingen. Koppel de nieuwe rig aan benen, armen, handen en hoofd; stem voetcontact, ooghoogte, eerste persoon en uitrustingspunten op zijn proporties af. Controleer ook zitten, zwemmen, fietsen en actieposes.
7. Pas kleding, hoeden en handvoorwerpen op de nieuwe lichaamsvorm aan. De inventory en spelwereld gebruiken dezelfde assets. Exporteer via Blender; wijzig gegenereerde meshbestanden niet handmatig. Houd de synchrone laadroute zonder nieuwe runtime-loader waar mogelijk; onderzoek de texture-export op basis van de echte download.
8. Toon beide modellen naast elkaar in de bewegingspreview, met kiezen, lopen, rennen en inventory. Controleer pasvorm en beweging visueel.
9. Test opslagmigratie, karakterselectie, opslaan/annuleren, multiplayer, rig, grondcontact, uitrusting, deterministische export en bestaande regressies. Werk documentatie en dit plan bij.

## Acceptatie

- Precies twee werkende personages; de bestaande reiziger blijft beschikbaar.
- De nieuwe keuze is daadwerkelijk gebaseerd op het aangeleverde Sketchfab-model en zichtbaar aangepast.
- Beide personages werken op het eiland en in de inventory; voeten en verplaatsing blijven op elkaar afgestemd.
- Bronbestanden, credits en reproduceerbare export staan op de nieuwe branch.
- Visueel gecontroleerde previews en geslaagde relevante tests; geen merge naar main zonder opdracht.

## Status

Gebouwd op `feat/tweede-avonturier` (30 september 2026), nog niet naar main.

- **Bron.** De download staat ongewijzigd in `assets/adventurer/source-link.glb`. De metadata in
  het bestand noemt **A_CAT564** als maker (CC BY 4.0), niet de uploader die hierboven staat;
  `assets/adventurer/CREDITS.md` noemt beide, met de lijst wijzigingen. Het is een fanmodel van
  een bestaand Nintendo-personage: de CC-licentie dekt het model, niet het personage zelf, en de
  aanpassingen hieronder zijn ook daarom gedaan.
- **Blender.** `scripts/build-adventurer.py` bouwt alles opnieuw uit de GLB naar
  `island-adventurer.blend` en `web/js/adventurer-mesh.js` (via `export-adventurer.py`);
  twee keer bakken geeft dezelfde bytes. Schaal 0,285 × 0,92 (haar tot 0,45, iets boven de
  Reiziger), armen 43° omlaag uit de A-pose, 124 botten teruggebracht tot drie gewrichten per
  ledemaat, textuur als hoekkleur (gezicht één keer onderverdeeld: 33,5k driehoeken in totaal,
  700 kB gzip naast de 550 kB van de Reiziger).
- **Eigen uiterlijk.** Tuniek egaal leisteenblauw (embleem weg), haar donkerbruin, broek zand,
  riemen, armbeschermer en handschoenen bruin leer met gewoon messing; oren klein en rond en
  paardenstaart en bakkebaarden korter, via de eigen oor-, staart- en bakkebaardbotten; zwaard,
  schild, schede en oorbel weggelaten.
- **Uitrusting.** Hoeden op de maat van het hoofd (een maat ruimer, over het haar), rugzak en
  borstplaat vanaf de schouders tegen de rug, schouderstukken kleiner, beenstukken langs het
  been, sabatons laag. Handvoorwerpen zijn in beide handen die van de Reiziger.
- **Runtime.** `web/js/player-bodies.js` is de tabel; `normalizeAvatar` houdt `character` bij
  (onbekend of ontbrekend = Reiziger, dus oude opgeslagen looks openen op de Reiziger);
  `createClassicAvatar` wisselt het hele rig in dezelfde ouder; walk.js en peers.js lezen
  heup- en ooghoogte van het rig. De zee geeft `character` door als slug (`lookOf`); geen
  protocolversie, geen eilanddata. **De open zee moet opnieuw uitgerold worden** voordat
  anderen iemand als Avonturier zien; tot dan tekent iedereen de Reiziger.
- **Inventory.** Bovenaan twee portretten (Traveller, Adventurer); kiezen trekt direct aan,
  Never mind zet ook het lichaam terug. Huid- en outfitverf verdwijnen bij de Avonturier, want
  zijn lijf is geschilderd, niet geverfd. Alle andere keuzes gaan mee naar het andere lichaam.
- **Bewegingsstudio.** `/avatar-motion.html` laat beide naast elkaar lopen en rennen, met
  *Dichtbij* per personage; de inventory kleedt het gekozen lichaam aan.
- **Tests.** `tests/characters.test.mjs` (keuze en terugval, oude opslag, onderdelen van de
  bake, grondcontact bij lopen en rennen, wisselen in dezelfde ouder, alle inventory-iconen op
  beide lichamen, verf, de zee, credits); de hele suite slaagt op `plan-scan` na, die in de
  volle run op `scan.lock` wacht en los slaagt.

### Beweging uit Mixamo (1 oktober 2026)

- **Skelet.** Het rig heeft nu een bekken, onderrug, borst en nek (de romp is gevild op die vier
  botten), sleutelbeenderen en tenen; benen, armen, hoofd, rugzak en borstplaat hangen aan
  *mounts* die precies de verandering van hun bot volgen, zodat elk draaipunt zijn oude plek
  houdt. Dat geldt voor beide lichamen; de Reiziger beweegt verder procedureel zoals voorheen.
- **Clips.** `assets/mixamo/` (FBX, binair, zonder skin) + `clips.json` →
  `scripts/bake-mixamo-gait.py` → `web/js/gait-clips.js`: per gewricht de rotatie t.o.v. de
  ouder, armen en benen eerst van T-pose naar hangend gezet, de spiegeling van het rig
  verrekend. Lopen, rennen en sprinten op afstand (de voet glijdt nooit), stilstaan, staande en
  rennende sprong, schoolslag en graven op tijd. Nagemeten: botrichtingen van ons rig en Mixamo
  op hetzelfde moment komen binnen 0,1 overeen.
- **Snelheden.** Lopen is Mixamo's eigen 0,43; rennen 1,8 en sprinten 2,7 (twee keer op verzoek verhoogd, ruim sneller dan
  Mixamo's 0,90 en 1,41 op dit been), met de paslengte van de clip en dus een hogere cadans.
  Shift met stamina is sprinten, zonder stamina rennen; een route vanuit de lucht sprint altijd
  en kost geen stamina.
- **Sprong.** De snelheid bij het afzetten blijft in de lucht (stuur met `AIR_STEER`); uit
  stilstand de staande sprong, op snelheid de rennende, elk over de eigen vluchttijd.
- **Graven** speelt Mixamo's tweehandige schep (gespiegeld met links), de worp op `DIG_THROW`;
  de schep ligt tussen beide handen. **Zwemmen** is de schoolslag zonder de vaste kanteling
  (walk.js kantelt een zwemmer al), sneller naarmate je harder zwemt; stil in het water gaat hij over
  in Mixamo's **watertrappen** (op `pose.treading`, dezelfde overgang als walk.js tussen liggen en rechtop),
  met de 31 graden voorover die de clip zelf heeft. walk.js en peers.js geven een lichaam met een eigen slag
  (`strokes`) alleen de helling, niet de rol en het knikken van de Reiziger: die liepen op een eigen ritme
  over de clip heen en gaven een wiebel. De bake haalt bij de schoolslag alleen de helling van het bekken
  weg, niet zijn rol, zodat de schoudergordel net als bij Mixamo ligt.
- **Voeten** worden na het poseren op de grond gezet (`plantFeet`): Mixamo's hoeken op onze
  verhoudingen lieten een voet een centimeter in de grond.
- **Skill** `.claude/skills/mixamo-clips/`: hoe een nieuwe clip erbij komt.

### Nog open

- Op het eiland zelf (walk.js: fiets, zwemmen, zitten, eerste persoon) is het nog niet in een
  echte sessie bekeken; de bewegingsstudio en de tests wel.
- Per lichaam aparte kledingkeuzes bewaren is niet nodig gebleken: alles past op beide.
- De maker op de modelpagina nog eens naast de metadata leggen.
