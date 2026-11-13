# Integrations: Discord, Google Sheets roster, AnchorCAD

Status as of 2026-11-04: **code complete and tested; not activated.** No Supabase project,
Discord application, Google service account or AnchorCAD key exists yet, so nothing
is connected. The site says so everywhere ("Not configured"); nothing claims to be live.

## Architecture

```
GitHub Pages (static site, public config only)
   │  supabase-js: Discord sign-in (PKCE), RPC my_membership(), reads under RLS
   ▼
Supabase
   ├─ Auth: Discord provider (identity = Discord user ID in auth.identities)
   ├─ Postgres + RLS (supabase/migrations): personnel, positions, division_slots,
   │    roster_sync_runs, audit_log, discord_role_map, discord_verifications, integration_status
   └─ Edge Functions (supabase/functions), secrets server-side only:
        roster-sync         Google Sheets → validate → preview / apply (atomic)
        discord-verify      member's own token → guild membership + role comparison (no bot)
        integration-health  authenticated checks of all four integrations
```

All TPD tables and functions live in the Postgres schema `tpd` (exposed through the Data API), because the
Supabase project `ajequjidyrsitqmcqkwr` also hosts the District Five app in `public`. The two apps share
Supabase Auth (one user list, one Discord provider). District Five's `on_auth_user_created` trigger therefore
also runs for TPD sign-ins; TPD never reads District Five tables.

The frontend stays on GitHub Pages. Every write happens in an Edge Function after a
server-side check; signed-in users have no write grants on any table.

