using System;
using Godot;
using Promptholm.Data.Models;
using Promptholm.Visual;
using Promptholm.World;

namespace Promptholm.Buildings.Data;

/// <summary>Which roof a building wears. The single strongest silhouette cue there is.</summary>
public enum RoofForm
{
	/// <summary>Two slopes to a ridge; the default village roof.</summary>
	Gable,

	/// <summary>Four slopes to a short ridge. Reads as squat and settled.</summary>
	Hip,

	/// <summary>Asymmetric: a short slope over the front, a long one running down the back.</summary>
	Saltbox,

	/// <summary>Barn roof: a steep lower pitch breaking to a shallow upper one.</summary>
	Gambrel,

	/// <summary>Flat roof behind a battlemented parapet. Keeps and castles.</summary>
	Parapet,

	/// <summary>Four slopes to a point. Towers and gatehouses.</summary>
	Pyramid,

	/// <summary>A cone. Lighthouse caps and windmill bonnets.</summary>
	Cone,

	/// <summary>One slope, front to back. The cheapest shed there is.</summary>
	Lean,
}

/// <summary>What kind of thing this is, before tier gets a say.</summary>
public enum BuildingFamily
{
	/// <summary>A session's house: six tiers, from a canvas A-frame to a keep.</summary>
	House,

	/// <summary>A subagent's shed. Small and plain, but not all the same.</summary>
	Shed,

	/// <summary>Town hall, chapel, school, tavern, castle: tall walls and a long ridge.</summary>
	CivicHall,

	/// <summary>Clock tower, lighthouse, windmill: a taper that beats every roof for silhouette.</summary>
	CivicTower,

	/// <summary>Boards, wells, offices, plaza furniture: one lot, waist-high, no pretence of a house.</summary>
	CivicKiosk,
}

/// <summary>
/// Everything about how one building looks, decided once from the data the server published.
///
/// The division of labour this file exists to keep: the server owns <em>where</em> a building
/// stands, how big its plot is and which tier it reached — none of that is decided here, and
/// <see cref="For"/> never touches a position. What is left over is the part the server has no
/// opinion about, which turns out to be the whole silhouette: how tall the walls are, which roof
/// sits on them, which way the ridge runs, whether there is a chimney and where it stands.
///
/// It was the missing half. All six house tiers share a 3×3 lot in the data, so with a fixed
/// wall height and one gable the tiers were literally indistinguishable — 163 buildings, four
/// measured silhouettes. Height, pitch and roof family are what make a manor read as a manor
/// from the far side of the island, and they cost nothing but a lookup table.
///
/// Every choice is hashed off <c>b.Id</c> via <see cref="PmRng.Hash32"/>, so a house keeps its
/// roof across runs, across restarts and across two people looking at the same island. Nothing
/// here reads a clock or a global RNG.
/// </summary>
public sealed record BuildingForm
{
	/// <summary>Height of the walls the roof sits on, in metres.</summary>
	public required float WallHeight { get; init; }

	/// <summary>How far the roof rises above <see cref="WallHeight"/>, in metres.</summary>
	public required float RoofRise { get; init; }

	/// <summary>How far the eaves reach out past the wall, per side, in metres.</summary>
	public required float Overhang { get; init; }

	public required BuildingFamily Family { get; init; }
	public required RoofForm Roof { get; init; }

	/// <summary>True when the ridge runs along X; false when it runs along Z.</summary>
	public required bool RidgeAlongX { get; init; }

	/// <summary>Chimneys on the roof, 0–2. Never centred — see BuildingMassing.</summary>
	public required int Chimneys { get; init; }

	/// <summary>Dormer windows poking through the front slope, 0–2.</summary>
	public required int Dormers { get; init; }

	/// <summary>A lean-to porch over the front door.</summary>
	public required bool Porch { get; init; }

	/// <summary>A corner turret rising past the parapet. Keeps and the castle.</summary>
	public required bool Turret { get; init; }

