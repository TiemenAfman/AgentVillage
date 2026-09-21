# Wie joint ziet de host als mist

**Status: gebouwd en lokaal geverifieerd op 21 september 2026.** Onderaan staat wat het werd
en hoe het is nagekeken; de rest is het plan zoals het vóór de code stond.

## Wat er gebeurde

Twee eilanden op één zee. De host zag het eiland van de joiner compleet naast het zijne.
De joiner zag het eiland van de host **alleen als mist**: een silhouet aan de horizon en
verder water. Vanaf beide kanten vastgesteld (Promptholm host, Hoogezand joint; daarna
omgekeerd), en lokaal gereproduceerd met een tweede islander op dezelfde machine.

De console van de joiner zei het, dertien keer per minuut:

```
island: region <host-id> overlaps home
```

## Waarom

Twee dingen vielen samen.

1. **De pagina leerde maar één keer waar haar eigen eiland lag.** `learnTheWorld()` in
   `web/js/main.js` haalde bij het opstarten `GET /world` en zette `state.homeOrigin` op de
   `origin` van het eigen rijtje. Daarna nooit meer: niet als het eigen rijtje ná de welcome
   binnenkwam (de gewone volgorde bij joinen: de pagina verbindt eerder dan de islander
   publiceert), niet bij `followSea()`, niet bij een herstart van de zee. Voor een joiner
   bleef thuis dus `[0,0]`.

2. **Het eiland van de host ligt óók op `[0,0]`** — het was er eerst. `joinIsland` weigert
   een regio die over de eigen regio valt ("overlaps home"), dus het werd nooit
   opgebouwd. Wat overbleef was het silhouet van `horizon.js` uit het baken op het LAN, en
   dat leest als mist.

Een herladen zou niet hebben geholpen, om een diepere reden: **de pagina kan haar eigen
eiland alleen op scene-oorsprong tekenen.** `world.js`, de gebouwen, de hamlets, de dokken
van thuis hangen allemaal direct in `scene` op lokale coördinaten ("at the origin for home",
main.js bij de dokken). Alleen `guest-island.js` zet zijn groep op `region.origin`. Met
`homeOrigin` op `[304,0]` zei de thuisregio `[304,0]` terwijl de meshes op `[0,0]` stonden:
de eigen bewoners (crowd-view telt `region.origin` erbij) liepen 304 eenheden naast hun
huizen, de spelers ook, en het eiland van de host werd op `[0,0]` bovenop het onze gebouwd.
CLAUDE.md zei "our own island stands where the sea says it does" — dat gold voor de
regio-facade, niet voor wat er getekend werd.

## De keuze

De pagina houdt haar eigen eiland op scene-oorsprong en **vertaalt de wereld**: alles wat
van de zee komt in wereldcoördinaten wordt bij de draad verschoven met `-homeOrigin`, en
alles wat naar de zee gaat met `+homeOrigin`. `homeOrigin` is daarmee één getal met één
betekenis: de vertaling tussen zee-frame en scene-frame. Thuis blijft `[0,0]` in alles wat
tekent, en `layout.json` en de terrain blijven lokaal, zoals ze altijd waren.

Het alternatief — alles van thuis in een groep op `homeOrigin` hangen — raakt elke plek
waar main.js iets aan `scene` toevoegt (tientallen), en de CSS3D-panelenlaag, en de camera.
Vertalen bij de draad raakt een handvol plekken die toch al de grens tussen twee machines
zijn.

## Wat het werd

| wat | waar | richting |
|---|---|---|
| de twee regels | `worldToScene` / `sceneToWorld` in `shared/regions.mjs` | — |
| eigen pose (`t:'p'`), eigen boot (`t:'boat' moved`), aanspreken (`t:'attend'`) | `web/js/net.js`, bij het versturen (`outgoing`) | scene → wereld |
| poses van anderen (`t:'s'`), boten uit de welcome en uit `t:'boat'` | `web/js/net.js`, bij het ontvangen, vóór `peers.snapshot` / `onBoat` | wereld → scene |
| regio's van gasten | `joinIsland`: `placeIsland(terrain, { origin: worldToScene(row.origin, homeOrigin) })` | wereld → scene |
| silhouetten van de verre vloot | `syncHorizon`: `horizon.pin(id, worldToScene(row.origin, …))` | wereld → scene |
| thuis | `buildScene` en `layLandscape`: altijd `origin: [0, 0]` | — |
| bewoners van gasten, hun rides, andermans borden | niets: die reizen in het eigen frame van hun eiland en krijgen `region.origin` erbij, dat dan al vertaald is | — |

