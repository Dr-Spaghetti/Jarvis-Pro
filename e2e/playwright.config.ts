import { defineConfig } from "@playwright/test";

// Requires Jarvis to be running:
//   Dev mode:  `pnpm dev`  → web on :5173, API on :8787  (BASE_URL=http://localhost:5173)
//   Prod mode: `node bin/octogent` → everything on :8787  (default)
// Override via:  BASE_URL=http://localhost:5173 pnpm test:e2e

const BASE_URL = process.env.BASE_URL ?? "http://localhost:8787";
const E2E_AUTH_TOKEN = process.env.OCTOGENT_AUTH_TOKEN ?? process.env.E2E_AUTH_TOKEN ?? "";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 1,
  // 2 workers: Jarvis is a single-process dev server — too many parallel page loads
  // cause load-time spikes and flaky nav timeouts.
  workers: 2,
  reporter: [["list"], ["html", { outputFolder: "../e2e-report", open: "never" }]],

  use: {
    baseURL: BASE_URL,
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    trace: "on-first-retry",
    // Seed auth from the environment so a live token is never committed.
    // Key matches apiClient.ts AUTH_TOKEN_STORAGE_KEY.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [{ name: "octogent.authToken", value: E2E_AUTH_TOKEN }],
        },
      ],
    },
  },
});
