using System;
using System.Collections.Generic;
using System.Globalization;
using Godot;
using Promptholm.Core;
using Promptholm.Data;
using Promptholm.Data.Models;

namespace Promptholm.UI;

/// <summary>
/// Overlay UI for inspecting a settler's house. Listens to EventBus.BuildingSelected
/// (fly-mode click or walk-mode [E] near the door), looks the building up in the active
/// VillageData and pops up the dossier: settler header, district/branch badges, model
/// style + tier + status, stats grid and the apprentice (shed) list. Closes on Esc,
/// clicking outside the panel, or the [X] button. Also owns the walk-mode "[E] Inspect …"
/// prompt bar fed by EventBus.InteractionPromptChanged.
/// </summary>
[GlobalClass]
public partial class BuildingDossierUI : CanvasLayer
{
	private VillageData? _village;
	private Dictionary<string, BuildingData>? _byId;

	private Control? _overlay;
	private Control? _dim;
	private PanelContainer? _panel;
	private Label? _lblName;
	private Label? _lblSession;
	private Label? _lblDistrict;
	private Label? _lblBranch;
	private Label? _lblModel;
	private Label? _lblTier;
	private Label? _lblStatus;
	private Label? _statTurns;
	private Label? _statTools;
	private Label? _statFiles;
	private Label? _statInput;
	private Label? _statOutput;
	private Label? _statCache;
	private VBoxContainer? _apprenticeBox;
	private PanelContainer? _promptBar;
	private Label? _promptLabel;
	private Tween? _openTween;
	private string? _currentId;

	/// <summary>True while the dossier panel is on screen.</summary>
	public bool IsOpen => _overlay is { Visible: true };

	/// <summary>The id of the building currently shown, or null.</summary>
	public string? CurrentBuildingId => _currentId;

	public override void _Ready()
	{
		if (Engine.IsEditorHint())
			return;

		Layer = 10;
		BuildUi();

		if (EventBus.Instance is not null)
		{
			EventBus.Instance.VillageDataLoaded += OnVillageDataLoaded;
			EventBus.Instance.BuildingSelected += OnBuildingSelected;
			EventBus.Instance.InteractionPromptChanged += OnInteractionPromptChanged;
		}

		// The client may have loaded a village before this node existed.
		if (GetNodeOrNull<VillageClient>("/root/VillageClient")?.LastData is VillageData data)
			SetVillage(data);
	}

	public override void _ExitTree()
	{
		if (EventBus.Instance is not null)
		{
			EventBus.Instance.VillageDataLoaded -= OnVillageDataLoaded;
			EventBus.Instance.BuildingSelected -= OnBuildingSelected;
			EventBus.Instance.InteractionPromptChanged -= OnInteractionPromptChanged;
		}
	}

	public override void _UnhandledInput(InputEvent @event)
	{
		if (@event is InputEventKey { Pressed: true, Keycode: Key.Escape } && IsOpen)
			CloseDossier();
	}

	/// <summary>Make this component the dossier for <paramref name="data"/> and refill an open panel.</summary>
	public void SetVillage(VillageData data)
	{
		_village = data;
		_byId = new Dictionary<string, BuildingData>(data.Buildings.Count, StringComparer.Ordinal);
		foreach (var b in data.Buildings)
		{
			if (string.IsNullOrWhiteSpace(b.Id))
				continue;
			_byId[b.Id] = b;
		}

		if (_currentId is null)
			return;
		if (!_byId.ContainsKey(_currentId))
			CloseDossier();
		else
			OpenDossier(_currentId);
	}

	/// <summary>Closes the dossier (bound to the [X] button, Esc and clicks outside).</summary>
	public void CloseDossier()
	{
		_currentId = null;
		_openTween?.Kill();
		_openTween = null;
		if (_overlay is not null)
			_overlay.Visible = false;
		if (_panel is not null)
		{
			_panel.Scale = Vector2.One;
			_panel.Modulate = Colors.White;
		}
		if (_dim is not null)
			_dim.Modulate = Colors.White;
	}

	// ---- event handlers -----------------------------------------------------

	private void OnVillageDataLoaded(VillageData village)
		=> SetVillage(village);

