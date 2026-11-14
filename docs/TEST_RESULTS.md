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
