import { expect, test, type Page, type Request } from "@playwright/test";

/*
 * Live mode against a stubbed Supabase (same build as integrations.spec.ts: NEXT_PUBLIC_SUPABASE_URL=https://fakeproj.supabase.co,
 * a dummy anon key, E2E_FAKE_BACKEND=1). Checks that the evaluation screens call the real RPCs with the right arguments,
 * map their responses, and never fall back to demo data. Server-side rules are covered by supabase/tests/dpe.test.sql.
 */
test.skip(!process.env.E2E_FAKE_BACKEND, "needs the fake-backend build");

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jwt = `${b64({ alg: "HS256", typ: "JWT" })}.${b64({ sub: "00000000-0000-0000-0000-0000000000aa", exp: 4102444800, role: "authenticated" })}.sig`;
const session = {
  access_token: jwt,
  refresh_token: "r",
  token_type: "bearer",
  expires_in: 3600,
  expires_at: 4102444800,
  user: { id: "00000000-0000-0000-0000-0000000000aa", aud: "authenticated", role: "authenticated", app_metadata: { provider: "discord" }, user_metadata: {}, created_at: "2026-11-04T00:00:00Z" },
};
const person = (rank: string, name: string, callsign: string) => ({
  id: "11111111-1111-4111-8111-111111111111",
  name,
  callsign,
  rank,
  appointment: "Test",
  tier: "Test",
  district: "North",
  timezone: null,
  status: "active",
  divisions: [],
});

const TODAY = "2026-11-12";
const settings = { timezone: "America/New_York", day_start: "04:00:00", deadline_day_offset: 1, deadline_time: "20:00:00", min_patrol_minutes: 15, amend_window_days: 7, interim: true };
const row = (over: Record<string, unknown> = {}) => ({
  obligation_id: "o-1",
  supervisor_id: "11111111-1111-4111-8111-111111111111",
  supervisor_name: "Q. Sergeant",
  supervisor_rank: "Sergeant",
  supervisor_callsign: "X-450",
  patrol_date: TODAY,
  source: "assignment",
  status: "not_started",
  deadline: "2026-11-14T01:00:00Z",
  day_start: "2026-11-12T09:00:00Z",
  report_id: null,
  report_status: null,
  no_observations: false,
  entry_count: 0,
  submitted_at: null,
  first_submitted_at: null,
  late: false,
  version: 0,
  reviewed_at: null,
  excuse_reason: null,
  ...over,
});
const submittedReport = {
  id: "r-1",
  supervisor_id: "11111111-1111-4111-8111-111111111111",
  patrol_date: TODAY,
  status: "submitted",
  no_observations: true,
  version: 1,
  author_name: "Q. Sergeant",
  author_rank: "Sergeant",
  author_callsign: "X-450",
  first_submitted_at: "2026-11-12T22:00:00Z",
  submitted_at: "2026-11-12T22:00:00Z",
  late: false,
  reopened_at: null,
  reviewed_at: null,
  dpe_entries: [],
};

async function live(page: Page, member: object, onRpc: (name: string, req: Request) => unknown) {
  await page.route("https://fakeproj.supabase.co/**", async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
    if (url.pathname.endsWith("/rpc/my_membership")) return json({ state: "verified", last_sync_at: "2026-11-12T01:00:00Z", member });
    if (url.pathname.includes("/auth/v1/user")) return json(session.user);
    const rpc = url.pathname.match(/\/rest\/v1\/rpc\/(\w+)$/)?.[1];
    if (rpc) {
      const out = onRpc(rpc, req);
      return json(out === undefined ? [] : out);
    }
    const table = url.pathname.match(/\/rest\/v1\/(\w+)$/)?.[1];
    if (table) {
      const out = onRpc(`table:${table}`, req);
      return json(out === undefined ? [] : out);
    }
    return json([]);
  });
  await page.addInitScript((s) => localStorage.setItem("tpd-auth", JSON.stringify(s)), session);
}

test("live: a Sergeant files a no-observations report through dpe_save_report", async ({ page }) => {
  let saved: Record<string, unknown> | null = null;
  const calls: string[] = [];
  await live(page, person("Sergeant", "Q. Sergeant", "X-450"), (name, req) => {
    calls.push(name);
    if (name === "dpe_my_overview")
      return { required: true, today: TODAY, now: "2026-11-12T22:00:00Z", settings, supervisor: { id: "11111111-1111-4111-8111-111111111111", name: "Q. Sergeant", rank: "Sergeant", callsign: "X-450" }, today_minutes: 0, rows: [row(saved ? { status: "submitted", report_id: "r-1", report_status: "submitted", no_observations: true, version: 1, submitted_at: "2026-11-12T22:00:00Z" } : {})] };
    if (name === "dpe_eligible_officers") return [{ id: "o-9", name: "L. Officer", callsign: "X-499", rank: "Officer", district: "North", patrolled: true }];
    if (name === "dpe_save_report") {
      saved = req.postDataJSON();
      return { report_id: "r-1", status: "submitted", version: 1, late: false };
    }
    if (name === "table:dpe_reports") return saved ? [submittedReport] : [];
    return undefined;
  });

  await page.goto("/hq/evaluations");
  await expect(page.getByRole("heading", { level: 1, name: "Daily patrol evaluation" })).toBeVisible();
  await expect(page.getByText("Sergeant Q. Sergeant").first()).toBeVisible();
  await expect(page.getByText("X-450").first()).toBeVisible();
  await expect(page.getByText(/demo personas/i)).toHaveCount(0);

  await page.getByRole("checkbox", { name: /No notable observations/ }).check();
  await page.getByRole("button", { name: "Submit report" }).click();
  await expect(page.getByText("Submitted: no notable observations")).toBeVisible();
  expect(saved).toEqual({ p_patrol_date: TODAY, p_mode: "submit", p_no_observations: true, p_entries: [], p_reason: null });
  expect(calls).toContain("dpe_eligible_officers");
});

test("live: an Officer gets no evaluation page and no evaluation data is requested", async ({ page }) => {
  const calls: string[] = [];
  await live(page, person("Officer", "R. Officer", "X-498"), (name) => {
    calls.push(name);
    return undefined;
  });
  await page.goto("/hq/evaluations");
  await expect(page.getByRole("heading", { name: /filed by Sergeants and Lieutenants/ })).toBeVisible();
  await page.goto("/hq/command/evaluations");
  await expect(page.getByRole("heading", { name: "Evaluation review is restricted" })).toBeVisible();
  expect(calls.filter((c) => c.startsWith("dpe_") || c.startsWith("table:dpe_"))).toEqual([]);
});

test("live: a Captain sees compliance from dpe_compliance", async ({ page }) => {
  let range: Record<string, unknown> | null = null;
  await live(page, person("Captain", "C. Captain", "X-309"), (name, req) => {
    if (name === "dpe_compliance") {
      range = req.postDataJSON();
      return { now: "2026-11-12T22:00:00Z", today: TODAY, rows: [row({ status: "overdue", patrol_date: "2026-11-10" }), row({ obligation_id: "o-2", status: "excused", excuse_reason: "Approved leave of absence" })] };
    }
    return undefined;
  });
  await page.goto("/hq/command/evaluations");
  const table = page.getByRole("table", { name: "Reporting obligations" });
  await expect(table.getByText("Overdue")).toBeVisible();
  await expect(table.getByText("Approved leave of absence")).toBeVisible();
  expect(range).toMatchObject({ p_to: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), p_from: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) });
});
