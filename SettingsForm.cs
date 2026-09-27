using System.Text;
using System.Text.Json;

namespace MedicalAutoFillTool;

/// <summary>
/// Giao diện cấu hình: quản lý form, ánh xạ cột Excel -&gt; trường trên web,
/// tham số engine, và bộ công cụ CHẨN ĐOÁN (quét trang, thử phân tích dữ liệu dán).
///
/// Mọi thay đổi lưu vào config/forms.json và áp dụng ngay, không cần sửa code.
/// </summary>
public class SettingsForm : Form
{
    private readonly AppConfig _config;                    // bản làm việc (copy sâu)
    private readonly Func<string?, Task<string?>>? _scanPage;

    // --- Tab 1: form & trường ---
    private readonly TabControl _tabs = new();
    private readonly ListBox _lstForms = new();
    private readonly TextBox _txtName = new();
    private readonly TextBox _txtUrl = new();
    private readonly TextBox _txtUrlRegex = new();
    private readonly DataGridView _dgvFields = new();

    // --- Tab 2: tùy chọn ---
    private readonly TextBox _txtDefaultUrl = new();
    private readonly ComboBox _cmbPasteMode = new();
    private readonly TextBox _txtNoKeywords = new();
    private readonly CheckBox _chkPreferHeader = new();
    private readonly CheckBox _chkAutoFillOnPaste = new();
    private readonly CheckBox _chkHijackCtrlV = new();
    private readonly CheckBox _chkOneClickFill = new();
    private readonly CheckBox _chkOneClickAdvance = new();
    private readonly CheckBox _chkFillImmediately = new();
    private readonly CheckBox _chkEnableQueue = new();
    private readonly CheckBox _chkSelectNoHotkey = new();
    private readonly CheckBox _chkHighlightMissing = new();
    private readonly CheckBox _chkNormalizeNumbers = new();
    private readonly CheckBox _chkDebugEngine = new();
    private readonly CheckBox _chkAllowDevTools = new();
    private readonly CheckBox _chkOpenDevTools = new();
    private readonly CheckBox _chkLogToFile = new();
    private readonly CheckBox _chkDisableGpu = new();
    private readonly NumericUpDown _numReadyTimeout = new();
    private readonly NumericUpDown _numMaxAttempts = new();
    private readonly NumericUpDown _numMinScore = new();
    private readonly NumericUpDown _numPerFieldDelay = new();
    private readonly NumericUpDown _numPerRowDelay = new();

    // --- Tab 3: chẩn đoán ---
    private readonly TextBox _txtSample = new();
    private readonly TextBox _txtAnalysis = new();
    private readonly DataGridView _dgvScan = new();
    private readonly TextBox _txtScanFilter = new();
    private readonly Label _lblScanInfo = new();

    private readonly Button _btnSave = new();
    private readonly Button _btnCancel = new();
    private readonly Button _btnReset = new();
    private readonly Button _btnExport = new();
    private readonly Button _btnImport = new();
    private readonly Label _lblPath = new();

    private FormProfile? _current;
    private static readonly string[] ControlTypes = { "auto", "text", "textarea", "number", "date", "select", "checkbox", "radio" };

    /// <summary>Cấu hình sau khi người dùng nhấn Lưu.</summary>
    public AppConfig Config => _config;

    /// <param name="scanPage">Hàm mượn WebView2 của cửa sổ chính để quét trang medinet (có thể null).</param>
    public SettingsForm(AppConfig original, Func<string?, Task<string?>>? scanPage = null)
    {
        _scanPage = scanPage;
        Text = "⚙ Cài đặt tiện ích";
        StartPosition = FormStartPosition.CenterParent;
        MinimumSize = new Size(980, 640);
        Size = new Size(1080, 720);

        // Copy sâu để bấm Hủy không làm mất cấu hình gốc.
        _config = AppJson.DeepClone(original);

        BuildUi();
        LoadGlobal();
        RefreshFormsList();
        _lstForms.SelectedIndex = _config.Forms.Count > 0 ? 0 : -1;
    }

