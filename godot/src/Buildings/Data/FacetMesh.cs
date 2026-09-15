using System;
using System.Collections.Generic;
using Godot;

namespace Promptholm.Buildings.Data;

/// <summary>
/// One building piece, accumulated as flat-shaded triangles and emitted as a single mesh surface.
///
/// It solves two problems at once. The look: this style is faceted — flat faces meeting at hard
/// edges, with the shading doing the work a texture would otherwise do — and that is exactly a
/// triangle soup with one normal per face, the same idiom <c>RockMesh</c> already uses for the
/// stones. And the cost: a house used to be a hundred and sixty separate <c>BoxMesh</c> nodes,
/// one draw call each, because every plank and every brick was its own MeshInstance3D. Here a
/// plank is six quads in a shared buffer, so a whole wall — framing and all — is one surface.
///
/// Colour rides along in the vertex buffer instead of in a material, which is what lets the
/// palette grow while the material count stays flat: a hundred shades of roof cost one material.
/// Godot reads ArrayMesh vertex colours as linear, so <see cref="Add"/> converts on the way in —
/// see the note on <c>Palette.Terrain</c>. Writing sRGB numbers straight into the buffer bleaches
/// the whole island and does not read as a bug, only as a bad palette.
/// </summary>
public sealed class FacetMesh
{
	private readonly List<Vector3> _vertices = new();
	private readonly List<Vector3> _normals = new();
	private readonly List<Color> _colours = new();

	public bool IsEmpty => _vertices.Count == 0;

	/// <summary>Triangles accumulated so far; the runners report on this.</summary>
	public int TriangleCount => _vertices.Count / 3;

	/// <summary>
	/// One flat triangle. Corners are given counter-clockwise <em>as seen from outside</em> the
	/// solid, which is the everyday convention and the one the callers below read naturally.
	///
	/// Godot's is the other one. Measured on BoxMesh, PrismMesh and CylinderMesh: the front face
	/// of a primitive is wound so that (b−a)×(c−a) points *against* its own normal. So the normal
	/// is taken from the corners as given and the triangle is emitted reversed. Getting this
	/// backwards raises nothing — the geometry simply vanishes into backface culling, which is a
	/// miserable thing to debug from a screenshot.
	/// </summary>
	public void Tri(Vector3 a, Vector3 b, Vector3 c, Color colour)
	{
		var n = (b - a).Cross(c - a);
		if (n.LengthSquared() < 1e-12f)
			return;
		n = n.Normalized();
		Add(a, n, colour);
		Add(c, n, colour);
		Add(b, n, colour);
	}

