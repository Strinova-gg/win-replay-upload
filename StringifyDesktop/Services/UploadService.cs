using StringifyDesktop.Models;

namespace StringifyDesktop.Services;

public sealed class UploadService
{
    private readonly IAccessTokenSource accessTokenSource;
    private readonly IUploadRoutingClient backendApiClient;
    private readonly HttpClient uploadClient;
    private readonly ReplayFileValidator replayFileValidator;

    public UploadService(
        IAccessTokenSource accessTokenSource,
        IUploadRoutingClient backendApiClient,
        HttpClient? uploadClient = null,
        ReplayFileValidator? replayFileValidator = null)
    {
        this.accessTokenSource = accessTokenSource;
        this.backendApiClient = backendApiClient;
        this.uploadClient = uploadClient ?? new HttpClient();
        this.replayFileValidator = replayFileValidator ?? new ReplayFileValidator();
    }

    public async Task<IReadOnlyDictionary<string, UploadOutcome>> UploadReplaysAsync(
        IReadOnlyList<(string FilePath, string FileName)> files,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(files);

        if (files.Count == 0)
        {
            return new Dictionary<string, UploadOutcome>(StringComparer.OrdinalIgnoreCase);
        }

        var outcomes = new Dictionary<string, UploadOutcome>(StringComparer.OrdinalIgnoreCase);
        var uploads = new List<ValidatedUpload>(files.Count);

        foreach (var file in files)
        {
            var (validatedUpload, failedOutcome) = await ValidateUploadAsync(file.FilePath, file.FileName, cancellationToken);
            if (validatedUpload is not null)
            {
                uploads.Add(validatedUpload);
                continue;
            }

            outcomes[file.FileName] = failedOutcome ?? new UploadOutcome.Failed("Could not prepare upload.");
        }

        if (uploads.Count == 0)
        {
            return outcomes;
        }

        var token = await accessTokenSource.GetAccessTokenAsync();
        if (string.IsNullOrWhiteSpace(token))
        {
            foreach (var upload in uploads)
            {
                outcomes[upload.FileName] = new UploadOutcome.Failed("Not signed in (no OAuth access token)");
            }

            return outcomes;
        }

        var batchSize = Math.Max(1, backendApiClient.MaxBatchSize);
        foreach (var batch in uploads.Chunk(batchSize))
        {
            IReadOnlyList<UploadRouteResult> routes;
            try
            {
                routes = await backendApiClient.RequestUploadUrlsAsync(
                    batch.Select(static upload => new UploadRouteRequest(upload.FileName, upload.FileSize)).ToArray(),
                    token,
                    cancellationToken);
            }
            catch (BackendError error) when (error.Status == 403)
            {
                foreach (var upload in batch)
                {
                    outcomes[upload.FileName] = new UploadOutcome.AlreadyUploaded(403);
                }

                continue;
            }
            catch (BackendError error)
            {
                foreach (var upload in batch)
                {
                    outcomes[upload.FileName] = new UploadOutcome.Failed(error.Message, error.Status);
                }

                continue;
            }
            catch (Exception error)
            {
                foreach (var upload in batch)
                {
                    outcomes[upload.FileName] = new UploadOutcome.Failed(error.Message);
                }

                continue;
            }

            var uploadsByFile = batch.ToDictionary(static upload => upload.FileName, StringComparer.OrdinalIgnoreCase);
            foreach (var route in routes)
            {
                if (!uploadsByFile.TryGetValue(route.FileName, out var upload))
                {
                    continue;
                }

                outcomes[route.FileName] = route switch
                {
                    UploadRouteResult.Ready ready => await UploadToStorageAsync(upload, ready, cancellationToken),
                    UploadRouteResult.AlreadyUploaded alreadyUploaded => new UploadOutcome.AlreadyUploaded(alreadyUploaded.HttpStatus),
                    UploadRouteResult.Failed failed => new UploadOutcome.Failed(failed.Error, failed.HttpStatus),
                    _ => new UploadOutcome.Failed("Upload routing returned an unknown result.")
                };
            }

            foreach (var upload in batch)
            {
                outcomes.TryAdd(upload.FileName, new UploadOutcome.Failed("Upload routing did not return a result.", 502));
            }
        }

        return outcomes;
    }

    public async Task<UploadOutcome> UploadReplayAsync(string filePath, string fileName, CancellationToken cancellationToken = default)
    {
        var outcomes = await UploadReplaysAsync([(filePath, fileName)], cancellationToken);
        return outcomes.GetValueOrDefault(fileName) ?? new UploadOutcome.Failed("Upload service did not return an outcome.");
    }

    private async Task<(ValidatedUpload? Upload, UploadOutcome? FailedOutcome)> ValidateUploadAsync(
        string filePath,
        string fileName,
        CancellationToken cancellationToken)
    {
        FileInfo fileInfo;
        try
        {
            fileInfo = new FileInfo(filePath);
            if (!fileInfo.Exists)
            {
                return (null, new UploadOutcome.Failed("Could not read file: file does not exist."));
            }
        }
        catch (Exception error)
        {
            return (null, new UploadOutcome.Failed($"Could not read file: {error.Message}"));
        }

        var validation = await replayFileValidator.ValidateAsync(filePath, cancellationToken);
        if (!validation.IsValid)
        {
            return (null, new UploadOutcome.Failed(validation.Error ?? "Invalid replay file."));
        }

        return (new ValidatedUpload(filePath, fileName, fileInfo.Length), null);
    }

    private async Task<UploadOutcome> UploadToStorageAsync(
        ValidatedUpload upload,
        UploadRouteResult.Ready route,
        CancellationToken cancellationToken)
    {
        try
        {
            await using var stream = File.OpenRead(upload.FilePath);
            using var request = new HttpRequestMessage(new HttpMethod(route.Method), route.UploadUrl)
            {
                Content = new StreamContent(stream)
            };
            request.Content.Headers.ContentType = new System.Net.Http.Headers.MediaTypeHeaderValue("application/octet-stream");

            foreach (var header in route.Headers)
            {
                if (!request.Headers.TryAddWithoutValidation(header.Key, header.Value))
                {
                    request.Content.Headers.TryAddWithoutValidation(header.Key, header.Value);
                }
            }

            using var response = await uploadClient.SendAsync(request, cancellationToken);
            if (response.IsSuccessStatusCode)
            {
                return new UploadOutcome.Uploaded();
            }

            if ((int)response.StatusCode == 403)
            {
                return new UploadOutcome.AlreadyUploaded(403);
            }

            return new UploadOutcome.Failed(
                $"Upload responded with {(int)response.StatusCode} {response.ReasonPhrase}",
                (int)response.StatusCode);
        }
        catch (Exception error)
        {
            return new UploadOutcome.Failed(error.Message);
        }
    }

    private sealed record ValidatedUpload(
        string FilePath,
        string FileName,
        long FileSize);
}