    // ------------------------------------------------------------------- UI
    private void BuildUi()
    {
        // THỨ TỰ DOCK: control thêm SAU được dock TRƯỚC.
        // Thêm tabs (Fill) TRƯỚC, rồi thanh nút (Bottom) — làm ngược sẽ che mất dòng cuối của lưới.
        _tabs.Dock = DockStyle.Fill;
        _tabs.TabPages.Add(BuildTabForms());       // 0
        _tabs.TabPages.Add(BuildTabGeneral());     // 1
        _tabs.TabPages.Add(BuildTabDiagnostics()); // 2
        Controls.Add(_tabs);

        var bottom = new TableLayoutPanel { Dock = DockStyle.Bottom, Height = 54, ColumnCount = 6, Padding = new Padding(10, 8, 10, 8) };
        bottom.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100f));
        for (int i = 1; i < 6; i++) bottom.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        _lblPath.Text = "Cấu hình: " + ConfigRepository.ConfigPath;
        _lblPath.ForeColor = Color.Gray;
        _lblPath.AutoEllipsis = true;

        Style(_btnExport, "📤 Xuất", "Xuất cấu hình ra file JSON để mang sang máy khác");
        _btnExport.Click += (_, _) => ExportConfig();
        Style(_btnImport, "📥 Nhập", "Nhập cấu hình từ file JSON");
        _btnImport.Click += (_, _) => ImportConfig();
        Style(_btnReset, "Khôi phục mặc định", "Trả về bộ form mẫu ban đầu");
        _btnReset.Click += (_, _) => ResetToDefault();
        Style(_btnCancel, "Hủy", "");
        _btnCancel.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };
        Style(_btnSave, "💾 Lưu cấu hình", "Lưu và áp dụng ngay cho trang đang mở");
        _btnSave.BackColor = Color.FromArgb(0, 140, 60);
        _btnSave.ForeColor = Color.White;
        _btnSave.Click += (_, _) => SaveAndClose();

        bottom.Controls.Add(_lblPath, 0, 0);
        bottom.Controls.Add(_btnExport, 1, 0);
        bottom.Controls.Add(_btnImport, 2, 0);
        bottom.Controls.Add(_btnReset, 3, 0);
        bottom.Controls.Add(_btnCancel, 4, 0);
        bottom.Controls.Add(_btnSave, 5, 0);
        Controls.Add(bottom);
    }

    private static void Style(Button b, string text, string tooltip)
    {
        b.Text = text;
        b.AutoSize = true;
        b.Margin = new Padding(4, 2, 4, 2);
        if (!string.IsNullOrEmpty(tooltip)) new ToolTip().SetToolTip(b, tooltip);
    }

    private TabPage BuildTabForms()
    {
        var page = new TabPage("Form & Trường dữ liệu");

        // Cột trái: danh sách form
        var left = new Panel { Dock = DockStyle.Left, Width = 250, Padding = new Padding(8) };
        var leftLbl = new Label { Text = "Danh sách các form:", Dock = DockStyle.Top, Height = 20 };
        var leftBtns = new FlowLayoutPanel { Dock = DockStyle.Bottom, Height = 34 };
        var btnAddForm = new Button { Text = "+ Thêm form", AutoSize = true };
        var btnRemoveForm = new Button { Text = "− Xóa form", AutoSize = true };
        var btnDupForm = new Button { Text = "⧉ Nhân bản", AutoSize = true };
        btnAddForm.Click += (_, _) => AddForm();
        btnRemoveForm.Click += (_, _) => RemoveForm();
        btnDupForm.Click += (_, _) => DuplicateForm();
        leftBtns.Controls.Add(btnAddForm);
        leftBtns.Controls.Add(btnDupForm);
        leftBtns.Controls.Add(btnRemoveForm);

        _lstForms.Dock = DockStyle.Fill;
        _lstForms.SelectedIndexChanged += (_, _) => LoadSelected();

        left.Controls.Add(_lstForms);      // Fill thêm TRƯỚC
        left.Controls.Add(leftLbl);
        left.Controls.Add(leftBtns);

        // Cột phải: thông tin form + lưới trường
        var right = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, Padding = new Padding(8) };
        right.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        right.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        right.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        right.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        right.Controls.Add(MakeLabeledRow("Tên form:", _txtName, "Tên hiển thị, vd: Phiếu Cận Lâm Sàng (KSKDK)"), 0, 0);
        right.Controls.Add(MakeLabeledRow("URL chứa:", _txtUrl, "Trang medinet có địa chỉ CHỨA chuỗi này thì form được áp dụng, vd: KSKDK_Phieu_CanLamSang"), 0, 1);
        right.Controls.Add(MakeLabeledRow("URL (regex):", _txtUrlRegex, "Không bắt buộc. Dùng khi địa chỉ trang thay đổi số id, vd: KSKDK_Phieu_CanLamSang/\\d+"), 0, 2);
        right.Controls.Add(BuildGridPanel(), 0, 3);

        page.Controls.Add(right);
        page.Controls.Add(left);
        return page;
    }

    private static Panel MakeLabeledRow(string caption, TextBox box, string tooltip)
    {
        var p = new Panel { Dock = DockStyle.Fill };
        var lbl = new Label { Text = caption, Location = new Point(0, 6), Size = new Size(92, 20) };
        box.Location = new Point(96, 3);
        box.Width = 620;
        box.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        if (!string.IsNullOrEmpty(tooltip)) new ToolTip().SetToolTip(box, tooltip);
        p.Controls.Add(lbl);
        p.Controls.Add(box);
        return p;
    }

    private Panel BuildGridPanel()
    {
        var p = new Panel { Dock = DockStyle.Fill, Padding = new Padding(0, 4, 0, 0) };

        var head = new FlowLayoutPanel { Dock = DockStyle.Top, Height = 34 };
        head.Controls.Add(new Label { Text = "Ánh xạ dữ liệu → trường trên web:", AutoSize = true, Margin = new Padding(0, 8, 8, 0) });

        var btnAdd = new Button { Text = "+ Thêm trường", AutoSize = true, Margin = new Padding(3, 4, 3, 0) };
        var btnDel = new Button { Text = "− Xóa", AutoSize = true, Margin = new Padding(3, 4, 3, 0) };
        var btnUp = new Button { Text = "▲", AutoSize = true, Margin = new Padding(3, 4, 3, 0) };
        var btnDown = new Button { Text = "▼", AutoSize = true, Margin = new Padding(3, 4, 3, 0) };
        var btnRenumber = new Button { Text = "🔢 Đánh số lại cột", AutoSize = true, Margin = new Padding(3, 4, 3, 0) };
        var btnPickSelector = new Button { Text = "🎯 Lấy selector từ trang", AutoSize = true, Margin = new Padding(3, 4, 3, 0) };

        btnAdd.Click += (_, _) => AddFieldRow();
        btnDel.Click += (_, _) => RemoveFieldRows();
        btnUp.Click += (_, _) => MoveFieldRow(-1);
        btnDown.Click += (_, _) => MoveFieldRow(+1);
        btnRenumber.Click += (_, _) => RenumberColumns();
        btnPickSelector.Click += (_, _) => PickSelectorForSelectedField();

        new ToolTip().SetToolTip(btnRenumber, "Đánh lại 'Cột Excel' = 0,1,2... theo đúng thứ tự dòng (dùng sau khi xoá/chèn trường)");
        new ToolTip().SetToolTip(btnPickSelector, "Quét trang medinet đang mở, chọn nhãn và lấy CSS selector chính xác cho trường này");

        head.Controls.Add(btnAdd);
        head.Controls.Add(btnDel);
        head.Controls.Add(btnUp);
        head.Controls.Add(btnDown);
        head.Controls.Add(btnRenumber);
        head.Controls.Add(btnPickSelector);

        _dgvFields.Dock = DockStyle.Fill;
        _dgvFields.AllowUserToAddRows = false;
        _dgvFields.AllowUserToDeleteRows = false;
        _dgvFields.RowHeadersVisible = true;
        _dgvFields.RowHeadersWidth = 34;
        _dgvFields.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _dgvFields.MultiSelect = false;
        _dgvFields.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.None;
        _dgvFields.AutoSizeRowsMode = DataGridViewAutoSizeRowsMode.AllCells;
        _dgvFields.BackgroundColor = Color.White;
        _dgvFields.Font = new Font("Segoe UI", 9f);

        _dgvFields.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Cột Excel", Width = 70 });
        _dgvFields.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Nhãn trên web (cách nhau bằng ;)", Width = 260 });
        _dgvFields.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Tên cột trong Excel (;)", Width = 220 });
        _dgvFields.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Selector CSS (nếu biết)", Width = 180 });
        var colType = new DataGridViewComboBoxColumn { HeaderText = "Loại", Width = 90, FlatStyle = FlatStyle.Flat };
        colType.Items.AddRange(ControlTypes);
        _dgvFields.Columns.Add(colType);
        _dgvFields.Columns.Add(new DataGridViewCheckBoxColumn { HeaderText = "Bắt buộc", Width = 70 });

        var hint = new Label
        {
            Dock = DockStyle.Bottom,
            Height = 34,
            ForeColor = Color.DimGray,
            Text = "💡 'Cột Excel' = vị trí cột (0,1,2...) dùng khi KHÔNG có dòng tiêu đề. 'Tên cột trong Excel' dùng để khớp khi CÓ tiêu đề — nên khai cả hai.\r\n" +
                   "     'Selector CSS' là cách chắc chắn nhất: bấm 🎯 để lấy trực tiếp từ trang medinet đang mở."
        };

        p.Controls.Add(_dgvFields);   // Fill thêm TRƯỚC
        p.Controls.Add(head);
        p.Controls.Add(hint);
        return p;
    }

    private TabPage BuildTabGeneral()
    {
        var page = new TabPage("Tùy chọn");
        var tbl = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, Padding = new Padding(12), AutoScroll = true };
        tbl.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));
        tbl.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50f));

        var leftCol = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoSize = true };
        leftCol.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        leftCol.RowStyles.Add(new RowStyle(SizeType.Absolute, 56));
        leftCol.RowStyles.Add(new RowStyle(SizeType.Absolute, 130));
        leftCol.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        leftCol.Controls.Add(MakeLabeledRow("URL mặc định:", _txtDefaultUrl, "Trang mở khi bấm 🏠"), 0, 0);

        var pastePanel = new Panel { Dock = DockStyle.Fill };
        pastePanel.Controls.Add(new Label { Text = "Kiểu phân cách cột:", Location = new Point(0, 6), Size = new Size(140, 20) });
        _cmbPasteMode.Location = new Point(144, 3);
        _cmbPasteMode.Width = 200;
        _cmbPasteMode.DropDownStyle = ComboBoxStyle.DropDownList;
        _cmbPasteMode.Items.AddRange(new object[] { "auto (tự nhận)", "tab", "comma (dấu phẩy)", "semicolon (chấm phẩy)" });
        new ToolTip().SetToolTip(_cmbPasteMode, "Để 'auto' là tốt nhất: tự nhận tab / ; / , theo dữ liệu");
        pastePanel.Controls.Add(_cmbPasteMode);
        leftCol.Controls.Add(pastePanel, 0, 1);

        var kwPanel = new Panel { Dock = DockStyle.Fill };
        kwPanel.Controls.Add(new Label { Text = "Từ khóa chọn 'Không' (Ctrl+B), cách nhau bằng ;:", Location = new Point(0, 0), Size = new Size(420, 20) });
        _txtNoKeywords.Location = new Point(0, 22);
        _txtNoKeywords.Size = new Size(430, 96);
        _txtNoKeywords.Multiline = true;
        _txtNoKeywords.ScrollBars = ScrollBars.Vertical;
        _txtNoKeywords.Anchor = AnchorStyles.Top | AnchorStyles.Left | AnchorStyles.Right;
        kwPanel.Controls.Add(_txtNoKeywords);
        leftCol.Controls.Add(kwPanel, 0, 2);

        var chkLeft = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true };
        Check(_chkPreferHeader, "Ưu tiên khớp cột theo TÊN cột Excel (khuyến nghị)");
        Check(_chkNormalizeNumbers, "Chuẩn hoá số kiểu VN khi ô web là ô số (1.234,5 → 1234.5)");
        Check(_chkHighlightMissing, "Tô vàng nhãn không tìm thấy ô nhập sau khi điền");
        Check(_chkSelectNoHotkey, "Cho phép Ctrl+B chọn 'Không' hàng loạt");
        Check(_chkEnableQueue, "Cho phép điền hàng loạt nhiều dòng (hàng đợi)");
        Check(_chkLogToFile, "Ghi log ra file (nên bật để truy lỗi 'lúc được lúc không')");
        Check(_chkDisableGpu, "🛡 Chế độ ổn định trình duyệt (không dùng GPU — chống trang trắng)");
        chkLeft.Controls.Add(_chkPreferHeader);
        chkLeft.Controls.Add(_chkNormalizeNumbers);
        chkLeft.Controls.Add(_chkHighlightMissing);
        chkLeft.Controls.Add(_chkSelectNoHotkey);
        chkLeft.Controls.Add(_chkEnableQueue);
        chkLeft.Controls.Add(_chkLogToFile);
        chkLeft.Controls.Add(_chkDisableGpu);
        new ToolTip().SetToolTip(_chkDisableGpu,
            "NÊN BẬT nếu webview hay bị trắng / không hiện trang khi tải (máy driver đồ hoạ cũ, remote desktop).\r\n" +
            "Khởi Chromium với --disable-gpu: tải trang chậm hơn chút nhưng gần như không bao giờ trắng.\r\n" +
            "Chỉ TẮT nếu máy đồ hoạ tốt và trang bị giật. Hiệu lực khi khởi động lại phần mềm.");
        leftCol.Controls.Add(chkLeft, 0, 3);

        var rightCol = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, AutoSize = true };
        // 5 dòng đầu là các ô số (cao cố định 34px). HAI dòng cuối phải AutoSize:
        // trước đây nhóm checkbox cũng bị nhét vào dòng Absolute 34px nên 6 ô checkbox
        // chỉ hiện được ~1 ô (phần còn lại bị cắt), không cuộn được.
        for (int i = 0; i < 5; i++) rightCol.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        rightCol.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // nhóm checkbox
        rightCol.RowStyles.Add(new RowStyle(SizeType.AutoSize));   // dòng gợi ý

        Num(_numReadyTimeout, "Chờ form render tối đa (ms)", 500, 60000, 100, "Form medinet nặng nên để 6000-10000. Tăng lên nếu hay bị thiếu trường.");
        Num(_numMaxAttempts, "Số lần thử ghi lại 1 ô", 1, 10, 1, "Ô bị widget hoàn tác giá trị sẽ được ghi lại chừng này lần.");
        Num(_numMinScore, "Ngưỡng khớp nhãn (0-1000)", 0, 1000, 10, "Cao hơn = ít điền nhầm nhưng dễ bỏ sót. 380 là cân bằng.");
        Num(_numPerFieldDelay, "Nghỉ giữa 2 trường (ms)", 0, 1000, 10, "Trang chậm thì đặt 20-50 để widget kịp cập nhật.");
        Num(_numPerRowDelay, "Nghỉ giữa 2 dòng (ms)", 0, 10000, 50, "Thời gian chờ khi điền hàng loạt nhiều bệnh nhân.");

        rightCol.Controls.Add(WrapNum("Chờ form render (ms):", _numReadyTimeout), 0, 0);
        rightCol.Controls.Add(WrapNum("Số lần thử ghi lại:", _numMaxAttempts), 0, 1);
        rightCol.Controls.Add(WrapNum("Ngưỡng khớp nhãn:", _numMinScore), 0, 2);
        rightCol.Controls.Add(WrapNum("Nghỉ giữa 2 trường (ms):", _numPerFieldDelay), 0, 3);
        rightCol.Controls.Add(WrapNum("Nghỉ giữa 2 dòng (ms):", _numPerRowDelay), 0, 4);

        var chkRight = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.TopDown, WrapContents = false, AutoSize = true };
        Check(_chkOneClickFill, "⚡ Bấm ▶ Điền (F8) là TỰ ĐỌC clipboard rồi điền luôn — bỏ bước 📋 Dán");
        Check(_chkOneClickAdvance, "     Bấm ▶ Điền liên tiếp với cùng nội dung copy = sang dòng kế tiếp");
        Check(_chkFillImmediately, "Điền NGAY sau khi dán (không cần bấm nút)");
        Check(_chkAutoFillOnPaste, "Cho engine tự điền khi Ctrl+V ngay trong trang medinet");
        Check(_chkHijackCtrlV, "⚠ Giành Ctrl+V thường để dán Excel (sẽ KHÔNG dán chữ vào ô medinet được)");
        Check(_chkAllowDevTools, "Cho phép mở DevTools (F12)");
        Check(_chkOpenDevTools, "Mở DevTools ngay khi khởi động");
        Check(_chkDebugEngine, "Engine in log chi tiết ra DevTools");
        chkRight.Controls.Add(_chkOneClickFill);
        chkRight.Controls.Add(_chkOneClickAdvance);
        chkRight.Controls.Add(_chkFillImmediately);
        chkRight.Controls.Add(_chkAutoFillOnPaste);
        chkRight.Controls.Add(_chkHijackCtrlV);
        chkRight.Controls.Add(_chkAllowDevTools);
        chkRight.Controls.Add(_chkOpenDevTools);
        chkRight.Controls.Add(_chkDebugEngine);

        var hint = new Label
        {
            Dock = DockStyle.Fill,
            ForeColor = Color.DimGray,
            Text = "💡 Không chắc nên chỉnh gì? Giữ nguyên mặc định, rồi dùng tab \"Chẩn đoán\" để xem\r\n" +
                   "     dữ liệu dán được hiểu thế nào và trang medinet có những nhãn/ô nhập nào."
        };
        rightCol.Controls.Add(chkRight, 0, 5);
        rightCol.Controls.Add(hint, 0, 6);

        tbl.Controls.Add(leftCol, 0, 0);
        tbl.Controls.Add(rightCol, 1, 0);
        page.Controls.Add(tbl);
        return page;
    }

    private static void Check(CheckBox c, string text)
    {
        c.Text = text;
        c.AutoSize = true;
        c.Margin = new Padding(0, 3, 0, 3);
    }

    private static void Num(NumericUpDown n, string tooltip, int min, int max, int increment, string note)
    {
        n.Minimum = min;
        n.Maximum = max;
        n.Increment = increment;
        n.Width = 90;
        var tt = new ToolTip();
        tt.SetToolTip(n, tooltip + "\r\n" + note);
    }

    private static Panel WrapNum(string caption, NumericUpDown n)
    {
        var p = new Panel { Dock = DockStyle.Fill };
        p.Controls.Add(new Label { Text = caption, Location = new Point(0, 6), Size = new Size(190, 20) });
        n.Location = new Point(196, 3);
        p.Controls.Add(n);
        return p;
    }

    private TabPage BuildTabDiagnostics()
    {
        var page = new TabPage("Chẩn đoán");
        // Không dùng SplitContainer: gán SplitterDistance ngay lúc khởi tạo (khi control
        // chưa có kích thước thật) ném InvalidOperationException rất khó đoán.
        var split = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 2 };
        split.RowStyles.Add(new RowStyle(SizeType.Percent, 48f));
        split.RowStyles.Add(new RowStyle(SizeType.Percent, 52f));

        // --- Nửa trên: thử phân tích dữ liệu dán ---
        var top = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1 };
        top.RowStyles.Add(new RowStyle(SizeType.Absolute, 30));
        top.RowStyles.Add(new RowStyle(SizeType.Percent, 55f));
        top.RowStyles.Add(new RowStyle(SizeType.Percent, 45f));

        var topBar = new FlowLayoutPanel { Dock = DockStyle.Fill };
        topBar.Controls.Add(new Label { Text = "Dán thử dữ liệu Excel vào đây để xem phần mềm hiểu thế nào:", AutoSize = true, Margin = new Padding(0, 6, 8, 0) });
        var btnAnalyze = new Button { Text = "🔬 Phân tích", AutoSize = true };
        btnAnalyze.Click += (_, _) => AnalyzeSample();
        topBar.Controls.Add(btnAnalyze);

        _txtSample.Multiline = true;
        _txtSample.ScrollBars = ScrollBars.Both;
        _txtSample.WordWrap = false;
        _txtSample.Font = new Font("Consolas", 9f);
        _txtSample.Dock = DockStyle.Fill;
        _txtSample.PlaceholderText = "Ctrl+V dữ liệu copy từ Excel vào đây (giữ nguyên tab)...";

        _txtAnalysis.Multiline = true;
        _txtAnalysis.ReadOnly = true;
        _txtAnalysis.ScrollBars = ScrollBars.Both;
        _txtAnalysis.WordWrap = false;
        _txtAnalysis.Font = new Font("Consolas", 9f);
        _txtAnalysis.Dock = DockStyle.Fill;
        _txtAnalysis.BackColor = Color.FromArgb(250, 250, 252);

        top.Controls.Add(topBar, 0, 0);
        top.Controls.Add(_txtSample, 0, 1);
        top.Controls.Add(_txtAnalysis, 0, 2);

        // --- Nửa dưới: quét trang medinet ---
        var bottom = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1 };
        bottom.RowStyles.Add(new RowStyle(SizeType.Absolute, 34));
        bottom.RowStyles.Add(new RowStyle(SizeType.Percent, 100f));
        bottom.RowStyles.Add(new RowStyle(SizeType.Absolute, 22));

        var scanBar = new FlowLayoutPanel { Dock = DockStyle.Fill };
        scanBar.Controls.Add(new Label { Text = "Lọc nhãn:", AutoSize = true, Margin = new Padding(0, 6, 4, 0) });
        _txtScanFilter.Width = 200;
        scanBar.Controls.Add(_txtScanFilter);
        var btnScan = new Button { Text = "🔎 Quét trang medinet đang mở", AutoSize = true };
        btnScan.Click += async (_, _) => await ScanPageAsync();
        scanBar.Controls.Add(btnScan);
        var btnUse = new Button { Text = "🎯 Dùng selector cho trường đang chọn", AutoSize = true };
        btnUse.Click += (_, _) => ApplySelectedSelector();
        scanBar.Controls.Add(btnUse);

        _dgvScan.Dock = DockStyle.Fill;
        _dgvScan.AllowUserToAddRows = false;
        _dgvScan.ReadOnly = true;
        _dgvScan.RowHeadersVisible = false;
        _dgvScan.SelectionMode = DataGridViewSelectionMode.FullRowSelect;
        _dgvScan.MultiSelect = false;
        _dgvScan.AutoSizeColumnsMode = DataGridViewAutoSizeColumnsMode.Fill;
        _dgvScan.BackgroundColor = Color.White;
        _dgvScan.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Nhãn trên trang", Name = "lbl", FillWeight = 26 });
        _dgvScan.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Ô nhập engine tìm được", Name = "tgt", FillWeight = 22 });
        _dgvScan.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "Selector gợi ý (dán vào cột Selector)", Name = "sel", FillWeight = 40 });
        _dgvScan.Columns.Add(new DataGridViewTextBoxColumn { HeaderText = "id / name", Name = "idn", FillWeight = 12 });

        _lblScanInfo.Dock = DockStyle.Fill;
        _lblScanInfo.ForeColor = Color.DimGray;
        _lblScanInfo.Text = "Mở trang medinet chứa form cần điền ở cửa sổ chính, rồi bấm Quét.";

        bottom.Controls.Add(scanBar, 0, 0);
        bottom.Controls.Add(_dgvScan, 0, 1);
        bottom.Controls.Add(_lblScanInfo, 0, 2);

        split.Controls.Add(top, 0, 0);
        split.Controls.Add(bottom, 0, 1);
        page.Controls.Add(split);
        return page;
    }

    // ------------------------------------------------------- Nạp / lưu lưới
    private void LoadGlobal()
    {
        _txtDefaultUrl.Text = _config.DefaultUrl;
        _cmbPasteMode.SelectedIndex = (_config.PasteMode ?? "auto").ToLowerInvariant() switch
        {
            "tab" => 1,
            "comma" => 2,
            "semicolon" or "semi" => 3,
            _ => 0
        };
        _txtNoKeywords.Text = string.Join(";", _config.SelectNoKeywords);

        var o = _config.Options ??= new EngineOptions();
        _chkPreferHeader.Checked = o.PreferHeaderMatch;
        _chkNormalizeNumbers.Checked = o.NormalizeNumbers;
        _chkHighlightMissing.Checked = o.HighlightMissing;
        _chkSelectNoHotkey.Checked = o.EnableSelectNoHotkey;
        _chkEnableQueue.Checked = _config.EnableRowQueue;
        _chkLogToFile.Checked = _config.LogToFile;
        _chkDisableGpu.Checked = _config.DisableGpu;
        _chkOneClickFill.Checked = _config.OneClickFill;
        _chkOneClickAdvance.Checked = _config.OneClickAdvanceRows;
        _chkFillImmediately.Checked = _config.FillImmediatelyAfterPaste;
        _chkAutoFillOnPaste.Checked = o.AutoFillOnPaste;
        _chkHijackCtrlV.Checked = _config.HijackPlainCtrlV;
        _chkAllowDevTools.Checked = _config.AllowDevTools;
        _chkOpenDevTools.Checked = _config.OpenDevToolsOnStart;
        _chkDebugEngine.Checked = o.Debug;

        _numReadyTimeout.Value = Clamp(o.ReadyTimeoutMs, _numReadyTimeout);
        _numMaxAttempts.Value = Clamp(o.MaxAttempts, _numMaxAttempts);
        _numMinScore.Value = Clamp(o.MinMatchScore, _numMinScore);
        _numPerFieldDelay.Value = Clamp(o.PerFieldDelayMs, _numPerFieldDelay);
        _numPerRowDelay.Value = Clamp(o.PerRowDelayMs, _numPerRowDelay);
    }

    private static decimal Clamp(int v, NumericUpDown n) => Math.Min(n.Maximum, Math.Max(n.Minimum, v));

    private void SaveGlobal()
    {
        _config.DefaultUrl = _txtDefaultUrl.Text.Trim();
        _config.PasteMode = _cmbPasteMode.SelectedIndex switch { 1 => "tab", 2 => "comma", 3 => "semicolon", _ => "auto" };
        _config.SelectNoKeywords = SplitList(_txtNoKeywords.Text);

        var o = _config.Options ??= new EngineOptions();
        o.PreferHeaderMatch = _chkPreferHeader.Checked;
        o.NormalizeNumbers = _chkNormalizeNumbers.Checked;
        o.HighlightMissing = _chkHighlightMissing.Checked;
        o.EnableSelectNoHotkey = _chkSelectNoHotkey.Checked;
        o.AutoFillOnPaste = _chkAutoFillOnPaste.Checked;
        o.Debug = _chkDebugEngine.Checked;
        o.ReadyTimeoutMs = (int)_numReadyTimeout.Value;
        o.MaxAttempts = (int)_numMaxAttempts.Value;
        o.MinMatchScore = (int)_numMinScore.Value;
        o.PerFieldDelayMs = (int)_numPerFieldDelay.Value;
        o.PerRowDelayMs = (int)_numPerRowDelay.Value;

        _config.EnableRowQueue = _chkEnableQueue.Checked;
        _config.LogToFile = _chkLogToFile.Checked;
        _config.DisableGpu = _chkDisableGpu.Checked;
        _config.OneClickFill = _chkOneClickFill.Checked;
        _config.OneClickAdvanceRows = _chkOneClickAdvance.Checked;
        _config.FillImmediatelyAfterPaste = _chkFillImmediately.Checked;
        _config.HijackPlainCtrlV = _chkHijackCtrlV.Checked;
        _config.AllowDevTools = _chkAllowDevTools.Checked;
        _config.OpenDevToolsOnStart = _chkOpenDevTools.Checked;
    }

    private static List<string> SplitList(string s)
    {
        var outList = new List<string>();
        foreach (var part in (s ?? "").Split(new[] { ';', ',', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries))
        {
            var t = part.Trim();
            if (t.Length > 0) outList.Add(t);
        }
        return outList;
    }

    private void RefreshFormsList()
    {
        var keep = _lstForms.SelectedIndex;
        _lstForms.Items.Clear();
        foreach (var f in _config.Forms) _lstForms.Items.Add(string.IsNullOrWhiteSpace(f.Name) ? "(chưa đặt tên)" : f.Name);
        if (keep >= 0 && keep < _lstForms.Items.Count) _lstForms.SelectedIndex = keep;
    }

    private void LoadSelected()
    {
        CommitCurrent();
        if (_lstForms.SelectedIndex < 0 || _lstForms.SelectedIndex >= _config.Forms.Count)
        {
            _current = null;
            _txtName.Text = ""; _txtUrl.Text = ""; _txtUrlRegex.Text = "";
            _dgvFields.Rows.Clear();
            return;
        }
        _current = _config.Forms[_lstForms.SelectedIndex];
        _txtName.Text = _current.Name;
        _txtUrl.Text = _current.UrlContains;
        _txtUrlRegex.Text = _current.UrlRegex;
        ReloadGrid();
    }

    private void ReloadGrid()
    {
        _dgvFields.Rows.Clear();
        if (_current == null) return;
        foreach (var f in _current.Fields)
        {
            int r = _dgvFields.Rows.Add(
                f.ExcelIndex,
                string.Join(";", f.Labels),
                string.Join(";", f.HeaderNames),
                f.Selector ?? "",
                string.IsNullOrEmpty(f.ControlType) ? "text" : f.ControlType,
                f.Required);
            _dgvFields.Rows[r].Tag = f;
        }
    }

    private void CommitCurrent()
    {
        if (_current == null) return;
        _current.Name = _txtName.Text.Trim();
        _current.UrlContains = _txtUrl.Text.Trim();
        _current.UrlRegex = _txtUrlRegex.Text.Trim();
        _current.Fields = GridToFields();
        var idx = _lstForms.SelectedIndex;
        if (idx >= 0 && idx < _lstForms.Items.Count)
            _lstForms.Items[idx] = string.IsNullOrWhiteSpace(_current.Name) ? "(chưa đặt tên)" : _current.Name;
    }

    private List<FieldMapping> GridToFields()
    {
        var list = new List<FieldMapping>();
        foreach (DataGridViewRow row in _dgvFields.Rows)
        {
            if (row.IsNewRow) continue;

            int idx = int.TryParse(row.Cells[0].Value?.ToString(), out int n) ? n : row.Index;
            var labels = SplitList(row.Cells[1].Value?.ToString() ?? "").ToArray();
            var headers = SplitList(row.Cells[2].Value?.ToString() ?? "").ToArray();
            var selector = (row.Cells[3].Value?.ToString() ?? "").Trim();
            var type = (row.Cells[4].Value?.ToString() ?? "text").Trim();
            bool required = row.Cells[5].Value is bool b && b;

            // Không khai tên cột Excel riêng thì dùng nhãn để khớp tiêu đề (như engine làm).
            if (headers.Length == 0) headers = (string[])labels.Clone();
            if (labels.Length == 0 && string.IsNullOrEmpty(selector)) continue;   // dòng trống
            if (labels.Length == 0) labels = new[] { selector };

            list.Add(new FieldMapping
            {
                ExcelIndex = idx,
                Labels = labels,
                HeaderNames = headers,
                Selector = selector,
                ControlType = string.IsNullOrEmpty(type) ? "text" : type,
                Required = required,
                // Giữ lại Group nếu dòng này vốn là một FieldMapping có sẵn.
                Group = (row.Tag as FieldMapping)?.Group ?? ""
            });
        }
        return list;
    }

    // ------------------------------------------------------- Thao tác lưới
    private void AddForm()
    {
        CommitCurrent();
        _config.Forms.Add(new FormProfile { Name = "Form mới " + (_config.Forms.Count + 1) });
        RefreshFormsList();
        _lstForms.SelectedIndex = _config.Forms.Count - 1;
    }

    private void DuplicateForm()
    {
        CommitCurrent();
        if (_current == null) return;
        var copy = AppJson.DeepClone(_current);
        copy.Id = Guid.NewGuid().ToString("N");
        copy.Name = _current.Name + " (bản sao)";
        _config.Forms.Add(copy);
        RefreshFormsList();
        _lstForms.SelectedIndex = _config.Forms.Count - 1;
    }

    private void RemoveForm()
    {
        int i = _lstForms.SelectedIndex;
        if (i < 0 || i >= _config.Forms.Count) return;
        if (MessageBox.Show($"Xóa form '{_config.Forms[i].Name}' và { _config.Forms[i].Fields.Count } trường của nó?",
                "Xác nhận", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;

        _current = null;
        _config.Forms.RemoveAt(i);
        RefreshFormsList();
        _lstForms.SelectedIndex = _config.Forms.Count > 0 ? Math.Min(i, _config.Forms.Count - 1) : -1;
        if (_lstForms.SelectedIndex < 0) { _txtName.Text = ""; _txtUrl.Text = ""; _txtUrlRegex.Text = ""; _dgvFields.Rows.Clear(); }
    }

    private void AddFieldRow()
    {
        if (_current == null)
        {
            if (_config.Forms.Count == 0) AddForm();
            if (_lstForms.SelectedIndex < 0) _lstForms.SelectedIndex = 0;
            if (_current == null) return;
        }
        int idx = _dgvFields.Rows.Count;
        _dgvFields.Rows.Add(idx, "", "", "", "text", false);
        if (_dgvFields.RowCount > 0)
        {
            _dgvFields.ClearSelection();
            _dgvFields.Rows[_dgvFields.RowCount - 1].Selected = true;
            _dgvFields.FirstDisplayedScrollingRowIndex = _dgvFields.RowCount - 1;
        }
    }

    private void RemoveFieldRows()
    {
        if (_dgvFields.CurrentRow == null) return;
        var row = _dgvFields.CurrentRow;
        int i = row.Index;
        _dgvFields.Rows.Remove(row);
        RenumberColumns(silent: true);
        if (_dgvFields.Rows.Count > 0)
            _dgvFields.Rows[Math.Min(i, _dgvFields.Rows.Count - 1)].Selected = true;
    }

    private void MoveFieldRow(int delta)
    {
        if (_dgvFields.CurrentRow == null) return;
        int i = _dgvFields.CurrentRow.Index;
        int j = i + delta;
        if (j < 0 || j >= _dgvFields.Rows.Count) return;

        var values = new object[_dgvFields.Columns.Count];
        for (int c = 0; c < values.Length; c++) values[c] = _dgvFields.Rows[i].Cells[c].Value ?? "";
        var tag = _dgvFields.Rows[i].Tag;

        _dgvFields.Rows.RemoveAt(i);
        _dgvFields.Rows.Insert(j, values);
        _dgvFields.Rows[j].Tag = tag;
        RenumberColumns(silent: true);
        _dgvFields.ClearSelection();
        _dgvFields.Rows[j].Selected = true;
        _dgvFields.CurrentCell = _dgvFields.Rows[j].Cells[0];
    }

    private void RenumberColumns(bool silent = false)
    {
        for (int r = 0; r < _dgvFields.Rows.Count; r++) _dgvFields.Rows[r].Cells[0].Value = r;
        if (!silent) SetAnalysis("Đã đánh số lại 'Cột Excel' = 0.." + Math.Max(0, _dgvFields.Rows.Count - 1));
    }

    // ------------------------------------------------------- Quét trang
    private async void PickSelectorForSelectedField()
    {
        await ScanPageAsync(applyToSelector: true);
    }

    private async Task ScanPageAsync(bool applyToSelector = false)
    {
        if (_scanPage == null)
        {
            MessageBox.Show(
                "Chức năng quét trang chỉ dùng được khi mở Cài đặt từ cửa sổ chính.\r\n" +
                "Hãy mở trang medinet chứa form cần điền ở cửa sổ chính trước, rồi vào lại đây.",
                "Chưa kết nối tới trang", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        _lblScanInfo.Text = "Đang quét trang...";
        string? json;
        try
        {
            json = await _scanPage(string.IsNullOrWhiteSpace(_txtScanFilter.Text) ? null : _txtScanFilter.Text.Trim());
        }
        catch (Exception ex)
        {
            _lblScanInfo.Text = "Lỗi khi quét: " + ex.Message;
            return;
        }

        ScanResult? scan = null;
        if (!string.IsNullOrWhiteSpace(json))
        {
            try { scan = JsonSerializer.Deserialize<ScanResult>(json, JsonOpts.Loose); }
            catch (Exception ex) { _lblScanInfo.Text = "Không đọc được kết quả quét: " + ex.Message; return; }
        }

        if (scan == null)
        {
            _lblScanInfo.Text = "Không quét được. Kiểm tra trang medinet đã tải xong chưa.";
            return;
        }
        if (!string.IsNullOrEmpty(scan.Error))
        {
            _lblScanInfo.Text = "Engine báo lỗi: " + scan.Error;
            return;
        }

        _dgvScan.Rows.Clear();
        int withTarget = 0;
        foreach (var item in scan.Items)
        {
            int r = _dgvScan.Rows.Add(
                item.Label,
                item.Target?.Describe() ?? "(không tìm được ô nhập)",
                item.Target?.Selector ?? "",
                (item.Target?.Id ?? "") + (string.IsNullOrEmpty(item.Target?.Name) ? "" : " / " + item.Target?.Name));
            _dgvScan.Rows[r].Tag = item;
            if (item.Target != null) withTarget++;
            else _dgvScan.Rows[r].DefaultCellStyle.ForeColor = Color.Firebrick;
        }

        _lblScanInfo.Text = $"Quét được {scan.Count} nhãn, {withTarget} nhãn có ô nhập kề bên. URL: {scan.Url}";

        if (applyToSelector)
        {
            if (_dgvScan.Rows.Count == 0)
            {
                MessageBox.Show("Không thấy nhãn nào trên trang. Hãy mở đúng trang có form cần điền.",
                    "Không có kết quả", MessageBoxButtons.OK, MessageBoxIcon.Information);
                return;
            }
            _tabs.SelectedIndex = 2;   // nhảy sang tab Chẩn đoán để chọn nhãn
            _lblScanInfo.Text += " — chọn 1 dòng ở bảng dưới rồi bấm '🎯 Dùng selector cho trường đang chọn'.";
        }
    }

    private void ApplySelectedSelector()
    {
        if (_dgvScan.CurrentRow?.Tag is not ScanItem item || item.Target == null)
        {
            MessageBox.Show("Hãy chọn một dòng CÓ ô nhập ở bảng quét trang.", "Chưa chọn", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }
        if (_dgvFields.CurrentRow == null)
        {
            MessageBox.Show("Hãy chọn trường cần gán selector ở tab 'Form & Trường dữ liệu' trước.",
                "Chưa chọn trường", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        var selector = item.Target.Selector ?? "";
        if (string.IsNullOrEmpty(selector))
        {
            MessageBox.Show("Không sinh được selector cho ô nhập này.", "Không có selector", MessageBoxButtons.OK, MessageBoxIcon.Information);
            return;
        }

        // Nếu người dùng đang ở tab Chẩn đoán thì ô "trường đang chọn" là của tab Form;
        // ta vẫn ghi được vì DataGridView giữ nguyên CurrentRow khi đổi tab.
        _dgvFields.CurrentRow.Cells[3].Value = selector;
        if (string.IsNullOrWhiteSpace(_dgvFields.CurrentRow.Cells[1].Value?.ToString()))
            _dgvFields.CurrentRow.Cells[1].Value = item.Label;

        _lblScanInfo.Text = $"Đã gán selector '{selector}' cho trường dòng {_dgvFields.CurrentRow.Index + 1}. Đừng quên bấm 💾 Lưu.";
    }

    // ------------------------------------------------------- Phân tích dữ liệu mẫu
    private void AnalyzeSample()
    {
        CommitCurrent();
        var fields = _current?.Fields ?? new List<FieldMapping>();
        if (fields.Count == 0)
        {
            SetAnalysis("Chưa có form/trường nào được chọn để đối chiếu.\r\nChọn một form ở tab 'Form & Trường dữ liệu' rồi thử lại.");
            return;
        }

        var sample = _txtSample.Text ?? "";
        if (string.IsNullOrWhiteSpace(sample))
        {
            SetAnalysis("Hãy dán dữ liệu mẫu (copy từ Excel) vào ô phía trên rồi bấm Phân tích.");
            return;
        }

        char? delim = (_config.PasteMode ?? "auto").ToLowerInvariant() switch
        {
            "tab" => '\t',
            "comma" => ',',
            "semicolon" or "semi" => ';',
            _ => null
        };

        var table = TsvParser.Parse(sample, delim);
        table.HeaderRowIndex = TsvParser.DetectHeaderRow(table, fields);
        var map = TsvParser.ResolveColumns(fields, table.HeaderRow);

        var sb = new StringBuilder();
        sb.AppendLine($"Form đối chiếu : {_current!.Name}  ({fields.Count} trường)");
        sb.AppendLine($"Kích thước     : {table.RowCount} dòng × {table.ColCount} cột");
        sb.AppendLine($"Ký tự phân cách: '{ShowDelim(table.Delimiter)}'" + (delim == null ? "  (tự nhận)" : "  (do cấu hình chỉ định)"));
        sb.AppendLine($"Có nháy kép    : {(table.HasQuotes ? "có (đã parse kiểu CSV, giữ được ô nhiều dòng)" : "không")}");
        sb.AppendLine($"Dòng tiêu đề   : {(table.HasHeader ? "dòng " + (table.HeaderRowIndex + 1) : "KHÔNG có — sẽ dùng vị trí cột (ExcelIndex)")}");
        sb.AppendLine($"Dòng dữ liệu đầu: {table.FirstDataRow + 1}");
        sb.AppendLine();
        sb.AppendLine("CỘT  | TRƯỜNG (nhãn đầu tiên)                 | GIÁ TRỊ DÒNG ĐẦU TIÊN");
        sb.AppendLine(new string('-', 96));

        int matched = 0, blank = 0;
        var firstRow = table.Row(table.FirstDataRow);
        for (int i = 0; i < fields.Count; i++)
        {
            int col = map[i];
            string val = (col >= 0 && col < firstRow.Length) ? firstRow[col] : "(không có cột này)";
            string via = col >= 0 ? (table.HasHeader ? "tiêu đề" : "vị trí") : "—";
            if (string.IsNullOrWhiteSpace(val)) blank++; else matched++;
            sb.AppendLine($"{col,4} | {Trunc(fields[i].DisplayName, 38),-38} | {Trunc(val, 40),-40} [{via}]");
        }

        sb.AppendLine();
        sb.AppendLine($"Tổng kết: {matched} trường có dữ liệu, {blank} trường trống/không có cột.");
        if (!table.HasHeader)
            sb.AppendLine("⚠ Không nhận diện được tiêu đề: nếu file Excel của bạn CÓ dòng tiêu đề mà phần mềm không nhận ra,");
        if (!table.HasHeader)
            sb.AppendLine("  hãy khai thêm 'Tên cột trong Excel' cho từng trường (giống hệt tiêu đề trong file).");
        if (matched == 0)
            sb.AppendLine("⚠ Không trường nào có dữ liệu — khả năng cao là copy sai vùng, hoặc thứ tự cột khác với khai báo.");

        SetAnalysis(sb.ToString());
    }

    private static string Trunc(string s, int max) => s.Length <= max ? s : s.Substring(0, max - 1) + "…";
    private static string ShowDelim(char d) => d switch { '\t' => "TAB", ';' => ";", ',' => ",", _ => d.ToString() };

    private void SetAnalysis(string text) => _txtAnalysis.Text = text;

    // ------------------------------------------------------- Nhập / xuất / lưu
    private void ExportConfig()
    {
        CommitCurrent();
        SaveGlobal();
        using var dlg = new SaveFileDialog
        {
            Filter = "File JSON (*.json)|*.json",
            FileName = "medical-autofill-config.json",
            Title = "Xuất cấu hình"
        };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;
        if (ConfigRepository.Export(_config, dlg.FileName, out var err))
            MessageBox.Show("Đã xuất cấu hình ra:\r\n" + dlg.FileName, "Thành công", MessageBoxButtons.OK, MessageBoxIcon.Information);
        else
            MessageBox.Show("Không xuất được: " + err, "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error);
    }

    private void ImportConfig()
    {
        using var dlg = new OpenFileDialog { Filter = "File JSON (*.json)|*.json", Title = "Nhập cấu hình" };
        if (dlg.ShowDialog(this) != DialogResult.OK) return;

        var cfg = ConfigRepository.Import(dlg.FileName, out var err);
        if (cfg == null)
        {
            MessageBox.Show("Không nhập được: " + err, "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }
        var answer = MessageBox.Show(
            $"File có {cfg.Forms.Count} form.\r\n\r\n" +
            "YES = GHI ĐÈ toàn bộ cấu hình hiện tại\r\n" +
            "NO  = GỘP thêm các form trong file vào cấu hình hiện tại\r\n" +
            "Cancel = bỏ qua",
            "Nhập cấu hình", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
        if (answer == DialogResult.Cancel) return;
        bool overwrite = answer == DialogResult.Yes;

        if (overwrite)
        {
            _config.DefaultUrl = cfg.DefaultUrl;
            _config.PasteMode = cfg.PasteMode;
            _config.SelectNoKeywords = cfg.SelectNoKeywords;
            _config.Forms = cfg.Forms;
            _config.Options = cfg.Options ?? new EngineOptions();
        }
        else
        {
            foreach (var f in cfg.Forms)
            {
                f.Id = Guid.NewGuid().ToString("N");
                f.Name += " (nhập)";
                _config.Forms.Add(f);
            }
        }

        LoadGlobal();
        RefreshFormsList();
        _current = null;
        _lstForms.SelectedIndex = _config.Forms.Count > 0 ? 0 : -1;
    }

    private void ResetToDefault()
    {
        if (MessageBox.Show("Khôi phục toàn bộ cấu hình về mặc định? Các thay đổi hiện tại sẽ bị ghi đè.",
                "Xác nhận", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes) return;

        var fresh = AppJson.DeepClone(ConfigRepository.CreateDefault());
        _config.DefaultUrl = fresh.DefaultUrl;
        _config.PasteMode = fresh.PasteMode;
        _config.SelectNoKeywords = fresh.SelectNoKeywords;
        _config.Forms = fresh.Forms;

        LoadGlobal();
        RefreshFormsList();
        _current = null;
        _lstForms.SelectedIndex = _config.Forms.Count > 0 ? 0 : -1;
    }

    private void SaveAndClose()
    {
        CommitCurrent();
        SaveGlobal();

        // Rà soát trước khi lưu: cảnh báo những lỗi cấu hình hay gặp.
        var problems = new List<string>();
        foreach (var f in _config.Forms)
        {
            if (string.IsNullOrWhiteSpace(f.Name)) problems.Add("Có một form chưa đặt tên.");
            if (string.IsNullOrWhiteSpace(f.UrlContains) && string.IsNullOrWhiteSpace(f.UrlRegex))
                problems.Add($"Form '{f.Name}' chưa khai 'URL chứa' — phần mềm sẽ không tự nhận diện được form này.");
            var seenCols = new HashSet<int>();
            foreach (var m in f.Fields)
            {
                if (m.Labels.Length == 0 && string.IsNullOrWhiteSpace(m.Selector))
                    problems.Add($"Form '{f.Name}': có trường trống cả nhãn lẫn selector (cột {m.ExcelIndex}).");
                if (!string.IsNullOrWhiteSpace(m.Selector) && !m.Selector.Contains('#') && !m.Selector.Contains('.') && !m.Selector.Contains('['))
                    problems.Add($"Form '{f.Name}': selector '{m.Selector}' trông không hợp lệ (thường bắt đầu bằng #, . hoặc [).");
                if (!seenCols.Add(m.ExcelIndex) && string.IsNullOrWhiteSpace(m.Selector))
                    problems.Add($"Form '{f.Name}': cột Excel {m.ExcelIndex} bị khai báo 2 lần — 2 trường sẽ giành nhau 1 cột dữ liệu.");
            }
        }

        if (problems.Count > 0)
        {
            var sb = new StringBuilder("Phát hiện một số điểm cần kiểm tra:\r\n\r\n");
            for (int i = 0; i < Math.Min(10, problems.Count); i++) sb.AppendLine("• " + problems[i]);
            if (problems.Count > 10) sb.AppendLine($"• ...và {problems.Count - 10} điểm khác");
            sb.AppendLine("\r\nVẫn lưu chứ?");
            if (MessageBox.Show(sb.ToString(), "Kiểm tra cấu hình", MessageBoxButtons.YesNo, MessageBoxIcon.Warning) != DialogResult.Yes)
                return;
        }

        if (!ConfigRepository.TrySave(_config, out var error))
        {
            MessageBox.Show("Không ghi được file cấu hình:\r\n" + error +
                            "\r\n\r\nĐường dẫn: " + ConfigRepository.ConfigPath,
                "Lỗi", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        DialogResult = DialogResult.OK;
        Close();
    }
}
