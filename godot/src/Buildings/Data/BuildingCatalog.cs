using Godot;
using Promptholm.Buildings.Slots;

namespace Promptholm.Buildings.Data;

/// <summary>
/// Central registry of modular building-piece mesh factories.
/// Each static method creates a Node3D tree with proper materials for a given piece type.
/// Used by both WorldManager (procedural sizing) and prefab [Tool] scripts (editor preview).
/// </summary>
public static class BuildingCatalog
{
    /// <summary>Half-width of the visible half-timber beams on <see cref="MakeWallTimber"/>.</summary>
    public const float TimberBeamWidth = 0.05f;

    // ---- Shared materials ----

    private static readonly StandardMaterial3D _plaster = new()
    {
        AlbedoColor = new Color(0.94f, 0.90f, 0.82f),
        Roughness = 0.92f,
    };

    private static readonly StandardMaterial3D _beam = new()
    {
        AlbedoColor = new Color(0.32f, 0.20f, 0.11f),
        Roughness = 0.78f,
    };

    private static readonly StandardMaterial3D _stone = new()
    {
        AlbedoColor = new Color(0.60f, 0.58f, 0.55f),
        Roughness = 0.90f,
    };

    private static readonly StandardMaterial3D _stoneDark = new()
    {
        AlbedoColor = new Color(0.52f, 0.50f, 0.47f),
        Roughness = 0.90f,
    };

    private static readonly StandardMaterial3D _roofTile = new()
    {
        AlbedoColor = new Color(0.74f, 0.32f, 0.18f),
        Roughness = 0.80f,
    };

    private static readonly StandardMaterial3D _thatch = new()
    {
        AlbedoColor = new Color(0.82f, 0.74f, 0.48f),
        Roughness = 0.95f,
    };

    private static readonly StandardMaterial3D _wood = new()
    {
        AlbedoColor = new Color(0.40f, 0.27f, 0.15f),
        Roughness = 0.82f,
    };

    private static readonly StandardMaterial3D _woodLight = new()
    {
        AlbedoColor = new Color(0.52f, 0.38f, 0.22f),
        Roughness = 0.82f,
    };

    private static readonly StandardMaterial3D _iron = new()
    {
        AlbedoColor = new Color(0.18f, 0.18f, 0.20f),
        Roughness = 0.55f,
        Metallic = 0.7f,
    };

    private static readonly StandardMaterial3D _glass = new()
    {
        AlbedoColor = new Color(0.98f, 0.88f, 0.52f, 0.92f),
        Roughness = 0.10f,
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
        EmissionEnabled = true,
        Emission = new Color(0.98f, 0.88f, 0.52f),
        EmissionEnergyMultiplier = 0.35f,
    };

    private static readonly StandardMaterial3D _copper = new()
    {
        AlbedoColor = new Color(0.72f, 0.45f, 0.20f),
        Roughness = 0.45f,
        Metallic = 0.8f,
    };

    private static readonly StandardMaterial3D _smoke = new()
    {
        AlbedoColor = new Color(0.70f, 0.70f, 0.72f, 0.6f),
        Roughness = 1.0f,
        Transparency = BaseMaterial3D.TransparencyEnum.Alpha,
    };

    // ---- Storybook palette (exposed for the headless verifier) ----

    public static Color PlasterColour => _plaster.AlbedoColor;
    public static Color BeamTimberColour => _beam.AlbedoColor;
    public static Color FieldstoneColour => _stone.AlbedoColor;
    public static Color RoofTileColour => _roofTile.AlbedoColor;
    public static Color WindowGlassColour => _glass.AlbedoColor;

    // ---- Foundations ----

    public static Node3D MakeFoundationStone(float w, float d)
    {
        var root = new Node3D();
        var plinth = new BoxMesh
        {
            Size = new Vector3(w + 0.3f, 0.24f, d + 0.3f),
            Material = _stone,
        };
        root.AddChild(new MeshInstance3D { Mesh = plinth });
        var rim = new BoxMesh
        {
            Size = new Vector3(w + 0.36f, 0.06f, d + 0.36f),
            Material = _stoneDark,
        };
        root.AddChild(new MeshInstance3D { Mesh = rim, Position = new Vector3(0, 0.12f, 0) });
        return root;
    }

    // ---- Walls ----

