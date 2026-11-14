# Test Results

## Milestone 1 · 2026-11-03 · branch `milestone-1-design-system`

| Check | Result |
|-------|--------|
| `npm run typecheck` (tsc, strict) | Pass |
| `npm run lint` (eslint, next config) | Pass, 0 warnings |
| `npm run build` (production) | Pass, 18 routes, ~105 kB first-load JS |
| Responsive sweep: `/`, `/hq`, `/hq/patrol`, `/hq/roster`, `/hq/training`, `/hq/divisions/waterfront`, `/hq/command`, `/hq/requests` at 1440/1024/768/390 px light and 1440/390 px dark (48 page loads) | No horizontal overflow, no console or page errors |

Interaction checks (Playwright, headless Chromium, production build):

| Check | Result |
|-------|--------|
| Patrol: choose South, start, timer advances, end returns to start | Pass |
| Search palette: Ctrl K → "x-525" → Enter opens roster filtered to that member | Pass |
| Roster: query filter, clear filters, empty state on no match | Pass |
| Requests: Closed tab selects its first request | Pass |
| Sidebar collapse persists across reload | Pass |
| Theme choice persists across reload | Pass |
| Mobile drawer opens, navigates, closes | Pass |
| Public mobile menu shows sign-in | Pass |
| Skip link appears on first Tab | Pass |

Not yet tested: automated accessibility scan (axe), screen readers, Safari/Firefox, real data, authentication, server logic (none exists yet).
Known limit: Ctrl K pressed before the page finishes hydrating is ignored.

## Redesign (black and gold) · 2026-11-03 · branch `redesign-black-gold`

Run against a production build (`next build && next start`), headless Chromium.

| Check | Result |
|-------|--------|
| `npx tsc --noEmit` (strict) | Pass |
| `npm run lint` | Pass, 0 warnings |
| `npm run build` | Pass (member profiles prerendered via `generateStaticParams`) |
| `npm test` (Vitest): activity/week maths incl. DST, `can()` and `canDecide()`, preview store operations incl. personnel changes | 24 / 24 pass |
| `npm run test:e2e` (Playwright, desktop 1440 + Pixel 7) | 23 / 23 pass |

End-to-end coverage:
- Shell: palette searches personnel and navigates; palette hides Command Center from officers; go-to shortcuts and shortcut sheet; sidebar collapse persists; new request submitted and opened; notifications marked read.
- Patrol: start, recover after reload, end with confirmation; probationary officers cannot start (HB §3.2); palette start asks first; activity correction from history.
- Command Center: officers see access denied; decision with reason updates the queue; filters, saved views, sorting; supervisors cannot decide LOA extensions (HB §5.4).
- Personnel: promotion shows consequences, requires a reason and lands in history; no self-edit, no admin menu for officers; roster filters; division application respects membership; supervisor desk gated; every HQ page renders an h1 with no console errors.
- Public: disclaimer, badge and real handbook/application links.
- Mobile: tab bar and drawer; no horizontal overflow on key screens.

Bugs found by these tests and fixed: patrol recovery state never cleared; clock showed milliseconds as seconds; a nested admin dialog closing also closed the personnel sheet (React propagates `close`); member profile had no page heading.

Not yet tested: axe scan, screen readers, Safari and Firefox, real data, sign-in and server logic (not built yet).

## Precision pass (Dashboard, Patrol, Command Center) · 2026-11-03 · branch `redesign-black-gold`

Production build, headless Chromium. tsc and lint pass; build succeeds.

| Suite | Result |
|-------|--------|
| Vitest | 28 / 28 pass (adds stale-decision refusal, self-decision, manipulated IDs, cross-member corrections and withdrawals, LOA-extension and personnel authorization) |
| Playwright (desktop 1440, Pixel 7) | 27 / 27 pass (adds session drawer and sorting, dashboard identity and quick-action start, metric drill-downs, two-reviewer concurrency, mobile layout-width check) |
| Browser QA | 17 screenshots: officer, probationary, supervisor (dark), command at 1440, 834 and Pixel 7; 0 console errors |

Bugs found and fixed: dashboard table forced phones to zoom out (layout 491 px on a 412 px screen); patrol hero image reduced contrast behind actions; decision queue actions clipped at 1440 px.

Limits: all data is the browser-local preview store. "Server-side" checks are the store's operation guards, which mirror the planned server contracts; they are not a server. Not yet tested: axe scan, screen readers, Safari and Firefox.

## Internal Affairs and AnchorCAD · 2026-11-13 · branch `feature/internal-affairs-anchorcad`

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 errors (2 pre-existing warnings in files this branch does not touch) |
| `npm test` (Vitest) | 225 passed, 12 files (new: IA model, intake client, IA Edge Function helpers) |
| `supabase/tests/run-local.sh` (PostgreSQL, fresh DB per suite) | `ia.test.sql` ALL IA TESTS PASSED; `rls.test.sql` ALL RLS TESTS PASSED (fixed pre-existing failure) |
| `deno check` ia-intake, ia-evidence | Pass |
| `STATIC_EXPORT=1 next build` | Pass; `/report`, `/report/status`, `/hq/report`, `/hq/internal-affairs{,/case,/appointments}`, `/hq/cad` exported. No service key, CAD key or pepper in `out/` |
| `npx playwright test` | 37 passed, 14 skipped (the stubbed-backend suite, which skips in the preview build as before) |
| Mobile overflow sweep (Pixel 7) | No overflow on the six new screens |
| Screenshots | 1440 px and 390 px, light and dark, reviewed |

