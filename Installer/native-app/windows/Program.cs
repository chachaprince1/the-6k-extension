using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.Win32;

namespace The6KExtensionInstaller;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new InstallerForm());
    }
}

internal sealed class InstallerForm : Form
{
    readonly Label title = new() { AutoSize = true, Font = new Font(SystemFonts.DefaultFont.FontFamily, 22, FontStyle.Bold), MaximumSize = new Size(620, 0) };
    readonly Label body = new() { AutoSize = true, Font = new Font(SystemFonts.DefaultFont.FontFamily, 12), MaximumSize = new Size(620, 0) };
    readonly FlowLayoutPanel buttons = new() { AutoSize = true, FlowDirection = FlowDirection.TopDown, WrapContents = false };
    readonly StudyInstaller installer = new();
    readonly CallbackServer callback = new();
    string screen = "intro";
    string? callbackWarning;

    public InstallerForm()
    {
        Text = "The 6K Extension Installer";
        ClientSize = new Size(700, 520);
        MinimumSize = new Size(600, 400);
        StartPosition = FormStartPosition.CenterScreen;

        var panel = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(28),
            FlowDirection = FlowDirection.TopDown,
            WrapContents = false,
            AutoScroll = true
        };
        panel.Controls.AddRange([title, body, buttons]);
        Controls.Add(panel);

        callback.ExtensionLoaded += () =>
        {
            if (IsHandleCreated)
                BeginInvoke((Action)(() =>
                {
                    if (screen == "step")
                        ShowWebSetup();
                }));
        };
        callbackWarning = callback.Start();
        FormClosed += (_, _) => callback.Dispose();
        Render();
    }

    void Render(string? error = null)
    {
        var content = screen switch
        {
            "intro" => (
                "Welcome to The 6K Extension",
                "This little installer will help guide you through the installation of The 6K Extension. Just follow each step. Some of it will be automated and some of it will require manual clicks from you."),
            "step" => (
                "One Chrome step left",
                """
                I copied The 6K Extension folder address and opened Chrome's Extensions page.

                1. In Chrome, turn on the Developer mode switch in the top-right.
                2. Click Load unpacked in the top-left.
                3. In the folder window, press Ctrl+L, then Ctrl+V, then Enter.
                4. The The 6K Extension folder appears. Click Select Folder.

                Chrome should show a card named “The 6K Extension.” This is the one and only folder to load.
                """ + (callbackWarning is null ? "" : $"\n\n{callbackWarning}")),
            "manual-confirmation" => (
                "Please confirm Chrome loaded it",
                "I could not automatically confirm Chrome's response. At chrome://extensions, make sure you can see a card named “The 6K Extension.” If you do, confirm below. Otherwise, copy the folder path again and repeat the four steps."),
            "web-setup" => (
                "Continue setup in Chrome",
                """
                Chrome confirmed that The 6K Extension loaded. Keep this guide open while you finish its setup page.

                1. You need a free jpdb account. Create one or sign in, then on the jpdb row click Connect signed-in account. On jpdb's settings page, click Use this API key.
                2. Keep Anki open and confirm AnkiConnect says Connected.
                3. Return to The 6K Extension setup page and click Check again after each step.

                Do not finish this guide until jpdb and Yomitan show Connected.
                """),
            "web-setup-yomitan" => (
                "One Yomitan setting needs attention",
                """
                The installer could not reach Yomitan's local API. In The 6K Extension setup page, click Open API switch in the Yomitan row. In Yomitan settings, turn on Advanced, then Enable Yomitan API. Return to The 6K Extension and click Check again.

                Then create or sign in to your free jpdb account, click Connect signed-in account and Use this API key. Keep Anki open and confirm AnkiConnect says Connected.

                Do not finish this guide until jpdb and Yomitan show Connected.
                """),
            "complete" => (
                "Setup guide complete",
                "The 6K Extension is loaded, and you confirmed the remaining jpdb and Yomitan setup steps in Chrome. You can close this guide."),
            _ => ("Setup needs attention", error ?? "Try again.")
        };

        title.Text = content.Item1;
        body.Text = content.Item2;
        buttons.Controls.Clear();

        switch (screen)
        {
            case "intro":
                Button("Start setup", Start);
                break;
            case "step":
                Button("Copy folder path again", installer.CopyPath);
                Button("Open Chrome again", OpenChrome);
                Button("I selected the folder and can see The 6K Extension", () => { screen = "manual-confirmation"; Render(); });
                break;
            case "manual-confirmation":
                Button("Yes, I can see The 6K Extension in Chrome", ShowWebSetup);
                Button("Copy folder path again", installer.CopyPath);
                Button("Open Chrome again", OpenChrome);
                break;
            case "web-setup":
            case "web-setup-yomitan":
                Button("I finished the web setup and can see all connections", () => { screen = "complete"; Render(); });
                Button("Open Chrome Extensions again", OpenChrome);
                break;
            case "complete":
                Button("Close", Close);
                break;
            default:
                Button("Try again", Start);
                break;
        }
    }

    void Button(string text, Action handler)
    {
        var button = new Button { Text = text, AutoSize = true, Padding = new Padding(12, 7, 12, 7), Font = new Font(SystemFonts.DefaultFont.FontFamily, 11) };
        button.Click += (_, _) => handler();
        buttons.Controls.Add(button);
    }

    void Start()
    {
        try
        {
            installer.Install();
            installer.CopyPath();
            installer.OpenChrome();
            screen = "step";
            Render();
        }
        catch (Exception exception)
        {
            screen = "error";
            Render(exception.Message);
        }
    }

    void OpenChrome()
    {
        try
        {
            installer.OpenChrome();
        }
        catch (Exception exception)
        {
            screen = "error";
            Render(exception.Message);
        }
    }

    async void ShowWebSetup()
    {
        buttons.Enabled = false;
        var yomitanReady = await installer.CheckYomitanApiAsync();
        if (IsDisposed)
            return;
        screen = yomitanReady ? "web-setup" : "web-setup-yomitan";
        Render();
    }
}