`net.js` krijgt de ligplaats als functie (`frame: () => state.homeOrigin`) en leest hem bij
élk bericht. Verandert hij, dan gaat onze pose op de volgende beat uit, ook als onze voeten
niet bewogen: voor de zee is een verschoven ligplaats een verschoven lichaam.

`homeOrigin` wordt **bijgehouden**, niet één keer geleerd. `rehomeFrom(rows)` leest ons
eigen rijtje elke keer dat de vloot nieuws is (welcome én `island joined/rev/gone`), en
`rehome(origin)` zet de vertaling, haalt elke gastregio neer (de fleet-sync erna zet ze
terug waar ze nu horen) en wist de laatste twee poses van de andere spelers, want die staan
in het oude frame; de eerstvolgende roster van de zee zet ze terug.

En `doSyncFleet` bouwt **niemand op voordat de zee ónze ligplaats heeft gezegd**
(`berthed`). De welcome van een joiner is er meestal eerder dan de publicatie van zijn
islander, dus even heeft de vloot iedereen behalve ons; bouwen tegen een onbekende
ligplaats zette de host op thuis en gaf vijf "overlaps home"-waarschuwingen per join — en
dat is precies de waarschuwing die de eerste middag debuggen de verkeerde kant op stuurde.
Een pagina zonder islander (`islandId` null) heeft geen ligplaats om op te wachten.

## Wat níet veranderde

- De zee. Poses reizen in wereldcoördinaten, `nextOrigin()` blijft de politiek,
  `clearOf()` de invariant. Dit was een tekenkwestie van de pagina.
- `layout.json`, `shared/terrain.mjs`, de bundel. Alles lokaal, zoals het was.
- De host. Voor het eerste eiland in een zee is `homeOrigin` `[0,0]` en is de vertaling de
  identiteit; wat werkte bleef tot op de decimaal hetzelfde.

## Hoe het is nagekeken

Lokaal, zonder tweede machine, met een tweede islander uit een verse worktree op HEAD
(`Contextholm`, poort 4748, `mode: single`, dus met een eigen zee op 4750), en Promptholm
via `POST /api/sea` daarin gejoind. De zee zette Contextholm op `[0,0]` en ons op `[304,0]`.

Op de pagina van de **joiner** (Promptholm, de code van deze branch):

- `state.homeOrigin` `[304,0]`; thuisregio `[0,0]`; Contextholm als gastregio op
  `[-304,0]`, 71 gebouwen en 54 bewoners opgebouwd; in de screenshot een compleet eiland
  in het water ten westen van het onze, geen mist.
- Lopend op scene `[2.5, 4.7]` zag de zee ons op `[306.5, 4.7]` (sonde op de socket).
- De host, lopend op zijn scene `[2.5, 4.7]` (wereld `[2.5, 4.7]`), stond op onze pagina op
  scene `[-301.5, 4.7]`, als mesh én in `peers.blockers()`.

Op de pagina van de **host** (Contextholm): `homeOrigin` `[0,0]`, Promptholm als gast op
`[304,0]` met 132 gebouwen — precies wat er vóór deze wijziging ook al werkte.

`tests/regions.test.mjs` houdt de twee functies aan elkaar als exacte inversen en aan de
identiteit voor een host. De pagina zelf is alleen met de hand te controleren; het recept
hierboven is daarvoor: `git worktree add --detach ../Settlers-test HEAD`, `web/vendor`
kopiëren, een config met `mode: single` en een andere poort, en dan het eigen eiland laten
joinen.

## Wat daarnaast is verholpen

De zee gooide **elke verbinding die zestig seconden zweeg** eruit als "idle": ook de
islander, wiens socket zijn hele aanwezigheid is, en ook een pagina die alleen kijkt. Voor
de islander betekende dat een geforceerde herpublicatie en een herbouwde menigte per minuut
— elke bewoner terug naar zijn deur, op ieder scherm — en in `data/server.log` een
"joined"-regel per minuut, de hele dag. `lib/players.mjs` veegt nu alleen nog *lopende*
lichamen, want alleen die staan ergens als standbeeld; `tests/sea-idle.test.mjs`.

En de sleutel van een zee gold alleen op de socket: een islander die daar werd geweigerd
publiceerde zijn eiland tóch over HTTP, en die kopie bleef eeuwig liggen (`live: true`
zonder socket die kon wegvallen), onder een token die de islander bij zijn volgende herstart
kwijt was. Nu vraagt de zee de sleutel ook op `/island/:id` en `/island/:id/parcel`, en telt
een publicatie zonder islander op de lijn niet als levend; `tests/sea-key.test.mjs`.
