import { defineConfig } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testMatch: '**/failure.spec.ts',
  testIgnore: [],
  reporter: [
    ['list'],
    ['html', { outputFolder: 'test-results/e2e-failure-report', open: 'never' }],
  ],
  outputDir: '../../test-results/e2e-failure',
  use: { ...base.use, baseURL: 'http://127.0.0.1:5175' },
  webServer: {
    ...(Array.isArray(base.webServer) ? base.webServer[0]! : base.webServer!),
    url: 'http://127.0.0.1:5175',
    env: {
      E2E_FAILURE_MODE: 'true',
      E2E_API_PORT: '4102',
      E2E_WEB_PORT: '5175',
      E2E_DB_NAME: 'devday_study_failure_e2e',
    },
  },
});
