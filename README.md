# Promptholm - destillaat

Het eiland zonder het spel. Elke Claude Code- en Cowork-sessie op deze machine is een bewoner met
een huis; hier kijk je alleen hoe dat dorp groeit. Geen lopen, geen boten, geen kroeg, geen quests,
geen zee met anderen. Wel:

- **live groei** - de scan draait elke minuut; een nieuwe sessie wordt een huis, een gehucht groeit,
  een mijlpaal verschijnt;
- **de regisseur** - laat je de muis even los, dan vliegt de camera vanzelf naar iets dat gebeurt
  (Settings → *Wander by itself*; `?director=5` begint na vijf seconden);
- **de planner** (`U`, of de Plan-knop) - gehuchten verplaatsen, grond geven of afpakken, zones;
- **bewoners die rondlopen** - een eigen zee op loopback in hetzelfde proces loopt ze, zoals single
  player op het echte eiland. Niets gaat het netwerk op.

## Starten

```bash
npm install
npm run dev
```

Draait op <http://localhost:4848/>. Het eiland woont in `~/.promptholm-destillaat` (of
`PROMPTHOLM_HOME`). De eerste start kopieert `config.json`, `layout.json` en `arrivals.jsonl` van
het echte eiland (`~/.promptholm`), zodat je hetzelfde eiland ziet; daarna groeit het zelf mee uit
dezelfde transcripten. Een zet in de planner van het destillaat blijft dus in het destillaat, en het
echte eiland wordt nooit aangeraakt. `node start.mjs --fresh` sticht een nieuw eiland.

## Als hologram op het bureaublad

```bash
npm run hologram
```

Een vensterloos, doorzichtig venster (Electron) waarin alleen het eiland zweeft: geen lucht, geen
open zee, geen wolken, alleen het land met zijn ondiepe kust. Linkermuis draait, het wieltje zoomt,
**rechtermuis sleept het eiland over je bureaublad**, F11 is volledig scherm. Waar het venster niets
toont gaat de muis erdoorheen naar wat erachter ligt. Het tray-icoon (het eilandje bij de klok, soms
onder het pijltje) heeft de rest: Klein / Middel / Groot, Volledig scherm, Regisseur (aan: de camera
dwaalt na 15 s zelf naar iets dat gebeurt; uit: het eiland draait langzaam rond), Altijd bovenop,
Naar het midden, Opnieuw laden en **Sluiten**. Draait de server nog niet, dan start het venster hem
zelf. In een gewone browser is het <http://localhost:4848/?hologram>.

## Waar het vandaan komt

Een uitgeklede kopie van [AgentVillage](https://github.com/TiemenAfman/AgentVillage)
(`Plans/destillaat-eiland.md` daar). De eigen bestanden zijn `start.mjs`, `serve.mjs`,
`web/index.html`, `web/js/main.js`, `web/js/watch-net.js`, `web/js/hologram.js` en `hologram/`; al het andere is precies wat die
importeren, gekopieerd door `scripts/distill.mjs` uit de AgentVillage-checkout:

```bash
node scripts/distill.mjs "C:/Development/- Anders/Promptholm-Destillaat"
```

(gedraaid vanuit AgentVillage). Dat ververst de gekopieerde modules en ruimt op wat niet meer nodig
is; de eigen bestanden blijven staan. `DISTILLED.txt` zegt welk bestand er door welke import in kwam.
