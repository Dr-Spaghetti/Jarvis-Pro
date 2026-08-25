import { describe, expect, it } from "vitest";

import { encodeRfc822, headerMap } from "../src/gmail/googleWorkspace";

describe("encodeRfc822", () => {
  it("produces a base64url RFC822 payload with subject and body", () => {
    const raw = encodeRfc822({
      to: "rachel@example.com",
      subject: "Re: Venue",
      body: "See you Thursday.",
    });
    const decoded = Buffer.from(raw, "base64url").toString("utf8");
    expect(decoded).toContain("To: rachel@example.com");
    expect(decoded).toContain("Subject: Re: Venue");
    expect(decoded).toContain("See you Thursday.");
  });
});

describe("headerMap", () => {
  it("lowercases header names", () => {
    expect(
      headerMap([
        { name: "From", value: "Ada <ada@example.com>" },
        { name: "Subject", value: "Hello" },
      ]),
    ).toEqual({ from: "Ada <ada@example.com>", subject: "Hello" });
  });
});
