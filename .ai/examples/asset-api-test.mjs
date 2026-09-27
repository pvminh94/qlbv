// Kiểm thử end-to-end API phân hệ tài sản: node .ai/examples/asset-api-test.mjs (API ở :4000, đã seed + demo)
const B = process.env.API ?? 'http://localhost:4000/api';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { ok++; console.log('  ✔', name); } else { fail++; console.log('  ✘', name, extra); } };
async function login(u, p) {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const j = await r.json(); return j.data?.accessToken ?? j.accessToken;
}
function client(tok) {
  return async (method, path, body, raw) => {
    const r = await fetch(`${B}${path}`, { method, headers: { authorization: `Bearer ${tok}`, ...(body && !raw ? { 'content-type': 'application/json' } : {}), ...(raw ? { 'content-type': 'application/octet-stream' } : {}) }, body: raw ?? (body ? JSON.stringify(body) : undefined) });
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('json')) { const j = await r.json(); return { status: r.status, data: j.data ?? j, msg: j.message }; }
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers };
  };
}
const admin = client(await login('admin', 'Admin@123'));
const tag = Date.now().toString(36).toUpperCase();

console.log('▸ Danh mục');
const cats = (await admin('GET', '/asset-catalogs/categories')).data;
check('có cây loại tài sản mặc định', cats.length >= 18 && cats[0].code === 'TBYT' && cats[1].level === 2, JSON.stringify(cats[0]));
const cdha = cats.find((c) => c.code === 'TBYT-CDHA'); const pc = cats.find((c) => c.code === 'CNTT-MT');
const loc = (await admin('POST', '/asset-catalogs/locations', { code: `KHU-A-${tag}`, name: 'Khu A', kind: 'KHU' })).data;
const room = (await admin('POST', '/asset-catalogs/locations', { code: `P101-${tag}`, name: 'Phòng 101', kind: 'PHONG', parentId: loc.id })).data;
check('vị trí con có path theo cha', room.path === `/${loc.id}/${room.id}/` && room.level === 2, JSON.stringify(room));
const cyc = await admin('PUT', `/asset-catalogs/locations/${loc.id}`, { parentId: room.id });
check('chặn vòng lặp cha–con', cyc.status === 400, cyc.msg);
const dupc = await admin('POST', '/asset-catalogs/funding', { code: 'nsnn', name: 'x' });
check('chặn trùng mã (không phân biệt hoa thường)', dupc.status === 409, dupc.msg);
const funds = (await admin('GET', '/asset-catalogs/funding')).data;
const opts = (await admin('GET', '/assets/options')).data;
const dept1 = opts.departments[0], dept2 = opts.departments[1];

console.log('▸ Tài sản');
const a1 = (await admin('POST', '/assets', { name: 'Máy siêu âm màu 4D', categoryId: cdha.id, model: 'LOGIQ P9', serialNumber: `SN-${tag}`, originalCost: 1_200_000_000, fundingSourceId: funds[0].id, acquisitionDate: '2024-03-15', lastCalibrationDate: '2025-10-01' })).data;
check('tạo tài sản: tự sinh mã theo tiền tố loại', /^CDHA\.2024\.\d{4}$/.test(a1.code), a1.code);
check('kế thừa khấu hao/kiểm định từ loại', a1.raw.annualRate === 12.5 && a1.raw.usefulLifeMonths === 96 && a1.raw.requiresCalibration === true, JSON.stringify(a1.raw).slice(0, 200));
check('tự tính hạn kiểm định = lần gần nhất + 12 tháng', a1.raw.nextCalibrationDate === '2026-10-01', a1.raw.nextCalibrationDate);
check('trạng thái mặc định Trong kho', a1.status === 'TRONG_KHO');
check('có lịch hao mòn dự kiến', a1.schedule.length > 0 && a1.schedule.at(-1).bookValue === 0, JSON.stringify(a1.schedule.slice(0, 2)));
const lot = (await admin('POST', '/assets', { name: 'Máy tính để bàn Dell', categoryId: pc.id, originalCost: 18_000_000, acquisitionDate: '2025-06-01', copies: 5, departmentId: dept1.id })).data;
check('tạo lô 5 tài sản, mỗi cái một mã', lot.count === 5 && lot.ids.length === 5, JSON.stringify(lot));
const list = (await admin('GET', `/assets?categoryId=${cats.find((c) => c.code === 'CNTT').id}&pageSize=100`)).data;
check('lọc theo cây loại (cha gồm cả con)', list.items.filter((i) => lot.ids.includes(i.id)).length === 5 && list.summary.cost >= 90_000_000);
const s1 = (await admin('GET', `/assets?q=${encodeURIComponent('may sieu am')}`)).data;
check('tìm không dấu', s1.items.some((i) => i.id === a1.id));
const lk = await admin('GET', `/assets/lookup/${encodeURIComponent(`sn-${tag}`)}`);
check('tra cứu theo serial (không phân biệt hoa thường)', lk.data?.id === a1.id, lk.msg);
const up = (await admin('PUT', `/assets/${a1.id}`, { originalCost: 1_250_000_000, note: 'Sửa khi chưa phát sinh' })).data;
check('sửa nguyên giá khi chưa phát sinh nghiệp vụ', up.originalCost === 1_250_000_000 && up.events[0].eventType === 'UPDATED');

