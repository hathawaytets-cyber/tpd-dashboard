"use client";

/**
 * DESIGN-PREVIEW DATA LAYER.
 *
 * Holds fictional sample state in the browser (localStorage, synced across
 * tabs) so every control in the preview operates on real application state.
 * The operations below mirror the server contracts planned for Milestones 3–4
 * (idempotent start, single open session, authorization on every decision,
 * append-only history). Milestone 2+ replaces this module with server actions;
 * the UI calls only the exported operations, so it does not need to change.
 */

import { useSyncExternalStore } from "react";
import { can, canDecide, type Actor, type RequestType } from "@/lib/authz";
import { STALE_SESSION_MS } from "@/lib/domain/activity";
import { MEMBERS, RANKS, type District, type Member, type RequestState } from "@/lib/sample-data";

export type PreviewRole = "officer" | "probationary" | "supervisor" | "lieutenant" | "captain" | "command" | "chief";

export const ROLE_PERSONA: Record<PreviewRole, { memberId: string; label: string; description: string }> = {
  officer: { memberId: "m-07", label: "Officer", description: "Senior Officer, North District" },
  probationary: { memberId: "m-10", label: "Probationary officer", description: "In field training with a PTO" },
  supervisor: { memberId: "m-06", label: "Supervisor", description: "Sergeant, North District" },
  lieutenant: { memberId: "m-05", label: "Lieutenant", description: "Lieutenant, North District (on approved leave)" },
  captain: { memberId: "m-04", label: "Captain", description: "Captain, Waterfront Unit Commander" },
  command: { memberId: "m-03", label: "Command", description: "Major, Patrol Operations" },
  chief: { memberId: "m-01", label: "Office of the Chiefs", description: "Chief of Police" },
};

export type PatrolDistrict = Exclude<District, "Department">;

export interface SessionRecord {
  id: string;
  memberId: string;
  district: PatrolDistrict;
  start: number;
  end: number | null;
  flag?: "Correction pending" | "Needs review";
}

export interface RequestEvent {
  at: number;
  actor: string;
  action: "Created" | "Submitted" | "Assigned" | "Approved" | "Denied" | "Clarification requested" | "Withdrawn" | "Commented";
  note?: string;
}

export interface RequestRecord {
  id: string;
  type: RequestType;
  memberId: string;
  summary: string;
  detail: string;
  state: RequestState;
  reviewerId: string | null;
  createdAt: number;
  dueAt: number | null;
  /** For corrections: the session the request refers to. */
  sessionId?: string;
  history: RequestEvent[];
}

export interface PreviewState {
  version: number;
  role: PreviewRole;
  sessions: SessionRecord[];
  requests: RequestRecord[];
  readNotifications: string[];
  recents: string[];
  /** Admin changes applied on top of the sample roster. */
  personnel: Record<string, Partial<Member>>;
  /** Append-only record of personnel actions. */
  audit: AuditEntry[];
}

export interface AuditEntry {
  at: number;
  actor: string;
  memberId: string;
  action: PersonnelAction;
  from: string;
  to: string;
  reason: string;
}

export type PersonnelAction = "Promotion" | "Demotion" | "Transfer" | "Divisions" | "Call sign" | "Status";

const KEY = "tpd-preview-state";
const VERSION = 5;
const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ---------------------------------------------------------------- seeding

/** Weekly minutes each sample member has logged, spread over recent days. */
const SEED_MINUTES: Record<string, number[]> = {
  "m-01": [90, 0, 75, 0, 80],
  "m-02": [60, 70, 0, 65],
  "m-03": [80, 0, 70],
  "m-04": [65, 70, 0, 70],
  "m-05": [],
  "m-06": [75, 80, 0, 70],
  "m-07": [65, 0, 40],
  "m-08": [60],
  "m-09": [70, 60, 0, 60],
  "m-10": [45],
  "m-11": [70, 0, 60],
  "m-12": [20],
  "m-13": [50, 40],
  "m-14": [],
};

