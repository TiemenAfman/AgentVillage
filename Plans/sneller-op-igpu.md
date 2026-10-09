# Sneller op de iGPU

**🚧 Status: gemeten op 9 oktober 2026. De vlag van het venster is gerepareerd, en welke onderdelen
lichter moeten kiest de keeper.**

## Aanleiding

De keeper: "de graphics is een issue". Zijn `?stats`-regel was
`modest · lightest · 81 calls · 333k tris | shadow 72 calls | 55.4 ms/frame · 15.8 ms work`: ~18 fps, terwijl
het werk van de pagina maar 16 ms was. Dat wijst op de GPU. `modest` betekent dat WebGL een Intel meldde. Deze
laptop heeft een **Intel Arc** (stuurt het laptopscherm, 3840×2400) en een **RTX 4090 Laptop** (stuurt de
AOC-monitor, 3440×1440).

## Wat er mis was: de vlag deed niets

`src-tauri/src/lib.rs` gaf WebView2 `--force-high-performance-gpu` mee. Chromium vergelijkt switches letterlijk,
en de echte naam is `force_high_performance_gpu`, met underscores. Gemeten in Chrome met een eigen profiel:

| Vlag | WebGL-renderer |
|---|---|
| geen | RTX 4090 (de AOC hangt aan de RTX) |
| `--force-low-power-gpu` (streepjes) | RTX 4090: genegeerd |
| `--force_low_power_gpu` (underscores) | Intel Arc |
| WebView2 (oude exe) + env `--force_low_power_gpu` | Intel Arc: WebView2 volgt de underscore-vorm ook |
| nieuwe exe, `--force_high_performance_gpu` | RTX 4090 |

Zonder geldige vlag neemt Chromium de kaart die het scherm aanstuurt. Met de AOC aan is dat toevallig de RTX. Op
het laptopscherm alleen is het de Arc, en dat geeft `modest` en 55 ms. De vlag staat nu goed (`BROWSER_ARGS`).

- **Realtime wisselen kan niet.** Chromium kiest de adapter één keer, bij het starten van het GPU-proces.
  `powerPreference: 'high-performance'` (staat al op main.js `RENDERER_TRIES[0]`) verandert daar niets aan.
  Wisselen betekent het venster opnieuw starten met een andere vlag.
