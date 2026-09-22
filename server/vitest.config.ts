import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each test file gets an isolated on-disk database, so files may run in
    // parallel; within a file, tests run sequentially.
    pool: 'forks',
    testTimeout: 20000,
    hookTimeout: 20000,
    globals: false,
    setupFiles: ['./tests/setup.ts'],
  },
});
