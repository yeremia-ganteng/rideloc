import type { MinimalLogger } from './logger';

export interface PeriodicJobDeps {
  name: string;
  run: () => Promise<void>;
  /** Returns true if this instance won the cluster-wide lock for this round. */
  tryAcquireLock: () => Promise<boolean>;
  logger: MinimalLogger;
  intervalMs: number;
}

export function startPeriodicJob({
  name,
  run,
  tryAcquireLock,
  logger,
  intervalMs,
}: PeriodicJobDeps) {
  let running = false;

  async function tick(): Promise<void> {
    if (running) return; // never overlap with a slow previous round
    running = true;
    try {
      if (!(await tryAcquireLock())) return;
      await run();
    } catch (err) {
      logger.error({ err, job: name }, 'periodic job failed');
    } finally {
      running = false;
    }
  }

  const timer = setInterval(() => void tick(), intervalMs);
  timer.unref();

  return { tick, stop: (): void => clearInterval(timer) };
}
