'use client';

/**
 * Studio — hộp thoại cấu hình một ô widget:
 * chọn nguồn dữ liệu → chỉ số (tổng hợp) → kích thước nhóm → bộ lọc →
 * khoảng thời gian → sắp xếp/giới hạn → tuỳ chọn hiển thị.
 * Bên phảI là bản xem trước trực tiếp của ô đang thiết kế.
 */
import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input, Label, Select } from '@/components/ui/input';
import {
  BUILTIN_WIDGETS,
  WIDGET_TYPE_LABELS,
  type StudioDataSpec,
  type StudioDatePreset,
  type StudioDimension,
  type StudioFilter,
  type StudioFilterOp,
  type StudioMetric,
  type StudioSourceMeta,
  type StudioVocabulary,
  type StudioWidget,
  type StudioWidgetType,
} from '@/lib/studio';
import { WidgetBody, WIDGET_HEIGHTS } from './widget-view';

/* ------------------------------------------------------------------ phụ */

const NO_VALUE_OPS: StudioFilterOp[] = ['null', 'notnull'];

const OPS_BY_TYPE: Record<string, StudioFilterOp[]> = {
  text: ['eq', 'ne', 'in', 'nin', 'contains', 'starts', 'null', 'notnull'],
  enum: ['eq', 'ne', 'in', 'nin', 'null', 'notnull'],
  boolean: ['eq', 'null', 'notnull'],
  number: ['eq', 'ne', 'gt', 'gte', 'lt', 'lte', 'between', 'in', 'nin', 'null', 'notnull'],
  date: ['eq', 'gte', 'lte', 'between', 'null', 'notnull'],
  datetime: ['eq', 'gte', 'lte', 'between', 'null', 'notnull'],
};

const CHART_TYPES: StudioWidgetType[] = ['kpi', 'line', 'area', 'bar', 'barh', 'pie', 'donut', 'table'];

interface ConfigProps {
  open: boolean;
  widget: StudioWidget;
  sources: StudioSourceMeta[];
  vocabulary: StudioVocabulary;
  onClose: () => void;
  onSave: (widget: StudioWidget) => void;
}

