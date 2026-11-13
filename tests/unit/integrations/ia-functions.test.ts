/**
 * Internal Affairs Edge Functions at the HTTP level. Real Request objects go through the real handlers;
 * only the network (Supabase Auth, PostgREST, Storage) is faked.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { iaIntakeHandler } from "../../../supabase/functions/_shared/fn-ia-intake.ts";
import { iaEvidenceHandler } from "../../../supabase/functions/_shared/fn-ia-evidence.ts";
import { clientKey, isHttpsLink, newTrackingToken, sniffMime, TOKEN_PATTERN, validateComplaint } from "../../../supabase/functions/_shared/ia.ts";

const URL_ = "https://proj.supabase.test";
const ANON = "anon-key-for-tests-0000000000";
const SERVICE = "service-key-for-tests";
const PEPPER = "pepper-for-tests-0123456789abcdef0123456789";
const CASE = "11111111-1111-4111-8111-111111111111";
const EVIDENCE = "22222222-2222-4222-8222-222222222222";
const OFFICER = "33333333-3333-4333-8333-333333333333";

const env = (over: Record<string, string | undefined> = {}) => {
  const e: Record<string, string | undefined> = { SUPABASE_URL: URL_, SUPABASE_ANON_KEY: ANON, SUPABASE_SERVICE_ROLE_KEY: SERVICE, IA_INTAKE_PEPPER: PEPPER, ALLOWED_ORIGINS: "https://site.test", ...over };
  return { get: (k: string) => e[k] };
};

const USERS: Record<string, string> = { "member-token": "u-member", "ia-token": "u-ia", "outsider-token": "u-outsider" };

interface Call { url: string; key: string; auth: string; body: unknown }
let calls: Call[] = [];
let rpcResult: (fn: string, body: Record<string, unknown>, auth: string) => Response;
const ok = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
const rpcCalls = (fn: string) => calls.filter((c) => c.url.endsWith(`/rpc/${fn}`));

beforeEach(() => {
  calls = [];
  rpcResult = (fn, body, auth) => {
    if (fn === "ia_intake_submit") return ok({ case_id: CASE, reference: "TPD-7KQ3-M9PX" });
    if (fn === "ia_intake_attach") return ok(EVIDENCE);
    if (fn === "ia_receipt_status") return ok({ found: true, status: "under_review", reference: body.p_reference });
    if (fn === "ia_evidence_upload_check") return auth === "ia-token" ? ok(true) : ok({ code: "42501", message: "Case unavailable" }, 403);
    if (fn === "ia_evidence_staff_attach") return ok(EVIDENCE);
    if (fn === "ia_evidence_download_check") return auth === "ia-token" ? ok(`cases/${CASE}/file.png`) : ok({ code: "42501", message: "Evidence unavailable" }, 403);
    return ok({ message: "unexpected" }, 500);
  };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const h = new Headers(init?.headers);
      const key = h.get("apikey") ?? "";
      const auth = (h.get("authorization") ?? "").replace(/^Bearer /, "");
      let body: unknown = init?.body;
      if (typeof body === "string") {
        try {
          body = JSON.parse(body);
        } catch {
          /* raw */
        }
      }
      calls.push({ url, key, auth, body });
      if (url === `${URL_}/auth/v1/user`) return USERS[auth] ? ok({ id: USERS[auth] }) : ok({ msg: "invalid JWT" }, 401);
      if (url.startsWith(`${URL_}/rest/v1/rpc/`)) return rpcResult(url.split("/rpc/")[1], body as Record<string, unknown>, auth);
      if (url.startsWith(`${URL_}/storage/v1/object/sign/`)) return ok({ signedURL: "/object/sign/tpd-ia-evidence/x?token=t" });
      if (url.startsWith(`${URL_}/storage/v1/object/`)) return ok({ Key: "ok" });
      if (url.startsWith("https://challenges.cloudflare.com/")) return ok({ success: String((body as URLSearchParams)?.toString?.() ?? "").includes("response=good") });
      return new Response("unexpected upstream call: " + url, { status: 500 });
    }),
  );
});
afterEach(() => vi.unstubAllGlobals());

