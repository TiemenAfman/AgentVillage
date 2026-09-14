using System;
using System.Diagnostics;
using Godot;
using Promptholm.Buildings;
using Promptholm.Buildings.Data;
using Promptholm.Buildings.Slots;

namespace Promptholm.Tools;

/// <summary>
/// Headless check that all 6 tiers assemble with valid slot attachments and zero null mesh
/// references through the BuildingCatalog mesh factories.
/// Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyModelSheetRunner.cs
/// </summary>
public partial class VerifyModelSheetRunner : SceneTree
{
    private int _fails;

    public override void _Initialize()
    {
        try
        {
            Run();
        }
        catch (Exception ex)
        {
            GD.PushError($"EXCEPTION during model sheet verification: {ex}");
            Quit(1);
        }
    }

    private void Run()
    {
        var sw = Stopwatch.StartNew();

        GD.Print("=== Model Sheet Verification ===\n");

        var tiers = new[]
        {
            ("tent",   0),
            ("hut",    1),
            ("cottage",2),
            ("house",  3),
            ("manor",  4),
            ("keep",   5),
        };

        var styles = new[] { "opus", "sonnet", "haiku" };

        int totalPieces = 0;

        foreach (var (tierName, tierLevel) in tiers)
        {
            GD.Print($"--- Tier {tierLevel}: {tierName} ---");

            foreach (var style in styles)
            {
                var root = new Node3D { Name = $"Test_{tierName}_{style}" };
                Root.AddChild(root);

                var assembler = new BuildingAssembler { Name = "Assembler" };
                root.AddChild(assembler);

                BuildTestSlots(assembler);
                var catalog = BuildTestCatalog(tierName, style, tierLevel);
                assembler.Catalog = catalog;
                assembler.Assemble(style, tierName, []);

                int occupied = CountOccupied(assembler);
                totalPieces += occupied;

                GD.Print($"  [{style}] {occupied} pieces attached");

                bool nullMesh = HasNullMesh(assembler);
                Check(!nullMesh, $"Tier {tierLevel} '{style}' has no null mesh references");
                Check(occupied >= 5, $"Tier {tierLevel} '{style}' assembled at least 5 pieces (foundation + 4 walls)");

                foreach (var child in root.GetChildren())
                    child.QueueFree();
                root.QueueFree();
            }
        }

        GD.Print($"\nTotal pieces across all tiers: {totalPieces}");
        Check(totalPieces >= 90, $"Total attached pieces ({totalPieces}) >= 90 (6 tiers x 3 styles x 5 min)");

        // Verify all BuildingCatalog factory methods produce valid Node3D trees
        GD.Print("\n--- Catalog Factory Methods ---");
        VerifyFactory("FoundationStone", BuildingCatalog.MakeFoundationStone(2.0f, 2.0f));
        VerifyFactory("WallTimber",      BuildingCatalog.MakeWallTimber(3.0f, 2.0f, 0.12f));
        VerifyFactory("WallStone",       BuildingCatalog.MakeWallStone(3.0f, 2.0f, 0.12f));
        VerifyFactory("RoofGableTiles",  BuildingCatalog.MakeRoofGableTiles(3.0f, 3.0f));
        VerifyFactory("RoofThatch",      BuildingCatalog.MakeRoofThatch(3.0f, 3.0f));
        VerifyFactory("DoorWood",        BuildingCatalog.MakeDoorWood());
        VerifyFactory("WindowFrame",     BuildingCatalog.MakeWindowFrame());
        VerifyFactory("OrnamentForge",   BuildingCatalog.MakeOrnamentForge());
        VerifyFactory("OrnamentWeathervane", BuildingCatalog.MakeOrnamentWeathervane());

        // Verify the packaged .tscn prefab scenes load, instantiate and self-build meshes
        GD.Print("\n--- Prefab Scenes ---");
        string[] prefabScenes =
        [
            "res://prefabs/foundations/foundation_stone.tscn",
            "res://prefabs/walls/wall_timber.tscn",
            "res://prefabs/walls/wall_stone.tscn",
            "res://prefabs/roofs/roof_gable_tiles.tscn",
            "res://prefabs/roofs/roof_thatch.tscn",
            "res://prefabs/openings/door_wood.tscn",
            "res://prefabs/openings/window_frame.tscn",
            "res://prefabs/ornaments/ornament_forge.tscn",
            "res://prefabs/ornaments/ornament_weathervane.tscn",
        ];
        foreach (var path in prefabScenes)
            VerifyPrefabScene(path);

        sw.Stop();
        GD.Print($"\nVerification completed in {sw.ElapsedMilliseconds} ms");

        if (_fails == 0)
        {
            GD.Print("[OK] All tiers assemble successfully with valid meshes");
            Quit(0);
        }
        else
        {
            GD.PushError($"{_fails} check(s) FAILED");
            Quit(1);
        }
    }

    private void VerifyFactory(string name, Node3D node)
    {
        int meshCount = 0;
        bool hasNull = false;
        foreach (var child in node.GetChildren())
        {
            if (child is MeshInstance3D mi)
            {
                meshCount++;
                if (mi.Mesh is null)
                    hasNull = true;
            }
        }
        Check(meshCount > 0, $"{name}: has at least one MeshInstance3D");
        Check(!hasNull, $"{name}: no null mesh references");
        GD.Print($"  {name}: {meshCount} meshes, null={hasNull}");
    }

    private static void EnsureMeshesIfPresent(Node3D node)
    {
        if (node is Promptholm.Buildings.Prefabs.ToolPrefabBase prefab)
            prefab.EnsureMeshes();
    }

