import { expect, test, type Page } from "@playwright/test";
import { asRole } from "./helpers";

/*
 * Daily Patrol Evaluation (design preview store). Server-side rules are covered by supabase/tests/dpe.test.sql;
 * these tests cover the screens and the preview store that mirrors those rules.
 */

const CAT = {
  exceeding: "Exceeding Expectations",
  needs: "Struggling / Needs Improvement",
  award: "Recommended for Award or Medal",
};

async function addOfficer(page: Page, query: string) {
  const picker = page.getByRole("combobox", { name: /officer/i });
  await picker.fill(query);
  // Keyboard selection: the first match is active, Enter adds it.
  await expect(page.getByRole("listbox", { name: "Eligible officers" }).getByRole("option", { name: new RegExp(query) })).toHaveAttribute("aria-selected", "true");
  await picker.press("Enter");
}

test("a Sergeant files a no-observations report in two actions", async ({ page }) => {
  await asRole(page, "supervisor", "/hq/evaluations");
  const form = page.getByRole("form", { name: "Daily patrol evaluation" });
  // Supervisor details come from the signed-in profile.
  await expect(page.getByText("Sergeant J. Abernathy").first()).toBeVisible();
  await expect(page.getByText("X-401").first()).toBeVisible();

  await form.getByRole("checkbox", { name: /No notable observations/ }).check();
  await page.getByRole("button", { name: "Submit report" }).click();

  await expect(page.getByText("Submitted: no notable observations")).toBeVisible();
  // The oldest open day was overdue, so the submission is accepted and marked late.
  await expect(page.getByRole("list").getByRole("button", { name: /Submitted late/ })).toHaveCount(1);
});

test("a full report needs a justification per officer and records an award", async ({ page }) => {
  await asRole(page, "supervisor", "/hq/evaluations");
  await page.getByRole("button", { name: /^Today ·/ }).click();

  await addOfficer(page, "Brennan");
  await addOfficer(page, "Adeyemi");
  await addOfficer(page, "Fontaine");
  const entries = page.getByRole("form", { name: "Daily patrol evaluation" }).locator("ol > li");
  await expect(entries).toHaveCount(3);
  await entries.nth(1).getByText(CAT.needs).click();
  await entries.nth(2).getByText(CAT.award).click();

  // The no-observations option is locked while officers are listed.
  await expect(page.getByRole("checkbox", { name: /No notable observations/ })).toBeDisabled();

  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByRole("alert").filter({ hasText: /justification/i }).first()).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: /award/i }).first()).toBeVisible();

  await entries.nth(0).getByRole("textbox").last().fill("Handled a felony stop calmly and briefed responding units.");
  await entries.nth(1).getByRole("textbox").last().fill("Radio updates during the pursuit were unclear; coached afterwards.");
  await entries.nth(2).getByPlaceholder("Name of the award or medal").fill("Lifesaving recognition");
  await entries.nth(2).getByRole("textbox").last().fill("Rendered first aid at a rollover before Fire Rescue arrived.");
  await page.getByRole("button", { name: "Submit report" }).click();

  await expect(page.getByText("Submitted with 3 observations")).toBeVisible();
  await expect(page.getByText("Lifesaving recognition").first()).toBeVisible();
});

test("a second submission for the same day is rejected", async ({ page, context }) => {
  await asRole(page, "supervisor", "/hq/evaluations");
  const other = await context.newPage();
  await other.goto("/hq/evaluations");
  for (const p of [page, other]) await p.getByRole("checkbox", { name: /No notable observations/ }).check();

  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Submitted: no notable observations")).toBeVisible();

  await other.getByRole("button", { name: "Submit report" }).click();
  await expect(other.getByText(/already (been )?submitted/i).first()).toBeVisible();
});

