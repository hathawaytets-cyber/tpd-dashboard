import { defineConfig, devices } from "@playwright/test";

const PORT = Number(process.env.E2E_PORT ?? 3410);

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? `http://localhost:${PORT}`,
    trace: "retain-on-failure",
  },
  // A fake-backend build (E2E_FAKE_BACKEND=1) is in live mode, where the demo-data suites cannot apply; only the
  // suites written for a live build run against it.
  projects: process.env.E2E_FAKE_BACKEND
    ? [{ name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testMatch: /(integrations|evaluations-live|ia-staging)\.spec/ }]
    : [
        { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } }, testIgnore: /mobile/ },
        { name: "mobile", use: { ...devices["Pixel 7"] }, testMatch: /mobile/ },
      ],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : { command: `npm run build && npx next start -p ${PORT}`, port: PORT, reuseExistingServer: true, timeout: 180_000 },
});
