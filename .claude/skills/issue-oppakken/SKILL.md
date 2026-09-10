---
name: issue-oppakken
description: >-
  De werkwijze voor werk aan Promptholm (TiemenAfman/AgentVillage): elke taak
  krijgt eerst een GitHub issue, dan een branch vanaf main, bij oppakken gaat de
  issue op "in progress", en als het werk klaar is wordt de branch gepusht en de
  issue op done gezet. Gebruik dit zodra er aan deze repo gewerkt wordt — bij
  "pak issue 6 op", "maak hier een issue van", "begin aan deze taak", "ik wil
  <iets> op het eiland", "dit moet gefixt worden", "klaar, push maar", en bij de
  Engelse varianten (pick up issue N, open an issue for this, start this task,
  I'm done, push it). Trigger ook als er geen issue genoemd wordt: een verzoek om
  hier een feature te bouwen of een bug te fixen begint bij stap 1, niet in de
  editor.
---

# Issue → branch → in progress → done

Werk aan deze repo loopt langs vier stappen, in deze volgorde. Geen code voordat
stap 1 en 2 staan.

Alles gaat via `gh` op `TiemenAfman/AgentVillage`. Draai je in een worktree, dan
werkt `gh` daar gewoon — de remote is dezelfde.

## 1. Elke taak krijgt eerst een issue

Geen uitzonderingen: ook een kleine fix, ook een idee dat onderweg opkomt, ook
iets dat in tien minuten klaar is. De issue is waar de taak *staat*; de branch is
alleen waar hij gebeurt.

Kijk eerst of hij al bestaat. Dat is hier geen formaliteit — issues 6 t/m 10 en
11 t/m 15 zijn twee keer hetzelfde vijftal, met andere titels:

```bash
gh issue list --state all --search "bioscoop"
```

Bestaat hij niet, maak hem aan in het huisformaat dat de bestaande issues
gebruiken — **Wat**, **Technisch (richting)**, **Open vragen**. Nederlands, zoals
de rest:

```bash
gh issue create --title "Café 'BoikonFM' — muziek luisteren op het eiland" --label enhancement --body "$(cat <<'BODY'
## Wat
Wat er op het eiland te zien of te doen moet zijn, in één of twee zinnen.

## Technisch (richting)
- Welke bestanden het raakt (`shared/shapes.mjs`, `web/js/props.js`, …)
- Wat de aanpak zou zijn, niet uitgewerkt

## Open vragen
- Wat nog beslist moet worden voordat dit af kan
BODY
)"
```

Labels die al bestaan: `enhancement`, `bug`, `documentation`, `question`. Kies er
één; verzin geen nieuwe soorten.

Het issuenummer dat je terugkrijgt heb je in stap 2 en 3 nodig.

## 2. Branch vanaf main

Altijd van `origin/main`, nooit van de branch waar je toevallig op staat:

```bash
git fetch origin
git switch -c feature/11-cafe-boikonfm origin/main
```

Naam: `<soort>/<issuenummer>-<korte-slug>`. De soorten komen uit
[docs/branches.md](../../../docs/branches.md): `feature/`, `fix/`, `docs/`,
`perf/`. Het nummer erin betekent dat de link issue↔branch zichtbaar is zonder
te zoeken.

Zit de sessie al in een worktree op een `claude/…`-branch die de app zelf van
`main` heeft afgetakt? Dan is dát de branch — noem hem op de issue en maak geen
tweede. Controleer wel dat er niets vreemds onder zit:

```bash
git log --oneline origin/main..HEAD
```

Niets op `main` committen, ook niet "even snel".

## 3. Oppakken = in progress

Vóór de eerste commit, niet achteraf. Het label is er om te voorkomen dat een
tweede sessie dezelfde issue oppakt, dus het moet er staan zolang je bezig bent:

```bash
gh issue edit 11 --add-label "in progress" --add-assignee @me
gh issue comment 11 --body "Opgepakt op \`feature/11-cafe-boikonfm\`."
```

Bestaat het label nog niet in de repo, dan eenmalig:

```bash
gh label create "in progress" --color FBCA04 --description "Wordt nu aan gewerkt"
```

## 4. Af = branch pushen, issue op done

```bash
git push -u origin HEAD
gh issue edit 11 --remove-label "in progress"
gh issue close 11 --reason completed --comment "Klaar op \`feature/11-cafe-boikonfm\`, gepusht. Zit nog niet in main."
```

Done is hier **closed as completed** — dat is de done-toestand die GitHub Issues
zelf heeft. Er is geen apart `done`-label en geen projectbord aan deze repo
gekoppeld, dus er valt niets te verslepen.

Dat de issue dichtgaat op een gepushte branch die nog niet gemerged is, is hier
opzet: deze repo mergt laat en stelt een release samen uit losse branches (zie
[docs/branches.md](../../../docs/branches.md)). Daarom staat er in de
afsluitcomment welke branch het is en dat hij nog niet in `main` zit.

Een PR hoort hier niet standaard bij. Wil je review, of moet het echt de main in,
dan is dat de uitzondering: laat de issue open, zet `Closes #11` in de PR-body en
laat de merge hem sluiten.

```bash
gh pr create --fill --base main
```

## Waar het misgaat

- Beginnen met code en de issue er achteraf bij verzinnen. Dan heet de branch al
  verkeerd en is stap 3 zinloos.
- Aftakken van de huidige branch in plaats van `origin/main`. `git switch -c …
  origin/main` is niet optioneel.
- `in progress` laten staan op werk dat al gepusht is: dan lijkt de taak bezet.
- Een tweede issue aanmaken voor iets dat er al staat. Zoeken kost één commando.
- `gh project`-commando's proberen. Dat vraagt een scope die dit token niet heeft
  (`gh auth refresh -s project`) en er is toch geen bord.
