import type { MinimalLogger } from '../../lib/logger';
import type { PresenceService } from './presence.service';

export interface SweeperDeps {
  presence: Pick<PresenceService, 'sweepGhosts'>;
  /** Returns true if this instance won the cluster-wide lock for this round. */
  tryAcquireLock: () => Promise<boolean>;
  logger: MinimalLogger;
  intervalMs: number;
}

export function startGhostSweeper({ presence, tryAcquireLock, logger, intervalMs }: SweeperDeps) {
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; // never overlap with a slow previous sweep
    running = true;
    try {
      if (!(await tryAcquireLock())) return;
      const result = await presence.sweepGhosts();
      if (result.removedFromGeo + result.markedOffline > 0) logger.info(result, 'ghost sweep');
    } catch (err) {
      logger.error({ err }, 'ghost sweep failed');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();

  return { tick, stop: (): void => clearInterval(timer) };
}
