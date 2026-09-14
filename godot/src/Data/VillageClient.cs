using System;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Godot;
using Promptholm.Core;
using Promptholm.Data.Models;
using HttpClient = System.Net.Http.HttpClient;
using GodotFileAccess = Godot.FileAccess;

namespace Promptholm.Data;

/// <summary>
/// Polls the localserver for village.json and pushes fresh copies to EventBus.
/// HTTP work runs on background threads and arrives back on the main thread via
/// CallDeferred (thread-safe), so signal handlers can touch the scene tree freely.
/// When the server is offline the first load falls back to res://village.json.
/// </summary>
[GlobalClass]
public partial class VillageClient : Node
{
	[Export] public string ServerUrl { get; set; } = "http://localhost:4747";
	[Export] public double PollSeconds { get; set; } = 5.0;
	[Export] public int TimeoutSeconds { get; set; } = 3;
	[Export] public bool FallbackToResource { get; set; } = true;

	private HttpClient? _http;
	private string _lastGeneratedAt = "";
	private bool _polling = true;
	private bool _fallbackLoaded;
	private double _elapsed;
	private string? _pendingJson;
	private VillageData? _lastData;

	public VillageData? LastData => _lastData;

	public override void _Ready()
	{
		_http = new HttpClient { Timeout = TimeSpan.FromSeconds(Math.Max(1, TimeoutSeconds)) };
		if (PollSeconds <= 0.0)
			_polling = false;
	}

	public override void _ExitTree()
	{
		_polling = false;
		_http?.Dispose();
		_http = null;
	}

	public override void _Process(double delta)
	{
		if (!_polling || _http == null)
			return;
		_elapsed += delta;
		if (_elapsed < PollSeconds)
			return;
		_elapsed = 0.0;
		_ = PollOnceAsync();
	}

	private async Task PollOnceAsync()
	{
		bool wantFallback = false;
		try
		{
			string url = ServerUrl.TrimEnd('/') + "/village.json?ts=" + DateTime.UtcNow.Ticks;
			using var resp = await _http!.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).ConfigureAwait(false);
			resp.EnsureSuccessStatusCode();
			string json = await resp.Content.ReadAsStringAsync().ConfigureAwait(false);
			var generatedAt = ReadGeneratedAt(json);
			if (generatedAt == _lastGeneratedAt)
				return;
			_lastGeneratedAt = generatedAt;
			_pendingJson = json;
			CallDeferred(nameof(DispatchVillage));
		}
		catch (HttpRequestException)
		{
			wantFallback = true;
		}
		catch (TaskCanceledException)
		{
			// Server not answering within the timeout: nothing to do this tick.
			return;
		}
		catch (JsonException)
		{
			CallDeferred(nameof(DeferWarn), "village.json from the server did not parse as a village document");
			return;
		}

		if (wantFallback && FallbackToResource && !_fallbackLoaded)
			CallDeferred(nameof(LoadResourceFallback));
	}

	private void DispatchVillage()
	{
		if (_pendingJson == null)
			return;
		var data = VillageJson.Parse<VillageData>(_pendingJson);
		_pendingJson = null;
		if (data == null)
		{
			GD.PushWarning("[VillageClient] village.json parsed to nothing");
			return;
		}
		_lastData = data;
		GD.Print($"[VillageClient] village loaded: {data.Buildings.Count} buildings, {data.Districts.Count} districts, island '{data.Island.Name}'");
		EventBus.Instance.PublishVillageData(data);
	}

	private void LoadResourceFallback()
	{
		_fallbackLoaded = true;
		const string path = "res://village.json";
		if (!GodotFileAccess.FileExists(path))
		{
			GD.PushWarning($"[VillageClient] server offline and no fallback {path} exists");
			return;
		}
		using var f = GodotFileAccess.Open(path, GodotFileAccess.ModeFlags.Read);
		if (f == null)
		{
			GD.PushWarning($"[VillageClient] could not read fallback {path}");
			return;
		}
		_lastGeneratedAt = "";
		_pendingJson = f.GetAsText();
		GD.Print($"[VillageClient] server offline; loaded fallback {path}");
		DispatchVillage();
	}

	private void DeferWarn(string message)
		=> GD.PushWarning($"[VillageClient] {message}");

	private static string ReadGeneratedAt(string json)
	{
		try
		{
			using var doc = JsonDocument.Parse(json);
			if (doc.RootElement.TryGetProperty("generatedAt", out var v) && v.ValueKind == JsonValueKind.String)
				return v.GetString() ?? "";
		}
		catch (JsonException)
		{
			// Let the caller's own parse produce the real error.
		}
		return "";
	}
}
