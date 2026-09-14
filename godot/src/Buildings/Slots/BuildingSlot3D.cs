using Godot;

namespace Promptholm.Buildings.Slots;

[GlobalClass]
public partial class BuildingSlot3D : Marker3D
{
    [Export]
    public SlotType Type { get; set; }

    [Export(PropertyHint.Range, "0.1,4.0,0.1")]
    public float ClearanceRadius { get; set; } = 1.0f;

    public Node3D? AttachedPiece { get; private set; }
    public bool IsOccupied => AttachedPiece is not null;

    public bool CanAttach(IBuildingPiece? piece)
    {
        return piece is not null
            && !IsOccupied
            && piece.TargetSlot == Type;
    }

    public bool Attach(Node3D pieceInstance)
    {
        if (pieceInstance is null) return false;
        if (IsOccupied) ClearAttached();

        AddChild(pieceInstance);
        pieceInstance.Position = Vector3.Zero;
        pieceInstance.Rotation = Vector3.Zero;
        pieceInstance.Scale = Vector3.One;
        AttachedPiece = pieceInstance;
        return true;
    }

    public void ClearAttached()
    {
        if (AttachedPiece is null) return;
        AttachedPiece.QueueFree();
        AttachedPiece = null;
    }

    public override void _Ready()
    {
        if (!Engine.IsEditorHint()) return;
        BuildEditorGizmo();
    }

    private void BuildEditorGizmo()
    {
        var mesh = new ImmediateMesh();
        mesh.SurfaceBegin(Mesh.PrimitiveType.Lines);

        var h = ClearanceRadius * 0.5f;
        var corners = new Vector3[]
        {
            new(-h, -h, -h), new( h, -h, -h),
            new( h,  h, -h), new(-h,  h, -h),
            new(-h, -h,  h), new( h, -h,  h),
            new( h,  h,  h), new(-h,  h,  h),
        };

        int[] edges = [
            0,1, 1,2, 2,3, 3,0,
            4,5, 5,6, 6,7, 7,4,
            0,4, 1,5, 2,6, 3,7,
        ];

        mesh.SurfaceSetNormal(Vector3.Forward);
        for (int i = 0; i < edges.Length; i += 2)
        {
            mesh.SurfaceAddVertex(corners[edges[i]]);
            mesh.SurfaceAddVertex(corners[edges[i + 1]]);
        }

        mesh.SurfaceEnd();

        var gizmo = new MeshInstance3D { Mesh = mesh, Name = "SlotGizmo" };
        var mat = new StandardMaterial3D();
        mat.ShadingMode = BaseMaterial3D.ShadingModeEnum.Unshaded;
        mat.VertexColorUseAsAlbedo = true;
        mat.AlbedoColor = Type switch
        {
            SlotType.Foundation => new Color(0.2f, 0.8f, 0.2f, 0.7f),
            SlotType.Wall       => new Color(0.8f, 0.6f, 0.1f, 0.7f),
            SlotType.Roof       => new Color(0.6f, 0.2f, 0.2f, 0.7f),
            SlotType.Door       => new Color(0.3f, 0.3f, 0.9f, 0.7f),
            SlotType.Window     => new Color(0.2f, 0.8f, 0.9f, 0.7f),
            SlotType.Ornament   => new Color(0.9f, 0.3f, 0.8f, 0.7f),
            SlotType.Sign       => new Color(0.9f, 0.9f, 0.2f, 0.7f),
            _                   => new Color(1f, 1f, 1f, 0.5f),
        };
        gizmo.MaterialOverride = mat;
        AddChild(gizmo);
    }
}
