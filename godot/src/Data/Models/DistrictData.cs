using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Promptholm.Data.Models;

/// <summary>A fleck of the island a settler's projects cluster around.</summary>
public sealed class DistrictData
{
	public string Id { get; set; } = "";
	public string? Kind { get; set; }
	public string? Name { get; set; }
	/// <summary>Working directory root; null for the outlands and the quay.</summary>
	public string? Root { get; set; }
	/// <summary>Hue of the district, hash32(key) % 360.</summary>
	public int Hue { get; set; }
	/// <summary>Lattice cell at the middle of the built part, [gx, gz].</summary>
	public List<int>? Center { get; set; }
	/// <summary>Top-left (gx, gz) of the district square, when it has one.</summary>
	public List<int>? Square { get; set; }
	public List<List<int>> Pier { get; set; } = new();
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? FirstSeenAt { get; set; }
	public int Population { get; set; }
	public List<string> Outposts { get; set; } = new();
	public string? Tier { get; set; }
	public bool Guest { get; set; }
	public List<List<int>> Paved { get; set; } = new();
	public List<DistrictLobe> Lobes { get; set; } = new();
	public Dictionary<string, object>? Folders { get; set; }
	public Dictionary<string, object>? Branches { get; set; }
}

/// <summary>One green (village green) a hamlet grew its houses around.</summary>
public sealed class DistrictLobe
{
	/// <summary>Centre cell of the green, [gx, gz].</summary>
	public List<int>? Green { get; set; }
	public double Size { get; set; }
	public List<List<int>> Paved { get; set; } = new();
	/// <summary>RLE parcel of the green's cells.</summary>
	public object? Parcel { get; set; }
}