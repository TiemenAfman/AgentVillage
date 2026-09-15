using System.Collections.Generic;
using Godot;

namespace Promptholm.Visual;

/// <summary>
/// One place for the island's colours and its materials.
///
/// Two problems this solves. First, six separate colour sets had grown across BuildingCatalog,
/// WorldManager, PropSpawner, FarmlandSpawner, DistrictDecorator and CivicDecorator, so there
/// was no such thing as "the island's green". Second, each of those files had its own
/// <c>SolidMat(Color)</c> helper that returned <c>new StandardMaterial3D</c> on every call, so
/// every market-stall slat and field slab carried a private material — see VerifyMetricsRunner
/// for the count. The factories here cache on their full recipe, so identical requests share
/// one resource and the scene batches.
///
/// <see cref="Style"/> is the per-model palette ported from the GDScript kit
/// (<c>scripts/kit_primitives.gd</c>), the only place where a settler's model was ever
/// expressed as colour. The C# rewrite never picked it up, which is part of why 163 buildings
/// read as one building.
/// </summary>
public static class Palette
{
	// ---- named colours --------------------------------------------------------

	/// <summary>Warm storybook cream for plastered walls.</summary>
	public static readonly Color Plaster = new(0.94f, 0.90f, 0.82f);

	/// <summary>Dark half-timber beam.</summary>
	public static readonly Color Beam = new(0.32f, 0.20f, 0.11f);

	public static readonly Color Fieldstone = new(0.60f, 0.58f, 0.55f);
	public static readonly Color FieldstoneDark = new(0.52f, 0.50f, 0.47f);
	public static readonly Color RoofTile = new(0.74f, 0.32f, 0.18f);
	public static readonly Color RoofSlate = new(0.30f, 0.33f, 0.40f);
	public static readonly Color RoofGreen = new(0.36f, 0.54f, 0.29f);
	public static readonly Color Thatch = new(0.82f, 0.74f, 0.48f);
	public static readonly Color Wood = new(0.40f, 0.27f, 0.15f);
	public static readonly Color WoodLight = new(0.52f, 0.38f, 0.22f);
	public static readonly Color Iron = new(0.18f, 0.18f, 0.20f);
	public static readonly Color Copper = new(0.72f, 0.45f, 0.20f);
	public static readonly Color Gold = new(0.85f, 0.72f, 0.35f);

	/// <summary>Lit window pane; nearly opaque so it reads as glass rather than a hole.</summary>
	public static readonly Color WindowGlass = new(0.98f, 0.88f, 0.52f, 0.92f);
	public static readonly Color Smoke = new(0.70f, 0.70f, 0.72f, 0.6f);

	// landscape
	public static readonly Color Seabed = new(0.20f, 0.32f, 0.35f);
	public static readonly Color SeabedDeep = new(0.03f, 0.07f, 0.12f);
	public static readonly Color Sand = new(0.90f, 0.82f, 0.58f);
	public static readonly Color Grass = new(0.40f, 0.64f, 0.26f);
	public static readonly Color GrassUpland = new(0.38f, 0.61f, 0.25f);

	// props & decoration
	public static readonly Color Foliage = new(0.24f, 0.62f, 0.30f);
	public static readonly Color FoliageDark = new(0.15f, 0.48f, 0.24f);
	public static readonly Color Trunk = new(0.45f, 0.31f, 0.18f);
	public static readonly Color Rock = new(0.52f, 0.52f, 0.53f);
	public static readonly Color Hedge = new(0.16f, 0.38f, 0.14f);
	public static readonly Color Loam = new(0.42f, 0.34f, 0.25f);
	public static readonly Color Furrow = new(0.49f, 0.42f, 0.31f);

	// built surfaces
	public static readonly Color Plank = new(0.45f, 0.30f, 0.18f);
	public static readonly Color Railing = new(0.38f, 0.25f, 0.15f);
	public static readonly Color Cobble = new(0.44f, 0.46f, 0.50f);
	public static readonly Color BridgeStone = new(0.52f, 0.52f, 0.54f);
	public static readonly Color CanvasCream = new(0.93f, 0.88f, 0.76f);
	public static readonly Color CanvasNavy = new(0.27f, 0.35f, 0.48f);
	public static readonly Color PondWater = new(0.22f, 0.72f, 0.68f, 0.82f);

