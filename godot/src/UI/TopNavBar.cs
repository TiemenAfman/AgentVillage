using System;
using Godot;

namespace Promptholm.UI;

/// <summary>
/// Top-right mode bar: activity-type filters (Code / Cowork / Apprentices)
/// and navigation buttons (Walk / Overview). Fires events so the orchestrator
/// can react to toggles and camera resets.
/// </summary>
public partial class TopNavBar : HBoxContainer
{
	public event Action<string, bool>? FilterToggled;
	public event Action? WalkToggled;
	public event Action? OverviewClicked;

	private Button _codeBtn = null!;
	private Button _coworkBtn = null!;
	private Button _apprenticeBtn = null!;
	private Button _walkBtn = null!;
	private Button _overviewBtn = null!;
	private bool _suppressToggleEvent;

	private static readonly Color TextWhite = new(0.92f, 0.90f, 0.85f);
	private static readonly Color TextGray = new(0.55f, 0.55f, 0.55f);
	private static readonly Color Gold = new(0.85f, 0.72f, 0.35f);
	private static readonly Color BgDark = new(0.08f, 0.10f, 0.12f, 0.88f);
	private static readonly Color BtnNormal = new(0.15f, 0.17f, 0.20f, 0.9f);
	private static readonly Color BtnActive = new(0.25f, 0.22f, 0.12f, 1.0f);
	private static readonly Color WalkActive = new(0.18f, 0.32f, 0.18f, 1.0f);

	public override void _Ready()
	{
		BuildUI();
	}

	private void BuildUI()
	{
		var bg = new StyleBoxFlat
		{
			BgColor = BgDark,
			CornerRadiusTopLeft = 8,
			CornerRadiusTopRight = 8,
			CornerRadiusBottomLeft = 8,
			CornerRadiusBottomRight = 8,
			ContentMarginLeft = 8,
			ContentMarginRight = 8,
			ContentMarginTop = 4,
			ContentMarginBottom = 4,
		};
		AddThemeStyleboxOverride("panel", bg);
		AddThemeConstantOverride("separation", 4);

		// ── Filter buttons (all on by default → everything visible) ──
		_codeBtn = MakeToggleButton("Code");
		_codeBtn.ButtonPressed = true;
		_codeBtn.Toggled += (on) => FilterToggled?.Invoke("Code", on);
		AddChild(_codeBtn);

		_coworkBtn = MakeToggleButton("Cowork");
		_coworkBtn.ButtonPressed = true;
		_coworkBtn.Toggled += (on) => FilterToggled?.Invoke("Cowork", on);
		AddChild(_coworkBtn);

		_apprenticeBtn = MakeToggleButton("Apprentices");
		_apprenticeBtn.ButtonPressed = true;
		_apprenticeBtn.Toggled += (on) => FilterToggled?.Invoke("Apprentices", on);
		AddChild(_apprenticeBtn);

		var sep = new VSeparator();
		sep.Modulate = new Color(1, 1, 1, 0.15f);
		AddChild(sep);

		// ── Navigation buttons ──
		_walkBtn = MakeToggleButton("Walk");
		_walkBtn.Toggled += (on) => { if (!_suppressToggleEvent) WalkToggled?.Invoke(); };
		AddChild(_walkBtn);

		_overviewBtn = MakeNavButton("Overview");
		AddChild(_overviewBtn);
	}

	private Button MakeToggleButton(string text)
	{
		var btn = new Button
		{
			Text = text,
			ToggleMode = true,
			ButtonPressed = false,
		};
		StyleButton(btn, activeBg: BtnActive);
		return btn;
	}

	private Button MakeNavButton(string text)
	{
		var btn = new Button
		{
			Text = text,
			ToggleMode = false,
		};
		StyleButton(btn, activeBg: BtnActive);
		btn.Pressed += () => OverviewClicked?.Invoke();
		return btn;
	}

	private void StyleButton(Button btn, Color activeBg)
	{
		btn.AddThemeFontSizeOverride("font_size", 11);
		btn.AddThemeColorOverride("font_color", TextGray);
		btn.AddThemeColorOverride("font_hover_color", TextWhite);
		btn.AddThemeColorOverride("font_pressed_color", Gold);

		var normal = new StyleBoxFlat
		{
			BgColor = BtnNormal,
			CornerRadiusTopLeft = 5,
			CornerRadiusTopRight = 5,
			CornerRadiusBottomLeft = 5,
			CornerRadiusBottomRight = 5,
			ContentMarginLeft = 10,
			ContentMarginRight = 10,
			ContentMarginTop = 4,
			ContentMarginBottom = 4,
		};
		var active = (StyleBoxFlat)normal.Duplicate();
		active.BgColor = activeBg;
		var hover = (StyleBoxFlat)normal.Duplicate();
		hover.BgColor = new Color(0.2f, 0.22f, 0.26f, 0.95f);

		btn.AddThemeStyleboxOverride("normal", normal);
		btn.AddThemeStyleboxOverride("hover", hover);
		btn.AddThemeStyleboxOverride("pressed", active);
		btn.AddThemeStyleboxOverride("hover_pressed", active);
		btn.AddThemeStyleboxOverride("focus", normal);
	}

	public void UpdateWalkState(bool inWalkMode)
	{
		_suppressToggleEvent = true;
		_walkBtn.ButtonPressed = inWalkMode;
		_suppressToggleEvent = false;
		var bg = _walkBtn.GetThemeStylebox("pressed") as StyleBoxFlat;
		if (bg is not null)
		{
			bg.BgColor = inWalkMode ? WalkActive : BtnActive;
			// Force a redraw so the colour change shows immediately.
			_walkBtn.AddThemeStyleboxOverride("pressed", bg);
		}
	}
}