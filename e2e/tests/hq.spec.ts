import { expect, test } from "@playwright/test";
import { JarvisPage } from "../helpers/jarvis";

test.describe("Jarvis HQ", () => {
  test("conversation panel is visible on load", async ({ page }) => {
    const j = new JarvisPage(page);
    await j.goto();
    await j.goToTab("Jarvis HQ");

    // JarvisHomePrimaryView renders as <section aria-label="Jarvis home view">
    // which contains <div className="nc-hq-console hud-panel"> as the conversation panel
    await expect(page.locator('[aria-label="Jarvis home view"]')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".nc-hq-console")).toBeVisible({ timeout: 5_000 });
    await expect(page.getByLabel("Today")).toBeVisible();
    await expect(page.getByRole("form", { name: "Capture" })).toBeVisible();
    await expect(page.getByLabel("Mail")).toBeVisible();
    await expect(page.getByLabel("Agenda")).toBeVisible();
  });

  test("chat input is present and accepts text", async ({ page }) => {
    const j = new JarvisPage(page);
    await j.goto();
    await j.goToTab("Jarvis HQ");

    // Input must exist
    await expect(j.chatInput).toBeVisible({ timeout: 10_000 });

    // Can type into it
    await j.chatInput.fill("test");
    await expect(j.chatInput).toHaveValue("test");
    await j.chatInput.clear();
  });
});
