'use client';

import React, { useState, useEffect, useRef, use } from 'react';
import {
  Shield,
  Clock,
  Stethoscope,
  Lock,
  Maximize,
  CheckCircle2,
  Minimize2,
  RefreshCw,
  Sparkles,
  Smartphone,
  Sun,
  Moon,
} from 'lucide-react';
import QRCode from 'qrcode';
import { KioskLockdown } from '@/lib/kiosk-lockdown';

interface PageProps {
  params: Promise<{ roomCode: string }>;
}

export default function KioskPage({ params }: PageProps) {
  const { roomCode } = use(params);

  const [roomInfo, setRoomInfo] = useState<{ code: string; name: string }>({
    code: roomCode,
    name: `Phòng khám ${roomCode}`,
  });
  const [scheduledDuty, setScheduledDuty] = useState<any>(null);
  const [qrUrl, setQrUrl] = useState<string>('');
  const [expiresInSeconds, setExpiresInSeconds] = useState<number>(90);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showExitWarning, setShowExitWarning] = useState(false);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [activeSession, setActiveSession] = useState<any>(null);
  const [currentTime, setCurrentTime] = useState<string>('');
  const [isITModalOpen, setIsITModalOpen] = useState(false);
  const [itPinInput, setItPinInput] = useState('');
  const [itError, setItError] = useState<string | null>(null);
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [isMinimized, setIsMinimized] = useState(false);
  const [lockConfirmOpen, setLockConfirmOpen] = useState(false);

  const qrCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const secretClickCountRef = useRef(0);
  const secretClickTimeoutRef = useRef<any>(null);

  // 1. Đồng hồ thời gian thực
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setCurrentTime(
        now.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) +
          ' · ' +
          now.toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' }),
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // 2. Tải trạng thái phòng và tạo/lấy phiên QR
  const fetchKioskStatus = async () => {
    try {
      const resp = await fetch(`/api/kiosk/status?room=${roomCode}`);
      if (!resp.ok) return;
      const data = await resp.json();

      setRoomInfo(data.room);
      setScheduledDuty(data.currentScheduled || null);

      if (data.isUnlocked) {
        setIsUnlocked(true);
        setActiveSession(data.activeSession);
        return;
      }

      if (data.qrSession) {
        setQrUrl(data.qrSession.qrUrl);
        setExpiresInSeconds(data.qrSession.expiresInSeconds);
      }
    } catch (err) {
      console.warn('Lỗi nạp trạng thái Kiosk:', err);
    }
  };

  // 3. Làm mới mã QR
  const refreshQrSession = async () => {
    setIsRefreshing(true);
    try {
      const resp = await fetch('/api/kiosk/session/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, roomName: roomInfo.name }),
      });
      const data = await resp.json();
      if (data.success) {
        setQrUrl(data.qrUrl);
        setExpiresInSeconds(data.expiresInSeconds || 90);
      }
    } catch (err) {
      console.warn('Lỗi làm mới QR:', err);
    } finally {
      setIsRefreshing(false);
    }
  };

  // 4. Vẽ mã QR lên Canvas
  useEffect(() => {
    if (qrUrl && qrCanvasRef.current) {
      QRCode.toCanvas(qrCanvasRef.current, qrUrl, {
        width: 240,
        margin: 2,
        color: {
          dark: '#0f766e',
          light: '#ffffff',
        },
      });
    }
  }, [qrUrl]);

  // 5. Đếm lùi thời gian sống mã QR
  useEffect(() => {
    if (isUnlocked) return;
    const timer = setInterval(() => {
      setExpiresInSeconds((prev) => {
        if (prev <= 1) {
          refreshQrSession();
          return 90;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [roomInfo.name, isUnlocked]);

  // 6. Lắng nghe sự kiện mở khoá Server-Sent Events (SSE) thời gian thực
  useEffect(() => {
    fetchKioskStatus();

    const eventSource = new EventSource(`/api/kiosk/events/${roomCode}`);

    eventSource.addEventListener('UNLOCK_EVENT', (e) => {
      try {
        const payload = JSON.parse(e.data);
        if (payload.type === 'UNLOCK_SUCCESS') {
          setIsUnlocked(true);
          setActiveSession(payload.doctor);
          KioskLockdown.exitFullscreen().catch(() => {});
        }
      } catch (err) {
        console.warn('Lỗi xử lý sự kiện SSE:', err);
      }
    });

    eventSource.addEventListener('LOCK_EVENT', () => {
      setIsUnlocked(false);
      setActiveSession(null);
      KioskLockdown.enterFullscreen().catch(() => {});
      fetchKioskStatus();
    });

    return () => {
      eventSource.close();
    };
  }, [roomCode]);

  // 7. Khoá tính năng Kiosk chống can thiệp (Anti-Tamper Lockdown)
  useEffect(() => {
    if (isUnlocked) return;

    const lockdown = new KioskLockdown({
      enabled: true,
      onEmergencyTrigger: () => {
        setIsITModalOpen(true);
      },
      onFullscreenChange: (isFull) => {
        setShowExitWarning(!isFull);
        if (!isFull) {
          KioskLockdown.enterFullscreen().catch(() => {});
        }
      },
    });

    lockdown.activate();
    return () => lockdown.deactivate();
  }, [isUnlocked]);

  // Nhấp 5 lần bí mật vào logo để mở bảng IT
  const handleLogoSecretClick = () => {
    clearTimeout(secretClickTimeoutRef.current);
    secretClickCountRef.current += 1;
    if (secretClickCountRef.current >= 5) {
      setIsITModalOpen(true);
      secretClickCountRef.current = 0;
    } else {
      secretClickTimeoutRef.current = setTimeout(() => {
        secretClickCountRef.current = 0;
      }, 2000);
    }
  };

  const handleITOverride = async (e: React.FormEvent) => {
    e.preventDefault();
    setItError(null);
    try {
      const resp = await fetch('/api/kiosk/override-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode, pin: itPinInput }),
      });
      const data = await resp.json();
      if (!resp.ok) {
        throw new Error(data.message || 'Mã PIN khẩn cấp không đúng.');
      }
      setIsITModalOpen(false);
      setItPinInput('');
    } catch (err: any) {
      setItError(err.message || 'Lỗi mở khoá IT.');
    }
  };

  const handleLockRoom = async () => {
    try {
      await fetch('/api/kiosk/lock', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomCode }),
      });
      setLockConfirmOpen(false);
      setIsUnlocked(false);
      setActiveSession(null);
      KioskLockdown.enterFullscreen().catch(() => {});
      fetchKioskStatus();
    } catch (e) {
      console.warn('Lỗi khoá phòng:', e);
    }
  };

  // --- TRẠNG THÁI 1: ĐÃ MỞ KHOÁ (HIỆN MINI DOCK GÓC MÀN HÌNH ĐỂ LỘ DESKTOP) ---
  if (isUnlocked) {
    return (
      <div className="fixed top-3 right-3 z-50 select-none animate-in fade-in slide-in-from-top-4 duration-300">
        {!isMinimized ? (
          <div className="rounded-2xl border-2 border-teal-500/50 bg-slate-900/95 backdrop-blur-md p-3.5 shadow-2xl text-slate-100 flex items-center gap-4 max-w-lg">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/20 text-teal-400 border border-teal-500/30 shrink-0">
              <Stethoscope className="h-5 w-5" />
            </div>

            <div className="min-w-[170px]">
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] font-bold text-teal-400 uppercase tracking-wider bg-teal-950 px-1.5 py-0.5 rounded border border-teal-800">
                  {roomCode}
                </span>
                <span className="flex items-center gap-1 text-[10px] font-semibold text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Đã mở máy tính Windows
                </span>
              </div>
              <h3 className="text-xs font-bold text-white mt-0.5 truncate">
                {activeSession?.title || 'BS'} {activeSession?.fullName || 'Bác sĩ khám'}
              </h3>
              <span className="text-[10px] text-slate-400 font-mono">
                {activeSession?.shiftName || 'Ca làm việc'} · {currentTime.split('·')[0]}
              </span>
            </div>

            <div className="flex items-center gap-2 shrink-0 border-l border-slate-800 pl-3">
              <button
                type="button"
                onClick={() => setLockConfirmOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold shadow-lg shadow-rose-600/30 transition-all hover:scale-105 active:scale-95"
                title="Khoá màn hình máy tính ngay lập tức khi rời phòng"
              >
                <Lock className="h-3.5 w-3.5" />
                <span>Khoá máy / Rời phòng</span>
              </button>

              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                className="p-1.5 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
                title="Thu nhỏ thanh tiện ích"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsMinimized(false)}
            className="flex items-center gap-2 px-3 py-2 rounded-full border border-teal-500/40 bg-slate-900/90 backdrop-blur-md shadow-xl text-teal-300 hover:text-white transition-all"
          >
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
            </span>
            <span className="text-xs font-bold font-mono">
              {roomCode}: {activeSession?.fullName || 'Bác sĩ'}
            </span>
          </button>
        )}

        {/* Hộp thoại xác nhận khoá máy */}
        {lockConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
            <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-slate-900 p-6 shadow-2xl">
              <h3 className="text-base font-bold text-white mb-2">Khoá máy tính phòng khám {roomCode}?</h3>
              <p className="text-xs text-slate-400 mb-6">
                Màn hình máy tính Windows sẽ lập tức được phủ Kiosk toàn màn hình và yêu cầu Bác sĩ quét QR để mở khoá.
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setLockConfirmOpen(false)}
                  className="flex-1 py-2.5 rounded-xl border border-slate-700 bg-slate-800 text-slate-300 text-xs font-semibold"
                >
                  Huỷ bỏ
                </button>
                <button
                  type="button"
                  onClick={handleLockRoom}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-semibold"
                >
                  Khoá máy ngay
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  // --- TRẠNG THÁI 2: ĐANG KHOÁ (PHỦ TOÀN MÀN HÌNH BẢO VỆ MÁY TRẠM) ---
  return (
    <div
      className={`relative min-h-screen w-screen flex flex-col justify-between overflow-hidden select-none transition-colors duration-300 ${
        isDarkMode
          ? 'bg-gradient-to-b from-slate-950 via-slate-900 to-teal-950/40 text-slate-100'
          : 'bg-gradient-to-b from-slate-100 via-white to-teal-50 text-slate-900'
      }`}
    >
      {/* Cảnh báo khi người dùng thoát toàn màn hình */}
      {showExitWarning && (
        <div
          onClick={() => KioskLockdown.enterFullscreen()}
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-slate-950/95 backdrop-blur-xl p-6 text-center cursor-pointer"
        >
          <div className="h-20 w-20 rounded-3xl bg-amber-500/10 border-2 border-amber-500/40 text-amber-400 flex items-center justify-center mb-4">
            <Shield className="h-10 w-10 animate-pulse" />
          </div>
          <h2 className="text-xl font-black text-white">MÁY TRẠM YÊU CẦU TOÀN MÀN HÌNH</h2>
          <p className="mt-2 text-xs text-slate-400 max-w-sm">
            Nhấp chuột vào bất kỳ đâu để khôi phục chế độ toàn màn hình bảo vệ phòng khám.
          </p>
          <button
            type="button"
            className="mt-6 px-6 py-2.5 rounded-xl bg-teal-600 text-white font-bold text-xs"
          >
            Khôi phục toàn màn hình
          </button>
        </div>
      )}

      {/* Header đỉnh máy trạm */}
      <header
        className={`px-6 sm:px-8 py-4 sm:py-5 flex items-center justify-between border-b backdrop-blur-md ${
          isDarkMode ? 'border-slate-800/80 bg-slate-950/60' : 'border-slate-200 bg-white/80 shadow-sm'
        }`}
      >
        <div className="flex items-center gap-3 sm:gap-4">
          <button
            type="button"
            onClick={handleLogoSecretClick}
            className="flex h-12 w-12 sm:h-14 sm:w-14 items-center justify-center rounded-2xl bg-teal-500/10 border border-teal-500/30 text-teal-600 dark:text-teal-400 shadow-md cursor-pointer shrink-0"
            title="Nhấp 5 lần để mở hỗ trợ IT"
          >
            <Shield className="h-7 w-7 sm:h-8 sm:w-8" />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] sm:text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 bg-teal-50 dark:bg-teal-950/80 px-2 py-0.5 rounded border border-teal-200 dark:border-teal-800">
                QLBV · HỆ THỐNG PHÒNG KHÁM
              </span>
            </div>
            <h1 className="text-lg sm:text-2xl font-black tracking-tight mt-0.5">
              {roomInfo.name} <span className="text-teal-600 dark:text-teal-400 font-mono">[{roomInfo.code}]</span>
            </h1>
          </div>
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          <div className="text-right hidden md:block">
            <div className="flex items-center gap-1.5 text-xs font-semibold opacity-70 justify-end">
              <Clock className="h-3.5 w-3.5 text-teal-600 dark:text-teal-400" />
              <span>GIỜ HỆ THỐNG</span>
            </div>
            <div className="text-base sm:text-lg font-bold font-mono mt-0.5">{currentTime}</div>
          </div>

          <button
            type="button"
            onClick={() => setIsDarkMode(!isDarkMode)}
            className="p-2.5 rounded-xl border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/60 text-slate-700 dark:text-slate-300"
            title="Chuyển chế độ Sáng / Tối"
          >
            {isDarkMode ? <Sun className="h-4 w-4 text-amber-400" /> : <Moon className="h-4 w-4 text-teal-600" />}
          </button>

          <button
            type="button"
            onClick={() => setIsITModalOpen(true)}
            className="flex items-center gap-1.5 text-xs font-medium border border-slate-300 dark:border-slate-800 bg-white dark:bg-slate-900/60 px-3 py-2 rounded-xl"
            title="Hỗ trợ IT (Ctrl + Shift + Alt + F12)"
          >
            <Lock className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Kỹ thuật IT</span>
          </button>
        </div>
      </header>

      {/* Khối chính: Mã QR & Thông tin ca trực */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-5xl grid grid-cols-1 md:grid-cols-2 gap-8 sm:gap-12 items-center">
          {/* Cột trái: Thông tin ca trực & hướng dẫn */}
          <div className="space-y-5">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-500/10 border border-rose-500/30 text-rose-600 dark:text-rose-400 text-xs font-bold">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-rose-500"></span>
              </span>
              MÀN HÌNH ĐANG KHOÁ — CHỜ BÁC SĨ ĐIỂM DANH
            </div>

            <div>
              <h2 className="text-2xl sm:text-3xl font-black leading-tight">
                Quét mã QR bằng Camera điện thoại để mở khoá ca làm việc
              </h2>
              <p className="mt-2 text-xs sm:text-sm opacity-75 leading-relaxed">
                Hệ thống xác thực khuôn mặt người thật (ISO 30107 PAD) và tự động đối soát với bảng phân công ca trực của bệnh viện.
              </p>
            </div>

            {/* Thông tin Bác sĩ được xếp trực từ PostgreSQL CSDL QLBV */}
            <div
              className={`rounded-2xl border p-4 sm:p-5 space-y-3 ${
                isDarkMode ? 'border-teal-500/20 bg-teal-950/20' : 'border-teal-200 bg-teal-50/60 shadow-sm'
              }`}
            >
              <div className="flex items-center justify-between border-b border-teal-500/20 pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-teal-600 dark:text-teal-400 flex items-center gap-1.5">
                  <Stethoscope className="h-4 w-4" />
                  PHÂN CÔNG CA TRỰC HIỆN TẠI
                </span>
                <span className="text-xs font-mono bg-teal-600 text-white px-2.5 py-0.5 rounded-full font-bold">
                  {scheduledDuty?.shiftName || 'Ca Khám bệnh'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <span className="text-xs opacity-70 block">Bác sĩ khám chính:</span>
                  <span className="font-bold text-sm sm:text-base">
                    {scheduledDuty?.title} {scheduledDuty?.fullName || 'Đang cập nhật...'}
                  </span>
                </div>
                <div>
                  <span className="text-xs opacity-70 block">Khung giờ trực:</span>
                  <span className="font-semibold text-teal-600 dark:text-teal-300 font-mono">
                    {scheduledDuty?.startTime || '07:00'} – {scheduledDuty?.endTime || '17:00'}
                  </span>
                </div>
              </div>
            </div>

            {/* 3 Bước hướng dẫn */}
            <div className="grid grid-cols-3 gap-2.5 pt-1">
              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-center bg-white/50 dark:bg-slate-900/30">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-xs mb-1">
                  1
                </div>
                <p className="text-xs font-bold">Quét mã QR</p>
                <p className="text-[10px] opacity-70">Camera điện thoại</p>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-center bg-white/50 dark:bg-slate-900/30">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-xs mb-1">
                  2
                </div>
                <p className="text-xs font-bold">Quét khuôn mặt</p>
                <p className="text-[10px] opacity-70">Chớp mắt xác thực</p>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-2.5 text-center bg-white/50 dark:bg-slate-900/30">
                <div className="mx-auto flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/10 text-teal-600 dark:text-teal-400 font-bold text-xs mb-1">
                  3
                </div>
                <p className="text-xs font-bold">Mở khoá tức thì</p>
                <p className="text-[10px] opacity-70">Vào màn hình Desktop</p>
              </div>
            </div>
          </div>

          {/* Cột phải: Mã QR động */}
          <div className="flex flex-col items-center justify-center">
            <div className="relative p-4 sm:p-5 rounded-3xl bg-white shadow-2xl border-4 border-teal-500/30">
              <canvas ref={qrCanvasRef} />
            </div>

            <div className="mt-4 flex items-center gap-3 text-xs opacity-75">
              <span>Hết hạn sau: <strong className="font-mono text-teal-600 dark:text-teal-400">{expiresInSeconds}s</strong></span>
              <button
                type="button"
                onClick={refreshQrSession}
                disabled={isRefreshing}
                className="flex items-center gap-1 text-teal-600 dark:text-teal-400 hover:underline"
              >
                <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
                <span>Đổi mã mới</span>
              </button>
            </div>
          </div>
        </div>
      </main>

      {/* Footer đáy màn hình */}
      <footer
        className={`px-6 sm:px-8 py-3.5 border-t text-xs flex items-center justify-between opacity-75 ${
          isDarkMode ? 'border-slate-800/80 bg-slate-950/80' : 'border-slate-200 bg-white/80'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500"></span>
          <span>Bảo vệ Kiosk: Bật · Khóa Win+D, Task Manager & Phím điều hướng</span>
        </div>
        <div>
          <span>Phím IT khẩn cấp: <kbd className="px-1.5 py-0.5 rounded border font-mono text-[10px]">Ctrl + Shift + Alt + F12</kbd></span>
        </div>
      </footer>

      {/* Hộp thoại mở khoá IT khẩn cấp */}
      {isITModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <form
            onSubmit={handleITOverride}
            className="w-full max-w-sm rounded-3xl border border-slate-700 bg-slate-900 p-6 text-white shadow-2xl space-y-4"
          >
            <div className="flex items-center gap-2 border-b border-slate-800 pb-3">
              <Shield className="h-5 w-5 text-amber-400" />
              <h3 className="text-sm font-bold">Mở khoá Khẩn cấp dành cho IT</h3>
            </div>
            <p className="text-xs text-slate-400">Nhập mã PIN Quản trị viên để mở khoá trực tiếp máy trạm.</p>
            {itError && <p className="text-xs text-rose-400">{itError}</p>}
            <input
              type="password"
              required
              autoFocus
              placeholder="Nhập mã PIN IT"
              value={itPinInput}
              onChange={(e) => setItPinInput(e.target.value)}
              className="w-full rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 text-center text-lg tracking-widest font-mono text-white focus:outline-none focus:border-teal-500"
            />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setIsITModalOpen(false)}
                className="flex-1 py-2 rounded-xl border border-slate-700 text-xs text-slate-300"
              >
                Đóng
              </button>
              <button
                type="submit"
                className="flex-1 py-2 rounded-xl bg-teal-600 hover:bg-teal-500 text-xs font-bold text-white"
              >
                Mở khoá
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
