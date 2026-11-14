#!/usr/bin/env node
/**
 * Internal Affairs staging verification against a REAL Supabase stack (Postgres + Auth + PostgREST +
 * Storage + Edge Runtime), never the live project. Typical target: `supabase start` on a throwaway
 * directory (see docs/IA_RELEASE.md, "Staging"). Every persona is fictional and every Discord ID fake.
 *
 *   STAGING_API_URL       e.g. http://127.0.0.1:54321
 *   STAGING_ANON_KEY      anon key of the staging stack
 *   STAGING_SERVICE_KEY   service-role key of the staging stack (used only for user setup)
 *   STAGING_DB_URL        postgres URL of the staging database (psql must be on PATH)
 *   STAGING_IA_PEPPER     the IA_INTAKE_PEPPER the staging functions were served with
 *   STAGING_SKIP_EXPIRY=1 skip the 65-second signed-URL expiry wait
 *
 * Refuses to run against *.supabase.co so it can never touch a hosted project by accident.
 * Prints one PASS/FAIL line per check and exits non-zero on any failure.
 */
import { execFileSync } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";

const API = process.env.STAGING_API_URL;
const ANON = process.env.STAGING_ANON_KEY;
const SERVICE = process.env.STAGING_SERVICE_KEY;
const DB = process.env.STAGING_DB_URL;
const PEPPER = process.env.STAGING_IA_PEPPER;
if (!API || !ANON || !SERVICE || !DB || !PEPPER) {
  console.error("Set STAGING_API_URL, STAGING_ANON_KEY, STAGING_SERVICE_KEY, STAGING_DB_URL and STAGING_IA_PEPPER.");
  process.exit(2);
}
if (/supabase\.co/i.test(API) || /supabase\.co|pooler\.supabase/i.test(DB)) {
  console.error("Refusing to run against a hosted Supabase project. Staging only.");
  process.exit(2);
}

// ------------------------------------------------------------------ helpers
const results = [];
let section = "";
const check = (name, ok, detail = "") => {
  results.push({ section, name, ok: !!ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  [${section}] ${name}${!ok && detail ? `  -> ${detail}` : ""}`);
};
const head = (s) => {
  section = s;
  console.log(`\n== ${s}`);
};
const sql = (q) => execFileSync("psql", [DB, "-AtXq", "-v", "ON_ERROR_STOP=1", "-c", q], { encoding: "utf8" }).trim();
const sha256hex = (b) => createHash("sha256").update(b).digest("hex");
const clientKey = (addr) => createHmac("sha256", PEPPER).update(addr).digest("hex");
let ipSeq = 0;
const freshIp = () => `198.51.100.${++ipSeq}`; // TEST-NET-2, one per logical client

async function rpc(token, fn, args = {}) {
  const res = await fetch(`${API}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: ANON, authorization: `Bearer ${token ?? ANON}`, "content-type": "application/json", "content-profile": "tpd", "accept-profile": "tpd" },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body, ok: res.ok };
}
async function table(token, name) {
  const res = await fetch(`${API}/rest/v1/${name}${name.includes("?") ? "&" : "?select=*&"}limit=1000`, { headers: { apikey: ANON, authorization: `Bearer ${token ?? ANON}`, "accept-profile": "tpd" } });
  return { status: res.status, body: await res.text() };
}
async function fn(name, { token, json, form, ip, headers = {} } = {}) {
  const h = { apikey: ANON, authorization: `Bearer ${token ?? ANON}`, origin: "http://localhost:3411", ...headers };
  if (ip) h["cf-connecting-ip"] = ip;
  let body;
  if (json) {
    h["content-type"] = "application/json";
    body = JSON.stringify(json);
  } else if (form) body = form;
  const res = await fetch(`${API}/functions/v1/${name}`, { method: "POST", headers: h, body });
  const text = await res.text();
  let b = null;
  try {
    b = text ? JSON.parse(text) : null;
  } catch {
    b = text;
  }
  return { status: res.status, body: b };
}
const complaint = (over = {}) => ({
  action: "submit",
  category: "public_conduct",
  summary: "Rude during a traffic stop",
  description: "The officer shouted at me repeatedly during a traffic stop near the pier.",
  anonymous: true,
  ...over,
});
const formWith = (payload, files) => {
  const f = new FormData();
  f.set("complaint", JSON.stringify(payload));
  for (const [bytes, name, type] of files) f.append("evidence", new Blob([bytes], { type }), name);
  return f;
};
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("fake-png-body-for-staging")]);
const PDF = Buffer.from("%PDF-1.4\n% staging test document\n");
const MP4 = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypisom"), Buffer.alloc(32)]);
const EXE = Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64)]);
const caseIdOf = (ref) => sql(`select case_id from tpd.ia_receipts where reference = '${ref}'`);
const caseRow = (id, cols) => sql(`select ${cols} from tpd.ia_cases where id = '${id}'`);
const denied = (r) => !r.ok && r.status >= 400;

// ------------------------------------------------------------------ personas
// a Chief X-101 · b Deputy Chief X-102 · c Major X-201 (IA oversight) · d IA Director (Captain X-303)
// e IA Deputy Director (Lt X-304) · f, g investigators · h officer · i Captain X-204 · j Sergeant
// k officer (complainant) · l Lieutenant · m Major X-202 (command, not IA oversight) · z signed in, not on roster
const P = {
  a: ["A. Chief", "X-101", "Chief of Police", "Office of the Chiefs"],
  b: ["B. Deputy", "X-102", "Deputy Chief", "Office of the Chiefs"],
  c: ["C. Major", "X-201", "Major", "Command Staff"],
  d: ["D. Director", "X-303", "Captain", "Division Command"],
  e: ["E. Deputydirector", "X-304", "Lieutenant", "Division Command"],
  f: ["F. Investigator", "X-420", "Officer", "Patrol Bureau"],
  g: ["G. Inquirer", "X-421", "Officer", "Patrol Bureau"],
  h: ["H. Patrolman", "X-422", "Officer", "Patrol Bureau"],
  i: ["I. Captain", "X-204", "Captain", "Command Staff"],
  j: ["J. Sergeant", "X-350", "Sergeant", "Field Supervisory"],
  k: ["K. Complainant", "X-423", "Officer", "Patrol Bureau"],
  l: ["L. Lieutenant", "X-330", "Lieutenant", "Field Supervisory"],
  m: ["M. Major", "X-202", "Major", "Command Staff"],
};
const LETTERS = Object.keys(P);
const discord = (x) => `2999000000000000${String(LETTERS.indexOf(x) + 1).padStart(2, "0")}`;
const T = {}; // access tokens
const ID = {}; // personnel ids