### Identity and access
1. "Sign in with Discord" → Supabase Auth → Discord (authorization code + PKCE, state handled by Supabase Auth, redirect limited to Supabase's allow list).
2. The Discord user ID comes from `auth.identities` (written by Supabase from Discord's response). User-editable metadata is never trusted.
3. `my_membership()` matches that ID to `personnel.discord_id` (from the roster sheet) and returns one of: verified, unrecognized, former, inactive, pending_verification, unavailable.
4. Command access (`is_command()`, interim PC-08: Captain and above) comes only from the roster rank. Discord roles never grant access.

### Roster sync
- Reads whole columns of `TPD Roster` and `TPD | Divisions` with a read-only service account (`spreadsheets.readonly`).
- Finds the header row by its labels and maps columns by header text, so inserted rows or columns do not break it. Section headings set the tier. The POINTS column is never read; Hire Logs and Records are never read.
- Validates: Discord ID format and uniqueness, call-sign uniqueness, known ranks, district, division holders on the roster, names without IDs (warning), empty or headerless reads.
- Any error rejects the run and the previous snapshot stays. Removing more than max(3, 25%) of active members is treated as a broken read and needs a command user's explicit confirmation.
- Apply is one transaction (`apply_roster_snapshot`). Additions and ordinary updates (rank, call sign, district, appointment) apply at once. **A missing member is never marked `former` by a single read.** They stay active and are tracked in `removal_candidates` until either (a) a command user approves the removal after previewing the same snapshot (`confirmRemovals` plus the preview's `expectedHash`; a changed sheet invalidates the approval), or (b) they are absent from 3 separate applied snapshots, each at least 6 hours after the previous one. A member listed again loses their candidate record. Previews, rejected and failed runs never count. The scheduler can never approve removals. Members are never deleted. Every run is logged in `roster_sync_runs` and `audit_log`.
- Direction is Sheets → website only. Nothing writes to Google.
- Scheduled every 10 minutes once `supabase/sql/schedule-roster-sync.sql` is run; command users can preview and apply manually from Command Center → Integrations.

### Discord server membership (no bot)
- Sign-in asks Discord for `identify` and `guilds.members.read` only. Nothing can post, join servers or act for the member.
- On the OAuth callback page the browser sends Discord's short-lived token once to `discord-verify`. The function checks that `GET /users/@me` returns the same ID as the Supabase identity, then reads `GET /users/@me/guilds/{DISCORD_GUILD_ID}/member` (role IDs). The token is not stored or logged by the server.
- Roles are compared with the roster only through **confirmed** rows in `discord_role_map`. Findings and a dry-run plan are stored; `ROLE_WRITES_ENABLED = false`. Planned role removals are always manual.
- A 404 is "not in the server". A missing scope, an invalid token or an outage is reported as a failure and is never recorded as "not in the server".
- Limit of this method: a member is only checked when they sign in, and role names cannot be listed (role IDs only; copy them in Discord with Developer Mode). A bulk "verify everyone" needs a bot, which dede declined.
- Note: supabase-js keeps the session, including that provider token, in the member's own browser storage. Its scopes are read-only identity and membership.

### AnchorCAD
- Official Open Developer API exists: `https://anchorcad.xyz/api/v1`, header `x-api-key`, keys `ank_v1.<serverId>.<secret>` bound to one panel, scopes, about 120 requests/min ([docs](https://docs.anchr.gg/api-reference/index)).
- Implemented: launch link (dashboard, Patrol, Resources, top bar, palette), only when the URL is https on anchorcad.xyz or anchr.gg; and a server-side `GET /server` key check.
- Not implemented, because the response fields are undocumented or importing them needs approval: member matching, report references, and CAD duty or patrol sync. Website patrols and AnchorCAD stay separate systems.

## Activation (what dede or an admin must do)

| # | Item | Where |
|---|------|-------|
| 1 | Create a Supabase project. Run `supabase link`, `supabase db push` (migrations), then `supabase functions deploy roster-sync discord-verify integration-health`. | supabase.com |
| 2 | Create a Discord application. Add the redirect `https://<project-ref>.supabase.co/auth/v1/callback`. In Supabase Auth → Providers → Discord, paste the client ID and secret. In Auth → URL configuration, add `https://dedeworld9-cmd.github.io/tpd-dashboard/hq/auth/callback/` to the redirect allow list. | discord.com/developers, Supabase |
| 3 | Set `DISCORD_GUILD_ID` (the TPD server ID) as a function secret. No bot is needed. | Supabase |
| 4 | Create a Google Cloud service account with the Sheets API enabled. Share the roster sheet with its email as **Viewer**. Set `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS` (the JSON) and `GOOGLE_SHEETS_ID`. | Google Cloud |
| 5 | Set `ROSTER_SYNC_SECRET` and `ALLOWED_ORIGINS=https://dedeworld9-cmd.github.io`. Then run `supabase/sql/schedule-roster-sync.sql`. | Supabase |
| 6 | Optional: create an AnchorCAD API key with `server:read` only (Dashboard → Config → Developer API). Set `ANCHORCAD_API_KEY` and `ANCHORCAD_PANEL_URL`. | AnchorCAD |
| 7 | Build the site with `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and `NEXT_PUBLIC_ANCHORCAD_URL`. All three are public by design. Deploying needs dede's approval. | build env |
| 8 | First run: a Captain+ member signs in. Then open Command Center → Integrations, click **Run health checks**, then **Preview sync**, then **Apply**. | the site |
| 9 | Role mapping: copy role IDs in Discord (Developer Mode → Server Settings → Roles → Copy Role ID). Insert rows in `discord_role_map`, and set `confirmed_by`/`confirmed_at` only after leadership confirms each mapping. | SQL editor |

Use `.env.example` for the variable list. Secrets go only into `supabase secrets set`; never into `NEXT_PUBLIC_*`, the repository or chat.

## Bootstrap note
No command user exists before the first import, so the first import is driven by the sync secret from the SQL editor: a dry run (`{"mode":"preview"}`, writes nothing but a run record), then, once the report is acceptable, one manual apply, then the schedule. `ROSTER_SYNC_SECRET` is generated in Vault and copied from there to the function secret, so it never passes through chat or the repo. After the first import, command users run preview/apply from Command Center > Integrations.

## Member access (Phase 1)
- **Gate.** With a backend configured, no HQ page renders until sign-in, roster verification (`my_membership()`, matched on the exact Discord user ID from `auth.identities`) and the real directory load all succeed. Any failure closes HQ; there is never a fallback to demo personas. Signed-out visitors, unrecognized, former, inactive and unverifiable accounts see only the sign-in screen with the reason.
- **Live mode.** Identity, the Personnel directory, Divisions and the Command Center staffing counts come from the database through RLS (`personnel_directory`, `division_slots`). The sample personas, sample sessions/requests and role switcher exist only in the no-backend design preview.
- **Closed until built.** Patrol, Activity, Training, Requests and Supervisor have no server-side record, so in live mode they show "not connected yet" and every store mutation refuses to run. Nothing is saved to the browser.
- **Authorization.** `can()` in the UI is convenience only. The server enforces it: `is_command()` (RLS) gates sync runs, audit, integration status and full personnel rows; `roster-sync` and `integration-health` call it before doing anything.
- **Expired sessions.** A 401 or JWT error from the roster call ends the session locally and returns to sign-in; it is never shown as an outage.
- **Roster import guards** (all reject the run, leaving the last valid snapshot): header/rank/Discord-ID/call-sign format errors, duplicate Discord ID or call sign, no member with a valid ID, a mass removal, and a position count that drops below 80% of the last import. A command user can confirm the last two manually. Warnings (not blocking): name without Discord ID, duplicate names under different IDs, more than three division slots for one member (HB §9.3), division holders missing from the roster.

### JWT verification
The project signs user tokens with an asymmetric key (ECC P-256; Project Settings > JWT Keys, verified 2026-11-04). The dashboard switch "Verify JWT with legacy secret" only accepts the legacy HS256 secret, so with it ON every real member session is rejected with "Invalid JWT" before the function runs. It must be OFF for the three functions, and that is safe only because each one authenticates the caller itself:
- `discord-verify`: the first thing it does is send the bearer token to Supabase Auth (`/auth/v1/user`: signature, expiry, revoked sessions). The anon/publishable key is not a user token and is refused.
- `integration-health`: `requireCommand` does the same, then `is_command()` (roster rank) must be true.
- `roster-sync`: a command user's token the same way, or the `x-sync-secret` header.
`supabase/config.toml` records this. Do not disable legacy API keys (`SUPABASE_ANON_KEY` is what the functions use to call Auth) until the functions are moved to the new keys.

### Edge Function access checks
Each function authenticates the caller itself (the gateway's JWT check is off, see above). Order of checks: method (non-POST is 405 and does nothing; OPTIONS is a CORS preflight), then identity, then authorization, then body parsing (malformed JSON 400, non-object 400, over 16 KB 413), then the work. `x-sync-secret` is compared by hash without early exit, an unset or empty secret never matches, and a secret never opens `integration-health` or `discord-verify`. Covered by `tests/unit/integrations/functions-http.test.ts` (missing, malformed, expired, anon-key, wrong-secret and non-command credentials; every rejected request is asserted to cause no service-role call).

## Tests
- `npm test`: parser, validation, change detection, sync failure paths, Google JWT signing, Discord (member-token) and AnchorCAD adapters (mocked HTTP), and secret hygiene.
- `supabase/tests/run-as-nonroot.sh` (or `run-local.sh` as a non-root user): applies the migration to a throwaway PostgreSQL with a stub auth schema and checks RLS, membership states and snapshot safety.
- `deno check` on the three functions (`supabase/functions/deno.json`).
- E2E: `tests/e2e/integrations.spec.ts`. The default build checks the "not configured" states. A build with a fake `NEXT_PUBLIC_SUPABASE_URL=https://fakeproj.supabase.co` and `E2E_FAKE_BACKEND=1` checks Discord PKCE redirect parameters, every membership state, expired sessions, directory failure, demo isolation, closed workspaces and Command Center access against stubbed responses (`E2E_FAKE_BACKEND=1 E2E_BASE_URL=http://localhost:3411 npx playwright test tests/e2e/integrations.spec.ts` after `npx next build` with the fake env and `npx next start -p 3411`).

None of these tests talks to the real Discord, Google, Supabase or AnchorCAD; those checks need the credentials above.

## Live state (2026-11-04)
- Project `ajequjidyrsitqmcqkwr`: `tpd` schema migrated and exposed; TPD callback in the redirect allow list; Discord provider shared with District Five.
- Functions deployed from the dashboard editor as single-file bundles: `npx esbuild supabase/functions/<name>/index.ts --bundle --format=esm --platform=neutral`. Gateway JWT verification must be OFF for all three (see "JWT verification"); each checks the caller itself.
- Secrets set: `DISCORD_GUILD_ID`, `ALLOWED_ORIGINS`, `GOOGLE_SHEETS_ID`. Missing: `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`, `ROSTER_SYNC_SECRET`, AnchorCAD.
- The site build uses the project's publishable key (public by design). Not deployed yet.

## Pending on the live project (Phase 1 changes, not applied)
1. Apply, in this order, `supabase/migrations/20261105000000_roster_apply_hardening.sql` and then `supabase/migrations/20261105000100_roster_removal_safeguards.sql` (SQL editor; both safe to re-run; the second replaces the two-argument `apply_roster_snapshot` and adds `removal_candidates`). Without it the first sync can fail on an unqualified `DELETE` and `my_membership` lacks the member id the new directory needs.
2. Redeploy `discord-verify`, `integration-health` (fix: command users were matched against the first personnel row instead of their own; authenticates before anything else) and `roster-sync` (truncation guard; dry run with the sync secret). Deploy the new code BEFORE turning Verify JWT OFF for `discord-verify` and `integration-health`: the new code authenticates first, the old `discord-verify` did not.
3. Missing secrets: `GOOGLE_SERVICE_ACCOUNT_CREDENTIALS`, `ROSTER_SYNC_SECRET`. Then the scheduler SQL.
4. Rebuild and deploy the site (needs approval).

## AnchorCAD (2026-11-13)

Official community: `https://anchr.gg/join?communityid=vcfsrp`. A join link lets a member ask to join the community
inside AnchorCAD; it is **not** API access and gives this site no right to read CAD data.

- **Implemented: launch-and-reference.** `/hq/cad` explains how to join, links the community and (when
  `NEXT_PUBLIC_ANCHORCAD_URL` is set to an official host) the panel. Internal Affairs logs AnchorCAD records as
  references (record number or link); nothing is imported, scraped or displayed from CAD.
- **API facts (docs.anchr.gg, read 2026-11-13).** Base `https://anchorcad.xyz/api/v1`, header `x-api-key`, keys are
  panel-bound and scoped, about 120 requests/minute per IP. Endpoints cover members, civilians, dispatch, units,
  departments and read-only records (incidents, warrants, citations). There are **no** evidence or bodycam endpoints,
  **no** OAuth or account linking, **no** webhooks, and response fields are undocumented. The terms forbid
  circumventing access controls.
- **Not activated: read-only sync (proposal).** If command wants record lookups later: a panel owner issues a key limited to
  read-only scopes (records and server info), stored solely as the `ANCHORCAD_API_KEY` Edge Function secret; an Edge
  Function looks up a record number on demand for an authorized IA user and stores only the reference and a
  verification timestamp. AnchorCAD stays the system of record. Needs dede's approval, the key, and verified response
  shapes before any code reads records.
