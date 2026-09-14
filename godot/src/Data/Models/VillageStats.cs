using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Promptholm.Data.Models;

/// <summary>Island-wide numbers scan.mjs puts on the end of village.json.</summary>
public sealed class VillageStats
{
	public int Settlers { get; set; }
	public int Apprentices { get; set; }
	public int Districts { get; set; }
	public int Waiting { get; set; }
	public int ToolCalls { get; set; }
	public int FilesTouched { get; set; }
	public int Sessions { get; set; }
	public double AvgSessionMs { get; set; }
	public double DurationMs { get; set; }
	public int Milestones { get; set; }
	public TokenCounts Tokens { get; set; } = new();
	public int ApiErrors { get; set; }
	public int Publishes { get; set; }
	public int Bricks { get; set; }
	/// <summary>The nearest milestone that hasn't been reached yet, if any.</summary>
	public NextMilestoneData? NextMilestone { get; set; }
}

public sealed class NextMilestoneData
{
	public string? Id { get; set; }
	public int At { get; set; }
	public string? On { get; set; }
	public string? Label { get; set; }
	public int Remaining { get; set; }
}

/// <summary>A dispatch record: one ticket sent to one session. Only the headline fields
/// are typed; scan.mjs slices at 60 but keeps the full record.</summary>
public sealed class AssignmentData
{
	public string? Id { get; set; }
	public string? Source { get; set; }
	public string? IssueKey { get; set; }
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? IssueSummary { get; set; }
	public string? IssueUrl { get; set; }
	public string? SettlerId { get; set; }
	public string? SettlerName { get; set; }
	public bool Newcomer { get; set; }
	public string? District { get; set; }
	public string? Cwd { get; set; }
	public string? Model { get; set; }
	public string? Status { get; set; }
	public string? SessionId { get; set; }
	public double At { get; set; }
	public bool DryRun { get; set; }
}