using System.Text.Json;
using StringifyDesktop.Models;

namespace StringifyDesktop.Services;

public sealed class SettingsStore
{
    private readonly AppPaths paths;
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private AppSettings current = AppSettings.Default;

    public SettingsStore(AppPaths paths)
    {
        this.paths = paths;
    }

    public async Task InitializeAsync()
    {
        if (paths.AllowsLegacyImport && !File.Exists(paths.SettingsPath))
        {
            await TryImportLegacyAsync();
        }

        if (!File.Exists(paths.SettingsPath))
        {
            current = AppSettings.Default;
            return;
        }

        try
        {
            await using var stream = File.OpenRead(paths.SettingsPath);
            current = await JsonSerializer.DeserializeAsync<AppSettings>(stream, JsonOptions)
                ?? AppSettings.Default;
        }
        catch
        {
            current = AppSettings.Default;
        }
    }

    public AppSettings Get()
    {
        return current;
    }

    public async Task<AppSettings> UpdateAsync(
        bool? autoSyncEnabled = null,
        string? watchDir = null,
        bool clearWatchDir = false,
        bool? deleteAfterUploadEnabled = null)
    {
        current = current with
        {
            AutoSyncEnabled = autoSyncEnabled ?? current.AutoSyncEnabled,
            WatchDir = clearWatchDir ? null : watchDir ?? current.WatchDir,
            DeleteAfterUploadEnabled = deleteAfterUploadEnabled ?? current.DeleteAfterUploadEnabled
        };

        await PersistAsync();
        return current;
    }

    private async Task PersistAsync()
    {
        await using var stream = File.Create(paths.SettingsPath);
        await JsonSerializer.SerializeAsync(stream, current, JsonOptions);
    }

    private async Task TryImportLegacyAsync()
    {
        foreach (var candidate in paths.EnumerateLegacyCandidates("settings.json"))
        {
            if (!File.Exists(candidate))
            {
                continue;
            }

            try
            {
                var text = await File.ReadAllTextAsync(candidate);
                await File.WriteAllTextAsync(paths.SettingsPath, text);
                break;
            }
            catch
            {
                // Ignore broken legacy imports and continue.
            }
        }
    }
}
