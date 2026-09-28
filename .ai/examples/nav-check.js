/* Kiểm tra nav "Báo cáo tuỳ biến" hiển thị đúng với user thường (bs.minh) */
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const BASE = 'http://localhost:3000';
  const out = [];

  // bs.minh: user thường, không có quyền report.template.view nhưng có studio.report.view
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.locator('input').nth(0).fill('bs.minh');
  await page.locator('input').nth(1).fill('123456');
  await page.getByRole('button', { name: /đăng nhập/i }).click();
  await page.waitForURL(/dashboard/, { timeout: 15000 });
  await page.waitForURL((u) => !u.pathname.includes('dang-nhap'), { timeout: 10000 });

  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(1500);

  const sidebar = (await page.locator('nav, aside').first().innerText().catch(() => '')) || '';
  const body = await page.locator('body').innerText();
  out.push(['bs.minh thấy "Báo cáo tuỳ biến" trong nav', sidebar.includes('Báo cáo tuỳ biến') || body.includes('Báo cáo tuỳ biến')]);

  // Vào thử trang /bao-cao/tuy-bien có bị chặn quyền không
  await page.goto(`${BASE}/bao-cao/tuy-bien`);
  await page.waitForTimeout(1200);
  const tuyBien = await page.locator('body').innerText();
  const blocked = /không có quyền|truy cập bị từ chối|Forbidden|403/i.test(tuyBien);
  out.push(['bs.minh mở được trang Báo cáo tuỳ biến', !blocked && !page.url().includes('dang-nhap')]);

  // Dashboard của user thường có KPI số liệu không
  await page.goto(`${BASE}/dashboard`);
  await page.waitForTimeout(2000);
  const dash = await page.locator('body').innerText();
  out.push(['bs.minh thấy dashboard KPI', /Tổng phiếu|chờ ký|Trực tiếp|Bảng điều khiển/i.test(dash)]);

  for (const [name, ok] of out) console.log(ok ? `  ✔ ${name}` : `  ✘ ${name}`);
  await page.screenshot({ path: '/tmp/shots-gd3a/nav-bsminh.png', fullPage: false });
  await browser.close();
})();
