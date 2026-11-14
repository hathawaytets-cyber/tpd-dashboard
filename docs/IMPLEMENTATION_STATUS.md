# Implementation Status

## Milestone 0 — Discovery · complete (2026-11-03)

Done
- Repository audit: `dedeworld9-cmd/tampaPD` was empty; **public** visibility.
- Read HB (full), UoF (full), all six RS tabs, GF (all 29 questions, public view).
- Reviewed three reference sites in a browser at desktop and mobile widths; confirmed each portal is Discord-gated.
- Wrote REQUIREMENTS, DATA_SOURCES, POLICY_CONFLICTS (25 items), ARCHITECTURE, PROJECT_PLAN, research/REFERENCE_SITES.

Not done / limits
- Rank Structure & Responsibilities document not available (PC-12).
- Google Form responses not accessible (only the public form).
- Reference portals not evaluated beyond their sign-in gates.
- AnchorCAD: no API documentation available; link-only.
- No code, tests or builds yet, so no test results to report.

## External blockers (needed from dede / leadership)
| Needed for | Item |
|------------|------|
| M2 | Discord application (client ID + secret) and the Discord server (guild) ID |
| M2 | Supabase project (or approval for me to use a local Supabase for development only) |
| M2 import | Google service account with Viewer access to the roster sheet, or approval to use a manual CSV export |
| M3 | Answers to PC-14 (week/timezone) and PC-15 (is the website the official patrol log) |
| M4 | PC-07, PC-08, PC-16 |
| M5 | PC-06, PC-24 |
| Assets | Official TPD badge/patch artwork, if any, and permission to use it |

## Milestone 1 — Design system & shell · design complete, awaiting review (2026-11-03)

Done
- Next.js 15 (App Router, strict TS), Tailwind v4 tokens, light/dark themes, self-hosted Public Sans.
- Public layout + homepage (join pathway from HB §3.1, divisions, districts, policy links, roleplay disclaimer).
- HQ shell: collapsible sidebar, mobile drawer, top bar, universal search (Ctrl/⌘ K), theme toggle, duty chip.
- Screens: Overview, Patrol, Personnel, Training, Division (6 routes), Command Center, Requests. Activity, Resources, Supervisor and Settings are labelled placeholders.
- Browser QA: 8 routes × 1440/1024/768/390 px (light) + 1440/390 (dark); no horizontal overflow, no console errors. 13 interaction checks pass. See TEST_RESULTS.md.

Deliberate limits
- All HQ data is fictional (`src/lib/sample-data.ts`) and every HQ page shows a "design preview" banner.
- The patrol timer runs in the browser only and records nothing; request decisions are disabled.
- No authentication: `/hq` is open in this preview. Do not deploy publicly until Milestone 2 adds sign-in.
- AnchorCAD link not configured (`NEXT_PUBLIC_ANCHORCAD_URL`); the button is disabled and says so.
- No automated test suite in the repo yet (Vitest/Playwright arrive with M2 logic).

## Next
Milestone 2: Discord sign-in, account linking, capability engine, personnel schema and roster import.
Blocked on the external items above.

## Redesign — black-and-gold system · complete in development, awaiting review (2026-11-03)

dede rejected the Milestone 1 look and issued two directives (design reformation; advanced UI/UX and interaction). Work so far:

Done
- Brand: department badge cut out to a transparent PNG without altering it (`public/brand/tpd-badge.png`, 207×265 source); favicon and touch icon from it. In-game Charger photo and Tampa skyline banner added as WebP.
- Tokens: Obsidian / Graphite / Heritage gold / Warm ivory palette in light and dark, Archivo variable type (wide display cuts), gold-ink for AA text on light surfaces.
- Component library (`src/components/ui`): buttons, fields, pills, cards, dialogs and sheets on native `<dialog>`, popovers and menus with keyboard support, tooltips, toasts, skeletons, tabs, segmented controls, hour meter, bar/stack/capacity charts, data table (sort, column visibility, selection, row menus, sticky header, pagination, CSV export).
- Authorization moved to `src/lib/authz` (`can()`, `canDecide()`), with handbook citations and interim rules marked.
- Design-preview data layer (`src/lib/preview/store.ts`): browser-local sample state that mirrors the planned server contracts (idempotent start, one open session, 12 h cap with review flag, authz on every decision, mandatory reasons, append-only history, double-submit guard). M2+ swaps it for server actions.
- Shell: collapsible obsidian sidebar (persisted), workspace switcher, role-filtered nav, live duty status, account menu with "Preview as" personas, theme, shortcuts, reset; top bar with breadcrumbs, quick actions, notification center; Ctrl/⌘K command palette; g-letter shortcuts; mobile tab bar and drawer.
- Reference screens: Member Dashboard (adapts to off duty, on duty, probationary, supervisor, command), Active Patrol workspace (start, recover, end with confirmation, weekly progress, six-week trend, history with corrections, supervisors on duty, fleet, policy refs), Command Center (KPIs, staffing, compliance, division capacity, decision queue with saved views and filters, approval panel). Requests workspace rebuilt on the same table and panel.
- Tests: 22 unit (authz, week math incl. DST, store operations) and 16 Playwright end-to-end. See TEST_RESULTS.md.

