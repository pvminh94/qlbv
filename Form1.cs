using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace MedicalAutoFillTool;

/// <summary>
/// Cửa sổ chính: trình duyệt nhúng WebView2 mở medinet + thanh công cụ + bảng dữ liệu dán.
///
/// NHỮNG THAY ĐỔI LỚN so với bản cũ (đều nhằm vào lỗi "copy paste lúc được lúc không"):
///  1. Đọc clipboard BẰNG C# (ClipboardService, có retry) thay vì trông chờ
///     navigator.clipboard.readText() trong trang — API đó cần HTTPS + quyền,
///     và bị tiến trình khác giữ clipboard là ném lỗi ngay.
///  2. UserDataFolder cố định ở %LocalAppData% — chạy từ Program Files/IIS/ổ mạng
///     vẫn khởi tạo được WebView2 và giữ phiên đăng nhập medinet.
///  3. Tự khôi phục khi tiến trình render của WebView2 chết (ProcessFailed):
///     trước đây trang trắng xoá, phải tắt phần mềm mở lại.
///  4. Tự cho phép các quyền trình duyệt xin (PermissionRequested) — không còn
///     hộp thoại chặn giữa chừng làm mất thao tác dán.
///  5. Bảng xem trước dữ liệu dán: thấy ngay mấy dòng/mấy cột, có tiêu đề không,
///     cột nào khớp trường nào; sửa tay được trước khi điền.
///  6. Khớp cột theo TÊN (header) chứ không theo vị trí cố định.
///  7. Báo cáo chi tiết từng trường: OK / không thấy ô / ghi lỗi / thiếu dữ liệu.
///  8. Ghi log ra file để truy lại đúng lần bị lỗi.
///
/// NHÓM SỬA LỖI "TRANG TRẮNG TRONG WEBVIEW, LÚC ĐƯỢC LÚC KHÔNG":
///  9.  Timeout + retry 3 lần cho tạo môi trường / khởi tạo WebView2 (trước đây treo
///      là trắng vô thời hạn, không hộp lỗi). Dọn file khoá profile còn sót (Singleton*)
///      trước khi khởi động; lần cuối cùng xoá hẳn profile.
/// 10. Điều hướng đầu tiên (trang chủ) dời tới SAU KHI cửa sổ vẽ xong (Shown) — navigate
///      lúc cửa sổ chưa paint xong là thủ phạm rất hay gặp của lần paint đầu trắng.
/// 11. Chống webview bị kéo về about:blank khi trang xin mở popup rỗng (window.open()),
///      chỉ tiếp quản popup http(s) thật. Có log MỌI điều hướng (NavigationStarting).
/// 12. "Tải xong mà trang trắng" (renderer không render) -> tự Reload tối đa 2 lần/URL,
///      hết thì báo rõ — thay vì hiện "✅ Sẵn sàng" trong khi màn trắng.
/// 13. Chế độ ổn định (mặc định bật): khởi Chromium với --disable-gpu để không phụ thuộc
///      driver đồ hoạ (máy cũ/remote desktop hay chết renderer -> trắng). Tắt được trong
///      Cài đặt nếu máy đồ hoạ khoẻ.
/// 14. Khôi phục sau khi renderer chết: gỡ hết event cũ trước khi dispose, không điều
///      hướng đôi (home rồi lại url cũ), có chặn vòng lặp (3 lần chết/60 giây -> dừng).
/// </summary>
public partial class Form1 : Form
{
    private WebView2? _webView;
    private ToolStrip _nav = new();
    private bool _stretching;
    private ToolStripTextBox _txtAddress = new();
    private ToolStripComboBox _cmbForm = new();
    private StatusStrip _statusStrip = new();
    private ToolStripStatusLabel _lblStatus = new();
    private ToolStripStatusLabel _lblEngine = new();
    private ToolStripProgressBar _progress = new();
    private PastePanel _pastePanel = new();

    private AppConfig _config = new();
    private ParsedTable? _table;
    private string? _engineJs;
    private bool _coreReady;
    private bool _recovering;
    private bool _busy;
    private int _queueTotal;
    private int _queueDone;
    private int _queueOk;

    // Trạng thái chế độ ĐIỀN MỘT CHẠM (▶ Điền / F8): nhớ vân tay của nội dung
    // clipboard lần cuối để biết người dùng vừa copy LẠI hay vẫn dùng nội dung cũ,
    // và đang đứng ở dòng nào để lần bấm kế tiếp sang dòng kế.
    private string _lastClipHash = "";
    private int _oneClickRow;
    private bool _oneClickActive;

    // ---------------------------------------------------------------------
    // Chống lỗi "trắng trang trong webview, lúc được lúc không"
    // ---------------------------------------------------------------------

    /// <summary>User đã gõ URL trước khi core sẵn sàng (Navigate() đã đặt Source).
    /// Nếu đặt cờ này thì KHÔNG điều hướng về trang chủ lần đầu — control tự
    /// điều hướng tới URL đã xếp hàng khi init xong, tránh đè mất URL của user.</summary>
    private bool _urlQueuedBeforeCore;

    /// <summary>Số lần tự tải lại cho từng URL bị "tải xong mà trang trắng" (tối đa 2 lần/URL).</summary>
    private readonly Dictionary<string, int> _blankReloads = new();

    /// <summary>Đếm số lần renderer chết liên tiếp để KHÔNG lặp vòng khôi phục vô hạn
    /// (máy driver đồ hoạ lỗi cứ chết -> cứ dựng lại -> user chỉ thấy trắng liên tục).</summary>
    private int _rendererFailCount;
    private DateTime _rendererFailWindowUtc = DateTime.MinValue;

    // ---------------------------------------------------------------- Khởi tạo
    public Form1()
    {
        InitializeComponent();
        LoadConfig();
        SetupLayout();
        _ = InitializeWebViewAsync();
    }

    private void LoadConfig()
    {
        try
        {
            _config = ConfigRepository.Load();
        }
        catch (Exception ex)
        {
            AppLogger.Error("Không đọc được cấu hình, dùng mặc định", ex);
            _config = ConfigRepository.CreateDefault();
        }

        AppLogger.Enabled = _config.LogToFile;
        AppLogger.MinLevel = _config.Options.Debug ? LogLevel.Debug : LogLevel.Info;
        AppLogger.Info($"Cấu hình: {_config.Forms.Count} form, engine {EngineScript.Version}, " +
                       $"thư mục dữ liệu: {AppPaths.DataDirectory} (portable={AppPaths.IsPortableMode})");

        // Người dùng sửa file config bằng Notepad -> áp dụng ngay, không cần khởi động lại.
        ConfigRepository.ExternalChange += cfg =>
        {
            if (IsDisposed) return;
            BeginInvoke(new Action(() =>
            {
                _config = cfg;
                RefreshFormCombo();
                SetStatus("🔁 Cấu hình được cập nhật từ file — áp dụng ngay.");
                _ = ApplyConfigToPageAsync();
            }));
        };
        ConfigRepository.StartWatching();
    }

    private void SetupLayout()
    {
        Text = "Medical Auto Fill Tool";
        WindowState = FormWindowState.Maximized;
        StartPosition = FormStartPosition.CenterScreen;
        MinimumSize = new Size(900, 600);

        // WebView2 thêm TRƯỚC (index 0) để dock Fill được xử lý CUỐI, không che các thanh.
        _webView = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_webView);

        _pastePanel.Dock = DockStyle.Bottom;
        _pastePanel.Height = 240;
        _pastePanel.Visible = false;
        WirePastePanel();
        Controls.Add(_pastePanel);

        BuildStatusStrip();
        Controls.Add(_statusStrip);

