using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Security.Cryptography;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Branchline.Preview;

internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        if (args.SequenceEqual(new[] { "--pc-files" })) { PcFiles.Run(); return; }
        ApplicationConfiguration.Initialize();
        bool smoke = args.Contains("--smoke-test");
        // Patch releases retain this workspace identity; opening an update must not create an empty replacement.
        string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Branchline Preview", "0.7.0");
        int index = Array.IndexOf(args, "--data-dir");
        if (index >= 0 && index + 1 < args.Length) data = Path.GetFullPath(args[index + 1]);
        bool smokeHistory = args.Contains("--smoke-history");
        if (smokeHistory && (!smoke || index < 0)) { Environment.ExitCode = 2; return; }
        // This preview is intentionally separate from the installed Beta workspace.
        string key = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(data.ToUpperInvariant())));
        using var mutex = new Mutex(true, @"Local\Branchline.Preview." + key, out bool created);
        if (!created) { if (!smoke) MessageBox.Show("Branchline Preview is already open. Look for its tree icon on the taskbar.", "Branchline Preview"); Environment.ExitCode = 2; return; }
        Application.Run(new PreviewWindow(data, smoke, args.Contains("--setup-apertus"), smokeHistory, args.Contains("--setup-hearthline")));
    }
}

internal sealed class PreviewWindow : Form
{
    private readonly string data;
    private readonly bool smoke;
    private readonly bool setupApertus;
    private readonly bool setupHearthline;
    private readonly bool smokeHistory;
    private readonly Stopwatch startupWatch = Stopwatch.StartNew();
    private double uiReadyMs;
    private readonly string appRoot = AppContext.BaseDirectory;
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };
    private readonly Label status = new() { Dock = DockStyle.Fill, Text = "Opening your Branchline preview…", TextAlign = ContentAlignment.MiddleCenter };
    private readonly StringBuilder errors = new();
    private Process? backend;
    private OwnedProcessJob? backendJob;
    private Uri? origin;
    private string? sessionToken;
    private bool closing, canClose;
    private bool smokePassed;
    private bool backendStarted;
    private string backendExit = "not-started";
    private double shutdownMs;
    private readonly CancellationTokenSource lifetime = new();
    private readonly TaskCompletionSource<bool> smokeDownload = new(TaskCreationOptions.RunContinuationsAsynchronously);

    public PreviewWindow(string data, bool smoke, bool setupApertus, bool smokeHistory, bool setupHearthline)
    {
        this.data = data; this.smoke = smoke; this.setupApertus = setupApertus; this.smokeHistory = smokeHistory;
        this.setupHearthline = setupHearthline;
        var releaseVersion = System.Reflection.CustomAttributeExtensions.GetCustomAttribute<System.Reflection.AssemblyInformationalVersionAttribute>(typeof(PreviewWindow).Assembly)?.InformationalVersion.Split('+')[0];
        Text = $"Branchline · v{releaseVersion}"; Width = 1280; Height = 900;
        MinimumSize = new Size(780, 580); StartPosition = FormStartPosition.CenterScreen;
        BackColor = Color.FromArgb(244, 242, 234);
        if (smoke) { ShowInTaskbar = false; Opacity = 0; }
        string icon = Path.Combine(appRoot, "public", "assets", "branchline.ico");
        if (File.Exists(icon)) Icon = new Icon(icon);
        Controls.Add(web); Controls.Add(status);
        Shown += async (_, _) => await StartAsync();
        FormClosing += async (_, e) => {
            if (canClose) return;
            e.Cancel = true;
            if (closing) return;
            closing = true; Enabled = false;
            try {
                if (!await PreparePageCloseAsync()) { closing = false; Enabled = true; return; }
            } catch (Exception error) {
                errors.AppendLine("Close save: " + error.Message);
                if (!smoke) {
                    MessageBox.Show(this, "Branchline stayed open because an unfinished edit could not be saved.\n\n" + error.Message, "Your edits are still here", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                    await web.ExecuteScriptAsync("window.branchlineCancelClose?.()");
                    closing = false; Enabled = true; return;
                }
                smokePassed = false;
            }
            lifetime.Cancel();
            await StopBackendAsync();
            web.Dispose();
            if (smoke) {
                smokePassed &= backendExit == "graceful";
                await File.WriteAllTextAsync(Path.Combine(data, "smoke-result.json"), JsonSerializer.Serialize(new { status = smokePassed ? "PASS" : "FAIL", backendStopped = !backendStarted || backend!.HasExited, backendExit, shutdownMs, workspace = Path.Combine(data, "workspace"), uiReadyMs, errors = errors.ToString() }));
                Environment.ExitCode = smokePassed ? 0 : 1;
            }
            canClose = true; Close();
        };
    }

    private async Task StartAsync()
    {
        try {
            Directory.CreateDirectory(data);
            // Prepare the browser environment alongside history verification.
            // Navigation and API credentials still wait for validated readiness.
            var environmentTask = CoreWebView2Environment.CreateAsync(null, Path.Combine(data, "webview"));
            _ = environmentTask.ContinueWith(task => { _ = task.Exception; }, TaskContinuationOptions.OnlyOnFaulted);
            var start = new ProcessStartInfo(Path.Combine(appRoot, "node.exe")) {
                WorkingDirectory = appRoot, UseShellExecute = false, CreateNoWindow = true,
                RedirectStandardInput = true, RedirectStandardOutput = true, RedirectStandardError = true
            };
            start.ArgumentList.Add(Path.Combine(appRoot, "server", "desktop.mjs"));
            start.Environment["BRANCHLINE_DATA_DIR"] = Path.Combine(data, "workspace");
            start.Environment["BRANCHLINE_PUBLIC_DIR"] = Path.Combine(appRoot, "public");
            start.Environment["BRANCHLINE_NATIVE_FILES"] = Environment.ProcessPath;
            if (setupApertus && !smoke) start.Environment["BRANCHLINE_SETUP_APERTUS"] = "1";
            else start.Environment.Remove("BRANCHLINE_SETUP_APERTUS");
            if (setupHearthline && !smoke) start.Environment["BRANCHLINE_SETUP_HEARTHLINE"] = "1";
            else start.Environment.Remove("BRANCHLINE_SETUP_HEARTHLINE");
            start.Environment.Remove("NODE_OPTIONS");
            backend = new Process { StartInfo = start, EnableRaisingEvents = true };
            backend.ErrorDataReceived += (_, e) => { if (e.Data is not null) lock (errors) { if (errors.Length < 64000) errors.AppendLine(e.Data); } };
            backendJob = new OwnedProcessJob();
            backendStarted = backend.Start();
            backendJob.Add(backend);
            backend.BeginErrorReadLine();
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token);
            string line;
            while (true) {
                // Large existing journals report progress while replaying. A
                // healthy replay must not be killed by the old 25-second limit.
                timeout.CancelAfter(TimeSpan.FromSeconds(60));
                line = await backend.StandardOutput.ReadLineAsync(timeout.Token) ?? throw new IOException("The local server stopped before opening.");
                using var progress = JsonDocument.Parse(line);
                if (progress.RootElement.GetProperty("type").GetString() != "loading") break;
                long records = progress.RootElement.GetProperty("recordCount").GetInt64();
                string phase = progress.RootElement.TryGetProperty("phase", out var phaseValue) ? phaseValue.GetString() ?? "replay" : "replay";
                long bytes = progress.RootElement.TryGetProperty("bytes", out var byteValue) ? byteValue.GetInt64() : 0;
                status.Text = phase switch {
                    "integrity" => $"Checking saved history…\n{bytes / (1024 * 1024):N0} MB checked",
                    "compress" => "Compressing and verifying saved history…\nEvery original record is retained.",
                    "tail" => "Loading recent changes…",
                    _ => $"Opening your saved history…\n{records:N0} records checked"
                };
            }
            using var ready = JsonDocument.Parse(line);
            if (ready.RootElement.GetProperty("type").GetString() != "ready") throw new IOException("The local server did not report ready.");
            origin = new Uri(ready.RootElement.GetProperty("url").GetString()!);
            sessionToken = ready.RootElement.GetProperty("sessionToken").GetString();
            if (sessionToken is null || sessionToken.Length != 64 || sessionToken.Any(c => !"0123456789abcdef".Contains(c))) throw new IOException("The local server did not establish a paired session.");
            if (origin.Scheme != "http" || origin.Host != "127.0.0.1" || origin.Port < 1 || origin.AbsolutePath != "/" || origin.Query.Length > 0 || origin.Fragment.Length > 0) throw new IOException("Unexpected local server address.");
            var environment = await environmentTask;
            if (closing) return;
            await web.EnsureCoreWebView2Async(environment);
            web.CoreWebView2.Settings.AreHostObjectsAllowed = false;
            web.CoreWebView2.Settings.IsWebMessageEnabled = false;
            web.CoreWebView2.Settings.IsStatusBarEnabled = false;
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            // Launch credential stays in the native host; never placed in model context or page storage.
            web.CoreWebView2.AddWebResourceRequestedFilter(origin.GetLeftPart(UriPartial.Authority) + "/api/*", CoreWebView2WebResourceContext.All);
            web.CoreWebView2.WebResourceRequested += (_, e) => {
                if (Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out var requestUri)
                    && requestUri.GetLeftPart(UriPartial.Authority) == origin.GetLeftPart(UriPartial.Authority)
                    && requestUri.AbsolutePath.StartsWith("/api/", StringComparison.Ordinal))
                    e.Request.Headers.SetHeader("x-branchline-session", sessionToken);
            };
            web.CoreWebView2.PermissionRequested += (_, e) => { e.State = CoreWebView2PermissionState.Deny; e.Handled = true; };
            web.CoreWebView2.NewWindowRequested += (_, e) => {
                e.Handled = true;
                // Only an explicit click can open the official account sign-in in the browser.
                if (e.IsUserInitiated && Uri.TryCreate(e.Uri, UriKind.Absolute, out var auth)
                    && auth.Scheme == "https" && auth.Host == "auth.openai.com" && auth.IsDefaultPort
                    && auth.UserInfo.Length == 0) {
                    try { Process.Start(new ProcessStartInfo(auth.AbsoluteUri) { UseShellExecute = true }); }
                    catch (Exception) { MessageBox.Show(this, "Open your browser and retry sign-in from Models.", "Branchline sign-in"); }
                }
            };
            web.CoreWebView2.DownloadStarting += (_, e) => {
                string local = origin.GetLeftPart(UriPartial.Authority);
                string uri = e.DownloadOperation.Uri;
                bool localExport = uri.StartsWith("blob:" + local + "/", StringComparison.Ordinal)
                    || (Uri.TryCreate(uri, UriKind.Absolute, out var exportUri)
                        && exportUri.GetLeftPart(UriPartial.Authority) == local
                        && (exportUri.AbsolutePath == "/api/export" || exportUri.AbsolutePath == "/api/continuity/export" || exportUri.AbsolutePath == "/api/harnesses/export"));
                e.Handled = true;
                if (!localExport) { e.Cancel = true; return; }
                if (smoke) {
                    e.ResultFilePath = Path.Combine(data, "native-download.json");
                    var download = e.DownloadOperation;
                    download.StateChanged += (_, _) => {
                        if (download.State == CoreWebView2DownloadState.Completed) smokeDownload.TrySetResult(true);
                        else if (download.State == CoreWebView2DownloadState.Interrupted) smokeDownload.TrySetException(new IOException("Native export was interrupted."));
                    };
                } else {
                    using var save = new SaveFileDialog { Title = "Save a Branchline export", FileName = Path.GetFileName(e.ResultFilePath), OverwritePrompt = true, AddExtension = true };
                    if (save.ShowDialog(this) == DialogResult.OK) e.ResultFilePath = save.FileName;
                    else e.Cancel = true;
                }
            };
            web.CoreWebView2.NavigationStarting += (_, e) => {
                if (!Uri.TryCreate(e.Uri, UriKind.Absolute, out var next) || next.GetLeftPart(UriPartial.Authority) != origin.GetLeftPart(UriPartial.Authority)) e.Cancel = true;
            };
            web.CoreWebView2.NavigationCompleted += async (_, e) => {
                if (!e.IsSuccess) { status.Text = "The preview page could not open. Close the window and try again."; return; }
                status.Visible = false;
                if (smoke) {
                    try {
                        // Exercise only explicitly selected synthetic smoke data.
                        string result = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#attach-file') !== null && document.title.includes('Branchline')");
                        if (result != "true") throw new IOException("The native page did not render its file control.");
                        using var client = new HttpClient();
                        using var unpaired = await client.GetAsync(new Uri(origin, "/api/state"));
                        if (unpaired.StatusCode != System.Net.HttpStatusCode.Unauthorized) throw new IOException("Unpaired access was not rejected.");
                        client.DefaultRequestHeaders.Add("x-branchline-session", sessionToken);
                        string rawState = await client.GetStringAsync(new Uri(origin, "/api/state"));
                        using var state = JsonDocument.Parse(rawState);
                        int expectedRoots = File.Exists(Path.Combine(appRoot, "bundled-model", "manifest.json")) ? 1 : 0;
                        if (smokeHistory) {
                            using var expected = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(data, "native-expected.json")));
                            expectedRoots = expected.RootElement.GetProperty("roots").GetInt32();
                            string actualHash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(rawState))).ToLowerInvariant();
                            if (actualHash != expected.RootElement.GetProperty("stateSha256").GetString()) throw new IOException("Native history differs from the exact synthetic fixture.");
                            if (expected.RootElement.TryGetProperty("imageObjects", out var expectedPictures)) {
                                using var exported = JsonDocument.Parse(await client.GetStringAsync(new Uri(origin, "/api/export")));
                                if (exported.RootElement.GetProperty("profile").GetString() != "branchline.workspace-export/2") throw new IOException("Unknown picture export format.");
                                if (exported.RootElement.GetProperty("state").GetRawText() != rawState) throw new IOException("Picture export changed the saved state.");
                                var pictures = exported.RootElement.GetProperty("imageObjects");
                                if (pictures.GetArrayLength() != expectedPictures.GetInt32()) throw new IOException("Native picture export count changed.");
                                foreach (var picture in pictures.EnumerateArray()) {
                                    byte[] bytes = Convert.FromBase64String(picture.GetProperty("base64").GetString()!);
                                    string hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
                                    if (hash != picture.GetProperty("sha256").GetString() || bytes.Length != picture.GetProperty("byteLength").GetInt32()) throw new IOException("Native picture export bytes changed.");
                                }
                            }
                        }
                        var workspaceState = state.RootElement;
                        if (workspaceState.GetProperty("roots").GetArrayLength() != expectedRoots) throw new IOException("Smoke workspace did not match its synthetic fixture.");
                        for (int i = 0; i < 50; i++) {
                            result = await web.CoreWebView2.ExecuteScriptAsync("document.documentElement.dataset.theme === 'garden'");
                            if (result == "true") break;
                            await Task.Delay(100);
                        }
                        if (result != "true") throw new IOException("The appearance module did not initialize.");
                        await web.CoreWebView2.ExecuteScriptAsync("void (async () => { const r = await fetch('/api/state'); document.documentElement.dataset.paired = String(r.ok && (await r.json()).roots.length === " + expectedRoots + " && sessionStorage.getItem('branchline.session') === null); })()");
                        for (int i = 0; i < 50; i++) {
                            result = await web.CoreWebView2.ExecuteScriptAsync("document.documentElement.dataset.paired === 'true'");
                            if (result == "true") break;
                            await Task.Delay(100);
                        }
                        if (result != "true") throw new IOException("The native UI did not authenticate with its private launch session.");
                        for (int i = 0; i < 50; i++) {
                            result = await web.CoreWebView2.ExecuteScriptAsync("(() => { const image = document.querySelector('.dream-art img'); return !!image && image.complete && image.naturalWidth > 0 && document.querySelector('.dream-start')?.disabled === true && document.querySelector('.dream-timeline')?.textContent.includes('Scheduling coming later'); })()");
                            if (result == "true") break;
                            await Task.Delay(100);
                        }
                        if (result != "true") throw new IOException("The Dream introduction or its SVG did not load in the native page.");
                        if (smokeHistory) {
                            for (int i = 0; i < 50; i++) {
                                result = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#branch-list').textContent.includes('Synthetic packet branch')");
                                if (result == "true") break;
                                await Task.Delay(100);
                            }
                            if (result != "true") throw new IOException("Synthetic history did not reach the navigation.");
                        }
                        uiReadyMs = startupWatch.Elapsed.TotalMilliseconds;
                        if (workspaceState.TryGetProperty("images", out var savedImages) && savedImages.GetProperty("selections").GetArrayLength() > 0) {
                            await web.CoreWebView2.ExecuteScriptAsync("void (async () => { const state = await (await fetch('/api/state')).json(); const first = state.images.selections[0]; const response = await fetch('/api/images/object?' + new URLSearchParams({chatId:first.chatId,id:first.id})); const picture = new Image(); picture.id = 'native-fixture-picture'; picture.src = URL.createObjectURL(await response.blob()); document.body.append(picture); })()");
                            for (int i = 0; i < 50; i++) {
                                result = await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#native-fixture-picture')?.naturalWidth > 0");
                                if (result == "true") break;
                                await Task.Delay(100);
                            }
                            if (result != "true") throw new IOException("Saved picture did not load through the paired native session.");
                            await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#native-fixture-picture').remove()");
                        }
                        await web.CoreWebView2.ExecuteScriptAsync("(() => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['{\"synthetic\":true}'], {type:'application/json'})); a.download = 'native-download.json'; a.click(); })()");
                        await smokeDownload.Task.WaitAsync(TimeSpan.FromSeconds(10));
                        if (await File.ReadAllTextAsync(Path.Combine(data, "native-download.json")) != "{\"synthetic\":true}") throw new IOException("Native export bytes did not match.");
                        using var capture = File.Create(Path.Combine(data, "native-preview.png"));
                        await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, capture);
                        if (smokeHistory) {
                            using var expectedClose = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(data, "native-expected.json")));
                            if (expectedClose.RootElement.TryGetProperty("dreamPersonalId", out var dreamPersonal)) {
                                await web.ExecuteScriptAsync("(() => { const select=document.querySelector('#dream-personal-select'); select.value="+dreamPersonal.GetRawText()+"; select.dispatchEvent(new Event('change',{bubbles:true})); document.querySelector('.dreams-section [data-action=dream-review]').click(); })()");
                                for (int i = 0; i < 100; i++) {
                                    result = await web.ExecuteScriptAsync("document.querySelector('#dream-review')?.open === true && !!document.querySelector('.dream-journal-detail h3')");
                                    if (result == "true") break;
                                    await Task.Delay(50);
                                }
                                if (result != "true") throw new IOException("Dream review did not open in the native window.");
                                await web.ExecuteScriptAsync("document.querySelector('#dream-review [data-dream-action=select][data-id='+"+expectedClose.RootElement.GetProperty("dreamRecordId").GetRawText()+"+']').click()");
                                for (int i = 0; i < 100; i++) {
                                    result = await web.ExecuteScriptAsync("!!document.querySelector('#dream-note') && document.querySelector('#dream-review').getAttribute('aria-busy') !== 'true'");
                                    if (result == "true") break;
                                    await Task.Delay(50);
                                }
                                if (result != "true") throw new IOException("The Dream note editor was unavailable.");
                                if (expectedClose.RootElement.TryGetProperty("expectedDreamDraft", out var expectedDreamDraft)) {
                                    result = await web.ExecuteScriptAsync("document.querySelector('#dream-note').value === "+expectedDreamDraft.GetRawText());
                                    if (result != "true") throw new IOException("The unfinished Dream note was not restored.");
                                }
                                using (var dreamCapture = File.Create(Path.Combine(data,"native-dream-review.png"))) await web.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png,dreamCapture);
                                if (expectedClose.RootElement.TryGetProperty("closeDreamNote", out var closeDreamNote)) {
                                    await web.ExecuteScriptAsync("(() => { const note=document.querySelector('#dream-note'); note.value="+closeDreamNote.GetRawText()+"; note.dispatchEvent(new Event('input',{bubbles:true})); document.querySelector('#dream-review .settings-resize').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',bubbles:true})); })()");
                                }
                            }
                            if (expectedClose.RootElement.TryGetProperty("toyShelfHeight", out var shelfHeight)) {
                                result = await web.ExecuteScriptAsync("(() => { const shelf=document.querySelector('.toy-shelf'), art=document.querySelector('.toy-shelf-art'); return shelf?.offsetHeight===" + shelfHeight.GetRawText() + " && art?.complete && art.naturalWidth>0 && [...document.querySelectorAll('.toy-tile')].map(x=>x.dataset.shelfId).join(',')==='desk,peaches' && document.querySelectorAll('.toy-slot').length===1 && !document.querySelector('.toy-shelf-size'); })()");
                                if (result != "true") throw new IOException("Native Toy Shelf did not restore its size, arrangement or artwork.");
                                if (expectedClose.RootElement.TryGetProperty("closeShelf", out var closeShelf) && closeShelf.GetBoolean()) {
                                    await web.ExecuteScriptAsync("document.querySelector('.toy-shelf-grip').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowDown',bubbles:true}))");
                                }
                            }
                            if (expectedClose.RootElement.TryGetProperty("closeDraft", out var closeDraft)) {
                                await web.ExecuteScriptAsync("document.querySelector('.home-resume-button')?.click()");
                                for (int i = 0; i < 100; i++) {
                                    result = await web.ExecuteScriptAsync("!document.querySelector('#composer-form').hidden && !document.querySelector('#message-input').disabled");
                                    if (result == "true") break;
                                    await Task.Delay(50);
                                }
                                if (result != "true") throw new IOException("Synthetic close-test composer was not ready.");
                                await web.ExecuteScriptAsync("(() => { const input = document.querySelector('#message-input'); input.value = " + closeDraft.GetRawText() + "; input.dispatchEvent(new Event('input', {bubbles:true})); })()");
                            }
                            if (expectedClose.RootElement.TryGetProperty("closeSketch", out var closeSketch)) {
                                await web.ExecuteScriptAsync("document.querySelector('#open-sketch-book').click()");
                                for (int i = 0; i < 100; i++) {
                                    result = await web.ExecuteScriptAsync("document.querySelector('#sketch-book')?.open === true");
                                    if (result == "true") break;
                                    await Task.Delay(50);
                                }
                                if (result != "true") throw new IOException("Synthetic Sketch Book was not ready.");
                                await web.ExecuteScriptAsync("document.querySelector('[data-sketch-action=new]').click()");
                                for (int i = 0; i < 100; i++) {
                                    result = await web.ExecuteScriptAsync("!!document.querySelector('#sketch-editor')");
                                    if (result == "true") break;
                                    await Task.Delay(50);
                                }
                                if (result != "true") throw new IOException("Synthetic sketch editor was not ready.");
                                await web.ExecuteScriptAsync("(() => { const form=document.querySelector('#sketch-editor'); form.elements.title.value='Native unfinished sketch'; form.elements.text.value="+closeSketch.GetRawText()+"; form.elements.text.dispatchEvent(new Event('input',{bubbles:true})); })()");
                            }
                        }
                        smokePassed = true;
                    } catch (Exception error) { errors.AppendLine(error.ToString()); }
                    Close();
                }
            };
            web.Source = origin;
        } catch (Exception error) {
            if (closing) return;
            errors.AppendLine(error.ToString());
            string details = "";
            try {
                Directory.CreateDirectory(data);
                await File.WriteAllTextAsync(Path.Combine(data, "startup-error.txt"), errors.ToString());
                details = "\n\nDetails: " + Path.Combine(data, "startup-error.txt");
            } catch (Exception) { /* Report the original startup failure even if this folder is unwritable. */ }
            if (!smoke && error is WebView2RuntimeNotFoundException) {
                var choice = MessageBox.Show(this,
                    "Branchline needs the Microsoft Edge WebView2 Runtime to display its window.\n\n" +
                    "Open Microsoft's download page? Choose the Evergreen Runtime, install it, then open Branchline again. Your conversations stay saved." + details,
                    "WebView2 Runtime needed", MessageBoxButtons.YesNo, MessageBoxIcon.Information);
                if (choice == DialogResult.Yes) {
                    try { Process.Start(new ProcessStartInfo("https://developer.microsoft.com/microsoft-edge/webview2/#download-section") { UseShellExecute = true }); }
                    catch (Exception) { MessageBox.Show(this, "Visit https://developer.microsoft.com/microsoft-edge/webview2/ in your browser and download the Evergreen Runtime.", "WebView2 download"); }
                }
            } else if (!smoke) MessageBox.Show(this, "Branchline could not open.\n\n" + error.Message + details, "Branchline", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Close();
        }
    }

    private async Task<bool> PreparePageCloseAsync()
    {
        if (web.CoreWebView2 is null) return true;
        await web.ExecuteScriptAsync("window.branchlinePrepareClose?.()");
        var waiting = Stopwatch.StartNew();
        while (waiting.Elapsed < TimeSpan.FromSeconds(30)) {
            using var result = JsonDocument.Parse(await web.ExecuteScriptAsync("window.branchlineCloseState ?? null"));
            if (result.RootElement.ValueKind == JsonValueKind.Null) return true; // No editable page loaded yet.
            string state = result.RootElement.GetProperty("status").GetString() ?? "";
            if (state == "ready") return true;
            if (state is "failed" or "needs-confirmation") {
                string message = result.RootElement.GetProperty("message").GetString() ?? "An edit could not be saved.";
                if (state == "failed") throw new IOException(message);
                if (smoke || MessageBox.Show(this, message, "Unfinished selections", MessageBoxButtons.OKCancel, MessageBoxIcon.Warning) != DialogResult.OK) {
                    await web.ExecuteScriptAsync("window.branchlineCancelClose?.()");
                    return false;
                }
                await web.ExecuteScriptAsync("window.branchlinePrepareClose(true)");
            }
            await Task.Delay(50);
        }
        throw new TimeoutException("Saving took longer than expected. Please check the open edit and try again.");
    }

    private async Task StopBackendAsync()
    {
        var watch = Stopwatch.StartNew();
        try {
            if (!backendStarted || backend is null) return;
            if (backend.HasExited) { backendExit = "already-exited"; return; }
            await backend.StandardInput.WriteLineAsync("shutdown");
            await backend.StandardInput.FlushAsync();
            backend.StandardInput.Close();
            await backend.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(15));
            backendExit = backend.ExitCode == 0 ? "graceful" : "failed";
        } catch (Exception error) {
            backendExit = "forced";
            errors.AppendLine("Shutdown: " + error.Message);
            // The job contains only the backend and children created by this host.
            if (backendStarted && backend is not null && !backend.HasExited) { backend.Kill(entireProcessTree: true); await backend.WaitForExitAsync(); }
        } finally { shutdownMs = watch.Elapsed.TotalMilliseconds; backendJob?.Dispose(); backendJob = null; }
    }
}
