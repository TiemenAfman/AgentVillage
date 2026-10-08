# Gedeelde kamers: één taverne, één Kraken, één kasteel voor de hele zee

**✅ DONE**

Gevraagd op 8 oktober 2026: "Instances zoals de taverne / kasteel / kraken moeten een gedeelde
instance zijn zodat je bij elkaar in zit. Maakt niet uit of je bij jezelf of een ander naar binnen
gaat. Anders zit je alleen maar met npcs in een ruimte. Je komt weer buiten waar je naar binnen bent
gegaan."

## Wat er mis was

De kamers gingen al als kamer over de lijn: een pose draagt `r: 'tavern'` (of `rave`,
`piratetavern`), de zee (`lib/players.mjs`) stuurt elke rij naar iedereen, en `peers.js` zet wie in
`tavern` staat in de eigen taverne-scène. Twee dingen hielden mensen toch uit elkaar:

- **De positie kreeg de ligplaats erbij.** `net.js` telt bij elke uitgaande positie het eigen berth op
  (`sceneToWorld`) en trekt bij elke binnenkomende het eigen berth eraf. Binnen een kamer zijn de
  coördinaten die van de kamer zelf, dus twee spelers in "dezelfde" taverne, elk van een ander
  eiland, stonden een eiland-afstand uit elkaar - ver buiten de muren, onzichtbaar. Alleen spelers
  van hetzelfde eiland zagen elkaar binnen.
- **Een andermans deur ging niet open.** `interactables()` liep alleen over `state.byId`, en een
  gast-eiland staat daar bewust niet in (guest-island.js). Je kon alleen je eigen taverne in.

## Besluiten

- **Eén kamer per soort voor de hele zee.** De kale naam (`tavern`, `rave`, `piratetavern`) ís de
  instance. De zee kent al `<islandId>:tavern` als vorm (`room()` in lib/players.mjs), bedoeld om
  kamers per eiland te scheiden; die gebruiken we bewust niet - per eiland scheiden is precies wat de
  keeper niet wil. De kamer is overal dezelfde scène (`ROOMS[room]()` neemt niets van het eiland
  mee), dus een positie erin betekent op elk scherm hetzelfde.
- **Een positie in een kamer gaat zonder berth over de lijn** (`indoors` in net.js): uitgaand niet
  opgeteld, inkomend niet afgetrokken (de rij heeft de kamer in slot 6). `boat` is geen kamer maar
  een stuurman buiten, en houdt het berth.
- **De zee hoeft niets.** Alles wat op de zee een positie gebruikt om iemand te raken (lava, wachters,
  adem, gevechten) vraagt `afoot`, en dat sluit iedereen in een kamer uit; een kamerpositie die nu
  bij het midden van de wereld (de vulkaan) ligt, raakt dus niets. Geen `SEA_V`, geen redeploy.
- **Een buurmans taverne, Kraken en kasteel gaan open, de rest van zijn eiland niet** (`roomDoors`
  in main.js, voor ons eigen eiland en voor elk gast-eiland, ids als `guest:<eiland>:<id>`). Het
  kasteel blijft dicht buiten de rave-uren, zoals thuis.
- **Naar buiten waar je naar binnen ging.** Dat deed `cameFrom` al (de plek vóór de deur, in de
  scène, dus ook op een ander eiland); alleen het luik van de Kraken pakte altijd onze eigen Kraken.
  Nu draagt elke Kraken-deur zijn eigen dek mee (`deck`), en `leaveInterior('deck')` gebruikt dat.

## Bekende gaten

- **Gemengde versies.** Een pagina van vóór deze wijziging stuurt binnen nog berth + kamerpositie;
  een nieuwe pagina tekent die speler dan een berth-afstand verschoven (onzichtbaar), en andersom.
  Na een release + `play`-deploy is dat weg; een patch volstaat (niets in layout, config of bundle).
- De gasten van de rave en de bemanning in de Kraken blijven per pagina je eigen NPC's: alleen de
  spelers zijn gedeeld.
