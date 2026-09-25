# De smidse

Begonnen op 25 september 2026, na de zagerij (`Plans/zagerij.md`), met dezelfde opzet. Referentie:
een klein vakwerkhuis (crème pleister, bruine balken, stenen voeten, donker leien dak met
dakkapel en stenen schoorsteen) met tegen de rechtergevel een open afdak waar gewerkt wordt.

## Stand van zaken

Model en animatie staan op `/demo` (rij "Civic", "Smithy"); gebruik het Night-schuifje. **Sinds 25
september op het eiland: een trede op 60 settlers**, na de zagerij (55), op een 3x3-blok vlak
buiten de kavels rond het plein - de afwegingen staan in `Plans/zagerij.md`. Het vuur heeft zijn
eigen licht, dus een eiland met een smidse (ook dat van een buur) kost één licht meer: één keer
opnieuw compileren als hij verschijnt, geen prijs per frame.

## Wat er gebeurt

- **De smid**, een passieve settler die bij geen agent hoort: overdag staat hij aan het aambeeld
  en slaat drie keer, ademt even, en weer; bij elke klap spatten er vonken van het aambeeld.
- **Het oventje** gloeit in zijn opening en ademt mee met de blaasbalg, die pompt zolang hij
  werkt; er stijgen sintels uit op, en een warm licht valt over het afdak (vooral 's nachts).
- **'s Nachts** (Night boven 0,55) loopt hij via de voorkant van het afdak naar de voordeur en gaat
  naar binnen. De blaasbalg stopt en het vuur zakt in ~20 s terug naar een nagloed die nooit helemaal
  uitgaat. **'s Ochtends** (onder 0,45) komt hij weer naar buiten. Het gat tussen die twee houdt
  hem uit de deuropening als het schuifje op de helft staat.
- De lantaarn onder het afdak zwaait zachtjes; de schoorsteen heeft een `anchor.smoke`.

## Besluiten

- Zelfde patroon als de zagerij: `scripts/build-smithy.py` → `assets/smithy/smithy.blend` →
  `web/js/smithy-mesh.js`, twee gemeente-assets (`civic_smithy` 724, `civic_smithy_yard` 712).
  Bewegende delen (blaasbalg, vuur, lantaarn) zitten in de afdak-asset en `buildings.js` laat ze
  uit de merge (`isSmithyMoving`); `web/js/smithy.js` hangt ze op hun eigen as.
- **Waar de smid staat en naar binnen gaat komt uit de bake**: het aambeeld is een eigen, stil
  onderdeel met zijn oorsprong op het slagvlak, en de voordeur is `anchor.door` op het huis.
- **De smid is de spelersrig** (`createClassicAvatar`) met een hamer in de rechterhand, op 0,72 van
  de spelersmaat: zo groot als de dorpelingen, en hij past onder deur en afdak. Zijn klap is de
  bestaande `attack()`-zwaai; geen nieuwe animatie.
- **Het nagloeien** zet de `aEmissive`-waarden van het vuur tijdens het draaien lager (een bake
  mag alleen 0 of 1, de shader neemt elke waarde) en dimt het licht mee. Het licht staat vanaf het
  begin in de scène op 0, zoals de fakkel, omdat three.js alle materialen opnieuw compileert als
  het aantal lichten verandert.
- De nacht is `uNight` van het gedeelde materiaal, hetzelfde getal dat de ramen laat branden.

## Later

- Meer passieve settlers volgens dit patroon: de zager bij de zaagbank, iemand die de band vult.
