using Godot;
using Promptholm.Visual;

namespace Promptholm.Tools;

/// <summary>
/// Paint the foliage cards, the way <see cref="StrokeTexturesRunner"/> paints the ground.
///
/// Same argument, one scale down: the ground textures stopped being photographs because a
/// photoscanned lawn under a low-poly hill reads as a mistake in one of the two, and a downloaded
/// grass atlas on top of a hand-painted ground would be that mistake again. What the card carries
/// is in <see cref="CardTexture"/>; this only writes it out.
///
/// Three things about the import, each of which has a counterpart in StrokeTexturesRunner and one
/// of which is deliberately the opposite:
///
///   * **Mipmaps on**, or the cards shimmer into white noise at twenty metres - there are tens of
///     thousands of them and each is a few pixels across at that range.
///   * **fix_alpha_border on**, which is where this differs from the terrain set. There the alpha
///     carries height and bleeding colour into it would corrupt the data; here the alpha is real
///     transparency, and without the bleed every mip level averages the blade with whatever black
///     sits in the transparent pixels beside it, so the grass grows a dark rim as it recedes.
///   * **detect_3d/compress_to=0**, so the first 3D use does not silently reimport to VRAM
///     compression and undo the two settings above.
///
///   Godot..._console.exe --headless --path &lt;godot&gt; --script res://src/Tools/FoliageCardsRunner.cs
/// </summary>
public partial class FoliageCardsRunner : SceneTree
{
	private int _ticks;

	public override bool _Process(double delta)
	{
		if (++_ticks != 1) return false;

		string dir = ProjectSettings.GlobalizePath(FoliageCards.Dir);
		DirAccess.MakeDirRecursiveAbsolute(dir);

		var cards = FoliageCards.All();
		int done = 0;
		foreach (var card in cards)
		{
			string path = $"{dir}/{card.Name}.png";
			var image = CardTexture.Paint(card.Seed, FoliageCards.Size, card.Tuft);
			var err = image.SavePng(path);
			if (err != Error.Ok)
			{
				GD.PushWarning($"{card.Name}: could not write to {dir} ({err})");
				continue;
			}
			WriteImportHints(path);
			GD.Print($"  {card.Name}  {FoliageCards.Size}x{FoliageCards.Size}  " +
				$"blades={card.Tuft.Count} height={card.Tuft.Height} arch={card.Tuft.Arch}");
			done++;
		}

		GD.Print($"painted {done} of {cards.Length} foliage cards into {FoliageCards.Dir}");
		Quit(done == cards.Length ? 0 : 1);
		return true;
	}

	/// <summary>
	/// Lay down the import settings before Godot ever sees the PNG; the scan that follows fills in
	/// the uid and the destination and leaves these alone. See the class comment for why each one
	/// is here, and StrokeTexturesRunner for what forgetting them costs.
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
			"compress/mode=0\n" +
			"mipmaps/generate=true\n" +
			"mipmaps/limit=-1\n" +
			"process/fix_alpha_border=true\n" +
			"detect_3d/compress_to=0\n");
	}
}
