using System;
using System.Text;
using Godot;
using Promptholm.Data;
using Promptholm.Data.Models;

namespace Promptholm.UI;

/// <summary>
/// Talking to a settler, as if they were a character you walked up to.
///
/// The conceit is exact rather than decorative: the log on screen is the session's own
/// transcript, and the line you type is carried on in that very session by
/// <c>claude --resume</c>. So this is not a chat window that happens to sit on an island — it is
/// the island's way into work that is already underway, and the house grows a tier while you
/// talk, because your turn is a turn the next scan counts.
///
/// Permission mode is offered here and defaults to read-only. The browser version defaulted to
/// "can do anything", which is defensible on a page you opened deliberately; on an island where a
/// settler is one keypress away from any passer-by it is not, so the safe end is the default and
/// the wording says what is being granted rather than naming a setting.
/// </summary>
[GlobalClass]
public partial class SettlerChatUI : CanvasLayer
{
	/// <summary>How many turns of history to pull. Enough to pick the thread back up.</summary>
	private const int HistoryLimit = 40;

	private static readonly Color Ink = new(0.88f, 0.90f, 0.93f);
	private static readonly Color Muted = new(0.58f, 0.62f, 0.68f);
	private static readonly Color YouTint = new(0.72f, 0.82f, 0.62f);
	private static readonly Color ThemTint = new(0.82f, 0.76f, 0.58f);
	private static readonly Color NoteTint = new(0.78f, 0.55f, 0.50f);

	private Control? _overlay;
	private RichTextLabel? _log;
	private TextEdit? _input;
	private Button? _sendBtn;
	private OptionButton? _modeBtn;
	private Label? _title;
	private Label? _subtitle;
	private Label? _status;

	private ChatClient? _client;
	private BuildingData? _settler;
	private readonly StringBuilder _pending = new();
	private bool _busy;

	/// <summary>Where the island server lives. Same origin the village itself is polled from.</summary>
	[Export] public string ServerUrl { get; set; } = "http://localhost:4747";

	public bool IsOpen => _overlay is { Visible: true };

	public override void _Ready()
	{
		BuildUi();
		_client = new ChatClient(ServerUrl);
		if (_overlay is not null) _overlay.Visible = false;
	}

	public override void _ExitTree()
	{
		_client?.Dispose();
		_client = null;
	}

	public override void _UnhandledInput(InputEvent @event)
	{
		if (!IsOpen) return;
		if (@event is InputEventKey { Pressed: true, Keycode: Key.Escape })
		{
			Close();
			GetViewport().SetInputAsHandled();
		}
	}

	/// <summary>
	/// Opens the conversation with one settler. A building without a session id is a shed or a
	/// civic hall — there is nobody in it to carry on with, and saying so is better than opening
	/// an empty window.
	/// </summary>
	public void Open(BuildingData settler)
	{
		if (_overlay is null || _client is null) return;

		_settler = settler;
		_pending.Clear();
		_busy = false;

		_title!.Text = string.IsNullOrWhiteSpace(settler.Name) ? settler.Id : settler.Name!;
		_subtitle!.Text = string.IsNullOrWhiteSpace(settler.Title) ? "—" : settler.Title!;
		_log!.Text = "";

		_overlay.Visible = true;
		_input!.GrabFocus();

		if (string.IsNullOrWhiteSpace(settler.SessionId))
		{
			Note("There is nobody here to talk to — this building has no session of its own.");
			SetCanSend(false);
			return;
		}

		SetStatus("Reading their transcript…");
		SetCanSend(false);
		LoadHistory(settler.SessionId!);
	}

	public void Close()
	{
		_client?.Cancel();
		if (_overlay is not null) _overlay.Visible = false;
		_settler = null;
	}

	// ---- transcript ------------------------------------------------------------

	private async void LoadHistory(string sessionId)
	{
		var t = await _client!.LoadTranscriptAsync(sessionId, HistoryLimit);
		// Back to the main thread before anything touches a node.
		CallDeferred(nameof(ApplyHistory), t.Ok, t.Reason ?? "", t.Cwd ?? "", t.CanReply,
			RenderMessages(t.Messages));
	}

