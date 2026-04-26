namespace StringifyDesktop.Services;

public interface IUploadRoutingClient
{
    int MaxBatchSize { get; }

    Task<IReadOnlyList<UploadRouteResult>> RequestUploadUrlsAsync(
        IReadOnlyList<UploadRouteRequest> files,
        string bearerToken,
        CancellationToken cancellationToken = default);
}
