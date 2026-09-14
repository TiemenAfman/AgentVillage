using Godot;
using Promptholm.Buildings.Data;

namespace Promptholm.Buildings.Prefabs;

[Tool]
[GlobalClass]
public partial class PmPrefabWallTimber : ToolPrefabBase
{
    protected override void RebuildMeshes()
    {
        ClearMeshChildren(this);
        AddMeshesFrom(this, BuildingCatalog.MakeWallTimber(3.0f, 2.0f, 0.12f));
    }
}
