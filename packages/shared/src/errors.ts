import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'INSUFFICIENT_CREDITS',
  'PLAN_LIMIT_REACHED',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'PROVIDER_NOT_CONFIGURED',
  'NO_ACTIVE_ORGANIZATION',
  'INTERNAL',
] as const;
export const errorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof errorCodeSchema>;

/** Every non-2xx API response has this body. */
export const apiErrorSchema = z.object({
  code: errorCodeSchema,
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string().optional(),
});
export type ApiErrorBody = z.infer<typeof apiErrorSchema>;

export interface InsufficientCreditsDetails {
  required: number;
  balance: number;
}

/** Error thrown by domain code; the API maps it to an HTTP response by `code`. */
export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const ERROR_HTTP_STATUS: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  INSUFFICIENT_CREDITS: 402,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  NO_ACTIVE_ORGANIZATION: 409,
  PLAN_LIMIT_REACHED: 403,
  RATE_LIMITED: 429,
  PROVIDER_UNAVAILABLE: 503,
  PROVIDER_NOT_CONFIGURED: 501,
  INTERNAL: 500,
};
