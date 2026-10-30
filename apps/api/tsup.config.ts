import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  target: 'node22',
  clean: true,
  // Bundle paket workspace (source TS) ke dalam hasil build.
  noExternal: ['@rideloc/shared'],
});
