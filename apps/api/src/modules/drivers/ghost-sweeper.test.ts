import { describe, expect, it, vi } from 'vitest';
import { startGhostSweeper } from './ghost-sweeper';

function setup(opts: {
  lock?: boolean;
  sweep?: () => Promise<{ removedFromGeo: number; markedOffline: number }>;
}) {
  const sweepGhosts = vi.fn(opts.sweep ?? (async () => ({ removedFromGeo: 0, markedOffline: 0 })));
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const sweeper = startGhostSweeper({
    presence: { sweepGhosts },
    tryAcquireLock: async () => opts.lock ?? true,
    logger,
    intervalMs: 60_000, // the real timer never fires during a test; tests call tick()
  });
  return { sweepGhosts, logger, sweeper };
}

describe('ghost sweeper', () => {
  it('menyapu saat lock didapat dan mencatat hanya jika ada yang dibersihkan', async () => {
    const { sweeper, sweepGhosts, logger } = setup({
      sweep: async () => ({ removedFromGeo: 2, markedOffline: 1 }),
    });
    await sweeper.tick();
    sweeper.stop();
    expect(sweepGhosts).toHaveBeenCalledOnce();
    expect(logger.info).toHaveBeenCalledWith(
      { removedFromGeo: 2, markedOffline: 1 },
      'ghost sweep',
    );
  });

  it('tidak menyapu dan tidak mencatat jika instance lain memegang lock', async () => {
    const { sweeper, sweepGhosts, logger } = setup({ lock: false });
    await sweeper.tick();
    sweeper.stop();
    expect(sweepGhosts).not.toHaveBeenCalled();
    expect(logger.info).not.toHaveBeenCalled();
  });

  it('tidak tumpang tindih saat sapuan sebelumnya masih berjalan', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { sweeper, sweepGhosts } = setup({
      sweep: async () => {
        await gate;
        return { removedFromGeo: 0, markedOffline: 0 };
      },
    });
    const first = sweeper.tick();
    await sweeper.tick(); // returns immediately: still running
    await new Promise((r) => setTimeout(r, 0));
    expect(sweepGhosts).toHaveBeenCalledTimes(1);
    release();
    await first;
    sweeper.stop();
  });

  it('error saat menyapu dicatat dan tidak menjatuhkan proses, putaran berikutnya tetap jalan', async () => {
    let calls = 0;
    const { sweeper, logger } = setup({
      sweep: async () => {
        calls += 1;
        if (calls === 1) throw new Error('redis down');
        return { removedFromGeo: 0, markedOffline: 0 };
      },
    });
    await sweeper.tick();
    await sweeper.tick();
    sweeper.stop();
    expect(logger.error).toHaveBeenCalledOnce();
    expect(calls).toBe(2);
  });
});
