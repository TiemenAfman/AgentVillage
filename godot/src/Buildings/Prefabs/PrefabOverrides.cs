using System;
using System.Collections.Generic;
using Godot;

namespace Promptholm.Buildings.Prefabs;

/// <summary>
/// The escape hatch from procedural geometry: a hand-made scene beats the code.
///
/// The rule, in one sentence. A <c>.tscn</c> anywhere under <c>res://prefabs</c> whose file name
/// matches a piece id, and which carries real geometry of its own, takes that piece's slot over
/// completely. Anything else — and that includes every prefab in the tree today — is ignored and
/// the procedural piece is built exactly as before.
///
/// "Real geometry of its own" is the whole trick, and it needs no flag and no registry to
/// declare. The nine prefabs shipped so far are hollow: an empty Node3D with a <c>[Tool]</c>
/// script that builds its meshes in <c>_Ready</c>. Instantiating a PackedScene does not put it in
/// the tree, so <c>_Ready</c> does not run, so a hollow prefab probes as having no MeshInstance3D
/// at all. A prefab somebody actually modelled has its meshes saved in the scene file and probes
/// as having them. The discriminator is therefore exactly the question we wanted to ask: did a
/// person put geometry in this file?
///
/// Whole slots only. This never merges with the procedural piece and never adds to it — a half
/// override is how a house ends up wearing two roofs, one authored and one generated, and from
/// most angles you would not notice until the shadows disagreed.
/// </summary>
public static class PrefabOverrides
{
	private const string Root = "res://prefabs";

	/// <summary>Piece id → the scene that claims it. Built once; scanning is a directory walk.</summary>
	private static Dictionary<string, PackedScene>? _byPieceId;

	/// <summary>How many prefabs currently win a slot. Zero is the normal, healthy answer.</summary>
	public static int Count => Index().Count;

	/// <summary>
	/// A fresh instance of the prefab that owns <paramref name="pieceId"/>, or null when no
	/// hand-made scene claims it. Callers attach the result to the slot and skip building.
	/// </summary>
	public static Node3D? TryInstantiate(string? pieceId)
	{
		if (string.IsNullOrWhiteSpace(pieceId))
			return null;
		return Index().TryGetValue(pieceId, out var scene)
			? scene.Instantiate<Node3D>()
			: null;
	}

	/// <summary>Drops the cache, so a prefab saved in the editor is picked up on the next build.</summary>
	public static void Invalidate() => _byPieceId = null;

	private static Dictionary<string, PackedScene> Index()
	{
		if (_byPieceId is not null)
			return _byPieceId;

		var found = new Dictionary<string, PackedScene>(StringComparer.OrdinalIgnoreCase);
		Scan(Root, found);
		if (found.Count > 0)
			GD.Print($"[PrefabOverrides] {found.Count} hand-made prefab(s) claim a slot: {string.Join(", ", found.Keys)}");
		_byPieceId = found;
		return found;
	}

	private static void Scan(string dir, Dictionary<string, PackedScene> into)
	{
		using var handle = DirAccess.Open(dir);
		if (handle is null)
			return;

		foreach (var sub in handle.GetDirectories())
			Scan($"{dir}/{sub}", into);

		foreach (var file in handle.GetFiles())
		{
			// In an exported build a .tscn ships as .scn and the loader is reached through a
			// .remap; strip that first or nothing is ever found outside the editor.
			var name = file.EndsWith(".remap", StringComparison.OrdinalIgnoreCase)
				? file[..^".remap".Length]
				: file;
			if (!name.EndsWith(".tscn", StringComparison.OrdinalIgnoreCase)
				&& !name.EndsWith(".scn", StringComparison.OrdinalIgnoreCase))
			{
				continue;
			}

			var path = $"{dir}/{name}";
			var scene = ResourceLoader.Load<PackedScene>(path);
			if (scene is null || !HasAuthoredGeometry(scene))
				continue;

			var pieceId = name[..name.LastIndexOf('.')];
			into[pieceId] = scene;
		}
	}

	/// <summary>
	/// True when the saved scene already contains a mesh. Probed on a throwaway instance that is
	/// never added to the tree, which is what keeps the <c>[Tool]</c> scripts from building their
	/// geometry and reporting a false positive for every hollow prefab in the folder.
	/// </summary>
	private static bool HasAuthoredGeometry(PackedScene scene)
	{
		var probe = scene.Instantiate<Node3D>();
		if (probe is null)
			return false;
		try
		{
			return AnyMesh(probe);
		}
		finally
		{
			probe.Free();
		}
	}

	private static bool AnyMesh(Node node)
	{
		if (node is MeshInstance3D mi && mi.Mesh is not null && mi.Mesh.GetSurfaceCount() > 0)
			return true;
		foreach (var child in node.GetChildren())
		{
			if (AnyMesh(child))
				return true;
		}
		return false;
	}
}
