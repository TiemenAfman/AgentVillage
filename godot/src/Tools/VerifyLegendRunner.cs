using System.Linq;
using Godot;
using Promptholm.UI;

namespace Promptholm.Tools;

/// <summary>
/// Headless checks for the island HUD: the walk toggle must not feed back into itself, the
/// bar must not hold keyboard focus (Space belongs to the settler), and the controls legend
/// must swap with the mode. Run after a build with:
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyLegendRunner.cs
/// </summary>
public partial class VerifyLegendRunner : SceneTree
{
	private int _fails;
	private bool _done;

	// In _Process, not _Initialize: a Control added there has not had its _Ready yet, so the
	// bar would still be a bag of nulls.
	public override bool _Process(double delta)
	{
		if (_done)
			return false;
		_done = true;

		var bar = new TopNavBar { Name = "TopNavBar" };
		Root.AddChild(bar);

		int echoes = 0;
		bar.WalkToggled += () => echoes++;

		// The loop that flipped the island between walking and the sky view every frame:
		// UpdateWalkState assigned ButtonPressed, that emitted Toggled, and the handler
		// toggled the mode right back (#60).
		bar.UpdateWalkState(true);
		bar.UpdateWalkState(false);
		Check(echoes == 0, $"UpdateWalkState does not re-enter WalkToggled ({echoes} echo(s))");

		int focusable = bar.GetChildren()
			.OfType<Button>()
			.Count(b => b.FocusMode != Control.FocusModeEnum.None);
		Check(focusable == 0, $"no nav-bar button keeps keyboard focus ({focusable} would swallow Space)");

		var legend = new ControlsLegend();
		Root.AddChild(legend);

		string fly = LegendText(legend);
		legend.SetWalkMode(true);
		string walk = LegendText(legend);

		Check(fly.Contains("WASD Fly") && !fly.Contains("Crouch"), $"sky-view legend lists the fly keys [{fly}]");
		Check(walk.Contains("C Crouch") && walk.Contains("Space Jump"), $"walk legend lists crouch and jump [{walk}]");
		Check(walk.Contains("Tab Sky view"), "walk legend names the way back out");

		if (_fails == 0)
		{
			GD.Print("OK - HUD toggle is loop-free, focus-free, and the legend follows the mode");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}

		return false;
	}

	/// <summary>Flattens the legend row back to "KEY What KEY What ..." for asserting on.</summary>
	private static string LegendText(ControlsLegend legend)
	{
		var row = legend.GetNodeOrNull<HBoxContainer>("Keys");
		if (row is null)
			return string.Empty;

		return string.Join(" ", row.GetChildren()
			.OfType<Label>()
			.Select(l => l.Text)
			.Where(t => t != "\u00b7"));
	}

	private void Check(bool ok, string what)
	{
		if (ok)
		{
			GD.Print($"  [OK] {what}");
		}
		else
		{
			GD.PushError($"  [FAIL] {what}");
			_fails++;
		}
	}
}