	private void OnBuildingSelected(string buildingId)
	{
		EnsureVillage();
		if (string.IsNullOrWhiteSpace(buildingId) || _byId is null || !_byId.TryGetValue(buildingId, out _))
		{
			GD.Print($"[DossierUI] no building with id '{buildingId}' in the active village");
			return;
		}
		OpenDossier(buildingId);
	}

	private void OnInteractionPromptChanged(string? text)
	{
		if (_promptBar is null || _promptLabel is null)
			return;
		_promptLabel.Text = text ?? "";
		_promptBar.Visible = !string.IsNullOrEmpty(text);
	}

	private void OnDimInput(InputEvent @event)
	{
		if (@event is InputEventMouseButton { ButtonIndex: MouseButton.Left, Pressed: true })
			CloseDossier();
	}

	// ---- dossier lifecycle --------------------------------------------------

	private void EnsureVillage()
	{
		if (_village is not null)
			return;
		if (GetNodeOrNull<VillageClient>("/root/VillageClient")?.LastData is VillageData data)
			SetVillage(data);
	}

	private void OpenDossier(string buildingId)
	{
		EnsureVillage();
		if (_byId is null || !_byId.TryGetValue(buildingId, out var b))
			return;

		_currentId = buildingId;
		Fill(b);

		if (_overlay is null)
			return;

		_overlay.Visible = true;
		if (_dim is not null)
			_dim.Modulate = new Color(1.0f, 1.0f, 1.0f, 0.0f);
		if (_panel is not null)
			_panel.Modulate = new Color(1.0f, 1.0f, 1.0f, 0.0f);

		CallDeferred(nameof(AnimateOpen));
	}

	/// <summary>Runs after the first layout frame: pivot is known, so the panel can pop from the centre.</summary>
	private void AnimateOpen()
	{
		_openTween?.Kill();
		if (_panel is null)
			return;

		_panel.PivotOffset = _panel.Size * 0.5f;
		_panel.Scale = new Vector2(0.9f, 0.9f);

		var tween = CreateTween();
		tween.SetParallel();
		if (_dim is not null)
			tween.TweenProperty(_dim, "modulate", new Color(1.0f, 1.0f, 1.0f, 1.0f), 0.18f);
		tween.TweenProperty(_panel, "modulate", new Color(1.0f, 1.0f, 1.0f, 1.0f), 0.18f);
		tween.TweenProperty(_panel, "scale", Vector2.One, 0.16f)
			.SetTrans(Tween.TransitionType.Back)
			.SetEase(Tween.EaseType.Out);
		_openTween = tween;
	}

	private void Fill(BuildingData b)
	{
		_lblName!.Text = string.IsNullOrWhiteSpace(b.Name) ? b.Label ?? b.Id : b.Name;

		_lblSession!.Text = string.IsNullOrWhiteSpace(b.Title)
			? string.IsNullOrWhiteSpace(b.SessionId) ? "—" : b.SessionId
			: b.Title;

		_lblDistrict!.Text = $"District    {ResolveDistrict(b)}";
		_lblBranch!.Text = $"Branch    {Narrow(b.GitBranch)}";
		_lblModel!.Text = PrettyModel(b);
		_lblTier!.Text = TitleCase(string.IsNullOrWhiteSpace(b.Tier) ? b.Kind : b.Tier);
		_lblStatus!.Text = b.Active ? "Active" : b.Archived ? "Archived" : "Inactive";

		_statTurns!.Text = Num(b.Stats.HumanTurns);
		_statTools!.Text = Num(b.Stats.ToolCalls);
		_statFiles!.Text = Num(b.Stats.FilesTouched);
		_statInput!.Text = Num(b.Stats.Tokens.Input);
		_statOutput!.Text = Num(b.Stats.Tokens.Output);
		_statCache!.Text = Num(b.Stats.Tokens.CacheRead + b.Stats.Tokens.CacheCreation);

		FillApprentices(b.Sheds);
	}

	private string ResolveDistrict(BuildingData b)
	{
		if (b.District is DistrictData dd && !string.IsNullOrWhiteSpace(dd.Name))
			return dd.Name;

		string? id = b.District?.ToString();
		if (!string.IsNullOrWhiteSpace(id) && _village?.Districts is not null)
		{
			foreach (var d in _village.Districts)
			{
				if (!string.Equals(d.Id, id, StringComparison.Ordinal))
					continue;
				return string.IsNullOrWhiteSpace(d.Name) ? id : d.Name;
			}
		}
		return "The Outlands";
	}

