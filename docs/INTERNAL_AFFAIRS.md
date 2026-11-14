# Internal Affairs: complaints and case management

Source of truth: the TPD Internal Affairs SOP (Google Doc `1EIHNewZ80A-nNMFIyF04alCXLQ3L_gge3Bbp6DgaFcg`), cited as **IA §n**.
Where the SOP is silent, the interim choice is listed under "Open policy questions" (IA-01 …) and in
[POLICY_CONFLICTS.md](POLICY_CONFLICTS.md) section I. None of these is presented as TPD policy.

Release readiness, staging results, the decision matrix and the deployment plan: [IA_RELEASE.md](IA_RELEASE.md).

Status (2026-11-13): code complete on branch `feature/internal-affairs-anchorcad`. **Not deployed, not applied to the
live Supabase project, no secrets set.** The public form says "not connected" until the steps below are done.

## What exists

| Surface | Route | Who |
|---|---|---|
| Report an officer | `/report` | Anyone. No sign-in, anonymous allowed (IA §4) |
| Complaint status | `/report/status` | Whoever holds the reference **and** the private tracking code |
| Report misconduct (members) | `/hq/report` | Signed-in members. Same intake, with a roster picker the server verifies |
| Case management | `/hq/internal-affairs` | IA appointees, Major X-201, Deputy Chief X-102, Chief X-101 (IA §11) |
| Case file | `/hq/internal-affairs/case?id=` | As above, minus anyone excluded from that case (see Visibility) |
| Appointments | `/hq/internal-affairs/appointments` | Viewed by IA and oversight; changed by the Deputy Chief only (IA §12) |

## Architecture

- **Database (`supabase/migrations/20261113000000_internal_affairs.sql`).** 17 `tpd.ia_*` tables, all with RLS on and
  **no table grants to `anon` or `authenticated`**. Every read and write goes through `SECURITY DEFINER` functions that
  identify the caller from `auth.identities` (never from client input) and re-check access on every call.
- **IA access comes from appointments, not rank.** `tpd.ia_appointments` (IA-01 Director, IA-02 Deputy Director,
  IA-03…06 investigators) plus the three oversight posts read from roster positions X-101/X-102/X-201. A Lieutenant or
  Captain without an appointment sees nothing. The sidebar hides IA unless `ia_my_access()` says yes, but hiding is
  never the check: every RPC refuses on its own.
- **Edge Functions.**
  - `ia-intake` (public, `verify_jwt = false`): validates, rate-limits (3/hour and 8/day per client, 60/hour
    overall, keyed by an HMAC of the address with `IA_INTAKE_PEPPER`; no raw IP is stored), checks magic bytes of
    uploads, calls `ia_intake_submit` with the service role, stores files in the private bucket and returns a
    reference plus a 256-bit tracking token (only its SHA-256 is stored). A member's bearer token is verified
    server-side; a public caller's `officerId` and "supervisor referral" flag are discarded.
  - `ia-evidence` (staff): authenticates, asks the database whether *this user* may upload or open a file on *this
    case* (audited), then signs a 60-second URL or stores the upload. The service role never reaches the browser.
- **Storage.** Private bucket `tpd-ia-evidence` (25 MB, images/video/PDF). No public URLs, no client-side signing.
- **Audit.** `tpd.ia_audit_events` is append-only and separate from `tpd.audit_log` (which Captains can read). Every
  case view, file open, assignment, finding, decision and disclosure is logged with the actor.
- **Immutability.** Interviews, notes, reports, reviews, evidence, disclosures and audit rows cannot be edited or
  deleted. Cases, allegations, tasks and appointments cannot be deleted. Findings lock once the report is submitted.
  Closed cases are read-only except recording that the member was told the finding.
- **Notifications.** In-app only and content-free (kind + case id). Nothing about IA is sent to Discord or shown in
  supervisor dashboards or activity feeds.

## Workflow (IA SOP mapping)

1. **Intake** (§4): complaint arrives → case `intake`, bodycam preservation task due same day (24 h, capped at incident
   + 7 days), evidence preservation task due 48 h, alert to Director and Deputy Director.
2. **Routing** (§5): handler is chosen from the accused: IA member → Director only; Director or Major X-201 → Deputy
   Chief; Deputy Chief → Chief; Chief → recorded as an external referral by the Deputy Chief. The accused and a member
   complainant are always excluded from their own case. A public complaint cannot link a member, so the officer named
   in the free text is matched against IA staff and the oversight posts at intake: anyone matched is excluded and the
   case starts at the narrowest handler a match needs, until the higher authority links the verified member.
