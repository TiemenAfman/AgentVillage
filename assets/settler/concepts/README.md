# Refined traveller studies

Three original Blender concepts derived from Promptholm's existing traveller wardrobe and proportions. Built and rendered in Blender 5.2 with smooth surfaces, rounded edges, continuous sleeves, smaller facial features and curved hat brims.

1. **Vertrouwd en zacht**: rounded proportions closest to the original, softer clothing and a quiet face.
2. **Slanke reiziger**: narrower body, longer legs, smaller head and a gently curved hat.
3. **Ambachtelijk karakter**: intermediate proportions, fitted sage waistcoat, piping and a leather belt pouch.

## Files

- `comparison.png`: all three under the same studio camera and lighting, ordered 1–3 from left to right.
- `variant-1.png`, `variant-2.png`, `variant-3.png`: full-resolution individual previews.
- `variant-1.blend`, `variant-2.blend`, `variant-3.blend`: editable scenes with the corresponding concept visible; the other two collections are hidden.
- `three-travellers.blend`: editable side-by-side comparison.
- `../../../scripts/build-settler-concepts.py`: reproducible modelling and rendering script.

Run from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --python scripts/build-settler-concepts.py
```

These files preserve the three visual studies. Concept 3 was selected and is now
implemented by `scripts/build-settler.py` in `../promptholm-settler.blend` and the game.
The production version has fitted equipment, animation groups and exported smooth
normals. The concept scenes retain their denser geometry and fabric bump detail.
