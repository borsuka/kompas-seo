import { APIError } from 'better-auth/api';
import { AppError, type ErrorCode } from '@seo/shared';

const STATUS_TO_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Runs a Better Auth server API call and maps its errors to our AppError contract. */
export async function authCall<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof APIError) {
      const status = typeof err.statusCode === 'number' ? err.statusCode : 400;
      const body = err.body as { message?: string; code?: string } | undefined;
      throw new AppError(
        STATUS_TO_CODE[status] ?? 'VALIDATION_FAILED',
        body?.message ?? err.message,
        {
          authCode: body?.code,
        },
      );
    }
    throw err;
  }
}
