// Must be imported before anything else so Sentry can instrument modules.
import * as Sentry from '@sentry/nestjs';
import { loadApiEnv } from './config/env.js';

const env = loadApiEnv();

if (env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1,
  });
}
