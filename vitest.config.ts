import { defineConfig } from 'vitest/config';

const sources = [
  'apps/*/src/**',
  'apps/*/test/**',
  'libs/*/src/**',
  'libs/*/scripts/**',
  'libs/*/test/**',
  'scripts/**',
  'tools/**',
];

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: sources.map((glob) => `${glob}/*.spec.{ts,tsx}`),
          exclude: ['**/node_modules/**', '**/*.integration.spec.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: sources.flatMap((glob) => [`${glob}/*.integration.spec.ts`, `${glob}/*.e2e-spec.ts`]),
          exclude: ['**/node_modules/**'],
          testTimeout: 180_000,
          hookTimeout: 180_000,
        },
      },
      {
        test: {
          name: 'vectors',
          include: ['libs/chain/**/*.vectors.spec.ts', 'apps/verifier/**/*.vectors.spec.ts'],
          exclude: ['**/node_modules/**'],
        },
      },
    ],
  },
});