export function WidgetConfigDialog({ open, widget, sources, vocabulary, onClose, onSave }: ConfigProps) {
  const [draft, setDraft] = useState<StudioWidget>(() => JSON.parse(JSON.stringify(widget)) as StudioWidget);

  // Nạp lại draft mỗi khi mở ô khác
  const [lastKey, setLastKey] = useState('');
  const openKey = `${open}-${widget.id}`;
  if (openKey !== lastKey) {
    setLastKey(openKey);
    setDraft(JSON.parse(JSON.stringify(widget)) as StudioWidget);
  }

  // Ô dữ liệu chưa có spec (vừa thêm từ palette) → khởi tạo spec mặc định
  if (open && draft.type !== 'text' && draft.type !== 'builtin' && !draft.dataSpec && sources.length > 0) {
    setDraft((d) => (d.dataSpec ? d : { ...d, dataSpec: defaultSpec(sources[0]) }));
  }

  const source = sources.find((s) => s.key === draft.dataSpec?.source);
  const isBuiltin = draft.type === 'builtin';
  const isText = draft.type === 'text';
  const isData = !isBuiltin && !isText;

  const patch = (changes: Partial<StudioWidget>) => setDraft((d) => ({ ...d, ...changes }));
  const patchSpec = (changes: Partial<StudioDataSpec>) =>
    setDraft((d) => ({ ...d, dataSpec: { ...(d.dataSpec as StudioDataSpec), ...changes } }));

  const previewHeight = Math.min(WIDGET_HEIGHTS[draft.h] ?? 300, 320);

  const handleTypeChange = (type: StudioWidgetType) => {
    const next: StudioWidget = { ...draft, type };
    if (type === 'text') { delete next.dataSpec; delete next.builtin; }
    if (type === 'builtin') { delete next.dataSpec; next.builtin = next.builtin ?? 'jobs'; }
    if (isData && CHART_TYPES.includes(type) && !next.dataSpec) {
      next.dataSpec = defaultSpec(sources[0]);
    }
    setDraft(next);
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="xl"
      title={`Cấu hình ô — ${WIDGET_TYPE_LABELS[draft.type]}`}
      description="Chỉ số và dữ liệu được kiểm tra an toàn phía máy chủ; ô chỉ hiển thị nguồn bạn có quyền xem"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Huỷ</Button>
          <Button
            onClick={() => {
              onSave(draft);
              onClose();
            }}
          >
            Lưu ô
          </Button>
        </>
      }
    >
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        {/* -------------------------------------------------- cấu hình */}
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Tiêu đề ô</Label>
              <Input
                value={draft.title}
                onChange={(e) => patch({ title: e.target.value })}
                placeholder="Ví dụ: Phiếu chờ duyệt theo khoa"
              />
            </div>
            <div>
              <Label>Loại hiển thị</Label>
              <Select data-testid="cfg-type" value={draft.type} onChange={(e) => handleTypeChange(e.target.value as StudioWidgetType)}>
                {CHART_TYPES.map((t) => (
                  <option key={t} value={t}>{WIDGET_TYPE_LABELS[t]}</option>
                ))}
                <option value="text">{WIDGET_TYPE_LABELS.text}</option>
                <option value="builtin">{WIDGET_TYPE_LABELS.builtin}</option>
              </Select>
            </div>
          </div>

          {isText ? (
            <div>
              <Label>Nội dung</Label>
              <textarea
                className="min-h-32 w-full rounded-lg border bg-transparent px-3 py-2 text-sm"
                value={String(draft.options?.text ?? '')}
                onChange={(e) => patch({ options: { ...draft.options, text: e.target.value } })}
                placeholder="Văn bản giải thích, tiêu đề nhóm…"
              />
            </div>
          ) : null}

          {isBuiltin ? (
            <div>
              <Label>Ô tích hợp</Label>
              <div className="grid gap-2">
                {BUILTIN_WIDGETS.map((b) => (
                  <label key={b.key} className="flex cursor-pointer items-start gap-2 rounded-lg border p-2 hover:bg-[var(--accent)]">
                    <input
                      type="radio"
                      name="builtin"
                      className="mt-1"
                      checked={draft.builtin === b.key}
                      onChange={() => patch({ builtin: b.key })}
                    />
                    <span>
                      <span className="block text-sm font-medium">{b.label}</span>
                      <span className="block text-xs text-[var(--muted-foreground)]">{b.description}</span>
                    </span>
                  </label>
                ))}
              </div>
            </div>
          ) : null}

          {isData && draft.dataSpec ? (
            <DataSpecEditor
              draft={draft}
              source={source}
              sources={sources}
              vocabulary={vocabulary}
              patchSpec={patchSpec}
              setDraft={setDraft}
            />
          ) : null}

          {/* Tuỳ chọn hiển thị cho KPI/biểu đồ */}
          {isData && draft.type === 'kpi' ? (
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Tông màu</Label>
                <Select
                  value={String(draft.options?.tone ?? 'default')}
                  onChange={(e) => patch({ options: { ...draft.options, tone: e.target.value } })}
                >
                  <option value="default">Mặc định</option>
                  <option value="primary">Xanh dương</option>
                  <option value="success">Xanh lá</option>
                  <option value="warning">Vàng</option>
                  <option value="danger">Đỏ</option>
                  <option value="muted">Xám</option>
                </Select>
              </div>
              <div>
                <Label>Định dạng số</Label>
                <Select
                  value={String(draft.options?.format ?? 'number')}
                  onChange={(e) => patch({ options: { ...draft.options, format: e.target.value } })}
                >
                  <option value="number">Số thường</option>
                  <option value="money">Tiền (đ)</option>
                </Select>
              </div>
              <div>
                <Label>Ghi chú phụ</Label>
                <Input
                  value={String(draft.options?.hint ?? '')}
                  onChange={(e) => patch({ options: { ...draft.options, hint: e.target.value } })}
                  placeholder="VD: so với tháng trước"
                />
              </div>
            </div>
          ) : null}

          {isData && draft.type !== 'kpi' && draft.type !== 'table' ? (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(draft.options?.fillGaps)}
                onChange={(e) => patch({ options: { ...draft.options, fillGaps: e.target.checked } })}
              />
              Điền đủ các ngày trống (biểu đồ theo ngày liền mạch)
            </label>
          ) : null}
        </div>

        {/* --------------------------------------------------- xem trước */}
        <div>
          <div className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--muted-foreground)]">
            Xem trước trực tiếp
          </div>
          <div
            className="flex flex-col overflow-hidden rounded-[var(--radius-card)] border bg-[var(--card)] shadow-sm"
            style={{ height: previewHeight }}
          >
            <div className="border-b px-3 py-1.5 text-sm font-semibold">{draft.title || '—'}</div>
            <div className="min-h-0 flex-1 p-3">
              <WidgetBodyLive draft={draft} />
            </div>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

