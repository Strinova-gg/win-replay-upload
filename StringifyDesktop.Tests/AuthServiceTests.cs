using StringifyDesktop.Models;
using StringifyDesktop.Services;

namespace StringifyDesktop.Tests;

public sealed class AuthServiceTests
{
    [Fact]
    public async Task HandleCallbackUriAsync_RejectsStateMismatch()
    {
        var tempRoot = CreateTempDirectory();
        try
        {
            var paths = new AppPaths(tempRoot);
            var store = new ProtectedFileStore(paths);
            await store.SavePendingFlowAsync(new PendingAuthFlow("expected", "nonce", "verifier", DateTimeOffset.UtcNow));

            var authService = CreateAuthService(store);

            await authService.HandleCallbackUriAsync(new Uri("stringify-gg://auth/callback?code=abc&state=wrong"));

            Assert.Contains("state did not match", authService.CallbackError, StringComparison.OrdinalIgnoreCase);
            Assert.Null(authService.Session);
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    [Fact]
    public async Task HandleCallbackUriAsync_RejectsMissingCode()
    {
        var tempRoot = CreateTempDirectory();
        try
        {
            var paths = new AppPaths(tempRoot);
            var store = new ProtectedFileStore(paths);
            await store.SavePendingFlowAsync(new PendingAuthFlow("expected", "nonce", "verifier", DateTimeOffset.UtcNow));

            var authService = CreateAuthService(store);

            await authService.HandleCallbackUriAsync(new Uri("stringify-gg://auth/callback?state=expected"));

            Assert.Contains("authorization code", authService.CallbackError, StringComparison.OrdinalIgnoreCase);
        }
        finally
        {
            Directory.Delete(tempRoot, true);
        }
    }

    [Fact]
    public async Task CreateCodeChallengeAsync_ReturnsBase64UrlValue()
    {
        var challenge = await AuthService.CreateCodeChallengeAsync("abc123");

        Assert.DoesNotContain("+", challenge, StringComparison.Ordinal);
        Assert.DoesNotContain("/", challenge, StringComparison.Ordinal);
        Assert.DoesNotContain("=", challenge, StringComparison.Ordinal);
        Assert.NotEmpty(challenge);
    }

    private static AuthService CreateAuthService(ProtectedFileStore store)
    {
        var config = new AppConfiguration(
            "https://stringify.gg",
            "https://clerk.stringify.gg",
            "client-id",
            "profile email",
            "stringify-gg://auth/callback",
            "C:\\Temp");

        return new AuthService(config, store, new SystemClock(), new HttpClient(new StubHttpHandler(_ => throw new InvalidOperationException("Network should not be called."))));
    }

    private static string CreateTempDirectory()
    {
        var path = Path.Combine(Path.GetTempPath(), $"StringifyDesktop.Tests.{Guid.NewGuid():N}");
        Directory.CreateDirectory(path);
        return path;
    }
}
