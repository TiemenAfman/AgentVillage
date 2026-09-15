using Godot;
using Promptholm.Visual;

namespace Promptholm.Tools;

/// <summary>
/// Paint the ground textures instead of photographing it.
///
/// The three slots the terrain uses came from ambientCG: photoscans of real turf, real granite
/// and real cobbles. They are excellent photographs and they fight everything else on the
/// island, which is chunky, faceted and flat-coloured. A photoscanned lawn under a low-poly
/// hill reads as a mistake in one of the two, and the hill is not the mistake.
///
/// So the same brush strokes that give a boulder its surface (<see cref="BrushTexture"/>, used
/// by RockMesh) are baked into the pair of maps Terrain3D wants, and the photoscans drop out.
/// The rock slot is generated from *exactly* the parameters RockMesh uses, so a rocky slope and
/// the boulder standing on it are the same painting.
///
/// Three things about the packing, each of which has already cost someone an afternoon:
///
///   * **Albedo is a modulation, not a colour.** The strokes come out around 1.0, not around
///     0.5, because the biome colour comes from the terrain's colour map and this only has to
///     vary it. A field averaging 0.35 multiplied into grass gives a bog.
///   * **Alpha carries height** beside the albedo and roughness beside the normal - that is
///     what the _alb_ht / _nrm_rgh suffixes mean. Terrain3D reads the height both to bias the
///     blend between two slots and to shade the grain.
///   * **Every slice of the array must be the same format and size, and must have mipmaps.**
///     Hand it one mismatch and it rejects the entire asset list with
///     "Texture ID N albedo format: X doesn't match format of first texture: Y", the terrain
///     silently falls back to nothing, and every later material change appears to do nothing
///     because there is no material left to change. Hence RGBA8 PNG at one size, and
///     mipmaps/generate=true in each .import afterwards.
///
///   Godot..._console.exe --headless --path &lt;godot&gt; --script res://src/Tools/StrokeTexturesRunner.cs
/// </summary>
public partial class StrokeTexturesRunner : SceneTree
{
	private const string Target = "res://assets/terrain-strokes";

	/// <summary>Pixels a side, for every map. 512 is grain, not detail, and grain is all this is.</summary>
	private const int Size = 512;

	/// <summary>
	/// One painted surface: the stroke field it is made of, and how the albedo reads it.
	/// </summary>
	private readonly record struct Painted(
		string Name,
		uint Seed,
		int Strokes,
		int Steps,
		float Lean,
		float LengthScale,
		float Low,
		float High,
		float NormalStrength);

	private static readonly Painted[] Sets =
	[
		// Meadow. Soft sweeps with a direction you can see but not name: lean was 0.62 and from
		// the air a whole hillside read as corduroy, because Terrain3D repeats this every three
		// metres and every repeat leans the same way. The contrast is deliberately small - the
		// colour map does the colour, and this only has to keep it from being a flat fill.
		new("ground", 5171u, 380, 5, 0.42f, 0.95f, 0.90f, 1.07f, 1.6f),
		// Stone. The seed and every parameter are RockMesh.StoneMaterial()'s, so the rocky
		// ground under a boulder is the same painting as the boulder.
		new("rock", 2701u, 260, 5, 0.55f, 1.00f, 0.84f, 1.09f, 2.4f),
		// Worn flagstone. Short dabbed marks going every which way - a paved square is laid, not
		// brushed - and more contrast, because the wear between the stones is the whole point.
		new("paving", 8123u, 520, 4, 0.25f, 0.55f, 0.80f, 1.12f, 2.2f),
	];

	/// <summary>
	/// Flat and matte. The shader adds the colour map's alpha to this as a signed offset, and the
	/// colour map writes a neutral 0.5, so what is here is what the ground gets.
	/// </summary>
	private const float Roughness = 0.9f;

	private int _ticks;

	public override bool _Process(double delta)
	{
		if (++_ticks != 1) return false;

		string dir = ProjectSettings.GlobalizePath(Target);
		DirAccess.MakeDirRecursiveAbsolute(dir);

		int done = 0;
		foreach (var set in Sets)
		{
			if (Write(set, dir)) done++;
		}

		GD.Print($"painted {done} of {Sets.Length} texture sets into {Target}");
		Quit(done == Sets.Length ? 0 : 1);
		return true;
	}

