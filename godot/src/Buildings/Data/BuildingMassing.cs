using System;
using Godot;
using Promptholm.Visual;
using Promptholm.World;

namespace Promptholm.Buildings.Data;

/// <summary>
/// The geometry that gives a building its outline, built per slot and merged into one mesh each.
///
/// The old kit is still next door in <see cref="BuildingCatalog"/> and still feeds the editor
/// prefabs and the model sheet; what it could not do is vary. Every factory there takes a width
/// and a depth and returns the same gable, and it returns it as forty separate MeshInstance3Ds —
/// one per brick — so the island cost 159 draw calls per house for a shape you could not tell
/// apart from its neighbour.
///
/// Everything here takes a <see cref="BuildingForm"/> instead, which is where the variation was
/// missing, and returns a single merged <see cref="FacetMesh"/> per slot, which is where the cost
/// was. Colour lives in the vertex buffer, so a roof can be any shade in <c>Palette</c> without
/// adding a material.
///
/// Shared conventions, because the slots are not all in the same frame:
///   foundation  origin at the top of the plinth, so the ground is at y = −0.12
///   wall        X across the wall, Y up from its middle, outward face toward −Z
///   roof        origin at the top of the walls, in the middle of the plan
///   door/window on the front wall, facing −Z
/// </summary>
public static class BuildingMassing
{
	/// <summary>Thickness of a roof slope, and of the porch lid. Thick enough to read as a plank.</summary>
	private const float RoofPlate = 0.11f;

	private const float WallThickness = 0.12f;

	/// <summary>
	/// The one material every opaque scrap of building geometry shares.
	///
	/// It has to be built here rather than fetched from <c>Palette</c>: the cache there keys on
	/// albedo/roughness/metallic and has no notion of vertex colour, so asking it for a white
	/// matte and then flipping <c>VertexColorUseAsAlbedo</c> would hand the flag to every other
	/// caller that happens to want the same recipe. One explicit material, once, is the honest
	/// version — and it replaces the twelve the buildings used to put in the scene.
	/// </summary>
	private static StandardMaterial3D? _painted;

	private static StandardMaterial3D Painted() => _painted ??= new StandardMaterial3D
	{
		AlbedoColor = Colors.White,
		VertexColorUseAsAlbedo = true,
		Roughness = 0.88f,
		SpecularMode = BaseMaterial3D.SpecularModeEnum.Disabled,
	};

	// ---- foundation -------------------------------------------------------------

	/// <summary>
	/// The plinth the building stands on, plus the porch when it has one. The porch lives here
	/// rather than in a slot of its own: a slot is a draw call and an entry in every piece count,
	/// and a lean-to over the door is not a part anybody assembles separately.
	/// </summary>
	public static Node3D MakeFoundation(BuildingForm form, float w, float d)
	{
		var m = new FacetMesh();
		var stone = Palette.Fieldstone;
		var stoneDark = Palette.FieldstoneDark;

		if (form.IsTower)
		{
			float r = MathF.Min(w, d) * 0.5f + 0.16f;
			m.Drum(Transform3D.Identity.Translated(new Vector3(0, -0.12f, 0)), r, r * 0.94f, 0.26f, 8, stone, stoneDark);
		}
		else
		{
			m.Box(new Vector3(0, 0, 0), new Vector3(w + 0.26f, 0.24f, d + 0.26f), stone);
			m.Box(new Vector3(0, 0.10f, 0), new Vector3(w + 0.34f, 0.07f, d + 0.34f), stoneDark);
		}

		if (form.Porch)
			AddPorch(m, form, w, d);

		return Wrap("Foundation", m);
	}

