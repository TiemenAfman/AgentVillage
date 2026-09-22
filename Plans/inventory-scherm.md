# Het inventory-scherm: een RPG-inventory in plaats van een kleurenformulier

## Aanleiding

Het paneel achter de `I`-toets en de Avatar-chip (`web/js/studio.js`) heette "Your settler"
en zag eruit als een instellingenformulier: een kleine turntable links, rechts rijen ronde
kleurbolletjes, tekst-pills voor de hoedvorm en 40px-vierkantjes met emoji voor de
uitrusting. Functioneel, maar niet wat `Plans/uitrusting-en-vasthouden.md` voor ogen had:
"een equipment-UI, RPG-stijl".

Martijn gaf als referentie een screenshot van het inventory van Titan Quest 2 — donkere
stenen lijst met pilaren, een metalen kopplaat INVENTORY, het personage groot in het midden,
per kant een kolom slots, drankjes onderin de hoeken — en tekende daar zelf ronde
"colorpick"-icoontjes bij op een paar slots: een regenboogring die een popup opent om de kleur
van dat item te kiezen. De bolletjes moesten weg; de huidkleur mocht ook zo'n kiezer krijgen.

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Wat toont een slot? | Een **render van de echte mesh** (de hoed in de gekozen kleur, het harnas, het zwaard), via een tweede offscreen renderer die alleen leeft zolang het paneel open is. | Een emoji of een getekend icoontje zegt "hier hoort een hoed"; een render zegt welke, en in welke kleur. |
| Wat doet klikken op een slot met meerdere keuzes (hoofd, handen)? | Een **popup met keuzetegels** naast het slot, met dezelfde renders. | Negen hoedopties doorklikken is onhandig; een rij losse knopjes is het oude formulier. |
| Waar zitten de kleuren? | Op het slot dat ze kleuren: hoedkleur op HEAD, tunickleur op een TUNIC-slot. Huid en leer (`trim`: riem, broek, laarzen, banden, grepen) als **twee flesjes onderaan het podium**, waar TQ2 de drankjes heeft. | Elke kleur één duidelijke plek; huid en leer horen bij geen enkel uittrekbaar stuk. |
| Nep-slots? | **Nee.** Geen ringen, geen amulet, geen wapenwissel I/II. | Een slot dat niets kan veranderen is decor dat liegt; de bestaande CSS-regel zei dat al. |
| Hoofd-slot aan/uit? | Weg. "Bare-headed" is één van de acht tegels. | Een aparte toggle naast een kiezer met een "niets"-optie is twee knoppen voor één keuze. |
| Waar staat de slottabel? | `web/js/inventory.js`, DOM-vrij, met `tests/inventory.test.mjs`. | Zo kan een test vasthouden dat elke `equip`-sleutel precies één slot heeft en elke swatch precies één dye-knop — een stuk dat morgen aan `DEFAULT_AVATAR` wordt toegevoegd kan het scherm dan niet stil missen. In `avatar.js` kan het niet (dat wordt door `classic-avatar.js` geïmporteerd, en de tabel heeft diens onderdelenlijsten nodig). |
| Escape | Sluit eerst de popup, dan pas het paneel; nooit walk-mode. | De popover vangt Escape in de capture-fase op `window`, vóór studio's eigen listener en vóór `walk.js`. |
| Ornamenten | Pure CSS + inline SVG; de enige bitmap is de bestaande `stone-stacked.png` als adering op de pilaren. | Geen nieuw asset-pad, niets dat bij boot geladen wordt; de markup bestaat pas na `open()`. |

Twee dingen die onderweg bleken en nu een regel zijn:

- **`renderer.dispose()` geeft de WebGL-context niet vrij** — alleen `forceContextLoss()`
  doet dat. Het oude paneel liet dus bij elke open één context achter; Chrome gooit boven
  zestien de oudste weg, en dat is uiteindelijk die van het eiland zelf. Beide renderers
  van het inventory (de nis en de iconen) sluiten nu zo.
- **Een hoeddeel komt alleen uit `buildFigure` als `spec.hatShape` zijn variant noemt.** Een
  tegel voor een hoed die je níét draagt moet de vorm dus op de spec forceren, anders komt er
  een lege geometrie uit. De test rendert elke tegel en eist een niet-lege geometrie.

## Indeling

| Positie | Slot | Staat | Klik | Dye |
|---|---|---|---|---|
| links | HEAD, CHEST, LEGS, LEFT HAND | `hatShape`, `equip.chestplate`, `equip.leggings`, `equip.leftHandItem` | picker, toggle, toggle, picker | `hat` op HEAD |
| rechts | BACK, TUNIC, FEET, RIGHT HAND | `equip.backpack`, altijd gedragen, `equip.boots`, `equip.rightHandItem` | toggle, dye-popup, toggle, picker | `tunic` op TUNIC |
| podium | SKIN-flesje, LEATHER-flesje | `skin`, `trim` | dye-popup | — |

Een dye-popup blijft open na een keuze (kleuren vergelijk je op de figuur); een item-picker
sluit na een keuze (dat is een besluit).

## Bestanden

- `web/js/inventory.js` — de slottabel, `slotIcon`/`optionIcon` (wat een slot of tegel
  toont), `iconDyes`/`iconKey` (welke kleuren een icoon leest → wanneer het veroudert),
  `iconGeometry`.
- `web/js/popover.js` — één popover tegelijk, `position: fixed` in `body`, plaatsing met
  flip en clamp, sluit op klik buiten / Escape / focus weg / resize.
- `web/js/studio.js` — de markup en wiring; `makeIcons()` (orthografische offscreen renderer,
  `drawImage` in het canvas van elk slot) naast het bestaande `makePreview()`.
- `web/js/classic-avatar.js` — exporteert `PIECE_PARTS`, `HELD_ITEM_PARTS` en
  `heldItemGeometry`; verder ongewijzigd.
- `web/css/ui.css` — het `.av-*`-blok is vervangen door `.inv-*` en `.popover`.
- `tests/inventory.test.mjs`.

## Verificatie

`node --test "tests/*.test.mjs"`; dan in de browser (`?nointro`, `I` in walk-mode en de
Avatar-chip in sky-mode): elk slot toont een render, gedimd als het stuk niet gedragen wordt;
een hoedkleur hertint het HEAD-icoon, leer hertint grepen, banden en riem; de popup flipt aan
de schermrand en sluit op Escape zonder het paneel mee te nemen; op 375px breed staat het
podium boven en de kolommen eronder zonder horizontale scrollbar; twintig keer openen en
sluiten geeft geen "Too many active WebGL contexts"; Never mind herstelt, Reset zet de brede
strohoed met rugzak terug, Wear it overleeft een herlaad.

## Open

- De instanced settlers (`settler-figures.js`) hebben nog geen `equip`; dit scherm kleedt
  alleen de speler. Stap 2 van `uitrusting-en-vasthouden.md` staat nog open.
- De hand-ghosts (een lege hand, gedimd) en de posities van zwaard/hamer in hun slot
  (`ITEM_POSE`) zijn op het oog gekozen; wie ze anders wil, verandert één tabel.
