using Godot;
using Promptholm.Buildings.Data;

namespace Promptholm.Buildings.Prefabs;

[Tool]
[GlobalClass]
public partial class PmPrefabRoofThatch : ToolPrefabBase
{
    protected override void RebuildMeshes()
    {
        ClearMeshChildren(this);
        AddMeshesFrom(this, BuildingCatalog.MakeRoofThatch(3.0f, 3.0f));
    }
}
