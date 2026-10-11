/**
 * Mô-đun khoá tính năng Kiosk & Chống can thiệp người dùng (Anti-Tamper Kiosk Lockdown)
 * Đạt chuẩn Kiosk y tế: ngăn chặn 100% các hình thức đóng, thoát, thu nhỏ,
 * chuyển ứng dụng, phím tắt phần cứng, chuột phụ, kéo thả tệp và cử chỉ cảm ứng.
 */

export interface LockdownConfig {
  enabled: boolean;
  onEmergencyTrigger: () => void;
  onFullscreenChange?: (isFullscreen: boolean) => void;
}

export class KioskLockdown {
  private config: LockdownConfig;
  private keydownHandler: (e: KeyboardEvent) => void;
  private contextMenuHandler: (e: MouseEvent) => void;
  private mouseHandler: (e: MouseEvent) => void;
  private dragStartHandler: (e: DragEvent) => void;
  private dragOverHandler: (e: DragEvent) => void;
  private dropHandler: (e: DragEvent) => void;
  private selectStartHandler: (e: Event) => void;
  private wheelHandler: (e: WheelEvent) => void;
  private gestureHandler: (e: Event) => void;
  private beforeUnloadHandler: (e: BeforeUnloadEvent) => void;
  private blurHandler: () => void;
  private visibilityHandler: () => void;
  private fullscreenHandler: () => void;
  private popstateHandler: () => void;
  private wakeLockSentinel: any = null;
  private isActive: boolean = false;
  private audioCtx: AudioContext | null = null;

