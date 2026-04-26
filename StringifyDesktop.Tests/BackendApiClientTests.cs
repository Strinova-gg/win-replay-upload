using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using StringifyDesktop.Models;
using StringifyDesktop.Services;

namespace StringifyDesktop.Tests;

public sealed class BackendApiClientTests
{
    [Fact]
    public async Task RequestUploadUrlsAsync_ParsesMixedBatchResponse()
    {
        HttpRequestMessage? capturedRequest = null;
        string? capturedBody = null;
        var httpClient = new HttpClient(new StubHttpHandler(request =>
        {
            capturedRequest = request;
            capturedBody = request.Content!.ReadAsStringAsync().GetAwaiter().GetResult();
            return new HttpResponseMessage(HttpStatusCode.OK)
            {
                Content = new StringContent(
                    """
                    {
                      "urls": [
                        {
                          "name": "match-1.replay",
                          "signedUrl": "https://storage.example/upload/1",
                          "method": "PUT",
                          "headers": {
                            "x-ms-blob-type": "BlockBlob"
                          }
                        },
                        {
                          "name": "match-2.replay",
                          "error": "ALREADY_UPLOADED"
                        },
                        {
                          "name": "match-3.replay",
                          "uploadUrl": "https://storage.example/upload/3"
                        }
                      ]
                    }
                    """,
                    Encoding.UTF8,
                    "application/json")
            };
        }));

        var client = new BackendApiClient(CreateConfiguration(), httpClient);

        var routes = await client.RequestUploadUrlsAsync(
            [
                new UploadRouteRequest("match-1.replay", 1234),
                new UploadRouteRequest("match-2.replay", 2345),
                new UploadRouteRequest("match-3.replay", 3456)
            ],
            "token");

        Assert.NotNull(capturedRequest);
        Assert.Equal(HttpMethod.Post, capturedRequest!.Method);
        Assert.Equal("https://example.invalid/api/upload", capturedRequest.RequestUri!.ToString());
        Assert.Equal(new AuthenticationHeaderValue("Bearer", "token"), capturedRequest.Headers.Authorization);

        using var payload = JsonDocument.Parse(capturedBody!);
        Assert.Equal(3, payload.RootElement.GetProperty("files").GetArrayLength());

        var first = Assert.IsType<UploadRouteResult.Ready>(routes[0]);
        Assert.Equal("match-1.replay", first.FileName);
        Assert.Equal("https://storage.example/upload/1", first.UploadUrl);
        Assert.Equal("PUT", first.Method);
        Assert.Equal("BlockBlob", first.Headers["x-ms-blob-type"]);

        var second = Assert.IsType<UploadRouteResult.AlreadyUploaded>(routes[1]);
        Assert.Equal("match-2.replay", second.FileName);
        Assert.Equal(403, second.HttpStatus);

        var third = Assert.IsType<UploadRouteResult.Ready>(routes[2]);
        Assert.Equal("match-3.replay", third.FileName);
        Assert.Equal("https://storage.example/upload/3", third.UploadUrl);
        Assert.Equal("PUT", third.Method);
    }

    [Fact]
    public async Task RequestUploadUrlAsync_ParsesCamelCaseErrorResponse()
    {
        var httpClient = new HttpClient(new StubHttpHandler(_ =>
            new HttpResponseMessage(HttpStatusCode.BadRequest)
            {
                Content = new StringContent(
                    """
                    {
                      "error": "bad payload"
                    }
                    """,
                    Encoding.UTF8,
                    "application/json")
            }));

        var client = new BackendApiClient(CreateConfiguration(), httpClient);

        var error = await Assert.ThrowsAsync<BackendError>(() =>
            client.RequestUploadUrlAsync("match.replay", 1234, "token"));

        Assert.Equal(400, error.Status);
        Assert.Equal("bad payload", error.Message);
    }

    private static AppConfiguration CreateConfiguration()
    {
        return new AppConfiguration(
            "https://example.invalid",
            "https://issuer.invalid",
            "client-id",
            "openid profile email",
            "stringify-gg://auth/callback",
            "C:\\Replays");
    }
}