    public static Node3D MakeWallTimber(float w, float h, float depth)
    {
        var root = new Node3D();

        var plaster = new BoxMesh
        {
            Size = new Vector3(w, h, depth),
            Material = _plaster,
        };
        root.AddChild(new MeshInstance3D { Mesh = plaster });

        const float bw = TimberBeamWidth;
        float bFront = -depth * 0.5f - bw * 0.25f;
        float halfH = h * 0.5f;
        float halfW = w * 0.5f;

        void AddBeam(float bx, float by, float bz, float sx, float sy, float sz)
        {
            var bMesh = new BoxMesh { Size = new Vector3(sx, sy, sz), Material = _beam };
            root.AddChild(new MeshInstance3D { Mesh = bMesh, Position = new Vector3(bx, by, bz) });
        }

        AddBeam(0, -halfH + bw * 0.5f, bFront, w, bw, bw);
        AddBeam(0, halfH - bw * 0.5f, bFront, w, bw, bw);
        AddBeam(-halfW + bw * 0.5f, 0, bFront, bw, h, bw);
        AddBeam(halfW - bw * 0.5f, 0, bFront, bw, h, bw);
        AddBeam(0, 0, bFront, bw, h, bw);
        AddBeam(-halfW * 0.5f, 0, bFront, bw * 0.7f, h * 0.7f, bw);
        AddBeam(halfW * 0.5f, 0, bFront, bw * 0.7f, h * 0.7f, bw);

        return root;
    }

    public static Node3D MakeWallStone(float w, float h, float depth)
    {
        var root = new Node3D();
        var block = new BoxMesh
        {
            Size = new Vector3(w, h, depth),
            Material = _stone,
        };
        root.AddChild(new MeshInstance3D { Mesh = block });

        float halfW = w * 0.5f;
        float halfH = h * 0.5f;
        float bFront = -depth * 0.5f - 0.02f;

        void AddBrick(float bx, float by, float sx, float sy)
        {
            var bMesh = new BoxMesh { Size = new Vector3(sx, sy, 0.02f), Material = _stoneDark };
            root.AddChild(new MeshInstance3D { Mesh = bMesh, Position = new Vector3(bx, by, bFront) });
        }

        float brickH = 0.22f;
        int rows = (int)(h / brickH);
        for (int r = 0; r < rows; r++)
        {
            float by = -halfH + brickH * 0.5f + r * brickH;
            bool even = r % 2 == 0;
            float offset = even ? 0f : w * 0.25f;
            for (float bx = -halfW + w * 0.125f + offset; bx < halfW; bx += w * 0.25f)
            {
                float bw2 = (bx < -halfW + 0.05f || bx > halfW - 0.05f)
                    ? w * 0.12f : w * 0.22f;
                AddBrick(bx, by, bw2, brickH * 0.85f);
            }
        }

        return root;
    }

    // ---- Roofs ----

    public static Node3D MakeRoofGableTiles(float w, float d)
    {
        var root = new Node3D();
        float roofW = w + 0.4f;
        float roofD = d + 0.4f;
        float ridge = 0.7f;

        var prism = new PrismMesh
        {
            Size = new Vector3(roofW, ridge, roofD),
            Material = _roofTile,
        };
        root.AddChild(new MeshInstance3D { Mesh = prism, Position = new Vector3(0, ridge * 0.35f, 0) });

        var trim = new BoxMesh
        {
            Size = new Vector3(roofW + 0.08f, 0.05f, roofD + 0.08f),
            Material = _beam,
        };
        root.AddChild(new MeshInstance3D { Mesh = trim, Position = new Vector3(0, -0.02f, 0) });

        var ridgeBeam = new BoxMesh
        {
            Size = new Vector3(0.08f, 0.08f, roofD),
            Material = _beam,
        };
        root.AddChild(new MeshInstance3D { Mesh = ridgeBeam, Position = new Vector3(0, ridge * 0.7f, 0) });

        return root;
    }

    public static Node3D MakeRoofThatch(float w, float d)
    {
        var root = new Node3D();
        float roofW = w + 0.5f;
        float roofD = d + 0.5f;
        float ridge = 0.8f;

        var prism = new PrismMesh
        {
            Size = new Vector3(roofW, ridge, roofD),
            Material = _thatch,
        };
        root.AddChild(new MeshInstance3D { Mesh = prism, Position = new Vector3(0, ridge * 0.3f, 0) });

        var overhang = new BoxMesh
        {
            Size = new Vector3(roofW + 0.15f, 0.10f, roofD + 0.15f),
            Material = _thatch,
        };
        root.AddChild(new MeshInstance3D { Mesh = overhang, Position = new Vector3(0, -0.05f, 0) });

        return root;
    }

    // ---- Doors ----

