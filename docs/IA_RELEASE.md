# Internal Affairs and AnchorCAD: release readiness (2026-11-14)

Branch `feature/internal-affairs-anchorcad` (PR #5). Nothing here has been applied to the live Supabase project,
deployed, or merged. Every production step below needs dede's explicit approval.

## 1. Verdict

| Module | Verdict | Why |
|---|---|---|
| AnchorCAD (launch and reference) | **Ready** | No key in code, assets or history; the site claims no CAD sync. Ships with the site build. |
| Internal Affairs (intake + case management) | **Ready for activation, gated** | 172/172 checks on a real Supabase stack, 8/8 real-backend browser tests. Go-live depends on the live prerequisites in section 5 (allowed origin, sign-in redirect, X-102 on the roster and signed in) and on the preflight returning the expected values. |

If any prerequisite in section 5 cannot be met tonight, release the site with intake switched off (do not deploy
`ia-intake`; the form then says "not connected") and ship AnchorCAD only.

## 2. What this pass changed

| Change | Why |
|---|---|
| **Confidential routing from free text.** A public complaint cannot link a member, so the officer the complainant named is matched (name, surname, roster call sign, IA call sign) against IA staff and the oversight posts at intake. Anyone matched is excluded from the case and the case starts at the narrowest handler any match would need. Only the higher authority can re-route it, and only by linking the verified member. | Before, a public complaint about the IA Director went to the Director's own queue with the complainant's contact details (IA §4 retaliation, §5, §11). |
| **IA-09: complaints against the Major X-201 go to the Deputy Chief.** | IA reports to the Major (IA §2), and IA §5 bars investigating your direct supervisor. The earlier interim had IA investigate the Major. |
| **Assignment re-checks visibility.** Anyone a case is hidden from can never be assigned to it. | Defence in depth for the exclusions above. |
| **Restrictive storage policy** `tpd_ia_evidence_service_only` on `storage.objects`. | The project is shared with District Five. A permissive storage policy written for that app would otherwise expose IA evidence. Proven on staging: with a `using (true)` policy present, evidence stays sealed; without the guard, the same policy exposes it. |
| **Rate-limit answer fixed (SQLSTATE PT429).** | Found on real PostgREST: the old code `P0429` came back as HTTP 500 and the function answered "could not be saved" instead of 429. Blocking still worked; the message and status were wrong. |
| Complainant receipt date in department time (America/New_York). | Was UTC. |
| Rollback script `supabase/sql/rollback-internal-affairs.sql`, read-only preflight `supabase/sql/ia-preflight-readonly.sql`. | Deployment plan. |
| Stale fake-backend browser tests repaired (directory RPC, Command Center copy, workspaces now connected). | The 14 skipped tests ran with 4 pre-existing failures; all 14 pass now. |

## 3. Verification

**Staging** is a real local Supabase stack (CLI 3.1.0, Postgres 17.6, GoTrue, PostgREST, Storage, Edge Runtime 1.78),
not a hosted project: no new hosted project was created because that needs dede's account. All 13 migrations apply
cleanly; both functions are served with a 64-character pepper.

| Suite | Result |
|---|---|
| `tests/staging/ia-staging.mjs` (real JWTs, PostgREST, Storage, Edge Functions) | **172 passed, 0 failed**, including the 65 s signed-URL expiry wait |
| `tests/e2e/ia-staging.spec.ts` (Chromium, site build, every request forwarded to staging) | **8 passed**: anonymous filing and status lookup in the UI; officer, sergeant, lieutenant, captain and a non-X-201 major refused; investigator sees and opens the case; officer cannot open it by URL |
| `tests/e2e/integrations.spec.ts` fake-backend suite (the 14 previously skipped) | **14 passed** (stubbed responses; not production verification) |
| `npx playwright test` default preview build | 37 passed, 22 skipped (the 14 stubbed + 8 staging tests, which need their own backends and were run separately above) |
| SQL suites on Postgres 16 (`run-as-nonroot.sh`) | IA and RLS suites pass; with PR #2's migration added, DPE, IA and RLS all pass |
| typecheck / lint / Vitest | pass / 0 errors (2 pre-existing warnings) / 225 passed |
| `STATIC_EXPORT=1` build + secret scan of `out/` | pass; no service key, secret key, pepper or CAD key |
| Edge Function bundles for the dashboard editor | served on staging: intake 201, evidence 401 without a session |

Staging checks by area (all pass): appointments only by the Deputy Chief, no self-appointment, one holder per call
sign · anonymous intake drops identity, ignores a public `officerId` and referral flag, stores only the token hash and
HMAC client keys, alerts only the Director and Deputy Director with content-free notices, creates same-day bodycam and
48 h preservation tasks · status lookup returns received / under review / closed plus a Deputy Chief approved
statement; wrong token and unknown reference answer identically · honeypot, invalid fields, oversized bodies refused
with no case created and no database text echoed · rate limits 3/hour and 8/day per client, 60/hour overall, 20
lookups/hour · public files: PNG and PDF stored privately; disguised executable, video, a 4th file and >5 MB refused ·
direct storage download, authenticated and public object routes, member signing, listing and direct upload all refused
· `ia-evidence`: 401 without a session, 403 for officer, sergeant, lieutenant, captain, non-X-201 major and a
non-roster account; investigator gets a 60 s URL that serves the exact file, cannot be tampered with or reused for
another object, expires after 60 s; every open audited · staff uploads only by case workers, never to a hidden case,
content-checked · routing for officer, investigator, Director, Deputy Chief, Chief and Major, verified and free-text ·
exact reader set for 10 case types · officer, sergeant, lieutenant, captain, non-X-201 major, non-roster account and
anon: no access flag, all 17 tables refused, dashboard, case files, staff, appointments and evidence refused,
service-only functions refused, no notifications · no member-readable view references IA; anon executes no IA
function; `tpd.audit_log` holds nothing about IA · conflicts: accused, non-IA member and complainant cannot be
assigned; investigators cannot assign; declaring a conflict unassigns, removes access, notifies the Director and blocks
reassignment · escalation: Chief complaint recorded as an external referral, Deputy Chief complaint only by the Chief,
Director complaint never handed to IA · criminal referral blocks the accused interview until the Deputy Chief decides;
Garrity attestation required · discipline: never on a non-sustained finding, report needs every finding and closed
preservation tasks, findings lock on submit, Director review cannot be skipped, only the Deputy Chief decides (Director,
Deputy Director, Major, Chief, Captain, Major X-202 and investigator refused), unknown discipline refused, termination
goes to the Chief, the Deputy Chief cannot approve it, roster record untouched, a pending Records-tab task only the
Deputy Chief or Chief can confirm, closed cases read-only, decisions immutable, disclosures only by the Deputy Chief.

**Not verified (cannot be from here):** the live project itself (the connected browser is signed in to a different
Supabase account, and the sandbox cannot reach `supabase.co`); Cloudflare's `cf-connecting-ip` on hosted Edge
Functions (staging injects it); Discord sign-in end to end; real delivery of alerts beyond the in-app list. These are
covered by the preflight and the production smoke tests.

## 4. Decision matrix: the 15 IA SOP gaps

Priority items first (intake notifications, confidential routing, complainant visibility). "Before production" says
whether leadership must act before the switch-on; "No" means the interim default is conservative and consistent with
the SOP, and stays labelled INTERIM until leadership confirms it.

| # | Gap | Interim default (in code now) | Risk | Before production |
|---|---|---|---|---|
| IA-01 | Who is alerted to new complaints | Director and Deputy Director, in-app and content-free; Major and Deputy Chief if no IA lead; escalated cases alert only the handling authority; named staff are never alerted | Alerts exist only inside HQ: if IA staff do not sign in daily, the 7-day bodycam window (IA §4) can lapse | **No**, but IA staff must check HQ daily until an outside alert is approved (a Discord ping would need a bot, which dede declined) |
| — | Confidential routing (not in the original 15; fixed tonight) | Free-text matches against IA staff and oversight; matched people excluded; narrowest handler; re-routing only by a verified link from the higher authority | False positives hide a case from someone who could have handled it (safe direction); a misspelled name is not matched, so IA intake review stays the backstop | **No** |
| IA-06 | What a complainant may learn | Received / under review / closed, plus a statement the Deputy Chief approves (IA §11) | A Chief complaint referred outside shows "Closed" | **No** |
| IA-07 | Complaint against the Chief | Deputy Chief records the referral to "the next authority above the department on the server" (IA §5); only the Deputy Chief sees it | The SOP does not name that authority or how it receives the file; the Deputy Chief reports to the accused | **Yes: accept the interim tonight or name the authority** |
| IA-09 | Complaint against the Major X-201 | Deputy Chief handles it (changed tonight to follow IA §2 + §5) | None known | **No** |
| IA-02 | Chief appointing IA when X-102 is vacant | Only X-102 appoints (IA §12) | If X-102 is vacant, IA has no members; oversight posts still see cases | **No** (operational: X-102 must be on the roster and signed in) |
| IA-03 | When the Deputy Director acts as Director | Only while IA-01 is vacant | A temporarily absent Director stalls assignment | No |
| IA-04 | "Same day" bodycam timezone | 24 h from receipt, capped at incident + 7 days | Slightly looser than "same day" for complaints logged early in the day | No |
| IA-05 | How written notice is delivered | Investigator attests method and time | Unverifiable delivery | No |
| IA-08 | Director review for escalated cases | Escalated cases go straight to the deciding authority | Less review on the most sensitive cases | No |
| IA-10 | Exact Garrity text | Attestation that the warning was read before the interview (IA §7) | Wording varies by investigator | No |
| IA-11 | Discipline list and points | HB §13 ladder (Infraction, Strike, Blackmark, Suspension, Demotion, Termination); no points computed; a Records-tab task is created for a human | SOP §9 lists only four outcomes for the Records tab; points are entered by hand | No |
| IA-12 | Closing out-of-scope intake without findings | Not allowed; every case reaches findings or an external referral | Minor issues (IA §3) cost a full investigation | No |
| IA-13 | Referral source "Daily Patrol Evaluations" | Generic supervisor referral, Sergeant and above | None | No |
| IA-14 | Public uploads | Images and PDF, 3 × 5 MB; video as links; staff up to 25 MB | Large evidence must be linked | No |
| IA-15 | Retention | Nothing deletable, no purge (IA §11 "life of the department") | Abusive or doxxing text in a public complaint cannot be removed | No (needs a redaction policy later) |

Also open from IA §5: the "direct supervisor / someone they supervise" conflicts are attested by the Director and the
investigator, not computed, because the roster holds no supervision links.

## 5. Production deployment plan

### 5.1 Prerequisites (live, read-only first)

1. **Preflight (read-only):** run `supabase/sql/ia-preflight-readonly.sql` in the SQL editor of `ajequjidyrsitqmcqkwr`.
   Expect: 0 IA tables and functions; `list_member_directory()` present; X-102 post filled and signed in with Discord;
   no `tpd-ia-evidence` bucket; and read the storage policy list (any policy without a bucket filter is exactly what
   the new guard neutralizes; nothing to change in District Five).
2. **Allowed origin:** the `ALLOWED_ORIGINS` function secret must contain `https://hathawaytets-cyber.github.io`.
   Without it the browser blocks the public form (CORS), so intake would fail for everyone.
3. **Sign-in redirect:** Auth > URL configuration must list
   `https://hathawaytets-cyber.github.io/tpd-dashboard/hq/auth/callback/`. Without it no member can sign in, so the IA
   workspace cannot be used (public intake still works).
4. The site's anon (publishable) key for the build. It is public by design.

### 5.2 Order (each step needs approval)

| # | Action | Where | Verify |
|---|---|---|---|
| 0 | Only if Daily Patrol Evaluation ships in the same release (integrated branch `claude/project-thread-xrbp5s`): apply `supabase/migrations/20261112000000_daily_patrol_evaluations.sql` first, the same way. Skip it when releasing PR #5 alone. | SQL editor | `to_regclass('tpd.daily_patrol_evaluations')` is not null |
| 1 | Apply `supabase/migrations/20261113000000_internal_affairs.sql` (schema `tpd`, bucket `tpd-ia-evidence`, one restrictive storage policy). Paste the whole file once; it runs as one transaction and fails safe if run twice. Do **not** use `supabase db push`: two migration files share version `20261105000000` and the CLI rejects that. | SQL editor | Re-run the preflight: 17 IA tables, bucket private, policy `tpd_ia_evidence_service_only` present |
| 2 | Set secret `IA_INTAKE_PEPPER` (random, ≥ 32 chars, e.g. `openssl rand -base64 48`); confirm `ALLOWED_ORIGINS`. Leave `TURNSTILE_SECRET` unset. | Edge Functions > Secrets | Names listed; values never shown |
| 3 | Deploy `ia-intake` and `ia-evidence` from the bundles in project files (`ia-release/ia-intake.js`, `ia-release/ia-evidence.js`), **Verify JWT OFF** for both (they authenticate callers themselves). | Edge Functions editor | Both listed as active |
| 4 | Build the site with `STATIC_EXPORT=1 PAGES_BASE_PATH=/tpd-dashboard NEXT_PUBLIC_SUPABASE_URL=https://ajequjidyrsitqmcqkwr.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key>` from the approved commit; scan `out/` for secrets; publish `out/` to `gh-pages`. This build is **live mode**: HQ requires Discord sign-in, and it replaces the current demo build of PR #2. | sandbox + gh-pages | Pages serves the new build |
| 5 | Deputy Chief appoints IA-01 to IA-06 at `/hq/internal-affairs/appointments`. | HQ | Appointments listed |

### 5.3 Smoke tests (production)

1. `/report` shows the form without "not connected"; submit one anonymous test complaint marked "TEST, please close";
   save the reference and code.
2. `/report/status` with both values shows "Received"; a wrong code shows "No complaint matches".
3. From a second network, submit once: in SQL, `select count(distinct bucket) from tpd.ia_intake_throttle where bucket like 'c:%'`
   must be 2 or more (proves the platform passes the real client address; one bucket means every visitor shares a
   limit and must be fixed before announcing the form).
4. An ordinary officer signs in: no Internal Affairs item in the sidebar, `/hq/internal-affairs` says "Restricted area".
5. The Director signs in: the test case is in the intake queue and opens.
6. `/hq/cad`: the "Join the community" button opens `https://anchr.gg/join?communityid=vcfsrp`; no CAD data is shown.
7. Close the test case through the workflow with a note that it was a release test (IA records cannot be deleted).

### 5.4 Rollback

- **Site:** re-publish the previous `gh-pages` commit (the PR #2 demo build), or rebuild without the Supabase
  variables (demo mode).
- **Intake only:** delete or disable `ia-intake` (the form then fails closed with "could not be submitted"), or unset
  `IA_INTAKE_PEPPER` (the function answers 503).
- **Database, level 1:** first block of `supabase/sql/rollback-internal-affairs.sql`: revokes every IA function from
  members and the functions; all records stay. Reversible by re-running the grant section of the migration.
- **Database, level 2:** the rest of the script drops IA objects and refuses to run if any complaint or file exists
  (IA §11). The empty private bucket must be removed in Dashboard > Storage (Supabase blocks SQL deletes there).
  Tested on staging: level 2 refused with data present; on an empty install it removed all 17 tables and 63
  functions, left the 16 other `tpd` tables untouched, and the migration re-applied cleanly afterwards.

## 6. Conflicts with other open work

- **PR #2 (Daily Patrol Evaluation)** and **PR #4 (stacked on #2):** no schema conflict. With both migrations applied
  in order (`20261112000000` then `20261113000000`), the DPE, IA and RLS suites all pass. Text conflicts on merge in
  `docs/*`, `src/components/shell/nav-config.ts`, `supabase/tests/rls.test.sql`, `supabase/tests/run-local.sh` and
  `tests/e2e/mobile.spec.ts` (PR #4 also `src/app/(public)/page.tsx`); all are additive and resolvable at merge time.
  Both PRs fix the same stale `rls.test.sql` query.
- **Integrated branch (2026-11-14):** `claude/project-thread-xrbp5s` = PR #5 + PR #4 (which contains PR #2), all nine
  conflicts resolved additively (nav keeps Internal Affairs and Command Center > Evaluations; the SQL runner tests every
  suite in a fresh database; the mobile sweep covers both features; POLICY_CONFLICTS keeps DPE as section I and the IA
  SOP questions as section J). Verified there: typecheck, lint, Vitest, SQL dpe/ia/rls, default and fake-backend
  Playwright, and the 172-check staging harness on a stack with both migrations applied. See TEST_RESULTS.md.
- **PR #1:** conflicts only in `docs/IMPLEMENTATION_STATUS.md`. **PR #3:** none.
- Deploying PR #5 alone replaces the current Pages demo build of PR #2; DPE stays unreleased either way (its migration
  is not applied).

## 7. Re-running staging

```bash
npx supabase@3 init && cp -r supabase/migrations supabase/functions <staging>/supabase/
# rename one of the two 20261105000000_* files (the CLI rejects duplicate versions), add "tpd" to [api] schemas
SUPABASE_INTERNAL_IMAGE_REGISTRY=docker.io npx supabase start   # docker.io mirror: public.ecr.aws is blocked here
npx supabase functions serve --env-file supabase/functions/.env  # IA_INTAKE_PEPPER=<64 hex>, ALLOWED_ORIGINS=...
STAGING_API_URL=http://127.0.0.1:54321 STAGING_DB_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres \
STAGING_ANON_KEY=... STAGING_SERVICE_KEY=... STAGING_IA_PEPPER=... node tests/staging/ia-staging.mjs
# then the browser suite against a fake-backend build served on :3411
E2E_STAGING_API=http://127.0.0.1:54321 E2E_STAGING_ANON_KEY=... E2E_BASE_URL=http://localhost:3411 npx playwright test tests/e2e/ia-staging.spec.ts --trace off
```
