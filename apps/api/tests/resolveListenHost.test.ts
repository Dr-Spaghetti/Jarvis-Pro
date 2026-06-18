import { describe, expect, it } from "vitest";
import { resolveListenHost, toDisplayHost } from "../src/resolveListenHost";

describe("resolveListenHost", () => {
  it("binds loopback by default (local-only)", () => {
    expect(resolveListenHost({})).toBe("127.0.0.1");
  });

  it("binds all interfaces in remote mode so LAN/Tailscale clients can connect", () => {
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "1" })).toBe("0.0.0.0");
  });

  it("stays loopback when remote flag is anything other than '1'", () => {
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "0" })).toBe("127.0.0.1");
    expect(resolveListenHost({ OCTOGENT_ALLOW_REMOTE_ACCESS: "true" })).toBe("127.0.0.1");
  });

  it("lets OCTOGENT_API_HOST override everything", () => {
    expect(resolveListenHost({ OCTOGENT_API_HOST: "100.64.0.5" })).toBe("100.64.0.5");
    expect(
      resolveListenHost({ OCTOGENT_API_HOST: "192.168.1.10", OCTOGENT_ALLOW_REMOTE_ACCESS: "1" }),
    ).toBe("192.168.1.10");
  });

  it("ignores blank OCTOGENT_API_HOST", () => {
    expect(resolveListenHost({ OCTOGENT_API_HOST: "   " })).toBe("127.0.0.1");
  });
});

describe("toDisplayHost", () => {
  it("maps wildcard binds to loopback for the local browser/base URL", () => {
    expect(toDisplayHost("0.0.0.0")).toBe("127.0.0.1");
    expect(toDisplayHost("::")).toBe("127.0.0.1");
  });

  it("leaves concrete hosts unchanged", () => {
    expect(toDisplayHost("127.0.0.1")).toBe("127.0.0.1");
    expect(toDisplayHost("100.64.0.5")).toBe("100.64.0.5");
  });
});
