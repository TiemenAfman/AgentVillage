using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Promptholm.Data.Models;

public sealed class IslandData
{
	public string Name { get; set; } = "Promptholm";
	public uint Seed { get; set; }
	/// <summary>
	/// null, "", an epoch number or an ISO-8601 string depending on which config survived.
	/// The converter normalises all of them to string-or-null so this never crashes.
	/// </summary>
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? FoundedAt { get; set; }
	/// <summary>The terrain hash the µlayout computed for this seed; Godot must reproduce it.</summary>
	public string? TerrainHash { get; set; }
	/// <summary>World-space landing spot [x, z], or null while the beach is undecided.</summary>
	public List<int>? Landing { get; set; }
	public TownData? Town { get; set; }
	public LatticeData Lattice { get; set; } = new();
}

public sealed class TownData
{
	/// <summary>Top-left (gx, gz) of the plaza.</summary>
	public List<int>? Square { get; set; }
	public List<int>? Centre { get; set; }
	public int Size { get; set; }
	public List<List<int>> Lots { get; set; } = new();
	public List<List<int>> Paved { get; set; } = new();
	/// <summary>RLE parcel of the commons; absent until a parcel has been drawn.</summary>
	public object? Parcel { get; set; }
	public int CoreR { get; set; } = 2;
	/// <summary>History of plaza widths (size, unlockedAt).</summary>
	public List<TownSizeStep> SizeSteps { get; set; } = new();
}

/// <summary>When the plaza reached each width (size, at, unlockedAt).</summary>
public sealed class TownSizeStep
{
	public int Size { get; set; }
	public int At { get; set; }
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? UnlockedAt { get; set; }
}

/// <summary>Row/column pitch the land register sits on (PITCH = 4 in layout.mjs).</summary>
public sealed class LatticeData
{
	public List<int> Anchor { get; set; } = new();
	public int Pitch { get; set; } = 4;
}