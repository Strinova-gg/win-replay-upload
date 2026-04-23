namespace StringifyDesktop.Models;

public sealed record UploadLogEntry(
    UploadStatus Status,
    DateTimeOffset At,
    string? Error = null,
    int? HttpStatus = null,
    string? Detail = null);