	private static string RenderMessages(System.Collections.Generic.IReadOnlyList<ChatClient.Message> msgs)
	{
		var sb = new StringBuilder();
		foreach (var m in msgs)
		{
			sb.Append(Bubble(m.Role, m.Text));
			foreach (var tool in m.Tools)
				sb.Append($"[color=#{Muted.ToHtml(false)}][i]  · {Escape(tool)}[/i][/color]\n");
		}
		return sb.ToString();
	}

	private void ApplyHistory(bool ok, string reason, string cwd, bool canReply, string body)
	{
		if (_log is null) return;

		if (!ok)
		{
			Note(string.IsNullOrWhiteSpace(reason)
				? "Their transcript could not be read."
				: reason);
			// A settler with no transcript can still be spoken to — --resume only needs the id.
			SetCanSend(true);
			SetStatus(null);
			return;
		}

		_log.Text = body;
		if (body.Length == 0)
			Note("They have not said anything yet.");

		if (!canReply)
			Note("This is an apprentice's log; you can read it but not carry it on.");

		SetCanSend(canReply);
		SetStatus(string.IsNullOrWhiteSpace(cwd) ? null : cwd);
		ScrollToEnd();
	}

	// ---- sending ---------------------------------------------------------------

	private void OnSend()
	{
		if (_busy || _settler is null || _input is null) return;

		string text = _input.Text.Trim();
		if (text.Length == 0) return;
		if (string.IsNullOrWhiteSpace(_settler.SessionId)) return;

		_input.Text = "";
		Append(Bubble("user", text));
		_pending.Clear();
		SetBusy(true);

		string mode = ChatClient.Modes[Math.Clamp(_modeBtn?.Selected ?? 0, 0, ChatClient.Modes.Length - 1)].Id;
		Send(_settler.SessionId!, _settler.Cwd, text, mode);
	}

	private async void Send(string sessionId, string? cwd, string text, string mode)
	{
		await _client!.SayAsync(sessionId, cwd, text, mode,
			onText: s => CallDeferred(nameof(OnStreamText), s),
			onTool: s => CallDeferred(nameof(OnStreamTool), s),
			onDone: e => CallDeferred(nameof(OnStreamDone), e ?? ""));
	}

	private void OnStreamText(string chunk)
	{
		// Rewriting the whole trailing bubble each chunk keeps the BBCode well-formed; appending
		// raw text into an open colour tag does not, and RichTextLabel renders the tag itself once
		// that happens.
		_pending.Append(chunk);
		RedrawPending();
	}

	private void OnStreamTool(string tool)
	{
		SetStatus($"…{tool}");
	}

	private void OnStreamDone(string error)
	{
		SetBusy(false);
		if (_pending.Length > 0)
		{
			RedrawPending(final: true);
			_pending.Clear();
		}
		if (!string.IsNullOrEmpty(error))
			Note(error);
		SetStatus(null);
		ScrollToEnd();
	}

	/// <summary>
	/// Replaces the in-progress reply at the end of the log. The finished text is committed with a
	/// trailing newline so the next message starts its own bubble.
	/// </summary>
	private void RedrawPending(bool final = false)
	{
		if (_log is null) return;

		string head = _log.Text;
		int mark = head.LastIndexOf(StreamMarker, StringComparison.Ordinal);
		if (mark >= 0) head = head[..mark];

		_log.Text = head + StreamMarker + Bubble("assistant", _pending.ToString());
		if (final)
			_log.Text = _log.Text.Replace(StreamMarker, "");
		ScrollToEnd();
	}

	/// <summary>Zero-width marker for where the streaming reply begins, so it can be rewritten.</summary>
	private const string StreamMarker = "​";

	// ---- small helpers ---------------------------------------------------------

