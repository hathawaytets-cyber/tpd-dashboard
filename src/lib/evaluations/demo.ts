"use client";

/**
 * DESIGN-PREVIEW implementation of the evaluations API. Fictional sample data in this browser only
 * (localStorage), following the same rules as the database functions so the screens can be reviewed and
 * tested without a backend. Live builds never use this module (see ./index.ts).
 */

import { atLeast, type Rank } from "@/lib/authz";
import { allMembers, currentMember, getPreviewState, memberById } from "@/lib/preview/store";
import type { Member } from "@/lib/sample-data";
import {
  CATEGORY_LABEL,
  DEFAULT_SETTINGS,
  ELIGIBLE_RANKS,
  JUSTIFICATION_MIN,
  REASON_MIN,
  REQUIRED_RANKS,
  addDays,
  dayEnd,
  dayStart,
  deadline,
  obligationSource,
  patrolDate,
  patrolMinutes,
  statusAt,
} from "./rules";
import {
  EvaluationError,
  type Assignment,
  type Award,
  type Entry,
  type EntryInput,
  type EvaluationsApi,
  type Excusal,
  type ExportRow,
  type ObligationRow,
  type PersonRef,
  type Report,
  type ReportDetail,
  type ReportVersion,
  type Review,
  type ReviewDecision,
  type ReviewStage,
} from "./types";

export const DEMO_KEY = "tpd-dpe-preview";
const VERSION = 1;
const S = DEFAULT_SETTINGS;

interface DemoObligation {
  id: string;
  supervisorId: string;
  patrolDate: string;
  source: "assignment" | "patrol";
  snapshot: PersonRef;
  voided: boolean;
}
interface DemoReport extends Report {
  obligationId: string;
}
interface DemoState {
  v: number;
  assignments: (Assignment & { cancelled: boolean })[];
  obligations: DemoObligation[];
  excusals: (Excusal & { revoked: boolean })[];
  loa: { memberId: string; from: string; to: string }[];
  reports: DemoReport[];
  versions: (ReportVersion & { reportId: string })[];
  reviews: (Review & { reportId: string })[];
  awards: Award[];
  audit: { at: number; actor: string; action: string; target: string }[];
}

let seq = 0;
const id = (p: string) => `${p}-${Date.now().toString(36)}${(seq++).toString(36)}`;
const ref = (m: Member): PersonRef => ({ id: m.id, name: m.name, rank: m.rank, callsign: m.callsign });
const isReporter = (m: Member) => (REQUIRED_RANKS as readonly string[]).includes(m.rank) && m.status !== "Suspended";
const isEligible = (m: Member) => (ELIGIBLE_RANKS as readonly string[]).includes(m.rank) && m.status !== "Suspended";
const isReviewer = (m: Member) => atLeast(m.rank as Rank, "Captain") && m.status !== "Suspended";
const isAwardAuthority = (m: Member) => ["Chief of Police", "Deputy Chief", "Assistant Chief"].includes(m.rank);
const me = () => currentMember(getPreviewState());
const sessionsOf = (memberId: string) => getPreviewState().sessions.filter((s) => s.memberId === memberId);

function deny(message: string): never {
  throw new EvaluationError(message, "42501");
}
function invalid(message: string): never {
  throw new EvaluationError(message, "22023");
}

// ------------------------------------------------------------------ storage

function read(): DemoState | null {
  try {
    const raw = localStorage.getItem(DEMO_KEY);
    const s = raw ? (JSON.parse(raw) as DemoState) : null;
    return s?.v === VERSION ? s : null;
  } catch {
    return null;
  }
}
/** Saves without notifying (derived obligations refreshed on read). */
function persist(s: DemoState) {
  try {
    localStorage.setItem(DEMO_KEY, JSON.stringify(s));
  } catch {}
}
/** Saves a user action and tells open screens to reload. */
function write(s: DemoState) {
  persist(s);
  window.dispatchEvent(new Event("tpd-dpe-change"));
}

function load(): DemoState {
  const s = read() ?? seed();
  syncObligations(s);
  return s;
}

