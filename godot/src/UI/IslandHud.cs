using System;
using Godot;
using Promptholm.Core;
using Promptholm.Data.Models;
using Promptholm.Walking;

namespace Promptholm.UI;

/// <summary>
/// Unified island-wide HUD overlay. A CanvasLayer (layer 100) that sits above the 3D world
/// and composes the top-left island card, the top-right mode bar and the right-hand
/// activity sidebar. Subscribes to EventBus.VillageDataLoaded to keep stats/sessions fresh.
/// </summary>
public partial class IslandHud : CanvasLayer
{
	private IslandCard _islandCard = null!;
	private ActivitySidebar _activitySidebar = null!;
	private TopNavBar _topNavBar = null!;

	private WalkModeManager? _walkManager;
	private FreeFlyCamera? _flyCamera;
	private bool _lastWalkState;

	/// <summary>Default fly-view position (matches Main.cs camera setup).</summary>
	private static readonly Vector3 DefaultCameraPos = new(32.0f, 15.0f, 60.0f);
	private static readonly Vector3 DefaultCameraTarget = Vector3.Zero;

	public override void _Ready()
	{
		Layer = 100;
		Name = "IslandHud";

		BuildComponents();

		FindWorldReferences();
		SubscribeToEvents();

		_lastWalkState = _walkManager?.InWalkMode ?? false;
		_topNavBar.UpdateWalkState(_lastWalkState);
	}

	public override void _ExitTree()
	{
		UnsubscribeFromEvents();
	}

	public override void _Process(double delta)
	{
		// Reflect Tab-key toggles made outside the HUD (WalkModeManager handles Tab itself).
		bool walkState = _walkManager?.InWalkMode ?? false;
		if (walkState != _lastWalkState)
		{
			_lastWalkState = walkState;
			_topNavBar.UpdateWalkState(walkState);
		}
	}

	private void BuildComponents()
	{
		// ── IslandCard: top-left ──
		_islandCard = new IslandCard();
		_islandCard.SetAnchorsPreset(Control.LayoutPreset.TopLeft);
		_islandCard.OffsetLeft = 16;
		_islandCard.OffsetTop = 16;
		_islandCard.GrowHorizontal = Control.GrowDirection.End;
		_islandCard.GrowVertical = Control.GrowDirection.End;
		_islandCard.MouseFilter = Control.MouseFilterEnum.Pass;
		AddChild(_islandCard);

		// ── TopNavBar: top-right ──
		_topNavBar = new TopNavBar();
		_topNavBar.SetAnchorsPreset(Control.LayoutPreset.TopRight);
		_topNavBar.OffsetLeft = -16;
		_topNavBar.OffsetTop = 16;
		_topNavBar.OffsetRight = -16;
		_topNavBar.GrowHorizontal = Control.GrowDirection.Begin;
		_topNavBar.GrowVertical = Control.GrowDirection.End;
		_topNavBar.MouseFilter = Control.MouseFilterEnum.Pass;
		AddChild(_topNavBar);

		// ── ActivitySidebar: right edge, vertically centred ──
		_activitySidebar = new ActivitySidebar();
		_activitySidebar.AnchorLeft = 1;
		_activitySidebar.AnchorTop = 0.5f;
		_activitySidebar.AnchorRight = 1;
		_activitySidebar.AnchorBottom = 0.5f;
		_activitySidebar.OffsetTop = -140;
		_activitySidebar.OffsetBottom = -140;
		_activitySidebar.GrowHorizontal = Control.GrowDirection.Begin;
		_activitySidebar.GrowVertical = Control.GrowDirection.Both;
		_activitySidebar.MouseFilter = Control.MouseFilterEnum.Pass;
		AddChild(_activitySidebar);
	}

	private void FindWorldReferences()
	{
		var main = GetParent();
		if (main is null) return;
		_walkManager = main.GetNodeOrNull<WalkModeManager>("WalkModeManager");
		_flyCamera = main.GetNodeOrNull<FreeFlyCamera>("FreeFlyCamera");
	}

	private void SubscribeToEvents()
	{
		if (EventBus.Instance is not null)
			EventBus.Instance.VillageDataLoaded += OnVillageDataLoaded;

		_activitySidebar.SessionClicked += OnSessionClicked;
		_topNavBar.FilterToggled += _activitySidebar.SetFilter;
		_topNavBar.WalkToggled += OnWalkToggled;
		_topNavBar.OverviewClicked += OnOverviewClicked;
	}

	private void UnsubscribeFromEvents()
	{
		if (EventBus.Instance is not null)
			EventBus.Instance.VillageDataLoaded -= OnVillageDataLoaded;

		_activitySidebar.SessionClicked -= OnSessionClicked;
		_topNavBar.FilterToggled -= _activitySidebar.SetFilter;
		_topNavBar.WalkToggled -= OnWalkToggled;
		_topNavBar.OverviewClicked -= OnOverviewClicked;
	}

	private void OnVillageDataLoaded(VillageData data)
	{
		_islandCard.UpdateStats(data);
		_activitySidebar.UpdateSessions(data);
	}

	private void OnSessionClicked(string sessionId)
	{
		EventBus.Instance?.PublishBuildingSelected(sessionId);
	}

	private void OnWalkToggled()
	{
		if (_walkManager is null)
		{
			FindWorldReferences();
			if (_walkManager is null) return;
		}

		if (_walkManager.InWalkMode)
			_walkManager.ExitWalkMode();
		else
			_walkManager.EnterWalkMode();

		_lastWalkState = _walkManager.InWalkMode;
		_topNavBar.UpdateWalkState(_lastWalkState);
	}

	private void OnOverviewClicked()
	{
		if (_walkManager is not null && _walkManager.InWalkMode)
			_walkManager.ExitWalkMode();

		if (_flyCamera is null)
		{
			FindWorldReferences();
			if (_flyCamera is null) return;
		}

		_flyCamera.Initialize(DefaultCameraPos, DefaultCameraTarget);
		_flyCamera.MakeCurrent();

		_lastWalkState = false;
		_topNavBar.UpdateWalkState(false);
	}
}