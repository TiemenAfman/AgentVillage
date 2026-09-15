using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// Hands the island the server baked to Terrain3D.
///
/// Terrain3D is a GDExtension, so C# gets no generated bindings for it: every call goes through
/// <c>ClassDB.Instantiate</c> and <c>Call</c> by name, with no compile-time check that the name
/// or the argument types are right. That is unpleasant enough that it should happen in exactly
/// one file, which is this one. Everything outside here talks to the bridge, not to Terrain3D.
///
/// What it buys, and it is worth being precise because the obvious answer is wrong: not tunnels.
/// A hole removes ground; it does not build a bore, and the walls, floor and ceiling still have
/// to be meshed either way. What it does solve is that you cannot punch a hole in a
/// <c>HeightMapShape3D</c> - so the trench-and-roof workaround the plan needed disappears. The
/// real wins are a clipmap with ten levels of detail, splatting across up to 32 textures, and
/// foliage instancing: three things a 400 m world needs and this project had no answer for.
/// </summary>
public sealed class Terrain3DBridge
{
	/// <summary>Region side in metres. Matches the server's chunk exactly, so publishing a chunk
	/// and adding a region are the same act.</summary>
	public const int RegionSize = 64;

	// The control map is a uint bit-packed into a float texel. Layout read off their own shader
	// (addons/terrain_3d/extras/shaders/lightweight.gdshader), not guessed:
	//   base texture   control >> 27 & 0x1F
	//   overlay        control >> 22 & 0x1F
	//   blend          control >> 14 & 0xFF
	//   hole           control >>  2 & 0x01
	//   navigation     control >>  1 & 0x01
	//   auto shader    control       & 0x01
	private const int BaseShift = 27, OverlayShift = 22, BlendShift = 14;
	private const uint HoleBit = 1u << 2, NavigationBit = 1u << 1, AutoShaderBit = 1u;

	/// <summary>Texture slot per terrain class. Two textures so far - a ground and a rock - so
	/// this is coarse; it gets finer the moment there are more in the asset list.</summary>
	public const int TextureGround = 0;
	public const int TextureRock = 1;

	public Node3D Node { get; private init; } = null!;
	public GodotObject Data { get; private init; } = null!;
	public int RegionCount { get; private set; }

	// Diagnostics, kept rather than deleted because they earned it and the question they answered
	// is not fully closed - see the note on ControlFor. Each map can be withheld to see what the
	// others do on their own, a single control word can be forced everywhere, and the words the
	// classifier produces can be counted. Between them they proved the encoding was right and the
	// write path worked, which is what left the fault where it actually is.
	public static bool WriteControl = true;
	public static bool WriteColour = true;
	public static int ControlProbe = -1;   // >= 0: write this word everywhere
	public static bool DumpControlWords;

	public static bool IsAvailable => ClassDB.ClassExists("Terrain3D");

	/// <summary>
	/// Build a Terrain3D node under <paramref name="parent"/> and fill it from the field.
	/// Returns null when the extension is not loaded, so a caller can fall back rather than crash.
	/// </summary>
	public static Terrain3DBridge? Build(Node3D parent, TerrainField field, Shader? shaderOverride = null)
	{
		if (!IsAvailable)
		{
			GD.PushWarning("Terrain3D is not loaded; is addons/terrain_3d present and the build for this platform there?");
			return null;
		}

		if (parent.GetNodeOrNull("Terrain3D") is Node old)
		{
			parent.RemoveChild(old);
			old.QueueFree();
		}

		var node = ClassDB.Instantiate("Terrain3D").AsGodotObject() as Node3D
			?? throw new InvalidOperationException("Terrain3D would not instantiate");
		node.Name = "Terrain3D";
		parent.AddChild(node);

		// Must happen after it is in the tree: the data object is built on entering.
		node.Call("change_region_size", RegionSize);
		node.Set("vertex_spacing", field.MetresPerSample);

		var data = node.Get("data").AsGodotObject()
			?? throw new InvalidOperationException("Terrain3D has no data object");

		var bridge = new Terrain3DBridge { Node = node, Data = data };
		bridge.LoadTextures();
		bridge.ApplyMaterial(shaderOverride);
		bridge.FillFrom(field);
		return bridge;
	}

