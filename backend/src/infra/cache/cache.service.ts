/**
 * Lớp cache dùng chung — Redis (nhiều tiến trình) hoặc bộ nhớ (một tiến trình).
 *
 * Chọn backend bằng biến môi trường `CACHE_DRIVER`:
 *   redis  → ioredis, chia sẻ giữa các tiến trình, có TTL, SCAN để xoá theo tiền tố
 *   memory → Map trong tiến trình, dùng khi chạy thử không có Redis
 *
 * Quy ước khoá:  <namespace>:<phần định danh>   vd: rpt:structure:12, auth:perm:5
 * Nhờ vậy có thể vô hiệu hoá cache theo nhóm bằng `delByPrefix('rpt:structure:')`.
 */
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import type Redis from 'ioredis';
import { config } from '../../config/env';

export interface CacheEntry {
  value: unknown;
  expiresAt: number | null;
}

export const CACHE_REDIS = 'CACHE_REDIS_CLIENT';

@Injectable()
export class CacheService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(CacheService.name);
  private readonly memory = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;

  constructor(@Optional() @Inject(CACHE_REDIS) private readonly redis: Redis | null) {}

  get usingRedis(): boolean {
    return this.redis !== null && this.redis.status !== 'end';
  }

  async onModuleInit(): Promise<void> {
    if (this.redis) {
      this.logger.log('Cache: Redis');
    } else {
      this.logger.warn(
        'Cache: bộ nhớ trong tiến trình (không có Redis) — chỉ phù hợp chạy thử hoặc chạy 1 tiến trình.',
      );
    }
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.redis) await this.redis.quit().catch(() => undefined);
    this.memory.clear();
  }

  private fullKey(key: string): string {
    return this.usingRedis ? key : key;
  }

  private purgeExpired(): void {
    if (this.memory.size === 0) return;
    const now = Date.now();
    for (const [k, v] of this.memory) {
      if (v.expiresAt !== null && v.expiresAt <= now) this.memory.delete(k);
    }
    // Giới hạn số phần tử — xoá bớt phần tử cũ nhất
    const max = config.cache.maxItems;
    if (this.memory.size > max) {
      const excess = this.memory.size - max;
      let i = 0;
      for (const k of this.memory.keys()) {
        if (i++ >= excess) break;
        this.memory.delete(k);
      }
    }
  }

  /* ------------------------------------------------------------------ Đọc / Ghi */

  async get<T = unknown>(key: string): Promise<T | null> {
    const k = this.fullKey(key);    if (this.usingRedis) {
      const raw = await this.redis!.get(k);
      if (raw === null) {
        this.misses++;
        return null;
      }
      this.hits++;
      try {
        return JSON.parse(raw) as T;
      } catch {
        return raw as unknown as T;
      }
    }
    const entry = this.memory.get(k);
    if (!entry || (entry.expiresAt !== null && entry.expiresAt <= Date.now())) {
      if (entry) this.memory.delete(k);
      this.misses++;
      return null;
    }
    this.hits++;
    return entry.value as T;
  }

  async set(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    const k = this.fullKey(key);
    const ttl = ttlSeconds ?? config.cache.ttl;
    if (this.usingRedis) {
      const payload = JSON.stringify(value ?? null);
      if (ttl > 0) await this.redis!.set(k, payload, 'EX', ttl);
      else await this.redis!.set(k, payload);
      return;
    }
    this.purgeExpired();
    this.memory.set(k, {
      value,
      expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : null,
    });
  }

  async del(...keys: string[]): Promise<void> {
    if (keys.length === 0) return;
    if (this.usingRedis) {
      await this.redis!.del(...keys.map((k) => this.fullKey(k)));
      return;
    }
    for (const k of keys) this.memory.delete(k);
  }

  /** Xoá toàn bộ khoá theo tiền tố — dùng để vô hiệu hoá cache theo nhóm */
  async delByPrefix(prefix: string): Promise<number> {
    if (this.usingRedis) {
      let cursor = '0';
      let removed = 0;
      // LƯU Ý: ioredis KHÔNG tự thêm keyPrefix vào tham số MATCH của SCAN,
      // và khoá do SCAN trả về đã có sẵn tiền tố — phải BÓC tiền tố ra trước
      // khi DEL, nếu không client sẽ tự ghép thêm một lần nữa (xoá trật).
      const pattern = `${config.redis.keyPrefix}${prefix}*`;
      const plen = config.redis.keyPrefix.length;
      do {
        const [next, found] = await this.redis!.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = next;
        if (found.length > 0) {
          const bare = found.map((k) => (k.startsWith(config.redis.keyPrefix) ? k.slice(plen) : k));
          await this.redis!.del(...bare);
          removed += found.length;
        }
      } while (cursor !== '0');
      return removed;
    }
    let removed = 0;
    for (const k of [...this.memory.keys()]) {
      if (k.startsWith(prefix)) {
        this.memory.delete(k);
        removed++;
      }
    }
    return removed;
  }

  /**
   * Đọc từ cache, nếu trống thì gọi `factory`, rồi lưu lại.
   * Đây là mẫu dùng chính trong toàn bộ hệ thống.
   */
  async remember<T>(
    key: string,
    ttlSeconds: number,
    factory: () => Promise<T>,
    namespace?: string,
  ): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    // Không cache kết quả rỗng để tránh "dính" dữ liệu trống
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttlSeconds);
      if (namespace) await this.tagKey(namespace, key);
    }
    return value;
  }

  /* ---------------------------------------------------------- Theo dõi nhóm khoá */

  /** Ghi nhận khoá thuộc một nhóm để có thể xoá nhanh cả nhóm sau này */
  private async tagKey(namespace: string, key: string): Promise<void> {
    const tag = `tag:${namespace}`;
    if (this.usingRedis) {
      await this.redis!.sadd(tag, key);
      await this.redis!.expire(tag, Math.max(config.cache.structureTtl * 4, 3600));
    } else {
      const existing = (this.memory.get(tag)?.value as string[] | undefined) ?? [];
      if (!existing.includes(key)) existing.push(key);
      this.memory.set(tag, { value: existing, expiresAt: null });
    }
  }

  /** Xoá mọi khoá thuộc nhóm đã ghi nhận */
  async invalidateNamespace(namespace: string): Promise<void> {
    const tag = `tag:${namespace}`;
    if (this.usingRedis) {
      const logicalKeys = await this.redis!.smembers(tag);
      if (logicalKeys.length > 0) {
        await this.redis!.del(...logicalKeys.map((k) => this.fullKey(k)));
      }
      await this.redis!.del(tag);
      return;
    }
    const keys = (this.memory.get(tag)?.value as string[] | undefined) ?? [];
    for (const k of keys) this.memory.delete(k);
    this.memory.delete(tag);
  }

  /* ------------------------------------------------------------------- Bộ đếm */

  /** Tăng bộ đếm — dùng cho giới hạn số lần đăng nhập sai */
  async incr(key: string, ttlSeconds: number): Promise<number> {
    if (this.usingRedis) {
      const v = await this.redis!.incr(key);
      if (v === 1 && ttlSeconds > 0) await this.redis!.expire(key, ttlSeconds);
      return v;
    }
    const entry = this.memory.get(key);
    const alive = entry && (entry.expiresAt === null || entry.expiresAt > Date.now());
    const next = (alive ? (entry!.value as number) : 0) + 1;
    this.memory.set(key, {
      value: next,
      expiresAt: alive && entry!.expiresAt !== null ? entry!.expiresAt : Date.now() + ttlSeconds * 1000,
    });
    return next;
  }

  async ttl(key: string): Promise<number> {
    if (this.usingRedis) return this.redis!.ttl(key);
    const entry = this.memory.get(key);
    if (!entry) return -2;
    if (entry.expiresAt === null) return -1;
    return Math.max(0, Math.round((entry.expiresAt - Date.now()) / 1000));
  }

  /* ------------------------------------------------------------------ Tập hợp */

  async sadd(key: string, ...members: string[]): Promise<void> {
    if (this.usingRedis) {
      await this.redis!.sadd(key, ...members);
      return;
    }
    const cur = new Set((this.memory.get(key)?.value as string[] | undefined) ?? []);
    members.forEach((m) => cur.add(m));
    this.memory.set(key, { value: [...cur], expiresAt: null });
  }

  async srem(key: string, ...members: string[]): Promise<void> {
    if (this.usingRedis) {
      await this.redis!.srem(key, ...members);
      return;
    }
    const cur = new Set((this.memory.get(key)?.value as string[] | undefined) ?? []);
    members.forEach((m) => cur.delete(m));
    this.memory.set(key, { value: [...cur], expiresAt: null });
  }

  async smembers(key: string): Promise<string[]> {
    if (this.usingRedis) return this.redis!.smembers(key);
    return (this.memory.get(key)?.value as string[] | undefined) ?? [];
  }

  /* -------------------------------------------------------------------- Thống kê */

  stats(): { backend: 'redis' | 'memory'; size: number; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      backend: this.usingRedis ? 'redis' : 'memory',
      size: this.usingRedis ? -1 : this.memory.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total === 0 ? '0%' : `${Math.round((this.hits / total) * 100)}%`,
    };
  }

  async flushAll(): Promise<void> {
    if (this.usingRedis) {
      await this.redis!.flushdb();
      return;
    }
    this.memory.clear();
  }

  async health(): Promise<{ ok: boolean; latencyMs: number; backend: string }> {
    const t = Date.now();
    if (!this.usingRedis) {
      return { ok: true, latencyMs: Date.now() - t, backend: 'memory' };
    }
    try {
      await this.redis!.ping();
      return { ok: true, latencyMs: Date.now() - t, backend: 'redis' };
    } catch {
      return { ok: false, latencyMs: Date.now() - t, backend: 'redis' };
    }
  }
}