async function setup() {
  head("setup");
  if (sql("select count(*) from tpd.ia_appointments") !== "0") {
    throw new Error("Staging database already has IA data (append-only). Reset it first: supabase db reset");
  }
  sql("truncate tpd.ia_intake_throttle");
  // Fresh auth users (email/password) carrying a Discord identity, the way a real sign-in links them.
  for (const x of [...LETTERS, "z"]) {
    const email = `staging-${x}@example.test`;
    sql(`delete from auth.identities where user_id in (select id from auth.users where email = '${email}'); delete from auth.users where email = '${email}'`);
    const r = await fetch(`${API}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "staging-password-1", email_confirm: true }),
    });
    const u = await r.json();
    if (!u.id) throw new Error(`user ${x}: ${JSON.stringify(u)}`);
    if (x !== "z") {
      sql(`insert into auth.identities (provider_id, user_id, identity_data, provider, created_at, updated_at)
           values ('${discord(x)}', '${u.id}', '{"sub":"${discord(x)}"}', 'discord', now(), now())`);
    }
    const t = await fetch(`${API}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: ANON, "content-type": "application/json" },
      body: JSON.stringify({ email, password: "staging-password-1" }),
    }).then((res) => res.json());
    T[x] = t.access_token;
  }
  const members = LETTERS.map((x) => ({ discordId: discord(x), name: P[x][0], callsign: P[x][1], rank: P[x][2], tier: P[x][3] }));
  const positions = ["a", "b", "c", "i", "m"].map((x, n) => ({ ord: n + 1, callsign: P[x][1], rank: P[x][2], appointment: "Staging post", tier: P[x][3], discordId: discord(x) }));
  sql(`insert into tpd.roster_sync_runs (trigger, status, finished_at) values ('manual', 'applied', now())`);
  sql(`set role service_role; select tpd.apply_roster_snapshot('${JSON.stringify({ members, positions }).replace(/'/g, "''")}'::jsonb, gen_random_uuid())`);
  for (const x of LETTERS) ID[x] = sql(`select id from tpd.personnel where discord_id = '${discord(x)}'`);
  check("13 fictional personas on the roster with real Supabase sessions", LETTERS.every((x) => ID[x] && T[x]) && !!T.z);
  // IA appointments are made by the Deputy Chief through the real RPC.
  for (const [x, cs] of [["d", "IA-01"], ["e", "IA-02"], ["f", "IA-03"], ["g", "IA-04"]]) {
    const r = await rpc(T.b, "ia_appoint", { p_personnel: ID[x], p_callsign: cs, p_reason: "Staging appointment for verification" });
    check(`Deputy Chief appoints ${cs}`, r.ok, JSON.stringify(r.body));
  }
}

async function appointments() {
  head("appointments");
  for (const x of ["a", "c", "d", "i", "h"]) {
    const r = await rpc(T[x], "ia_appoint", { p_personnel: ID.l, p_callsign: "IA-05", p_reason: "Attempted appointment by non-DC" });
    check(`${P[x][1]} (${P[x][2]}) cannot appoint IA members`, denied(r) && /Deputy Chief/.test(JSON.stringify(r.body)), JSON.stringify(r.body));
  }
  const self = await rpc(T.b, "ia_appoint", { p_personnel: ID.b, p_callsign: "IA-05", p_reason: "Deputy Chief self appointment" });
  check("Deputy Chief cannot appoint themselves", denied(self));
  const dup = await rpc(T.b, "ia_appoint", { p_personnel: ID.l, p_callsign: "IA-03", p_reason: "Second holder of IA-03" });
  check("one holder per IA call sign", denied(dup));
}

