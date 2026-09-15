using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Data.Models;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// What grows on the ground, in four layers, from the same class byte the rocks come off.
///
/// <see cref="RockSpawner"/> established the pattern and this follows it exactly: the server has
/// already decided what every sample of the island *is* — sea, beach, dune, meadow, wood, scree,
/// rock, cliff — and a scatterer's whole job is to ask, not to invent a second opinion. That is the
/// break with <c>PropSpawner</c>, which rolls its own forest noise, ignores the cleared lots and
/// therefore disagrees with the ground it stands on. Its ground cover is superseded here; its trees
/// are still its own.
///
/// The four layers are not four densities of the same thing. Each one answers a different failure:
///
///   1 ground cover   Short, wide, dense. Closes the seam between the terrain texture and anything
///                    standing on it — without it every rock and every wall meets the ground on a
///                    hard line, which is the single loudest sign of a scattered world.
///   2 grass blades   Taller, narrower, upright. This is the layer the wind is actually visible in;
///                    ground cover is too low and too splayed to read as moving.
///   3 ferns          Geometry, not a card: a fern is mostly gap, so a card of one pays full
///                    overdraw for a tenth of its area. Under the wood and banked against stone.
///   4 leafy bushes   Volume. Clustered rather than sprinkled, because a bush on its own is a
///                    gardener's bush and what a wood's edge has is thickets.
///
/// Everything else is the discipline the rocks already have: one <see cref="PmRng.Hash32"/> per
/// candidate decides the whole instance, so two runs place identical foliage; a cleared lot, a
/// paved run and the surf are all skipped; and steep ground thins out rather than stopping dead.
/// </summary>
public sealed class FoliageSpawner
{
	/// <summary>
	/// Which layers are scattered. All of them, unless a measurement run says otherwise — the
	/// same diagnostic hatch <see cref="Terrain3DBridge.WriteControl"/> and friends use, so a
	/// layer's cost can be isolated without rebuilding.
	/// </summary>
	[Flags]
	public enum Layer
	{
		None = 0,
		Cover = 1,
		Blades = 2,
		Ferns = 4,
		Bushes = 8,
		All = Cover | Blades | Ferns | Bushes,
	}

	public static Layer Enabled = Layer.All;

	/// <summary>Three shapes of each kind; see <see cref="FoliageCards"/> for why three.</summary>
	private const int Variants = 3;

	/// <summary>
	/// Cards are crossed pairs rather than single quads.
	///
	/// One quad is half the triangles and a quarter of the plant: seen along its own plane it
	/// disappears, and since every instance is given a random yaw, a quarter of the field vanishes
	/// from any given viewpoint and reappears as you walk. Four triangles is not the cost worth
	/// saving here — the overdraw of the alpha cut-out is, and that is what the draw ranges below
	/// are for.
	/// </summary>
	private const int CardFaces = 2;

	/// <summary>
	/// How much of a bush is buried. Small, for the same reason <c>RockSpawner.Sink</c> is: the
	/// clump is already seated on the lowest ground under it, and stacking a sink on top of that
	/// buries the thing until only a cap shows.
	/// </summary>
	private const float BushSink = 0.06f;

	/// <summary>One in this many instances gets the deviating tint. Roughly three per cent: enough
	/// that the eye finds variety, few enough that it stays an accent and not a second species.</summary>
	private const int AccentIn = 32;

	public int Placed { get; private set; }

	/// <summary>Instances per layer, for the metrics runner's table.</summary>
	public readonly Dictionary<Layer, int> PerLayer = new();

	/// <summary>
	/// The first few transforms this run emitted, in scan order.
	///
	/// Kept because "the same number of instances" is a weak claim about determinism — two runs can
	/// place the same count in different places. These are what a second run has to match.
	/// </summary>
	public readonly List<Transform3D> FirstTransforms = new();

