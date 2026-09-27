# Font nhúng trong bản in PDF

| Tệp | Họ font | Thay thế tương thích cho | Giấy phép |
|---|---|---|---|
| `Tinos-*.ttf` | Tinos | **Times New Roman** (cùng metric — cùng độ rộng từng ký tự, bố cục không lệch) | SIL Open Font License 1.1 |
| `Arimo-*.ttf` | Arimo | Arial (cùng metric) | SIL Open Font License 1.1 |
| `Cousine-*.ttf` | Cousine | Courier New (cùng metric) | SIL Open Font License 1.1 |
| `Roboto-*.ttf` | Roboto | — | Apache License 2.0 |

Nguồn Tinos/Arimo/Cousine: ChromeOS core fonts © 2010–2020 Google Inc./Google LLC (gói Debian
`fonts-croscore` 20201225) — SIL Open Font License 1.1, nguyên văn trong `OFL.txt`.
Roboto: © Google — Apache License 2.0.

Font Times New Roman gốc của Microsoft **không được phép phân phối kèm phần mềm**. Nếu muốn dùng
đúng font gốc, quản trị viên tải các tệp `times.ttf`, `timesbd.ttf`, `timesi.ttf`, `timesbi.ttf`
(lấy từ `C:\Windows\Fonts` trên máy có bản quyền Windows) lên tại
**Quản trị → Thiết kế bản in → Font chữ**. Hệ thống tự nhận diện họ font trong tệp và ưu tiên dùng
font gốc thay cho Tinos.
