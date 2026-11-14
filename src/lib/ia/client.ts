"use client";

/**
 * Browser calls for Internal Affairs. Every call goes to a SECURITY DEFINER function or an
 * Edge Function that re-checks access; nothing here decides authorization.
 */

import { supabase } from "@/lib/backend/client";
import { backendConfigured, SUPABASE_ANON_KEY, SUPABASE_URL } from "@/lib/backend/config";
import type { ComplaintInput, FieldErrors } from "../../../supabase/functions/_shared/ia.ts";
import type { AppointmentRow, CaseDetail, CaseRow, IaAccess, StaffMember } from "./model";

export const intakeAvailable = backendConfigured;

function sb() {
  const c = supabase();
  if (!c) throw new Error("Internal Affairs is not connected.");
  return c;
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await sb().rpc(fn, args);
  if (error) throw new Error(error.message || "The request failed.");
  return data as T;
}

export const ia = {
  access: () => rpc<IaAccess>("ia_my_access"),
  dashboard: () => rpc<CaseRow[]>("ia_dashboard"),
  detail: (id: string) => rpc<CaseDetail>("ia_case_detail", { p_case: id }),
  staff: () => rpc<StaffMember[]>("ia_staff"),
  notifications: () => rpc<{ id: number; kind: string; case_id: string | null; created_at: string; read: boolean }[]>("ia_my_notifications"),
  markRead: () => rpc<number>("ia_mark_notifications_read"),
  appointments: () => rpc<AppointmentRow[]>("ia_appointments_list"),
  appoint: (personnelId: string, callsign: string, reason: string) => rpc<string>("ia_appoint", { p_personnel: personnelId, p_callsign: callsign, p_reason: reason }),
  endAppointment: (id: string, reason: string) => rpc<boolean>("ia_end_appointment", { p_appointment: id, p_reason: reason }),
  openCase: (a: { source: "ia_opened" | "use_of_force_review"; category: string; accused: string | null; summary: string; description: string; incidentDate: string | null }) =>
    rpc<string>("ia_open_case", { p_source: a.source, p_category: a.category, p_accused: a.accused, p_summary: a.summary, p_description: a.description, p_incident_date: a.incidentDate }),
  acceptIntake: (id: string, accused: string | null, note: string) => rpc<string>("ia_accept_intake", { p_case: id, p_accused: accused, p_note: note }),
  assign: (id: string, investigator: string, conflictCheck: string) => rpc<boolean>("ia_assign", { p_case: id, p_investigator: investigator, p_conflict_check: conflictCheck }),
  declareConflict: (id: string, note: string) => rpc<boolean>("ia_declare_conflict", { p_case: id, p_note: note }),
  attestNoConflict: (id: string, note: string) => rpc<boolean>("ia_attest_no_conflict", { p_case: id, p_note: note }),
  extend: (id: string, due: string, reason: string) => rpc<boolean>("ia_extend", { p_case: id, p_new_due: due, p_reason: reason }),
  addAllegation: (id: string, category: string, description: string) => rpc<string>("ia_add_allegation", { p_case: id, p_category: category, p_description: description }),
  recordNotice: (id: string, delayed: boolean, note: string) => rpc<boolean>("ia_record_notice", { p_case: id, p_delayed: delayed, p_note: note }),
  addEvidence: (id: string, kind: string, description: string, ref: string | null) => rpc<string>("ia_add_evidence", { p_case: id, p_kind: kind, p_description: description, p_external_ref: ref }),
  completeTask: (taskId: string, note: string) => rpc<boolean>("ia_complete_task", { p_task: taskId, p_note: note }),
  recordInterview: (id: string, a: { kind: string; interviewee: string; conductedAt: string; garrityReadAt: string | null; observer: string | null; summary: string }) =>
    rpc<string>("ia_record_interview", { p_case: id, p_kind: a.kind, p_interviewee: a.interviewee, p_conducted_at: a.conductedAt, p_garrity_read_at: a.garrityReadAt, p_observer: a.observer, p_summary: a.summary }),
  addNote: (id: string, body: string) => rpc<string>("ia_add_note", { p_case: id, p_body: body }),
  criminalReferral: (id: string, note: string) => rpc<boolean>("ia_criminal_referral", { p_case: id, p_note: note }),
  criminalDecision: (id: string, opened: boolean, note: string) => rpc<boolean>("ia_criminal_decision", { p_case: id, p_opened: opened, p_note: note }),
  recordFinding: (allegationId: string, finding: string, rationale: string, recommended: string | null) =>
    rpc<boolean>("ia_record_finding", { p_allegation: allegationId, p_finding: finding, p_rationale: rationale, p_recommended: recommended }),
  submitReport: (id: string, body: string, noAccusedInterviewReason: string | null) => rpc<number>("ia_submit_report", { p_case: id, p_body: body, p_no_accused_interview_reason: noAccusedInterviewReason }),
  directorReview: (id: string, approve: boolean, notes: string) => rpc<string>("ia_director_review", { p_case: id, p_approve: approve, p_notes: notes }),
  decide: (id: string, outcomes: Record<string, string>, rationale: string) => rpc<string>("ia_decide", { p_case: id, p_outcomes: outcomes, p_rationale: rationale }),
  chiefTermination: (id: string, approve: boolean, notes: string) => rpc<string>("ia_chief_termination", { p_case: id, p_approve: approve, p_notes: notes }),
  findingsNotice: (id: string, method: string) => rpc<boolean>("ia_record_findings_notice", { p_case: id, p_method: method }),
  approveDisclosure: (id: string, body: string) => rpc<string>("ia_approve_disclosure", { p_case: id, p_body: body }),

  async evidenceUrl(evidenceId: string): Promise<string> {
    const { data, error } = await sb().functions.invoke("ia-evidence", { body: { action: "download", evidenceId } });
    if (error || typeof data?.url !== "string") throw new Error("The file could not be opened.");
    return data.url;
  },
  async uploadEvidence(caseId: string, kind: string, description: string, file: File): Promise<string> {
    const form = new FormData();
    form.set("caseId", caseId);
    form.set("kind", kind);
    form.set("description", description);
    form.set("file", file);
    const { data, error } = await sb().functions.invoke("ia-evidence", { body: form });
    if (error) {
      let msg = "The file could not be uploaded.";
      try {
        const ctx = (error as { context?: Response }).context;
        if (ctx) msg = (await ctx.json()).error ?? msg;
      } catch {
        /* generic */
      }
      throw new Error(msg);
    }
    return String(data?.evidenceId ?? "");
  },
};

