# De regisseur: een camera die zelf gaat kijken waar wat gebeurt

**✅ Status: gebouwd op 28 september 2026.**

## Wat Tiemen vroeg

> Ik wil dat als je geen interactie uitvoert met het eiland de camera zelf focust op plekken
> waar wat te doen is. Dus na x seconden focus op de werf of op de smit die goud weg brengt of
> op een random werkende inwoner of op de geit of op de vissershut (moet nog een visser voor
> komen) of op een net arriverende inwoner enz. Zodat een statische overview begint te leven.

Twee dingen: (1) een camera die na een tijd niemand-doet-iets zelf naar iets levends gaat en het
volgt, en (2) een visser bij de vissershut, want daar leeft nu niets.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wanneer | Na `IDLE_S` (45 s) zonder muis, wiel, aanraking of toets, alleen van boven (`state.mode === 'orbit'`), niet tijdens de intro en niet met een paneel of dossier open. | Wie aan het kijken is, moet niet weggetrokken worden; wie weg is, krijgt een eiland dat leeft. |
| Stoppen | Elke invoer stopt de regisseur meteen, en de camera blijft staan waar hij is. De teller begint opnieuw. | Een camera die terugspringt naar waar hij was, is een tweede verrassing na de eerste. |
| Wat hij kiest | Een lijst bronnen, elk met een gewicht: een net aangekomen inwoner (voorrang, zolang hij nog loopt), de goudvracht als die rijdt, de houtkar onderweg of bij het laden/lossen, de werf met zijn werknemers (overdag), een werkende inwoner (hamer, schoffel, bijl, hengel, kruiwagen), een verhaaldier (de geit het liefst), de visser. Nooit twee keer hetzelfde achter elkaar. | Precies de lijst uit de vraag; de rest ligt klaar om er later bij te zetten. |
| Hoe hij kijkt | Hij vliegt er in `FLY_S` heen en blijft `HOLD_S` (16 s) op het doel, dat hij volgt als het beweegt, terwijl hij langzaam om het doel draait, op een vaste hoogte en afstand - een inwoner, dier of de visser van dichterbij (`CLOSE`, 5) dan de houtkar of de werf (`SHOT_DIST`). Verdwijnt het doel (de vracht is klaar, de inwoner ging naar binnen), dan kiest hij meteen het volgende. | Een vaste afstand en een trage draai lezen als een camera met een bedoeling; een sprong naar een doel leest als een fout. |
| Een onderschrift | Een regel onderin ("The timber wagon on its way to the shipyard"), zolang hij een doel volgt. | Anders weet een kijker niet waarom de camera daar is. |
| Uit te zetten | Settings → From the sky → **Wander by itself**, per browser (`promptholm.director`), standaard aan. | Zoals de YOU-pijl: het verandert wat deze pagina doet, niet het eiland. |
| Waar het draait | `web/js/director.js`: het kiezen en het bewegen, zonder DOM en zonder three.js-camera, zodat het te testen is. `main.js` geeft het de bronnen en de invoer. | Alles is van de pagina en op het eiland van jezelf; niets op de lijn. |
| De visser | `web/js/fisher.js`, de smid-aanpak: een dorpeling met een hengel (`rod`, een gereedschap van dorpelingen zoals de houweel, niet in de inventaris) aan de waterkant voor de hut. Hij werpt uit, wacht, haalt op en werpt weer uit; 's nachts gaat hij naar binnen. | "Moet nog een visser voor komen": een hut waar niemand is, is geen plek om naar te kijken. |

## Wat er bij het bouwen bij kwam

- **Proberen zonder te wachten:** `?director=5` laat hem na vijf seconden beginnen in plaats van na 45.
- **Alleen op je eigen eiland een visser:** hij zoekt de waterkant op de grond van de pagina, en de
  hut van een buureiland staat op grond die niet `groundAt` is. Daar blijft de hut zoals hij was.
- **Bekeken** op een testeiland van 124 settlers: de regisseur ging van de werf naar de houtkar,
  de goudvracht, de visser en een inwoner die schoffelde, nooit twee keer hetzelfde achter elkaar,
  met het onderschrift eronder. De verhaaldieren waren er op dat eiland nog niet.

## Tweede ronde (29 september 2026)

> na elke focus op een inwoner/werker moet het overview van het eiland weer getoond worden. als
> er geen activiteit is mag de camera langzaam om het eiland heen draaien.

| Vraag | Besluit | Waarom |
|---|---|---|
| Tussen twee shots | Na elk shot vliegt hij in 5 s terug naar het hele eiland (het beeld van `frameIsland`) en draait daar `OVERVIEW_S` (12 s) langzaam omheen (`OVERVIEW_RATE`, een rondje in drie minuten), dan pas het volgende shot. | Het eiland is het onderwerp; een shot is een uitstapje ernaartoe, en een rij close-ups achter elkaar liet nooit zien waar ze lagen. |
| Niets te doen | Blijft hij om het eiland draaien, zonder opnieuw te vliegen, en kijkt elke `OVERVIEW_S` of er iets begint. | "Mag de camera langzaam om het eiland heen draaien." De vaste gebouwen die eerst als reserve dienden (stadhuis, taverne, …) zijn daarmee weer weg: dat was stilstaan op iets waar niets gebeurde. |
| Een wandelende inwoner | Blijft een shot (licht gewogen). | Iemand die loopt, is iets dat gebeurt. |
| Het centrum | Af en toe een shot van het plein (`town.centre`) van `CENTRE_DIST` (22) en wat hoger, hooguit eens per `CENTRE_EVERY` (2 min), gerekend vanaf het moment dat hij er echt naar kijkt. | "Neem ook af en toe een shot van het centrum mee." Het plein is er altijd; zonder die pauze wisselde een stil eiland alleen nog plein en overzicht af. |

## Derde ronde: de smid en de bakker

> neem ook de smid en de bakker mee als shot.

Twee shots zoals de visser: alleen terwijl ze aan het werk zijn (`mode` 'work'; 's avonds lopen
ze naar binnen en gaat het shot mee weg), van dichtbij (`CLOSE`). Het eerste beeld van de smid was
een dak: de camera kwam van waar hij toevallig stond en de smidse stond ertussen. Een shot kan
daarom een kant noemen (`az`): de camera vliegt naar die kant en draait er een halve slag omheen,
met die kant in het midden. Voor de smid en de bakker is dat de kant van het gebouw waar ze staan,
gemeten vanaf het midden van het gebouw.

## Vierde ronde: de slager en de goudsmid

> neem ook de slager en de goudsmid mee als shot

De slager gaat zoals de smid en de bakker (`TRADESMEN`, `rec.butcher`). De goudsmid hoort bij de
cast van de goudvracht (`goldrun.js`), dus die wordt gevraagd aan `goldRun.smithAt()`: waar hij
tussen twee vrachten bij zijn mal staat, en null binnen, onderweg of tijdens een vracht (dan
volgt het goud-shot hem al). Beide van de kant van hun gebouw waar ze staan.

## Later

- Een aankomende inwoner per boot (`sailIn`) wordt gevolgd zodra zijn figuur er is; de boot zelf nog niet.
- Meer bronnen: de rave op zaterdagnacht, de smid, een boot die uitvaart.

## Versie

Alleen paginacode; niets op de lijn, niets in `layout.json` of de bundle. Een patch mag dat.