	/// <summary>
	/// Sow the island.
	/// </summary>
	/// <param name="bridge">Must already have had its paving painted: the scatter asks it which
	/// samples are road, and before <c>PaintPaving</c> it truthfully answers "none".</param>
	public void Spawn(Terrain3DBridge bridge, TerrainField field, VillageData village)
	{
		var cards = CardMaterials();
		var leafMaterial = LeafMaterial();

		// Ids come from the bridge in call order, so they follow the rocks rather than colliding
		// with them. Ascending and uninterrupted is still the rule — see RegisterMeshAsset.
		var coverIds = new int[Variants];
		var bladeIds = new int[Variants];
		var fernIds = new int[Variants];
		var bushIds = new int[Variants];

		for (int v = 0; v < Variants; v++)
			coverIds[v] = bridge.RegisterCardAsset($"cover{v}", CoverSize, CardFaces, cards[v], CoverTuning);
		for (int v = 0; v < Variants; v++)
			bladeIds[v] = bridge.RegisterCardAsset($"blade{v}", BladeSize, CardFaces, cards[Variants + v], BladeTuning);
		// One material for the geometry layers together: a fern and a bush differ in shape and in
		// the colour handed to them per instance, and in nothing else. Two materials would be two
		// pipeline states for one look.
		for (int v = 0; v < Variants; v++)
			fernIds[v] = bridge.RegisterMeshAsset($"fern{v}", FoliageMesh.Fern((uint)(v * 131 + 17)), 0.0f, FernTuning, leafMaterial);
		for (int v = 0; v < Variants; v++)
			bushIds[v] = bridge.RegisterMeshAsset($"bush{v}", FoliageMesh.Bush((uint)(v * 173 + 29)), 0.0f, BushTuning, leafMaterial);

		var cleared = TerrainField.ClearedLots(village);
		var batches = new Dictionary<int, (Godot.Collections.Array T, List<Color> C)>();

		Scatter(Layer.Cover, bridge, field, cleared, batches, coverIds, CoverStrideM, CoverPlan);
		Scatter(Layer.Blades, bridge, field, cleared, batches, bladeIds, BladeStrideM, BladePlan);
		Scatter(Layer.Ferns, bridge, field, cleared, batches, fernIds, FernStrideM, FernPlan);
		Scatter(Layer.Bushes, bridge, field, cleared, batches, bushIds, BushStrideM, BushPlan);

		foreach (var (id, batch) in batches)
			bridge.AddInstances(id, batch.T, batch.C.ToArray());
		bridge.FinishInstances();

		GD.Print($"[FoliageSpawner] {Placed} plants: " +
			$"cover {Count(Layer.Cover)}, blades {Count(Layer.Blades)}, " +
			$"ferns {Count(Layer.Ferns)}, bushes {Count(Layer.Bushes)} " +
			$"(layers {Enabled}); {bridge.InstanceCount} instances rendered");
	}

	public int Count(Layer layer) => PerLayer.GetValueOrDefault(layer);

	// ---- the layers ---------------------------------------------------------------

	/// <summary>
	/// Nominal card size in metres: width across, height up from the root.
	///
	/// These are the size of the *quad*, and the tuft painted on it reaches most but not all of the
	/// way up - see <see cref="FoliageCards"/>. So a ground-cover plant is about 30 cm of grass and
	/// a blade about 80 cm, before the per-instance scale below widens that either way.
	///
	/// Both were smaller and both were wrong. A 20 cm tuft on a 408 m island is invisible from any
	/// viewpoint the screenshot matrix actually uses, which makes it a cost with no picture
	/// attached; a tuft wide enough to touch its neighbours is what turns a scatter of dots into a
	/// mat, which is the whole job of the first layer.
	/// </summary>
	private static readonly Vector2 CoverSize = new(0.95f, 0.34f);
	private static readonly Vector2 BladeSize = new(0.60f, 0.92f);

