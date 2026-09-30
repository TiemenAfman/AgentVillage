# Verdiepingen en trappen binnen

**🚧 Status: plan van 30 september 2026, voor de Salty Kraken (`Plans/piratenkroeg.md`); wordt nu gebouwd.**

## Aanleiding

De keeper koos voor de kroeg een grotkroeg met een begane grond en twee verdiepingen (schets 4 in
`D:\git\Martijn\AgentVillage\refs\krakenkit\renders\`, richtpunt `concept-grotkroeg-2-richtpunt.jpg`): een
barterras, een kapiteinshut op de 1e verdieping boven het water, een bemanningszolder en een uitkijk op de 2e,
een kraaiennest met een touwbrug. De kapitein geeft quests, dus je moet bij hem kunnen: de verdiepingen moeten
beloopbaar zijn, niet alleen decor (optie A van de keeper).

Walk mode kende dat niet. Een hoogte stond per **cel** (1 x 1, vier meter) in `levels`, en een trap was daarom
een terras van vier meter per trede. Blockers waren muren op elke hoogte, dus een tafel beneden blokkeerde de
galerij erboven. En de camera wist alleen van de rechthoek van de zaal (`clampCam` in `interior.js`), niet van een
vloer boven je hoofd.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Vloeren en trappen | **`surfaces`**: rechthoeken met een hoogte, of een **helling** (`y0` naar `y1` langs x of z), aan walk mode gegeven met `setSurfaces`. `groundAt` neemt ze mee zoals `levels`: de hoogste die niet boven `voeten + STEP_UP` ligt. | Een trap wordt getekend als treden en gelopen als helling, zoals in de meeste spellen: elke frame is de stap klein, en naar beneden volg je hem vanzelf. Rechthoeken in plaats van cellen, want een balkon is een halve cel diep. |
| Blockers per verdieping | Een blocker mag **`y0`/`y1`** hebben: hij blokkeert alleen als je lichaam (voeten tot voeten + `BODY_H`) die hoogte raakt. Zonder die velden blokkeert hij zoals altijd, op elke hoogte. | Een tafel beneden mag de galerij erboven niet dichtzetten, en de reling boven niet de vloer eronder. Buiten verandert er niets, want daar heeft geen blocker die velden. |
| Van de rand vallen | Geen extra regel: waar geen reling staat, geeft `groundAt` de lagere vloer en val je, zoals van een rots. | Het bestaat al (in de lucht, zwaartekracht). |
| Camera onder een vloer | `clampCam` in de kamer houdt de camera **onder** elke surface die boven je voeten ligt en boven de camera's plek hangt. | Anders kijkt de camera van boven op de vloer van de galerij terwijl jij eronder loopt. |
| Praten en zitten over hoogte | Een interactable met een `y` is alleen in bereik als je voeten binnen 0.5 van die hoogte zijn. | Anders praat je vanaf de kuil met de kapitein boven je hoofd. |
| Waar het geldt | Alleen in kamers (`interior.js` geeft `def.surfaces` door). Het eiland en de zee blijven `levels` gebruiken. | Kleinste wijziging; de zee kent geen kamers en loopt niemand binnen. |
| De oude `stage` | Wordt een surface zoals de rest; `stage` in de kamerdata blijft werken. | De taverne en de rave hoeven niet om. |

## Wat het in cijfers is

- Treden: `STEP_UP` is 0.45, dus een helling mag per frame willekeurig steil zijn, maar een trap van 0.8 over 1.2
  is 34 graden en loopt natuurlijk. Een touwladder wordt een steile helling van ongeveer 60 graden.
- De kroeg is later een cascade rond een atrium geworden (18 x 14, gewelf 5, terrassen op 0.6, 1.5, 2.1 en 3.0;
  `Plans/piratenkroeg.md`). Een massief terras is voor wie lager staat een muur (`solid` in de layout, een blocker tot
  een stap onder de rand); een dek op palen heeft ruimte eronder.

## Tests

`tests/walk-surfaces.test.mjs` stuurt walk mode headless (zoals `tests/diving-walk.test.mjs`): een helling op
lopen tot de galerij, onder de galerij door lopen zonder erop te springen, van een rand vallen, en een blocker
met een hoogte die alleen op zijn eigen verdieping tegenhoudt.
