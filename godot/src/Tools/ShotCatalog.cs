using Godot;

namespace Promptholm.Tools;

/// <summary>
/// The fixed camera viewpoints the screenshot harness renders from. Fixed on purpose:
/// a before/after comparison is only meaningful if the camera did not move. Positions
/// are derived from the real seed-1337 island (town centre at world origin, lighthouse
/// at (-28, -2), quay at (-7, 22)).
/// </summary>
public static class ShotCatalog
{
	/// <param name="Position">Camera position in world metres.</param>
	/// <param name="Target">Point the camera looks at.</param>
	/// <param name="Fov">Vertical FOV. Lower compresses the composition, which reads painterly.</param>
	/// <param name="GroundRelative">
	/// When true, Position.Y and Target.Y are offsets above the terrain rather than absolute,
	/// so eye-level shots stay at eye level whatever the ground does.
	/// </param>
	public readonly record struct Shot(
		string Name, Vector3 Position, Vector3 Target, float Fov, bool GroundRelative);

	public static readonly Shot[] All =
	[
		// The current Main.cs viewpoint, kept so the very first capture is a like-for-like
		// baseline against the screenshot that started this work.
		new("overlook", new Vector3(32f, 15f, 60f), new Vector3(0f, 0f, 0f), 58f, false),

		// Low, out at sea off the landing: judges water, shoreline foam and island silhouette.
		new("harbour", new Vector3(-14f, 3.0f, 44f), new Vector3(-5f, 1.5f, 20f), 62f, false),

		// Low over the town from the south-east green: judges building variety, window glow and
		// street scale. It deliberately stands *outside* the built-up area — with 131 of the 157
		// buildings overlapping a neighbour there is no open ground left in the centre to put a
		// camera, and an eye-level plaza shot rendered the inside of a wall.
		new("street", new Vector3(-18f, 7f, -18f), new Vector3(0f, 3f, 0f), 55f, false),

		// Along the lighthouse beam: judges volumetric fog and night readability.
		new("lighthouse", new Vector3(-6f, 6f, 16f), new Vector3(-28f, 4f, -2f), 58f, false),
	];

	/// <summary>The hours the matrix renders, placed on the solar arc: sunrise (6 degrees), morning (41), noon (58), golden hour (12), dusk (-12), night (-50).</summary>
	public static readonly float[] Hours = [6.4f, 9.0f, 12.5f, 17.2f, 18.8f, 23.0f];

	public static Shot? Find(string name)
	{
		foreach (var shot in All)
			if (shot.Name.Equals(name, System.StringComparison.OrdinalIgnoreCase))
				return shot;
		return null;
	}

	public static string Names()
	{
		var names = new string[All.Length];
		for (int i = 0; i < All.Length; i++)
			names[i] = All[i].Name;
		return string.Join(", ", names);
	}
}