	/// <summary>A deck, two posts and a lean-to lid over the front door, in foundation space.</summary>
	private static void AddPorch(FacetMesh m, BuildingForm form, float w, float d)
	{
		float hw = MathF.Min(w * 0.34f, 1.35f);
		float front = -d * 0.5f;
		float reach = 0.82f;
		float postH = form.WallHeight - 0.62f;

		m.Box(new Vector3(0, -0.02f, front - reach * 0.5f), new Vector3(hw * 2.0f + 0.2f, 0.16f, reach), Palette.Plank);

		foreach (float sx in new[] { -hw, hw })
		{
			m.Box(new Vector3(sx, -0.12f + postH * 0.5f, front - reach + 0.10f),
				new Vector3(0.11f, postH, 0.11f), form.Trim);
		}

		// The lid slopes away from the wall. Built as a plate so it has an underside and a lip.
		float high = form.WallHeight - 0.20f;
		float low = form.WallHeight - 0.66f;
		float lx = hw + 0.16f;
		m.Plate(
			new Vector3(-lx, high, front + 0.04f),
			new Vector3(lx, high, front + 0.04f),
			new Vector3(lx, low, front - reach - 0.10f),
			new Vector3(-lx, low, front - reach - 0.10f),
			RoofPlate, form.RoofColour);
	}

	// ---- walls ------------------------------------------------------------------

	/// <summary>
	/// One wall: a solid panel with its framing. Which framing depends on the tier — sticks and
	/// canvas at the bottom, half-timbering in the middle, ashlar courses at the top — because
	/// the pattern of the front is the second thing you read after the roofline.
	/// </summary>
	public static Node3D MakeWall(BuildingForm form, float span, float height)
	{
		var m = new FacetMesh();
		m.Box(Vector3.Zero, new Vector3(span, height, WallThickness), form.Wall);

		float outward = -WallThickness * 0.5f - 0.025f;
		float hs = span * 0.5f;
		float hh = height * 0.5f;

		void Beam(float x, float y, float sx, float sy)
			=> m.Box(new Vector3(x, y, outward), new Vector3(sx, sy, 0.06f), form.Trim);

		switch (form.Family)
		{
			case BuildingFamily.CivicKiosk:
				// A plinth with a capping band, not a wall with windows in it.
				Beam(0, hh - 0.06f, span, 0.12f);
				Beam(0, -hh + 0.05f, span, 0.10f);
				break;

			case BuildingFamily.CivicHall:
				// Pilasters: vertical stone ribs, evenly spaced. Reads as civic from a distance.
				Beam(0, hh - 0.10f, span, 0.20f);
				for (int i = -1; i <= 1; i++)
					Beam(i * hs * 0.62f, 0, 0.16f, height);
				break;

			case BuildingFamily.Shed:
				Beam(0, hh - 0.05f, span, 0.10f);
				Beam(0, 0, 0.09f, height);
				break;

			default:
			{
				// Half-timbering. The braces are what stop a flat panel from reading as cardboard,
				// and the count rises with the tier so a manor looks more worked than a hut.
				Beam(0, hh - 0.06f, span, 0.12f);
				Beam(0, -hh + 0.05f, span, 0.10f);
				Beam(-hs + 0.06f, 0, 0.11f, height);
				Beam(hs - 0.06f, 0, 0.11f, height);
				if (height >= 1.8f)
				{
					Beam(0, 0, 0.09f, height);
					Beam(-hs * 0.5f, 0, 0.08f, height * 0.62f);
					Beam(hs * 0.5f, 0, 0.08f, height * 0.62f);
				}
				if (height >= 3.0f)
					Beam(0, hh - height * 0.42f, span, 0.14f);   // belt course: the second storey
				break;
			}
		}

		return Wrap("Wall", m);
	}

