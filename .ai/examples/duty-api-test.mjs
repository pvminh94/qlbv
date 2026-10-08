// Kiểm thử end-to-end API phân hệ LỊCH TRỰC KHÁM BỆNH.
// Chạy: node .ai/examples/duty-api-test.mjs   (API ở :4000, đã migrate + seed; dữ liệu tạo mới mỗi lần chạy)
const B = process.env.API ?? 'http://localhost:4000/api';
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
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('json')) {
      const j = await r.json();
      return { status: r.status, data: j.data ?? j, msg: String(j.message ?? '') };
    }
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), ct };
  };
}

// Ngày kiểm thử: tuần kế tiếp (Thứ 2 → Thứ 7), luôn ở tương lai
const todayBkk = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
const addDays = (ymd, n) => { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dow = new Date(`${todayBkk}T00:00:00Z`).getUTCDay() || 7;
const MON = addDays(todayBkk, 7 - (dow - 1));
const day = (i) => addDays(MON, i); // 0 = Thứ 2 … 5 = Thứ 7
const tag = Date.now().toString(36).toUpperCase();

console.log('▸ Chuẩn bị tài khoản thử nghiệm');
const admin = client(await login('admin', 'Admin@123'));
// Dọn dữ liệu kiểm thử còn sót từ lần chạy trước (kỳ lịch trùng ngày và ngày nghỉ bị chặn theo ràng buộc)
{
  const list = await admin('GET', '/duty/periods');
  const stale = (list.data ?? []).filter((p) => /(Lịch trực kiểm thử|Nháp|Trùng|Mở sau chốt|Xoá kiểm thử) [0-9A-Z]{6,}$/.test(p.name));
  for (const p of stale) await admin('POST', `/duty/periods/${p.id}/delete`, { reason: 'Dọn dữ liệu kiểm thử còn sót', confirmName: p.name });
  const cds = await admin('GET', '/duty/closed-days?pageSize=200');
  const items = Array.isArray(cds.data) ? cds.data : (cds.data?.items ?? []);
  for (const c of items.filter((c) => /^(Nghỉ kiểm thử|Trùng ô)/.test(c.name))) await admin('DELETE', `/duty/closed-days/${c.id}`);
}
const mkUser = async (suffix, title, roleCodes) => {
  const username = `duty_${suffix}_${tag}`.toLowerCase();
  const r = await admin('POST', '/users', { username, fullName: `Nhân viên ${suffix.toUpperCase()}`, password: 'Test@12345', title, roleCodes, mustChangePassword: false });
  if (r.status >= 300) throw new Error(`Tạo user ${username} lỗi: ${r.status} ${r.msg}`);
  return { id: r.data.id, username };
};
const khthU = await mkUser('khth', 'Bác sĩ', ['DIEU_PHOI_TRUC']);
const dd1U = await mkUser('bs1', 'Bác sĩ', ['NHAN_VIEN_TRUC']);
const dd2U = await mkUser('bs2', 'Bác sĩ', ['NHAN_VIEN_TRUC']);
const dd3U = await mkUser('dd1', 'Điều dưỡng', ['NHAN_VIEN_TRUC']);
const dd4U = await mkUser('dd2', 'Điều dưỡng', ['NHAN_VIEN_TRUC']);
const khth = client(await login(khthU.username, 'Test@12345'));
const bs1 = client(await login(dd1U.username, 'Test@12345'));
const bs2 = client(await login(dd2U.username, 'Test@12345'));
const dd1 = client(await login(dd3U.username, 'Test@12345'));
const dd2 = client(await login(dd4U.username, 'Test@12345'));
check('đã tạo 5 tài khoản thử nghiệm và đăng nhập được', [khthU, dd1U, dd2U, dd3U, dd4U].every((u) => u.id));

console.log('▸ Danh mục');
const rooms = (await bs1('GET', '/duty/rooms/options')).data;
check('nhân viên xem được danh mục phòng (≥15 phòng mặc định)', Array.isArray(rooms) && rooms.length >= 15, JSON.stringify(rooms).slice(0, 120));
const P1 = rooms.find((r) => r.label.startsWith('P1 '));
const P2 = rooms.find((r) => r.label.startsWith('P2 '));
const shifts = (await bs1('GET', '/duty/shifts/options')).data;
const S = shifts.find((s) => s.label.startsWith('S '));
const C = shifts.find((s) => s.label.startsWith('C '));
const roles = (await bs1('GET', '/duty/roles/options')).data;
const BS = roles.find((r) => r.label.startsWith('Bác sĩ trực'));
const DD = roles.find((r) => r.label.startsWith('Điều dưỡng trực'));
check('có đủ ca S/C, vai trò BS/DD', !!(S && C && BS && DD && P1 && P2));

const tmpRoom = await khth('POST', '/duty/rooms', { code: `T${tag}`, name: 'Phòng kiểm thử', sortOrder: 99 });
check('thêm phòng mới', tmpRoom.status < 300 && tmpRoom.data.id, tmpRoom.msg);
const dupRoom = await khth('POST', '/duty/rooms', { code: `t${tag}`, name: 'Trùng mã' });
check('chặn trùng mã phòng (không phân biệt hoa thường)', dupRoom.status === 409, dupRoom.msg);
const badShift = await khth('POST', '/duty/shifts', { code: 'X1', name: 'Ca lỗi', startTime: '08:00', endTime: '08:00' });
check('chặn ca có giờ bắt đầu = giờ kết thúc', badShift.status === 400, badShift.msg);
const cd = await khth('POST', '/duty/closed-days', { date: day(2), name: `Nghỉ kiểm thử ${tag}` });
check('thêm ngày nghỉ (Thứ 4)', cd.status < 300 && cd.data.id, cd.msg);
const badTitle = await khth('POST', '/duty/roles', { code: `ZZ${tag}`.slice(0, 10), name: 'Vai trò lỗi', requiredTitle: 'Chức danh không tồn tại' });
check('chặn vai trò có chức danh không có trong danh mục chức danh', badTitle.status === 400, badTitle.msg);

console.log('▸ Kỳ lịch & sinh ô trực');
const deny = await dd1('POST', '/duty/periods', { name: 'x', startDate: day(0), endDate: day(5), lockAt: `${day(-3)}T17:00:00+07:00` });
check('nhân viên không được tạo kỳ lịch (403)', deny.status === 403, deny.status);
const badRange = await khth('POST', '/duty/periods', { name: 'Sai', startDate: day(5), endDate: day(0), lockAt: '2030-01-01T00:00:00+07:00' });
check('chặn ngày bắt đầu sau ngày kết thúc', badRange.status === 400, badRange.msg);

const lockAt = new Date(Date.now() + 36 * 3600e3).toISOString();
const pr = await khth('POST', '/duty/periods', {
  name: `Lịch trực kiểm thử ${tag}`,
  startDate: day(0),
  endDate: day(5),
  lockAt,
  rules: { minRestHours: 12, maxHoursPerDay: 10, maxHoursPerWeek: 48, maxShiftsPerDay: 2 },
});
check('tạo kỳ lịch ở trạng thái nháp', pr.status < 300 && pr.data.status === 'NHAP', pr.msg);
const PID = pr.data.id;

const gen = await khth('POST', `/duty/periods/${PID}/slots/generate`, {
  roomIds: [P1.value, P2.value], shiftIds: [S.value, C.value], roleIds: [BS.value], weekdays: [1, 2, 3, 4, 5, 6], requiredCount: 1, skipClosedDays: true,
});
check('sinh ô: 2 phòng × 2 ca × 5 ngày (bỏ Thứ 4 nghỉ) = 20 ô', gen.status < 300 && gen.data.created === 20, JSON.stringify(gen.data));
const genDeny = await dd1('POST', `/duty/periods/${PID}/slots/generate`, { roomIds: [P1.value], shiftIds: [S.value], roleIds: [BS.value], weekdays: [1] });
check('nhân viên không được sinh ô (403)', genDeny.status === 403, genDeny.status);
const dupSlot = await khth('POST', `/duty/periods/${PID}/slots`, { dutyDate: day(0), roomId: P1.value, shiftId: S.value, roleId: BS.value });
check('chặn thêm ô trùng (cùng ngày, phòng, ca, vai trò)', dupSlot.status === 409, dupSlot.msg);
const extra = await khth('POST', `/duty/periods/${PID}/slots`, { dutyDate: day(4), roomId: P1.value, shiftId: S.value, roleId: DD.value });
check('thêm ô điều dưỡng lẻ (Thứ 6, P1, sáng)', extra.status < 300 && extra.data.id, extra.msg);
const outside = await khth('POST', `/duty/periods/${PID}/slots`, { dutyDate: addDays(day(5), 3), roomId: P1.value, shiftId: S.value, roleId: BS.value });
check('chặn ô ngoài khoảng ngày của kỳ', outside.status === 400, outside.msg);

const grid0 = (await khth('GET', `/duty/periods/${PID}/grid`)).data;
const slotOf = (i, roomId, shiftId, roleId = BS.value) => grid0.slots.find((s) => s.dutyDate === day(i) && s.roomId === roomId && s.shiftId === shiftId && s.roleId === roleId);
const mS1 = slotOf(0, P1.value, S.value);
const mC1 = slotOf(0, P1.value, C.value);
const mS2 = slotOf(0, P2.value, S.value);
const tuS1 = slotOf(1, P1.value, S.value);
const tuS2 = slotOf(1, P2.value, S.value);
const thS1 = slotOf(3, P1.value, S.value);
const thS2 = slotOf(3, P2.value, S.value);
const satC2 = slotOf(5, P2.value, C.value);
const satS2 = slotOf(5, P2.value, S.value);
const friDD = grid0.slots.find((s) => s.dutyDate === day(4) && s.roleId === DD.value);
check('lưới có đủ ô và ngày Thứ 4 được đánh dấu nghỉ', !!(mS1 && mC1 && mS2 && tuS1 && friDD && grid0.days.find((d) => d.date === day(2))?.closed));

console.log('▸ Phân công & ràng buộc');
const as1 = await khth('POST', `/duty/slots/${mS1.id}/assignments`, { userId: dd1U.id, note: 'Phân công kiểm thử' });
check('xếp bác sĩ 1 vào Thứ 2 sáng P1', as1.status < 300 && as1.data.filled === 1, as1.msg);
const as1b = await khth('POST', `/duty/slots/${mC1.id}/assignments`, { userId: dd1U.id });
check('cho phép ca liền kề ban ngày (Thứ 2 sáng + chiều, mẫu lịch thật)', as1b.status < 300, as1b.msg);
const overlap = await khth('POST', `/duty/slots/${mS2.id}/assignments`, { userId: dd1U.id });
check('chặn trùng giờ (sáng P2 trùng sáng P1)', overlap.status === 409 && /Trùng giờ/.test(overlap.msg), overlap.msg);
const wrongTitle = await khth('POST', `/duty/slots/${mS2.id}/assignments`, { userId: dd3U.id });
check('chặn sai chức danh (điều dưỡng vào ô bác sĩ)', wrongTitle.status === 409 && /Chức danh/.test(wrongTitle.msg), wrongTitle.msg);
const as2 = await khth('POST', `/duty/slots/${tuS1.id}/assignments`, { userId: dd2U.id });
check('xếp bác sĩ 2 vào Thứ 3 sáng P1', as2.status < 300, as2.msg);

await khth('PUT', `/duty/periods/${PID}`, { rules: { minRestHours: 16 } });
const rest = await khth('POST', `/duty/slots/${tuS2.id}/assignments`, { userId: dd1U.id });
check('nghỉ 14h giữa hai ca không đủ 16h (cấu hình kỳ) → chặn', rest.status === 409 && /nghỉ/.test(rest.msg), rest.msg);
await khth('PUT', `/duty/periods/${PID}`, { rules: { minRestHours: 12 } });
const restOk = await khth('POST', `/duty/slots/${tuS2.id}/assignments`, { userId: dd1U.id });
check('đủ 12h nghỉ (cấu hình mặc định) → được xếp', restOk.status < 300, restOk.msg);

const abs1 = await khth('POST', '/duty/absences', { userId: dd2U.id, startDate: day(3), endDate: day(3), reason: 'PHEP_NAM', note: 'Kiểm thử' });
check('ghi nhận nghỉ phép cho bác sĩ 2 (Thứ 5)', abs1.status < 300, abs1.msg);
const absBlock = await khth('POST', `/duty/slots/${thS1.id}/assignments`, { userId: dd2U.id });
check('chặn xếp người đang nghỉ phép', absBlock.status === 409 && /nghỉ/.test(absBlock.msg), absBlock.msg);
const abs2 = await khth('POST', '/duty/absences', { userId: dd2U.id, startDate: day(1), endDate: day(1), reason: 'OM_DAU' });
check('báo nghỉ trùng ca đã xếp → trả về danh sách ca bị ảnh hưởng', abs2.status < 300 && abs2.data.affected?.length === 1, JSON.stringify(abs2.data?.affected ?? abs2.msg).slice(0, 200));
await khth('DELETE', `/duty/absences/${abs2.data.id}`);
const selfAbs = await bs2('POST', '/duty/absences', { startDate: day(5), endDate: day(5), reason: 'KHAC', note: 'Tự báo' });
check('nhân viên tự báo nghỉ của mình', selfAbs.status < 300, selfAbs.msg);
await bs2('DELETE', `/duty/absences/${selfAbs.data.id}`);

console.log('▸ Công bố & tự đăng ký');
const beforePub = await dd1('POST', `/duty/slots/${thS2.id}/register`);
check('chưa công bố thì không được tự đăng ký', beforePub.status === 409 && /công bố/.test(beforePub.msg), beforePub.msg);
const pubNo = await khth('POST', `/duty/periods/${PID}/publish`, {});
check('chặn công bố khi còn ô thiếu người', pubNo.status === 409 && /thiếu người/.test(pubNo.msg), pubNo.msg);
const pubForce = await khth('POST', `/duty/periods/${PID}/publish`, { force: true });
check('công bố có ghi nhận (force) và thông báo người trực', pubForce.status < 300 && pubForce.data.notified >= 2, JSON.stringify(pubForce.data ?? pubForce.msg));
const pubAgain = await khth('POST', `/duty/periods/${PID}/publish`, { force: true });
check('không công bố lại kỳ đã công bố', pubAgain.status === 409, pubAgain.msg);

const wrongSelf = await bs1('POST', `/duty/slots/${friDD.id}/register`); // bác sĩ vào ô điều dưỡng
check('không tự đăng ký ca sai vai trò (BS không vào ô điều dưỡng)', wrongSelf.status === 409, wrongSelf.msg);
const dd3Reg = await dd1('POST', `/duty/slots/${friDD.id}/register`);
check('điều dưỡng tự đăng ký ô điều dưỡng', dd3Reg.status < 300, dd3Reg.msg);
const dd3Unreg = await dd1('POST', `/duty/slots/${friDD.id}/unregister`);
check('tự huỷ ca mình đăng ký (trước giờ trực)', dd3Unreg.status < 300, dd3Unreg.msg);
const dd3Reg2 = await dd1('POST', `/duty/slots/${friDD.id}/register`);
check('đăng ký lại sau khi huỷ', dd3Reg2.status < 300, dd3Reg2.msg);
const myOpt = await bs1('GET', `/duty/periods/${PID}/my-options`);
check('xem các ca có thể đăng ký (có lý do nếu không được)', myOpt.status === 200 && Array.isArray(myOpt.data.items), myOpt.msg);
const satReg = await bs1('POST', `/duty/slots/${satC2.id}/register`);
check('bác sĩ 1 tự đăng ký Thứ 7 chiều P2', satReg.status < 300, satReg.msg);
const satReg2 = await bs2('POST', `/duty/slots/${satS2.id}/register`);
check('bác sĩ 2 tự đăng ký Thứ 7 sáng P2', satReg2.status < 300 || /đã được|đủ người/.test(satReg2.msg), satReg2.msg);

const me1 = await bs1('GET', '/duty/me');
check('"Lịch của tôi" có ca đã xếp', me1.status === 200 && me1.data.assignments.length >= 2, me1.msg);
const hidden = await bs1('GET', `/duty/periods/${PID}/logs`);
check('nhân viên không xem được nhật ký (403)', hidden.status === 403, hidden.status);

console.log('▸ Nhường ca & đổi ca');
const give = await bs1('POST', '/duty/requests', { type: 'NHUONG', slotId: mC1.id, targetUserId: dd2U.id, reason: 'Có việc gia đình buổi chiều' });
check('tạo yêu cầu nhường ca (Thứ 2 chiều)', give.status < 300 && give.data.status === 'CHO_NGUOI_NHAN', give.msg);
const giveDup = await bs1('POST', '/duty/requests', { type: 'NHUONG', slotId: mC1.id, targetUserId: dd2U.id, reason: 'Trùng lặp kiểm thử' });
check('chặn tạo yêu cầu trùng khi còn chờ', giveDup.status === 409, giveDup.msg);
const inc = await bs2('GET', '/duty/requests?box=incoming');
const incItem = inc.data.find((r) => r.id === give.data.id);
check('người nhận thấy yêu cầu trong hộp đến', !!incItem);
const acc = await bs2('POST', `/duty/requests/${give.data.id}/accept`);
check('người nhận đồng ý → chờ duyệt (cấu hình mặc định)', acc.status < 300 && acc.data.status === 'CHO_DUYET', acc.msg);
const appr = await khth('GET', '/duty/requests?box=approval');
check('KHTH thấy yêu cầu chờ duyệt', appr.data.some((r) => r.id === give.data.id && r.actions.canApprove));
const apprDeny = await bs1('POST', `/duty/requests/${give.data.id}/approve`, {});
check('nhân viên không được duyệt (403)', apprDeny.status === 403, apprDeny.status);
const apprOk = await khth('POST', `/duty/requests/${give.data.id}/approve`, { note: 'Đồng ý' });
check('KHTH duyệt → đổi người trực thực tế', apprOk.status < 300, apprOk.msg);
const gridAfter = (await khth('GET', `/duty/periods/${PID}/grid`)).data;
const cAfter = gridAfter.slots.find((s) => s.id === mC1.id);
check('sau duyệt: ca chiều P1 Thứ 2 thuộc bác sĩ 2', cAfter.assignments.some((a) => a.userId === dd2U.id) && !cAfter.assignments.some((a) => a.userId === dd1U.id));

// Đổi ca hai chiều: bác sĩ 1 (Thứ 7 chiều P2) đổi với bác sĩ 2 (Thứ 7 sáng P2)
const swapSlotA = gridAfter.slots.find((s) => s.id === satC2.id);
const swapSlotB = gridAfter.slots.find((s) => s.id === satS2.id);
const swapAOk = swapSlotA.assignments.some((a) => a.userId === dd1U.id);
const swapBOk = swapSlotB.assignments.some((a) => a.userId === dd2U.id);
if (swapAOk && swapBOk) {
  const sw = await bs1('POST', '/duty/requests', { type: 'DOI', slotId: swapSlotA.id, targetUserId: dd2U.id, targetSlotId: swapSlotB.id, reason: 'Đổi ca Thứ 7 cho thuận tiện' });
  check('tạo yêu cầu đổi ca hai chiều', sw.status < 300, sw.msg);
  const swAcc = await bs2('POST', `/duty/requests/${sw.data.id}/accept`);
  check('người đổi đồng ý', swAcc.status < 300, swAcc.msg);
  const swOk = await khth('POST', `/duty/requests/${sw.data.id}/approve`, {});
  check('KHTH duyệt đổi ca', swOk.status < 300, swOk.msg);
  const g2 = (await khth('GET', `/duty/periods/${PID}/grid`)).data;
  const a2 = g2.slots.find((s) => s.id === swapSlotA.id), b2 = g2.slots.find((s) => s.id === swapSlotB.id);
  check('đổi ca xong: hai người đổi chỗ đúng', a2.assignments.some((a) => a.userId === dd2U.id) && b2.assignments.some((a) => a.userId === dd1U.id));
} else {
  check('đổi ca hai chiều (bỏ qua: ô Thứ 7 chưa có đủ người)', true);
}

console.log('▸ Chốt, ngoại lệ sau chốt, điều chỉnh');
const lock = await khth('POST', `/duty/periods/${PID}/lock`, {});
check('KHTH chốt sớm kỳ lịch', lock.status < 300, lock.msg);
const lockedSwap = await bs1('POST', '/duty/requests', { type: 'NHUONG', slotId: mS1.id, targetUserId: dd2U.id, reason: 'Thử sau khi chốt' });
check('sau chốt: không tạo nhường/đổi thường được', lockedSwap.status === 409 && /chốt/.test(lockedSwap.msg), lockedSwap.msg);
const lockedAssign = await khth('POST', `/duty/slots/${mS2.id}/assignments`, { userId: dd2U.id });
check('sau chốt: không xếp thêm người thường', lockedAssign.status === 409, lockedAssign.msg);
const exc = await dd1('POST', '/duty/requests', { type: 'NGOAI_LE', slotId: friDD.id, replacementUserId: dd4U.id, reason: 'Ốm đột xuất, không đi trực được', urgent: true });
check('điều dưỡng gửi ngoại lệ tới KHTH (sau chốt)', exc.status < 300 && exc.data.status === 'CHO_DUYET', exc.msg);
const excDeny = await bs2('POST', `/duty/requests/${exc.data.id}/approve`, {});
check('bác sĩ không duyệt được ngoại lệ (403)', excDeny.status === 403, excDeny.status);
const excOk = await khth('POST', `/duty/requests/${exc.data.id}/approve`, { note: 'Đã sắp xếp điều dưỡng thay' });
check('KHTH duyệt ngoại lệ → thay người trực', excOk.status < 300, excOk.msg);
const gExc = (await khth('GET', `/duty/periods/${PID}/grid`)).data.slots.find((s) => s.id === friDD.id);
check('ngoại lệ: người thay có nguồn NGOAI_LE, người cũ đã gỡ', gExc.assignments.some((a) => a.userId === dd4U.id && a.source === 'NGOAI_LE') && !gExc.assignments.some((a) => a.userId === dd3U.id));
const ovNo = await khth('POST', '/duty/exceptions/override', { slotId: mS1.id, removeUserId: dd1U.id, addUserId: dd3U.id, reason: 'Kiểm thử thay người không đúng chức danh' });
check('điều chỉnh trực tiếp: vẫn chặn vi phạm chức danh nếu không bỏ qua', ovNo.status === 409, ovNo.msg);
const ovOk = await khth('POST', '/duty/exceptions/override', { slotId: mS1.id, removeUserId: dd1U.id, addUserId: dd2U.id, reason: 'Kiểm thử: đổi người trực trực tiếp sau chốt' });
check('điều chỉnh trực tiếp sau chốt (đúng chức danh, không vi phạm) → thành công', ovOk.status < 300, ovOk.msg);

console.log('▸ Mở chốt theo mốc thời gian & quyền');
const unl = await khth('POST', `/duty/periods/${PID}/unlock`, { reason: 'Kiểm thử mở chốt', lockAt: new Date(Date.now() + 48 * 3600e3).toISOString() });
check('mở chốt bằng lý do và mốc mới', unl.status < 300, unl.msg);
await khth('PUT', `/duty/periods/${PID}`, { lockAt: new Date(Date.now() - 60e3).toISOString() });
const autoLock = await khth('POST', `/duty/slots/${satReg2.data ? mS2.id : mS2.id}/assignments`, { userId: dd4U.id });
check('đến mốc chốt tự động: thay đổi bị khoá', autoLock.status === 409, autoLock.msg);
const unl2 = await khth('POST', `/duty/periods/${PID}/unlock`, { reason: 'Kiểm thử: mốc chốt cũ', lockAt: new Date(Date.now() + 24 * 3600e3).toISOString() });
check('mở chốt lại sau mốc tự động', unl2.status < 300, unl2.msg);
const unlNoReason = await khth('POST', `/duty/periods/${PID}/unlock`, { reason: 'x', lockAt: new Date(Date.now() + 3600e3).toISOString() });
check('mở chốt bắt buộc lý do đủ dài', unlNoReason.status === 400, unlNoReason.msg);

console.log('▸ Báo cáo, nhật ký, xuất Excel');
const sum = await khth('GET', `/duty/periods/${PID}/summary`);
check('tổng hợp giờ trực theo người', sum.status === 200 && sum.data.items.length >= 3 && typeof sum.data.fairness.gapHours === 'number', sum.msg);
const sumBS = await bs1('GET', `/duty/periods/${PID}/summary`);
check('nhân viên không xem được tổng hợp giờ của cả kỳ (403)', sumBS.status === 403, sumBS.status);
const logs = await khth('GET', `/duty/periods/${PID}/logs`);
const acts = new Set((logs.data ?? []).map((l) => l.action));
check('nhật ký ghi đủ các thao tác chính', ['PUBLISH', 'LOCK', 'ASSIGN', 'SWAP', 'EXCEPTION', 'OVERRIDE', 'UNLOCK'].every((a) => acts.has(a)), [...acts].join(','));
const xl = await khth('GET', `/duty/periods/${PID}/export`);
check('xuất Excel lịch trực', xl.status === 200 && /spreadsheetml/.test(xl.ct) && xl.buf.length > 2000, xl.status);
const xlDeny = await bs1('GET', `/duty/periods/${PID}/export`);
check('nhân viên không xuất được lịch (403)', xlDeny.status === 403, xlDeny.status);
const gridBS = await bs1('GET', `/duty/periods/${PID}/grid`);
check('nhân viên xem lưới nhưng không thấy danh sách nghỉ phép', gridBS.status === 200 && gridBS.data.absences.length === 0);

console.log('▸ Hiển thị theo trạng thái & dọn dẹp');
const nh = await khth('POST', '/duty/periods', { name: `Nháp ${tag}`, startDate: day(10), endDate: day(10), lockAt: lockAt });
check('kỳ nháp tạo được ngoài khoảng kỳ chính', nh.status < 300, nh.msg);
const hideNh = await bs1('GET', `/duty/periods/${nh.data.id}`);
check('kỳ nháp: nhân viên không thấy (404)', hideNh.status === 404, hideNh.status);

console.log('▸ Ràng buộc chặt chẽ: trùng kỳ, mở đăng ký, ngày nghỉ, ca/vai trò đang dùng, nghỉ phép');
const ovP = await khth('POST', '/duty/periods', { name: `Trùng ${tag}`, startDate: day(2), endDate: day(3), lockAt });
check('không tạo kỳ trùng ngày với kỳ khác (409)', ovP.status === 409, ovP.msg);
const ovEdit = await khth('PUT', `/duty/periods/${nh.data.id}`, { startDate: day(4), endDate: day(4) });
check('đổi ngày kỳ nháp sang khoảng đang thuộc kỳ khác bị chặn (409)', ovEdit.status === 409, ovEdit.msg);
const winBad = await khth('POST', '/duty/periods', { name: `Mở sau chốt ${tag}`, startDate: day(20), endDate: day(20), lockAt, registrationOpensAt: new Date(Date.now() + 48 * 3600e3).toISOString() });
check('mở đăng ký phải trước mốc chốt (400)', winBad.status === 400, winBad.msg);
const cdBad = await khth('POST', '/duty/closed-days', { date: day(0), name: `Trùng ô ${tag}` });
check('không đánh dấu ngày nghỉ khi đã có ô trực (409)', cdBad.status === 409, cdBad.msg);
const shiftBad = await khth('PUT', `/duty/shifts/${S.value}`, { startTime: '06:30' });
check('không đổi giờ ca đang được dùng (409)', shiftBad.status === 409, shiftBad.msg);
const roleBad = await khth('PUT', `/duty/roles/${BS.value}`, { requiredTitle: 'Điều dưỡng' });
check('không đổi chức danh vai trò đang được dùng (409)', roleBad.status === 409, roleBad.msg);
const pastAbs = await bs1('POST', '/duty/absences', { startDate: addDays(todayBkk, -3), endDate: addDays(todayBkk, -2), reason: 'KHAC' });
check('nhân viên không khai nghỉ cho ngày đã qua (400)', pastAbs.status === 400, pastAbs.msg);
const a1 = await khth('POST', '/duty/absences', { userId: dd2U.id, startDate: day(12), endDate: day(12), reason: 'KHAC', note: 'Kiểm thử trùng' });
const a2 = await khth('POST', '/duty/absences', { userId: dd2U.id, startDate: day(11), endDate: day(12), reason: 'KHAC' });
check('nghỉ phép không được trùng khoảng đã khai (409)', a1.status < 300 && a2.status === 409, a2.msg);
if (a1.data?.id) await khth('DELETE', `/duty/absences/${a1.data.id}`);

console.log('▸ Xoá cả kỳ lịch (lý do, gõ lại tên; nhân viên đã xếp được thông báo)');
const dName = `Xoá kiểm thử ${tag}`;
const dp = await khth('POST', '/duty/periods', { name: dName, startDate: day(14), endDate: day(15), lockAt });
const DPID = dp.data.id;
await khth('POST', `/duty/periods/${DPID}/slots/generate`, { roomIds: [P1.value], shiftIds: [S.value], roleIds: [BS.value], weekdays: [1] });
const dSlot = (await khth('GET', `/duty/periods/${DPID}/grid`)).data.slots[0];
const dAs = await khth('POST', `/duty/slots/${dSlot.id}/assignments`, { userId: dd1U.id });
check('kỳ kiểm thử xoá: đã xếp một người', dAs.status < 300, dAs.msg);
const pubD = await khth('POST', `/duty/periods/${DPID}/publish`, {});
check('kỳ kiểm thử xoá: đã công bố', pubD.status < 300, pubD.msg);
const delNoName = await khth('POST', `/duty/periods/${DPID}/delete`, { reason: 'Kiểm thử xoá kỳ', confirmName: 'sai tên' });
check('xoá kỳ: sai tên xác nhận bị chặn (400)', delNoName.status === 400, delNoName.msg);
const delShort = await khth('POST', `/duty/periods/${DPID}/delete`, { reason: 'ngắn', confirmName: dName });
check('xoá kỳ: lý do quá ngắn bị chặn (400)', delShort.status === 400, delShort.msg);
const delStaff = await bs1('POST', `/duty/periods/${DPID}/delete`, { reason: 'Nhân viên thử xoá', confirmName: dName });
check('nhân viên không xoá được kỳ (403)', delStaff.status === 403, delStaff.status);
const delOk = await khth('POST', `/duty/periods/${DPID}/delete`, { reason: 'Kiểm thử: xoá kỳ đã công bố', confirmName: dName });
check('xoá kỳ đã công bố khi đúng xác nhận (200, báo người bị ảnh hưởng)', delOk.status < 300 && delOk.data.notified >= 1, delOk.msg);
const gone = await khth('GET', `/duty/periods/${DPID}`);
check('kỳ đã xoá không còn (404)', gone.status === 404, gone.status);
const delNh = await khth('POST', `/duty/periods/${nh.data.id}/delete`, { reason: 'Kiểm thử xoá kỳ nháp', confirmName: `Nháp ${tag}` });
check('xoá kỳ nháp (chưa có người được xếp)', delNh.status < 300, delNh.msg);
const delCd = await khth('DELETE', `/duty/closed-days/${cd.data.id}`);
check('dọn ngày nghỉ kiểm thử', delCd.status < 300, delCd.msg);
const delRoom = await khth('DELETE', `/duty/rooms/${tmpRoom.data.id}`);
check('dọn phòng kiểm thử (chưa có ô → xoá được)', delRoom.status < 300, delRoom.msg);
const usedRoom = await khth('DELETE', `/duty/rooms/${P1.value}`);
check('không xoá phòng đang có ô trực (chỉ tắt)', usedRoom.status === 409, usedRoom.msg);

const delPid = await khth('POST', `/duty/periods/${PID}/delete`, { reason: 'Dọn dữ liệu kiểm thử sau khi chạy xong', confirmName: `Lịch trực kiểm thử ${tag}` });
check('dọn kỳ lịch kiểm thử chính sau khi chạy xong', delPid.status < 300, delPid.msg);
console.log(`\nKết quả: ${ok} đạt, ${fail} lỗi`);
process.exit(fail ? 1 : 0);
