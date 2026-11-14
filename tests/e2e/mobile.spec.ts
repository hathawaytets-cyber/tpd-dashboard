import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

test("mobile tab bar and navigation drawer", async ({ page }) => {
  await asRole(page, "officer");
  const tabs = page.getByRole("navigation", { name: "Quick navigation" });
  await expect(tabs).toBeVisible();
  await tabs.getByRole("link", { name: "Patrol" }).click();
  await expect(page).toHaveURL(/\/hq\/patrol$/);
  await tabs.getByRole("button", { name: "More" }).click();
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await drawer.getByRole("link", { name: "Requests" }).click();
  await expect(page).toHaveURL(/\/hq\/requests/);
  await expect(drawer).toBeHidden();
});

test("no horizontal page overflow on key screens", async ({ page }) => {
  for (const [role, path] of [["officer", "/hq"], ["officer", "/hq/patrol"], ["officer", "/hq/structure"], ["officer", "/hq/resources"], ["officer", "/hq/divisions/swat"], ["probationary", "/hq/training"], ["officer", "/"], ["command", "/hq"], ["command", "/hq/command"], ["command", "/hq/command?id=REQ-1047"], ["officer", "/report"], ["officer", "/report/status"], ["officer", "/hq/internal-affairs"], ["officer", "/hq/internal-affairs/case?id=c-3"], ["officer", "/hq/internal-affairs/appointments"], ["officer", "/hq/cad"], ["supervisor", "/hq/evaluations"], ["lieutenant", "/hq/evaluations"], ["command", "/hq/command/evaluations"]] as const) {
    await asRole(page, role, path);
    await page.waitForTimeout(400);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, path).toBeLessThanOrEqual(0);
    // A too-wide layout makes mobile browsers zoom out, which hides overflow from the check above.
    expect(await page.evaluate(() => window.innerWidth), `${path} layout width`).toBe(page.viewportSize()!.width);
  }
});

test("a Sergeant can file a no-observations report on a phone", async ({ page }) => {
  await asRole(page, "supervisor", "/hq/evaluations");
  await page.getByRole("checkbox", { name: /No notable observations/ }).check();
  // The sticky action bar sits above the bottom navigation, so the button is not covered.
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Submitted: no notable observations")).toBeVisible();
});