	/// <summary>
	/// A tower shaft, used in place of the four walls. Built from its base upward, because that
	/// is where a tower's proportions are read from; the slot sits on the ground for this one.
	/// </summary>
	public static Node3D MakeTowerShaft(BuildingForm form, float w, float d)
	{
		var m = new FacetMesh();
		float r = MathF.Min(w, d) * 0.5f;
		float top = r * form.TaperTop;
		const int Sides = 8;

		// Banded, because a smooth taper of one colour is a traffic cone. Each band is its own
		// drum so the facets stay flat and the joins stay hard.
		int bands = Math.Max(3, (int)MathF.Round(form.WallHeight / 0.85f));
		for (int i = 0; i < bands; i++)
		{
			float t0 = (float)i / bands;
			float t1 = (float)(i + 1) / bands;
			var colour = (i % 2 == 0) ? form.Wall : form.Accent;
			m.Drum(
				Transform3D.Identity.Translated(new Vector3(0, form.WallHeight * t0, 0)),
				Mathf.Lerp(r, top, t0), Mathf.Lerp(r, top, t1),
				form.WallHeight * (t1 - t0), Sides, colour, colour);
		}

		if (form.Gallery)
		{
			// The walkway the light stands on. It is also the reason this tower stops where it
			// does: LighthouseController hangs its lantern at 2.7 m and the deck has to meet it.
			float deckY = form.WallHeight - 0.10f;
			m.Drum(Transform3D.Identity.Translated(new Vector3(0, deckY, 0)),
				top + 0.30f, top + 0.30f, 0.10f, Sides, Palette.Iron, Palette.Iron);
			for (int i = 0; i < Sides; i++)
			{
				float a = Mathf.Tau * i / Sides;
				m.Box(new Vector3(MathF.Cos(a) * (top + 0.24f), deckY + 0.24f, MathF.Sin(a) * (top + 0.24f)),
					new Vector3(0.06f, 0.38f, 0.06f), Palette.Iron);
			}
		}

		return Wrap("TowerShaft", m);
	}

	// ---- roofs ------------------------------------------------------------------

	/// <summary>
	/// The whole roof: slopes, gable ends, eaves, and everything standing on it. Chimneys and
	/// dormers belong to this slot rather than to ornament slots of their own — they are part of
	/// the outline, and putting them here keeps a building at one mesh per slot.
	///
	/// Built in "ridge space", where the ridge always runs along X, and then turned a quarter
	/// turn when the building's ridge runs the other way. Half the village faces the other way
	/// for free, and there is only one of each roof to get right.
	/// </summary>
	public static Node3D MakeRoof(BuildingForm form, float w, float d)
	{
		var m = new FacetMesh();
		var basis = form.RidgeAlongX ? Basis.Identity : new Basis(Vector3.Up, Mathf.Pi * 0.5f);

		// Half-extents in ridge space: X runs along the ridge, Z across it.
		float ex = (form.RidgeAlongX ? w : d) * 0.5f + form.Overhang;
		float ez = (form.RidgeAlongX ? d : w) * 0.5f + form.Overhang;
		float gx = (form.RidgeAlongX ? w : d) * 0.5f;   // the wall plane, inside the overhang
		float rise = form.RoofRise;

		Vector3 P(float x, float y, float z) => basis * new Vector3(x, y, z);

		switch (form.Roof)
		{
			case RoofForm.Gable: Gable(m, form, P, ex, ez, gx, rise); break;
			case RoofForm.Saltbox: Saltbox(m, form, P, ex, ez, gx, rise); break;
			case RoofForm.Hip: Hip(m, form, P, ex, ez, rise); break;
			case RoofForm.Gambrel: Gambrel(m, form, P, ex, ez, gx, rise); break;
			case RoofForm.Pyramid: Pyramid(m, form, P, ex, ez, rise); break;
			case RoofForm.Cone: Cone(m, form, MathF.Min(ex, ez), rise); break;
			case RoofForm.Lean: Lean(m, form, P, ex, ez, gx, rise); break;
			default: Parapet(m, form, P, ex, ez, rise); break;
		}

		if (form.Sails)
			AddSails(m, form, P, ez, rise);
		if (form.Turret)
			AddTurret(m, form, P, w, d, rise);
		for (int i = 0; i < form.Dormers; i++)
			AddDormer(m, form, P, ex, ez, rise, i);
		for (int i = 0; i < form.Chimneys; i++)
			AddChimney(m, form, P, ex, ez, rise, i);

		return Wrap("Roof", m);
	}

