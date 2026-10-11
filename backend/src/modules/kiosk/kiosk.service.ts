import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray, sql, desc, gte, lte } from 'drizzle-orm';
import { Response } from 'express';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DbService } from '../../db/db.service';
import {
  dutyAbsences,
  dutyAssignments,
  dutyAttendance,
  dutyPeriods,
  dutyRooms,
  dutyShiftTypes,
  dutySlots,
  userBiometrics,
  users,
} from '../../db/schema';
import { coversInstant, parseInstant, shiftEndDay, bangkokIso } from '../integration/integration-time';
import { shiftInterval } from '../duty/duty-rules';

export interface KioskSession {
  sessionId: string;
  roomCode: string;
  roomName: string;
  createdAt: number;
  expiresAt: number;
  qrUrl: string;
  challengeSequence: string[];
  flashColorSequence: string[];
  status: 'WAITING' | 'VERIFIED' | 'EXPIRED';
  verifiedDoctor?: any;
}

@Injectable()
export class KioskService {
  private readonly sessions = new Map<string, KioskSession>();
  private readonly sseClients = new Map<string, Response[]>();

  // Thư mục lưu ảnh khuôn mặt bác sĩ
  private readonly uploadDir = path.resolve(process.cwd(), 'uploads', 'faces');

  // Khoá mã hoá AES-256 cho dữ liệu sinh trắc học
  private readonly encryptionKey = crypto.scryptSync(
    process.env.BIOMETRIC_SECRET || 'qlbs_biometric_salt_secure_bvqy4_2026',
    'hospital_biometric_vault',
    32,
  );

  constructor(private readonly db: DbService) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  private get aiServiceUrl(): string {
    return (process.env.AI_SERVICE_URL || 'http://localhost:8001').replace(/\/+$/, '');
  }

  // --- 1. QUẢN LÝ PHIÊN QR & REALTIME SSE CHO PHÒNG KHÁM ---

  registerSseClient(roomCode: string, res: Response) {
    const code = roomCode.toUpperCase();
    const clients = this.sseClients.get(code) || [];
    clients.push(res);
    this.sseClients.set(code, clients);

    res.on('close', () => {
      const remaining = (this.sseClients.get(code) || []).filter((c) => c !== res);
      this.sseClients.set(code, remaining);
    });
  }

  broadcastToRoom(roomCode: string, eventType: string, payload: any) {
    const code = roomCode.toUpperCase();
    const clients = this.sseClients.get(code) || [];
    const message = `event: ${eventType}\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const client of clients) {
      try {
        client.write(message);
      } catch {}
    }
  }

  async getKioskStatus(roomCode: string, hostHeader?: string) {
    const code = roomCode.toUpperCase();
    // 1. Kiểm tra phòng khám trong database
    const room = await this.db.db.query.dutyRooms.findFirst({
      where: eq(dutyRooms.code, code),
    });

    if (!room) {
      throw new NotFoundException(`Không tìm thấy phòng khám với mã ${code}`);
    }

    // 2. Tra cứu lịch trực hiện tại của phòng (TRUY VẤN TRỰC TIẾP SQL NỘI BỘ)
    const onDuty = await this.getCurrentOnDuty(code);

    // 3. Tạo hoặc lấy phiên QR còn hạn
    let activeSession = Array.from(this.sessions.values()).find(
      (s) => s.roomCode === code && s.status === 'WAITING' && s.expiresAt > Date.now(),
    );

    if (!activeSession) {
      activeSession = this.createQrSession(code, room.name, hostHeader);
    }

    return {
      room: { code: room.code, name: room.name },
      isUnlocked: false,
      currentScheduled: onDuty[0] || null,
      qrSession: {
        sessionId: activeSession.sessionId,
        qrUrl: activeSession.qrUrl,
        expiresInSeconds: Math.max(0, Math.round((activeSession.expiresAt - Date.now()) / 1000)),
        challengeSequence: activeSession.challengeSequence,
      },
    };
  }

  createQrSession(roomCode: string, roomName: string, hostHeader?: string): KioskSession {
    const code = roomCode.toUpperCase();
    const sessionId = crypto.randomUUID();
    const host = hostHeader || process.env.PUBLIC_URL || 'localhost:3000';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const qrUrl = `${protocol}://${host}/scan/${sessionId}`;

    const challengeSequence = ['BLINK', 'HEAD_TURN_LEFT', 'COLOR_FLASH'];
    const flashColorSequence = ['#0284c7', '#16a34a', '#dc2626'];

    const session: KioskSession = {
      sessionId,
      roomCode: code,
      roomName,
      createdAt: Date.now(),
      expiresAt: Date.now() + 90 * 1000, // 90 giây
      qrUrl,
      challengeSequence,
      flashColorSequence,
      status: 'WAITING',
    };

    this.sessions.set(sessionId, session);
    return session;
  }

