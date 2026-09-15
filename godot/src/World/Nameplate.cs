using System;
using Godot;
using Promptholm.Visual;

namespace Promptholm.World;

/// <summary>
/// The little sign staked in a settler's front yard, carrying the session's own name.
///
/// This is what makes the island readable as a place where work happens rather than a village of
/// anonymous boxes: every house is one Claude session, and the board in front of it says which.
/// Ported from the V1 browser island (<c>web/js/nameplate.js</c>), which established the look —
/// cream field, dark routed border, and a band of the district's own hue across the top so two
/// neighbouring hamlets are told apart at a glance.
///
/// Text is a <see cref="Label3D"/> rather than a painted canvas texture. The browser version had
/// to draw into a canvas because merged vertex-colour geometry cannot carry glyphs; here the
/// engine has a text node that renders crisply at any distance and costs one draw call, and
/// <c>DistrictDecorator</c>'s archway plaques already use it, so this stays in the same idiom.
/// </summary>
public static class Nameplate
{
	/// <summary>Board width in metres. Two lines of a settler name fit comfortably.</summary>
	private const float BoardW = 1.05f;

	private const float BoardH = 0.42f;
	private const float BoardThick = 0.05f;

	/// <summary>Height of the board's underside above the ground.</summary>
	private const float BoardBase = 0.52f;

	private const float PostR = 0.045f;

	private static readonly Color Cream = new(0.94f, 0.90f, 0.81f);
	private static readonly Color Ink = new(0.22f, 0.17f, 0.11f);

	/// <summary>
	/// Builds the sign, with the lettered face toward local −Z — the same way a building's door
	/// slot faces, so a plate parented to a house's root reads from the street without any
	/// rotation of its own.
	///
	/// `hue` is the district's colour in degrees, or null for a building that belongs to no
	/// district (the civics), which then simply gets no band.
	/// </summary>
	public static Node3D Build(string text, float? hue = null, float scale = 1.0f)
	{
		var root = new Node3D { Name = "Nameplate" };

		float bw = BoardW * scale;
		float bh = BoardH * scale;
		float baseY = BoardBase * scale;
		float boardMidY = baseY + bh * 0.5f;

		// Two legs rather than one: a single stake reads as a for-sale sign, two as a plaque that
		// belongs to the house behind it.
		float legH = boardMidY + bh * 0.45f;
		float legSpan = bw * 0.38f;
		var legMesh = new CylinderMesh
		{
			TopRadius = PostR * scale,
			BottomRadius = PostR * 1.25f * scale,
			Height = legH,
			RadialSegments = 6,
			Rings = 1,
			Material = Palette.Solid(Palette.Wood, 0.85f),
		};
		foreach (float sx in new[] { -legSpan, legSpan })
		{
			root.AddChild(new MeshInstance3D
			{
				Name = sx < 0 ? "LegL" : "LegR",
				Mesh = legMesh,
				Position = new Vector3(sx, legH * 0.5f, 0.0f),
			});
		}

		var board = new BoxMesh
		{
			Size = new Vector3(bw, bh, BoardThick * scale),
			Material = Palette.Solid(Cream, 0.88f),
		};
		root.AddChild(new MeshInstance3D
		{
			Name = "Board",
			Mesh = board,
			Position = new Vector3(0.0f, boardMidY, 0.0f),
		});

		// The routed border: a slightly larger, darker slab a hair behind the cream face. Cheaper
		// than four rails and reads the same at the distance anyone sees it from.
		var frame = new BoxMesh
		{
			Size = new Vector3(bw + 0.06f * scale, bh + 0.06f * scale, BoardThick * 0.6f * scale),
			Material = Palette.Solid(new Color(0.28f, 0.19f, 0.10f), 0.85f),
		};
		root.AddChild(new MeshInstance3D
		{
			Name = "Frame",
			Mesh = frame,
			Position = new Vector3(0.0f, boardMidY, 0.012f * scale),
		});

		if (hue.HasValue)
		{
			var band = new BoxMesh
			{
				Size = new Vector3(bw * 0.92f, bh * 0.16f, BoardThick * 0.5f * scale),
				Material = Palette.Solid(Color.FromHsv(hue.Value / 360.0f, 0.52f, 0.46f), 0.85f),
			};
			root.AddChild(new MeshInstance3D
			{
				Name = "HueBand",
				Mesh = band,
				Position = new Vector3(0.0f, boardMidY + bh * 0.36f, -BoardThick * 0.35f * scale),
			});
		}

		var label = new Label3D
		{
			Name = "Text",
			Text = Wrap(text),
			FontSize = 28,
			PixelSize = 0.0050f * scale,
			Modulate = Ink,
			HorizontalAlignment = HorizontalAlignment.Center,
			VerticalAlignment = VerticalAlignment.Center,
			// Face −Z, the street side, matching the door slot.
			RotationDegrees = new Vector3(0.0f, 180.0f, 0.0f),
			Position = new Vector3(0.0f, boardMidY - bh * 0.06f, -BoardThick * 0.55f * scale),
		};
		root.AddChild(label);

		return root;
	}

	/// <summary>
	/// Two lines at most, broken at the last space that fits. Settler names are two words
	/// ("Eager Brook"), so this is nearly always a single break in the middle; a one-word name is
	/// left alone and a very long one is cut rather than allowed to overrun the board.
	/// </summary>
	private static string Wrap(string text)
	{
		string t = (text ?? "").Trim();
		if (t.Length == 0) return "Untitled";
		if (t.Length <= 13) return t;

		int mid = t.LastIndexOf(' ', Math.Min(t.Length - 1, 15));
		if (mid <= 0)
			return t.Length > 15 ? t[..14] + "…" : t;

		string first = t[..mid];
		string second = t[(mid + 1)..];
		if (second.Length > 15) second = second[..14] + "…";
		return $"{first}\n{second}";
	}
}