	private static void Gable(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float gx, float rise)
	{
		m.Plate(P(-ex, 0, -ez), P(ex, 0, -ez), P(ex, rise, 0), P(-ex, rise, 0), RoofPlate, f.RoofColour);
		m.Plate(P(ex, 0, ez), P(-ex, 0, ez), P(-ex, rise, 0), P(ex, rise, 0), RoofPlate, f.RoofColour);
		GableEnds(m, f, P, ez, gx, rise, 0.0f);
	}

	/// <summary>
	/// Asymmetric gable: the ridge sits a third of the way forward, so the back slope runs long
	/// and shallow and the front one is short and steep. One number, and the building stops
	/// being symmetrical from every angle.
	/// </summary>
	private static void Saltbox(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float gx, float rise)
	{
		float ridgeZ = -ez * 0.34f;
		m.Plate(P(-ex, 0, -ez), P(ex, 0, -ez), P(ex, rise, ridgeZ), P(-ex, rise, ridgeZ), RoofPlate, f.RoofColour);
		m.Plate(P(ex, 0, ez), P(-ex, 0, ez), P(-ex, rise, ridgeZ), P(ex, rise, ridgeZ), RoofPlate, f.RoofColour);
		GableEnds(m, f, P, ez, gx, rise, ridgeZ);
	}

	/// <summary>The triangle of wall each gable end closes off, at the wall plane rather than at
	/// the verge, so the roof visibly overhangs it.</summary>
	private static void GableEnds(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ez, float gx, float rise, float ridgeZ)
	{
		float inner = ez - f.Overhang;
		foreach (float sx in new[] { -gx, gx })
		{
			var outward = P(sx, 0, 0) - P(0, 0, 0);
			m.TriFacing(P(sx, 0, -inner), P(sx, 0, inner), P(sx, rise, ridgeZ), outward, f.Wall);
		}
	}

	private static void Hip(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float rise)
	{
		float rx = ex * 0.34f;
		m.Plate(P(-ex, 0, -ez), P(ex, 0, -ez), P(rx, rise, 0), P(-rx, rise, 0), RoofPlate, f.RoofColour);
		m.Plate(P(ex, 0, ez), P(-ex, 0, ez), P(-rx, rise, 0), P(rx, rise, 0), RoofPlate, f.RoofColour);
		m.TriFacing(P(ex, 0, -ez), P(ex, 0, ez), P(rx, rise, 0), P(1, 0, 0) - P(0, 0, 0), f.RoofColour);
		m.TriFacing(P(-ex, 0, ez), P(-ex, 0, -ez), P(-rx, rise, 0), P(-1, 0, 0) - P(0, 0, 0), f.RoofColour);
	}

	/// <summary>Barn roof: a steep skirt breaking to a shallow cap at 45% of the rise.</summary>
	private static void Gambrel(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float gx, float rise)
	{
		float bz = ez * 0.46f;
		float by = rise * 0.62f;

		m.Plate(P(-ex, 0, -ez), P(ex, 0, -ez), P(ex, by, -bz), P(-ex, by, -bz), RoofPlate, f.RoofColour);
		m.Plate(P(-ex, by, -bz), P(ex, by, -bz), P(ex, rise, 0), P(-ex, rise, 0), RoofPlate, f.RoofColour);
		m.Plate(P(ex, 0, ez), P(-ex, 0, ez), P(-ex, by, bz), P(ex, by, bz), RoofPlate, f.RoofColour);
		m.Plate(P(ex, by, bz), P(-ex, by, bz), P(-ex, rise, 0), P(ex, rise, 0), RoofPlate, f.RoofColour);

		float inner = ez - f.Overhang;
		float innerB = bz * (inner / ez);
		foreach (float sx in new[] { -gx, gx })
		{
			var outward = P(sx, 0, 0) - P(0, 0, 0);
			m.TriFacing(P(sx, 0, -inner), P(sx, by, -innerB), P(sx, rise, 0), outward, f.Wall);
			m.TriFacing(P(sx, 0, -inner), P(sx, rise, 0), P(sx, 0, inner), outward, f.Wall);
			m.TriFacing(P(sx, 0, inner), P(sx, rise, 0), P(sx, by, innerB), outward, f.Wall);
		}
	}