3. **Intake review → assign** (§5): lead links the verified member, assigns an investigator. The database refuses an
   assignee who is the accused, the complainant, or has declared a conflict. Due = 7 days (§6).
4. **Investigate** (§6, §7): notice to the member or a recorded reason to delay; evidence and AnchorCAD references;
   interviews (an accused interview requires a recorded notice and the Garrity attestation, and is blocked while a
   criminal referral is pending); possible crime → referral to the Deputy Chief, who decides.
5. **Findings** (§8): one of Sustained, Not Sustained, Exonerated, Unfounded per allegation, with rationale.
   A recommended discipline is accepted **only on a sustained allegation**.
6. **Report** (§6): submit needs every finding, the notice record, an accused interview or a reason, no open criminal
   referral and all preservation tasks done. IA cases go to Director review (not by the author); escalated cases go
   straight to the Deputy Chief.
7. **Decision** (§9): the Deputy Chief decides per sustained allegation. Termination goes to the Chief, who approves
   or declines (decline returns it to the Deputy Chief). **No discipline is ever created automatically.**
8. **Close** (§9, §11): non-sustained outcomes stay in the IA file only. Sustained outcomes create a *pending*
   "Roster Records tab entry" task; it is marked done only when the Deputy Chief or Chief confirms they made the entry.
   The site does not write to the roster sheet. The member is told the finding (§7); disclosures need Deputy Chief
   approval (§11).

## Deployment requirements (not done; each needs dede's go-ahead)

1. Apply `supabase/migrations/20261113000000_internal_affairs.sql` to the project (schema `tpd` only; District Five
   is untouched). It also creates the private bucket `tpd-ia-evidence`.
2. Set Edge Function secrets:
   - `IA_INTAKE_PEPPER`: random, at least 32 characters (`openssl rand -base64 48`). Without it intake returns 503.
   - `TURNSTILE_SECRET`: **leave unset for now.** The function supports Cloudflare Turnstile, but the form does not
     render the widget yet, so setting it would reject every complaint. Add the widget first if bots become a problem.
   - `ALLOWED_ORIGINS`: must include the site origin (already used by the other functions).
3. Deploy `ia-intake` and `ia-evidence` (`verify_jwt = false` is set in `supabase/config.toml`; both functions check
   authorization themselves).
4. The Deputy Chief appoints IA-01…06 at `/hq/internal-affairs/appointments` (bootstrap: X-102 must be on the roster).
5. Rebuild the site so `NEXT_PUBLIC_SUPABASE_*` are present; the "not connected" notices then disappear.

## Open policy questions (interim behaviour in brackets)

- **IA-01** Who is alerted to new complaints? [Director and Deputy Director; oversight posts if IA-01 is vacant.]
- **IA-02** Can the Chief appoint IA members if the Deputy Chief post is vacant? [No; only X-102.]
- **IA-03** When does the Deputy Director act as Director? [Only while IA-01 is vacant.]
- **IA-04** Which timezone is "the same day" for bodycam preservation? [24 hours from receipt; ties to PC-14.]
- **IA-05** How is written notice delivered and evidenced? [Investigator records method and time as an attestation.]
- **IA-06** What may a complainant learn? [Received / under review / closed, plus a statement the Deputy Chief approves.]
- **IA-07** Complaint against the Chief: who investigates? [Deputy Chief records an external referral only.]
- **IA-08** Do escalated cases (handled by the Deputy Chief or Chief) need Director review? [No.]
- **IA-09** Complaint against the Major X-201, who oversees IA? [Handled by the Deputy Chief, like a complaint against the Director: IA reports to the Major (§2) and §5 bars investigating your own supervisor. Changed 2026-11-14.]
- **IA-10** Exact Garrity warning text. [Not in the SOP; recorded as an attestation that it was given.]
- **IA-11** Discipline list and points. [HB §13 ladder: Infraction, Strike, Blackmark, Suspension, Demotion, Termination; no points are computed.]
- **IA-12** Can intake be closed without findings (e.g. out of scope)? [No; every case reaches findings or an external referral.]
- **IA-13** Daily Patrol Evaluations are referenced as a referral source but do not exist in this site. [Generic supervisor referral, Sergeant+.]
- **IA-14** Public uploads. [Images and PDF only, 3 × 5 MB; video as links. Staff may upload video up to 25 MB.]
- **IA-15** Retention: SOP says closed files are kept for the life of the department. [Nothing is deletable; no purge job.]
