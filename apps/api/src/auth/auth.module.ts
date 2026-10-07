import { Global, Logger, Module } from '@nestjs/common';
import type { Database } from '@seo/db';
import { API_ENV, type ApiEnv } from '../config/env.js';
import { createMailer, type Mailer } from '../email/mailer.js';
import { AUTH, DB } from '../infra/tokens.js';
import { createAuth } from './auth.js';

export const MAILER = Symbol('MAILER');

@Global()
@Module({
  providers: [
    { provide: MAILER, inject: [API_ENV], useFactory: (env: ApiEnv) => createMailer(env) },
    {
      provide: AUTH,
      inject: [API_ENV, DB, MAILER],
      useFactory: (env: ApiEnv, db: Database, mailer: Mailer) => {
        const logger = new Logger('Auth');
        return createAuth({
          env,
          db,
          mailer,
          onError: (err, context) => logger.error({ err, context }, 'Auth email failed'),
        });
      },
    },
  ],
  exports: [AUTH, MAILER],
})
export class AuthModule {}