function seed(now: number): PreviewState {
  const sessions: SessionRecord[] = [];
  let n = 2200;
  for (const [memberId, chunks] of Object.entries(SEED_MINUTES)) {
    const member = MEMBERS.find((m) => m.id === memberId)!;
    chunks.forEach((minutes, i) => {
      if (!minutes) return;
      // Evening sessions on the previous i+1 days, ending well before now.
      const end = now - (i + 1) * DAY + 2 * HOUR - (n % 5) * 600_000;
      sessions.push({
        id: `PS-${n++}`,
        memberId,
        district: member.district === "South" ? "South" : "North",
        start: end - minutes * 60_000,
        end,
      });
    });
    // Older history for the activity trend (previous three weeks).
    for (let w = 1; w <= 3; w++) {
      const mins = Math.max(0, chunks.reduce((a, b) => a + b, 0) + ((w * 37 + n) % 70) - 30);
      if (!mins) continue;
      const end = now - w * 7 * DAY - DAY;
      sessions.push({ id: `PS-${n++}`, memberId, district: member.district === "South" ? "South" : "North", start: end - mins * 60_000, end });
    }
  }
  // Members currently on patrol (never a preview persona, so switching roles does not "recover" a session).
  const LIVE: [string, number][] = [["m-02", 84], ["m-04", 47], ["m-09", 22], ["m-13", 63]];
  for (const [memberId, mins] of LIVE) {
    const member = MEMBERS.find((m) => m.id === memberId)!;
    sessions.push({ id: `PS-${n++}`, memberId, district: member.district === "South" ? "South" : "North", start: now - mins * 60_000, end: null });
  }
  // Member m-07's second session has a pending correction.
  const delgado = sessions.filter((s) => s.memberId === "m-07").sort((a, b) => b.start - a.start);
  if (delgado[1]) delgado[1].flag = "Correction pending";

  const req = (r: Omit<RequestRecord, "history"> & { history?: RequestEvent[] }): RequestRecord => ({
    history: r.history ?? [
      { at: r.createdAt, actor: r.memberId, action: "Submitted" },
      ...(r.reviewerId ? [{ at: r.createdAt + HOUR, actor: "system", action: "Assigned" as const, note: r.reviewerId }] : []),
    ],
    ...r,
  });

  const requests: RequestRecord[] = [
    req({ id: "REQ-1042", type: "Leave of absence", memberId: "m-05", summary: "12 days · academic exams", detail: "Final exams through the 14th. I will be unable to patrol during this period.", state: "Approved", reviewerId: "m-03", createdAt: now - 4 * DAY, dueAt: null, history: [
      { at: now - 4 * DAY, actor: "m-05", action: "Submitted" },
      { at: now - 4 * DAY + HOUR, actor: "system", action: "Assigned", note: "m-03" },
      { at: now - 3 * DAY, actor: "m-03", action: "Approved", note: "Within the two-week limit. Good luck on exams." },
    ] }),
    req({ id: "REQ-1047", type: "Activity correction", memberId: "m-07", summary: "Session ended 40 min late after a disconnect", detail: "My game crashed at 21:30 and I could not end the session until I reconnected. Requesting the end time be corrected to 21:30.", state: "Under review", reviewerId: "m-06", createdAt: now - 1.5 * DAY, dueAt: now + 0.5 * DAY, sessionId: delgado[1]?.id }),
    req({ id: "REQ-1049", type: "Division application", memberId: "m-09", summary: "Traffic Interdiction Unit", detail: "Applying to join TIU. Currently holds no other subdivision assignments.", state: "Submitted", reviewerId: null, createdAt: now - 1.2 * DAY, dueAt: null }),
    req({ id: "REQ-1050", type: "Ride-along", memberId: "m-13", summary: "Civilian observer, tomorrow evening", detail: "A civilian member has asked to observe a South District patrol.", state: "Submitted", reviewerId: "m-11", createdAt: now - 0.4 * DAY, dueAt: now + 1 * DAY }),
    req({ id: "REQ-1051", type: "LOA extension", memberId: "m-05", summary: "Extend leave by 7 days · family obligation", detail: "Family obligation following exams. Requesting extension before the current LOA expires.", state: "Under review", reviewerId: "m-02", createdAt: now - 0.3 * DAY, dueAt: now + 8 * DAY }),
    req({ id: "REQ-1052", type: "Activity correction", memberId: "m-12", summary: "Missing 25 minutes from a session", detail: "Started patrol before logging in. Requesting 25 minutes be added to the start.", state: "Submitted", reviewerId: "m-11", createdAt: now - 0.2 * DAY, dueAt: now + 2 * DAY }),
    req({ id: "REQ-1038", type: "Transfer", memberId: "m-12", summary: "North to South district", detail: "Timezone fits South District shift times better.", state: "Denied", reviewerId: "m-03", createdAt: now - 6 * DAY, dueAt: null, history: [
      { at: now - 6 * DAY, actor: "m-12", action: "Submitted" },
      { at: now - 5 * DAY, actor: "m-03", action: "Denied", note: "South District is at capacity for Officers this month. Reapply next month." },
    ] }),
  ];

  return { version: VERSION, role: "officer", sessions, requests, readNotifications: [], recents: [], personnel: {}, audit: [] };
}

