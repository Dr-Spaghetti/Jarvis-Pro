import { expect, test } from "@playwright/test";
import { JarvisPage } from "../helpers/jarvis";

// Smoke tests — tagged @smoke. Run in ~15s, safe for pre-commit.
// These cover the ★-starred critical flows from e2e/flows.md.

test("@smoke app loads and canvas is visible", async ({ page }) => {
  const j = new JarvisPage(page);
  await j.goto();
  await j.expectPageLoaded();
});

test("@smoke primary tabs are all clickable", async ({ page }) => {
  const j = new JarvisPage(page);
  await j.goto();

  const tabs = ["Agent Arsenal", "Surveillance", "Content Analyzer", "Settings", "Jarvis HQ"];

  for (const tab of tabs) {
    await j.goToTab(tab);
    // Canvas must still be visible after each tab switch
    await expect(j.canvas).toBeVisible();
  }
});

test("@smoke content analyzer sidebar renders items", async ({ page }) => {
  const j = new JarvisPage(page);
  await j.goto();
  await j.goToTab("Content Analyzer");

  // Wait for the analyzer section to mount (confirms tab switch completed)
  await j.analyzerView.waitFor({ timeout: 10_000 });

  // Sidebar must be visible (the <aside> with "Past Analyses" header always renders)
  await expect(j.analyzerSidebar).toBeVisible({ timeout: 5_000 });

  // Sidebar must show either analysis buttons OR the empty-state paragraph
  // (depends on whether analyses are stored — both are valid steady states)
  await expect(j.analyzerSidebar.locator("button, p").first()).toBeVisible({ timeout: 10_000 });
});
