import { type Locator, type Page, expect } from "@playwright/test";

export class JarvisPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  // ── Navigation ──────────────────────────────────────────────────────────────

  async goto() {
    // Watch for the two API calls that useInitialColumnsHydration awaits in parallel.
    // Both must resolve before applyHydratedUiState() fires. We race both approaches:
    //   a) body[data-hydrated="true"] — set by App.tsx useEffect (requires rebuilt Jarvis)
    //   b) network fallback — wait for both /api/ui-state and /api/terminals responses
    const terminalsResponsePromise = this.page
      .waitForResponse((r) => r.url().includes("/api/terminals") && !r.url().includes("/ws"), {
        timeout: 8_000,
      })
      .catch(() => null);
    const uiStateResponsePromise = this.page
      .waitForResponse((r) => r.url().includes("/api/ui-state"), { timeout: 8_000 })
      .catch(() => null);

    await this.page.goto("/");
    await this.page.waitForLoadState("load");
    // Wait for the primary nav to confirm app rendered past auth gate
    await this.page.locator('[aria-label="Primary navigation"]').waitFor({ timeout: 20_000 });

    // Prefer the data-hydrated attribute (added by App.tsx after hydration). Falls back
    // to a 3s timeout if the attribute isn't present (Jarvis hasn't been rebuilt yet).
    const hydrated = await this.page
      .locator("body[data-hydrated='true']")
      .waitFor({ timeout: 3_000 })
      .then(() => true)
      .catch(() => false);

    if (!hydrated) {
      // Network fallback: both responses must arrive before applyHydratedUiState fires
      await Promise.all([terminalsResponsePromise, uiStateResponsePromise]);
      await this.page.waitForTimeout(200);
    }
  }

  async goToTab(name: string) {
    // Scope to the primary nav to avoid matching aria-label*= on content-area elements.
    // Tab aria-labels are: "Jarvis HQ (9)", "Content Analyzer (5)", "Settings (7)", etc.
    await this.page
      .locator('[aria-label="Primary navigation"]')
      .locator(`[aria-label*="${name}"]`)
      .click();
    await this.page.waitForTimeout(500);
  }

  // ── Main canvas ─────────────────────────────────────────────────────────────

  get canvas(): Locator {
    return this.page.locator('[aria-label="Main content canvas"]');
  }

  // ── Content Analyzer ────────────────────────────────────────────────────────

  // AnalyzerPrimaryView renders:
  //   <section aria-label="Analyzer primary view">
  //     <aside>  ← sidebar with "Past Analyses" list
  //       <button>...</button>  ← one per analysis
  //     </aside>
  //   </section>
  get analyzerView(): Locator {
    return this.page.locator('[aria-label="Analyzer primary view"]');
  }

  get analyzerSidebar(): Locator {
    return this.analyzerView.locator("aside");
  }

  get analyzerItems(): Locator {
    return this.analyzerSidebar.locator("button");
  }

  async analyzerItem(pattern: RegExp): Promise<Locator> {
    return this.analyzerItems.filter({ hasText: pattern });
  }

  get emailBadgeItems(): Locator {
    return this.analyzerItems.filter({
      has: this.page.locator('span:text("✉")'),
    });
  }

  async clickAnalyzerItem(pattern: RegExp) {
    const item = await this.analyzerItem(pattern);
    await item.click();
  }

  // ── Conversation ─────────────────────────────────────────────────────────────

  get chatInput(): Locator {
    return this.canvas.locator("textarea, input[type='text']").last();
  }

  async sendMessage(text: string) {
    await this.chatInput.fill(text);
    await this.chatInput.press("Enter");
  }

  // ── Assertions ───────────────────────────────────────────────────────────────

  async expectPageLoaded() {
    await expect(this.page.locator('[aria-label="Main content canvas"]')).toBeVisible({
      timeout: 15_000,
    });
    await expect(this.page.locator("body")).not.toContainText("Access token prompt");
  }
}
