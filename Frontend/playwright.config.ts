import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: { baseURL:'http://127.0.0.1:3000', headless:true, channel:process.env.PLAYWRIGHT_CHANNEL || undefined },
  webServer: { command:'npm run dev -- --host 127.0.0.1', url:'http://127.0.0.1:3000', reuseExistingServer:!process.env.CI },
});