	private static void Pyramid(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float rise)
	{
		var apex = P(0, rise, 0);
		var corners = new[] { P(-ex, 0, -ez), P(ex, 0, -ez), P(ex, 0, ez), P(-ex, 0, ez) };
		for (int i = 0; i < 4; i++)
		{
			var a = corners[i];
			var b = corners[(i + 1) % 4];
			var outward = (a + b) * 0.5f - P(0, 0, 0) + Vector3.Up * rise * 0.3f;
			m.TriFacing(a, b, apex, outward, f.RoofColour);
		}
	}

	private static void Cone(FacetMesh m, BuildingForm f, float r, float rise)
	{
		m.Drum(Transform3D.Identity, r + 0.14f, r * 0.92f, 0.12f, 8, f.Accent, f.Accent);
		m.Drum(Transform3D.Identity.Translated(new Vector3(0, 0.12f, 0)), r * 0.92f, 0.0f, rise, 8,
			f.RoofColour, f.RoofColour);
	}

	/// <summary>One slope, back to front. The cheapest roof a shed can have, and it shows.</summary>
	private static void Lean(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float gx, float rise)
	{
		m.Plate(P(-ex, 0, -ez), P(ex, 0, -ez), P(ex, rise, ez), P(-ex, rise, ez), RoofPlate, f.RoofColour);
		float inner = ez - f.Overhang;
		foreach (float sx in new[] { -gx, gx })
		{
			var outward = P(sx, 0, 0) - P(0, 0, 0);
			m.TriFacing(P(sx, 0, -inner), P(sx, 0, inner), P(sx, rise * (inner / ez), inner), outward, f.Wall);
		}
		// The back wall has to grow to meet the high edge, or the shed is open at the top.
		m.QuadFacing(P(-gx, 0, inner), P(gx, 0, inner), P(gx, rise * (inner / ez), inner),
			P(-gx, rise * (inner / ez), inner), P(0, 0, 1) - P(0, 0, 0), f.Wall);
	}

	/// <summary>
	/// A flat deck behind a battlemented parapet. The merlons are the point: a keep has to read
	/// as a keep in profile, and a plain box with a flat lid reads as a warehouse.
	/// </summary>
	private static void Parapet(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float rise)
	{
		float deck = rise * 0.34f;
		float wallTop = rise;
		const float T = 0.16f;

		m.QuadFacing(P(-ex, deck, -ez), P(ex, deck, -ez), P(ex, deck, ez), P(-ex, deck, ez),
			Vector3.Up, f.RoofColour);

		void Rail(Vector3 centre, Vector3 size) => m.Box(new Transform3D(BasisOf(P), centre), size, f.Wall);

		float mid = (deck + wallTop) * 0.5f;
		float h = wallTop - deck;
		Rail(P(0, mid, -ez + T * 0.5f), new Vector3(ex * 2.0f, h, T));
		Rail(P(0, mid, ez - T * 0.5f), new Vector3(ex * 2.0f, h, T));
		Rail(P(-ex + T * 0.5f, mid, 0), new Vector3(T, h, ez * 2.0f));
		Rail(P(ex - T * 0.5f, mid, 0), new Vector3(T, h, ez * 2.0f));

		// Merlons only where there is a parapet worth notching. A kiosk wears the same flat lid
		// for its silhouette and would look ridiculous with battlements on it.
		if (rise < 0.35f)
			return;

		int merlons = Math.Max(2, (int)MathF.Round(ex * 2.0f / 0.78f));
		float mh = MathF.Min(0.34f, h * 0.9f);
		for (int i = 0; i <= merlons; i += 2)
		{
			float x = Mathf.Lerp(-ex + T, ex - T, (float)i / merlons);
			Rail(P(x, wallTop + mh * 0.5f, -ez + T * 0.5f), new Vector3(0.42f, mh, T));
			Rail(P(x, wallTop + mh * 0.5f, ez - T * 0.5f), new Vector3(0.42f, mh, T));
		}
	}

