/**
 * Daily Patrol Evaluation rules, mirrored from supabase/migrations/20261112000000_daily_patrol_evaluations.sql.
 *
 * The database is the enforcement point. This module exists so the interface can show the same patrol day,
 * deadline, status and validation messages before a round trip, and so the design-preview store behaves like
 * the server. Every value in DEFAULT_SETTINGS is INTERIM (docs/POLICY_CONFLICTS.md PC-30 to PC-37).
 */

export type Category = "exceeding" | "needs_improvement" | "award";
export type ObligationStatus = "upcoming" | "not_started" | "draft" | "submitted" | "overdue" | "excused";
export type ObligationSource = "assignment" | "patrol";

/** Labels taken from the department's Daily Patrol Report form. */
export const CATEGORY_LABEL: Record<Category, string> = {
  exceeding: "Exceeding Expectations",
  needs_improvement: "Struggling / Needs Improvement",
  award: "Recommended for Award or Medal",
};
export const CATEGORY_SHORT: Record<Category, string> = { exceeding: "Exceeding", needs_improvement: "Needs improvement", award: "Award" };
export const CATEGORIES: Category[] = ["exceeding", "needs_improvement", "award"];

export const STATUS_LABEL: Record<ObligationStatus, string> = {
  upcoming: "Upcoming",
  not_started: "Not started",
  draft: "Draft",
  submitted: "Submitted",
  overdue: "Overdue",
  excused: "Excused",
};

export interface EvaluationSettings {
  timezone: string;
  /** "HH:MM" local time the patrol day starts. */
  dayStart: string;
  deadlineDayOffset: number;
  /** "HH:MM" local time on the deadline day. */
  deadlineTime: string;
  minPatrolMinutes: number;
  amendWindowDays: number;
  interim: boolean;
}

export const DEFAULT_SETTINGS: EvaluationSettings = {
  timezone: "America/New_York",
  dayStart: "04:00",
  deadlineDayOffset: 1,
  deadlineTime: "20:00",
  minPatrolMinutes: 15,
  amendWindowDays: 7,
  interim: true,
};

export const REQUIRED_RANKS = ["Sergeant", "Lieutenant"] as const;
export const ELIGIBLE_RANKS = ["Corporal", "Senior Officer", "Officer", "Reserve Officer", "Probationary Officer"] as const;
export const JUSTIFICATION_MIN = 10;
export const JUSTIFICATION_MAX = 2000;
export const REASON_MIN = 10;
export const MAX_ENTRIES = 40;

const MINUTE = 60_000;
const DAY = 86_400_000;

// ------------------------------------------------------------- time zones

const formatters = new Map<string, Intl.DateTimeFormat>();
function parts(ms: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    formatters.set(tz, f);
  }
  const o: Record<string, number> = {};
  for (const p of f.formatToParts(new Date(ms))) if (p.type !== "literal") o[p.type] = Number(p.value);
  return o as { year: number; month: number; day: number; hour: number; minute: number; second: number };
}

/** Offset of `tz` from UTC at instant `ms`, in milliseconds (EST = -5h). */
export function zoneOffset(ms: number, tz: string): number {
  const p = parts(ms, tz);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wall - Math.floor(ms / 1000) * 1000;
}

const parseDate = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};
const parseTime = (t: string) => {
  const [h, m] = t.split(":").map(Number);
  return (h * 60 + m) * MINUTE;
};
export const isoDate = (utcMidnight: number) => new Date(utcMidnight).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => isoDate(parseDate(d) + n * DAY);

/** The instant a local wall time occurs in `tz` (like Postgres `timestamp AT TIME ZONE tz`). */
export function zonedInstant(date: string, time: string, tz: string): number {
  const wall = parseDate(date) + parseTime(time);
  let at = wall - zoneOffset(wall, tz);
  const second = wall - zoneOffset(at, tz);
  if (second !== at) at = second;
  return at;
}

/** The patrol day an instant belongs to: its local date after moving back by the day start. */
export function patrolDate(ms: number, s: EvaluationSettings = DEFAULT_SETTINGS): string {
  const wall = ms + zoneOffset(ms, s.timezone) - parseTime(s.dayStart);
  return isoDate(Math.floor(wall / DAY) * DAY);
}
export const dayStart = (date: string, s: EvaluationSettings = DEFAULT_SETTINGS) => zonedInstant(date, s.dayStart, s.timezone);
export const dayEnd = (date: string, s: EvaluationSettings = DEFAULT_SETTINGS) => zonedInstant(addDays(date, 1), s.dayStart, s.timezone);
export const deadline = (date: string, s: EvaluationSettings = DEFAULT_SETTINGS) =>
  zonedInstant(addDays(date, s.deadlineDayOffset), s.deadlineTime, s.timezone);

