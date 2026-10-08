// Kiểm thử giao diện LỊCH TRỰC (Playwright): đăng nhập bằng API, mở các trang chính ở máy tính và điện thoại,
// chụp ảnh vào /tmp/shots và báo lỗi console. Chạy:
//   PW_MODULE=/tmp/pw/node_modules/playwright/index.mjs node .ai/examples/duty-ui-test.mjs
// (WEB mặc định http://localhost:3000, API mặc định http://localhost:4000/api; cần admin / Admin@123)
const { chromium } = await import(process.env.PW_MODULE ?? 'playwright');
const WEB = process.env.WEB ?? 'http://localhost:3000';
const API = process.env.API ?? 'http://localhost:4000/api';
const fs = await import('node:fs');
fs.mkdirSync('/tmp/shots', { recursive: true });

const login = async (u, p) => {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const j = await r.json();
  return { access: j.data?.accessToken ?? j.accessToken, refresh: j.data?.refreshToken ?? j.refreshToken };
};
const admin = await login('admin', 'Admin@123');
const uname = `nvtruc_ui_${Date.now().toString(36)}`;
await fetch(`${API}/users`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', authorization: `Bearer ${admin.access}` },
  body: JSON.stringify({ username: uname, fullName: 'BS. Kiểm thử giao diện', password: 'Test@12345', title: 'Bác sĩ', roleCodes: ['NHAN_VIEN_TRUC'], mustChangePassword: false }),
});
const emp = await login(uname, 'Test@12345');

const plan = [
  ['may-tinh', 1440, 900, admin, '/lich-truc', 'lich-admin'],
  ['may-tinh', 1440, 900, admin, '/lich-truc/ky-lich', 'ky-lich'],
  ['may-tinh', 1440, 900, emp, '/lich-truc/cua-toi', 'cua-toi'],
  ['may-tinh', 1440, 900, admin, '/lich-truc/yeu-cau', 'yeu-cau'],
  ['may-tinh', 1440, 900, admin, '/lich-truc/danh-muc', 'danh-muc'],
  ['dien-thoai', 390, 844, emp, '/lich-truc', 'dien-thoai-lich'],
  ['dien-thoai', 390, 844, emp, '/lich-truc/cua-toi', 'dien-thoai-cua-toi'],
];
const browser = await chromium.launch({ args: ['--no-sandbox'] });
const problems = [];
for (const [, w, h, tok, path, name] of plan) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`[${name}] lỗi trang: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`[${name}] console: ${m.text().slice(0, 200)}`); });
  await page.goto(`${WEB}/login`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(({ a, r }) => { localStorage.setItem('qlbs_access_token', a); localStorage.setItem('qlbs_refresh_token', r); }, { a: tok.access, r: tok.refresh });
  await page.goto(`${WEB}${path}`, { waitUntil: 'networkidle', timeout: 60000 }).catch((e) => problems.push(`[${name}] tải trang: ${e.message}`));
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `/tmp/shots/${name}.png` });
  await ctx.close();
}
await browser.close();
console.log(problems.length ? problems.join('\n') : 'KHÔNG CÓ LỖI CONSOLE — đã chụp ảnh các trang lịch trực');