internal sealed class CallbackServer : IDisposable
{
    readonly TcpListener listener = new(IPAddress.Loopback, 19634);
    public event Action? ExtensionLoaded;

    public string? Start()
    {
        try
        {
            listener.Start();
            _ = AcceptLoop();
            return null;
        }
        catch (SocketException)
        {
            return "Automatic confirmation is unavailable because port 19634 is already in use. You can still finish setup manually.";
        }
    }

    async Task AcceptLoop()
    {
        while (true)
        {
            try
            {
                using var client = await listener.AcceptTcpClientAsync();
                using var stream = client.GetStream();
                var buffer = new byte[8192];
                var count = await stream.ReadAsync(buffer);
                var request = Encoding.ASCII.GetString(buffer, 0, count);
                var target = request.Split(' ', StringSplitOptions.RemoveEmptyEntries).Skip(1).FirstOrDefault();
                var valid = target is not null
                    && Uri.TryCreate($"http://127.0.0.1{target}", UriKind.Absolute, out var uri)
                    && uri.AbsolutePath == "/extension-loaded"
                    && uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries)
                        .Any(pair => pair.Split('=', 2) is [var name, var value]
                            && Uri.UnescapeDataString(name) == "extension"
                            && Uri.UnescapeDataString(value) == "the-6k");

                if (valid)
                    ExtensionLoaded?.Invoke();

                var response = valid ? "HTTP/1.1 204 No Content" : "HTTP/1.1 404 Not Found";
                await stream.WriteAsync(Encoding.ASCII.GetBytes($"{response}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"));
            }
            catch (ObjectDisposedException)
            {
                return;
            }
            catch (SocketException)
            {
                return;
            }
        }
    }

    public void Dispose() => listener.Stop();
}

internal sealed class StudyInstaller
{
    const string PayloadPrefix = "payload/extensions/the-6k-extension/";
    readonly string root = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Anime Study Tools");
    readonly string extensionName = "the-6k-extension";

    public void Install()
    {
        var destination = Path.Combine(root, "Extensions", extensionName);
        Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
        var stage = Path.Combine(root, "Extensions", $".{extensionName}.new-{Guid.NewGuid():N}");

        try
        {
            ExtractExtension(stage);
            Validate(Path.Combine(stage, "manifest.json"));
            if (Directory.Exists(destination))
                Directory.Move(destination, Path.Combine(root, "Extensions", $".{extensionName}.backup-{Guid.NewGuid():N}"));
            Directory.Move(stage, destination);
            InstallHost();
        }
        catch
        {
            if (Directory.Exists(stage))
                Directory.Delete(stage, true);
            throw;
        }
    }

