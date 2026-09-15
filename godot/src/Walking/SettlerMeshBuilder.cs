using Godot;
using Promptholm.Visual;

namespace Promptholm.Walking;

/// <summary>
/// Procedural builder for the iconic Promptholm settler: blue trousers, warm linen shirt,
/// skin-toned head and a wide-brimmed straw hat. Every part is a primitive mesh with its
/// own material, collected into a Node3D hierarchy whose limbs sit on pivot nodes so the
/// avatar can swing them while walking ("wobble / tilt").
/// The root is authored with its feet at y = 0; the owning avatar offsets it so the feet
/// sit on the capsule bottom. Total height is roughly 1.5-1.6 m, so the figure clears
/// the 0.63 m bridge clearance only by crouching/dipping - and since the deck is hollow
/// underneath it can swim straight through.
/// </summary>
public static class SettlerMeshBuilder
{
	private static readonly Color TrousersColour = new(0.23f, 0.38f, 0.72f);
	private static readonly Color ShirtColour = new(0.94f, 0.85f, 0.60f);
	private static readonly Color SkinColour = new(0.91f, 0.74f, 0.58f);
	private static readonly Color StrawColour = new(0.88f, 0.78f, 0.45f);

	// ---- shared parts ----------------------------------------------------------
	//
	// Every settler is the same seven meshes in the same seven colours, so they are built once
	// and handed out by reference. This used to allocate a fresh BoxMesh and a fresh
	// StandardMaterial3D per limb per figure. With one avatar that cost seven of each and nobody
	// noticed; with a crowd of thirty-one it is two hundred materials, and the material ceiling in
	// VerifyMetricsRunner is there precisely because each one is a pipeline state.
	//
	// Palette.Solid caches on the whole recipe, so these are the same resources the rest of the
	// island already uses rather than a private set that happens to hold the same numbers.

	/// <summary>Head centre. Everything above it is measured from here so the hat cannot drift.</summary>
	private const float HeadY = 1.12f;
	private const float HeadRadius = 0.12f;
	private const float BrimThick = 0.04f;
	private const float CrownHeight = 0.16f;

	private static readonly BoxMesh LegMesh = Mesh(new BoxMesh { Size = new Vector3(0.10f, 0.55f, 0.12f) }, TrousersColour);
	private static readonly BoxMesh TorsoMesh = Mesh(new BoxMesh { Size = new Vector3(0.34f, 0.42f, 0.20f) }, ShirtColour);
	private static readonly BoxMesh ArmMesh = Mesh(new BoxMesh { Size = new Vector3(0.07f, 0.42f, 0.09f) }, ShirtColour);
	private static readonly SphereMesh HeadMesh = Mesh(
		new SphereMesh { Radius = HeadRadius, Height = HeadRadius * 2.0f, RadialSegments = 12, Rings = 8 }, SkinColour);
	private static readonly CylinderMesh BrimMesh = Mesh(
		new CylinderMesh { TopRadius = 0.33f, BottomRadius = 0.35f, Height = BrimThick, RadialSegments = 16 }, StrawColour);
	private static readonly CylinderMesh CrownMesh = Mesh(
		new CylinderMesh { TopRadius = 0.16f, BottomRadius = 0.21f, Height = CrownHeight, RadialSegments = 14 }, StrawColour);

	private static T Mesh<T>(T mesh, Color colour) where T : PrimitiveMesh
	{
		mesh.Material = Palette.Solid(colour, 0.85f);
		return mesh;
	}

	/// <summary>Build the full settler scene root, feet at local y = 0.</summary>
	public static Node3D BuildSettler()
	{
		var root = new Node3D { Name = "Settler" };

		// Legs: blue trousers, swinging from hip pivots at y = 0.57.
		root.AddChild(Pivot("LegPivotL", new Vector3(-0.08f, 0.57f, 0.0f), LegMesh, "LegL", new Vector3(0.0f, -0.275f, 0.0f)));
		root.AddChild(Pivot("LegPivotR", new Vector3(0.08f, 0.57f, 0.0f), LegMesh, "LegR", new Vector3(0.0f, -0.275f, 0.0f)));

		// Torso: warm linen shirt, hips to shoulders.
		root.AddChild(new MeshInstance3D
		{
			Name = "Torso",
			Mesh = TorsoMesh,
			Position = new Vector3(0.0f, 0.78f, 0.0f),
		});

		// Arms: short shirt sleeves, hanging from shoulder pivots at y = 0.96.
		root.AddChild(Pivot("ArmPivotL", new Vector3(-0.205f, 0.96f, 0.02f), ArmMesh, "ArmL", new Vector3(-0.035f, -0.21f, 0.0f)));
		root.AddChild(Pivot("ArmPivotR", new Vector3(0.205f, 0.96f, 0.02f), ArmMesh, "ArmR", new Vector3(0.035f, -0.21f, 0.0f)));

		// Head: skin-toned sphere peeking out between the shoulders.
		root.AddChild(new MeshInstance3D
		{
			Name = "Head",
			Mesh = HeadMesh,
			Position = new Vector3(0.0f, HeadY, 0.0f),
		});

		// Straw hat: wide flat brim + short crown, both measured off the crown of the head rather
		// than written out as constants. They were, and the brim sat 6 cm clear of the skull — a
		// floating hat, and one of the things the rondgang of 15 September picked out.
		float skull = HeadY + HeadRadius;
		float brimY = skull - 0.02f;                       // biting into the head, not resting above it
		root.AddChild(new MeshInstance3D
		{
			Name = "HatBrim",
			Mesh = BrimMesh,
			Position = new Vector3(0.0f, brimY, 0.0f),
		});
		root.AddChild(new MeshInstance3D
		{
			Name = "HatTop",
			Mesh = CrownMesh,
			Position = new Vector3(0.0f, brimY + BrimThick * 0.5f + CrownHeight * 0.5f - 0.01f, 0.0f),
		});

		return root;
	}

	/// <summary>
	/// Basic walking wobble: limbs swing in counter-phase on their pivots, scaled by how
	/// fast the settler is moving (speed01 in 0..1), so standing still leaves the figure
	/// restful. Called every frame from the owning avatar while it moves. The caller passes
	/// the animation time at 1× wall-clock scale; inside this method, `time * 8.5f` gives
	/// ~1.35 Hz step cadence (natural walking speed).
	/// </summary>
	public static void PoseWalk(Node3D root, float time, float speed01)
	{
		float leg = Mathf.Sin(time * 8.5f) * 0.38f * speed01;
		float arm = Mathf.Sin(time * 8.5f + Mathf.Pi) * 0.26f * speed01;

		SetSwing(root, "LegPivotL", leg);
		SetSwing(root, "LegPivotR", -leg);
		SetSwing(root, "ArmPivotL", arm);
		SetSwing(root, "ArmPivotR", -arm);
	}

	private static Node3D Pivot(string name, Vector3 pivotPosition, Mesh mesh, string meshName, Vector3 meshOffset)
	{
		var pivot = new Node3D { Name = name, Position = pivotPosition };
		var part = new MeshInstance3D
		{
			Name = meshName,
			Mesh = mesh,
			Position = meshOffset,
		};
		pivot.AddChild(part);
		return pivot;
	}

	private static void SetSwing(Node3D root, string pivotName, float pitch)
	{
		if (root.GetNodeOrNull<Node3D>(pivotName) is Node3D pivot)
			pivot.Rotation = new Vector3(pitch, 0.0f, 0.0f);
	}

}