test("amending a report requires a reason and keeps the original version", async ({ page }) => {
  await asRole(page, "supervisor", "/hq/evaluations");
  await page.getByRole("checkbox", { name: /No notable observations/ }).check();
  await page.getByRole("button", { name: "Submit report" }).click();
  await page.getByRole("button", { name: "Amend report" }).click();

  const form = page.getByRole("form", { name: "Amend daily patrol evaluation" });
  await form.getByRole("checkbox", { name: /No notable observations/ }).uncheck();
  await addOfficer(page, "Brennan");
  await form.locator("ol > li").first().getByRole("textbox").last().fill("Took over scene command at a multi-vehicle collision.");
  await page.getByRole("button", { name: "Submit amendment" }).click();
  await expect(page.locator("#dpe-errors").getByText(/Explain the amendment/)).toBeVisible();

  await form.getByPlaceholder("What you corrected and why").fill("Forgot to record Officer Brennan's scene work.");
  await page.getByRole("button", { name: "Submit amendment" }).click();
  await expect(page.getByText("Submitted with 1 observation")).toBeVisible();
  await expect(page.getByText(/Version 1 · Submitted/)).toBeVisible();
  await expect(page.getByText(/Version 2 · Amended/)).toBeVisible();
});

test("a Lieutenant on approved leave sees those days excused", async ({ page }) => {
  await asRole(page, "lieutenant", "/hq/evaluations");
  await expect(page.getByRole("heading", { name: "Daily patrol evaluation" })).toBeVisible();
  await expect(page.getByText("Excused").first()).toBeVisible();
});

test("officers and command cannot open the supervisor form; officers cannot open command review", async ({ page }) => {
  await asRole(page, "officer", "/hq/evaluations");
  await expect(page.getByRole("heading", { name: /filed by Sergeants and Lieutenants/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit report" })).toHaveCount(0);

  await asRole(page, "officer", "/hq/command/evaluations");
  await expect(page.getByRole("heading", { name: "Evaluation review is restricted" })).toBeVisible();

  await asRole(page, "supervisor", "/hq/command/evaluations");
  await expect(page.getByRole("heading", { name: "Evaluation review is restricted" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Daily evaluation" })).toBeVisible();
});

test("command sees overdue reports and can excuse a day with a reason", async ({ page }) => {
  await asRole(page, "command", "/hq/command/evaluations");
  const table = page.getByRole("table", { name: "Reporting obligations" });
  await page.getByLabel("Filter by status").selectOption("overdue");
  const rows = table.locator("tbody tr");
  const before = await rows.count();
  expect(before).toBeGreaterThan(0);

  await rows.first().getByRole("button", { name: /Actions for/ }).click();
  await page.getByRole("menuitem", { name: /Excuse this day/ }).click();
  const dialog = page.getByRole("dialog", { name: "Excuse this reporting day" });
  await expect(dialog.getByRole("button", { name: "Excuse day" })).toBeDisabled();
  await dialog.getByLabel("Reason").fill("Pulled to a court appearance by command.");
  await dialog.getByRole("button", { name: "Excuse day" }).click();

  await expect(rows).toHaveCount(before - 1);
  await page.getByLabel("Filter by status").selectOption("excused");
  await expect(table.getByText("Pulled to a court appearance by command.")).toBeVisible();
});

test("award recommendations need endorsement then Office of the Chiefs approval", async ({ page }) => {
  await asRole(page, "command", "/hq/command/evaluations");
  await page.getByRole("tab", { name: "Review" }).click();
  await page.getByRole("button", { name: /C\. Fontaine \(Award\)/ }).click();
  const sheet = page.getByRole("dialog").first();

  await sheet.getByRole("button", { name: "Endorse" }).click();
  const confirm = page.getByRole("dialog", { name: /Endorse award for C\. Fontaine/ });
  await confirm.getByLabel("Reason").fill("Aid before Fire Rescue arrived is exactly what the award recognises.");
  await confirm.getByRole("button", { name: "Endorse award" }).click();

  await expect(sheet.getByText(/Endorsed by Major/)).toBeVisible();
  // A Major is not the award authority (interim PC-35), so final approval is not offered.
  await expect(sheet.getByText(/Awaiting final approval by the Office of the Chiefs/)).toBeVisible();
  await expect(sheet.getByRole("button", { name: "Approve award" })).toHaveCount(0);

  // Concerns can be referred without becoming a disciplinary finding.
  await sheet.getByRole("button", { name: "Refer to chain of command" }).click();
  const refer = page.getByRole("dialog", { name: /Refer H\. Adeyemi/ });
  await expect(refer.getByText(/not a disciplinary finding/)).toBeVisible();
  await refer.getByLabel("Reason").fill("Second radio-discipline observation this month.");
  await refer.getByRole("button", { name: /^Refer/ }).click();
  await expect(sheet.getByText(/Referred to chain of command by Major/)).toBeVisible();
});
