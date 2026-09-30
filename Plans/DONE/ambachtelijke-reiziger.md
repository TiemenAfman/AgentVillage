# ✅ Ambachtelijke reiziger in spel en inventory

Concept 3 is de standaardhoofdpersoon: gladde vormen, saliegroen vest, leren buideltje en verfijnde rugzak. Bestaande opgeslagen kleuren en uitrustingskeuzes blijven werken.

## Uitvoering

- De productievariant gebruikt dezelfde Blender-bouwfuncties als het gekozen concept, met minder geometrie voor het spel.
- De exporter bewaart gladde normalen, lichaamsgroepen en animatieaansluitingen. Het personage gebruikt een eigen glad materiaal met gedeelde spelbelichting.
- Hoeden, bepantsering, wapens, lopen en drinken passen bij de nieuwe verhoudingen. De oude drinkbewegingen worden naar de nieuwe handposities vertaald.
- De inventory toont hetzelfde model en dezelfde geometrie in de iconen. Outfit bevat shirt, mouwen, vest, riem en buideltje; de kleurknop verft het shirt.
- Bewoners behouden hun eigen gezichten wanneer hun Blender-model opnieuw wordt opgebouwd.

## Controle

- Volledige suite: 1.582 tests geslaagd.
- Na de laatste pasvormcorrectie: alle 19 avatar- en inventorytests geslaagd.
- Browsercontrole: alle acht iconen, hoeden, uitrustingsknoppen, zwaard/schild, shirtkleur, opslaan/heropenen en annuleren; geen browserfouten.
- Blender-export levert bij herhaling dezelfde geometrie. Een geïsoleerde herbouw behoudt alle 14 gezichtsdelen van de bewoners.
- Visuele controle van de standaardoutfit en de bepantserde variant. Screenshots in `assets/settler/inventory-preview.png` en `inventory-armour-preview.png`.