Also done
- Public homepage: obsidian hero with the badge and Charger photo, HB §2 values, HB §3.1 recruitment pathway, stats band on the skyline banner (2 districts, 6 divisions, 134 sworn slots from the official sheet), districts, divisions, leadership by rank (no names: the repo is public), services (HB §12.1, §14.1), announcements, policy links, banner footer. Roleplay disclaimer kept as the first line.
- Personnel: data table with filters and export, side panel, full profile page, admin actions (rank, district, divisions, call sign, status) that show gained or lost access, vehicles and exemptions before confirming, require a reason, block self-edits and write an audit history.
- Activity, Training, Divisions (overview and each division), Supervisor desk (gated), Resources (fleet matrix), Settings rebuilt on the new system.
- Tests: 24 unit and 23 end-to-end, all passing. See TEST_RESULTS.md. Screenshots in the project files (`redesign/`).

Remaining
- dede's review of the design. Not deployed, and must not be until dede approves the design and the release.
- Milestone 2 blockers are unchanged: Discord application, Supabase project, AnchorCAD URL, and policy conflicts PC-06, 07, 08, 14 and 16.
- The badge source is 207×265 px; a higher-resolution original would sharpen the hero.

## Department information integration · complete in development, not deployed (2026-11-04)

Done
- One verified data module, `src/lib/department` (sources, roster positions, divisions, fleet, policy), transcribed from RS, HB and UoF on 2026-11-04. `sample-data.ts` re-exports divisions and fleet from it and now holds only fictional demo personas, sessions and requests.
- Roster: all 134 authorized positions with tier, district, appointment and holder (13 sworn; 121 vacant). Active duty 13/126, probationary 0/8, matching Numbers by Rank.
- Divisions: all 67 slots across the six divisions with holders; commanders and assistants linked to their X-3xx positions. Branch shown only where a source assigns one (IA and OPA: Administrative Operations).
- Fleet: the three approved vehicles with model, livery, use and status, and the rank matrix cell by cell.
- Policy: core values, purpose, 3-hour weekly requirement and exceptions, seven-step HB §3.1 pathway, HB §13 discipline ladder (policy only), promotion eligibility, and a categorized section index of HB and UoF.
- Pages: homepage (values, pathway, districts with captain and staffing, divisions with commander and staffing, full leadership with vacancies, 13 / 134 band); new HQ **Structure** page; division pages list every slot; Resources adds the policy library, activity rule, discipline ladder and fleet details; Training shows the seven steps and no invented sign-offs; Command Center division capacity uses official counts; Personnel is labelled as demo personas.
- Tests: `tests/unit/department.test.ts` (counts against Numbers by Rank, divisions, fleet, pathway, discipline, and a guard that fails on any Discord-ID-shaped number in `src`); E2E for the homepage leadership and the Structure page; mobile overflow test covers Structure, Resources and a division page.

Never copied (restricted): Discord IDs, Roblox usernames, timezones, hire and resignation dates, disciplinary points, TPD | Records.

Open: PC-26 to PC-29 (docs/POLICY_CONFLICTS.md). Names on the public site await dede's decision (PC-29). Not deployed: the gh-pages preview still shows the previous build.

## Phase 2: real integrations · code complete, not activated (2026-11-04)

See docs/INTEGRATIONS.md for the architecture, activation steps and tests.

