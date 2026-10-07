import { createClient, type ClickHouseClient } from '@clickhouse/client';

export interface ClickHouseConfig {
  url: string;
  username: string;
  password: string;
  database: string;
}

export type { ClickHouseClient };

export function createClickHouse(config: ClickHouseConfig): ClickHouseClient {
  return createClient({
    url: config.url,
    username: config.username,
    password: config.password,
    database: config.database,
    clickhouse_settings: {
      // Return 64-bit integers as numbers in JSON (values we store fit in 2^53).
      output_format_json_quote_64bit_integers: 0,
      date_time_input_format: 'best_effort',
    },
    request_timeout: 30_000,
  });
}

export function clickHouseConfigFromEnv(env: {
  CLICKHOUSE_URL: string;
  CLICKHOUSE_USER: string;
  CLICKHOUSE_PASSWORD: string;
  CLICKHOUSE_DATABASE: string;
}): ClickHouseConfig {
  return {
    url: env.CLICKHOUSE_URL,
    username: env.CLICKHOUSE_USER,
    password: env.CLICKHOUSE_PASSWORD,
    database: env.CLICKHOUSE_DATABASE,
  };
}
