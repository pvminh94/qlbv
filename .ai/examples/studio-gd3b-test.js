/**
 * Kiểm thử giao diện Studio GĐ3b: ấn bản định kỳ, drill-down, phạm vi trang.
 * Chạy:  NODE_PATH=/tmp/pw/node_modules node .ai/examples/studio-gd3b-test.js
 */
const { chromium } = require('playwright');
const fs = require('fs');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const API = process.env.API_URL || 'http://localhost:4000';
const SHOTS = '/tmp/shots-gd3b';
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

let step = 0;
const results = [];
async function shot(page, name) {
  await page.screenshot({ path: `${SHOTS}/${String(++step).padStart(2, '0')}-${name}.png`, fullPage: false });
}
function pass(name) { results.push(['PASS', name]); console.log(`  ✔ ${name}`); }
function fail(name, err) { results.push(['FAIL', name, String(err)]); console.log(`  ✘ ${name}: ${err}`); }

async function login(page, user = 'admin', pw = 'Admin@123') {
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill(user);
  await page.locator('input').nth(1).fill(pw);
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 15000 });
  await page.waitForTimeout(1800);
}

(async () => {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1500, height: 950 } })).newPage();
  page.on('pageerror', (e) => console.log('  [pageerror]', String(e).slice(0, 160)));

  try {
    /* 1 — Đăng nhập, dashboard mặc định hiện nút "Ấn bản" */
    await login(page);
    const bellBtn = page.getByRole('button', { name: /Ấn bản/i }).first();
    if (await bellBtn.count()) pass('dashboard có nút "Ấn bản"'); else fail('nút Ấn bản tồn tại', 'not found');

    /* 2 — Mở dialog ấn bản, tạo đăng ký */
    await bellBtn.click();
    await page.waitForTimeout(700);
    if (await page.getByText('Đăng ký nhận cho trang này').count()) pass('dialog ấn bản mở'); else fail('dialog ấn bản mở', 'không thấy tiêu đề');
    await shot(page, 'an-ban-dialog');
    await page.getByPlaceholder('VD: Báo cáo đầu ngày').fill('Ấn bản test UI');
    // chọn giờ 06:00 đã có đăng ký trước đó → chọn 07:00 để tránh trùng lịch
    await page.locator('div[role="dialog"] select').nth(1).selectOption('7');
    await page.getByRole('button', { name: /^Đăng ký$/ }).click();
    await page.waitForTimeout(1200);
    if (await page.getByText('Ấn bản test UI').count()) pass('tạo đăng ký mới thành công'); else fail('tạo đăng ký', 'không thấy trong danh sách');

    /* 3 — Chạy thử → có file trong "Ấn bản đã phát hành" */
    const runBtn = page.locator('button[title*="Phát hành thử"]').first();
    await runBtn.click();
    await page.waitForTimeout(2500);
    await shot(page, 'an-ban-da-chay');
    const downloadBtns = page.getByRole('button', { name: /Tải/ });
    if (await downloadBtns.count()) pass('chạy thử sinh ấn bản (có nút Tải)');
    else fail('ấn bản sau chạy thử', 'danh sách file rỗng');

    /* 4 — Tải file từ dialog */
    const dl = page.waitForEvent('download', { timeout: 8000 }).catch(() => null);
    await downloadBtns.first().click();
    const dlObj = await dl;
    if (dlObj && (await dlObj.path())) {
      const size = fs.statSync(await dlObj.path()).size;
      size > 3000 ? pass(`tải ấn bản xuống (${size}B)`) : fail('tải ấn bản', `file quá nhỏ ${size}`);
    } else fail('tải ấn bản', 'không bắt được download');

    /* 5 — Tắt/xoá đăng ký */
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);

    /* 6 — Drill-down từ KPI */
    const kpi = page.locator('div[title="Bấm để xem các bản ghi gốc"]').first();
    await shot(page, 'dashboard');
    if (await kpi.count()) {
      await kpi.click();
      await page.waitForTimeout(1400);
      const dlgTitle = page.getByText(/^Bản ghi gốc/);
      if (await dlgTitle.count()) pass('KPI click → dialog bản ghi gốc mở');
      else fail('drill KPI', 'dialog không mở');
      const rows = await page.locator('div[role="dialog"] tbody tr').count();
      rows > 0 ? pass(`bản ghi gốc có ${rows} dòng`) : fail('drill KPI rows', 'bảng rỗng');
      const total = await page.locator('div[role="dialog"] footer, div[role="dialog"] .tabular-nums').first().textContent().catch(() => '');
      await shot(page, 'drill-kpi');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else fail('drill KPI', 'không tìm thấy thẻ KPI clickable');

    /* 7 — Drill-down từ biểu đồ (bấm vào cột/nhóm pie) */
    const pieCell = page.locator('.recharts-pie-sector path, .recharts-bar-rectangle path').first();
    if (await pieCell.count()) {
      await pieCell.click({ force: true });
      await page.waitForTimeout(1400);
      if (await page.getByText(/^Bản ghi gốc/).count()) {
        pass('biểu đồ click → dialog bản ghi gốc mở');
        const desc = await page.locator('div[role="dialog"]').first().textContent();
        desc.includes(':') ? pass('mô tả bộ lọc hiển thị (nhãn: giá trị)') : fail('mô tả bộ lọc', desc.slice(0, 80));
        await shot(page, 'drill-chart');
      } else fail('drill biểu đồ', 'dialog không mở');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else console.log('  · không có pie/bar để thử drill (bỏ qua 7)');

    /* 8 — Drill-down từ bảng (nếu có ô bảng) */
    const tableRow = page.locator('table tbody tr[title*="bản ghi gốc"]').first();
    if (await tableRow.count()) {
      await tableRow.click();
      await page.waitForTimeout(1400);
      if (await page.getByText(/^Bản ghi gốc/).count()) pass('bảng click → dialog bản ghi gốc mở');
      else fail('drill bảng', 'dialog không mở');
      await shot(page, 'drill-table');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(400);
    } else console.log('  · không có ô bảng để thử drill (bỏ qua 8)');

    /* 9 — Dialog "Thông tin trang" có chọn phạm vi (admin) */
    await page.getByRole('button', { name: /Thông tin trang/i }).click();
    await page.waitForTimeout(600);
    if (await page.getByText('Phạm vi chia sẻ').count()) {
      pass('admin thấy chọn phạm vi trong Thông tin trang');
      await page.locator('div[role="dialog"] select').first().selectOption('ROLE');
      await page.waitForTimeout(400);
      ((await page.locator('div[role="dialog"] select').count()) >= 2) ? pass('chọn ROLE hiện thêm select vai trò') : fail('select vai trò', 'không hiện');
      await shot(page, 'thong-tin-trang-role');
    } else fail('phạm vi chia sẻ', 'không thấy');
    await page.keyboard.press('Escape');

    /* 10 — Mở thẳng dialog ấn bản từ link thông báo (?an-ban=1) */
    await page.goto(`${BASE}/dashboard?an-ban=1`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(2000);
    if (await page.getByText('Đăng ký nhận cho trang này').count()) pass('?an-ban=1 tự mở dialog ấn bản');
    else fail('auto-open ấn bản', 'dialog không tự mở');
    await page.keyboard.press('Escape');

    /* 11 — Trang báo cáo tuỳ biến: nút Ấn bản + dialog */
    await page.goto(`${BASE}/bao-cao/tuy-bien`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    const firstReport = page.locator('a[href^="/bao-cao/tuy-bien/"]').filter({ hasText: /\S/ }).first();
    if (await firstReport.count()) {
      await firstReport.click();
      await page.waitForTimeout(1600);
      const bell2 = page.getByRole('button', { name: /Ấn bản/i }).first();
      if (await bell2.count()) pass('trang báo cáo có nút "Ấn bản"'); else fail('nút ấn bản báo cáo', 'không thấy');
    } else console.log('  · chưa có báo cáo riêng để thử (bỏ qua 11)');
  } catch (e) {
    fail('luồng tổng', e);
  } finally {
    await shot(page, 'cuoi');
    await browser.close();
  }

  /* 12 — API: người thường (không manage) tạo trang cá nhân được */
  try {
    const login2 = await fetch(`${API}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'tk.nam', password: '123456' }),
    }).then((r) => r.json());
    const t2 = login2.data.accessToken;
    const cr = await fetch(`${API}/api/studio/pages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t2}` },
      body: JSON.stringify({ name: 'Trang riêng tk.nam', kind: 'DASHBOARD', layout: { widgets: [] } }),
    }).then((r) => r.json());
    cr.success && cr.data?.scope === 'PERSONAL'
      ? pass('người thường (không quyền manage) tạo trang cá nhân OK')
      : fail('tạo trang cá nhân người thường', JSON.stringify(cr).slice(0, 120));
    const cr2 = await fetch(`${API}/api/studio/pages`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t2}` },
      body: JSON.stringify({ name: 'Trang hệ thống xấu', kind: 'DASHBOARD', scope: 'SYSTEM', layout: { widgets: [] } }),
    }).then((r) => r.json());
    !cr2.success ? pass('người thường tạo trang SYSTEM bị chặn đúng') : fail('chặn SYSTEM', 'đáng lẽ 403');
  } catch (e) {
    fail('API quyền tạo trang', e);
  }

  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length} đạt · ${fails.length} lỗi`);
  process.exit(fails.length ? 1 : 0);
})();
