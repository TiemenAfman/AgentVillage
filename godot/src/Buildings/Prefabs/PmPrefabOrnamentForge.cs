using Godot;
using Promptholm.Buildings.Data;

namespace Promptholm.Buildings.Prefabs;

[Tool]
[GlobalClass]
public partial class PmPrefabOrnamentForge : ToolPrefabBase
{
    protected override void RebuildMeshes()
    {
        ClearMeshChildren(this);
        AddMeshesFrom(this, BuildingCatalog.MakeOrnamentForge());
    }
}
