import { describe, expect, it } from "vitest";

import { extractEmailTargets } from "../src/createApiServer/emailIngestProcessor";

describe("extractEmailTargets", () => {
  it("keeps page links and image links in separate buckets", () => {
    const { pageUrls, imageUrls } = extractEmailTargets(
      "see https://example.com/post and https://cdn.example.com/shot.png",
      "",
    );
    expect(pageUrls).toEqual(["https://example.com/post"]);
    expect(imageUrls).toEqual(["https://cdn.example.com/shot.png"]);
  });

  it("drops tracker domains", () => {
    const { pageUrls, imageUrls } = extractEmailTargets(
      "https://wisestamp.com/pixel.gif https://example.com/a",
      "",
    );
    expect(pageUrls).toEqual(["https://example.com/a"]);
    expect(imageUrls).toEqual([]);
  });
});
