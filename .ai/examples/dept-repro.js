/** Tái hiện lỗi: thêm/xoá khoa phòng — cây có tự cập nhật không? */
const { chromium } = require('playwright');

const BASE = 'http://localhost:3000';

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', (m) => { if (m.type() === 'error') console.log('  [console-err]', m.text().slice(0, 200)); });
  page.on('response', (r) => { if (/\/departments/.test(r.url()) && r.request().method() !== 'GET') console.log('  [api]', r.request().method(), r.url().split('/api')[1], r.status()); });

  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill('admin');
  await page.locator('input').nth(1).fill('Admin@123');
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 15000 });

  await page.goto(`${BASE}/quan-tri/khoa-phong`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1200);

  const CODE = 'DV' + Date.now().toString().slice(-6);
  const NAME = 'Don vi test ' + CODE;

  /* ---- THÊM MỚI ---- */
  await page.getByRole('button', { name: /thêm đơn vị|thêm khoa|thêm mới/i }).first().click();
  await page.waitForTimeout(500);
  await page.getByPlaceholder('KPK').fill(CODE);
  await page.getByPlaceholder(/Khoa Phẫu thuật/).fill(NAME);
  // Chọn loại đơn vị Khoa để chắc chắn
  await page.screenshot({ path: '/tmp/dept-1-form.png' });
  await page.getByRole('button', { name: /lưu|thêm$/i }).first().click();
  await page.waitForTimeout(1800);

  let body = await page.locator('body').innerText();
  const afterAddNoRefresh = body.includes(NAME);
  console.log('sau THÊM (không F5):', afterAddNoRefresh ? 'CÂY ĐÃ CÓ' : 'CÂY CHƯA CÓ — LỖI');
  await page.screenshot({ path: '/tmp/dept-2-after-add.png' });

  await page.reload({ waitUntil: 'networkidle' });
  body = await page.locator('body').innerText();
  console.log('sau THÊM + F5:', body.includes(NAME) ? 'có (dữ liệu đã lưu DB)' : 'vẫn không có — lỗi lưu');

  if (!afterAddNoRefresh) {
    // Không cần tiếp tục nếu lỗi đã tái hiện ở bước thêm
  }

  /* ---- XOÁ ---- */
  // Tìm dòng chứa NAME và bấm nút xoá (icon thùng rác)
  const row = page.locator('div, li, tr').filter({ hasText: NAME }).last();
  const delBtn = row.getByTitle(/xoá|xóa/i).first();
  console.log('nút xoá tìm được:', await delBtn.count());
  if ((await delBtn.count()) > 0) {
    await delBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: '/tmp/dept-3-confirm.png' });
    const confirmBtn = page.getByRole('button', { name: /xoá|xóa|đồng ý|xác nhận/i }).last();
    await confirmBtn.click();
    await page.waitForTimeout(1800);
    const body2 = await page.locator('body').innerText();
    console.log('sau XOÁ (không F5):', body2.includes(NAME) ? 'CÂY VẪN CÒN — LỖI' : 'CÂY ĐÃ MẤT — đúng');
    await page.screenshot({ path: '/tmp/dept-4-after-delete.png' });
    await page.reload({ waitUntil: 'networkidle' });
    const body3 = await page.locator('body').innerText();
    console.log('sau XOÁ + F5:', body3.includes(NAME) ? 'vẫn còn — lỗi xoá DB' : 'đã mất (DB đúng)');
  }
  await browser.close();
})();
