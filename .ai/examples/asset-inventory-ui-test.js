// UI test GĐ2 (Playwright): danh sách kiểm kê, chi tiết, quét, báo cáo, lịch bảo trì, thiết kế biên bản
// NODE_PATH=/tmp/pw/node_modules node .ai/examples/asset-inventory-ui-test.js
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.WEB ?? 'http://localhost:3000';
const SHOTS = '/tmp/shots-gd2';
fs.mkdirSync(SHOTS, { recursive: true });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, ignoreHTTPSErrors: true })).newPage();
  page.on('console', (m) => {
    if (m.type() === 'error' && !/favicon|BarcodeDetector|getUserMedia/.test(m.text())) errors.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${String(e).slice(0, 200)}`));

  const login = async () => {
    await page.goto(`${BASE}/login`);
    const i = page.locator('input');
    await i.nth(0).fill('admin');
    await i.nth(1).fill('Admin@123');
    await page.keyboard.press('Enter');
    await sleep(3000);
  };
  const shot = (name) => page.screenshot({ path: `${SHOTS}/${name}.png`, fullPage: false });
  const check = (name, ok, extra = '') => console.log(ok ? '  ✔' : '  ✘', name, ok ? '' : extra);

  await login();

  // Danh sách đợt kiểm kê
  await page.goto(`${BASE}/tai-san/kiem-ke`);
  await page.waitForSelector('text=Kiểm kê tài sản', { timeout: 10_000 });
  await sleep(1200);
  check('cards đợt kiểm kê hiển thị', (await page.locator('.rounded .border, [role=link]').count()) >= 1);
  await shot('01-danh-sach');

  // Chi tiết đợt đang kiểm kê
  await page.goto(`${BASE}/tai-san/kiem-ke/2`);
  await sleep(1500);
  check('chi tiết: thẻ số liệu', await page.locator('text=Theo sổ sách').first().isVisible());
  check('chi tiết: nút Quét mã', await page.locator('text=Quét mã').first().isVisible());
  check('chi tiết: bảng kết quả', (await page.locator('tbody tr').count()) > 0);
  await shot('02-chi-tiet');

  // Lọc kết quả
  await page.locator('select').nth(1).selectOption('PENDING').catch(() => {});
  await sleep(800);
  await shot('03-loc-chua-kiem');

  // Trang quét (không camera trong headless nhưng UI phải load)
  await page.goto(`${BASE}/tai-san/kiem-ke/2/quet`);
  await sleep(1500);
  check('trang quét hiển thị ô nhập', await page.locator('input[placeholder*="Quét mã"], input[placeholder*="gõ mã"]').isVisible());
  // Quét thử một mã còn thiếu
  await page.locator('form input').fill('MT.2025.0061').catch(() => {});
  await page.keyboard.press('Enter');
  await sleep(1800);
  check('quét cập nhật tiến độ', await page.locator('text=/tài sản trong sổ|mã khác nhau|Đã ghi/').first().isVisible());
  await shot('04-quet');

  // Báo cáo
  await page.goto(`${BASE}/tai-san/bao-cao?k=so-tai-san`);
  await sleep(2000);
  check('báo cáo: thẻ tóm tắt', (await page.locator('text=Số tài sản').count()) >= 1);
  check('báo cáo: bảng có dòng nhóm', (await page.locator('text=Cộng ').count()) > 0);
  await shot('05-bao-cao-so');
  await page.goto(`${BASE}/tai-san/bao-cao?k=tang-giam`);
  await sleep(2000);
  check('tăng giảm: tổng kết', await page.locator('text=TỔNG CỘNG').first().isVisible());
  await shot('06-bao-cao-tanggiam');

  // Lịch bảo trì
  await page.goto(`${BASE}/tai-san/bao-tri`);
  await sleep(1500);
  check('lịch: ô tháng', await page.getByRole('button', { name: 'Hôm nay' }).isVisible());
  check('lịch: danh sách sự kiện', (await page.locator('text=/KĐ:|BD:|BH:/').count()) >= 1);
  await shot('07-bao-tri');

  // Biểu mẫu lập đợt
  await page.goto(`${BASE}/tai-san/kiem-ke`);
  await sleep(800);
  await page.getByRole('button', { name: /Lập đợt kiểm kê/ }).first().click();
  await sleep(700);
  await sleep(900);
  const dlg = page.locator('div[role="dialog"]');
  check('form: phạm vi + hội đồng', (await page.locator('text=/Phạm vi kiểm kê/').count()) > 0 && (await page.locator('text=/Thành phần hội đồng/').count()) > 0);
  await dlg.locator('input').first().fill('Kiểm kê thử UI');
  await page.getByRole('button', { name: /Đếm tài sản/ }).click();
  await sleep(1500);
  check('form: đếm trước phạm vi', (await dlg.locator('.bg-teal-50').count()) > 0);
  await shot('08-lap-dot');
  await page.keyboard.press('Escape');

  // Dashboard tổng quan vẫn ổn
  await page.goto(`${BASE}/tai-san`);
  await sleep(1500);
  check('dashboard tải không lỗi', await page.locator('text=Tổng quan tài sản').isVisible());
  await shot('09-dashboard');

  // Trình thiết kế biên bản mở được
  await page.goto(`${BASE}/quan-tri/mau-in`);
  await sleep(1500);
  check('danh sách mẫu có biên bản kiểm kê', (await page.locator('text=/Biên bản kiểm kê/').count()) > 0);
  await shot('10-mau-in');

  console.log('\nLỗi console/page:', errors.length ? errors : 'không có');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
})();