	/// <summary>
	/// The ground textures, in the slots the control map refers to by number.
	///
	/// Terrain3D ships none; these two come from its demo (ambientCG, CC0) and they are packed
	/// the way it wants - albedo in RGB with height in alpha, normal in RGB with roughness in
	/// alpha. Two is enough to tell ground from rock and not enough for the look we are after:
	/// sand, wet sand, dry grass, forest floor and a layered cliff all want their own slot.
	/// </summary>
	private void LoadTextures()
	{
		var assets = ClassDB.Instantiate("Terrain3DAssets").AsGodotObject();
		if (assets is null) { GD.PushWarning("Terrain3DAssets would not instantiate"); return; }

		AddTexture(assets, TextureGround, "ground", "res://assets/terrain/ground037", 0.06f);
		AddTexture(assets, TextureRock, "rock", "res://assets/terrain/rock023", 0.09f);

		Node.Set("assets", assets);
	}

	private static void AddTexture(GodotObject assets, int slot, string name, string prefix, float uvScale)
	{
		var albedo = GD.Load<Texture2D>($"{prefix}_alb_ht.png");
		var normal = GD.Load<Texture2D>($"{prefix}_nrm_rgh.png");
		if (albedo is null)
		{
			GD.PushWarning($"terrain texture {prefix}_alb_ht.png is missing; slot {slot} stays empty");
			return;
		}

		var asset = ClassDB.Instantiate("Terrain3DTextureAsset").AsGodotObject();
		if (asset is null) return;
		asset.Set("name", name);
		asset.Set("id", slot);
		asset.Set("albedo_texture", albedo);
		if (normal is not null) asset.Set("normal_texture", normal);
		// UV scale is in texture repeats per metre: smaller means the grain is bigger on the
		// ground. Rock wants a coarser grain than turf or it reads as sandpaper.
		asset.Set("uv_scale", uvScale);
		assets.Call("set_texture", slot, asset);
	}

	/// <summary>
	/// Our own shader over their clipmap. Terrain3D's default look is realistic PBR; this project
	/// is painterly, and without this the terrain system would decide the art direction.
	/// </summary>
	private void ApplyMaterial(Shader? shaderOverride)
	{
		if (shaderOverride is null) return;
		var material = Node.Get("material").AsGodotObject();
		if (material is null)
		{
			GD.PushWarning("Terrain3D exposed no material to override");
			return;
		}
		material.Call("set_shader_override", shaderOverride);
		material.Call("enable_shader_override", true);
	}

	/// <summary>
	/// One region per published chunk: heights, a control map that says which texture goes where,
	/// and a colour map carrying the palette the server's classification picked.
	///
	/// The colour map is why this does not throw away the painterly look to gain texture detail.
	/// Splatting supplies the grain - sand, strata, grass - and the colour map tints it with the
	/// biome the generator decided. The screenshots on Terrain3D's own page are hand-sculpted and
	/// hand-painted; here the generator does both, and the client is told rather than asked.
	/// </summary>
	private void FillFrom(TerrainField field)
	{
		if (DumpControlWords)
		{
			var seen = new Dictionary<uint, int>();
			foreach (var info in field.Manifest.Chunks)
			{
				int oi = (int)MathF.Round((info.Cx * field.Manifest.ChunkM + field.EnvelopeHalf) / field.MetresPerSample);
				int oj = (int)MathF.Round((info.Cz * field.Manifest.ChunkM + field.EnvelopeHalf) / field.MetresPerSample);
				for (int j = 0; j < RegionSize; j += 4)
					for (int i = 0; i < RegionSize; i += 4)
					{
						uint w = ControlFor(field.ClassOf(oi + i, oj + j), field, oi + i, oj + j);
						seen[w] = seen.GetValueOrDefault(w) + 1;
					}
			}
			var top = new List<KeyValuePair<uint, int>>(seen);
			top.Sort((a, b) => b.Value.CompareTo(a.Value));
			GD.Print($"control words: {seen.Count} distinct");
			for (int k = 0; k < Math.Min(8, top.Count); k++)
			{
				uint w = top[k].Key;
				GD.Print($"  {w,12} x{top[k].Value,-7} base {(w >> 27) & 0x1F}  overlay {(w >> 22) & 0x1F}  blend {(w >> 14) & 0xFF}  hole {(w >> 2) & 1}  nav {(w >> 1) & 1}  auto {w & 1}");
			}
		}

		var regions = new List<GodotObject>();
		foreach (var info in field.Manifest.Chunks)
		{
			var region = BuildRegion(field, info);
			if (region is not null) regions.Add(region);
		}

		foreach (var region in regions)
			Data.Call("add_region", region, false);

		Data.Call("update_maps");
		RegionCount = Data.Call("get_region_count").AsInt32();
	}

