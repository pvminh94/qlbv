// Kiểm thử end-to-end GĐ2 tài sản (kiểm kê · báo cáo · lịch bảo trì · nhắc hạn):
//   node .ai/examples/asset-inventory-test.mjs    (API ở :4000, đã seed + demo)
const B = process.env.API ?? 'http://localhost:4000/api';
let ok = 0, fail = 0;
const check = (name, cond, extra = '') => { if (cond) { ok++; console.log('  ✔', name); } else { fail++; console.log('  ✘', name, extra); } };
async function login(u, p) {
  const r = await fetch(`${B}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: u, password: p }) });
  const j = await r.json(); return j.data?.accessToken ?? j.accessToken;
}
function client(tok) {
  return async (method, path, body) => {
    const r = await fetch(`${B}${path}`, { method, headers: { authorization: `Bearer ${tok}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('json')) { const j = await r.json(); return { status: r.status, data: j.data ?? j, msg: j.message }; }
    return { status: r.status, buf: Buffer.from(await r.arrayBuffer()), headers: r.headers };
  };
}
const admin = client(await login('admin', 'Admin@123'));
const tag = Date.now().toString(36).toUpperCase();
const opts = (await admin('GET', '/assets/options')).data;
const cats = (await admin('GET', '/asset-catalogs/categories')).data;
const pc = cats.find((c) => c.code === 'CNTT-MT');
// Khoa riêng cho test để phạm vi kiểm kê chỉ gồm tài sản do test tạo
const dept = (await admin('POST', '/departments', { code: `KT-${tag}`, name: `Khoa kiểm thử ${tag}`, type: 'LAM_SANG' })).data;
const deptX = opts.departments.find((d) => d.id !== dept?.id);
check('tạo khoa kiểm thử', dept?.id > 0, JSON.stringify(dept).slice(0, 200));
const room = (await admin('POST', '/asset-catalogs/locations', { code: `KK-P-${tag}`, name: `Phòng kiểm kê ${tag}`, kind: 'PHONG' })).data;

console.log('▸ Chuẩn bị tài sản');
const lot = (await admin('POST', '/assets', { name: `Máy tính kiểm kê ${tag}`, categoryId: pc.id, originalCost: 20_000_000, acquisitionDate: '2025-01-10', copies: 4, departmentId: dept.id, status: 'DANG_SU_DUNG', maintenanceIntervalMonths: 6, lastMaintenanceDate: '2025-06-01' })).data;
const other = (await admin('POST', '/assets', { name: `Máy in khoa khác ${tag}`, categoryId: pc.id, originalCost: 5_000_000, acquisitionDate: '2025-01-10', departmentId: deptX.id, status: 'DANG_SU_DUNG' })).data;
const A = await Promise.all(lot.ids.map(async (id) => (await admin('GET', `/assets/${id}`)).data));
check('tạo 4 tài sản trong khoa + 1 tài sản khoa khác', A.length === 4 && other.id > 0);

console.log('▸ Lập đợt kiểm kê');
const scope = { departmentIds: [dept.id], includeStore: false };
const pv = (await admin('POST', '/asset-inventories/scope-preview', { scope })).data;
check('xem trước phạm vi: đếm đúng 4 tài sản', pv.count === 4 && pv.cost === 80_000_000, JSON.stringify(pv));
const inv = (await admin('POST', '/asset-inventories', { name: `Kiểm kê cuối năm ${tag}`, scope, decisionNo: 'QĐ 123/QĐ-BV', committee: [{ name: 'Nguyễn Văn A', position: 'Phó Giám đốc', role: 'Chủ tịch hội đồng' }, { name: 'Trần Thị B', position: 'Kế toán', role: 'Uỷ viên' }] })).data;
check('lập đợt: mã KK-YYYY-###, trạng thái Nháp', /^KK-\d{4}-\d{3}$/.test(inv.code) && inv.status === 'NHAP', inv.code);
const early = await admin('POST', `/asset-inventories/${inv.id}/scans`, { scans: [{ code: A[0].code }] });
check('chưa bắt đầu thì không quét được', early.status === 409, early.msg);
const st = (await admin('POST', `/asset-inventories/${inv.id}/start`)).data;
check('bắt đầu: chốt sổ sách 4 tài sản', st.status === 'DANG_KIEM_KE' && st.stats.expected === 4 && st.snapshotAt, JSON.stringify(st.stats));
const scopeLock = await admin('PUT', `/asset-inventories/${inv.id}`, { scope: { departmentIds: [deptX.id] } });
check('đã chốt sổ thì không đổi được phạm vi', scopeLock.status === 409, scopeLock.msg);

