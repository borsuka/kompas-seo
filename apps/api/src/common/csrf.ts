import type { NextFunction, Request, Response } from 'express';
import type { ApiErrorBody } from '@seo/shared';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * CSRF protection for cookie-authenticated REST calls: state-changing requests that
 * carry cookies must come from our own origin (Origin, or Referer as a fallback).
 * SameSite=Lax cookies already block most cross-site requests; this closes the rest.
 * Better Auth performs its own origin checks on /api/auth/*.
 */
export function csrfOriginCheck(appUrl: string) {
  const allowed = new URL(appUrl).origin;
  return (req: Request, res: Response, next: NextFunction) => {
    if (SAFE_METHODS.has(req.method) || !req.headers.cookie) return next();
    const origin =
      req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : undefined);
    if (origin === allowed) return next();
    const body: ApiErrorBody = { code: 'FORBIDDEN', message: 'Cross-site request blocked' };
    res.status(403).json(body);
  };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
