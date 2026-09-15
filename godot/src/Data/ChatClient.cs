using System;
using System.Collections.Generic;
using System.IO;
using SysHttp = System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Godot;

namespace Promptholm.Data;

/// <summary>
/// Talking to a settler.
///
/// A settler <em>is</em> a Claude session, so "talking to them" is not a metaphor and not a
/// separate chat: the transcript on screen is that session's own transcript, and what you send
/// carries it on with <c>claude --resume</c>. The house grows while you talk, because the turn
/// you just added is the turn the next scan counts.
///
/// Both endpoints already existed for the V1 browser island and are unchanged here — this is the
/// Godot client for them, not a new protocol:
///   GET  /api/transcript?session=&lt;id&gt;&amp;limit=N  → the conversation so far
///   POST /api/say                                   → newline-delimited JSON, streamed as it arrives
///
/// Everything below runs off the main thread and hands results back through callbacks that the
/// caller marshals with <c>CallDeferred</c>. Godot's own HTTPRequest would keep it on the main
/// thread, but it cannot stream a response body, and a reply that only appears once the session
/// has finished thinking is the whole difference between a conversation and a form submission.
/// </summary>
public sealed class ChatClient : IDisposable
{
	/// <summary>One line of the conversation as the server models it.</summary>
	public sealed record Message(string Role, string Text, IReadOnlyList<string> Tools)
	{
		public static Message User(string text) => new("user", text, Array.Empty<string>());
		public static Message Note(string text) => new("note", text, Array.Empty<string>());
	}

	/// <summary>What the transcript endpoint says about a settler.</summary>
	public sealed record Transcript(bool Ok, string? Reason, string? Cwd, bool CanReply,
		IReadOnlyList<Message> Messages);

	/// <summary>
	/// What the settler is allowed to do while you talk. Mirrors <c>MODES</c> in lib/chat.mjs,
	/// which maps these onto Claude's own permission modes — this is a real grant of authority,
	/// not a display setting, which is why the wording names the consequence.
	/// </summary>
	public static readonly (string Id, string Label)[] Modes =
	{
		("full", "Can do anything"),
		("edits", "May edit files"),
		("read", "Read only"),
	};

	private readonly SysHttp.HttpClient _http;
	private readonly string _baseUrl;
	private CancellationTokenSource? _inFlight;

	public ChatClient(string baseUrl)
	{
		_baseUrl = baseUrl.TrimEnd('/');
		// No overall timeout: a reply can legitimately take minutes while the session works, and
		// the per-read cancellation below is what stops a hung request instead.
		_http = new SysHttp.HttpClient { Timeout = Timeout.InfiniteTimeSpan };
	}

	/// <summary>True while a reply is still streaming in.</summary>
	public bool Busy => _inFlight is { IsCancellationRequested: false };

	/// <summary>Stops the reply that is streaming, if any. The turn already sent still happened.</summary>
	public void Cancel()
	{
		_inFlight?.Cancel();
		_inFlight = null;
	}

	public async Task<Transcript> LoadTranscriptAsync(string sessionId, int limit = 60)
	{
		try
		{
			string url = $"{_baseUrl}/api/transcript?session={Uri.EscapeDataString(sessionId)}&limit={limit}";
			string body = await _http.GetStringAsync(url).ConfigureAwait(false);

			using var doc = JsonDocument.Parse(body);
			var root = doc.RootElement;

			bool ok = root.TryGetProperty("ok", out var okEl) && okEl.ValueKind == JsonValueKind.True;
			string? reason = root.TryGetProperty("reason", out var rEl) ? rEl.GetString() : null;
			string? cwd = root.TryGetProperty("cwd", out var cEl) ? cEl.GetString() : null;
			bool canReply = !root.TryGetProperty("canReply", out var crEl)
				|| crEl.ValueKind != JsonValueKind.False;

			var msgs = new List<Message>();
			if (root.TryGetProperty("messages", out var arr) && arr.ValueKind == JsonValueKind.Array)
			{
				foreach (var m in arr.EnumerateArray())
				{
					string role = m.TryGetProperty("role", out var roleEl) ? roleEl.GetString() ?? "note" : "note";
					string text = m.TryGetProperty("text", out var tEl) ? tEl.GetString() ?? "" : "";
					var tools = new List<string>();
					if (m.TryGetProperty("tools", out var toolsEl) && toolsEl.ValueKind == JsonValueKind.Array)
					{
						foreach (var t in toolsEl.EnumerateArray())
						{
							string name = t.TryGetProperty("name", out var nEl) ? nEl.GetString() ?? "" : "";
							string hint = t.TryGetProperty("hint", out var hEl) ? hEl.GetString() ?? "" : "";
							tools.Add(string.IsNullOrEmpty(hint) ? name : $"{name} · {hint}");
						}
					}
					if (text.Length > 0 || tools.Count > 0)
						msgs.Add(new Message(role, text, tools));
				}
			}

			return new Transcript(ok, reason, cwd, canReply, msgs);
		}
		catch (Exception e)
		{
			return new Transcript(false, e.Message, null, false, Array.Empty<Message>());
		}
	}

