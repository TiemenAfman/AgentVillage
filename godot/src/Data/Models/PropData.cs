using System.Collections.Generic;

namespace Promptholm.Data.Models;

/// <summary>
/// One thing placed on the island on purpose (tree, bench, bridge, panel). Lives in
/// data/props.json, served by the server at /api/props; the scanner never touches it.
/// </summary>
public sealed class PropsApiData
{
	public int V { get; set; }
	public string? SavedAt { get; set; }
	public List<PropData> Props { get; set; } = new();
}

public sealed class PropData
{
	public string? Id { get; set; }
	public string? Kind { get; set; }
	public double X { get; set; }
	public double Z { get; set; }
	public double Rot { get; set; }
	public double Scale { get; set; } = 1;
	public double Length { get; set; }
	public string? Label { get; set; }
	public string? Face { get; set; }
	public string? Note { get; set; }
	public string? By { get; set; }
	public string? At { get; set; }
	public bool Unknown { get; set; }
}