	/// <summary>Metres between candidate positions, per layer. Ground cover is the only one that
	/// wants a metre; anything that reads as an individual plant looks planted at that spacing.</summary>
	private const float CoverStrideM = 1.0f;
	private const float BladeStrideM = 2.0f;
	private const float FernStrideM = 3.0f;
	private const float BushStrideM = 4.0f;

	/// <summary>
	/// How far each layer is drawn, and whether it casts a shadow.
	///
	/// These are the density dial that actually costs nothing to turn, and the first set of numbers
	/// here — 38 m for ground cover, 55 m for blades — was tuned for an island that does not exist.
	/// This one is 408 m across, the fixed viewpoints stand a hundred metres back from the town, and
	/// at forty metres every card was behind the camera. Foliage that stops before the frame starts
	/// is a cost with no picture attached to it. Shadows are the other half of the dial and go the
	/// other way: one shadow draw per blade of grass is not something anybody can see, and it is the
	/// single most expensive thing this file could ask for.
	/// </summary>
	private static readonly Terrain3DBridge.MeshTuning CoverTuning = new(85.0f, 16.0f, false);
	private static readonly Terrain3DBridge.MeshTuning BladeTuning = new(120.0f, 22.0f, false);
	private static readonly Terrain3DBridge.MeshTuning FernTuning = new(140.0f, 24.0f, false);
	private static readonly Terrain3DBridge.MeshTuning BushTuning = new(230.0f, 36.0f, true);

	/// <summary>
	/// What a candidate sample turns into: whether anything grows, how big, and in what colour.
	/// Null means the ground is wrong for this layer.
	/// </summary>
	/// <param name="Chance">Per candidate, before slope and clustering thin it.</param>
	/// <param name="Min">Smallest and <paramref name="Max"/> largest scale, as a multiple of the
	/// registered mesh or card. Squared rather than cubed like the rocks: a plant has a much
	/// narrower size range than a stone, and cubing collapses it into one size.</param>
	private readonly record struct Plan(float Chance, float Min, float Max, Color Tint, Color Accent);

	/// <summary>
	/// Ground cover. Wood is thicker than meadow — a forest floor is litter and low growth all the
	/// way across — and the dune gets a thin marram fringe rather than nothing, because a beach that
	/// stops at a hard line between sand and grass is the thing dunes least look like.
	/// </summary>
	private static Plan? CoverPlan(byte cls) => cls switch
	{
		TerrainClass.Meadow => new(0.46f, 0.80f, 1.45f, Tint(0.35f, 0.77f, 0.11f), Tint(0.62f, 0.77f, 0.14f)),
		TerrainClass.Wood => new(0.52f, 0.85f, 1.55f, Tint(0.18f, 0.53f, 0.09f), Tint(0.40f, 0.58f, 0.10f)),
		TerrainClass.Polder => new(0.34f, 0.75f, 1.30f, Tint(0.40f, 0.80f, 0.12f), Tint(0.64f, 0.80f, 0.15f)),
		TerrainClass.Dune => new(0.09f, 0.70f, 1.25f, Tint(0.64f, 0.82f, 0.18f), Tint(0.75f, 0.90f, 0.23f)),
		_ => null,
	};

	/// <summary>Blades. Meadow is where they belong; in a wood they thin out, because under a
	/// canopy grass does.</summary>
	private static Plan? BladePlan(byte cls) => cls switch
	{
		TerrainClass.Meadow => new(0.40f, 0.80f, 1.50f, Tint(0.40f, 0.82f, 0.11f), Tint(0.67f, 0.82f, 0.16f)),
		TerrainClass.Wood => new(0.22f, 0.75f, 1.35f, Tint(0.21f, 0.58f, 0.09f), Tint(0.44f, 0.66f, 0.11f)),
		TerrainClass.Polder => new(0.28f, 0.80f, 1.40f, Tint(0.42f, 0.83f, 0.13f), Tint(0.69f, 0.85f, 0.17f)),
		_ => null,
	};

