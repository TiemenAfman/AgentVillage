using Godot;
using Promptholm.Data.Models;

namespace Promptholm.UI;

/// <summary>
/// Top-left island status card: "THE LIVING ISLAND" header, stats pills, milestone badge.
/// Updates dynamically when VillageData arrives via EventBus.
/// </summary>
public partial class IslandCard : PanelContainer
{
	private Label _titleLabel = null!;
	private Label _nameLabel = null!;
	private Label _liveLabel = null!;
	private Label _foundedLabel = null!;
	private Label _settlersLabel = null!;
	private Label _apprenticesLabel = null!;
	private Label _districtsLabel = null!;
	private Label _milestoneLabel = null!;
	private PanelContainer _milestonePanel = null!;

	private static readonly Color Gold = new(0.85f, 0.72f, 0.35f);
	private static readonly Color GoldDim = new(0.65f, 0.55f, 0.28f);
	private static readonly Color Green = new(0.3f, 0.82f, 0.45f);
	private static readonly Color TextWhite = new(0.92f, 0.90f, 0.85f);
	private static readonly Color TextGray = new(0.55f, 0.55f, 0.55f);
	private static readonly Color BgDark = new(0.08f, 0.10f, 0.12f, 0.88f);
	private static readonly Color PillBg = new(0.15f, 0.17f, 0.20f, 0.9f);
	private static readonly Color MilestoneBg = new(0.22f, 0.18f, 0.08f, 0.95f);

	public override void _Ready()
	{
		BuildUI();
		MouseFilter = Control.MouseFilterEnum.Stop;
	}

	private void BuildUI()
	{
		var bg = new StyleBoxFlat
		{
			BgColor = BgDark,
			CornerRadiusTopLeft = 10,
			CornerRadiusTopRight = 10,
			CornerRadiusBottomLeft = 10,
			CornerRadiusBottomRight = 10,
			BorderColor = GoldDim,
			BorderWidthTop = 1,
			BorderWidthBottom = 1,
			BorderWidthLeft = 1,
			BorderWidthRight = 1,
			ContentMarginLeft = 18,
			ContentMarginRight = 18,
			ContentMarginTop = 14,
			ContentMarginBottom = 14,
		};
		AddThemeStyleboxOverride("panel", bg);

		var margin = new MarginContainer();
		AddChild(margin);

		var root = new VBoxContainer();
		root.AddThemeConstantOverride("separation", 4);
		margin.AddChild(root);

		// ── Header row ──
		_titleLabel = new Label
		{
			Text = "THE LIVING ISLAND",
			Modulate = GoldDim,
		};
		_titleLabel.AddThemeFontSizeOverride("font_size", 10);
		root.AddChild(_titleLabel);

		var headerRow = new HBoxContainer();
		headerRow.AddThemeConstantOverride("separation", 10);
		root.AddChild(headerRow);

		_nameLabel = new Label
		{
			Text = "Promptholm",
			Modulate = TextWhite,
		};
		_nameLabel.AddThemeFontSizeOverride("font_size", 22);
		_nameLabel.SizeFlagsHorizontal = SizeFlags.ExpandFill;
		headerRow.AddChild(_nameLabel);

		_liveLabel = new Label
		{
			Text = "● LIVE",
			Modulate = Green,
			VerticalAlignment = VerticalAlignment.Center,
		};
		_liveLabel.AddThemeFontSizeOverride("font_size", 11);
		headerRow.AddChild(_liveLabel);

		// ── Founded date ──
		_foundedLabel = new Label
		{
			Text = "Founded —",
			Modulate = TextGray,
		};
		_foundedLabel.AddThemeFontSizeOverride("font_size", 11);
		root.AddChild(_foundedLabel);

		// ── Separator ──
		var sep = new HSeparator { Modulate = new Color(1, 1, 1, 0.08f) };
		root.AddChild(sep);

		// ── Stats pills ──
		var statsRow = new HBoxContainer();
		statsRow.AddThemeConstantOverride("separation", 6);
		root.AddChild(statsRow);

		_settlersLabel = MakePill(statsRow, "[ 0 settlers ]");
		_apprenticesLabel = MakePill(statsRow, "[ 0 apprentices ]");
		_districtsLabel = MakePill(statsRow, "[ 0 districts ]");

		// ── Milestone badge ──
		_milestonePanel = new PanelContainer();
		_milestonePanel.Visible = false;
		root.AddChild(_milestonePanel);

		var milestoneBg = new StyleBoxFlat
		{
			BgColor = MilestoneBg,
			CornerRadiusTopLeft = 6,
			CornerRadiusTopRight = 6,
			CornerRadiusBottomLeft = 6,
			CornerRadiusBottomRight = 6,
			ContentMarginLeft = 10,
			ContentMarginRight = 10,
			ContentMarginTop = 5,
			ContentMarginBottom = 5,
		};
		_milestonePanel.AddThemeStyleboxOverride("panel", milestoneBg);

		_milestoneLabel = new Label
		{
			Modulate = Gold,
		};
		_milestoneLabel.AddThemeFontSizeOverride("font_size", 11);
		_milestonePanel.AddChild(_milestoneLabel);
	}

	private static Label MakePill(Node parent, string text)
	{
		var pill = new PanelContainer();
		var bg = new StyleBoxFlat
		{
			BgColor = PillBg,
			CornerRadiusTopLeft = 6,
			CornerRadiusTopRight = 6,
			CornerRadiusBottomLeft = 6,
			CornerRadiusBottomRight = 6,
			ContentMarginLeft = 8,
			ContentMarginRight = 8,
			ContentMarginTop = 3,
			ContentMarginBottom = 3,
		};
		pill.AddThemeStyleboxOverride("panel", bg);

		var label = new Label
		{
			Text = text,
			Modulate = TextGray,
		};
		label.AddThemeFontSizeOverride("font_size", 11);
		pill.AddChild(label);
		parent.AddChild(pill);
		return label;
	}

	public void UpdateStats(VillageData data)
	{
		var stats = data.Stats;
		_nameLabel.Text = data.Island.Name ?? "Promptholm";

		_foundedLabel.Text = string.IsNullOrWhiteSpace(data.Island.FoundedAt)
			? "Founded —"
			: $"Founded {data.Island.FoundedAt}";

		_settlersLabel.Text = $"[ {stats.Settlers} settlers ]";
		_apprenticesLabel.Text = $"[ {stats.Apprentices} apprentices ]";
		_districtsLabel.Text = $"[ {stats.Districts} districts ]";

		var ms = stats.NextMilestone;
		if (ms is not null && !string.IsNullOrWhiteSpace(ms.Label))
		{
			_milestonePanel.Visible = true;
			_milestoneLabel.Text = $"★ {ms.Label} in {ms.Remaining}";
		}
		else
		{
			_milestonePanel.Visible = false;
		}
	}
}
