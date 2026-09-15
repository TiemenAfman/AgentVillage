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
	public const int TexturePaving = 2;

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

		var data = node.Get("data").AsGodotObject();
		if (data is null)
		{
			// Terrain3D builds its data object when it enters the tree, so this is what you get
			// for calling from _Initialize - where the tree is not live yet. Returning null lets
			// the caller fall back to the chunk meshes instead of taking the whole run down.
			GD.PushWarning(
				"Terrain3D has no data object yet; was the world built from _Initialize? " +
				"Build on the first frame instead. Falling back to chunk meshes.");
			parent.RemoveChild(node);
			node.QueueFree();
			return null;
		}

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

		// Packed pairs, not the loose maps from the pack, and that is not a detail.
		//
		// Terrain3D wants **albedo in RGB with height in alpha** - that is what the _alb_ht
		// suffix means - and normal in RGB with roughness in alpha. A JPEG has no alpha, so
		// feeding it one leaves the height at 1.0 everywhere and its height-based blending
		// falls over: tried with 4K JPEGs from ambientCG and the island came back bleached
		// white. Going to 4K is fine, but the maps have to be repacked into PNGs with the
		// fourth channel filled first, and nothing does that yet.
		// De tint is neutraal van kleur en alleen donker van waarde, en dat is het hele punt van
		// de geschilderde set: de strokes moduleren rond 1.0 in plaats van rond 0.5, dus wat er
		// overblijft is de kleurkaart - de klasse die de generator koos, met korrel erover. Bij
		// de foto's moest de tint de kleur nog terugzetten die het delitten eruit had gerekend;
		// hier zou diezelfde tint de kleurkaart juist overstemmen.
		//
		// Waarom niet gewoon wit: met tint 1.0 komt de klassekleur er ongedempt uit en dat is
		// ~1,3x helderder dan de fotoset. Gemeten op dezelfde shot werd gras neongroen en zand
		// bijna wit (243,245,211 van de 255). Rond 0,78 zit hij weer op de helderheid van de
		// foto's, maar dan als vlakke kleur in plaats van als foto. Blauw staat extra laag: de
		// foto's waren warm en dempten blauw mee, en zonder dat wordt zand crème in plaats van
		// oker. De rots krijgt daarbovenop een warme duw, zodat een rotshelling dezelfde kant op
		// kleurt als de keien van RockMesh die erop staan.
		AddTexture(assets, TextureGround, "ground", Painted("ground", "ground037"), 0.34f, new Color(0.76f, 0.78f, 0.68f));
		AddTexture(assets, TextureRock, "rock", Painted("rock", "rock023"), 0.22f, new Color(0.84f, 0.80f, 0.72f));
		// uv_scale is repeats per metre, so 0.42 puts one repeat of the flagstone strokes in
		// about two and a half metres - a paving stone the size of a paving stone.
		AddTexture(assets, TexturePaving, "paving", Painted("paving", "rocks025"), 0.42f, new Color(0.80f, 0.78f, 0.74f));

		Node.Set("assets", assets);
	}

	/// <summary>The same, for a pack that ships its maps loose instead of packed in pairs.</summary>
	private static void AddTextureMaps(GodotObject assets, int slot, string name, string albedoPath, string normalPath, float uvScale)
	{
		var albedo = GD.Load<Texture2D>(albedoPath);
		if (albedo is null)
		{
			GD.PushWarning($"terrain texture {albedoPath} is missing; slot {slot} stays empty");
			return;
		}
		var asset = ClassDB.Instantiate("Terrain3DTextureAsset").AsGodotObject();
		if (asset is null) return;
		asset.Set("name", name);
		asset.Set("id", slot);
		asset.Set("albedo_texture", albedo);
		var normal = GD.Load<Texture2D>(normalPath);
		if (normal is not null) asset.Set("normal_texture", normal);
		asset.Set("uv_scale", uvScale);
		assets.Call("set_texture", slot, asset);
	}

	/// <summary>The three painted sets StrokeTexturesRunner writes, by slot order.</summary>
	private static readonly string[] PaintedSet = ["ground", "rock", "paving"];

	/// <summary>
	/// The hand-painted set if StrokeTexturesRunner has been run, otherwise the photoscan, and
	/// otherwise the small demo pair that ships in git so a fresh clone still has *a* ground.
	///
	/// All three slots switch together or none of them do. Every texture in the array has to be
	/// the same format *and* the same size, so one 512 painted slot beside two 4K photographs is
	/// exactly the mismatch that makes Terrain3D reject the whole list - and after that the
	/// terrain has no material at all and every later change to it appears to do nothing.
	/// </summary>
	private static string Painted(string painted, string photo)
	{
		if (PaintedComplete()) return $"res://assets/terrain-strokes/{painted}";
		string packed = $"res://assets/terrain-packed/{photo}_alb_ht.png";
		return Godot.FileAccess.FileExists(packed)
			? $"res://assets/terrain-packed/{photo}"
			: $"res://assets/terrain/{photo}";
	}

	private static bool PaintedComplete()
	{
		foreach (string name in PaintedSet)
		{
			if (!Godot.FileAccess.FileExists($"res://assets/terrain-strokes/{name}_alb_ht.png")) return false;
		}
		return true;
	}

	private static void AddTexture(GodotObject assets, int slot, string name, string prefix, float uvScale, Color? tint = null)
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
		// ground. It was 0.06 - one repeat per seventeen metres - which stretched a two-metre
		// photograph of turf over half a hillside, and from standing height that is a green blur.
		// A third of a repeat per metre puts a blade of grass back at the size of a blade of grass.
		asset.Set("uv_scale", uvScale);
		if (tint.HasValue) asset.Set("albedo_color", tint.Value);
		// The normal map is the only thing left that says the ground is not a flat photograph, and
		// it is doing all of the work: Terrain3D's shader has sixteen parameters and not one of
		// them is parallax or tessellation, so a stone can be *shaded* as if it stands out but
		// never actually stand out. Pushed well past the default; beyond about three it stops
		// reading as relief and starts reading as foil.
		asset.Set("normal_depth", 2.8f);
		// Ambient occlusion comes off the height in the albedo's alpha. With the displacement map
		// in there it finally has something to occlude with.
		asset.Set("ao_strength", 1.0f);
		// And because a repeat every three metres would otherwise read as a chequerboard from
		// the air, each tile is rotated and shifted a little against its neighbours.
		// Rotation was 0.14 and it was worse than the tiling it fixed: Terrain3D turns each
		// repeat by a different amount, so every tile meets its neighbour at a seam and a rock
		// face came out as a patchwork of squares. Shift alone slides the repeats past each
		// other without turning them, which breaks the grid and leaves no edges behind; the
		// large-scale variation comes from macro_variation instead.
		asset.Set("detiling_rotation", 0.0f);
		asset.Set("detiling_shift", 0.35f);
		assets.Call("set_texture", slot, asset);
	}

	/// <summary>
	/// Our own shader over their clipmap. Terrain3D's default look is realistic PBR; this project
	/// is painterly, and without this the terrain system would decide the art direction.
	/// </summary>
	private void ApplyMaterial(Shader? shaderOverride)
	{
		var material = Node.Get("material").AsGodotObject();
		if (material is null)
		{
			GD.PushWarning("Terrain3D exposed no material");
			return;
		}

		// Three settings that decide whether the ground looks like ground from two metres away.
		// None of them is resolution: a close-up of this terrain came back smeared into streaks,
		// and the honest diagnosis was projection and tiling scale, not pixels.
		//
		//   enable_projection  Terrain3D projects its textures straight down by default, so a
		//                      slope of sixty degrees stretches the grass to twice its length
		//                      and a cliff face smears into vertical stripes. This puts a second
		//                      projection on the steep parts, which is the whole fix for that.
		//   macro variation    Raising uv_scale to something sane means the texture repeats every
		//                      few metres, and a repeat every few metres reads as a grid from the
		//                      air. This modulates it over tens of metres so the grid dissolves.
		//   dual scaling       A second scale for the distance, so the near ground can be fine
		//                      without the far ground turning into noise.
		// These live in the shader, not on the material object. `material.Set(name, value)` looks
		// like it works and does nothing at all - it pushes a warning into a log nobody reads and
		// the terrain comes back exactly as blurry as before. `set_shader_param` is the door.
		void Param(string name, Variant value) => material.Call("set_shader_param", name, value);

		//   projection      Terrain3D projects its textures straight down, so a slope of sixty
		//                   degrees stretches the grass to twice its length and a cliff smears
		//                   into vertical stripes. This is the second projection for steep ground.
		//   mipmap_bias     Positive biases towards the blurrier mip. The default is tuned for a
		//                   terrain you fly over; this one is walked on.
		//   depth_blur      Blurs the distance on purpose. We already have fog for that.
		//   macro variation Two colours modulated over tens of metres. Without them a texture
		//                   that repeats every three metres reads as one flat green from far off,
		//                   which is the price of making it sharp up close.
		// Per-face normals on the ground itself, the same trick RockMesh uses on a boulder. The
		// terrain is a clipmap of triangles either way; shading them flat is what turns a smooth
		// photoreal hill into a faceted one, and it costs nothing - no geometry changes, no world
		// changes, no re-founding.
		Param("flat_terrain_normals", true);
		Param("enable_projection", true);

		Param("depth_blur", 0.0f);
		// Macro variation and dual scaling are OFF, and that is a finding rather than an
		// omission. Both were tried: dual scaling with no near/far distances set broke the rock
		// faces into a patchwork of squares, and macro variation on top of the colour map - which
		// already tints every sample with the biome the server picked - turned the valleys neon.
		// This island gets its large-scale colour from the generator, not from the shader, so the
		// shader should stay out of it.
		Param("enable_macro_variation", false);
		material.Set("dual_scaling", false);

		if (shaderOverride is null) return;
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

	// ---- painting the paving ------------------------------------------------------

	/// <summary>What the stone is tinted to where the paving is solid.</summary>
	private static readonly Color PavingTint = new(0.66f, 0.64f, 0.60f);

	/// <summary>Metres of solid paving either side of a path's centre line.</summary>
	private const float PavingHalfW = 1.5f;
	/// <summary>And how far past that it fades out into whatever the ground already was.</summary>
	private const float PavingFade = 1.6f;

	/// <summary>
	/// Paint the roads into the terrain instead of laying a mesh over it.
	///
	/// A road drawn as geometry is a separate object sitting on the ground, and it looks like
	/// one: it has the lot's own square edges, it z-fights where it meets a slope, and it stops
	/// dead at a boundary no road ever had. What a path actually is, is the ground being a
	/// different ground - and that is a texture, blended in over a metre or two.
	///
	/// This is done through Terrain3D's own per-position setters rather than by packing control
	/// words into an image by hand. Writing the image is what this file has a long note about
	/// further down: the words came out right and rendered white. `set_control_base_id` and
	/// friends pack the same bits internally, so whatever was wrong about doing it by hand stops
	/// being our problem.
	///
	/// The blend byte is what buys the gradient. 0 is all base, 255 is all overlay; a sample on
	/// the centre line gets pure paving and one <see cref="PavingFade"/> metres out gets pure
	/// meadow, with a smoothstep between so the edge has no line in it.
	/// </summary>
	public void PaintPaving(TerrainField field, IEnumerable<IReadOnlyList<(int Gx, int Gz)>> runs, double metresPerLot)
	{
		var distance = PavedDistance(field, runs, metresPerLot);
		_paved = distance;

		int painted = 0;
		float mps = field.MetresPerSample;
		float half = field.EnvelopeHalf;
		foreach (var (key, d) in distance)
		{
			var at = new Vector3(key.I * mps - half, 0.0f, key.J * mps - half);
			// Terrain3D stores one control word per sample and finds it from a world position;
			// outside a published region there is nothing to write to and it says so.
			if (float.IsNaN(HeightAt(at))) continue;

			float t = Mathf.Clamp((d - PavingHalfW) / PavingFade, 0.0f, 1.0f);
			int blend = (int)MathF.Round(Mathf.SmoothStep(0.0f, 1.0f, t) * 255.0f);

			Data.Call("set_control_auto", at, false);
			Data.Call("set_control_base_id", at, TexturePaving);
			Data.Call("set_control_overlay_id", at, TextureGround);
			Data.Call("set_control_blend", at, blend);

			// And take the biome tint off, in step with the same ramp.
			//
			// The colour map multiplies the splatted texture with whatever colour the server's
			// classifier picked for that sample, which is what keeps the island painterly. A
			// road is classified meadow - it is meadow, with stones on it - so without this the
			// cobbles come through multiplied by grass green and the path is invisible. Found
			// the hard way: the control map was written correctly and nothing appeared.
			var (i, j) = (key.I, key.J);
			var tint = Palette.Terrain(field.ClassOf(i, j));
			// Towards stone, not towards white. Every other sample on the island is tinted *down*
			// from its texture, so leaving the path at 1,1,1 made it the brightest thing in the
			// frame - a chalk stripe over the meadow rather than a track through it.
			float k = (float)blend / 255.0f;
			Data.Call("set_color", at, new Color(
				Mathf.Lerp(PavingTint.R, tint.R, k),
				Mathf.Lerp(PavingTint.G, tint.G, k),
				Mathf.Lerp(PavingTint.B, tint.B, k), 0.5f));
			painted++;
		}

		Data.Call("update_maps");
		GD.Print($"[Terrain3D] painted {painted} samples of paving");
	}

	/// <summary>
	/// Distance from each sample near a paved run to the nearest one, in metres.
	///
	/// Split out of <see cref="PaintPaving"/> rather than copied, because the scatterers need the
	/// same answer: nothing grows on a road, and "near a road" has to mean the same thing to the
	/// paint and to the grass or the verge will not line up with the stones. Only samples within
	/// <see cref="PavedReach"/> appear, so this is a sparse map and not a field over the envelope.
	/// </summary>
	private static Dictionary<(int I, int J), float> PavedDistance(
		TerrainField field, IEnumerable<IReadOnlyList<(int Gx, int Gz)>> runs, double metresPerLot)
	{
		var distance = new Dictionary<(int I, int J), float>();
		float reach = PavedReach;
		float half = field.EnvelopeHalf;
		float mps = field.MetresPerSample;

		void Mark(Vector2 a, Vector2 b)
		{
			float minX = MathF.Min(a.X, b.X) - reach, maxX = MathF.Max(a.X, b.X) + reach;
			float minZ = MathF.Min(a.Y, b.Y) - reach, maxZ = MathF.Max(a.Y, b.Y) + reach;
			int i0 = (int)MathF.Floor((minX + half) / mps), i1 = (int)MathF.Ceiling((maxX + half) / mps);
			int j0 = (int)MathF.Floor((minZ + half) / mps), j1 = (int)MathF.Ceiling((maxZ + half) / mps);

			for (int j = j0; j <= j1; j++)
			{
				for (int i = i0; i <= i1; i++)
				{
					if (!field.InField(i, j)) continue;
					var p = new Vector2(i * mps - half, j * mps - half);
					float d = DistanceToSegment(p, a, b);
					if (d > reach) continue;
					var key = (i, j);
					if (!distance.TryGetValue(key, out float best) || d < best) distance[key] = d;
				}
			}
		}

		foreach (var run in runs)
		{
			if (run.Count == 0) continue;
			// A single lot is a doorstep: a segment of zero length, which the point-to-segment
			// distance handles as a circle, and that is exactly right for it.
			for (int k = 0; k < run.Count; k++)
			{
				var a = LotCentre(run[k], field, metresPerLot);
				var b = LotCentre(run[Math.Min(k + 1, run.Count - 1)], field, metresPerLot);
				Mark(a, b);
			}
		}

		return distance;
	}

	/// <summary>The paved samples from the last <see cref="PaintPaving"/>, keyed the same way.</summary>
	private Dictionary<(int I, int J), float>? _paved;

	/// <summary>How far from a path's centre line the paving has any say at all, in metres.</summary>
	public const float PavedReach = PavingHalfW + PavingFade;

	/// <summary>
	/// Whether a sample is close enough to a paved run that nothing should be growing on it.
	///
	/// False everywhere until <see cref="PaintPaving"/> has run, which is why the scatterers are
	/// wired after the roads: a spawner that asks too early gets a truthful "no paving anywhere"
	/// and sows grass down the middle of the high street.
	/// </summary>
	public bool IsPaved(int i, int j) => _paved is not null && _paved.ContainsKey((i, j));

	private static Vector2 LotCentre((int Gx, int Gz) lot, TerrainField field, double metresPerLot)
	{
		double half = field.Size / 2.0;
		return new Vector2(
			(float)((lot.Gx - half + 0.5) * metresPerLot),
			(float)((lot.Gz - half + 0.5) * metresPerLot));
	}

	/// <summary>Shortest distance from a point to a line segment; a zero-length segment is a point.</summary>
	private static float DistanceToSegment(Vector2 p, Vector2 a, Vector2 b)
	{
		var ab = b - a;
		float len2 = ab.LengthSquared();
		if (len2 < 1e-6f) return (p - a).Length();
		float t = Mathf.Clamp((p - a).Dot(ab) / len2, 0.0f, 1.0f);
		return (p - (a + ab * t)).Length();
	}

	// ---- the instancer ------------------------------------------------------------

	/// <summary>
	/// How far an instanced kind is drawn, how softly it stops, and whether it casts a shadow.
	/// </summary>
	/// <param name="DrawRangeM">Metres at which the instance disappears. Zero leaves Terrain3D's
	/// own defaults alone, which are 32 m for the first level of detail and 32 m more for each
	/// one after — short enough that a single-mesh asset, which has exactly one level, is culled
	/// at 32 m whether that was intended or not.</param>
	/// <param name="FadeM">Metres of cross-fade before the range ends, so a kind thins out
	/// instead of popping. Terrain3D clamps this to half the gap to the next level's range, which
	/// is why the next range is set alongside it.</param>
	/// <param name="Shadows">A shadow per blade of grass is a draw per blade of grass. Worth it
	/// for a bush, not for ground cover.</param>
	public readonly record struct MeshTuning(float DrawRangeM, float FadeM, bool Shadows)
	{
		/// <summary>Terrain3D's own settings, untouched.</summary>
		public static readonly MeshTuning Default = new(0.0f, 0.0f, true);
	}

	/// <summary>
	/// Next free slot in Terrain3D's mesh list.
	///
	/// Terrain3D grows that list one entry at a time, so registering id 3 while it holds one is
	/// refused with "Mesh ID out of range" — and the refusal costs you the kind, silently apart
	/// from an error nobody reads. Every caller used to hardcode its own block of ids, which works
	/// exactly until two callers exist. This hands them out in call order instead.
	/// </summary>
	private int _nextMeshId;

	/// <summary>
	/// Register a mesh under the next free id, so instances of it can be scattered. Returns the id.
	///
	/// Terrain3D wants a <c>PackedScene</c>, which normally means a .tscn on disk — a procedural
	/// world has no such file, so the scene is packed in memory. That was the one genuinely
	/// uncertain part of this path and <c>SpikeInstancerRunner</c> settled it.
	///
	/// LOD ranges are read off the scene's node names by Terrain3D (a child called *LOD1 and so
	/// on); a single-mesh scene simply has one level, which is right for a rock or a bush.
	/// </summary>
	public int RegisterMeshAsset(string name, Mesh mesh, float heightOffset = 0.0f,
		MeshTuning? tuning = null, Material? material = null)
	{
		var asset = NewMeshAsset(name, tuning ?? MeshTuning.Default);
		if (asset is null) return -1;

		var holder = new MeshInstance3D { Name = name, Mesh = mesh };
		var scene = new PackedScene();
		if (scene.Pack(holder) != Error.Ok)
		{
			GD.PushWarning($"could not pack a scene for mesh asset '{name}'");
			return -1;
		}

		asset.Set("scene_file", scene);
		asset.Set("height_offset", heightOffset);
		// Null leaves the mesh's own surface materials alone, which is what a rock wants: RockMesh
		// builds its stone with one. A plant wants the wind shader instead, and one override across
		// every variant is one pipeline state for the lot.
		if (material is not null) asset.Set("material_override", material);
		return Commit(asset);
	}

	/// <summary>
	/// Register one of Terrain3D's own generated texture cards, under the next free id.
	///
	/// A card is a quad, or two or three of them crossed, with a cut-out texture on it — the
	/// cheapest thing that can be a blade of grass. Terrain3D builds the geometry from
	/// <paramref name="size"/> and <paramref name="faces"/>; what it does not have is an opinion
	/// about the material, which is where the wind comes from.
	///
	/// Note what the geometry does and does not do with <paramref name="size"/>: the card's base
	/// always sits at local y = -0.5 and grows upward from there, whatever height is asked for. So
	/// a card is *not* anchored at its root, and an instance placed exactly on the ground sinks
	/// half a metre into it. The spawner lifts it back; see FoliageSpawner.
	/// </summary>
	public int RegisterCardAsset(string name, Vector2 size, int faces, Material material, MeshTuning? tuning = null)
	{
		var asset = NewMeshAsset(name, tuning ?? MeshTuning.Default);
		if (asset is null) return -1;

		asset.Set("generated_type", CardType);
		asset.Set("generated_faces", faces);
		asset.Set("generated_size", size);
		asset.Set("material_override", material);
		return Commit(asset);
	}

	/// <summary>Terrain3DMeshAsset.TYPE_TEXTURE_CARD, which C# gets no enum for.</summary>
	private const int CardType = 1;

	private GodotObject? NewMeshAsset(string name, MeshTuning tuning)
	{
		var asset = ClassDB.Instantiate("Terrain3DMeshAsset").AsGodotObject();
		if (asset is null) { GD.PushWarning("Terrain3DMeshAsset would not instantiate"); return null; }

		asset.Set("name", name);
		asset.Set("id", _nextMeshId);
		asset.Set("cast_shadows", (int)(tuning.Shadows
			? GeometryInstance3D.ShadowCastingSetting.On
			: GeometryInstance3D.ShadowCastingSetting.Off));

		if (tuning.DrawRangeM > 0.0f)
		{
			asset.Set("lod0_range", tuning.DrawRangeM);
			// The next level's range only exists to give the fade something to clamp against:
			// Terrain3D limits fade_margin to half the gap between lod0 and lod1, so leaving lod1
			// at its 64 m default silently zeroes the fade on anything drawn further than that.
			asset.Set("lod1_range", tuning.DrawRangeM * 1.6f);
			asset.Set("fade_margin", tuning.FadeM);
		}
		return asset;
	}

	private int Commit(GodotObject asset)
	{
		var assets = Node.Get("assets").AsGodotObject();
		if (assets is null) { GD.PushWarning("Terrain3D exposes no asset list"); return -1; }
		int id = _nextMeshId++;
		assets.Call("set_mesh_asset", id, asset);
		return id;
	}

	/// <summary>
	/// Scatter a batch of one mesh.
	///
	/// Batched deliberately: every call to the instancer is a GDExtension crossing, and
	/// <c>update_mmis</c> rebuilds the whole MultiMesh tree. So the transforms go in with
	/// <c>update = false</c> and the rebuild happens once, in <see cref="FinishInstances"/>.
	///
    /// An instance outside a published region has nowhere to be stored and is dropped silently,
	/// which is why the caller filters on the field first rather than trusting this to complain.
	/// </summary>
	public void AddInstances(int meshId, Godot.Collections.Array transforms, Color[] colours)
	{
		if (transforms.Count == 0) return;
		var instancer = Node.Call("get_instancer").AsGodotObject();
		if (instancer is null) { GD.PushWarning("Terrain3D exposes no instancer"); return; }
		instancer.Call("add_transforms", meshId, transforms, colours, false);
	}

	/// <summary>Rebuild the MultiMesh tree once, after every batch is in.</summary>
	public void FinishInstances()
	{
		var instancer = Node.Call("get_instancer").AsGodotObject();
		instancer?.Call("update_mmis", true);
	}

	/// <summary>Instances actually rendered, counted from the scene rather than from a return
	/// value: stored and drawn are different claims, and this is the one that matters.</summary>
	public int InstanceCount => CountInstances(Node);

	private static int CountInstances(Node node)
	{
		int n = node is MultiMeshInstance3D mmi && mmi.Multimesh is not null ? mmi.Multimesh.InstanceCount : 0;
		foreach (var child in node.GetChildren()) n += CountInstances(child);
		return n;
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

	/// <summary>
	/// Hide or show every instanced mesh at once — rocks, grass, ferns, bushes.
	///
	/// Terrain3D's own switch, and it hides rather than unloads, so the same frame can be measured
	/// with and without the scatter and the difference is the scatter's bill and nothing else.
	/// </summary>
	public void SetShowInstances(bool show) => Node.Set("show_instances", show);
}
