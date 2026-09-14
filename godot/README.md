# Promptholm Godot Spike

Fase 1: Godot als kijker naast de bestaande webclient.

Wat deze spike nu doet:

- leest live data van `http://localhost:4747/village.json` en `http://localhost:4747/api/props`
- rendert een simpele 3D-versie van het eiland: land, water, cleared tiles, paden, districten, gebouwen en props
- WASD beweegt de camera, Q/E omhoog/omlaag, rechtermuis slepen kijkt rond
- valt terug op een kleine sample als de Node-server niet draait

Openen:

```powershell
D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64.exe --path D:\git\Martijn\AgentVillage-godot-45\godot
```

Headless sanity-check:

```powershell
D:\Software\Godot_v4.7.2-stable_mono_win64\Godot_v4.7.2-stable_mono_win64_console.exe --headless --path D:\git\Martijn\AgentVillage-godot-45\godot --quit-after 1
```

Dit gebruikt bewust GDScript. Voor deze spike is dat minder setup dan C#/Mono en laat het sneller zien of Godot als client prettig voelt. Een C#-variant kan later.
