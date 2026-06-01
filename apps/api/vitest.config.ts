import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    // The API suite is transform-heavy and slow to spin up on Windows; the
    // default 5s is too tight under parallel load and causes spurious timeouts.
    testTimeout: 20000,
    hookTimeout: 20000,
    // Run test files sequentially. Many API tests do real temp-file I/O
    // (transcripts, registry persistence); on Windows, running files in parallel
    // threads makes that I/O race and flake. Sequential files = deterministic.
    fileParallelism: false,
  },
});
