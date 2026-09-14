using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Promptholm.Data.Models;

public sealed class PolderData
{
	public List<List<int>> Cells { get; set; } = new();
	public List<List<int>> Dike { get; set; } = new();
	/// <summary>Settler count at which this polder was drained.</summary>
	public int At { get; set; }
	/// <summary>When the polder was earned.</summary>
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? UnlockedAt { get; set; }
}

public sealed class MilestoneData
{
	public string? Id { get; set; }
	/// <summary>Settler / apprentice count at which this unlocks.</summary>
	public int At { get; set; }
	public string? On { get; set; }
	public string? Label { get; set; }
	public bool Unlocked { get; set; }
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? UnlockedAt { get; set; }
	public string? Building { get; set; }
}