using System;
using System.Collections.Generic;
using System.Linq;
using Godot;
using Promptholm.Data.Models;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// Shared parcel-to-grid decoder for village.json lobe parcels. Used by
/// DistrictDecorator (hedges/archways) and FarmlandSpawner (field placement).
/// </summary>
internal static class ParcelRaster
{
	internal const short None = -1;
	internal const short Town = -2;

	/// <summary>
	/// Fine-cell ownership map: each pitch×pitch block owned by a lobe parcel
	/// gets its district index. Town commons get <see cref="Town"/>.
	/// </summary>
	internal static short[] DecodeOwners(VillageData village, int size)
	{
		var owner = new short[size * size];
		Array.Fill(owner, (short)None);
		var lat = village.Island?.Lattice;
		if (lat is null || lat.Anchor.Count < 2 || lat.Pitch <= 0)
			return owner;
		int ax = lat.Anchor[0], az = lat.Anchor[1], pitch = lat.Pitch;

		void Stamp(object? parcel, short k)
		{
			if (parcel is null) return;
			if (!TryDecode(parcel, out int i0, out int j0, out int w, out int h,
				out string[] rows))
				return;
			for (int r = 0; r < h; r++)
			{
				string row = rows[r];
				for (int c = 0; c < w; c++)
				{
					if (row[c] != '1') continue;
					int gx0 = ax + pitch * (i0 + c);
					int gz0 = az + pitch * (j0 + r);
					for (int z = 0; z < pitch; z++)
						for (int x = 0; x < pitch; x++)
						{
							int gx = gx0 + x, gz = gz0 + z;
							if (gx < 0 || gz < 0 || gx >= size || gz >= size) continue;
							owner[gx + gz * size] = k;
						}
				}
			}
		}

		Stamp(village.Island.Town?.Parcel, Town);
		for (int k = 0; k < village.Districts.Count; k++)
			foreach (var lobe in village.Districts[k].Lobes)
				Stamp(lobe.Parcel, (short)k);
		return owner;
	}

	internal static bool TryDecode(object? parcel, out int i0, out int j0,
		out int w, out int h, out string[] rows)
	{
		i0 = j0 = w = h = 0;
		rows = Array.Empty<string>();
		if (parcel is not System.Text.Json.JsonElement el
			|| el.ValueKind != System.Text.Json.JsonValueKind.Object)
			return false;
		if (!el.TryGetProperty("i0", out var pi0) || !el.TryGetProperty("j0", out var pj0)
			|| !el.TryGetProperty("w", out var pw) || !el.TryGetProperty("h", out var ph)
			|| !el.TryGetProperty("rows", out var prows))
			return false;
		i0 = pi0.GetInt32();
		j0 = pj0.GetInt32();
		w = pw.GetInt32();
		h = ph.GetInt32();
		var list = new List<string>();
		foreach (var r in prows.EnumerateArray())
			list.Add(r.GetString() ?? "");
		rows = list.ToArray();
		return w > 0 && h > 0 && rows.Length == h;
	}
}

/// <summary>
/// Boundary hedges, gateposts and archway name signs for each district lobe,
/// matching the V1 Promptholm visual style. Hedges are low stylised green blocks
/// along parcel edges, with gatepost pairs where roads cross. Archways straddle
/// the road at the hamlet gate, with a wooden plank displaying the district name.
/// All clamped strictly to terrain.WorldHeight. Drawn as MultiMesh for performance.
/// </summary>
[GlobalClass]
public partial class DistrictDecorator : Node3D
{
	private static readonly (int Dx, int Dz)[] ND4 = { (1, 0), (-1, 0), (0, 1), (0, -1) };

	// Hedge block: BoxMesh(0.8, 0.65, 0.35), long axis along local X.
	// Rotated 90° about Y for edges running along Z.
	private const float HedgeLen = 0.8f;
	private const float HedgeH = 0.65f;
	private const float HedgeDepth = 0.35f;