    public static Node3D MakeDoorWood()
    {
        var root = new Node3D();

        var plank = new BoxMesh
        {
            Size = new Vector3(0.8f, 1.5f, 0.09f),
            Material = _wood,
        };
        root.AddChild(new MeshInstance3D { Mesh = plank });

        void AddBeam(float bx, float by, float sx, float sy)
        {
            var bMesh = new BoxMesh { Size = new Vector3(sx, sy, 0.11f), Material = _beam };
            root.AddChild(new MeshInstance3D { Mesh = bMesh, Position = new Vector3(bx, by, -0.01f) });
        }

        AddBeam(0, 0.60f, 0.84f, 0.07f);
        AddBeam(0, -0.60f, 0.84f, 0.07f);
        AddBeam(-0.36f, 0, 0.07f, 1.5f);
        AddBeam(0.36f, 0, 0.07f, 1.5f);

        var latch = new BoxMesh
        {
            Size = new Vector3(0.04f, 0.12f, 0.04f),
            Material = _iron,
        };
        root.AddChild(new MeshInstance3D { Mesh = latch, Position = new Vector3(0.28f, 0.0f, -0.07f) });

        var hingeTop = new BoxMesh
        {
            Size = new Vector3(0.12f, 0.04f, 0.03f),
            Material = _iron,
        };
        root.AddChild(new MeshInstance3D { Mesh = hingeTop, Position = new Vector3(-0.34f, 0.5f, -0.06f) });
        var hingeBot = new BoxMesh
        {
            Size = new Vector3(0.12f, 0.04f, 0.03f),
            Material = _iron,
        };
        root.AddChild(new MeshInstance3D { Mesh = hingeBot, Position = new Vector3(-0.34f, -0.5f, -0.06f) });

        return root;
    }

    // ---- Windows ----

    public static Node3D MakeWindowFrame()
    {
        var root = new Node3D();

        var glass = new BoxMesh
        {
            Size = new Vector3(0.52f, 0.52f, 0.03f),
            Material = _glass,
        };
        root.AddChild(new MeshInstance3D { Mesh = glass, Position = new Vector3(0, 0, 0.02f) });

        void AddFrame(float bx, float by, float sx, float sy)
        {
            var fMesh = new BoxMesh { Size = new Vector3(sx, sy, 0.06f), Material = _woodLight };
            root.AddChild(new MeshInstance3D { Mesh = fMesh, Position = new Vector3(bx, by, 0) });
        }

        AddFrame(0, 0.29f, 0.60f, 0.06f);
        AddFrame(0, -0.29f, 0.60f, 0.06f);
        AddFrame(-0.28f, 0, 0.06f, 0.60f);
        AddFrame(0.28f, 0, 0.06f, 0.60f);
        AddFrame(0, 0, 0.04f, 0.60f);
        AddFrame(0, 0, 0.60f, 0.04f);

        return root;
    }

    // ---- Ornaments ----

    public static Node3D MakeOrnamentForge()
    {
        var root = new Node3D();

        var chimney = new BoxMesh
        {
            Size = new Vector3(0.35f, 0.60f, 0.35f),
            Material = _stone,
        };
        root.AddChild(new MeshInstance3D { Mesh = chimney, Position = new Vector3(0, 0.30f, 0) });

        var flue = new BoxMesh
        {
            Size = new Vector3(0.20f, 0.25f, 0.20f),
            Material = _stoneDark,
        };
        root.AddChild(new MeshInstance3D { Mesh = flue, Position = new Vector3(0, 0.72f, 0) });

        void AddPuff(float px, float py, float pz, float r)
        {
            var sphere = new SphereMesh
            {
                Radius = r,
                RadialSegments = 6,
                Rings = 3,
                Material = _smoke,
            };
            root.AddChild(new MeshInstance3D { Mesh = sphere, Position = new Vector3(px, py, pz) });
        }

        AddPuff(0.06f, 1.05f, 0.02f, 0.10f);
        AddPuff(-0.05f, 1.20f, -0.03f, 0.08f);
        AddPuff(0.03f, 1.32f, 0.01f, 0.06f);

        return root;
    }

    public static Node3D MakeOrnamentWeathervane()
    {
        var root = new Node3D();

        var pole = new BoxMesh
        {
            Size = new Vector3(0.03f, 0.40f, 0.03f),
            Material = _iron,
        };
        root.AddChild(new MeshInstance3D { Mesh = pole, Position = new Vector3(0, 0.20f, 0) });

        var arrow = new BoxMesh
        {
            Size = new Vector3(0.30f, 0.02f, 0.02f),
            Material = _copper,
        };
        root.AddChild(new MeshInstance3D { Mesh = arrow, Position = new Vector3(0, 0.40f, 0) });

        var tip = new BoxMesh
        {
            Size = new Vector3(0.02f, 0.02f, 0.08f),
            Material = _copper,
        };
        root.AddChild(new MeshInstance3D { Mesh = tip, Position = new Vector3(0.14f, 0.40f, 0) });

        var nesw = new BoxMesh
        {
            Size = new Vector3(0.02f, 0.02f, 0.20f),
            Material = _iron,
        };
        root.AddChild(new MeshInstance3D { Mesh = nesw, Position = new Vector3(0, 0.38f, 0) });

        return root;
    }
}
