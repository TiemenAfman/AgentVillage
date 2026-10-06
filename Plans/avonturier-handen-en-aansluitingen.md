# ✅ Avonturier: handen en aansluitingen

De schouder en de overgang van nek naar hoofd moeten gesloten blijven tijdens bewegen.
Beide ogen krijgen een duidelijk zichtbare iris en pupil. De bestaande bronvingers krijgen
hun eigen gewrichten en huidgewichten terug, met een ontspannen rustpose en een grijpstand.

1. Inspecteer bronmodel, geëxporteerde geometrie en bewegende rig.
2. Repareer aansluitingen en ogen in het reproduceerbare Blender-script.
3. Exporteer vingerketens en gewichten; koppel die aan de bestaande polsen in de runtime.
4. Controleer rust, beweging, uitrusting, opnieuw aankleden en deterministische export.

Geen nieuwe modellenloader of wijziging aan opgeslagen spelersgegevens nodig.

## Uitgevoerd

- De oogtextuur herhaalt nu zoals de bron: beide irissen en pupillen zichtbaar.
- Schouderdriehoeken behouden hun rompgewichten; gedeelde randpunten blijven bij
  stilstaan en sprinten op dezelfde plek. Nek en onderkant hoofd delen hun vervorming.
- Vijftien vingerbotten per hand behouden, met ontspannen ruststand en geleidelijke
  grijpstand bij uitrusting; opnieuw aankleden behoudt deze gewrichten en gewichten.
- Blender-bron en browsermesh opnieuw opgebouwd; herhalen geeft dezelfde meshhash.
- In de browser bekeken: stilstaan, sprinten, gezicht dichtbij en hamer vasthouden.
- Avatar-, karakter- en syntaxcontroles uitgevoerd, inclusief nieuwe regressies voor
  ogen, beweeglijke vingers en gesloten schoudernaden.