console.log('▸ Chứng từ');
const cp = await admin('POST', '/asset-transactions', { type: 'CAP_PHAT', txDate: '2024-03-20', toDepartmentId: dept1.id, toLocationId: room.id, reason: 'Bàn giao sử dụng', items: [{ assetId: a1.id }], submit: true });
check('lập & gửi duyệt cấp phát', cp.data?.status === 'CHO_DUYET' && /^CP-202403-\d{3}$/.test(cp.data.code), cp.msg ?? cp.data?.code);
const busy = await admin('POST', '/asset-transactions', { type: 'BAO_HONG', items: [{ assetId: a1.id }] });
check('chặn tài sản sai trạng thái / đang chờ duyệt', busy.status === 400, busy.msg);
const ap = (await admin('POST', `/asset-transactions/${cp.data.id}/approve`)).data;
check('duyệt → áp dụng vào tài sản', ap.status === 'DA_DUYET' && ap.items[0].after.status === 'DANG_SU_DUNG' && ap.items[0].before.status === 'TRONG_KHO');
let d1 = (await admin('GET', `/assets/${a1.id}`)).data;
check('tài sản về khoa + vị trí + ngày sử dụng', d1.departmentId === dept1.id && d1.locationId === room.id && d1.inUseDate === '2024-03-20' && d1.locked === true);
const lockedEdit = await admin('PUT', `/assets/${a1.id}`, { originalCost: 1 });
check('khoá sửa nguyên giá sau khi phát sinh', lockedEdit.status === 400, lockedEdit.msg);
const dc = (await admin('POST', '/asset-transactions', { type: 'DIEU_CHUYEN', toDepartmentId: dept2.id, items: [{ assetId: a1.id }], approveNow: true })).data;
d1 = (await admin('GET', `/assets/${a1.id}`)).data;
check('điều chuyển (duyệt ngay) đổi khoa', dc.status === 'DA_DUYET' && d1.departmentId === dept2.id);
const bh = (await admin('POST', '/asset-transactions', { type: 'BAO_HONG', items: [{ assetId: a1.id, condition: 'HONG', note: 'Mất hình' }], approveNow: true })).data;
const sc = (await admin('POST', '/asset-transactions', { type: 'SUA_CHUA', items: [{ assetId: a1.id, amount: 15_000_000 }], approveNow: true })).data;
const hs = (await admin('POST', '/asset-transactions', { type: 'HOAN_THANH_SUA', items: [{ assetId: a1.id, amount: 14_500_000, condition: 'TOT' }], approveNow: true })).data;
d1 = (await admin('GET', `/assets/${a1.id}`)).data;
check('báo hỏng → sửa → hoàn thành: về Đang sử dụng, tình trạng Tốt', bh.status === 'DA_DUYET' && sc.status === 'DA_DUYET' && hs.status === 'DA_DUYET' && d1.status === 'DANG_SU_DUNG' && d1.condition === 'TOT', d1.status);
const kd = (await admin('POST', '/asset-transactions', { type: 'KIEM_DINH', txDate: '2026-09-01', items: [{ assetId: a1.id }], approveNow: true })).data;
d1 = (await admin('GET', `/assets/${a1.id}`)).data;
check('kiểm định → hạn kế tiếp +12 tháng', d1.raw.nextCalibrationDate === '2027-09-01', d1.raw.nextCalibrationDate);
check('dòng thời gian ghi đủ sự kiện', d1.events.length >= 7 && d1.transactions.length === 6, `${d1.events.length}/${d1.transactions.length}`);
const rj = await admin('POST', '/asset-transactions', { type: 'DE_NGHI_THANH_LY', items: [{ assetId: lot.ids[0] }], submit: true });
const rj2 = (await admin('POST', `/asset-transactions/${rj.data.id}/reject`, { reason: 'Còn dùng tốt' })).data;
check('từ chối chứng từ (bắt buộc lý do)', rj2.status === 'TU_CHOI' && rj2.rejectReason === 'Còn dùng tốt');
const txl = (await admin('GET', '/asset-transactions?pageSize=50')).data;
check('danh sách chứng từ + đếm', txl.total >= 7 && txl.items[0].typeLabel, JSON.stringify(txl.counts));