## Internal Affairs release validation · 2026-11-14 · PR #5

Real local Supabase stack (Postgres 17, Auth, PostgREST, Storage, Edge Runtime), not the live project. Details in
[IA_RELEASE.md](IA_RELEASE.md).

| Check | Result |
|-------|--------|
| `tests/staging/ia-staging.mjs` | 172 passed, 0 failed |
| `tests/e2e/ia-staging.spec.ts` (browser → staging) | 8 passed |
| `tests/e2e/integrations.spec.ts` fake-backend (previously skipped) | 14 passed (4 stale stubs repaired) |
| `npx playwright test` (preview build) | 37 passed, 22 skipped (the two suites above, run separately) |
| SQL suites (IA, RLS; plus DPE with PR #2's migration) | pass |
| typecheck, lint, Vitest | pass, 0 errors, 225 passed |
| Static export + secret scan | pass, clean |

Defects found and fixed: rate-limited requests returned HTTP 500 (SQLSTATE P0429 → now PT429/429); public complaints
naming IA staff reached the named person's queue; complaints against the Major X-201 were investigated by IA.

## Daily Patrol Evaluation · 2026-11-12 · branch `claude/project-thread-5t5848`

| Suite | Result |
|-------|--------|
| SQL (`supabase/tests/run-local.sh` on local PostgreSQL 16) | RLS suite passes again (was failing on `main`); new `dpe.test.sql` passes (15 sections) |
| Vitest | 204 / 204 pass (adds 14 patrol-day, deadline, status and validation tests) |
| Playwright (desktop 1440, Pixel 7) | 41 pass, 14 skipped (fake-backend only, as before); adds 8 evaluation tests and 1 mobile test |
| `tsc --noEmit`, `npm run lint`, `npm run build` | Pass (lint: the 2 pre-existing warnings) |

SQL coverage: patrol-day boundary at 04:00 and the 23 h / 25 h DST days; patrol obligations (cross-midnight, 03:50 start, under 15 minutes, summed short sessions, officer, captain, former member); assignments as the authoritative source and Sergeants unable to assign; status at the deadline; no-observations flow and validation; duplicate submit (23505); future days; amendments and version history; visibility for another Sergeant, a Lieutenant, an Officer, signed-out and anon users and command; excusals and approved LOA; assignment cancellation; concern referral; two-step award approval where the endorser cannot approve; lock after review and one amendment after reopen; append-only versions, reviews and audit log; history that survives roster changes; export and audited settings. Mutation checks (removing the duplicate guard, removing the excusal branch) make the suite fail.

E2E coverage: two-action no-observations report; full report with three officers, validation messages and an award; duplicate submission from a second tab rejected; amendment needs a reason and keeps version 1; Lieutenant on leave sees excused days; Officers and Captain+ cannot file and Officers and Sergeants cannot open command review; command excuses an overdue day; award endorsement without final approval for a Major and a concern referral; phone submission and no horizontal overflow on the new pages.

Bugs found by these tests and fixed: draft autosave disabled the officer search while saving, which closed the list mid-selection; the first draft save remounted the form (key included the report status), dropping focus and any edit made during the save.

Not tested: real Supabase (migration not applied), true parallel submissions, screen readers, Safari and Firefox.

## Integrated release branch · 2026-11-14 · `claude/project-thread-xrbp5s` (PR #5 + PR #4 + PR #2)

| Check | Result |
|-------|--------|
| `npm run typecheck` | Pass |
| `npm run lint` | Pass, 0 errors (2 pre-existing warnings) |
| `npm test` (Vitest) | 239 passed, 13 files |
| `supabase/tests/run-as-nonroot.sh` (fresh DB per suite) | ALL DPE, ALL IA and ALL RLS TESTS PASSED |
| `npx playwright test` (demo build, desktop + Pixel 7) | 47 passed, 26 skipped (live-mode suites, run below) |
| Fake-backend build, `E2E_FAKE_BACKEND=1` with staging env | 26 passed (14 integrations, 4 evaluations-live, 8 IA against real staging), 2 skipped (no-backend checks, covered by the demo run) |
| `tests/staging/ia-staging.mjs` on local Supabase with all 14 migrations (DPE and IA) | 172 passed, 0 failed |
| `STATIC_EXPORT=1 PAGES_BASE_PATH=/tpd-dashboard next build` | Pass; secret scan of `out/` clean (no service key, pepper, JWT secret or guild ID) |
| Mobile overflow sweep (Pixel 7) | No overflow on 19 screens, including IA, AnchorCAD and both evaluation pages |

Not verified anywhere: the live Supabase project, live Discord sign-in, roster sync against the real sheet, and the
production website in live mode. Edge Functions were type-checked by the Supabase edge runtime while serving staging
(`deno` is not installed in this sandbox). Running the whole suite against a fake-backend build used to fail 42
demo-data tests that cannot apply in live mode; `playwright.config.ts` now runs only the live-mode suites for that build.