/** Create obligations the way tpd.dpe_ensure_obligation does: assignment first, else a qualifying patrol. */
function ensure(s: DemoState, memberId: string, date: string): DemoObligation | null {
  const m = memberById(memberId);
  if (!m || !isReporter(m)) return null;
  const hasAssignment = s.assignments.some((a) => a.supervisorId === memberId && a.patrolDate === date && !a.cancelled);
  const source = obligationSource(hasAssignment, patrolMinutes(sessionsOf(memberId), date, S), S);
  if (!source) return null;
  let o = s.obligations.find((x) => x.supervisorId === memberId && x.patrolDate === date);
  if (!o) {
    o = { id: id("obl"), supervisorId: memberId, patrolDate: date, source, snapshot: ref(m), voided: false };
    s.obligations.push(o);
  } else if (o.voided || source === "assignment") {
    o.voided = false;
    o.source = source;
  }
  return o;
}

function syncObligations(s: DemoState) {
  const sessions = getPreviewState().sessions;
  for (const x of sessions) if (x.end !== null) ensure(s, x.memberId, patrolDate(x.start, S));
}

function seed(): DemoState {
  const now = Date.now();
  const today = patrolDate(now, S);
  const s: DemoState = { v: VERSION, assignments: [], obligations: [], excusals: [], loa: [], reports: [], versions: [], reviews: [], awards: [], audit: [] };
  const assign = (memberId: string, date: string, note = "District patrol supervision") =>
    s.assignments.push({ id: id("asg"), supervisorId: memberId, patrolDate: date, note, cancelled: false });
  // Sergeant persona (m-06) is assigned today and the last four days; m-11 (South) the last three; Lieutenant m-05 a week ago.
  for (let i = 0; i <= 4; i++) assign("m-06", addDays(today, -i));
  for (let i = 1; i <= 3; i++) assign("m-11", addDays(today, -i));
  for (let i = 6; i <= 8; i++) assign("m-05", addDays(today, -i));
  assign("m-06", addDays(today, 2));
  // Lieutenant m-05 is on approved leave (HB §5.4) for the last five days.
  s.loa.push({ memberId: "m-05", from: addDays(today, -5), to: addDays(today, 1) });
  assign("m-05", addDays(today, -2), "Assigned before leave was approved");
  for (const a of s.assignments) ensure(s, a.supervisorId, a.patrolDate);
  syncObligations(s);

  const file = (memberId: string, date: string, noObs: boolean, entries: Omit<EntryInput, never>[], at: number) => {
    const o = s.obligations.find((x) => x.supervisorId === memberId && x.patrolDate === date)!;
    const author = memberById(memberId)!;
    const r: DemoReport = {
      id: id("rep"), obligationId: o.id, supervisorId: memberId, patrolDate: date, status: "submitted", noObservations: noObs, version: 1,
      author: ref(author), firstSubmittedAt: at, submittedAt: at, late: at >= deadline(date, S), reopenedAt: null, reviewedAt: null,
      entries: toEntries(entries, s),
    };
    s.reports.push(r);
    s.versions.push({ reportId: r.id, version: 1, kind: "submitted", reason: null, at, content: snapshotContent(r) });
    return r;
  };
  file("m-06", addDays(today, -1), true, [], dayStart(today, S) - 3 * 3_600_000);
  file(
    "m-06",
    addDays(today, -2),
    false,
    [
      { officer_id: "m-09", category: "exceeding", justification: "Ran a clean felony stop on I-275, briefed responding units and kept the scene orderly." },
      { officer_id: "m-12", category: "needs_improvement", justification: "Radio traffic during the Dale Mabry pursuit was unclear; coached on concise updates afterwards." },
      { officer_id: "m-13", category: "award", justification: "Rendered aid at a rollover on Kennedy Blvd before Fire Rescue arrived.", award_text: "Lifesaving recognition" },
    ],
    dayStart(addDays(today, -1), S) - 2 * 3_600_000,
  );
  file("m-11", addDays(today, -1), true, [], dayStart(today, S) + 2 * 3_600_000);
  file("m-11", addDays(today, -3), false, [{ officer_id: "m-14", category: "exceeding", justification: "Covered two calls back to back while short-staffed in the South District." }], deadline(addDays(today, -3), S) + 3_600_000);
  // Older patrol days in the sample history were filed on time with nothing notable, so the preview opens on recent work.
  for (const ob of s.obligations) {
    if (ob.patrolDate < addDays(today, -4) && !s.reports.some((r) => r.obligationId === ob.id)) file(ob.supervisorId, ob.patrolDate, true, [], dayStart(addDays(ob.patrolDate, 1), S) - 5 * 3_600_000);
  }
  // m-11 started but did not finish the report two days ago: a draft that is now overdue.
  const o = s.obligations.find((x) => x.supervisorId === "m-11" && x.patrolDate === addDays(today, -2))!;
  s.reports.push({
    id: id("rep"), obligationId: o.id, supervisorId: "m-11", patrolDate: o.patrolDate, status: "draft", noObservations: false, version: 0,
    author: ref(memberById("m-11")!), firstSubmittedAt: null, submittedAt: null, late: false, reopenedAt: null, reviewedAt: null,
    entries: toEntries([{ officer_id: "m-12", category: "exceeding", justification: "" }], s),
  });
  persist(s);
  return s;
}

