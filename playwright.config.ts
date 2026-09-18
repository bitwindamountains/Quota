import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e', fullyParallel: false, workers: 1,
  timeout: 30000, retries: 0,
  use: { baseURL: 'http://127.0.0.1:4320', browserName: 'chromium', headless: true, viewport: { width: 1440, height: 1100 }, colorScheme: 'light', trace: 'retain-on-failure' },
  webServer: { command: 'node scripts/e2e-server.mjs', url: 'http://127.0.0.1:4320/api/health', reuseExistingServer: false, timeout: 15000 }
});
