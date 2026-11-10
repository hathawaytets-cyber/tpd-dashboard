"use client";

import Link from "next/link";
import { Lock } from "lucide-react";
import { DistrictBoard, ReviewQueue } from "@/components/dashboard/dashboard";
import { Page, PageHeader } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/feedback";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { formatMinutes, formatTime } from "@/lib/domain/activity";
import { useMe, useNow } from "@/lib/preview/hooks";
import { memberById, usePreviewState } from "@/lib/preview/store";

export function SupervisorWorkspace() {
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
  if (!can(me.actor, "supervisor.view")) {
    return (
      <Page>
        <div className="mx-auto mt-10 max-w-md rounded-xl border border-edge bg-surface p-8 text-center shadow-card">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-obsidian text-gold">
            <Lock className="size-5" aria-hidden />
          </span>
          <h1 className="display mt-4 text-xl font-bold">Supervisor desk is restricted</h1>
          <p className="mt-2 text-xs text-muted">It is available to Sergeant and above. Your rank is {me.member.rank}.</p>
          <ButtonLink href="/hq" variant="secondary" className="mt-5">
            Back to overview
          </ButtonLink>
        </div>
      </Page>
    );
  }
  const flagged = state.sessions.filter((s) => s.flag === "Needs review").map((s) => ({ s, m: memberById(s.memberId)! }));
  const district = me.member.district;
  return (
    <Page wide>
      <PageHeader eyebrow="Management" title="Supervisor desk" description="Who is on patrol, who needs a check-in, and what is waiting on your decision." />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex flex-col gap-5">
          <DistrictBoard state={state} now={now} district={district} />
          <Card>
            <CardHeader title="Sessions flagged for review" description="Sessions open longer than 12 hours are capped and sent here" />
            {flagged.length === 0 ? (
              <p className="border-t border-line px-4 py-6 text-center text-2xs text-muted">No flagged sessions.</p>
            ) : (
              <ul className="divide-y divide-line border-t border-line">
                {flagged.map(({ s, m }) => (
                  <li key={s.id} className="flex items-center gap-3 px-4 py-2.5 text-xs">
                    <Link href={`/hq/roster?member=${m.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                      {m.name}
                    </Link>
                    <span className="text-ink-2 tabular">
                      {formatTime(s.start)}–{formatTime(s.end!)} · {formatMinutes(Math.floor((s.end! - s.start) / 60000))}
                    </span>
                    <Pill tone="amber">Needs review</Pill>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
        <ReviewQueue state={state} />
      </div>
    </Page>
  );
}
