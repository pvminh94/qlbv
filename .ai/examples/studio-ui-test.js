/**
 * Kiểm thử giao diện Studio (GĐ3a): dashboard canvas, kéo-thả, cấu hình ô,
 * tạo báo cáo tùy biến, realtime dot.
 * Chạy:  NODE_PATH=/tmp/pw/node_modules node .ai/examples/studio-ui-test.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const SHOTS = '/tmp/shots-gd3a';
fs.mkdirSync(SHOTS, { recursive: true });

let step = 0;
const results = [];
async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png`, fullPage: false });
}
function pass(name) { results.push(['PASS', name]); console.log(`  ✔ ${name}`); }
function fail(name, err) { results.push(['FAIL', name, String(err)]); console.log(`  ✘ ${name}: ${err}`); }

async function login(page) {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill('admin');
  await page.locator('input').nth(1).fill('Admin@123');
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 15000 });
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  const consoleErrors = [];
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push(String(e)));

  try {
    /* 1. Dashboard canvas hiển thị đủ ô hệ thống */
    await login(page);
    await page.waitForSelector('[data-testid="studio-canvas"]', { timeout: 15000 });
    const kpiCount = await page.locator('[data-widget-id^="kpi-"]').count();
    if (kpiCount >= 5) pass(`dashboard hiển thị ${kpiCount} ô KPI hệ thống`); else fail('KPI hệ thống', `chỉ ${kpiCount}`);
    await shot(page, 'dashboard-xem');

    /* 2. Nhãn "Trực tiếp" realtime xuất hiện (SSE qua proxy Next) */
    try {
      await page.waitForSelector('text=Trực tiếp', { timeout: 8000 });
      pass('kết nối realtime (SSE qua proxy)');
    } catch { fail('realtime dot', 'không thấy nhãn Trực tiếp'); }

    /* 3. KPI có số liệu thật */
    await page.waitForTimeout(1500);
    const kpiText = await page.locator('[data-widget-id="kpi-tong-phieu"]').innerText();
    if (/\d/.test(kpiText)) pass(`KPI tổng phiếu có số liệu (${kpiText.split('\n').find((l) => /^\d/.test(l.trim()))?.trim()})`);
    else fail('KPI số liệu', kpiText.slice(0, 60));

    /* 4. Mở chế độ chỉnh sửa → hiện nút thêm ô */
    await page.getByRole('button', { name: /chỉnh sửa/i }).click();
    await page.getByRole('button', { name: /thêm ô/i }).waitFor({ timeout: 5000 });
    pass('mở chế độ chỉnh sửa canvas');
    // Dọn các ô "Chỉ số mới" sót lại từ lần chạy trước (test idempotent)
    let stale = page.locator('[data-widget-id]').filter({ hasText: 'Chỉ số mới' });
    while ((await stale.count()) > 0) {
      await stale.first().getByTitle('Xoá ô').click();
      await page.waitForTimeout(200);
      stale = page.locator('[data-widget-id]').filter({ hasText: 'Chỉ số mới' });
    }
    await shot(page, 'dashboard-chinh-sua');

    /* 5. Thêm ô KPI mới từ palette */
    await page.getByRole('button', { name: /thêm ô/i }).click();
    await page.getByRole('button', { name: /Thẻ chỉ số \(KPI\)/i }).click();
    const newKpi = page.locator('[data-widget-id]').filter({ hasText: 'Chỉ số mới' }).first();
    await newKpi.waitFor({ timeout: 5000 });
    pass('thêm ô KPI mới vào canvas');

    /* 6. Cấu hình ô: chọn nguồn HSBA + chỉ số đếm + lưu */
    await newKpi.getByTitle('Cấu hình ô').click();
    await page.getByText('Cấu hình ô —', { exact: false }).waitFor({ timeout: 5000 });
    // Nguồn dữ liệu (select đầu tiên trong vùng biên tập)
    const srcSelect = page.getByTestId('cfg-source');
    await srcSelect.selectOption('hsba-requests');
    await page.waitForTimeout(300);
    await shot(page, 'cau-hinh-o');
    await page.getByRole('button', { name: 'Lưu ô' }).click();
    await page.waitForTimeout(800);
    pass('cấu hình ô KPI với nguồn HSBA + lưu');

    /* 7. Đổi rộng ô bằng nút [+] */
    const before = await page.locator('[data-widget-id]').filter({ hasText: 'Chỉ số mới' }).first().evaluate((el) => el.style.gridColumn);
    await page.locator('[data-widget-id]').filter({ hasText: 'Chỉ số mới' }).first().getByTitle('Mở rộng 1 cột').click();
    const after = await page.locator('[data-widget-id]').filter({ hasText: 'Chỉ số mới' }).first().evaluate((el) => el.style.gridColumn);
    if (before !== after) pass(`đổi rộng ô (${before} → ${after})`); else fail('đổi rộng', 'không đổi');

    /* 8. Lưu bố cục (trang hệ thống, admin được sửa) */
    await page.getByRole('button', { name: /lưu bố cục/i }).click();
    await page.waitForTimeout(1200);
    const errBox = await page.locator('.border-rose-200').count();
    if (errBox === 0) pass('lưu bố cục dashboard hệ thống'); else fail('lưu bố cục', await page.locator('.border-rose-200').innerText());
    await shot(page, 'sau-luu');

    /* 9. Báo cáo tùy biến: vào trang danh sách từ menu */
    await page.goto(`${BASE}/bao-cao/tuy-bien`, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: /tạo báo cáo/i }).first().waitFor({ timeout: 8000 });
    pass('trang danh sách báo cáo tùy biến');

    /* 10. Tạo báo cáo mới qua prompt */
    page.once('dialog', (d) => d.accept('Báo cáo tài sản theo khoa'));
    await page.getByRole('button', { name: /tạo báo cáo/i }).first().click();
    await page.waitForURL(/bao-cao\/tuy-bien\/\d+/, { timeout: 10000 });
    pass('tạo báo cáo tùy biến → mở trang thiết kế');

    /* 11. Thiết kế: thêm bảng + cấu hình nguồn assets + nhóm theo khoa */
    await page.getByRole('button', { name: /chỉnh sửa/i }).click();
    await page.getByRole('button', { name: /thêm ô/i }).click();
    await page.getByRole('button', { name: /Bảng dữ liệu/i }).click();
    const tableWidget = page.locator('[data-widget-id]').filter({ hasText: 'Bảng mới' }).first();
    await tableWidget.getByTitle('Cấu hình ô').click();
    await page.getByText('Cấu hình ô —', { exact: false }).waitFor({ timeout: 5000 });
    const src2 = page.getByTestId('cfg-source');
    await src2.selectOption('assets');
    await page.waitForTimeout(300);
    // Thêm nhóm theo khoa
    await page.getByRole('button', { name: /thêm nhóm/i }).click();
    const groupSelect = page.locator('select').filter({ has: page.locator('option', { hasText: 'Khoa/phòng' }) }).last();
    await groupSelect.selectOption('departmentName');
    await page.waitForTimeout(600);
    await shot(page, 'thiet-ke-bao-cao');
    await page.getByRole('button', { name: 'Lưu ô' }).click();
    await page.getByRole('button', { name: /lưu bố cục/i }).click();
    await page.waitForTimeout(1500);
    pass('thiết kế bảng "assets theo khoa" + lưu báo cáo');

    /* 12. Bảng hiển thị dữ liệu thật sau khi lưu */
    await page.waitForTimeout(800);
    const bodyText = await page.locator('table').first().innerText().catch(() => '');
    if (/Khoa|Nguyên|Số lượng/i.test(bodyText)) pass('bảng báo cáo hiển thị dữ liệu'); else fail('bảng dữ liệu', bodyText.slice(0, 80));
    await shot(page, 'bao-cao-xem');

    /* 13. Xuất Excel nút trên ô bảng — kiểm chứng endpoint trả file (gọi trực tiếp bằng fetch trong trang) */
    const exportResp = await page.evaluate(async () => {
      const res = await fetch('/api/studio/query/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          source: 'assets',
          metrics: [{ field: 'originalCost', agg: 'sum', label: 'Nguyên giá' }],
          dimensions: [{ field: 'departmentName' }],
          title: 'test',
        }),
      });
      return { status: res.status, type: res.headers.get('content-type') };
    });
    if ((exportResp.status === 200 || exportResp.status === 201) && /sheet/.test(exportResp.type ?? '')) pass('xuất Excel từ query engine'); else fail('xuất Excel', JSON.stringify(exportResp));
  } catch (err) {
    fail('ngoại lệ bất ngờ', err);
    await shot(page, 'loi');
  }

  console.log(`\n${results.filter((r) => r[0] === 'PASS').length} đạt · ${results.filter((r) => r[0] === 'FAIL').length} lỗi`);
  if (consoleErrors.length) {
    console.log('\nConsole errors:', [...new Set(consoleErrors)].slice(0, 8));
  } else {
    console.log('Không có lỗi console.');
  }
  await browser.close();
})();
