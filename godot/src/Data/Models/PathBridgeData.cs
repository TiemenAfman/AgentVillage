using System.Collections.Generic;

namespace Promptholm.Data.Models;

/// <summary>Footpath the land register drew between plots; cells to draw.</summary>
public sealed class PathData
{
	public string Id { get; set; } = "";
	public List<List<int>> Cells { get; set; } = new();
}

/// <summary>Bridge deck over a river; cells along axis.</summary>
public sealed class BridgeData
{
	public string Id { get; set; } = "";
	/// <summary>"x" or "z": which way the deck runs.</summary>
	public string? Axis { get; set; }
	public List<List<int>> Cells { get; set; } = new();
}