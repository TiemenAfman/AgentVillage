using Godot;

namespace Promptholm.Buildings.Slots;

public interface IBuildingPiece
{
    string PieceId { get; }
    SlotType TargetSlot { get; }
    Vector3 ClearanceSize { get; }
}