async function anonymousIntake() {
  head("anonymous intake");
  const ip = freshIp();
  const r = await fn("ia-intake", { json: complaint({ name: "Should be dropped", contact: "drop@example.test", officerId: ID.h, referral: true, officer: "X-422" }), ip });
  check("anonymous complaint accepted without sign-in (201)", r.status === 201 && /^TPD-/.test(r.body?.reference) && r.body?.token?.length === 43, JSON.stringify(r.body));
  const id = caseIdOf(r.body.reference);
  check("identity dropped for an anonymous complaint", sql(`select anonymous and name is null and contact is null and member_id is null from tpd.ia_complainants where case_id='${id}'`) === "t");
  check("public officerId and referral flag ignored (no verified link)", caseRow(id, "accused_id is null and source = 'public' and status = 'intake'") === "t");
  check("only the SHA-256 of the tracking token is stored", sql(`select encode(token_hash,'hex') from tpd.ia_receipts where case_id='${id}'`) === sha256hex(r.body.token));
  check("no raw client address stored anywhere in the throttle", sql(`select count(*) from tpd.ia_intake_throttle where bucket like '%198.51.100%'`) === "0" && sql(`select count(*) from tpd.ia_intake_throttle where bucket = 'c:${clientKey(ip)}'`) === "1");
  check("intake writes nothing to the command-visible audit log", sql(`select count(*) from tpd.audit_log where detail::text like '%${id}%' or target = '${id}'`) === "0");
  check("Director and Deputy Director alerted, nobody else", sql(`select string_agg(recipient_id::text, ',' order by recipient_id) from tpd.ia_notifications where case_id='${id}'`) === [ID.d, ID.e].sort().join(","));
  check("alerts carry no case content (kind + case id only)", sql(`select count(*) from information_schema.columns where table_schema='tpd' and table_name='ia_notifications' and column_name not in ('id','recipient_id','kind','case_id','created_at','read_at')`) === "0");
  check("same-day bodycam and 48 h evidence preservation tasks", sql(`select count(*) from tpd.ia_tasks where case_id='${id}' and ((kind='bodycam_preservation' and due_at <= now() + interval '24 hours') or (kind='evidence_preservation' and due_at <= now() + interval '48 hours'))`) === "2");

  // status lookup
  const ok = await fn("ia-intake", { json: { action: "status", reference: r.body.reference, token: r.body.token }, ip: freshIp() });
  check("complainant sees coarse status only", ok.status === 200 && ok.body.found === true && ok.body.status === "received" && Object.keys(ok.body).sort().join() === "found,received_on,reference,statement,status", JSON.stringify(ok.body));
  const wrong = await fn("ia-intake", { json: { action: "status", reference: r.body.reference, token: "A".repeat(43) }, ip: freshIp() });
  const unknown = await fn("ia-intake", { json: { action: "status", reference: "TPD-AAAA-AAAA", token: r.body.token }, ip: freshIp() });
  check("wrong token and unknown reference give the same answer", JSON.stringify(wrong.body) === '{"found":false}' && JSON.stringify(unknown.body) === '{"found":false}');

  // honeypot and validation never create a case
  const before = sql("select count(*) from tpd.ia_cases");
  const hp = await fn("ia-intake", { json: complaint({ website: "http://spam.example" }), ip: freshIp() });
  const bad = await fn("ia-intake", { json: complaint({ category: "made_up", evidenceLinks: ["javascript:alert(1)"] }), ip: freshIp() });
  const big = await fn("ia-intake", { json: complaint({ description: "x".repeat(60_000) }), ip: freshIp() });
  check("honeypot, invalid fields and oversized bodies are refused", hp.status === 400 && bad.status === 400 && big.status === 413, `${hp.status} ${bad.status} ${big.status}`);
  check("refused submissions create no case", sql("select count(*) from tpd.ia_cases") === before);
  const leak = JSON.stringify([bad.body, big.body]);
  check("errors never echo database messages or case numbers", !/IA-20|tpd\.|ia_|violates|constraint/i.test(leak), leak);
  return { id, reference: r.body.reference, token: r.body.token };
}

async function rateLimits() {
  head("rate limits");
  const ip = freshIp();
  const s = [];
  for (let n = 0; n < 4; n++) s.push((await fn("ia-intake", { json: complaint({ summary: `Rate test ${n}` }), ip })).status);
  check("3 complaints per client per hour, the 4th gets 429", s.join() === "201,201,201,429", s.join());
  const other = await fn("ia-intake", { json: complaint(), ip: freshIp() });
  check("a different client is unaffected", other.status === 201);
  // Daily cap: 8 per client per 24 h (earlier hours seeded directly; the key is the HMAC the function computes).
  const ip2 = freshIp();
  sql(`insert into tpd.ia_intake_throttle values ('c:${clientKey(ip2)}', date_trunc('hour', now()) - interval '3 hours', 3), ('c:${clientKey(ip2)}', date_trunc('hour', now()) - interval '2 hours', 3)`);
  const d1 = await fn("ia-intake", { json: complaint(), ip: ip2 });
  const d2 = await fn("ia-intake", { json: complaint(), ip: ip2 });
  const d3 = await fn("ia-intake", { json: complaint(), ip: ip2 });
  check("8 per client per day, the 9th gets 429", `${d1.status},${d2.status},${d3.status}` === "201,201,429", `${d1.status},${d2.status},${d3.status}`);
  // Overall cap: 60 per hour across all clients.
  const prev = sql(`select coalesce(hits, 0) from tpd.ia_intake_throttle where bucket='all' and window_start = date_trunc('hour', now())`) || "0";
  sql(`insert into tpd.ia_intake_throttle values ('all', date_trunc('hour', now()), 60) on conflict (bucket, window_start) do update set hits = 60`);
  const g = await fn("ia-intake", { json: complaint(), ip: freshIp() });
  check("60 per hour overall, then 429 for everyone", g.status === 429);
  sql(`update tpd.ia_intake_throttle set hits = ${prev} where bucket='all' and window_start = date_trunc('hour', now())`);
  // Status lookups: 20 per client per hour.
  const ip3 = freshIp();
  const st = [];
  for (let n = 0; n < 21; n++) st.push((await fn("ia-intake", { json: { action: "status", reference: "TPD-AAAA-AAAA", token: "B".repeat(43) }, ip: ip3 })).status);
  check("20 status lookups per client per hour, the 21st gets 429", st.slice(0, 20).every((x) => x === 200) && st[20] === 429, st.join());
  check("throttle rows hold HMAC keys only", sql(`select count(*) from tpd.ia_intake_throttle where bucket !~ '^(all|[cs]:[0-9a-f]{64})$'`) === "0");
}

