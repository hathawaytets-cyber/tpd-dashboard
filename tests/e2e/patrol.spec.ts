import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

test("start, recover after reload, and end patrol with confirmation", async ({ page }) => {
  await asRole(page, "officer", "/hq/patrol");
  await page.getByText("South District", { exact: true }).click();
  const start = page.getByRole("button", { name: "Start patrol in South" });
  await start.click();
  await expect(page.getByRole("heading", { name: "Active patrol" })).toBeVisible();
  await expect(page.getByRole("timer")).toBeVisible();
  await expect(page.getByRole("link", { name: /On duty, South District/ })).toBeVisible();

  await page.reload();
  await expect(page.getByText("Patrol recovered")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Active patrol" })).toBeVisible();

  // The notice is shown once per tab, not on every page load.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Active patrol" })).toBeVisible();
  await page.waitForTimeout(1500);
  await expect(page.getByText("Patrol recovered")).toHaveCount(0);

  await page.getByRole("button", { name: "End patrol" }).first().click();
  const confirm = page.getByRole("dialog", { name: "End patrol?" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep patrolling" }).click();
  await expect(page.getByRole("heading", { name: "Active patrol" })).toBeVisible();

  await page.getByRole("button", { name: "End patrol" }).first().click();
  await expect(confirm.getByText("South District")).toBeVisible();
  await confirm.getByRole("button", { name: "Confirm end patrol" }).click();
  const summary = page.getByRole("dialog", { name: "Patrol recorded" });
  await expect(summary).toBeVisible();
  await summary.getByRole("button", { name: "View session" }).click();
  const drawer = page.getByRole("dialog", { name: "Patrol session" });
  await expect(drawer.getByText("South District").first()).toBeVisible();
  await expect(drawer.getByText("Recorded")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Patrol console" })).toBeVisible();
});

test("probationary officers cannot start patrol", async ({ page }) => {
  await asRole(page, "probationary", "/hq/patrol");
  await expect(page.getByText("Independent patrol locked")).toBeVisible();
  await expect(page.getByRole("button", { name: /Start patrol/ })).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("start patrol");
  await expect(page.getByRole("option", { name: /Start patrol/ })).toHaveAttribute("aria-disabled", "true");
});

test("palette start patrol asks for confirmation first", async ({ page }) => {
  await asRole(page, "officer");
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: "Search commands" }).fill("start patrol");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: "Start patrol?" })).toBeVisible();
  await page.getByRole("button", { name: "Start in North" }).click();
  await expect(page.getByRole("link", { name: /On duty, North District/ })).toBeVisible();
});

test("activity correction is requested from history", async ({ page }) => {
  await asRole(page, "officer", "/hq/patrol#history");
  const row = page.locator("#history tbody tr").filter({ hasText: "Recorded" }).first();
  await row.getByRole("button", { name: "Request correction" }).click();
  const dialog = page.getByRole("dialog", { name: "Request a correction" });
  await dialog.getByRole("button", { name: "Submit for review" }).click();
  await expect(dialog.getByRole("alert")).toContainText("Explain what should change");
  await dialog.getByLabel("What should change, and why?").fill("Game crashed at 21:30; end time should be 21:30.");
  await dialog.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText(/Correction REQ-\d+ submitted/)).toBeVisible();
  await expect(page.locator("#history").getByText("Correction pending")).toHaveCount(2);
});

test("session history sorts and opens the detail drawer with correction history", async ({ page }) => {
  await asRole(page, "officer", "/hq/patrol#history");
  const table = page.getByRole("table", { name: "Session history" });
  await table.getByRole("button", { name: "Duration" }).click();
  await expect(table.getByRole("columnheader", { name: /Duration/ })).toHaveAttribute("aria-sort", "ascending");
  await table.locator("tbody tr").filter({ hasText: "Correction pending" }).getByRole("button", { name: /^View/ }).click();
  const drawer = page.getByRole("dialog", { name: "Patrol session" });
  await expect(drawer.getByText("REQ-1047")).toBeVisible();
  await expect(drawer.getByRole("button", { name: "Correction pending" })).toBeDisabled();
});

test("dashboard shows identity, recent patrols and starts patrol from quick actions", async ({ page }) => {
  await asRole(page, "officer", "/hq");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("R. Delgado");
  await expect(page.getByText("X-414").first()).toBeVisible();
  const recent = page.getByRole("table", { name: "Recent patrols" });
  await expect(recent.locator("tbody tr").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Activity correction pending/ })).toBeVisible();
  await page.getByRole("button", { name: "Quick actions" }).click();
  await expect(page.getByRole("menuitem", { name: /Command Center/ })).toHaveCount(0);
  await page.getByRole("menuitem", { name: "Start patrol · North" }).click();
  await expect(page.getByRole("link", { name: /On duty, North District/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open patrol console" }).or(page.getByRole("link", { name: "Open patrol console" }))).toBeVisible();
});