	private static bool Write(Painted set, string dir)
	{
		// The same field twice, read two different ways. Same seed and same parameters means the
		// strokes land in the same places, so the height is in register with the albedo rather
		// than being a second, unrelated painting sitting underneath it.
		var albedo = BrushTexture.Strokes(set.Seed, Size, set.Strokes, set.Steps, set.Lean, set.Low, set.High, set.LengthScale).GetImage();
		// Height from 0.03 rather than 0.0. The importer's fix_alpha_border is off below, but a
		// pixel at exactly zero alpha is what half the tooling in a pipeline reads as
		// "transparent, colour irrelevant", and here the colour is the whole point.
		var height = BrushTexture.Strokes(set.Seed, Size, set.Strokes, set.Steps, set.Lean, 0.03f, 1.0f, set.LengthScale).GetImage();
		var normals = BrushTexture.StrokeNormals(set.Seed, Size, set.NormalStrength, set.Strokes, set.Steps, set.Lean, set.LengthScale).GetImage();

		var albHt = Pack(albedo, height);
		var nrmRgh = Pack(normals, null);

		var a = albHt.SavePng($"{dir}/{set.Name}_alb_ht.png");
		var n = nrmRgh.SavePng($"{dir}/{set.Name}_nrm_rgh.png");
		if (a != Error.Ok || n != Error.Ok)
		{
			GD.PushWarning($"{set.Name}: could not write to {dir} ({a}, {n})");
			return false;
		}

		WriteImportHints($"{dir}/{set.Name}_alb_ht.png");
		WriteImportHints($"{dir}/{set.Name}_nrm_rgh.png");

		GD.Print($"  {set.Name}  {Size}x{Size}  strokes={set.Strokes} steps={set.Steps} lean={set.Lean} length={set.LengthScale}");
		return true;
	}

	/// <summary>
	/// Lay down the import settings *before* Godot ever sees the PNG.
	///
	/// The importer defaults a texture to no mipmaps, and Terrain3D refuses an array slice that
	/// has none - "Texture ID N has no mipmaps". Setting it by hand after each import is a step
	/// that will be forgotten exactly once, and the symptom is a terrain with no material at all
	/// rather than an error anyone connects to this. So the .import is written here, and the
	/// scan that follows fills in the uid and the destination and leaves these alone.
	/// </summary>
	private static void WriteImportHints(string pngPath)
	{
		string path = pngPath + ".import";
		if (Godot.FileAccess.FileExists(path)) return;

		string res = ProjectSettings.LocalizePath(pngPath);
		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Write);
		if (file is null) { GD.PushWarning($"could not write {path}"); return; }
		file.StoreString(
			"[remap]\n\nimporter=\"texture\"\ntype=\"CompressedTexture2D\"\n\n" +
			$"[deps]\n\nsource_file=\"{res}\"\n\n" +
			"[params]\n\n" +
			// Lossless, so the array really is RGBA8 and the height in the alpha survives.
			"compress/mode=0\n" +
			"mipmaps/generate=true\n" +
			"mipmaps/limit=-1\n" +
			// Off, because a height of zero is a legitimate value here and not a transparent
			// pixel: the border fix would bleed neighbouring colour into it.
			"process/fix_alpha_border=false\n" +
			// Leave it alone when the terrain starts using it in 3D; the settings above are the
			// point and a silent reimport to VRAM compression would undo them.
			"detect_3d/compress_to=0\n");
	}

	/// <summary>
	/// RGB from one image, alpha from the red channel of another - or the flat roughness when
	/// there is no second image - as RGBA8. One format for every slice of the array; see the
	/// class comment for what a mismatch costs.
	/// </summary>
	private static Image Pack(Image rgb, Image? alpha)
	{
		var image = Image.CreateEmpty(rgb.GetWidth(), rgb.GetHeight(), false, Image.Format.Rgba8);
		for (int y = 0; y < rgb.GetHeight(); y++)
		{
			for (int x = 0; x < rgb.GetWidth(); x++)
			{
				var c = rgb.GetPixel(x, y);
				c.A = alpha is null ? Roughness : alpha.GetPixel(x, y).R;
				image.SetPixel(x, y, c);
			}
		}
		return image;
	}
}