async function publicEvidence() {
  head("public evidence");
  const r = await fn("ia-intake", { form: formWith(complaint(), [[PNG, "photo.png", "image/png"], [PDF, "statement.pdf", "application/pdf"]]), ip: freshIp() });
  check("PNG and PDF stored with the complaint", r.status === 201 && r.body.files?.stored === 2, JSON.stringify(r.body));
  const id = caseIdOf(r.body.reference);
  check("files land in the private bucket under intake/<case>/", sql(`select count(*) from storage.objects where bucket_id='tpd-ia-evidence' and name like 'intake/${id}/%'`) === "2");
  check("bucket is private", sql(`select public from storage.buckets where id='tpd-ia-evidence'`) === "f");
  check("evidence rows record SHA-256 and size", sql(`select count(*) from tpd.ia_evidence where case_id='${id}' and sha256 ~ '^[0-9a-f]{64}$' and size_bytes > 0 and submitted_by_public`) === "2");
  const n0 = sql("select count(*) from tpd.ia_cases");
  const exe = await fn("ia-intake", { form: formWith(complaint(), [[EXE, "photo.png", "image/png"]]), ip: freshIp() });
  const mp4 = await fn("ia-intake", { form: formWith(complaint(), [[MP4, "clip.mp4", "video/mp4"]]), ip: freshIp() });
  const many = await fn("ia-intake", { form: formWith(complaint(), [[PNG, "1.png", "image/png"], [PNG, "2.png", "image/png"], [PNG, "3.png", "image/png"], [PNG, "4.png", "image/png"]]), ip: freshIp() });
  const huge = await fn("ia-intake", { form: formWith(complaint(), [[Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]), "big.png", "image/png"]]), ip: freshIp() });
  check("disguised executable refused by magic bytes", exe.status === 400, JSON.stringify(exe.body));
  check("public video upload refused (links only)", mp4.status === 400);
  check("more than 3 files refused", many.status === 400);
  check("file over 5 MB refused", huge.status === 400 || huge.status === 413, String(huge.status));
  check("refused uploads create no case", sql("select count(*) from tpd.ia_cases") === n0);
  return { id, path: sql(`select storage_path from tpd.ia_evidence where case_id='${id}' and mime_type='image/png'`), evidenceId: sql(`select id from tpd.ia_evidence where case_id='${id}' and mime_type='image/png'`) };
}

