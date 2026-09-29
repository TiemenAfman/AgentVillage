# Een Esc-menu, en een knoppenbalk in twee groepen

**✅ Status: gebouwd op 29 september 2026 (twee rondes: het menu, daarna het menu als instellingen), en door Tiemen goedgekeurd.**

## Wat er gevraagd werd

Het spel heeft geen Esc-menu, en rechtsboven staat één lange rij tekstknoppen door elkaar:
New settler, Walk, Map, Plan, Inventory, Sound, Legend, Settings, Overview (plus Build, Say,
Controls en Animals als die aan staan), met daaronder nog een rij *Show*-schakelaars. Een
voorstel van Gemini, dat Tiemen doorgaf met "zelf bijschaven mag":

1. een systeemmenu achter Esc en een tandwiel rechtsboven (Hervatten, Instellingen met geluid,
   Opslaan/Laden, Afsluiten);
2. de knoppen verdelen in *acties*, *info* en *systeem*;
3. acties naar linksonder of midden-onder als gereedschapskist, info rechtsboven naast de klok;
4. iconen in plaats van tekst, met tooltips;
5. sneltoetsen, en die in de tooltip noemen;
6. Animals en Inventory als tabbladen van één Overview-scherm;
7. de vaakst gebruikte knoppen groter of met een accentkleur.

## Besluiten

| Voorstel | Besluit | Waarom |
|---|---|---|
| Esc-menu | **Ja**, als overlay midden op het scherm, met `open`/`close`/`isOpen` in `PANELS` (main.js). | Dan krijgt het vanzelf wat elk overlay al heeft: B op de controller sluit, de terugknop van Android sluit (`phoneBack`), en de regisseur wacht. |
| Wanneer Esc het menu opent | Alleen **van boven** (`orbit`) en alleen als er **niets anders open** is. Anders sluit Esc eerst dat andere (paneel, kaart, inventaris, popover, bord), zoals nu. | Esc betekent al "één stap terug", overal. Te voet blijft het zoals CLAUDE.md het vastlegt: de eerste Esc geeft de muis vrij, de tweede gaat naar boven, en de derde opent daar het menu. In de planner stapt Esc laag voor laag terug (plan-mode.js); daar opent het geen menu. |
| Wat erin staat | *Back to the island*; Settings (alleen de keeper); Legend; Controls (alleen de telefoon); Sound aan/uit; de *Show*-schakelaars; *Which sea…* (het hoofdmenu opnieuw, alleen met een eigen islander). | Precies wat nu als losse knoppen rondslingert en zelden nodig is, plus de zeekeuze die je nu alleen bij het opstarten zag. |
| Opslaan/Laden, Afsluiten | **Niet.** | Er valt niets op te slaan: het eiland schrijft zichzelf. Een browsertab heeft geen "afsluiten", en in het desktopvenster is dat het kruisje. Knoppen die niets doen zijn erger dan geen knoppen. |
| Hervatten | Heet *Back to the island*. | Er is geen pauze: de zee loopt door voor iedereen erop. "Hervatten" belooft een pauze die er niet is. |
| De *Show*-rij | Gaat het menu in, en verschijnt alleen onder de balk zolang er iets uit staat. | Drie schakelaars die bijna altijd aan staan, hoeven niet altijd in beeld. Maar een eiland waar huizen verborgen zijn, moet dat wel laten zien. |
| Acties naar linksonder | **Niet.** De balk blijft rechtsboven, maar in twee groepen met een scheidingslijn: *doen* (New settler, Walk, Plan, Build, Say) en *kijken* (Map, Inventory, Animals, Overview), met het menu (☰) helemaal rechts. | Onderin staan al de tijdlijn, de toetsenrij, de toasts, het onderschrift van de regisseur en de knop voor volledig scherm, en op de telefoon de stick en de knoppen. Rechtsboven is de plek die mensen al kennen. |
| Iconen | **Alleen iconen**, en de woorden terug via *This screen → Names on the buttons* (per browser, en ook dan alleen boven 1100 px breed). De naam en de toets blijven de tooltip en het `aria-label`; Walk/Fly up en Plan/Done werken hun tooltip mee bij. | Eerst stond het woord er standaard bij, met als argument dat alleen iconen trager lezen voor een nieuwe speler. Martijn na het zien ervan: "alleen icoontjes lijkt me voldoende" - de woorden namen op een laptopscherm de halve breedte. Omlijnde SVG's in de stijl van touchpad.js. |
| Sneltoetsen | Van boven: **Esc** menu, **M** kaart (bestond), **I** inventaris (bestond te voet), **O** overzicht, **N** nieuwe settler, **P** planner (keeper), **L** legenda. De tooltip noemt de toets. Op de controller: **Start** opent het menu van boven. | Zelfde letters als te voet waar die bestaan. W, A, S, D en E blijven vrij, want dat zijn de toetsen te voet. Start was van boven een tweede "lopen" naast A; op een console is Start het menu. |
| Animals en Inventory als tabbladen van Overview | **Niet.** | Overview is geen scherm maar de camera die het hele eiland in beeld brengt. Inventory is je eigen uitrusting, Animals het dagboek van de dieren van de keeper. Drie verschillende dingen in één scherm stoppen is minder knoppen, maar niet duidelijker. |
| Visuele hiërarchie | Walk houdt zijn accentkleur (die had het al). | Het is de knop waar alles mee begint. |

