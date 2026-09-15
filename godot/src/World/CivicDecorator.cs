using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Buildings.Data;
using Promptholm.Data.Models;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// Plaza furniture for the side-scene storybook look (Phase 2 step 12): a classic round
/// fountain on the town plaza and a row of awninged market stalls on the market lot. It
/// reads the village data first (the real village.json already carries a <c>civic:fountain</c>
/// at the plaza centre and a <c>civic:market</c> on gx:36, gz:26), and falls back to those
/// exact cells when the data is missing them. WorldManager skips drawing a generic civic
/// house on these plots, so the decorator owns the spot completely.
/// </summary>
[GlobalClass]
public partial class CivicDecorator : Node3D
{
	/// <summary>Turquoise pond colour matching the shallow-water shader gradient.</summary>
	private static readonly Color Water = new(0.22f, 0.72f, 0.68f, 0.82f);

	private static readonly Color CanvasCream = new(0.94f, 0.90f, 0.82f);
	private static readonly Color CanvasNavy = new(0.22f, 0.34f, 0.62f);

	private readonly List<Node3D> _stallRoots = new();
	private Node3D? _fountainRoot;

	/// <summary>True when WorldManager should hand the plot over to the decorator.</summary>
	public static bool Handles(BuildingData b)
	{
		if (string.IsNullOrWhiteSpace(b.Id))
			return false;
		return b.Id.Contains("fountain", StringComparison.OrdinalIgnoreCase)
			|| b.Id.Contains("market", StringComparison.OrdinalIgnoreCase);
	}

	/// <summary>Number of fountains placed (always 0 or 1).</summary>
	public int FountainCount { get; private set; }

	/// <summary>Number of market stalls placed across the market lot.</summary>
	public int StallCount => _stallRoots.Count;

	/// <summary>World-space centre of the fountain, used by the headless verifier.</summary>
	public Vector3 FountainPosition { get; private set; }

	public void BuildCivics(TerrainGenerator terrain, VillageData village)
	{
		ClearDecos();

		var (fGx, fGz) = FindCell(village, "fountain", 32, 32);
		BuildFountain(terrain, fGx, fGz);

		var (mGx, mGz, mW, mD) = FindPlot(village, "market", 36, 26);
		BuildMarket(terrain, mGx, mGz, mW, mD);
	}

	// ---- décor discovery ------------------------------------------------------

	private static (int Gx, int Gz) FindCell(VillageData village, string key, int fallbackGx, int fallbackGz)
	{
		foreach (var b in village.Buildings)
		{
			if (!string.IsNullOrWhiteSpace(b.Id) && b.Id.Contains(key, StringComparison.OrdinalIgnoreCase))
				return (b.Plot.Gx, b.Plot.Gz);
		}
		return (fallbackGx, fallbackGz);
	}

	private static (int Gx, int Gz, int W, int D) FindPlot(VillageData village, string key, int fallbackGx, int fallbackGz)
	{
		foreach (var b in village.Buildings)
		{
			if (!string.IsNullOrWhiteSpace(b.Id) && b.Id.Contains(key, StringComparison.OrdinalIgnoreCase))
				return (b.Plot.Gx, b.Plot.Gz, Math.Max(1, b.Plot.W), Math.Max(1, b.Plot.D));
		}
		return (fallbackGx, fallbackGz, 3, 3);
	}

	// ---- fountain -------------------------------------------------------------

	private void BuildFountain(TerrainGenerator terrain, int gx, int gz)
	{
		var (wx, wz) = terrain.CellWorld(gx, gz);
		float ground = (float)terrain.WorldHeight(wx, wz);

		var root = new Node3D
		{
			Name = "TownFountain",
			Position = new Vector3((float)wx, ground, (float)wz),
		};
		AddChild(root);
		_fountainRoot = root;
		FountainCount = 1;
		FountainPosition = root.Position;

		MeshChild(root, "Basin", Cyl(1.35f, 1.5f, 0.5f, 8), new Vector3(0, 0.25f, 0), SolidFieldstone());
		MeshChild(root, "BasinRim", Cyl(1.28f, 1.35f, 0.08f, 8), new Vector3(0, 0.52f, 0), SolidFieldstoneDark());
		MeshChild(root, "Pond", Cyl(1.05f, 1.16f, 0.08f, 8), new Vector3(0, 0.48f, 0), PondWater());
		MeshChild(root, "Pier", Cyl(0.16f, 0.22f, 0.4f, 8), new Vector3(0, 0.66f, 0), SolidFieldstoneDark());
		MeshChild(root, "WaterColumn", Cyl(0.09f, 0.09f, 0.75f, 8), new Vector3(0, 1.18f, 0), PondWater());
		MeshChild(root, "Crown", Sph(0.13f, 8, 4), new Vector3(0, 1.58f, 0), SolidFieldstone());
	}