// ---------------------------------------------------------------- store core

let state: PreviewState | null = null;
const listeners = new Set<() => void>();

// ------------------------------------------------------------ live mode
//
// When the backend is configured and a verified member is signed in, the store
// holds the REAL roster (read through RLS) and nothing else: no sample members,
// sessions or requests, no persistence to localStorage, and no mutations. Patrol,
// requests and personnel changes have no server side yet, so they refuse to run
// rather than pretend to save. Demo personas can therefore never appear in, or
// be mixed into, an authenticated session.

export interface LiveRoster {
  me: Member;
  members: Member[];
}
let live: LiveRoster | null = null;

export const LIVE_UNAVAILABLE = "Not available yet: this workflow has no server-side record, so nothing would be saved to the department.";

function emptyState(): PreviewState {
  return { version: VERSION, role: "officer", sessions: [], requests: [], readNotifications: [], recents: [], personnel: {}, audit: [] };
}

/** Switches the store between the labelled demo (null) and the verified live roster. */
export function setLiveRoster(next: LiveRoster | null) {
  live = next;
  state = next ? emptyState() : null;
  listeners.forEach((l) => l());
}

/** Drops the verified roster from memory (sign-out, access revoked). Never falls back to demo data. */
export function clearLiveRoster() {
  live = null;
  state = emptyState();
  listeners.forEach((l) => l());
}

export const isLiveRoster = () => live !== null;

function load(): PreviewState {
  if (live) return (state ??= emptyState());
  if (state) return state;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PreviewState;
      if (parsed.version === VERSION) {
        state = parsed;
        return state;
      }
    }
  } catch {}
  state = seed(Date.now());
  persist();
  return state;
}

/** Re-reads persisted state if present (another tab may have written it). Keeps memory state otherwise. */
function refresh() {
  if (live) return;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as PreviewState) : null;
    if (parsed?.version === VERSION) state = parsed;
  } catch {}
}

function persist() {
  if (live) return; // live mode never writes to browser storage
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {}
}

function set(updater: (s: PreviewState) => PreviewState) {
  state = updater(load());
  persist();
  listeners.forEach((l) => l());
}

if (typeof window !== "undefined") {
  // Cross-tab sync: another tab starting or ending a patrol updates this one.
  window.addEventListener("storage", (e) => {
    if (live || e.key !== KEY) return;
    state = null;
    load();
    listeners.forEach((l) => l());
  });
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}

/** Null during server render and the first client render; components show skeletons then. */
export function usePreviewState(): PreviewState | null {
  return useSyncExternalStore(subscribe, load, () => null);
}

export function usePreview<T>(select: (s: PreviewState) => T): T | null {
  const s = usePreviewState();
  return s ? select(s) : null;
}

/** Current state outside React (tests, event handlers). */
export function getPreviewState(): PreviewState {
  return load();
}

