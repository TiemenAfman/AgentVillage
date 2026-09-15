using Godot;

namespace Promptholm.World;

/// <summary>
/// Flat sea surface laid at sea level (y = 0). One enormous plane so the ocean meets the
/// horizon in every direction; the stylized water shader refracts the seabed, absorbs
/// light with depth (Beer–Lambert), projects animated caustics and draws Voronoi foam.
/// </summary>
[GlobalClass]
public partial class WaterPlane : MeshInstance3D
{
	/// <summary>TerrainGenerator.SeaLevel, kept in sync so water always meets land.</summary>
	public const float SeaLevelY = 0.0f;

	/// <summary>Side length of the square water sheet; far beyond the island and terrain bounds.</summary>
	[Export] public float HorizonSize { get; set; } = 2000.0f;

	/// <summary>Caustics pattern cell size in texels (generated once as a seamless noise texture).</summary>
	[Export] public int CausticsTexelSize { get; set; } = 512;

	private ShaderMaterial? _waterMaterial;

	public void Build(TerrainGenerator terrain)
	{
		var plane = new PlaneMesh
		{
			Size = new Vector2(HorizonSize, HorizonSize),
			SubdivideWidth = 40,
			SubdivideDepth = 40,
		};

		Mesh = plane;
		Position = new Vector3(0.0f, SeaLevelY, 0.0f);
		CastShadow = GeometryInstance3D.ShadowCastingSetting.Off;

		// Kept out of global illumination. A 2000 m sheet voxelised into the SDFGI cascades
		// buys nothing — water is not a bounce source worth the cascade budget — and it threw
		// a large dark slab across the sea where the cascade boundary fell.
		GIMode = GeometryInstance3D.GIModeEnum.Disabled;
		MaterialOverride = WaterMaterial();
	}

	private ShaderMaterial WaterMaterial()
	{
		if (_waterMaterial is not null)
			return _waterMaterial;

		var shader = GD.Load<Shader>("res://shaders/stylized_water.gdshader");
		_waterMaterial = new ShaderMaterial { Shader = shader };
		_waterMaterial.SetShaderParameter("caustics_texture", CausticsTexture());
		_waterMaterial.SetShaderParameter("water_level", SeaLevelY);

		// The shader's own defaults are the tutorial's: sea_height 1.1 / sea_choppy 2.6 on a
		// near-mirror surface (roughness 0.10, specular 0.9). Measured, that carpets the whole
		// open ocean in white — not foam, as it looks, but sun glitter shattering on normals
		// that are far too steep. Turning foam off changes nothing; raising roughness removes
		// it entirely. So the wave normals get calmer and the highlight gets a width, which
		// leaves one readable sun streak instead of broken glass.
		_waterMaterial.SetShaderParameter("sea_height", 0.55f);
		_waterMaterial.SetShaderParameter("sea_choppy", 1.35f);
		_waterMaterial.SetShaderParameter("roughness", 0.26f);
		_waterMaterial.SetShaderParameter("specular", 0.55f);

		// 2.0 puts foam on every wave crest, which whitens open water that has no business
		// being white; the shoreline band is what should carry the foam.
		_waterMaterial.SetShaderParameter("foam_crest_amount", 0.35f);

		return _waterMaterial;
	}

	private NoiseTexture2D CausticsTexture()
	{
		var noise = new FastNoiseLite
		{
			NoiseType = FastNoiseLite.NoiseTypeEnum.Cellular,
			Frequency = 0.08f,
			Seed = 1337,
		};

		return new NoiseTexture2D
		{
			Noise = noise,
			Width = CausticsTexelSize,
			Height = CausticsTexelSize,
			Seamless = true,
			GenerateMipmaps = true,
		};
	}
}