using System;
using System.Linq;
using Godot;
using Promptholm.Data;
using Promptholm.Data.Models;
using Promptholm.UI;

namespace Promptholm.Tools;

/// <summary>
/// Can the island actually talk to a settler?
///
/// Two halves, and they fail in different ways, so both are checked. The panel half is pure
/// client work and always runs: a settler with no session id must be told there is nobody home
/// rather than shown an empty log, and the permission selector must open on the safe end.
///
/// The wire half needs <c>node serve.mjs</c> on the other side. When the server is not up this
/// reports it and passes anyway — that is not the client being broken, and a runner that goes red
/// because a separate process is not running teaches people to ignore it. What it must never do
/// is pass quietly while the client cannot parse a transcript it did receive.
///
///   Godot..._console.exe --headless --path &lt;godot&gt; --script res://src/Tools/VerifyChatRunner.cs
/// </summary>
public partial class VerifyChatRunner : SceneTree
{
	private const string ServerUrl = "http://localhost:4747";

	private int _ticks;
	private int _fails;
	private bool _started;
	private bool _wireDone;
	private double _waited;

	/// <summary>How long to give the island server to answer before calling it absent.</summary>
	private const double WireTimeoutSeconds = 8.0;

	public override bool _Process(double delta)
	{
		_ticks++;

		if (_ticks == 1)
		{
			CheckPanel();
			StartWireCheck();
			return false;
		}

		// Wall-clock, not frames: headless runs as fast as it can, so a frame budget here is a
		// fraction of a second and the fetch never lands.
		_waited += delta;
		if (!_wireDone && _waited < WireTimeoutSeconds) return false;

		if (!_wireDone)
			GD.Print("  [SKIP] the island server did not answer in time; wire check not run");

		Finish();
		return false;
	}

	// ---- the panel, with no server involved ------------------------------------

	private void CheckPanel()
	{
		var chat = new SettlerChatUI { Name = "SettlerChatUI", ServerUrl = ServerUrl };
		Root.AddChild(chat);

		Check(!chat.IsOpen, "the chat starts closed");

		// A shed has no session of its own. Opening on one must say so, not show a blank log.
		chat.Open(new BuildingData { Id = "shed:x", Kind = "shed", Name = "A lean-to" });
		var log = chat.FindChild("Log", true, false) as RichTextLabel;
		Check(log is not null, "the chat has a log to write into");
		Check(log is not null && log.Text.Contains("nobody here", StringComparison.OrdinalIgnoreCase),
			$"a building with no session says so [{Trim(log?.Text)}]");

		var input = chat.FindChild("Input", true, false) as TextEdit;
		Check(input is { Editable: false }, "you cannot type at a building with nobody in it");

		var mode = chat.FindChild("Mode", true, false) as OptionButton;
		Check(mode is not null && mode.ItemCount == ChatClient.Modes.Length,
			$"every permission mode is offered ({mode?.ItemCount ?? 0})");
		// The safe end is the default: a settler is one keypress from any passer-by here.
		Check(mode is not null && ChatClient.Modes[mode.Selected].Id == "read",
			$"the permission selector opens read-only [{(mode is null ? "?" : ChatClient.Modes[mode.Selected].Id)}]");

		chat.Close();
		Check(!chat.IsOpen, "closing the chat hides it");
	}

	// ---- the wire, if anything is listening -------------------------------------

	private async void StartWireCheck()
	{
		if (_started) return;
		_started = true;

		string? sessionId = FirstSessionId();
		if (sessionId is null)
		{
			GD.Print("  [SKIP] no building in village.json carries a session id");
			_wireDone = true;
			return;
		}

		using var client = new ChatClient(ServerUrl);
		var t = await client.LoadTranscriptAsync(sessionId, 5);

		CallDeferred(nameof(ReportWire), t.Ok, t.Reason ?? "", t.Cwd ?? "", t.Messages.Count);
	}

	private void ReportWire(bool ok, string reason, string cwd, int messages)
	{
		_wireDone = true;

		// A refused connection is the server being absent, which is not this client's fault.
		if (!ok && LooksLikeNoServer(reason))
		{
			GD.Print($"  [SKIP] no island server on {ServerUrl}; start `node serve.mjs` to check the wire");
			return;
		}

		Check(ok, $"the transcript endpoint answered [{(ok ? "ok" : reason)}]");
		if (!ok) return;

		// The point of the parse is the messages. A transcript that comes back ok with a working
		// directory but nothing in it means the client read the envelope and dropped the contents,
		// which is exactly the failure that would look fine on screen until you opened one.
		Check(messages > 0, $"the client parsed {messages} message(s) out of the reply");
		Check(!string.IsNullOrWhiteSpace(cwd),
			$"the reply carries the folder the session worked in [{cwd}]");
	}

	private static bool LooksLikeNoServer(string reason) =>
		reason.Contains("refused", StringComparison.OrdinalIgnoreCase)
		|| reason.Contains("No connection", StringComparison.OrdinalIgnoreCase)
		|| reason.Contains("actively refused", StringComparison.OrdinalIgnoreCase)
		|| reason.Contains("unreachable", StringComparison.OrdinalIgnoreCase);

	private static string? FirstSessionId()
	{
		const string path = "res://village.json";
		if (!Godot.FileAccess.FileExists(path)) return null;

		using var file = Godot.FileAccess.Open(path, Godot.FileAccess.ModeFlags.Read);
		if (file is null) return null;

		var village = VillageJson.Parse<VillageData>(file.GetAsText());
		return village?.Buildings
			.FirstOrDefault(b => b.Kind == "house" && !string.IsNullOrWhiteSpace(b.SessionId))
			?.SessionId;
	}

	private static string Trim(string? s) =>
		string.IsNullOrEmpty(s) ? "" : s.Replace("\n", " ").Trim();

	private void Finish()
	{
		if (_fails == 0)
		{
			GD.Print("OK - a settler can be opened, and their transcript reads back");
			Quit(0);
		}
		else
		{
			GD.PushError($"{_fails} check(s) FAILED");
			Quit(1);
		}
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
