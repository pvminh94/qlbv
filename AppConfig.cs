using System.Text.Json;
using System.Text.Json.Serialization;

namespace MedicalAutoFillTool;

/// <summary>Ánh xạ giữa 1 cột dữ liệu (Excel) và 1 trường nhập trên web.</summary>
public class FieldMapping
{
    /// <summary>Chỉ số cột trong bảng tính / clipboard (bắt đầu từ 0). Dùng khi KHÔNG có dòng tiêu đề.</summary>
    public int ExcelIndex { get; set; }

    /// <summary>
    /// Một hoặc nhiều nhãn (label) khả dĩ trên web để tìm ô nhập.
    /// Phần mềm thử từng nhãn; nhiều nhãn thì web đổi tên vẫn hoạt động.
    /// </summary>
    public string[] Labels { get; set; } = Array.Empty<string>();

    /// <summary>
    /// TÊN CỘT trong file Excel (vd "Huyết sắc tố (g/dL)", "So luong HC").
    /// Khi khối dán CÓ dòng tiêu đề, engine khớp theo tên cột thay vì vị trí,
    /// nên copy thiếu/thừa/đảo cột vẫn điền đúng. Đây là điểm bản cũ không có
    /// (chỉ dùng ExcelIndex cố định -> lệch cột là sai hết).
    /// Nếu để trống sẽ tự dùng Labels để khớp tiêu đề.
    /// </summary>
    public string[] HeaderNames { get; set; } = Array.Empty<string>();

    /// <summary>
    /// CSS selector chỉ định thẳng ô nhập (vd "#txtHoTen", ".dx-field:nth-of-type(3) input").
    /// Khi có selector, engine dùng ngay và bỏ qua mọi suy đoán — chính xác tuyệt đối.
    /// Bấm nút "Quét trang" trong Cài đặt để lấy selector gợi ý.
    /// </summary>
    public string Selector { get; set; } = "";

    /// <summary>Loại điều khiển: auto | text | textarea | number | date | select | checkbox | radio.</summary>
    public string ControlType { get; set; } = "text";

    /// <summary>Đánh dấu trường bắt buộc: thiếu dữ liệu sẽ được cảnh báo trong báo cáo.</summary>
    public bool Required { get; set; }

    /// <summary>Biến đổi giá trị trước khi điền: "" | trim | upper | lower | date | number.</summary>
    public string Transform { get; set; } = "";

    /// <summary>Nhóm trường (chỉ để hiển thị/gom trong giao diện Cài đặt).</summary>
    public string Group { get; set; } = "";

    /// <summary>Tên viết tắt dùng trong báo cáo; mặc định lấy nhãn đầu tiên.</summary>
    [JsonIgnore]
    public string DisplayName => Labels.Length > 0 ? Labels[0] : ("Cột " + ExcelIndex);
}

/// <summary>Một "form" (mẫu biểu) trên web, được nhận diện qua chuỗi URL.</summary>
public class FormProfile
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string Name { get; set; } = "Form mới";

    /// <summary>Nếu URL trang đang mở chứa chuỗi này thì form này được coi là active.</summary>
    public string UrlContains { get; set; } = "";

    /// <summary>Biểu thức chính quy để nhận diện URL (ưu tiên cao hơn UrlContains khi khớp dài hơn).</summary>
    public string UrlRegex { get; set; } = "";

    public List<FieldMapping> Fields { get; set; } = new();

    public override string ToString() => Name;
}

/// <summary>
/// Tham số vận hành của engine JavaScript. Các tên này PHẢI khớp với DEFAULTS
/// trong Shared/maf-engine.js (engine chỉ nhận đúng những khóa nó biết).
/// </summary>
public class EngineOptions
{
    /// <summary>Ưu tiên khớp cột theo tiêu đề Excel trước, rơi về ExcelIndex.</summary>
    public bool PreferHeaderMatch { get; set; } = true;

    /// <summary>Ngưỡng điểm khớp nhãn tối thiểu (0-1000). Tăng lên nếu hay điền nhầm ô.</summary>
    public int MinMatchScore { get; set; } = 380;