	// ---- market stalls --------------------------------------------------------

	private void BuildMarket(TerrainGenerator terrain, int gx, int gz, int w, int d)
	{
		int stalls = Math.Clamp(w, 1, 4);

		for (int i = 0; i < stalls; i++)
		{
			int cellGx = gx + i;
			int cellGz = gz;
			var (wx, wz) = terrain.CellWorld(cellGx, cellGz);
			float ground = (float)terrain.WorldHeight(wx, wz);

			var stall = new Node3D
			{
				Name = "MarketStall",
				Position = new Vector3((float)wx, ground, (float)wz),
			};
			AddChild(stall);
			_stallRoots.Add(stall);

			// Two timber posts and a deep display counter.
			MeshChild(stall, "PostL", Box(0.07f, 1.15f, 0.07f), new Vector3(-0.52f, 0.575f, 0), SolidTimber());
			MeshChild(stall, "PostR", Box(0.07f, 1.15f, 0.07f), new Vector3(0.52f, 0.575f, 0), SolidTimber());
			MeshChild(stall, "Counter", Box(1.24f, 0.08f, 0.6f), new Vector3(0, 1.1f, 0), SolidTimberLight());

			// Slanted striped awning on its own sub-node so the tilt reads from every angle.
			var awning = new Node3D
			{
				Name = "Awning",
				Position = new Vector3(0, 1.95f, 0.18f),
				Rotation = new Vector3(-0.42f, 0, 0),
			};
			stall.AddChild(awning);
			const float slatW = 1.42f;
			const int stripes = 5;
			for (int s = 0; s < stripes; s++)
			{
				float off = s - stripes * 0.5f + 0.5f;
				MeshChild(awning, "Slat", Box(slatW / stripes - 0.02f, 0.05f, 1.0f),
					new Vector3(off * (slatW / stripes), 0, 0),
					s % 2 == 0 ? SolidCanvasA() : SolidCanvasB());
			}
		}
	}

	// ---- helpers --------------------------------------------------------------

	private void ClearDecos()
	{
		foreach (var child in GetChildren())
		{
			RemoveChild(child);
			child.QueueFree();
		}
		_stallRoots.Clear();
		_fountainRoot = null;
		FountainCount = 0;
	}

	private static void MeshChild(Node3D parent, string name, Mesh mesh, Vector3 pos, Material material)
	{
		parent.AddChild(new MeshInstance3D
		{
			Name = name,
			Mesh = mesh,
			MaterialOverride = material,
			Position = pos,
		});
	}

	private static BoxMesh Box(float w, float h, float d) => new() { Size = new Vector3(w, h, d) };
	private static CylinderMesh Cyl(float top, float bottom, float h, int segments)
		=> new() { TopRadius = top, BottomRadius = bottom, Height = h, RadialSegments = segments };
	private static SphereMesh Sph(float r, int segments, int rings)
		=> new() { Radius = r, RadialSegments = segments, Rings = rings };

	private static StandardMaterial3D Solid(Color colour, float roughness = 0.82f)
		=> Palette.Solid(colour, roughness);

	private static StandardMaterial3D SolidFieldstone() => Palette.Solid(Palette.Fieldstone, 0.9f);
	private static StandardMaterial3D SolidFieldstoneDark() => Palette.Solid(Palette.FieldstoneDark, 0.9f);
	private static StandardMaterial3D SolidTimber() => Palette.Solid(Palette.Beam, 0.78f);
	private static StandardMaterial3D SolidTimberLight() => Palette.Solid(new Color(0.72f, 0.55f, 0.32f), 0.78f);

	private static StandardMaterial3D SolidCanvasA() => Palette.Solid(CanvasCream, 0.95f);
	private static StandardMaterial3D SolidCanvasB() => Palette.Solid(CanvasNavy, 0.95f);

	private static StandardMaterial3D PondWater() => Palette.Translucent(Water, 0.15f);
}