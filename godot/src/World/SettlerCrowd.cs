using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Data.Models;
using Promptholm.Walking;

namespace Promptholm.World;

/// <summary>
/// The settlers themselves, pottering about outside their own front doors.
///
/// Until now the island had houses but nobody in them, and an empty village reads as a model
/// rather than a place. One figure per session, each keeping to its own yard: you can stand on a
/// hill and see which hamlets are busy, and walking up to a house means walking up to somebody.
///
/// They are deliberately not <see cref="CharacterBody3D"/>. Thirty-odd characters each running
/// <c>MoveAndSlide</c> against a 1025² heightmap collider is real physics cost for a figure that
/// only ever needs to stand on the ground and amble — so a settler samples the terrain directly,
/// the same call the spawners use, and the only body with physics on this island stays the one
/// the player is driving.
///
/// The wandering is a three-state loop — pause, turn, walk — off a per-settler RNG seeded from the
/// building id. Same island, same paths, every run: an idle crowd that reshuffles on reload looks
/// like a bug even when nothing is wrong.
/// </summary>
[GlobalClass]
public partial class SettlerCrowd : Node3D
{
	/// <summary>
	/// How far from their own door a settler will stray, in metres. A plot is about twelve metres
	/// across, so this keeps them in the garden and out of the neighbour's.
	/// </summary>
	private const float RoamRadius = 5.0f;

	private const float WalkSpeed = 1.15f;
	private const float TurnRate = 4.5f;

	/// <summary>Seconds of standing still between errands, either side of the mean.</summary>
	private const float PauseMin = 1.5f;
	private const float PauseMax = 6.0f;

	/// <summary>
	/// Ceiling on the number of figures. Each settler is about a dozen small meshes, so this is a
	/// draw-call budget rather than a design limit: past a few dozen, a crowd on an island this
	/// size reads the same but costs linearly more.
	/// </summary>
	private const int MaxSettlers = 48;

	private sealed class Wanderer
	{
		public Node3D Node = null!;
		public Vector3 Home;
		public Vector3 Target;
		public float Wait;
		public float AnimTime;
		public float Yaw;
		public PmRng Rng = null!;
	}

	private readonly List<Wanderer> _crowd = new();
	private TerrainField? _terrain;

	/// <summary>Settlers currently on the island. Read by the metrics runner.</summary>
	public int Count => _crowd.Count;

	/// <summary>
	/// Puts one settler outside every house that belongs to a session. Sheds are subagents and
	/// civics belong to the village, so neither gets a body — a crowd milling round the town hall
	/// would say something about the island that is not true.
	/// </summary>
	public void Populate(TerrainField terrain, VillageData village)
	{
		Clear();
		_terrain = terrain;

		foreach (var b in village.Buildings)
		{
			if (_crowd.Count >= MaxSettlers) break;
			if (b.Kind != "house" || b.Plot is null) continue;

			var (cornerX, cornerZ) = terrain.CellCorner(b.Plot.Gx, b.Plot.Gz);
			float hx = (float)cornerX + terrain.Span(b.Plot.W * 0.5);
			float hz = (float)cornerZ + terrain.Span(b.Plot.D * 0.5);

			var rng = new PmRng(PmRng.Hash32(b.Id ?? $"{hx},{hz}"));
			var node = SettlerMeshBuilder.BuildSettler();
			node.Name = $"Settler_{b.Id}";
			AddChild(node);

			var w = new Wanderer
			{
				Node = node,
				Home = new Vector3(hx, 0.0f, hz),
				Rng = rng,
				// Staggered, or the whole island steps off on the same frame.
				Wait = (float)rng.Next() * PauseMax,
				AnimTime = (float)rng.Next() * 10.0f,
				Yaw = (float)rng.Next() * Mathf.Tau,
			};
			w.Target = PickTarget(w);
			// Start somewhere in the yard rather than all on the doorstep.
			var start = PickTarget(w);
			Place(w, start);
			_crowd.Add(w);
		}

		GD.Print($"[SettlerCrowd] {_crowd.Count} settlers walking their own yards");
	}

	public void Clear()
	{
		foreach (var w in _crowd)
		{
			RemoveChild(w.Node);
			w.Node.QueueFree();
		}
		_crowd.Clear();
	}

	public override void _Process(double delta)
	{
		if (_terrain is null || _crowd.Count == 0) return;

		float d = (float)delta;
		foreach (var w in _crowd)
			Step(w, d);
	}

	private void Step(Wanderer w, float d)
	{
		var pos = w.Node.Position;
		var flat = new Vector2(w.Target.X - pos.X, w.Target.Z - pos.Z);
		float dist = flat.Length();

		if (w.Wait > 0.0f)
		{
			w.Wait -= d;
			// Standing still: the pose eases back to neutral rather than freezing mid-stride.
			w.AnimTime += d;
			SettlerMeshBuilder.PoseWalk(w.Node, w.AnimTime, 0.0f);
			return;
		}

		if (dist < 0.25f)
		{
			w.Wait = Mathf.Lerp(PauseMin, PauseMax, (float)w.Rng.Next());
			w.Target = PickTarget(w);
			return;
		}

		var dir = flat / dist;
		float step = MathF.Min(WalkSpeed * d, dist);
		Place(w, new Vector3(pos.X + dir.X * step, 0.0f, pos.Z + dir.Y * step));

		// Face where they are going. Atan2(-x, -z) matches PlayerAvatar, so the crowd and the
		// figure the player drives are the same way round.
		float want = Mathf.Atan2(-dir.X, -dir.Y);
		w.Yaw = Mathf.LerpAngle(w.Yaw, want, 1.0f - Mathf.Exp(-TurnRate * d));
		w.Node.Rotation = new Vector3(0.0f, w.Yaw, 0.0f);

		w.AnimTime += d;
		SettlerMeshBuilder.PoseWalk(w.Node, w.AnimTime, 1.0f);
	}

	/// <summary>Drops a settler onto the ground at a world XZ. The mesh has its feet at y = 0.</summary>
	private void Place(Wanderer w, Vector3 at)
	{
		float y = (float)_terrain!.WorldHeight(at.X, at.Z);
		w.Node.Position = new Vector3(at.X, y, at.Z);
	}

	/// <summary>
	/// Somewhere else in the yard. Rejects anything that ended up below the waterline: the plots on
	/// the shore reach into the surf, and a settler treading water outside his own front door is
	/// the sort of detail that undoes the whole scene.
	/// </summary>
	private Vector3 PickTarget(Wanderer w)
	{
		for (int attempt = 0; attempt < 6; attempt++)
		{
			float a = (float)w.Rng.Next() * Mathf.Tau;
			// Square-rooted, or every target clusters in the middle of the circle.
			float r = MathF.Sqrt((float)w.Rng.Next()) * RoamRadius;
			float x = w.Home.X + MathF.Cos(a) * r;
			float z = w.Home.Z + MathF.Sin(a) * r;
			if (_terrain is null || _terrain.WorldHeight(x, z) > 0.35)
				return new Vector3(x, 0.0f, z);
		}
		return w.Home;
	}
}
