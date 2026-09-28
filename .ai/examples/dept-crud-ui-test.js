/**
 * Kiểm thử giao diện Quản trị → Khoa phòng:
 *  - Thêm đơn vị mới (loại "Ban") → cây cập nhật NGAY không cần F5
 *  - Xoá đơn vị → cây mất NGAY không cần F5
 * Chạy: NODE_PATH=/tmp/pw/node_modules node .ai/examples/dept-crud-ui-test.js
 */
const { chromium } = require('playwright');

const BASE = process.env.BASE_URL || 'http://localhost:3000';
const results = [];
function pass(name) { results.push(['PASS', name]); console.log(`  ✔ ${name}`); }
function fail(name, err) { results.push(['FAIL', name, String(err)]); console.log(`  ✘ ${name}: ${err}`); }

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console]', m.text().slice(0, 160)); });

  try {
    await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
    await page.locator('input').nth(0).fill('admin');
    await page.locator('input').nth(1).fill('Admin@123');
    await page.getByRole('button', { name: /đăng nhập/i }).click();
    await page.waitForURL(/dashboard/, { timeout: 15000 });

    await page.goto(`${BASE}/quan-tri/khoa-phong`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);

    const CODE = 'BAN' + Date.now().toString().slice(-6);
    const NAME = 'Ban kiem thu ' + CODE;

    /* 1. Dropdown loại đơn vị có mục "Ban" */
    await page.getByRole('button', { name: /thêm đơn vị|thêm khoa|thêm mới/i }).first().click();
    await page.waitForTimeout(500);
    const kindSelect = page.locator('select#kind, select').filter({ has: page.locator('option', { hasText: 'Ban' }) }).first();
    if ((await kindSelect.count()) > 0) pass('dropdown loại đơn vị có mục "Ban"');
    else fail('dropdown loại đơn vị', 'không có mục Ban');

    /* 2. Thêm mới → cây hiện ngay (không F5) */
    await page.getByPlaceholder('KPK').fill(CODE);
    await page.getByPlaceholder(/Khoa Phẫu thuật/).fill(NAME);
    await kindSelect.selectOption('BAN');
    await page.getByRole('button', { name: /lưu lại/i }).first().click();
    await page.waitForTimeout(1500);
    let body = await page.locator('body').innerText();
    if (body.includes(NAME)) pass('sau THÊM: cây hiển thị ngay (không F5)');
    else fail('sau THÊM', 'cây chưa hiển thị đơn vị mới');
    await page.screenshot({ path: '/tmp/dept-ok-1.png' });

    /* 3. Xoá → cây mất ngay (không F5). Nút Xoá nằm trong panel chi tiết: chọn đơn vị trước */
    await page.getByText(NAME, { exact: false }).first().click();
    await page.waitForTimeout(600);
    const delBtn = page.getByRole('button', { name: /^Xoá$/ }).first();
    if ((await delBtn.count()) === 0) { fail('nút xoá', 'không thấy trong panel chi tiết'); }
    else {
      await delBtn.click();
      await page.waitForTimeout(400);
      // ConfirmDialog: nút xác nhận "Xoá"
      await page.getByRole('button', { name: /xoá|đồng ý/i }).last().click();
      await page.waitForTimeout(1500);
      body = await page.locator('body').innerText();
      if (!body.includes(NAME)) pass('sau XOÁ: cây mất ngay (không F5)');
      else fail('sau XOÁ', 'cây vẫn còn đơn vị đã xoá');
      await page.screenshot({ path: '/tmp/dept-ok-2.png' });
    }
  } catch (err) {
    fail('ngoại lệ', err);
    await page.screenshot({ path: '/tmp/dept-ok-loi.png' });
  }

  console.log(`\n${results.filter((r) => r[0] === 'PASS').length} đạt · ${results.filter((r) => r[0] === 'FAIL').length} lỗi`);
  await browser.close();
})();
