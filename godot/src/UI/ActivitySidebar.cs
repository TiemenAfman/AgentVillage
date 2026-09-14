using System;
using System.Collections.Generic;
using Godot;
using Promptholm.Data.Models;

namespace Promptholm.UI;

/// <summary>
/// Right-hand sidebar showing live session states: "WAITING FOR YOU" and "NOW BUILDING".
/// Each session card is clickable and fires BuildingSelected on the EventBus.
/// </summary>
public partial class ActivitySidebar : PanelContainer
{
	private VBoxContainer _waitingContainer = null!;
	private VBoxContainer _buildingContainer = null!;
	private Label _waitingHeader = null!;
	private Label _buildingHeader = null!;

	/// <summary>Active activity-type filters (Code / Cowork / Apprentices). All on by default.</summary>
	private readonly HashSet<string> _activeFilters = new() { "Code", "Cowork", "Apprentices" };

	public event Action<string>? SessionClicked;

	private static readonly Color TextWhite = new(0.92f, 0.90f, 0.85f);
	private static readonly Color TextGray = new(0.55f, 0.55f, 0.55f);
	private static readonly Color TextGold = new(0.85f, 0.72f, 0.35f);
	private static readonly Color BgDark = new(0.08f, 0.10f, 0.12f, 0.88f);
	private static readonly Color CardBg = new(0.13f, 0.15f, 0.18f, 0.9f);
	private static readonly Color CardHover = new(0.18f, 0.20f, 0.24f, 0.95f);
	private static readonly Color WaitingDot = new(0.95f, 0.75f, 0.30f);
	private static readonly Color BuildingDot = new(0.3f, 0.82f, 0.45f);

	public override void _Ready()
	{
		BuildUI();
		MouseFilter = Control.MouseFilterEnum.Pass;
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
			ContentMarginLeft = 12,
			ContentMarginRight = 12,
			ContentMarginTop = 14,
			ContentMarginBottom = 14,
		};
		AddThemeStyleboxOverride("panel", bg);

		var margin = new MarginContainer();
		AddChild(margin);

		var root = new VBoxContainer();
		root.AddThemeConstantOverride("separation", 6);
		margin.AddChild(root);

		// ── Waiting section ──
		_waitingHeader = new Label
		{
			Text = "WAITING FOR YOU",
			Modulate = WaitingDot,
		};
		_waitingHeader.AddThemeFontSizeOverride("font_size", 10);
		root.AddChild(_waitingHeader);

		_waitingContainer = new VBoxContainer();
		_waitingContainer.AddThemeConstantOverride("separation", 4);
		root.AddChild(_waitingContainer);

		var sep1 = new HSeparator { Modulate = new Color(1, 1, 1, 0.06f) };
		root.AddChild(sep1);

		// ── Building section ──
		_buildingHeader = new Label
		{
			Text = "NOW BUILDING",
			Modulate = BuildingDot,
		};
		_buildingHeader.AddThemeFontSizeOverride("font_size", 10);
		root.AddChild(_buildingHeader);

