"use client";

import { supabase } from "@/lib/backend/client";
import { DEFAULT_SETTINGS, type EvaluationSettings } from "./rules";
import {
  EvaluationError,
  NOT_ENABLED,
  type Award,
  type EligibleOfficer,
  type Entry,
  type EvaluationsApi,
  type ExportRow,
  type ObligationRow,
  type PersonRef,
  type Report,
  type ReportDetail,
  type Review,
  type ReportVersion,
} from "./types";

/* eslint-disable @typescript-eslint/no-explicit-any -- rows arrive as JSON from PostgREST and are mapped field by field below. */

function db() {
  const sb = supabase();
  if (!sb) throw new EvaluationError("The evaluations backend is unavailable.");
  return sb;
}
function fail(error: { message: string; code?: string } | null): never | void {
  if (!error) return;
  // The site can go live before the evaluation migration is applied: PostgREST then reports the RPC or table as missing.
  if (error.code === "PGRST202" || error.code === "PGRST205" || error.code === "42883" || error.code === "42P01") throw new EvaluationError(NOT_ENABLED, "not_enabled");
  throw new EvaluationError(error.message, error.code);
}
const ms = (v: string | null | undefined) => (v ? Date.parse(v) : null);
const hhmm = (t: string) => t.slice(0, 5);

function settings(raw: any): EvaluationSettings {
  if (!raw) return DEFAULT_SETTINGS;
  return {
    timezone: raw.timezone,
    dayStart: hhmm(raw.day_start),
    deadlineDayOffset: raw.deadline_day_offset,
    deadlineTime: hhmm(raw.deadline_time),
    minPatrolMinutes: raw.min_patrol_minutes,
    amendWindowDays: raw.amend_window_days,
    interim: raw.interim,
  };
}

function row(r: any): ObligationRow {
  return {
    obligationId: r.obligation_id,
    supervisor: { id: r.supervisor_id, name: r.supervisor_name, rank: r.supervisor_rank, callsign: r.supervisor_callsign },
    patrolDate: r.patrol_date,
    source: r.source,
    status: r.status,
    deadline: Date.parse(r.deadline),
    dayStart: Date.parse(r.day_start),
    reportId: r.report_id,
    reportStatus: r.report_status,
    noObservations: !!r.no_observations,
    entryCount: r.entry_count ?? 0,
    submittedAt: ms(r.submitted_at),
    firstSubmittedAt: ms(r.first_submitted_at),
    late: !!r.late,
    version: r.version ?? 0,
    reviewedAt: ms(r.reviewed_at),
    excuseReason: r.excuse_reason,
  };
}

const REPORT_COLUMNS =
  "id,supervisor_id,patrol_date,status,no_observations,version,author_name,author_rank,author_callsign,first_submitted_at,submitted_at,late,reopened_at,reviewed_at," +
  "dpe_entries(id,position,officer_id,officer_name,officer_rank,officer_callsign,category,justification,award_id,award_text,dpe_awards(name))";

function entry(e: any): Entry {
  return {
    id: e.id,
    position: e.position,
    officer: { id: e.officer_id, name: e.officer_name, rank: e.officer_rank, callsign: e.officer_callsign },
    category: e.category,
    justification: e.justification,
    awardId: e.award_id,
    awardText: e.award_text,
    award: e.dpe_awards?.name ?? e.award_text ?? null,
  };
}

function report(r: any): Report {
  return {
    id: r.id,
    supervisorId: r.supervisor_id,
    patrolDate: r.patrol_date,
    status: r.status,
    noObservations: r.no_observations,
    version: r.version,
    author: { id: r.supervisor_id, name: r.author_name, rank: r.author_rank, callsign: r.author_callsign },
    firstSubmittedAt: ms(r.first_submitted_at),
    submittedAt: ms(r.submitted_at),
    late: r.late,
    reopenedAt: ms(r.reopened_at),
    reviewedAt: ms(r.reviewed_at),
    entries: ((r.dpe_entries ?? []) as any[]).map(entry).sort((a, b) => a.position - b.position),
  };
}

async function detail(base: any): Promise<ReportDetail> {
  const [versions, reviews] = await Promise.all([
    db().from("dpe_report_versions").select("version,kind,reason,at,content").eq("report_id", base.id).order("version"),
    db().from("dpe_reviews").select("id,officer_id,category,stage,decision,reason,actor_name,actor_rank,at").eq("report_id", base.id).order("at"),
  ]);
  fail(versions.error);
  // Authors cannot read command decisions (RLS returns none), which is expected.
  return {
    ...report(base),
    versions: ((versions.data ?? []) as any[]).map((v): ReportVersion => ({ version: v.version, kind: v.kind, reason: v.reason, at: Date.parse(v.at), content: v.content })),
    reviews: ((reviews.data ?? []) as any[]).map(
      (v): Review => ({ id: String(v.id), officerId: v.officer_id, category: v.category, stage: v.stage, decision: v.decision, reason: v.reason, actorName: v.actor_name, actorRank: v.actor_rank, at: Date.parse(v.at) }),
    ),
  };
}

