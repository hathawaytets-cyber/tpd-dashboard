import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  addDays,
  dayEnd,
  dayStart,
  deadline,
  obligationSource,
  patrolDate,
  patrolMinutes,
  relativeDue,
  statusAt,
  validateReport,
  zonedInstant,
  type EntryDraft,
} from "@/lib/evaluations/rules";

const ny = (local: string) => zonedInstant(local.slice(0, 10), local.slice(11, 16), "America/New_York");
const H = 3_600_000;

describe("patrol-day boundary (04:00 to 04:00 America/New_York, interim)", () => {
  it("assigns times around the boundary to the right patrol day", () => {
    expect(patrolDate(ny("2026-11-12T03:59"))).toBe("2026-11-11");
    expect(patrolDate(ny("2026-11-12T04:00"))).toBe("2026-11-12");
    expect(patrolDate(ny("2026-11-13T01:30"))).toBe("2026-11-12");
    expect(patrolDate(ny("2026-11-12T23:59"))).toBe("2026-11-12");
  });

  it("matches the database instants in summer and winter", () => {
    expect(new Date(dayStart("2026-07-04")).toISOString()).toBe("2026-07-04T08:00:00.000Z");
    expect(new Date(dayStart("2026-12-04")).toISOString()).toBe("2026-12-04T09:00:00.000Z");
    expect(new Date(deadline("2026-11-12")).toISOString()).toBe("2026-11-14T01:00:00.000Z");
  });

  it("handles daylight saving: the days that span the clock change are 23 and 25 hours", () => {
    expect((dayEnd("2026-03-07") - dayStart("2026-03-07")) / H).toBe(23);
    expect((dayEnd("2026-10-31") - dayStart("2026-10-31")) / H).toBe(25);
    expect((dayEnd("2026-03-08") - dayStart("2026-03-08")) / H).toBe(24);
    // 01:30 on the fall-back night happens twice; both belong to the 2026-10-31 patrol day.
    const first = Date.parse("2026-11-01T05:30:00Z");
    const second = Date.parse("2026-11-01T06:30:00Z");
    expect(patrolDate(first)).toBe("2026-10-31");
    expect(patrolDate(second)).toBe("2026-10-31");
  });

  it("follows configured settings", () => {
    const s = { ...DEFAULT_SETTINGS, dayStart: "00:00", deadlineDayOffset: 0, deadlineTime: "23:59" };
    expect(patrolDate(ny("2026-11-12T03:59"), s)).toBe("2026-11-12");
    expect(new Date(deadline("2026-11-12", s)).toISOString()).toBe("2026-11-13T04:59:00.000Z");
  });
});

describe("obligations", () => {
  const d = "2026-11-10";
  it("an assignment always requires a report, even with no patrol", () => {
    expect(obligationSource(true, 0)).toBe("assignment");
  });
  it("a patrol requires one only at the minimum", () => {
    expect(obligationSource(false, 14)).toBeNull();
    expect(obligationSource(false, 15)).toBe("patrol");
  });
  it("counts sessions on the day they started, summing short ones and capping at 12 h", () => {
    const sessions = [
      { start: ny("2026-11-10T23:30"), end: ny("2026-11-11T01:30") }, // 120 crossing midnight
      { start: ny("2026-11-11T03:50"), end: ny("2026-11-11T04:20") }, // 30, still the 10th
      { start: ny("2026-11-11T04:10"), end: ny("2026-11-11T05:00") }, // the 11th
      { start: ny("2026-11-10T12:00"), end: null }, // open: not counted
    ];
    expect(patrolMinutes(sessions, d)).toBe(150);
    expect(patrolMinutes(sessions, addDays(d, 1))).toBe(50);
    expect(patrolMinutes([{ start: ny("2026-11-10T05:00"), end: ny("2026-11-11T03:00") }], d)).toBe(720);
  });
});

describe("status", () => {
  const due = deadline("2026-11-10");
  const base = { patrolDate: "2026-11-10", reportStatus: null, excused: false } as const;
  it("flips to overdue exactly at the deadline", () => {
    expect(statusAt(base, due - 1)).toBe("not_started");
    expect(statusAt(base, due)).toBe("overdue");
    expect(statusAt({ ...base, reportStatus: "draft" }, due - 1)).toBe("draft");
    expect(statusAt({ ...base, reportStatus: "draft" }, due)).toBe("overdue");
  });
  it("submitted and excused days are never overdue; future days are upcoming", () => {
    expect(statusAt({ ...base, reportStatus: "submitted" }, due + 99 * H)).toBe("submitted");
    expect(statusAt({ ...base, excused: true }, due + 99 * H)).toBe("excused");
    expect(statusAt(base, dayStart("2026-11-10") - 1)).toBe("upcoming");
  });
  it("describes the time left", () => {
    expect(relativeDue(due, due - 3 * H - 20 * 60_000)).toBe("Due in 3 h 20 min");
    expect(relativeDue(due, due + 50 * H)).toBe("Overdue by 2 days");
  });
});

describe("report validation", () => {
  const entry = (over: Partial<EntryDraft> = {}): EntryDraft => ({ key: "a", officerId: "o1", category: "exceeding", justification: "Clean felony stop", awardId: null, awardText: "", ...over });
  const ok = { final: true, eligible: (id: string) => id.startsWith("o") };
  it("accepts an explicit no-observations report", () => {
    expect(validateReport({ noObservations: true, entries: [], supervisorId: "s1" }, ok)).toEqual([]);
  });
  it("requires the explicit confirmation for an empty report", () => {
    expect(validateReport({ noObservations: false, entries: [], supervisorId: "s1" }, ok)[0].message).toMatch(/No notable observations/);
    expect(validateReport({ noObservations: false, entries: [], supervisorId: "s1" }, { ...ok, final: false })).toEqual([]);
  });
  it("blocks self-evaluation, supervisors, duplicates, short justifications and unnamed awards", () => {
    const errs = validateReport(
      {
        noObservations: false,
        supervisorId: "s1",
        entries: [
          entry({ key: "1", officerId: "s1" }),
          entry({ key: "2", officerId: "s2" }),
          entry({ key: "3" }),
          entry({ key: "4" }),
          entry({ key: "5", officerId: "o2", justification: "short" }),
          entry({ key: "6", officerId: "o3", category: "award" }),
        ],
      },
      ok,
    );
    expect(errs.map((e) => `${e.key}:${e.field}`)).toEqual(["1:officer", "2:officer", "4:category", "5:justification", "6:award"]);
  });
  it("lets drafts keep incomplete justifications", () => {
    expect(validateReport({ noObservations: false, entries: [entry({ justification: "" })], supervisorId: "s1" }, { ...ok, final: false })).toEqual([]);
  });
});
