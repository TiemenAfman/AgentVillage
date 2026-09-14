# Promptholm Godot Spike

Fase 1: Godot als kijker naast de bestaande webclient.

Wat deze client doet:

- **genereert het eiland zelf.** `village.json` bevat geen terreindata, alleen
  `island.seed` — de webclient bouwt de grond uit die seed en Godot doet dat nu ook,
  via `scripts/rng.gd`, `scripts/simplex.gd` en `scripts/terrain.gd` (een port van
  `shared/rng.mjs` en `shared/terrain.mjs`).
- rendert het hoogteveld fijner dan het grid zelf is: elk vak wordt onderverdeeld en
  daarna gladgestreken, met de waterlijn vastgezet zodat er geen land onder water verdwijnt.
  Kleurbanden per hoogte, plus water op zeeniveau waar zee, meer én rivieren onder vallen.
- tekent wegen als smal lint over de padcellen in plaats van een tegel per cel. De route
  blijft precies waar de layout hem legde; alleen de breedte is een tekenkeuze.
- leest live data van `http://localhost:4747/village.json` en `/api/props` en zet daar
  gebouwen (met zadeldak, op terreinhoogte), paden, districten, bruggen en props op.
- kijkt elke 5 seconden of er iets veranderd is en herbouwt alleen dan.
- valt terug op een kleine sample als de Node-server niet draait.

Besturing: WASD lopen, Shift rennen, Q/E omhoog/omlaag, rechtermuis slepen kijkt rond.

## Model versus beeld

De grond die getekend wordt is een gladgestreken versie van het hoogteveld. Alles wat op
de grond staat — huizen, props, wegdek, brugdek — wordt op díe grond gezet, zodat een huis
staat op wat je ziet. Wat land is, wat water is en waar een brug mag liggen komt onveranderd
uit `terrain.gd`, en dus uit dezelfde regels als de server.

## Determinisme

De port moet bit voor bit hetzelfde uitrekenen als Node, anders staat een huis hier in zee
en daar op gras. `hash_heights()` is die controle: hij hoort gelijk te zijn aan
`island.terrainHash` uit `village.json`. De client toont dat in de statusregel en klaagt in
de console als het niet klopt.

Twee valkuilen die dat verschil maakten:

- JS-bitoperatoren rekenen in int32 en GDScript-ints zijn 64 bits, dus elke stap maskeert
  terug naar uint32 — en `Math.imul` is in halven gesplitst omdat een volledig 32×32-product
  over int64 heen loopt.
- `Math.round()` rondt halven naar +oneindig, `round()` in GDScript rondt van nul af. Onder
  zeeniveau is dat een ander getal, dus daar staat `PmRng.js_round()`.

## Draaien

```powershell
D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64.exe --path D:\git\Martijn\AgentVillage-godot-45\godot
```

Controles zonder venster:

```powershell
# klopt het terrein nog met de JS-versie?
D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe --headless --path D:\git\Martijn\AgentVillage-godot-45\godot --script res://tools/verify_terrain.gd

# worden bruggen opgebouwd en wordt een wijziging opgemerkt?
D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe --headless --path D:\git\Martijn\AgentVillage-godot-45\godot --script res://tools/verify_render.gd
```

Een plaatje maken zonder erbij te zitten kan met `--write-movie shot.png --quit-after 100`;
dat schrijft genummerde PNG's.

## Nog niet gedaan

- Gebouwen zijn een doos met een zadeldak, geen echte modellen. De webclient heeft daar
  62 KB procedurele geometrie voor (`web/js/buildings.js`); dat is een eigen issue waard.
- Geen riet of grind langs de oevers, geen dag/nacht, geen interactie.
- Eén mesh voor het hele eiland: ~55 ms terrein en ~200 ms tekenen bij 64×64. De
  onderverdeling zakt terug op een groter grid zodat het aantal punten gelijk blijft.
- Écht smallere wegen en rivieren vragen een fijner grid (`grid.size`), en dat is een
  serverbeslissing: het verandert de terrein-hash en herfundeert het eiland.

Dit gebruikt bewust GDScript. Voor deze fase is dat minder setup dan C#/Mono; een
C#-variant kan later.