	/// <summary>Sails on the cap. The windmill, and only the windmill.</summary>
	public required bool Sails { get; init; }

	/// <summary>A walkway ringing the top of the tower. The lighthouse.</summary>
	public required bool Gallery { get; init; }

	/// <summary>Top radius of a tower as a fraction of its base; 1.0 is a straight shaft.</summary>
	public required float TaperTop { get; init; }

	public required Color Wall { get; init; }
	public required Color Trim { get; init; }
	public required Color RoofColour { get; init; }
	public required Color Accent { get; init; }

	/// <summary>Hash of the building id; everything downstream that needs jitter derives from it.</summary>
	public required uint Seed { get; init; }

	/// <summary>
	/// Piece id the Roof slot asks for. A hand-made <c>.tscn</c> of the same name under
	/// <c>res://prefabs</c> takes the slot over whole — see <c>PrefabOverrides</c>.
	/// </summary>
	public required string RoofPieceId { get; init; }

	/// <summary>A tower has one shaft instead of four walls, so BuildSlots lays it out differently.</summary>
	public bool IsTower => Family == BuildingFamily.CivicTower;

	/// <summary>Walls too low to put a window in get none, rather than a window in the gutter.</summary>
	public bool HasWindows => WallHeight >= 1.35f && Family != BuildingFamily.CivicKiosk;

	/// <summary>Door leaf height; a canvas A-frame cannot carry a full 1.5 m door.</summary>
	public float DoorHeight => Math.Clamp(WallHeight - 0.18f, 0.85f, 1.60f);

	/// <summary>Where the roof slot sits, and where the ornament above it goes.</summary>
	public float RidgeY => WallHeight + RoofRise;

	// ---- resolution -------------------------------------------------------------

	/// <summary>Walls by tier, in metres. The spread is the point: tent 0.90 against keep 4.40 is
	/// what makes tier legible from the overlook, given that every tier got the same 3x3 lot.</summary>
	private static readonly float[] TierWall = [0.90f, 1.60f, 2.25f, 2.85f, 3.60f, 4.40f];

	/// <summary>
	/// Roof pitch by tier, as a multiple of the half-span; 1.0 is 45 degrees. It falls as the
	/// walls rise, so the roof goes from being nearly the whole building (a canvas A-frame with a
	/// timber skirt) to a lid on two storeys of plaster.
	/// </summary>
	private static readonly float[] TierPitch = [0.92f, 0.76f, 0.58f, 0.54f, 0.50f, 0.24f];

	/// <summary>Eaves reach by tier. Grander buildings get a deeper shadow line under the roof.</summary>
	private static readonly float[] TierEave = [0.14f, 0.16f, 0.19f, 0.21f, 0.25f, 0.18f];

	private static readonly string[] Tiers = ["tent", "hut", "cottage", "house", "manor", "keep"];

	/// <summary>
	/// Resolves one building. <paramref name="w"/> and <paramref name="d"/> are the footprint the
	/// server's plot produced; they are read, never written.
	/// </summary>
	public static BuildingForm For(BuildingData b, float w, float d)
	{
		uint seed = PmRng.Hash32($"silhouette:{b.Id}");
		var family = FamilyOf(b);
		int tier = TierOf(b);
		float minSpan = MathF.Min(w, d);

		var style = Palette.Style(b.Style);
		var (roof, ridgeAlongX, wallH, rise, taper) = Massing(b, family, tier, minSpan, seed);

		return new BuildingForm
		{
			Seed = seed,
			Family = family,
			Roof = roof,
			RidgeAlongX = ridgeAlongX,
			WallHeight = wallH,
			RoofRise = rise,
			TaperTop = taper,
			Overhang = EaveOf(family, tier, minSpan),
			Chimneys = ChimneysOf(family, tier, seed),
			Dormers = DormersOf(family, tier, roof, seed),
			Porch = PorchOf(b, family, tier, seed),
			Turret = tier >= 5 || Is(b, "castle"),
			Sails = Is(b, "windmill"),
			Gallery = Is(b, "lighthouse"),
			Wall = Shade(WallPalette(family, tier).Lerp(style.Wall, StyleTint), seed, 0.09f, 0.012f),
			Trim = style.Trim,
			RoofColour = Shade(RoofPalette(family, tier, style, seed), seed ^ 0x5bd1u, 0.10f, 0.010f),
			Accent = style.Accent,
			RoofPieceId = RoofPieceIdOf(b, roof),
		};
	}