async function memberCases() {
  head("member intake and escalation");
  const submit = async (who, officerId, summary) => {
    const r = await fn("ia-intake", { token: T[who], json: complaint({ anonymous: false, name: "Typed name", contact: "typed contact", officerId, summary, category: "abuse_of_authority" }), ip: freshIp() });
    if (r.status !== 201) throw new Error(`${summary}: ${JSON.stringify(r.body)}`);
    return caseIdOf(r.body.reference);
  };
  const C = {
    ord: await submit("k", ID.h, "Ordinary member complaint"),
    inv: await submit("k", ID.f, "Complaint naming an investigator"),
    dir: await submit("k", ID.d, "Complaint naming the Director"),
    dc: await submit("k", ID.b, "Complaint naming the Deputy Chief"),
    chief: await submit("k", ID.a, "Complaint naming the Chief"),
    major: await submit("k", ID.c, "Complaint naming the Major"),
    byInvestigator: await submit("g", ID.h, "Complaint filed by investigator G"),
  };
  check("member identity comes from the session, not the typed name", sql(`select member_id = '${ID.k}' from tpd.ia_complainants where case_id='${C.ord}'`) === "t");
  const h = (k) => caseRow(C[k], "handler");
  check("IA §5 routing: officer→IA, investigator→Director, Director→Deputy Chief, Deputy Chief→Chief, Chief→external, Major X-201→Deputy Chief",
    [h("ord"), h("inv"), h("dir"), h("dc"), h("chief"), h("major")].join() === "ia,ia_director,deputy_chief,chief,external,deputy_chief", [h("ord"), h("inv"), h("dir"), h("dc"), h("chief"), h("major")].join());
  const forged = await fn("ia-intake", { token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.forged", json: complaint({ officerId: ID.h }), ip: freshIp() });
  check("a forged session token is rejected (401), not downgraded to public", forged.status === 401, String(forged.status));
  const self = await fn("ia-intake", { token: T.k, json: complaint({ anonymous: false, officerId: ID.k }), ip: freshIp() });
  check("a member cannot name themselves", self.status === 400);

  // Confidential routing from free text (public form, no verified link).
  const pub = async (officer, summary = "Public complaint") => caseIdOf((await fn("ia-intake", { json: complaint({ officer, summary }), ip: freshIp() })).body.reference);
  C.txDir = await pub("IA-01 the IA director");
  C.txMajor = await pub("X-201");
  C.txInv = await pub("Investigator, badge unknown");
  check("public complaint naming the Director: routed to the Deputy Chief, Director excluded", caseRow(C.txDir, `handler = 'deputy_chief' and '${ID.d}' = any(provisional_excluded)`) === "t");
  check("public complaint naming the Major: Deputy Chief handles it, Major excluded", caseRow(C.txMajor, `handler = 'deputy_chief' and '${ID.c}' = any(provisional_excluded)`) === "t");
  check("public complaint naming an investigator: Director handles it", caseRow(C.txInv, `handler = 'ia_director' and '${ID.f}' = any(provisional_excluded)`) === "t");
  return C;
}

async function visibility(C, pubCase) {
  head("who can read a case (real JWTs through PostgREST)");
  const sees = async (x, id) => (await rpc(T[x], "ia_case_detail", { p_case: id })).ok;
  const expect = {
    ord: "a b c d e f g", inv: "a b c d", dir: "a b", dc: "a", chief: "b", major: "a b", byInvestigator: "a b c d e f",
    txDir: "a b", txMajor: "a b", txInv: "a b c d",
  };
  for (const [k, who] of Object.entries(expect)) {
    const allowed = new Set(who.split(" "));
    const got = [];
    for (const x of LETTERS) if (await sees(x, C[k])) got.push(x);
    check(`${k}: readable by exactly [${who}]`, got.join(" ") === [...allowed].join(" "), `got [${got.join(" ")}]`);
  }
  check("anonymous complaint readable by IA and oversight only", (await Promise.all(LETTERS.map((x) => sees(x, pubCase)))).map((v, n) => (v ? LETTERS[n] : "")).join("") === "abcdefg");
  const dashIds = async (x) => {
    const r = await rpc(T[x], "ia_dashboard");
    return r.ok ? r.body.map((c) => c.id) : null;
  };
  const gDash = await dashIds("g");
  check("investigator G's queue omits cases they are excluded from", gDash && !gDash.includes(C.inv) && !gDash.includes(C.dir) && !gDash.includes(C.txInv) && gDash.includes(C.ord));
  const dDash = await dashIds("d");
  check("Director's queue omits the complaint naming them", dDash && !dDash.includes(C.dir) && !dDash.includes(C.txDir));
}

async function deniedRoles(C, pubCase) {
  head("ordinary officers, supervisors, unauthorized command and anonymous users");
  const TABLES = ["ia_appointments", "ia_cases", "ia_complainants", "ia_receipts", "ia_allegations", "ia_conflicts", "ia_evidence", "ia_tasks", "ia_interviews",
    "ia_notes", "ia_reports", "ia_reviews", "ia_decisions", "ia_disclosures", "ia_notifications", "ia_audit_events", "ia_intake_throttle"];
  const who = { h: "officer", j: "sergeant", l: "lieutenant", i: "captain X-204", m: "major X-202", z: "signed in, not on roster", anon: "anonymous" };
  for (const [x, label] of Object.entries(who)) {
    const tok = x === "anon" ? null : T[x];
    const acc = await rpc(tok, "ia_my_access");
    check(`${label}: no IA access reported`, x === "anon" ? denied(acc) : acc.ok && acc.body.has_access === false, JSON.stringify(acc.body));
    let tablesDenied = true;
    for (const t of TABLES) {
      const r = await table(tok, t);
      if (r.status < 400 || /"id"/.test(r.body)) tablesDenied = false;
    }
    check(`${label}: all 17 IA tables refused through the API`, tablesDenied);
    const reads = await Promise.all([
      rpc(tok, "ia_dashboard"), rpc(tok, "ia_case_detail", { p_case: C.ord }), rpc(tok, "ia_case_detail", { p_case: pubCase }),
      rpc(tok, "ia_staff"), rpc(tok, "ia_appointments_list"), rpc(tok, "ia_evidence_download_check", { p_evidence: randomUUID() }),
    ]);
    check(`${label}: dashboard, case files, staff list, appointments and evidence refused`, reads.every(denied), reads.map((r) => r.status).join());
    const internal = await Promise.all([
      rpc(tok, "ia_intake_submit", { p: {}, p_client_key: "a".repeat(64), p_user: null, p_token_hash: "\\x00" }),
      rpc(tok, "ia_receipt_status", { p_reference: "TPD-AAAA-AAAA", p_token_hash: "\\x00", p_client_key: "a".repeat(64) }),
      rpc(tok, "ia_can_view_as", { p_personnel: ID.d, p_case: C.ord }),
      rpc(tok, "ia_close", { p_case: C.ord, p_outcomes: [] }),
    ]);
    check(`${label}: service-only functions cannot be called`, internal.every(denied), internal.map((r) => r.status).join());
    if (x !== "anon") {
      const n = await rpc(tok, "ia_my_notifications");
      check(`${label}: no IA notifications`, n.ok && Array.isArray(n.body) && n.body.length === 0);
    }
  }
  const audit = await table(T.i, "audit_log?select=action,detail");
  check("captain can read tpd.audit_log but it holds nothing about IA", audit.status === 200 && !/ia_|case\.|complaint|IA-20/i.test(audit.body));
  // No other relation readable by members exposes IA tables.
  const leaks = sql(`select string_agg(distinct c.relname, ',') from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'tpd' and c.relkind in ('v','m') and (has_table_privilege('authenticated', c.oid, 'select') or has_table_privilege('anon', c.oid, 'select'))
    and pg_get_viewdef(c.oid) ~ 'ia_'`);
  check("no member-readable view references IA tables", leaks === "", leaks);
  const fnLeak = sql(`select string_agg(p.proname, ',') from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'tpd' and p.proname like 'ia\\_%' and has_function_privilege('anon', p.oid, 'execute')`);
  check("anon can execute no IA function", fnLeak === "", fnLeak);
}

async function evidenceAccess(C, pub) {
  head("evidence storage and signed URLs");
  const objectUrl = `${API}/storage/v1/object/tpd-ia-evidence/${pub.path}`;
  const get = (tok, url = objectUrl) => fetch(url, { headers: { apikey: ANON, authorization: `Bearer ${tok ?? ANON}` } }).then((r) => r.status);
  const direct = { anon: await get(null), officer: await get(T.h), investigator: await get(T.f), chief: await get(T.a) };
  check("direct object download refused for anon, officer, investigator and Chief", Object.values(direct).every((s) => s >= 400), JSON.stringify(direct));
  const authUrl = `${API}/storage/v1/object/authenticated/tpd-ia-evidence/${pub.path}`;
  check("authenticated object route refused", (await get(T.f, authUrl)) >= 400);
  check("public object route refused", (await get(null, `${API}/storage/v1/object/public/tpd-ia-evidence/${pub.path}`)) >= 400);
  const signAs = await fetch(`${API}/storage/v1/object/sign/tpd-ia-evidence/${pub.path}`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${T.f}`, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: 3600 }) });
  check("a member cannot sign their own URL, even an investigator", signAs.status >= 400, String(signAs.status));
  const list = await fetch(`${API}/storage/v1/object/list/tpd-ia-evidence`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${T.f}`, "content-type": "application/json" }, body: JSON.stringify({ prefix: "intake", limit: 100 }) });
  const listed = await list.text();
  check("listing the bucket returns nothing", list.status >= 400 || listed === "[]", listed.slice(0, 120));
  const up = await fetch(`${API}/storage/v1/object/tpd-ia-evidence/cases/${C.ord}/x.png`, { method: "POST", headers: { apikey: ANON, authorization: `Bearer ${T.h}`, "content-type": "image/png" }, body: PNG });
  check("direct upload into the bucket refused", up.status >= 400, String(up.status));

  // Shared project: simulate a permissive storage policy written for another app.
  sql(`drop policy if exists staging_other_app on storage.objects; create policy staging_other_app on storage.objects for all to anon, authenticated using (true) with check (true)`);
  const withOther = { anon: await get(null), officer: await get(T.h) };
  check("a permissive policy from another app does not open IA evidence (restrictive guard)", Object.values(withOther).every((s) => s >= 400), JSON.stringify(withOther));
  sql(`alter policy tpd_ia_evidence_service_only on storage.objects using (true) with check (true)`);
  const unguarded = await get(T.h);
  sql(`alter policy tpd_ia_evidence_service_only on storage.objects using (bucket_id is distinct from 'tpd-ia-evidence') with check (bucket_id is distinct from 'tpd-ia-evidence')`);
  sql(`drop policy staging_other_app on storage.objects`);
  check("control: without the guard that same policy WOULD expose evidence", unguarded === 200, String(unguarded));

  // ia-evidence function
  const dl = (tok, evidenceId = pub.evidenceId) => fn("ia-evidence", { token: tok, json: { action: "download", evidenceId } });
  const none = await dl(null);
  check("download without a session: 401", none.status === 401, String(none.status));
  for (const x of ["h", "j", "l", "i", "m", "z"]) {
    const r = await dl(T[x]);
    check(`download refused for ${P[x]?.[2] ?? "non-roster account"} (${P[x]?.[1] ?? "-"})`, r.status === 403 && !r.body?.url, String(r.status));
  }
  const ok = await dl(T.f);
  check("investigator receives a signed URL valid for 60 s", ok.status === 200 && ok.body.expiresIn === 60 && typeof ok.body.url === "string", JSON.stringify(ok.body).slice(0, 160));
  // Local stack only: inside Docker the function sees SUPABASE_URL as http://kong:8000. Hosted projects sign with the public URL.
  ok.body.url = ok.body.url.replace(/^http:\/\/kong:8000/, API);
  const bytes = Buffer.from(await (await fetch(ok.body.url)).arrayBuffer());
  check("signed URL serves the exact file", sha256hex(bytes) === sha256hex(PNG));
  const tampered = ok.body.url.replace(/token=([^&]+)/, (_, t) => `token=${t.slice(0, -4)}AAAA`);
  check("tampered signed URL refused", (await fetch(tampered)).status >= 400);
  const other = ok.body.url.replace(pub.path, pub.path.replace(/[^/]+$/, "other.pdf"));
  check("signed URL cannot be reused for another object", (await fetch(other)).status >= 400);
  check("every file open is audited with the actor", sql(`select count(*) from tpd.ia_audit_events where action='evidence.downloaded' and actor_id='${ID.f}'`) >= "1");
  check("refused attempts open nothing (no audit for officers)", sql(`select count(*) from tpd.ia_audit_events where action='evidence.downloaded' and actor_id in ('${ID.h}','${ID.j}','${ID.i}','${ID.m}')`) === "0");

  // staff upload
  const staffForm = (caseId, bytes, type = "image/png") => {
    const f = new FormData();
    f.set("caseId", caseId);
    f.set("kind", "screenshot");
    f.set("description", "Staging screenshot");
    f.set("file", new Blob([bytes], { type }), "s.png");
    return f;
  };
  // Make D the lead on the ordinary case first so the file has a worker.
  const up1 = await fn("ia-evidence", { token: T.d, form: staffForm(C.ord, PNG) });
  check("case lead uploads a file", up1.status === 201, JSON.stringify(up1.body));
  check("staff file stored under cases/<case>/", sql(`select count(*) from storage.objects where bucket_id='tpd-ia-evidence' and name like 'cases/${C.ord}/%'`) === "1");
  const up2 = await fn("ia-evidence", { token: T.h, form: staffForm(C.ord, PNG) });
  check("officer upload refused", up2.status === 403);
  const up3 = await fn("ia-evidence", { token: T.d, form: staffForm(C.dir, PNG) });
  check("upload to a case the user cannot see refused", up3.status === 403);
  const up4 = await fn("ia-evidence", { token: T.d, form: staffForm(C.ord, EXE) });
  check("disguised file refused for staff too", up4.status === 400);
  const up5 = await fn("ia-evidence", { token: T.c, form: staffForm(C.ord, PNG) });
  check("Major (oversight, not a case worker) cannot add evidence", up5.status === 403);
  return { url: ok.body.url };
}

