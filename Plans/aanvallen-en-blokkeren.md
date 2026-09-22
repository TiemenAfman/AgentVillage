# Aanvallen en blokkeren met de muis, en de browser zijn sneltoetsen afpakken

## Aanleiding

Met een zwaard in de ene hand en een schild in de andere (zie `inventory-scherm.md`) wil
Martijn ze ook gebruiken: linkermuisknop slaat, rechtermuisknop blokkeert. Daarbij de vraag
of dat wel kan zonder first person — de linkermuisknop is in walk-mode al "slepen om te
kijken" — en de wens om "een poging te doen" de Ctrl-sneltoetsen van de browser in het spel
te onderdrukken (Ctrl+W sluit het tabblad terwijl je W ingedrukt houdt om te lopen).

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Is first person nodig? | **Nee.** Een pointer-lock (dubbelklik op het canvas, bestond al) koppelt de muis direct aan de camera, ook in third person; dan zijn beide knoppen vrij. | De camera-afstand is een los ding van wie de muis heeft. |
| En zonder lock? | Slepen blijft kijken; een **klik die geen sleep werd** (< 6 px) is de aanval. Rechts kijkt nooit, dus blokkeren werkt altijd. | Zo verliest niemand de bestaande bediening, en wie het spelgevoel wil, dubbelklikt één keer. |
| Wat is een aanval? | Een getimede zwaai van 0,45 s op de wapenarm: optrekken achter de schouder, slaan naar voren-onder, terug naar wat de arm deed. Het vastgehouden item staat dan níet meer rechtop (de gewone tegen-rotatie) maar gaat mee met de arm. Een nieuwe klik mag pas ná de slag de zwaai afbreken. | Direct aangestuurd, niet via `damp()`: bij 15/s zou die een halve seconde uitsmeren tot een golfje. |
| Welke arm slaat en welke blokkeert? | Slaan: een hand met zwaard of hamer (rechts eerst), anders een lege vuist. Blokkeren: de hand met het schild, anders de hand die niet slaat. | Zonder wapen is een slag een stoot; zonder schild is een blok een opgeheven arm. |
| Wat is blokkeren? | Een gehouden pose: de schildarm komt voor de borst (`-1.25`), het schild draait van zijn rust-yaw (0,6 rad, iets naar voren) naar een kwartslag zodat het vlak recht vooruit wijst. | Dit gaat wél door de gewone targets en damping — het is een houding, geen animatie. |
| Zwemmen, liggen, zitten? | Geen aanval en geen blok. | De armen zijn dan al ergens mee bezig. |
| Zichtbaar voor anderen? | Nee. | De avatar-look gaat al niet over de draad; de pose ook niet. |
| Ctrl-sneltoetsen | In walk-mode (niet in een overlay, niet in een invoerveld) `preventDefault` op de Ctrl-combinaties die een pagina mág annuleren (S, P, F, D, U, O, H, J, K, L, E, G, R, B). Daarbovenop een **Keyboard Lock** (`navigator.keyboard.lock`) op die letters plús W, T, N, Tab en de cijfers. | Chrome negeert `preventDefault` op Ctrl+W/T/N/cijfer; die komen alleen bij de pagina onder een Keyboard Lock, en die werkt alleen in **fullscreen** — dat is de API, geen keuze. De Fullscreen-knop is dus de plek waar het eiland geen tabbladen meer verliest. |
| Escape in de lock? | Nee. | Een gelockte Escape maakt fullscreen verlaten "ingedrukt houden", en Escape heeft hier al een taak (terug naar de lucht). |

## Bestanden

- `web/js/classic-avatar.js` — `attack()`, `swingPose()`, `blocking` in de pose, de schild-yaw
  per frame gedempt; `HOLD_ARM_X` is per item (een schild wordt gedragen, niet uitgestoken).
- `web/js/walk.js` — muisknoppen in `onDown`/`onUp` (`canFight`, `CLICK_PX`), `state.blocking`,
  `BROWSER_KEYS` + `preventDefault` in `onKeyDown`, `lockKeys()` bij `enter()`/`exit()`.
- `web/js/ui.js` — de toetsenstrip: "LMB attack", "RMB hold to block", "double-click to lock the mouse".
- `tests/avatar.test.mjs` — zwaai omhoog en terug, blok draait het schild naar voren.

## Verificatie

Tests; dan te voet: klik zonder slepen → zwaai; slepen → alleen kijken; rechts ingedrukt →
schild voor de borst, los → weer langs het lijf; dubbelklik → lock, dan slaat de knop direct.
Ctrl+S / Ctrl+P / Ctrl+F doen niets meer te voet, wel weer in de lucht. Fullscreen-knop aan:
Ctrl+W sluit het tabblad niet meer zolang je loopt.