console.log('▸ Khấu hao / hao mòn');
// Dọn các kỳ đã chốt từ lần chạy trước (huỷ từ kỳ mới nhất) để test chạy lại được
for (const r of (await admin('GET', '/asset-depreciation/runs')).data.filter((r) => r.status === 'DA_CHOT').sort((a, b) => b.period.localeCompare(a.period))) {
  await admin('POST', `/asset-depreciation/runs/${r.id}/cancel`);
}
const pv = (await admin('GET', '/asset-depreciation/preview?period=2024')).data;
const l1 = pv.lines.find((l) => l.assetId === a1.id);
check('xem trước năm 2024: siêu âm 10 tháng × 12,5%', l1 && l1.amount === Math.ceil(1_250_000_000 * 0.125 * 10 / 12), JSON.stringify(l1));
const fut = await admin('GET', '/asset-depreciation/preview?period=2099');
check('chặn kỳ tương lai', fut.status === 400);
const run24 = (await admin('POST', '/asset-depreciation/runs', { period: '2024' })).data;
check('chốt kỳ 2024', run24.status === 'DA_CHOT' && run24.lines.some((l) => l.assetId === a1.id));
const again = await admin('POST', '/asset-depreciation/runs', { period: '2024' });
check('chặn chốt trùng kỳ', again.status === 409, again.msg);
const run25 = (await admin('POST', '/asset-depreciation/runs', { period: '2025' })).data;
d1 = (await admin('GET', `/assets/${a1.id}`)).data;
const exp = Math.ceil(1_250_000_000 * 0.125 * 10 / 12) + Math.ceil(1_250_000_000 * 0.125);
check('luỹ kế sau 2 kỳ đúng', d1.accumulatedDepreciation === exp && d1.lastDepreciationPeriod === '2025', `${d1.accumulatedDepreciation} vs ${exp}`);
const c24 = await admin('POST', `/asset-depreciation/runs/${run24.id}/cancel`);
check('chặn huỷ kỳ cũ khi còn kỳ sau', c24.status === 409, c24.msg);
await admin('POST', `/asset-depreciation/runs/${run25.id}/cancel`);
d1 = (await admin('GET', `/assets/${a1.id}`)).data;
check('huỷ kỳ 2025 → hoàn luỹ kế, kỳ gần nhất = 2024', d1.lastDepreciationPeriod === '2024' && d1.accumulatedDepreciation === Math.ceil(1_250_000_000 * 0.125 * 10 / 12), `${d1.lastDepreciationPeriod} ${d1.accumulatedDepreciation}`);
const xr = await admin('GET', `/asset-depreciation/runs/${run24.id}/export`);
check('xuất sổ khấu hao Excel', xr.status === 200 && xr.buf.slice(0, 2).toString() === 'PK');

