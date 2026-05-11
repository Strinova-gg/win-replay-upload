using System.Text.Json;
using StringifyDesktop.Models;

namespace StringifyDesktop.Services;

public sealed class AppConfigurationLoader
{
    public AppConfiguration Load(AppPaths paths)
    {
        var dto = LoadFileConfiguration() ?? new ConfigurationDto();

        var backendUrl = Read("BACKEND_URL", dto.BackendUrl, "https://stringify.gg");
        var issuer = Read("CLERK_OAUTH_ISSUER", dto.OAuthIssuer, "https://clerk.stringify.gg");
        var clientId = Read("CLERK_OAUTH_CLIENT_ID", dto.OAuthClientId, "9YfNu3Z7Vm9PvZ6G");
        var scopes = Read("CLERK_OAUTH_SCOPES", dto.OAuthScopes, "profile email");
        var callback = Read("CLERK_OAUTH_CALLBACK_URI", dto.OAuthCallbackUri, "stringify-gg://auth/callback");

        var defaultReplayFolder = Environment.ExpandEnvironmentVariables(
            Read(
                "DEFAULT_REPLAY_FOLDER",
                dto.DefaultReplayFolder,
                "%LOCALAPPDATA%\\Strinova\\Saved\\Demos"));

        return new AppConfiguration(
            backendUrl.TrimEnd('/'),
            issuer.TrimEnd('/'),
            clientId,
            scopes,
            callback,
            defaultReplayFolder);
    }

    private static string Read(string envKey, string? fileValue, string fallback)
    {
        return Environment.GetEnvironmentVariable(envKey) ?? fileValue ?? fallback;
    }

    private static ConfigurationDto? LoadFileConfiguration()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "appsettings.json");
        if (!File.Exists(path))
        {
            return null;
        }

        return JsonSerializer.Deserialize<ConfigurationDto>(File.ReadAllText(path));
    }

    private sealed class ConfigurationDto
    {
        public string? BackendUrl { get; set; }

        public string? OAuthIssuer { get; set; }

        public string? OAuthClientId { get; set; }

        public string? OAuthScopes { get; set; }

        public string? OAuthCallbackUri { get; set; }

        public string? DefaultReplayFolder { get; set; }
    }
}
