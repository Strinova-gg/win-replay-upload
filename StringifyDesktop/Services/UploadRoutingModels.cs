namespace StringifyDesktop.Services;

public sealed record UploadRouteRequest(
    string FileName,
    long FileSize);

public abstract record UploadRouteResult(string FileName)
{
    public sealed record Ready(
        string FileName,
        string UploadUrl,
        string Method,
        IReadOnlyDictionary<string, string> Headers) : UploadRouteResult(FileName);

    public sealed record AlreadyUploaded(
        string FileName,
        int HttpStatus = 403) : UploadRouteResult(FileName);

    public sealed record Failed(
        string FileName,
        string Error,
        int? HttpStatus = null) : UploadRouteResult(FileName);
}