	/// <summary>Ferns: the wood, and a few stragglers on the meadow so the edge of the wood is a
	/// gradient rather than a fence. The rock bonus is applied in <see cref="Scatter"/>.</summary>
	private static Plan? FernPlan(byte cls) => cls switch
	{
		TerrainClass.Wood => new(0.44f, 0.45f, 0.85f, Tint(0.24f, 0.62f, 0.05f), Tint(0.44f, 0.66f, 0.05f)),
		TerrainClass.Meadow => new(0.05f, 0.40f, 0.70f, Tint(0.30f, 0.68f, 0.06f), Tint(0.48f, 0.70f, 0.06f)),
		TerrainClass.Scree => new(0.07f, 0.34f, 0.60f, Tint(0.26f, 0.60f, 0.05f), Tint(0.44f, 0.64f, 0.06f)),
		_ => null,
	};

	/// <summary>
	/// Bushes. The chance looks high because the clustering below throws away two clumps in three
	/// before it is ever consulted, and because a thicket is a thicket: half a dozen bushes in one
	/// patch of ground and none for twenty metres either side.
	///
	/// The accent is dry autumn rather than a flower. A saturated flowering colour was tried and it
	/// reads as litter at any distance past twenty metres — the eye finds a magenta dot in a green
	/// field instantly and then has to decide what it is, which is not a question a background
	/// should be asking.
	/// </summary>
	private static Plan? BushPlan(byte cls) => cls switch
	{
		TerrainClass.Wood => new(0.60f, 0.85f, 1.70f, Tint(0.25f, 0.64f, 0.05f), Tint(0.52f, 0.60f, 0.05f)),
		TerrainClass.Meadow => new(0.34f, 0.80f, 1.55f, Tint(0.32f, 0.72f, 0.06f), Tint(0.58f, 0.66f, 0.06f)),
		_ => null,
	};

	/// <summary>
	/// A colour on its way to a shader, in the same space the ground beside it is in.
	///
	/// Deliberately *not* converted with <c>SrgbToLinear</c>, and that cost a render to find out.
	/// The obvious reading is that <c>COLOR</c> is multiplied into <c>ALBEDO</c>, which is linear,
	/// so the sRGB numbers in <see cref="Palette"/> have to be converted — the warning Palette
	/// itself carries about vertex colours. But the ground these plants stand on is tinted by
	/// Terrain3D's colour map, which is a plain RGBA8 data texture sampled raw: the same
	/// <c>Palette.Terrain</c> numbers reach that shader unconverted. Converting here made the
	/// vegetation about half as bright as the meadow under it, so the island came back speckled
	/// with what looked like dark litter rather than covered in grass.
	///
	/// Two wrongs, and they have to be the same wrong. Whoever fixes the terrain's colour space
	/// has to fix this in the same commit.
	///
	/// The numbers themselves are darker and more saturated than the class colours in
	/// <see cref="Palette"/>, and that is measured rather than taste: rendered against the ground
	/// they stand on, the first set came out at RGB 108/145/114 where the meadow under it was
	/// 108/172/100 - the same brightness, less green, more blue. Grass that is greyer than its own
	/// field reads as litter. Pulling green up and blue down puts it back on the ground's hue, a
	/// step darker, which is where a plant that shades itself belongs.
	/// </summary>
	private static Color Tint(float r, float g, float b) => new(r, g, b);

	// ---- the scatter --------------------------------------------------------------