	private GodotObject? BuildRegion(TerrainField field, ChunkInfo info)
	{
		int chunkM = (int)MathF.Round(field.Manifest.ChunkM);
		if (chunkM != RegionSize)
		{
			GD.PushWarning($"the server publishes {chunkM} m chunks but regions are {RegionSize} m");
			return null;
		}

		int originI = (int)MathF.Round((info.Cx * chunkM + field.EnvelopeHalf) / field.MetresPerSample);
		int originJ = (int)MathF.Round((info.Cz * chunkM + field.EnvelopeHalf) / field.MetresPerSample);

		var heights = Image.CreateEmpty(RegionSize, RegionSize, false, Image.Format.Rf);
		var control = Image.CreateEmpty(RegionSize, RegionSize, false, Image.Format.Rf);
		var colours = Image.CreateEmpty(RegionSize, RegionSize, false, Image.Format.Rgba8);

		for (int j = 0; j < RegionSize; j++)
		{
			for (int i = 0; i < RegionSize; i++)
			{
				// Regions are edge-exclusive - region (0,0) is [0,64) and (1,0) is [64,128) - so
				// the duplicated edge row the chunk carries is simply not used here. Terrain3D
				// stitches its own regions.
				int si = originI + i, sj = originJ + j;
				heights.SetPixel(i, j, new Color(field.HeightOf(si, sj), 0, 0));

				byte cls = field.ClassOf(si, sj);
				uint word = ControlProbe >= 0 ? (uint)ControlProbe : ControlFor(cls, field, si, sj);
				control.SetPixel(i, j, new Color(BitConverter.Int32BitsToSingle((int)word), 0, 0));

				var tint = Palette.Terrain(cls);
				// Alpha on the colour map is a roughness modifier, not opacity. Half is neutral.
				colours.SetPixel(i, j, new Color(tint.R, tint.G, tint.B, 0.5f));
			}
		}

		var region = ClassDB.Instantiate("Terrain3DRegion").AsGodotObject();
		if (region is null) return null;
		region.Call("set_region_size", RegionSize);
		region.Call("set_vertex_spacing", field.MetresPerSample);
		region.Call("set_location", new Vector2I(info.Cx, info.Cz));
		region.Call("set_height_map", heights);
		if (WriteControl) region.Call("set_control_map", control);
		if (WriteColour) region.Call("set_color_map", colours);
		region.Call("sanitize_maps");
		region.Call("calc_height_range");
		return region;
	}

	/// <summary>
	/// The packed control word for one sample.
	///
	/// Auto-shader on, and that is a deliberate step back from what was tried first. Writing the
	/// base and overlay texture explicitly - ground below, rock above a slope threshold - produced
	/// exactly the numbers intended (checked: the field comes out as 4194304 for flat ground and
	/// 142589952 for steep, which are right), and every one of those words renders correctly when
	/// written as a constant across the whole island. Written per sample they render white on the
	/// flats and black on the slopes. I did not find out why.
	///
	/// What auto-shader does is pick base and overlay by slope, which is what the explicit version
	/// was computing anyway - so nothing is lost today. It becomes worth solving when there are
	/// more than two textures and the choice is beach sand against dune grass against strata,
	/// which slope alone cannot make.
	///
	/// Navigation is still ours to say: the generator knows where a settler can walk.
	/// </summary>
	private static uint ControlFor(byte cls, TerrainField field, int i, int j)
	{
		uint word = AutoShaderBit;
		// Navigable where a settler could plausibly walk: on land, not up a cliff, not in water.
		if (!TerrainClass.IsWater(cls) && field.SlopeOf(i, j) < 0.7f) word |= NavigationBit;
		return word;
	}

	/// <summary>
	/// Cut a hole at a world position: the ground stops existing there, in the mesh and in the
	/// collision both. This is what a tunnel mouth or a cave entrance is made of, and it is the
	/// one thing a heightfield collider could never do.
	/// </summary>
	public void SetHole(Vector3 at, bool hole)
	{
		uint control = (uint)Data.Call("get_control", at).AsInt64();
		control = hole ? control | HoleBit : control & ~HoleBit;
		Data.Call("set_control", at, control);
	}

	/// <summary>Ground height at a world position, from Terrain3D itself. NaN outside a region.</summary>
	public float HeightAt(Vector3 at) => Data.Call("get_height", at).AsSingle();

	/// <summary>Collision follows the camera rather than covering the whole envelope; without a
	/// camera it has nothing to follow, and Terrain3D says so loudly every frame.</summary>
	public void SetCamera(Camera3D camera) => Node.Call("set_camera", camera);
}
