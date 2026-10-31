import { describe, expect, it } from 'vitest';
import { assertTransition } from './transition';

describe('assertTransition', () => {
  it('diam untuk transisi yang diizinkan', () => {
    expect(() => assertTransition('SEARCHING', 'DRIVER_ASSIGNED')).not.toThrow();
  });

  it('melempar AppError 409 untuk transisi terlarang', () => {
    expect(() => assertTransition('COMPLETED', 'SEARCHING')).toThrowError(
      expect.objectContaining({ statusCode: 409, code: 'INVALID_TRANSITION' }),
    );
  });
});
