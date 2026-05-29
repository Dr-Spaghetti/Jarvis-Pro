import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The API suite is transform-heavy and slow to spin up on Windows; the
    // default 5s is too tight under parallel load and causes spurious timeouts.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