Implemented and tested without credentials
- Supabase schema with RLS, membership states and an atomic, validated roster snapshot apply. Tested on a local PostgreSQL 16 with a stub auth schema (`supabase/tests`).
- Edge Functions `roster-sync`, `discord-verify` and `integration-health` (Deno, no third-party imports, `deno check` passes), with shared logic unit-tested in Vitest: 39 integration tests.
- Website: Discord sign-in through Supabase Auth with PKCE, callback page, membership states, verified identity card on the dashboard, sign-in and sign-out in the account menu, Command Center → Integrations (health, sync preview and apply, read-only member verification), and AnchorCAD launch-URL validation.

Blocked on credentials (nothing is connected)
- Supabase project; Discord application plus guild ID (no bot); Google service account with Viewer access; AnchorCAD panel URL and an optional API key.
- Discord role mapping: the server's roles have not been seen, so no mapping exists, and none is enforced until leadership confirms it.
- AnchorCAD member matching, report references and duty sync are unsupported, because the API response fields are undocumented.

Not deployed: the live preview does not include Phase 2.

## Phase 1: real member access · code complete, not deployed or live-tested (2026-11-04)
- HQ is gated on verified roster membership when a backend is configured; demo personas and mutations are removed from live mode (store live layer, `LiveGate`, `LiveSwitch`).
- Real directory (Personnel), Overview and Command Center staffing come from RLS-protected views. Patrol, Activity, Training, Requests, Supervisor are closed ("not connected yet").
- Fixes: `discord-verify` matched command users to the wrong personnel row; `apply_roster_snapshot` used unqualified DELETEs; expired sessions looked like outages. New: call-sign validation, no-member and position-shrink import guards, duplicate-name and >3-division warnings.
- Needs a real member to verify: Discord sign-in end to end, the server-membership check, and gateway JWT acceptance. See docs/INTEGRATIONS.md, "Pending on the live project".

### Phase 1 security pass (2026-11-04)
- Shared project audited read-only: District Five authorization is membership/admin based (RLS plus SECURITY DEFINER RPCs, no table write grants for `anon`/`authenticated`), so a TPD login gets only a profile row. `tpd` grants are SELECT-only for `authenticated`, none for `anon`. Findings for dede (District Five side, not changed): email sign-ups are enabled and `handle_new_user` copies `provider_id` from user-editable metadata, so an email sign-up could claim a pre-seeded District Five roster slot; today there are 0 such slots and 0 email identities.
- Roster removals: deferred until approved or seen in 3 independent snapshots (migration `20261105000100`). Approval is bound to the previewed snapshot hash.
- Edge Functions: authenticate before parsing bodies, constant-time secret check, body size and shape limits, 81 HTTP-level negative tests. Live 405/401 probes recorded in the activation checklist.

## Internal Affairs and AnchorCAD · code complete, not deployed (2026-11-13)

2026-11-14: validated on a real Supabase staging stack (172/172 checks, 8 real-backend browser tests); three defects fixed. Verdict, decision matrix and the production plan: [IA_RELEASE.md](IA_RELEASE.md). Still not applied live or deployed.

Branch `feature/internal-affairs-anchorcad`. Details: [INTERNAL_AFFAIRS.md](INTERNAL_AFFAIRS.md), AnchorCAD section of
[INTEGRATIONS.md](INTEGRATIONS.md).

Done
- Public "Report an officer" form (`/report`) and receipt lookup (`/report/status`), no sign-in; member form at `/hq/report`.
- IA database: 17 tables, RLS with no direct grants, SOP workflow functions, append-only audit, private evidence bucket.
- `ia-intake` and `ia-evidence` Edge Functions (rate limiting, file sniffing, hashed tokens, server-side authorization).
- IA workspace: case queues, case file with every SOP step, appointments managed by the Deputy Chief.
- AnchorCAD workspace (`/hq/cad`): join link, panel link, capability matrix; launch-and-reference only.
- Fixed the pre-existing `rls.test.sql` failure (it still queried the retired `personnel_directory` view).

Not done / blocked
- Migration not applied, functions not deployed, `IA_INTAKE_PEPPER` not set (needs dede's approval).
- IA-01 to IA-15 policy questions open; interim behaviour documented.
- Roster Records tab entries are a confirmed manual task; the site never writes the roster sheet.
- AnchorCAD read-only sync designed, not built (needs a key and approval).
