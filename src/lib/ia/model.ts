/**
 * Internal Affairs vocabulary and view-model helpers. Pure (no React, no network) so it can be unit-tested.
 * Procedure source: TPD Internal Affairs Division SOP (cited as IA §n). Open questions: docs/POLICY_CONFLICTS.md (IA-xx).
 */

import { IA_CATEGORIES } from "../../../supabase/functions/_shared/ia.ts";

export { IA_CATEGORIES };

export type CaseStatus = "intake" | "unassigned" | "investigating" | "director_review" | "deputy_chief_review" | "chief_review" | "closed" | "referred_external";
export type Handler = "ia" | "ia_director" | "deputy_chief" | "chief" | "external";
export type Finding = "sustained" | "not_sustained" | "exonerated" | "unfounded";
export type IaRole = "director" | "deputy_director" | "investigator";
export type IaPost = "chief" | "deputy_chief" | "major_admin";

export const STATUS_LABEL: Record<CaseStatus, string> = {
  intake: "Awaiting intake review",
  unassigned: "Unassigned",
  investigating: "Under investigation",
  director_review: "Director review",
  deputy_chief_review: "Deputy Chief decision",
  chief_review: "Chief approval (termination)",
  closed: "Closed",
  referred_external: "Referred outside the department",
};

export const HANDLER_LABEL: Record<Handler, string> = {
  ia: "Internal Affairs",
  ia_director: "IA Director (complaint against an IA member)",
  deputy_chief: "Deputy Chief (complaint against the IA Director)",
  chief: "Chief of Police (complaint against the Deputy Chief)",
  external: "Outside authority (complaint against the Chief)",
};

export const FINDINGS: { key: Finding; label: string; meaning: string }[] = [
  { key: "sustained", label: "Sustained", meaning: "The evidence shows the misconduct happened." },
  { key: "not_sustained", label: "Not sustained", meaning: "There is not enough evidence to prove or disprove the allegation." },
  { key: "exonerated", label: "Exonerated", meaning: "The act happened, but it was lawful and within policy." },
  { key: "unfounded", label: "Unfounded", meaning: "The evidence shows the act did not happen, or the member was not involved." },
];
export const FINDING_LABEL = Object.fromEntries(FINDINGS.map((f) => [f.key, f.label])) as Record<Finding, string>;

/** HB §13 ladder. "Infraction" is the handbook's wording for a Warning (PC-20). */
export const DISCIPLINES = [
  { key: "none", label: "No discipline" },
  { key: "Infraction", label: "Infraction (Warning, 1 point)" },
  { key: "Strike", label: "Strike (3 points)" },
  { key: "Blackmark", label: "Blackmark (5 points)" },
  { key: "Suspension", label: "Suspension" },
  { key: "Demotion", label: "Demotion" },
  { key: "Termination", label: "Termination (needs the Chief)" },
] as const;
export type Discipline = (typeof DISCIPLINES)[number]["key"];

export const ROLE_LABEL: Record<IaRole, string> = { director: "Director", deputy_director: "Deputy Director", investigator: "Investigator" };
export const POST_LABEL: Record<IaPost, string> = { chief: "Chief of Police", deputy_chief: "Deputy Chief", major_admin: "Major, Administrative Operations" };

export const EVIDENCE_KINDS = [
  { key: "bodycam", label: "Bodycam" },
  { key: "anchorcad_record", label: "AnchorCAD record" },
  { key: "report", label: "Report" },
  { key: "screenshot", label: "Screenshot" },
  { key: "video", label: "Video" },
  { key: "recording", label: "Recording" },
  { key: "document", label: "Document" },
  { key: "link", label: "Link" },
  { key: "other", label: "Other" },
] as const;

export const categoryLabel = (k: string) => IA_CATEGORIES.find((c) => c.key === k)?.label ?? k;

export interface CaseRow {
  id: string;
  case_number: string;
  status: CaseStatus;
  handler: Handler;
  category: string;
  summary: string;
  received_at: string;
  source: string;
  accused: string | null;
  accused_verified: boolean;
  investigator: string | null;
  assigned_to_me: boolean;
  due_at: string | null;
  overdue: boolean;
  open_preservation: number;
  preservation_overdue: boolean;
  roster_update_pending: boolean;
  criminal_pending: boolean;
}

export type Queue = "intake" | "unassigned" | "active" | "director_review" | "decision" | "closed" | "overdue" | "preservation" | "mine";

