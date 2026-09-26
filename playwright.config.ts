import { defineConfig, devices } from '@playwright/test';

const chromium = devices['Desktop Chrome'];

export default defineConfig({
  forbidOnly: true,
  reporter: 'list',
  projects: [
    { name: 'web', testDir: 'apps/web/e2e', use: { ...chromium, baseURL: 'http://127.0.0.1:5173' } },
    { name: 'portal', testDir: 'apps/portal/e2e', use: { ...chromium, baseURL: 'http://127.0.0.1:5174' } },
  ],
  webServer: [
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1',
      cwd: 'apps/web',
      url: 'http://127.0.0.1:5173',
      reuseExistingServer: false,
    },
    {
      command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1',
      cwd: 'apps/portal',
      url: 'http://127.0.0.1:5174',
      reuseExistingServer: false,
    },
  ],
});
