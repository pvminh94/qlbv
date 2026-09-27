'use client';

import { useQueryClient } from '@tanstack/react-query';
import {
  Camera, CameraOff, CheckCircle2, CloudOff, CloudUpload, RefreshCw, ScanLine, Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Pill } from '@/components/assets/asset-ui';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { ASSET_CONDITION } from '@/lib/assets';
import {
  getDeviceId, INVENTORY_RESULT, loadSession, saveSession, type InventoryItemRow, type ListedScan, type LocalSession, type ScanOutcome,
} from '@/lib/inventory';
import { cn, formatDateTime } from '@/lib/utils';
import type { InventoryDetail } from '@/app/(app)/tai-san/kiem-ke/[id]/page';

interface Detector {
  detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (o?: { formats?: string[] }) => Detector;
  }
}

/** Lấy mã từ nội dung QR (URL …/ts/<mã>) hoặc mã vạch thuần */
export function extractCode(raw: string): string {
  const s = raw.trim();
  const m = s.match(/\/ts\/([^/?#\s]+)/);
  return m ? decodeURIComponent(m[1]) : s;
}

const RES_COLOR: Record<string, string> = {
  FOUND: '#16a34a', DUPLICATE: '#64748b', EXTRA: '#9333ea', UNKNOWN: '#be185d', INVALID: '#dc2626',
  KHOP: '#16a34a', SAI_VI_TRI: '#2563eb', SAI_TINH_TRANG: '#d97706', THIEU: '#dc2626', THUA: '#9333ea', KHONG_RO: '#be185d',
};
const OUTCOME_LABEL: Record<string, string> = { FOUND: 'Tìm thấy', DUPLICATE: 'Đã quét', EXTRA: 'Ngoài phạm vi', UNKNOWN: 'Chưa có hồ sơ' };

/** Phiếu quét lớn, tối ưu cho điện thoại: camera / máy quét / nhập tay · lấy mẫu offline · đồng bộ nền */
export function InventoryScanPane({ id, detail: d }: { id: number; detail: InventoryDetail }) {
  const qc = useQueryClient();
  const [code, setCode] = useState('');
  const [session, setSession] = useState<LocalSession>({ id, savedAt: Date.now(), status: d.status, blind: d.blind && !d.can.seeExpected, expected: [], found: [], departments: [], locations: [], scans: [], edit: {} });
  const [last, setLast] = useState<{ code: string; outcome: ScanOutcome | null; local: boolean; scan: ListedScan } | null>(null);
  const [camera, setCamera] = useState(false);
  const [camErr, setCamErr] = useState('');
  const [prompt, setPrompt] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(true);
  const vib = (ms: number | number[]) => navigator.vibrate?.(ms);
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lastScan = useRef<{ code: string; t: number }>({ code: '', t: 0 });
  const syncingRef = useRef(false);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const bring = (s: LocalSession | ((x: LocalSession) => LocalSession)) => setSession((x) => { const n = typeof s === 'function' ? (s as (y: LocalSession) => LocalSession)(x) : s; saveSession(n); return n; });

  /* Khôi phục phiên địa phương khi vào trang */
  useEffect(() => {
    const old = loadSession(id);
    if (old && old.scans.length) {
      setSession(old);
      toast.info(`Đã khôi phục phiên: ${old.scans.filter((s) => !s.synced).length} lượt chưa đồng bộ`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  /* Theo dõi mạng */
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  /* Tải lấy mẫu offline (chỉ nhữ gì thiết bị cần lưu) */
  const [packLoading, setPackLoading] = useState(false);
  const ensurePack = async () => {
    if (sessionRef.current.expected.length) return;
    setPackLoading(true);
    try {
      const pack = await apiFetch<{
        items: { id: number; assetId: number | null; code: string; barcode: string; serialNumber: string; name: string; bookDepartmentId: number | null; bookLocationId: number | null; bookCondition: string; checkState: string; expected: boolean }[];
        departments: { id: number; name: string }[];
        locations: { id: number; name: string; level: number }[];
      }>(`/asset-inventories/${id}/offline-pack`);
      bring((s) => ({
        ...s,
        expected: pack.items.filter((i) => i.expected).map((i) => ({ code: i.code, barcode: i.barcode, serialNumber: i.serialNumber, name: i.name, departmentId: i.bookDepartmentId, locationId: i.bookLocationId, condition: i.bookCondition })),
        departments: pack.departments, locations: pack.locations,
      }));
      toast.success('Đã tải bộ nhớ offline — có thể quét khi mất mạng');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setPackLoading(false);
    }
  };
  useEffect(() => {
    if (session.scans.some((s) => !s.synced) && online) void sync();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online]);

  /* Đồng bộ hàng loạt lượt quét chưa gửi */
  const sync = async () => {
    if (syncingRef.current) return;
    const unsynced = sessionRef.current.scans.filter((s) => !s.synced);
    if (!unsynced.length) return;
    syncingRef.current = true;
    setSyncing(true);
    try {
      const r = await apiFetch<{ results: ScanOutcome[] }>(`/asset-inventories/${id}/scans`, {
        method: 'POST',
        body: {
          deviceId: getDeviceId(),
          scans: unsynced.map((s) => ({
            clientId: s.clientId, code: s.code, scannedAt: new Date(s.at).toISOString(), method: s.method,
            departmentId: s.departmentId, locationId: s.locationId, condition: s.condition || undefined,
          })),
        },
      });
      bring((ss) => ({
        ...ss,
        scans: ss.scans.map((x) => (x.synced ? x : { ...x, synced: true })),
      }));
      // Hiển thị nhận xét gần nhất từ máy chủ
      const mine = r.results.filter((x) => x.outcome !== 'DUPLICATE');
      if (mine.length) {
        const lastMine = mine[mine.length - 1];
        setLast((l) => (l && l.scan.clientId === lastMine.clientId ? { ...l, outcome: lastMine } : l));
      }
      void qc.invalidateQueries({ queryKey: ['asset-inventory', id] });
      void qc.invalidateQueries({ queryKey: ['asset-inventory-items', id] });
    } catch (e) {
      toast.error(`Chưa đồng bộ được: ${(e as Error).message} — hệ thống sẽ thử lại`);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
    }
  };

  /* Quét một mã */
  const doScan = async (raw: string, method: string) => {
    const c = extractCode(raw);
    if (!c) return;
    setCode('');
    const now = Date.now();
    // Chống quét trùng liên tiếp (máy quét/cĂmra bắn 2 lần)
    if (lastScan.current.code === c && now - lastScan.current.t < 2000) return;
    lastScan.current = { code: c, t: now };
    const s = sessionRef.current;
    const expectHit = s.expected.find((e) => [e.code, e.barcode, e.serialNumber].some((x) => x && x.toLowerCase() === c.toLowerCase()));
    const foundHit = s.found.find((e) => [e.code].some((x) => x && x.toLowerCase() === c.toLowerCase()));
    const name = expectHit?.name ?? foundHit?.name ?? '';
    const duplicate = !!s.scans.find((x) => extractCode(x.code).toLowerCase() === c.toLowerCase());
    const scan: ListedScan = {
      clientId: `${getDeviceId()}-${now}-${Math.random().toString(36).slice(2, 7)}`,
      code: c, at: now, method, departmentId: undefined, locationId: undefined, condition: '', synced: false,
    };
    // Nếu đang chờ ghi chú cho lượt trước → dùng lượt mới bắt đầu lại
    setPrompt(null);
    const localOutcome: ScanOutcome = { clientId: scan.clientId, code: c, outcome: duplicate ? 'DUPLICATE' : expectHit ? 'FOUND' : 'EXTRA', item: null };
    if (!expectHit && !duplicate) {
      // Quét ngoài sổ lấy mẫu: có thể thừa hoặc chưa có hồ sơ — máy chủ phân định
      localOutcome.outcome = 'EXTRA';
    }
    bring((ss) => ({ ...ss, scans: [scan, ...ss.scans], found: !duplicate && !expectHit && !foundHit ? [...ss.found, { code: c, name }] : ss.found }));
    setLast({ code: c, outcome: localOutcome, local: true, scan });
    vib(duplicate ? [60, 60, 60] : 60);
    if (online) void sync();
  };

  /* Camera */
  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    let timer = 0;
    let stopped = false;
    (async () => {
      if (!window.BarcodeDetector) {
        setCamErr('Trình duyệt này không hỗ trợ quét bằng camera (cần Chrome/Edge mới hoặc Android). Hãy dùng máy quét mã vạch hoặc nhập mã.');
        setCamera(false);
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        await video.current.play();
        const det = new window.BarcodeDetector({ formats: ['qr_code', 'code_128', 'code_39', 'ean_13'] });
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const r = await det.detect(video.current);
            const v = r[0]?.rawValue;
            if (v && (v !== lastScan.current.code || Date.now() - lastScan.current.t > 3000)) void doScan(v, 'CAMERA');
          } catch {
            /* khung hình lỗi */
          }
          timer = window.setTimeout(tick, 250);
        };
        void tick();
      } catch (e) {
        setCamErr(`Không mở được camera: ${(e as Error).message}`);
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const unsynced = session.scans.filter((s) => !s.synced).length;
  const known = session.expected.length;
  const myStats = useMemo(() => {
    const uniq = new Map<string, ListedScan>();
    for (const s of session.scans) {
      const c = extractCode(s.code).toLowerCase();
      if (!uniq.has(c)) uniq.set(c, s);
    }
    let found = 0; let extra = 0;
    for (const [c] of uniq) {
      const inExpected = session.expected.some((e) => e.code.toLowerCase() === c);
      if (inExpected) found++; else extra++;
    }
    return { unique: uniq.size, found, extra, offline: !online, useOffline: known > 0 };
  }, [session.scans, session.expected, online]);

  const progressTxt = session.blind
    ? `${myStats.unique} mã khác nhau${myStats.extra ? ` · ${myStats.extra} ngoài phạm vi` : ''}`
    : myStats.useOffline
      ? `${myStats.found}/${known} tài sản trong sổ${myStats.extra ? ` · ${myStats.extra} quét thêm` : ''}`
      : `Đã ghi ${myStats.unique} mã`;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {/* Thanh tiến độ + trạng thái mạng */}
        <Card className="p-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex-1">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-teal-700 dark:text-teal-400">{progressTxt}</span>
                <span className="text-[var(--muted-foreground)]">
                  {d.can.seeExpected ? `Toàn đợt: ${d.stats.checked}/${d.stats.expected} · ` : ''}{session.scans.length} lượt quét
                </span>
              </div>
              {myStats.useOffline && !session.blind ? (
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                  <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all" style={{ width: `${Math.min(100, (myStats.found / Math.max(1, known)) * 100)}%` }} />
                </div>
              ) : d.can.seeExpected && d.stats.expected ? (
                <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-[var(--muted)]">
                  <div className="h-full rounded-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all" style={{ width: `${Math.min(100, (d.stats.checked / d.stats.expected) * 100)}%` }} />
                </div>
              ) : null}
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              {online ? (
                <button onClick={() => void sync()} className="inline-flex items-center gap-1 rounded-lg bg-teal-50 px-2 py-1 font-medium text-teal-700 dark:bg-teal-950/50 dark:text-teal-300">
                  <RefreshCw className={cn('size-3.5', syncing && 'animate-spin')} />
                  {syncing ? 'Đang đồng bộ…' : unsynced ? `${unsynced} chờ đồng bộ` : 'Đã đồng bộ'}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1 rounded-lg bg-amber-100 px-2 py-1 font-semibold text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                  <CloudOff className="size-3.5" /> Offline — quét tiếp được, tự gửi khi có mạng
                </span>
              )}
              {!myStats.useOffline && (
                <Button size="sm" variant="outline" disabled={packLoading || !online} onClick={() => void ensurePack()}>
                  <CloudUpload className="size-3.5" /> {packLoading ? 'Đang tải…' : 'Tải cho chế độ offline'}
                </Button>
              )}
            </div>
          </div>
          {camErr && <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{camErr}</div>}
        </Card>

        {/* Ô quét */}
        <Card className="p-4">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void doScan(code, 'SCANNER');
              input.current?.focus();
            }}
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <ScanLine className="absolute left-3 top-[13px] size-5 text-teal-600" />
              <Input ref={input} autoFocus className="h-12 pl-10 font-mono text-lg" placeholder="Quét mã vạch/QR hoặc gõ mã rồi Enter…" value={code} onChange={(e) => setCode(e.target.value)} />
            </div>
            <Button type="button" variant={camera ? 'danger' : 'outline'} className="h-12 w-12 px-0" title={camera ? 'Tắt camera' : 'Quét bằng camera'} onClick={() => { setCamErr(''); setCamera((v) => !v); void ensurePack(); }}>
              {camera ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
            </Button>
          </form>
          {camera && (
            <div className="relative mx-auto mt-3 max-w-md overflow-hidden rounded-xl bg-black">
              <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
              <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-teal-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
            </div>
          )}
          <p className="mt-2 text-[11px] text-[var(--muted-foreground)]">
            Điện thoại: bật camera quét QR trên tem. Máy quét USB/Bluetooth hoạt động như bàn phím (gõ mã + Enter).
          </p>
        </Card>

        {/* Kết quả mã vừa quét */}
        {last && (
          <div
            className={cn('overflow-hidden rounded-[var(--radius-card)] border border-l-4 bg-[var(--card)]')}
            style={{ borderLeftColor: RES_COLOR[last.outcome?.result ?? last.outcome?.outcome ?? 'FOUND'] }}
          >
            <div className="flex flex-wrap items-start justify-between gap-2 p-4">
              <div className="min-w-0">
                <div className="font-mono text-sm font-bold">{last.code}</div>
                <div className="text-base font-semibold">
                  {last.outcome?.item?.name ?? session.expected.find((e) => e.code.toLowerCase() === last.code.toLowerCase())?.name ?? session.found.find((f) => f.code === last.code)?.name ?? (last.outcome?.outcome === 'UNKNOWN' ? '(Chưa có hồ sơ)' : '')}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  <Pill color={RES_COLOR[last.outcome?.outcome ?? 'FOUND']} className={last.outcome?.outcome === 'DUPLICATE' ? 'opacity-70' : ''}>
                    {OUTCOME_LABEL[last.outcome?.outcome ?? 'FOUND'] ?? last.outcome?.outcome}
                  </Pill>
                  {last.outcome?.result && last.outcome.result !== 'KHOP' && (
                    <Pill color={RES_COLOR[last.outcome.result]}>{INVENTORY_RESULT[last.outcome.result]?.label ?? last.outcome.result}</Pill>
                  )}
                  {last.outcome?.item && !last.outcome.item.checkState && null}
                  {!last.outcome?.item?.checkedByName && last.local && <span className="text-[10px] text-[var(--muted-foreground)]">{formatDateTime(new Date(last.scan.at).toISOString())}</span>}
                </div>
              </div>
              {!last.outcome?.item?.checkedByName && !last.scan.synced && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">chờ đồng bộ</span>}
            </div>
            {(last.outcome?.outcome === 'FOUND' || last.outcome?.item?.expected) && (
              <div className="flex flex-wrap items-center gap-2 border-t px-4 py-2.5 text-xs">
                <span className="text-[var(--muted-foreground)]">Ghi chú nhanh:</span>
                <select
                  className="h-8 rounded-lg border bg-transparent px-2"
                  value={last.scan.condition ?? ''}
                  onChange={(e) => {
                    const v = e.target.value;
                    bring((ss) => ({ ...ss, scans: ss.scans.map((x) => (x.clientId === last.scan.clientId ? { ...x, condition: v, synced: v === (x.condition ?? '') && x.synced ? x.synced : false } : x)) }));
                  }}
                >
                  <option value="">Tình trạng như sổ sách</option>
                  {Object.entries(ASSET_CONDITION).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
                {unsynced > 0 && (
                  <Button size="sm" variant="outline" onClick={() => void sync()} disabled={syncing || !online}>
                    <CloudUpload className="size-3.5" /> Ghi chú & đồng bộ
                  </Button>
                )}
              </div>
            )}
            {last.outcome?.item && (
              <div className="grid gap-2 border-t px-4 py-2.5 text-xs sm:grid-cols-3">
                <div><span className="text-[var(--muted-foreground)]">Sổ sách: </span>{last.outcome.item.bookDepartmentName ?? 'Kho'}{last.outcome.item.bookLocationName ? ` · ${last.outcome.item.bookLocationName}` : ''}</div>
                <div><span className="text-[var(--muted-foreground)]">Thực tế: </span>{last.outcome.item.actualDepartmentName ?? 'Kho'}{last.outcome.item.actualLocationName ? ` · ${last.outcome.item.actualLocationName}` : ''}</div>
                <div><span className="text-[var(--muted-foreground)]">Ngườ i kiểm: </span>{last.outcome.item.checkedByName || '—'}</div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Nhật ký quét trên máy */}
      <Card className="max-h-[80vh] overflow-hidden">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <div className="text-sm font-semibold">Đã quét trên máy này ({session.scans.length})</div>
          {session.scans.length > 0 && (
            <button className="text-[var(--muted-foreground)] hover:text-red-600" title="Xoá lịch sử máy (đã đồng bộ)" onClick={() => { if (confirm('Xoá lịch sử trên máy? Lượt chưa đồng bộ vẫn giữ.')) bring((ss) => ({ ...ss, scans: ss.scans.filter((x) => !x.synced) })); }} aria-label="Xoá lịch sử">
              <Trash2 className="size-4" />
            </button>
          )}
        </div>
        <div className="thin-scroll max-h-[72vh] overflow-y-auto">
          {session.scans.map((s) => (
            <div key={s.clientId} className={cn('flex items-center gap-2 border-b px-4 py-2 text-xs', !s.synced && 'bg-amber-50/60 dark:bg-amber-950/20')}>
              {s.synced ? <CheckCircle2 className="size-3.5 shrink-0 text-teal-600" /> : <CloudOff className="size-3.5 shrink-0 text-amber-600" />}
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono font-semibold">{s.code}</div>
                <div className="truncate text-[10px] text-[var(--muted-foreground)]">
                  {formatDateTime(new Date(s.at).toISOString())} · {s.method}{s.condition ? ` · ${ASSET_CONDITION[s.condition] ?? s.condition}` : ''}
                </div>
              </div>
            </div>
          ))}
          {session.scans.length === 0 && <div className="p-8 text-center text-xs text-[var(--muted-foreground)]">Chưa quét mã nào trên máy này</div>}
        </div>
      </Card>
      
    </div>
  );
}
