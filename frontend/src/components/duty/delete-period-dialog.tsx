"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input, Label, Textarea } from "@/components/ui/input";
import { DUTY_KEYS, dutyApi, fmtDate, type DutyPeriod } from "@/lib/duty";
import { errorText } from "./duty-shared";

/** Xoá cả kỳ lịch: phải có lý do và gõ lại đúng tên kỳ. Máy chủ vẫn kiểm tra lại mọi điều kiện. */
export function DeletePeriodDialog({
  period,
  onClose,
  onDeleted,
}: {
  period: DutyPeriod;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirmName, setConfirmName] = useState("");
  const published = period.status !== "NHAP";
  const reasonOk = reason.trim().length >= 5;
  const nameOk = confirmName.trim() === period.name.trim();

  const mut = useMutation({
    mutationFn: () => dutyApi.deletePeriod(period.id, { reason: reason.trim(), confirmName: confirmName.trim() }),
    onSuccess: (r) => {
      toast.success(r.notified ? `Đã xoá kỳ lịch và báo ${r.notified} nhân viên liên quan` : "Đã xoá kỳ lịch");
      qc.invalidateQueries({ queryKey: DUTY_KEYS.periods });
      onDeleted();
    },
    onError: (e) => toast.error(errorText(e)),
  });

  return (
    <Dialog
      open
      onClose={onClose}
      title="Xoá cả kỳ lịch"
      description={`${period.name} · ${fmtDate(period.startDate)} – ${fmtDate(period.endDate)}`}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={mut.isPending}>
            Huỷ
          </Button>
          <Button variant="danger" disabled={!reasonOk || !nameOk || mut.isPending} onClick={() => mut.mutate()}>
            {mut.isPending ? "Đang xoá…" : "Xoá kỳ lịch"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="space-y-1">
            <p className="font-medium">Thao tác không hoàn tác được.</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[13px]">
              <li>Xoá {period.slotCount ?? 0} ô trực và {period.filledCount ?? 0} lượt phân công trong kỳ.</li>
              <li>Huỷ các yêu cầu nhường/đổi ca đang chờ của kỳ này.</li>
              {published ? (
                <li>Nhân viên đã được xếp sẽ nhận thông báo huỷ ca kèm lý do.</li>
              ) : (
                <li>Kỳ nháp chưa công bố nên nhân viên không nhận thông báo.</li>
              )}
              <li>Nhật ký kỳ được giữ lại để đối soát.</li>
              <li>Không xoá được nếu đã có ca trực đã diễn ra hoặc đang diễn ra.</li>
            </ul>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="del-reason">
            Lý do xoá <span className="text-[var(--danger)]">*</span>
          </Label>
          <Textarea
            id="del-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ví dụ: nhập nhầm khoảng ngày, sẽ lập lại theo mẫu mới"
          />
          <div className="text-[11px] text-[var(--muted-foreground)]">Tối thiểu 5 ký tự. Lý do được ghi vào nhật ký.</div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="del-name">
            Gõ lại tên kỳ lịch để xác nhận <span className="text-[var(--danger)]">*</span>
          </Label>
          <Input
            id="del-name"
            value={confirmName}
            onChange={(e) => setConfirmName(e.target.value)}
            placeholder={period.name}
            autoComplete="off"
          />
          {confirmName && !nameOk ? <div className="text-[11px] text-rose-600">Tên chưa khớp với kỳ lịch.</div> : null}
        </div>
      </div>
    </Dialog>
  );
}
