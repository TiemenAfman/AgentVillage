using Godot;
using Promptholm.Buildings.Data;
using Promptholm.Buildings.Slots;
using Promptholm.Atmosphere;

namespace Promptholm.Buildings.Prefabs;

/// <summary>
/// [Tool] showroom scene that spawns a gallery of all tier/style building pieces
/// on pedestals with labels and showcase lighting. Opens directly in the editor viewport.
/// </summary>
[Tool]
[GlobalClass]
public partial class ModelSheetShowroom : Node3D
{
    private bool _built;

    private static readonly StandardMaterial3D _pedestalMat = new()
    {
        AlbedoColor = new Color(0.85f, 0.82f, 0.76f),
        Roughness = 0.9f,
    };

    private static readonly StandardMaterial3D _labelMat = new()
    {
        AlbedoColor = new Color(0.15f, 0.13f, 0.12f),
        Roughness = 1.0f,
        NoDepthTest = true,
    };

    private static readonly (string Name, int Tier, float X, string[] Styles)[] Tiers =
    [
        ("Tent",   0, -12.0f, ["opus", "sonnet", "haiku"]),
        ("Hut",    1,  -7.0f, ["opus", "sonnet", "haiku"]),
        ("Cottage",2,  -2.0f, ["opus", "sonnet", "haiku"]),
        ("House",  3,   3.0f, ["opus", "sonnet", "haiku"]),
        ("Manor",  4,   8.0f, ["opus", "sonnet", "haiku"]),
        ("Keep",   5,  13.0f, ["opus", "sonnet", "haiku"]),
    ];

    private static readonly (SlotType Slot, string PieceId, string Style, int Tier, float OffsetX, float OffsetY)[] Pieces =
    [
        (SlotType.Foundation, "foundation",  "opus",   0, 0.0f,  0.0f),
        (SlotType.Wall,       "wall",        "opus",   0, 0.0f,  1.5f),
        (SlotType.Roof,       "roof",        "opus",   0, 0.0f,  2.8f),
        (SlotType.Door,       "door",        "opus",   0, 0.0f,  1.5f),
        (SlotType.Window,     "window",      "opus",   0, 0.6f,  1.8f),

        (SlotType.Foundation, "foundation",  "sonnet", 0, 1.8f,  0.0f),
        (SlotType.Wall,       "wall",        "sonnet", 0, 1.8f,  1.5f),
        (SlotType.Roof,       "roof",        "sonnet", 0, 1.8f,  2.8f),

        (SlotType.Foundation, "foundation",  "haiku",  0, 3.6f,  0.0f),
        (SlotType.Wall,       "wall",        "haiku",  0, 3.6f,  1.5f),
        (SlotType.Roof,       "roof",        "haiku",  0, 3.6f,  2.8f),

        (SlotType.Ornament,   "forge",       "",       3, 5.4f,  3.2f),
        (SlotType.Ornament,   "weathervane", "",       3, 6.3f,  3.4f),
    ];

    public override void _Ready()
    {
        if (!Engine.IsEditorHint()) return;
        if (_built) return;
        _built = true;
        BuildGallery();
    }

    public override void _Process(double delta)
    {
        if (!Engine.IsEditorHint()) return;
        if (!_built)
        {
            _built = true;
            BuildGallery();
        }
        SetProcess(false);
    }

