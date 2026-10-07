import { Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { and, eq, schema, type Database } from '@seo/db';
import { AppError, can, roleSchema, type Permission } from '@seo/shared';
import { AUTH, DB } from '../infra/tokens.js';
import {
  IS_PUBLIC,
  REQUIRED_PERMISSION,
  type AppRequest,
  type AuthSession,
  type AuthUser,
} from '../common/request-context.js';
import type { Auth } from './auth.js';

/** Global: every route requires a valid Better Auth session unless marked @Public(). */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH) private readonly auth: Auth,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<AppRequest>();
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
    const orgId =
      (Array.isArray(header) ? header[0] : header) ?? query ?? req.session?.activeOrganizationId;
    if (!orgId)
      throw new AppError('NO_ACTIVE_ORGANIZATION', 'Select or create an organization first');

    const [membership] = await this.db
      .select({ id: schema.member.id, role: schema.member.role })
      .from(schema.member)
      .where(and(eq(schema.member.organizationId, orgId), eq(schema.member.userId, req.user.id)));
    // Not a member: behave as if the organization does not exist.
    if (!membership) throw new AppError('NOT_FOUND', 'Organization not found');

    const role = roleSchema.safeParse(membership.role);
    if (!role.success || !can(role.data, permission)) {
      throw new AppError('FORBIDDEN', 'You do not have permission to perform this action', {
        permission,
      });
    }
    req.org = { id: orgId, role: role.data, memberId: membership.id };
    return true;
  }
}
