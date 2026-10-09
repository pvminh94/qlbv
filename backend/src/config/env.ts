/**
 * Nạp biến môi trường (.env) và cung cấp cấu hình có kiểu.
 * Tìm .env theo thứ tự: <cwd>/.env → <cwd>/backend/.env → <backend>/.env
 */
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';

function findEnvFile(): string | undefined {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), 'backend', '.env'),
    path.resolve(__dirname, '..', '..', '..', '.env'),
    path.resolve(__dirname, '..', '..', '.env'),
  ];
  return candidates.find((p) => fs.existsSync(p));
}

const envFile = findEnvFile();
if (envFile) dotenv.config({ path: envFile, quiet: true });

const num = (v: string | undefined, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

const bool = (v: string | undefined, fallback = false): boolean =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

/** Chuỗi thời lượng hợp lệ cho JWT: '60m', '12h', '30s'… */
export type DurationString = `${number}${'s' | 'm' | 'h' | 'd' | 'w' | 'y'}`;

const list = (v: string | undefined, fallback: string[] = []): string[] =>
  v === undefined
    ? fallback
    : v
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

export const APP_ROOT = path.resolve(__dirname, '..', '..');

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isProd: process.env.NODE_ENV === 'production',
  appName: process.env.APP_NAME ?? 'QLBS — Phần mềm Quản lý Bệnh viện',
  port: num(process.env.PORT, 4000),
  host: process.env.HOST ?? '0.0.0.0',
  apiPrefix: process.env.API_PREFIX ?? 'api',
  /** Bật tài liệu Swagger (mặc định bật ở môi trường không phải production) */
  swagger: bool(process.env.SWAGGER_ENABLED, process.env.NODE_ENV !== 'production'),
  corsOrigins: list(process.env.CORS_ORIGINS, ['*']),
  /** Địa chỉ được gọi API tích hợp (máy khoá). Trống = không giới hạn IP, chỉ kiểm tra khoá API */
  integrationAllowedIps: list(process.env.INTEGRATION_ALLOWED_IPS, []),
  timezone: process.env.TZ ?? 'Asia/Ho_Chi_Minh',
  locale: process.env.LOCALE ?? 'vi-VN',

  database: {
    url:
      process.env.DATABASE_URL ??
      'postgresql://qlbs:qlbs@localhost:5432/qlbs',
    poolMax: num(process.env.DB_POOL_MAX, 12),
    idleTimeoutMs: num(process.env.DB_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMs: num(process.env.DB_CONNECTION_TIMEOUT_MS, 10_000),
    /** In câu SQL ra log (chỉ nên bật khi gỡ lỗi) */
    logQueries: bool(process.env.DB_LOG_QUERIES, false),
    ssl: bool(process.env.DB_SSL, false),
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
    password: process.env.REDIS_PASSWORD ?? undefined,
    db: num(process.env.REDIS_DB, 0),
    keyPrefix: process.env.REDIS_KEY_PREFIX ?? 'qlbs:',
    /** redis = dùng Redis thật · memory = cache trong bộ nhớ tiến trình */
    driver: (process.env.CACHE_DRIVER ?? 'redis') as 'redis' | 'memory',
  },

  queue: {
    /** bullmq = hàng đợi Redis (đa tiến trình) · inline = chạy trong tiến trình */
    driver: (process.env.QUEUE_DRIVER ?? 'bullmq') as 'bullmq' | 'inline',
    prefix: process.env.QUEUE_PREFIX ?? 'qlbs',
    concurrency: num(process.env.QUEUE_CONCURRENCY, 4),
    /** Tự chạy tác vụ định kỳ đã bật khi khởi động */
    autoSchedule: bool(process.env.QUEUE_AUTO_SCHEDULE, true),
  },

  cache: {
    /** Thời gian cache mặc định (giây) */
    ttl: num(process.env.CACHE_TTL, 60),
    /** Thời gian cache riêng cho cấu trúc mẫu báo cáo — ít thay đổi */
    structureTtl: num(process.env.CACHE_STRUCTURE_TTL, 600),
    /** Thời gian cache quyền người dùng */
    permissionTtl: num(process.env.CACHE_PERMISSION_TTL, 300),
    maxItems: num(process.env.CACHE_MEMORY_MAX_ITEMS, 5_000),
  },

  jwt: {
    secret: process.env.JWT_SECRET ?? 'doi-chuoi-nay-truoc-khi-dung-that-qlbs',
    refreshSecret:
      process.env.JWT_REFRESH_SECRET ??
      process.env.JWT_SECRET ??
      'doi-chuoi-nay-truoc-khi-dung-that-qlbs-refresh',
    accessTtl: (process.env.JWT_ACCESS_TTL ?? '60m') as DurationString,
    refreshTtl: (process.env.JWT_REFRESH_TTL ?? '12h') as DurationString,
    issuer: process.env.JWT_ISSUER ?? 'qlbs',
  },

  security: {
    bcryptRounds: num(process.env.BCRYPT_ROUNDS, 10),
    maxFailedLogins: num(process.env.MAX_FAILED_LOGINS, 8),
    lockMinutes: num(process.env.LOCK_MINUTES, 15),
    sessionHours: num(process.env.SESSION_HOURS, 12),
    /** Bật kiểm tra CSRF cho cookie-based auth (JWT Bearer không cần) */
    csrf: bool(process.env.CSRF_ENABLED, false),
  },

  storage: {
    dir: process.env.STORAGE_DIR ?? path.resolve(APP_ROOT, '.data', 'storage'),
    exportsDir: process.env.EXPORTS_DIR ?? path.resolve(APP_ROOT, '.data', 'exports'),
    backupsDir: process.env.BACKUPS_DIR ?? path.resolve(APP_ROOT, '.data', 'backups'),
    uploadMaxMb: num(process.env.UPLOAD_MAX_MB, 25),
    /** Giữ tệp xuất trong bao nhiêu ngày */
    retentionDays: num(process.env.STORAGE_RETENTION_DAYS, 30),
  },

  seed: {
    adminUser: process.env.SEED_ADMIN_USER ?? 'admin',
    adminPass: process.env.SEED_ADMIN_PASS ?? 'Admin@123',
    adminName: process.env.SEED_ADMIN_NAME ?? 'Quản trị hệ thống',
    /** Tạo dữ liệu mẫu (khoa + mẫu báo cáo demo) */
    demo: bool(process.env.SEED_DEMO_DATA, true),
  },

  /** Kích thước trang mặc định cho API danh sách */
  pagination: {
    defaultPageSize: num(process.env.DEFAULT_PAGE_SIZE, 20),
    maxPageSize: num(process.env.MAX_PAGE_SIZE, 200),
  },
} as const;

export type AppConfig = typeof config;
