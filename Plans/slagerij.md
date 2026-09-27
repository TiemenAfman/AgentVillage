# De slagerij

Begonnen op 25 september 2026, na de zagerij en de smidse (`Plans/zagerij.md`,
`Plans/smidse.md`), met dezelfde opzet en in dezelfde stijl als de smidse: een klein vakwerkhuis
(crème pleister, bruine balken, stenen voeten, donker leien dak met dakkapel en stenen
schoorsteen), met daarnaast de plek waar gewerkt wordt. Gevraagd als "naast de smid en de bakker"
- een bakkerij bestaat nog niet; de zagerij is de andere.

## Stand van zaken

Model en animatie staan op `/demo` (rij "Civic", "Butcher"); gebruik het Night-schuifje. **Plek
en moment op het eiland zijn nog niet besloten.** De zagerij en de smidse krijgen die intussen
(treden 55 en 60, `TRADES` in `lib/layout.mjs`: het dichtstbijzijnde vrije 3x3-blok buiten de
kavels rond het plein); de slagerij kan daarna op dezelfde manier een trede krijgen.

## Wat er te zien is

- **Het winkelhuis**: een brede etalage met een marmeren toonbank vol vlees (een ham, worst,
  lappen), een rood-wit gestreepte luifel erboven, een ossenbloedrode deur, en aan de linker
  voorhoek een uithangbord met een varken erop - geen letters, zoals overal.
- **De rokerij** rechts achter: een smal, hoog plankenhuisje op een stenen voet met een
  rookkapje op de nok. Onderin smeult het vuurtje (het gloeit en ademt), en uit het kapje
  kringelt de hele dag en nacht rook: een rokerij gaat niet uit.
- **Het rek** ernaast, een galg van twee palen en een ligger waar twee hammen en een ring rookworst
  aan drogen; ze wiegen zachtjes, elk op zijn eigen maat.
- **Het hakblok** voor de rokerij, met een stuk vlees erop en een tobbe ernaast.

## Wat er gebeurt

- **De slager**, een passieve settler die bij geen agent hoort: overdag staat hij achter het
  hakblok, met zijn gezicht naar de voorkant, en hakt drie keer, ademt even, en weer. Bij elke
  klap veert het stuk vlees in en valt er een plak af, die de vorige opzij duwt; even na de derde
  schuiven de plakken een voor een over de rand de tobbe in.
- **'s Nachts** (Night boven 0,55) laat hij niets op het blok liggen, loopt om het hakblok heen
  naar de voordeur en gaat naar binnen; de luifel rolt in (naar zijn kast tegen de gevel), en de etalage brandt. **'s Ochtends**
  (onder 0,45) rolt de luifel uit en komt hij weer naar buiten. Hetzelfde gat als bij de smid houdt
  hem uit de deuropening als het schuifje op de helft staat.
- Het uithangbord zwaait zachtjes aan zijn arm.

## Besluiten

- Zelfde patroon als de smidse: `scripts/build-butcher.py` → `assets/butcher/butcher.blend` →
  `web/js/butcher-mesh.js`, twee gemeente-assets (`civic_butcher` het huis, `civic_butcher_yard`
  de rokerij en de werkplek), elk onder de 1500.
- **Alles wat beweegt zit in de werf-asset**, ook de luifel en het uithangbord die aan het huis
  hangen: dan is er één regel (`isButcherMoving` in `buildings.js`) en blijft het huis één stil
  stuk. Elk bewegend deel heeft zijn oorsprong op zijn eigen as (het scharnier van de luifel, de
  haak van een ham, de arm van het bord), zodat de gebakken `at` het draaipunt is.
- **Waar de slager staat, hakt en naar binnen gaat komt uit de bake**: het hakblok is een eigen,
  stil onderdeel met zijn oorsprong op het hakvlak, de voordeur is `anchor.door` op het huis, en
  waar de rook uitkomt is de oorsprong van het (stille) rookkapje. De route naar de deur: een stap
  terug van het blok, opzij tussen blok en rokerij door, door de gang tussen huis en blok naar
  voren en langs de gevel naar de deur - lopend is hij breder dan diep, dus recht opzij vanaf zijn
  plek schampte zijn schouder het blok. De test rekent na dat geen stuk door het blok, de rokerij
  of het huis gaat.
- **Het hakblok staat op heuphoogte** (0,14), niet op de 0,22 van het aambeeld: gemeten aan de
  rig zelf komt het hakmes onderin de zwaai op ~0,12 uit, dus op aambeeldhoogte zat het blad in
  het hout. De test meet dat het blad op de snijkant van het vlees neerkomt.
- **De rook is van de slagerij zelf** (een kleine `InstancedMesh` van grijze wolkjes, één draw
  call), niet van `anchor.smoke`: de modelplaat tekent geen schoorsteenrook, en het eiland rookt
  alleen uit een gemeentegebouw als er een vuur is. `anchor.smoke` staat gewoon op de schoorsteen
  van het huis, zoals bij de smidse.
- **De slager is de spelersrig** (`createClassicAvatar`) op 0,72 van de spelersmaat, in een wit
  schort en een wit mutsje (de bies donker: de rig verft er zijn benen mee), met een **hakmes** in de rechterhand. Het hakmes is een
  nieuw procedureel handvoorwerp in `classic-avatar.js`, maar staat bewust niet in `HAND_ITEMS`:
  een speler kan het niet kiezen, dus de inventaris, de zee (`lookOf`) en `normalizeAvatar` weten
  er niets van, en de slager krijgt het ná `normalizeAvatar` in zijn hand. Zijn hak is de
  bestaande `attack()`-zwaai.
- **De plakken** zijn een vaste pool van drie, uit één gebakken plak; niets verschijnt uit het
  niets: een plak groeit uit het snijvlak en krimpt weg in de tobbe.
- **De luifel rolt in door te schalen** (diepte en hoogte samen, om het scharnier), niet door te
  draaien: omhoog geklapt steekt hij door de dakrand, omlaag geklapt is het een luik.
- Het vuurtje in de rokerij is `aEmissive` die tijdens het draaien meebeweegt, zoals de kolen
  van de smidse; de nacht is `uNight` van het gedeelde materiaal.

## Later

- Plek en trede op het eiland, via `TRADES` zoals de zagerij en de smidse, en in `main.js`
  `attachExtras`/`animateExtras`/`disposeRecord` en `guest-island.js` zoals zij.
- Een bakkerij in dezelfde reeks, met een bakker bij de oven.