    void ExtractExtension(string stage)
    {
        var assembly = Assembly.GetExecutingAssembly();
        var resources = assembly.GetManifestResourceNames()
            .Where(name => name.StartsWith(PayloadPrefix, StringComparison.Ordinal))
            .ToArray();
        if (!resources.Any(name => name == PayloadPrefix + "manifest.json"))
            throw new InvalidOperationException("Installer payload is missing.");

        Directory.CreateDirectory(stage);
        var stageRoot = Path.GetFullPath(stage) + Path.DirectorySeparatorChar;
        foreach (var name in resources)
        {
            var relativePath = name[PayloadPrefix.Length..].Replace('/', Path.DirectorySeparatorChar);
            var outputPath = Path.GetFullPath(Path.Combine(stage, relativePath));
            if (!outputPath.StartsWith(stageRoot, StringComparison.Ordinal))
                throw new InvalidOperationException("Installer payload contains an invalid path.");
            Directory.CreateDirectory(Path.GetDirectoryName(outputPath)!);
            using var input = Resource(name);
            using var output = File.Create(outputPath);
            input.CopyTo(output);
        }
    }

    static void Validate(string manifest)
    {
        using var document = JsonDocument.Parse(File.ReadAllText(manifest));
        if (document.RootElement.GetProperty("name").GetString() != "The 6K Extension"
            || document.RootElement.GetProperty("manifest_version").GetInt32() != 3)
            throw new InvalidOperationException("The bundled The 6K Extension is invalid.");
    }

    void InstallHost()
    {
        var directory = Path.Combine(root, "Yomitan API", "1.0.0");
        Directory.CreateDirectory(directory);
        var host = Path.Combine(directory, "yomitan-api-host.exe");
        WriteResource("helper/yomitan-api-host.exe", host);
        WriteResource("helper/LICENSE.yomitan-api.txt", Path.Combine(directory, "LICENSE.yomitan-api.txt"));

        var manifest = Path.Combine(directory, "yomitan_api.json");
        var json = JsonSerializer.Serialize(new
        {
            name = "yomitan_api",
            description = "Yomitan API native messaging host",
            path = host,
            type = "stdio",
            allowed_origins = new[] { "chrome-extension://likgccmbimhjbgkjambclfkhldnlhbnn/" }
        }, new JsonSerializerOptions { WriteIndented = true });
        File.WriteAllText(manifest, json);

        using var key = Registry.CurrentUser.CreateSubKey(@"Software\Google\Chrome\NativeMessagingHosts\yomitan_api");
        key?.SetValue("", manifest);
    }

    static void WriteResource(string resourceName, string destination)
    {
        var temporary = destination + $".new-{Guid.NewGuid():N}";
        try
        {
            using (var input = Resource(resourceName))
            using (var output = File.Create(temporary))
                input.CopyTo(output);
            File.Move(temporary, destination, true);
        }
        finally
        {
            if (File.Exists(temporary))
                File.Delete(temporary);
        }
    }

    static Stream Resource(string name) =>
        Assembly.GetExecutingAssembly().GetManifestResourceStream(name)
        ?? throw new InvalidOperationException($"Installer resource is missing: {name}");

    public void CopyPath() => Clipboard.SetText(Path.Combine(root, "Extensions", extensionName));

    public void OpenChrome()
    {
        var chrome = Registry.LocalMachine.OpenSubKey(@"SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe")?.GetValue("") as string
            ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), @"Google\Chrome\Application\chrome.exe");
        if (!File.Exists(chrome))
            throw new InvalidOperationException("Google Chrome was not found. Install Chrome, then click Open Chrome again.");
        Process.Start(new ProcessStartInfo(chrome, "chrome://extensions/") { UseShellExecute = true });
    }

    public async Task<bool> CheckYomitanApiAsync()
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        using var body = new StringContent("{}", Encoding.UTF8, "application/json");
        try
        {
            using var response = await client.PostAsync("http://127.0.0.1:19633/serverVersion", body);
            return response.IsSuccessStatusCode;
        }
        catch (HttpRequestException)
        {
            return false;
        }
        catch (TaskCanceledException)
        {
            return false;
        }
    }
}
