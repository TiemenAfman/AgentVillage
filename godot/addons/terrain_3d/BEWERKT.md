# Wat er aan deze addon is veranderd

Upstream: https://github.com/TokisanGames/Terrain3D v1.0.2-stable (MIT).
Twee dingen zijn hier weggelaten; haal ze terug uit de release als je ze nodig hebt.

**`bin/` is teruggebracht tot Windows.** De release levert veertien platformbuilds mee, samen
40 MB. Dit project exporteert voor Windows. Voeg je een platform toe, haal dan de bijbehorende
binary én de regel in `terrain.gdextension` terug — anders weigert Godot de extensie te laden
op dat platform, zonder een duidelijke reden te noemen.

**`brushes/` is verwijderd** (12 MB). Dat zijn de penselen van de sculpt-editor. De wereld hier
komt procedureel uit de server, dus er wordt nooit met de hand gesculpt. Wil je de editor-plugin
alsnog aanzetten, haal ze dan terug — zonder de penselen werkt het sculptmenu niet.

De grondtexturen die de demo meelevert staan niet hier maar in `godot/assets/terrain/`: ze zijn
van ons project, niet van de addon.
