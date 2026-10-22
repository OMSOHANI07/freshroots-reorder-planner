import { defineConfig, devices } from "@playwright/test";

// Runs against `make dev` (API :8000 + site :3000), starting them if needed.
export default defineConfig({
  testDir: "./e2e",
  timeout: 180_000,
  workers: 1,
  fullyParallel: false,
  expect: { timeout: 30_000 },
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    contextOptions: { reducedMotion: "reduce" },
    acceptDownloads: true,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL ? undefined : [
    { command: "make api", url: "http://127.0.0.1:8000/api/health", reuseExistingServer: true, timeout: 120_000 },
    { command: "npm run dev", url: "http://localhost:3000", reuseExistingServer: true, timeout: 120_000 },
  ],
});
