"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, FolderLock, Plus, RefreshCw, UsersRound } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button, ButtonLink } from "@/components/ui/button";
import { Callout, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Pill } from "@/components/ui/status";
import { Tabs } from "@/components/ui/tabs";
import { cn } from "@/lib/cn";
import { ia } from "@/lib/ia/client";
import { categoryLabel, dueText, POST_LABEL, QUEUES, queueCounts, ROLE_LABEL, STATUS_LABEL, statusTone, type CaseRow, type Queue } from "@/lib/ia/model";
import { PREVIEW_CASES } from "@/lib/ia/preview";
import { OpenCaseDialog } from "./ia-open-case";
import { useIaAccess } from "./use-ia";

const fmtDate = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

export function IaDashboard() {
  const { access, preview, reload } = useIaAccess();
  const [rows, setRows] = useState<CaseRow[] | null>(preview ? PREVIEW_CASES : null);
  const [error, setError] = useState<string | null>(null);
  const [queue, setQueue] = useState<Queue | "all">("all");
  const [n, setN] = useState(0);
  const [openCase, setOpenCase] = useState(false);

  useEffect(() => {
    if (preview) return setRows(PREVIEW_CASES);
    if (!access?.has_access) return;
    let alive = true;
    setError(null);
    ia.dashboard()
      .then((r) => {
        if (!alive) return;
        setRows(r);
        // Alerts carry no case content (only a kind and a case id); seeing the queues clears them.
        if (access.unread > 0) void ia.markRead().then(reload, () => undefined);
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Cases could not be loaded."));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload when access or the retry counter changes, not on every unread change
  }, [preview, access?.has_access, n]);

  const counts = useMemo(() => queueCounts(rows ?? []), [rows]);
  const visible = useMemo(() => {
    const r = rows ?? [];
    if (queue === "all") return r.filter((c) => c.status !== "closed" && c.status !== "referred_external");
    return r.filter(QUEUES.find((q) => q.key === queue)!.test);
  }, [rows, queue]);

  if (!preview && access && !access.has_access) return <NoAccess />;
  if (!preview && !access) return <Loading />;

  const leader = !!access && (access.ia_role === "director" || access.ia_role === "deputy_director" || access.post === "deputy_chief" || access.post === "chief");
  const roleText = access?.ia_role ? `IA ${ROLE_LABEL[access.ia_role]}` : access?.post ? POST_LABEL[access.post] : "";

  return (
    <Page wide>
      <PageHeader
        eyebrow="Internal Affairs · Confidential"
        title="Case management"
        description="Complaints, investigations and reviews under the Internal Affairs SOP. Only IA appointees and the designated oversight posts can open these records, and every case view is logged."
        meta={
          roleText || access?.unread ? (
            <>
              {roleText ? <Pill tone="neutral">{roleText}</Pill> : null}
              {access?.unread ? <Pill tone="gold">{access.unread} new {access.unread === 1 ? "alert" : "alerts"}</Pill> : null}
            </>
          ) : null
        }
        actions={
          <>
            <ButtonLink href="/hq/internal-affairs/appointments" variant="secondary" size="md">
              <UsersRound className="size-4" aria-hidden /> Appointments
            </ButtonLink>
            {leader ? (
              <Button variant="gold" icon={<Plus className="size-4" />} onClick={() => setOpenCase(true)} disabled={preview}>
                Open case
              </Button>
            ) : null}
          </>
        }
      />
      {preview ? (
        <div className="mb-5">
          <Callout tone="info" title="Design preview with fictional cases">
            Actions are switched off. On the live site these screens load from the database, where access and every workflow step are enforced.
          </Callout>
        </div>
      ) : null}
      {error ? (
        <div className="mb-5">
          <Callout tone="error" title="Cases could not be loaded" action={<Button size="sm" variant="secondary" onClick={() => setN((x) => x + 1)}>Retry</Button>}>
            {error}
          </Callout>
        </div>
      ) : null}

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        {(
          [
            ["New complaints", counts.intake, "intake"],
            ["Unassigned", counts.unassigned, "unassigned"],
            ["Overdue", counts.overdue, "overdue"],
            ["Awaiting decision", counts.decision + counts.director_review, "decision"],
          ] as [string, number, Queue][]
        ).map(([label, value, q]) => (
          <button key={label} type="button" onClick={() => setQueue(q)} className="bg-surface px-4 py-3 text-left transition-colors hover:bg-surface-2 focus-visible:relative">
            <dt className="text-2xs text-muted">{label}</dt>
            <dd className={cn("display mt-1 text-xl font-semibold tabular", q === "overdue" && value > 0 ? "text-red" : "text-ink")}>{rows ? value : "–"}</dd>
          </button>
        ))}
      </dl>

      <Tabs
        label="Case queues"
        value={queue}
        onChange={setQueue}
        className="mb-4"
        items={[{ value: "all" as const, label: "Open", count: rows ? rows.filter((c) => c.status !== "closed" && c.status !== "referred_external").length : undefined }, ...QUEUES.map((q) => ({ value: q.key, label: q.label, count: rows ? counts[q.key] : undefined }))]}
      />

      {!rows ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState icon={<FolderLock />} title="No cases in this queue" body="Cases appear here as complaints arrive and move through review." />
      ) : (
        <CaseTable rows={visible} />
      )}

      <p className="mt-4 flex items-center gap-2 text-2xs text-muted">
        <RefreshCw className="size-3.5" aria-hidden />
        Statuses update when you reload. Due dates follow the 7-day target from assignment (IA §6).
      </p>
      {openCase ? <OpenCaseDialog onClose={() => setOpenCase(false)} onOpened={() => (setOpenCase(false), setN((x) => x + 1))} /> : null}
    </Page>
  );
}

function CaseTable({ rows }: { rows: CaseRow[] }) {
  return (
    <>
      {/* Desktop and tablet: a real table that scrolls inside its own frame instead of clipping. */}
      <div className="hidden overflow-x-auto rounded-lg border border-line bg-surface md:block">
        <table className="w-full min-w-[860px] text-left text-xs">
          <caption className="sr-only">Internal Affairs cases</caption>
          <thead className="border-b border-line bg-surface-2 text-2xs text-muted">
            <tr>
              <th scope="col" className="px-4 py-2.5 font-medium">Case</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Member</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Investigator</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Status</th>
              <th scope="col" className="px-3 py-2.5 font-medium">Received</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Target</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => (
              <tr key={r.id} className="group relative hover:bg-surface-2">
                <td className="px-4 py-3 align-top">
                  <Link href={`/hq/internal-affairs/case?id=${r.id}`} className="font-semibold text-ink tabular after:absolute after:inset-0 focus-visible:outline-none group-focus-within:underline">
                    {r.case_number}
                  </Link>
                  <p className="mt-0.5 max-w-[34ch] truncate text-muted">
                    {categoryLabel(r.category)} · {r.summary}
                  </p>
                </td>
                <td className="px-3 py-3 align-top">
                  {r.accused ?? <span className="text-muted">Not identified</span>}
                  {r.accused && !r.accused_verified ? <p className="text-2xs text-muted">As reported, unverified</p> : null}
                </td>
                <td className="px-3 py-3 align-top">{r.investigator ?? <span className="text-muted">Unassigned</span>}</td>
                <td className="px-3 py-3 align-top">
                  <StatusLine r={r} />
                </td>
                <td className="px-3 py-3 align-top whitespace-nowrap text-ink-2 tabular">{fmtDate(r.received_at)}</td>
                <td className={cn("px-4 py-3 align-top whitespace-nowrap tabular", r.overdue ? "font-semibold text-red" : "text-ink-2")}>
                  {r.status === "investigating" ? dueText(r.due_at) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {/* Phones: stacked rows. */}
      <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface md:hidden">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/hq/internal-affairs/case?id=${r.id}`} className="flex items-start gap-3 px-4 py-3 hover:bg-surface-2">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold tabular">{r.case_number}</p>
                <p className="mt-0.5 truncate text-xs text-ink-2">{r.summary}</p>
                <div className="mt-1.5">
                  <StatusLine r={r} />
                </div>
                <p className="mt-1 text-2xs text-muted">
                  {r.accused ?? "Member not identified"} · {r.investigator ?? "Unassigned"}
                  {r.status === "investigating" && r.due_at ? ` · ${dueText(r.due_at)}` : ""}
                </p>
              </div>
              <ArrowRight className="mt-1 size-4 shrink-0 text-muted" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </>
  );
}

/** One quiet line per case; color only where action is needed. */
function StatusLine({ r }: { r: CaseRow }) {
  const tone = statusTone(r);
  const flags = [
    r.preservation_overdue ? "Preservation overdue" : r.open_preservation > 0 && r.status !== "closed" ? "Preservation open" : null,
    r.criminal_pending ? "Criminal referral pending" : null,
    r.roster_update_pending ? "Roster entry pending" : null,
    r.handler !== "ia" ? "Escalated" : null,
  ].filter(Boolean);
  return (
    <div className="flex flex-col gap-0.5">
      <span className="inline-flex items-center gap-1.5 font-medium text-ink">
        <span aria-hidden className={cn("size-1.5 rounded-full", { neutral: "bg-muted", amber: "bg-amber", red: "bg-red", info: "bg-info" }[tone])} />
        {STATUS_LABEL[r.status]}
      </span>
      {flags.length ? <span className={cn("text-2xs", r.preservation_overdue ? "text-red" : "text-muted")}>{flags.join(" · ")}</span> : null}
    </div>
  );
}

function NoAccess() {
  return (
    <Page>
      <PageHeader eyebrow="Internal Affairs" title="Restricted area" />
      <Callout tone="info" title="Internal Affairs records are restricted">
        Only members appointed to Internal Affairs by the Deputy Chief, and the Major over Administrative Operations, the Deputy Chief and the Chief of Police, can open IA records (IA SOP §11). Rank alone does not grant access.
      </Callout>
      <div className="mt-5">
        <ButtonLink href="/hq/report" variant="secondary">
          Report misconduct
        </ButtonLink>
      </div>
    </Page>
  );
}

function Loading() {
  return (
    <Page>
      <div role="status" aria-label="Loading" className="space-y-3">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-24 rounded-lg" />
      </div>
    </Page>
  );
}