	private void FillApprentices(List<string>? sheds)
	{
		if (_apprenticeBox is null)
			return;

		foreach (var child in _apprenticeBox.GetChildren())
			child.QueueFree();

		if (sheds is null || sheds.Count == 0)
		{
			var none = new Label { Text = "None yet — this settler works alone." };
			none.AddThemeFontSizeOverride("font_size", 13);
			none.AddThemeColorOverride("font_color", new Color(0.62f, 0.66f, 0.72f));
			_apprenticeBox.AddChild(none);
			return;
		}

		foreach (var id in sheds)
		{
			string name = string.IsNullOrWhiteSpace(id) ? "An apprentice" : id;
			if (_byId is not null && _byId.TryGetValue(id, out var shed) && !string.IsNullOrWhiteSpace(shed.Name))
				name = shed.Name;

			var row = new HBoxContainer();
			row.AddThemeConstantOverride("separation", 6);
			var bullet = new Label { Text = "•" };
			bullet.AddThemeColorOverride("font_color", new Color(0.82f, 0.68f, 0.40f));
			row.AddChild(bullet);

			var label = new Label { Text = name };
			label.AddThemeFontSizeOverride("font_size", 13);
			row.AddChild(label);

			_apprenticeBox.AddChild(row);
		}
	}

	// ---- UI construction ----------------------------------------------------

