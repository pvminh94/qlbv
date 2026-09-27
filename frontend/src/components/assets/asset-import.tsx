'use client';

import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Switch } from '@/components/ui/input';
import { apiFetch, downloadFile } from '@/lib/api';
import { cn } from '@/lib/utils';

interface Preview {
  dryRun: boolean;
  blocked?: boolean;
  summary: { total: number; create: number; update: number; error: number; newSuppliers: string[]; columns: string[]; created?: number; updated?: number; failed?: number };
  rows?: { line: number; code: string; name: string; action: 'create' | 'update' | 'error'; errors: string[] }[];
  failures?: { line: number; error: string }[];
}

export function AssetImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [update, setUpdate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [done, setDone] = useState<Preview | null>(null);
  const [onlyErrors, setOnlyErrors] = useState(false);

  useEffect(() => {
    if (open) {
      setFile(null);
      setPreview(null);
      setDone(null);
    }
  }, [open]);

  const send = async (f: File, dryRun: boolean, upd = update) => {
    setBusy(true);
    try {
      const r = await apiFetch<Preview>(`/assets/import?name=${encodeURIComponent(f.name)}&dryRun=${dryRun}&updateExisting=${upd}`, { method: 'POST', body: f });
      if (dryRun || r.dryRun) setPreview(r);
      else {
        setDone(r);
        qc.invalidateQueries({ queryKey: ['assets'] });
        qc.invalidateQueries({ queryKey: ['asset-dashboard'] });
        toast.success(`Đã nhập ${r.summary.created ?? 0} mới, cập nhật ${r.summary.updated ?? 0}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = (f?: File | null) => {
    if (!f) return;
    setFile(f);
    setPreview(null);
    setDone(null);
    send(f, true);
  };

  const rows = (preview?.rows ?? []).filter((r) => !onlyErrors || r.action === 'error');
  const s = preview?.summary;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title="Nhập tài sản từ Excel / CSV"
      description="Hệ thống kiểm tra toàn bộ tệp trước; chỉ ghi khi không còn dòng lỗi. Hãng/nhà cung cấp chưa có sẽ tự thêm vào danh mục."
      footer={
        <>
          <Button variant="ghost" className="mr-auto" onClick={() => downloadFile('/assets/import/template', 'mau-nhap-tai-san.xlsx')}>
            <Download className="size-4" /> Tải tệp mẫu
          </Button>
          <Button variant="outline" onClick={onClose}>
            Đóng
          </Button>
          {preview && !done ? (
            <Button className="bg-teal-600 hover:bg-teal-700" disabled={!file || !!s?.error || !s?.total} loading={busy} onClick={() => file && send(file, false)}>
              Ghi {(s?.create ?? 0) + (s?.update ?? 0)} dòng
            </Button>
          ) : null}
        </>
      }
    >
      <div className="space-y-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => (e.preventDefault(), pick(e.dataTransfer.files?.[0]))}
          onClick={() => input.current?.click()}
          className="flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed border-teal-300 bg-teal-50/40 px-4 py-6 text-center hover:bg-teal-50"
        >
          {file ? <FileSpreadsheet className="size-8 text-teal-600" /> : <Upload className="size-8 text-teal-600" />}
          <div className="text-sm font-medium">{file ? file.name : 'Kéo thả hoặc bấm để chọn tệp .xlsx / .xls / .csv'}</div>
          <div className="text-xs text-[var(--muted-foreground)]">Cột bắt buộc: Tên tài sản. Nhận diện tiêu đề linh hoạt (Mã TS, Nguyên giá, Khoa/phòng, Loại, Serial…)</div>
          <input ref={input} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <div className="flex items-center gap-2">
          <Switch checked={update} onCheckedChange={(v) => (setUpdate(v), file && !done && send(file, true, v))} />
          <span className="text-sm">Cập nhật tài sản đã có (trùng mã) thay vì báo lỗi</span>
        </div>

        {done ? (
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="size-5" /> Hoàn tất: thêm {done.summary.created}, cập nhật {done.summary.updated}
              {done.summary.failed ? `, lỗi ${done.summary.failed}` : ''}
            </div>
            {done.failures?.length ? (
              <ul className="mt-2 list-disc pl-5 text-red-700">
                {done.failures.map((f) => (
                  <li key={f.line}>
                    Dòng {f.line}: {f.error}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {preview && !done ? (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ['Tổng dòng', s?.total, 'text-[var(--foreground)]'],
                ['Thêm mới', s?.create, 'text-teal-700'],
                ['Cập nhật', s?.update, 'text-blue-700'],
                ['Lỗi', s?.error, s?.error ? 'text-red-600' : 'text-emerald-600'],
              ].map(([l, n, c]) => (
                <div key={String(l)} className="rounded-xl border bg-[var(--card)] p-3">
                  <div className="text-xs text-[var(--muted-foreground)]">{l}</div>
                  <div className={cn('text-2xl font-bold tabular-nums', String(c))}>{Number(n ?? 0)}</div>
                </div>
              ))}
            </div>
            {s?.newSuppliers?.length ? <div className="text-xs text-[var(--muted-foreground)]">Sẽ thêm vào danh mục hãng/NCC: {s.newSuppliers.join(', ')}</div> : null}
            <div className="flex items-center justify-between">
              <span className="text-xs text-[var(--muted-foreground)]">Cột nhận diện: {s?.columns?.join(', ')}</span>
              {s?.error ? (
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={onlyErrors} onChange={(e) => setOnlyErrors(e.target.checked)} className="accent-teal-600" /> Chỉ dòng lỗi
                </label>
              ) : null}
            </div>
            <div className="thin-scroll max-h-72 overflow-auto rounded-lg border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-[var(--muted)] text-left text-xs">
                  <tr>
                    <th className="p-2">Dòng</th>
                    <th className="p-2">Mã</th>
                    <th className="p-2">Tên</th>
                    <th className="p-2">Kết quả</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.line} className="border-t align-top">
                      <td className="p-2 tabular-nums text-xs">{r.line}</td>
                      <td className="p-2 font-mono text-xs">{r.code || <span className="text-[var(--muted-foreground)]">tự sinh</span>}</td>
                      <td className="p-2">{r.name}</td>
                      <td className="p-2 text-xs">
                        {r.action === 'error' ? (
                          <span className="flex items-start gap-1 text-red-600">
                            <XCircle className="mt-0.5 size-3.5 shrink-0" />
                            {r.errors.join('; ')}
                          </span>
                        ) : r.action === 'update' ? (
                          <span className="text-blue-700">Cập nhật</span>
                        ) : (
                          <span className="text-teal-700">Thêm mới</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}
      </div>
    </Dialog>
  );
}
