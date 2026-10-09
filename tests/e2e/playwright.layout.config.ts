import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config.js';

export default defineConfig({
  ...base,
  testMatch: ['review-audio.spec.ts', 'shared-state.spec.ts'],
  projects: [{ name: 'layout-perturbed', use: { ...devices['Desktop Chrome'] } }],
  reporter: [['list'], ['html', { outputFolder: 'test-results/e2e-layout-report', open: 'never' }]],
  outputDir: '../../test-results/e2e-layout',
});
