import type { ClickHouseClient } from '@seo/db/clickhouse';

/** One row in ClickHouse `provider_usage`. */
export interface UsageEvent {
  orgId: string;
  provider: string;
  endpoint: string;
  costUsd: number;
  credits: number;
  cached: boolean;
  success: boolean;
  latencyMs: number;
  requestHash: string;
  createdAt: Date;
}

export interface UsageSink {
  record(event: UsageEvent): void;
  flush(): Promise<void>;
}

export class MemoryUsageSink implements UsageSink {
  readonly events: UsageEvent[] = [];
  record(event: UsageEvent) {
    this.events.push(event);
  }
  async flush() {}
}

/**
 * Buffers usage events and inserts them into ClickHouse in batches
 * (ClickHouse prefers few large inserts over many tiny ones).
 */
export class ClickHouseUsageSink implements UsageSink {
  private buffer: UsageEvent[] = [];
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly ch: ClickHouseClient,
    private readonly opts: {
      maxBatch?: number;
      flushIntervalMs?: number;
      onError?: (err: unknown) => void;
    } = {},
  ) {}

  record(event: UsageEvent) {
    this.buffer.push(event);
    if (this.buffer.length >= (this.opts.maxBatch ?? 200)) {
      void this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => void this.flush(), this.opts.flushIntervalMs ?? 1000);
      this.timer.unref?.();
    }
  }

  async flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.buffer.length) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.ch.insert({
        table: 'provider_usage',
        format: 'JSONEachRow',
        values: batch.map((e) => ({
          org_id: e.orgId,
          provider: e.provider,
          endpoint: e.endpoint,
          cost: e.costUsd,
          credits: e.credits,
          cached: e.cached,
          success: e.success,
          latency_ms: Math.round(e.latencyMs),
          request_hash: e.requestHash,
          created_at: e.createdAt.getTime(),
        })),
      });
    } catch (err) {
      this.opts.onError?.(err);
    }
  }
}
