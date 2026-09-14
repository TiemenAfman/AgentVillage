using Godot;
using Promptholm.Buildings.Data;
using Promptholm.Buildings.Slots;

namespace Promptholm.Buildings;

[GlobalClass]
public partial class BuildingAssembler : Node3D
{
	private static readonly Dictionary<string, int> TierIndex = new(StringComparer.OrdinalIgnoreCase)
	{
		["tent"]   = 0,
		["hut"]    = 1,
		["cottage"]= 2,
		["house"]  = 3,
		["manor"]  = 4,
		["keep"]   = 5,
	};

	[Export]
	public BuildingPieceResource[] Catalog { get; set; } = [];

	private readonly Dictionary<SlotType, List<BuildingSlot3D>> _slotsByType = new();

	public void RefreshSlotInventory()
	{
		_slotsByType.Clear();
		foreach (var child in GetChildren())
		{
			if (child is not BuildingSlot3D slot) continue;
			if (!_slotsByType.TryGetValue(slot.Type, out var list))
			{
				list = [];
				_slotsByType[slot.Type] = list;
			}
			list.Add(slot);
		}
	}

	public void Assemble(string style, string tier, string[] ornaments)
	{
		RefreshSlotInventory();
		ClearPieces();

		int tierLevel = TierIndex.GetValueOrDefault(tier, 3);
		var ornamentSet = ornaments?.Length > 0
			? new HashSet<string>(ornaments, StringComparer.OrdinalIgnoreCase)
			: null;

		foreach (var (slotType, slots) in _slotsByType)
		{
			foreach (var slot in slots)
			{
				var piece = SelectPiece(slot.Type, style, tierLevel, ornamentSet);
				if (piece is null) continue;
				AttachPiece(piece, slot);
			}
		}
	}

	public void ClearPieces()
	{
		foreach (var list in _slotsByType.Values)
			foreach (var slot in list)
				slot.ClearAttached();
	}

	private BuildingPieceResource? SelectPiece(
		SlotType slotType, string style, int tierLevel, HashSet<string>? ornamentSet)
	{
		BuildingPieceResource? fallback = null;

		foreach (var piece in Catalog)
		{
			if (piece is null) continue;
			if (piece.TargetSlot != slotType) continue;
			if (piece.TierRequirement > tierLevel) continue;

			if (!string.IsNullOrWhiteSpace(style)
				&& !string.IsNullOrWhiteSpace(piece.ModelStyle)
				&& !string.Equals(piece.ModelStyle, style, StringComparison.OrdinalIgnoreCase))
				continue;

			if (slotType == SlotType.Ornament)
			{
				if (ornamentSet is not null && ornamentSet.Contains(piece.PieceId))
					return piece;
				continue;
			}

			fallback ??= piece;
		}

		return fallback;
	}

	private void AttachPiece(BuildingPieceResource piece, BuildingSlot3D slot)
	{
		if (piece.MeshOverride is not null)
		{
			var mi = new MeshInstance3D { Mesh = piece.MeshOverride.Duplicate() as Mesh ?? piece.MeshOverride };
			if (piece.MaterialOverride is not null)
				mi.MaterialOverride = piece.MaterialOverride;
			slot.Attach(mi);
			return;
		}
		if (piece.PieceScene is null) return;
		var instance = piece.PieceScene.Instantiate<Node3D>();
		slot.Attach(instance);
	}
}