    /// <summary>Chờ form render xong tối đa (ms) trước khi điền. Form medinet nặng nên để 8000.</summary>
    public int ReadyTimeoutMs { get; set; } = 8000;

    /// <summary>Chu kỳ kiểm tra lại DOM khi chờ (ms).</summary>
    public int ReadyPollMs { get; set; } = 120;

    /// <summary>Số lần thử ghi lại một ô bị widget hoàn tác.</summary>
    public int MaxAttempts { get; set; } = 3;

    /// <summary>Nghỉ giữa 2 lần thử (ms).</summary>
    public int RetryDelayMs { get; set; } = 250;

    /// <summary>Nghỉ giữa 2 trường (ms). Đặt 10-30 nếu trang medinet chậm cập nhật.</summary>
    public int PerFieldDelayMs { get; set; } = 0;

    /// <summary>Nghỉ giữa 2 dòng khi điền hàng loạt (ms).</summary>
    public int PerRowDelayMs { get; set; } = 400;

    /// <summary>Cho phép engine tự điền khi người dùng Ctrl+V ngay trong trang medinet.</summary>
    public bool AutoFillOnPaste { get; set; } = false;

    /// <summary>Ctrl+B = chọn "Không" hàng loạt.</summary>
    public bool EnableSelectNoHotkey { get; set; } = true;

    /// <summary>Chuẩn hoá số kiểu Việt Nam (1.234,5 -&gt; 1234.5) trước khi điền.</summary>
    public bool NormalizeNumbers { get; set; } = true;

    /// <summary>Tô vàng những nhãn không tìm thấy ô nhập để người dùng sửa mapping.</summary>
    public bool HighlightMissing { get; set; } = true;

    /// <summary>Thời gian giữ khung tô vàng (ms).</summary>
    public int HighlightMs { get; set; } = 6000;

    /// <summary>In log chi tiết ra DevTools của trang (F12).</summary>
    public bool Debug { get; set; } = false;
}

/// <summary>Toàn bộ cấu hình của tiện ích, đọc/ghi dưới dạng JSON.</summary>
public class AppConfig
{
    public string DefaultUrl { get; set; } = "https://quanlyskcd.medinet.org.vn/account/login";

    /// <summary>"auto" | "tab" | "comma" | "semicolon" — cách tách cột khi dán.</summary>
    public string PasteMode { get; set; } = "auto";

    /// <summary>Các từ tương ứng với "Chọn Không" khi bấm Ctrl+B.</summary>
    public List<string> SelectNoKeywords { get; set; } = new()
    {
        "không", "hầu như không", "không nhớ rõ", "không có", "bình thường", "không rõ"
    };

    public List<FormProfile> Forms { get; set; } = new();

    /// <summary>Tham số engine điền form.</summary>
    public EngineOptions Options { get; set; } = new();

    // ---------------- Trải nghiệm người dùng (chỉ phía C#, engine không dùng) ----------------

    /// <summary>Tự mở bảng dữ liệu dán khi bấm Ctrl+Shift+V.</summary>
    public bool ShowPastePanelOnPaste { get; set; } = true;

    /// <summary>Tự điền ngay sau khi dán (không cần bấm thêm nút). Tắt để an toàn.</summary>
    public bool FillImmediatelyAfterPaste { get; set; } = false;

    /// <summary>
    /// ĐIỀN MỘT CHẠM (mặc định BẬT) — bỏ bớt bước "📋 Dán".
    /// Quy trình chỉ còn: copy trong Excel -> bấm "▶ Điền" (hoặc F8) -> xong.
    /// Nút "▶ Điền" sẽ TỰ ĐỌC CLIPBOARD, phân tích bảng rồi điền luôn, không mở
    /// bảng xem trước.
    ///
    /// An toàn: nếu clipboard KHÔNG đọc được hoặc không phải dữ liệu bảng (lỡ copy
    /// một đoạn chữ), app quay về hành vi cũ — điền dòng đang chọn của bảng đã dán —
    /// nên không bao giờ mất dữ liệu đang làm chỉ vì clipboard đổi sang thứ khác.
    ///
    /// TẮT tùy chọn này thì "▶ Điền" chỉ điền dòng đang chọn, y như bản trước.
    /// </summary>
    public bool OneClickFill { get; set; } = true;

