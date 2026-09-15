using Godot;

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

	/// <summary>Build the full settler scene root, feet at local y = 0.</summary>
	public static Node3D BuildSettler()
	{
		var root = new Node3D { Name = "Settler" };

		// Legs: blue trousers, swinging from hip pivots at y = 0.57.
		var legMesh = new BoxMesh { Size = new Vector3(0.10f, 0.55f, 0.12f) };
		legMesh.Material = Solid(TrousersColour);
		root.AddChild(Pivot("LegPivotL", new Vector3(-0.08f, 0.57f, 0.0f), legMesh, "LegL", new Vector3(0.0f, -0.275f, 0.0f)));
		root.AddChild(Pivot("LegPivotR", new Vector3(0.08f, 0.57f, 0.0f), legMesh, "LegR", new Vector3(0.0f, -0.275f, 0.0f)));

		// Torso: warm linen shirt, hips to shoulders.
		var torso = new MeshInstance3D { Name = "Torso" };
		var torsoMesh = new BoxMesh { Size = new Vector3(0.34f, 0.42f, 0.20f) };
		torsoMesh.Material = Solid(ShirtColour);
		torso.Mesh = torsoMesh;
		torso.Position = new Vector3(0.0f, 0.78f, 0.0f);
		root.AddChild(torso);

		// Arms: short shirt sleeves, handing from shoulder pivots at y = 0.96.
		var armMesh = new BoxMesh { Size = new Vector3(0.07f, 0.42f, 0.09f) };
		armMesh.Material = Solid(ShirtColour);
		root.AddChild(Pivot("ArmPivotL", new Vector3(-0.205f, 0.96f, 0.02f), armMesh, "ArmL", new Vector3(-0.035f, -0.21f, 0.0f)));
		root.AddChild(Pivot("ArmPivotR", new Vector3(0.205f, 0.96f, 0.02f), armMesh, "ArmR", new Vector3(0.035f, -0.21f, 0.0f)));

		// Head: skin-toned sphere peeking out between the shoulders.
		var head = new MeshInstance3D { Name = "Head" };
		var headMesh = new SphereMesh { Radius = 0.12f, Height = 0.24f, RadialSegments = 12, Rings = 8 };
		headMesh.Material = Solid(SkinColour);
		head.Mesh = headMesh;
		head.Position = new Vector3(0.0f, 1.12f, 0.0f);
		root.AddChild(head);

		// Straw hat: wide flat brim + short crowned top.
		var brim = new MeshInstance3D { Name = "HatBrim" };
		var brimMesh = new CylinderMesh { TopRadius = 0.33f, BottomRadius = 0.35f, Height = 0.04f, RadialSegments = 16 };
		brimMesh.Material = Solid(StrawColour);
		brim.Mesh = brimMesh;
		brim.Position = new Vector3(0.0f, 1.30f, 0.0f);
		root.AddChild(brim);

		var top = new MeshInstance3D { Name = "HatTop" };
		var topMesh = new CylinderMesh { TopRadius = 0.16f, BottomRadius = 0.21f, Height = 0.16f, RadialSegments = 14 };
		topMesh.Material = Solid(StrawColour);
		top.Mesh = topMesh;
		top.Position = new Vector3(0.0f, 1.39f, 0.0f);
		root.AddChild(top);

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

	private static StandardMaterial3D Solid(Color colour)
		=> new() { AlbedoColor = colour, Roughness = 0.85f };
}