	/// <summary>
	/// A weathervane or a forge stack for the Ornament slot. Merged like everything else, with
	/// the smoke on its own surface because it is the one part that has to blend.
	/// </summary>
	public static Node3D MakeOrnament(BuildingForm form, string ornamentId)
	{
		var solid = new FacetMesh();
		var smoke = new FacetMesh();

		if (string.Equals(ornamentId, "forge", StringComparison.OrdinalIgnoreCase))
		{
			solid.Box(new Vector3(0, 0.30f, 0), new Vector3(0.36f, 0.60f, 0.36f), Palette.Fieldstone);
			solid.Box(new Vector3(0, 0.70f, 0), new Vector3(0.22f, 0.24f, 0.22f), Palette.FieldstoneDark);
			smoke.Drum(Transform3D.Identity.Translated(new Vector3(0.06f, 0.92f, 0.02f)),
				0.12f, 0.06f, 0.20f, 6, Palette.Smoke, Palette.Smoke);
			smoke.Drum(Transform3D.Identity.Translated(new Vector3(-0.05f, 1.16f, -0.03f)),
				0.10f, 0.04f, 0.16f, 6, Palette.Smoke, Palette.Smoke);
		}
		else
		{
			solid.Box(new Vector3(0, 0.22f, 0), new Vector3(0.05f, 0.44f, 0.05f), Palette.Iron);
			solid.Box(new Vector3(0, 0.44f, 0), new Vector3(0.34f, 0.04f, 0.04f), form.Accent);
			solid.Box(new Vector3(0, 0.42f, 0), new Vector3(0.04f, 0.04f, 0.24f), Palette.Iron);
			solid.Tri(new Vector3(0.17f, 0.50f, 0), new Vector3(0.17f, 0.38f, 0), new Vector3(0.34f, 0.44f, 0),
				Palette.Copper);
			solid.Tri(new Vector3(0.17f, 0.38f, 0), new Vector3(0.17f, 0.50f, 0), new Vector3(0.34f, 0.44f, 0),
				Palette.Copper);
		}

		var mesh = new ArrayMesh();
		solid.AppendTo(mesh, Painted());
		smoke.AppendTo(mesh, BuildingCatalog.SmokeMaterial);
		return Wrap("Ornament", mesh);
	}

	// ---- things that stand on the roof -----------------------------------------

	/// <summary>
	/// A chimney, offset along the ridge and pushed off it sideways. Never centred: a stack on
	/// the peak of the roof is the single clearest tell of a generated building, and moving it
	/// costs one line.
	/// </summary>
	private static void AddChimney(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float rise, int index)
	{
		uint h = PmRng.Hash32($"chimney:{f.Seed}:{index}");
		float side = index == 0 ? -1.0f : 1.0f;
		float along = side * Mathf.Lerp(0.26f, 0.52f, (h & 0xFFu) / 255.0f) * ex;
		float across = ((h >> 8) & 1u) == 0 ? -ez * 0.18f : ez * 0.18f;

		float top = rise + 0.42f + ((h >> 12) & 0x7u) * 0.055f;
		float baseY = rise * 0.25f;
		float width = f.Family == BuildingFamily.CivicHall ? 0.42f : 0.34f;

		m.Box(new Transform3D(BasisOf(P), P(along, (baseY + top) * 0.5f, across)),
			new Vector3(width, top - baseY, width), Palette.Fieldstone);
		m.Box(new Transform3D(BasisOf(P), P(along, top + 0.06f, across)),
			new Vector3(width + 0.13f, 0.12f, width + 0.13f), Palette.FieldstoneDark);
	}

