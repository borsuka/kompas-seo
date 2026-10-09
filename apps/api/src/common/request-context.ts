import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { Permission, Role } from '@seo/shared';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  image: string | null;
  emailVerified: boolean;
  locale?: string | null;
}

export interface AuthSession {
  id: string;
  activeOrganizationId?: string | null;
}

export interface OrgContext {
  id: string;
  role: Role;
  memberId: string;
}

/** Set when the request is authenticated with a public API key instead of a session. */
export interface ApiKeyContext {
  id: string;
  organizationId: string;
  role: 'member' | 'viewer';
}

/** Express request enriched by our guards. */
export interface AppRequest extends Request {
  user?: AuthUser;
  session?: AuthSession;
  org?: OrgContext;
  apiKey?: ApiKeyContext;
}

export const IS_PUBLIC = 'auth:isPublic';
export const REQUIRED_PERMISSION = 'auth:permission';

/** Route needs no session (health checks, docs). */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Route operates on the active organization and requires this permission.
 * Resolves the org from the `x-org-id` header, `orgId` query or the session.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw new Error('CurrentUser used on a public route');
  return user;
});

export const CurrentOrg = createParamDecorator((_: unknown, ctx: ExecutionContext): OrgContext => {
  const org = ctx.switchToHttp().getRequest<AppRequest>().org;
  if (!org) throw new Error('CurrentOrg used without @RequirePermission');
  return org;
});

export function requestIp(req: Request): string | null {
  return req.ip ?? null;
}
