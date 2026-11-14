/**
 * DESIGN PREVIEW ONLY. Fictional Internal Affairs cases for the labelled preview build (no backend configured).
 * No real members, no real complaints. The live site never reads this module: with a backend configured every
 * IA screen loads from the database through the SECURITY DEFINER functions, and actions run there.
 */

import type { AppointmentRow, CaseDetail, CaseRow, IaAccess, StaffMember } from "./model";

const H = 3_600_000;
const D = 24 * H;
const iso = (offset: number) => new Date(Date.now() + offset).toISOString();

export const PREVIEW_ACCESS: IaAccess = { personnel_id: "p-dir", ia_role: "director", post: null, can_appoint: false, has_access: true, unread: 2 };

export const PREVIEW_STAFF: StaffMember[] = [
  { appointment_id: "ap-1", personnel_id: "p-dir", name: "R. Alvarez", callsign: "X-303", rank: "Captain", role: "director", ia_callsign: "IA-01" },
  { appointment_id: "ap-2", personnel_id: "p-dd", name: "T. Brooks", callsign: "X-304", rank: "Lieutenant", role: "deputy_director", ia_callsign: "IA-02" },
  { appointment_id: "ap-3", personnel_id: "p-i1", name: "M. Chen", callsign: "X-415", rank: "Senior Officer", role: "investigator", ia_callsign: "IA-03" },
  { appointment_id: "ap-4", personnel_id: "p-i2", name: "S. Okafor", callsign: "X-418", rank: "Corporal", role: "investigator", ia_callsign: "IA-04" },
];

const row = (r: Partial<CaseRow> & Pick<CaseRow, "id" | "case_number" | "status" | "category" | "summary" | "received_at">): CaseRow => ({
  handler: "ia",
  source: "public",
  accused: null,
  accused_verified: false,
  investigator: null,
  assigned_to_me: false,
  due_at: null,
  overdue: false,
  open_preservation: 0,
  preservation_overdue: false,
  roster_update_pending: false,
  criminal_pending: false,
  ...r,
});

export const PREVIEW_CASES: CaseRow[] = [
  row({ id: "c-1", case_number: "IA-2026-0014", status: "intake", category: "public_conduct", summary: "Discourteous language during a traffic stop", received_at: iso(-3 * H), accused: "Officer named as “X-4?? on the pier”", open_preservation: 2 }),
  row({ id: "c-2", case_number: "IA-2026-0013", status: "unassigned", category: "use_of_force", summary: "Takedown during arrest outside the bank", received_at: iso(-20 * H), source: "member", accused: "X-421 D. Mercer", accused_verified: true, open_preservation: 1, preservation_overdue: false }),
  row({ id: "c-3", case_number: "IA-2026-0011", status: "investigating", category: "abuse_of_authority", summary: "Threatened arrest without cause on 5th Street", received_at: iso(-4 * D), source: "member", accused: "X-430 J. Patel", accused_verified: true, investigator: "X-415 M. Chen", due_at: iso(3 * D) }),
  row({ id: "c-4", case_number: "IA-2026-0009", status: "investigating", category: "dishonesty", summary: "Report times do not match the CAD log", received_at: iso(-9 * D), source: "supervisor_referral", accused: "X-436 K. Romero", accused_verified: true, investigator: "X-418 S. Okafor", due_at: iso(-1 * D), overdue: true }),
  row({ id: "c-5", case_number: "IA-2026-0008", status: "director_review", category: "uof_policy", summary: "Taser deployed on a fleeing subject", received_at: iso(-8 * D), source: "use_of_force_review", accused: "X-412 L. Grant", accused_verified: true, investigator: "X-415 M. Chen", due_at: iso(-1 * D) }),
  row({ id: "c-6", case_number: "IA-2026-0006", status: "deputy_chief_review", category: "handbook_policy", summary: "Repeated unauthorized vehicle use", received_at: iso(-12 * D), source: "supervisor_referral", accused: "X-440 P. Novak", accused_verified: true, investigator: "X-418 S. Okafor" }),
  row({ id: "c-7", case_number: "IA-2026-0004", status: "closed", category: "public_conduct", summary: "Refused to give a call sign when asked", received_at: iso(-20 * D), accused: "X-425 A. Fields", accused_verified: true, investigator: "X-415 M. Chen", roster_update_pending: true }),
  row({ id: "c-8", case_number: "IA-2026-0002", status: "closed", category: "use_of_force", summary: "Use of force during a pursuit stop", received_at: iso(-26 * D), accused: "X-433 B. Ortiz", accused_verified: true, investigator: "X-418 S. Okafor" }),
];

