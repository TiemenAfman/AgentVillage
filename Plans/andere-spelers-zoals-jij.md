# Andere spelers zien zoals jij jezelf ziet

Opgeschreven en gebouwd op 25 september 2026. Doel: wie je op zee tegenkomt ziet je liggen,
hurken en zitten, ziet je armen bewegen als je slaat of drinkt, en ziet wat je draagt en
vasthoudt - niet één rechtopstaand figuurtje zonder armen in de kleur van een model.

## Hoe het zat

- Een andere speler was één samengevoegd mesh per stijl (`playerGeometry(style)` in
  peers.js), zonder losse armen of benen. De stijl kwam uit het connectie-id, niet uit wat
  de speler zelf had gekozen.
- Je eigen uiterlijk (`web/js/avatar.js`: huid, tuniek, rand, hoed, en de uitrusting met
  wat elke hand vasthoudt) staat in je eigen localStorage en ging nooit over de lijn.
- De pose had acht bits en alle acht waren in gebruik (`POSE_MASK = 255`); liggen, hurken en
  zitten zaten er niet in.
- Een slag van een speler ging naar de zee voor het vechten (`{t:'swing'}`), maar niemand
  anders hoorde ervan; een slok helemaal nergens.

## Besluiten

- **Andere spelers krijgen dezelfde rig als jij**: `createClassicAvatar` uit
  classic-avatar.js, per peer één, aangestuurd met dezelfde pose die walk.js hem geeft
  (lopen, rennen, hurken, zitten, liggen, zwemmen, blokken, fietsen). Geen tweede figuur om
  bij te houden. De prijs: een handvol meshes per speler in plaats van één - bij hooguit
  zestien spelers te dragen, en de reden dat de settlers wél geïnstanced blijven.
- **Je uiterlijk gaat mee als eigen bericht**, `{t:'look', ...}`, bij het verbinden en bij
  elke wijziging (de Apply in het inventory-scherm) - niet in elke pose. De zee houdt het
  vast op de speler, controleert de vorm (kleuren als getal, korte slugs, booleans) en
  stuurt het mee in `identity` (join, roster, welcome). De pagina die het tekent haalt het
  nog door `normalizeAvatar`, de eigen witte lijst van de wardrobe; de zee hoeft de
  woordenlijst van de wardrobe niet te kennen (en mag web/ niet importeren).
- **Liggen, hurken, zitten zijn pose-bits** (256, 512, 1024; `POSE_MASK` 2047). Een zee van
  vóór dit maskeert ze weg, zoals bij de fiets; er breekt niets.
- **Slaan en drinken zijn gebeurtenissen**, geen toestand: `{t:'swing', side}` gaat zoals
  voorheen naar het vechten en de zee stuurt `{t:'swung', id, side}` naar de anderen;
  `{t:'drink', side}` wordt `{t:'drank', id, side}`. Een slag duurt korter dan twee
  pose-beats, dus als bit zou hij soms nooit aankomen.
- **Blokken** was al een bit (`BLOCKING`); welke hand volgt uit je uitrusting (de hand met
  het schild), zoals walk.js het ook doet.
- **Wie nog geen uiterlijk stuurt** (een oudere pagina) krijgt het standaarduiterlijk.

## Nog niet

- De ligmat onder iemand die ligt (walk.js' `lounge`) tekenen we niet voor anderen.
- Het biertje dat je aan een settler geeft blijft van jouw pagina (Plans/bier-en-dronken.md).
