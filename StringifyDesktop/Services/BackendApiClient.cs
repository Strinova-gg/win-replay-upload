using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using StringifyDesktop.Models;

namespace StringifyDesktop.Services;

public sealed class BackendApiClient : IUploadRoutingClient
{
    private const string AlreadyUploadedErrorCode = "ALREADY_UPLOADED";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly HttpClient client;
    private readonly AppConfiguration configuration;

    public BackendApiClient(AppConfiguration configuration, HttpClient? client = null)
    {
        this.configuration = configuration;
        this.client = client ?? new HttpClient();
    }

    public int MaxBatchSize => 5;

    public async Task<IReadOnlyList<UploadRouteResult>> RequestUploadUrlsAsync(
        IReadOnlyList<UploadRouteRequest> files,
        string bearerToken,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(files);

        if (files.Count == 0)
        {
            return Array.Empty<UploadRouteResult>();
        }

        if (files.Count > MaxBatchSize)
        {
            throw new ArgumentOutOfRangeException(nameof(files), $"Upload API supports at most {MaxBatchSize} files per request.");
        }

        using var request = new HttpRequestMessage(HttpMethod.Post, $"{configuration.BackendUrl}/api/upload");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", bearerToken);
        request.Content = new StringContent(
            JsonSerializer.Serialize(new
            {
                files = files.Select(static file => new { name = file.FileName, size = file.FileSize }).ToArray()
            }),
            Encoding.UTF8,
            "application/json");

        using var response = await client.SendAsync(request, cancellationToken);
        if (!response.IsSuccessStatusCode)
        {
            throw new BackendError(await ReadErrorAsync(response), (int)response.StatusCode);
        }

        await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
        var payload = await JsonSerializer.DeserializeAsync<UploadUrlsResponse>(stream, JsonOptions, cancellationToken);
        return MapUploadRoutes(files, payload?.Urls);
    }

    public async Task<(string UploadUrl, string Method, IReadOnlyDictionary<string, string> Headers)> RequestUploadUrlAsync(
        string fileName,
        long fileSize,
        string bearerToken,
        CancellationToken cancellationToken = default)
    {
        var results = await RequestUploadUrlsAsync(
            [new UploadRouteRequest(fileName, fileSize)],
            bearerToken,
            cancellationToken);

        return results.SingleOrDefault() switch
        {
            UploadRouteResult.Ready ready => (ready.UploadUrl, ready.Method, ready.Headers),
            UploadRouteResult.AlreadyUploaded alreadyUploaded => throw new BackendError(AlreadyUploadedErrorCode, alreadyUploaded.HttpStatus),
            UploadRouteResult.Failed failed => throw new BackendError(failed.Error, failed.HttpStatus ?? 400),
            _ => throw new BackendError("Upload API did not return a signed URL.", 502)
        };
    }

    private static async Task<string> ReadErrorAsync(HttpResponseMessage response)
    {
        try
        {
            await using var stream = await response.Content.ReadAsStreamAsync();
            var payload = await JsonSerializer.DeserializeAsync<ErrorResponse>(stream, JsonOptions);
            return payload?.Error ?? payload?.Message ?? $"{(int)response.StatusCode} {response.ReasonPhrase}";
        }
        catch
        {
            return $"{(int)response.StatusCode} {response.ReasonPhrase}";
        }
    }

    private sealed class UploadUrlsResponse
    {
        [JsonPropertyName("urls")]
        public List<UploadUrlEntry>? Urls { get; set; }
    }

    private sealed class UploadUrlEntry
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("signedUrl")]
        public string? SignedUrl { get; set; }

        [JsonPropertyName("uploadUrl")]
        public string? UploadUrl { get; set; }

        [JsonPropertyName("url")]
        public string? Url { get; set; }

        [JsonPropertyName("method")]
        public string? Method { get; set; }

        [JsonPropertyName("headers")]
        public Dictionary<string, string>? Headers { get; set; }

        [JsonPropertyName("error")]
        public string? Error { get; set; }
    }

    private sealed class ErrorResponse
    {
        [JsonPropertyName("error")]
        public string? Error { get; set; }

        [JsonPropertyName("message")]
        public string? Message { get; set; }
    }

    private static IReadOnlyList<UploadRouteResult> MapUploadRoutes(
        IReadOnlyList<UploadRouteRequest> files,
        IReadOnlyList<UploadUrlEntry>? entries)
    {
        if (entries is null || entries.Count == 0)
        {
            return files
                .Select(static file => new UploadRouteResult.Failed(file.FileName, "Upload API did not return any upload routes.", 502))
                .ToArray();
        }

        var namedEntries = new Dictionary<string, Queue<UploadUrlEntry>>(StringComparer.OrdinalIgnoreCase);
        var unnamedEntries = new Queue<UploadUrlEntry>();

        foreach (var entry in entries)
        {
            if (string.IsNullOrWhiteSpace(entry.Name))
            {
                unnamedEntries.Enqueue(entry);
                continue;
            }

            if (!namedEntries.TryGetValue(entry.Name, out var queue))
            {
                queue = new Queue<UploadUrlEntry>();
                namedEntries[entry.Name] = queue;
            }

            queue.Enqueue(entry);
        }

        var results = new List<UploadRouteResult>(files.Count);
        foreach (var file in files)
        {
            var entry = TryTakeEntry(file.FileName, files.Count, entries, namedEntries, unnamedEntries);
            if (entry is null)
            {
                results.Add(new UploadRouteResult.Failed(
                    file.FileName,
                    $"Upload API did not return a route for '{file.FileName}'.",
                    502));
                continue;
            }

            if (string.Equals(entry.Error, AlreadyUploadedErrorCode, StringComparison.OrdinalIgnoreCase))
            {
                results.Add(new UploadRouteResult.AlreadyUploaded(file.FileName));
                continue;
            }

            if (!string.IsNullOrWhiteSpace(entry.Error))
            {
                results.Add(new UploadRouteResult.Failed(file.FileName, entry.Error, 400));
                continue;
            }

            var uploadUrl = entry.SignedUrl ?? entry.UploadUrl ?? entry.Url;
            if (string.IsNullOrWhiteSpace(uploadUrl))
            {
                results.Add(new UploadRouteResult.Failed(file.FileName, "Upload API did not return a signed URL.", 502));
                continue;
            }

            results.Add(new UploadRouteResult.Ready(
                file.FileName,
                uploadUrl,
                string.IsNullOrWhiteSpace(entry.Method) ? "PUT" : entry.Method,
                entry.Headers ?? new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)));
        }

        return results;
    }

    private static UploadUrlEntry? TryTakeEntry(
        string fileName,
        int requestedCount,
        IReadOnlyList<UploadUrlEntry> entries,
        IDictionary<string, Queue<UploadUrlEntry>> namedEntries,
        Queue<UploadUrlEntry> unnamedEntries)
    {
        if (namedEntries.TryGetValue(fileName, out var namedQueue) && namedQueue.Count > 0)
        {
            return namedQueue.Dequeue();
        }

        if (unnamedEntries.Count > 0)
        {
            return unnamedEntries.Dequeue();
        }

        if (requestedCount == 1 && entries.Count == 1)
        {
            return entries[0];
        }

        return null;
    }
}