console.log('▸ Quét mã');
const origin = 'https://qlbs.example.vn';
const batch = [
  { clientId: `${tag}-1`, code: A[0].code, method: 'CAMERA' },
  { clientId: `${tag}-2`, code: `${origin}/ts/${encodeURIComponent(A[1].code)}`, method: 'CAMERA' },
  { clientId: `${tag}-3`, code: A[2].code.toLowerCase(), departmentId: deptX.id, locationId: room.id, method: 'SCANNER' },
  { clientId: `${tag}-4`, code: other.code, method: 'SCANNER' },
  { clientId: `${tag}-5`, code: `KHONG-CO-${tag}`, method: 'MANUAL' },
  { clientId: `${tag}-6`, code: A[0].code, method: 'SCANNER' },
];
const sc = (await admin('POST', `/asset-inventories/${inv.id}/scans`, { scans: batch, deviceId: 'test' })).data;
const oc = sc.results.map((r) => r.outcome);
check('kết quả quét: FOUND, FOUND (từ URL QR), FOUND, EXTRA, UNKNOWN, DUPLICATE', JSON.stringify(oc) === JSON.stringify(['FOUND', 'FOUND', 'FOUND', 'EXTRA', 'UNKNOWN', 'DUPLICATE']), JSON.stringify(oc));
check('đối chiếu: khớp / sai vị trí / thừa / chưa có hồ sơ', sc.results[0].result === 'KHOP' && sc.results[2].result === 'SAI_VI_TRI' && sc.results[3].result === 'THUA' && sc.results[4].result === 'KHONG_RO', JSON.stringify(sc.results.map((r) => r.result)));
check('trả kèm thông tin tài sản để hiển thị', sc.results[1].item?.code === A[1].code && sc.results[2].item?.actualDepartmentName === deptX.name);
check('tiến độ: 3/4 đã kiểm', sc.stats.checked === 3 && sc.stats.pending === 1, JSON.stringify(sc.stats));
const again = (await admin('POST', `/asset-inventories/${inv.id}/scans`, { scans: batch })).data;
check('đồng bộ lại cùng lô (offline gửi lại) không bị trùng', again.results.every((r) => r.synced) && again.stats.checked === 3 && again.stats.THUA === 1, JSON.stringify(again.stats));
const older = (await admin('POST', `/asset-inventories/${inv.id}/scans`, { scans: [{ clientId: `${tag}-old`, code: A[2].code, departmentId: dept.id, scannedAt: '2020-01-01T00:00:00Z' }] })).data;
check('lượt quét cũ hơn (offline) không ghi đè kết quả mới', older.results[0].outcome === 'DUPLICATE' && older.results[0].result === 'SAI_VI_TRI', JSON.stringify(older.results[0]));

