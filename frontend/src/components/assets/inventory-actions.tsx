'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { Field, Pill } from '@/components/assets/asset-ui';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';
import { money } from '@/lib/assets';
import { INVENTORY_RESULT, INVENTORY_RESOLUTION } from '@/lib/inventory';
import { cn } from '@/lib/utils';
import type { InventoryDetail } from '@/app/(app)/tai-san/kiem-ke/[id]/page';

/* ------------------------------------------------------------ Xác nhận chung */
export function ConfirmDialog({ open, onClose, title, message, action, pending }: { open: boolean; onClose: () => void; title: string; message: string; action: () => Promise<void>; pending?: boolean }) {
  return (
    <Dialog open={open} onClose={onClose} title={title} size="sm">
      <div className="space-y-4 px-4 py-3">
        <p className="text-sm text-[var(--muted-foreground)]">{message}</p>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Quay lại</Button>
          <Button
            className="bg-teal-600 hover:bg-teal-700"
            disabled={pending}
            onClick={async () => {
              try {
                await action();
              } catch (e) {
                toast.error((e as Error).message);
              }
              onClose();
            }}
          >
            Xác nhận
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* Trình phụ: tránh lỗi tham chiếu export cũ */
export function DiffDiffDialog() {
  return <span className="hidden" />;
}

/* ------------------------------------------------------------ Khoá số liệu & trình duyệt */
export function FinishDialog({ open, onClose, onSubmit, pending, conclusion, setConclusion, detail: d }: { open: boolean; onClose: () => void; onSubmit: (conclusion: string) => Promise<void>; pending?: boolean; conclusion: string; setConclusion: (s: string) => void; detail: InventoryDetail | undefined }) {
  const s = d?.stats;
  const autoMissing = s && s.pending > 0;
  return (
    <Dialog open={open} onClose={onClose} title={d ? `Khoá số liệu kiểm kê ${d.code}` : 'Khoá số liệu'} description="Chô t sổ liệu quét, chuyển sang chờ duyệt. Ngườ i quét không sửa kết quả được nữa (quản lý vẫn sửa / mở lại được).">
      <div className="space-y-3 px-4 py-3">
        {s && (
          <div className="grid grid-cols-3 gap-2 text-center">
            {[
              ['Đã kiểm', s.checked, '#2563eb'],
              ['Chưa kiểm', s.pending, '#d97706'],
              ['Chênh lệch', s.THIEU + s.THUA + s.KHONG_RO + s.SAI_VI_TRI + s.SAI_TINH_TRANG, '#9333ea'],
            ].map(([l, v, c]) => (
              <div key={String(l)} className="rounded-lg border p-2">
                <div className="text-lg font-bold" style={{ color: String(c) }}>{v}</div>
                <div className="text-[11px] text-[var(--muted-foreground)]">{l}</div>
              </div>
            ))}
          </div>
        )}
        {autoMissing && (
          <p className="rounded-lg bg-amber-50 p-2.5 text-xs leading-relaxed text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
            <AlertTriangle className="mr-1 inline size-3.5" />
            Còn <b>{s!.pending}</b> tài sản chưa kiểm — khi khoá, hệ thống ghi nhận là <b>Không tìm thấy (Thiếu)</b>. Có thể “Mở lại” để kiểm tiếp.
          </p>
        )}
        <Field label="Kết luận ban đầu của hội đồng (in lên biên bản, sửa được sau)">
          <textarea
            className="min-h-20 w-full rounded-lg border bg-transparent px-3 py-2 text-sm focus-visible:border-teal-500 focus-visible:outline-none"
            value={conclusion}
            onChange={(e) => setConclusion(e.target.value)}
            placeholder={`VD: Tài sản cơ bản khớp sổ sách. Đề nghị điều chuyển ${'}…'} tài sản về đúng nơi sử dụng, xử lý phần thiếu theo quy định.`}
          />
        </Field>
        <div className="flex justify-end gap-2 border-t pt-3">
          <Button variant="outline" onClick={onClose}>Quay lại</Button>
          <Button className="bg-amber-600 hover:bg-amber-700" disabled={pending} onClick={() => void onSubmit(conclusion)}>
            Khoá số liệu & trình duyệt
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------ Xử lý chênh lệch → chứng từ */
interface CreatedTx {
  id: number;
  code: string;
  type: string;
  count: number;
}

export function ResolveDialog({ open, onClose, inventoryId, detail: d }: { open: boolean; onClose: () => void; inventoryId: number; detail: InventoryDetail }) {
  const qc = useQueryClient();
  const s = d.stats;
  const counts: Record<string, number> = {
    SAI_VI_TRI: s.SAI_VI_TRI,
    SAI_TINH_TRANG: s.SAI_TINH_TRANG,
    THIEU: s.THIEU,
    THUA: s.THUA + s.KHONG_RO,
    KHOP: s.KHOP,
  };
  const suggested = [
    { action: 'DIEU_CHUYEN', show: s.SAI_VI_TRI + s.THUA > 0 },
    { action: 'BAO_MAT', show: s.THIEU > 0 },
    { action: 'BAO_HONG', show: s.SAI_TINH_TRANG + s.KHOP + s.SAI_VI_TRI + s.THUA > 0 },
    { action: 'GHI_NHAN', show: s.THUA + s.KHONG_RO + s.SAI_TINH_TRANG + s.THIEU + s.SAI_VI_TRI > 0 },
  ].filter((x) => x.show);
  const [created, setCreated] = useState<{ created: CreatedTx[]; resolved: number; errors: string[] } | null>(null);
  const run = useMutation({
    mutationFn: (body: { action: string; submit?: boolean }) => apiFetch<{ created: CreatedTx[]; resolved: number; errors: string[] }>(`/asset-inventories/${inventoryId}/resolve`, { method: 'POST', body }),
    onSuccess: (r) => {
      setCreated(r);
      void qc.invalidateQueries({ queryKey: ['asset-inventory', inventoryId] });
      void qc.invalidateQueries({ queryKey: ['asset-inventory-items', inventoryId] });
      void qc.invalidateQueries({ queryKey: ['asset-inventories'] });
      if (r.errors.length) toast.warning(`Một phần chưa xử lý: ${r.errors[0]}`);
      else toast.success(`Đã xử lý ${r.resolved} dòng`);
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const TX_LABEL: Record<string, string> = { DIEU_CHUYEN: 'Điều chuyển', CAP_PHAT: 'Cấp phát', THU_HOI: 'Thu hồi', BAO_MAT: 'Báo mất', BAO_HONG: 'Báo hỏng' };

  return (
    <Dialog open={open} onClose={() => (setCreated(null), onClose())} title={`Xử lý chênh lệch — ${d.code}`} description="Hệ thống lập sẵn chứng từ nghiệp vụ theo kết quả kiểm kê; chứng từ vẫn đi qua quy trình duyệt như thường." size="lg">
      <div className="thin-scroll max-h-[70vh] space-y-3 overflow-y-auto px-4 py-3">
        {!created ? (
          suggested.map(({ action }) => {
            const cnt = action === 'DIEU_CHUYEN' ? counts.SAI_VI_TRI + counts.THUA : action === 'BAO_MAT' ? counts.THIEU : action === 'BAO_HONG' ? undefined : counts.THUA + counts.SAI_TINH_TRANG + counts.SAI_VI_TRI + counts.THIEU;
            const meta = INVENTORY_RESOLUTION[action];
            return (
              <div key={action} className="flex flex-wrap items-center gap-3 rounded-xl border p-3">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{meta.label}</div>
                  <div className="mt-0.5 text-xs text-[var(--muted-foreground)]">
                    {action === 'DIEU_CHUYEN' && `${counts.SAI_VI_TRI} tài sản sai vị trí quay về đúng nơi sử dụng; tài sản thừa có hồ sơ được đưa về nơi quét thấy (tự chọn Cấp phát/Thu hồi).`}
                    {action === 'BAO_MAT' && `${counts.THIEU} tài sản không tìm thấy — lập chứng từ báo mất để ghi giảm sau duyệt.`}
                    {action === 'BAO_HONG' && `Các tài sản ghi nhận tình trạng Hỏng khi kiểm kê — lập chứng từ báo hỏng.`}
                    {action === 'GHI_NHAN' && `Chấp nhận chênh lệch còn lại, không lập chứng từ (đã xem xét).`}
                  </div>
                  {cnt !== undefined && <span className="mt-1 inline-block rounded bg-[var(--muted)] px-2 py-0.5 text-[11px] font-semibold">{cnt} dòng đủ điều kiện</span>}
                </div>
                <div className="flex gap-2">
                  {action !== 'GHI_NHAN' ? (
                    <>
                      <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate({ action })}>Lập nháp</Button>
                      <Button size="sm" className="bg-purple-600 hover:bg-purple-700" disabled={run.isPending} onClick={() => run.mutate({ action, submit: true })}>
                        Lập & trình duyệt <ArrowRight className="size-3.5" />
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" variant="outline" disabled={run.isPending} onClick={() => run.mutate({ action })}>Ghi nhận</Button>
                  )}
                </div>
              </div>
            );
          })
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg bg-teal-50 p-3 text-sm text-teal-900 dark:bg-teal-950/40 dark:text-teal-200">
              <CheckCircle2 className="mr-1.5 inline size-4" /> Đã xử lý <b>{created.resolved}</b> dòng chênh lệch.
            </div>
            {created.created.length > 0 && (
              <div>
                <div className="mb-1.5 text-sm font-semibold">Chứng từ đã lập</div>
                <div className="space-y-1.5">
                  {created.created.map((t) => (
                    <Link key={t.id} href={`/tai-san/nghiep-vu/${t.id}`} className="flex items-center justify-between rounded-lg border p-2.5 text-sm hover:bg-[var(--muted)]/40" onClick={() => (setCreated(null), onClose())}>
                      <span className="font-mono font-medium">{t.code}</span>
                      <span className="text-xs">{TX_LABEL[t.type] ?? t.type} · {t.count} tài sản</span>
                      <ExternalLink className="size-3.5 text-[var(--muted-foreground)]" />
                    </Link>
                  ))}
                </div>
              </div>
            )}
            {created.errors.length > 0 && (
              <div className="rounded-lg bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                {created.errors.slice(0, 5).map((e, i) => (
                  <div key={i}>· {e}</div>
                ))}
              </div>
            )}
            <div className="flex justify-end gap-2 border-t pt-3">
              <Button size="sm" variant="outline" onClick={() => setCreated(null)}>Xử lý tiếp</Button>
              <Button size="sm" onClick={() => (setCreated(null), onClose())}>Đóng</Button>
            </div>
          </div>
        )}
      </div>
    </Dialog>
  );
}
