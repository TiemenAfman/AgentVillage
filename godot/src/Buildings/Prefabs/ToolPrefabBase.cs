using Godot;

namespace Promptholm.Buildings.Prefabs;

/// <summary>
/// Base class for [Tool] prefab scripts. Rebuilds procedural mesh children in the editor
/// so each prefab is visible without pressing F5.
/// </summary>
[GlobalClass]
public partial class ToolPrefabBase : Node3D
{
    public override void _Ready()
    {
        RebuildMeshes();
    }

    /// <summary>Explicit rebuild entry so headless runners can assemble prefab meshes on demand.</summary>
    public void EnsureMeshes() => RebuildMeshes();

    public override void _Process(double delta)
    {
        if (!Engine.IsEditorHint()) return;
        RebuildMeshes();
        SetProcess(false);
    }

    protected virtual void RebuildMeshes() { }

    protected static void ClearMeshChildren(Node3D root)
    {
        foreach (var child in root.GetChildren())
        {
            if (child is MeshInstance3D mi)
            {
                root.RemoveChild(mi);
                mi.QueueFree();
            }
        }
    }

    protected static void AddMeshesFrom(Node3D root, Node3D source)
    {
        foreach (var child in source.GetChildren())
        {
            if (child is MeshInstance3D mi)
            {
                source.RemoveChild(mi);
                root.AddChild(mi);
                if (Engine.IsEditorHint())
                    mi.Owner = root;
            }
        }
        source.Free();
    }
}