function toEntries(inputs: EntryInput[], s: DemoState): Entry[] {
  return inputs.map((e, i) => {
    const o = memberById(e.officer_id)!;
    const listed = e.category === "award" && e.award_id ? s.awards.find((a) => a.id === e.award_id) ?? null : null;
    const text = e.category === "award" && !listed ? e.award_text?.trim() || null : null;
    return { id: id("ent"), position: i + 1, officer: ref(o), category: e.category, justification: e.justification.trim(), awardId: listed?.id ?? null, awardText: text, award: listed?.name ?? text };
  });
}

function snapshotContent(r: Report): ReportVersion["content"] {
  return {
    no_observations: r.noObservations,
    entries: r.entries.map((e) => ({ officer_name: e.officer.name, officer_callsign: e.officer.callsign, category: e.category, justification: e.justification, award: e.award })),
  };
}

function excuseReason(s: DemoState, memberId: string, date: string): string | null {
  const x = s.excusals.find((e) => e.supervisorId === memberId && e.patrolDate === date && !e.revoked);
  if (x) return `Excused by command: ${x.reason}`;
  if (s.loa.some((l) => l.memberId === memberId && date >= l.from && date <= l.to)) return "Approved leave of absence";
  return null;
}

function rowsFor(s: DemoState, from: string, to: string, memberId: string | null, now: number): ObligationRow[] {
  return s.obligations
    .filter((o) => !o.voided && o.patrolDate >= from && o.patrolDate <= to && (!memberId || o.supervisorId === memberId))
    .map((o): ObligationRow => {
      const r = s.reports.find((x) => x.obligationId === o.id) ?? null;
      const excuse = excuseReason(s, o.supervisorId, o.patrolDate);
      return {
        obligationId: o.id, supervisor: o.snapshot, patrolDate: o.patrolDate, source: o.source,
        status: statusAt({ patrolDate: o.patrolDate, reportStatus: r?.status ?? null, excused: !!excuse }, now, S),
        deadline: deadline(o.patrolDate, S), dayStart: dayStart(o.patrolDate, S),
        reportId: r?.id ?? null, reportStatus: r?.status ?? null, noObservations: r?.noObservations ?? false, entryCount: r?.entries.length ?? 0,
        submittedAt: r?.submittedAt ?? null, firstSubmittedAt: r?.firstSubmittedAt ?? null, late: r?.late ?? false, version: r?.version ?? 0,
        reviewedAt: r?.reviewedAt ?? null, excuseReason: excuse,
      };
    })
    .sort((a, b) => (a.patrolDate === b.patrolDate ? a.supervisor.name.localeCompare(b.supervisor.name) : a.patrolDate < b.patrolDate ? 1 : -1));
}

const delay = () => new Promise((r) => setTimeout(r, 250));
function requireReviewer() {
  const m = me();
  if (!isReviewer(m)) deny("Command authorization required");
  return m;
}
const checkReason = (reason: string) => {
  if (!reason || reason.trim().length < REASON_MIN) invalid(`A reason of at least ${REASON_MIN} characters is required`);
};
function detailOf(s: DemoState, r: DemoReport, withReviews: boolean): ReportDetail {
  return {
    ...r,
    versions: s.versions.filter((v) => v.reportId === r.id).sort((a, b) => a.version - b.version),
    reviews: withReviews ? s.reviews.filter((v) => v.reportId === r.id).sort((a, b) => a.at - b.at) : [],
  };
}