	/// <summary>A planar quad; corners counter-clockwise as seen from outside.</summary>
	public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Color colour)
	{
		Tri(a, b, c, colour);
		Tri(a, c, d, colour);
	}

	/// <summary>
	/// A triangle whose outward side is the one pointing roughly <paramref name="towards"/>,
	/// whatever order the corners arrived in.
	///
	/// Worth the dot product. Roof slopes, hips and gambrel breaks are quads whose corner order
	/// is obvious from the geometry and anything but obvious from the sign of a cross product,
	/// and a slope emitted inside-out is invisible rather than wrong-looking.
	/// </summary>
	public void TriFacing(Vector3 a, Vector3 b, Vector3 c, Vector3 towards, Color colour)
	{
		if ((b - a).Cross(c - a).Dot(towards) < 0.0f)
			Tri(a, c, b, colour);
		else
			Tri(a, b, c, colour);
	}

	/// <summary>A quad whose outward side is the one pointing roughly <paramref name="towards"/>.</summary>
	public void QuadFacing(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 towards, Color colour)
	{
		if ((b - a).Cross(c - a).Dot(towards) < 0.0f)
		{
			Tri(a, d, c, colour);
			Tri(a, c, b, colour);
		}
		else
		{
			Tri(a, b, c, colour);
			Tri(a, c, d, colour);
		}
	}

	/// <summary>
	/// A slab with real thickness: the four corners give its top face, and it is extruded
	/// straight down by <paramref name="thickness"/>. Every roof slope is one of these rather
	/// than a bare quad, which is what puts a visible edge on the eaves — the chunky cut-plank
	/// look the reference has, and a shape you can read from below.
	/// </summary>
	public void Plate(Vector3 a, Vector3 b, Vector3 c, Vector3 d, float thickness, Color colour)
	{
		var drop = new Vector3(0.0f, thickness, 0.0f);
		var a2 = a - drop;
		var b2 = b - drop;
		var c2 = c - drop;
		var d2 = d - drop;

		QuadFacing(a, b, c, d, Vector3.Up, colour);
		QuadFacing(a2, b2, c2, d2, Vector3.Down, colour);
		Edge(a, b, b2, a2, (a + b) * 0.5f - (c + d) * 0.5f, colour);
		Edge(b, c, c2, b2, (b + c) * 0.5f - (d + a) * 0.5f, colour);
		Edge(c, d, d2, c2, (c + d) * 0.5f - (a + b) * 0.5f, colour);
		Edge(d, a, a2, d2, (d + a) * 0.5f - (b + c) * 0.5f, colour);
	}

	private void Edge(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector3 towards, Color colour)
	{
		if (towards.LengthSquared() < 1e-9f)
			towards = Vector3.Up;
		QuadFacing(a, b, c, d, towards, colour);
	}

	/// <summary>
	/// A box of <paramref name="size"/>, centred on and oriented by <paramref name="at"/>.
	/// The workhorse of the kit: walls, beams, chimneys, parapets and sills are all boxes.
	/// </summary>
	public void Box(Transform3D at, Vector3 size, Color colour)
	{
		var h = size * 0.5f;
		Vector3 P(float x, float y, float z) => at * new Vector3(x * h.X, y * h.Y, z * h.Z);

		var nnn = P(-1, -1, -1);
		var pnn = P(+1, -1, -1);
		var ppn = P(+1, +1, -1);
		var npn = P(-1, +1, -1);
		var nnp = P(-1, -1, +1);
		var pnp = P(+1, -1, +1);
		var ppp = P(+1, +1, +1);
		var npp = P(-1, +1, +1);

		Quad(nnp, pnp, ppp, npp, colour);   // +Z
		Quad(pnn, nnn, npn, ppn, colour);   // −Z
		Quad(pnp, pnn, ppn, ppp, colour);   // +X
		Quad(nnn, nnp, npp, npn, colour);   // −X
		Quad(npn, npp, ppp, ppn, colour);   // +Y
		Quad(nnn, pnn, pnp, nnp, colour);   // −Y
	}

	/// <summary>A box centred on <paramref name="centre"/>, axis-aligned.</summary>
	public void Box(Vector3 centre, Vector3 size, Color colour)
		=> Box(new Transform3D(Basis.Identity, centre), size, colour);

	/// <summary>
	/// An N-sided drum: a tapered tube with a lid, standing on <paramref name="at"/> with its
	/// base at y=0 in that frame. <paramref name="topRadius"/> of zero gives a cone, equal radii
	/// give a straight prism. Six or eight sides is the sweet spot — enough to read as round at
	/// a distance, few enough that every facet still catches its own light.
	/// </summary>
	public void Drum(
		Transform3D at, float bottomRadius, float topRadius, float height, int sides,
		Color wall, Color lid, float yaw = 0.0f, bool capBottom = false)
	{
		sides = Math.Max(3, sides);
		var ring = new Vector3[sides];
		var top = new Vector3[sides];
		for (int i = 0; i < sides; i++)
		{
			float a = yaw + Mathf.Tau * i / sides;
			float cx = MathF.Cos(a), cz = MathF.Sin(a);
			ring[i] = at * new Vector3(cx * bottomRadius, 0.0f, cz * bottomRadius);
			top[i] = at * new Vector3(cx * topRadius, height, cz * topRadius);
		}

		var apex = at * new Vector3(0.0f, height, 0.0f);
		for (int i = 0; i < sides; i++)
		{
			int j = (i + 1) % sides;
			if (topRadius <= 0.0005f)
				Tri(ring[i], ring[j], apex, wall);
			else
				Quad(ring[i], ring[j], top[j], top[i], wall);
		}

		if (topRadius > 0.0005f)
		{
			for (int i = 1; i + 1 < sides; i++)
				Tri(top[0], top[i], top[i + 1], lid);
		}

		if (capBottom)
		{
			var floor = at * Vector3.Zero;
			for (int i = 0; i < sides; i++)
				Tri(floor, ring[(i + 1) % sides], ring[i], lid);
		}
	}

	/// <summary>
	/// The finished piece: one surface, one material, flat normals, colour in the vertex buffer.
	/// Returns null when nothing was accumulated, so callers can skip the MeshInstance3D entirely
	/// rather than hang an empty node off a slot.
	/// </summary>
	public ArrayMesh? Build(Material material)
	{
		if (IsEmpty)
			return null;

		var mesh = new ArrayMesh();
		AppendTo(mesh, material);
		return mesh;
	}

	/// <summary>
	/// Adds this builder's triangles to <paramref name="mesh"/> as one more surface. Used where a
	/// piece genuinely needs a second material — a window pane is emissive and the frame is not —
	/// and nowhere else: every extra surface is another draw call on every building.
	/// </summary>
	public void AppendTo(ArrayMesh mesh, Material material)
	{
		if (IsEmpty)
			return;

		var arrays = new Godot.Collections.Array();
		arrays.Resize((int)Mesh.ArrayType.Max);
		arrays[(int)Mesh.ArrayType.Vertex] = _vertices.ToArray();
		arrays[(int)Mesh.ArrayType.Normal] = _normals.ToArray();
		arrays[(int)Mesh.ArrayType.Color] = _colours.ToArray();

		int surface = mesh.GetSurfaceCount();
		mesh.AddSurfaceFromArrays(Mesh.PrimitiveType.Triangles, arrays);
		mesh.SurfaceSetMaterial(surface, material);
	}

	private void Add(Vector3 vertex, Vector3 normal, Color colour)
	{
		_vertices.Add(vertex);
		_normals.Add(normal);
		_colours.Add(colour.SrgbToLinear());
	}
}
