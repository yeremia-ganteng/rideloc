import { describe, expect, it, vi } from 'vitest';
import { startPeriodicJob } from './periodic-job';

function setup(opts: { lock?: boolean; run?: () => Promise<void> }) {
  const run = vi.fn(opts.run ?? (async () => undefined));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const job = startPeriodicJob({
    name: 'test',
    run,
    tryAcquireLock: async () => opts.lock ?? true,
    logger,
    intervalMs: 60_000, // the real timer never fires during a test; tests call tick()
  });
  return { run, logger, job };
}

describe('periodic job', () => {
  it('menjalankan job hanya jika lock didapat', async () => {
    const won = setup({ lock: true });
    await won.job.tick();
    won.job.stop();
    expect(won.run).toHaveBeenCalledOnce();

    const lost = setup({ lock: false });
    await lost.job.tick();
    lost.job.stop();
    expect(lost.run).not.toHaveBeenCalled();
  });

  it('tidak tumpang tindih saat putaran sebelumnya masih berjalan', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { job, run } = setup({ run: () => gate });
    const first = job.tick();
    await job.tick(); // returns immediately: still running
    await new Promise((r) => setTimeout(r, 0));
    expect(run).toHaveBeenCalledTimes(1);
    release();
    await first;
    job.stop();
  });

  it('error dicatat dan putaran berikutnya tetap berjalan', async () => {
    let calls = 0;
    const { job, logger } = setup({
      run: async () => {
        calls += 1;
        if (calls === 1) throw new Error('boom');
      },
    });
    await job.tick();
    await job.tick();
    job.stop();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(calls).toBe(2);
  });
});
