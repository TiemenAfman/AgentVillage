using Godot;
using Promptholm.Buildings.Data;

namespace Promptholm.Buildings.Prefabs;

[Tool]
[GlobalClass]
public partial class PmPrefabDoorWood : ToolPrefabBase
{
    protected override void RebuildMeshes()
    {
        ClearMeshChildren(this);
        AddMeshesFrom(this, BuildingCatalog.MakeDoorWood());
    }
}
