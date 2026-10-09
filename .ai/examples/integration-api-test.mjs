// Kiểm thử end-to-end API TÍCH HỢP LỊCH TRỰC cho máy khoá phòng khám (khoá API chỉ đọc).
// Chạy: node .ai/examples/integration-api-test.mjs
//   Yêu cầu: API ở :4000 (đã migrate 0018 và seed). Gọi CLI quản lý khoá trong thư mục backend.
// Kỳ thử nghiệm đặt cách hôm nay ~60 ngày (tương lai, không trùng dữ liệu thật). Dữ liệu được dọn khi xong.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const B = process.env.API ?? 'http://localhost:4000/api';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = process.env.BACKEND ?? path.resolve(HERE, '../../backend');
const API_LOG = process.env.API_LOG ?? '/tmp/api.log';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => {
  if (cond) { ok++; console.log('  ✔', name); }
  else { fail++; console.log('  ✘', name, extra ? `→ ${String(extra).slice(0, 300)}` : ''); }
};

async function login(u, p) {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const j = await r.json();
  const tok = j.data?.accessToken ?? j.accessToken;
  if (!tok) throw new Error(`Đăng nhập ${u} thất bại: ${JSON.stringify(j).slice(0, 200)}`);
  return tok;
}
function client(tok) {
  return async (method, path, body) => {
    const r = await fetch(`${B}${path}`, {
      method,
      headers: { authorization: `Bearer ${tok}`, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const j = await r.json();
    return { status: r.status, data: j.data ?? j, msg: String(j.message ?? '') };
  };
}
// Gọi API tích hợp: không gửi JWT, chỉ gửi khoá API (hoặc không gửi gì nếu key = null)
async function machine(key, path) {
  const headers = key === null ? {} : { authorization: `Bearer ${key}` };
  const r = await fetch(`${B}${path}`, { headers });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, data: j.data, msg: String(j.message ?? '') };
}
const cli = (...args) => execFileSync('npm', ['run', '-s', 'integration:key', '--', ...args], { cwd: BACKEND, encoding: 'utf8', timeout: 120000 });
const keyIn = (text) => (text.match(/qlbs_int_[A-Za-z0-9_-]+/) ?? [])[0];

const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const todayBkk = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const base = addDays(todayBkk, 60);
const dowBase = new Date(`${base}T00:00:00Z`).getUTCDay() || 7;
const D0 = addDays(base, (8 - dowBase) % 7); // Thứ 2 kế tiếp (không sớm hơn 60 ngày)
const D1 = addDays(D0, 1), D2 = addDays(D0, 2), DRAFT = addDays(D0, 5);
const tag = Date.now().toString(36).toUpperCase();
const at = (ymd, hhmm) => `${ymd}T${hhmm}:00+07:00`;

console.log('▸ Chuẩn bị');
const adminToken = await login('admin', 'Admin@123');
const admin = client(adminToken);
const shifts = (await admin('GET', '/duty/shifts/options')).data;
const rooms = (await admin('GET', '/duty/rooms/options')).data;
const roles = (await admin('GET', '/duty/roles/options')).data;
const S = shifts.find((s) => s.code === 'S'), C = shifts.find((s) => s.code === 'C'), D = shifts.find((s) => s.code === 'D');
const P1 = rooms.find((r) => r.label.startsWith('P1 ')), P2 = rooms.find((r) => r.label.startsWith('P2 '));
const BS = roles.find((r) => r.code === 'BS');
check('có ca S, C, D và phòng P1, P2, vai trò BS', !!(S && C && D && P1 && P2 && BS));

const mkUser = async (suffix) => {
  const username = `itg_${suffix}_${tag}`.toLowerCase();
  const r = await admin('POST', '/users', { username, fullName: `Bác sĩ ${suffix.toUpperCase()} ${tag}`, password: 'Test@12345', title: 'Bác sĩ', roleCodes: ['NHAN_VIEN_TRUC'], mustChangePassword: false });
  if (r.status >= 300) throw new Error(`Tạo user ${username} lỗi: ${r.status} ${r.msg}`);
  return { id: r.data.id, username };
};
const bsA = await mkUser('a'), bsB = await mkUser('b'), bsC = await mkUser('c'), bsD = await mkUser('d');

const lockAt = new Date(Date.now() + 36 * 3600e3).toISOString();
// Ca đêm 17:00–07:00 dài 14 giờ, vượt giới hạn 10 giờ/ngày mặc định nên nới riêng cho kỳ thử này
const rules = { minRestHours: 12, maxHoursPerDay: 14, maxHoursPerWeek: 48, maxShiftsPerDay: 2 };
const pub = await admin('POST', '/duty/periods', { name: `Tích hợp kiểm thử ${tag}`, startDate: D0, endDate: D2, lockAt, rules });
check('tạo kỳ công bố thử ở nháp', pub.status < 300 && pub.data.status === 'NHAP', pub.msg);
const PID = pub.data.id;
const draft = await admin('POST', '/duty/periods', { name: `Tích hợp nháp ${tag}`, startDate: DRAFT, endDate: DRAFT, lockAt, rules });
check('tạo kỳ nháp thử (ngày khác)', draft.status < 300, draft.msg);
const DID = draft.data.id;

// Ô trực: bác sĩ A ca S P1 (D0); bác sĩ B ca đêm D P1 (D0→D1); bác sĩ C ca C P2 (D0, sẽ nghỉ phép)
await admin('POST', `/duty/periods/${PID}/slots`, { dutyDate: D0, roomId: P1.value, shiftId: S.value, roleId: BS.value });
await admin('POST', `/duty/periods/${PID}/slots`, { dutyDate: D0, roomId: P1.value, shiftId: D.value, roleId: BS.value });
await admin('POST', `/duty/periods/${PID}/slots`, { dutyDate: D0, roomId: P2.value, shiftId: C.value, roleId: BS.value });
await admin('POST', `/duty/periods/${DID}/slots`, { dutyDate: DRAFT, roomId: P1.value, shiftId: S.value, roleId: BS.value });
const grid = (await admin('GET', `/duty/periods/${PID}/grid`)).data;
const gridD = (await admin('GET', `/duty/periods/${DID}/grid`)).data;
const slot = (g, date, room, shift) => g.slots.find((s) => s.dutyDate === date && s.roomId === room && s.shiftId === shift && s.roleId === BS.value);
const sA = slot(grid, D0, P1.value, S.value), sB = slot(grid, D0, P1.value, D.value), sC = slot(grid, D0, P2.value, C.value);
const sDraft = slot(gridD, DRAFT, P1.value, S.value);
check('có đủ ô trực thử nghiệm', !!(sA && sB && sC && sDraft));
const as = await Promise.all([
  admin('POST', `/duty/slots/${sA.id}/assignments`, { userId: bsA.id }),
  admin('POST', `/duty/slots/${sB.id}/assignments`, { userId: bsB.id }),
  admin('POST', `/duty/slots/${sC.id}/assignments`, { userId: bsC.id }),
  admin('POST', `/duty/slots/${sDraft.id}/assignments`, { userId: bsD.id }),
]);
check('phân công 4 bác sĩ vào các ô thử', as.every((r) => r.status < 300), as.map((r) => r.msg).join(' | '));
const leave = await admin('POST', '/duty/absences', { userId: bsC.id, startDate: D0, endDate: D0, reason: 'PHEP_NAM', note: 'Kiểm thử tích hợp' });
check('ghi nhận nghỉ phép của bác sĩ C ngày D0', leave.status < 300, leave.msg);
const pubRes = await admin('POST', `/duty/periods/${PID}/publish`, { force: true });
const pubState = (await admin('GET', `/duty/periods/${PID}`)).data;
check('công bố kỳ thử', pubRes.status < 300 && (pubState.status ?? pubState.period?.status) === 'CONG_BO', pubRes.msg);

console.log('▸ Khoá API');
const created = cli('create', '--name', `Kiểm thử tích hợp ${tag}`);
const KEY = keyIn(created);
const KEY_ID = Number((created.match(/khoá API #(\d+)/) ?? [])[1]);
check('tạo khoá API bằng CLI và khoá có tiền tố qlbs_int_', !!KEY && KEY.startsWith('qlbs_int_') && KEY_ID > 0);
const listed = cli('list');
check('danh sách khoá hiển thị khoá vừa tạo (không lộ khoá đầy đủ)', listed.includes(`#${KEY_ID}`) && !listed.includes(KEY));

console.log('▸ Xác thực');
check('thiếu khoá → 401', (await machine(null, '/integration/duty/on-duty?room=P1')).status === 401);
check('khoá sai → 401', (await machine('qlbs_int_sai', '/integration/duty/on-duty?room=P1')).status === 401);
check('khoá không có tiền tố → 401', (await machine('abc123', '/integration/duty/on-duty?room=P1')).status === 401);
check('JWT người dùng không được dùng thay khoá → 401', (await machine(adminToken, '/integration/duty/on-duty?room=P1')).status === 401);

// Khoá có phạm vi khác: thêm trực tiếp vào CSDL để kiểm tra 403
const scopeKey = execFileSync('node', ['-e', `
  const crypto = require('crypto'); const { Client } = require('pg'); require('dotenv').config();
  (async () => {
    const key = 'qlbs_int_' + crypto.randomBytes(32).toString('base64url');
    const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    const r = await c.query("INSERT INTO integration_keys (name, key_prefix, key_hash, scope) VALUES ('Phạm vi khác', 'x', $1, 'other:scope') RETURNING id",
      [crypto.createHash('sha256').update(key).digest('hex')]);
    await c.end(); console.log(JSON.stringify({ id: r.rows[0].id, key }));
  })().catch((e) => { console.error(e.message); process.exit(1); });
`], { cwd: BACKEND, encoding: 'utf8' });
const scoped = JSON.parse(scopeKey.trim().split('\n').pop());
const r403 = await machine(scoped.key, '/integration/duty/on-duty?room=P1');
check('khoá sai phạm vi (không phải duty:read) → 403', r403.status === 403, r403.msg);
cli('revoke', '--id', String(scoped.id));

console.log('▸ Ca trực theo thời điểm');
const K = KEY;
const onDuty = async (when, room) => {
  const q = `at=${encodeURIComponent(when)}${room ? `&room=${room}` : ''}`;
  const r = await machine(K, `/integration/duty/on-duty?${q}`);
  return r;
};
const names = (r) => (r.data?.onDuty ?? []).map((e) => e.staff.username);

let r = await onDuty(at(D0, '09:00'), 'P1');
check('phản hồi 200 có danh sách onDuty trong data', r.status === 200 && Array.isArray(r.data?.onDuty), JSON.stringify(r).slice(0, 200));
check('09:00 D0 phòng P1: đúng bác sĩ A (ca S)', JSON.stringify(names(r)) === JSON.stringify([bsA.username]), JSON.stringify(names(r)));
const eA = r.data.onDuty[0];
check('ca S có giờ đúng +07:00 và mã phòng/ca đúng', eA?.shift.code === 'S' && eA.shift.startsAt === at(D0, '07:00') && eA.shift.endsAt === at(D0, '12:00') && eA.room.code === 'P1', JSON.stringify(eA));
check('thông tin nhân viên tối thiểu (không lộ email/SĐT)', JSON.stringify(Object.keys(eA?.staff ?? {}).sort()) === JSON.stringify(['fullName', 'title', 'username']), JSON.stringify(eA?.staff));

r = await onDuty(at(D0, '20:00'), 'P1');
check('20:00 D0 phòng P1: đúng bác sĩ B (ca đêm)', JSON.stringify(names(r)) === JSON.stringify([bsB.username]), JSON.stringify(names(r)));
check('ca đêm có giờ kết thúc sang ngày hôm sau', r.data.onDuty[0]?.shift.endsAt === at(D1, '07:00'), JSON.stringify(r.data.onDuty[0]?.shift));

r = await onDuty(at(D1, '03:00'), 'P1');
check('03:00 D1 (còn trong ca đêm) phòng P1: vẫn là bác sĩ B', JSON.stringify(names(r)) === JSON.stringify([bsB.username]), JSON.stringify(names(r)));
r = await onDuty(at(D1, '07:00'), 'P1');
check('07:00 D1 (hết ca đêm, cuối ca không tính): không còn ai', names(r).length === 0, JSON.stringify(names(r)));
r = await onDuty(at(D0, '12:00'), 'P1');
check('12:00 D0 (hết ca S, đầu ca C): không còn ai ở P1', names(r).length === 0, JSON.stringify(names(r)));
r = await onDuty(at(D0, '13:00'), 'P2');
check('13:00 D0 phòng P2: bác sĩ C đang nghỉ phép nên không được mở', names(r).length === 0, JSON.stringify(names(r)));
r = await onDuty(at(DRAFT, '09:00'), 'P1');
check('kỳ nháp không bao giờ được trả về', names(r).length === 0, JSON.stringify(names(r)));
r = await onDuty(at(D0, '09:00'), 'p1');
check('mã phòng không phân biệt hoa thường', JSON.stringify(names(r)) === JSON.stringify([bsA.username]));
r = await onDuty(at(D0, '09:00'), 'ZZ-KHONG-TON-TAI');
check('phòng không tồn tại → danh sách rỗng (không lỗi)', r.status === 200 && names(r).length === 0, r.status);
r = await machine(K, '/integration/duty/on-duty');
check('không truyền at → dùng thời điểm hiện tại (200)', r.status === 200 && typeof r.data.at === 'string' && /\+07:00$/.test(r.data.at));
r = await machine(K, '/integration/duty/on-duty?at=2026-10-09');
check('at chỉ có ngày → 400', r.status === 400, r.msg);
r = await machine(K, '/integration/duty/on-duty?at=' + encodeURIComponent('2026-13-45T10:00'));
check('at sai ngày/giờ → 400', r.status === 400, r.msg);

console.log('▸ Lịch trực theo khoảng ngày');
const roster = async (from, to, room) => machine(K, `/integration/duty/roster?from=${from}&to=${to}${room ? `&room=${room}` : ''}`);
let ro = await roster(D0, D2, 'P1');
const itemA = ro.data?.items?.find((i) => i.staff.username === bsA.username);
const itemB = ro.data?.items?.find((i) => i.staff.username === bsB.username);
check('lịch 3 ngày phòng P1 có đủ bác sĩ A và B, không có nháp', !!itemA && !!itemB && !ro.data.items.some((i) => i.staff.username === bsD.username), JSON.stringify(ro.data?.items?.map((i) => i.staff.username)));
check('cờ onLeave = false khi không nghỉ phép', itemA?.onLeave === false && itemB?.onLeave === false);
ro = await roster(D0, D2, 'P2');
const itemC = ro.data?.items?.find((i) => i.staff.username === bsC.username);
check('lịch phòng P2 vẫn liệt kê bác sĩ C nhưng đánh dấu nghỉ phép', !!itemC && itemC.onLeave === true, JSON.stringify(itemC));
ro = await roster(D0, addDays(D0, 31));
check('khoảng quá 31 ngày → 400', ro.status === 400, ro.msg);
ro = await roster(D2, D0);
check('to trước from → 400', ro.status === 400, ro.msg);
ro = await roster('2026/10/01', D2);
check('ngày sai định dạng → 400', ro.status === 400, ro.msg);
ro = await roster(D0, D2, 'ZZ-KHONG-TON-TAI');
check('lịch phòng không tồn tại → rỗng', ro.status === 200 && ro.data.items.length === 0);

console.log('▸ Trạng thái nhân sự và phòng');
// Ca đêm D đang tắt trong danh mục (seed) nhưng phân công đã công bố vẫn phải được tính
check('ca đêm đã tắt trong danh mục vẫn mở được cho người trực đã công bố', names(await onDuty(at(D0, '20:00'), 'P1')).includes(bsB.username));
// Vô hiệu hoá nhân sự → không được mở máy; bật lại sau đó
const deact = await admin('PATCH', `/users/${bsA.id}/active`, { active: false });
check('vô hiệu hoá bác sĩ A (thử nghiệm)', deact.status < 300, deact.msg);
r = await onDuty(at(D0, '09:00'), 'P1');
check('nhân sự đã vô hiệu hoá không còn được mở máy', names(r).length === 0, JSON.stringify(names(r)));
await admin('PATCH', `/users/${bsA.id}/active`, { active: true });
// Đóng phòng P1 → không ai được mở; mở lại sau đó
const roomOff = await admin('PUT', `/duty/rooms/${P1.value}`, { active: false });
check('đóng phòng P1 (thử nghiệm)', roomOff.status < 300, roomOff.msg);
r = await onDuty(at(D0, '09:00'), 'P1');
check('phòng đã đóng: không ai được mở máy', names(r).length === 0, JSON.stringify(names(r)));
const roomOn = await admin('PUT', `/duty/rooms/${P1.value}`, { active: true });
check('mở lại phòng P1', roomOn.status < 300, roomOn.msg);
r = await onDuty(at(D0, '09:00'), 'P1');
check('sau khi mở lại phòng, bác sĩ A được mở máy lại', names(r).includes(bsA.username));

console.log('▸ Danh mục phòng');
r = await machine(K, '/integration/duty/rooms');
check('danh mục có P1 và P2', r.status === 200 && r.data.rooms.some((x) => x.code === 'P1') && r.data.rooms.some((x) => x.code === 'P2'));

console.log('▸ Thu hồi và nhật ký');
const listed2 = cli('list');
const line = listed2.split('\n').find((l) => l.startsWith(`#${KEY_ID} `)) ?? '';
check('danh sách ghi nhận lần dùng cuối của khoá', line.includes('dùng lần cuối=') && !line.includes('dùng lần cuối=—'), line);
if (fs.existsSync(API_LOG)) {
  check('khoá đầy đủ không xuất hiện trong nhật ký API', !fs.readFileSync(API_LOG, 'utf8').includes(K));
} else {
  console.log('  - bỏ qua kiểm tra nhật ký (không có', API_LOG, ')');
}
cli('revoke', '--id', String(KEY_ID));
r = await onDuty(at(D0, '09:00'), 'P1');
check('khoá đã thu hồi → 401 ngay lập tức', r.status === 401 && /thu hồi/.test(r.msg), r.msg);
check('thu hồi lần thứ hai báo không có khoá đang hoạt động', (() => { try { cli('revoke', '--id', String(KEY_ID)); return false; } catch (e) { return String(e.stderr ?? '').includes('Không có khoá'); } })());

console.log('▸ Dọn dữ liệu thử');
for (const [id, name] of [[PID, `Tích hợp kiểm thử ${tag}`], [DID, `Tích hợp nháp ${tag}`]]) {
  const del = await admin('POST', `/duty/periods/${id}/delete`, { reason: 'Dọn dữ liệu kiểm thử tích hợp', confirmName: name });
  check(`xoá kỳ thử ${name}`, del.status < 300, del.msg);
}

console.log(`\nKết quả: ${ok} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
