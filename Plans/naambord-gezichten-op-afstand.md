# Naambordjes: het gezicht alleen waar je het kunt lezen

**🚧 Status: plan, 29 september 2026 — nog niet gebouwd.** Eerst de keuzes onder *Te besluiten*.
Dit is het eenvoudige alternatief voor stap 3 van [gebouwen-in-een-batch.md](DONE/gebouwen-in-een-batch.md)
(de gezichten in een atlas).

## Waar dit vandaan komt

Na [gebouwen-in-een-batch.md](DONE/gebouwen-in-een-batch.md) zitten paal en bord van elk naambordje in
de batch van het eiland, maar het beletterde gezicht is nog een eigen mesh: een vlak met een
`MeshBasicMaterial` en een eigen canvas-textuur van 512x202 (`nameplate.js`). Op Hoogezand zijn dat
399 gezichten, 399 calls in de kleurpas (geen schaduw), en nu de grootste groep calls.

Gemeten op 29 september (kopie van Hoogezand, Chrome van de DevTools-MCP vooraan, 1280x800, de
gezichten in dezelfde pagina zeven keer om de beurt aan en uit, gepaard verschil):

| Standpunt | met gezichten | zonder | scheelt |
|---|---|---|---|
| Van boven | 20,9 ms | 15,8 ms | ~4,3 ms |
| Van boven, `?modest` | 17,3 ms | 14,5 ms | ~4,2 ms |
| Dorp (35 van het stadhuis, 38 gezichten in beeld) | | | in de ruis |
| Te voet | | | 0 |

De atlas zou die calls samenvoegen, maar vraagt een keuze tussen scherpte en geheugen, uploads per
vakje, een marge tegen doorlopende mipmaps en een verdeler om te onderhouden - voor een winst die er
alleen van boven is. Van boven is een gezicht een paar pixels breed en de tekst onleesbaar. Dus:
**teken het gezicht niet waar niemand het kan lezen.**

## Het idee

1. **Per frame, per bordje: hoe breed is het gezicht op het scherm?** Met de verticale FOV (45°) en
   de hoogte van het venster: `px = breedte * innerHeight / (2 * tan(fov / 2) * afstand)`. Een
   gewoon gezicht is 0,81 breed (het bord 0,86 maal 0,94), dat van een kamp 0,57. Op 1280x800 is
   dat ~780 / afstand pixels: 13 px op 60, 24 px op 32, 65 px op 12. Het dorpsbeeld op 35 ligt
   dus precies in de fade: de bordjes vlak bij het stadhuis blijven, verder weg vallen ze weg.
2. **Onder een drempel weg, erboven vol, ertussen een fade.** Voorstel: vol vanaf 24 px, weg onder
   16 px. Het gezicht heeft al een eigen materiaal en is al `transparent`, dus de fade is
   `faceMat.opacity`, zonder hercompilatie; onder de drempel `face.visible = false`, en dan is ook
   de call weg. In pixels en niet in eenheden, zodat een groter venster of een ander scherm
   dezelfde leesbaarheid houdt.
3. **Wat je van veraf ziet blijft hetzelfde bordje.** Het gezicht is een crème plaquette met een
   donkere rand; zonder gezicht is het bord bruin hout. Daarom komt er in de frame-geometrie (de
   gedeelde vorm in de batch) een crème vlakje van dezelfde maat, net achter het gezicht (z 0,016
   tegen 0,017). Dichtbij ligt het gezicht erop, van veraf zie je alleen het vlakje: dezelfde
   crème spikkel als nu. Het kost geen call en geen textuur - het zit in de vorm die de batch al
   tekent.
4. **Waar in de frame:** een functie in `main.js` vlak vóór `cullRecords()`, dus als de camera staat
   waar hij getekend wordt; alleen voor records die niet geknipt zijn (`rec.cull`). De rekensom
   (pixels → doorzichtigheid) is een pure functie zonder DOM, met een test, zoals `fadeAmount` in
   `fade.js`. `createNameplate` geeft daarvoor zijn `face` en de breedte van het gezicht terug.

Kosten per frame: een afstand en een deling per bordje (~400), en alleen een schrijfactie als de
doorzichtigheid verandert - tientallen microseconden.

## Wat het oplevert en wat niet

| | deze route | de atlas |
|---|---|---|
| Van boven | ~4 ms (alle gezichten weg; het vlakje zit in de batch) | ~3,5-4 ms |
| Ingezoomd en te voet | niets, en niets nodig | niets |
| Scherpte dichtbij | zoals nu | zoals nu, of zachter bij minder geheugen |
| Geheugen | zoals nu (~219 MB aan canvassen) | ~89-270 MB, afhankelijk van de resolutie |
| Code | een pure functie, ~20 regels in de frame, een vlakje in `frameGeometry` | een atlasmodule: vakjes, uploads per vakje, marges, opruimen |
| Risico | een zichtbare overgang op de drempel | randjes van buurvakjes, haperen bij een upload |

Het geheugen van de canvassen blijft staan. Dat was nooit het probleem van deze meting, en het is
een los punt voor later (ze vrijgeven als een bordje lang niet getekend is).

## Te besluiten

1. **Het crème vlakje, of gewoon bruin hout van veraf?** Zonder vlakje is het nog eenvoudiger,
   maar dan verandert het dorp van boven: de crème spikkels van ~400 bordjes worden bruin. Voorstel:
   het vlakje.
2. **Dag en nacht.** Het gezicht is `MeshBasicMaterial`: onverlicht, 's nachts even licht als
   overdag. Het vlakje is het gebouwmateriaal en wordt 's nachts donker, dus bij het uitzoomen in
   het donker dimt een bordje op de drempel. Te verhelpen met een `aEmissive` tussen 0 en 1 op het
   vlakje (mag op runtime-geometrie, niet in een bake), af te stellen met screenshots om 13:00 en
   21:00. Of: accepteren, want op de drempel is het ~16 px groot.
3. **De drempel.** 24 → 16 px is een voorstel. Hoger houdt meer gezichten weg (sneller, eerder
   onleesbaar), lager houdt ze langer (mooier bij het inzoomen).
4. **De naamborden boven de wijken** (40 bogen, `hamlets.js` via `createNameplate` met `arch`)
   blijven erbuiten: het zijn er weinig, en boven de wijk hangt van boven al het HTML-onderschrift
   dat tegen die borden in overvloeit (`hamletCaptions`, 30 → 46 van het doel).

## Controle, als het gebouwd wordt

- Van boven dezelfde meting als hierboven: verwachting ~4 ms, en 745 → ~346 calls in de kleurpas.
- Inzoomen op een bordje: geen sprong, het gezicht komt op de drempel uit het vlakje; overdag en 's
  nachts (`?hour=13`, `?hour=21`), full en `?modest`, en in first person.
- Een nieuw bordje, Settings → House signs aan en uit, de planner (verbergt ze), de tijdlijn.
- De test op de pure functie, en `node --test "tests/*.test.mjs"` groen.

## Versie

Alleen paginacode; niets op de lijn, niets in `layout.json`, `config.json` of de bundle. Past in een
patch.
