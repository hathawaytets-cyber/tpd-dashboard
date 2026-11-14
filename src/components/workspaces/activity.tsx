"use client";

import { Page, PageHeader } from "@/components/shell/page";
import { SessionHistory, Trend, WeekProgress } from "@/components/patrol/patrol-console";
import { Skeleton } from "@/components/ui/feedback";
import { Pill } from "@/components/ui/status";
import { formatMinutes, REQUIRED_MINUTES } from "@/lib/domain/activity";
import { exemptReason, memberWeek } from "@/lib/preview/derived";
import { useMe, useNow } from "@/lib/preview/hooks";
import { usePreviewState } from "@/lib/preview/store";

export function ActivityWorkspace() {
  const me = useMe();
  const state = usePreviewState();
  const now = useNow(30_000);
  if (!me || !state || !now) {
    return (
      <Page wide>
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-96 rounded-lg" />
      </Page>
    );
  }
  const week = memberWeek(state, me.member.id, now);
  const exempt = exemptReason(me.member);
  return (
    <Page wide>
      <PageHeader
        eyebrow="Personal"
        title="Activity"
        description="Your documented patrol time. The department requires 3 hours per week (Handbook §3.2); divisions can’t add their own quotas."
        meta={
          <>
            <Pill tone={exempt ? "gold" : week >= REQUIRED_MINUTES ? "green" : "neutral"}>{exempt ? "Exempt this week" : `${formatMinutes(week)} of 3h`}</Pill>
            <span className="text-3xs text-muted">Week runs Monday to Sunday, Tampa time (interim)</span>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <WeekProgress state={state} now={now} week={week} />
        <Trend state={state} now={now} />
      </div>
      <div className="mt-5">
        <SessionHistory state={state} />
      </div>
    </Page>
  );
}
