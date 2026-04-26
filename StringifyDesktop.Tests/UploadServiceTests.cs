using System.Net;
using StringifyDesktop.Models;
using StringifyDesktop.Services;

namespace StringifyDesktop.Tests;

public sealed class UploadServiceTests
{
    [Fact]
    public async Task UploadReplayAsync_MapsBackend403ToAlreadyUploaded()
    {
        var tempRoot = CreateTempDirectory();
        var filePath = Path.Combine(tempRoot, "match.replay");
        await File.WriteAllBytesAsync(filePath, ReplayFileTestData.CreateReplayBytes(headerMagic: ReplayFileTestData.NetworkDemoMagic));

        try
        {
            var service = new UploadService(
                new FakeTokenSource("token"),
                new FakeUploadRoutingClient((_, _) => throw new BackendError("already there", 403)));

            var outcome = await service.UploadReplayAsync(filePath, "match.replay");

            var typed = Assert.IsType<UploadOutcome.AlreadyUploaded>(outcome);
            Assert.Equal(403, typed.HttpStatus);
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    [Fact]
    public async Task UploadReplaysAsync_MapsEntryAlreadyUploadedToAlreadyUploaded()
    {
        var tempRoot = CreateTempDirectory();
        var firstPath = Path.Combine(tempRoot, "match-1.replay");
        var secondPath = Path.Combine(tempRoot, "match-2.replay");
        await File.WriteAllBytesAsync(firstPath, ReplayFileTestData.CreateReplayBytes(headerMagic: ReplayFileTestData.NetworkDemoMagic));
        await File.WriteAllBytesAsync(secondPath, ReplayFileTestData.CreateReplayBytes(headerMagic: ReplayFileTestData.NetworkDemoMagic));

        try
        {
            var service = new UploadService(
                new FakeTokenSource("token"),
                new FakeUploadRoutingClient((files, _) => Task.FromResult<IReadOnlyList<UploadRouteResult>>(
                    [
                        new UploadRouteResult.Ready("match-1.replay", "https://example.invalid/upload/1", "PUT", new Dictionary<string, string>()),
                        new UploadRouteResult.AlreadyUploaded("match-2.replay")
                    ])),
                new HttpClient(new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK))));

            var outcomes = await service.UploadReplaysAsync(
                [
                    (firstPath, "match-1.replay"),
                    (secondPath, "match-2.replay")
                ]);

            Assert.IsType<UploadOutcome.Uploaded>(outcomes["match-1.replay"]);

            var alreadyUploaded = Assert.IsType<UploadOutcome.AlreadyUploaded>(outcomes["match-2.replay"]);
            Assert.Equal(403, alreadyUploaded.HttpStatus);
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    [Fact]
    public async Task UploadReplaysAsync_RequestsUploadRoutesInBatchesOfFive()
    {
        var tempRoot = CreateTempDirectory();
        var files = new List<(string FilePath, string FileName)>();
        for (var i = 1; i <= 6; i += 1)
        {
            var fileName = $"match-{i}.replay";
            var filePath = Path.Combine(tempRoot, fileName);
            await File.WriteAllBytesAsync(filePath, ReplayFileTestData.CreateReplayBytes(headerMagic: ReplayFileTestData.NetworkDemoMagic));
            files.Add((filePath, fileName));
        }

        try
        {
            var batchSizes = new List<int>();
            var service = new UploadService(
                new FakeTokenSource("token"),
                new FakeUploadRoutingClient((requestFiles, _) =>
                {
                    batchSizes.Add(requestFiles.Count);
                    return Task.FromResult<IReadOnlyList<UploadRouteResult>>(
                        requestFiles
                            .Select(file => new UploadRouteResult.Ready(
                                file.FileName,
                                $"https://example.invalid/upload/{file.FileName}",
                                "PUT",
                                new Dictionary<string, string>()))
                            .ToArray());
                }),
                new HttpClient(new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.OK))));

            var outcomes = await service.UploadReplaysAsync(files);

            Assert.Equal([5, 1], batchSizes);
            foreach (var file in files)
            {
                Assert.IsType<UploadOutcome.Uploaded>(outcomes[file.FileName]);
            }
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    [Fact]
    public async Task UploadReplayAsync_MapsUpload403ToAlreadyUploaded()
    {
        var tempRoot = CreateTempDirectory();
        var filePath = Path.Combine(tempRoot, "match.replay");
        await File.WriteAllBytesAsync(filePath, ReplayFileTestData.CreateReplayBytes(headerMagic: ReplayFileTestData.NetworkDemoMagic));

        try
        {
            var uploadClient = new HttpClient(new StubHttpHandler(_ => new HttpResponseMessage(HttpStatusCode.Forbidden)));
            var service = new UploadService(
                new FakeTokenSource("token"),
                new FakeUploadRoutingClient((_, _) => Task.FromResult<IReadOnlyList<UploadRouteResult>>(
                    [new UploadRouteResult.Ready("match.replay", "https://example.invalid/upload", "PUT", new Dictionary<string, string>())])),
                uploadClient);

            var outcome = await service.UploadReplayAsync(filePath, "match.replay");

            var typed = Assert.IsType<UploadOutcome.AlreadyUploaded>(outcome);
            Assert.Equal(403, typed.HttpStatus);
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    [Fact]
    public async Task UploadReplayAsync_FailsInvalidReplayBeforeRequestingUploadUrl()
    {
        var tempRoot = CreateTempDirectory();
        var filePath = Path.Combine(tempRoot, "match.replay");
        await File.WriteAllBytesAsync(filePath, [1, 2, 3, 4, 5, 6]);

        try
        {
            var requestCount = 0;
            var service = new UploadService(
                new FakeTokenSource("token"),
                new FakeUploadRoutingClient((_, _) =>
                {
                    requestCount += 1;
                    return Task.FromResult<IReadOnlyList<UploadRouteResult>>(
                        [new UploadRouteResult.Ready("match.replay", "https://example.invalid/upload", "PUT", new Dictionary<string, string>())]);
                }));

            var outcome = await service.UploadReplayAsync(filePath, "match.replay");

            var typed = Assert.IsType<UploadOutcome.Failed>(outcome);
            Assert.Contains("File too small", typed.Error, StringComparison.Ordinal);
            Assert.Equal(0, requestCount);
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

    private sealed class FakeTokenSource : IAccessTokenSource
    {
        private readonly string? token;

        public FakeTokenSource(string? token)
        {
            this.token = token;
        }

        public Task<string?> GetAccessTokenAsync()
        {
            return Task.FromResult(token);
        }
    }

    private sealed class FakeUploadRoutingClient : IUploadRoutingClient
    {
        private readonly Func<IReadOnlyList<UploadRouteRequest>, string, Task<IReadOnlyList<UploadRouteResult>>> handler;

        public FakeUploadRoutingClient(Func<IReadOnlyList<UploadRouteRequest>, string, Task<IReadOnlyList<UploadRouteResult>>> handler)
        {
            this.handler = handler;
        }

        public int MaxBatchSize => 5;

        public Task<IReadOnlyList<UploadRouteResult>> RequestUploadUrlsAsync(IReadOnlyList<UploadRouteRequest> files, string bearerToken, CancellationToken cancellationToken = default)
        {
            return handler(files, bearerToken);
        }
    }
}
