using Godot;

namespace Promptholm.World;

/// <summary>
/// Flat sea surface laid at sea level (y = 0). One enormous plane so the ocean meets the
/// horizon in every direction; a custom shader depth-fades from warm turquoise shallows
/// under the coast to deep navy blue offshore and draws a pulsing foam line on the banks.
/// </summary>
[GlobalClass]
public partial class WaterPlane : MeshInstance3D
{
	/// <summary>TerrainGenerator.SeaLevel, kept in sync so water always meets land.</summary>
	public const float SeaLevelY = 0.0f;

	/// <summary>Side length of the square water sheet; far beyond the island and terrain bounds.</summary>
	[Export] public float HorizonSize { get; set; } = 2000.0f;

	private ShaderMaterial? _waterMaterial;

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

	private ShaderMaterial WaterMaterial()
	{
		if (_waterMaterial is not null)
			return _waterMaterial;

		var shader = GD.Load<Shader>("res://shaders/water.gdshader");
		_waterMaterial = new ShaderMaterial { Shader = shader };
		return _waterMaterial;
	}
}