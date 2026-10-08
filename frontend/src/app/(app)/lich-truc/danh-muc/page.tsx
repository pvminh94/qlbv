"use client";

import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { CrudTable, type CrudField } from "@/components/shared/crud-table";
import { PageHeader } from "@/components/shared/page-header";
import { Tabs } from "@/components/ui/tabs";
import { EmptyState } from "@/components/ui/card";
import { apiFetch } from "@/lib/api";
import { useAuth } from "@/lib/auth";

type Opt = { id?: number; value?: number | string; name?: string; label?: string };
const toOptions = (list: unknown) =>
  (Array.isArray(list) ? list : []).map((o: Opt) => ({
    value: (o.id ?? o.value) as number | string,
    label: String(o.name ?? o.label ?? ""),
  }));

/** Danh mục nền của Lịch trực: phòng khám, ca trực, vai trò trực, ngày nghỉ */
export default function DanhMucTrucPage() {
  const can = useAuth((s) => s.can);
  const canManage = can("duty.catalog.manage");
  const [tab, setTab] = useState("rooms");

  const departments = useQuery({
    queryKey: ["departments-options-duty"],
    queryFn: () => apiFetch<unknown>("/departments/options"),
    staleTime: 60_000,
  });
  const jobTitles = useQuery({
    queryKey: ["job-titles-options-duty"],
    queryFn: () => apiFetch<unknown>("/job-titles/options"),
    staleTime: 60_000,
  });
  const deptOptions = toOptions(departments.data);
  const titleOptions = toOptions(jobTitles.data).map((o) => ({ value: String(o.label), label: String(o.label) }));

  const roomFields: CrudField[] = [
    { name: "code", label: "Mã phòng", required: true, placeholder: "P1", help: "Viết liền, không dấu. Không phân biệt hoa thường." },
    { name: "name", label: "Tên phòng khám", required: true, placeholder: "Phòng khám số 1" },
    {
      name: "departmentId",
      label: "Khoa quản lý",
      type: "select",
      options: deptOptions.map((o) => ({ value: Number(o.value), label: o.label })),
      help: "Trưởng khoa chỉ xếp trực được cho phòng thuộc khoa mình. Bỏ trống: chỉ Điều phối toàn viện xếp.",
      hideInTable: false,
    },
    { name: "location", label: "Vị trí", placeholder: "Tầng 2, khu A", hideInTable: true },
    { name: "sortOrder", label: "Thứ tự hiển thị", type: "number", hideInTable: true, help: "Nhỏ hơn xếp trước trên lịch" },
    { name: "active", label: "Đang sử dụng", type: "switch", defaultValue: true, help: "Tắt để không sinh ô mới (ô cũ vẫn giữ)" },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  const shiftFields: CrudField[] = [
    { name: "code", label: "Mã ca", required: true, placeholder: "S", help: "Ví dụ: S (sáng), C (chiều), CD (cả ngày), D (đêm)" },
    { name: "name", label: "Tên ca", required: true, placeholder: "Ca sáng" },
    { name: "startTime", label: "Giờ bắt đầu", type: "time", required: true },
    { name: "endTime", label: "Giờ kết thúc", type: "time", required: true, help: "Kết thúc trước giờ bắt đầu = ca qua đêm" },
    { name: "isNight", label: "Ca đêm", type: "switch", defaultValue: false, hideInTable: true, help: "Ca đêm có giới hạn riêng và cần khoảng nghỉ liền kề" },
    { name: "color", label: "Màu hiển thị", placeholder: "#2563eb", hideInTable: true, help: "Mã màu dạng #RRGGBB" },
    { name: "sortOrder", label: "Thứ tự", type: "number", hideInTable: true },
    { name: "active", label: "Đang sử dụng", type: "switch", defaultValue: true },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  const roleFields: CrudField[] = [
    { name: "code", label: "Mã vai trò", required: true, placeholder: "BS" },
    { name: "name", label: "Tên vai trò trực", required: true, placeholder: "Bác sĩ trực" },
    {
      name: "requiredTitle",
      label: "Chức danh bắt buộc",
      type: "select",
      options: titleOptions.map((o) => ({ value: o.value, label: o.label })),
      help: "Chỉ người có chức danh này mới được xếp vào vai trò. Bỏ trống: không yêu cầu.",
    },
    { name: "sortOrder", label: "Thứ tự", type: "number", hideInTable: true },
    { name: "active", label: "Đang sử dụng", type: "switch", defaultValue: true },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  const closedFields: CrudField[] = [
    { name: "date", label: "Ngày nghỉ", type: "date", required: true },
    { name: "name", label: "Tên ngày nghỉ", required: true, placeholder: "Quốc khánh 2/9" },
    { name: "note", label: "Ghi chú", type: "textarea", hideInTable: true },
  ];

  if (!can("duty.view")) return <EmptyState title="Bạn chưa có quyền xem danh mục trực" />;

  return (
    <>
      <PageHeader
        title="Danh mục lịch trực"
        description="Phòng khám, ca trực, vai trò trực và ngày nghỉ. Thay đổi ở đây áp dụng cho các kỳ lịch lập sau; ô đã sinh không tự đổi."
      />
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          {
            key: "rooms",
            label: "Phòng khám",
            content: (
              <CrudTable
                title="Phòng khám trực"
                description="Danh sách phòng khám tham gia lịch trực"
                endpoint="/duty/rooms"
                fields={roomFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm phòng khám"
                searchPlaceholder="Tìm mã hoặc tên phòng"
              />
            ),
          },
          {
            key: "shifts",
            label: "Ca trực",
            content: (
              <CrudTable
                title="Ca trực"
                description="Khung giờ các ca trực. Ca đêm có thể bật/tắt tuỳ nhu cầu."
                endpoint="/duty/shifts"
                fields={shiftFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm ca trực"
                searchPlaceholder="Tìm mã hoặc tên ca"
              />
            ),
          },
          {
            key: "roles",
            label: "Vai trò trực",
            content: (
              <CrudTable
                title="Vai trò trực"
                description="Vai trò trong một ô trực (bác sĩ, điều dưỡng…) và chức danh tương ứng"
                endpoint="/duty/roles"
                fields={roleFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm vai trò"
                searchPlaceholder="Tìm vai trò"
              />
            ),
          },
          {
            key: "closed",
            label: "Ngày nghỉ",
            content: (
              <CrudTable
                title="Ngày nghỉ lễ / nghỉ chung"
                description="Ngày không sinh ô trực khi tạo lịch (ví dụ lễ, Tết)"
                endpoint="/duty/closed-days"
                fields={closedFields}
                canCreate={canManage}
                canEdit={canManage}
                canDelete={canManage}
                labelKey="name"
                createLabel="Thêm ngày nghỉ"
                searchPlaceholder="Tìm ngày nghỉ"
              />
            ),
          },
        ]}
      />
    </>
  );
}
