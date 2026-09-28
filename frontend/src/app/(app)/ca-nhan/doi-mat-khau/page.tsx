'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { KeyRound } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/shared/page-header';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { apiFetch } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function ChangePasswordPage() {
  const router = useRouter();
  const logout = useAuth((s) => s.logout);
  const { data: publicSettings } = useQuery({
    queryKey: ['settings-public'],
    queryFn: () => apiFetch<Record<string, unknown>>('/settings/public'),
    staleTime: 60_000,
  });
  const minPwdLength = Number(publicSettings?.['system.passwordMinLength']) || 6;

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const change = useMutation({
    mutationFn: () =>
      apiFetch('/auth/change-password', {
        method: 'POST',
        body: { currentPassword, newPassword, confirmPassword },
      }),
    onSuccess: async () => {
      toast.success('Đã đổi mật khẩu. Vui lòng đăng nhập lại.');
      await logout();
      router.replace('/login');
    },
    onError: (err) => toast.error((err as Error).message),
  });

  return (
    <div className="space-y-4">
      <PageHeader title="Đổi mật khẩu" description={`Mật khẩu mới cần tối thiểu ${minPwdLength} ký tự; mọi phiên đăng nhập khác sẽ bị thu hồi`} />
      <Card className="max-w-lg">
        <form
          className="space-y-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (newPassword !== confirmPassword) {
              toast.error('Mật khẩu nhập lại không khớp');
              return;
            }
            change.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="cur">Mật khẩu hiện tại *</Label>
            <Input id="cur" type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new">Mật khẩu mới *</Label>
            <Input id="new" type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={minPwdLength} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm">Nhập lại mật khẩu mới *</Label>
            <Input id="confirm" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
          </div>
          <Button type="submit" loading={change.isPending}>
            <KeyRound /> Đổi mật khẩu
          </Button>
        </form>
      </Card>
    </div>
  );
}
