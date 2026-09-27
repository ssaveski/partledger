import { defineConfig, devices } from '@playwright/test';

const chromium = devices['Desktop Chrome'];

export default defineConfig({
  forbidOnly: true,
  reporter: [['list'], ['html', { open: 'never' }]],
  // CI uploads the report and traces when a run fails, so a failure there can be diagnosed.
  use: { trace: 'retain-on-failure' },
  // Three cold dev servers share the CI runner, so the first render of a page can exceed 5 seconds.
  expect: { timeout: 10_000 },
  projects: [
    { name: 'web', testDir: 'apps/web/e2e', use: { ...chromium, baseURL: 'http://127.0.0.1:5173' } },
    { name: 'portal', testDir: 'apps/portal/e2e', use: { ...chromium, baseURL: 'http://127.0.0.1:5174' } },
    { name: 'ui', testDir: 'libs/ui/e2e', use: { ...chromium, baseURL: 'http://127.0.0.1:5175' } },
  ],
  webServer: [
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1',
      cwd: 'apps/web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1',
      cwd: 'apps/portal',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
      stdout: 'pipe',
    },
    {
      command:
        'node node_modules/storybook/dist/bin/dispatcher.js dev --port 5175 --exact-port --host 127.0.0.1 --ci --no-open',
      cwd: 'libs/ui',
      url: 'http://127.0.0.1:5175/index.json',
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