	private static readonly Color HedgeColor = new(0.16f, 0.38f, 0.14f);
	private static readonly Color GatepostColor = new(0.42f, 0.30f, 0.16f);
	private static readonly Color SignWood = new(0.45f, 0.32f, 0.17f);
	private static readonly Color SignWoodDark = new(0.30f, 0.20f, 0.11f);

	public int HedgeCount { get; private set; }
	public int ArchwayCount { get; private set; }

	public void DecorateDistricts(TerrainField terrain, VillageData village)
	{
		foreach (var child in GetChildren())
		{
			RemoveChild(child);
			child.QueueFree();
		}
		HedgeCount = 0;
		ArchwayCount = 0;

		int size = terrain.Size;
		float half = (float)terrain.Half;
		// Lot coordinates into metres. A hedge runs the length of a lot, so its mesh grows
		// with the grid; its height and thickness are a hedge and do not.
		float lot = terrain.Span(1.0);
		var owner = ParcelRaster.DecodeOwners(village, size);

		var roadCells = new HashSet<long>();
		foreach (var path in village.Paths)
			foreach (var cell in path.Cells)
				if (cell.Count >= 2)
					roadCells.Add((long)cell[1] * size + cell[0]);
		foreach (var bridge in village.Bridges)
			foreach (var cell in bridge.Cells)
				if (cell.Count >= 2)
					roadCells.Add((long)cell[1] * size + cell[0]);
		if (village.Island.Town?.Paved is not null)
			foreach (var cell in village.Island.Town.Paved)
				if (cell.Count >= 2)
					roadCells.Add((long)cell[1] * size + cell[0]);

		bool IsRoad(int gx, int gz) =>
			gx >= 0 && gz >= 0 && gx < size && gz < size
			&& roadCells.Contains((long)gz * size + gx);

		short OwnerAt(int gx, int gz) =>
			(gx < 0 || gz < 0 || gx >= size || gz >= size)
				? ParcelRaster.None : owner[gx + gz * size];

		var hedgeTfs = new List<Transform3D>();
		var postTfs = new List<Transform3D>();

		var hedgeMesh = new BoxMesh { Size = new Vector3(HedgeLen * lot, HedgeH, HedgeDepth) };
		hedgeMesh.Material = SolidMat(HedgeColor);

		var postMesh = new BoxMesh { Size = new Vector3(0.12f, 0.72f, 0.12f) };
		postMesh.Material = SolidMat(GatepostColor);

		for (int gz = 0; gz < size; gz++)
		{
			for (int gx = 0; gx < size; gx++)
			{
				short k = OwnerAt(gx, gz);
				if (k == ParcelRaster.None || k == ParcelRaster.Town) continue;

				foreach (var (dx, dz) in ND4)
				{
					int nx = gx + dx, nz = gz + dz;
					short no = OwnerAt(nx, nz);
					if (no == k) continue;
					if (no != ParcelRaster.None && no != ParcelRaster.Town && no < k) continue;
					if (!terrain.IsLand(nx, nz)) continue;

					if (IsRoad(gx, gz) && IsRoad(nx, nz))
					{
						bool isX = dx != 0;
						int fixedC = isX ? gx + (dx > 0 ? 1 : 0) : gz + (dz > 0 ? 1 : 0);
						int along0 = isX ? gz : gx;
						foreach (int along in new[] { along0, along0 + 1 })
						{
							float px = (isX ? fixedC - half : along - half) * lot;
							float pz = (isX ? along - half : fixedC - half) * lot;
							float ph = (float)terrain.WorldHeight(px, pz);
							postTfs.Add(new Transform3D(Basis.Identity,
								new Vector3(px, ph + 0.36f, pz)));
						}
						continue;
					}

					float midX, midZ;
					Basis basis;
					if (dx != 0)
					{
						midX = (gx + (dx > 0 ? 1 : 0) - half) * lot;
						midZ = (gz - half + 0.5f) * lot;
						basis = RotY90();
					}
					else
					{
						midX = (gx - half + 0.5f) * lot;
						midZ = (gz + (dz > 0 ? 1 : 0) - half) * lot;
						basis = Basis.Identity;
					}
					float h = (float)terrain.WorldHeight(midX, midZ);
					hedgeTfs.Add(new Transform3D(basis,
						new Vector3(midX, h + HedgeH * 0.5f, midZ)));
				}
			}
		}

		if (hedgeTfs.Count > 0)
			AddChild(FillMulti(hedgeMesh, hedgeTfs));
		if (postTfs.Count > 0)
			AddChild(FillMulti(postMesh, postTfs));

		HedgeCount = hedgeTfs.Count;

		for (int di = 0; di < village.Districts.Count; di++)
		{
			var d = village.Districts[di];
			if (string.IsNullOrWhiteSpace(d.Name)) continue;
			if (string.Equals(d.Tier, "farmstead", StringComparison.OrdinalIgnoreCase))
				continue;
			if (d.Center is null || d.Center.Count < 2) continue;

			for (int li = 0; li < d.Lobes.Count; li++)
			{
				var lobe = d.Lobes[li];
				var gate = FindGate(village, d.Id, li, lobe);

				int gx, gz;
				if (gate.HasValue)
				{
					gx = gate.Value.AtGx;
					gz = gate.Value.AtGz;
				}
				else
				{
					gx = lobe.Green?[0] ?? d.Center[0];
					gz = lobe.Green?[1] ?? d.Center[1];
				}

				var (wx, wz) = terrain.CellWorld(gx, gz);
				float ground = (float)terrain.WorldHeight(wx, wz);
				bool along = gate.HasValue
					&& Math.Abs(gate.Value.NextGx - gate.Value.AtGx)
					   > Math.Abs(gate.Value.NextGz - gate.Value.AtGz);
				float yaw = along ? MathF.PI / 2f : 0f;

				SpawnArchway(new Vector3((float)wx, ground, (float)wz),
					yaw, d.Name!, d.Hue);
				ArchwayCount++;
			}
		}

		GD.Print($"[DistrictDecorator] {HedgeCount} hedges, {postTfs.Count} gateposts, "
			+ $"{ArchwayCount} archways");
	}