## Hoe het gebouwd is

- `web/js/sysmenu.js`: het menu. Het is een overlay met dezelfde vorm als de andere
  (`open`/`close`/`isOpen`). De knoppen die erin staan zijn de **bestaande knoppen, verplaatst**
  (`sound-btn`, `legend-btn`, `settings-btn`, `phone-btn`, de `data-filter`-schakelaars), zodat
  alles wat ui.js er al mee deed (handlers, `hidden` voor wie geen keeper is, `on`, `aria-pressed`)
  ongewijzigd blijft werken.
- Esc: een luisteraar in de capture-fase onthoudt of er bij het indrukken iets open was. Die in
  de bubble-fase opent pas het menu als dat niet zo was en niemand de toets heeft opgeëist
  (`defaultPrevented`). Zo sluit dezelfde Esc niet eerst een paneel en opent daarna het menu.

## Tweede ronde: het menu wás de instellingen niet

Tiemens reactie op de eerste versie: "Er is geen Esc-menu, wel een minimaal settings-scherm."
Dat klopte. De eerste versie was een doorgeefluik: een kaart met *Back*, *Settings*, *Legend*,
*Sound* en *Which sea…*, en Settings kwam uit in hetzelfde zijpaneel van 316 px breed. Daarin
stonden huisbordjes, toetsen, eilandgrootte, de zee, de camera, de tekenkwaliteit en debug onder
elkaar. Twee klikken om bij hetzelfde smalle lijstje te komen. En het Gemini-voorstel (ook AI)
had het echte probleem niet gezien:

- **Het paneel was alleen voor de keeper, maar het meeste erin is van de browser.** Toetsen, de
  YOU-pijl, de regisseur en *Lighter when slow* staan in `localStorage`. Een bezoeker, of iemand
  aan de telefoon, kon ze nooit veranderen, omdat `setKeeper` de hele Settings-knop verborg om
  drie instellingen (bordjes, grootte, de zee) die wél van het eiland zijn.
- Instellingen die bij elkaar horen stonden niet bij elkaar: Sound als losse knop, Show als
  losse rij, de rest in het paneel.

Besluit: **het menu is de instellingen.** Eén venster midden op het scherm, met tabbladen:

| Tab | Wat erin | Voor wie |
|---|---|---|
| *This screen* | Geluid, wat er te zien is (Show), de camera van boven (YOU-pijl, *Wander by itself*), tekenen (*Lighter when slow*) | iedereen |
| *Controls* | De toetsen te voet, om te zetten; de letters van boven; op de telefoon de aanraakbediening | iedereen |
| *Island* | Huisbordjes, eilandgrootte, de zee, debug (Build mode) | de keeper: dit schrijft `config.json` |
| *Help* | De legenda, wat Esc doet, de versie | iedereen |

Het zijpaneel *Settings* en de knop *Which sea…* verdwijnen: de zee staat nu op het tabblad
*Island*, met de lijst en *Add*, en dat is meer dan het hoofdmenu bood. De legenda blijft een
zijpaneel. Het is naslag die je naast het eiland wilt houden, niet iets om in een venster ervoor
te lezen.

## Versie

Alleen paginacode; niets op de lijn, niets in `layout.json` of de bundle. Een patch mag dat.
