using System;
using Godot;
using Promptholm.Data.Models;

namespace Promptholm.Core;

/// <summary>
/// Application-wide event hub. Register as an autoload in project.godot so scenes find it
/// as EventBus.Instance. The Godot signals (TerrainGenerated, BuildingSelected) surface
/// as strongly typed C# events too, since the source generator turns each [Signal] into
/// one; VillageDataLoaded is a plain C# event because VillageData is not a Variant.
/// Everything a background task publishes is marshalled to the main thread by the sender.
/// </summary>
[GlobalClass]
public partial class EventBus : Node
{
	public static EventBus Instance { get; private set; } = null!;

	/// <summary>An error-free village.json arrived (body parsed on the main thread).</summary>
	public event Action<VillageData>? VillageDataLoaded;

	[Signal]
	public delegate void TerrainGeneratedEventHandler(string terrainHash);

	[Signal]
	public delegate void BuildingSelectedEventHandler(string buildingId);

	public override void _EnterTree()
	{
		Instance = this;
	}

	public override void _ExitTree()
	{
		if (Instance == this)
			Instance = null!;
	}

	public void PublishVillageData(VillageData data)
		=> VillageDataLoaded?.Invoke(data);

	public void PublishTerrainGenerated(string terrainHash)
		=> EmitSignal(SignalName.TerrainGenerated, terrainHash);

	public void PublishBuildingSelected(string buildingId)
		=> EmitSignal(SignalName.BuildingSelected, buildingId);
}