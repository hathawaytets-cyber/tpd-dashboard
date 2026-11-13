import { expect, test } from "@playwright/test";
import { asRole } from "./helpers";

test("public report form is reachable from the homepage and says when intake is not connected", async ({ page }) => {
  await page.goto("/");
  await page.locator("main").getByRole("link", { name: /Report an officer/ }).first().click();
  await expect(page).toHaveURL(/\/report\/?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Report an officer" })).toBeVisible();
  for (const s of ["Officer involved", "What happened", "Evidence and witnesses", "About you"]) await expect(page.getByRole("heading", { name: s })).toBeVisible();
  // The preview build has no backend: the form must say so instead of pretending to submit.
  await expect(page.getByText(/not connected on this site yet/).first()).toBeVisible();
  // The officer picker is for signed-in members only; the public describes the officer instead.
  await expect(page.getByRole("combobox", { name: /Officer/ })).toHaveCount(0);
  // No privileged credentials in the public page.
  const html = await page.content();
  expect(html).not.toMatch(/service_role|ank_v1\.|IA_INTAKE_PEPPER/);
});

test("receipt lookup page explains what it shows", async ({ page }) => {
  await page.goto("/report/status");
  await expect(page.getByRole("heading", { level: 1, name: "Complaint status" })).toBeVisible();
  await expect(page.getByText("Status lookup is not connected on this site yet.")).toBeVisible();
});

test("IA workspace: preview dashboard, queues and case file", async ({ page }) => {
  await asRole(page, "officer", "/hq/internal-affairs");
  await expect(page.getByRole("heading", { level: 1, name: "Case management" })).toBeVisible();
  await expect(page.getByText("Design preview with fictional cases")).toBeVisible();
  await page.getByRole("tab", { name: /Overdue/ }).click();
  await expect(page.getByRole("link", { name: "IA-2026-0009" })).toBeVisible();
  await expect(page.getByRole("link", { name: "IA-2026-0011" })).toHaveCount(0);
  await page.getByRole("tab", { name: /^Open/ }).click();
  await page.getByRole("link", { name: "IA-2026-0011" }).click();
  await expect(page).toHaveURL(/\/hq\/internal-affairs\/case\/?\?id=c-3/);
  await expect(page.getByRole("heading", { level: 1, name: /IA-2026-0011/ })).toBeVisible();
});

test("IA appointments list six seats and the AnchorCAD page links out without data", async ({ page }) => {
  await asRole(page, "officer", "/hq/internal-affairs/appointments");
  await expect(page.getByRole("heading", { level: 1, name: "Appointments" })).toBeVisible();
  for (const c of ["IA-01", "IA-02", "IA-03", "IA-04", "IA-05", "IA-06"]) await expect(page.getByText(c, { exact: true }).first()).toBeVisible();
  await page.goto("/hq/cad");
  await expect(page.getByRole("heading", { level: 1, name: "AnchorCAD" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Join the community/ })).toHaveAttribute("href", "https://anchr.gg/join?communityid=vcfsrp");
});

test("navigation shows Report misconduct and AnchorCAD to every member", async ({ page }) => {
  await asRole(page, "probationary", "/hq");
  const nav = page.getByRole("navigation", { name: "Headquarters" });
  await expect(nav.getByRole("link", { name: "AnchorCAD" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "Report misconduct" })).toBeVisible();
});