	/// <summary>
	/// The three numbers that carry the silhouette, plus the roof that goes with them.
	/// Towers are their own thing: the shaft <em>is</em> the building, so its height comes from
	/// the type rather than from a tier table.
	/// </summary>
	private static (RoofForm Roof, bool RidgeAlongX, float WallHeight, float Rise, float Taper) Massing(
		BuildingData b, BuildingFamily family, int tier, float minSpan, uint seed)
	{
		bool alongX = (seed & 0x10u) != 0;

		switch (family)
		{
			case BuildingFamily.CivicTower:
				// The lighthouse stops at 2.7 m because that is where LighthouseController mounts
				// its lantern and beam; a taller shaft would put the beam out of the tower's waist.
				if (Is(b, "lighthouse"))
					return (RoofForm.Cone, true, 2.40f, 0.62f, 0.62f);
				if (Is(b, "windmill"))
					return (RoofForm.Cone, true, 4.60f, 1.05f, 0.74f);
				return (RoofForm.Pyramid, true, 6.20f, 1.30f, 0.86f);

			case BuildingFamily.CivicHall:
			{
				if (Is(b, "castle"))
					return (RoofForm.Parapet, alongX, 4.60f, minSpan * 0.5f * 0.22f, 1.0f);
				if (Is(b, "chapel"))
					return (RoofForm.Gable, alongX, 3.10f, minSpan * 0.5f * 1.05f, 1.0f);
				float hallWall = Is(b, "townhall") ? 3.60f : 3.20f;
				return (RoofForm.Hip, alongX, hallWall, minSpan * 0.5f * 0.62f, 1.0f);
			}

			case BuildingFamily.CivicKiosk:
				// A notice board and a bench are not houses. Waist-high with a flat lid reads as
				// street furniture, which is what the data says they are.
				return (RoofForm.Parapet, alongX, 0.95f, 0.16f, 1.0f);

			case BuildingFamily.Shed:
			{
				// Three shapes, not one: a shed that is identical 128 times over is the single
				// most repeated object on the island.
				var form = (seed % 3u) switch
				{
					0u => RoofForm.Gable,
					1u => RoofForm.Saltbox,
					_ => RoofForm.Lean,
				};
				return (form, alongX, 1.35f, minSpan * 0.5f * 0.70f, 1.0f);
			}

			default:
			{
				float wallH = Math.Clamp(TierWall[tier], 0.6f, minSpan * 1.7f);
				float rise = Math.Clamp(TierPitch[tier] * minSpan * 0.5f, 0.24f, 3.2f);
				return (HouseRoof(tier, seed), alongX, wallH, rise, 1.0f);
			}
		}
	}

	/// <summary>
	/// Roof families widen as the tier rises: a canvas A-frame has exactly one shape, a house can
	/// be any of four. That is deliberate — variety itself reads as status.
	/// </summary>
	private static RoofForm HouseRoof(int tier, uint seed)
	{
		uint pick = PmRng.Hash32($"roof:{seed}") >> 8;
		return tier switch
		{
			0 => RoofForm.Gable,
			1 => (pick % 2u) == 0 ? RoofForm.Gable : RoofForm.Saltbox,
			2 => (pick % 3u) switch { 0u => RoofForm.Gable, 1u => RoofForm.Hip, _ => RoofForm.Saltbox },
			3 => (pick % 4u) switch
			{
				0u => RoofForm.Gable,
				1u => RoofForm.Hip,
				2u => RoofForm.Saltbox,
				_ => RoofForm.Gambrel,
			},
			4 => (pick % 3u) switch { 0u => RoofForm.Hip, 1u => RoofForm.Gambrel, _ => RoofForm.Gable },
			_ => RoofForm.Parapet,
		};
	}