export type SubmitResult =
  | { ok: true; reference: string; token: string; files: { received: number; stored: number } }
  | { ok: false; status: number; message: string; fields?: FieldErrors };

/** Posts a complaint to the ia-intake Edge Function. A signed-in member's session is attached when present. */
export async function submitComplaint(input: ComplaintInput & { website?: string; challenge?: string }, files: File[]): Promise<SubmitResult> {
  if (!backendConfigured) return { ok: false, status: 503, message: "Complaint intake is not connected on this site yet." };
  const session = (await supabase()?.auth.getSession())?.data.session ?? null;
  const headers: Record<string, string> = { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${session?.access_token ?? SUPABASE_ANON_KEY}` };
  let body: BodyInit;
  const payload = { action: "submit", ...input };
  if (files.length) {
    const form = new FormData();
    form.set("complaint", JSON.stringify(payload));
    for (const f of files) form.append("evidence", f);
    body = form;
  } else {
    headers["content-type"] = "application/json";
    body = JSON.stringify(payload);
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ia-intake`, { method: "POST", headers, body });
    const b = await res.json().catch(() => ({}));
    if (res.status === 201 && typeof b.reference === "string" && typeof b.token === "string") return { ok: true, reference: b.reference, token: b.token, files: b.files ?? { received: 0, stored: 0 } };
    return { ok: false, status: res.status, message: typeof b.error === "string" ? b.error : "Your complaint could not be submitted. Nothing was saved; please try again.", fields: b.fields };
  } catch {
    return { ok: false, status: 0, message: "The connection failed. Nothing was saved; please try again." };
  }
}

export async function checkReceipt(reference: string, token: string): Promise<{ found: false } | { found: true; reference: string; received_on: string; status: "received" | "under_review" | "closed"; statement: string | null } | { error: string }> {
  if (!backendConfigured) return { error: "Status lookup is not connected on this site yet." };
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/ia-intake`, {
      method: "POST",
      headers: { apikey: SUPABASE_ANON_KEY, authorization: `Bearer ${SUPABASE_ANON_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "status", reference, token }),
    });
    const b = await res.json().catch(() => ({}));
    if (!res.ok) return { error: typeof b.error === "string" ? b.error : "The status could not be checked right now." };
    return b;
  } catch {
    return { error: "The connection failed. Try again." };
  }
}

/** Active-member directory for the officer picker. Null when the visitor is not a signed-in, verified member. */
export async function memberDirectory(): Promise<{ id: string; name: string; callsign: string | null; rank: string }[] | null> {
  const c = supabase();
  if (!c) return null;
  const { data: s } = await c.auth.getSession();
  if (!s.session) return null;
  const { data, error } = await c.rpc("list_member_directory");
  if (error || !Array.isArray(data)) return null;
  return data;
}