export const QUEUES: { key: Queue; label: string; test: (r: CaseRow) => boolean }[] = [
  { key: "intake", label: "New complaints", test: (r) => r.status === "intake" },
  { key: "unassigned", label: "Unassigned", test: (r) => r.status === "unassigned" },
  { key: "active", label: "Active investigations", test: (r) => r.status === "investigating" },
  { key: "director_review", label: "Director review", test: (r) => r.status === "director_review" },
  { key: "decision", label: "Deputy Chief decision", test: (r) => r.status === "deputy_chief_review" || r.status === "chief_review" },
  { key: "overdue", label: "Overdue", test: (r) => r.overdue },
  { key: "preservation", label: "Evidence preservation", test: (r) => r.open_preservation > 0 && r.status !== "closed" },
  { key: "closed", label: "Closed", test: (r) => r.status === "closed" || r.status === "referred_external" },
  { key: "mine", label: "Assigned to me", test: (r) => r.assigned_to_me && r.status !== "closed" },
];

export function queueCounts(rows: CaseRow[]): Record<Queue, number> {
  return Object.fromEntries(QUEUES.map((q) => [q.key, rows.filter(q.test).length])) as Record<Queue, number>;
}

/** Restrained status tone: only things that need action get color. */
export function statusTone(r: Pick<CaseRow, "status" | "overdue" | "preservation_overdue">): "neutral" | "amber" | "red" | "info" {
  if (r.overdue || r.preservation_overdue) return "red";
  if (r.status === "intake" || r.status === "unassigned") return "amber";
  if (r.status === "closed" || r.status === "referred_external") return "neutral";
  return "info";
}

/** "Due in 3 days" / "Overdue by 2 days" against the 7-day target (IA §6). */
export function dueText(dueAt: string | null, now = Date.now()): string | null {
  if (!dueAt) return null;
  const ms = new Date(dueAt).getTime() - now;
  const days = Math.round(Math.abs(ms) / 86_400_000);
  const hours = Math.round(Math.abs(ms) / 3_600_000);
  const span = days >= 1 ? `${days} day${days === 1 ? "" : "s"}` : `${Math.max(hours, 1)} hour${hours === 1 ? "" : "s"}`;
  return ms < 0 ? `Overdue by ${span}` : `Due in ${span}`;
}

export interface Allegation {
  id: string;
  ord: number;
  category: string;
  description: string;
  finding: Finding | null;
  finding_rationale: string | null;
  recommended_discipline: Discipline | null;
  finding_at: string | null;
}

export interface CaseDetail {
  case: Omit<CaseRow, "accused" | "investigator"> & {
    description: string;
    incident_date: string | null;
    incident_time_approx: string | null;
    location: string | null;
    reported_officer: string | null;
    witnesses: string | null;
    evidence_links: string[];
    accused: { id: string; name: string; callsign: string | null; rank: string } | null;
    investigator: { id: string; name: string; callsign: string | null } | null;
    assigned_at: string | null;
    accused_notice: "notified" | "delayed" | null;
    accused_notice_at: string | null;
    accused_notice_note: string | null;
    criminal_referral_at: string | null;
    criminal_referral_note: string | null;
    criminal_decision: "opened" | "not_opened" | null;
    closed_at: string | null;
    findings_notice_at: string | null;
    findings_notice_method: string | null;
  };
  complainant: { anonymous: boolean; name: string | null; contact: string | null; member_id: string | null; member_name: string | null } | null;
  receipt_reference: string | null;
  allegations: Allegation[];
  evidence: { id: string; kind: string; description: string; external_ref: string | null; has_file: boolean; mime_type: string | null; size_bytes: number | null; submitted_by_public: boolean; added_at: string }[];
  tasks: { id: string; kind: "bodycam_preservation" | "evidence_preservation" | "roster_record_update"; detail: string; due_at: string | null; completed_at: string | null; completion_note: string | null }[];
  interviews: { id: string; kind: "complainant" | "witness" | "accused"; interviewee: string; conducted_at: string; garrity_read_at: string | null; observer: string | null; summary: string; conducted_by_name: string }[];
  notes: { id: string; body: string; created_at: string; author_name: string }[];
  conflicts: { id: string; kind: "declared_conflict" | "no_conflict_attested"; note: string; recorded_at: string; name: string }[];
  reports: { id: string; version: number; body: string; no_accused_interview_reason: string | null; submitted_at: string; author_name: string }[];
  reviews: { id: string; stage: "director" | "chief_termination"; outcome: "approved" | "returned"; notes: string; reviewed_at: string; reviewer_name: string }[];
  decisions: { id: string; rationale: string; outcomes: { allegation_id: string; ord: number; finding: Finding; discipline: Discipline | null }[]; termination: boolean; decided_at: string; superseded_at: string | null; decided_by_name: string }[];
  disclosures: { id: string; body: string; approved_at: string }[];
  audit: { at: string; action: string; actor: string; detail: Record<string, unknown> }[];
  me: { is_lead: boolean; is_worker: boolean; is_assigned: boolean; can_review: boolean; can_decide: boolean; can_approve_termination: boolean; can_confirm_roster: boolean };
}