console.log('▸ In tem, nhập/xuất, tổng quan');
const t1 = await admin('POST', '/assets/labels', { ids: [a1.id, ...lot.ids], layout: 'THERMAL', origin: 'https://qlbs.local' });
check('in tem nhiệt: PDF 6 trang', t1.status === 200 && t1.buf.slice(0, 4).toString() === '%PDF' && t1.headers.get('x-label-count') === '6', t1.status);
const t2 = await admin('POST', '/assets/labels', { ids: [a1.id, ...lot.ids], layout: 'SHEET', copies: 2, sheet: { skip: 3 } });
check('in decal A4: 12 tem, bỏ qua 3 ô', t2.status === 200 && t2.headers.get('x-label-count') === '12');
const bad = await admin('POST', '/assets/labels', { ids: [a1.id], layout: 'SHEET', sheet: { cols: 9 } });
check('báo lỗi lưới vượt khổ A4', bad.status === 400, bad.msg);
const ex = await admin('GET', '/assets/export?status=ACTIVE');
check('xuất Excel danh sách', ex.status === 200 && ex.buf.slice(0, 2).toString() === 'PK');
const tpl = await admin('GET', '/assets/import/template');
check('tải tệp mẫu nhập', tpl.status === 200 && tpl.buf.length > 5000);
const csv = `Mã tài sản,Tên tài sản,Loại tài sản,Nguyên giá,Khoa/phòng sử dụng,Ngày ghi tăng,Hao mòn luỹ kế đầu kỳ,Ngày số dư đầu kỳ,Hãng sản xuất,Trạng thái\nIMP-${tag}-1,Máy thở Hamilton,TBYT-HSCC,"850.000.000",${dept1.code},15/01/2022,300000000,31/12/2025,Hamilton Medical ${tag},Đang sử dụng\nIMP-${tag}-2,Monitor,Loại không có,abc,,32/13/2020,,,,\n`;
const dry = (await admin('POST', `/assets/import?name=t.csv&dryRun=true`, null, Buffer.from(csv))).data;
check('nhập chạy thử: 1 hợp lệ, 1 lỗi có lý do', dry.summary.create === 1 && dry.summary.error === 1 && dry.rows[1].errors.length >= 3, JSON.stringify(dry.rows?.[1]?.errors));
const csvOk = csv.split('\n').slice(0, 2).join('\n');
const real = (await admin('POST', `/assets/import?name=t.csv`, null, Buffer.from(csvOk))).data;
check('nhập thật: tạo tài sản + tự thêm hãng mới', real.summary.created === 1 && real.summary.newSuppliers.length === 1, JSON.stringify(real.summary));
const imp = (await admin('GET', `/assets/lookup/IMP-${tag}-1`)).data;
check('tài sản nhập có số dư đầu kỳ', imp.accumulatedDepreciation === 300_000_000 && imp.bookValue === 550_000_000);
const pv26 = (await admin('GET', '/asset-depreciation/preview?period=2026')).data;
const li = pv26.lines.find((l) => l.assetId === imp.id);
check('số dư đầu kỳ 31/12/2025 → tính tiếp từ 2026, không báo bỏ sót', li && li.amount === Math.ceil(850_000_000 * 0.125) && !li.warning, JSON.stringify(li));
const dash = (await admin('GET', '/assets/dashboard')).data;
check('tổng quan: tổng, cơ cấu, cảnh báo', dash.totals.count >= 7 && dash.byStatus.length && dash.byDepartment.length && dash.byCategory.length && Array.isArray(dash.upcoming), JSON.stringify(dash.totals));

console.log('▸ Phạm vi dữ liệu (trưởng khoa)');
const tkTok = await login('tk.nam', '123456');
if (tkTok) {
  const tk = client(tkTok);
  const me = (await tk('GET', '/auth/me')).data;
  const tl = await tk('GET', '/assets?pageSize=200');
  const myDepts = new Set([me?.departmentId, ...(me?.departmentIds ?? [])].filter(Boolean));
  check('trưởng khoa chỉ thấy tài sản khoa mình', tl.status === 200 && tl.data.items.every((i) => myDepts.has(i.departmentId)), `${tl.status} ${tl.data?.items?.length}`);
  const d = await tk('GET', `/assets/${a1.id}`);
  check('không xem được tài sản khoa khác', d.status === 403 || myDepts.has(d1.departmentId), d.status);
  const appr = await tk('POST', `/asset-transactions/${rj.data.id}/approve`);
  check('trưởng khoa không có quyền duyệt', appr.status === 403);
} else console.log('  (bỏ qua: không đăng nhập được tk.nam)');

console.log('▸ Xoá');
const del1 = await admin('DELETE', `/assets/${a1.id}`);
check('không xoá được tài sản đã phát sinh', del1.status === 409, del1.msg);
const del2 = await admin('DELETE', `/assets/${lot.ids[4]}`);
check('xoá tài sản chưa phát sinh + giải phóng mã', del2.status === 200);

console.log(`\n${ok} đạt · ${fail} lỗi`);
process.exit(fail ? 1 : 0);
