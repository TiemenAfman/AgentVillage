using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Promptholm.Data.Models;

/// <summary>
/// One building on the island: a settler's house, a shed (subagent) or a civic building.
/// Field shapes follow scan.mjs buildVillage — note the polymorphic things: district is
/// an id-string on civics and an object on houses, and waiting/commission are null unless
/// a session is actually stuck on a person.
/// </summary>
public sealed class BuildingData
{
	public string Id { get; set; } = "";
	public string? SessionId { get; set; }
	public string Kind { get; set; } = "house";
	/// <summary>String id (civics) or DistrictData object (houses) — read via the raw value.</summary>
	public object? District { get; set; }
	public string? Name { get; set; }
	public string? Title { get; set; }
	public string? Label { get; set; }
	public string? Cwd { get; set; }
	public string? Source { get; set; }
	public string? Entrypoint { get; set; }
	public string? GitBranch { get; set; }
	/// <summary>The outpost this building belongs to: a string id on some setups, an object on others.</summary>
	public object? Outpost { get; set; }
	public string? Style { get; set; }
	public string? Model { get; set; }
	/// <summary>Model usage counts, e.g. { "claude-sonnet-4-5": 3 }.</summary>
	public Dictionary<string, object> Models { get; set; } = new();
	public string? Tier { get; set; }
	public List<object> Ornaments { get; set; } = new();
	public bool Harbour { get; set; }
	public bool Visitor { get; set; }
	public bool Founder { get; set; }
	public bool Active { get; set; }
	public bool Archived { get; set; }
	public object? Waiting { get; set; }
	public string? Repo { get; set; }
	public string? RepoUrl { get; set; }
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? StartedAt { get; set; }
	[JsonConverter(typeof(FlexibleStringConverter))]
	public string? LastAt { get; set; }
	public PlotData Plot { get; set; } = new();
	/// <summary>World-space door spot [x, z], or null while the building has no door.</summary>
	public List<double>? Door { get; set; }
	public List<string> Sheds { get; set; } = new();
	public List<object> WorkOrders { get; set; } = new();
	public SkillsData Skills { get; set; } = new();
	public CommissionData? Commission { get; set; }
	public BuildingStats Stats { get; set; } = new();
}

public sealed class PlotData
{
	public int Gx { get; set; }
	public int Gz { get; set; }
	public int W { get; set; } = 1;
	public int D { get; set; } = 1;
	public double Rot { get; set; }
}

public sealed class SkillsData
{
	public bool Jira { get; set; }
	public bool Issue { get; set; }
}

/// <summary>Jira ticket this session is working for the sprint board.</summary>
public sealed class CommissionData
{
	public string? IssueKey { get; set; }
	public string? Summary { get; set; }
	public string? From { get; set; }
	public string? Url { get; set; }
}

public sealed class BuildingStats
{
	public int HumanTurns { get; set; }
	public int AssistantMsgs { get; set; }
	public int ToolCalls { get; set; }
	public int FilesTouched { get; set; }
	public TokenCounts Tokens { get; set; } = new();
	public int ApiErrors { get; set; }
	public int Publishes { get; set; }
	public double DurationMs { get; set; }
}

public sealed class TokenCounts
{
	public double Input { get; set; }
	public double Output { get; set; }
	public double CacheRead { get; set; }
	public double CacheCreation { get; set; }
}