export interface IaAccess {
  personnel_id: string | null;
  ia_role: IaRole | null;
  post: IaPost | null;
  can_appoint: boolean;
  has_access: boolean;
  unread: number;
}

export interface StaffMember {
  appointment_id: string;
  personnel_id: string;
  name: string;
  callsign: string | null;
  rank: string;
  role: IaRole;
  ia_callsign: string;
}

/** What the current user can do next on this case, in workflow order. Mirrors the server checks for display only. */
export function nextSteps(d: CaseDetail): string[] {
  const c = d.case;
  const out: string[] = [];
  if (c.status === "intake" && d.me.is_lead) out.push("Review intake and link the member if identifiable");
  if (c.status === "unassigned" && d.me.is_lead) out.push("Assign an investigator after a conflict check (IA §5)");
  if (c.status === "investigating" && d.me.is_worker) {
    if (d.tasks.some((t) => !t.completed_at && t.kind !== "roster_record_update")) out.push("Complete evidence preservation");
    if (c.accused && !c.accused_notice) out.push("Record written notice to the member, or an authorized delay (IA §6)");
    if (!d.interviews.some((i) => i.kind === "accused")) out.push("Interview witnesses, then the member after the Garrity warning (IA §7)");
    if (d.allegations.some((a) => !a.finding)) out.push("Record a finding for every allegation (IA §8)");
    out.push("Submit the written case report");
  }
  if (c.status === "director_review" && d.me.can_review) out.push("Review the report (IA §6)");
  if (c.status === "deputy_chief_review" && d.me.can_decide) out.push("Decide the outcome for each sustained allegation (IA §9)");
  if (c.status === "chief_review" && d.me.can_approve_termination) out.push("Approve or decline the termination (IA §9)");
  if (c.status === "closed") {
    if (!c.findings_notice_at && (d.me.is_lead || d.me.can_decide)) out.push("Record that the member was told the finding (IA §7)");
    if (d.tasks.some((t) => t.kind === "roster_record_update" && !t.completed_at) && d.me.can_confirm_roster) out.push("Confirm the Records tab entry on the TPD Roster (IA §9)");
  }
  return out;
}

export const AUDIT_LABEL: Record<string, string> = {
  "case.received": "Complaint received",
  "case.opened": "Case opened",
  "case.viewed": "Case file viewed",
  "case.assigned": "Investigator assigned",
  "case.closed": "Case closed",
  "intake.accepted": "Intake reviewed",
  "conflict.declared": "Conflict of interest declared",
  "conflict.none_attested": "No conflict attested",
  "deadline.extended": "Deadline extended",
  "allegation.added": "Allegation added",
  "notice.delivered": "Member notified",
  "notice.delayed": "Notice delayed",
  "evidence.added": "Evidence logged",
  "evidence.received": "Evidence received with complaint",
  "evidence.file_added": "Evidence file uploaded",
  "evidence.downloaded": "Evidence file opened",
  "task.completed": "Task completed",
  "interview.recorded": "Interview recorded",
  "note.added": "Note added",
  "criminal.referred": "Possible crime referred to the Deputy Chief",
  "criminal.opened": "Criminal investigation opened",
  "criminal.not_opened": "No criminal investigation",
  "finding.recorded": "Finding recorded",
  "report.submitted": "Report submitted",
  "review.approved": "Report approved",
  "review.returned": "Report returned",
  "decision.recorded": "Decision recorded",
  "termination.approved": "Termination approved",
  "termination.declined": "Termination declined",
  "findings.member_notified": "Member told the finding",
  "disclosure.approved": "Disclosure approved",
};

export interface AppointmentRow {
  id: string;
  callsign: string;
  role: IaRole;
  name: string;
  member_callsign: string | null;
  appointed_at: string;
  ended_at: string | null;
  reason: string;
  end_reason: string | null;
  /** Who the roster's division slot with this call sign shows, so a mismatch can be fixed on the roster. */
  roster_slot_holder: string | null;
}

/** IA §1: IA-01 Director, IA-02 Deputy Director, IA-03 to IA-06 investigators. */
export const IA_CALLSIGNS: { callsign: string; role: IaRole }[] = [
  { callsign: "IA-01", role: "director" },
  { callsign: "IA-02", role: "deputy_director" },
  { callsign: "IA-03", role: "investigator" },
  { callsign: "IA-04", role: "investigator" },
  { callsign: "IA-05", role: "investigator" },
  { callsign: "IA-06", role: "investigator" },
];