// ---------------------------------------------------------------------- API

export const demoEvaluations: EvaluationsApi = {
  mode: "demo",
  async overview() {
    await delay();
    const s = load();
    const m = me();
    const now = Date.now();
    const today = patrolDate(now, S);
    persist(s);
    return {
      required: isReporter(m),
      today,
      now,
      settings: S,
      supervisor: ref(m),
      todayMinutes: patrolMinutes(sessionsOf(m.id), today, S),
      rows: rowsFor(s, addDays(today, -60), addDays(today, 14), m.id, now),
    };
  },
  async eligibleOfficers(date) {
    await delay();
    const m = me();
    if (!isReporter(m) && !isReviewer(m)) deny("Supervisor rank required");
    const from = dayStart(date, S);
    const to = dayEnd(date, S);
    return allMembers()
      .filter((o) => o.id !== m.id && isEligible(o))
      .map((o) => ({ ...ref(o), district: o.district === "Department" ? null : o.district, patrolled: sessionsOf(o.id).some((x) => x.start >= from && x.start < to) }))
      .sort((a, b) => Number(b.patrolled) - Number(a.patrolled) || a.name.localeCompare(b.name));
  },
  async awards() {
    return load().awards;
  },
  async myReport(date) {
    await delay();
    const s = load();
    const r = s.reports.find((x) => x.supervisorId === me().id && x.patrolDate === date);
    return r ? detailOf(s, r, false) : null;
  },
  async save(date, mode, noObservations, entries, reason) {
    await delay();
    const s = load();
    const m = me();
    if (!isReporter(m)) deny("Daily evaluations are filed by Sergeants and Lieutenants");
    const o = ensure(s, m.id, date);
    if (!o) invalid("No report is required for this patrol day");
    if (Date.now() < dayStart(date, S)) invalid("This patrol day has not started yet");
    if (noObservations && entries.length) invalid('Remove the observations or untick "No notable observations"');
    if (mode !== "draft" && !noObservations && entries.length === 0) invalid('Add at least one observation, or confirm "No notable observations"');
    const final = mode !== "draft";
    const seen = new Set<string>();
    entries.forEach((e, i) => {
      const off = memberById(e.officer_id);
      if (!off) invalid(`Observation ${i + 1}: officer not found`);
      if (off.id === m.id) deny("Supervisors cannot evaluate themselves");
      if (!isEligible(off)) deny(`Observation ${i + 1}: ${off.name} is not an eligible non-supervisory officer`);
      if (seen.has(`${off.id}:${e.category}`)) invalid(`Observation ${i + 1}: ${off.name} is already listed in this category`);
      seen.add(`${off.id}:${e.category}`);
      if (final && e.justification.trim().length < JUSTIFICATION_MIN) invalid(`Observation ${i + 1}: write a justification of at least ${JUSTIFICATION_MIN} characters`);
      if (final && e.category === "award" && !e.award_id && !e.award_text?.trim()) invalid(`Observation ${i + 1}: choose or name the recommended award`);
    });
    let r = s.reports.find((x) => x.obligationId === o.id);
    if (r?.status === "submitted" && mode !== "amend") throw new EvaluationError("A report for this patrol day has already been submitted. Use an amendment to correct it.", "23505");
    if (mode === "amend") {
      if (!r || r.status !== "submitted") invalid("Only a submitted report can be amended");
      checkReason(reason ?? "");
      if (!r.reopenedAt && (r.reviewedAt || Date.now() > (r.firstSubmittedAt ?? 0) + S.amendWindowDays * 86_400_000))
        deny("This report is locked. Ask command staff to reopen it for an amendment.");
    }
    if (!r) {
      r = { id: id("rep"), obligationId: o.id, supervisorId: m.id, patrolDate: date, status: "draft", noObservations, version: 0, author: ref(m), firstSubmittedAt: null, submittedAt: null, late: false, reopenedAt: null, reviewedAt: null, entries: [] };
      s.reports.push(r);
    }
    r.entries = toEntries(entries, s);
    r.noObservations = noObservations;
    r.author = ref(m);
    if (mode !== "draft") {
      const now = Date.now();
      if (!r.firstSubmittedAt) r.late = now >= deadline(date, S);
      r.firstSubmittedAt ??= now;
      r.submittedAt = now;
      r.status = "submitted";
      r.version += 1;
      r.reopenedAt = null;
      s.versions.push({ reportId: r.id, version: r.version, kind: mode === "amend" ? "amended" : "submitted", reason: mode === "amend" ? reason!.trim() : null, at: now, content: snapshotContent(r) });
      s.audit.push({ at: now, actor: m.id, action: mode === "amend" ? "dpe.report_amended" : "dpe.report_submitted", target: r.id });
    }
    write(s);
    return { reportId: r.id, status: r.status, version: r.version, late: r.late };
  },
  async compliance(from, to) {
    await delay();
    requireReviewer();
    const s = load();
    const now = Date.now();
    return { now, today: patrolDate(now, S), rows: rowsFor(s, from, to, null, now) };
  },
  async reports({ from, to }) {
    await delay();
    requireReviewer();
    return load().reports.filter((r) => r.status === "submitted" && r.patrolDate >= from && r.patrolDate <= to).sort((a, b) => (a.patrolDate < b.patrolDate ? 1 : -1));
  },
  async report(reportId) {
    await delay();
    const s = load();
    const m = me();
    const r = s.reports.find((x) => x.id === reportId);
    if (!r || (r.supervisorId !== m.id && !isReviewer(m))) invalid("Report not found");
    return detailOf(s, r, isReviewer(m));
  },
  async review(reportId, stage, decision, reason, officerId) {
    await delay();
    const m = requireReviewer();
    const s = load();
    const r = s.reports.find((x) => x.id === reportId);
    if (!r || r.status !== "submitted") invalid("Only submitted reports can be reviewed");
    if (r.supervisorId === m.id) deny("You cannot review your own report");
    checkReason(reason);
    if (officerId === m.id) deny("You cannot decide on an observation about yourself");
    const prior = s.reviews.filter((v) => v.reportId === r.id && v.officerId === (officerId ?? null));
    let category: Review["category"] = null;
    const ok = (st: ReviewStage, ds: ReviewDecision[]) => stage === st && ds.includes(decision);
    if (ok("report", ["reviewed"])) r.reviewedAt = Date.now();
    else if (ok("reopen", ["reopened"])) r.reopenedAt = Date.now();
    else if (ok("concern", ["noted", "referred"])) category = "needs_improvement";
    else if (ok("award_endorsement", ["endorsed", "declined"])) {
      category = "award";
      if (prior.some((v) => v.stage === "award_endorsement" || v.stage === "award_final")) throw new EvaluationError("This recommendation already has a command decision", "23505");
    } else if (ok("award_final", ["approved", "declined"])) {
      category = "award";
      if (!isAwardAuthority(m)) deny("Final award decisions are made by the Office of the Chiefs");
      const endorse = [...prior].reverse().find((v) => v.stage === "award_endorsement");
      if (!endorse || endorse.decision !== "endorsed") invalid("The recommendation must be endorsed first");
      if (endorse.actorName === m.name) deny("The final decision must come from someone other than the endorser");
      if (prior.some((v) => v.stage === "award_final")) throw new EvaluationError("This recommendation already has a final decision", "23505");
    } else invalid("Unknown review decision");
    if (category && !r.entries.some((e) => e.officer.id === officerId && e.category === category)) invalid("That observation is not in the current version of the report");
    s.reviews.push({ id: id("rev"), reportId: r.id, officerId: category ? officerId! : null, category, stage, decision, reason: reason.trim(), actorName: m.name, actorRank: m.rank, at: Date.now() });
    s.audit.push({ at: Date.now(), actor: m.id, action: `dpe.review_${decision}`, target: r.id });
    write(s);
  },
  async assign(supervisorId, dates, note) {
    await delay();
    const m = requireReviewer();
    const s = load();
    const sup = memberById(supervisorId);
    if (!sup || !isReporter(sup)) invalid("Assignments are for active Sergeants and Lieutenants");
    if (!dates.length || dates.length > 62) invalid("Choose between 1 and 62 days");
    const today = patrolDate(Date.now(), S);
    let n = 0;
    for (const d of dates) {
      if (d < addDays(today, -7)) invalid("Assignments cannot be back-dated more than 7 days");
      if (!s.assignments.some((a) => a.supervisorId === supervisorId && a.patrolDate === d && !a.cancelled)) {
        s.assignments.push({ id: id("asg"), supervisorId, patrolDate: d, note: note.slice(0, 500), cancelled: false });
        n++;
      }
      ensure(s, supervisorId, d);
    }
    s.audit.push({ at: Date.now(), actor: m.id, action: "dpe.assigned", target: supervisorId });
    write(s);
    return n;
  },
  async cancelAssignment(supervisorId, date, reason) {
    await delay();
    requireReviewer();
    checkReason(reason);
    const s = load();
    const a = s.assignments.find((x) => x.supervisorId === supervisorId && x.patrolDate === date && !x.cancelled);
    if (!a) invalid("No active assignment for that day");
    a.cancelled = true;
    const o = s.obligations.find((x) => x.supervisorId === supervisorId && x.patrolDate === date && !x.voided);
    if (o) {
      if (patrolMinutes(sessionsOf(supervisorId), date, S) >= S.minPatrolMinutes) o.source = "patrol";
      else if (!s.reports.some((r) => r.obligationId === o.id)) o.voided = true;
    }
    write(s);
  },
  async assignments(from, to) {
    requireReviewer();
    return load().assignments.filter((a) => !a.cancelled && a.patrolDate >= from && a.patrolDate <= to);
  },
  async excuse(supervisorId, date, reason) {
    await delay();
    const m = requireReviewer();
    if (supervisorId === m.id) deny("You cannot excuse your own reporting obligation");
    checkReason(reason);
    const s = load();
    if (s.excusals.some((e) => e.supervisorId === supervisorId && e.patrolDate === date && !e.revoked)) throw new EvaluationError("That day is already excused", "23505");
    s.excusals.push({ id: id("exc"), supervisorId, patrolDate: date, reason: reason.trim(), grantedAt: Date.now(), revoked: false });
    s.audit.push({ at: Date.now(), actor: m.id, action: "dpe.excused", target: supervisorId });
    write(s);
  },
  async revokeExcusal(excusalId, reason) {
    await delay();
    requireReviewer();
    checkReason(reason);
    const s = load();
    const x = s.excusals.find((e) => e.id === excusalId && !e.revoked);
    if (!x) invalid("Excusal not found or already revoked");
    x.revoked = true;
    write(s);
  },
  async excusals(from, to) {
    requireReviewer();
    return load().excusals.filter((e) => !e.revoked && e.patrolDate >= from && e.patrolDate <= to);
  },
  async exportRows(from, to) {
    await delay();
    const m = requireReviewer();
    const s = load();
    const out: ExportRow[] = [];
    for (const r of s.reports.filter((x) => x.status === "submitted" && x.patrolDate >= from && x.patrolDate <= to)) {
      const base = { patrol_date: r.patrolDate, supervisor: `${r.author.rank} ${r.author.name}`, callsign: r.author.callsign, submitted_at: r.submittedAt ? new Date(r.submittedAt).toISOString() : null, late: r.late, version: r.version, no_observations: r.noObservations };
      if (!r.entries.length) out.push({ ...base, category: null, officer: null, officer_callsign: null, officer_rank: null, award: null, justification: null });
      for (const e of r.entries) out.push({ ...base, category: e.category, officer: e.officer.name, officer_callsign: e.officer.callsign, officer_rank: e.officer.rank, award: e.award, justification: e.justification });
    }
    s.audit.push({ at: Date.now(), actor: m.id, action: "dpe.exported", target: `${from}..${to}` });
    write(s);
    return out;
  },
  async saveAward(name, description, active) {
    await delay();
    requireReviewer();
    const n = name.trim();
    if (n.length < 2 || n.length > 80) invalid("Award name must be 2 to 80 characters");
    const s = load();
    const existing = s.awards.find((a) => a.name === n);
    if (existing) Object.assign(existing, { description, active });
    else s.awards.push({ id: id("awd"), name: n, description, active });
    write(s);
  },
  async supervisors() {
    return allMembers().filter(isReporter).map(ref);
  },
};

/** For tests: the category labels used in exports match the form. */
export const EXPORT_CATEGORY = CATEGORY_LABEL;
