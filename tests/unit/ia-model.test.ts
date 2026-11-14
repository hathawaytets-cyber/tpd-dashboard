import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DISCIPLINES, dueText, IA_CALLSIGNS, IA_CATEGORIES, nextSteps, queueCounts, statusTone, type CaseRow } from "@/lib/ia/model";
import { PREVIEW_CASES, previewDetail } from "@/lib/ia/preview";

const sql = readFileSync("supabase/migrations/20261113000000_internal_affairs.sql", "utf8");
const sqlArray = (fn: string) => {
  const m = sql.match(new RegExp(`function tpd\\.${fn}\\(\\)[\\s\\S]*?select array\\[([^\\]]+)\\]`));
  return m![1].split(",").map((s) => s.trim().replace(/^'|'$/g, ""));
};

const row = (r: Partial<CaseRow>): CaseRow => ({
  id: "c",
  case_number: "IA-2026-0001",
  status: "investigating",
  handler: "ia",
  category: "other",
  summary: "s",
  received_at: "2026-11-01T00:00:00Z",
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

describe("IA vocabulary matches the database", () => {
  it("categories (IA §3)", () => expect(IA_CATEGORIES.map((c) => c.key)).toEqual(sqlArray("ia_categories")));
  it("discipline outcomes (HB §13)", () => expect(DISCIPLINES.map((d) => d.key)).toEqual(sqlArray("ia_disciplines")));
  it("six IA seats (IA §1)", () => {
    expect(IA_CALLSIGNS.map((s) => s.callsign)).toEqual(["IA-01", "IA-02", "IA-03", "IA-04", "IA-05", "IA-06"]);
    expect(IA_CALLSIGNS.filter((s) => s.role === "director")).toHaveLength(1);
  });
});

describe("queues and tones", () => {
  it("counts each queue independently", () => {
    const c = queueCounts([row({ status: "intake" }), row({ overdue: true }), row({ status: "closed", open_preservation: 1 }), row({ open_preservation: 2, assigned_to_me: true })]);
    expect(c.intake).toBe(1);
    expect(c.active).toBe(2);
    expect(c.overdue).toBe(1);
    expect(c.preservation).toBe(1); // closed cases drop out of the preservation queue
    expect(c.mine).toBe(1);
    expect(c.closed).toBe(1);
  });
  it("colors only what needs action", () => {
    expect(statusTone(row({ overdue: true }))).toBe("red");
    expect(statusTone(row({ status: "closed", preservation_overdue: true }))).toBe("red");
    expect(statusTone(row({ status: "intake" }))).toBe("amber");
    expect(statusTone(row({ status: "closed" }))).toBe("neutral");
    expect(statusTone(row({}))).toBe("info");
  });
});

describe("dueText (IA §6 seven-day target)", () => {
  const now = Date.parse("2026-11-10T12:00:00Z");
  it("handles days, hours and overdue", () => {
    expect(dueText(null, now)).toBeNull();
    expect(dueText("2026-11-13T12:00:00Z", now)).toBe("Due in 3 days");
    expect(dueText("2026-11-11T12:00:00Z", now)).toBe("Due in 1 day");
    expect(dueText("2026-11-10T15:00:00Z", now)).toBe("Due in 3 hours");
    expect(dueText("2026-11-08T12:00:00Z", now)).toBe("Overdue by 2 days");
  });
});

describe("nextSteps", () => {
  it("guides an investigator through an open case and stops at review", () => {
    const id = PREVIEW_CASES.find((c) => c.status === "investigating")!.id;
    const d = previewDetail(id)!;
    const worker = nextSteps({ ...d, me: { ...d.me, is_worker: true } });
    expect(worker.at(-1)).toBe("Submit the written case report");
    const outsider = nextSteps({ ...d, me: { ...d.me, is_worker: false, is_lead: false, can_review: false, can_decide: false } });
    expect(outsider).toEqual([]);
  });
  it("asks only the Chief to act on a termination", () => {
    const d = previewDetail(PREVIEW_CASES[0].id)!;
    const chiefCase = { ...d, case: { ...d.case, status: "chief_review" as const } };
    expect(nextSteps({ ...chiefCase, me: { ...d.me, can_approve_termination: true } })).toEqual(["Approve or decline the termination (IA §9)"]);
    expect(nextSteps({ ...chiefCase, me: { ...d.me, can_approve_termination: false } })).toEqual([]);
  });
});
