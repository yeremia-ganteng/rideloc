import type { z } from 'zod';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** Validates untrusted input at a system boundary and throws a 400 AppError on failure. */
export function parseOrThrow<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new AppError(
      400,
      'VALIDATION_ERROR',
      'Invalid request',
      result.error.issues.map((i) => ({ path: i.path.map(String).join('.'), message: i.message })),
    );
  }
  return result.data;
}

export function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === '23505';
}
