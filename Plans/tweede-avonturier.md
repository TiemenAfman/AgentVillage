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

Plan opgeslagen vóór implementatie. Eerst de officiële download verkrijgen; de technische integratie volgt na inspectie van de echte bronbestanden.
