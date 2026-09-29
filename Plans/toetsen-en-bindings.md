# Ctrl, duiken met de muis en een bindings-scherm met drie kolommen

**🚧 NOG NIET KLAAR** — alles gebouwd en getest op `ctrl-bindbaar-duiken-met-muis` (1568 tests groen; het
scherm, het binden, het grijs worden en het duiken zijn in een echte pagina bekeken). Open: het is met een
nagebootste controller geprobeerd, niet met een echte; de telefoon (touchpad) is er niet op bekeken; en
het staat nog niet in `main`.

Begonnen op 29 september 2026, uit een reeks korte vragen van Martijn tijdens het testen van 0.7.0: "ik
zocht ctrl om te duiken" (het is C), "kunnen we ctrl bindable maken en alle ctrl+W/A/S/D/E/F uitschakelen",
"ctrl+A moet er sowieso uit" (nu selecteert het de hele pagina, ook vanuit de lucht), "ik wil omhoog en
omlaag kunnen sturen met de muis ipv C en spatie", en daarna een plaatje van een *Bindings Manager*
(Action / Keyboard Primary / Keyboard Secondary / Controller): "ik wil er een 2e keybinding kolom hebben en
een 3e voor de controllers", "grey out when no controller connected", "anders controller naam laten zien",
"etcetera".

## Hoe het zat

- Toetsen waren één-op-één: `keybinds.js` bewaarde `{ actie: toets }` en `canon()` vertaalde een ingedrukte
  toets terug naar de standaardtoets van zijn actie, zodat `walk.js` de standaardtoetsen kon blijven testen.
  Er was geen tweede toets en Ctrl kon niet: `onKeyDown` gooide elke toets met `ctrlKey` weg.
- Ctrl was ooit de crouch-toets. Het werd C omdat crouchen + lopen ctrl+W werd, en Chrome houdt ctrl+W voor
  zichzelf (alleen in fullscreen onder een keyboard lock kan een pagina het weigeren). In het desktopvenster
  is er geen tab om te sluiten, dus daar was Ctrl nooit een probleem geweest.
- `BROWSER_KEYS` en `LOCKED_CODES` in `walk.js` waren lijstjes van de letters die tot dan toe pijn hadden
  gedaan; `A` stond er niet in, dus ctrl+A selecteerde alles. En het gebeurde niet alleen te voet: vanuit de
  lucht draait `walk.js` niet eens.
- De controller was vast bedraad: `MAPS.walk` in `input.js` noemt de knoppen (A springt, B hurkt, ...) en dat
  is de enige plek die dat doet. Er was geen scherm om dat te veranderen.
- Op en neer in het water ging met C en Spatie; er was geen manier om met de muis te sturen.

## Besluiten

- **Ctrl is een toets als elke andere, en standaard van niemand** (`'control'`, wat `KeyboardEvent.key`
  zegt). Is hij gebonden, dan is Ctrl (en wat erbij ingedrukt wordt) geen sneltoets-modifier meer maar een
  spel-toets: `ctrlIsKey()` in `keybinds.js`, en `onKeyDown` laat zo'n toets door. De browser-sneltoets
  wordt in dat geval óók geannuleerd. Prijs, gezegd in de docs: in een gewone Chrome-tab sluit ctrl+W de
  tab nog steeds als je niet fullscreen bent; in het desktopvenster is er niets te verliezen.
- **Elke ctrl+letter en ctrl+cijfer is uit te voet**, niet meer een lijstje: `BROWSER_KEYS` en
  `LOCKED_CODES` zijn alle 26 letters en de cijfers (plus Tab). Een veld op een bord houdt zijn sneltoetsen
  (`typingInto`). AltGr komt op een Nederlands toetsenbord als ctrl+alt binnen en blijft een letter.
- **ctrl+A is uit in elke modus** (`web/js/page-keys.js`, geïnstalleerd vanuit `main.js`), los van de
  wandelmodus. Alleen select-all: ctrl+R (herladen) en de dev-tools blijven van de browser buiten de
  wandelmodus, omdat het venster daarmee herladen wordt tijdens het bouwen.
