"use client";

import Link from "next/link";
import { Check, Circle, CircleDot, Lock } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/feedback";
import { Avatar, RankMark } from "@/components/ui/identity";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { useMe } from "@/lib/preview/hooks";
import { allMembers, usePreviewState } from "@/lib/preview/store";
import { TRAINING_MODULES } from "@/lib/sample-data";

export function TrainingWorkspace() {
  const me = useMe();
  const state = usePreviewState();
  if (!me || !state) {
    return (
      <Page>
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-96 rounded-lg" />
      </Page>
    );
  }
  const trainee = me.member.status === "Probationary";
  const done = TRAINING_MODULES.filter((m) => m.state === "Complete").length;
  const trainees = allMembers().filter((m) => m.status === "Probationary");

  return (
    <Page wide>
      <PageHeader
        eyebrow="Personal"
        title={trainee ? "Your field training" : "Field training program"}
        description="Every new officer is appointed a Probationary Patrol Officer and completes six requirements, including the PTO Mentorship Program, before the Office of the Chiefs approves independent patrol (Handbook §3.1)."
        meta={<Pill tone="amber">{trainee ? "Progress shown is sample data" : "No sign-offs are recorded yet"}</Pill>}
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card>
          <CardHeader title={trainee ? "Your pathway" : "The pathway"} description={trainee ? `${done} of ${TRAINING_MODULES.length} steps complete (sample)` : "Seven steps for every Probationary Officer (Handbook §3.1)"} />
          <ol className="border-t border-line px-5 py-2">
            {TRAINING_MODULES.map((m, i) => {
              const state = trainee ? m.state : "Not started";
              const last = i === TRAINING_MODULES.length - 1;
              return (
                <li key={m.key} className="relative flex gap-4 py-4">
                  {!last ? <span aria-hidden className={cn("absolute top-11 bottom-0 left-[11px] w-px", state === "Complete" ? "bg-gold" : "bg-line")} /> : null}
                  <span className="relative z-10 mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface">
                    {!trainee ? (
                      <span className="flex size-6 items-center justify-center rounded-full bg-sunken text-3xs font-bold text-muted tabular">{i + 1}</span>
                    ) : state === "Complete" ? (
                      <span className="flex size-6 items-center justify-center rounded-full bg-gold text-on-gold">
                        <Check aria-hidden className="size-3.5" strokeWidth={3} />
                      </span>
                    ) : state === "In progress" ? (
                      <CircleDot aria-hidden className="size-6 text-gold-ink" />
                    ) : (
                      <Circle aria-hidden className="size-6 text-line-strong" />
                    )}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-semibold">{m.title}</h3>
                      {trainee ? <Pill tone={state === "Complete" ? "green" : state === "In progress" ? "gold" : "neutral"}>{state}</Pill> : null}
                    </div>
                    <p className="mt-1 text-xs text-muted">{m.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="flex items-start gap-2.5 border-t border-line bg-surface-2 px-5 py-3.5 text-2xs text-muted">
            <Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />
            Independent patrol is approved by the Office of the Chiefs. Until then probationary officers are exempt from the weekly activity requirement (Handbook §3.2).
          </div>
        </Card>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="In field training" description={`${trainees.length} probationary officers`} />
            <ul className="divide-y divide-line border-t border-line">
              {trainees.map((m) => (
                <li key={m.id}>
                  <Link href={`/hq/roster?member=${m.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <Avatar name={m.name} size={28} />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-xs font-semibold">{m.name}</span>
                      <span className="block truncate text-3xs text-muted">
                        <RankMark rank={m.rank} /> · {m.callsign} · {m.district}
                      </span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Sign-offs and approvals" />
            <p className="border-t border-line px-4 py-3.5 text-2xs leading-relaxed text-muted">
              {can(me.actor, "training.approve_independent")
                ? "As a member of the Office of the Chiefs you will approve independent patrol here."
                : "PTOs record module sign-offs and the Office of the Chiefs approves independent patrol."}{" "}
              Sign-offs open here once leadership confirms how PTO assignments work.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
