import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';
import { ThrottlerException } from '@nestjs/throttler';
import { AppError, ERROR_HTTP_STATUS, type ApiErrorBody, type ErrorCode } from '@seo/shared';
import type { AppRequest } from './request-context.js';

const STATUS_CODE: Record<number, ErrorCode> = {
  400: 'VALIDATION_FAILED',
  401: 'UNAUTHENTICATED',
  402: 'INSUFFICIENT_CREDITS',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  429: 'RATE_LIMITED',
};

/** Maps every error to the `{ code, message, details, requestId }` contract. */
@Catch()
export class AppErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('ErrorFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<AppRequest>();
    const requestId = req.id !== undefined ? String(req.id) : undefined;

    let status = 500;
    let body: ApiErrorBody;

    if (exception instanceof AppError) {
      status = ERROR_HTTP_STATUS[exception.code];
      body = { code: exception.code, message: exception.message, details: exception.details };
    } else if (exception instanceof ThrottlerException) {
      status = 429;
      body = { code: 'RATE_LIMITED', message: 'Too many requests, slow down' };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : ((response as { message?: string | string[] }).message ?? exception.message);
      body = {
        code: STATUS_CODE[status] ?? (status >= 500 ? 'INTERNAL' : 'VALIDATION_FAILED'),
        message: Array.isArray(message) ? 'Validation failed' : message,
        details: Array.isArray(message) ? message : undefined,
      };
    } else {
      body = { code: 'INTERNAL', message: 'Something went wrong' };
    }

    if (status >= 500) this.logger.error({ err: exception, requestId }, 'Unhandled error');
    if (res.headersSent) return;
    res.status(status).json({ ...body, requestId });
  }
}
