# Bloom en anti-aliasing als instelling

**🚧 Status: plan van 30 september 2026, wordt nu gebouwd.**

## Aanleiding

De keeper zag een three.js-site waar bloom en AA als schakelaars direct werken, en na de lichtpass van de Salty
Kraken (`piratenkroeg.md`, "Licht") vroeg hij of wij dat hebben. De engine had MSAA van de canvas (`antialias: true`,
met terugval op zwakke machines) en ACES-tone mapping, maar geen postprocessing: geen EffectComposer, geen bloom, geen
SMAA. De gloed in de kroeg was nagebootst met halo's (`web/js/room-glow.js`).

## Besluiten

| Vraag | Besluit | Waarom |
|---|---|---|
| Welke passes | three's eigen addons, gevendord door `scripts/vendor.mjs`: `EffectComposer`, `RenderPass`, `UnrealBloomPass`, `SMAAPass`, `OutputPass` (+ `Pass`, `ShaderPass`, `MaskPass` en hun shaders) | Geen nieuwe dependency; ze horen bij de three die we al hebben. |
| Waar bloom werkt | **Alleen in kamers** (Uit / In kamers). Het eiland later. | Een composer rendert lineair naar een tussenbuffer en zet pas in `OutputPass` om naar schermkleur. De koepel, het water en een paar eigen shaders van het eiland schrijven al schermkleur; met een composer worden die twee keer omgezet. Eerst die shaders op `colorspace_fragment`, dan het eiland. Ook de alpha-gaten voor de borden (CSS3D onder de canvas) moeten dan getest worden. |
| AA | MSAA (standaard) / SMAA / Uit. In een kamer met bloom: MSAA = een multisampled render target (4), SMAA = de pass, Uit = geen van beide. Op het eiland: de canvas (MSAA en SMAA daar beide de canvas-MSAA); Uit werkt na herladen, want de canvas krijgt `antialias` bij het maken. | De canvas-MSAA werkt niet meer zodra naar een render target wordt getekend. |
| De halo's | Blijven wanneer bloom uit staat; met bloom verborgen (`inside.setBloom`). | Echte bloom maakt ze dubbel. |
| Kleuren van de eigen room-shaders | `room-glow.js` schrijft lineair en eindigt op `colorspace_fragment`, zodat ze op het scherm en in de composer gelijk uitkomen. | Anders schieten de lichtbundels in de composer omhoog. |
| Waar het wordt bewaard | Per browser, `promptholm.post.v1` in `graphics-settings.js` (`loadPost`/`savePost`), naast de afstanden; de telefoon begint met bloom uit. | Net als de afstanden: het is de grafische kaart van deze machine. |
| Waar je het zet | Settings → Graphics: Bloom (Uit / In kamers) + sterkte, Anti-aliasing (MSAA / SMAA / Uit). Werkt direct. | Zoals de schuifjes. |

## Code

- `web/js/post.js`: `createPost(renderer)` met `render(scene, camera, { room })` - een gewone render, of de composer als
  er in deze context iets aan staat; houdt de grootte bij de pixel ratio van de governor.
- `main.js`: de ene `renderer.render` in `frame()` wordt `post.render`; `onPostSetting` bewaart en past toe.
- `interior.js`: `setBloom(on)` verbergt de halo's.
