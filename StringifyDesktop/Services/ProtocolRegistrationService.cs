using Microsoft.Win32;
using StringifyDesktop.Models;

namespace StringifyDesktop.Services;

public sealed class ProtocolRegistrationService
{
    private readonly AppConfiguration configuration;

    public ProtocolRegistrationService(AppConfiguration configuration)
    {
        this.configuration = configuration;
    }

    public void EnsureRegistered()
    {
        try
        {
            var callback = new Uri(configuration.OAuthCallbackUri);
            var executablePath = Environment.ProcessPath;
            if (string.IsNullOrWhiteSpace(executablePath))
            {
                return;
            }

            using var key = Registry.CurrentUser.CreateSubKey($@"Software\Classes\{callback.Scheme}");
            key?.SetValue(string.Empty, "URL:Stringify Desktop Protocol");
            key?.SetValue("URL Protocol", string.Empty);

            using var iconKey = key?.CreateSubKey("DefaultIcon");
            iconKey?.SetValue(string.Empty, $"\"{executablePath}\",0");

            using var commandKey = key?.CreateSubKey(@"shell\open\command");
            commandKey?.SetValue(string.Empty, $"\"{executablePath}\" \"%1\"");
        }
        catch
        {
            // Packaged installs register the protocol in the app manifest, so registry registration
            // is best-effort for unpackaged builds only.
        }
    }
}