/** One fully worked case so the detail layout can be reviewed. */
export function previewDetail(id: string): CaseDetail | null {
  const base = PREVIEW_CASES.find((c) => c.id === id);
  if (!base) return null;
  const investigating = base.status === "investigating";
  return {
    case: {
      ...base,
      description:
        "The complainant states that during a call on 5th Street the officer told them they would be arrested if they did not leave, although they were standing on the sidewalk and had not been given a lawful order. The complainant recorded part of the exchange.",
      incident_date: iso(-5 * D).slice(0, 10),
      incident_time_approx: "Around 9 PM",
      location: "5th Street, North District",
      reported_officer: "Officer with call sign ending 30",
      witnesses: "Two civilians at the bus stop (display names in the attached clip).",
      evidence_links: ["https://example.com/clip/preview"],
      accused: base.accused_verified ? { id: "p-acc", name: base.accused?.split(" ").slice(1).join(" ") ?? "", callsign: base.accused?.split(" ")[0] ?? null, rank: "Officer" } : null,
      investigator: base.investigator ? { id: "p-i1", name: base.investigator.split(" ").slice(1).join(" "), callsign: base.investigator.split(" ")[0] } : null,
      assigned_at: base.investigator ? iso(-4 * D) : null,
      accused_notice: investigating ? "notified" : null,
      accused_notice_at: investigating ? iso(-3 * D) : null,
      accused_notice_note: investigating ? "Written notice delivered by department mail with the allegation." : null,
      criminal_referral_at: null,
      criminal_referral_note: null,
      criminal_decision: null,
      closed_at: base.status === "closed" ? iso(-2 * D) : null,
      findings_notice_at: null,
      findings_notice_method: null,
    },
    complainant: { anonymous: false, name: "Preview complainant", contact: "Discord username (preview)", member_id: null, member_name: null },
    receipt_reference: "TPD-7KQ3-M9PX",
    allegations: [
      { id: "al-1", ord: 1, category: base.category, description: base.summary, finding: null, finding_rationale: null, recommended_discipline: null, finding_at: null },
      { id: "al-2", ord: 2, category: "public_conduct", description: "Raised voice and used discourteous language toward the complainant.", finding: null, finding_rationale: null, recommended_discipline: null, finding_at: null },
    ],
    evidence: [
      { id: "ev-1", kind: "link", description: "Complainant's clip of the exchange", external_ref: "https://example.com/clip/preview", has_file: false, mime_type: null, size_bytes: null, submitted_by_public: true, added_at: base.received_at },
      { id: "ev-2", kind: "anchorcad_record", description: "Dispatch log for the 5th Street call", external_ref: "AnchorCAD incident 4471", has_file: false, mime_type: null, size_bytes: null, submitted_by_public: false, added_at: iso(-3 * D) },
      { id: "ev-3", kind: "bodycam", description: "Bodycam export, both units", external_ref: null, has_file: true, mime_type: "video/mp4", size_bytes: 18_400_000, submitted_by_public: false, added_at: iso(-4 * D + 2 * H) },
    ],
    tasks: [
      { id: "t-1", kind: "bodycam_preservation", detail: "Request and save bodycam footage the same day the complaint is logged (IA §4). Footage is kept 7 days.", due_at: iso(-4 * D + 20 * H), completed_at: iso(-4 * D + 2 * H), completion_note: "Footage from both units saved to the case." },
      { id: "t-2", kind: "evidence_preservation", detail: "Preserve AnchorCAD logs, reports, screenshots and recordings (IA §6).", due_at: iso(-2 * D), completed_at: null, completion_note: null },
    ],
    interviews: investigating
      ? [
          { id: "iv-1", kind: "complainant", interviewee: "Complainant", conducted_at: iso(-3 * D), garrity_read_at: null, observer: null, summary: "Described the exchange and named two witnesses at the bus stop.", conducted_by_name: "M. Chen" },
          { id: "iv-2", kind: "witness", interviewee: "Witness one", conducted_at: iso(-2 * D), garrity_read_at: null, observer: null, summary: "Heard the officer say the complainant would be arrested if they stayed.", conducted_by_name: "M. Chen" },
        ]
      : [],
    notes: [{ id: "n-1", body: "Intake review: within IA scope; member identified from the CAD log.", created_at: iso(-4 * D), author_name: "R. Alvarez" }],
    conflicts: [{ id: "cf-1", kind: "no_conflict_attested", note: "Assignment conflict check: no supervisory or personal relationship.", recorded_at: iso(-4 * D), name: "R. Alvarez" }],
    reports: [],
    reviews: [],
    decisions: [],
    disclosures: [],
    audit: [
      { at: base.received_at, action: "case.received", actor: "system:ia-intake", detail: {} },
      { at: iso(-4 * D), action: "intake.accepted", actor: "R. Alvarez", detail: {} },
      { at: iso(-4 * D), action: "case.assigned", actor: "R. Alvarez", detail: {} },
      { at: iso(-4 * D + 2 * H), action: "task.completed", actor: "M. Chen", detail: {} },
      { at: iso(-3 * D), action: "notice.delivered", actor: "M. Chen", detail: {} },
      { at: iso(-3 * D), action: "interview.recorded", actor: "M. Chen", detail: {} },
    ],
    me: { is_lead: true, is_worker: true, is_assigned: false, can_review: true, can_decide: false, can_approve_termination: false, can_confirm_roster: false },
  };
}

export const PREVIEW_APPOINTMENTS: AppointmentRow[] = [
  ...PREVIEW_STAFF.map((s, i) => ({
    id: s.appointment_id,
    callsign: s.ia_callsign,
    role: s.role,
    name: s.name,
    member_callsign: s.callsign,
    appointed_at: iso(-(60 - i * 9) * D),
    ended_at: null,
    reason: "Appointed by the Deputy Chief under IA §12.",
    end_reason: null,
    roster_slot_holder: i === 3 ? null : s.name,
  })),
  { id: "ap-0", callsign: "IA-05", role: "investigator", name: "J. Ramos", member_callsign: "X-422", appointed_at: iso(-120 * D), ended_at: iso(-30 * D), reason: "Appointed by the Deputy Chief under IA §12.", end_reason: "Transferred to Patrol at the member's request.", roster_slot_holder: null },
];
