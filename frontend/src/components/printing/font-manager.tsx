'use client';

import { CheckCircle2, Info, Trash2, Upload } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { apiFetch } from '@/lib/api';
import { cssFontFamily, ensureFont, fetchFontFamilies, reloadFonts, type FontFamilyInfo } from './print-fonts';

const VARIANT_LABEL: Record<string, string> = { regular: 'Thường', bold: 'Đậm', italic: 'Nghiêng', boldItalic: 'Đậm nghiêng' };
const SAMPLE = 'Cộng hòa Xã hội Chủ nghĩa Việt Nam — Độc lập, Tự do, Hạnh phúc. 0123456789';

/** Quản lý font bản in: xem font đang dùng, tải font gốc (vd Times New Roman) lên, xoá font đã tải. */
export function FontManager({ open, onClose, canEdit }: { open: boolean; onClose: () => void; canEdit: boolean }) {
  const [families, setFamilies] = useState<FontFamilyInfo[]>([]);
  const [uploading, setUploading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const load = async (force = false) => {
    const list = await fetchFontFamilies(force);
    setFamilies(list);
    list.forEach((f) => void ensureFont(f.family));
  };

  useEffect(() => {
    if (open) void load(true);
  }, [open]);

  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    let ok = 0;
    for (const file of Array.from(files)) {
      try {
        const res = await apiFetch<{ family: string; variant: string; missingVietnamese: string }>(
          `/print/fonts?name=${encodeURIComponent(file.name)}`,
          { method: 'POST', body: file },
        );
        ok++;
        toast.success(`${file.name}: nhận diện "${res.family}" — ${VARIANT_LABEL[res.variant] ?? res.variant}`);
        if (res.missingVietnamese) toast.warning(`${file.name} thiếu một số ký tự: ${res.missingVietnamese.slice(0, 20)}…`);
      } catch (err) {
        toast.error(`${file.name}: ${(err as Error).message}`);
      }
    }
    setUploading(false);
    if (input.current) input.current.value = '';
    if (ok) {
      await reloadFonts();
      await load(true);
    }
  };

  const remove = async (family: string, variant?: string) => {
    try {
      await apiFetch(`/print/fonts?family=${encodeURIComponent(family)}${variant ? `&variant=${variant}` : ''}`, { method: 'DELETE' });
      toast.success('Đã xoá font tải lên');
      await reloadFonts();
      await load(true);
    } catch (err) {
      toast.error((err as Error).message);
    }
  };

  const tnr = families.find((f) => f.family === 'Times New Roman');
  const tnrOriginal = tnr && Object.values(tnr.variants).every((v) => v.source === 'custom');

  return (
    <Dialog open={open} onClose={onClose} size="lg" title="Font chữ bản in" description="Mọi bản in mặc định dùng Times New Roman — kể cả khi xem trước và xuất PDF">
      <div className="space-y-3">
        <div className={`flex gap-2 rounded-lg border p-3 text-xs ${tnrOriginal ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-sky-200 bg-sky-50 text-sky-900'}`}>
          {tnrOriginal ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          {tnrOriginal ? (
            <div>
              Đang dùng <b>Times New Roman gốc</b> của Microsoft cho mọi bản in PDF.
            </div>
          ) : (
            <div className="space-y-1">
              <div>
                Đang dùng <b>Tinos</b> thay cho Times New Roman: font tương thích metric (từng ký tự rộng y hệt nên bố cục, chỗ xuống dòng giống
                hệt Times New Roman), đủ dấu tiếng Việt. Muốn PDF nhúng đúng font gốc Times New Roman, chọn một trong hai cách:
              </div>
              <ol className="list-decimal pl-5">
                <li>
                  Trên máy chủ chạy: <code className="rounded bg-white px-1">sudo bash deploy/install-times-font.sh</code> (tự tải gói font chính thức
                  của Microsoft).
                </li>
                <li>
                  Hoặc bấm <b>Tải font lên</b> và chọn 4 tệp <code>times.ttf</code>, <code>timesbd.ttf</code>, <code>timesi.ttf</code>,{' '}
                  <code>timesbi.ttf</code> trong thư mục <code>C:\Windows\Fonts</code> của máy Windows.
                </li>
              </ol>
            </div>
          )}
        </div>

        {canEdit ? (
          <div className="flex items-center gap-2">
            <input ref={input} type="file" accept=".ttf,.otf" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
            <Button size="sm" onClick={() => input.current?.click()} loading={uploading}>
              <Upload /> Tải font lên (.ttf, .otf)
            </Button>
            <span className="text-[11px] text-[var(--muted-foreground)]">Hệ thống tự đọc tên họ font và kiểu chữ (thường/đậm/nghiêng) trong tệp.</span>
          </div>
        ) : null}

        <div className="divide-y rounded-lg border">
          {families.map((f) => (
            <div key={f.family} className="space-y-1.5 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{f.family}</span>
                {f.isDefault ? <Badge tone="info">Mặc định</Badge> : null}
                {f.source === 'custom' ? (
                  <Badge tone="success">Font tải lên</Badge>
                ) : f.source === 'mixed' ? (
                  <Badge tone="warning">Một phần tải lên</Badge>
                ) : (
                  <Badge tone="muted">Nhúng sẵn{f.substitute ? ` · ${f.substitute}` : ''}</Badge>
                )}
                {canEdit && f.source !== 'builtin' ? (
                  <Button size="sm" variant="ghost" className="ml-auto text-[var(--danger)]" onClick={() => void remove(f.family)}>
                    <Trash2 /> Xoá font tải lên
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {Object.entries(f.variants).map(([k, v]) => (
                  <span
                    key={k}
                    className={`rounded border px-1.5 py-0.5 ${v.source === 'custom' ? 'border-emerald-300 bg-emerald-50' : v.source === 'fallback' ? 'border-amber-300 bg-amber-50' : ''}`}
                    title={v.fileName ?? ''}
                  >
                    {VARIANT_LABEL[k]}: {v.source === 'custom' ? v.fileName : v.source === 'builtin' ? 'nhúng sẵn' : 'dùng kiểu thường'}
                  </span>
                ))}
              </div>
              <div className="truncate text-[15px]" style={{ fontFamily: cssFontFamily(f.family) }}>
                {SAMPLE}
              </div>
              <div className="truncate text-[15px] font-bold italic" style={{ fontFamily: cssFontFamily(f.family) }}>
                {SAMPLE}
              </div>
            </div>
          ))}
        </div>
      </div>
    </Dialog>
  );
}