const items = (await admin('GET', `/asset-inventories/${inv.id}/items?pageSize=100`)).data.items;
const itemOf = (assetId) => items.find((i) => i.assetId === assetId);
const cond = (await admin('PUT', `/asset-inventories/${inv.id}/items/${itemOf(A[1].id).id}`, { actualCondition: 'HONG', note: 'Không lên nguồn' })).data;
check('ghi nhận tình trạng thực tế → Khác tình trạng', cond.result === 'SAI_TINH_TRANG' && cond.actualCondition === 'HONG', JSON.stringify(cond).slice(0, 200));
const f1 = (await admin('GET', `/asset-inventories/${inv.id}/items?result=SAI_VI_TRI`)).data;
check('lọc dòng theo kết quả', f1.total === 1 && f1.items[0].assetId === A[2].id);
const pack = (await admin('GET', `/asset-inventories/${inv.id}/offline-pack`)).data;
check('gói offline: đủ dòng, có danh mục khoa/vị trí', pack.items.length === 6 && pack.departments.length > 0 && pack.locations.some((l) => l.id === room.id), `${pack.items.length}`);
const expectedItem = items.find((i) => i.expected);
const delExpected = await admin('DELETE', `/asset-inventories/${inv.id}/items/${expectedItem.id}`);
check('không xoá được dòng thuộc sổ sách', delExpected.status === 400, delExpected.msg);

console.log('▸ Khoá số liệu / mở lại');
const fin = (await admin('POST', `/asset-inventories/${inv.id}/finish`, { conclusion: 'Cơ bản khớp sổ sách' })).data;
check('khoá số liệu: còn lại tự thành Thiếu, chờ duyệt', fin.status === 'CHO_DUYET' && fin.stats.THIEU === 1 && fin.stats.pending === 0, JSON.stringify(fin.stats));
const lateScan = await admin('POST', `/asset-inventories/${inv.id}/scans`, { scans: [{ code: A[3].code }] });
check('chờ duyệt thì không quét thêm', lateScan.status === 409);
const ro = (await admin('POST', `/asset-inventories/${inv.id}/reopen`)).data;
check('mở lại: dòng Thiếu tự động quay về chưa kiểm', ro.status === 'DANG_KIEM_KE' && ro.stats.THIEU === 0 && ro.stats.pending === 1, JSON.stringify(ro.stats));
await admin('POST', `/asset-inventories/${inv.id}/finish`, {});

console.log('▸ Xử lý chênh lệch');
const r1 = (await admin('POST', `/asset-inventories/${inv.id}/resolve`, { action: 'DIEU_CHUYEN' })).data;
check('điều chuyển: lập chứng từ nháp về đúng khoa thực tế', r1.created.length === 1 && r1.created[0].type === 'DIEU_CHUYEN' && r1.created[0].count === 1, JSON.stringify(r1));
const tx1 = (await admin('GET', `/asset-transactions/${r1.created[0].id}`)).data;
check('chứng từ điều chuyển đúng khoa/vị trí đích', tx1.toDepartmentId === deptX.id && tx1.toLocationId === room.id && tx1.status === 'NHAP' && tx1.items[0].assetId === A[2].id, JSON.stringify({ to: tx1.toDepartmentId, loc: tx1.toLocationId }));
const r2 = (await admin('POST', `/asset-inventories/${inv.id}/resolve`, { action: 'BAO_HONG' })).data;
check('báo hỏng tài sản ghi nhận hỏng khi kiểm kê', r2.created.length === 1 && r2.created[0].type === 'BAO_HONG', JSON.stringify(r2));
const r3 = (await admin('POST', `/asset-inventories/${inv.id}/resolve`, { action: 'BAO_MAT', submit: true })).data;
const tx3 = (await admin('GET', `/asset-transactions/${r3.created[0]?.id}`)).data;
check('báo mất tài sản thiếu, gửi duyệt luôn', r3.created[0]?.type === 'BAO_MAT' && tx3.status === 'CHO_DUYET' && tx3.items[0].assetId === A[3].id, JSON.stringify(r3));
const r4 = await admin('POST', `/asset-inventories/${inv.id}/resolve`, { action: 'BAO_MAT' });
check('không xử lý trùng lần hai', r4.status === 400, r4.msg);
const r5 = (await admin('POST', `/asset-inventories/${inv.id}/resolve`, { action: 'GHI_NHAN' })).data;
check('ghi nhận phần còn lại (thừa, chưa có hồ sơ)', r5.resolved === 2, JSON.stringify(r5));

