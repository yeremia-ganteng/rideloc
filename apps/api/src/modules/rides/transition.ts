import { canTransition, type RideStatus } from '@rideloc/shared';
import { AppError } from '../../lib/errors';

/** Every status change in the API goes through the transition table (FR-1). */
export function assertTransition(from: RideStatus, to: RideStatus): void {
  if (!canTransition(from, to)) {
    throw new AppError(409, 'INVALID_TRANSITION', `Cannot move a ride from ${from} to ${to}`);
  }
}