    private void VerifyPrefabScene(string path)
    {
        string name = System.IO.Path.GetFileNameWithoutExtension(path);

        var scene = GD.Load<PackedScene>(path);
        Check(scene is not null, $"{name}: scene loads from {path}");
        if (scene is null)
            return;

        var instance = scene.Instantiate<Node3D>();
        Check(instance is not null, $"{name}: instantiates as Node3D");
        if (instance is null)
            return;

        Root.AddChild(instance);
        EnsureMeshesIfPresent(instance);

        int meshCount = 0;
        bool hasNull = false;
        foreach (var child in instance.GetChildren())
        {
            if (child is MeshInstance3D mi)
            {
                meshCount++;
                if (mi.Mesh is null)
                    hasNull = true;
            }
        }
        Check(meshCount > 0, $"{name}: self-built meshes after instantiation");
        Check(!hasNull, $"{name}: no null mesh references");

        instance.QueueFree();
    }

    private static void BuildTestSlots(BuildingAssembler assembler)
    {
        float w = 2.0f, d = 2.0f, h = 2.0f;
        assembler.AddChild(MkSlot("Foundation", SlotType.Foundation, new Vector3(0, 0.12f, 0)));
        assembler.AddChild(MkSlot("WallFront",  SlotType.Wall,      new Vector3(0, h * 0.5f, -d * 0.5f)));
        assembler.AddChild(MkSlot("WallBack",   SlotType.Wall,      new Vector3(0, h * 0.5f, d * 0.5f)));
        assembler.AddChild(MkSlot("WallLeft",   SlotType.Wall,      new Vector3(-w * 0.5f, h * 0.5f, 0)));
        assembler.AddChild(MkSlot("WallRight",  SlotType.Wall,      new Vector3(w * 0.5f, h * 0.5f, 0)));
        assembler.AddChild(MkSlot("Roof",       SlotType.Roof,      new Vector3(0, h, 0)));
        assembler.AddChild(MkSlot("Door",       SlotType.Door,      new Vector3(0, 0.7f, -d * 0.5f)));
        assembler.AddChild(MkSlot("WindowL",    SlotType.Window,    new Vector3(-w * 0.25f, 1.3f, -d * 0.5f)));
        assembler.AddChild(MkSlot("WindowR",    SlotType.Window,    new Vector3(w * 0.25f, 1.3f, -d * 0.5f)));
        assembler.AddChild(MkSlot("Ornament",   SlotType.Ornament,  new Vector3(0, h + 0.35f, 0)));
    }

    private static BuildingSlot3D MkSlot(string name, SlotType type, Vector3 pos)
    {
        return new BuildingSlot3D
        {
            Name = name,
            Type = type,
            ClearanceRadius = 1.0f,
            Position = pos,
        };
    }

    private static BuildingPieceResource[] BuildTestCatalog(string tier, string style, int tierLevel)
    {
        bool isStone = style == "opus";
        bool isThatch = style == "haiku";

        var list = new System.Collections.Generic.List<BuildingPieceResource>
        {
            MkPiece("foundation", SlotType.Foundation, tierLevel, style,
                BuildingCatalog.MakeFoundationStone(2.0f, 2.0f)),
            MkPiece("wall", SlotType.Wall, tierLevel, style,
                isStone ? BuildingCatalog.MakeWallStone(2.0f, 2.0f, 0.12f)
                        : BuildingCatalog.MakeWallTimber(2.0f, 2.0f, 0.12f)),
            MkPiece("roof", SlotType.Roof, tierLevel, style,
                isThatch ? BuildingCatalog.MakeRoofThatch(2.0f, 2.0f)
                         : BuildingCatalog.MakeRoofGableTiles(2.0f, 2.0f)),
            MkPiece("door", SlotType.Door, tierLevel, style,
                BuildingCatalog.MakeDoorWood()),
            MkPiece("window", SlotType.Window, tierLevel, style,
                BuildingCatalog.MakeWindowFrame()),
            MkPiece("forge", SlotType.Ornament, tierLevel, style,
                BuildingCatalog.MakeOrnamentForge()),
            MkPiece("weathervane", SlotType.Ornament, tierLevel, style,
                BuildingCatalog.MakeOrnamentWeathervane()),
        };

        return list.ToArray();
    }

    private static BuildingPieceResource MkPiece(string id, SlotType slot, int tier, string style, Node3D node)
    {
        var scene = new PackedScene();
        scene.Pack(node);
        return new BuildingPieceResource
        {
            PieceId = id,
            PieceScene = scene,
            TargetSlot = slot,
            TierRequirement = tier,
            ModelStyle = style,
        };
    }

    private static int CountOccupied(BuildingAssembler assembler)
    {
        int count = 0;
        foreach (var child in assembler.GetChildren())
        {
            if (child is BuildingSlot3D slot && slot.IsOccupied)
                count++;
        }
        return count;
    }

    private static bool HasNullMesh(BuildingAssembler assembler)
    {
        foreach (var child in assembler.GetChildren())
        {
            if (child is not BuildingSlot3D slot) continue;
            if (slot.AttachedPiece is null) continue;
            foreach (var mc in slot.AttachedPiece.GetChildren())
            {
                if (mc is MeshInstance3D mi && mi.Mesh is null)
                    return true;
            }
        }
        return false;
    }

    private void Check(bool ok, string what)
    {
        if (ok)
            GD.Print($"  [OK] {what}");
        else
        {
            GD.PushError($"  [FAIL] {what}");
            _fails++;
        }
    }
}
