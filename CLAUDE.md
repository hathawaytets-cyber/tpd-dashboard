# CLAUDE.md: working on TPD HQ

Read this whole file before touching anything. Then read `docs/IMPLEMENTATION_STATUS.md`,
which records what is built, what is live and what is blocked.

## 1. Hard rules (never break these)

1. **The repo is public.** Never commit roster data (Discord IDs, Roblox usernames, real
   timezones, hire dates, disciplinary points, anything from "TPD | Records" or Hire Logs),
   the TPD Discord server ID, or any secret. Test data uses obviously fake IDs
   (`100000000000000001`) and fictional personas. `tests/unit/department.test.ts` fails on
   Discord-ID-shaped numbers in `src`; do not weaken it.
2. **Never invent TPD policy.** Every rule cites its source: HB §x.y (Personnel Handbook),
   UoF (Use of Force Policy), RS (the roster/divisions/fleet sheet). Where policy is silent
   or contradictory, add a `PC-nn` entry to `docs/POLICY_CONFLICTS.md`, ship a configurable
   default, and label it **INTERIM** in code comments, UI copy and docs. An interim default
   stays labelled until leadership confirms it in writing. Never quietly drop the label.
3. **Nothing reaches production without dede's explicit approval, given for that release.**
   That covers: pushing to `gh-pages`, running a publish workflow, merging any PR,
   applying SQL to the live Supabase project, changing Edge Function secrets or settings,
   and changing Supabase Auth settings. Approval for one deploy does not carry to the next.
   "Looks good" is not "deploy"; ask for the exact words.
4. **The Supabase project is shared with dede's District Five app, which has real users.**
   TPD lives only in the `tpd` schema. Never read, alter, grant on or migrate anything in
   `public.*` or District Five objects. Never run schema-wide grants. Its
   `on_auth_user_created` trigger also fires for TPD sign-ins; leave it alone.
5. **Authorization is enforced server-side.** `can()` in `src/lib/authz` decides what the UI
   shows and what the design-preview store allows. In live mode the real check is Postgres:
   RLS policies, `SECURITY DEFINER` RPCs and `tpd.is_command()`, plus in-function checks in
   the Edge Functions. Hiding a button is never the check, and a client-side `can()` is never
   enough for a live write.
6. **Do not modify another thread's branch.** Work on your own branch and open your own PR.

## 2. What this project is

TPD HQ is the website for the **Tampa Police Department, a fictional roleplay department** in
the Florida State Roleplay community on Roblox *Emergency Response: Liberty County*. It is
not a real agency; every public page starts with the roleplay disclaimer. Owner: dede.

Two halves in one Next.js app:
- **Public site** (`/`, `/ride-alongs`): recruitment pathway, leadership by rank, districts,
  divisions, services, policy links.
- **HQ** (`/hq/*`): member portal. Overview, Patrol (duty timer), Activity, Training,
  Personnel, Divisions, Structure, Requests, Supervisor desk, Command Center, Integrations.

Official sources (readable through the Google connectors; never copy restricted columns):
roster sheet `1uWDH1g8BBlHDzzGaAvNH4FmQllbBtnjLPl-NtzdU0Zk`, Personnel Handbook, Use of
Force Policy, recruitment Google Form. Links are in `src/lib/department/sources.ts`.

## 3. How it is built

