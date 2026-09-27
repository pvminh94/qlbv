// Test Playwright giao diện phân hệ Tài sản: node .ai/examples/asset-ui-test.js (cần web :3000 + API :4000 đã nạp demo)
const { chromium } = require('/tmp/pw/node_modules/playwright');
const BASE = 'http://localhost:3000'; const OUT = '/tmp/shots/'; require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1600, height: 1000 } }); const errs = [];
  p.on('pageerror', (e) => errs.push(`${p.url()} :: ${e.message}`)); p.on('console', (m) => { if (m.type() === 'error' && !/favicon|401/.test(m.text())) errs.push(`${p.url()} :: console: ${m.text()}`); });
  await p.goto(BASE + '/login'); const i = p.locator('input'); await i.nth(0).fill('admin'); await i.nth(1).fill('Admin@123'); await p.keyboard.press('Enter'); await p.waitForTimeout(3000);
  const shot = async (url, name, wait = 2500) => { await p.goto(BASE + url); await p.waitForTimeout(wait); await p.screenshot({ path: OUT + name + '.png', fullPage: true }); console.log('✓', url, '→', name); };
  await shot('/tai-san', 'a1-dashboard', 3500);
  await shot('/tai-san/danh-sach', 'a2-list');
  // chọn 2 dòng → thanh thao tác
  await p.locator('tbody input[type=checkbox]').nth(0).check(); await p.locator('tbody input[type=checkbox]').nth(1).check();
  await p.getByRole('button', { name: /Lập chứng từ/ }).click(); await p.waitForTimeout(400); await p.screenshot({ path: OUT + 'a3-bulk.png' });
  await p.keyboard.press('Escape');
  const href = await p.locator('tbody a[href^="/tai-san/"]').first().getAttribute('href');
  await shot(href, 'a4-detail', 3000);
  await p.getByRole('button', { name: /Khấu hao \/ hao mòn/ }).click().catch(() => {}); await p.waitForTimeout(800); await p.screenshot({ path: OUT + 'a5-detail-depr.png', fullPage: true });
  await p.getByRole('button', { name: /Dòng thời gian/ }).click().catch(() => {}); await p.waitForTimeout(500); await p.screenshot({ path: OUT + 'a6-timeline.png', fullPage: true });
  await p.getByRole('button', { name: /^Sửa$/ }).click(); await p.waitForTimeout(800); await p.screenshot({ path: OUT + 'a7-edit.png' }); await p.keyboard.press('Escape');
  await shot('/tai-san/danh-sach?new=1', 'a8-new');
  await shot('/tai-san/nghiep-vu?status=', 'a9-tx');
  const tx = await p.locator('tbody tr').first(); await tx.click(); await p.waitForTimeout(2500); await p.screenshot({ path: OUT + 'a10-tx-detail.png', fullPage: true });
  const id = href.split('/').pop();
  await shot(`/tai-san/nghiep-vu/tao-moi?type=DIEU_CHUYEN&ids=${id}`, 'a11-tx-new');
  await shot('/tai-san/khau-hao', 'a12-depr');
  await p.getByRole('button', { name: /Xem trước/ }).click(); await p.waitForTimeout(2500); await p.screenshot({ path: OUT + 'a13-depr-preview.png', fullPage: true });
  await shot(`/tai-san/in-tem?ids=${id}`, 'a14-label');
  await p.getByRole('button', { name: /Tạo tem/ }).click(); await p.waitForTimeout(3000); await p.screenshot({ path: OUT + 'a15-label-pdf.png' });
  await shot('/tai-san/tra-cuu', 'a16-scan', 1500);
  const code = await (async () => { await p.goto(BASE + href); await p.waitForTimeout(2000); return (await p.locator('.font-mono').first().innerText()).split(' ')[0]; })();
  await p.goto(BASE + '/tai-san/tra-cuu'); await p.waitForTimeout(1200); await p.locator('main input').first().fill(code); await p.keyboard.press('Enter'); await p.waitForTimeout(1500); await p.screenshot({ path: OUT + 'a17-scan-hit.png' });
  // Ô tìm kiếm chung: gõ/quét mã tài sản → mở thẳng hồ sơ
  await p.goto(BASE + '/'); await p.waitForTimeout(1000); await p.locator('header form input').fill(code); await p.keyboard.press('Enter'); await p.waitForTimeout(2000);
  console.log('Global search →', p.url()); if (!/\/tai-san\/\d+/.test(p.url())) errs.push('global search không mở hồ sơ tài sản');
  await p.goto(BASE + '/ts/' + encodeURIComponent(code)); await p.waitForTimeout(3000); console.log('QR redirect →', p.url());
  await shot('/tai-san/danh-muc', 'a18-catalog');
  console.log('errors:', errs.slice(0, 15)); await b.close();
})();