    /// <summary>
    /// Khi copy NGUYÊN MỘT KHỐI nhiều dòng rồi bấm "▶ Điền" LIÊN TIẾP mà không copy
    /// lại: mỗi lần bấm sang dòng KẾ TIẾP (điền lần lượt từng bệnh nhân, tới dòng
    /// cuối thì quay về dòng đầu). Copy nội dung MỚI thì bắt đầu lại từ dòng đầu.
    /// TẮT đi thì lần nào cũng điền dòng đầu của khối vừa copy.
    /// </summary>
    public bool OneClickAdvanceRows { get; set; } = true;

    /// <summary>Điền liên tiếp các dòng trong bảng (hàng đợi) khi bấm "Điền tất cả".</summary>
    public bool EnableRowQueue { get; set; } = true;

    /// <summary>Mở DevTools của WebView2 khi khởi động (để dò mapping).</summary>
    public bool OpenDevToolsOnStart { get; set; } = false;

    /// <summary>Cho phép F12 mở DevTools.</summary>
    public bool AllowDevTools { get; set; } = true;

    /// <summary>Ghi log ra file trong thư mục logs/.</summary>
    public bool LogToFile { get; set; } = true;

    /// <summary>Chặn Ctrl+V mặc định của trang để tự điền (CHỈ bật nếu bạn không cần dán chữ vào medinet).</summary>
    public bool HijackPlainCtrlV { get; set; } = false;

    /// <summary>
    /// CHẾ ĐỘ ỔN ĐỊNH TRÌNH DUYỆT (mặc định BẬT): khởi Chromium với --disable-gpu
    /// (không dùng card đồ hoạ để ghép hình).
    ///
    /// Máy văn phòng có driver đồ hoạ cũ — hoặc chạy qua remote desktop — hay gặp
    /// tiến trình render của WebView2 chết giữa chừng khiến trang TRẮNG, và "lúc được
    /// lúc không" theo trạng thái máy. Tắt GPU thì trang tải chậm hơn một chút nhưng
    /// gần như không bao giờ trắng.
    ///
    /// Chỉ TẮT nếu bạn chắc máy đồ hoạ tốt và trang bị giật. Hiệu lực: khởi động lại.
    /// </summary>
    public bool DisableGpu { get; set; } = true;

    /// <summary>Phím tắt điền dòng đang chọn.</summary>
    public string HotkeyFill { get; set; } = "Ctrl+Enter";

    /// <summary>Phím tắt dán từ clipboard hệ thống.</summary>
    public string HotkeyPasteFill { get; set; } = "Ctrl+Shift+V";

    /// <summary>Phím tắt điền dòng kế tiếp trong hàng đợi.</summary>
    public string HotkeyNextRow { get; set; } = "F9";

    /// <summary>Phím tắt kiểm tra mapping (không ghi dữ liệu).</summary>
    public string HotkeyDryRun { get; set; } = "F10";

    /// <summary>Phiên bản cấu hình, để sau này tự động di dời định dạng cũ.</summary>
    public int ConfigVersion { get; set; } = 2;
}

/// <summary>Dùng chung cho việc đọc/ghi JSON và sinh script (đồng bộ tên thuộc tính camelCase).</summary>
public static class AppJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        // Thuộc tính chỉ đọc (DisplayName) không được ghi ra file.
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    /// <summary>
    /// JSON compact để nhúng vào JavaScript.
    /// QUAN TRỌNG: giữ bộ escape MẶC ĐỊNH của System.Text.Json (nó thoát &lt; &gt; &amp; ' ")
    /// nên dữ liệu bệnh nhân có chứa "&lt;/script&gt;" cũng không phá được đoạn script.
    /// </summary>
    public static string SerializeForScript(object value)
    {
        var opts = new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false
        };
        return JsonSerializer.Serialize(value, opts);
    }

    /// <summary>Copy sâu bằng JSON — dùng để "Hủy" trong Cài đặt không làm hỏng bản gốc.</summary>
    public static T DeepClone<T>(T value) where T : new()
    {
        var json = JsonSerializer.Serialize(value, Options);
        return JsonSerializer.Deserialize<T>(json, Options) ?? new T();
    }
}