/** Bản xem trước — debounce 450ms để gõ phím không gọi API liên tục */
function WidgetBodyLive({ draft }: { draft: StudioWidget }) {
  const [frozen, setFrozen] = useState<StudioWidget>(draft);
  useEffect(() => {
    const timer = setTimeout(() => setFrozen(JSON.parse(JSON.stringify(draft)) as StudioWidget), 450);
    return () => clearTimeout(timer);
  }, [draft]);
  return <WidgetBody widget={frozen} />;
}

/* ------------------------------------------------------- spec mặc định */

function defaultSpec(source?: StudioSourceMeta): StudioDataSpec {
  const firstId = source?.columns.find((c) => c.key === 'id') ?? source?.columns[0];
  return {
    source: source?.key ?? '',
    metrics: [{ field: firstId?.key ?? '*', agg: 'count' }],
    dimensions: [],
    filters: [],
    limit: 50,
  };
}

/* ----------------------------------------------------- biên tập dataSpec */

function DataSpecEditor({
  draft,
  source,
  sources,
  vocabulary,
  patchSpec,
  setDraft,
}: {
  draft: StudioWidget;
  source?: StudioSourceMeta;
  sources: StudioSourceMeta[];
  vocabulary: StudioVocabulary;
  patchSpec: (c: Partial<StudioDataSpec>) => void;
  setDraft: (fn: (d: StudioWidget) => StudioWidget) => void;
}) {
  const spec = draft.dataSpec!;
  const dateColumns = source?.columns.filter((c) => c.type === 'date' || c.type === 'datetime') ?? [];

  const setMetric = (i: number, changes: Partial<StudioMetric>) =>
    patchSpec({ metrics: spec.metrics.map((m, idx) => (idx === i ? { ...m, ...changes } : m)) });
  const setDimension = (i: number, changes: Partial<StudioDimension>) =>
    patchSpec({ dimensions: (spec.dimensions ?? []).map((d, idx) => (idx === i ? { ...d, ...changes } : d)) });
  const setFilter = (i: number, changes: Partial<StudioFilter>) =>
    patchSpec({ filters: (spec.filters ?? []).map((f, idx) => (idx === i ? { ...f, ...changes } : f)) });

  return (
    <div className="space-y-4 rounded-lg border p-3">
      {/* Nguồn */}
      <div>
        <Label>Nguồn dữ liệu</Label>
        <Select
          data-testid="cfg-source"
          value={spec.source}
          onChange={(e) => {
            const next = sources.find((s) => s.key === e.target.value);
            setDraft((d) => ({ ...d, dataSpec: defaultSpec(next) }));
          }}
        >
          {sources.map((s) => (
            <option key={s.key} value={s.key}>{s.name} ({s.module})</option>
          ))}
        </Select>
        {source?.description ? (
          <div className="mt-1 text-xs text-[var(--muted-foreground)]">{source.description}</div>
        ) : null}
      </div>

      {/* Chỉ số */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label className="mb-0">Chỉ số (tối đa 4)</Label>
          <Button
            size="sm"
            variant="ghost"
            disabled={spec.metrics.length >= 4}
            onClick={() => patchSpec({ metrics: [...spec.metrics, { field: source?.columns.find((c) => c.key === 'id')?.key ?? source?.columns[0]?.key ?? '*', agg: 'count' }] })}
          >
            <Plus className="size-3.5" /> Thêm chỉ số
          </Button>
        </div>
        <div className="space-y-2">
          {spec.metrics.map((m, i) => {
            const column = source?.columns.find((c) => c.key === m.field);
            const numericOnly = ['sum', 'avg', 'min', 'max'];
            return (
              <div key={i} className="flex items-center gap-2">
                <Select className="w-[38%]" value={m.field} onChange={(e) => setMetric(i, { field: e.target.value })}>
                  <option value="*">(Số dòng)</option>
                  {source?.columns.map((c) => (
                    <option key={c.key} value={c.key}>{c.label}</option>
                  ))}
                </Select>
                <Select className="w-[30%]" value={m.agg} onChange={(e) => setMetric(i, { agg: e.target.value as StudioMetric['agg'] })}>
                  <option value="count">Đếm</option>
                  <option value="countd">Đếm riêng biệt</option>
                  {numericOnly.map((agg) => (
                    <option key={agg} value={agg} disabled={!column?.numeric}>{vocabulary.aggs[agg as StudioMetric['agg']]}</option>
                  ))}
                </Select>
                <Input
                  className="flex-1"
                  placeholder="Tên hiển thị (tuỳ chọn)"
                  value={m.label ?? ''}
                  onChange={(e) => setMetric(i, { label: e.target.value })}
                />
                <button
                  type="button"
                  className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                  onClick={() => patchSpec({ metrics: spec.metrics.filter((_, idx) => idx !== i) })}
                  disabled={spec.metrics.length <= 1}
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {/* Kích thước nhóm */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label className="mb-0">Nhóm theo (tối đa 2)</Label>
          <Button
            size="sm"
            variant="ghost"
            disabled={(spec.dimensions ?? []).length >= 2}
            onClick={() => {
              const firstGroupable = source?.columns.find((c) => c.groupable);
              patchSpec({ dimensions: [...(spec.dimensions ?? []), { field: firstGroupable?.key ?? '' }] });
            }}
          >
            <Plus className="size-3.5" /> Thêm nhóm
          </Button>
        </div>
        {(spec.dimensions ?? []).map((d, i) => {
          const column = source?.columns.find((c) => c.key === d.field);
          const isDate = column?.type === 'date' || column?.type === 'datetime';
          return (
            <div key={i} className="mb-2 flex items-center gap-2">
              <Select className="flex-1" value={d.field} onChange={(e) => setDimension(i, { field: e.target.value, bucket: undefined })}>
                {source?.columns.filter((c) => c.groupable).map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </Select>
              {isDate ? (
                <Select
                  className="w-[36%]"
                  value={d.bucket ?? ''}
                  onChange={(e) => setDimension(i, { bucket: (e.target.value || undefined) as StudioDimension['bucket'] })}
                >
                  <option value="">Nguyên giá trị</option>
                  {Object.entries(vocabulary.buckets).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </Select>
              ) : <span className="w-[36%]" />}
              <button
                type="button"
                className="rounded p-1.5 text-rose-500 hover:bg-rose-50"
                onClick={() => patchSpec({ dimensions: (spec.dimensions ?? []).filter((_, idx) => idx !== i) })}
              >
                <Trash2 className="size-4" />
              </button>
            </div>
          );
        })}
      </div>

      {/* Bộ lọc */}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label className="mb-0">Bộ lọc</Label>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              const first = source?.columns[0];
              patchSpec({ filters: [...(spec.filters ?? []), { field: first?.key ?? '', op: 'eq', value: '' }] });
            }}
          >
            <Plus className="size-3.5" /> Thêm lọc
          </Button>
        </div>
        <div className="space-y-2">
          {(spec.filters ?? []).map((f, i) => {
            const column = source?.columns.find((c) => c.key === f.field);
            const ops = OPS_BY_TYPE[column?.type ?? 'text'] ?? OPS_BY_TYPE.text;
            return (
              <FilterRow
                key={i}
                filter={f}
                columnLabelType={column?.type ?? 'text'}
                options={column?.options}
                fields={source?.columns ?? []}
                ops={ops}
                opLabels={vocabulary.filterOps}
                onChange={(changes) => setFilter(i, changes)}
                onRemove={() => patchSpec({ filters: (spec.filters ?? []).filter((_, idx) => idx !== i) })}
              />
            );
          })}
        </div>
      </div>

      {/* Khoảng thời gian */}
      {dateColumns.length ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Khoảng thời gian</Label>
            <Select
              value={spec.dateRange?.preset ?? ''}
              onChange={(e) => {
                const value = e.target.value;
                patchSpec({
                  dateRange: value
                    ? { field: spec.dateRange?.field, preset: value as StudioDatePreset }
                    : undefined,
                });
              }}
            >
              <option value="">Toàn bộ thời gian</option>
              {Object.entries(vocabulary.datePresets).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </Select>
          </div>
          {spec.dateRange?.preset === 'custom' ? (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Từ ngày</Label>
                <Input type="date" value={spec.dateRange.from ?? ''} onChange={(e) => patchSpec({ dateRange: { ...spec.dateRange, from: e.target.value } })} />
              </div>
              <div>
                <Label>Đến ngày</Label>
                <Input type="date" value={spec.dateRange.to ?? ''} onChange={(e) => patchSpec({ dateRange: { ...spec.dateRange, to: e.target.value } })} />
              </div>
            </div>
          ) : (
            <div>
              <Label>Ngày áp dụng</Label>
              <Select
                value={spec.dateRange?.field ?? source?.dateDefault ?? ''}
                onChange={(e) => patchSpec({ dateRange: { ...(spec.dateRange ?? { preset: 'month' }), field: e.target.value } })}
              >
                {dateColumns.map((c) => (
                  <option key={c.key} value={c.key}>{c.label}</option>
                ))}
              </Select>
            </div>
          )}
        </div>
      ) : null}

      {/* Sắp xếp + giới hạn */}
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label>Sắp xếp theo</Label>
          <Select
            value={spec.orderBy?.[0]?.key ?? ''}
            onChange={(e) => {
              const key = e.target.value;
              patchSpec({
                orderBy: key ? [{ key, dir: spec.orderBy?.[0]?.dir ?? 'asc' }] : [],
              });
            }}
          >
            <option value="">Mặc định</option>
            {(spec.dimensions ?? []).map((d, i) => (
              <option key={`d${i}`} value={`d${i}`}>Nhóm {i + 1}</option>
            ))}
            {spec.metrics.map((m, i) => (
              <option key={`m${i}`} value={`m${i}`}>Chỉ số {i + 1}{m.label ? ` (${m.label})` : ''}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label>Chiều</Label>
          <Select
            value={spec.orderBy?.[0]?.dir ?? 'asc'}
            onChange={(e) => {
              const dir = e.target.value as 'asc' | 'desc';
              const key = spec.orderBy?.[0]?.key ?? `m0`;
              patchSpec({ orderBy: [{ key, dir }] });
            }}
          >
            <option value="asc">Tăng dần</option>
            <option value="desc">Giảm dần</option>
          </Select>
        </div>
        <div>
          <Label>Tối đa dòng</Label>
          <Input
            type="number"
            min={1}
            max={500}
            value={spec.limit ?? 50}
            onChange={(e) => patchSpec({ limit: Math.min(Number(e.target.value) || 50, 500) })}
          />
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- FilterRow */

function FilterRow({
  filter,
  fields,
  columnLabelType,
  options,
  ops,
  opLabels,
  onChange,
  onRemove,
}: {
  filter: StudioFilter;
  fields: StudioSourceMeta['columns'];
  columnLabelType: string;
  options?: { value: string; label: string }[];
  ops: StudioFilterOp[];
  opLabels: Record<StudioFilterOp, string>;
  onChange: (c: Partial<StudioFilter>) => void;
  onRemove: () => void;
}) {
  const needsValue = !NO_VALUE_OPS.includes(filter.op);
  const type = columnLabelType;

  return (
    <div className="rounded-lg border p-2">
      <div className="flex items-center gap-2">
        <Select
          className="w-[34%]"
          value={filter.field}
          onChange={(e) => onChange({ field: e.target.value, value: undefined, op: (OPS_BY_TYPE[fields.find((c) => c.key === e.target.value)?.type ?? 'text'] ?? ['eq'])[0] })}
        >
          {fields.map((c) => (
            <option key={c.key} value={c.key}>{c.label}</option>
          ))}
        </Select>
        <Select className="w-[24%]" value={filter.op} onChange={(e) => onChange({ op: e.target.value as StudioFilterOp })}>
          {ops.map((op) => (
            <option key={op} value={op}>{opLabels[op]}</option>
          ))}
        </Select>
        <div className="flex-1" />
        <button type="button" className="rounded p-1.5 text-rose-500 hover:bg-rose-50" onClick={onRemove}>
          <Trash2 className="size-4" />
        </button>
      </div>
      {needsValue ? (
        <div className="mt-2">
          <FilterValueInput filter={filter} type={type} options={options} onChange={onChange} />
        </div>
      ) : null}
    </div>
  );
}

function FilterValueInput({
  filter,
  type,
  options,
  onChange,
}: {
  filter: StudioFilter;
  type: string;
  options?: { value: string; label: string }[];
  onChange: (c: Partial<StudioFilter>) => void;
}) {
  const stringValue = useMemo(() => {
    if (Array.isArray(filter.value)) return filter.value.join(', ');
    return String(filter.value ?? '');
  }, [filter.value]);

  /* Enum đơn trị */
  if (type === 'enum' && options && (filter.op === 'eq' || filter.op === 'ne')) {
    return (
      <Select value={stringValue} onChange={(e) => onChange({ value: e.target.value })}>
        <option value="">— Chọn giá trị —</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </Select>
    );
  }

  /* Enum nhiều trị */
  if (type === 'enum' && options && (filter.op === 'in' || filter.op === 'nin')) {
    const selected = new Set(
      (Array.isArray(filter.value) ? filter.value : String(filter.value ?? '').split(',')).map(String).map((s) => s.trim()).filter(Boolean),
    );
    return (
      <div className="flex max-h-28 flex-wrap gap-1 overflow-auto rounded-lg border p-2">
        {options.map((o) => {
          const active = selected.has(o.value);
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => {
                const next = new Set(selected);
                if (active) next.delete(o.value); else next.add(o.value);
                onChange({ value: [...next] });
              }}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                active ? 'border-[var(--primary)] bg-[var(--primary)] text-white' : 'hover:bg-[var(--accent)]'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  /* Khoảng */
  if (filter.op === 'between') {
    const arr = Array.isArray(filter.value) ? filter.value : ['', ''];
    const inputType = type === 'date' || type === 'datetime' ? 'date' : type === 'number' ? 'number' : 'text';
    return (
      <div className="flex items-center gap-2">
        <Input type={inputType} value={String(arr[0] ?? '')} onChange={(e) => onChange({ value: [e.target.value, arr[1] ?? ''] })} />
        <span className="text-xs text-[var(--muted-foreground)]">đến</span>
        <Input type={inputType} value={String(arr[1] ?? '')} onChange={(e) => onChange({ value: [arr[0] ?? '', e.target.value] })} />
      </div>
    );
  }

  /* Danh sách text phân tách */
  if (filter.op === 'in' || filter.op === 'nin') {
    return (
      <Input
        placeholder="Giá trị, phân tách bằng dấu phẩy"
        value={stringValue}
        onChange={(e) => onChange({ value: e.target.value })}
      />
    );
  }

  const inputType = type === 'date' || type === 'datetime' ? 'date' : type === 'number' ? 'number' : 'text';
  return (
    <Input
      type={inputType}
      value={stringValue}
      placeholder="Giá trị lọc"
      onChange={(e) => onChange({ value: type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value })}
    />
  );
}