- **Een browsertab** (Chrome, `/play`) volgt alleen de Windows-grafische voorkeur voor chrome.exe. Die zet de
  keeper zelf (todo #175).
- `isModestGpu` (graphics-settings.js, verhuisd uit main.js) leest "Intel(R) Arc(TM) Graphics" als modest en de
  RTX niet. Een test borgt dat (`tests/quality-readout.test.mjs`).

## Profiel op de Arc, per onderdeel

GPU-tijd van één frame (de render van de scène, de schaduwpas inbegrepen) via `EXT_disjoint_timer_query_webgl2`,
in het échte venster (WebView2, 1600×1000, pixel ratio 1, `?quality=0` houdt de trede vast). Per onderdeel zes
korte paren aan/uit, en de mediaan van de verschillen. Frametijd was onbruikbaar: met de andere sessies erbij
liep die binnen één minuut 30-60% weg, en de Arc deelt zijn stroombudget met de bezette CPU.

Twee plekken: **boven** (noclip `cam=0,45,140`, het hele stadje van boven: 865 calls, 4,5M tris + schaduw 3,4M)
en **straat** (`4,2.2,40`, ooghoogte: 450 calls, 4,0M tris + schaduw 3,6M).

| Uit | Boven: bespaart (ms) | Straat: bespaart (ms) | Spreiding |
|---|---|---|---|
| *GPU-tijd van het hele frame* | *~36* | *~26* | |
| **Schaduwpas** (`shadowMap.autoUpdate = false`) | **14,1** | **6,6** | 20 / 2,6 |
| **Bewoners** (alle `resident-*`-batches) | **7,6** | **8,2** | 4,5 / 5,2 |
| **Building batch** | **7,2** | **3,7** | 4,8 / 14 |
| Pixel ratio 1 → 0,5 | 4,5 | 1,0 | 7 / 10 |
| Hemelkoepel | 2,2 | 0,5 | |
| Bomen (instanced) | 1,8 | 1,0 | |
| Mist (near/far naar 1e9) | 1,6 | 0,6 | |
| Water + oceaanschijf | 0,5 | 0,3 | |
| Zeebodem (van boven al uit) | 0,5 | 0,2 | |
| Wolken | ~0 | 0,5 | |
| Grond | ~0 | ~0 | |

Ter vergelijking, dezelfde meting in Chrome op de Arc met een venster van 3424×1305 (onder buildlast, spreiding tot
45 ms, alleen grof bruikbaar): het frame kostte 42-57 ms GPU, en pixel ratio 0,5 bespaarde daar 7-24 ms. Op een
groot scherm wordt vulsnelheid dus wél een factor. Het laptopscherm (3840×2400) is groter dan alles wat hier
gemeten is.

De RTX heeft geen profiel per onderdeel gekregen: het venster werd tijdens die meting gesloten. Van boven, in Chrome
op de RTX: 34 ms per frame bij 40 ms eigen werk, dus daar is de CPU het plafond en niet de GPU.

**CPU, los van de GPU:** van boven kostte het eigen werk van de pagina (`work`) 40 ms op de RTX en 37-60 ms op de
Arc. Met 485 bewoners is van boven de main thread het plafond, ook op de RTX (~30 fps). Dat valt buiten dit plan.

## Advies: waar de winst zit

1. **Venster op de RTX** (gedaan): dat was het hele probleem van de keeper. Met de nieuwe exe kiest het venster de
   RTX, ook zonder monitor.
2. **Schaduwpas op modest**: de grootste post, 6-14 ms. Mogelijke knoppen: de schaduwmap minder vaak verversen
   (de governor kan dat al, per n-de frame), Shadow Distance op `modest` korter, een kleinere map, en minder
   werpers (bewoners en bomen tekenen zichzelf ook in de schaduwpas).
3. **Bewoners**: 7-8 ms, het dubbele van alle gebouwen bij elkaar op straat. Elke bewoner is per instance
   geskind (17 gewrichten, twee invloeden) en wordt twee keer getekend (kleur + schaduw). Knoppen: geen schaduw
   voor bewoners op `modest`, het oude lichaam op `modest` (`?skinned=0`), of NPC Distance op `modest` korter.
4. **Building batch**: 4-7 ms. Object Distance op `modest` is al 0,7× View Distance. Een lagere `OBJECT_RATIO`
   alleen voor de iGPU zou het verkleinen.
5. **Pixel ratio**: weinig op 1600×1000, veel op een groot scherm. `modest` tekent nu op `min(dpr, 1.15)`. Voor
   het 4K-paneel zou een plafond op het aantal pixels (in plaats van op de ratio) eerlijker zijn.
6. Water, zeebodem, hemel, wolken, mist, grond en bomen: elk ≤ 2 ms, niet de moeite van een kwaliteitsverlies.

## Open: kiest de keeper

- Welke van 2-5 op `modest` lichter mogen, en hoeveel kwaliteit dat mag kosten.
- Of het venster een instelling "GPU: snel / zuinig" krijgt (herstart nodig, zie boven), bijvoorbeeld voor op de
  accu.
- Of de CPU-kant van boven (punt "CPU" hierboven) een eigen plan krijgt.

## Opnieuw meten

De scripts stonden in de scratchpad van de sessie. De opzet: Chrome met een eigen `--user-data-dir`,
`--remote-debugging-port`, `--disable-gpu-vsync --disable-frame-rate-limit` en een `--force_*_gpu`-vlag; of het
venster met `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` (dat wordt áchter de eigen
argumenten geplakt). De scène vind je via `__renderStats.breakdown()` (rijen → objecten → `parent` tot de Scene),
de renderer via één keer `scene.onBeforeRender`. Een timer query loopt van `scene.onBeforeRender` tot
`onAfterRender`. Laat het verborgen browserpaneel liggen: dat tekent geen frames.
