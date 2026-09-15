using System;
using Godot;
using Promptholm.UI;

namespace Promptholm.Tools;

/// <summary>
/// Headless check that the island HUD actually shows the village it is standing on.
///
/// This exists because of a real bug: both start-up paths in Main called BuildWorld directly
/// and never published on the EventBus, while IslandHud only updates on that signal. The
/// result was a fully built town of 163 buildings under a card reading
/// "0 settlers / 0 apprentices / 0 districts" — the numbers (97 / 351 / 12) were sitting in
/// res://village.json the whole time. Asserting on the rendered label text is the only way to
/// catch that class of bug: every individual piece was working.
///
///   Godot..._console.exe --headless --path &lt;godot dir&gt; --script res://src/Tools/VerifyHudRunner.cs
/// </summary>
public partial class VerifyHudRunner : SceneTree
{
	private int _ticks;
	private int _fails;
	private Main? _main;

	public override void _Initialize()
	{
	}

	public override bool _Process(double delta)
	{
		_ticks++;
		try
		{
			if (_ticks == 1)
			{
				_main = new Main { Name = "Main" };
				Root.AddChild(_main);
			}
			else if (_ticks == 4)
			{
				RunChecks();
				Finish();
			}
		}
		catch (Exception ex)
		{
			GD.PushError($"EXCEPTION during HUD verification: {ex}");
			Quit(1);
		}
		return false;
	}

	private void RunChecks()
	{
		var hud = _main!.GetNodeOrNull<IslandHud>("IslandHud");
		Check(hud is not null, "IslandHud is mounted under Main");
		if (hud is null)
			return;

		// The card builds its labels in code with no stable names, so the text is what we read.
		var labels = new System.Collections.Generic.List<Label>();
		Collect(hud, labels);
		GD.Print($"hud labels   : {labels.Count}");

		CheckStat(labels, "settlers");
		CheckStat(labels, "apprentices");
		CheckStat(labels, "districts");

		var founded = Find(labels, "Founded");
		Check(founded is not null, "island card shows a Founded line");
		Check(founded is not null && founded.Text.Trim() != "Founded —",
			$"Founded line carries the real date (\"{founded?.Text}\")");
	}

	/// <summary>Asserts a "[ N thing ]" pill exists and that N is not the constructor's zero.</summary>
	private void CheckStat(System.Collections.Generic.List<Label> labels, string noun)
	{
		var label = Find(labels, noun);
		if (label is null)
		{
			Check(false, $"island card has a {noun} pill");
			return;
		}

		string text = label.Text;
		bool populated = !text.Contains("[ 0 ", StringComparison.Ordinal);
		Check(populated, $"{noun} pill reflects the loaded village (\"{text}\")");
	}

	private static Label? Find(System.Collections.Generic.List<Label> labels, string needle)
	{
		foreach (var label in labels)
			if (label.Text.Contains(needle, StringComparison.OrdinalIgnoreCase))
				return label;
		return null;
	}

	private static void Collect(Node node, System.Collections.Generic.List<Label> into)
	{
		if (node is Label label)
			into.Add(label);
		foreach (var child in node.GetChildren())
			Collect(child, into);
	}

	private void Check(bool ok, string what)
	{
		if (ok)
		{
			GD.Print($"  [OK]   {what}");
		}
		else
		{
			GD.PushError($"  [FAIL] {what}");
			_fails++;
		}
	}

	private void Finish()
	{
		if (_fails == 0)
		{
			GD.Print("OK - island HUD reflects the village that was actually built");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}
	}
}
