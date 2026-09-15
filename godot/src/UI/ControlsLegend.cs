using Godot;

namespace Promptholm.UI;

/// <summary>
/// Bottom-centre controls legend: the keys that actually do something, swapped per mode so
/// the sky view never advertises "C Crouch". Shares the centre line with BuildingDossierUI's
/// interaction prompt (which sits 70-110 px up) and stays below it.
/// </summary>
public partial class ControlsLegend : PanelContainer
{
	/// <summary>On foot: PlayerAvatar + WalkModeManager.</summary>
	private static readonly (string Key, string What)[] WalkKeys =
	{
		("WASD", "Move"),
		("Shift", "Run"),
		("C", "Crouch"),
		("Space", "Jump"),
		("E", "Inspect"),
		("Tab", "Sky view"),
	};

	/// <summary>Inspection view: FreeFlyCamera.</summary>
	private static readonly (string Key, string What)[] FlyKeys =
	{
		("WASD", "Fly"),
		("Space/E", "Up"),
		("Q/Ctrl", "Down"),
		("Shift", "Faster"),
		("Drag", "Look"),
		("Tab", "Walk"),
	};

	private static readonly Color BgDark = new(0.08f, 0.10f, 0.12f, 0.88f);
	private static readonly Color KeyBg = new(0.18f, 0.20f, 0.24f, 1.0f);
	private static readonly Color KeyText = new(0.92f, 0.90f, 0.85f);
	private static readonly Color WhatText = new(0.62f, 0.62f, 0.62f);

	private HBoxContainer _row = null!;
	private bool _walkMode;

	public override void _Ready()
	{
		Name = "ControlsLegend";
		// A legend is read, never clicked: let every pointer event through to the island.
		MouseFilter = MouseFilterEnum.Ignore;

		AddThemeStyleboxOverride("panel", new StyleBoxFlat
		{
			BgColor = BgDark,
			CornerRadiusTopLeft = 8,
			CornerRadiusTopRight = 8,
			CornerRadiusBottomLeft = 8,
			CornerRadiusBottomRight = 8,
			ContentMarginLeft = 10,
			ContentMarginRight = 10,
			ContentMarginTop = 5,
			ContentMarginBottom = 5,
		});

		_row = new HBoxContainer { Name = "Keys", MouseFilter = MouseFilterEnum.Ignore };
		_row.AddThemeConstantOverride("separation", 10);
		AddChild(_row);

		Rebuild();
	}

	/// <summary>Swaps the legend between walking and the sky view. Cheap no-op when unchanged.</summary>
	public void SetWalkMode(bool walking)
	{
		if (walking == _walkMode)
			return;

		_walkMode = walking;
		if (_row is not null)
			Rebuild();
	}

	private void Rebuild()
	{
		foreach (var child in _row.GetChildren())
		{
			_row.RemoveChild(child);
			child.QueueFree();
		}

		var keys = _walkMode ? WalkKeys : FlyKeys;
		for (int i = 0; i < keys.Length; i++)
		{
			if (i > 0)
				_row.AddChild(Dot());
			_row.AddChild(Cap(keys[i].Key));
			_row.AddChild(Caption(keys[i].What));
		}
	}

	/// <summary>The key itself, on a chip that reads as a keycap.</summary>
	private static Label Cap(string text)
	{
		var lbl = new Label { Text = text, MouseFilter = Control.MouseFilterEnum.Ignore };
		lbl.AddThemeFontSizeOverride("font_size", 11);
		lbl.AddThemeColorOverride("font_color", KeyText);
		lbl.AddThemeStyleboxOverride("normal", new StyleBoxFlat
		{
			BgColor = KeyBg,
			CornerRadiusTopLeft = 4,
			CornerRadiusTopRight = 4,
			CornerRadiusBottomLeft = 4,
			CornerRadiusBottomRight = 4,
			ContentMarginLeft = 6,
			ContentMarginRight = 6,
			ContentMarginTop = 1,
			ContentMarginBottom = 1,
		});
		return lbl;
	}

	private static Label Caption(string text)
	{
		var lbl = new Label { Text = text, MouseFilter = Control.MouseFilterEnum.Ignore };
		lbl.AddThemeFontSizeOverride("font_size", 11);
		lbl.AddThemeColorOverride("font_color", WhatText);
		return lbl;
	}

	private static Label Dot()
	{
		var lbl = new Label { Text = "\u00b7", MouseFilter = Control.MouseFilterEnum.Ignore };
		lbl.AddThemeFontSizeOverride("font_size", 11);
		lbl.AddThemeColorOverride("font_color", new Color(1, 1, 1, 0.25f));
		return lbl;
	}
}
