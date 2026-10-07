import { StandardSchemaValidationPipe } from '@nestjs/common';
import { AppError } from '@seo/shared';

/** Global pipe for `@Body({ schema })` etc. (Nest 12 Standard Schema → zod). */
export function createValidationPipe() {
  return new StandardSchemaValidationPipe({
    exceptionFactory: (issues) =>
      new AppError(
        'VALIDATION_FAILED',
        'Validation failed',
        issues.map((issue) => ({
          path: issue.path?.map((s) => (typeof s === 'object' ? s.key : s)).join('.') ?? '',
          message: issue.message,
        })),
      ),
  });
}
