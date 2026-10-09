import { createHash } from 'node:crypto';
import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import type { Redis } from 'ioredis';
import { and, eq, getOrganizationPlan, isNull, schema, type Database } from '@seo/db';
import {
  API_KEY_PREFIX,
  AppError,
  can,
  PLANS,
  roleSchema,
  type Permission,
  type Role,
} from '@seo/shared';
import { AUTH, DB, REDIS } from '../infra/tokens.js';
import {
  IS_PUBLIC,
  REQUIRED_PERMISSION,
  type AppRequest,
  type AuthSession,
  type AuthUser,
} from '../common/request-context.js';
import type { Auth } from './auth.js';

export const hashApiKey = (key: string) => createHash('sha256').update(key).digest('hex');

/** Roles ordered by rights; an API key never exceeds its creator's current role. */
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

/**
 * Global: every route requires a valid Better Auth session unless marked @Public().
 * `Authorization: Bearer ks_…` authenticates with a public API key instead (plans with
 * API access only, rate limited per key and minute); the key acts for its creator.
 */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
    @Inject(DB) private readonly db: Database,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private async authenticateKey(req: AppRequest, key: string) {
    const [row] = await this.db
      .select({ key: schema.apiKeys, user: schema.user })
      .from(schema.apiKeys)
      .innerJoin(schema.user, eq(schema.user.id, schema.apiKeys.createdBy))
      .where(and(eq(schema.apiKeys.keyHash, hashApiKey(key)), isNull(schema.apiKeys.revokedAt)));
    if (!row) throw new AppError('UNAUTHENTICATED', 'Invalid API key');
    const limits = PLANS[await getOrganizationPlan(this.db, row.key.organizationId)];
    if (!limits.apiAccess)
      throw new AppError('PLAN_LIMIT_REACHED', 'Your plan does not include API access', {
        resource: 'apiAccess',
      });
    const bucket = `ratelimit:apikey:${row.key.id}:${Math.floor(Date.now() / 60_000)}`;
    const used = await this.redis.incr(bucket);
    if (used === 1) await this.redis.expire(bucket, 120);
    if (used > limits.apiRatePerMinute)
      throw new AppError('RATE_LIMITED', 'API rate limit exceeded', {
        limit: limits.apiRatePerMinute,
      });
    if (!row.key.lastUsedAt || Date.now() - row.key.lastUsedAt.getTime() > 60_000)
      void this.db
        .update(schema.apiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(schema.apiKeys.id, row.key.id))
        .catch(() => undefined);
    req.user = row.user as AuthUser;
    req.apiKey = {
      id: row.key.id,
      organizationId: row.key.organizationId,
      role: row.key.role === 'member' ? 'member' : 'viewer',
    };
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const bearer = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    if (bearer?.startsWith(API_KEY_PREFIX)) {
      await this.authenticateKey(req, bearer);
      return true;
    }
    const result = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!result) throw new AppError('UNAUTHENTICATED', 'Sign in required');
    req.user = result.user as AuthUser;
    req.session = result.session as AuthSession;
    return true;
  }
}

/**
 * Global: for routes with @RequirePermission, resolves the organization, verifies
 * membership (this is the tenant isolation boundary) and checks the role's permission.
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DB) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(
      REQUIRED_PERMISSION,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (!permission) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
    if (!req.user) throw new AppError('UNAUTHENTICATED', 'Sign in required');

    const header = req.headers['x-org-id'];
    const query = typeof req.query?.orgId === 'string' ? req.query.orgId : undefined;
    const requested = (Array.isArray(header) ? header[0] : header) ?? query;
    // An API key is bound to its organization; asking for another one looks like "not found".
    if (req.apiKey && requested && requested !== req.apiKey.organizationId)
      throw new AppError('NOT_FOUND', 'Organization not found');
    const orgId = req.apiKey?.organizationId ?? requested ?? req.session?.activeOrganizationId;
    if (!orgId)
      throw new AppError('NO_ACTIVE_ORGANIZATION', 'Select or create an organization first');

    const [membership] = await this.db
      .select({ id: schema.member.id, role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, req.user.id)));
    // Not a member: behave as if the organization does not exist.
    if (!membership) throw new AppError('NOT_FOUND', 'Organization not found');

    const parsed = roleSchema.safeParse(membership.role);
    const role =
      parsed.success && req.apiKey && RANK[req.apiKey.role] < RANK[parsed.data]
        ? { success: true as const, data: req.apiKey.role as Role }
        : parsed;
    if (!role.success || !can(role.data, permission)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action', {
        permission,
      });
    }
    req.org = { id: orgId, role: role.data, memberId: membership.id };
    return true;
  }
}
