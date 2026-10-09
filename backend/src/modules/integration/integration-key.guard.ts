import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq, sql } from 'drizzle-orm';
import { config } from '../../config/env';
import { DbService } from '../../db/db.service';
import { integrationKeys } from '../../db/schema';
import { hashIntegrationKey, INTEGRATION_KEY_PREFIX } from './integration-keys';

export const INTEGRATION_SCOPE_KEY = 'qlbs:integrationScope';
/** Khai báo phạm vi khoá API cần có để gọi endpoint này (ví dụ duty:read) */
export const RequireIntegrationScope = (scope: string) => SetMetadata(INTEGRATION_SCOPE_KEY, scope);

interface IntegrationRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  integration?: { id: number; name: string; scope: string };
}

/** ::ffff:10.0.0.5 → 10.0.0.5 */
export function normalizeIp(ip: string | undefined): string {
  return (ip ?? '').replace(/^::ffff:/i, '');
}

/**
 * Xác thực máy gọi bằng khoá API: `Authorization: Bearer qlbs_int_...`.
 * Không dùng JWT người dùng. Khoá sai, đã thu hồi hoặc sai phạm vi đều bị từ chối.
 * Nếu đặt INTEGRATION_ALLOWED_IPS thì chỉ chấp nhận các địa chỉ trong danh sách.
 * Nhật ký không bao giờ ghi giá trị khoá.
 */
@Injectable()
export class IntegrationKeyGuard implements CanActivate {
  private readonly logger = new Logger('IntegrationAuth');

  constructor(
    private readonly reflector: Reflector,
    private readonly db: DbService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<IntegrationRequest>();
    const ip = normalizeIp(req.ip);

    if (config.integrationAllowedIps.length > 0 && !config.integrationAllowedIps.includes(ip)) {
      this.logger.warn(`Từ chối ${ip}: không nằm trong INTEGRATION_ALLOWED_IPS`);
      throw new ForbiddenException('Địa chỉ này không được phép gọi API tích hợp');
    }

    const header = String(req.headers['authorization'] ?? '');
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    if (!token.startsWith(INTEGRATION_KEY_PREFIX)) {
      throw new UnauthorizedException('Thiếu khoá API tích hợp (Authorization: Bearer <khoá>)');
    }

    const [row] = await this.db.db
      .select({
        id: integrationKeys.id,
        name: integrationKeys.name,
        scope: integrationKeys.scope,
        revokedAt: integrationKeys.revokedAt,
      })
      .from(integrationKeys)
      .where(eq(integrationKeys.keyHash, hashIntegrationKey(token)))
      .limit(1);

    if (!row || row.revokedAt) {
      this.logger.warn(`Khoá API không hợp lệ hoặc đã thu hồi (từ ${ip})`);
      throw new UnauthorizedException('Khoá API không hợp lệ hoặc đã bị thu hồi');
    }

    const required = this.reflector.getAllAndOverride<string | undefined>(INTEGRATION_SCOPE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (required && row.scope !== required) {
      this.logger.warn(`Khoá #${row.id} thiếu phạm vi ${required} (từ ${ip})`);
      throw new ForbiddenException(`Khoá API không có quyền "${required}"`);
    }

    req.integration = { id: row.id, name: row.name, scope: row.scope };
    await this.db.db
      .update(integrationKeys)
      .set({ lastUsedAt: new Date(), useCount: sql`${integrationKeys.useCount} + 1` })
      .where(eq(integrationKeys.id, row.id));
    return true;
  }
}
