using Godot;

namespace Promptholm.Buildings.Data;

[GlobalClass]
public partial class BuildingPieceResource : Resource
{
	[Export(PropertyHint.PlaceholderText, "e.g. house_t2_2")]
	public string PieceId { get; set; } = string.Empty;

	[Export]
	public PackedScene? PieceScene { get; set; }

	[Export]
	public Mesh? MeshOverride { get; set; }

	[Export]
	public Material? MaterialOverride { get; set; }

	/// <summary>
	/// Runtime Node3D tree (mesh instances) created by BuildingCatalog. Transient, not
	/// serialized: PackedScene.Pack() drops children of off-tree nodes, so the assembler
	/// duplicates this template directly instead of going through a scene file.
	/// </summary>
	public Node3D? MeshNode { get; set; }

	[Export]
	public Slots.SlotType TargetSlot { get; set; }

	[Export(PropertyHint.Range, "0,5,1")]
	public int TierRequirement { get; set; }

	[Export(PropertyHint.PlaceholderText, "opus, sonnet, haiku")]
	public string ModelStyle { get; set; } = string.Empty;
}
