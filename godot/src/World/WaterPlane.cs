using Godot;

namespace Promptholm.World;

/// <summary>
/// Flat sea surface laid at sea level (y = 0). One enormous plane so the ocean meets the
/// horizon in every direction; the deep-blue tint is only lightly opaque, so the sandy
/// shallows under the coast read through and the far sea feels like deep water.
/// </summary>
[GlobalClass]
public partial class WaterPlane : MeshInstance3D
{
	/// <summary>TerrainGenerator.SeaLevel, kept in sync so water always meets land.</summary>
	public const float SeaLevelY = 0.0f;

	/// <summary>Side length of the square water sheet; far beyond the island and terrain bounds.</summary>
	[Export] public float HorizonSize { get; set; } = 2000.0f;

	private StandardMaterial3D? _waterMaterial;

	public void Build(TerrainGenerator terrain)
	{
		var plane = new PlaneMesh
		{
			Size = new Vector2(HorizonSize, HorizonSize),
			SubdivideWidth = 12,
			SubdivideDepth = 12,
		};

		Mesh = plane;
		Position = new Vector3(0.0f, SeaLevelY, 0.0f);
		CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;
		MaterialOverride = WaterMaterial();
	}

	private StandardMaterial3D WaterMaterial()
	{
		if (_waterMaterial is not null)
			return _waterMaterial;

		_waterMaterial = new StandardMaterial3D
		{
			Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
			AlbedoColor = new Color(0.02f, 0.14f, 0.32f, 0.82f),
			Metallic = 0.0f,
			Roughness = 0.18f,
		};
		return _waterMaterial;
	}
}