import { afterEach, describe, expect, it, vi } from "vitest";

import { createShellEnvironment } from "../src/terminalRuntime/ptyEnvironment";

const DENIED_KEYS = [
  "GMAIL_CLIENT_SECRET",
  "GMAIL_REFRESH_TOKEN",
  "GMAIL_ACCESS_TOKEN",
  "GMAIL_CLIENT_ID",
  "TELEGRAM_BOT_TOKEN",
] as const;

describe("createShellEnvironment", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("strips Gmail and Telegram secrets while keeping OCTOGENT_AUTH_TOKEN", () => {
    for (const key of DENIED_KEYS) {
      vi.stubEnv(key, `${key}-secret`);
    }
    vi.stubEnv("OCTOGENT_AUTH_TOKEN", "keep-me");

    const env = createShellEnvironment({ octogentSessionId: "session-1" });

    for (const key of DENIED_KEYS) {
      expect(env[key]).toBeUndefined();
    }
    expect(env.OCTOGENT_AUTH_TOKEN).toBe("keep-me");
    expect(env.OCTOGENT_SESSION_ID).toBe("session-1");
    expect(env.TERM).toBe("xterm-256color");
    expect(env.COLORTERM).toBe("truecolor");
  });
});