console.log('▸ Biên bản / xuất Excel');
const pdf = await admin('GET', `/asset-inventories/${inv.id}/print`);
check('in biên bản kiểm kê PDF', pdf.status === 200 && pdf.buf.subarray(0, 4).toString() === '%PDF', `${pdf.status}`);
const pdf2 = await admin('GET', `/asset-inventories/${inv.id}/print?onlyDiff=true`);
check('in biên bản chỉ phần chênh lệch', pdf2.status === 200 && pdf2.buf.length > 1000);
const xl = await admin('GET', `/asset-inventories/${inv.id}/export`);
check('xuất Excel kết quả', xl.status === 200 && xl.buf.subarray(0, 2).toString() === 'PK');
if (process.env.SAVE) { const fs = await import('fs'); fs.writeFileSync('/tmp/kiem-ke.pdf', pdf.buf); }

console.log('▸ Duyệt hoàn tất');
const done = (await admin('POST', `/asset-inventories/${inv.id}/complete`, {})).data;
check('duyệt: Hoàn tất', done.status === 'HOAN_TAT' && done.approvedByName && done.summary.found >= 3, JSON.stringify(done.summary));
const a1 = (await admin('GET', `/assets/${A[1].id}`)).data;
check('tình trạng thực tế cập nhật vào hồ sơ', a1.raw?.condition === 'HONG' || a1.condition === 'HONG', a1.raw?.condition ?? a1.condition);
const a0 = (await admin('GET', `/assets/${A[0].id}`)).data;
check('ghi ngày kiểm kê + dòng thời gian', !!(a0.raw?.lastInventoryAt ?? a0.lastInventoryAt) && (a0.events ?? a0.timeline ?? []).some((e) => e.eventType === 'INVENTORY'), JSON.stringify((a0.events ?? a0.timeline ?? []).slice(0, 2)).slice(0, 200));
const again2 = await admin('POST', `/asset-inventories/${inv.id}/complete`, {});
check('không duyệt lại lần hai', again2.status === 409);
const lst = (await admin('GET', '/asset-inventories?pageSize=5')).data;
check('danh sách đợt kèm tiến độ + đếm theo trạng thái', lst.items[0].stats && lst.counts.HOAN_TAT >= 1, JSON.stringify(lst.counts));

console.log('▸ Phân quyền');
const tkTok = await login('tk.nam', '123456');
if (tkTok) {
  const tk = client(tkTok);
  const c1 = await tk('POST', '/asset-inventories', { name: 'x', scope });
  check('trưởng khoa không lập được đợt kiểm kê', c1.status === 403, `${c1.status}`);
  const d1 = await tk('GET', `/asset-inventories/${inv.id}`);
  check('trưởng khoa khác khoa không xem được đợt này', d1.status === 403, `${d1.status}`);
  const rp = await tk('GET', '/asset-reports/theo-khoa');
  check('trưởng khoa xem báo cáo theo phạm vi khoa mình', rp.status === 200 && rp.data.rows.filter((r) => !r._kind).length <= 2, `${rp.status} ${rp.data?.rows?.length}`);
} else console.log('  (bỏ qua — chưa có tài khoản demo tk.nam)');

