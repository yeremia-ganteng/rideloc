import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.int.test.ts'],
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    fileParallelism: false, // all files share one database
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
