using Godot;

namespace Promptholm.Visual;

/// <summary>
/// The card set the ground vegetation is drawn from: which tufts exist, and where they live.
///
/// One table, read by two callers - <c>FoliageCardsRunner</c>, which paints the PNGs, and
/// <see cref="Load"/>, which the spawner uses to fetch them. That is deliberate: the alternative
/// is a list of parameters in the runner and a list of file names in the spawner, and the day
/// somebody adds a variant to one and not the other the world loses a kind of grass without
/// saying anything.
/// </summary>
public static class FoliageCards
{
	/// <summary>Where the runner writes them, and the only place the spawner looks.</summary>
	public const string Dir = "res://assets/foliage-cards";

	/// <summary>Pixels a side. A card is between 20 and 60 cm on the ground and its silhouette is
	/// cut, not blended, so this is already more resolution than the cut can use.</summary>
	public const int Size = 256;

	/// <summary>One painted card: the file it lives in, and the tuft that made it.</summary>
	public readonly record struct Card(string Name, uint Seed, CardTexture.Tuft Tuft);

	/// <summary>
	/// Three of each, because the eye finds a repeated silhouette long before it finds a repeated
	/// texture - the same argument <c>RockSpawner</c> makes for three rock shapes.
	///
	/// Ground cover is short, wide and splayed: what it has to do is close the gap between the
	/// ground texture and anything standing on it, so it is nearly a mat. The blades are taller,
	/// narrower and much more upright, and they carry the wind - a tuft that sprawls sideways has
	/// nowhere to sway to.
	/// </summary>
	public static readonly Card[] Cover =
	[
		new("cover0", 3181u, new CardTexture.Tuft(9, 0.84f, 0.30f, 0.30f, 0.062f)),
		new("cover1", 5273u, new CardTexture.Tuft(7, 0.78f, 0.34f, 0.38f, 0.075f)),
		new("cover2", 9377u, new CardTexture.Tuft(11, 0.88f, 0.26f, 0.24f, 0.055f)),
	];

	public static readonly Card[] Blades =
	[
		new("blade0", 1487u, new CardTexture.Tuft(7, 0.86f, 0.17f, 0.13f, 0.045f)),
		new("blade1", 6221u, new CardTexture.Tuft(5, 0.91f, 0.13f, 0.09f, 0.038f)),
		new("blade2", 8039u, new CardTexture.Tuft(9, 0.80f, 0.21f, 0.18f, 0.050f)),
	];

	/// <summary>Every card there is, in the order the runner writes them.</summary>
	public static Card[] All()
	{
		var all = new Card[Cover.Length + Blades.Length];
		Cover.CopyTo(all, 0);
		Blades.CopyTo(all, Cover.Length);
		return all;
	}

	/// <summary>
	/// The painted PNG when the runner has been run, and the same painting made on the spot when
	/// it has not.
	///
	/// The fallback is not politeness. A missing card is a whole layer of vegetation that silently
	/// stops existing, and the terrain textures have already taught this project what that costs
	/// to diagnose. Painting it costs about a tenth of a second per card and looks identical,
	/// because it is the same function with the same seed.
	/// </summary>
	public static Texture2D Load(Card card)
	{
		string path = $"{Dir}/{card.Name}.png";
		if (ResourceLoader.Exists(path))
		{
			var texture = GD.Load<Texture2D>(path);
			if (texture is not null) return texture;
		}

		GD.PushWarning($"foliage card {path} is missing; painting it at run time. " +
			"Run src/Tools/FoliageCardsRunner.cs once and re-import to get it off disk.");
		return ImageTexture.CreateFromImage(CardTexture.Paint(card.Seed, Size, card.Tuft));
	}
}
