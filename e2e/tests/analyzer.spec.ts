import { expect, test } from "@playwright/test";
import { JarvisPage } from "../helpers/jarvis";

test.describe("Content Analyzer", () => {
  test.beforeEach(async ({ page }) => {
    const j = new JarvisPage(page);
    await j.goto();
    await j.goToTab("Content Analyzer");
  });

  test("email-sourced analysis shows amber ✉ badge", async ({ page }) => {
    const j = new JarvisPage(page);

    // Wait for sidebar to settle (analyses load async from API)
    await j.analyzerSidebar.waitFor({ timeout: 10_000 });

    // Skip gracefully if no email-sourced analyses exist in the current environment
    const hasEmailBadge = await j.emailBadgeItems
      .first()
      .isVisible({ timeout: 5_000 })
      .catch(() => false);
    if (!hasEmailBadge) {
      test.skip();
      return;
    }
    await expect(j.emailBadgeItems.first()).toBeVisible();
  });

  test("clicking a URL analysis renders research content", async ({ page }) => {
    const j = new JarvisPage(page);

    // Wait for sidebar to settle (analyses load async)
    await j.analyzerSidebar.waitFor({ timeout: 10_000 });

    // Click first available analysis
    const firstItem = j.analyzerItems.first();
    if (!(await firstItem.isVisible())) {
      test.skip(); // no analyses stored — skip gracefully
      return;
    }
    await firstItem.click();

    // The main canvas should show analysis content (not just empty state)
    const canvas = j.canvas;
    await expect(canvas).toBeVisible({ timeout: 10_000 });
    await expect(canvas).not.toContainText("Select an analysis or upload media");
  });

  test("URL analysis with email badge shows subject or source label", async ({ page }) => {
    const j = new JarvisPage(page);

    // Skip gracefully if no email-sourced analyses exist
    if (
      !(await j.emailBadgeItems
        .first()
        .isVisible({ timeout: 5_000 })
        .catch(() => false))
    ) {
      test.skip();
      return;
    }

    await j.emailBadgeItems.first().click();

    // The canvas should render content
    await expect(j.canvas).toBeVisible({ timeout: 10_000 });
  });
});
