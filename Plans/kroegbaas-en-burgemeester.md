# Een kroegbaas, een burgemeester en de andere bewaarders

## Aanleiding

Tiemen wil een kroegbaas bij de kroeg op het plein en een burgemeester bij het stadhuis. Daarna
kwamen er drie bij: een medewerker bij het "goudkantoor" (de goudkuil, `civic:goldpit` - er is
geen apart kantoor), een schooldirecteur (een vrouw) bij de school en een pastoor bij de kapel.
Tot nu toe woont er niemand in een civic gebouw: `HOUSED` in `lib/crowd.mjs` slaat ze over
en de pagina verbergt elke figuur van een civic record (`applyVisibility` in `main.js`).

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wie is het? | Een figuur met het **id van het gebouw**: `civic:tavern` is de kroegbaas, `civic:townhall` de burgemeester. Welke gebouwen er iemand hebben staat één keer in `KEEPERS` (`shared/palette.mjs`). | Civic ids worden niet geredigeerd (`guestVillage` vindt er geen uuid in), dus het rooster, `/api/crowd-ids` en de pagina kennen ze al; een tweede soort id zou overal een uitzondering vragen. |
| Wie laat ze lopen? | De zee, zoals iedereen (`createCrowd` spawnt ze na de huizen). | Er is geen lokale simulatie meer; wat de zee niet loopt, bestaat op andere schermen niet. |
| Hoe zien ze eruit? | `keeperLook`: de gewone `settlerLook` van het id (gezicht, huid, lengte blijven gehasht) met een vaste dracht erover. Kroegbaas: blootshoofds, linnen hemd, bruin schort, wat steviger. Burgemeester: donkerblauwe jas, gouden bies, zwarte bolhoed. Eén functie, `residentLook(spec)`, voor de zee en de pagina. | De lengte bepaalt de pas op de zee; zee en pagina moeten dus dezelfde look uitrekenen. |
| Waar staan ze? | Voor de deur van hun gebouw, op `w / 2 + 0.35` uit het midden (een huis staat op 0.85, maar een civic lot is drie cellen breed). | |
| Welke gedragingen? | Twee vlaggen in `KEEPERS`: `serves` (de kroegbaas: bedient tijdens een verzamelmoment in plaats van mee te doen) en `tours` (burgemeester en pastoor: af en toe een rondje over het plein). Zonder vlag (goudklerk, directeur) blijven ze bij de deur en gaan ze mee naar het plein als iedereen gaat. `aside` zet de goudklerk 1,2 opzij: door de open kant van de kuil rijden de kruiwagens naar binnen. | Vlaggen in plaats van namen in de walk: een zesde bewaarder is dan één regel in de tabel. |
| Dracht van de drie nieuwe? | Goudklerk: grijsgroen met pet. Directeur: `presentation: 'woman'`, rok, bordeauxrood - zo gevraagd, dus niet aan de hash van het id overgelaten. Pastoor: zwarte soutane met het wit van de boord in de bies, blootshoofds. | |
| Wat doen ze? | Nooit wandelen naar elders, geen klussen, geen goud, geen boot (`f.post`). **Kroegbaas**: drentelt bij de deur; tijdens een verzamelmoment (koffie, lunch, thee, borrel) loopt hij rondjes over de pleintegels bij de kroeg om te bedienen, in plaats van zelf mee te doen. **Burgemeester**: loopt af en toe een rondje over het plein en gaat mee met elk verzamelmoment. | Ze horen bij hun gebouw; de rest van het dorp gebruikt het eiland. |
| Aanspreken? | E bij de figuur: je kijkt ze aan (`faceUp`, zoals bij elke inwoner). De burgemeester opent daarna het register van het stadhuis; de anderen zeggen iets over hun gebouw - de goudklerk met de telling van de kuil, de rest naar het uur en het verzamelmoment. | Het stadhuis-paneel is het werk van de burgemeester; een kroegbaas heeft geen sessie om voort te zetten. |
| Naam bij hover? | "The innkeeper" / "The mayor", met het gebouw eronder. | |

## Bestanden

- `shared/palette.mjs` — `KEEPERS`, `keeperOf`, `keeperLook`, `residentLook`.
- `shared/settlerwalk.mjs` — `spawn(..., { post, reach, radius })`, rondjes en bedienen.
- `lib/crowd.mjs` — de twee spawnen.
- `web/js/crowd-view.js` — `residentLook`.
- `web/js/main.js` — zichtbaar laten, hover-naam, interactables.
- `tests/keepers.test.mjs`.