| Layer | Reality (verify before assuming otherwise) |
|-------|-----------|
| App | Next.js 15.5 App Router, React 19, TypeScript strict. **Every route is static.** Almost every component is a client component (`"use client"`). No server actions, no route handlers, no middleware, no SSR data. |
| Hosting | Static export to GitHub Pages (`STATIC_EXPORT=1`, `out/`, pushed to `gh-pages`). Vercel is a stated preference but not set up. |
| Styling | Tailwind v4 with CSS-variable tokens in `src/app/globals.css` (`@theme`). Light and dark themes. Archivo variable font (self-hosted via `@fontsource-variable`). |
| UI kit | Own primitives in `src/components/ui` (Button, Card, Dialog/Sheet on native `<dialog>`, Popover/Menu, DataTable, Pill, HourMeter, charts, toasts). Icons: `lucide-react`. No Radix, no shadcn. |
| Data, live mode | Supabase from the browser with `@supabase/supabase-js` (anon/publishable key, public by design). Reads go through RLS views; **writes go only through `SECURITY DEFINER` RPCs or Edge Functions.** `authenticated` has no table write grants. |
| Data, preview mode | `src/lib/preview/store.ts`: browser-local sample state in `localStorage` (`tpd-preview-state`) that mirrors the server contracts. Personas are fictional (`src/lib/sample-data.ts`). |
| Mode switch | `backendConfigured` in `src/lib/backend/config.ts`, decided **at build time** from `NEXT_PUBLIC_SUPABASE_URL` (must match `https://<ref>.supabase.co`) and `NEXT_PUBLIC_SUPABASE_ANON_KEY` (must be longer than 20 chars). Without both, the build is a design preview with no sign-in. |
| Auth | Discord OAuth through Supabase Auth (PKCE). Membership comes from `tpd.my_membership()`, matched on the Discord ID in `auth.identities`, never on display names or user metadata. Discord roles never grant access. No Discord bot (dede declined). |
| Edge Functions | Deno, in `supabase/functions` (`roster-sync`, `discord-verify`, `integration-health`); logic in `_shared/` so Vitest can test it. Gateway JWT verification is OFF by design; each function authenticates the caller itself first (see `docs/INTEGRATIONS.md`, "JWT verification"). |
| Validation | Hand-written guards. There is **no Zod** in the repo despite `docs/ARCHITECTURE.md`; don't add it casually. |
| Tests | Vitest (unit), Playwright (e2e, desktop 1440 and Pixel 7), SQL/RLS suite on a throwaway local Postgres. |

`docs/ARCHITECTURE.md` is the Milestone 0 **proposal** (Radix, Zod, server actions, Vercel).
Large parts were never built that way. Trust the code and `docs/INTEGRATIONS.md` over it.

## 4. Folder map

```
src/app/(public)/          public site: homepage, ride-alongs
src/app/hq/                one folder per HQ route; page.tsx files are thin wrappers
  auth/callback/           OAuth return page (sends the Discord token once to discord-verify)
  command/integrations/    health checks, roster sync preview/apply
src/app/globals.css        ALL design tokens (light + dark), type utilities (.display, .tabular, ...)
src/components/ui/         design-system primitives; reuse these, don't restyle ad hoc
src/components/shell/      HQ shell: sidebar, topbar, command palette, nav-config.ts, Page/PageHeader
src/components/auth/       LiveGate / live pages: closes HQ unless membership is verified
src/components/<area>/     screens: dashboard, patrol, personnel, requests, command, workspaces, public
  live-*.tsx               live-mode versions of a screen (real backend); siblings are preview versions
src/lib/authz/             can(), canDecide(), RANKS, ACCESS_NOTE; INTERIM rules cite PC-nn
src/lib/backend/           Supabase client, config, one module per backend feature (RPC wrappers)
src/lib/department/        verified snapshot of RS/HB/UoF: roster positions, divisions, fleet, policy
src/lib/domain/activity.ts week maths (Monday 00:00 America/New_York, interim PC-14; DST-safe)
src/lib/preview/           design-preview store and hooks (browser only)
src/lib/sample-data.ts     fictional demo personas only
supabase/migrations/       SQL migrations, all in schema `tpd`; filename order = apply order
supabase/functions/        Deno Edge Functions; _shared/ holds the testable logic
supabase/sql/              hand-run scripts (scheduler; rollbacks on feature branches)
supabase/tests/            auth stub, rls.test.sql, run-local.sh, run-as-nonroot.sh
tests/unit/                Vitest (authz, activity, store, department, live, integrations/)
tests/e2e/                 Playwright specs; helpers.ts has asRole() for preview personas
docs/                      STATUS, REQUIREMENTS, POLICY_CONFLICTS, INTEGRATIONS, DESIGN_SYSTEM, TEST_RESULTS
public/brand/              badge cut-out (207x265 source), Charger hero, skyline banner
.github/workflows/         CI checks; publish-phase1.yml PUBLISHES to gh-pages (see section 9)
```

