import 'reflect-metadata';
import { RequestMethod, type INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import type { Auth } from './auth/auth.js';
import { csrfOriginCheck } from './common/csrf.js';
import { createValidationPipe } from './common/validation.js';
import { API_ENV, type ApiEnv } from './config/env.js';
import { AUTH } from './infra/tokens.js';

export const API_PREFIX = 'api/v1';

/** Builds the fully configured Nest app (used by main.ts and integration tests). */
export async function createApp(): Promise<INestApplication> {
  // Body parsing is added manually: Better Auth must receive the raw request stream.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  const env = app.get<ApiEnv>(API_ENV);
  const auth = app.get<Auth>(AUTH);

  app.set('trust proxy', 1);
  app.enableShutdownHooks();
  app.use(
    helmet({
      // The API serves JSON (and Swagger UI on /docs), not app pages.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.all('/api/auth/{*any}', toNodeHandler(auth));
  http.use(express.json({ limit: '1mb' }));
  http.use(express.urlencoded({ extended: false, limit: '1mb' }));
  http.use(`/${API_PREFIX}`, csrfOriginCheck(env.APP_URL));

  app.setGlobalPrefix(API_PREFIX, {
    exclude: [
      { path: 'health/live', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });
  app.useGlobalPipes(createValidationPipe());

  const config = new DocumentBuilder()
    .setTitle('Kompas SEO API')
    .setDescription('REST API. Authentication: Better Auth session cookie (`/api/auth/*`).')
    .setVersion('0.1.0')
    .addCookieAuth('better-auth.session_token')
    .addGlobalParameters({
      name: 'x-org-id',
      in: 'header',
      required: false,
      description: 'Organization to act on (defaults to the active organization of the session).',
    })
    .build();
  SwaggerModule.setup('docs', app, () => SwaggerModule.createDocument(app, config));

  return app;
}
