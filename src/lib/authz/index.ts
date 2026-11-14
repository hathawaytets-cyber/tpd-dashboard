/**
 * Central capability model (docs/ARCHITECTURE.md). Every page, action and
 * route handler asks `can()`; navigation uses the same answer only to hide
 * links, never as the security check.
 *
 * Rank thresholds cite the handbook where it is explicit. Items marked
 * INTERIM follow the configurable defaults in docs/POLICY_CONFLICTS.md and
 * must be confirmed by leadership.
 */

export const RANKS = [
  "Chief of Police",
  "Deputy Chief",
  "Assistant Chief",
  "Major",
  "Captain",
  "Lieutenant",
  "Sergeant",
  "Corporal",
  "Senior Officer",
  "Officer",
  "Reserve Officer",
  "Probationary Officer",
] as const;
export type Rank = (typeof RANKS)[number];

export type EmploymentStatus = "Active" | "On leave" | "Probationary" | "Suspended" | "Separated";

export interface Actor {
  rank: Rank;
  status: EmploymentStatus;
  /** Null until the Office of the Chiefs approves independent patrol (HB §3.1). */
  independentPatrolApprovedAt: string | null;
  /** Per-person exceptions granted with a recorded approver (e.g. HB §13.1). */
  grants?: Capability[];
}

export type Capability =
  | "patrol.start"
  | "roster.view"
  | "request.create"
  | "request.review"
  | "request.review.loa"
  | "request.review.loa_extension"
  | "request.review.ride_along"
  | "request.review.division"
  | "request.review.transfer"
  | "supervisor.view"
  | "command.view"
  | "personnel.manage"
  | "discipline.report"
  | "discipline.issue"
  | "training.approve_independent"
  | "evaluation.submit"
  | "evaluation.review"
  | "evaluation.award_final";

/** Lower index = more senior. Reserve Officer sits outside the seniority ladder (PC-13). */
export function seniority(rank: Rank): number {
  return RANKS.indexOf(rank);
}

/** True when `rank` is `min` or more senior. */
export function atLeast(rank: Rank, min: Rank): boolean {
  if (rank === "Reserve Officer") return min === "Reserve Officer" || min === "Probationary Officer";
  return seniority(rank) <= seniority(min);
}

const OOTC: Rank[] = ["Chief of Police", "Deputy Chief", "Assistant Chief"];

const RULES: Record<Capability, (a: Actor) => boolean> = {
  // HB §3.1: independent patrol only after OOTC approval.
  "patrol.start": (a) => a.independentPatrolApprovedAt !== null && a.rank !== "Probationary Officer",
  "roster.view": () => true,
  "request.create": () => true,
  // INTERIM (PC-16): chain of command from Sergeant upward reviews requests.
  "request.review": (a) => atLeast(a.rank, "Sergeant"),
  // INTERIM (PC-16): ordinary LOA ≤ 2 weeks reviewed by Lieutenant and above.
  "request.review.loa": (a) => atLeast(a.rank, "Lieutenant"),
  // HB §5.4: extensions need the Chief of Police or designee (OOTC by default).
  "request.review.loa_extension": (a) => OOTC.includes(a.rank),
  // HB §12.1: the assigned officer's Sergeant or above approves ride-alongs.
  "request.review.ride_along": (a) => atLeast(a.rank, "Sergeant"),
  // INTERIM: division command (Lieutenant and above) decides applications.
  "request.review.division": (a) => atLeast(a.rank, "Lieutenant"),
  // INTERIM: district transfers decided by Captain and above.
  "request.review.transfer": (a) => atLeast(a.rank, "Captain"),
  "supervisor.view": (a) => atLeast(a.rank, "Sergeant"),
  // INTERIM (PC-08): Command Center for Captain and above.
  "command.view": (a) => atLeast(a.rank, "Captain"),
  "personnel.manage": (a) => atLeast(a.rank, "Captain"),
  // HB §13.1: Sergeants document and escalate; Lieutenant+ issue formal discipline.
  "discipline.report": (a) => atLeast(a.rank, "Sergeant"),
  "discipline.issue": (a) => atLeast(a.rank, "Lieutenant"),
  // HB §3.1: OOTC approves independent patrol.
  "training.approve_independent": (a) => OOTC.includes(a.rank),
  // INTERIM (PC-31): Sergeants and Lieutenants file one Daily Patrol Evaluation per assigned patrol day.
  "evaluation.submit": (a) => a.rank === "Sergeant" || a.rank === "Lieutenant",
  // INTERIM (PC-34, follows PC-08): Captain and above review evaluations, compliance and award endorsements.
  "evaluation.review": (a) => atLeast(a.rank, "Captain"),
  // INTERIM (PC-35): the Office of the Chiefs gives final award approval.
  "evaluation.award_final": (a) => OOTC.includes(a.rank),
};

// Shown to members. Interim rules are tracked in docs/POLICY_CONFLICTS.md:
// command.view PC-08, evaluation.submit PC-31, evaluation.review PC-34, evaluation.award_final PC-35.
/** Human-readable access rule, kept beside RULES so the UI never restates it. */
export const ACCESS_NOTE: Partial<Record<Capability, string>> = {
  "command.view": "Captain and above (interim rule)",
  "supervisor.view": "Sergeant and above",
  "personnel.manage": "Captain and above (interim)",
  "evaluation.submit": "Sergeants and Lieutenants (interim rule)",
  "evaluation.review": "Captain and above (interim rule)",
  "evaluation.award_final": "Office of the Chiefs (interim rule)",
};

export function can(actor: Actor | null | undefined, capability: Capability): boolean {
  if (!actor) return false;
  if (actor.status === "Suspended" || actor.status === "Separated") return false;
  if (actor.grants?.includes(capability)) return true;
  return RULES[capability](actor);
}

export type RequestType =
  | "Leave of absence"
  | "LOA extension"
  | "Activity correction"
  | "Division application"
  | "Ride-along"
  | "Transfer"
  | "Training enrollment";

const REVIEW_CAPABILITY: Record<RequestType, Capability> = {
  "Leave of absence": "request.review.loa",
  "LOA extension": "request.review.loa_extension",
  "Activity correction": "request.review",
  "Division application": "request.review.division",
  "Ride-along": "request.review.ride_along",
  Transfer: "request.review.transfer",
  "Training enrollment": "request.review",
};

/** Whether `actor` may decide a request of this type. Members never decide their own requests. */
export function canDecide(actor: Actor | null | undefined, type: RequestType, isOwnRequest: boolean): boolean {
  if (isOwnRequest) return false;
  return can(actor, REVIEW_CAPABILITY[type]);
}

export function reviewRequirement(type: RequestType): string {
  switch (type) {
    case "LOA extension":
      return "Chief of Police or designee (Handbook §5.4)";
    case "Ride-along":
      return "Sergeant or above (Handbook §12.1)";
    case "Leave of absence":
      return "Lieutenant or above (interim, pending leadership)";
    case "Division application":
      return "Division command, Lieutenant or above (interim)";
    case "Transfer":
      return "Captain or above (interim)";
    default:
      return "Chain of command, Sergeant or above (interim)";
  }
}