	// ---- per-model style sets -------------------------------------------------

	/// <summary>The five colours that make one settler's model recognisable at a glance.</summary>
	public readonly record struct StyleSet(Color Wall, Color Trim, Color Roof, Color Accent, Color Glow);

	private static readonly StyleSet _fable = new(
		Hex(0xcfc4e6), Hex(0x6e5aa8), Hex(0xb87333), Hex(0x7a4fb0), Hex(0xffd27f));

	private static readonly StyleSet _opus = new(
		Hex(0xa8a59e), Hex(0x6f6b64), Hex(0x4c5566), Hex(0x5a3a24), Hex(0xffcf7a));

	private static readonly StyleSet _sonnet = new(
		Hex(0xf0e2c8), Hex(0x6b4a2f), Hex(0x5c8a4a), Hex(0x8a4b2a), Hex(0xffd88a));

	private static readonly StyleSet _haiku = new(
		Hex(0xd9b98c), Hex(0x7d5a3a), Hex(0xc9a75c), Hex(0x5a3c28), Hex(0xffe0a0));

	private static readonly StyleSet _unknown = new(
		Hex(0x9a9a9a), Hex(0x6f6f6f), Hex(0x6f6f6f), Hex(0x555555), Hex(0xffffff));

	/// <summary>
	/// Colours for a settler's model style. Ported verbatim from
	/// <c>scripts/kit_primitives.gd:7-13</c>; unrecognised styles fall back to the grey set.
	/// </summary>
	public static StyleSet Style(string? modelStyle) => (modelStyle ?? string.Empty).ToLowerInvariant() switch
	{
		"fable" => _fable,
		"opus" => _opus,
		"sonnet" => _sonnet,
		"haiku" => _haiku,
		_ => _unknown,
	};

	/// <summary>0xRRGGBB, matching how the GDScript kit wrote its palette.</summary>
	public static Color Hex(uint rgb) => Color.Color8(
		(byte)((rgb >> 16) & 0xff), (byte)((rgb >> 8) & 0xff), (byte)(rgb & 0xff));

	// ---- cached material factories --------------------------------------------

	private readonly record struct Recipe(
		Color Albedo, float Roughness, float Metallic, bool Transparent,
		Color Emission, float EmissionEnergy);

	private static readonly Dictionary<Recipe, StandardMaterial3D> _cache = [];

	/// <summary>Opaque matte material. Identical requests share one resource.</summary>
	public static StandardMaterial3D Solid(Color albedo, float roughness = 0.85f, float metallic = 0.0f)
		=> Get(new Recipe(albedo, roughness, metallic, false, default, 0.0f));

	/// <summary>Alpha-blended material, for water, canvas and smoke.</summary>
	public static StandardMaterial3D Translucent(Color albedo, float roughness = 0.85f)
		=> Get(new Recipe(albedo, roughness, 0.0f, true, default, 0.0f));

	/// <summary>Self-lit material; <paramref name="energy"/> 0 leaves emission switched off.</summary>
	public static StandardMaterial3D Emissive(
		Color albedo, Color emission, float energy, float roughness = 0.85f, bool transparent = false)
		=> Get(new Recipe(albedo, roughness, 0.0f, transparent, emission, energy));

	private static StandardMaterial3D Get(Recipe recipe)
	{
		if (_cache.TryGetValue(recipe, out var cached))
			return cached;

		var material = new StandardMaterial3D
		{
			AlbedoColor = recipe.Albedo,
			Roughness = recipe.Roughness,
			Metallic = recipe.Metallic,
		};

		if (recipe.Transparent)
			material.Transparency = BaseMaterial3D.TransparencyEnum.Alpha;

		if (recipe.EmissionEnergy > 0.0f)
		{
			material.EmissionEnabled = true;
			material.Emission = recipe.Emission;
			material.EmissionEnergyMultiplier = recipe.EmissionEnergy;
		}

		_cache[recipe] = material;
		return material;
	}

	/// <summary>Distinct materials handed out so far; VerifyMetricsRunner reports on this.</summary>
	public static int CachedMaterialCount => _cache.Count;
}
