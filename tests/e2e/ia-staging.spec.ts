import { expect, test, type Page } from "@playwright/test";

/**
 * Internal Affairs in a real browser against a REAL Supabase staging stack (not stubs).
 *
 * The site is the fake-backend build (NEXT_PUBLIC_SUPABASE_URL=https://fakeproj.supabase.co); every request the browser
 * makes to that host is forwarded unchanged to the staging stack, with only the build's dummy anon key swapped for the
 * staging one. Sessions are real Supabase Auth sessions, so the database decides everything.
 *
 * Needs: E2E_STAGING_API (e.g. http://127.0.0.1:54321), E2E_STAGING_ANON_KEY, and the personas created by
 * tests/staging/ia-staging.mjs (run that first on a freshly reset staging database). Skipped otherwise, and reported
 * as skipped, never as passed.
 */
const API = process.env.E2E_STAGING_API ?? "";
const ANON = process.env.E2E_STAGING_ANON_KEY ?? "";
const BUILD_ANON = "fake-anon-key-for-e2e-only-000000";
const CLIENT_IP = `203.0.113.${Math.floor(Math.random() * 250) + 1}`;
test.skip(!API || !ANON, "needs a staging Supabase stack (E2E_STAGING_API, E2E_STAGING_ANON_KEY)");

async function viaStaging(page: Page) {
  await page.route("https://fakeproj.supabase.co/**", async (route) => {
    const req = route.request();
    const headers = { ...req.headers() };
    for (const h of ["apikey", "authorization"]) if (headers[h]?.includes(BUILD_ANON)) headers[h] = headers[h].replace(BUILD_ANON, ANON);
    // One simulated client address per test run, so the per-client intake limit (3/hour) does not carry over between runs.
    headers["cf-connecting-ip"] = CLIENT_IP;
    const url = req.url().replace("https://fakeproj.supabase.co", API);
    const res = await route.fetch({ url, headers }).catch(() => null);
    if (!res) return route.abort().catch(() => undefined); // page closed mid-request
    // Signed storage URLs come back with the stack's internal host; keep the browser on the proxied one.
    const body = (await res.body()).toString("utf8").replaceAll("http://kong:8000", "https://fakeproj.supabase.co");
    await route.fulfill({ response: res, body, headers: { ...res.headers(), "access-control-allow-origin": "*" } });
  });
}

async function signIn(page: Page, letter: string) {
  const res = await fetch(`${API}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: `staging-${letter}@example.test`, password: "staging-password-1" }),
  });
  const session = await res.json();
  expect(session.access_token, `staging persona ${letter} exists (run tests/staging/ia-staging.mjs first)`).toBeTruthy();
  await page.addInitScript((s) => localStorage.setItem("tpd-auth", JSON.stringify(s)), session);
}

let filed: { reference: string; token: string; caseNumber?: string } | null = null;
const SUMMARY = `Browser staging complaint ${Date.now().toString(36)}`;

test.describe.serial("Internal Affairs against staging", () => {
  test("an anonymous visitor files a complaint and checks its status", async ({ page }) => {
    await viaStaging(page);
    await page.goto("/report");
    await expect(page.getByText(/not connected on this site yet/)).toHaveCount(0);
    await page.getByLabel("Name or call sign (optional)").fill("X-422");
    await page.getByLabel("Category").selectOption({ label: "Conduct toward the public" });
    await page.getByLabel("Short summary").fill(SUMMARY);
    await page.getByLabel("Describe the allegation").fill("Filed from a real browser against the staging stack to verify intake end to end.");
    await page.getByText("Submit anonymously").click();
    await page.getByRole("button", { name: "Submit complaint" }).click();
    await expect(page.getByRole("heading", { name: "Save your tracking details now" })).toBeVisible({ timeout: 15_000 });
    const text = await page.locator("main").innerText();
    const reference = text.match(/TPD-[0-9A-Z]{4}-[0-9A-Z]{4}/)?.[0];
    const token = text.match(/[A-Za-z0-9_-]{43}/)?.[0];
    expect(reference).toBeTruthy();
    expect(token).toBeTruthy();
    filed = { reference: reference!, token: token! };
    // The receipt never shows the internal case number (only the public reference).
    expect(text).not.toMatch(/IA-20\d\d-\d{4}/);

    await page.goto("/report/status");
    await page.getByLabel("Case reference").fill(filed.reference);
    await page.getByLabel("Tracking code").fill(filed.token);
    await page.getByRole("button", { name: "Check status" }).click();
    await expect(page.getByText("Received", { exact: true })).toBeVisible();
    await page.getByLabel("Tracking code").fill("A".repeat(43));
    await page.getByRole("button", { name: "Check status" }).click();
    await expect(page.getByText("No complaint matches that reference and tracking code.")).toBeVisible();
  });

  for (const [letter, who] of [["h", "an officer"], ["j", "a sergeant"], ["l", "a lieutenant"], ["i", "a captain (command, not IA)"], ["m", "a major who is not X-201"]] as const) {
    test(`${who} has no Internal Affairs navigation and the case list is refused`, async ({ page }) => {
      await viaStaging(page);
      await signIn(page, letter);
      await page.goto("/hq");
      await expect(page.getByRole("navigation", { name: "Headquarters" })).toBeVisible({ timeout: 15_000 });
      await expect(page.getByRole("navigation", { name: "Headquarters" }).getByRole("link", { name: "Internal Affairs" })).toHaveCount(0);
      await expect(page.getByRole("navigation", { name: "Headquarters" }).getByRole("link", { name: "Report misconduct" })).toBeVisible();
      await page.goto("/hq/internal-affairs");
      await expect(page.getByRole("heading", { level: 1, name: "Restricted area" })).toBeVisible();
      await expect(page.getByText(/IA-20\d\d-\d{4}/)).toHaveCount(0);
      await expect(page.getByText(SUMMARY)).toHaveCount(0);
    });
  }

  test("an IA investigator sees the new complaint in the queue and can open it", async ({ page }) => {
    await viaStaging(page);
    await signIn(page, "f");
    await page.goto("/hq/internal-affairs");
    await expect(page.getByRole("heading", { level: 1, name: "Case management" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Design preview with fictional cases")).toHaveCount(0);
    const row = page.getByRole("row").filter({ hasText: SUMMARY });
    await expect(row).toHaveCount(1);
    await row.getByRole("link").first().click();
    await expect(page.getByRole("heading", { level: 1, name: /IA-20\d\d-\d{4}/ })).toBeVisible();
    await expect(page.getByText("Filed from a real browser against the staging stack")).toBeVisible();
  });

  test("the officer cannot open that case file by URL", async ({ page, browser }) => {
    await viaStaging(page);
    await signIn(page, "f");
    await page.goto("/hq/internal-affairs");
    const href = await page.getByRole("row").filter({ hasText: SUMMARY }).getByRole("link").first().getAttribute("href");
    expect(href).toContain("id=");
    await page.unrouteAll({ behavior: "ignoreErrors" });
    const ctx = await browser.newContext({ baseURL: test.info().project.use.baseURL });
    const officer = await ctx.newPage();
    await viaStaging(officer);
    await signIn(officer, "h");
    await officer.goto(href!);
    await expect(officer.getByRole("navigation", { name: "Headquarters" })).toBeVisible({ timeout: 15_000 });
    await expect(officer.getByText(SUMMARY)).toHaveCount(0);
    await expect(officer.getByText("Filed from a real browser against the staging stack")).toHaveCount(0);
    await officer.unrouteAll({ behavior: "ignoreErrors" });
    await ctx.close();
  });
});