/** Same ordering as tpd.dpe_status_at. */
export function statusAt(
  o: { patrolDate: string; reportStatus: "draft" | "submitted" | null; excused: boolean },
  at: number,
  s: EvaluationSettings = DEFAULT_SETTINGS,
): ObligationStatus {
  if (o.reportStatus === "submitted") return "submitted";
  if (o.excused) return "excused";
  if (at < dayStart(o.patrolDate, s)) return "upcoming";
  if (at >= deadline(o.patrolDate, s)) return "overdue";
  if (o.reportStatus === "draft") return "draft";
  return "not_started";
}

/** Minutes of completed patrol attributed to a patrol day (sessions count on the day they started, capped at 12 h). */
export function patrolMinutes(sessions: { start: number; end: number | null }[], date: string, s: EvaluationSettings = DEFAULT_SETTINGS) {
  const from = dayStart(date, s);
  const to = dayEnd(date, s);
  let ms = 0;
  for (const x of sessions) if (x.end !== null && x.start >= from && x.start < to) ms += Math.min(x.end, x.start + 12 * 60 * MINUTE) - x.start;
  return Math.floor(ms / MINUTE);
}

/** Does this day require a report? Assignments always do; otherwise a qualifying patrol. */
export function obligationSource(hasAssignment: boolean, minutes: number, s: EvaluationSettings = DEFAULT_SETTINGS): ObligationSource | null {
  if (hasAssignment) return "assignment";
  if (minutes >= s.minPatrolMinutes) return "patrol";
  return null;
}

// -------------------------------------------------------------- validation

export interface EntryDraft {
  /** Stable client key for list rendering. */
  key: string;
  officerId: string;
  category: Category;
  justification: string;
  awardId: string | null;
  awardText: string;
}

export interface FieldError {
  /** Entry key, or "report" for the whole report. */
  key: string;
  field: "officer" | "category" | "justification" | "award" | "report";
  message: string;
}

/** Client-side mirror of the submit checks in tpd.dpe_save_report / tpd.dpe_write_entries. */
export function validateReport(
  input: { noObservations: boolean; entries: EntryDraft[]; supervisorId: string },
  opts: { final: boolean; eligible: (officerId: string) => boolean },
): FieldError[] {
  const errors: FieldError[] = [];
  if (input.noObservations && input.entries.length > 0)
    errors.push({ key: "report", field: "report", message: 'Remove the observations or untick "No notable observations".' });
  if (opts.final && !input.noObservations && input.entries.length === 0)
    errors.push({ key: "report", field: "report", message: 'Add at least one observation, or confirm "No notable observations".' });
  if (input.entries.length > MAX_ENTRIES) errors.push({ key: "report", field: "report", message: `A report holds at most ${MAX_ENTRIES} observations.` });
  const seen = new Set<string>();
  for (const e of input.entries) {
    if (!e.officerId) {
      errors.push({ key: e.key, field: "officer", message: "Choose an officer." });
      continue;
    }
    if (e.officerId === input.supervisorId) errors.push({ key: e.key, field: "officer", message: "You cannot evaluate yourself." });
    else if (!opts.eligible(e.officerId)) errors.push({ key: e.key, field: "officer", message: "Only active non-supervisory officers can be evaluated." });
    const pair = `${e.officerId}:${e.category}`;
    if (seen.has(pair)) errors.push({ key: e.key, field: "category", message: "This officer is already listed in this category." });
    seen.add(pair);
    const j = e.justification.trim();
    if (j.length > JUSTIFICATION_MAX) errors.push({ key: e.key, field: "justification", message: `Keep the justification under ${JUSTIFICATION_MAX} characters.` });
    if (opts.final && j.length < JUSTIFICATION_MIN)
      errors.push({ key: e.key, field: "justification", message: `Write a justification of at least ${JUSTIFICATION_MIN} characters.` });
    if (opts.final && e.category === "award" && !e.awardId && !e.awardText.trim())
      errors.push({ key: e.key, field: "award", message: "Choose or name the recommended award." });
  }
  return errors;
}

// ----------------------------------------------------------------- display

export function formatPatrolDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric" }) {
  return new Date(parseDate(date)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function formatInstant(ms: number, tz: string, withDate = true) {
  return new Date(ms).toLocaleString("en-US", {
    timeZone: tz,
    ...(withDate ? { weekday: "short", month: "short", day: "numeric" } : {}),
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

/** "Due in 3 h 20 min", "Overdue by 2 days". */
export function relativeDue(due: number, now: number): string {
  const diff = due - now;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / MINUTE);
  const span = h >= 48 ? `${Math.floor(h / 24)} days` : h >= 1 ? `${h} h ${m} min` : `${m} min`;
  return diff >= 0 ? `Due in ${span}` : `Overdue by ${span}`;
}