	private static string Bubble(string role, string text)
	{
		if (string.IsNullOrEmpty(text)) return "";
		var (who, tint) = role switch
		{
			"user" => ("You", YouTint),
			"assistant" => ("Them", ThemTint),
			_ => ("", NoteTint),
		};
		string body = Escape(text);
		return who.Length == 0
			? $"[color=#{tint.ToHtml(false)}][i]{body}[/i][/color]\n\n"
			: $"[color=#{tint.ToHtml(false)}][b]{who}[/b][/color]\n{body}\n\n";
	}

	/// <summary>Transcript text is data, not markup: a stray bracket must not become a tag.</summary>
	private static string Escape(string s) => s.Replace("[", "[lb]");

	private void Note(string text) => Append(Bubble("note", text));

	private void Append(string bb)
	{
		if (_log is null) return;
		_log.Text += bb;
		ScrollToEnd();
	}

	private void ScrollToEnd()
	{
		if (_log is null) return;
		// Deferred: the line count is not final until the label has laid out the new text.
		_log.CallDeferred("scroll_to_line", Math.Max(0, _log.GetLineCount() - 1));
	}

	private void SetBusy(bool busy)
	{
		_busy = busy;
		SetCanSend(!busy && _settler is not null && !string.IsNullOrWhiteSpace(_settler.SessionId));
		if (_sendBtn is not null) _sendBtn.Text = busy ? "Stop" : "Send";
		if (busy) SetStatus("Thinking…");
	}

	private void SetCanSend(bool can)
	{
		if (_input is not null) _input.Editable = can;
		// The button stays live while busy: that is how you stop them.
		if (_sendBtn is not null) _sendBtn.Disabled = !can && !_busy;
	}

	private void SetStatus(string? text)
	{
		if (_status is null) return;
		_status.Text = text ?? "";
		_status.Visible = !string.IsNullOrEmpty(text);
	}

	private void OnSendOrStop()
	{
		if (_busy) { _client?.Cancel(); return; }
		OnSend();
	}

	// ---- construction ----------------------------------------------------------