async function conflictsAndDiscipline(C) {
  head("assignment and conflicts");
  const must = async (tok, f, a, label) => {
    const r = await rpc(tok, f, a);
    if (!r.ok) throw new Error(`${label}: ${JSON.stringify(r.body)}`);
    return r.body;
  };
  await must(T.d, "ia_accept_intake", { p_case: C.ord, p_accused: null, p_note: "Intake reviewed, assign for investigation." }, "accept");
  const assignAccused = await rpc(T.d, "ia_assign", { p_case: C.ord, p_investigator: ID.h, p_conflict_check: "Checked for conflicts." });
  check("accused member cannot be assigned", denied(assignAccused));
  const nonIa = await rpc(T.d, "ia_assign", { p_case: C.ord, p_investigator: ID.l, p_conflict_check: "Checked for conflicts." });
  check("a non-IA member cannot be assigned", denied(nonIa));
  const byInv = await rpc(T.f, "ia_assign", { p_case: C.ord, p_investigator: ID.f, p_conflict_check: "Self assignment attempt." });
  check("an investigator cannot assign cases (Director only)", denied(byInv));
  await must(T.d, "ia_accept_intake", { p_case: C.byInvestigator, p_accused: null, p_note: "Intake reviewed for G's complaint." }, "accept g");
  const compl = await rpc(T.d, "ia_assign", { p_case: C.byInvestigator, p_investigator: ID.g, p_conflict_check: "Checked for conflicts." });
  check("the complainant cannot investigate their own complaint", denied(compl));
  await must(T.d, "ia_assign", { p_case: C.ord, p_investigator: ID.f, p_conflict_check: "No supervisory or personal link." }, "assign f");
  check("assignment sets a 7-day due date and notifies the investigator",
    caseRow(C.ord, `status = 'investigating' and due_at between now() + interval '6 days 23 hours' and now() + interval '7 days 1 minute'`) === "t"
    && sql(`select count(*) from tpd.ia_notifications where case_id='${C.ord}' and recipient_id='${ID.f}' and kind='assignment'`) === "1");
  await must(T.f, "ia_declare_conflict", { p_case: C.ord, p_note: "I supervise the accused on patrol." }, "declare");
  check("declaring a conflict unassigns the investigator", caseRow(C.ord, "status = 'unassigned' and assigned_investigator_id is null") === "t");
  check("the conflicted investigator loses access to the file", denied(await rpc(T.f, "ia_case_detail", { p_case: C.ord })));
  check("the Director is notified to reassign", sql(`select count(*) from tpd.ia_notifications where case_id='${C.ord}' and recipient_id='${ID.d}' and kind='conflict_declared'`) === "1");
  check("the conflicted investigator cannot be reassigned", denied(await rpc(T.d, "ia_assign", { p_case: C.ord, p_investigator: ID.f, p_conflict_check: "Reassign attempt." })));
  await must(T.d, "ia_assign", { p_case: C.ord, p_investigator: ID.g, p_conflict_check: "No link to the accused." }, "assign g");

  head("escalation paths");
  await must(T.b, "ia_accept_intake", { p_case: C.chief, p_accused: null, p_note: "Referred to the server's outside authority." }, "chief referral");
  check("complaint against the Chief is recorded as an external referral and closed", caseRow(C.chief, "status = 'referred_external' and handler = 'external'") === "t");
  check("complaint against the Deputy Chief cannot be handled by the Deputy Chief", denied(await rpc(T.b, "ia_accept_intake", { p_case: C.dc, p_accused: null, p_note: "Deputy Chief tries to handle own case." })));
  await must(T.a, "ia_accept_intake", { p_case: C.dc, p_accused: null, p_note: "Chief takes the Deputy Chief complaint." }, "dc case");
  check("only the Chief can investigate a Deputy Chief complaint", denied(await rpc(T.a, "ia_assign", { p_case: C.dc, p_investigator: ID.d, p_conflict_check: "Trying to hand it to IA." })));
  await must(T.b, "ia_accept_intake", { p_case: C.dir, p_accused: null, p_note: "Deputy Chief handles the Director complaint." }, "dir case");
  check("a Director complaint cannot be handed to IA staff", denied(await rpc(T.b, "ia_assign", { p_case: C.dir, p_investigator: ID.e, p_conflict_check: "Trying to hand it to IA." })));
  await must(T.b, "ia_accept_intake", { p_case: C.txDir, p_accused: ID.h, p_note: "Reviewed: the officer involved is X-422." }, "tx dir");
  check("verified link from the higher authority clears text-based routing", caseRow(C.txDir, "handler = 'ia' and provisional_excluded = '{}' and routing_basis = 'verified'") === "t");

  head("criminal referral");
  const t0 = new Date(Date.now() - 120_000).toISOString();
  await must(T.g, "ia_record_notice", { p_case: C.ord, p_delayed: false, p_note: "Written notice sent by Discord DM." }, "notice");
  await must(T.g, "ia_criminal_referral", { p_case: C.ord, p_note: "Statement suggests evidence tampering." }, "referral");
  const blocked = await rpc(T.g, "ia_record_interview", { p_case: C.ord, p_kind: "accused", p_interviewee: "H. Patrolman", p_conducted_at: new Date().toISOString(), p_garrity_read_at: t0, p_observer: null, p_summary: "Interview attempted while the referral is pending." });
  check("accused interview blocked while a criminal referral is pending", denied(blocked));
  check("only the Deputy Chief decides the referral", denied(await rpc(T.d, "ia_criminal_decision", { p_case: C.ord, p_opened: false, p_note: "Director tries to decide." })));
  await must(T.b, "ia_criminal_decision", { p_case: C.ord, p_opened: false, p_note: "No criminal investigation opened." }, "decision");
  const noGarrity = await rpc(T.g, "ia_record_interview", { p_case: C.ord, p_kind: "accused", p_interviewee: "H. Patrolman", p_conducted_at: new Date().toISOString(), p_garrity_read_at: null, p_observer: null, p_summary: "Interview without the Garrity warning recorded." });
  check("accused interview refused without the Garrity warning", denied(noGarrity));
  await must(T.g, "ia_record_interview", { p_case: C.ord, p_kind: "accused", p_interviewee: "H. Patrolman", p_conducted_at: new Date().toISOString(), p_garrity_read_at: t0, p_observer: null, p_summary: "Member answered every question after the Garrity warning." }, "interview");

  head("findings, review and discipline");
  const alleg = sql(`select id from tpd.ia_allegations where case_id='${C.ord}' order by ord limit 1`);
  const second = await must(T.g, "ia_add_allegation", { p_case: C.ord, p_category: "dishonesty", p_description: "Second allegation for the staging run." }, "add allegation");
  const notSus = await rpc(T.g, "ia_record_finding", { p_allegation: second, p_finding: "not_sustained", p_rationale: "Not enough evidence either way in the logs.", p_recommended: "Strike" });
  check("discipline cannot be recommended on a non-sustained finding", denied(notSus));
  await must(T.g, "ia_record_finding", { p_allegation: second, p_finding: "not_sustained", p_rationale: "Not enough evidence either way in the logs.", p_recommended: null }, "finding 2");
  const early = await rpc(T.g, "ia_submit_report", { p_case: C.ord, p_body: "R".repeat(120), p_no_accused_interview_reason: null });
  check("report refused while an allegation has no finding", denied(early));
  await must(T.g, "ia_record_finding", { p_allegation: alleg, p_finding: "sustained", p_rationale: "Bodycam and CAD logs confirm the conduct.", p_recommended: "Termination" }, "finding 1");
  const tasksOpen = await rpc(T.g, "ia_submit_report", { p_case: C.ord, p_body: "R".repeat(120), p_no_accused_interview_reason: null });
  check("report refused while preservation tasks are open", denied(tasksOpen));
  for (const t of sql(`select id from tpd.ia_tasks where case_id='${C.ord}'`).split("\n")) await must(T.g, "ia_complete_task", { p_task: t, p_note: "Preserved and saved." }, "task");
  await must(T.g, "ia_submit_report", { p_case: C.ord, p_body: "Case report. ".repeat(12), p_no_accused_interview_reason: null }, "report");
  check("findings lock once the report is submitted", denied(await rpc(T.g, "ia_record_finding", { p_allegation: second, p_finding: "sustained", p_rationale: "Changing the finding after submission.", p_recommended: "Strike" })));
  check("the Deputy Chief cannot skip Director review", denied(await rpc(T.b, "ia_decide", { p_case: C.ord, p_outcomes: { [alleg]: "Strike" }, p_rationale: "Deciding before review." })));
  await must(T.d, "ia_director_review", { p_case: C.ord, p_approve: true, p_notes: "Report reviewed and approved." }, "review");
  for (const x of ["d", "e", "c", "a", "i", "m", "g"]) {
    check(`${P[x][1]} (${P[x][2]}) cannot decide discipline`, denied(await rpc(T[x], "ia_decide", { p_case: C.ord, p_outcomes: { [alleg]: "Strike" }, p_rationale: "Not the deciding authority." })));
  }
  check("discipline on a non-sustained allegation refused", denied(await rpc(T.b, "ia_decide", { p_case: C.ord, p_outcomes: { [alleg]: "Strike", [second]: "Strike" }, p_rationale: "Including a non-sustained allegation." })));
  check("an unknown discipline value refused", denied(await rpc(T.b, "ia_decide", { p_case: C.ord, p_outcomes: { [alleg]: "Firing squad" }, p_rationale: "Not on the ladder." })));
  const term = await must(T.b, "ia_decide", { p_case: C.ord, p_outcomes: { [alleg]: "Termination" }, p_rationale: "Termination recommended to the Chief." }, "decide");
  check("a termination goes to the Chief before anything closes", term === "chief_review" && caseRow(C.ord, "status") === "chief_review");
  check("the Deputy Chief cannot approve their own termination decision", denied(await rpc(T.b, "ia_chief_termination", { p_case: C.ord, p_approve: true, p_notes: "Approving my own decision." })));
  const before = sql(`select status || '|' || rank from tpd.personnel where id='${ID.h}'`);
  await must(T.a, "ia_chief_termination", { p_case: C.ord, p_approve: true, p_notes: "Termination approved by the Chief." }, "chief");
  check("case closes after the Chief's approval", caseRow(C.ord, "status") === "closed");
  check("no discipline is applied automatically: roster record unchanged", sql(`select status || '|' || rank from tpd.personnel where id='${ID.h}'`) === before);
  check("a pending Records-tab task is created for the Deputy Chief", sql(`select count(*) from tpd.ia_tasks where case_id='${C.ord}' and kind='roster_record_update' and completed_at is null`) === "1");
  const rosterTask = sql(`select id from tpd.ia_tasks where case_id='${C.ord}' and kind='roster_record_update'`);
  check("the Director cannot confirm the roster entry", denied(await rpc(T.d, "ia_complete_task", { p_task: rosterTask, p_note: "Director confirms." })));
  await must(T.b, "ia_complete_task", { p_task: rosterTask, p_note: "Entered on the Records tab by hand." }, "roster task");
  check("closed case is read-only", denied(await rpc(T.g, "ia_add_evidence", { p_case: C.ord, p_kind: "other", p_description: "Late evidence", p_external_ref: null })));
  check("decisions cannot be edited, even by a database superuser (trigger)", sql(`do $$ begin begin update tpd.ia_decisions set rationale = 'x' where case_id='${C.ord}'; raise exception 'edited'; exception when insufficient_privilege then null; end; end $$; select 'ok'`) === "ok");
  check("no officer can approve a public statement", denied(await rpc(T.d, "ia_approve_disclosure", { p_case: C.ord, p_body: "Director tries to approve a statement." })));
  return { closed: C.ord };
}

