import { AppError } from '@seo/shared';
import { reportProviderCost } from '../context.js';
import { ProviderError } from '../errors.js';

/**
 * Minimal DataForSEO v3 client (https://docs.dataforseo.com/v3/).
 * - Basic auth with the API login/password from app.dataforseo.com/api-access.
 * - POST body is an array of tasks; Live endpoints accept exactly one task.
 * - Success is status_code 20000 at both the envelope and the task level.
 */

export const DATAFORSEO_HOSTS = {
  live: 'https://api.dataforseo.com',
  sandbox: 'https://sandbox.dataforseo.com',
} as const;

export interface DataForSeoConfig {
  login: string;
  password: string;
  sandbox?: boolean;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

interface Envelope<T> {
  status_code: number;
  status_message: string;
  cost?: number;
  tasks?: {
    id: string;
    status_code: number;
    status_message: string;
    cost?: number;
    result: T[] | null;
  }[];
}

/** Task status codes worth retrying (rate limits, transient upstream failures). */
const RETRIABLE = new Set([40103, 40202, 40209, 50000, 50301, 50401, 50402]);
/** "No search results": a valid, empty answer rather than an error. */
const NO_RESULTS = 40102;

export class DataForSeoClient {
  private readonly base: string;
  private readonly auth: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(config: DataForSeoConfig) {
    if (!config.login || !config.password) {
      throw new AppError(
        'PROVIDER_NOT_CONFIGURED',
        'DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD are required when a provider is set to "dataforseo"',
      );
    }
    this.base = config.sandbox ? DATAFORSEO_HOSTS.sandbox : DATAFORSEO_HOSTS.live;
    this.auth = `Basic ${Buffer.from(`${config.login}:${config.password}`).toString('base64')}`;
    this.fetchImpl = config.fetch ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 60_000;
  }

  /** Posts one task and returns its `result` array (empty when there are no results). */
  async post<T>(path: string, body: Record<string, unknown>): Promise<T[]> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.base}/v3/${path.replace(/^\/+/, '')}`, {
        method: 'POST',
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify([body]),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      throw new ProviderError(
        `DataForSEO request failed: ${(err as Error).message}`,
        true,
        undefined,
        {
          cause: err,
        },
      );
    }

    if (!res.ok) {
      throw ProviderError.fromHttpStatus(res.status, `DataForSEO HTTP ${res.status} on ${path}`);
    }
    const envelope = (await res.json()) as Envelope<T>;
    if (typeof envelope.cost === 'number') reportProviderCost(envelope.cost);

    if (envelope.status_code !== 20000)
      throw this.toError(envelope.status_code, envelope.status_message, path);
    const task = envelope.tasks?.[0];
    if (!task) throw new ProviderError(`DataForSEO returned no task for ${path}`, true);
    if (task.status_code === NO_RESULTS) return [];
    if (task.status_code !== 20000) throw this.toError(task.status_code, task.status_message, path);
    return task.result ?? [];
  }

  private toError(code: number, message: string, path: string): Error {
    if (code === 40100 || code === 40104) {
      return new AppError(
        'PROVIDER_NOT_CONFIGURED',
        `DataForSEO rejected the credentials (${code})`,
      );
    }
    if (code === 40200 || code === 40210 || code === 40203) {
      return new ProviderError(
        `DataForSEO account cannot pay for requests (${code}: ${message})`,
        false,
        code,
      );
    }
    return new ProviderError(
      `DataForSEO ${code} on ${path}: ${message}`,
      RETRIABLE.has(code),
      code,
    );
  }
}