	/// <summary>
	/// Carries the session on and streams the answer back.
	///
	/// `onText` fires for every chunk of assistant prose, `onTool` for every tool the session
	/// reaches for, and `onDone` once, with an error string or null. None of them are on the main
	/// thread — the caller is responsible for getting back there before touching a node.
	/// </summary>
	public async Task SayAsync(string sessionId, string? cwd, string text, string mode,
		Action<string> onText, Action<string> onTool, Action<string?> onDone)
	{
		Cancel();
		var cts = new CancellationTokenSource();
		_inFlight = cts;

		try
		{
			var payload = new Dictionary<string, object?>
			{
				["sessionId"] = sessionId,
				["text"] = text,
				["cwd"] = cwd,
				["mode"] = mode,
			};

			using var req = new SysHttp.HttpRequestMessage(SysHttp.HttpMethod.Post, $"{_baseUrl}/api/say")
			{
				Content = new SysHttp.StringContent(JsonSerializer.Serialize(payload), Encoding.UTF8, "application/json"),
			};

			using var resp = await _http.SendAsync(req, SysHttp.HttpCompletionOption.ResponseHeadersRead, cts.Token)
				.ConfigureAwait(false);

			if (!resp.IsSuccessStatusCode)
			{
				string err = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
				onDone(ErrorOf(err, (int)resp.StatusCode));
				return;
			}

			using var stream = await resp.Content.ReadAsStreamAsync().ConfigureAwait(false);
			using var reader = new StreamReader(stream, Encoding.UTF8);

			bool sawAnything = false;
			string? failure = null;

			while (!cts.IsCancellationRequested)
			{
				string? line = await reader.ReadLineAsync().ConfigureAwait(false);
				if (line is null) break;
				if (line.Trim().Length == 0) continue;

				if (Handle(line, onText, onTool, ref failure))
					sawAnything = true;
			}

			if (failure is not null) onDone(failure);
			else if (cts.IsCancellationRequested) onDone("you stopped them");
			else if (!sawAnything) onDone("they said nothing");
			else onDone(null);
		}
		catch (OperationCanceledException)
		{
			onDone("you stopped them");
		}
		catch (Exception e)
		{
			onDone(e.Message);
		}
		finally
		{
			if (ReferenceEquals(_inFlight, cts)) _inFlight = null;
			cts.Dispose();
		}
	}

	/// <summary>
	/// One line of the stream. Returns true when it produced something worth showing.
	///
	/// The shape is Claude's own <c>stream-json</c>, which the server passes through untouched, so
	/// this mirrors <c>handleEvent</c> in web/js/chat.js rather than inventing a second reading of
	/// the same events.
	/// </summary>
	private static bool Handle(string line, Action<string> onText, Action<string> onTool, ref string? failure)
	{
		try
		{
			using var doc = JsonDocument.Parse(line);
			var ev = doc.RootElement;
			string type = ev.TryGetProperty("type", out var tEl) ? tEl.GetString() ?? "" : "";

			if (type == "assistant" && ev.TryGetProperty("message", out var msg)
				&& msg.TryGetProperty("content", out var content)
				&& content.ValueKind == JsonValueKind.Array)
			{
				bool any = false;
				foreach (var b in content.EnumerateArray())
				{
					string bt = b.TryGetProperty("type", out var btEl) ? btEl.GetString() ?? "" : "";
					if (bt == "text" && b.TryGetProperty("text", out var txt))
					{
						string s = txt.GetString() ?? "";
						if (s.Length > 0) { onText(s); any = true; }
					}
					else if (bt == "tool_use" && b.TryGetProperty("name", out var nm))
					{
						onTool(nm.GetString() ?? "tool");
						any = true;
					}
				}
				return any;
			}

			// The server's own failures come back on the same stream rather than as a status code,
			// because by then the headers are long gone.
			if (type == "settlers_error")
			{
				failure = ev.TryGetProperty("error", out var e) ? e.GetString() : "the island could not reach them";
				return true;
			}
			if (type == "result" && ev.TryGetProperty("is_error", out var isErr)
				&& isErr.ValueKind == JsonValueKind.True)
			{
				failure = ev.TryGetProperty("result", out var r)
					? r.GetString() : "the session reported an error";
				return true;
			}
		}
		catch (JsonException)
		{
			// A half-written line is normal on a stream; the next read completes it.
		}
		return false;
	}

	private static string ErrorOf(string body, int status)
	{
		try
		{
			using var doc = JsonDocument.Parse(body);
			if (doc.RootElement.TryGetProperty("error", out var e))
				return e.GetString() ?? $"the island said {status}";
		}
		catch (JsonException) { /* not JSON; fall through to the status */ }
		return $"the island said {status}";
	}

	public void Dispose()
	{
		Cancel();
		_http.Dispose();
	}
}