const complaint = (over: Record<string, unknown> = {}) => ({
  action: "submit",
  category: "public_conduct",
  summary: "Rude during a traffic stop",
  description: "The officer swore at me repeatedly during a traffic stop near the pier.",
  officer: "X-422",
  anonymous: false,
  name: "Pat",
  contact: "pat#0001",
  ...over,
});

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("https://fn.test/ia-intake", { method: "POST", headers: { "content-type": "application/json", origin: "https://site.test", "x-forwarded-for": "203.0.113.9", ...headers }, body: JSON.stringify(body) });

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe("intake validation (shared with the form)", () => {
  it("accepts a complete complaint and drops identity when anonymous", () => {
    const r = validateComplaint({ ...complaint(), anonymous: true });
    expect(r.ok).toBe(true);
    if (r.ok) expect([r.value.name, r.value.contact]).toEqual([null, null]);
  });
  it("rejects bad categories, short descriptions, future dates, bad links and control characters", () => {
    const today = new Date("2026-11-13T12:00:00Z");
    const r = validateComplaint(
      { category: "nope", summary: "ok", description: "short", incidentDate: "2027-01-01", evidenceLinks: ["http://x.test"], location: "a\u0007b", anonymous: false },
      today,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(Object.keys(r.errors).sort()).toEqual(["category", "description", "evidenceLinks", "incidentDate", "location", "summary"]);
  });
  it("only accepts https links without credentials", () => {
    expect(isHttpsLink("https://medal.tv/clip/1")).toBe(true);
    expect(isHttpsLink("javascript:alert(1)")).toBe(false);
    expect(isHttpsLink("https://user:pw@evil.test")).toBe(false);
    expect(isHttpsLink("http://plain.test")).toBe(false);
  });
  it("detects file types by content", () => {
    expect(sniffMime(PNG)).toBe("image/png");
    expect(sniffMime(new TextEncoder().encode("%PDF-1.7"))).toBe("application/pdf");
    expect(sniffMime(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffMime(new TextEncoder().encode("MZ executable"))).toBeNull();
  });
  it("makes unguessable tokens and keyed address hashes", async () => {
    const a = newTrackingToken();
    expect(TOKEN_PATTERN.test(a)).toBe(true);
    expect(a).not.toBe(newTrackingToken());
    const k = await clientKey(PEPPER, "203.0.113.9");
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(k).not.toBe(await clientKey("another-pepper-0123456789abcdef0123", "203.0.113.9"));
  });
});

describe("ia-intake", () => {
  const h = () => iaIntakeHandler(env());

  it("accepts a public complaint, returns a reference and a one-time token, stores only the token hash", async () => {
    const res = await h()(post(complaint()));
    expect(res.status).toBe(201);
    const b = await res.json();
    expect(b.reference).toBe("TPD-7KQ3-M9PX");
    expect(TOKEN_PATTERN.test(b.token)).toBe(true);
    const sent = rpcCalls("ia_intake_submit")[0];
    expect(sent.key).toBe(SERVICE);
    const args = sent.body as Record<string, unknown>;
    expect(args.p_user).toBeNull();
    expect(String(args.p_token_hash)).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(JSON.stringify(args)).not.toContain(b.token);
    expect(JSON.stringify(args)).not.toContain("203.0.113.9");
    expect(String(args.p_client_key)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never lets a public caller link a personnel record or mark a referral", async () => {
    await h()(post(complaint({ officerId: OFFICER, referral: true })));
    const p = (rpcCalls("ia_intake_submit")[0].body as { p: Record<string, unknown> }).p;
    expect(p.officerId).toBeNull();
    expect(p.referral).toBe(false);
  });

  it("verifies a member's session and passes only the verified user id", async () => {
    const res = await h()(post(complaint({ officerId: OFFICER }), { authorization: "Bearer member-token" }));
    expect(res.status).toBe(201);
    const args = rpcCalls("ia_intake_submit")[0].body as Record<string, unknown>;
    expect(args.p_user).toBe("u-member");
    expect((args.p as Record<string, unknown>).officerId).toBe(OFFICER);
  });

  it("treats the anon key as a public caller and refuses an invalid session without saving", async () => {
    expect((await h()(post(complaint(), { authorization: `Bearer ${ANON}` }))).status).toBe(201);
    calls = [];
    const res = await h()(post(complaint(), { authorization: "Bearer expired-token" }));
    expect(res.status).toBe(401);
    expect(rpcCalls("ia_intake_submit")).toHaveLength(0);
  });

  it("returns field errors without calling the database", async () => {
    const res = await h()(post(complaint({ description: "too short" })));
    expect(res.status).toBe(400);
    const b = await res.json();
    expect(b.fields.description).toBeTruthy();
    expect(rpcCalls("ia_intake_submit")).toHaveLength(0);
  });

  it("drops honeypot submissions silently", async () => {
    const res = await h()(post(complaint({ website: "http://spam.test" })));
    expect(res.status).toBe(400);
    expect(rpcCalls("ia_intake_submit")).toHaveLength(0);
  });

  it("maps the database rate limit to 429 and hides database messages", async () => {
    rpcResult = () => ok({ code: "P0429", message: "rate_limited" }, 400);
    const res = await h()(post(complaint()));
    expect(res.status).toBe(429);
    rpcResult = () => ok({ code: "22023", message: "invalid officer: internal detail" }, 400);
    const res2 = await h()(post(complaint()));
    expect(res2.status).toBe(400);
    expect(JSON.stringify(await res2.json())).not.toContain("internal detail");
  });

  it("fails closed without the pepper or backend config", async () => {
    for (const e of [env({ IA_INTAKE_PEPPER: undefined }), env({ IA_INTAKE_PEPPER: "short" }), env({ SUPABASE_SERVICE_ROLE_KEY: undefined })]) {
      expect((await iaIntakeHandler(e)(post(complaint()))).status).toBe(503);
    }
    expect(calls).toHaveLength(0);
  });

  it("enforces Turnstile when it is configured", async () => {
    const t = iaIntakeHandler(env({ TURNSTILE_SECRET: "ts-secret" }));
    expect((await t(post(complaint({ challenge: "bad" })))).status).toBe(400);
    expect(rpcCalls("ia_intake_submit")).toHaveLength(0);
    expect((await t(post(complaint({ challenge: "good" })))).status).toBe(201);
  });

  it("rejects non-POST methods and oversized or malformed bodies", async () => {
    expect((await h()(new Request("https://fn.test/ia-intake", { method: "GET" }))).status).toBe(405);
    expect((await h()(new Request("https://fn.test/ia-intake", { method: "POST", body: "not json" }))).status).toBe(400);
    expect((await h()(new Request("https://fn.test/ia-intake", { method: "POST", body: JSON.stringify({ ...complaint(), description: "x".repeat(60_000) }) }))).status).toBe(413);
    expect(rpcCalls("ia_intake_submit")).toHaveLength(0);
  });

  it("stores checked image uploads in the private bucket and refuses disguised files before saving", async () => {
    const form = new FormData();
    form.set("complaint", JSON.stringify(complaint()));
    form.append("evidence", new File([PNG], "photo.png", { type: "image/png" }));
    const res = await h()(new Request("https://fn.test/ia-intake", { method: "POST", body: form }));
    expect(res.status).toBe(201);
    expect((await res.json()).files).toEqual({ received: 1, stored: 1 });
    const put = calls.find((c) => c.url.startsWith(`${URL_}/storage/v1/object/tpd-ia-evidence/intake/${CASE}/`));
    expect(put?.key).toBe(SERVICE);
    expect(rpcCalls("ia_intake_attach")[0].body).toMatchObject({ p_case: CASE, p_mime: "image/png" });

    calls = [];
    const bad = new FormData();
    bad.set("complaint", JSON.stringify(complaint()));
    bad.append("evidence", new File([new TextEncoder().encode("<svg onload=alert(1)>")], "x.png", { type: "image/png" }));
    const r2 = await h()(new Request("https://fn.test/ia-intake", { method: "POST", body: bad }));
    expect(r2.status).toBe(400);
    expect(rpcCalls("ia_intake_submit")).toHaveLength(0);
  });

  it("receipt lookup checks format first and never reveals whether a reference exists", async () => {
    const r = await h()(post({ action: "status", reference: "TPD-7KQ3-M9PX", token: "short" }));
    expect(await r.json()).toEqual({ found: false });
    expect(rpcCalls("ia_receipt_status")).toHaveLength(0);
    const token = newTrackingToken();
    const r2 = await h()(post({ action: "status", reference: "tpd-7kq3-m9px", token }));
    expect((await r2.json()).status).toBe("under_review");
    const args = rpcCalls("ia_receipt_status")[0].body as Record<string, unknown>;
    expect(args.p_reference).toBe("TPD-7KQ3-M9PX");
    expect(JSON.stringify(args)).not.toContain(token);
  });
});

describe("ia-evidence", () => {
  const h = () => iaEvidenceHandler(env());
  const upload = (token: string | null, file: File, fields: Record<string, string> = {}) => {
    const f = new FormData();
    f.set("caseId", CASE);
    f.set("kind", "screenshot");
    f.set("description", "Scene photo");
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    f.set("file", file);
    return new Request("https://fn.test/ia-evidence", { method: "POST", headers: token ? { authorization: `Bearer ${token}` } : {}, body: f });
  };
  const download = (token: string | null) =>
    new Request("https://fn.test/ia-evidence", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ action: "download", evidenceId: EVIDENCE }) });

  it("refuses anonymous callers and the anon key before touching storage", async () => {
    for (const t of [null, ANON, "expired-token"]) {
      const res = await h()(download(t));
      expect(res.status).toBe(401);
    }
    expect(calls.some((c) => c.url.includes("/storage/"))).toBe(false);
  });

  it("checks access as the caller, then signs a 60-second URL with the service role", async () => {
    const res = await h()(download("ia-token"));
    expect(res.status).toBe(200);
    const b = await res.json();
    expect(b.expiresIn).toBe(60);
    expect(rpcCalls("ia_evidence_download_check")[0].auth).toBe("ia-token");
    const sign = calls.find((c) => c.url.includes("/object/sign/"));
    expect(sign?.key).toBe(SERVICE);
    expect(sign?.body).toEqual({ expiresIn: 60 });
  });

  it("a signed-in member without IA access gets nothing signed", async () => {
    expect((await h()(download("outsider-token"))).status).toBe(403);
    expect(calls.some((c) => c.url.includes("/storage/"))).toBe(false);
  });

  it("uploads only after the caller's case check, by content type, and attaches as the caller", async () => {
    const res = await h()(upload("ia-token", new File([PNG], "a.png")));
    expect(res.status).toBe(201);
    expect(rpcCalls("ia_evidence_staff_attach")[0].auth).toBe("ia-token");
    calls = [];
    expect((await h()(upload("outsider-token", new File([PNG], "a.png")))).status).toBe(403);
    expect(calls.some((c) => c.url.includes("/storage/"))).toBe(false);
    expect((await h()(upload("ia-token", new File([new TextEncoder().encode("MZ.....")], "a.exe")))).status).toBe(400);
  });

  it("removes the stored object when the database refuses the attachment", async () => {
    const base = rpcResult;
    rpcResult = (fn, body, auth) => (fn === "ia_evidence_staff_attach" ? ok({ message: "Evidence is locked" }, 400) : base(fn, body, auth));
    const res = await h()(upload("ia-token", new File([PNG], "a.png")));
    expect(res.status).toBe(403);
    expect(calls.some((c) => c.url === `${URL_}/storage/v1/object/tpd-ia-evidence` && (c.body as { prefixes: string[] }).prefixes[0].startsWith(`cases/${CASE}/`))).toBe(true);
  });
});
