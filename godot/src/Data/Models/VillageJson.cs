using System.Text.Json;
using System.Text.Json.Serialization;

namespace Promptholm.Data.Models;

/// <summary>
/// Shared System.Text.Json options for reading and writing the village interchange
/// format. The wire keys are camelCase (scan.mjs writes them), the C# properties are
/// PascalCase, and both directions map through PropertyNamingPolicy. Tolerant on the
/// read side because the same JSON is produced by scripts older than the model.
/// </summary>
public static class VillageJson
{
	/// <summary>
	/// Read/write options for the whole village document. The scanner output is not always
	/// as typed as we would like — foundedAt can be null, "", a number or an ISO string
	/// depending on which script wrote the file — hence the permissive number and string
	/// handling on the read side.
	/// </summary>
	public static readonly JsonSerializerOptions DefaultOptions = new()
	{
		PropertyNameCaseInsensitive = true,
		PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
		NumberHandling = JsonNumberHandling.AllowReadingFromString,
		ReadCommentHandling = JsonCommentHandling.Skip,
		AllowTrailingCommas = true,
	};

	public static T? Parse<T>(string json) where T : class
		=> JsonSerializer.Deserialize<T>(json, DefaultOptions);

	public static string Serialize<T>(T value, bool pretty = false)
		=> JsonSerializer.Serialize(value, DefaultOptions);
}

/// <summary>
/// Reads a JSON string field that may arrive as a string, a number (epoch ms) or an
/// empty value (foundedAt is notoriously all three across scripts and configs). The
/// model side sees a plain string or null and can never crash on a type mismatch.
/// </summary>
public sealed class FlexibleStringConverter : JsonConverter<string?>
{
	public override string? Read(ref Utf8JsonReader reader, System.Type typeToConvert, JsonSerializerOptions options)
	{
		switch (reader.TokenType)
		{
			case JsonTokenType.String:
				return reader.GetString();
			case JsonTokenType.Number:
				using (var doc = JsonDocument.ParseValue(ref reader))
					return doc.RootElement.ToString();
			case JsonTokenType.Null:
				reader.Read();
				return null;
			default:
				return reader.GetString();
		}
	}

	public override void Write(Utf8JsonWriter writer, string? value, JsonSerializerOptions options)
	{
		if (value is null)
			writer.WriteNullValue();
		else
			writer.WriteStringValue(value);
	}
}