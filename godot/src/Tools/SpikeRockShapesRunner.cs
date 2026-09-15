using Godot;
using Promptholm.World;

namespace Promptholm.Tools;

/// <summary>
/// A row of rocks against a plain backdrop, so a silhouette can be judged before it goes into a
/// spawner. Risk 3 of the foliage plan: procedural stone reads as potatoes if the facets are
/// wrong, and that is taste work which fails visibly - so it fails here, in two seconds, rather
/// than after a thousand of them are scattered over an island.
///
///   Godot..._console.exe --path &lt;godot&gt; --script res://src/Tools/SpikeRockShapesRunner.cs
///                        -- --out shapes.png
/// </summary>
public partial class SpikeRockShapesRunner : SceneTree
{
	private int _ticks;
	private string _out = "";

	public override bool _Process(double delta)
	{
		_ticks++;
		if (_ticks == 1)
		{
			var args = OS.GetCmdlineUserArgs();
			for (int i = 0; i < args.Length; i++)
				if (args[i] == "--out" && i + 1 < args.Length) _out = args[i + 1];
			Build();
			return false;
		}
		if (_ticks < 4) return false;

		if (_out.Length > 0)
		{
			var image = Root.GetViewport().GetTexture().GetImage();
			GD.Print(image.SavePng(_out) == Error.Ok ? $"[shapes] wrote {_out}" : "[shapes] could not write");
		}
		Quit(0);
		return true;
	}

	private void Build()
	{
		var root = new Node3D();
		Root.AddChild(root);

		// Three rows, six seeds each, so "do they all look the same" and "are the three kinds
		// actually different" are both answered by one picture.
		for (int i = 0; i < 6; i++)
		{
			root.AddChild(new MeshInstance3D
			{
				Mesh = RockMesh.Massif((uint)(i * 5 + 11)),
				Position = new Vector3(i * 3.4f - 8.5f, 0.2f, -4.6f),
			});
			root.AddChild(new MeshInstance3D
			{
				Mesh = RockMesh.Slab((uint)(i * 7 + 1)),
				Position = new Vector3(i * 3.4f - 8.5f, 0.0f, 0.0f),
			});
			root.AddChild(new MeshInstance3D
			{
				Mesh = RockMesh.Boulder((uint)(i * 13 + 3)),
				Position = new Vector3(i * 3.4f - 8.5f, 0.0f, 4.2f),
			});
		}

		var ground = new MeshInstance3D { Mesh = new PlaneMesh { Size = new Vector2(60, 60) }, Position = new Vector3(0, -0.85f, 0) };
		ground.Mesh.SurfaceSetMaterial(0, Promptholm.Visual.Palette.Solid(new Color(0.55f, 0.62f, 0.38f), 0.95f));
		root.AddChild(ground);

		var camera = new Camera3D
		{
			Fov = 42.0f,
			Transform = new Transform3D(Basis.Identity, new Vector3(0.0f, 8.5f, 18.0f)).LookingAt(new Vector3(0, 0, 0), Vector3.Up),
		};
		Root.AddChild(camera);
		camera.MakeCurrent();

		Root.AddChild(new DirectionalLight3D
		{
			LightEnergy = 1.15f,
			ShadowEnabled = true,
			Rotation = new Vector3(-0.72f, -0.85f, 0.0f),
		});
		Root.AddChild(new WorldEnvironment
		{
			Environment = new Godot.Environment
			{
				BackgroundMode = Godot.Environment.BGMode.Sky,
				Sky = new Sky { SkyMaterial = new ProceduralSkyMaterial() },
				AmbientLightSource = Godot.Environment.AmbientSource.Sky,
				AmbientLightEnergy = 0.65f,
			},
		});
	}
}
