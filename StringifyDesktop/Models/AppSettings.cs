namespace StringifyDesktop.Models;

public sealed record AppSettings(bool AutoSyncEnabled, string? WatchDir, bool DeleteAfterUploadEnabled = false)
{
    public static AppSettings Default { get; } = new(true, null);
}