	// ---- archway ---------------------------------------------------------------

	private void SpawnArchway(Vector3 pos, float yaw, string name, int hue)
	{
		var root = new Node3D
		{
			Name = $"Archway_{name}",
			Position = pos,
			Rotation = new Vector3(0, yaw, 0),
		};

		var postMat = SolidMat(SignWoodDark);
		float h = pos.Y;
		float span = 1.1f;
		float postH = 2.2f;

		var postMesh = new BoxMesh { Size = new Vector3(0.16f, postH, 0.16f) };
		postMesh.Material = postMat;
		root.AddChild(new MeshInstance3D
		{
			Name = "PostL", Mesh = postMesh,
			Position = new Vector3(-span, h + postH * 0.5f, 0),
		});
		root.AddChild(new MeshInstance3D
		{
			Name = "PostR", Mesh = postMesh,
			Position = new Vector3(span, h + postH * 0.5f, 0),
		});

		var beamMesh = new BoxMesh { Size = new Vector3(span * 2 + 0.22f, 0.14f, 0.16f) };
		beamMesh.Material = postMat;
		root.AddChild(new MeshInstance3D
		{
			Name = "Lintel", Mesh = beamMesh,
			Position = new Vector3(0, h + postH + 0.07f, 0),
		});

		float nameLen = name.Length;
		float pw = MathF.Min(2.1f, MathF.Max(0.55f, nameLen * 0.06f + 0.55f));
		float plaqueY = h + 1.35f;

		var plaqueMesh = new BoxMesh { Size = new Vector3(pw, 0.34f, 0.05f) };
		plaqueMesh.Material = SolidMat(SignWood);
		root.AddChild(new MeshInstance3D
		{
			Name = "Plaque", Mesh = plaqueMesh,
			Position = new Vector3(0, plaqueY, 0),
		});

		var hueColor = Color.FromHsv(hue / 360f, 0.5f, 0.42f);
		var bandMesh = new BoxMesh { Size = new Vector3(pw - 0.04f, 0.06f, 0.055f) };
		bandMesh.Material = SolidMat(hueColor);
		root.AddChild(new MeshInstance3D
		{
			Name = "HueBand", Mesh = bandMesh,
			Position = new Vector3(0, plaqueY + 0.14f, 0),
		});

		var label = new Label3D
		{
			Text = name.ToUpperInvariant(),
			FontSize = 24,
			PixelSize = 0.008f,
			Modulate = new Color(0.18f, 0.15f, 0.12f),
			HorizontalAlignment = HorizontalAlignment.Center,
			VerticalAlignment = VerticalAlignment.Center,
			Position = new Vector3(0, plaqueY, 0.03f),
		};
		root.AddChild(label);

		AddChild(root);
	}