		_buildingContainer = new VBoxContainer();
		_buildingContainer.AddThemeConstantOverride("separation", 4);
		root.AddChild(_buildingContainer);
	}

	public void SetFilter(string category, bool enabled)
	{
		if (enabled)
			_activeFilters.Add(category);
		else
			_activeFilters.Remove(category);
	}

	public void UpdateSessions(VillageData data)
	{
		ClearContainer(_waitingContainer);
		ClearContainer(_buildingContainer);

		int waitingCount = 0;
		int buildingCount = 0;

		foreach (var b in data.Buildings)
		{
			bool visible = IsVisibleUnderFilters(b);
			if (!visible) continue;

			if (b.Waiting is not null)
			{
				waitingCount++;
				_waitingContainer.AddChild(MakeSessionCard(b, isWaiting: true));
			}
			else if (b.Active)
			{
				buildingCount++;
				_buildingContainer.AddChild(MakeSessionCard(b, isWaiting: false));
			}
		}

		_waitingHeader.Text = waitingCount > 0
			? $"WAITING FOR YOU ({waitingCount})"
			: "WAITING FOR YOU";
		_buildingHeader.Text = buildingCount > 0
			? $"NOW BUILDING ({buildingCount})"
			: "NOW BUILDING";

		if (waitingCount == 0)
			_waitingContainer.AddChild(MakeEmptyLabel("All settlers are busy."));
		if (buildingCount == 0)
			_buildingContainer.AddChild(MakeEmptyLabel("No active sessions."));
	}

	/// <summary>
	/// Derived activity type per building (see Kind/Skills data in BuildingData):
	/// houses → Code, sheds → Cowork, buildings with Jira/Issue skills → Apprentices.
	/// A session shows if ANY active filter matches it.
	/// </summary>
	private bool IsVisibleUnderFilters(BuildingData b)
	{
		if (_activeFilters.Count == 0)
			return false;

		if (_activeFilters.Contains("Code") && b.Kind == "house")
			return true;
		if (_activeFilters.Contains("Cowork") && b.Kind == "shed")
			return true;
		if (_activeFilters.Contains("Apprentices") && (b.Skills.Jira || b.Skills.Issue))
			return true;

		// Unclassified sessions default to "Code" so nothing is ever hidden by accident.
		return _activeFilters.Contains("Code");
	}

	private PanelContainer MakeSessionCard(BuildingData b, bool isWaiting)
	{
		var card = new PanelContainer();
		card.MouseFilter = Control.MouseFilterEnum.Stop;

		var cardBg = new StyleBoxFlat
		{
			BgColor = CardBg,
			CornerRadiusTopLeft = 6,
			CornerRadiusTopRight = 6,
			CornerRadiusBottomLeft = 6,
			CornerRadiusBottomRight = 6,
			ContentMarginLeft = 10,
			ContentMarginRight = 10,
			ContentMarginTop = 6,
			ContentMarginBottom = 6,
		};
		card.AddThemeStyleboxOverride("panel", cardBg);

		// Hover effect
		var hoverBg = (StyleBoxFlat)cardBg.Duplicate();
		hoverBg.BgColor = CardHover;

		card.MouseEntered += () => card.AddThemeStyleboxOverride("panel", hoverBg);
		card.MouseExited += () => card.AddThemeStyleboxOverride("panel", cardBg);

		// Click handler
		if (!string.IsNullOrEmpty(b.SessionId))
		{
			var sid = b.SessionId;
			card.GuiInput += (input) =>
			{
				if (input is InputEventMouseButton mb && mb.Pressed && mb.ButtonIndex == MouseButton.Left)
					SessionClicked?.Invoke(sid);
			};
		}

		var row = new HBoxContainer();
		row.AddThemeConstantOverride("separation", 8);
		card.AddChild(row);

		// Status dot
		var dot = new Label
		{
			Text = "●",
			Modulate = isWaiting ? WaitingDot : BuildingDot,
			VerticalAlignment = VerticalAlignment.Center,
		};
		dot.AddThemeFontSizeOverride("font_size", 10);
		row.AddChild(dot);

		// Info column
		var info = new VBoxContainer();
		info.AddThemeConstantOverride("separation", 1);
		row.AddChild(info);

		var name = b.Name ?? b.Title ?? b.Id;
		var nameLabel = new Label
		{
			Text = name,
			Modulate = TextWhite,
		};
		nameLabel.AddThemeFontSizeOverride("font_size", 12);
		info.AddChild(nameLabel);

		string detail;
		if (isWaiting)
		{
			var waitingText = b.Waiting?.ToString() ?? "unknown";
			if (waitingText.Length > 50)
				waitingText = waitingText[..47] + "...";
			detail = waitingText;
		}
		else
		{
			detail = string.IsNullOrWhiteSpace(b.Cwd) ? "building..." : ShortenPath(b.Cwd);
		}
		var detailLabel = new Label
		{
			Text = detail,
			Modulate = TextGray,
		};
		detailLabel.AddThemeFontSizeOverride("font_size", 10);
		info.AddChild(detailLabel);

		// Duration on the right
		string duration = FormatDuration(b);
		if (!string.IsNullOrEmpty(duration))
		{
			var durLabel = new Label
			{
				Text = duration,
				Modulate = TextGray,
				VerticalAlignment = VerticalAlignment.Center,
			};
			durLabel.AddThemeFontSizeOverride("font_size", 10);
			row.AddChild(durLabel);
		}

		return card;
	}

	private static Label MakeEmptyLabel(string text)
	{
		var label = new Label
		{
			Text = text,
			Modulate = TextGray,
		};
		label.AddThemeFontSizeOverride("font_size", 11);
		return label;
	}

	private static string ShortenPath(string cwd)
	{
		// Show last two segments: ".../project/src" → "project/src"
		var parts = cwd.Replace("\\", "/").Split('/');
		if (parts.Length <= 2)
			return cwd;
		return $"…/{parts[^2]}/{parts[^1]}";
	}

	private static string FormatDuration(BuildingData b)
	{
		if (string.IsNullOrWhiteSpace(b.StartedAt))
			return "";

		// Try epoch seconds
		if (double.TryParse(b.StartedAt, System.Globalization.NumberStyles.Float,
			System.Globalization.CultureInfo.InvariantCulture, out var epoch))
		{
			var elapsed = DateTimeOffset.UtcNow.ToUnixTimeSeconds() - (long)epoch;
			if (elapsed < 60) return $"{elapsed}s";
			if (elapsed < 3600) return $"{elapsed / 60}m";
			return $"{elapsed / 3600}h";
		}

		// Try ISO-8601
		if (DateTimeOffset.TryParse(b.StartedAt, out var dto))
		{
			var elapsed = DateTimeOffset.UtcNow - dto;
			if (elapsed.TotalMinutes < 1) return $"{(int)elapsed.TotalSeconds}s";
			if (elapsed.TotalHours < 1) return $"{(int)elapsed.TotalMinutes}m";
			return $"{(int)elapsed.TotalHours}h";
		}

		return "";
	}

	private static void ClearContainer(Node container)
	{
		foreach (var child in container.GetChildren())
		{
			container.RemoveChild(child);
			child.QueueFree();
		}
	}
}