	/// <summary>A dormer through the front slope: the tier-3-and-up tell, and it breaks the
	/// roofline where the eye reads it.</summary>
	private static void AddDormer(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ex, float ez, float rise, int index)
	{
		float x = (index == 0 ? -1.0f : 1.0f) * ex * (f.Dormers == 1 ? 0.22f : 0.38f);
		float z = -ez * 0.46f;
		float slopeY = rise * (1.0f - 0.46f);
		var at = BasisOf(P);

		m.Box(new Transform3D(at, P(x, slopeY + 0.08f, z)), new Vector3(0.62f, 0.62f, 0.66f), f.Wall);
		m.Box(new Transform3D(at, P(x, slopeY + 0.10f, z - 0.30f)), new Vector3(0.34f, 0.30f, 0.08f), f.Accent);

		var apex = P(x, slopeY + 0.58f, z);
		m.TriFacing(P(x - 0.38f, slopeY + 0.38f, z - 0.38f), P(x + 0.38f, slopeY + 0.38f, z - 0.38f), apex,
			P(0, 1, -1) - P(0, 0, 0), f.RoofColour);
		m.Plate(P(x - 0.38f, slopeY + 0.40f, z - 0.40f), P(x + 0.38f, slopeY + 0.40f, z - 0.40f),
			P(x + 0.38f, slopeY + 0.60f, z), P(x - 0.38f, slopeY + 0.60f, z), 0.07f, f.RoofColour);
	}

	/// <summary>A corner turret past the parapet. Keeps and the castle; nothing else gets one.</summary>
	private static void AddTurret(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float w, float d, float rise)
	{
		float r = MathF.Min(w, d) * 0.19f;
		float x = (f.RidgeAlongX ? w : d) * 0.5f - r * 0.8f;
		float z = (f.RidgeAlongX ? d : w) * 0.5f - r * 0.8f;
		var at = Transform3D.Identity.Translated(P(-x, -0.45f, -z));

		m.Drum(at, r, r * 0.94f, rise + 1.55f, 8, f.Wall, f.Wall);
		m.Drum(at.Translated(new Vector3(0, rise + 1.55f, 0)), r + 0.14f, 0.0f, r * 1.7f, 8,
			f.RoofColour, f.RoofColour);
	}

	/// <summary>Four sails on the cap. The windmill is the one building on the island whose
	/// silhouette is not a roof at all.</summary>
	private static void AddSails(FacetMesh m, BuildingForm f, Func<float, float, float, Vector3> P,
		float ez, float rise)
	{
		float hubZ = -ez - 0.22f;
		float hubY = rise * 0.55f;
		var at = BasisOf(P);
		m.Box(new Transform3D(at, P(0, hubY, hubZ)), new Vector3(0.26f, 0.26f, 0.34f), Palette.Iron);

		float arm = 2.35f;
		for (int i = 0; i < 4; i++)
		{
			float a = Mathf.Pi * 0.25f + Mathf.Pi * 0.5f * i;
			float dx = MathF.Cos(a), dy = MathF.Sin(a);
			var centre = P(dx * arm * 0.5f, hubY + dy * arm * 0.5f, hubZ - 0.12f);
			var spin = new Basis(Vector3.Forward, -a);
			m.Box(new Transform3D(at * spin, centre), new Vector3(0.14f, arm, 0.07f), Palette.Plank);
			m.Box(new Transform3D(at * spin, centre), new Vector3(0.46f, arm * 0.78f, 0.04f), Palette.CanvasCream);
		}
	}

	// ---- openings and trim ------------------------------------------------------

	/// <summary>A plank door sized to the wall it is cut into; a 1.5 m door in a 0.85 m wall was
	/// the sort of thing that only shows up in a screenshot.</summary>
	public static Node3D MakeDoor(BuildingForm form)
	{
		var m = new FacetMesh();
		float h = form.DoorHeight;
		float w = MathF.Min(0.82f, h * 0.58f);

		m.Box(new Vector3(0, 0, 0), new Vector3(w, h, 0.09f), Palette.Wood);
		m.Box(new Vector3(0, h * 0.30f, -0.05f), new Vector3(w + 0.05f, 0.08f, 0.05f), form.Trim);
		m.Box(new Vector3(0, -h * 0.30f, -0.05f), new Vector3(w + 0.05f, 0.08f, 0.05f), form.Trim);
		m.Box(new Vector3(-w * 0.42f, 0, -0.05f), new Vector3(0.07f, h, 0.05f), form.Trim);
		m.Box(new Vector3(w * 0.42f, 0, -0.05f), new Vector3(0.07f, h, 0.05f), form.Trim);
		m.Box(new Vector3(w * 0.32f, 0, -0.08f), new Vector3(0.05f, 0.13f, 0.05f), Palette.Iron);

		// Lintel above the opening; a doorway with nothing over it reads as a hole.
		m.Box(new Vector3(0, h * 0.5f + 0.07f, -0.04f), new Vector3(w + 0.26f, 0.13f, 0.07f), form.Trim);

		return Wrap("Door", m);
	}

