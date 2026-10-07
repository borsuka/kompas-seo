import { AppError } from '@seo/shared';

/** Error from an upstream data provider. `retriable` drives the retry middleware. */
export class ProviderError extends Error {
  constructor(
    message: string,
    public readonly retriable: boolean,
    public readonly status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'ProviderError';
  }

  static fromHttpStatus(status: number, message: string): ProviderError {
    return new ProviderError(message, status === 429 || status >= 500, status);
  }
}

export function isRetriable(err: unknown): boolean {
  if (err instanceof ProviderError) return err.retriable;
  if (err instanceof AppError) return false;
  // Network-level failures (fetch TypeError, ECONNRESET, timeouts) are retriable.
  const code = (err as { code?: string } | null)?.code;
  return (
    err instanceof TypeError ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    (err as Error | null)?.name === 'TimeoutError'
  );
}

export class ProviderUnavailableError extends AppError {
  constructor(provider: string, retryAfterMs: number) {
    super('PROVIDER_UNAVAILABLE', `Data provider "${provider}" is temporarily unavailable`, {
      provider,
      retryAfterMs,
    });
  }
}