	// ---- gate detection --------------------------------------------------------

	private static (int AtGx, int AtGz, int NextGx, int NextGz)? FindGate(
		VillageData village, string districtId, int lobeIndex, DistrictLobe lobe)
	{
		var lat = village.Island?.Lattice;
		if (lat is null || lat.Anchor.Count < 2 || lat.Pitch <= 0) return null;
		if (lobe.Parcel is null) return null;
		if (!ParcelRaster.TryDecode(lobe.Parcel, out var pi0, out var pj0,
			out var pw, out var ph, out var prows))
			return null;

		var own = new HashSet<(int, int)>();
		for (int r = 0; r < ph; r++)
			for (int c = 0; c < pw; c++)
				if (prows[r][c] == '1')
					own.Add((pi0 + c, pj0 + r));

		string roadId = $"road:{districtId}:{lobeIndex}";
		var road = village.Paths.FirstOrDefault(p => p.Id == roadId);
		if (road is null || road.Cells.Count < 2) return null;

		int ax = lat.Anchor[0], az = lat.Anchor[1], pitch = lat.Pitch;
		bool IsMine(List<int> cell)
		{
			if (cell.Count < 2) return false;
			int scx = (int)MathF.Floor((cell[0] - ax) / (float)pitch);
			int scz = (int)MathF.Floor((cell[1] - az) / (float)pitch);
			return own.Contains((scx, scz));
		}

		for (int i = 0; i < road.Cells.Count - 1; i++)
		{
			if (road.Cells[i].Count >= 2 && road.Cells[i + 1].Count >= 2
				&& IsMine(road.Cells[i]) && !IsMine(road.Cells[i + 1]))
				return (road.Cells[i][0], road.Cells[i][1],
						road.Cells[i + 1][0], road.Cells[i + 1][1]);
		}
		if (road.Cells[0].Count >= 2 && road.Cells[1].Count >= 2)
			return (road.Cells[0][0], road.Cells[0][1],
					road.Cells[1][0], road.Cells[1][1]);
		return null;
	}

	// ---- helpers ---------------------------------------------------------------

	/// <summary>-90° rotation about Y: local +X → global +Z.</summary>
	private static Basis RotY90() => new(
		new Vector3(0, 0, 1),
		Vector3.Up,
		new Vector3(-1, 0, 0));

	private static MultiMeshInstance3D FillMulti(Mesh mesh, List<Transform3D> tfs)
	{
		var mm = new MultiMesh
		{
			Mesh = mesh,
			TransformFormat = MultiMesh.TransformFormatEnum.Transform3D,
		};
		var mmi = new MultiMeshInstance3D { Multimesh = mm };
		mm.InstanceCount = tfs.Count;
		for (int i = 0; i < tfs.Count; i++)
			mm.SetInstanceTransform(i, tfs[i]);
		return mmi;
	}

	private static StandardMaterial3D SolidMat(Color color)
		=> Palette.Solid(color, 0.85f);
}