	/// <summary>
	/// Walk the sample lattice once for one layer and place what the plan asks for.
	///
	/// Everything about an instance comes out of a single hash of its sample, exactly as the rocks
	/// do it: the variant, the size, the yaw, the jitter inside the stride and whether it is an
	/// accent. That is what makes two runs identical, and it is also what stops a change in density
	/// from reshuffling the plants that were already there.
	/// </summary>
	private void Scatter(Layer layer, Terrain3DBridge bridge, TerrainField field,
		HashSet<long> cleared, Dictionary<int, (Godot.Collections.Array T, List<Color> C)> batches,
		int[] ids, float strideM, Func<byte, Plan?> plan)
	{
		if ((Enabled & layer) == 0) return;

		float half = field.EnvelopeHalf;
		float mps = field.MetresPerSample;
		int stride = Math.Max(1, (int)MathF.Round(strideM / mps));
		string label = layer.ToString().ToLowerInvariant();
		int placed = 0;

		for (int j = 0; j < field.N; j += stride)
		{
			for (int i = 0; i < field.N; i += stride)
			{
				byte cls = field.ClassOf(i, j);
				var p = plan(cls);
				if (p is null) continue;

				float y = field.HeightOf(i, j);
				if (y <= 0.2f) continue;                         // not in the surf
				if (bridge.IsPaved(i, j)) continue;              // and not on the road

				float wx = i * mps - half;
				float wz = j * mps - half;
				if (cleared.Contains(field.LotKeyAt(wx, wz))) continue;

				uint h = PmRng.Hash32($"{field.IslandSeed}:{label}:{i},{j}");

				float chance = p.Value.Chance * SlopeFactor(field, i, j);
				if (layer == Layer.Ferns) chance *= NearStone(field, i, j) ? 2.4f : 1.0f;
				if (layer == Layer.Bushes) chance *= ClumpFactor(field, i, j);
				if ((h % 10000) / 10000.0f > chance) continue;

				int id = ids[(h >> 13) % Variants];

				// Squared rather than uniform, so most plants are small and the tall ones stand
				// out. Not cubed, which is what the rocks use: a stone's range is an order of
				// magnitude and a plant's is a factor of two, and cubing that is one size.
				float u = ((h >> 17) & 0xFF) / 255.0f;
				float scale = p.Value.Min + (p.Value.Max - p.Value.Min) * u * u;

				float yaw = ((h >> 5) & 0xFF) / 255.0f * Mathf.Tau;
				var basis = new Basis(Vector3.Up, yaw).Scaled(new Vector3(scale, scale, scale));

				// Jitter inside the stride, or the scatter lands on a lattice - and a lattice of
				// grass is the one arrangement grass never has.
				float jx = (((h >> 3) & 0xFF) / 255.0f - 0.5f) * strideM;
				float jz = (((h >> 11) & 0xFF) / 255.0f - 0.5f) * strideM;
				float px = wx + jx, pz = wz + jz;
				float ground = (float)field.WorldHeight(px, pz);

				var at = new Vector3(px, ground + Seat(layer, scale), pz);

				var tint = ((h >> 26) % AccentIn) == 0 ? p.Value.Accent : p.Value.Tint;
				// A few per cent either way on top of that, so a field of one plan is still not a
				// field of one colour.
				float shift = 0.92f + ((h >> 21) & 0x1F) / 200.0f;
				tint = new Color(tint.R * shift, tint.G * shift, tint.B * shift, 1.0f);

				if (!batches.TryGetValue(id, out var batch))
				{
					batch = (new Godot.Collections.Array(), new List<Color>());
					batches[id] = batch;
				}
				var transform = new Transform3D(basis, at);
				batch.T.Add(transform);
				batch.C.Add(tint);
				if (FirstTransforms.Count < 10) FirstTransforms.Add(transform);
				placed++;
			}
		}

		PerLayer[layer] = placed;
		Placed += placed;
	}

