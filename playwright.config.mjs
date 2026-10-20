import { defineConfig } from '@playwright/test';

// End-to-end specs: the plugin from this checkout in a real VS Code
// (downloaded into .vscode-test), against projects joy builds for the run.
export default defineConfig({
  testDir: './e2e',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
});