	/// <summary>
	/// A window: glass on surface 0, frame on surface 1. The order is load-bearing —
	/// NightGlowManager finds a building's window material by taking surface 0 of the first mesh
	/// under the slot, and that is what switches the island's lights on at dusk.
	/// </summary>
	public static Node3D MakeWindow(BuildingForm form)
	{
		var glass = new FacetMesh();
		var frame = new FacetMesh();

		glass.Box(new Vector3(0, 0, 0.015f), new Vector3(0.52f, 0.52f, 0.04f), Colors.White);

		frame.Box(new Vector3(0, 0.29f, 0), new Vector3(0.62f, 0.07f, 0.07f), form.Trim);
		frame.Box(new Vector3(0, -0.29f, 0), new Vector3(0.62f, 0.07f, 0.07f), form.Trim);
		frame.Box(new Vector3(-0.28f, 0, 0), new Vector3(0.07f, 0.62f, 0.07f), form.Trim);
		frame.Box(new Vector3(0.28f, 0, 0), new Vector3(0.07f, 0.62f, 0.07f), form.Trim);
		frame.Box(new Vector3(0, 0, -0.005f), new Vector3(0.05f, 0.58f, 0.05f), form.Trim);
		frame.Box(new Vector3(0, -0.36f, -0.04f), new Vector3(0.72f, 0.07f, 0.14f), form.Trim);

		var mesh = new ArrayMesh();
		glass.AppendTo(mesh, BuildingCatalog.GlassMaterial);
		frame.AppendTo(mesh, Painted());
		return Wrap("Window", mesh);
	}

	/// <summary>The gilded board over a civic door.</summary>
	public static Node3D MakeSign(BuildingForm form)
	{
		var m = new FacetMesh();
		m.Box(new Vector3(0, 0, 0), new Vector3(0.92f, 0.34f, 0.07f), Palette.Gold);
		m.Box(new Vector3(0, 0.21f, -0.01f), new Vector3(1.02f, 0.08f, 0.09f), form.Trim);
		m.Box(new Vector3(0, -0.21f, -0.01f), new Vector3(1.02f, 0.08f, 0.09f), form.Trim);
		return Wrap("Sign", m);
	}

	// ---- plumbing ---------------------------------------------------------------

	/// <summary>The rotation baked into the ridge-space mapper, recovered so boxes can share it.</summary>
	private static Basis BasisOf(Func<float, float, float, Vector3> p)
	{
		var origin = p(0, 0, 0);
		return new Basis(p(1, 0, 0) - origin, p(0, 1, 0) - origin, p(0, 0, 1) - origin);
	}

	private static Node3D Wrap(string name, FacetMesh m)
	{
		var mesh = m.Build(Painted());
		return Wrap(name, mesh);
	}

	/// <summary>
	/// One slot, one MeshInstance3D. The wrapper node stays because BuildingSlot3D attaches a
	/// Node3D and NightGlowManager reaches through it for child 0; what is gone is the forty
	/// siblings that used to hang next to it.
	/// </summary>
	private static Node3D Wrap(string name, Mesh? mesh)
	{
		var root = new Node3D { Name = name };
		if (mesh is not null)
			root.AddChild(new MeshInstance3D { Name = "Mesh", Mesh = mesh });
		return root;
	}
}
