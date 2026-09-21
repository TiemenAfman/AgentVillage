# Wie joint ziet de host als mist

## Wat er gebeurt

Twee eilanden op één zee. De host ziet het eiland van de joiner compleet naast het zijne.
De joiner ziet het eiland van de host **alleen als mist**: een silhouet aan de horizon en
verder water. Vanaf beide kanten vastgesteld op 21 september 2026 (Promptholm host,
Hoogezand joint; daarna omgekeerd), en lokaal gereproduceerd met een tweede islander op
dezelfde machine.

De console van de joiner zegt het, dertien keer per minuut:

```
island: region <host-id> overlaps home
```

## Waarom

Twee dingen vallen samen.

1. **De pagina leert maar één keer waar haar eigen eiland ligt.** `learnTheWorld()` in
   `web/js/main.js` haalt bij het opstarten `GET /world` en zet `state.homeOrigin` op de
   `origin` van het eigen rijtje. Daarna nooit meer: niet als het eigen rijtje ná de welcome
   binnenkomt (de gewone volgorde bij joinen: de pagina verbindt eerder dan de islander
   publiceert), niet bij `followSea()`, niet bij een herstart van de zee. Voor een joiner
   blijft thuis dus `[0,0]`.

2. **Het eiland van de host ligt óók op `[0,0]`** — het was er eerst. `joinIsland` weigert
   een regio die over de eigen regio valt ("overlaps home"), dus het wordt nooit
   opgebouwd. Wat overblijft is het silhouet van `horizon.js` uit het baken op het LAN, en
   dat leest als mist.

Een herladen helpt niet, om een diepere reden: **de pagina kan haar eigen eiland alleen op
scene-oorsprong tekenen.** `world.js`, de gebouwen, de hamlets, de dokken van thuis hangen
allemaal direct in `scene` op lokale coördinaten ("at the origin for home", main.js bij de
dokken). Alleen `guest-island.js` zet zijn groep op `region.origin`. Zet `homeOrigin` na
een herlaad wél op `[304,0]`, dan zegt de thuisregio `[304,0]` terwijl de meshes op `[0,0]`
staan: de eigen bewoners (crowd-view telt `region.origin` erbij) lopen 304 eenheden naast
hun huizen, de spelers ook, en het eiland van de host wordt op `[0,0]` bovenop het onze
gebouwd. CLAUDE.md zegt "our own island stands where the sea says it does" — dat geldt nu
voor de regio-facade, niet voor wat er getekend wordt.

## De keuze

De pagina houdt haar eigen eiland op scene-oorsprong en **vertaalt de wereld**: alles wat
van de zee komt in wereldcoördinaten wordt bij de draad verschoven met `-homeOrigin`, en
alles wat naar de zee gaat met `+homeOrigin`. `homeOrigin` wordt daarmee één getal met één
betekenis: de vertaling tussen zee-frame en scene-frame. Thuis blijft `[0,0]` in alles wat
tekent, en `layout.json` en de terrain blijven lokaal, zoals ze altijd waren.

Het alternatief — alles van thuis in een groep op `homeOrigin` hangen — raakt elke plek
waar main.js iets aan `scene` toevoegt (tientallen), en de CSS3D-panelenlaag, en de camera.
Vertalen bij de draad raakt een handvol plekken die toch al de grens tussen twee machines
zijn.

## Waar de vertaling hoort

| wat | waar | richting |
|---|---|---|
| eigen pose (`t:'p'`), boot (`t:'boat'`), aanspreken (`t:'attend'`) | `web/js/net.js`, bij het versturen | scene → wereld: `+homeOrigin` |
| poses van anderen (`t:'s'`), andermans boten, cursors op borden | `web/js/peers.js` / `main.js`, bij het toepassen | wereld → scene: `-homeOrigin` |
| regio's van gasten | `joinIsland`: `placeIsland(terrain, { origin: row.origin - homeOrigin })` | wereld → scene |
| horizon-pins, `farFrom`, `nearestFirst` | `syncHorizon`, `doSyncFleet` | wereld → scene |
| bewoners van gasten, hun rides | niets: die reizen in het eigen frame van hun eiland en `crowd-view` telt `region.origin` erbij, dat dan al vertaald is | — |
| borden van anderen | `panels` krijgt wereldcoördinaten mee; vertalen bij `applyPanelMessage` | wereld → scene |

En `homeOrigin` wordt **bijgehouden**, niet één keer geleerd: in `onFleetNews`, zodra het
eigen rijtje een andere `origin` heeft dan de huidige, wordt de vertaling bijgesteld en
worden alle gastregio's opnieuw geplaatst (`dropRegion` + `syncFleet`). Dat is de weg die
`changeSea` nu al voor gasten loopt.

## Wat er níet verandert

- De zee. Poses reizen in wereldcoördinaten, `nextOrigin()` blijft de politiek,
  `clearOf()` de invariant. Dit is een tekenkwestie van de pagina.
- `layout.json`, `shared/terrain.mjs`, de bundel. Alles lokaal, zoals het was.
- De host. Voor het eerste eiland in een zee is `homeOrigin` `[0,0]` en is de vertaling de
  identiteit; wat vandaag werkt blijft tot op de decimaal hetzelfde.

## Verifiëren

Lokaal, zonder tweede machine: `island-buur` (poort 4748, `--no-rescan`) laten joinen op
de zee van `settlers`, en dan **op de pagina van de buur** kijken — niet op die van de host,
want daar werkte het al. Wat er te zien moet zijn: het eiland van de host compleet naast het
eigen eiland, het eigen eiland op de gewone plek met zijn eigen bewoners bij hun eigen deur,
een speler die van het ene naar het andere loopt op beide schermen op dezelfde plek. Geen
`overlaps home` in de console. `tests/regions.test.mjs` krijgt de vertaling erbij als
functie; de pagina zelf is alleen met de hand te controleren.

## Wat vandaag wél is verholpen

De zee gooide **elke verbinding die zestig seconden zweeg** eruit als "idle": ook de
islander, wiens socket zijn hele aanwezigheid is, en ook een pagina die alleen kijkt. Voor
de islander betekende dat een geforceerde herpublicatie en een herbouwde menigte per minuut
— elke bewoner terug naar zijn deur, op ieder scherm — en in `data/server.log` een
"joined"-regel per minuut, de hele dag. `lib/players.mjs` veegt nu alleen nog *lopende*
lichamen, want alleen die staan ergens als standbeeld; `tests/sea-idle.test.mjs`.