console.log('▸ Báo cáo');
const cat = (await admin('GET', '/asset-reports')).data;
check('danh mục 8 báo cáo có tham số mặc định', cat.length === 8 && cat.find((c) => c.key === 'tang-giam').params[0].default?.length === 10);
for (const c of cat) {
  const r = await admin('GET', `/asset-reports/${c.key}`);
  check(`báo cáo "${c.title}"`, r.status === 200 && Array.isArray(r.data.rows) && r.data.columns.length > 3, `${r.status} ${r.msg ?? ''}`);
}
const ledger = (await admin('GET', `/asset-reports/so-tai-san?departmentId=${dept.id}&status=`)).data;
const tot = ledger.rows.find((r) => r._kind === 'total');
check('sổ TSCĐ: có dòng nhóm, cộng nhóm, tổng', ledger.rows.some((r) => r._kind === 'group') && ledger.rows.some((r) => r._kind === 'subtotal') && tot.originalCost === 80_000_000, JSON.stringify(tot));
const mv = (await admin('GET', `/asset-reports/tang-giam?from=2025-01-01&to=2025-12-31&groupBy=department`)).data;
const mvRow = mv.rows.find((r) => r.label === dept.name);
check('tăng giảm: tài sản ghi tăng 2025 nằm ở cột Tăng', mvRow?.iq === 4 && mvRow?.ic === 80_000_000, JSON.stringify(mvRow));
const cost = await admin('GET', '/asset-reports/chi-phi?view=supplier');
check('chi phí theo đơn vị thực hiện', cost.status === 200 && cost.data.chart?.type === 'pie');
const xls = await admin('GET', '/asset-reports/so-tai-san/export');
check('xuất Excel báo cáo', xls.status === 200 && xls.buf.subarray(0, 2).toString() === 'PK');
const rpdf = await admin('GET', `/asset-reports/tang-giam/print?from=2025-01-01&to=2025-12-31`);
check('in PDF báo cáo', rpdf.status === 200 && rpdf.buf.subarray(0, 4).toString() === '%PDF');
if (process.env.SAVE) { const fs = await import('fs'); fs.writeFileSync('/tmp/bao-cao.pdf', rpdf.buf); fs.writeFileSync('/tmp/so-ts.pdf', (await admin('GET', `/asset-reports/so-tai-san/print`)).buf); }
const bad = await admin('GET', '/asset-reports/khong-co');
check('báo cáo không tồn tại → 404', bad.status === 404);

console.log('▸ Lịch bảo trì');
const sch = (await admin('GET', `/asset-reports/schedule?from=2025-12-01&to=2026-12-31&departmentId=${dept.id}`)).data;
const mt = sch.events.filter((e) => e.kind === 'maintenance' && lot.ids.includes(e.assetId));
check('lịch: hạn bảo dưỡng + lần lặp dự kiến theo chu kỳ 6 tháng', mt.some((e) => e.date === '2025-12-01' && !e.projected) && mt.some((e) => e.date === '2026-06-01' && e.projected), JSON.stringify(mt.slice(0, 3).map((e) => [e.date, e.projected])));
check('lịch: hạn đã qua nằm trong danh sách quá hạn', sch.overdue.some((e) => lot.ids.includes(e.assetId)), `${sch.overdue.length}`);

console.log('▸ Nhắc hạn (tác vụ định kỳ)');
const jobs = (await admin('GET', '/jobs?pageSize=100')).data;
const job = (jobs.items ?? jobs).find((j) => j.code === 'NHAC_HAN_TAI_SAN');
check('có tác vụ NHAC_HAN_TAI_SAN', !!job && job.handler === 'asset.due-reminder');
if (job) {
  await admin('POST', `/jobs/${job.id}/run`);
  let run;
  for (let i = 0; i < 20 && !run; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const runs = (await admin('GET', `/jobs/runs?jobId=${job.id}&pageSize=5`)).data;
    run = (runs.items ?? runs).find((x) => (x.jobId ?? x.job_id) === job.id && ['SUCCESS', 'FAILED', 'THANH_CONG', 'LOI'].includes(String(x.status).toUpperCase()));
  }
  check('chạy nhắc hạn thành công', run && /SUCCESS|THANH_CONG/i.test(run.status), JSON.stringify(run).slice(0, 300));
  const notes = (await admin('GET', '/notifications?limit=20')).data.items;
  check('quản trị nhận thông báo nhắc hạn', notes.some((n) => n.title.startsWith('Nhắc hạn thiết bị') && n.link === '/tai-san/bao-tri'), JSON.stringify(notes.slice(0, 2).map((n) => n.title)));
}

console.log(`\n${ok} đạt · ${fail} lỗi`);
process.exit(fail ? 1 : 0);
