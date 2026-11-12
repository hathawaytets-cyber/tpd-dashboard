import { expect, type Page } from "@playwright/test";

export type Role = "officer" | "probationary" | "supervisor" | "lieutenant" | "command";

/** Loads HQ with fresh sample data as the given preview persona. */
export async function asRole(page: Page, role: Role, path = "/hq") {
  await page.goto("/hq");
  await page.waitForFunction(() => localStorage.getItem("tpd-preview-state"));
  await page.evaluate(() => {
    localStorage.removeItem("tpd-preview-state");
    localStorage.removeItem("tpd-command-views");
    localStorage.removeItem("tpd-sidebar-collapsed");
    localStorage.removeItem("tpd-dpe-preview");
  });
  await page.reload();
  await page.waitForFunction(() => localStorage.getItem("tpd-preview-state"));
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem("tpd-preview-state")!);
    s.role = r;
    localStorage.setItem("tpd-preview-state", JSON.stringify(s));
  }, role);
  await page.goto(path);
  await expect(page.locator("main")).not.toBeEmpty();
}
