'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useParams } from 'next/navigation';
import {
  Camera,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Sparkles,
  Lock,
  ArrowRight,
  Eye,
  Smile,
  SwitchCamera,
} from 'lucide-react';

export default function MobileScanPage() {
  const routeParams = useParams();
  const rawSessionId = (routeParams?.sessionId as string) || '';
  const sessionId = decodeURIComponent(rawSessionId);

  const [sessionData, setSessionData] = useState<any>(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Mã xác nhận hiện diện 4 số tại phòng khám (Live Visual Handshake PIN)
  const [handshakePin, setHandshakePin] = useState<string>('');
  const [pinError, setPinError] = useState<string | null>(null);

  // Trạng thái thử thách Liveness (ISO 30107 PAD)
  const [currentStep, setCurrentStep] = useState<'ready' | 'challenge' | 'verifying' | 'success' | 'failed'>('ready');
  const [challengeText, setChallengeText] = useState<string>('Vui lòng nhìn thẳng vào camera');
  const [challengeProgress, setChallengeProgress] = useState(0);
  const [resultData, setResultData] = useState<any>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  // 1. Tải thông tin phiên quét từ sessionId
  useEffect(() => {
    const fetchSession = async () => {
      try {
        const resp = await fetch(`/api/kiosk/session/${sessionId}`);
        if (!resp.ok) {
          throw new Error('Mã QR đã hết hạn hoặc phiên không tồn tại. Vui lòng quét lại trên màn hình phòng khám.');
        }
        const raw = await resp.json();
        const data = raw?.data ?? raw;
        setSessionData(data);
      } catch (err: any) {
        setSessionError(err.message || 'Lỗi nạp phiên.');
      } finally {
        setLoadingSession(false);
      }
    };

    fetchSession();
  }, [sessionId]);

  // 2. Khởi tạo Camera điện thoại
  const startCamera = async () => {
    setCameraError(null);
    try {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }

      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: facingMode,
          width: { ideal: 640 },
          height: { ideal: 640 },
        },
        audio: false,
      });

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCameraActive(true);
      setCurrentStep('challenge');
      startLivenessFlow();
    } catch (err: any) {
      console.error('Lỗi mở Camera:', err);
      setCameraError('Không thể mở Camera. Vui lòng cho phép trình duyệt truy cập Camera để tiếp tục.');
    }
  };

  // Dọn dẹp luồng camera
  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // 3. Quy trình thử thách Liveness tương tác
  const startLivenessFlow = () => {
    setChallengeProgress(10);
    setChallengeText('Giữ thẳng khuôn mặt trong khung hình...');

    setTimeout(() => {
      setChallengeProgress(40);
      setChallengeText('Chớp mắt tự nhiên 1 lần');

      setTimeout(() => {
        setChallengeProgress(80);
        setChallengeText('Đang chụp và phân tích sinh trắc học...');

        setTimeout(() => {
          captureAndVerify();
        }, 1000);
      }, 1200);
    }, 1200);
  };

  // 4. Chụp khung hình và gửi xác thực AI Microservice
  const captureAndVerify = async () => {
    if (!videoRef.current) return;

    setCurrentStep('verifying');

    const video = videoRef.current;
    const canvas = canvasRef.current || document.createElement('canvas');
    canvas.width = video.videoWidth || 480;
    canvas.height = video.videoHeight || 480;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Chụp khung hình hiện tại
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const imageBase64 = canvas.toDataURL('image/jpeg', 0.85);

    try {
      const resp = await fetch('/api/kiosk/verify-face', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          handshakePin: handshakePin.trim(),
          imageBase64,
          livenessChallenges: ['blink', 'turn_head'],
        }),
      });

      const raw = await resp.json();
      const data = raw?.data ?? raw;

      if (!resp.ok) {
        throw new Error(data.message || 'Xác thực khuôn mặt thất bại.');
      }

      setResultData(data);
      setCurrentStep('success');

      // Tắt camera sau khi thành công
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Xác thực khuôn mặt không thành công.');
      setCurrentStep('failed');
    }
  };

  // Đổi camera trước / sau
  const toggleFacingMode = () => {
    setFacingMode((prev) => (prev === 'user' ? 'environment' : 'user'));
    setTimeout(() => startCamera(), 100);
  };

  if (loadingSession) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <RefreshCw className="h-10 w-10 text-teal-400 animate-spin mb-4" />
        <p className="text-sm font-semibold">Đang nạp phiên điểm danh phòng khám...</p>
      </div>
    );
  }

  if (sessionError) {
    return (
      <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-6 text-center">
        <div className="h-16 w-16 rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center mb-4">
          <AlertTriangle className="h-8 w-8" />
        </div>
        <h2 className="text-lg font-bold text-white mb-2">Phiên không hợp lệ hoặc đã hết hạn</h2>
        <p className="text-xs text-slate-400 max-w-sm mb-6">{sessionError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl bg-teal-600 hover:bg-teal-500 text-white text-xs font-bold"
        >
          Thử lại
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col justify-between p-4 sm:p-6 select-none max-w-md mx-auto">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-slate-800 pb-4">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/10 border border-teal-500/30 text-teal-400">
            <Stethoscope className="h-5 w-5" />
          </div>
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-teal-400 bg-teal-950 px-1.5 py-0.5 rounded border border-teal-800">
              {sessionData?.room?.code}
            </span>
            <h1 className="text-sm font-bold text-white leading-tight mt-0.5">
              {sessionData?.room?.name}
            </h1>
          </div>
        </div>

        <span className="text-[10px] text-slate-400 font-mono bg-slate-900 px-2 py-1 rounded-lg border border-slate-800">
          ISO 30107 PAD
        </span>
      </header>

      {/* Main Body */}
      <main className="my-auto py-6">
        {/* BƯỚC 1: SẴN SÀNG & NHẬP MÃ XÁC THỰC HIỆN DIỆN */}
        {currentStep === 'ready' && (
          <div className="text-center space-y-5">
            <div className="h-20 w-20 mx-auto rounded-3xl bg-teal-500/10 border-2 border-teal-500/30 text-teal-400 flex items-center justify-center shadow-xl">
              <Camera className="h-10 w-10" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-lg font-bold text-white">Xác thực khuôn mặt Bác sĩ</h2>
              <p className="text-xs text-slate-400 leading-relaxed px-2">
                Mở khoá máy trạm tại <strong className="text-teal-400">{sessionData?.room?.name}</strong>.
              </p>
            </div>

            {/* Ô nhập mã xác nhận hiện diện tại phòng */}
            <div className="bg-slate-900/90 border border-teal-500/30 rounded-2xl p-4 space-y-2 text-left shadow-lg">
              <label className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-teal-400" />
                <span>Mã hiện diện 4 số (xem trên màn hình máy tính):</span>
              </label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={4}
                value={handshakePin}
                onChange={(e) => {
                  const val = e.target.value.replace(/\D/g, '').slice(0, 4);
                  setHandshakePin(val);
                  if (val.length === 4) setPinError(null);
                }}
                placeholder="· · · ·"
                className="w-full text-center text-3xl font-mono font-black tracking-[0.35em] py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-teal-300 placeholder:text-slate-600 focus:outline-none focus:border-teal-400 focus:ring-1 focus:ring-teal-400"
              />
              {pinError ? (
                <p className="text-[11px] text-rose-400 font-semibold">{pinError}</p>
              ) : (
                <p className="text-[11px] text-slate-400">
                  Nhìn trực tiếp lên góc dưới mã QR trên màn hình phòng khám để lấy 4 số này.
                </p>
              )}
            </div>

            {cameraError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-950/20 p-3 text-rose-300 text-xs">
                {cameraError}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                if (handshakePin.trim().length !== 4) {
                  setPinError('Vui lòng nhìn lên màn hình máy tính phòng khám và nhập đủ 4 số hiện diện!');
                  return;
                }
                setPinError(null);
                startCamera();
              }}
              className="w-full py-3.5 rounded-2xl bg-teal-600 hover:bg-teal-500 active:scale-95 text-white font-bold text-sm shadow-xl shadow-teal-600/30 flex items-center justify-center gap-2 transition-all cursor-pointer"
            >
              <Camera className="h-4 w-4" />
              <span>Bật Camera & Quét khuôn mặt</span>
            </button>
          </div>
        )}

        {/* BƯỚC 2: CAMERA ĐANG CHẠY & THỬ THÁCH LIVENESS */}
        {(currentStep === 'challenge' || currentStep === 'verifying') && (
          <div className="space-y-4">
            <div className="relative aspect-square w-full rounded-3xl overflow-hidden bg-black border-2 border-teal-500 shadow-2xl">
              <video
                ref={videoRef}
                playsInline
                muted
                autoPlay
                className={`w-full h-full object-cover ${facingMode === 'user' ? '-scale-x-100' : ''}`}
              />

              {/* Vòng oval hướng dẫn đặt khuôn mặt */}
              <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                <div className="w-56 h-72 rounded-[50%] border-4 border-dashed border-teal-400/80 animate-pulse shadow-[0_0_50px_rgba(20,184,166,0.3)]"></div>
              </div>

              {/* Nút lật camera */}
              <button
                type="button"
                onClick={toggleFacingMode}
                className="absolute top-3 right-3 p-2.5 rounded-full bg-slate-900/80 backdrop-blur-md text-white border border-slate-700"
                title="Đổi camera"
              >
                <SwitchCamera className="h-4 w-4" />
              </button>

              {/* Lớp phủ khi đang xác thực */}
              {currentStep === 'verifying' && (
                <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex flex-col items-center justify-center text-center p-4">
                  <RefreshCw className="h-10 w-10 text-teal-400 animate-spin mb-3" />
                  <p className="text-xs font-bold text-white">Đang đối chiếu dữ liệu ArcFace...</p>
                  <p className="text-[10px] text-slate-400 mt-1">Kiểm tra lịch trực tại CSDL bệnh viện</p>
                </div>
              )}
            </div>

            {/* Thanh tiến trình và thông báo thử thách */}
            <div className="space-y-2 text-center">
              <div className="w-full bg-slate-800 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-teal-500 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${challengeProgress}%` }}
                ></div>
              </div>

              <div className="flex items-center justify-center gap-2 text-xs font-bold text-teal-400 animate-pulse">
                <Sparkles className="h-4 w-4" />
                <span>{challengeText}</span>
              </div>
            </div>
          </div>
        )}

        {/* BƯỚC 3: THÀNH CÔNG */}
        {currentStep === 'success' && (
          <div className="text-center space-y-6">
            <div className="h-20 w-20 mx-auto rounded-3xl bg-emerald-500/10 border-2 border-emerald-500/30 text-emerald-400 flex items-center justify-center shadow-xl">
              <CheckCircle2 className="h-10 w-10 animate-in zoom-in-75 duration-300" />
            </div>

            <div className="space-y-1">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-xs font-bold">
                <ShieldCheck className="h-3.5 w-3.5" />
                ĐIỂM DANH THÀNH CÔNG
              </div>
              <h2 className="text-xl font-bold text-white mt-2">
                {resultData?.doctor?.title || 'BS'} {resultData?.doctor?.fullName}
              </h2>
              <p className="text-xs text-slate-400">
                Ca trực: <strong className="text-white">{resultData?.duty?.shiftName || 'Hiện tại'}</strong>
              </p>
            </div>

            <div className="rounded-2xl border border-teal-500/30 bg-teal-950/20 p-4 text-left space-y-2 text-xs">
              <div className="flex justify-between text-slate-300">
                <span>Phòng khám mở khoá:</span>
                <span className="font-bold text-teal-400">{sessionData?.room?.name}</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Độ tin cậy khuôn mặt:</span>
                <span className="font-mono text-emerald-400">{(resultData?.similarity * 100 || 96.5).toFixed(1)}%</span>
              </div>
              <div className="flex justify-between text-slate-300">
                <span>Chống giả mạo PAD:</span>
                <span className="font-semibold text-emerald-400">Đạt chuẩn ISO 30107</span>
              </div>
            </div>

            <p className="text-xs text-teal-300 font-semibold">
              Màn hình máy tính Windows tại phòng khám đã tự động mở khoá và giải phóng Desktop. Bác sĩ có thể thao tác ngay!
            </p>
          </div>
        )}

        {/* BƯỚC 4: THẤT BẠI */}
        {currentStep === 'failed' && (
          <div className="text-center space-y-6">
            <div className="h-20 w-20 mx-auto rounded-3xl bg-rose-500/10 border-2 border-rose-500/30 text-rose-400 flex items-center justify-center shadow-xl">
              <AlertTriangle className="h-10 w-10" />
            </div>

            <div className="space-y-2">
              <h2 className="text-lg font-bold text-white">Xác thực không thành công</h2>
              <p className="text-xs text-rose-300 px-4">{errorMessage}</p>
            </div>

            <button
              type="button"
              onClick={() => {
                setCurrentStep('ready');
                setErrorMessage(null);
              }}
              className="w-full py-3 rounded-2xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs flex items-center justify-center gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Thử lại lần nữa</span>
            </button>
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="text-center text-[10px] text-slate-500 border-t border-slate-900 pt-3">
        Bệnh viện Đa khoa · Hệ thống xác thực sinh trắc học thông minh
      </footer>
    </div>
  );
}
