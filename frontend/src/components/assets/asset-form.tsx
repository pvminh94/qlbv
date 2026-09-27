'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Lock } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Select, Switch, Textarea } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { ASSET_CONDITION, ASSET_STATUS, money, treeLabel, useAssetCatalog, useAssetMeta, useAssetOptions } from '@/lib/assets';
import { cn } from '@/lib/utils';

type Form = Record<string, unknown>;

const SECTIONS = [
  { key: 'general', label: 'Thông tin chung' },
  { key: 'value', label: 'Nguồn gốc & giá trị' },
  { key: 'depr', label: 'Khấu hao' },
  { key: 'tech', label: 'Kỹ thuật & sử dụng' },
];

function F({ label, children, hint, span = 1, locked }: { label: string; children: ReactNode; hint?: string; span?: 1 | 2 | 3; locked?: boolean }) {
  return (
    <label className={cn('block space-y-1', span === 2 && 'sm:col-span-2', span === 3 && 'sm:col-span-3')}>
      <span className="flex items-center gap-1 text-xs font-medium text-[var(--muted-foreground)]">
        {label}
        {locked ? <Lock className="size-3 text-amber-600" /> : null}
      </span>
      {children}
      {hint ? <span className="block text-[10.5px] text-[var(--muted-foreground)]">{hint}</span> : null}
    </label>
  );
}