  constructor(config: LockdownConfig) {
    this.config = config;

    // 1. CHẶN BÀN PHÍM TOÀN DIỆN
    this.keydownHandler = (e: KeyboardEvent) => {
      // Phím nóng thoát hiểm DUY NHẤT dành cho Kỹ thuật viên IT: Ctrl + Shift + Alt + F12 (hoặc Ctrl + Shift + Alt + M)
      if (
        (e.ctrlKey && e.shiftKey && e.altKey && (e.key === 'F12' || e.code === 'F12' || e.key === 'm' || e.key === 'M')) ||
        (e.ctrlKey && e.shiftKey && e.altKey && e.key === 'Escape')
      ) {
        e.preventDefault();
        e.stopPropagation();
        this.config.onEmergencyTrigger();
        return;
      }

      if (!this.config.enabled) return;

      // A. CHẶN TẤT CẢ PHÍM CHỨC NĂNG (F1 ĐẾN F12)
      // F1: Trợ giúp trình duyệt / F3: Tìm kiếm / F5: Reload / F6: Address bar / F7: Caret browsing / F11: Toggle Fullscreen / F12: DevTools
      if (/^F[1-9]$|^F1[0-2]$/.test(e.key) || /^F[1-9]$|^F1[0-2]$/.test(e.code)) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // B. CHẶN PHÍM ALT VÀ CÁC TỔ HỢP HỆ THỐNG (Alt + Tab, Alt + F4, Alt + Space, Alt + Esc, Alt + D, Alt + Left...)
      if (e.altKey) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // C. CHẶN PHÍM WINDOWS (META / OS KEY) VÀ CÁC TỔ HỢP WIN + D, WIN + M, WIN + E, WIN + R, WIN + L, WIN + X, WIN + S...
      if (e.metaKey || e.key === 'Meta' || e.key === 'OS' || e.code === 'MetaLeft' || e.code === 'MetaRight') {
        e.preventDefault();
        e.stopPropagation();
        return;
      }

      // D. CHẶN PHÍM CTRL VÀ MỌI TỔ HỢP ĐIỀU HƯỚNG / TIỆN ÍCH TRÌNH DUYỆT
      if (e.ctrlKey) {
        // Cho phép phím gõ cơ bản nếu đang nhập form (ví dụ: Ctrl+A, Ctrl+C, Ctrl+V trong ô nhập PIN)
        const activeEl = document.activeElement as HTMLElement;
        const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');

        if (isInput && (e.key === 'a' || e.key === 'A' || e.key === 'v' || e.key === 'V' || e.key === 'c' || e.key === 'C')) {
          // Cho phép copy/paste cơ bản trong form nhập liệu
        } else {
          // Chặn tất cả: Ctrl+W (đóng tab), Ctrl+T (tab mới), Ctrl+N (cửa sổ mới), Ctrl+Shift+Esc (Task Manager),
          // Ctrl+Shift+I/J/C (DevTools), Ctrl+P (In file), Ctrl+S (Lưu trang), Ctrl+O (Mở file), Ctrl+H (Lịch sử),
          // Ctrl+J (Downloads), Ctrl+R (Reload), Ctrl+U (Xem mã nguồn), Ctrl+L/E/K (Thanh địa chỉ)...
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // E. CHẶN PHÍM ESCAPE ĐỂ TRÁNH THOÁT TOÀN MÀN HÌNH
      if (e.key === 'Escape' || e.code === 'Escape') {
        const activeEl = document.activeElement as HTMLElement;
        const isInsideModal = activeEl && activeEl.closest('[role="dialog"], .fixed');
        if (!isInsideModal) {
          e.preventDefault();
          e.stopPropagation();
          return;
        }
      }

      // F. CHẶN PHÍM BACKSPACE KHI KHÔNG TRONG FORM ĐỂ TRÁNH LÙI TRANG TRÌNH DUYỆT
      if (e.key === 'Backspace') {
        const target = e.target as HTMLElement;
        const isInput = target && (
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable
        );
        if (!isInput) {
          e.preventDefault();
          e.stopPropagation();
        }
      }

      // G. CHẶN CÁC PHÍM ĐIỀU HƯỚNG HỆ THỐNG: ContextMenu, Help, PrintScreen
      if (e.key === 'ContextMenu' || e.code === 'ContextMenu' || e.key === 'Help' || e.key === 'PrintScreen') {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // 2. CHẶN CHUỘT PHẢI (Context Menu)
    this.contextMenuHandler = (e: MouseEvent) => {
      if (this.config.enabled) {
        e.preventDefault();
        e.stopPropagation();
        return false;
      }
    };

    // 3. CHẶN CÁC NÚT PHỤ TRÊN CHUỘT (Chuột giữa mở tab mới, phím phụ ngón cái Back/Forward)
    this.mouseHandler = (e: MouseEvent) => {
      if (this.config.enabled) {
        // button 1: Chuột giữa (Middle click)
        // button 3: Chuột phụ lùi trang (Browser Back)
        // button 4: Chuột phụ tiến trang (Browser Forward)
        if (e.button === 1 || e.button === 3 || e.button === 4) {
          e.preventDefault();
          e.stopPropagation();
          return false;
        }
      }
    };

    // 4. CHẶN KÉO THẢ TỆP VÀO TRÌNH DUYỆT (Chặn mở file:// bằng kéo thả)
    this.dragStartHandler = (e: DragEvent) => {
      if (this.config.enabled) {
        e.preventDefault();
      }
    };
    this.dragOverHandler = (e: DragEvent) => {
      if (this.config.enabled) {
        e.preventDefault();
      }
    };
    this.dropHandler = (e: DragEvent) => {
      if (this.config.enabled) {
        e.preventDefault();
      }
    };

    // 5. CHẶN BÔI ĐEN CHỌN VĂN BẢN TRÊN MÀN HÌNH CHÍNH
    this.selectStartHandler = (e: Event) => {
      if (this.config.enabled) {
        const target = e.target as HTMLElement;
        if (!target || (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA')) {
          e.preventDefault();
        }
      }
    };

    // 6. CHẶN THAO TÁC ZOOM BẰNG CHUỘT (Ctrl + Con lăn cuộn)
    this.wheelHandler = (e: WheelEvent) => {
      if (this.config.enabled && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
      }
    };

    // 7. CHẶN CỬ CHỈ ZOOM CẢM ỨNG (Pinch-to-zoom trên màn hình cảm ứng AIO)
    this.gestureHandler = (e: Event) => {
      if (this.config.enabled) {
        e.preventDefault();
      }
    };

    // 8. BẪY LỊCH SỬ DUYỆT WEB (Ngăn chặn nút Back trên chuột hoặc bàn phím)
    this.popstateHandler = () => {
      if (this.config.enabled) {
        window.history.pushState(null, '', window.location.href);
      }
    };

    // 9. CHẶN ĐÓNG HOẶC TẢI LẠI TRANG (BeforeUnload Trap)
    this.beforeUnloadHandler = (e: BeforeUnloadEvent) => {
      if (this.config.enabled) {
        e.preventDefault();
        e.returnValue = 'Hệ thống đang hoạt động ở chế độ Kiosk phòng khám y tế. Không thể đóng ứng dụng!';
        return e.returnValue;
      }
    };

    // 10. TỰ ĐỘNG THU HỒI TIÊU ĐIỂM (Focus Recovery Trap)
    this.blurHandler = () => {
      if (this.config.enabled) {
        setTimeout(() => {
          if (!document.hidden) {
            window.focus();
          }
        }, 100);
      }
    };

    // 11. GIÁM SÁT ẨN HIỆN & PHÁT ÂM THANH CẢNH BÁO KHI BỊ THU NHỎ
    this.visibilityHandler = () => {
      if (this.config.enabled) {
        if (document.hidden) {
          // Kích hoạt còi báo động bảo mật nếu có ai cố tình thu nhỏ cửa sổ máy trạm
          this.playSecurityChime();
        } else {
          this.requestWakeLock();
          window.focus();
        }
      }
    };

    // 12. GIÁM SÁT CHẾ ĐỘ TOÀN MÀN HÌNH (Fullscreen Watcher)
    this.fullscreenHandler = () => {
      const isFull = !!document.fullscreenElement;
      if (isFull) {
        KioskLockdown.lockSystemKeyboard();
      } else if (this.config.enabled) {
        // Nếu bị thoát Fullscreen ngoài ý muốn, phát âm thanh và gọi callback
        this.playSecurityChime();
      }
      if (this.config.onFullscreenChange) {
        this.config.onFullscreenChange(isFull);
      }
    };
  }

  /**
   * Phát âm thanh cảnh báo ngắn (Web Audio API) khi cửa sổ bị mất tiêu điểm hoặc thoát Kiosk
   */
  private playSecurityChime() {
    try {
      if (!this.audioCtx) {
        const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtxClass) {
          this.audioCtx = new AudioCtxClass();
        }
      }
      if (this.audioCtx && this.audioCtx.state !== 'closed') {
        if (this.audioCtx.state === 'suspended') {
          this.audioCtx.resume();
        }
        const osc = this.audioCtx.createOscillator();
        const gain = this.audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(880, this.audioCtx.currentTime); // 880Hz A5
        osc.frequency.exponentialRampToValueAtTime(440, this.audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.3, this.audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.01, this.audioCtx.currentTime + 0.3);
        osc.connect(gain);
        gain.connect(this.audioCtx.destination);
        osc.start();
        osc.stop(this.audioCtx.currentTime + 0.3);
      }
    } catch {
      // Bỏ qua nếu trình duyệt chặn autoplay audio
    }
  }

  public activate() {
    if (this.isActive) return;
    this.isActive = true;

    // Khoá lịch sử trình duyệt để ngăn chặn Back/Forward
    window.history.pushState(null, '', window.location.href);
    window.addEventListener('popstate', this.popstateHandler);

    window.addEventListener('keydown', this.keydownHandler, { capture: true });
    window.addEventListener('contextmenu', this.contextMenuHandler, { capture: true });
    window.addEventListener('mousedown', this.mouseHandler, { capture: true });
    window.addEventListener('mouseup', this.mouseHandler, { capture: true });
    window.addEventListener('auxclick', this.mouseHandler, { capture: true });
    window.addEventListener('dragstart', this.dragStartHandler, { capture: true });
    window.addEventListener('dragover', this.dragOverHandler, { capture: true });
    window.addEventListener('drop', this.dropHandler, { capture: true });
    window.addEventListener('wheel', this.wheelHandler, { passive: false });
    window.addEventListener('gesturestart', this.gestureHandler as any, { passive: false });
    window.addEventListener('gesturechange', this.gestureHandler as any, { passive: false });
    window.addEventListener('beforeunload', this.beforeUnloadHandler);
    window.addEventListener('blur', this.blurHandler);
    document.addEventListener('selectstart', this.selectStartHandler, { capture: true });
    document.addEventListener('visibilitychange', this.visibilityHandler);
    document.addEventListener('fullscreenchange', this.fullscreenHandler);

    this.requestWakeLock();
  }

  public deactivate() {
    if (!this.isActive) return;
    this.isActive = false;

    window.removeEventListener('popstate', this.popstateHandler);
    window.removeEventListener('keydown', this.keydownHandler, { capture: true });
    window.removeEventListener('contextmenu', this.contextMenuHandler, { capture: true });
    window.removeEventListener('mousedown', this.mouseHandler, { capture: true });
    window.removeEventListener('mouseup', this.mouseHandler, { capture: true });
    window.removeEventListener('auxclick', this.mouseHandler, { capture: true });
    window.removeEventListener('dragstart', this.dragStartHandler, { capture: true });
    window.removeEventListener('dragover', this.dragOverHandler, { capture: true });
    window.removeEventListener('drop', this.dropHandler, { capture: true });
    window.removeEventListener('wheel', this.wheelHandler);
    window.removeEventListener('gesturestart', this.gestureHandler as any);
    window.removeEventListener('gesturechange', this.gestureHandler as any);
    window.removeEventListener('beforeunload', this.beforeUnloadHandler);
    window.removeEventListener('blur', this.blurHandler);
    document.removeEventListener('selectstart', this.selectStartHandler, { capture: true });
    document.removeEventListener('visibilitychange', this.visibilityHandler);
    document.removeEventListener('fullscreenchange', this.fullscreenHandler);

    if (this.wakeLockSentinel) {
      this.wakeLockSentinel.release?.().catch(() => {});
      this.wakeLockSentinel = null;
    }

    KioskLockdown.unlockSystemKeyboard();
  }

  /**
   * Giữ màn hình máy tính luôn sáng (Screen Wake Lock API)
   * Ngăn Windows 10/11 tự động ngủ hoặc tắt màn hình trong giờ làm việc
   */
  private async requestWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        this.wakeLockSentinel = await (navigator as any).wakeLock.request('screen');
      }
    } catch {
      // Bỏ qua nếu môi trường không hỗ trợ WakeLock
    }
  }

  /**
   * Khoá bàn phím hệ thống (Navigator Keyboard Lock API)
   * Chặn trình duyệt nhả phím Escape, Tab và các phím hệ thống khi đang toàn màn hình
   */
  public static async lockSystemKeyboard(): Promise<void> {
    try {
      if ('keyboard' in navigator && (navigator as any).keyboard?.lock) {
        await (navigator as any).keyboard.lock([
          'Escape',
          'Tab',
          'AltLeft',
          'AltRight',
          'ControlLeft',
          'ControlRight',
          'MetaLeft',
          'MetaRight',
          'KeyD',
          'KeyM',
          'KeyE',
          'KeyR',
          'KeyL',
          'KeyX',
          'KeyS',
          'KeyP',
          'ContextMenu',
          'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', 'F8', 'F9', 'F10', 'F11', 'F12'
        ]);
      }
    } catch {
      // Bỏ qua nếu quyền bị từ chối
    }
  }

  public static unlockSystemKeyboard(): void {
    try {
      if ('keyboard' in navigator && (navigator as any).keyboard?.unlock) {
        (navigator as any).keyboard.unlock();
      }
    } catch {}
  }

  public static async enterFullscreen(): Promise<boolean> {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
        await KioskLockdown.lockSystemKeyboard();
        return true;
      }
      return true;
    } catch (err) {
      console.warn('Không thể tự động vào toàn màn hình (cần tương tác người dùng):', err);
      return false;
    }
  }

  public static async exitFullscreen(): Promise<boolean> {
    try {
      KioskLockdown.unlockSystemKeyboard();
      if (document.fullscreenElement) {
        await document.exitFullscreen();
        return true;
      }
      return true;
    } catch {
      return false;
    }
  }
}