	private static BuildingFamily FamilyOf(BuildingData b)
	{
		if (string.Equals(b.Kind, "shed", StringComparison.OrdinalIgnoreCase))
			return BuildingFamily.Shed;
		if (!string.Equals(b.Kind, "civic", StringComparison.OrdinalIgnoreCase))
			return BuildingFamily.House;

		if (Is(b, "lighthouse") || Is(b, "clocktower") || Is(b, "windmill"))
			return BuildingFamily.CivicTower;
		if (Is(b, "townhall") || Is(b, "chapel") || Is(b, "school") || Is(b, "castle") || Is(b, "tavern"))
			return BuildingFamily.CivicHall;
		return BuildingFamily.CivicKiosk;
	}

	/// <summary>Tier as an index into the tables above; anything unrecognised lands on "house".</summary>
	private static int TierOf(BuildingData b)
	{
		var tier = string.IsNullOrWhiteSpace(b.Tier) ? b.Kind : b.Tier;
		for (int i = 0; i < Tiers.Length; i++)
		{
			if (string.Equals(Tiers[i], tier, StringComparison.OrdinalIgnoreCase))
				return i;
		}
		return 3;
	}

	private static float EaveOf(BuildingFamily family, int tier, float minSpan)
	{
		float eave = family switch
		{
			BuildingFamily.Shed => 0.13f,
			BuildingFamily.CivicKiosk => 0.10f,
			BuildingFamily.CivicTower => 0.16f,
			BuildingFamily.CivicHall => 0.26f,
			_ => TierEave[tier],
		};
		// Never reach so far that a roof starts sharing a lot with the neighbour's: the nearest
		// wall-to-wall gap on this island is measured in centimetres, not metres.
		return MathF.Min(eave, minSpan * 0.13f);
	}

	private static int ChimneysOf(BuildingFamily family, int tier, uint seed)
	{
		if (family is BuildingFamily.Shed or BuildingFamily.CivicKiosk or BuildingFamily.CivicTower)
			return 0;
		if (family == BuildingFamily.CivicHall)
			return 2;
		if (tier == 0)
			return 0;
		if (tier >= 4)
			return 2;
		return tier >= 3 && (PmRng.Hash32($"stack:{seed}") & 1u) == 0 ? 2 : 1;
	}

	private static int DormersOf(BuildingFamily family, int tier, RoofForm roof, uint seed)
	{
		if (family != BuildingFamily.House || tier < 3)
			return 0;
		if (roof is not (RoofForm.Gable or RoofForm.Hip or RoofForm.Saltbox or RoofForm.Gambrel))
			return 0;
		if (tier >= 4)
			return 2;
		return (PmRng.Hash32($"dormer:{seed}") & 1u) == 0 ? 1 : 0;
	}

	private static bool PorchOf(BuildingData b, BuildingFamily family, int tier, uint seed)
	{
		if (Is(b, "tavern"))
			return true;
		if (family != BuildingFamily.House || tier is < 2 or > 4)
			return false;
		return (PmRng.Hash32($"porch:{seed}") % 5u) < 2u;
	}

	/// <summary>
	/// How much of the settler's model colour survives into the wall.
	///
	/// Not all of it, which is the whole point. 216 of the 264 buildings on this island are opus,
	/// and the opus wall is a grey stone, so taking <c>Palette.Style</c> at face value painted
	/// four fifths of the village the same grey — the uniformity problem, moved rather than
	/// solved. The tier picks the material and the model tints it, so a hut is still timber and a
	/// manor is still plaster while an opus one and a sonnet one are still told apart.
	/// </summary>
	private const float StyleTint = 0.40f;

