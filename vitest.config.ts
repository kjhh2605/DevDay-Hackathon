import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['packages/**/*.test.ts', 'apps/**/*.test.ts', 'infra/**/*.test.ts'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/cdk.out/**',
            '**/*.integration.test.ts',
          ],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'integration',
          include: ['apps/**/*.integration.test.ts', 'tests/integration/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/dist/**', '**/cdk.out/**'],
          environment: 'node',
          fileParallelism: false,
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
    ],
  },
});