export function resetPreview() {
  if (live) return;
  try {
    localStorage.removeItem("tpd-dpe-preview"); // the evaluations preview reseeds from the fresh sample state
  } catch {}
  state = seed(Date.now());
  persist();
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------- selectors

export function memberById(id: string): Member | undefined {
  if (live) return live.members.find((m) => m.id === id);
  const base = MEMBERS.find((m) => m.id === id);
  const o = state?.personnel?.[id];
  return base && o ? { ...base, ...o } : base;
}

/** The roster with admin changes applied. */
export function allMembers(): Member[] {
  if (live) return live.members;
  return MEMBERS.map((m) => memberById(m.id)!);
}

export function actorFor(member: Member): Actor {
  return {
    rank: member.rank,
    status: member.status === "Probationary" ? "Active" : member.status,
    independentPatrolApprovedAt: member.status === "Probationary" ? null : "2026-10-30",
  };
}

export function currentMember(s: PreviewState): Member {
  if (live) return live.me;
  return memberById(ROLE_PERSONA[s.role].memberId)!;
}

export function openSessionFor(s: PreviewState, memberId: string): SessionRecord | null {
  return s.sessions.find((x) => x.memberId === memberId && x.end === null) ?? null;
}

// ---------------------------------------------------------------- operations

export class OperationError extends Error {}
/** The record changed after the caller read it. */
export class StaleError extends OperationError {}

const LATENCY = 550;
const inFlight = new Set<string>();

/** Serializes an operation: a second call while one is running is rejected (double-click guard). */
async function guarded<T>(key: string, fn: () => T): Promise<T> {
  if (live) throw new OperationError(LIVE_UNAVAILABLE);
  if (inFlight.has(key)) throw new OperationError("Already in progress");
  inFlight.add(key);
  try {
    await new Promise((r) => setTimeout(r, LATENCY));
    return fn();
  } finally {
    inFlight.delete(key);
  }
}

export function setRole(role: PreviewRole) {
  if (live) return;
  set((s) => ({ ...s, role }));
}

export const patrol = {
  /** Idempotent: returns the existing open session if there is one. */
  start(district: PatrolDistrict) {
    return guarded("patrol", () => {
      const s = load();
      const me = currentMember(s);
      if (!can(actorFor(me), "patrol.start")) {
        throw new OperationError("Independent patrol has not been approved for your account yet.");
      }
      const existing = openSessionFor(s, me.id);
      if (existing) return existing;
      const session: SessionRecord = { id: `PS-${Date.now().toString(36).toUpperCase()}`, memberId: me.id, district, start: Date.now(), end: null };
      set((st) => ({ ...st, sessions: [session, ...st.sessions] }));
      return session;
    });
  },
  end() {
    return guarded("patrol", () => {
      const s = load();
      const me = currentMember(s);
      const open = openSessionFor(s, me.id);
      if (!open) throw new OperationError("There is no open patrol to end.");
      const now = Date.now();
      const stale = now - open.start > STALE_SESSION_MS;
      const closed: SessionRecord = {
        ...open,
        end: stale ? open.start + STALE_SESSION_MS : now,
        flag: stale ? "Needs review" : undefined,
      };
      set((st) => ({ ...st, sessions: st.sessions.map((x) => (x.id === open.id ? closed : x)) }));
      return closed;
    });
  },
};

export type Decision = "Approved" | "Denied" | "Clarification requested";

export const requests = {
  /**
   * Records a decision. `expectedVersion` is the history length the reviewer
   * saw; if anyone else acted since, the decision is refused (optimistic
   * concurrency) so a reviewer never decides on a stale record.
   */
  decide(id: string, decision: Decision, reason: string, expectedVersion?: number) {
    return guarded(`req:${id}`, () => {
      refresh(); // re-read the shared record: another tab or reviewer may have changed it
      const s = load();
      const me = currentMember(s);
      const r = s.requests.find((x) => x.id === id);
      if (!r) throw new OperationError("This request no longer exists.");
      if (expectedVersion !== undefined && r.history.length !== expectedVersion) {
        throw new StaleError("This request changed since you opened it. Review the latest history before deciding.");
      }
      if (r.state !== "Submitted" && r.state !== "Under review") throw new OperationError(`This request is already ${r.state.toLowerCase()}.`);
      if (!canDecide(actorFor(me), r.type, r.memberId === me.id)) throw new OperationError("You are not authorized to decide this request.");
      if (reason.trim().length < 5) throw new OperationError("Record a reason of at least a few words.");
      const nextState: RequestState = decision === "Clarification requested" ? "Under review" : decision;
      const event: RequestEvent = { at: Date.now(), actor: me.id, action: decision, note: reason.trim() };
      set((st) => ({
        ...st,
        requests: st.requests.map((x) =>
          x.id === id ? { ...x, state: nextState, reviewerId: x.reviewerId ?? me.id, history: [...x.history, event] } : x,
        ),
        sessions:
          r.type === "Activity correction" && r.sessionId && decision !== "Clarification requested"
            ? st.sessions.map((ss) => (ss.id === r.sessionId ? { ...ss, flag: undefined } : ss))
            : st.sessions,
      }));
      return nextState;
    });
  },
  /** Member-initiated request (LOA, transfer, division application, ride-along). */
  create(type: Exclude<RequestType, "Activity correction">, summary: string, detail: string) {
    return guarded("req:new", () => {
      const s = load();
      const me = currentMember(s);
      if (!can(actorFor(me), "request.create")) throw new OperationError("Your account cannot submit requests.");
      if (summary.trim().length < 3) throw new OperationError("Add a short summary.");
      if (detail.trim().length < 10) throw new OperationError("Add details for the reviewer (at least 10 characters).");
      const now = Date.now();
      const record: RequestRecord = {
        id: `REQ-${1100 + s.requests.length}`,
        type,
        memberId: me.id,
        summary: summary.trim(),
        detail: detail.trim(),
        state: "Submitted",
        reviewerId: null,
        createdAt: now,
        dueAt: null,
        history: [{ at: now, actor: me.id, action: "Submitted" }],
      };
      set((st) => ({ ...st, requests: [record, ...st.requests] }));
      return record;
    });
  },
  withdraw(id: string) {
    return guarded(`req:${id}`, () => {
      const s = load();
      const me = currentMember(s);
      const r = s.requests.find((x) => x.id === id);
      if (!r || r.memberId !== me.id) throw new OperationError("You can only withdraw your own requests.");
      if (r.state !== "Submitted" && r.state !== "Under review") throw new OperationError(`This request is already ${r.state.toLowerCase()}.`);
      set((st) => ({
        ...st,
        requests: st.requests.map((x) => (x.id === id ? { ...x, state: "Withdrawn", history: [...x.history, { at: Date.now(), actor: me.id, action: "Withdrawn" }] } : x)),
        sessions: r.sessionId ? st.sessions.map((ss) => (ss.id === r.sessionId && ss.flag === "Correction pending" ? { ...ss, flag: undefined } : ss)) : st.sessions,
      }));
    });
  },
  createCorrection(sessionId: string, explanation: string) {
    return guarded(`corr:${sessionId}`, () => {
      const s = load();
      const me = currentMember(s);
      const session = s.sessions.find((x) => x.id === sessionId && x.memberId === me.id);
      if (!session) throw new OperationError("You can only request corrections to your own sessions.");
      if (session.end === null) throw new OperationError("End the patrol before requesting a correction.");
      if (session.flag === "Correction pending") throw new OperationError("A correction is already pending for this session.");
      if (explanation.trim().length < 10) throw new OperationError("Explain what should change and why (at least 10 characters).");
      const id = `REQ-${1100 + s.requests.length}`;
      const now = Date.now();
      const record: RequestRecord = {
        id,
        type: "Activity correction",
        memberId: me.id,
        summary: `Correction to ${sessionId}`,
        detail: explanation.trim(),
        state: "Submitted",
        reviewerId: null,
        createdAt: now,
        dueAt: null,
        sessionId,
        history: [{ at: now, actor: me.id, action: "Submitted" }],
      };
      set((st) => ({
        ...st,
        requests: [record, ...st.requests],
        sessions: st.sessions.map((x) => (x.id === sessionId ? { ...x, flag: "Correction pending" } : x)),
      }));
      return record;
    });
  },
};

// ---------------------------------------------------------------- personnel administration

export interface PersonnelChange {
  rank?: Member["rank"];
  district?: Member["district"];
  divisions?: string[];
  callsign?: string;
  status?: Member["status"];
}

/**
 * Applies one personnel change. Requires `personnel.manage`, a reason, and
 * never lets an administrator change their own record. Every change is
 * appended to the audit log with its before and after values.
 */
export const personnel = {
  change(memberId: string, change: PersonnelChange, reason: string) {
    return guarded(`personnel:${memberId}`, () => {
      const s = load();
      const me = currentMember(s);
      if (!can(actorFor(me), "personnel.manage")) throw new OperationError("You are not authorized to change personnel records.");
      if (memberId === me.id) throw new OperationError("You can’t change your own record. Another administrator must do it.");
      const target = memberById(memberId);
      if (!target) throw new OperationError("This member no longer exists.");
      if (reason.trim().length < 5) throw new OperationError("Record a reason of at least a few words.");
      const entries: AuditEntry[] = [];
      const now = Date.now();
      const push = (action: PersonnelAction, from: string, to: string) => entries.push({ at: now, actor: me.id, memberId, action, from, to, reason: reason.trim() });
      if (change.rank && change.rank !== target.rank) {
        push(RANKS.indexOf(change.rank) < RANKS.indexOf(target.rank) ? "Promotion" : "Demotion", target.rank, change.rank);
      }
      if (change.district && change.district !== target.district) push("Transfer", target.district, change.district);
      if (change.divisions) {
        if (change.divisions.length > 3) throw new OperationError("Members may hold at most three subdivisions (Handbook §9.3).");
        const before = [...target.divisions].sort().join(", ") || "None";
        const after = [...change.divisions].sort().join(", ") || "None";
        if (before !== after) push("Divisions", before, after);
      }
      if (change.callsign && change.callsign !== target.callsign) {
        if (!/^X-\d{3}$/.test(change.callsign)) throw new OperationError("Department call signs look like X-123.");
        if (allMembers().some((m) => m.id !== memberId && m.callsign === change.callsign)) throw new OperationError(`${change.callsign} is already assigned.`);
        push("Call sign", target.callsign, change.callsign);
      }
      if (change.status && change.status !== target.status) push("Status", target.status, change.status);
      if (!entries.length) throw new OperationError("Nothing changed.");
      set((st) => ({
        ...st,
        personnel: { ...st.personnel, [memberId]: { ...st.personnel[memberId], ...change } },
        audit: [...entries, ...st.audit],
      }));
      return entries;
    });
  },
};

export function markNotificationsRead(ids: string[]) {
  set((s) => ({ ...s, readNotifications: Array.from(new Set([...s.readNotifications, ...ids])) }));
}

export function pushRecent(href: string) {
  const s = load();
  if (s.recents[0] === href) return;
  set((st) => ({ ...st, recents: [href, ...st.recents.filter((h) => h !== href)].slice(0, 6) }));
}

// ---------------------------------------------------------------- notifications

export interface PreviewNotification {
  id: string;
  at: number;
  title: string;
  body: string;
  href: string;
  tone: "gold" | "green" | "red" | "info";
}

/**
 * Notifications are derived from state, not stored: decisions on my requests,
 * requests waiting on my decision, and my sessions flagged for review.
 */
export function notificationsFor(s: PreviewState): PreviewNotification[] {
  const me = currentMember(s);
  const actor = actorFor(me);
  const out: PreviewNotification[] = [];
  for (const r of s.requests) {
    if (r.memberId === me.id) {
      r.history.forEach((e, i) => {
        if (e.actor === me.id || e.actor === "system") return;
        const who = memberById(e.actor)?.name ?? "A reviewer";
        out.push({
          id: `${r.id}:${i}`,
          at: e.at,
          title: `${r.type} ${e.action.toLowerCase()}`,
          body: `${who} on ${r.id}${e.note ? `: “${e.note}”` : ""}`,
          href: `/hq/requests?id=${r.id}`,
          tone: e.action === "Approved" ? "green" : e.action === "Denied" ? "red" : "info",
        });
      });
    } else if ((r.state === "Submitted" || r.state === "Under review") && canDecide(actor, r.type, false) && (r.reviewerId === me.id || r.reviewerId === null)) {
      const who = memberById(r.memberId)?.name ?? "A member";
      out.push({
        id: `${r.id}:queue:${r.history.length}`,
        at: r.history[r.history.length - 1]?.at ?? r.createdAt,
        title: r.reviewerId === me.id ? `Assigned to you: ${r.type}` : `Unassigned: ${r.type}`,
        body: `${who} · ${r.summary}`,
        href: can(actor, "command.view") ? `/hq/command?id=${r.id}` : `/hq/requests?id=${r.id}`,
        tone: "gold",
      });
    }
  }
  for (const ss of s.sessions) {
    if (ss.memberId === me.id && ss.flag === "Needs review") {
      out.push({ id: `${ss.id}:flag`, at: ss.end ?? ss.start, title: "Session capped at 12 hours", body: `${ss.id} was auto-capped and sent for supervisor review.`, href: "/hq/patrol#history", tone: "info" });
    }
  }
  return out.sort((a, b) => b.at - a.at);
}