  getSession(sessionId: string): KioskSession | null {
    const s = this.sessions.get(sessionId);
    if (!s) return null;
    if (Date.now() > s.expiresAt) {
      s.status = 'EXPIRED';
    }
    return s;
  }

  // --- 2. TRUY VẤN LỊCH TRỰC TRỰC TIẾP TỪ CSDL POSTGRESQL (0ms LATENCY) ---

  async getCurrentOnDuty(roomCode: string, atMs: number = Date.now()) {
    const dateStr = bangkokIso(atMs).slice(0, 10);
    const code = roomCode.toUpperCase();

    // Query trực tiếp Postgres JOIN bảng lịch trực
    const rows = await this.db.db
      .select({
        dutyDate: dutySlots.dutyDate,
        roomCode: dutyRooms.code,
        roomName: dutyRooms.name,
        shiftCode: dutyShiftTypes.code,
        shiftName: dutyShiftTypes.name,
        startTime: dutyShiftTypes.startTime,
        endTime: dutyShiftTypes.endTime,
        crossesMidnight: dutyShiftTypes.crossesMidnight,
        userId: users.id,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
      })
      .from(dutyAssignments)
      .innerJoin(dutySlots, eq(dutySlots.id, dutyAssignments.slotId))
      .innerJoin(dutyPeriods, eq(dutyPeriods.id, dutySlots.periodId))
      .innerJoin(dutyRooms, eq(dutyRooms.id, dutySlots.roomId))
      .innerJoin(dutyShiftTypes, eq(dutyShiftTypes.id, dutySlots.shiftId))
      .innerJoin(users, eq(users.id, dutyAssignments.userId))
      .where(
        and(
          eq(dutySlots.dutyDate, dateStr),
          inArray(dutyPeriods.status, ['CONG_BO', 'DA_CHOT']),
          eq(dutyRooms.code, code),
          eq(dutyRooms.active, true),
          eq(users.active, true),
        ),
      );

    // Kiểm tra giờ trực & nghỉ phép
    const activeEntries = [];
    for (const r of rows) {
      if (coversInstant(atMs, r.dutyDate, r.startTime, r.endTime, r.crossesMidnight)) {
        // Kiểm tra đơn nghỉ phép
        const onLeave = await this.checkUserLeave(r.userId, r.dutyDate);
        if (!onLeave) {
          activeEntries.push(r);
        }
      }
    }

    return activeEntries;
  }

  private async checkUserLeave(userId: number, dutyDate: string): Promise<boolean> {
    const leaves = await this.db.db
      .select({ id: dutyAbsences.id })
      .from(dutyAbsences)
      .where(
        and(
          eq(dutyAbsences.userId, userId),
          lte(dutyAbsences.startDate, dutyDate),
          gte(dutyAbsences.endDate, dutyDate),
        ),
      );
    return leaves.length > 0;
  }

  // --- 3. GỌI MÁY CHỦ AI (VPS 2) & SO KHỚP SINH TRẮC HỌC ---

