using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Promptholm.Data.Models;

/// <summary>
/// Top-level village.json document, as scan.mjs writes it
/// (see scan.mjs buildVillage, around line 319).
/// </summary>
public sealed class VillageData
{
	public int V { get; set; }
	public string? GeneratedAt { get; set; }
	public bool All { get; set; }
	public IslandData Island { get; set; } = new();
	public GridData Grid { get; set; } = new();
	/// <summary>How many sessions earn a project a green and a sign.</summary>
	public int HamletAt { get; set; }
	public List<DistrictData> Districts { get; set; } = new();
	/// <summary>Land-register revision; changes whenever a parcel grows.</summary>
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? DistrictsRev { get; set; }
	public List<BuildingData> Buildings { get; set; } = new();
	public List<PathData> Paths { get; set; } = new();
	public List<BridgeData> Bridges { get; set; } = new();
	public List<List<int>> Cleared { get; set; } = new();
	public List<PolderData> Polders { get; set; } = new();
	public List<MilestoneData> Milestones { get; set; } = new();
	public List<string> Active { get; set; } = new();
	public List<AssignmentData> Assignments { get; set; } = new();
	public VillageStats Stats { get; set; } = new();
}

public sealed class GridData
{
	public int Size { get; set; } = 64;
}