	/// <summary>
	/// Where the instance's origin has to be for the plant to stand on the ground.
	///
	/// The card layers used to be lifted half a card, on the belief that a Terrain3D generated
	/// texture card hangs its base at local y = -0.5 regardless of the size asked for. It does
	/// not: the card it builds for <c>generated_type = TYPE_TEXTURE_CARD</c> stands *on* its
	/// origin, so the lift was a correction for a problem that was not there and it put every
	/// blade and every patch of cover exactly half its own height into the air.
	///
	/// That is the floating grass from the rondgang of 15 September, and it was not a sampling
	/// error: the height under each plant was always read at the jittered position. The measure
	/// that settles it is <c>VerifyGroundedRunner</c>, which compares the mesh's own AABB floor
	/// against the terrain rather than the instance origin — median clearance was +0.50 m on a
	/// scale of about one, which is 0.5 × scale to the centimetre.
	///
	/// <see cref="FoliageMesh"/> builds its meshes with the root at y = 0 for the same reason, so
	/// neither kind needs lifting now; only the bushes are deliberately settled into the ground.
	/// </summary>
	private static float Seat(Layer layer, float scale) => layer switch
	{
		Layer.Bushes => -BushSink * scale,
		_ => 0.0f,
	};

	/// <summary>
	/// How much of the plan survives the slope.
	///
	/// A gentle rise carries as much grass as a flat field; a scree chute carries none. Faded
	/// rather than cut, because a hard threshold draws a contour line across the hillside in
	/// vegetation, which is a thing hillsides do not do.
	/// </summary>
	private static float SlopeFactor(TerrainField field, int i, int j)
		=> 1.0f - Mathf.SmoothStep(0.45f, 1.10f, field.SlopeOf(i, j));

	/// <summary>
	/// Whether bare stone is within a few metres, which is where ferns actually grow: in the damp
	/// shade at the foot of a rock, not out in the open.
	/// </summary>
	private static bool NearStone(TerrainField field, int i, int j)
	{
		const int Reach = 3;
		return TerrainClass.IsBare(field.ClassOf(i + Reach, j))
			|| TerrainClass.IsBare(field.ClassOf(i - Reach, j))
			|| TerrainClass.IsBare(field.ClassOf(i, j + Reach))
			|| TerrainClass.IsBare(field.ClassOf(i, j - Reach));
	}

	/// <summary>Side of a bush clump, in metres. About the width of a plot: big enough to read as a
	/// thicket, small enough that two of them are two thickets.</summary>
	private const int ClumpM = 12;

	/// <summary>
	/// Bushes come in clumps or not at all.
	///
	/// A per-sample chance scatters them evenly, and evenly scattered bushes read as planting.
	/// Hashing the clump the sample falls in instead throws away two patches of ground in three and
	/// concentrates everything in the rest, which is what a thicket is. The hash is of the clump
	/// and not of the sample, so it is the same clump on every run.
	/// </summary>
	private static float ClumpFactor(TerrainField field, int i, int j)
	{
		int cells = Math.Max(1, (int)MathF.Round(ClumpM / field.MetresPerSample));
		uint h = PmRng.Hash32($"{field.IslandSeed}:clump:{i / cells},{j / cells}");
		return (h % 100) < 34 ? 1.0f : 0.0f;
	}

	// ---- materials ----------------------------------------------------------------

	/// <summary>
	/// One material per card, because each carries its own painting; one shader behind all of them,
	/// so the wind is one piece of maths. Cover first, then blades, in the order
	/// <see cref="FoliageCards.All"/> lists them.
	/// </summary>
	private static ShaderMaterial[] CardMaterials()
	{
		var shader = GD.Load<Shader>("res://shaders/foliage_card.gdshader");
		if (shader is null) GD.PushWarning("res://shaders/foliage_card.gdshader is missing; the cards will be untextured");

		var cards = FoliageCards.All();
		var materials = new ShaderMaterial[cards.Length];
		for (int k = 0; k < cards.Length; k++)
		{
			materials[k] = new ShaderMaterial { Shader = shader };
			materials[k].SetShaderParameter("card_tex", FoliageCards.Load(cards[k]));
		}
		return materials;
	}

	private static ShaderMaterial LeafMaterial()
	{
		var shader = GD.Load<Shader>("res://shaders/foliage_leaf.gdshader");
		if (shader is null) GD.PushWarning("res://shaders/foliage_leaf.gdshader is missing; ferns and bushes will be white");
		return new ShaderMaterial { Shader = shader };
	}
}