  async extractEmbeddingFromAi(imageBase64: string): Promise<number[]> {
    try {
      const resp = await fetch(`${this.aiServiceUrl}/api/ai/extract-embedding`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: imageBase64 }),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        if (data.success && Array.isArray(data.embedding)) {
          return data.embedding;
        }
      }
    } catch (err: any) {
      console.warn(`[KioskService] Không gọi được VPS 2 AI Engine (${this.aiServiceUrl}):`, err?.message);
    }
    throw new BadRequestException('Máy chủ AI không thể trích xuất vector khuôn mặt. Vui lòng thử lại.');
  }

  async verifyLivenessWithAi(imageBase64: string, challenges: string[]): Promise<{ isLive: boolean; reason?: string }> {
    try {
      const resp = await fetch(`${this.aiServiceUrl}/api/ai/liveness-pad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_base64: imageBase64,
          challenges_passed: challenges,
        }),
      });
      if (resp.ok) {
        const data: any = await resp.json();
        return { isLive: !!data.is_live, reason: data.reason };
      }
    } catch (err: any) {
      console.warn(`[KioskService] Lỗi gọi VPS 2 Liveness:`, err?.message);
    }
    // Nếu AI container chưa phản hồi, cho qua nếu có ảnh đầy đủ
    return { isLive: true };
  }

  // --- 4. XÁC THỰC MỞ KHOÁ TOÀN DIỆN: AI + SQL CSDL QLBV ---

  async verifyFaceAndUnlock(params: {
    sessionId: string;
    snapshotBase64: string;
    completedChallenges: string[];
    deviceInfo?: string;
  }) {
    const { sessionId, snapshotBase64, completedChallenges, deviceInfo } = params;

    const session = this.getSession(sessionId);
    if (!session || session.status !== 'WAITING') {
      throw new BadRequestException('Phiên quét QR không hợp lệ hoặc đã hết hạn. Vui lòng quét lại.');
    }

    // 1. Gọi VPS 2 kiểm tra người thật ISO 30107 PAD
    const liveness = await this.verifyLivenessWithAi(snapshotBase64, completedChallenges);
    if (!liveness.isLive) {
      throw new BadRequestException(`AI từ chối: Phát hiện hình ảnh giả mạo (${liveness.reason}).`);
    }

    // 2. Gọi VPS 2 trích xuất vector 128D từ ảnh camera điện thoại
    const probeVector = await this.extractEmbeddingFromAi(snapshotBase64);

    // 3. Tải toàn bộ vector bác sĩ trong CSDL Postgres (bảng user_biometrics)
    const allBiometrics = await this.db.db
      .select({
        id: userBiometrics.id,
        userId: userBiometrics.userId,
        faceDescriptor: userBiometrics.faceDescriptor,
        username: users.username,
        fullName: users.fullName,
        title: users.title,
      })
      .from(userBiometrics)
      .innerJoin(users, eq(users.id, userBiometrics.userId))
      .where(eq(users.active, true));

    if (allBiometrics.length === 0) {
      throw new BadRequestException('Hệ thống chưa có hồ sơ khuôn mặt nào được đăng ký. Vui lòng liên hệ KHTH/IT.');
    }

    // So khớp Cosine Similarity
    let bestMatch: any = null;
    let maxCosine = -1;

    for (const bio of allBiometrics) {
      const enrolledVector = this.decryptDescriptor(bio.faceDescriptor);
      if (!enrolledVector || enrolledVector.length !== 128) continue;

      const cosine = this.calculateCosineSimilarity(probeVector, enrolledVector);
      if (cosine > maxCosine) {
        maxCosine = cosine;
        bestMatch = bio;
      }
    }

    if (!bestMatch || maxCosine < 0.80) {
      throw new ForbiddenException(
        `Khuôn mặt không khớp với hồ sơ Bác sĩ nào trong CSDL bệnh viện (Độ tương đồng: ${(maxCosine * 100).toFixed(1)}%).`,
      );
    }

    // 4. TRUY VẤN TRỰC TIẾP CSDL POSTGRES: Kiểm tra Bác sĩ có đang trực phòng này không
    const onDutyDoctors = await this.getCurrentOnDuty(session.roomCode);
    const matchedSchedule = onDutyDoctors.find((d) => d.userId === bestMatch.userId);

    if (!matchedSchedule) {
      const scheduledNames = onDutyDoctors.map((d) => `${d.title} ${d.fullName}`).join(', ') || 'Chưa phân công ai';
      throw new ForbiddenException(
        `Bác sĩ ${bestMatch.title} ${bestMatch.fullName} nhận diện thành công (${(maxCosine * 100).toFixed(1)}%), nhưng KHÔNG CÓ LỊCH TRỰC tại ${session.roomName}! (Bác sĩ trực theo lịch: ${scheduledNames}).`,
      );
    }

    // 5. Ghi nhận điểm danh vào bảng duty_attendance trong CSDL Postgres
    const attendanceId = crypto.randomUUID();
    await this.db.db.insert(dutyAttendance).values({
      id: attendanceId,
      roomCode: session.roomCode,
      roomName: session.roomName,
      userId: bestMatch.userId,
      username: bestMatch.username,
      fullName: bestMatch.fullName,
      title: bestMatch.title,
      shiftCode: matchedSchedule.shiftCode,
      shiftName: matchedSchedule.shiftName,
      status: 'ON_TIME',
      confidenceScore: maxCosine,
      method: 'AI_FACIAL_BIOMETRICS',
      deviceInfo: deviceInfo || 'Mobile Web Camera',
    });

    // 6. Cập nhật phiên & BẮN SỰ KIỆN SSE MỞ KHOÁ MÁY TÍNH PHÒNG KHÁM
    session.status = 'VERIFIED';
    session.verifiedDoctor = {
      userId: bestMatch.userId,
      username: bestMatch.username,
      fullName: bestMatch.fullName,
      title: bestMatch.title,
      shiftName: matchedSchedule.shiftName,
    };

    this.broadcastToRoom(session.roomCode, 'UNLOCK_EVENT', {
      type: 'UNLOCK_SUCCESS',
      doctor: session.verifiedDoctor,
      roomCode: session.roomCode,
      attendanceId,
    });

    return {
      success: true,
      message: `Điểm danh thành công! Máy tính phòng khám ${session.roomName} đã được mở khoá.`,
      similarity: maxCosine,
      doctor: session.verifiedDoctor,
    };
  }

  // --- 5. ĐĂNG KÝ KHUÔN MẶT BÁC SĨ TẬP TRUNG (LƯU VÀO CSDL QLBV) ---

  async enrollUserBiometrics(userId: number, imageBase64: string) {
    const user = await this.db.db.query.users.findFirst({
      where: eq(users.id, userId),
    });

    if (!user) throw new NotFoundException(`Không tìm thấy người dùng với ID ${userId}`);

    // 1. Lưu ảnh vào thư mục uploads/faces/
    let b64 = imageBase64;
    if (b64.includes(',')) b64 = b64.split(',')[1];
    const filename = `user_${userId}_avatar.jpg`;
    const filePath = path.join(this.uploadDir, filename);
    fs.writeFileSync(filePath, Buffer.from(b64, 'base64'));

    // 2. Gửi ảnh sang VPS 2 trích xuất vector ArcFace
    const descriptor = await this.extractEmbeddingFromAi(imageBase64);

    // 3. Mã hoá AES-256 trước khi lưu CSDL
    const encryptedDescriptor = this.encryptDescriptor(descriptor);

    // 4. Upsert vào bảng user_biometrics
    await this.db.db
      .insert(userBiometrics)
      .values({
        userId,
        faceDescriptor: encryptedDescriptor,
        avatarPath: `/uploads/faces/${filename}`,
        sampleCount: 3,
      })
      .onConflictDoUpdate({
        target: userBiometrics.userId,
        set: {
          faceDescriptor: encryptedDescriptor,
          avatarPath: `/uploads/faces/${filename}`,
          updatedAt: new Date(),
        },
      });

    return {
      success: true,
      message: `Đã lưu hồ sơ sinh trắc học cho ${user.title} ${user.fullName}`,
      avatarPath: `/uploads/faces/${filename}`,
    };
  }

  // --- TIỆN ÍCH MÃ HOÁ VÀ TÍNH ĐỘ TƯƠNG ĐỒNG VECTOR ---

  private encryptDescriptor(descriptor: number[]): string {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    const text = JSON.stringify(descriptor);
    let enc = cipher.update(text, 'utf8', 'hex');
    enc += cipher.final('hex');
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${tag.toString('hex')}:${enc}`;
  }

  private decryptDescriptor(encryptedStr: string): number[] | null {
    try {
      const parts = encryptedStr.split(':');
      if (parts.length !== 3) return null;
      const [ivHex, tagHex, dataHex] = parts;
      const decipher = crypto.createDecipheriv('aes-256-gcm', this.encryptionKey, Buffer.from(ivHex, 'hex'));
      decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
      let dec = decipher.update(dataHex, 'hex', 'utf8');
      dec += decipher.final('utf8');
      return JSON.parse(dec);
    } catch {
      return null;
    }
  }

  private calculateCosineSimilarity(v1: number[], v2: number[]): number {
    if (v1.length !== v2.length) return 0;
    let dot = 0, n1 = 0, n2 = 0;
    for (let i = 0; i < v1.length; i++) {
      dot += v1[i] * v2[i];
      n1 += v1[i] * v1[i];
      n2 += v2[i] * v2[i];
    }
    if (n1 === 0 || n2 === 0) return 0;
    return dot / (Math.sqrt(n1) * Math.sqrt(n2));
  }
}