        BuildNavBar();
        Controls.Add(_nav);
    }

    private void BuildNavBar()
    {
        _nav = new ToolStrip
        {
            Dock = DockStyle.Top,
            GripStyle = ToolStripGripStyle.Hidden,
            BackColor = Color.FromArgb(41, 49, 66),
            ForeColor = Color.White,
            RenderMode = ToolStripRenderMode.Professional,
            AutoSize = false,
            Height = 40,
            Padding = new Padding(4, 3, 4, 3),
            ImageScalingSize = new Size(18, 18)
        };

        var btnHome = NavButton("🏠 Trang chủ", "Về trang đăng nhập medinet");
        btnHome.Click += (_, _) => NavigateHome();

        var btnReload = NavButton("⟳ Tải lại", "Tải lại trang (F5) — dùng khi form không nhận dữ liệu");
        btnReload.Click += (_, _) => ReloadPage();

        // LƯU Ý: ToolStripTextBox KHÔNG có thuộc tính Spring (Spring chỉ có trên
        // ToolStripItem và bị ToolStripTextBox che đi -> CS0117 nếu đặt trong
        // object initializer). Muốn ô địa chỉ chiếm hết khoảng trống còn lại thì
        // phải tự tính bề rộng trong StretchAddressBox() bên dưới.
        _txtAddress = new ToolStripTextBox
        {
            Width = 300,
            BorderStyle = BorderStyle.FixedSingle,
            ForeColor = Color.White,
            BackColor = Color.FromArgb(58, 70, 92),
            ToolTipText = "Nhập địa chỉ rồi bấm Enter"
        };
        _txtAddress.KeyDown += (_, e) =>
        {
            if (e.KeyCode != Keys.Enter) return;
            e.SuppressKeyPress = true;
            var url = _txtAddress.Text.Trim();
            if (url.Length == 0) return;
            Navigate(url.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? url : "https://" + url);
        };

        _cmbForm = new ToolStripComboBox
        {
            DropDownStyle = ComboBoxStyle.DropDownList,
            Width = 210,
            ToolTipText = "Form đang áp dụng. Mặc định tự nhận diện theo URL; chọn tay nếu web đổi địa chỉ."
        };
        _cmbForm.SelectedIndexChanged += (_, _) => OnFormSelectionChanged();

        var btnPaste = NavButton("📋 Dán", "Xem trước dữ liệu vừa copy rồi mới điền (Ctrl+Shift+V). KHÔNG bắt buộc — muốn điền ngay thì bấm ▶ Điền (F8)");
        btnPaste.Font = new Font(_nav.Font, FontStyle.Bold);
        btnPaste.Click += (_, _) => PasteFromClipboard(showPanel: true, fillImmediately: false);

        // Nút CHÍNH của quy trình một-chạm: copy trong Excel -> bấm đây là điền luôn.
        var btnFill = NavButton("⚡ Điền", "Copy trong Excel rồi bấm đây: TỰ ĐỌC clipboard và điền luôn, không qua bước Dán (F8).\n" +
                                           "Bấm lần nữa với cùng nội dung copy = sang dòng kế tiếp.\n" +
                                           "Nếu clipboard không phải dữ liệu bảng thì điền dòng đang chọn trong bảng đã dán.");
        btnFill.ForeColor = Color.FromArgb(180, 255, 200);
        btnFill.Font = new Font(_nav.Font, FontStyle.Bold);
        btnFill.Click += (_, _) => SmartFill();

        var btnFillAll = NavButton("⏭ Tất cả", "Điền lần lượt mọi dòng trong bảng");
        btnFillAll.Click += (_, _) => FillAllRows();

        var btnDry = NavButton("🧪 Kiểm tra", "Chỉ kiểm tra mapping, KHÔNG ghi (F10)");
        btnDry.Click += (_, _) => FillSelectedRow(dryRun: true);

        var btnNo = NavButton("☑ Chọn 'Không'", "Tích hàng loạt các mục 'Không' (Ctrl+B)");
        btnNo.Click += (_, _) => SelectAllNo();

        var btnPanel = NavButton("▤ Bảng dữ liệu", "Ẩn/hiện bảng dữ liệu đã dán (F7)");
        btnPanel.Click += (_, _) => TogglePastePanel();

        var btnSettings = NavButton("⚙ Cài đặt", "Ánh xạ cột Excel với nhãn trên web (Ctrl+Shift+S)");
        btnSettings.Click += (_, _) => OpenSettings();

        var btnLog = NavButton("📜 Log", "Xem nhật ký hoạt động — dùng khi cần báo lỗi (Ctrl+Shift+L)");
        btnLog.Click += (_, _) => ShowLogDialog();

        _nav.Items.Add(btnHome);
        _nav.Items.Add(btnReload);
        _nav.Items.Add(_txtAddress);
        _nav.Items.Add(new ToolStripSeparator());
        _nav.Items.Add(_cmbForm);
        _nav.Items.Add(new ToolStripSeparator());
        _nav.Items.Add(btnPaste);
        _nav.Items.Add(btnFill);
        _nav.Items.Add(btnFillAll);
        _nav.Items.Add(btnDry);
        _nav.Items.Add(btnNo);
        _nav.Items.Add(new ToolStripSeparator());
        _nav.Items.Add(btnPanel);
        _nav.Items.Add(btnSettings);
        _nav.Items.Add(btnLog);

        // Ô địa chỉ tự co giãn theo bề rộng cửa sổ (thay cho Spring).
        _nav.SizeChanged += (_, _) => StretchAddressBox();
        _nav.Layout += (_, _) => StretchAddressBox();

        RefreshFormCombo();
        StretchAddressBox();
    }

    /// <summary>
    /// Cho ô địa chỉ chiếm phần còn lại của thanh công cụ — thay cho thuộc tính
    /// Spring mà ToolStripTextBox không có. Có cờ chống đệ quy vì đổi Width của
    /// một mục có thể kích hoạt lại Layout.
    /// </summary>
    private void StretchAddressBox()
    {
        if (_stretching || _nav == null || _txtAddress == null) return;
        _stretching = true;
        try
        {
            int used = 0;
            foreach (ToolStripItem it in _nav.Items)
            {
                if (ReferenceEquals(it, _txtAddress)) continue;
                used += it.Width + it.Margin.Horizontal;
            }

            int avail = _nav.ClientSize.Width - used - _nav.Padding.Horizontal - 8;
            int want = Math.Max(110, Math.Min(avail, 900));
            if (Math.Abs(_txtAddress.Width - want) > 2) _txtAddress.Width = want;
        }
        catch { /* thanh chưa dựng xong thì bỏ qua, lần Layout sau sẽ tính lại */ }
        finally { _stretching = false; }
    }

    private ToolStripButton NavButton(string text, string tooltip)
    {
        return new ToolStripButton(text)
        {
            DisplayStyle = ToolStripItemDisplayStyle.Text,
            ForeColor = Color.White,
            ToolTipText = tooltip,
            Margin = new Padding(2, 1, 2, 1),
            Padding = new Padding(4, 2, 4, 2)
        };
    }

    private void BuildStatusStrip()
    {
        _statusStrip = new StatusStrip { SizingGrip = false, BackColor = Color.FromArgb(245, 246, 249) };

        _lblStatus = new ToolStripStatusLabel
        {
            Text = "⏳ Đang khởi động trình duyệt nhúng...",
            Spring = true,
            TextAlign = ContentAlignment.MiddleLeft
        };
        _progress = new ToolStripProgressBar
        {
            Style = ProgressBarStyle.Continuous,
            Visible = false,
            Width = 140,
            Minimum = 0,
            Maximum = 100
        };
        _lblEngine = new ToolStripStatusLabel
        {
            Text = "engine " + EngineScript.Version,
            ForeColor = Color.Gray,
            BorderSides = ToolStripStatusLabelBorderSides.Left
        };

        _statusStrip.Items.Add(_lblStatus);
        _statusStrip.Items.Add(_progress);
        _statusStrip.Items.Add(_lblEngine);
    }

    private void WirePastePanel()
    {
        _pastePanel.PasteRequested += () => PasteFromClipboard(showPanel: true, fillImmediately: false);
        _pastePanel.FillRequested += i => FillRow(i, dryRun: false);
        _pastePanel.FillAllRequested += list => FillQueue(list);
        _pastePanel.DryRunRequested += i => FillRow(i, dryRun: true);
        _pastePanel.ClearRequested += () => { _table = null; _pastePanel.Clear(); SetStatus("Đã xoá dữ liệu trong bảng."); };
        _pastePanel.DetailRequested += ShowReportDialog;
    }

    // ------------------------------------------------------------- WebView2
    /// <summary>
    /// Khởi tạo WebView2. Có retry + timeout cho 2 bước hay "treo" nhất:
    ///   - CreateAsync: antivirus quét thư mục profile, ổ đĩa chậm, khoá profile còn sót.
    ///   - EnsureCoreWebView2Async: lần đầu tạo profile, máy yếu, driver đồ hoạ lỗi.
    /// Trước đây 2 bước này KHÔNG có timeout: treo 1 phút là webview trắng vô thời hạn,
    /// không có hộp lỗi nào cả -> user chỉ thấy "lúc được lúc không".
    /// </summary>
    private async Task InitializeWebViewAsync(bool navigateHome = true)
    {
        if (_webView == null) return;
        try
        {
            SetStatus("⏳ Đang chuẩn hoá môi trường WebView2...");

            var folder = AppPaths.WebView2UserDataFolder;

            // [chống trắng trang 1] Xoá file khoá Chromium còn sót từ lần app bị
            // crash / tắt mạnh (task manager). Nếu còn Singleton*, WebView2 coi profile
            // đang "được dùng bởi tiến trình khác" -> init treo/lỗi -> webview trắng
            // mà không báo gì. An toàn: mutex single-instance đã đảm bảo chỉ đúng
            // tiến trình này đang dùng profile.
            CleanStaleProfileLocks(folder);

            var envOptions = new CoreWebView2EnvironmentOptions
            {
                // [chống trắng trang 2] Chế độ ổn định (mặc định BẬT): không dùng GPU để
                // ghép hình. Máy văn phòng có driver đồ hoạ cũ / remote desktop hay bị
                // tiến trình render chết giữa chừng -> trang trắng. Tắt GPU thì tải trang
                // chậm hơn chút xíu nhưng gần như không bao giờ trắng.
                // (bật/tắt trong Cài đặt — hiệu lực khi khởi động lại)
                AdditionalBrowserArguments = _config.DisableGpu ? "--disable-gpu" : null
            };

            // UserDataFolder PHẢI ghi được: bản cũ không truyền tham số này nên khi
            // .exe nằm trong Program Files/IIS, WebView2 không khởi tạo được và
            // cửa sổ cứ trắng (người dùng chỉ thấy "phần mềm không chạy").
            // Tạo môi trường tối đa 3 lần: sạch -> dọn khoá -> xoá hẳn profile.
            var env = await CreateEnvWithRetryAsync(folder, envOptions);

            // Khởi tạo control tối đa 3 lần; từ lần 2 trở đi DÙNG CONTROL MỚI
            // (WebView2 không cho init lại control đã fail — y hệt đường khôi phục
            // sau ProcessFailed bên dưới).
            Exception? lastErr = null;
            for (int attempt = 1; attempt <= 3; attempt++)
            {
                try
                {
                    SetStatus("⏳ Đang khởi tạo trình duyệt nhúng (lần " + attempt + "/3)...");
                    await WithTimeout(_webView.EnsureCoreWebView2Async(env), 90_000,
                        "khởi tạo trình duyệt nhúng WebView2");
                    lastErr = null;
                    break;
                }
                catch (Exception ex)
                {
                    lastErr = ex;
                    AppLogger.Error("Khởi tạo WebView2 thất bại (lần " + attempt + "/3)", ex);
                    if (attempt >= 3) break;

                    SetStatus("⚠ Khởi tạo WebView2 lỗi — đang thử lại (lần " + (attempt + 1) + "/3)...");
                    if (attempt == 2) CleanStaleProfileLocks(folder);
                    else WipeProfile(folder);
                    ReplaceWebViewControl();
                    await Task.Delay(500);
                }
            }
            if (lastErr != null) throw lastErr;

            var core = _webView.CoreWebView2;
            if (core == null) throw new InvalidOperationException("Không lấy được CoreWebView2 sau khi khởi tạo.");

            core.Settings.AreDevToolsEnabled = _config.AllowDevTools;
            core.Settings.AreDefaultContextMenusEnabled = true;
            core.Settings.AreBrowserAcceleratorKeysEnabled = true;
            core.Settings.IsPasswordAutosaveEnabled = true;      // nhớ mật khẩu medinet
            core.Settings.IsGeneralAutofillEnabled = false;      // không để trình duyệt tự điền đè lên engine
            core.Settings.IsStatusBarEnabled = true;
            core.Settings.IsWebMessageEnabled = true;            // bắt buộc để engine báo kết quả về C#
            core.Settings.IsZoomControlEnabled = true;

            // Nạp engine vào MỌI trang (kể cả sau khi điều hướng nội bộ).
            // Chỉ nạp engine, KHÔNG kèm cấu hình: cấu hình được nạp lại ở
            // NavigationCompleted nên đổi mapping xong là có hiệu lực ngay.
            _engineJs ??= EngineScript.Load();
            await core.AddScriptToExecuteOnDocumentCreatedAsync(_engineJs);

            core.NavigationStarting += Core_NavigationStarting;
            core.NavigationCompleted += Core_NavigationCompleted;
            core.SourceChanged += (_, _) => UpdateAddressBar();
            core.WebMessageReceived += Core_WebMessageReceived;
            core.PermissionRequested += Core_PermissionRequested;
            HookBrowserHotkeys(_webView!);
            core.NewWindowRequested += Core_NewWindowRequested;
            core.ProcessFailed += Core_ProcessFailed;
            core.DocumentTitleChanged += (_, _) => UpdateAddressBar();

            // Trang medinet có thể nhúng form trong iframe khác origin: nạp engine
            // vào từng frame ngay khi nó được tạo (cùng origin thì engine tự quét).
            core.FrameCreated += Core_FrameCreated;

            _coreReady = true;
            AppLogger.Info("WebView2 sẵn sàng. UserDataFolder=" + folder +
                           (_config.DisableGpu ? " [chế độ ổn định: --disable-gpu]" : ""));

            if (_config.OpenDevToolsOnStart && _config.AllowDevTools)
            {
                try { core.OpenDevToolsWindow(); } catch { }
            }

            // [chống trắng trang 3] Điều hướng đầu tiên làm SAU KHI cửa sổ đã vẽ xong.
            // Navigate ngay khi EnsureCoreWebView2Async vừa xong (cửa sổ chưa shown,
            // controller vừa mới được tạo) là nguyên nhân rất hay gặp của lần paint đầu
            // trắng trống; bấm ⟳ (F5) lại thì có — đúng kiểu "lúc được lúc không".
            ScheduleInitialNavigation(navigateHome);
        }
        catch (Exception ex)
        {
            _coreReady = false;
            AppLogger.Error("Khởi tạo WebView2 thất bại", ex);
            HandleWebViewInitFailure(ex);
        }
    }

    // ------------------------------------------------- Helpers chống trắng trang

    /// <summary>Overload cho task không có kết quả — WinForms' EnsureCoreWebView2Async
    /// trả về Task thường (không Task&lt;T&gt;).</summary>
    private static Task WithTimeout(Task task, int timeoutMs, string what) =>
        WithTimeoutCore(task, timeoutMs, what);

    /// <summary>Chạy task với timeout. WebView2 KHÔNG có CancellationToken, nên khi
    /// timeout ta ném TimeoutException nhưng GIỮ SỰ THAM CHIẾU task cũ để nuốt lỗi
    /// của nó (khi task cũ về sau, control có thể đã bị dispose -> ObjectDisposedException
    /// không được phép xuất hiện như "lỗi lạ" trong log).</summary>
    private static async Task<T> WithTimeout<T>(Task<T> task, int timeoutMs, string what)
    {
        await WithTimeoutCore(task, timeoutMs, what);
        return await task; // task đã hoàn thành (hoặc exception gốc đã được rethrow ở Core)
    }

    private static async Task WithTimeoutCore(Task task, int timeoutMs, string what)
    {
        var completed = await Task.WhenAny(task, Task.Delay(timeoutMs));
        if (ReferenceEquals(completed, task))
        {
            await task; // rethrow original exception (if any)
            return;
        }
        _ = task.ContinueWith(t =>
        {
            if (t.Exception != null)
                AppLogger.Debug("Task WebView2 cũ kết thúc sau timeout: " +
                                t.Exception.GetBaseException().Message);
        }, TaskScheduler.Default);
        throw new TimeoutException(what + " quá " + (timeoutMs / 1000) +
            " giây chưa xong (thường do antivirus đang quét file, ổ đĩa chậm, hoặc profile lỗi).");
    }

    /// <summary>Tạo môi trường WebView2, tối đa 3 lần:
    /// lần 1 sạch -> lần 2 dọn file khoá -> lần 3 xoá hẳn profile (phải đăng nhập lại
    /// medinet, chỉ dùng khi không còn cách nào khác).</summary>
    private async Task<CoreWebView2Environment> CreateEnvWithRetryAsync(
        string folder, CoreWebView2EnvironmentOptions options)
    {
        for (int attempt = 1; attempt <= 3; attempt++)
        {
            try
            {
                return await WithTimeout(
                    CoreWebView2Environment.CreateAsync(null, folder, options),
                    60_000, "tạo môi trường WebView2");
            }
            catch (Exception ex)
            {
                AppLogger.Error("Tạo môi trường WebView2 thất bại (lần " + attempt + "/3)", ex);
                if (attempt >= 3) throw;
                SetStatus("⚠ Tạo môi trường WebView2 lỗi — đang thử lại (lần " + (attempt + 1) + "/3)...");
                if (attempt == 2) CleanStaleProfileLocks(folder);
                else WipeProfile(folder);
                await Task.Delay(500);
            }
        }
        throw new InvalidOperationException("Không tạo được môi trường WebView2 (không tới được đây).");
    }

    /// <summary>
    /// Xoá file khoá Chromium còn sót (SingletonLock/SingletonCookie/SingletonSocket).
    /// Chúng chỉ là "ai đang giữ profile" — an toàn xoá khi app của ta là tiến trình
    /// duy nhất dùng profile (mutex single-instance đã chặn trường hợp ngược lại).
    /// </summary>
    private static void CleanStaleProfileLocks(string folder)
    {
        try
        {
            foreach (var name in new[] { "SingletonLock", "SingletonCookie", "SingletonSocket" })
            {
                var p = Path.Combine(folder, name);
                if (!File.Exists(p)) continue;
                File.Delete(p);
                AppLogger.Info("Đã xoá file khoá profile WebView2 còn sót: " + name);
            }
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Không xoá được file khoá profile cũ: " + ex.Message);
        }
    }

    /// <summary>Xoá TOÀN BỘ profile WebView2 (biện pháp cuối cùng khi profile "chết lâm
    /// sàng"). Hệ quả: phải đăng nhập lại medinet. Gọi khi đã thử 2 lần không thành.</summary>
    private static void WipeProfile(string folder)
    {
        AppLogger.Warn("XOÁ TOÀN BỘ profile WebView2 (phải đăng nhập lại medinet): " + folder);
        try
        {
            Directory.Delete(folder, recursive: true);
            Directory.CreateDirectory(folder);
        }
        catch (Exception ex)
        {
            AppLogger.Error("Không xoá được profile WebView2", ex);
        }
    }

    /// <summary>
    /// Tạo control WebView2 MỚI thay control cũ (dùng khi init fail hoặc renderer chết).
    /// Control mới đặt ở index 0 để Dock=Fill không che các thanh. Trước khi dispose
    /// control cũ thì GỠ HẾT event handler — để không nhận thêm sự kiện từ webview
    /// đang "chết" (vd ProcessFailed phát lại trong lúc dispose -> vòng lặp khôi phục).
    /// </summary>
    private void ReplaceWebViewControl()
    {
        _coreReady = false;
        var old = _webView;
        _webView = new WebView2 { Dock = DockStyle.Fill };
        Controls.Add(_webView);
        Controls.SetChildIndex(_webView, 0);

        if (old != null)
        {
            UnhookCoreEvents(old);
            try { old.Dispose(); } catch { }   // tự huỷ cả CoreWebView2
            try { Controls.Remove(old); } catch { }
        }
    }

    /// <summary>Gỡ MỌI handler khỏi core của một control sắp bị dispose (event -= null
    /// là cú pháp hợp lệ để rỗng danh sách subscriber).</summary>
    private static void UnhookCoreEvents(WebView2 wv)
    {
        try
        {
            wv.KeyDown -= null;
            var core = wv.CoreWebView2;
            if (core == null) return;
            core.NavigationStarting -= null;
            core.NavigationCompleted -= null;
            core.SourceChanged -= null;
            core.WebMessageReceived -= null;
            core.PermissionRequested -= null;
            core.NewWindowRequested -= null;
            core.ProcessFailed -= null;
            core.DocumentTitleChanged -= null;
            core.FrameCreated -= null;
        }
        catch { }
    }

    /// <summary>Đặt lịch điều hướng ĐẦU TIÊN (trang chủ). Chỉ chạy khi thực sự cần:
    /// user đã tự gõ URL từ trước (Source đã xếp hàng) thì không được đè.</summary>
    private void ScheduleInitialNavigation(bool navigateHome)
    {
        if (!navigateHome) return;

        if (_urlQueuedBeforeCore)
        {
            _urlQueuedBeforeCore = false;
            AppLogger.Info("User đã đặt URL từ trước core sẵn sàng — bỏ qua điều hướng trang chủ.");
            return;
        }
        if (IsDisposed) return;

        if (IsHandleCreated)
        {
            BeginInvoke(new Action(NavigateHome));
        }
        else
        {
            // Chờ cửa sổ paint xong (Shown) rồi mới navigate — tránh lần paint đầu trắng.
            void OnShown(object? s, EventArgs e)
            {
                Shown -= OnShown;
                if (!IsDisposed) NavigateHome();
            }
            Shown += OnShown;
        }
    }

    /// <summary>Báo lỗi khởi tạo bằng tiếng người, kèm cách xử lý (thiếu WebView2 Runtime là ca hay gặp).</summary>
    private void HandleWebViewInitFailure(Exception ex)
    {
        var msg = ex.Message ?? "";
        bool missingRuntime =
            msg.IndexOf("WebView2", StringComparison.OrdinalIgnoreCase) >= 0 ||
            msg.IndexOf("Runtime", StringComparison.OrdinalIgnoreCase) >= 0 ||
            ex.HResult == unchecked((int)0x80070002) ||   // ERROR_FILE_NOT_FOUND
            ex is DllNotFoundException || ex is FileNotFoundException;

        var sb = new StringBuilder();
        sb.AppendLine("Không khởi động được trình duyệt nhúng WebView2.");
        sb.AppendLine();
        if (missingRuntime)
        {
            sb.AppendLine("Nguyên nhân thường gặp: máy chưa cài 'Microsoft Edge WebView2 Runtime'.");
            sb.AppendLine("Cách xử lý: bấm Có để mở trang tải chính thức của Microsoft,");
            sb.AppendLine("tải bản 'Evergreen Standalone Installer' (x64) rồi cài đặt.");
        }
        else
        {
            sb.AppendLine("Chi tiết: " + msg);
            if (ex is TimeoutException)
            {
                sb.AppendLine();
                sb.AppendLine("Nguyên nhân thường gặp: antivirus (Kaspersky/Bitdefender/Windows Defender)");
                sb.AppendLine("đang quét thư mục dữ liệu của WebView2 làm khởi tạo bị treo.");
                sb.AppendLine("Cách xử lý: thêm NƠI NÀY vào danh sách ngoại lệ của antivirus:");
                sb.AppendLine(AppPaths.WebView2UserDataFolder);
            }
        }
        sb.AppendLine();
        sb.AppendLine("Nếu đã cài Runtime mà vẫn lỗi, thử chạy phần mềm bằng quyền Administrator");
        sb.AppendLine("một lần (để tạo thư mục dữ liệu), hoặc xoá thư mục:");
        sb.AppendLine(AppPaths.WebView2UserDataFolder);
        sb.AppendLine();
        sb.AppendLine("Log: " + AppPaths.LogFileToday);

        var result = MessageBox.Show(sb.ToString(), "Lỗi khởi tạo WebView2",
            missingRuntime ? MessageBoxButtons.YesNo : MessageBoxButtons.OK,
            MessageBoxIcon.Error);

        if (result == DialogResult.Yes)
        {
            try
            {
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = "https://developer.microsoft.com/microsoft-edge/webview2/",
                    UseShellExecute = true
                });
            }
            catch { }
        }

        SetStatus("❌ WebView2 không khởi động được. Xem chi tiết trong log.");
    }

    /// <summary>
    /// WebView2 chết tiến trình render (hay xảy ra khi máy thiếu RAM / driver đồ hoạ cũ):
    /// trang trắng xoá nhưng phần mềm vẫn "đang chạy". Bản cũ không xử lý nên người dùng
    /// phải tự tắt mở lại. Nay tự dựng lại WebView2 và quay về đúng trang đang xem.
    /// </summary>
    private void Core_ProcessFailed(object? sender, CoreWebView2ProcessFailedEventArgs e)
    {
        var kind = e.ProcessFailedKind;
        AppLogger.Error("WebView2 ProcessFailed: " + kind);

        if (kind == CoreWebView2ProcessFailedKind.RenderProcessExited ||
            kind == CoreWebView2ProcessFailedKind.BrowserProcessExited ||
            kind == CoreWebView2ProcessFailedKind.RenderProcessUnresponsive)
        {
            // CHỐNG VÒNG LẶP: máy có driver đồ hoạ lỗi thì renderer chết liên tục.
            // Nếu cứ tự dựng lại vô hạn, user chỉ thấy trang trắng nhấp nháy không sao
            // thoát ra. 3 lần chết trong 60 giây -> dừng tự khôi phục, báo rõ.
            if ((DateTime.UtcNow - _rendererFailWindowUtc).TotalSeconds > 60)
            {
                _rendererFailWindowUtc = DateTime.UtcNow;
                _rendererFailCount = 0;
            }
            _rendererFailCount++;
            if (_rendererFailCount >= 3)
            {
                AppLogger.Error("Renderer chết " + _rendererFailCount +
                    " lần trong 60 giây — DỪNG tự khôi phục để không lặp vô hạn.");
                SetStatus("❌ Trình duyệt nhúng lỗi lặp nhiều lần. Hãy tắt/bật lại phần mềm; " +
                          "nếu vẫn lặp: bật 'Chế độ ổn định trình duyệt' trong Cài đặt và cập nhật driver đồ hoạ.");
                Toast("❌ WebView2 lỗi lặp — cần khởi động lại", true);
                return;
            }

            if (IsDisposed) return;
            BeginInvoke(new Action(async () =>
            {
                try { await RecoverWebViewAsync(); }
                catch (Exception ex) { AppLogger.Error("Khôi phục WebView2 thất bại", ex); }
            }));
        }
        else
        {
            SetStatus("⚠ Một khung trang bị lỗi (" + kind + ") — thử tải lại trang (F5).");
        }
    }

    private async Task RecoverWebViewAsync()
    {
        if (_recovering) return;
        _recovering = true;
        try
        {
            var lastUrl = SafeSource();
            SetStatus("⚠ Trình duyệt nhúng bị treo — đang tự khôi phục...");
            AppLogger.Warn("Đang tự khôi phục WebView2 (renderer chết lần " + _rendererFailCount +
                           "). URL gần nhất: " + lastUrl);

            // Control mới + gỡ hết handler của control cũ + dispose (gộp trong 1 hàm,
            // dùng chung với các lần init retry trong InitializeWebViewAsync).
            ReplaceWebViewControl();

            // KHÔNG cho init tự navigate về trang chủ — ta sẽ quay về ĐÚNG trang
            // user đang xem (trước đây init về home xong recovery lại Navigate(lastUrl)
            // => 2 lần điều hướng chồng nhau, user thấy trang nhảy lung tung).
            await InitializeWebViewAsync(navigateHome: false);

            var target = string.IsNullOrEmpty(lastUrl) || lastUrl == "about:blank"
                ? HomeUrl()
                : lastUrl;
            Navigate(target);
            _rendererFailCount = 0;   // khôi phục thành công -> đếm lại

            SetStatus("✅ Đã khôi phục trình duyệt nhúng.");
            Toast("✅ Đã tự khôi phục trình duyệt nhúng", false);
        }
        finally
        {
            _recovering = false;
        }
    }

    /// <summary>
    /// Tự cho phép quyền mà trang xin (clipboard, tải nhiều file, notification...).
    /// Hộp thoại quyền bật lên giữa lúc dán dữ liệu sẽ làm MẤT thao tác Ctrl+V,
    /// đây là một nguyên nhân "paste không ăn" rất khó đoán.
    /// </summary>
    private void Core_PermissionRequested(object? sender, CoreWebView2PermissionRequestedEventArgs e)
    {
        try
        {
            var origin = e.Uri ?? "";
            AppLogger.Debug("Quyền trang xin: " + e.PermissionKind + " từ " + origin);
            e.State = CoreWebView2PermissionState.Allow;
            e.Handled = true;
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Không xử lý được PermissionRequested: " + ex.Message);
        }
    }

    /// <summary>
    /// Cửa sổ bật ra từ trang (medinet hay mở popup) -> mở ngay trong cửa sổ này.
    ///
    /// [chống trắng trang 4] Bản cũ Navigate THẲNG frame chính tới e.Uri bất kể giá
    /// trị: trang gọi window.open() rỗng / window.open('about:blank') (hay gặp ở form
    /// ASP.NET khi đổi trạng thái) là frame chính bị kéo về about:blank => TRANG
    /// TRẮNG XOA, bấm ⟳ lại thì hết. Nay chỉ tiếp quản khi URI là link http(s) thật.
    /// </summary>
    private void Core_NewWindowRequested(object? sender, CoreWebView2NewWindowRequestedEventArgs e)
    {
        try
        {
            e.Handled = true;   // không để WebView2 mở cửa sổ Chromium riêng (user thấy lạ)
            var uri = (e.Uri ?? "").Trim();
            AppLogger.Info("Trang xin mở cửa sổ con: '" + uri + "'");

            if (uri.Length == 0 ||
                uri.Equals("about:blank", StringComparison.OrdinalIgnoreCase) ||
                uri.Equals("about:srcdoc", StringComparison.OrdinalIgnoreCase))
            {
                // Popup trống — KHÔNG đụng vào trang chính.
                return;
            }
            if (!uri.StartsWith("http://", StringComparison.OrdinalIgnoreCase) &&
                !uri.StartsWith("https://", StringComparison.OrdinalIgnoreCase))
            {
                AppLogger.Warn("Bỏ qua yêu cầu mở cửa sổ không phải http(s): " + uri);
                return;
            }
            _webView?.CoreWebView2?.Navigate(uri);
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Không mở được cửa sổ mới: " + ex.Message);
        }
    }

    private void Core_FrameCreated(object? sender, CoreWebView2FrameCreatedEventArgs e)
    {
        try
        {
            var frame = e.Frame;
            if (frame == null || _engineJs == null) return;
            frame.ExecuteScriptAsync(_engineJs).ContinueWith(t =>
            {
                if (t.Exception != null) AppLogger.Debug("Không nạp engine vào frame: " + t.Exception.GetBaseException().Message);
            }, TaskScheduler.Default);
        }
        catch (Exception ex)
        {
            AppLogger.Debug("FrameCreated: " + ex.Message);
        }
    }

    /// <summary>Nhật ký MỌI điều hướng (kể cả điều hướng nội bộ) — đây là dữ liệu
    /// quan trọng nhất để tra "lúc được lúc không": log sẽ cho thấy trang bị điều
    /// hướng đi đâu trước khi trắng.</summary>
    private void Core_NavigationStarting(object? sender, CoreWebView2NavigationStartingEventArgs e)
    {
        try
        {
            var uri = e.Uri ?? "";
            AppLogger.Info("Điều hướng bắt đầu: " + uri);
            // Chặn link javascript: (kéo về trang rỗng nếu không chặn).
            if (uri.StartsWith("javascript:", StringComparison.OrdinalIgnoreCase))
                e.Cancel = true;
        }
        catch { }
    }

    private async void Core_NavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
    {
        var url = SafeSource() ?? "";
        AppLogger.Info("Đã tải trang: " + url + (e.IsSuccess ? "" : " (LỖI: " + e.WebErrorStatus + ")"));

        if (!e.IsSuccess)
        {
            SetStatus("❌ Không tải được trang: " + e.WebErrorStatus + " — kiểm tra mạng/VPN.");
            return;
        }

        // [chống trắng trang 5] Navigation "thành công" nhưng trang trả về TRẮNG
        // (renderer không render được gì — hay gặp sau crash GPU / tải nửa vời).
        // Tự Reload tối đa 2 lần/URL rồi dừng và báo rõ, thay vì hiện "✅ Sẵn sàng"
        // trong khi màn hình trắng (bản cũ user phải tự bấm ⟳, và không biết
        // phần mềm đang báo "sẵn sàng" là do bug).
        if (IsHttpUrl(url))
        {
            if (await IsPageBlankAsync())
            {
                if (_blankReloads.Count > 32) _blankReloads.Clear();
                var n = _blankReloads.TryGetValue(url, out var c) ? c + 1 : 1;
                _blankReloads[url] = n;
                if (n <= 2)
                {
                    AppLogger.Warn("Trang trả về TRẮNG dù báo tải xong (lần " + n + "/2) — tự tải lại: " + url);
                    SetStatus("⚠ Trang trả về trắng — tự tải lại (lần " + n + "/2)...");
                    try
                    {
                        await Task.Delay(1500);  // để Chromium kịp thả renderer rồi mới Reload
                        if (!_coreReady || _webView?.CoreWebView2 == null) return;
                        _webView.CoreWebView2.Reload();
                    }
                    catch { }
                    return;  // các bước nạp cấu hình/ngôn ngữ chạy ở lần tải kế tiếp
                }
                _blankReloads.Remove(url);
                AppLogger.Error("Trang VẪN trắng sau 2 lần tự tải lại: " + url);
                SetStatus("❌ Trang vẫn trắng sau khi tự tải lại. Bấm ⟳ Tải lại (F5), kiểm tra mạng/VPN, " +
                          "hoặc bật 'Chế độ ổn định trình duyệt' trong Cài đặt.");
                return;
            }
            else
            {
                _blankReloads.Remove(url);   // tải lành lặn -> xoá bộ đếm của URL này
            }
        }

        await ApplyConfigToPageAsync();

        var form = ResolveActiveForm();
        if (form != null)
        {
            SetStatus($"✅ Sẵn sàng. Form nhận diện được: {form.Name} ({form.Fields.Count} trường). Dán dữ liệu bằng Ctrl+Shift+V.");
            _lblEngine.Text = "engine " + EngineScript.Version + " • " + form.Name;
        }
        else
        {
            SetStatus("✅ Trang đã tải. ⚠ Chưa nhận diện được form nào theo URL này — chọn form tay ở thanh trên, hoặc thêm 'chuỗi URL nhận diện' trong Cài đặt.");
            _lblEngine.Text = "engine " + EngineScript.Version + " • chưa khớp form";
        }

        // Có dữ liệu chờ sẵn (dán trước khi trang tải xong) thì điền tiếp.
        if (_table != null && _pendingFillAfterLoad)
        {
            _pendingFillAfterLoad = false;
            FillSelectedRow(dryRun: false);
        }
    }

    private bool _pendingFillAfterLoad;

    /// <summary>Nạp cấu hình vào engine của trang đang mở và đọc trạng thái về.</summary>
    private async Task ApplyConfigToPageAsync()
    {
        if (!_coreReady || _webView?.CoreWebView2 == null) return;
        try
        {
            await _webView.CoreWebView2.ExecuteScriptAsync(AutoFillScriptBuilder.BuildConfigure(_config));
            var stateJson = await _webView.CoreWebView2.ExecuteScriptAsync(AutoFillScriptBuilder.BuildState());
            ParseEngineState(stateJson);
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Không áp được cấu hình vào trang: " + ex.Message);
        }
    }

    private void ParseEngineState(string? json)
    {
        // Kết quả là chuỗi JSON đã escape 2 lớp -> phải gỡ bằng EngineJson.Unwrap.
        var st = EngineJson.Unwrap<EngineState>(json);
        if (st == null) return;

        if (!string.IsNullOrEmpty(st.EngineVersion) && st.EngineVersion != EngineScript.Version)
            AppLogger.Warn($"Engine trong trang là bản {st.EngineVersion}, khác bản nhúng {EngineScript.Version} — hãy tải lại trang (F5).");
        if (st.Forms == 0)
            AppLogger.Warn("Engine trong trang chưa có form nào — cấu hình chưa được nạp.");
        AppLogger.Debug($"Engine state: form={st.Form ?? "(không)"}, fields={st.Fields}, secure={st.SecureContext}, clipboardApi={st.HasClipboardApi}");
    }

    // ------------------------------------------------- Phát hiện "trang trắng"

    private static bool IsHttpUrl(string url) =>
        url.StartsWith("http://", StringComparison.OrdinalIgnoreCase) ||
        url.StartsWith("https://", StringComparison.OrdinalIgnoreCase);

    /// <summary>Trạng thái document do script phía trang trả về (chống trang trắng).</summary>
    private sealed class PageState
    {
        public string? r { get; set; }
        public int kids { get; set; }
        public int len { get; set; }
    }

    /// <summary>
    /// True khi trang "đã tải xong" (readyState=complete) mà body TRỐNG — nghĩa là
    /// renderer đã không render được gì (đúng thứ user nhìn thấy: màn trắng).
    /// Khi trang đang tải dở thì body rỗng là bình thường, không báo sai.
    /// </summary>
    private async Task<bool> IsPageBlankAsync()
    {
        if (!_coreReady || _webView?.CoreWebView2 == null) return false;
        try
        {
            var js = "(() => { try { var b = document.body; " +
                     "var html = document.documentElement && document.documentElement.innerHTML; " +
                     "return JSON.stringify({ r: document.readyState, kids: b ? b.childElementCount : -1, len: html ? html.length : 0 }); } catch (e) { return null; } })()";
            var st = await ExecuteJsonAsync<PageState>(js);
            if (st == null) return false;
            return st.r == "complete" && st.kids == 0 && st.len < 300;
        }
        catch
        {
            return false;   // không kiểm tra được thì coi như không trắng (tránh reload vô cớ)
        }
    }

    /// <summary>Chạy script đồng bộ của engine và gỡ JSON kết quả.</summary>
    private async Task<T?> ExecuteJsonAsync<T>(string script) where T : class
    {
        try
        {
            var core = _webView?.CoreWebView2;
            if (core == null) return null;
            var raw = await core.ExecuteScriptAsync(script);
            return EngineJson.Unwrap<T>(raw);
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Không lấy được kết quả từ engine: " + ex.Message);
            return null;
        }
    }

    /// <summary>Công cụ cho hộp thoại Cài đặt mượn: quét trang để lấy selector gợi ý.</summary>
    internal async Task<string?> ScanPageAsync(string? filter)
    {
        if (!_coreReady || _webView?.CoreWebView2 == null) return null;
        return await ExecuteAsyncRaw(AutoFillScriptBuilder.BuildScan(filter));
    }

    private async Task<string?> ExecuteAsyncRaw(string script)
    {
        try
        {
            var core = _webView?.CoreWebView2;
            if (core == null) return null;
            var raw = await core.ExecuteScriptAsync(script);
            // Gỡ 1 lớp escape để trả về JSON thuần cho nơi gọi tự phân tích.
            using var doc = JsonDocument.Parse(string.IsNullOrWhiteSpace(raw) ? "null" : raw);
            return doc.RootElement.ValueKind == JsonValueKind.String ? doc.RootElement.GetString() : raw;
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Quét trang thất bại: " + ex.Message);
            return null;
        }
    }

    /// <summary>Nhận mọi thông điệp engine gửi về (kết quả điền, trạng thái, chọn Không).</summary>
    private void Core_WebMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs e)
    {
        string raw;
        try { raw = e.TryGetWebMessageAsString(); }
        catch
        {
            // Engine post object thay vì string -> lấy JSON thô.
            raw = e.WebMessageAsJson ?? "";
        }
        if (string.IsNullOrWhiteSpace(raw)) return;

        try
        {
            var env = JsonSerializer.Deserialize<EngineEnvelope>(raw, JsonOpts.Loose);
            if (env == null) return;

            switch (env.Type)
            {
                case "maf:result":
                    var report = FillReport.FromEnvelope(raw);
                    OnFillReport(report);
                    break;

                case "maf:ready":
                    AppLogger.Debug("Engine sẵn sàng trong trang.");
                    break;

                case "maf:select-no":
                    var clicked = env.Payload.TryGetProperty("clicked", out var c) ? c.GetInt32() : 0;
                    SetStatus(clicked > 0 ? $"☑ Đã chọn 'Không' cho {clicked} mục." : "⚠ Không tìm thấy mục 'Không' nào để chọn.");
                    Toast(clicked > 0 ? $"☑ Đã chọn 'Không' cho {clicked} mục" : "⚠ Không thấy mục 'Không' nào", clicked == 0);
                    AppLogger.Info("selectAllNo: " + clicked + " mục");
                    break;

                default:
                    AppLogger.Debug("Thông điệp lạ từ engine: " + env.Type);
                    break;
            }
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Không đọc được thông điệp engine: " + ex.Message);
        }
    }

    // ------------------------------------------------------- Phím tắt trong trang
    /// <summary>
    /// Gắn phím tắt cấp trình duyệt vào control WebView2 bằng event KeyDown
    /// CHUẨN của WinForms.
    ///
    /// TẠI SAO KHÔNG DÙNG AcceleratorKeyPressed (đã trả giá bằng 2 vòng CI đỏ):
    ///   • CoreWebView2.AcceleratorKeyPressed            -> không tồn tại (CS1061).
    ///   • WebView2.AcceleratorKeyPressed (cấp control)  -> không tồn tại (CS1061).
    ///   • CoreWebView2Controller.AcceleratorKeyPressed  -> CÓ tồn tại, nhưng control
    ///     WinForms giữ controller trong field PRIVATE `_coreWebView2Controller` ở
    ///     MỌI phiên bản SDK, nên `_webView.CoreWebView2Controller` cũng CS1061.
    ///     (Lấy bằng reflection thì được — vài dự án làm vậy — nhưng phải đánh đổi
    ///     bằng rủi ro vỡ âm thầm khi Microsoft đổi tên field nội bộ, nên không dùng.)
    ///
    /// Cách Microsoft chỉ định, nguyên văn Remarks của lớp WebView2 (WinForms):
    ///   "Accelerator key presses (e.g. Ctrl+P) that occur within the control will fire
    ///    standard key press events such as OnKeyDown. You can suppress the control's
    ///    default implementation of an accelerator key press by setting the Handled
    ///    property of its EventArgs to true."
    /// Nghĩa là control tự bắt AcceleratorKeyPressed của controller rồi forward thành
    /// KeyDown; đặt e.Handled = true sẽ được ghi ngược lại controller để chặn hành vi
    /// mặc định của trình duyệt. Đây là hook chạy TRƯỚC khi Chromium xử lý phím, nên
    /// Ctrl+Shift+V của ta thắng lệnh "dán thuần văn bản" của trình duyệt.
    ///
    /// Gỡ rồi gắn lại để hàm idempotent: InitializeWebViewAsync có thể chạy nhiều lần
    /// trên cùng một control (đường khôi phục sau khi tiến trình render chết).
    /// </summary>
    private void HookBrowserHotkeys(WebView2 wv)
    {
        if (wv == null) return;
        try
        {
            wv.KeyDown -= WebView_KeyDown;
            wv.KeyDown += WebView_KeyDown;
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Không gắn được phím tắt trình duyệt: " + ex.Message +
                           " — vẫn dùng được các nút trên thanh công cụ và phím tắt khi tiêu điểm ngoài trang.");
        }
    }

    /// <summary>
    /// Phím tắt khi tiêu điểm NẰM TRONG trang web. Khi tiêu điểm ở ngoài trang
    /// (thanh công cụ, bảng dữ liệu) thì ProcessCmdKey phía dưới đảm nhiệm.
    /// </summary>
    private void WebView_KeyDown(object? sender, KeyEventArgs e)
    {
        // "Ăn" phím: Handled để WebView2 ghi ngược lại controller (chặn trình duyệt
        // tự xử lý), SuppressKeyPress để không sinh thêm sự kiện KeyPress.
        void Eat() { e.Handled = true; e.SuppressKeyPress = true; }

        // Trạng thái phím lấy từ chính event, không dùng Control.ModifierKeys —
        // để đúng với tổ hợp mà trình duyệt vừa bắt được, kể cả khi cửa sổ khác
        // đang giữ phím.
        bool ctrl = e.Control;
        bool shift = e.Shift;
        var vk = e.KeyCode;

        // Ctrl+Shift+V : dán từ clipboard hệ thống (đường CHÍNH, luôn chạy)
        if (ctrl && shift && vk == Keys.V)
        {
            Eat();
            PasteFromClipboard(showPanel: true, fillImmediately: _config.FillImmediatelyAfterPaste);
            return;
        }

        // Ctrl+V thường: chỉ giành quyền nếu người dùng BẬT tùy chọn này.
        // Mặc định KHÔNG chặn, để còn dán chữ bình thường vào ô của medinet.
        if (ctrl && !shift && vk == Keys.V && _config.HijackPlainCtrlV)
        {
            Eat();
            PasteFromClipboard(showPanel: true, fillImmediately: _config.FillImmediatelyAfterPaste);
            return;
        }

        // Ctrl+Enter : điền dòng đang chọn
        if (ctrl && vk == Keys.Enter)
        {
            Eat();
            FillSelectedRow(dryRun: false);
            return;
        }

        // Ctrl+B : chọn "Không" hàng loạt
        if (ctrl && vk == Keys.B && _config.Options.EnableSelectNoHotkey)
        {
            Eat();
            SelectAllNo();
            return;
        }

        switch (vk)
        {
            case Keys.F5:
                Eat();
                ReloadPage();
                return;
            case Keys.F7:
                Eat();
                TogglePastePanel();
                return;
            case Keys.F8:
                Eat();
                SmartFill();
                return;
            case Keys.F9:
                Eat();
                FillNextInQueue();
                return;
            case Keys.F10:
                Eat();
                FillSelectedRow(dryRun: true);
                return;
            case Keys.F12:
                if (_config.AllowDevTools)
                {
                    Eat();
                    try { _webView?.CoreWebView2?.OpenDevToolsWindow(); } catch { }
                }
                return;
        }
    }

    /// <summary>Phím tắt khi tiêu điểm nằm trên form (không phải trong trang web).</summary>
    protected override bool ProcessCmdKey(ref Message msg, Keys keyData)
    {
        switch (keyData)
        {
            case Keys.Control | Keys.Shift | Keys.V:
                PasteFromClipboard(showPanel: true, fillImmediately: _config.FillImmediatelyAfterPaste);
                return true;
            case Keys.Control | Keys.Enter:
                FillSelectedRow(dryRun: false);
                return true;
            case Keys.F7:
                TogglePastePanel();
                return true;
            case Keys.F8:
                SmartFill();
                return true;
            case Keys.F9:
                FillNextInQueue();
                return true;
            case Keys.F10:
                FillSelectedRow(dryRun: true);
                return true;
            case Keys.Control | Keys.Shift | Keys.S:
                OpenSettings();
                return true;
            case Keys.Control | Keys.Shift | Keys.L:
                ShowLogDialog();
                return true;
            case Keys.F12:
                if (_config.AllowDevTools) { try { _webView?.CoreWebView2?.OpenDevToolsWindow(); } catch { } return true; }
                break;
        }
        return base.ProcessCmdKey(ref msg, keyData);
    }

    // ------------------------------------------------------- Nghiệp vụ chính
    /// <summary>
    /// ĐỌC CLIPBOARD BẰNG C# rồi mới đẩy sang trang.
    /// Đây là điểm khác biệt quan trọng nhất so với bản cũ: không phụ thuộc
    /// navigator.clipboard (cần HTTPS + quyền), có retry khi clipboard bị giữ,
    /// và người dùng thấy ngay kết quả trong bảng.
    /// </summary>
    private void PasteFromClipboard(bool showPanel, bool fillImmediately)
    {
        var fields = ActiveFields();
        if (fields.Count == 0)
        {
            WarnNoMapping();
            return;
        }

        var (clip, table) = ClipboardService.ReadTable(fields, DelimiterFromConfig());

        if (!clip.Ok)
        {
            var detail = clip.Error ?? "Không đọc được clipboard.";
            SetStatus("❌ " + detail);
            Toast("❌ " + detail, true);
            AppLogger.Warn("Đọc clipboard thất bại sau " + clip.Attempts + " lần thử: " + detail);
            MessageBox.Show(
                detail + "\r\n\r\nĐã thử " + clip.Attempts + " lần trong " + clip.ElapsedMs + " ms.\r\n" +
                "Gợi ý:\r\n" +
                "• Bôi đen vùng dữ liệu trong Excel rồi bấm Ctrl+C lại.\r\n" +
                "• Nếu đang dùng phần mềm clipboard/Unikey, thử tắt tạm.\r\n" +
                "• Chi tiết trong log: " + AppPaths.LogFileToday,
                "Không đọc được clipboard", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        if (table.IsEmpty)
        {
            SetStatus("⚠ Clipboard có nội dung nhưng không phải dữ liệu bảng.");
            Toast("⚠ Không phải dữ liệu bảng từ Excel", true);
            return;
        }

        _table = table;
        AppLogger.Info($"Dán: {table.RowCount} dòng × {table.ColCount} cột, phân cách '{ShowDelim(table.Delimiter)}', " +
                       $"tiêu đề={(table.HasHeader ? "dòng " + (table.HeaderRowIndex + 1) : "không")}, " +
                       $"đọc clipboard hết {clip.ElapsedMs}ms/{clip.Attempts} lần thử");

        if (showPanel) ShowPastePanel(true);
        _pastePanel.SetTable(table, fields);
        _pastePanel.ClearReport();

        var form = ResolveActiveForm();
        SetStatus($"📋 Đã dán {table.RowCount - (table.HasHeader ? 1 : 0)} dòng dữ liệu" +
                  (form != null ? $" cho form '{form.Name}'" : "") +
                  ". Bấm ▶ Điền (Ctrl+Enter) hoặc ▶ Điền tất cả.");

        if (fillImmediately) FillSelectedRow(dryRun: false);
    }

    private static string ShowDelim(char d) => d switch { '\t' => "TAB", ';' => ";", ',' => ",", _ => d.ToString() };

    private char? DelimiterFromConfig()
    {
        return (_config.PasteMode ?? "auto").ToLowerInvariant() switch
        {
            "tab" => '\t',
            "comma" => ',',
            "semicolon" or "semi" => ';',
            _ => null       // auto: tự phát hiện
        };
    }

    /// <summary>Danh sách trường đang áp dụng (theo form chọn tay hoặc tự nhận diện theo URL).</summary>
    private List<FieldMapping> ActiveFields()
    {
        var form = SelectedForm() ?? ResolveActiveForm();
        if (form != null) return form.Fields;
        // Chỉ có đúng 1 form thì dùng luôn, đừng bắt người dùng chọn.
        if (_config.Forms.Count == 1) return _config.Forms[0].Fields;
        return new List<FieldMapping>();
    }

    /// <summary>Form người dùng chọn tay ở thanh công cụ ("Tự nhận diện" = null).</summary>
    private FormProfile? SelectedForm()
    {
        if (_cmbForm.SelectedIndex <= 0) return null;
        var i = _cmbForm.SelectedIndex - 1;
        return i < _config.Forms.Count ? _config.Forms[i] : null;
    }

    private FormProfile? ResolveActiveForm()
    {
        var url = SafeSource() ?? "";
        if (url.Length == 0) return null;

        FormProfile? best = null;
        int bestLen = -1;
        foreach (var f in _config.Forms)
        {
            if (!string.IsNullOrEmpty(f.UrlContains) &&
                url.IndexOf(f.UrlContains, StringComparison.OrdinalIgnoreCase) >= 0 &&
                f.UrlContains.Length > bestLen)
            {
                best = f;
                bestLen = f.UrlContains.Length;
            }
        }
        return best;
    }

    private void RefreshFormCombo()
    {
        var keep = _cmbForm.SelectedIndex;
        _cmbForm.Items.Clear();
        _cmbForm.Items.Add("🔎 Tự nhận diện theo URL");
        foreach (var f in _config.Forms) _cmbForm.Items.Add(f.Name);
        _cmbForm.SelectedIndex = keep >= 0 && keep < _cmbForm.Items.Count ? keep : 0;
    }

    private void OnFormSelectionChanged()
    {
        if (_table != null) _pastePanel.SetTable(_table, ActiveFields());
        var f = SelectedForm();
        SetStatus(f != null
            ? $"Đang dùng form '{f.Name}' ({f.Fields.Count} trường) — bỏ qua nhận diện theo URL."
            : "Đang tự nhận diện form theo URL.");
    }

    /// <summary>
    /// ĐIỀN MỘT CHẠM — "copy trong Excel rồi bấm ▶ Điền là xong", bỏ bước 📋 Dán.
    ///
    /// Luật (vừa nhanh vừa KHÔNG phá luồng cũ):
    ///  1. Đọc clipboard bằng API native (ClipboardService, có retry) và phân tích bảng.
    ///  2. Nếu clipboard CÓ dữ liệu bảng:
    ///       • nội dung KHÁC lần bấm trước -> nạp bảng mới, điền dòng dữ liệu ĐẦU TIÊN
    ///         (không mở bảng xem trước — đây chính là bước được bỏ bớt);
    ///       • nội dung GIỐNG lần trước, khối copy có >1 dòng và OneClickAdvanceRows
    ///         -> sang dòng KẾ TIẾP (bấm liên tiếp = điền lần lượt từng bệnh nhân);
    ///       • đã tới dòng cuối -> quay vòng về dòng đầu.
    ///  3. Nếu clipboard KHÔNG đọc được hoặc không phải dữ liệu bảng -> giữ nguyên bảng
    ///     đã dán và điền dòng đang chọn (hành vi cũ). Nhờ vậy lỡ copy một đoạn chữ
    ///     khác cũng không mất dữ liệu đang làm dở.
    ///
    /// Kiểm tra khớp cột TRƯỚC khi điền: copy thiếu dòng tiêu đề, hoặc tiêu đề Excel
    /// lệch tên so với cấu hình, mà không khớp được trường nào thì app MỞ BẢNG XEM
    /// TRƯỚC kèm cảnh báo — thay vì điền rồi im lặng không có gì xảy ra (kiểu lỗi khó
    /// chịu nhất ở phòng khám, vì người dùng không biết vì sao).
    /// </summary>
    private void SmartFill()
    {
        if (_busy) { SetStatus("⏳ Đang điền, chờ chút..."); return; }

        // Tắt một-chạm thì ▶ Điền hành xử đúng như bản trước.
        if (!_config.OneClickFill) { FillSelectedRow(dryRun: false); return; }

        var fields = ActiveFields();
        if (fields.Count == 0) { WarnNoMapping(); return; }

        if (!_coreReady || _webView?.CoreWebView2 == null)
        {
            SetStatus("❌ Trang chưa sẵn sàng. Chờ medinet tải xong hoặc bấm ⟳ Tải lại.");
            Toast("❌ Trang chưa sẵn sàng", true);
            return;
        }

        var (clip, table) = ClipboardService.ReadTable(fields, DelimiterFromConfig());

        // (3) Clipboard không dùng được -> quay về hành vi cũ, KHÔNG phá dữ liệu đã dán.
        if (!clip.Ok || table.IsEmpty)
        {
            if (_table != null && !_table.IsEmpty)
            {
                AppLogger.Info("Một-chạm: clipboard không có dữ liệu bảng (" + (clip.Error ?? "rỗng") +
                               ") -> điền dòng đang chọn của bảng đã dán.");
                FillSelectedRow(dryRun: false);
            }
            else
            {
                var detail = clip.Error ?? "Clipboard không có dữ liệu bảng copied từ Excel.";
                SetStatus("⚠ " + detail);
                Toast("⚠ Chưa có dữ liệu — copy trong Excel rồi bấm lại", true);
                AppLogger.Warn($"Một-chạm: {detail} (sau {clip.Attempts} lần thử / {clip.ElapsedMs} ms)");
            }
            return;
        }

        // Kiểm tra khớp cột trước khi điền.
        var map = TsvParser.ResolveColumns(fields, table.HeaderRow, out int headerMatched);
        int inRange = map.Count(c => c >= 0 && c < table.ColCount);
        int first = table.FirstDataRow;
        int dataRows = table.RowCount - first;

        if (dataRows <= 0)
        {
            SetStatus("⚠ Clipboard chỉ có dòng tiêu đề, không có dòng số liệu nào.");
            Toast("⚠ Chỉ có tiêu đề, chưa có số liệu", true);
            return;
        }

        bool headerButNoMatch = table.HasHeader && headerMatched == 0;
        if (headerButNoMatch || inRange == 0)
        {
            _table = table;
            ShowPastePanel(true);
            _pastePanel.SetTable(table, fields);
            _pastePanel.ClearReport();
            var why = headerButNoMatch
                ? "có dòng tiêu đề nhưng KHÔNG khớp tên cột nào với ánh xạ của form"
                : "vị trí cột vượt quá số cột đã copy";
            SetStatus($"⚠ Không điền được: {why}. Đã mở bảng dữ liệu để xem chi tiết.");
            Toast("⚠ Không khớp cột nào — xem bảng dữ liệu", true);
            var hdr = table.HeaderRow;
            AppLogger.Warn($"Một-chạm: {why}. Khớp tiêu đề {headerMatched}/{fields.Count}, " +
                           $"trong phạm vi {inRange}/{fields.Count}. Tiêu đề Excel: " +
                           (hdr == null ? "(không có)" : string.Join(" | ", hdr.Take(10))));
            return;
        }

        // (2) Quyết định điền dòng nào.
        string hash = HashText(clip.BestText);
        bool sameClip = hash == _lastClipHash && _table != null && _table.RowCount == table.RowCount;
        int row = first;
        if (_config.OneClickAdvanceRows && sameClip && dataRows > 1 && _oneClickRow + 1 < table.RowCount)
            row = _oneClickRow + 1;
        if (row < first || row >= table.RowCount) row = first;

        bool isNew = !sameClip;      // chỉ dùng cho log + thanh trạng thái, không toast
        _lastClipHash = hash;
        _oneClickRow = row;
        _oneClickActive = true;
        _table = table;
        _queue.Clear();      // một-chạm tự quản lý dòng, không dùng hàng đợi F9
        _queuePos = 0;

        // Nạp vào bảng nhưng KHÔNG hiện ra: để F7 / Ctrl+Enter / báo cáo vẫn nhất quán.
        _pastePanel.SetTable(table, fields);
        _pastePanel.ClearReport();
        _pastePanel.SelectDataRow(row);

        AppLogger.Info($"Một-chạm: {(isNew ? "clipboard MỚI" : "cùng clipboard")}, " +
                       $"{dataRows} dòng dữ liệu, khớp tiêu đề {headerMatched}/{fields.Count} trường, " +
                       $"điền dòng {row - first + 1}/{dataRows}, " +
                       $"đọc clipboard {clip.ElapsedMs} ms / {clip.Attempts} lần thử");

        FillRow(row, dryRun: false);

        // Đặt SAU FillRow vì FillRow cũng ghi thanh trạng thái; dòng này phải là dòng
        // người dùng nhìn thấy trong lúc chờ kết quả.
        SetStatus($"⚡ {(isNew ? "Clipboard mới → điền" : "Điền tiếp")} dòng {row - first + 1}/{dataRows}" +
                  $" (khớp tiêu đề {headerMatched}/{fields.Count} trường)" +
                  (dataRows > 1 && _config.OneClickAdvanceRows ? " — bấm ▶ Điền (F8) lần nữa để sang dòng kế." : ""));
    }

    /// <summary>
    /// Vân tay nội dung clipboard, để biết người dùng có copy lại hay không.
    /// Dùng SHA256 thay vì so nguyên chuỗi: khối copy có thể hàng trăm dòng, và
    /// GetHashCode() của string bị ngẫu nhiên hoá theo tiến trình nên không đáng tin
    /// khi muốn so sánh ổn định.
    /// </summary>
    private static string HashText(string text)
    {
        if (string.IsNullOrEmpty(text)) return "";
        return Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));
    }

    private void FillSelectedRow(bool dryRun)
    {
        _oneClickActive = false;   // luồng có bảng xem trước, không phải một-chạm
        if (_table == null || _table.IsEmpty)
        {
            SetStatus("⚠ Chưa có dữ liệu. Copy trong Excel rồi bấm ▶ Điền (F8) — không cần bước Dán.");
            Toast("⚠ Chưa có dữ liệu — copy trong Excel rồi bấm ▶ Điền", true);
            return;
        }
        FillRow(_pastePanel.SelectedDataRowIndex, dryRun);
    }

    private void FillRow(int rowIndex, bool dryRun)
    {
        if (_busy) { SetStatus("⏳ Đang điền, chờ chút..."); return; }
        if (_table == null || _table.IsEmpty) return;

        var fields = ActiveFields();
        if (fields.Count == 0) { WarnNoMapping(); return; }

        if (!_coreReady || _webView?.CoreWebView2 == null)
        {
            SetStatus("❌ Trang chưa sẵn sàng. Chờ medinet tải xong hoặc bấm ⟳ Tải lại.");
            Toast("❌ Trang chưa sẵn sàng", true);
            return;
        }

        if (rowIndex < 0 || rowIndex >= _table.RowCount)
        {
            SetStatus("⚠ Dòng chọn không hợp lệ.");
            return;
        }

        var payload = new FillPayload
        {
            Rows = _table.Rows,
            HeaderRow = _table.HeaderRow,
            RowIndex = rowIndex,
            Fields = fields,
            FormId = (SelectedForm() ?? ResolveActiveForm())?.Name,
            DryRun = dryRun,
            ReadyTimeoutMs = _config.Options.ReadyTimeoutMs
        };

        _busy = true;
        _queueTotal = 1; _queueDone = 0; _queueOk = 0;
        _pastePanel.SetBusy(true);
        _progress.Visible = true;
        _progress.Value = 0;
        SetStatus(dryRun ? "🧪 Đang kiểm tra mapping (không ghi dữ liệu)..." : $"▶ Đang điền dòng {rowIndex + 1}...");
        AppLogger.Info((dryRun ? "DryRun" : "Fill") + $" dòng {rowIndex + 1}, {fields.Count} trường");

        _ = ExecuteAsync(AutoFillScriptBuilder.BuildFill(payload));
    }

    private void FillAllRows()
    {
        if (_table == null || _table.IsEmpty) { SetStatus("⚠ Chưa có dữ liệu."); return; }
        if (!_config.EnableRowQueue)
        {
            SetStatus("⚠ Điền hàng loạt đang tắt trong cấu hình.");
            return;
        }
        var list = new List<int>();
        for (int r = _table.FirstDataRow; r < _table.RowCount; r++) list.Add(r);
        if (list.Count == 0) { SetStatus("⚠ Không có dòng dữ liệu nào (chỉ có dòng tiêu đề?)."); return; }
        FillQueue(list);
    }

    /// <summary>
    /// Điền lần lượt từng dòng. KHÔNG gửi hết một lượt: mỗi bệnh nhân thường phải
    /// mở/lưu một phiếu riêng, nên điền xong dòng nào phần mềm dừng lại dòng đó
    /// để người dùng kiểm tra rồi bấm F9 sang dòng kế.
    /// </summary>
    private void FillQueue(List<int> rowIndexes)
    {
        if (rowIndexes == null || rowIndexes.Count == 0) return;
        _oneClickActive = false;   // hàng đợi F9 là luồng của bảng xem trước
        _queue = rowIndexes;
        _queuePos = 0;
        _queueTotal = rowIndexes.Count;
        _queueDone = 0;
        _queueOk = 0;
        FillRow(rowIndexes[0], dryRun: false);
    }

    private List<int> _queue = new();
    private int _queuePos;

    private void FillNextInQueue()
    {
        if (_queue.Count == 0)
        {
            // Không có hàng đợi: F9 đơn giản là điền dòng kế tiếp trong bảng.
            if (_table == null || _table.IsEmpty) { SetStatus("⚠ Chưa có dữ liệu."); return; }
            var next = Math.Min(_pastePanel.SelectedDataRowIndex + 1, _table.RowCount - 1);
            FillRow(next, dryRun: false);
            return;
        }
        if (_busy) { SetStatus("⏳ Đang điền dòng hiện tại..."); return; }
        _queuePos++;
        if (_queuePos >= _queue.Count)
        {
            SetStatus($"✅ Hoàn tất hàng đợi: {_queueOk}/{_queueTotal} dòng điền thành công.");
            Toast($"✅ Xong {_queueOk}/{_queueTotal} dòng", _queueOk < _queueTotal);
            _queue.Clear();
            _queuePos = 0;
            return;
        }
        FillRow(_queue[_queuePos], dryRun: false);
    }

    private void SelectAllNo()
    {
        if (!_coreReady || _webView?.CoreWebView2 == null)
        {
            SetStatus("❌ Trang chưa sẵn sàng.");
            return;
        }
        SetStatus("☑ Đang chọn 'Không' hàng loạt...");
        _ = ExecuteAsync(AutoFillScriptBuilder.BuildSelectNo(_config.SelectNoKeywords));
    }

    private async Task ExecuteAsync(string script)
    {
        try
        {
            var core = _webView?.CoreWebView2;
            if (core == null) return;
            await core.ExecuteScriptAsync(script);
        }
        catch (Exception ex)
        {
            AppLogger.Error("ExecuteScript thất bại", ex);
            SetStatus("❌ Không gửi được lệnh sang trang: " + ex.Message);
            Toast("❌ Trang có thể đã bị tải lại — bấm ⟳ rồi thử lại", true);
            FinishFillUi();
        }
    }

    private void OnFillReport(FillReport report)
    {
        AppLogger.Info("Kết quả điền: " + report.Summary);
        if (report.Missing.Count > 0)
            AppLogger.Warn("Không thấy ô nhập: " + string.Join(" | ", report.Missing.ConvertAll(m => m.Label)));
        if (report.Failed.Count > 0)
            AppLogger.Warn("Ghi thất bại: " + string.Join(" | ", report.Failed.ConvertAll(f => f.Label + "(" + f.Reason + ")")));

        FinishFillUi();

        if (report.Error != null)
        {
            SetStatus("❌ " + (report.Message ?? report.Error));
            Toast("❌ " + (report.Message ?? report.Error), true);
            if (report.Error == "no-fields") WarnNoMapping();
            return;
        }

        _pastePanel.SetReport(report);
        _queueDone++;
        if (report.Ok > 0 && report.Failed.Count == 0) _queueOk++;

        var icon = report.Failed.Count > 0 ? "⚠" : (report.Missing.Count > 0 ? "🟡" : "✅");
        SetStatus($"{icon} {report.Summary}");
        Toast($"{icon} {report.Summary}", report.Failed.Count > 0);

        if (_progress.Visible && _queueTotal > 0)
            _progress.Value = Math.Min(100, (int)(100.0 * _queueDone / _queueTotal));

        // Nhắc bước kế tiếp ĐÚNG THEO CHẾ ĐỘ vừa dùng: một-chạm thì F8, hàng đợi thì F9.
        if (_oneClickActive && _table != null)
        {
            int first = _table.FirstDataRow;
            int total = _table.RowCount - first;
            if (total > 1 && _config.OneClickAdvanceRows && _oneClickRow + 1 < _table.RowCount)
                SetStatus($"{icon} {report.Summary}  •  Bấm ⚡ Điền (F8) lần nữa để sang dòng kế tiếp ({_oneClickRow - first + 2}/{total}).");
            else if (total > 1 && _config.OneClickAdvanceRows)
                SetStatus($"{icon} {report.Summary}  •  Đã tới dòng cuối ({total}/{total}) — bấm F8 lần nữa sẽ quay về dòng đầu.");
        }
        else if (_queue.Count > 0 && _queuePos < _queue.Count - 1)
        {
            SetStatus($"{icon} {report.Summary}  •  Bấm F9 để điền dòng kế tiếp ({_queuePos + 2}/{_queueTotal}).");
        }
    }

    private void FinishFillUi()
    {
        _busy = false;
        _pastePanel.SetBusy(false);
        _progress.Visible = false;
    }

    private void WarnNoMapping()
    {
        var url = SafeSource() ?? "(chưa tải trang)";
        var sb = new StringBuilder();
        sb.AppendLine("Không xác định được bộ ánh xạ (mapping) cho trang đang mở.");
        sb.AppendLine();
        sb.AppendLine("URL hiện tại: " + url);
        sb.AppendLine();
        if (_config.Forms.Count == 0)
        {
            sb.AppendLine("File cấu hình chưa có form nào. Bấm ⚙ Cài đặt để 'Khôi phục mặc định' rồi Lưu.");
        }
        else
        {
            sb.AppendLine("Các form đã khai báo:");
            foreach (var f in _config.Forms)
                sb.AppendLine($"  • {f.Name}  —  URL chứa: '{(string.IsNullOrEmpty(f.UrlContains) ? "(trống)" : f.UrlContains)}'");
            sb.AppendLine();
            sb.AppendLine("Cách xử lý (chọn 1):");
            sb.AppendLine("  1. Chọn form ở ô dropdown trên thanh công cụ (bỏ qua nhận diện URL).");
            sb.AppendLine("  2. Vào ⚙ Cài đặt, sửa 'URL chứa' cho khớp với địa chỉ trang medinet đang mở.");
        }

        SetStatus("⚠ Chưa khớp form nào với URL này — xem hướng dẫn.");
        Toast("⚠ Chưa nhận diện được form", true);
        AppLogger.Warn("Không khớp form cho URL: " + url);
        MessageBox.Show(sb.ToString(), "Chưa nhận diện được form", MessageBoxButtons.OK, MessageBoxIcon.Warning);
    }

    // ------------------------------------------------------------- Điều hướng
    /// <summary>URL trang chủ (mặc định là trang đăng nhập medinet).</summary>
    private string HomeUrl()
    {
        return string.IsNullOrWhiteSpace(_config.DefaultUrl)
            ? "https://quanlyskcd.medinet.org.vn/account/login"
            : _config.DefaultUrl.Trim();
    }

    private void NavigateHome() => Navigate(HomeUrl());

    private void Navigate(string url)
    {
        try
        {
            if (_webView?.CoreWebView2 != null)
            {
                _webView.CoreWebView2.Navigate(url);
                AppLogger.Info("Điều hướng: " + url);
            }
            else
            {
                // WebView2 chưa sẵn sàng: đặt Source để nó tự điều hướng khi init xong.
                if (_webView != null)
                {
                    _webView.Source = new Uri(url.StartsWith("http", StringComparison.OrdinalIgnoreCase) ? url : "https://" + url);
                    // Nhớ rằng user đã tự chọn URL — ScheduleInitialNavigation() sẽ
                    // KHÔNG điều hướng về trang chủ đè lên (trước đây URL user gõ
                    // trong lúc khởi động có thể bị trang chủ đè mất).
                    _urlQueuedBeforeCore = true;
                }
                _pendingFillAfterLoad = _table != null;
            }
        }
        catch (Exception ex)
        {
            AppLogger.Error("Điều hướng thất bại: " + url, ex);
            SetStatus("❌ Không mở được " + url + ": " + ex.Message);
        }
    }

    private void ReloadPage()
    {
        try
        {
            if (_webView?.CoreWebView2 != null) _webView.CoreWebView2.Reload();
            else _webView?.Reload();
            SetStatus("⟳ Đang tải lại trang...");
        }
        catch (Exception ex)
        {
            AppLogger.Warn("Tải lại trang thất bại: " + ex.Message);
        }
    }

    private string? SafeSource()
    {
        try { return _webView?.CoreWebView2?.Source; }
        catch { return null; }
    }

    private void UpdateAddressBar()
    {
        if (IsDisposed) return;
        var src = SafeSource();
        if (src != null && _txtAddress.Text != src) _txtAddress.Text = src;
    }

    // ------------------------------------------------------------- Giao diện phụ
    private void ShowPastePanel(bool show)
    {
        _pastePanel.EnsureBuilt();
        _pastePanel.Visible = show;
        if (show) _pastePanel.BringToFront();
    }

    private void TogglePastePanel()
    {
        ShowPastePanel(!_pastePanel.Visible);
    }

    private void SetStatus(string text)
    {
        if (IsDisposed) return;
        try { _lblStatus.Text = text; } catch { }
    }

    /// <summary>Thông báo nổi ở góc phải, tự mất — để người dùng không phải nhìn thanh trạng thái.</summary>
    private void Toast(string message, bool isError)
    {
        if (IsDisposed) return;
        try
        {
            var lbl = new Label
            {
                Text = message,
                AutoSize = false,
                Size = new Size(420, 40),
                TextAlign = ContentAlignment.MiddleLeft,
                BackColor = isError ? Color.FromArgb(211, 47, 47) : Color.FromArgb(46, 125, 50),
                ForeColor = Color.White,
                Font = new Font("Segoe UI", 9.5f, FontStyle.Bold),
                Padding = new Padding(10, 0, 10, 0)
            };
            // Xếp chồng: đếm số toast đang hiện để đặt cái mới ngay bên dưới,
            // thay vì vẽ tất cả lên cùng một toạ độ rồi đè lên nhau.
            lbl.Tag = "toast";
            int stack = 0;
            foreach (Control c in Controls)
                if (c is Label && Equals(c.Tag, "toast")) stack++;
            lbl.Location = new Point(ClientSize.Width - lbl.Width - 16, 52 + stack * 44);
            lbl.Anchor = AnchorStyles.Top | AnchorStyles.Right;
            Controls.Add(lbl);
            lbl.BringToFront();

            var timer = new System.Windows.Forms.Timer { Interval = 4200 };
            timer.Tick += (_, _) =>
            {
                timer.Stop();
                timer.Dispose();
                try { Controls.Remove(lbl); lbl.Dispose(); } catch { }
            };
            timer.Start();
        }
        catch { /* toast chỉ là phụ, không được làm hỏng nghiệp vụ */ }
    }

    private void ShowReportDialog(FillReport report)
    {
        using var dlg = new Form
        {
            Text = "Kết quả điền dữ liệu",
            StartPosition = FormStartPosition.CenterParent,
            Size = new Size(760, 560),
            MinimizeBox = false,
            MaximizeBox = true
        };
        var txt = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Both,
            WordWrap = false,
            Font = new Font("Consolas", 9.5f),
            Text = report.ToText()
        };
        var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
        var btnCopy = new Button { Text = "📋 Copy báo cáo", AutoSize = true };
        var btnClose = new Button { Text = "Đóng", AutoSize = true, DialogResult = DialogResult.OK };
        btnCopy.Click += (_, _) =>
        {
            if (ClipboardService.Write(txt.Text)) SetStatus("Đã copy báo cáo vào clipboard.");
        };
        bottom.Controls.Add(btnClose);
        bottom.Controls.Add(btnCopy);
        dlg.Controls.Add(txt);
        dlg.Controls.Add(bottom);
        dlg.AcceptButton = btnClose;
        dlg.ShowDialog(this);
    }

    private void ShowLogDialog()
    {
        using var dlg = new Form
        {
            Text = "Nhật ký hoạt động — " + AppPaths.LogFileToday,
            StartPosition = FormStartPosition.CenterParent,
            Size = new Size(900, 560)
        };
        var txt = new TextBox
        {
            Dock = DockStyle.Fill,
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Both,
            WordWrap = false,
            Font = new Font("Consolas", 9f),
            Text = string.Join(Environment.NewLine, AppLogger.Recent())
        };
        var bottom = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 44, FlowDirection = FlowDirection.RightToLeft, Padding = new Padding(8) };
        var btnCopy = new Button { Text = "📋 Copy log", AutoSize = true };
        var btnOpenFolder = new Button { Text = "📂 Mở thư mục log", AutoSize = true };
        var btnClose = new Button { Text = "Đóng", AutoSize = true, DialogResult = DialogResult.OK };
        btnCopy.Click += (_, _) => { if (ClipboardService.Write(txt.Text)) SetStatus("Đã copy log."); };
        btnOpenFolder.Click += (_, _) =>
        {
            try
            {
                Directory.CreateDirectory(AppPaths.LogDirectory);
                System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo
                {
                    FileName = AppPaths.LogDirectory,
                    UseShellExecute = true
                });
            }
            catch (Exception ex) { MessageBox.Show("Không mở được thư mục log: " + ex.Message); }
        };
        bottom.Controls.Add(btnClose);
        bottom.Controls.Add(btnOpenFolder);
        bottom.Controls.Add(btnCopy);
        dlg.Controls.Add(txt);
        dlg.Controls.Add(bottom);
        dlg.ShowDialog(this);
    }

    private void OpenSettings()
    {
        // Truyền hàm quét trang để tab "Chẩn đoán" lấy được selector thật từ medinet.
        using var dlg = new SettingsForm(_config, ScanPageAsync);
        if (dlg.ShowDialog(this) != DialogResult.OK) return;

        // Lấy bản cấu hình đã lưu từ dialog (copy sâu để không dính reference).
        _config = AppJson.DeepClone(dlg.Config);
        AppLogger.Info("Đã lưu cấu hình mới từ giao diện Cài đặt.");

        RefreshFormCombo();
        if (_table != null) _pastePanel.SetTable(_table, ActiveFields());
        _ = ApplyConfigToPageAsync();
        SetStatus("✅ Đã lưu cấu hình và áp dụng ngay cho trang đang mở.");
        Toast("✅ Đã lưu cấu hình", false);
    }

    protected override void OnFormClosed(FormClosedEventArgs e)
    {
        try { ConfigRepository.StopWatching(); } catch { }
        try { _webView?.Dispose(); } catch { }   // tự huỷ cả CoreWebView2
        AppLogger.Info("==== Đóng phần mềm ====");
        base.OnFormClosed(e);
    }
}
