'use client';

import { Camera, CameraOff, ExternalLink, ScanLine, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { AssetStatus, AssetSubnav, DueBadge, Field } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { type AssetRow, money, useAssetMeta } from '@/lib/assets';
import { useAuth } from '@/lib/auth';
import { cn, formatDate } from '@/lib/utils';

type Hit = { at: string; code: string; ok: boolean; asset?: AssetRow; error?: string };

interface Detector {
  detect(src: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
declare global {
  interface Window {
    BarcodeDetector?: new (o?: { formats?: string[] }) => Detector;
  }
}

/** Lấy mã từ nội dung QR (URL …/ts/<mã>) hoặc mã vạch thuần */
function extractCode(raw: string): string {
  const s = raw.trim();
  const m = s.match(/\/ts\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : s;
}

export default function AssetScanPage() {
  const can = useAuth((s) => s.can);
  const meta = useAssetMeta();
  const [code, setCode] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [current, setCurrent] = useState<Hit | null>(null);
  const [camera, setCamera] = useState(false);
  const [camErr, setCamErr] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lastScan = useRef<{ code: string; t: number }>({ code: '', t: 0 });

  const lookup = async (raw: string) => {
    const c = extractCode(raw);
    if (!c) return;
    const at = new Date().toLocaleTimeString('vi-VN');
    try {
      const a = await apiFetch<AssetRow>(`/assets/lookup/${encodeURIComponent(c)}`);
      const h = { at, code: c, ok: true, asset: a };
      setCurrent(h);
      setHits((x) => [h, ...x].slice(0, 50));
      if (navigator.vibrate) navigator.vibrate(60);
    } catch (e) {
      const h = { at, code: c, ok: false, error: (e as Error).message };
      setCurrent(h);
      setHits((x) => [h, ...x].slice(0, 50));
    }
  };

  // Camera: dùng BarcodeDetector của trình duyệt (Chrome/Edge/Android) — không cần thư viện ngoài
  useEffect(() => {
    if (!camera) return;
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    (async () => {
      if (!window.BarcodeDetector) {
        setCamErr('Trình duyệt không hỗ trợ quét bằng camera (cần Chrome/Edge mới, hoặc Android). Hãy dùng máy quét mã vạch hoặc nhập mã.');
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
            const now = Date.now();
            if (v && (v !== lastScan.current.code || now - lastScan.current.t > 3000)) {
              lastScan.current = { code: v, t: now };
              void lookup(v);
            }
          } catch {
            /* khung hình lỗi — bỏ qua */
          }
          raf = window.setTimeout(tick, 250) as unknown as number;
        };
        tick();
      } catch (e) {
        setCamErr(`Không mở được camera: ${(e as Error).message}`);
        setCamera(false);
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [camera]);

  const a = current?.asset;
  const txTypes = a ? Object.entries(meta.data?.txTypes ?? {}).filter(([k, t]) => k !== 'GHI_TANG' && t.allowed.includes(a.status)) : [];

  return (
    <div className="space-y-4">
      <PageHeader breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>} title="Quét mã / tra cứu nhanh" description="Dùng máy quét mã vạch (USB/Bluetooth), camera điện thoại hoặc gõ mã tài sản, mã vạch, số serial." />
      <AssetSubnav />

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card className="p-4">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void lookup(code);
                setCode('');
                input.current?.focus();
              }}
              className="flex gap-2"
            >
              <div className="relative flex-1">
                <ScanLine className="absolute left-3 top-3 size-5 text-teal-600" />
                <Input ref={input} autoFocus className="h-11 pl-10 font-mono text-lg" placeholder="Quét hoặc nhập mã rồi Enter…" value={code} onChange={(e) => setCode(e.target.value)} />
              </div>
              <Button type="submit" className="h-11 bg-teal-600 hover:bg-teal-700">
                Tra cứu
              </Button>
              <Button type="button" variant={camera ? 'danger' : 'outline'} className="h-11" onClick={() => (setCamErr(''), setCamera((v) => !v))}>
                {camera ? <CameraOff className="size-5" /> : <Camera className="size-5" />}
              </Button>
            </form>
            {camErr ? <div className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">{camErr}</div> : null}
            {camera ? (
              <div className="relative mx-auto mt-3 max-w-md overflow-hidden rounded-xl bg-black">
                <video ref={video} className="aspect-video w-full object-cover" muted playsInline />
                <div className="pointer-events-none absolute inset-8 rounded-xl border-2 border-teal-400/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" />
              </div>
            ) : null}
          </Card>

          {current ? (
            current.ok && a ? (
              <Card className="overflow-hidden">
                <div className="flex flex-wrap items-start justify-between gap-2 border-b bg-gradient-to-r from-teal-50 to-transparent px-4 py-3">
                  <div>
                    <div className="font-mono text-sm font-bold text-teal-700">{a.code}</div>
                    <div className="text-lg font-semibold">{a.name}</div>
                  </div>
                  <AssetStatus status={a.status} />
                </div>
                <div className="grid gap-4 p-4 sm:grid-cols-3">
                  <Field label="Khoa/phòng">{a.departmentName ?? 'Kho'}</Field>
                  <Field label="Vị trí">{a.locationName}</Field>
                  <Field label="Người giữ">{a.custodianName}</Field>
                  <Field label="Model / serial">{[a.model, a.serialNumber].filter(Boolean).join(' · ')}</Field>
                  <Field label="Nguyên giá">{money(a.originalCost)} đ</Field>
                  <Field label="Còn lại">{money(a.bookValue)} đ</Field>
                  <Field label="Ngày ghi tăng">{a.acquisitionDate ? formatDate(a.acquisitionDate) : null}</Field>
                  <Field label="Hạn kiểm định">{a.nextCalibrationDate ? <DueBadge date={a.nextCalibrationDate} /> : null}</Field>
                  <Field label="Hạn bảo dưỡng">{a.nextMaintenanceDate ? <DueBadge date={a.nextMaintenanceDate} /> : null}</Field>
                </div>
                <div className="flex flex-wrap gap-2 border-t px-4 py-3">
                  <Link href={`/tai-san/${a.id}`}>
                    <Button size="sm" className="bg-teal-600 hover:bg-teal-700">
                      <ExternalLink className="size-4" /> Mở hồ sơ
                    </Button>
                  </Link>
                  {can('asset.transaction.create')
                    ? txTypes.slice(0, 6).map(([k, t]) => (
                        <Link key={k} href={`/tai-san/nghiep-vu/tao-moi?type=${k}&ids=${a.id}`}>
                          <Button size="sm" variant="outline">
                            {t.label}
                          </Button>
                        </Link>
                      ))
                    : null}
                </div>
              </Card>
            ) : (
              <Card className="border-red-200 bg-red-50 p-4 text-sm text-red-700">
                <b className="font-mono">{current.code}</b>: {current.error}
              </Card>
            )
          ) : null}
        </div>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="text-sm font-semibold">Lịch sử quét ({hits.length})</div>
            {hits.length ? (
              <Button size="sm" variant="ghost" onClick={() => setHits([])}>
                <Trash2 className="size-4" />
              </Button>
            ) : null}
          </div>
          <div className="thin-scroll max-h-[60vh] overflow-auto">
            {hits.map((h, i) => (
              <button key={i} type="button" onClick={() => setCurrent(h)} className={cn('flex w-full items-center gap-2 border-b px-4 py-2 text-left text-xs hover:bg-[var(--muted)]', current === h && 'bg-teal-50')}>
                <span className={cn('size-2 shrink-0 rounded-full', h.ok ? 'bg-emerald-500' : 'bg-red-500')} />
                <span className="font-mono font-semibold">{h.code}</span>
                <span className="flex-1 truncate text-[var(--muted-foreground)]">{h.asset?.name ?? h.error}</span>
                <span className="text-[10px] text-[var(--muted-foreground)]">{h.at}</span>
              </button>
            ))}
            {!hits.length ? <div className="p-6 text-center text-xs text-[var(--muted-foreground)]">Chưa quét mã nào</div> : null}
          </div>
          {hits.some((h) => h.ok) && can('asset.label.print') ? (
            <div className="border-t p-3">
              <Link href={`/tai-san/in-tem?ids=${[...new Set(hits.filter((h) => h.ok).map((h) => h.asset!.id))].join(',')}`} className="text-xs text-teal-700 hover:underline">
                In lại tem cho các tài sản đã quét →
              </Link>
            </div>
          ) : null}
        </Card>
      </div>
    </div>
  );
}
