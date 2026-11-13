import { expect, test } from "@playwright/test";

test("homepage shows the disclaimer, badge and real links", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(/Not a real police agency/)).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Tampa Police Department" })).toBeVisible();
  await expect(page.getByRole("img", { name: "Tampa Police Department badge" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Apply to join/ }).first()).toHaveAttribute("href", "https://forms.gle/EG78MZdQdgMdLoYX8");
  for (const id of ["about", "join", "districts", "divisions", "leadership", "policies", "ride-alongs"]) await expect(page.locator(`#${id}`)).toBeAttached();
  await expect(page.getByText(/not affiliated with the City of Tampa/)).toBeVisible();
});

test("homepage shows verified leadership, vacancies and staffing", async ({ page }) => {
  await page.goto("/");
  const lead = page.locator("#leadership");
  await expect(lead.getByText("J. Quinellope")).toBeVisible();
  await expect(lead.getByText("Chief of Police · Overall Operations")).toBeVisible();
  await expect(lead.getByText(/more positions open/).first()).toBeVisible();
  await expect(page.getByText("13 / 134")).toBeVisible();
  await expect(page.locator("#divisions").getByText("M. Hathaway")).toBeVisible();
  const html = await page.content();
  expect(html).not.toMatch(/\b\d{17,20}\b/);
});

test("department structure lists every tier and collapses vacant district slots", async ({ page }) => {
  await page.goto("/hq/structure");
  await expect(page.getByRole("heading", { level: 1, name: "Department structure" })).toBeVisible();
  for (const t of ["Office of the Chiefs", "Command Staff", "Division Command", "Field Supervisory", "North District", "South District"]) await expect(page.getByText(t, { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "J. Basit" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "X-402–406" })).toBeVisible();
  await expect(page.getByText("13", { exact: true }).first()).toBeVisible();
});

test("civilian ride-along entry is prominent and routes to source-grounded instructions", async ({ page }) => {
  await page.goto("/");
  const rideAlongs = page.locator("#ride-alongs");
  await expect(rideAlongs.getByRole("heading", { name: /Experience a patrol shift/ })).toBeVisible();
  await expect(rideAlongs.getByRole("link", { name: /Open application/ })).toHaveAttribute(
    "href",
    "https://docs.google.com/document/d/1hRNCfBXZsO6N9Mo7jpv_HQ2rF078AJUeuLHQPwOLxBY/edit?tab=t.0",
  );
  await expect(rideAlongs).toContainText("Make your own copy");
  await expect(rideAlongs).toContainText("Discord ticket");
  await page.getByRole("link", { name: "Full instructions" }).click();
  await expect(page).toHaveURL(/\/ride-alongs\/?$/);
  await expect(page.getByRole("heading", { level: 1, name: "Civilian ride-alongs" })).toBeVisible();
  await expect(page.getByText(/assigned officer.s Sergeant or higher/)).toBeVisible();
  await expect(page.getByText(/Never provide actual identity documents/)).toBeVisible();
});