    private void BuildGallery()
    {
        foreach (var tier in Tiers)
        {
            float tierX = tier.X;

            var label = MkLabel($"Tier {tier.Tier}: {tier.Name}");
            label.Position = new Vector3(tierX, 4.2f, 0);
            AddChild(label);

            var pedestal = new MeshInstance3D
            {
                Name = $"Pedestal_{tier.Name}",
                Mesh = new BoxMesh { Size = new Vector3(6.0f, 0.3f, 3.0f), Material = _pedestalMat },
                Position = new Vector3(tierX, -0.15f, 0),
            };
            AddChild(pedestal);

            foreach (var style in tier.Styles)
            {
                float offsetX = style switch
                {
                    "opus"   => -1.2f,
                    "sonnet" =>  0.0f,
                    "haiku"  =>  1.2f,
                    _        =>  0.0f,
                };

                var styleLabel = MkLabel(char.ToUpper(style[0]) + style[1..]);
                styleLabel.Position = new Vector3(tierX + offsetX, 3.8f, 0);
                AddChild(styleLabel);

                foreach (var piece in Pieces)
                {
                    if (piece.Style != style || piece.Tier != tier.Tier) continue;

                    Node3D node = piece.Slot switch
                    {
                        SlotType.Foundation => BuildingCatalog.MakeFoundationStone(2.0f, 2.0f),
                        SlotType.Wall       => style == "opus"
                            ? BuildingCatalog.MakeWallStone(1.8f, 2.0f, 0.12f)
                            : BuildingCatalog.MakeWallTimber(1.8f, 2.0f, 0.12f),
                        SlotType.Roof       => style == "haiku"
                            ? BuildingCatalog.MakeRoofThatch(2.0f, 2.0f)
                            : BuildingCatalog.MakeRoofGableTiles(2.0f, 2.0f),
                        SlotType.Door       => BuildingCatalog.MakeDoorWood(),
                        SlotType.Window     => BuildingCatalog.MakeWindowFrame(),
                        SlotType.Ornament   => piece.PieceId == "forge"
                            ? BuildingCatalog.MakeOrnamentForge()
                            : BuildingCatalog.MakeOrnamentWeathervane(),
                        _ => new Node3D(),
                    };

                    node.Position = new Vector3(
                        tierX + offsetX + piece.OffsetX,
                        piece.OffsetY,
                        0);
                    node.Name = $"{piece.Slot}_{piece.PieceId}";
                    AddChild(node);
                }
            }
        }

        AddShowcaseLighting();
        AddOrbitalCamera();

        GD.Print("[ModelSheetShowroom] Gallery built — 6 tiers x 3 styles + ornaments.");
    }

    private void AddShowcaseLighting()
    {
        var key = new DirectionalLight3D
        {
            Name = "KeyLight",
            LightColor = new Color(1.0f, 0.96f, 0.88f),
            LightEnergy = 1.2f,
            ShadowEnabled = true,
            Rotation = new Vector3(Mathf.DegToRad(-35.0f), Mathf.DegToRad(30.0f), 0),
        };
        AddChild(key);

        var fill = new DirectionalLight3D
        {
            Name = "FillLight",
            LightColor = new Color(0.70f, 0.78f, 0.92f),
            LightEnergy = 0.4f,
            ShadowEnabled = false,
            Rotation = new Vector3(Mathf.DegToRad(-20.0f), Mathf.DegToRad(210.0f), 0),
        };
        AddChild(fill);

        var rim = new DirectionalLight3D
        {
            Name = "RimLight",
            LightColor = new Color(0.95f, 0.92f, 1.0f),
            LightEnergy = 0.3f,
            ShadowEnabled = false,
            Rotation = new Vector3(Mathf.DegToRad(-10.0f), Mathf.DegToRad(160.0f), 0),
        };
        AddChild(rim);

        var env = new WorldEnvironment
        {
            Environment = EnvironmentFactory.CreateShowroom(),
        };
        env.Name = "WorldEnvironment";
        AddChild(env);
    }

    private void AddOrbitalCamera()
    {
        var camera = new Camera3D
        {
            Name = "ShowroomCamera",
            Position = new Vector3(0.5f, 3.5f, 10.0f),
            Rotation = new Vector3(Mathf.DegToRad(-12.0f), 0, 0),
            Current = true,
        };
        AddChild(camera);
    }

    private static Label3D MkLabel(string text)
    {
        return new Label3D
        {
            Text = text,
            FontSize = 28,
            OutlineSize = 8,
            MaterialOverride = _labelModulation,
            Billboard = BaseMaterial3D.BillboardModeEnum.Enabled,
            NoDepthTest = true,
            FixedSize = true,
            PixelSize = 0.004f,
        };
    }

    private static readonly StandardMaterial3D _labelModulation = new()
    {
        AlbedoColor = new Color(0.12f, 0.11f, 0.10f),
        Roughness = 1.0f,
        NoDepthTest = true,
    };
}
