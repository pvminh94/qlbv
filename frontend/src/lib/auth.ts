'use client';

import { create } from 'zustand';
import { apiFetch, tokenStore } from './api';
import type { CurrentUser, LoginResult } from '@/types/api';

interface AuthState {
  user: CurrentUser | null;
  loading: boolean;
  /** Đăng nhập và lưu token */
  login: (username: string, password: string) => Promise<CurrentUser>;
  /** Nạp lại thông tin người dùng hiện tại theo token đang có */
  loadMe: () => Promise<CurrentUser | null>;
  logout: (allDevices?: boolean) => Promise<void>;
  /** Người dùng có quyền hay vai trò tương ứng? */
  can: (permission: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  loading: false,

  async login(username, password) {
    set({ loading: true });
    try {
      const result = await apiFetch<LoginResult>('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      tokenStore.set(result.accessToken, result.refreshToken);
      set({ user: result.user, loading: false });
      return result.user;
    } catch (err) {
      set({ loading: false });
      throw err;
    }
  },

  async loadMe() {
    if (!tokenStore.access) return null;
    try {
      const user = await apiFetch<CurrentUser>('/auth/me');
      set({ user });
      return user;
    } catch (err) {
      const status = (err as { statusCode?: number }).statusCode;
      // Chỉ coi là "hết phiên" khi máy chủ nói rõ 401/403 — lỗi mạng thì ném ra
      // để layout hiện "thử lại" thay vì đăng xuất oan.
      if (status === 401 || status === 403) {
        tokenStore.clear();
        set({ user: null });
        return null;
      }
      throw err;
    }
  },

  async logout(allDevices = false) {
    try {
      // Thu hồi mọi phiên bằng DELETE /auth/sessions, phiên hiện tại bằng POST /auth/logout
      await apiFetch(allDevices ? '/auth/sessions' : '/auth/logout', { method: allDevices ? 'DELETE' : 'POST' });
    } catch {
      /* token có thể đã hết hạn — vẫn xoá ở máy khách */
    }
    tokenStore.clear();
    set({ user: null });
  },

  can(permission) {
    const { user } = get();
    if (!user) return false;
    if (user.isSuperAdmin) return true;
    return user.permissions.includes(permission);
  },
}));