export const liveEvaluations: EvaluationsApi = {
  mode: "live",
  async overview() {
    const { data, error } = await db().rpc("dpe_my_overview");
    fail(error);
    const d = data as any;
    return {
      required: !!d.required,
      today: d.today,
      now: Date.parse(d.now),
      settings: settings(d.settings),
      supervisor: d.supervisor,
      todayMinutes: d.today_minutes ?? 0,
      rows: ((d.rows ?? []) as any[]).map(row),
    };
  },
  async eligibleOfficers(patrolDate) {
    const { data, error } = await db().rpc("dpe_eligible_officers", { p_date: patrolDate });
    fail(error);
    return ((data ?? []) as any[]).map((o): EligibleOfficer => ({ id: o.id, name: o.name, callsign: o.callsign, rank: o.rank, district: o.district, patrolled: o.patrolled }));
  },
  async awards() {
    const { data, error } = await db().from("dpe_awards").select("id,name,description,active").order("name");
    fail(error);
    return (data ?? []) as Award[];
  },
  async myReport(patrolDate) {
    const me = await db().rpc("dpe_my_overview");
    fail(me.error);
    const id = (me.data as any)?.supervisor?.id;
    const { data, error } = await db().from("dpe_reports").select(REPORT_COLUMNS).eq("patrol_date", patrolDate).eq("supervisor_id", id).maybeSingle();
    fail(error);
    return data ? detail(data) : null;
  },
  async save(patrolDate, mode, noObservations, entries, reason) {
    const { data, error } = await db().rpc("dpe_save_report", {
      p_patrol_date: patrolDate,
      p_mode: mode,
      p_no_observations: noObservations,
      p_entries: entries,
      p_reason: reason ?? null,
    });
    fail(error);
    const d = data as any;
    if (!d?.report_id) throw new EvaluationError("The report was not confirmed by the server.");
    return { reportId: d.report_id, status: d.status, version: d.version, late: d.late };
  },
  async compliance(from, to) {
    const { data, error } = await db().rpc("dpe_compliance", { p_from: from, p_to: to });
    fail(error);
    const d = data as any;
    return { now: Date.parse(d.now), today: d.today, rows: ((d.rows ?? []) as any[]).map(row) };
  },
  async reports({ from, to }) {
    const { data, error } = await db()
      .from("dpe_reports")
      .select(REPORT_COLUMNS)
      .eq("status", "submitted")
      .gte("patrol_date", from)
      .lte("patrol_date", to)
      .order("patrol_date", { ascending: false })
      .limit(500);
    fail(error);
    return ((data ?? []) as any[]).map(report);
  },
  async report(reportId) {
    const { data, error } = await db().from("dpe_reports").select(REPORT_COLUMNS).eq("id", reportId).single();
    fail(error);
    return detail(data);
  },
  async review(reportId, stage, decision, reason, officerId) {
    const { error } = await db().rpc("dpe_review", { p_report: reportId, p_stage: stage, p_decision: decision, p_reason: reason, p_officer: officerId ?? null });
    fail(error);
  },
  async assign(supervisorId, dates, note) {
    const { data, error } = await db().rpc("dpe_assign", { p_supervisor: supervisorId, p_dates: dates, p_note: note });
    fail(error);
    return data as number;
  },
  async cancelAssignment(supervisorId, date, reason) {
    const { error } = await db().rpc("dpe_cancel_assignment", { p_supervisor: supervisorId, p_date: date, p_reason: reason });
    fail(error);
  },
  async assignments(from, to) {
    const { data, error } = await db()
      .from("dpe_assignments")
      .select("id,supervisor_id,patrol_date,note")
      .is("cancelled_at", null)
      .gte("patrol_date", from)
      .lte("patrol_date", to);
    fail(error);
    return ((data ?? []) as any[]).map((a) => ({ id: a.id, supervisorId: a.supervisor_id, patrolDate: a.patrol_date, note: a.note }));
  },
  async excuse(supervisorId, date, reason) {
    const { error } = await db().rpc("dpe_excuse", { p_supervisor: supervisorId, p_date: date, p_reason: reason });
    fail(error);
  },
  async revokeExcusal(excusalId, reason) {
    const { error } = await db().rpc("dpe_revoke_excusal", { p_excusal: excusalId, p_reason: reason });
    fail(error);
  },
  async excusals(from, to) {
    const { data, error } = await db()
      .from("dpe_excusals")
      .select("id,supervisor_id,patrol_date,reason,granted_at")
      .is("revoked_at", null)
      .gte("patrol_date", from)
      .lte("patrol_date", to);
    fail(error);
    return ((data ?? []) as any[]).map((x) => ({ id: x.id, supervisorId: x.supervisor_id, patrolDate: x.patrol_date, reason: x.reason, grantedAt: Date.parse(x.granted_at) }));
  },
  async exportRows(from, to) {
    const { data, error } = await db().rpc("dpe_export", { p_from: from, p_to: to });
    fail(error);
    return (data ?? []) as ExportRow[];
  },
  async saveAward(name, description, active) {
    const { error } = await db().rpc("dpe_save_award", { p_name: name, p_description: description, p_active: active });
    fail(error);
  },
  async supervisors() {
    const { data, error } = await db().rpc("list_member_directory");
    fail(error);
    return ((data ?? []) as any[])
      .filter((p) => p.rank === "Sergeant" || p.rank === "Lieutenant")
      .map((p): PersonRef => ({ id: p.id, name: p.name, rank: p.rank, callsign: p.callsign }));
  },
};
