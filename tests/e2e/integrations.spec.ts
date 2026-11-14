import { expect, test } from "@playwright/test";

// Default build: no backend configured. Everything must say so; nothing may claim to be connected.
test.describe("without a backend", () => {
  test.skip(!!process.env.E2E_FAKE_BACKEND, "fake-backend build");

  test("sign-in explains that Discord sign-in is not configured", async ({ page }) => {
    await page.goto("/hq/sign-in");
    await expect(page.getByText("Sign-in is not configured yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign in with Discord" })).toHaveCount(0);
  });

  test("integrations panel shows honest statuses", async ({ page }) => {
    await page.goto("/hq/command/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toBeVisible();
    await expect(page.getByText("No backend is connected to this site")).toBeVisible();
    await expect(page.getByText("Not configured", { exact: true })).toHaveCount(3);
    await expect(page.getByText("Connected", { exact: true })).toHaveCount(0);
    await expect(page.getByText("Sync patrol time with CAD duty status")).toBeVisible();
  });
});

// Built with NEXT_PUBLIC_SUPABASE_URL=https://fakeproj.supabase.co and a dummy anon key;
// Supabase responses are stubbed in the browser to exercise each membership state.
test.describe("with a backend (stubbed)", () => {
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
  const member = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "A. Example",
    callsign: "X-425",
    rank: "Officer",
    appointment: "Patrol Bureau",
    tier: "Patrol Bureau",
    district: "North",
    timezone: null,
    status: "active",
    divisions: [{ division: "waterfront", callsign: "W-12", role: "Officer", title: "Waterfront Unit" }],
  };
  const directory = [
    { id: member.id, name: "A. Example", callsign: "X-425", rank: "Officer", appointment: "Patrol Bureau", tier: "Patrol Bureau", district: "North", status: "active" },
    { id: "22222222-2222-4222-8222-222222222222", name: "B. Captain", callsign: "X-309", rank: "Captain", appointment: "Waterfront Unit Commander", tier: "Division Command", district: null, status: "active" },
  ];
  const DEMO_NAMES = ["R. Delgado", "S. Lindqvist", "J. Abernathy", "M. Castellanos"];

  type Stub = { membership?: object | null; status?: number; directoryStatus?: number };
  async function as(page: import("@playwright/test").Page, membership: object | null, status = 200, extra: Omit<Stub, "membership" | "status"> = {}) {
    await page.route("https://fakeproj.supabase.co/**", (route) => {
      const url = route.request().url();
      if (url.includes("/rest/v1/rpc/my_membership")) return route.fulfill({ status, contentType: "application/json", body: JSON.stringify(membership) });
      // The directory is the list_member_directory RPC (the personnel_directory view was retired in 20261105071000).
      if (url.includes("/rest/v1/rpc/list_member_directory")) return route.fulfill({ status: extra.directoryStatus ?? 200, contentType: "application/json", body: JSON.stringify(extra.directoryStatus ? { message: "boom" } : directory) });
      if (url.includes("/rest/v1/division_slots")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ personnel_id: member.id, division_slug: "waterfront" }]) });
      if (url.includes("/auth/v1/user")) return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(session.user) });
      return route.fulfill({ status: 200, contentType: "application/json", body: "[]" });
    });
    await page.addInitScript((s) => localStorage.setItem("tpd-auth", JSON.stringify(s)), membership === null ? null : session);
  }
  const noDemo = async (page: import("@playwright/test").Page) => {
    for (const n of DEMO_NAMES) await expect(page.getByText(n)).toHaveCount(0);
    await expect(page.getByText(/demo personas/i)).toHaveCount(0);
    await expect(page.getByText("Design preview")).toHaveCount(0);
  };

  test("signed out: offers Discord sign-in", async ({ page }) => {
    await as(page, null);
    await page.addInitScript(() => localStorage.removeItem("tpd-auth"));
    await page.goto("/hq/sign-in");
    const authorize = page.waitForRequest((r) => r.url().includes("/auth/v1/authorize"));
    await page.getByRole("button", { name: "Sign in with Discord" }).click();
    const url = new URL((await authorize).url());
    expect(url.searchParams.get("provider")).toBe("discord");
    expect(url.searchParams.get("code_challenge_method")).toBe("s256");
    expect(url.searchParams.get("code_challenge")).toBeTruthy();
    expect(url.searchParams.get("scopes")).toBe("identify guilds.members.read");
    expect(url.searchParams.get("redirect_to")).toMatch(/\/hq\/auth\/callback\/$/);
  });

  test("signed out visitors reach no HQ page and never see demo personas", async ({ page }) => {
    await as(page, null);
    await page.addInitScript(() => localStorage.removeItem("tpd-auth"));
    for (const path of ["/hq", "/hq/patrol", "/hq/roster", "/hq/command", "/hq/command/integrations"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1, name: "Sign in to Headquarters" })).toBeVisible();
      await expect(page.getByRole("navigation", { name: "Quick navigation" })).toHaveCount(0);
      await noDemo(page);
    }
  });

  test("verified member sees their real record, the real directory and no demo data", async ({ page }) => {
    await as(page, { state: "verified", last_sync_at: "2026-11-04T01:00:00Z", member });
    await page.goto("/hq");
    await expect(page.getByRole("heading", { level: 1, name: /A\. Example/ })).toBeVisible();
    await expect(page.getByText("Waterfront Unit (W-12, Officer)")).toBeVisible();
    await expect(page.getByText("2015 Charger", { exact: true })).toBeVisible();
    await noDemo(page);
    await page.goto("/hq/roster");
    await expect(page.getByRole("heading", { level: 1, name: "Personnel" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /B\. Captain/ })).toBeVisible();
    await expect(page.getByRole("cell", { name: "X-309" })).toBeVisible();
    await expect(page.getByText("Waterfront Unit", { exact: true }).first()).toBeVisible();
    await noDemo(page);
    // Directory figures are the stubbed rows only: no 14-person demo roster.
    await expect(page.getByText("Verified roster · 2 active")).toBeVisible();
    await page.goto("/hq/divisions/waterfront");
    await expect(page.getByText("Your division")).toBeVisible();
    await expect(page.getByText("Applications are not connected yet")).toBeVisible();
  });

  test("identity is consistent across the dashboard, directory and account menu", async ({ page }) => {
    await as(page, { state: "verified", member });
    await page.goto("/hq");
    await expect(page.getByRole("button", { name: "Account: A. Example" })).toBeVisible();
    await expect(page.getByText("X-425").first()).toBeVisible();
    await page.goto("/hq/roster");
    await expect(page.getByRole("button", { name: "Account: A. Example" })).toBeVisible();
    await expect(page.getByRole("cell", { name: /A\. Example/ })).toBeVisible();
  });

  // Every workspace now has a server record (patrol, requests, training, supervisor reviews), so none shows the
  // "not connected" page any more. What must still hold: live mode never falls back to the browser-local demo store.
  test("live workspaces never fall back to demo data or the browser-local store", async ({ page }) => {
    await as(page, { state: "verified", member });
    for (const path of ["/hq/patrol", "/hq/requests", "/hq/activity", "/hq/training", "/hq/supervisor"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Sign in to Headquarters" })).toHaveCount(0);
      await noDemo(page);
    }
    await expect(page.evaluate(() => localStorage.getItem("tpd-preview-state"))).resolves.toBeNull();
  });

  test("demo member profile URLs show nothing in live mode", async ({ page }) => {
    await as(page, { state: "verified", member });
    await page.goto("/hq/roster/m-07");
    await noDemo(page);
    await expect(page.getByText("Senior Officer")).toHaveCount(0);
    await expect(page.getByText("This member is not on the roster.")).toBeVisible();
  });

  test("session is restored after a refresh", async ({ page }) => {
    await as(page, { state: "verified", member });
    await page.goto("/hq/roster");
    await expect(page.getByRole("heading", { level: 1, name: "Personnel" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("heading", { level: 1, name: "Personnel" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Account: A. Example" })).toBeVisible();
  });

  test("unrecognized user gets an explanation and no access", async ({ page }) => {
    await as(page, { state: "unrecognized", last_sync_at: "2026-11-04T01:00:00Z" });
    await page.goto("/hq/sign-in");
    await expect(page.getByText("Not on the roster")).toBeVisible();
    await page.goto("/hq/roster");
    await expect(page.getByText("Not on the roster")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Personnel" })).toHaveCount(0);
    await page.goto("/hq/command/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toHaveCount(0);
  });

  test("removed (former) and inactive members are shut out", async ({ page }) => {
    for (const [state, title] of [["former", "No longer on the roster"], ["inactive", "Access paused"]] as const) {
      await page.unrouteAll();
      await as(page, { state, member, last_sync_at: "2026-11-04T01:00:00Z" });
      await page.goto("/hq/roster");
      await expect(page.getByText(title)).toBeVisible();
      await expect(page.getByRole("heading", { level: 1, name: "Personnel" })).toHaveCount(0);
    }
  });

  test("an expired or invalid session ends cleanly instead of showing HQ", async ({ page }) => {
    await as(page, { code: "PGRST301", message: "JWT expired" }, 401);
    await page.goto("/hq/roster");
    await expect(page.getByRole("heading", { level: 1, name: "Sign in to Headquarters" })).toBeVisible();
    await expect(page.getByText("Your session has ended. Sign in again.")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Personnel" })).toHaveCount(0);
  });

  test("a forged 'verified' response with an invalid rank is not trusted", async ({ page }) => {
    await as(page, { state: "verified", member: { ...member, rank: "Supreme Commander" } });
    await page.goto("/hq/sign-in");
    await expect(page.getByText("Verification unavailable")).toBeVisible();
    await page.goto("/hq/roster");
    await expect(page.getByRole("heading", { level: 1, name: "Personnel" })).toHaveCount(0);
  });

  test("a roster outage grants nothing", async ({ page }) => {
    await as(page, { message: "boom" }, 503);
    await page.goto("/hq/sign-in");
    await expect(page.getByText("Verification unavailable")).toBeVisible();
    await page.goto("/hq/command/integrations");
    await expect(page.getByRole("heading", { level: 1, name: "Integrations" })).toHaveCount(0);
  });

  test("if the directory cannot be loaded, HQ stays closed and does not fall back to demo data", async ({ page }) => {
    await as(page, { state: "verified", member }, 200, { directoryStatus: 403 });
    await page.goto("/hq");
    await expect(page.getByText("The roster could not be loaded")).toBeVisible();
    await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
    await noDemo(page);
    await expect(page.getByRole("navigation", { name: "Quick navigation" })).toHaveCount(0);
  });

  test("Command Center: an officer is refused, a Captain gets in without demo data", async ({ page }) => {
    await as(page, { state: "verified", member });
    await page.goto("/hq/command");
    await expect(page.getByText("Access restricted")).toBeVisible();
    await expect(page.getByText("Captain+ authorization required.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Command Center" })).toHaveCount(0);
    await page.goto("/hq/command/integrations");
    await expect(page.getByText("Command access required")).toBeVisible();
    await page.unrouteAll();
    await as(page, { state: "verified", member: { ...member, id: directory[1].id, name: "B. Captain", rank: "Captain", callsign: "X-309", district: null } });
    await page.goto("/hq/command");
    await expect(page.getByRole("heading", { level: 1, name: "Command Center" })).toBeVisible();
    // The report itself comes from tpd.command_operational_report (stubbed empty here); the page must not invent figures.
    await expect(page.getByText("Access restricted")).toHaveCount(0);
    await noDemo(page);
    await page.goto("/hq/command/integrations");
    await expect(page.getByRole("button", { name: "Run health checks" })).toBeVisible();
    await expect(page.getByText("Connected", { exact: true })).toHaveCount(0);
  });
});
