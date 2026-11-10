"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AdminActions, ProfileBody, ProfileHeader } from "./member-profile";
import { Page } from "@/components/shell/page";
import { Skeleton } from "@/components/ui/feedback";
import { useNow } from "@/lib/preview/hooks";
import { memberById, usePreviewState } from "@/lib/preview/store";

export function MemberProfilePage({ id }: { id: string }) {
  const state = usePreviewState();
  const now = useNow(60_000);
  const member = state ? memberById(id) : undefined;
  return (
    <Page>
      <Link href="/hq/roster" className="mb-4 inline-flex items-center gap-1.5 text-2xs font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Personnel
      </Link>
      {state && now && !member ? (
        <p role="status" className="rounded-xl border border-line bg-surface p-6 text-sm text-muted">
          This member is not on the roster.
        </p>
      ) : !state || !now || !member ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : (
        <>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-xl border border-edge bg-surface p-5 shadow-card">
            <ProfileHeader member={member} state={state} now={now} as="h1" />
            <AdminActions member={member} />
          </div>
          <ProfileBody member={member} state={state} now={now} full />
        </>
      )}
    </Page>
  );
}
