import { expect, test, type Page } from "@playwright/test";
import { asRole, type Role } from "./helpers";

/*
 * Release rehearsal: one report travels through every role without resetting the preview data.
 * Sergeant files with an award recommendation (after a saved draft), the Lieutenant on leave sees excused days,
 * a Captain assigns a day, excuses one and endorses the award, and the Office of the Chiefs approves it and marks
 * the report reviewed, which locks the Sergeant's amendment.
 */

async function switchTo(page: Page, role: Role, path: string) {
  await page.evaluate((r) => {
    const s = JSON.parse(localStorage.getItem("tpd-preview-state")!);
    s.role = r;
    localStorage.setItem("tpd-preview-state", JSON.stringify(s));
  }, role);
  await page.goto(path);
  await expect(page.locator("main")).not.toBeEmpty();
}

async function addOfficer(page: Page, query: string) {
  const picker = page.getByRole("combobox", { name: /officer/i });
  await picker.fill(query);
  await expect(page.getByRole("listbox", { name: "Eligible officers" }).getByRole("option", { name: new RegExp(query) })).toHaveAttribute("aria-selected", "true");
  await picker.press("Enter");
}

test("an evaluation moves from Sergeant to Captain to the Office of the Chiefs", async ({ page }) => {
  test.setTimeout(90_000);

  // Sergeant: draft first, then submit with an award recommendation.
  await asRole(page, "supervisor", "/hq/evaluations");
  await page.getByRole("button", { name: /^Today ·/ }).click();
  await addOfficer(page, "Fontaine");
  const entry = page.getByRole("form", { name: "Daily patrol evaluation" }).locator("ol > li").first();
  await entry.getByText("Recommended for Award or Medal").click();
  await entry.getByPlaceholder("Name of the award or medal").fill("Medal of Valor");
  await entry.getByRole("textbox").last().fill("Pulled a driver from a burning vehicle on the Howard Frankland Bridge.");
  await page.getByRole("button", { name: "Save draft" }).click();
  await expect(page.getByText(/Draft saved/)).toBeVisible();
  await page.reload();
  await page.getByRole("button", { name: /^Today ·/ }).click();
  await expect(page.getByRole("button", { name: /^Today ·.*Draft/ })).toBeVisible();
  await expect(page.getByText("C. Fontaine")).toBeVisible();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Submitted with 1 observation")).toBeVisible();

  // Lieutenant on approved leave: those days are excused, and command review stays closed.
  await switchTo(page, "lieutenant", "/hq/evaluations");
  await expect(page.getByText("Excused").first()).toBeVisible();
  await switchTo(page, "lieutenant", "/hq/command/evaluations");
  await expect(page.getByRole("heading", { name: "Evaluation review is restricted" })).toBeVisible();

  // Captain: assign a day, excuse an overdue day, endorse the award, but cannot give final approval.
  await switchTo(page, "captain", "/hq/command/evaluations");
  await page.getByRole("button", { name: "Assign patrol days" }).click();
  const assign = page.getByRole("dialog", { name: "Assign patrol days" });
  await assign.getByLabel("Supervisor").selectOption({ label: "Sergeant E. Varga · X-501" });
  await assign.getByRole("button", { name: /^Assign 1 day$/ }).click();
  await expect(assign).toHaveCount(0);

  const table = page.getByRole("table", { name: "Reporting obligations" });
  await page.getByLabel("Filter by status").selectOption("overdue");
  const overdueBefore = await table.locator("tbody tr").count();
  await table.locator("tbody tr").first().getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: /Excuse this day/ }).click();
  const excuse = page.getByRole("dialog", { name: "Excuse this reporting day" });
  await excuse.getByLabel("Reason").fill("Court appearance approved by the watch commander.");
  await excuse.getByRole("button", { name: "Excuse day" }).click();
  await expect(table.locator("tbody tr")).toHaveCount(overdueBefore - 1);

  await page.getByRole("tab", { name: "Review" }).click();
  await page.getByRole("button", { name: /C\. Fontaine \(Award\)/ }).first().click();
  let sheet = page.getByRole("dialog").first();
  await expect(sheet.getByText("Medal of Valor")).toBeVisible();
  await sheet.getByRole("button", { name: "Endorse" }).click();
  const endorse = page.getByRole("dialog", { name: /Endorse award for C\. Fontaine/ });
  await endorse.getByLabel("Reason").fill("Act of bravery well beyond routine duty.");
  await endorse.getByRole("button", { name: "Endorse award" }).click();
  await expect(sheet.getByText(/Endorsed by Captain P\. Moreau/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Approve award" })).toHaveCount(0);

  // Office of the Chiefs: final approval by a different person, then mark the report reviewed.
  await switchTo(page, "chief", "/hq/command/evaluations");
  await page.getByRole("tab", { name: "Review" }).click();
  await page.getByRole("button", { name: /C\. Fontaine \(Award\)/ }).first().click();
  sheet = page.getByRole("dialog").first();
  await sheet.getByRole("button", { name: "Approve award" }).click();
  const approve = page.getByRole("dialog", { name: /Approve award for C\. Fontaine/ });
  await approve.getByLabel("Reason").fill("Approved for the Medal of Valor at the next ceremony.");
  await approve.getByRole("button", { name: "Approve award" }).click();
  await expect(sheet.getByText(/Approved by Chief of Police A\. Whitfield/)).toBeVisible();
  // The audit history keeps both decisions with names.
  await expect(sheet.getByText(/Endorsed by Captain P\. Moreau/)).toBeVisible();
  await sheet.getByRole("button", { name: "Mark reviewed" }).click();
  const reviewed = page.getByRole("dialog", { name: "Mark reviewed" });
  await reviewed.getByLabel("Reason").fill("Reviewed at the weekly command meeting.");
  await reviewed.getByRole("button", { name: "Mark reviewed" }).click();
  await expect(reviewed).toHaveCount(0);

  // Command staff do not file reports.
  await switchTo(page, "chief", "/hq/evaluations");
  await expect(page.getByRole("heading", { name: /filed by Sergeants and Lieutenants/ })).toBeVisible();

  // Sergeant: the reviewed report is locked against amendment.
  await switchTo(page, "supervisor", "/hq/evaluations");
  await page.getByRole("button", { name: /^Today ·/ }).click();
  await expect(page.getByText("Submitted with 1 observation")).toBeVisible();
  await expect(page.getByRole("button", { name: "Amend report" })).toHaveCount(0);
});