	private void BuildUi()
	{
		Layer = 12;

		_overlay = new Control { Name = "ChatOverlay", MouseFilter = Control.MouseFilterEnum.Ignore };
		_overlay.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
		AddChild(_overlay);

		var dim = new Panel { Name = "Dim", MouseFilter = Control.MouseFilterEnum.Stop };
		dim.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
		dim.AddThemeStyleboxOverride("panel", Flat(new Color(0.0f, 0.0f, 0.0f, 0.42f), 0));
		dim.GuiInput += e =>
		{
			if (e is InputEventMouseButton { Pressed: true }) Close();
		};
		_overlay.AddChild(dim);

		var center = new CenterContainer { Name = "Center", MouseFilter = Control.MouseFilterEnum.Ignore };
		center.SetAnchorsAndOffsetsPreset(Control.LayoutPreset.FullRect);
		_overlay.AddChild(center);

		var panel = new PanelContainer { Name = "ChatPanel", MouseFilter = Control.MouseFilterEnum.Stop };
		panel.CustomMinimumSize = new Vector2(620.0f, 520.0f);
		panel.AddThemeStyleboxOverride("panel", Flat(new Color(0.10f, 0.12f, 0.16f, 0.98f), 14, 20, 20, 18, 18));
		center.AddChild(panel);

		var body = new VBoxContainer { Name = "Body" };
		body.AddThemeConstantOverride("separation", 10);
		panel.AddChild(body);

		// Header: who you are talking to, and the way out.
		var header = new HBoxContainer { Name = "Header" };
		body.AddChild(header);

		var titles = new VBoxContainer { Name = "Titles", SizeFlagsHorizontal = Control.SizeFlags.ExpandFill };
		header.AddChild(titles);

		_title = new Label { Name = "SettlerName", Text = "Settler" };
		_title.AddThemeFontSizeOverride("font_size", 22);
		_title.AddThemeColorOverride("font_color", Ink);
		titles.AddChild(_title);

		_subtitle = new Label { Name = "SessionTitle", Text = "" };
		_subtitle.AddThemeFontSizeOverride("font_size", 12);
		_subtitle.AddThemeColorOverride("font_color", Muted);
		titles.AddChild(_subtitle);

		var closeBtn = MkButton("X", new Vector2(34.0f, 30.0f));
		closeBtn.Pressed += Close;
		header.AddChild(closeBtn);

		// The log.
		var scroll = new PanelContainer { Name = "LogFrame", SizeFlagsVertical = Control.SizeFlags.ExpandFill };
		scroll.AddThemeStyleboxOverride("panel", Flat(new Color(0.07f, 0.09f, 0.12f), 10, 12, 12, 10, 10));
		body.AddChild(scroll);

		_log = new RichTextLabel
		{
			Name = "Log",
			BbcodeEnabled = true,
			ScrollFollowing = true,
			SelectionEnabled = true,
			FitContent = false,
			CustomMinimumSize = new Vector2(0.0f, 300.0f),
		};
		_log.AddThemeColorOverride("default_color", Ink);
		_log.AddThemeFontSizeOverride("normal_font_size", 13);
		scroll.AddChild(_log);

		_status = new Label { Name = "Status", Text = "", Visible = false };
		_status.AddThemeFontSizeOverride("font_size", 11);
		_status.AddThemeColorOverride("font_color", Muted);
		body.AddChild(_status);

		// Compose row.
		var compose = new HBoxContainer { Name = "Compose" };
		compose.AddThemeConstantOverride("separation", 8);
		body.AddChild(compose);

		_input = new TextEdit
		{
			Name = "Input",
			PlaceholderText = "Say something…",
			SizeFlagsHorizontal = Control.SizeFlags.ExpandFill,
			CustomMinimumSize = new Vector2(0.0f, 62.0f),
			WrapMode = TextEdit.LineWrappingMode.Boundary,
		};
		_input.AddThemeColorOverride("font_color", Ink);
		_input.AddThemeFontSizeOverride("font_size", 13);
		compose.AddChild(_input);

		var right = new VBoxContainer { Name = "ComposeSide" };
		right.AddThemeConstantOverride("separation", 6);
		compose.AddChild(right);

		_modeBtn = new OptionButton
		{
			Name = "Mode",
			CustomMinimumSize = new Vector2(150.0f, 26.0f),
			FocusMode = Control.FocusModeEnum.None,
		};
		foreach (var (_, label) in ChatClient.Modes)
			_modeBtn.AddItem(label);
		// Read-only first: see the class remark. Modes are ordered full/edits/read, so this is the last.
		_modeBtn.Selected = ChatClient.Modes.Length - 1;
		_modeBtn.AddThemeFontSizeOverride("font_size", 11);
		right.AddChild(_modeBtn);

		_sendBtn = MkButton("Send", new Vector2(150.0f, 30.0f));
		_sendBtn.Pressed += OnSendOrStop;
		right.AddChild(_sendBtn);
	}

	private static Button MkButton(string text, Vector2 size)
	{
		var b = new Button
		{
			Text = text,
			CustomMinimumSize = size,
			// Keyboard focus here would turn Space into ui_accept and re-press the button (#60).
			FocusMode = Control.FocusModeEnum.None,
		};
		b.AddThemeStyleboxOverride("normal", Flat(new Color(0.22f, 0.26f, 0.32f), 8, 10, 10, 6, 6));
		b.AddThemeStyleboxOverride("hover", Flat(new Color(0.34f, 0.38f, 0.46f), 8, 10, 10, 6, 6));
		b.AddThemeStyleboxOverride("pressed", Flat(new Color(0.15f, 0.17f, 0.21f), 8, 10, 10, 6, 6));
		b.AddThemeStyleboxOverride("disabled", Flat(new Color(0.16f, 0.18f, 0.22f), 8, 10, 10, 6, 6));
		return b;
	}

	private static StyleBoxFlat Flat(Color bg, int radius,
		int padL = 0, int padR = 0, int padT = 0, int padB = 0)
	{
		var sb = new StyleBoxFlat { BgColor = bg };
		sb.SetCornerRadiusAll(radius);
		sb.ContentMarginLeft = padL;
		sb.ContentMarginRight = padR;
		sb.ContentMarginTop = padT;
		sb.ContentMarginBottom = padB;
		return sb;
	}
}