export function AssetFormDialog({
  open,
  onClose,
  initial,
  locked = false,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  initial?: Form | null;
  locked?: boolean;
  onSaved?: (res: unknown) => void;
}) {
  const qc = useQueryClient();
  const isEdit = Boolean(initial?.id);
  const [section, setSection] = useState('general');
  const [f, setF] = useState<Form>({});
  const cats = useAssetCatalog('categories', true);
  const locs = useAssetCatalog('locations', true);
  const sups = useAssetCatalog('suppliers', true);
  const funds = useAssetCatalog('funding', true);
  const meta = useAssetMeta();
  const opts = useAssetOptions();

  useEffect(() => {
    if (!open) return;
    setSection('general');
    setF(initial ? { ...initial } : { unit: 'Cái', copies: 1, condition: 'TOT', acquisitionDate: new Date().toISOString().slice(0, 10) });
  }, [open, initial]);

  const set = (k: string, v: unknown) => setF((s) => ({ ...s, [k]: v }));
  const v = (k: string) => (f[k] ?? '') as string;

  /** Chọn loại → điền mặc định khấu hao/kiểm định của loại */
  const pickCategory = (id: string) => {
    const c = cats.data?.find((x) => String(x.id) === id);
    setF((s) => ({
      ...s,
      categoryId: id ? Number(id) : null,
      ...(c
        ? {
            depreciationMethod: c.depreciationMethod,
            usefulLifeMonths: c.usefulLifeMonths,
            annualRate: c.annualRate,
            requiresCalibration: c.requiresCalibration,
            calibrationIntervalMonths: c.calibrationIntervalMonths,
            maintenanceIntervalMonths: c.maintenanceIntervalMonths,
            kind: c.kind,
          }
        : {}),
    }));
  };

  const manufacturers = useMemo(() => (sups.data ?? []).filter((s) => ((s.roles as string[]) ?? []).includes('HSX')), [sups.data]);
  const suppliers = useMemo(() => (sups.data ?? []).filter((s) => !((s.roles as string[]) ?? []).length || ((s.roles as string[]) ?? []).includes('NCC')), [sups.data]);
  const users = (opts.data?.users ?? []).filter((u) => !f.departmentId || u.departmentId === Number(f.departmentId) || u.id === Number(f.custodianId));

  const save = useMutation({
    mutationFn: () => {
      const body: Form = { ...f };
      for (const k of ['raw', 'events', 'transactions', 'depreciation', 'schedule', 'children', 'parent', 'locked', 'categoryName', 'departmentName', 'locationName', 'supplierName', 'manufacturerName', 'fundingSourceName', 'bookValue', 'accumulatedDepreciation', 'statusLabel', 'conditionLabel', 'methodLabel', 'group', 'categoryCode', 'createdAt', 'updatedAt', 'deletedAt', 'lastInventoryAt', 'lastDepreciationPeriod', 'depreciationRemaining', 'id']) delete body[k];
      if (locked) for (const k of ['code', 'status', 'quantity', 'originalCost', 'openingAccumulated', 'openingDate', 'inUseDate', 'departmentId', 'locationId', 'custodianId', 'custodianName']) delete body[k];
      return isEdit ? apiFetch(`/assets/${initial!.id}`, { method: 'PUT', body }) : apiFetch('/assets', { method: 'POST', body });
    },
    onSuccess: (res) => {
      const r = res as { count?: number; code?: string };
      toast.success(isEdit ? 'Đã lưu hồ sơ tài sản' : r.count ? `Đã thêm ${r.count} tài sản` : `Đã thêm tài sản ${r.code}`);
      qc.invalidateQueries({ queryKey: ['assets'] });
      qc.invalidateQueries({ queryKey: ['asset'] });
      qc.invalidateQueries({ queryKey: ['asset-dashboard'] });
      onSaved?.(res);
      onClose();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const cost = Number(f.originalCost ?? 0);
  const rate = Number(f.annualRate ?? 0);
  const perYear = f.depreciationMethod === 'STRAIGHT_LINE_YEARLY' ? Math.ceil((cost * rate) / 100) : Math.round(((cost - Number(f.residualValue ?? 0)) * 12) / Math.max(1, Number(f.usefulLifeMonths ?? 1)));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={isEdit ? `Sửa hồ sơ ${String(initial?.code ?? '')}` : 'Thêm tài sản'}
      description={locked ? 'Tài sản đã phát sinh nghiệp vụ — các trường có biểu tượng khoá phải thay đổi qua chứng từ (điều chuyển, đánh giá lại…).' : 'Mã tài sản bỏ trống sẽ tự sinh theo tiền tố của loại tài sản.'}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Huỷ
          </Button>
          <Button loading={save.isPending} onClick={() => save.mutate()} className="bg-teal-600 hover:bg-teal-700">
            {isEdit ? 'Lưu thay đổi' : Number(f.copies) > 1 ? `Thêm ${f.copies} tài sản` : 'Thêm tài sản'}
          </Button>
        </>
      }
    >
      <div className="mb-4 flex gap-1 rounded-lg bg-[var(--muted)] p-1">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)} className={cn('flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors', section === s.key ? 'bg-[var(--card)] text-teal-700 shadow-sm' : 'text-[var(--muted-foreground)]')}>
            {s.label}
          </button>
        ))}
      </div>

      <div className={cn('grid gap-3 sm:grid-cols-3', section !== 'general' && 'hidden')}>
        <F label="Tên tài sản *" span={2}>
          <Input value={v('name')} onChange={(e) => set('name', e.target.value)} placeholder="Máy siêu âm màu 4D" autoFocus />
        </F>
        <F label="Mã tài sản" locked={locked} hint={isEdit ? undefined : 'Bỏ trống = tự sinh'}>
          <Input value={v('code')} disabled={locked || Number(f.copies) > 1} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="Tự sinh" className="font-mono" />
        </F>
        <F label="Loại tài sản" span={2}>
          <Select value={v('categoryId')} onChange={(e) => pickCategory(e.target.value)}>
            <option value="">— Chọn loại —</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {treeLabel(c)} ({c.code})
              </option>
            ))}
          </Select>
        </F>
        <F label="Phân loại">
          <Select value={v('kind') || 'TSCD_HUU_HINH'} onChange={(e) => set('kind', e.target.value)}>
            {Object.entries(meta.data?.kinds ?? {}).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </F>
        <F label="Model / ký mã hiệu">
          <Input value={v('model')} onChange={(e) => set('model', e.target.value)} />
        </F>
        <F label="Số serial">
          <Input value={v('serialNumber')} disabled={Number(f.copies) > 1} onChange={(e) => set('serialNumber', e.target.value)} />
        </F>
        <F label="Mã vạch riêng" hint="Bỏ trống = dùng mã tài sản">
          <Input value={v('barcode')} disabled={Number(f.copies) > 1} onChange={(e) => set('barcode', e.target.value)} className="font-mono" />
        </F>
        <F label="Đơn vị tính">
          <Input value={v('unit')} onChange={(e) => set('unit', e.target.value)} />
        </F>
        <F label="Tình trạng">
          <Select value={v('condition') || 'TOT'} onChange={(e) => set('condition', e.target.value)}>
            {Object.entries(ASSET_CONDITION).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </F>
        {!isEdit ? (
          <F label="Số lượng tạo" hint="Tạo nhiều tài sản giống nhau, mỗi cái 1 mã (vd 20 máy tính cùng lô)">
            <Input type="number" min={1} max={500} value={v('copies')} onChange={(e) => set('copies', Math.max(1, Number(e.target.value)))} />
          </F>
        ) : null}
        <F label="Thông số kỹ thuật / cấu hình" span={3}>
          <Textarea rows={3} value={v('specifications')} onChange={(e) => set('specifications', e.target.value)} />
        </F>
        <F label="Nhãn (tags, cách nhau dấu phẩy)" span={2}>
          <Input value={Array.isArray(f.tags) ? (f.tags as string[]).join(', ') : v('tags')} onChange={(e) => set('tags', e.target.value)} placeholder="ưu tiên, dự án 2024" />
        </F>
        <F label="Ghi chú">
          <Input value={v('note')} onChange={(e) => set('note', e.target.value)} />
        </F>
      </div>

      <div className={cn('grid gap-3 sm:grid-cols-3', section !== 'value' && 'hidden')}>
        <F label="Nguyên giá (đ)" locked={locked} hint={cost ? `${money(cost)} đồng` : undefined}>
          <Input type="number" min={0} value={v('originalCost')} disabled={locked} onChange={(e) => set('originalCost', e.target.value)} className="tabular-nums" />
        </F>
        <F label="Nguồn vốn">
          <Select value={v('fundingSourceId')} onChange={(e) => set('fundingSourceId', e.target.value || null)}>
            <option value="">—</option>
            {(funds.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="Ngày ghi tăng">
          <Input type="date" value={v('acquisitionDate')} onChange={(e) => set('acquisitionDate', e.target.value)} />
        </F>
        <F label="Hãng sản xuất">
          <Select value={v('manufacturerId')} onChange={(e) => set('manufacturerId', e.target.value || null)}>
            <option value="">—</option>
            {manufacturers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="Nước sản xuất">
          <Input value={v('countryOfOrigin')} onChange={(e) => set('countryOfOrigin', e.target.value)} />
        </F>
        <F label="Năm sản xuất">
          <Input type="number" value={v('yearOfManufacture')} onChange={(e) => set('yearOfManufacture', e.target.value)} />
        </F>
        <F label="Nhà cung cấp">
          <Select value={v('supplierId')} onChange={(e) => set('supplierId', e.target.value || null)}>
            <option value="">—</option>
            {suppliers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="Số hợp đồng">
          <Input value={v('contractNo')} onChange={(e) => set('contractNo', e.target.value)} />
        </F>
        <F label="Số hoá đơn">
          <Input value={v('invoiceNo')} onChange={(e) => set('invoiceNo', e.target.value)} />
        </F>
        <F label="Bảo hành đến">
          <Input type="date" value={v('warrantyUntil')} onChange={(e) => set('warrantyUntil', e.target.value)} />
        </F>
        <F label="Hao mòn luỹ kế đầu kỳ (đ)" locked={locked} hint="Tài sản đã dùng trước khi đưa vào phần mềm">
          <Input type="number" min={0} value={v('openingAccumulated')} disabled={locked} onChange={(e) => set('openingAccumulated', e.target.value)} />
        </F>
        <F label="Ngày chốt số dư đầu kỳ" locked={locked} hint="Vd 31/12/2025 → tính tiếp từ kỳ 2026">
          <Input type="date" value={v('openingDate')} disabled={locked} onChange={(e) => set('openingDate', e.target.value)} />
        </F>
      </div>

      <div className={cn('grid gap-3 sm:grid-cols-3', section !== 'depr' && 'hidden')}>
        <F label="Phương pháp" span={2}>
          <Select value={v('depreciationMethod') || 'STRAIGHT_LINE_YEARLY'} onChange={(e) => set('depreciationMethod', e.target.value)}>
            {Object.entries(meta.data?.methods ?? {}).map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </Select>
        </F>
        <F label="Ngày bắt đầu tính" hint="Bỏ trống = ngày đưa vào sử dụng">
          <Input type="date" value={v('depreciationStartDate')} onChange={(e) => set('depreciationStartDate', e.target.value)} />
        </F>
        <F label="Thời gian sử dụng (tháng)" hint={f.usefulLifeMonths ? `${Math.round((Number(f.usefulLifeMonths) / 12) * 10) / 10} năm` : undefined}>
          <Input type="number" min={1} value={v('usefulLifeMonths')} onChange={(e) => set('usefulLifeMonths', e.target.value)} />
        </F>
        <F label="Tỉ lệ hao mòn (%/năm)" hint="Theo năm (TT23): mức năm = nguyên giá × tỉ lệ">
          <Input type="number" min={0} max={100} step="0.01" value={v('annualRate')} onChange={(e) => set('annualRate', e.target.value)} />
        </F>
        <F label="Giá trị thu hồi ước tính (đ)" hint="Chỉ áp dụng khấu hao theo tháng">
          <Input type="number" min={0} value={v('residualValue')} onChange={(e) => set('residualValue', e.target.value)} />
        </F>
        <div className="rounded-xl border border-teal-200 bg-teal-50/60 p-3 text-sm sm:col-span-3">
          <div className="text-xs font-medium text-teal-800">Ước tính</div>
          <div className="mt-1 text-teal-900">
            {f.depreciationMethod === 'NONE' ? 'Không tính khấu hao/hao mòn' : cost > 0 ? <>Khoảng <b>{money(perYear)} đ/năm</b> ({money(perYear / 12)} đ/tháng)</> : 'Nhập nguyên giá để xem ước tính'}
          </div>
        </div>
      </div>

      <div className={cn('grid gap-3 sm:grid-cols-3', section !== 'tech' && 'hidden')}>
        {!isEdit || !locked ? (
          <F label="Trạng thái" locked={locked}>
            <Select value={v('status')} disabled={locked} onChange={(e) => set('status', e.target.value)}>
              <option value="">Tự động (có khoa → Đang sử dụng)</option>
              {Object.entries(ASSET_STATUS).map(([k, s]) => (
                <option key={k} value={k}>
                  {s.label}
                </option>
              ))}
            </Select>
          </F>
        ) : null}
        <F label="Khoa/phòng sử dụng" locked={locked}>
          <Select value={v('departmentId')} disabled={locked} onChange={(e) => set('departmentId', e.target.value || null)}>
            <option value="">— Kho —</option>
            {(opts.data?.departments ?? []).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </F>
        <F label="Vị trí" locked={locked}>
          <Select value={v('locationId')} disabled={locked} onChange={(e) => set('locationId', e.target.value || null)}>
            <option value="">—</option>
            {(locs.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {treeLabel(c)}
              </option>
            ))}
          </Select>
        </F>
        <F label="Người giữ / phụ trách" locked={locked}>
          <Select value={v('custodianId')} disabled={locked} onChange={(e) => set('custodianId', e.target.value || null)}>
            <option value="">—</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.username})
              </option>
            ))}
          </Select>
        </F>
        <F label="Ngày đưa vào sử dụng" locked={locked}>
          <Input type="date" value={v('inUseDate')} disabled={locked} onChange={(e) => set('inUseDate', e.target.value)} />
        </F>
        <F label="Phân loại TBYT (A/B/C/D)">
          <Select value={v('riskClass')} onChange={(e) => set('riskClass', e.target.value)}>
            <option value="">—</option>
            {['A', 'B', 'C', 'D'].map((x) => (
              <option key={x} value={x}>
                Loại {x}
              </option>
            ))}
          </Select>
        </F>
        <F label="Số lưu hành / số đăng ký">
          <Input value={v('registrationNo')} onChange={(e) => set('registrationNo', e.target.value)} />
        </F>
        <div className="flex items-center gap-2 pt-5">
          <Switch checked={Boolean(f.requiresCalibration)} onCheckedChange={(x) => set('requiresCalibration', x)} />
          <span className="text-sm">Phải kiểm định / hiệu chuẩn</span>
        </div>
        <F label="Chu kỳ kiểm định (tháng)">
          <Input type="number" min={0} value={v('calibrationIntervalMonths')} onChange={(e) => set('calibrationIntervalMonths', e.target.value)} />
        </F>
        <F label="Kiểm định gần nhất">
          <Input type="date" value={v('lastCalibrationDate')} onChange={(e) => set('lastCalibrationDate', e.target.value)} />
        </F>
        <F label="Hạn kiểm định kế tiếp" hint="Bỏ trống = tự tính theo chu kỳ">
          <Input type="date" value={v('nextCalibrationDate')} onChange={(e) => set('nextCalibrationDate', e.target.value)} />
        </F>
        <F label="Chu kỳ bảo dưỡng (tháng)">
          <Input type="number" min={0} value={v('maintenanceIntervalMonths')} onChange={(e) => set('maintenanceIntervalMonths', e.target.value)} />
        </F>
        <F label="Bảo dưỡng gần nhất">
          <Input type="date" value={v('lastMaintenanceDate')} onChange={(e) => set('lastMaintenanceDate', e.target.value)} />
        </F>
        <F label="Hạn bảo dưỡng kế tiếp" hint="Bỏ trống = tự tính theo chu kỳ">
          <Input type="date" value={v('nextMaintenanceDate')} onChange={(e) => set('nextMaintenanceDate', e.target.value)} />
        </F>
      </div>
    </Dialog>
  );
}