- **De muis stuurt op en neer** (`lookRise` in `diving.js`): de camera hangt achter en boven het lichaam,
  dus `camPitch` (positief = camera hoog, kijkt omlaag) is de richting. Een dode band rond 0,34 (de
  standaard is 0,28, een spawn 0,44) zodat een gewone slag langs het oppervlak niet uit zichzelf duikt;
  de uiteinden van het bereik zijn een volle slag. Alleen als er gezwommen wordt en naar voren of achteren
  (`iz`): achteruit keert het om, opzij en stilhangen niets. C en Spatie tellen erbij op in plaats van te
  vervangen. In eerste persoon is het oog de richting en is level gewoon level.
- **In het water mag de muis ver omhoog kijken** (`SWIM_PITCH_MIN` -1,1 in plaats van -0,25), en de camera
  houdt zijn kijkrichting als de vloer hem omhoog duwt: `placeCamera` tilt het richtpunt op met precies
  zoveel als de camera omhoog is gezet (`lift`; alleen een zwemmer, alleen omhoog). De lens zit dus nooit
  half onder zee, en omhoog kijken kijkt omhoog; het lichaam schuift vanaf ongeveer -0,6 onderaan uit beeld.
  Op het droge krimpt het bereik weer, zacht (`relaxPitch`).
- **Drie kolommen per actie: primair, secundair, controller**, zoals op het plaatje. Model in
  `keybinds.js`: per actie `{ primary, secondary }` toetsen plus één controllerknop; alleen wat afwijkt van
  de standaard wordt bewaard (`promptholm.bindings`, versie 2). `promptholm.keys` (versie 1, `{ actie: toets }`)
  wordt gelezen als primaire overrides en niet meer geschreven.
- **Een toets bezetten wisselt, hij steelt niet.** Neemt een actie een toets die een andere actie had, dan
  krijgt de andere de toets die de eerste losliet (of niets). Vroeger kreeg de ander zijn standaard terug;
  met twee plekken per actie zou dat vaker tot dubbele toewijzingen leiden. Geen toets of knop is dubbel.
- **Niet te binden:** Esc (loslaten/verlaten), Alt/AltGr/Meta (een toets met die modifier is nooit een
  spel-toets, dus hij zou nooit afgaan) en op de controller Back en Start (menu en verlaten).
- **De pijltjestoetsen zijn nu gewoon de standaard secundaire toets** van lopen, in plaats van vast bedraad.
  `canon()` vertaalt ze naar W/A/S/D; een gebruiker kan ze dus ook ergens anders voor gebruiken.
- **De controller-kolom is grijs zonder controller.** Een browser onthult een pad pas na een druk op een knop
  (`gamepadconnected`), dus de kolom zegt dat er dan een knop ingedrukt moet worden. Met een controller
  staat zijn naam in de kop (`padName`: de vendor-/product-ruis eraf) en gebruiken de labels de namen van
  zijn familie (✕ ◯ □ △ voor PlayStation). Bewaarde controller-bindings blijven staan als de controller
  weg is; alleen aanpassen kan dan niet.
- **`MAPS.walk` en `MAPS.inside` in `input.js` worden uit de bindings gebouwd** (`applyPadBindings`), nog
  steeds op één plek; alle andere modi (panelen, gesprek, lucht) houden hun vaste knoppen. Een binding
  verandert direct, zonder herladen.

## Wat er komt (en wat niet)

- "etcetera" van Martijn is een lijst die nog groeit; wat erbij komt staat hieronder.
- Niet gebouwd: een *binding set* (het "Create New Binding Set" van het plaatje), "Networked"/"Enabled" per
  actie, en het apart binden van op en neer (Move Vertically) — de muis en de bestaande C/Spatie dekken dat.
- Muisknoppen (linker- en rechterhand) blijven vast: ze zijn een hand, geen actie.
