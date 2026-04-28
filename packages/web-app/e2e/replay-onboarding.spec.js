/* replay-onboarding.spec.js — verify "Replay onboarding" actually shows the
 * NEW six-step journey panel and not the legacy driver.js spotlight tour.
 */
import { test, expect } from "@playwright/test";

test("Replay onboarding shows the new journey panel, not the legacy tour", async ({ page }) => {
  // First load: simulate a returning user (journey complete + dismissed).
  await page.goto("/");
  await page.evaluate(() => {
    try {
      localStorage.setItem(
        "datalex.onboarding.journey",
        JSON.stringify({
          version: 1,
          completed: ["welcome","connect","gaps","design","ai","draw"],
          dismissed: true,
        })
      );
      localStorage.setItem(
        "datalex.onboarding.seen",
        JSON.stringify({ version: 5, at: new Date().toISOString() })
      );
    } catch {}
  });
  await page.reload();
  await expect(page.locator("body")).toBeVisible();

  // Sanity: the panel is NOT showing for a returning user.
  await expect(page.getByRole("complementary", { name: /DataLex onboarding/i }))
    .toBeHidden({ timeout: 3_000 });

  // What the "Replay onboarding" button does, verbatim:
  //   resetJourney(); resetOnboardingSeen(); window.location.reload();
  await page.evaluate(() => {
    try { localStorage.removeItem("datalex.onboarding.journey"); } catch {}
    try { localStorage.removeItem("datalex.onboarding.seen"); } catch {}
  });
  await page.reload();

  // The new journey panel must mount and start at step 1.
  await expect(page.getByRole("complementary", { name: /DataLex onboarding/i }))
    .toBeVisible({ timeout: 10_000 });
  await expect(page.getByRole("heading", { name: /Build your first DataLex model/i })).toBeVisible();
  await expect(page.getByText(/Step 1 of 6/)).toBeVisible();

  // The legacy driver.js popover must NOT be present.
  const driverActive = await page.locator(".driver-popover, .driver-active, .driver-popover-content").count();
  expect(driverActive).toBe(0);

  // No legacy WelcomeModal either.
  const welcomeModal = await page.getByRole("dialog", { name: /Welcome/i }).count();
  expect(welcomeModal).toBe(0);
});