## 5. Commands (verified 2026-11-13 on `main` @ 933c617, Node 22, npm 10)

| Command | What it does | Time | Result on main |
|---------|--------------|------|----------------|
| `npm ci` | install from lockfile (never `npm install` unless changing deps) | ~2 min | ok (audit warnings are dev-only) |
| `npm run dev` | dev server on :3000; `/` public, `/hq` HQ in preview mode | | |
| `npm run typecheck` | `tsc --noEmit`, strict | 7 s | pass |
| `npm run lint` | ESLint (next core-web-vitals + typescript) | 5 s | 0 errors, 2 pre-existing unused-var warnings |
| `npm test` | Vitest, `tests/unit/**/*.test.ts` | 2 s | 190/190 pass |
| `npm run build` | production build, all routes static | 30 s | pass |
| `STATIC_EXPORT=1 PAGES_BASE_PATH=/tpd-dashboard npm run build` | the Pages build CI uses; writes `out/` | 30 s | pass |
| `npx playwright test --trace off` | e2e; webServer builds and starts `next start -p 3410` | 1.5 min | 32 pass, 14 skipped (fake-backend specs) |
| `PG_BIN=/usr/lib/postgresql/16/bin bash supabase/tests/run-as-nonroot.sh` | migrations + RLS tests on a throwaway Postgres (initdb refuses root, so this wrapper runs as `postgres`) | 2 s | **fails at rls.test.sql:71** on main (stale test; fixed by commit 1587dd7 on the PR #2 branch) |

Fake-backend (live-mode) e2e, against stubbed Supabase responses:
```bash
rm -rf .next
NEXT_PUBLIC_SUPABASE_URL=https://fakeproj.supabase.co \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fake-anon-key-for-e2e-only-000000 npx next build
npx next start -p 3411 &        # then wait for the port
E2E_FAKE_BACKEND=1 E2E_BASE_URL=http://localhost:3411 npx playwright test tests/e2e/integrations.spec.ts --trace off
```
On main: 10 pass, **4 fail (pre-existing, stale stubs)**: "verified member sees their real
record", "workspaces without a server record stay closed", "directory cannot be loaded",
"Command Center: an officer is refused". Don't report them as regressions you caused; don't
claim the suite is green either.

Not runnable here: `deno check` (Deno isn't installed in the cloud container); anything
against the live Supabase project (the container can't reach `supabase.co`; live checks go
through dede's browser, read-only unless dede approves a change).

CI (`.github/workflows/phase2-checks.yml`) runs typecheck, lint, unit tests and the static
build on push to `main` and a list of old phase branches. On `main` it does **not** run on
pull requests and does not run e2e or SQL tests; run them yourself.

## 6. Repository and branch state (2026-11-13; check before relying on it)

- Active repo: **`hathawaytets-cyber/tpd-dashboard`** (public). The old
  `dedeworld9-cmd/tampaPD` / `dedeworld9-cmd/tpd-dashboard` is dead (account suspended
  2026-11-08); ignore links to it, including the callback URL and `ALLOWED_ORIGINS` in
  `docs/INTEGRATIONS.md` and `.env.example`. dede's GitHub login `dedeworld9-cmd` is not a
  collaborator on the new repo, so reviewer requests to it fail; continue without them.
- `main` @ 933c617.
- **PR #1** (`claude/project-thread-201lit`): Refactoring UI design pass. Open, unmerged.
- **PR #2** (`claude/project-thread-5t5848`): Daily Patrol Evaluation, migration
  `20261112000000`, policy items PC-30..PC-38, manual `publish-pages.yml`, SQL tests in CI.
  Open, unmerged, migration **not** applied live. Owned by another thread.
- A later "design reformation" (dede's current design direction, commits on
  `claude/design-reformation`) exists only as a git bundle in project files
  (`redesign/reformation/tpd-design-reformation.bundle`), built on PR #1. Not pushed, not
  reviewed by dede.
- Live preview: `https://hathawaytets-cyber.github.io/tpd-dashboard/` serves a **demo build
  of PR #2's head** (sample data, no sign-in). Live Supabase: TPD migrations up to
  `20261105071000` applied, `20261112000000` not; the auth redirect list still points at the
  dead dedeworld9-cmd URL.

These branches diverge. Before UI work, find out which design base dede has approved;
don't build on `main`'s look if the work belongs on top of the reformation, and don't
merge branches together on your own.

## 7. Coding rules

- **Follow existing patterns.** New HQ screen: a thin `src/app/hq/<route>/page.tsx` that
  renders a component from `src/components/<area>/`, wrapped in `Page`/`PageHeader`, with
  a nav entry in `src/components/shell/nav-config.ts` gated by a capability.
- **Both modes, always.** Any HQ feature must behave correctly in the design preview (store)
  and in live mode. A workflow with no server-side record shows "not connected yet" in live
  mode and refuses mutations (`LIVE_UNAVAILABLE`); it never falls back to demo data and
  never saves real-looking data in `localStorage`.
- **Server is authoritative.** Never send personnel IDs, timestamps or ranks from the client
  for a write. RPCs derive the actor from `auth.uid()` and use `now()`.
- **Migrations:** new file `supabase/migrations/YYYYMMDDHHMMSS_<name>.sql`, timestamp later
  than every existing one (two existing files already share `20261105000000`; don't add
  more collisions). Everything in schema `tpd`, written idempotently (`if not exists`,
  `drop policy if exists`) because live changes are pasted into the SQL editor. Every new
  table: `enable row level security`, `revoke all ... from public, anon, authenticated`,
  then grant only `select` where a policy allows it. Every mutating function:
  `security definer`, `set search_path = ''`, fully qualified names, `revoke all on
  function ... from public, anon`, `grant execute ... to authenticated`. Postgres grants
  EXECUTE to PUBLIC by default; forgetting the revoke opens the function to everyone.
  History is append-only: corrections are new rows referencing the original.
- Add RLS assertions to `supabase/tests/rls.test.sql` for every table, policy and RPC, and
  a rollback script in `supabase/sql/` for anything that will be applied live.
- **Edge Functions:** order of checks is method, identity (`/auth/v1/user`), authorization,
  body parsing (size and shape limits), then work. Put logic in `_shared/` and test it in
  `tests/unit/integrations/`. Secrets only via `supabase secrets set`; never in
  `NEXT_PUBLIC_*`, the repo, logs or chat.
- **Static export constraints:** no server-only APIs, no dynamic routes without
  `generateStaticParams`, images through the custom loader, internal links must work under
  `basePath` (`/tpd-dashboard`) with `trailingSlash: true`. Build both variants when you touch
  routing, images or links.
- **Time:** department time is America/New_York. Week and day maths go through
  `src/lib/domain/activity.ts` (`weekStart`, `weekMinutes`, `dailyMinutes`). There is no
  shared display formatter yet (a known UX-audit finding), so when you format dates pass
  `timeZone: "America/New_York"` explicitly and keep one clock style per screen.
- Strict TS, no `any`, no `@ts-ignore`, no `eslint-disable` to get green. Don't add
  dependencies without a reason you can state; never upgrade Next/React casually (versions
  are pinned for a security fix).
- Keep diffs scoped. No drive-by refactors of business logic during UI work.

## 8. Design rules

Source of truth on `main`: `docs/DESIGN_SYSTEM.md` and the tokens in `globals.css`. Newer,
unmerged rules live on PR #1 and the reformation bundle; if your task builds on those, read
their `DESIGN_SYSTEM.md` instead.

- **Palette from the badge:** Obsidian `#101113`, Graphite `#242830`, Heritage gold
  `#D5AB36`, Warm ivory `#F7F5EF`. Use tokens (`bg-surface`, `text-ink`, `text-muted`,
  `border-line`, `bg-gold`, `text-gold-ink`), never raw hex in components.
- **Gold means action, live duty state, rank or links.** It is never decoration. Gold text
  on light surfaces uses `gold-ink` for contrast. Status uses semantic green/amber/red/info.
- **Dense, refined, Apple/Linear-style enterprise UI.** Clear hierarchy, tight spacing, one
  primary action per view, tables that hold real density. Avoid giant empty cards and
  equally weighted card grids.
- **Typography:** Archivo only. Wide cuts (`.display`) for titles and big numbers,
  `.tabular` for times, call signs and counts. Sentence case everywhere; no all-caps labels.
- **No "vibecoded" tells** (dede checks for these): purple/blue gradients, gradient text,
  emoji in headings, Inter, colored left-border cards, glassmorphism cards, three icon boxes
  in a row, a badge above the headline, scroll fade-ins, cursor glows, serif italic accent
  words, grain textures, buzzword copy, em dashes in UI copy.
- **Honest data:** no invented statistics or decorative charts. Sample data is always
  labelled "Design preview" or "Sample". Real counts come from `src/lib/department`.
- **Consequences before commitment:** admin and approval flows show what changes before the
  confirm button enables, require a reason, and confirm with a specific verb ("End patrol",
  "Confirm promotion"). Every mutation guards against double submit and shows a toast.
- **Badge:** use `public/brand/tpd-badge.png` unaltered, never wider than about 130 px
  (low-res source). Never redraw it or swap in a generic shield icon.
- **Accessibility and responsiveness:** WCAG AA contrast in both themes, visible gold-ink
  focus ring, keyboard access for menus and dialogs, motion of 200 ms or less and off under
  `prefers-reduced-motion`, no horizontal overflow at 390 px. Mobile gets its own layout
  (tab bar, drawer, full-screen sheets), not shrunken desktop.
- **Look at it.** UI work is not done until you've screenshotted it in a real browser at
  1440 px and 390 px, in light and dark, and critiqued the result honestly. dede has rejected
  designs that "worked" but looked generic. Put screenshots in project files, not the repo.

## 9. Mistakes a weaker model makes here, and how to avoid each

| Mistake | Do this instead |
|---------|-----------------|
| Trusting `docs/ARCHITECTURE.md` and adding server actions, middleware, Zod or Radix | Read the code. The app is a static export; server logic lives in Postgres RPCs and Edge Functions. |
| Treating `can()` or a hidden button as security for a live feature | Enforce in SQL (RLS, `SECURITY DEFINER` RPC with role checks) and test it in `rls.test.sql`. |
| Filling a policy gap with a plausible rule ("Sergeants approve LOA") | Cite HB/UoF/RS, or add a PC item and an INTERIM default that says so in the UI. |
| Copying real names, Discord IDs or Roblox usernames into fixtures, tests, docs or commit messages | Fictional personas and fake IDs only. Roleplay name + call sign + rank on the public site is the only approved real data (PC-29). |
| Writing SQL that touches `public.*` or grants schema-wide | Schema `tpd` only, explicit per-object grants. |
| Forgetting `revoke ... from public` on a new function, or omitting `set search_path = ''` | Copy the pattern from `supabase/migrations/20261105000000_patrol_sessions.sql`. |
| Pushing to `main` or merging "since tests pass" | Own branch, own PR, then stop. Merging needs dede. |
| Running or editing `publish-phase1.yml`, or pushing `gh-pages` | It publishes to production when run, or when a change to that file lands on `main`. Don't touch it without dede's deploy approval. |
| Rebuilding for Pages without the Supabase env (or with it) by accident | A build without both `NEXT_PUBLIC_SUPABASE_*` vars turns sign-in off; a build with them is live mode. Know which one dede approved. |
| Calling the 4 fake-backend failures or the RLS-suite failure "my regression" (or "all green") | They pre-exist on main. Report them as pre-existing, with output; show that your change didn't add more. |
| Leaving `next dev` running while `npm run build` / Playwright builds | Both write `.next` and corrupt it. Stop dev first; if pages 400 or 500, `rm -rf .next` and kill any stale `next start` on 3410 (Playwright reuses it). |
| `pkill -f next` / `pgrep -f ... \| xargs kill` | That pattern matches your own shell and kills it. Find the PID (`/proc/*/cmdline`) and kill that PID. |
| Running `npx playwright install` | Chromium for Playwright 1.63 is preinstalled. Pass `--trace off`. |
| Fixing the e2e by loosening assertions or skipping tests | Fix the cause. Never skip, delete or weaken a test to get green. |
| Building UI on whichever branch is checked out | Check which design base dede approved (section 6) first. |
| Hardcoding hex colors, all-caps labels, new card styles or gradients | Tokens and `src/components/ui` primitives only. |
| Showing browser-local times or 12h/24h mixes | Format in America/New_York, one clock style per screen. |
| Using links to the dead `dedeworld9-cmd` repo or Pages URL | Use `hathawaytets-cyber/tpd-dashboard` and its Pages URL. |
| Saying "done" after typecheck alone, or claiming a check you didn't run | Run the checklist below and report exact results. |
| Writing a long wall of options to dede | Lead with the result, recommend one option, ask only what's blocking. |

## 10. Before you say a task is done

- [ ] The change does what was asked, on your own branch, with no unrelated edits.
- [ ] `npm run typecheck` passes.
- [ ] `npm run lint`: 0 errors and no new warnings.
- [ ] `npm test` passes; new logic has unit tests (authz, store operations, rules).
- [ ] `npm run build` and `STATIC_EXPORT=1 PAGES_BASE_PATH=/tpd-dashboard npm run build` pass.
- [ ] `npx playwright test --trace off` passes (32 on main today); new flows have e2e.
- [ ] Touched live mode, auth or backend: fake-backend suite run; no new failures beyond the known 4.
- [ ] Touched SQL: SQL suite run, new RLS assertions added, rollback script written; nothing applied live.
- [ ] Touched UI: screenshots at 1440 and 390, light and dark, reviewed critically; no overflow, no console errors.
- [ ] Both modes checked: design preview works, live mode refuses what has no server record.
- [ ] `git diff` scanned for Discord IDs, Roblox names, secrets, the guild ID and real roster data.
- [ ] Every new rule cites HB/UoF/RS or a PC item; interim defaults are labelled INTERIM.
- [ ] Docs updated: `IMPLEMENTATION_STATUS.md`, plus `POLICY_CONFLICTS.md`, `INTEGRATIONS.md`, `DESIGN_SYSTEM.md` or `TEST_RESULTS.md` where relevant.
- [ ] Nothing deployed, merged or applied live without dede's explicit approval.
- [ ] Your report says exactly what was verified, what failed (with output) and what still needs dede.

## 11. Working with dede

dede expects a capable partner: make sound decisions on reversible work and report them,
challenge weak ideas, never fake results. dede often leaves for hours, so keep going on
anything safe and reversible and ask only for approvals, policy answers and credentials.
Write replies in plain sentences, lead with the result, recommend one option. Settled
decisions (no bot, `tpd` schema in the shared project, Monday America/New_York week,
public names limited to roleplay name, call sign and rank) are not to be re-asked.