	private void BuildUi()
	{
		_overlay = new Control
		{
			Name = "DossierOverlay",
			MouseFilter = Control.MouseFilterEnum.Stop,
			Visible = false,
		};
		_overlay.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
		AddChild(_overlay);

		_dim = new Panel { Name = "Dim", MouseFilter = Control.MouseFilterEnum.Stop };
		_dim.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
		_dim.AddThemeStyleboxOverride("panel", Flat(new Color(0.0f, 0.0f, 0.0f, 0.35f), 0));
		_dim.GuiInput += OnDimInput;
		_overlay.AddChild(_dim);

		var center = new CenterContainer { Name = "Center", MouseFilter = Control.MouseFilterEnum.Ignore };
		center.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
		_overlay.AddChild(center);

		_panel = new PanelContainer { Name = "DossierPanel", MouseFilter = Control.MouseFilterEnum.Stop };
		_panel.CustomMinimumSize = new Vector2(380.0f, 0.0f);
		_panel.AddThemeStyleboxOverride("panel", Flat(new Color(0.10f, 0.12f, 0.16f, 0.97f), 14, 20, 20, 18, 18));
		center.AddChild(_panel);

		var body = new VBoxContainer { Name = "Body" };
		_panel.AddChild(body);

		// Header row: identities left, close button right.
		var header = new HBoxContainer { Name = "Header" };
		body.AddChild(header);

		var titles = new VBoxContainer { Name = "Titles", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		header.AddChild(titles);

		_lblName = HeaderLabel("", 24);
		_lblName.Name = "SettlerName";
		titles.AddChild(_lblName);
		_lblSession = HeaderLabel("", 13);
		_lblSession.Name = "SessionTitle";
		titles.AddChild(_lblSession);

		var closeBtn = new Button
		{
			Name = "CloseButton",
			Text = "X",
			CustomMinimumSize = new Vector2(34.0f, 30.0f),
			// Keyboard focus here would swallow Space as ui_accept; Esc already closes (#60).
			FocusMode = Control.FocusModeEnum.None,
		};
		closeBtn.AddThemeStyleboxOverride("normal", Flat(new Color(0.22f, 0.26f, 0.32f), 8, 8, 8, 6, 6));
		closeBtn.AddThemeStyleboxOverride("hover", Flat(new Color(0.34f, 0.38f, 0.46f), 8, 8, 8, 6, 6));
		closeBtn.AddThemeStyleboxOverride("pressed", Flat(new Color(0.15f, 0.17f, 0.21f), 8, 8, 8, 6, 6));
		closeBtn.Pressed += CloseDossier;
		header.AddChild(closeBtn);

		// District + branch chips.
		var meta = new HBoxContainer { Name = "Meta" };
		meta.AddThemeConstantOverride("separation", 8);
		body.AddChild(meta);
		_lblDistrict = Badge("District    —");
		_lblDistrict.Name = "DistrictBadge";
		_lblBranch = Badge("Branch    —");
		_lblBranch.Name = "BranchBadge";
		meta.AddChild(_lblDistrict);
		meta.AddChild(_lblBranch);

		body.AddChild(ActionSeparator());

		var card = new PanelContainer { Name = "InfoCard" };
		card.AddThemeStyleboxOverride("panel", Flat(new Color(0.14f, 0.17f, 0.22f), 10, 10, 10, 10, 10));
		body.AddChild(card);

		var cardBox = new VBoxContainer { Name = "CardBody" };
		card.AddChild(cardBox);
		cardBox.AddChild(SectionLabel("Model & standing"));

		var infoGrid = new GridContainer { Name = "InfoGrid", Columns = 2 };
		infoGrid.AddThemeConstantOverride("h_separation", 8);
		cardBox.AddChild(infoGrid);

		_lblModel = InfoValue("—");
		_lblModel.Name = "ModelStyle";
		_lblTier = InfoValue("—");
		_lblTier.Name = "TierBadge";
		_lblStatus = InfoValue("—");
		_lblStatus.Name = "StatusBadge";
		AddInfoRow(infoGrid, "Model style", _lblModel);
		AddInfoRow(infoGrid, "Tier", _lblTier);
		AddInfoRow(infoGrid, "Status", _lblStatus);

		body.AddChild(ActionSeparator());

		body.AddChild(SectionLabel("Settler stats"));

		var stats = new GridContainer { Name = "StatsGrid", Columns = 2 };
		stats.AddThemeConstantOverride("h_separation", 16);
		body.AddChild(stats);

		_statTurns = StatValue("0");
		_statTurns.Name = "HumanTurns";
		_statTools = StatValue("0");
		_statTools.Name = "ToolCalls";
		_statFiles = StatValue("0");
		_statFiles.Name = "FilesTouched";
		_statInput = StatValue("0");
		_statInput.Name = "TokensInput";
		_statOutput = StatValue("0");
		_statOutput.Name = "TokensOutput";
		_statCache = StatValue("0");
		_statCache.Name = "TokensCache";
		AddStatRow(stats, "Human turns", _statTurns);
		AddStatRow(stats, "Tool calls", _statTools);
		AddStatRow(stats, "Files touched", _statFiles);
		AddStatRow(stats, "Tokens — input", _statInput);
		AddStatRow(stats, "Tokens — output", _statOutput);
		AddStatRow(stats, "Tokens — cache", _statCache);

		body.AddChild(ActionSeparator());

		body.AddChild(SectionLabel("Apprentices"));
		_apprenticeBox = new VBoxContainer { Name = "Apprentices" };
		_apprenticeBox.AddThemeConstantOverride("separation", 4);
		body.AddChild(_apprenticeBox);

		// Walk-mode interaction prompt, docked bottom-centre. It never swallows input so
		// clicks still reach the world while the bar is visible.
		_promptBar = new PanelContainer { Name = "InteractionPrompt", MouseFilter = Control.MouseFilterEnum.Ignore };
		_promptBar.AnchorLeft = 0.5f;
		_promptBar.AnchorRight = 0.5f;
		_promptBar.AnchorTop = 1.0f;
		_promptBar.AnchorBottom = 1.0f;
		_promptBar.OffsetLeft = -220.0f;
		_promptBar.OffsetRight = 220.0f;
		_promptBar.OffsetTop = -110.0f;
		_promptBar.OffsetBottom = -70.0f;
		_promptBar.GrowHorizontal = Control.GrowDirection.Both;
		_promptBar.AddThemeStyleboxOverride("panel", Flat(new Color(0.10f, 0.13f, 0.18f, 0.92f), 8, 12, 12, 8, 8));
		_promptBar.Visible = false;
		AddChild(_promptBar);

		_promptLabel = new Label
		{
			Name = "PromptText",
			HorizontalAlignment = HorizontalAlignment.Center,
			AutowrapMode = TextServer.AutowrapMode.WordSmart,
			TextOverrunBehavior = TextServer.OverrunBehavior.TrimEllipsis,
		};
		_promptLabel.AddThemeFontSizeOverride("font_size", 16);
		_promptLabel.AddThemeColorOverride("font_color", new Color(0.95f, 0.90f, 0.80f));
		_promptBar.AddChild(_promptLabel);
	}

	// ---- small label/director helpers ---------------------------------------

	private static void AddInfoRow(GridContainer grid, string caption, Label value)
	{
		grid.AddChild(InfoCaption(caption));
		grid.AddChild(value);
	}

	private static void AddStatRow(GridContainer grid, string caption, Label value)
	{
		grid.AddChild(StatCaption(caption));
		grid.AddChild(value);
	}

	private static Label HeaderLabel(string text, int size)
	{
		var l = new Label { Text = text };
		l.AddThemeFontSizeOverride("font_size", size);
		l.AddThemeColorOverride("font_color", new Color(0.96f, 0.94f, 0.88f));
		return l;
	}

	private static Label Badge(string text)
	{
		var l = new Label { Text = text, HorizontalAlignment = HorizontalAlignment.Center };
		l.AddThemeStyleboxOverride("normal", Flat(new Color(0.22f, 0.27f, 0.36f), 8, 10, 10, 5, 5));
		l.AddThemeFontSizeOverride("font_size", 12);
		l.AddThemeColorOverride("font_color", new Color(0.78f, 0.84f, 0.92f));
		return l;
	}

	private static Label SectionLabel(string text)
	{
		var l = new Label { Text = text };
		l.AddThemeFontSizeOverride("font_size", 13);
		l.AddThemeColorOverride("font_color", new Color(0.85f, 0.71f, 0.42f));
		return l;
	}

	private static Label InfoCaption(string text)
	{
		var l = new Label { Text = text };
		l.AddThemeFontSizeOverride("font_size", 13);
		l.AddThemeColorOverride("font_color", new Color(0.72f, 0.76f, 0.82f));
		return l;
	}

	private static Label InfoValue(string text)
	{
		var l = new Label { Text = text, HorizontalAlignment = HorizontalAlignment.Right };
		l.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
		l.AddThemeFontSizeOverride("font_size", 13);
		l.AddThemeColorOverride("font_color", new Color(0.94f, 0.92f, 0.86f));
		return l;
	}

	private static Label StatCaption(string text)
	{
		var l = new Label { Text = text };
		l.AddThemeFontSizeOverride("font_size", 13);
		l.AddThemeColorOverride("font_color", new Color(0.74f, 0.78f, 0.84f));
		return l;
	}

	private static Label StatValue(string text)
	{
		var l = new Label { Text = text, HorizontalAlignment = HorizontalAlignment.Right };
		l.SizeFlagsHorizontal = Control.SizeFlags.ExpandFill;
		l.AddThemeFontSizeOverride("font_size", 13);
		l.AddThemeColorOverride("font_color", new Color(0.86f, 0.94f, 0.86f));
		return l;
	}

	private static HSeparator ActionSeparator()
		=> new() { Modulate = new Color(1.0f, 1.0f, 1.0f, 0.15f) };

	private static StyleBoxFlat Flat(Color bg, int radius, int l = 12, int r = 12, int t = 10, int b = 10)
		=> new()
		{
			BgColor = bg,
			CornerRadiusTopLeft = radius,
			CornerRadiusTopRight = radius,
			CornerRadiusBottomRight = radius,
			CornerRadiusBottomLeft = radius,
			ContentMarginLeft = l,
			ContentMarginRight = r,
			ContentMarginTop = t,
			ContentMarginBottom = b,
		};

	// ---- formatting ---------------------------------------------------------

	private static string Num(double value)
		=> value.ToString("N0", CultureInfo.InvariantCulture);

	private static string PrettyModel(BuildingData b)
	{
		string m = string.IsNullOrWhiteSpace(b.Model) ? "" : b.Model.Trim();
		if (m.Length == 0 && b.Models is { Count: > 0 })
			m = string.Join(", ", b.Models.Keys);

		if (m.Length > 0)
		{
			var s = m.ToLowerInvariant();
			if (s.Contains("opus")) return "Opus";
			if (s.Contains("sonnet")) return "Sonnet";
			if (s.Contains("haiku")) return "Haiku";
		}
		return m.Length == 0 ? "—" : m;
	}

	private static string TitleCase(string s)
	{
		if (string.IsNullOrWhiteSpace(s))
			return "—";
		if (s.Length == 1)
			return char.ToUpperInvariant(s[0]).ToString();
		return char.ToUpperInvariant(s[0]) + s[1..];
	}

	private static string Narrow(string? s)
		=> string.IsNullOrWhiteSpace(s) ? "—" : s.Trim();
}