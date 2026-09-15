using System;
using Godot;

namespace Promptholm.Tools;

/// <summary>
/// Repack ambientCG maps into the pairs Terrain3D wants.
///
/// Terrain3D puts every ground texture into one texture array, and an array has one format for
/// all of its slices. Hand it a JPEG next to a PNG and it refuses the lot:
///
///   Texture ID 2 albedo format: 4 doesn't match format of first texture: 5.
///
/// The whole asset list then fails to build, the terrain falls back to nothing, and - this is
/// the part that cost an afternoon - every later change to the material appears to do nothing,
/// because there is no material left to change. The renders came back byte-identical while the
/// shader parameters, the UV scale and the texture resolution were all being altered underneath.
///
/// So everything is converted to the same thing: RGBA8 PNG, mipmapped, with the fourth channel
/// carrying what Terrain3D expects there - height beside the albedo, roughness beside the
/// normal. That is what the _alb_ht / _nrm_rgh suffixes on the demo textures mean.
///
///   Godot..._console.exe --headless --path &lt;godot&gt; --script res://src/Tools/PackTexturesRunner.cs
/// </summary>
public partial class PackTexturesRunner : SceneTree
{
	private const string Source = "res://assets/ambientcg";
	/// <summary>
	/// Not assets/terrain, which is in git and holds the small demo pair that guarantees a fresh
	/// clone has *a* ground. Four sets at 4K is a quarter of a gigabyte of PNG; that belongs
	/// beside the downloads, outside the repo, rebuildable in one command.
	/// </summary>
	private const string Target = "res://assets/terrain-packed";

	/// <summary>Names as they sit in assets/ambientcg, and what they are called afterwards.</summary>
	private static readonly (string From, string To)[] Wanted =
	[
		("ground037", "ground037"),
		("rock023", "rock023"),
		("rocks025", "rocks025"),
	];

	private int _ticks;

	public override bool _Process(double delta)
	{
		if (++_ticks != 1) return false;

		int done = 0;
		foreach (var (from, to) in Wanted)
		{
			if (Pack(from, to)) done++;
		}

		GD.Print($"packed {done} of {Wanted.Length} texture sets into {Target}");
		Quit(done == Wanted.Length ? 0 : 1);
		return true;
	}

	private static bool Pack(string from, string to)
	{
		var colour = Load($"{Source}/{from}/{from}_col.jpg");
		var normal = Load($"{Source}/{from}/{from}_nrm.jpg");
		var rough = Load($"{Source}/{from}/{from}_rgh.jpg");
		if (colour is null || normal is null)
		{
			GD.PushWarning($"{from}: no colour or normal map in {Source}/{from}/");
			return false;
		}

		// Height in the albedo's alpha. We do not keep the displacement map - it is a third of
		// the download and Terrain3D only uses it to bias the blend between two textures - so a
		// flat 0.5 goes in, which means "no opinion" rather than a wrong one.
		var albedo = WithAlpha(colour, null, 0.5f);
		var nrmRgh = WithAlpha(normal, rough, 0.5f);

		string dir = ProjectSettings.GlobalizePath(Target);
		DirAccess.MakeDirRecursiveAbsolute(dir);
		var a = albedo.SavePng($"{dir}/{to}_alb_ht.png");
		var n = nrmRgh.SavePng($"{dir}/{to}_nrm_rgh.png");
		if (a != Error.Ok || n != Error.Ok)
		{
			GD.PushWarning($"{from}: could not write to {dir} ({a}, {n})");
			return false;
		}

		GD.Print($"  {from} -> {to}  {albedo.GetWidth()}x{albedo.GetHeight()}");
		return true;
	}

	private static Image? Load(string path)
	{
		if (!Godot.FileAccess.FileExists(path)) return null;
		var texture = GD.Load<Texture2D>(path);
		return texture?.GetImage();
	}

	/// <summary>
	/// The RGB of one image with the red channel of another in its alpha, as RGBA8.
	///
	/// Both maps come out of the same pack at the same size, but the check is here anyway: a
	/// mismatched roughness map would otherwise read off the end of the row and produce a
	/// texture that is subtly, unfixably wrong.
	/// </summary>
	private static Image WithAlpha(Image rgb, Image? alpha, float fallback)
	{
		var image = Image.CreateEmpty(rgb.GetWidth(), rgb.GetHeight(), false, Image.Format.Rgba8);
		bool sized = alpha is not null
			&& alpha.GetWidth() == rgb.GetWidth() && alpha.GetHeight() == rgb.GetHeight();
		if (alpha is not null && !sized)
			GD.PushWarning("the alpha map is a different size from the colour map; using the flat value");

		for (int y = 0; y < rgb.GetHeight(); y++)
		{
			for (int x = 0; x < rgb.GetWidth(); x++)
			{
				var c = rgb.GetPixel(x, y);
				c.A = sized ? alpha!.GetPixel(x, y).R : fallback;
				image.SetPixel(x, y, c);
			}
		}
		return image;
	}
}
