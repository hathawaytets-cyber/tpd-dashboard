"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { ClipboardList, Plus } from "lucide-react";
import { DecisionSheet } from "./decision-sheet";
import { Page, PageHeader } from "@/components/shell/page";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { SearchField } from "@/components/ui/field";
import { Avatar } from "@/components/ui/identity";
import { Pill } from "@/components/ui/status";
import { Card } from "@/components/ui/surface";
import { Tabs } from "@/components/ui/tabs";
import { can, canDecide } from "@/lib/authz";
import { useMe, useNow } from "@/lib/preview/hooks";
import { memberById, usePreviewState, type RequestRecord } from "@/lib/preview/store";
import { stateTone } from "@/lib/request-tone";

type View = "mine" | "review" | "closed";
const isOpen = (r: RequestRecord) => r.state === "Submitted" || r.state === "Under review";

export function RequestsWorkspace() {
  const me = useMe();
  const state = usePreviewState();
  const now = useNow(60_000);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { openNewRequest } = useShell();
  const [q, setQ] = useState("");
  const requested = params.get("view") as View | null;
  const [tab, setTab] = useState<View>(requested ?? "mine");

  const reviewer = !!me && can(me.actor, "request.review");
  const activeId = params.get("id");

  const lists = useMemo(() => {
    if (!me || !state) return { mine: [], review: [], closed: [] };
    const mine = state.requests.filter((r) => r.memberId === me.member.id && isOpen(r));
    const review = state.requests.filter((r) => isOpen(r) && canDecide(me.actor, r.type, r.memberId === me.member.id));
    const closed = state.requests.filter((r) => !isOpen(r) && (r.memberId === me.member.id || r.history.some((h) => h.actor === me.member.id)));
    return { mine, review, closed };
  }, [me, state]);

  if (!me || !state || !now) {
    return (
      <Page>
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-96 rounded-lg" />
      </Page>
    );
  }

  const active = state.requests.find((r) => r.id === activeId) ?? null;
  const current = tab === "review" && !reviewer ? "mine" : tab;
  const query = q.trim().toLowerCase();
  const rows = lists[current].filter((r) => !query || `${r.id} ${r.type} ${r.summary} ${memberById(r.memberId)?.name}`.toLowerCase().includes(query));

  const columns: Column<RequestRecord>[] = [
    {
      key: "request",
      header: "Request",
      sort: (r) => r.type,
      cell: (r) => (
        <span className="block leading-tight">
          <span className="block font-semibold">{r.type}</span>
          <span className="block max-w-[150px] truncate text-3xs text-muted sm:max-w-none" title={`${r.id} · ${r.summary}`}>
            {r.id} · {r.summary}
          </span>
        </span>
      ),
    },
    {
      key: "member",
      hideBelow: "sm",
      header: "Member",
      hideable: true,
      defaultHidden: current === "mine",
      sort: (r) => memberById(r.memberId)!.name,
      cell: (r) => {
        const m = memberById(r.memberId)!;
        return (
          <span className="flex items-center gap-2">
            <Avatar name={m.name} size={22} />
            {m.name}
          </span>
        );
      },
    },
    { key: "reviewer", hideBelow: "lg", header: "Reviewer", hideable: true, sort: (r) => (r.reviewerId ? memberById(r.reviewerId)!.name : "~"), cell: (r) => (r.reviewerId ? memberById(r.reviewerId)!.name : <span className="text-muted">Unassigned</span>) },
    { key: "submitted", hideBelow: "sm", header: "Submitted", align: "right", sort: (r) => r.createdAt, cell: (r) => new Date(r.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) },
    { key: "status", header: "Status", sort: (r) => r.state, cell: (r) => <Pill tone={stateTone(r.state)}>{r.state}</Pill> },
  ];

  return (
    <Page wide>
      <PageHeader
        eyebrow="Requests"
        title="Requests"
        description="Leave, transfers, division applications, ride-alongs and activity corrections. Every decision is recorded with a reason."
        actions={
          <Button onClick={() => openNewRequest()} icon={<Plus className="size-4" />}>
            New request
          </Button>
        }
      />
      <Card>
        <Tabs
          label="Request lists"
          className="px-2"
          value={current}
          onChange={(v) => {
            setTab(v);
            router.replace(pathname, { scroll: false });
          }}
          items={[
            { value: "mine", label: "My open requests", count: lists.mine.length },
            ...(reviewer ? [{ value: "review" as const, label: "To review", count: lists.review.length }] : []),
            { value: "closed", label: "Closed", count: lists.closed.length },
          ]}
        />
        <DataTable
          key={current}
          label="Requests"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          onRowClick={(r) => router.replace(`${pathname}?id=${r.id}`, { scroll: false })}
          activeKey={activeId}
          initialSort={{ key: "submitted", dir: "desc" }}
          toolbar={<SearchField label="Search requests" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />}
          empty={
            <EmptyState
              icon={<ClipboardList />}
              title={current === "review" ? "Nothing to review" : current === "mine" ? "No open requests" : "Nothing closed yet"}
              body={current === "mine" ? "Requests you submit appear here until they are decided." : undefined}
              action={current === "mine" ? <Button size="sm" variant="secondary" onClick={() => openNewRequest()}>New request</Button> : undefined}
            />
          }
        />
      </Card>
      <DecisionSheet request={active} state={state} onClose={() => router.replace(pathname, { scroll: false })} />
    </Page>
  );
}