async function statusVisibility(pubComplaint) {
  head("complainant status visibility");
  const caseId = pubComplaint.id;
  const look = async () => (await fn("ia-intake", { json: { action: "status", reference: pubComplaint.reference, token: pubComplaint.token }, ip: freshIp() })).body;
  check("status is 'received' before intake review", (await look()).status === "received");
  const r = await rpc(T.d, "ia_accept_intake", { p_case: caseId, p_accused: null, p_note: "Accepted for investigation." });
  check("Director accepts the anonymous complaint", r.ok, JSON.stringify(r.body));
  const s2 = await look();
  check("status becomes 'under review' with no case details", s2.status === "under_review" && !JSON.stringify(s2).match(/IA-20|investigat|H\. Patrolman|X-4/));
  const d = await rpc(T.b, "ia_approve_disclosure", { p_case: caseId, p_body: "Your complaint has been assigned for investigation." });
  check("Deputy Chief approves a statement for the complainant", d.ok);
  check("approved statement shown to the complainant only via the token", (await look()).statement === "Your complaint has been assigned for investigation.");
  check("received_on is a date only (department time)", /^\d{4}-\d{2}-\d{2}$/.test(s2.received_on));
}

async function signedUrlExpiry(url) {
  head("signed URL expiry");
  if (process.env.STAGING_SKIP_EXPIRY) return check("signed URL expiry (skipped by STAGING_SKIP_EXPIRY)", true);
  await new Promise((r) => setTimeout(r, 65_000));
  const s = (await fetch(url)).status;
  check("signed URL stops working after 60 s", s >= 400, String(s));
}

// ------------------------------------------------------------------ run
const started = Date.now();
try {
  await setup();
  await appointments();
  const pubComplaint = await anonymousIntake();
  await rateLimits();
  const pubEvidence = await publicEvidence();
  const C = await memberCases();
  await visibility(C, pubComplaint.id);
  await deniedRoles(C, pubComplaint.id);
  const { url } = await evidenceAccess(C, pubEvidence);
  await conflictsAndDiscipline(C);
  await statusVisibility(pubComplaint);
  await signedUrlExpiry(url);
} catch (e) {
  check("run completed without an unexpected error", false, e.stack ?? String(e));
}
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed, ${Math.round((Date.now() - started) / 1000)} s`);
if (process.env.STAGING_RESULTS) (await import("node:fs")).writeFileSync(process.env.STAGING_RESULTS, JSON.stringify(results, null, 2));
process.exit(failed.length ? 1 : 0);
