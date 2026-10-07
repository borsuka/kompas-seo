/** DI tokens for infrastructure clients (plain objects, not Nest classes). */
export const DB = Symbol('DB');
export const DB_HANDLE = Symbol('DB_HANDLE');
export const CLICKHOUSE = Symbol('CLICKHOUSE');
export const REDIS = Symbol('REDIS');
export const AUTH = Symbol('AUTH');
export const PROVIDERS = Symbol('PROVIDERS');
export const USAGE_SINK = Symbol('USAGE_SINK');
export const QUEUES = Symbol('QUEUES');
