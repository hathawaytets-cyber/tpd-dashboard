"use client";

import Link from "next/link";
import { ClipboardCheck } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatInstant, formatPatrolDate, openDuties, relativeDue, useMyEvaluations, type MyOverview } from "@/lib/evaluations";
import { useMe, useNow } from "@/lib/preview/hooks";

function useDuties() {
  const me = useMe();
  const enabled = !!me && can(me.actor, "evaluation.submit");
  const { data } = useMyEvaluations(enabled);
  return enabled ? data : null;
}

/**
 * In-app reminder on the Overview. Derived from the reporting status the server computes, so there is exactly one
 * reminder per open patrol day however often the page loads (no duplicate notifications).
 */
export function EvaluationDueCard() {
  const data = useDuties();
  const now = useNow(60_000);
  if (!data) return null;
  const open = openDuties(data).sort((a, b) => (a.patrolDate < b.patrolDate ? -1 : 1));
  if (!open.length) return null;
  const overdue = open.filter((r) => r.status === "overdue").length;
  const first = open[0];
  return (
    <section
      aria-labelledby="dpe-due-title"
      className={cn("flex flex-wrap items-center gap-4 rounded-lg border p-4", overdue ? "border-red/30 bg-red-soft/50" : "border-gold/40 bg-gold-soft/50")}
    >
      <span className={cn("flex size-10 shrink-0 items-center justify-center rounded-full", overdue ? "bg-red/10 text-red" : "bg-obsidian text-gold")}>
        <ClipboardCheck className="size-5" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <h2 id="dpe-due-title" className="text-sm font-semibold text-ink">
          {overdue ? `${overdue} daily ${overdue === 1 ? "evaluation is" : "evaluations are"} overdue` : "Your daily patrol evaluation is due"}
        </h2>
        <p className="mt-0.5 text-2xs text-muted">
          {first.patrolDate === data.today ? "Today" : formatPatrolDate(first.patrolDate)} · {now ? relativeDue(first.deadline, now) : ""} ({formatInstant(first.deadline, data.settings.timezone)})
          {open.length > 1 ? ` · ${open.length} open in total` : ""}
        </p>
      </div>
      <ButtonLink href="/hq/evaluations" variant={overdue ? "primary" : "gold"} size="sm">
        Open report
      </ButtonLink>
    </section>
  );
}

/** Count of open reports for the sidebar link. */
export function EvaluationNavBadge({ collapsed }: { collapsed: boolean }) {
  const data = useDuties();
  const n = data ? openDuties(data).length : 0;
  if (!n) return null;
  const overdue = data ? openDuties(data).some((r) => r.status === "overdue") : false;
  return (
    <span
      aria-label={`${n} open ${n === 1 ? "report" : "reports"}`}
      className={cn(
        "flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold tabular",
        overdue ? "bg-red text-white" : "bg-gold text-on-gold",
        collapsed ? "absolute top-0.5 right-0.5" : "ml-auto",
      )}
    >
      {n}
    </span>
  );
}

export interface DutyNotification {
  id: string;
  at: number;
  title: string;
  body: string;
  href: string;
  tone: "gold" | "red";
}

/** Notification-center items: one per open patrol day and state, so moving from due to overdue notifies once more, never repeatedly. */
export function dutyNotifications(data: MyOverview | null): DutyNotification[] {
  if (!data) return [];
  return openDuties(data).map((r) => ({
    id: `dpe:${r.patrolDate}:${r.status === "overdue" ? "overdue" : "due"}`,
    at: r.status === "overdue" ? r.deadline : r.dayStart,
    title: r.status === "overdue" ? "Daily evaluation overdue" : "Daily evaluation due",
    body: `${formatPatrolDate(r.patrolDate)} · due ${formatInstant(r.deadline, data.settings.timezone)}`,
    href: "/hq/evaluations",
    tone: r.status === "overdue" ? "red" : "gold",
  }));
}

export function useDutyNotifications() {
  return dutyNotifications(useDuties());
}

export function EvaluationLink() {
  return (
    <Link href="/hq/evaluations" className="text-2xs font-semibold text-gold-ink hover:underline">
      Daily evaluation
    </Link>
  );
}
