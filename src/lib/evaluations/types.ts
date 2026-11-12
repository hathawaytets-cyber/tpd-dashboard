import type { Category, EvaluationSettings, ObligationSource, ObligationStatus } from "./rules";

export interface PersonRef {
  id: string;
  name: string;
  rank: string;
  callsign: string | null;
}

/** One patrol day that requires (or required) a report. Mirrors tpd.dpe_rows. */
export interface ObligationRow {
  obligationId: string;
  supervisor: PersonRef;
  patrolDate: string;
  source: ObligationSource;
  status: ObligationStatus;
  deadline: number;
  dayStart: number;
  reportId: string | null;
  reportStatus: "draft" | "submitted" | null;
  noObservations: boolean;
  entryCount: number;
  submittedAt: number | null;
  firstSubmittedAt: number | null;
  late: boolean;
  version: number;
  reviewedAt: number | null;
  excuseReason: string | null;
}

export interface MyOverview {
  required: boolean;
  today: string;
  now: number;
  settings: EvaluationSettings;
  supervisor: PersonRef;
  todayMinutes: number;
  rows: ObligationRow[];
}

export interface EligibleOfficer extends PersonRef {
  district: string | null;
  /** Logged patrol on this patrol day: listed first. */
  patrolled: boolean;
}

export interface Award {
  id: string;
  name: string;
  description: string;
  active: boolean;
}

export interface Entry {
  id: string;
  position: number;
  officer: PersonRef;
  category: Category;
  justification: string;
  awardId: string | null;
  awardText: string | null;
  /** Award name as shown: the listed award or the free text. */
  award: string | null;
}

export interface ReportVersion {
  version: number;
  kind: "submitted" | "amended";
  reason: string | null;
  at: number;
  content: { no_observations: boolean; entries: { officer_name: string; officer_callsign: string | null; category: Category; justification: string; award: string | null }[] };
}

export type ReviewStage = "report" | "concern" | "award_endorsement" | "award_final" | "reopen";
export type ReviewDecision = "reviewed" | "noted" | "referred" | "endorsed" | "declined" | "approved" | "reopened";

export interface Review {
  id: string;
  officerId: string | null;
  category: "needs_improvement" | "award" | null;
  stage: ReviewStage;
  decision: ReviewDecision;
  reason: string;
  actorName: string;
  actorRank: string;
  at: number;
}

export interface Report {
  id: string;
  supervisorId: string;
  patrolDate: string;
  status: "draft" | "submitted";
  noObservations: boolean;
  version: number;
  author: PersonRef;
  firstSubmittedAt: number | null;
  submittedAt: number | null;
  late: boolean;
  reopenedAt: number | null;
  reviewedAt: number | null;
  entries: Entry[];
}

export interface ReportDetail extends Report {
  versions: ReportVersion[];
  /** Command only; empty for authors. */
  reviews: Review[];
}

export interface EntryInput {
  officer_id: string;
  category: Category;
  justification: string;
  award_id?: string | null;
  award_text?: string | null;
}

export type SaveMode = "draft" | "submit" | "amend";

export interface SaveResult {
  reportId: string;
  status: "draft" | "submitted";
  version: number;
  late?: boolean;
}

export interface Assignment {
  id: string;
  supervisorId: string;
  patrolDate: string;
  note: string;
}

export interface Excusal {
  id: string;
  supervisorId: string;
  patrolDate: string;
  reason: string;
  grantedAt: number;
}

export interface ExportRow {
  patrol_date: string;
  supervisor: string;
  callsign: string | null;
  submitted_at: string | null;
  late: boolean;
  version: number;
  no_observations: boolean;
  category: Category | null;
  officer: string | null;
  officer_callsign: string | null;
  officer_rank: string | null;
  award: string | null;
  justification: string | null;
}

export interface ReportFilter {
  from: string;
  to: string;
}

/** Everything the screens need. Implemented by the Supabase backend and by the labelled design preview. */
export interface EvaluationsApi {
  readonly mode: "live" | "demo";
  overview(): Promise<MyOverview>;
  eligibleOfficers(patrolDate: string): Promise<EligibleOfficer[]>;
  awards(): Promise<Award[]>;
  /** The caller's own report for a day, or null. */
  myReport(patrolDate: string): Promise<ReportDetail | null>;
  save(patrolDate: string, mode: SaveMode, noObservations: boolean, entries: EntryInput[], reason?: string): Promise<SaveResult>;
  // Command
  compliance(from: string, to: string): Promise<{ now: number; today: string; rows: ObligationRow[] }>;
  reports(filter: ReportFilter): Promise<Report[]>;
  report(reportId: string): Promise<ReportDetail>;
  review(reportId: string, stage: ReviewStage, decision: ReviewDecision, reason: string, officerId?: string | null): Promise<void>;
  assign(supervisorId: string, dates: string[], note: string): Promise<number>;
  cancelAssignment(supervisorId: string, date: string, reason: string): Promise<void>;
  assignments(from: string, to: string): Promise<Assignment[]>;
  excuse(supervisorId: string, date: string, reason: string): Promise<void>;
  revokeExcusal(excusalId: string, reason: string): Promise<void>;
  excusals(from: string, to: string): Promise<Excusal[]>;
  exportRows(from: string, to: string): Promise<ExportRow[]>;
  saveAward(name: string, description: string, active: boolean): Promise<void>;
  /** Active reporting supervisors (for assignment). */
  supervisors(): Promise<PersonRef[]>;
}

/** Errors carry a user-facing message; the code is the Postgres SQLSTATE when there is one. */
export class EvaluationError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}
