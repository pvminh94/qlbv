'use client';

import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Filter, ListChecks, Plus, Printer, RefreshCw, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AssetPicker, AssetSubnav } from '@/components/assets/asset-ui';
import { PageHeader } from '@/components/shared/page-header';
import { Button } from '@/components/ui/button';
import { Card, Skeleton } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { ASSET_STATUS, type AssetRow, treeLabel, useAssetCatalog, useAssetOptions } from '@/lib/assets';
import { cn } from '@/lib/utils';

type Mini = Pick<AssetRow, 'id' | 'code' | 'name' | 'departmentName'>;

function LabelContent() {
  const params = useSearchParams();
  const cats = useAssetCatalog('categories');
  const opts = useAssetOptions();
  const [source, setSource] = useState<'pick' | 'filter'>(params.get('ids') ? 'pick' : 'pick');
  const [picked, setPicked] = useState<Mini[]>([]);
  const [filter, setFilter] = useState({ departmentId: '', categoryId: '', status: 'ACTIVE', acquiredFrom: '', acquiredTo: '' });
  const [layout, setLayout] = useState<'THERMAL' | 'SHEET'>('THERMAL');
  const [copies, setCopies] = useState(1);
  const [templateId, setTemplateId] = useState('');
  const [sheet, setSheet] = useState({ cols: '', rows: '', marginTop: '10', marginLeft: '5', gapX: '2', gapY: '2', skip: '0' });
  const [pdf, setPdf] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const urlRef = useRef<string | null>(null);

  const templates = useQuery({ queryKey: ['label-templates'], queryFn: () => apiFetch<{ id: number; name: string; isDefault: boolean; document: { customSize?: { width: number; height: number } } }[]>('/assets/labels/templates') });
  const filterCount = useQuery({
    queryKey: ['label-filter-count', filter],
    queryFn: () => apiFetch<{ total: number }>(`/assets?pageSize=1&${new URLSearchParams(Object.entries(filter).filter(([, v]) => v)).toString()}`),
    enabled: source === 'filter',
  });

  useEffect(() => {
    const ids = params.get('ids');
    if (ids) apiFetch<{ items: AssetRow[] }>(`/assets?ids=${ids}&all=true&status=&sortBy=code&sortDir=asc`).then((r) => setPicked(r.items)).catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => {
    if (urlRef.current) URL.revokeObjectURL(urlRef.current);
  }, []);

  const tpl = templates.data?.find((t) => String(t.id) === templateId) ?? templates.data?.find((t) => t.isDefault) ?? templates.data?.[0];
  const size = tpl?.document?.customSize ?? { width: 50, height: 30 };

  const render = async () => {
    if (source === 'pick' && !picked.length) return toast.error('Chưa chọn tài sản');
    setBusy(true);
    try {
      const body = {
        ...(source === 'pick' ? { ids: picked.map((p) => p.id) } : { filter: Object.fromEntries(Object.entries(filter).filter(([, v]) => v)) }),
        layout,
        copies,
        templateId: templateId ? Number(templateId) : undefined,
        origin: window.location.origin,
        ...(layout === 'SHEET' ? { sheet: Object.fromEntries(Object.entries(sheet).filter(([, v]) => v !== '').map(([k, v]) => [k, Number(v)])) } : {}),
      };
      const res = await apiFetch<Response>('/assets/labels', { method: 'POST', body, raw: true });
      const blob = await res.blob();
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
      urlRef.current = URL.createObjectURL(blob);
      setPdf(urlRef.current);
      setCount(Number(res.headers.get('X-Label-Count') ?? 0));
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const total = source === 'pick' ? picked.length : (filterCount.data?.total ?? 0);

  return (
    <div className="space-y-4">
      <PageHeader
        breadcrumb={<Link href="/tai-san">Quản lý tài sản</Link>}
        title="In tem tài sản"
        description={`Tem QR + mã vạch Code128 (${size.width} × ${size.height} mm). Máy in tem nhiệt: mỗi tem 1 trang · Giấy decal A4: lưới nhiều tem, bỏ qua ô đã dùng.`}
        actions={
          <Link href="/quan-tri/mau-in" className="text-sm text-teal-700 hover:underline">
            Sửa mẫu tem trong Trình thiết kế →
          </Link>
        }
      />
      <AssetSubnav />

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <div className="space-y-4">
          <Card className="p-4">
            <div className="mb-3 flex gap-1 rounded-lg bg-[var(--muted)] p-1">
              {([
                ['pick', 'Chọn tài sản', ListChecks],
                ['filter', 'Theo bộ lọc', Filter],
              ] as const).map(([k, l, I]) => (
                <button key={k} type="button" onClick={() => setSource(k)} className={cn('flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-xs font-medium', source === k ? 'bg-[var(--card)] text-teal-700 shadow-sm' : 'text-[var(--muted-foreground)]')}>
                  <I className="size-3.5" /> {l}
                </button>
              ))}
            </div>
            {source === 'pick' ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm">{picked.length} tài sản</span>
                  <div className="flex gap-1">
                    {picked.length ? (
                      <Button size="sm" variant="ghost" onClick={() => setPicked([])}>
                        Xoá hết
                      </Button>
                    ) : null}
                    <Button size="sm" variant="outline" onClick={() => setPicker(true)}>
                      <Plus className="size-4" /> Thêm / quét
                    </Button>
                  </div>
                </div>
                <div className="thin-scroll max-h-64 space-y-1 overflow-auto">
                  {picked.map((a) => (
                    <div key={a.id} className="flex items-center gap-2 rounded-lg border px-2 py-1 text-xs">
                      <span className="font-mono font-semibold text-teal-700">{a.code}</span>
                      <span className="flex-1 truncate">{a.name}</span>
                      <button type="button" onClick={() => setPicked((p) => p.filter((x) => x.id !== a.id))} aria-label="Bỏ">
                        <Trash2 className="size-3.5 text-red-500" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="grid gap-2">
                <Select value={filter.departmentId} onChange={(e) => setFilter((f) => ({ ...f, departmentId: e.target.value }))}>
                  <option value="">Tất cả khoa/phòng</option>
                  <option value="-1">— Trong kho —</option>
                  {(opts.data?.departments ?? []).map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name}
                    </option>
                  ))}
                </Select>
                <Select value={filter.categoryId} onChange={(e) => setFilter((f) => ({ ...f, categoryId: e.target.value }))}>
                  <option value="">Tất cả loại</option>
                  {(cats.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {treeLabel(c)}
                    </option>
                  ))}
                </Select>
                <Select value={filter.status} onChange={(e) => setFilter((f) => ({ ...f, status: e.target.value }))}>
                  <option value="ACTIVE">Đang theo dõi</option>
                  <option value="">Mọi trạng thái</option>
                  {Object.entries(ASSET_STATUS).map(([k, s]) => (
                    <option key={k} value={k}>
                      {s.label}
                    </option>
                  ))}
                </Select>
                <div className="flex items-center gap-1">
                  <Input type="date" value={filter.acquiredFrom} onChange={(e) => setFilter((f) => ({ ...f, acquiredFrom: e.target.value }))} title="Ghi tăng từ" />
                  <span className="text-xs">–</span>
                  <Input type="date" value={filter.acquiredTo} onChange={(e) => setFilter((f) => ({ ...f, acquiredTo: e.target.value }))} title="đến" />
                </div>
                <div className="text-xs text-[var(--muted-foreground)]">Khớp {filterCount.data?.total ?? '…'} tài sản (in theo thứ tự mã)</div>
              </div>
            )}
          </Card>

          <Card className="space-y-3 p-4">
            <div className="grid grid-cols-2 gap-2">
              {([
                ['THERMAL', 'Máy in tem nhiệt', 'Mỗi tem 1 trang'],
                ['SHEET', 'Giấy decal A4', 'Nhiều tem / tờ'],
              ] as const).map(([k, l, d]) => (
                <button key={k} type="button" onClick={() => setLayout(k)} className={cn('rounded-xl border p-3 text-left', layout === k ? 'border-teal-500 bg-teal-50 ring-2 ring-teal-500/20' : 'hover:border-teal-300')}>
                  <div className="text-sm font-semibold">{l}</div>
                  <div className="text-[11px] text-[var(--muted-foreground)]">{d}</div>
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="space-y-1">
                <span className="text-xs text-[var(--muted-foreground)]">Mẫu tem</span>
                <Select value={templateId} onChange={(e) => setTemplateId(e.target.value)}>
                  <option value="">Mặc định</option>
                  {(templates.data ?? []).map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-[var(--muted-foreground)]">Số bản / tài sản</span>
                <Input type="number" min={1} max={10} value={copies} onChange={(e) => setCopies(Math.min(10, Math.max(1, Number(e.target.value) || 1)))} />
              </label>
            </div>
            {layout === 'SHEET' ? (
              <div className="grid grid-cols-3 gap-2 rounded-lg bg-[var(--muted)]/50 p-2">
                {([
                  ['cols', 'Số cột (trống = tự)'],
                  ['rows', 'Số hàng (trống = tự)'],
                  ['skip', 'Bỏ qua ô đầu'],
                  ['marginTop', 'Lề trên (mm)'],
                  ['marginLeft', 'Lề trái (mm)'],
                  ['gapX', 'Khoảng ngang'],
                  ['gapY', 'Khoảng dọc'],
                ] as const).map(([k, l]) => (
                  <label key={k} className="space-y-0.5">
                    <span className="text-[10.5px] text-[var(--muted-foreground)]">{l}</span>
                    <Input className="h-8" type="number" min={0} step="0.5" value={sheet[k]} onChange={(e) => setSheet((s) => ({ ...s, [k]: e.target.value }))} />
                  </label>
                ))}
              </div>
            ) : null}
            <Button className="w-full bg-teal-600 hover:bg-teal-700" loading={busy} disabled={!total} onClick={render}>
              {pdf ? <RefreshCw className="size-4" /> : <Printer className="size-4" />} {pdf ? 'Tạo lại bản xem trước' : 'Tạo tem'} ({total * copies} tem)
            </Button>
          </Card>
        </div>

        <Card className="flex min-h-[520px] flex-col overflow-hidden">
          <div className="flex items-center justify-between border-b px-4 py-2">
            <div className="text-sm font-semibold">Xem trước {count ? `· ${count} tem` : ''}</div>
            {pdf ? (
              <Button size="sm" variant="outline" onClick={() => window.open(pdf, '_blank')}>
                <ExternalLink className="size-4" /> Mở để in
              </Button>
            ) : null}
          </div>
          {pdf ? (
            <iframe title="Xem trước tem" src={pdf} className="h-[70vh] w-full flex-1 bg-slate-100" />
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center text-sm text-[var(--muted-foreground)]">
              <div>
                <Printer className="mx-auto mb-2 size-10 text-teal-600/40" />
                Chọn tài sản và bấm <b>Tạo tem</b> để xem trước PDF.
                <div className="mt-1 text-xs">Mỗi lần in được ghi vào dòng thời gian của tài sản.</div>
              </div>
            </div>
          )}
        </Card>
      </div>

      <AssetPicker open={picker} onClose={() => setPicker(false)} allowedStatuses={undefined} exclude={picked.map((p) => p.id)} title="Chọn tài sản cần in tem" onPick={(rows) => setPicked((p) => [...p, ...rows])} />
    </div>
  );
}

export default function LabelPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96" />}>
      <LabelContent />
    </Suspense>
  );
}