	/// <summary>
	/// What a building's walls are made of, by tier: canvas and timber at the bottom, plaster in
	/// the middle, dressed stone at the top. The material reads at a distance where a window
	/// never will.
	/// </summary>
	private static Color WallPalette(BuildingFamily family, int tier) => family switch
	{
		BuildingFamily.Shed => Palette.Wood,
		BuildingFamily.CivicKiosk => Palette.Fieldstone,
		BuildingFamily.CivicTower => Palette.Plaster,
		BuildingFamily.CivicHall => Palette.Plaster,
		_ => tier switch
		{
			0 => Palette.Wood,          // the timber skirt under a canvas A-frame
			1 => Palette.WoodLight,
			2 => Palette.Plaster,
			3 => Palette.Plaster,
			4 => Palette.Plaster,
			_ => Palette.Fieldstone,
		},
	};

	/// <summary>
	/// Which of the palette's roof colours this building wears. Thatch on the poor tiers, tile in
	/// the middle, slate and verdigris at the top: the material tells you the tier before the
	/// shape does, and all of them already live in <c>Palette</c>.
	/// </summary>
	private static Color RoofPalette(BuildingFamily family, int tier, Palette.StyleSet style, uint seed)
	{
		uint pick = PmRng.Hash32($"tiles:{seed}") >> 5;
		return family switch
		{
			BuildingFamily.Shed => (pick % 2u) == 0 ? Palette.Wood : Palette.Thatch,
			BuildingFamily.CivicKiosk => Palette.RoofSlate,
			BuildingFamily.CivicTower => (pick % 2u) == 0 ? Palette.Copper : Palette.RoofTile,
			BuildingFamily.CivicHall => (pick % 2u) == 0 ? Palette.RoofSlate : Palette.RoofGreen,
			_ => tier switch
			{
				0 => Palette.CanvasCream,
				1 => Palette.Thatch,
				2 => (pick % 3u) == 0 ? Palette.Thatch : Palette.RoofTile,
				3 => (pick % 3u) == 0 ? Palette.RoofSlate : Palette.RoofTile,
				4 => (pick % 3u) == 0 ? Palette.RoofGreen : Palette.RoofSlate,
				_ => style.Roof,
			},
		};
	}

	/// <summary>
	/// The piece id the Roof slot asks for, which is also the file name a hand-made prefab has to
	/// carry to take the slot over. Buildings that deserve an authored roof get their own id; the
	/// rest share one per roof family, so a prefab dropped in for "roof_gable" would re-skin every
	/// gable on the island at once.
	/// </summary>
	private static string RoofPieceIdOf(BuildingData b, RoofForm roof)
	{
		if (Is(b, "townhall"))
			return "roof_townhall_cupola";
		if (Is(b, "lighthouse"))
			return "roof_lighthouse_lantern";
		return "roof_" + roof.ToString().ToLowerInvariant();
	}

	private static bool Is(BuildingData b, string key)
		=> !string.IsNullOrWhiteSpace(b.Id) && b.Id.Contains(key, StringComparison.OrdinalIgnoreCase);

	/// <summary>
	/// A colour nudged off its palette entry, deterministically per building.
	///
	/// Vertex colours make this free — it is the same material either way — and it is what stops
	/// a street of twenty-one opus cottages from reading as one cottage stamped out twenty-one
	/// times. Small on purpose: enough that no two neighbours match, not so much that the model's
	/// colour stops being recognisable.
	/// </summary>
	private static Color Shade(Color c, uint seed, float valueSpread, float hueSpread)
	{
		float v = Mathf.Clamp(c.V * (1.0f + valueSpread * (Unit(seed) * 2.0f - 1.0f)), 0.05f, 1.0f);
		float h = Mathf.Wrap(c.H + hueSpread * (Unit(seed * 2654435761u) * 2.0f - 1.0f), 0.0f, 1.0f);
		return Color.FromHsv(h, c.S, v, c.A);
	}

	private static float Unit(uint h) => (h & 0xFFFFFFu) / 16777215.0f;
}
