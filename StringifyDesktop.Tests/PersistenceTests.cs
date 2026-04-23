using StringifyDesktop.Models;
using StringifyDesktop.Services;

namespace StringifyDesktop.Tests;

public sealed class PersistenceTests
{
    [Fact]
    public async Task SettingsStore_PersistsUpdates()
    {
        var tempRoot = CreateTempDirectory();
        try
        {
            var store = new SettingsStore(new AppPaths(tempRoot));
            await store.InitializeAsync();

            var updated = await store.UpdateAsync(
                autoSyncEnabled: false,
                watchDir: @"C:\Replays",
                deleteAfterUploadEnabled: true);

            Assert.False(updated.AutoSyncEnabled);
            Assert.Equal(@"C:\Replays", updated.WatchDir);
            Assert.True(updated.DeleteAfterUploadEnabled);

            var reloaded = new SettingsStore(new AppPaths(tempRoot));
            await reloaded.InitializeAsync();
            Assert.False(reloaded.Get().AutoSyncEnabled);
            Assert.Equal(@"C:\Replays", reloaded.Get().WatchDir);
            Assert.True(reloaded.Get().DeleteAfterUploadEnabled);
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    [Fact]
    public async Task UploadLogStore_ClearsFailedEntries()
    {
        var tempRoot = CreateTempDirectory();
        try
        {
            var store = new UploadLogStore(new AppPaths(tempRoot));
            await store.InitializeAsync();
            await store.SetAsync("a.replay", new UploadLogEntry(UploadStatus.Uploaded, DateTimeOffset.UtcNow));
            await store.SetAsync("b.replay", new UploadLogEntry(UploadStatus.Failed, DateTimeOffset.UtcNow, "boom"));

            var removed = await store.ClearFailedAsync();

            Assert.Equal(1, removed);
            Assert.Single(store.GetSnapshot());
            Assert.Contains("a.replay", store.GetSnapshot().Keys);
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"StringifyDesktop.Tests.{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}
