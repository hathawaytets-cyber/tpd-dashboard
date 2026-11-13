"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Bookmark, Copy, Download, ExternalLink, Filter, Lock, Plus, Trash2, UserRound, X } from "lucide-react";
import { DecisionSheet } from "@/components/requests/decision-sheet";
import { Page, PageHeader } from "@/components/shell/page";
import { Button, ButtonLink } from "@/components/ui/button";
import { CapacityBar, Legend, StackBar } from "@/components/ui/data-viz";
import { DataTable, exportCsv, type Column } from "@/components/ui/data-table";
import { EmptyState, Skeleton, toast } from "@/components/ui/feedback";
import { Input, SearchField, Select } from "@/components/ui/field";
import { Avatar, rankTier } from "@/components/ui/identity";
import { MenuItem, MenuSeparator } from "@/components/ui/menu";
import { Dot, Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { Segmented } from "@/components/ui/tabs";
import { ACCESS_NOTE, can, canDecide, type RequestType } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatTime } from "@/lib/domain/activity";
import { departmentMetrics, openRequests, roster } from "@/lib/preview/derived";
import { useMe, useNow } from "@/lib/preview/hooks";
import { allMembers, memberById, usePreviewState, type PreviewState, type RequestRecord } from "@/lib/preview/store";
import { stateTone } from "@/lib/request-tone";
import { DIVISIONS, divisionStaffing } from "@/lib/department";
import type { RequestState } from "@/lib/sample-data";

const TYPES: RequestType[] = ["Leave of absence", "LOA extension", "Activity correction", "Division application", "Ride-along", "Transfer", "Training enrollment"];
const SWORN_SLOTS = 134; // Roster sheet: 134 sworn slots (docs/DATA_SOURCES.md)

interface Filters {
  q: string;
  status: "open" | "all" | RequestState;
  type: "" | RequestType;
  district: "" | "North" | "South" | "Department";
  division: string;
  tier: "" | "1" | "2" | "3" | "4";
  reviewer: "any" | "me" | "unassigned";
  since: "all" | "1" | "7" | "30";
  decidable: boolean;
  overdue: boolean;
}

const DEFAULT: Filters = { q: "", status: "open", type: "", district: "", division: "", tier: "", reviewer: "any", since: "all", decidable: false, overdue: false };

const BUILTIN_VIEWS: { id: string; label: string; filters: Partial<Filters> }[] = [
  { id: "decide", label: "Needs my decision", filters: { status: "open", decidable: true } },
  { id: "mine", label: "Assigned to me", filters: { status: "open", reviewer: "me" } },
  { id: "unassigned", label: "Unassigned", filters: { status: "open", reviewer: "unassigned" } },
  { id: "all", label: "All requests", filters: { status: "all" } },
];

/** Views reachable by link (metric drill-downs) that are not chips. */
const LINK_VIEWS: Record<string, Partial<Filters>> = {
  open: { status: "open" },
  overdue: { status: "open", overdue: true },
  corrections: { status: "open", type: "Activity correction" },
};

function initialView(v: string | null): { view: string | null; filters: Filters } {
  const chip = BUILTIN_VIEWS.find((b) => b.id === v);
  if (chip) return { view: chip.id, filters: { ...DEFAULT, ...chip.filters } };
  if (v && LINK_VIEWS[v]) return { view: null, filters: { ...DEFAULT, ...LINK_VIEWS[v] } };
  return { view: "decide", filters: { ...DEFAULT, status: "open", decidable: true } };
}

const VIEWS_KEY = "tpd-command-views";
const age = (t: number, now: number) => {
  const h = Math.floor((now - t) / 3600_000);
  return h < 1 ? "<1h" : h < 48 ? `${h}h` : `${Math.floor(h / 24)}d`;
};

export function CommandCenter() {
  const me = useMe();
  const state = usePreviewState();
  const now = useNow(60_000);
  if (!me || !state || !now) return <CommandSkeleton />;
  if (!can(me.actor, "command.view")) return <AccessDenied rank={me.member.rank} />;
  return <CommandInner state={state} now={now} />;
}

function CommandInner({ state, now }: { state: PreviewState; now: number }) {
  const me = useMe()!;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const activeId = params.get("id");
  const active = state.requests.find((r) => r.id === activeId) ?? null;

  const [init] = useState(() => initialView(params.get("view")));
  const [filters, setFilters] = useState<Filters>(init.filters);
  const [view, setView] = useState<string | null>(init.view);

  // Metric links change ?view= while the page stays mounted.
  const viewParam = params.get("view");
  useEffect(() => {
    if (!viewParam) return;
    const next = initialView(viewParam);
    setFilters(next.filters);
    setView(next.view);
    document.getElementById("queue")?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [viewParam]);
  const [saved, setSaved] = useState<{ id: string; label: string; filters: Filters }[]>([]);
  const [naming, setNaming] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  useEffect(() => {
    try {
      setSaved(JSON.parse(localStorage.getItem(VIEWS_KEY) ?? "[]"));
    } catch {}
  }, []);

  function persistViews(next: typeof saved) {
    setSaved(next);
    try {
      localStorage.setItem(VIEWS_KEY, JSON.stringify(next));
    } catch {}
  }

  const patch = (p: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...p }));
    setView(null);
  };

  const rows = useMemo(() => {
    const q = filters.q.trim().toLowerCase();
    return state.requests.filter((r) => {
      const m = memberById(r.memberId)!;
      if (filters.status === "open" ? !(r.state === "Submitted" || r.state === "Under review") : filters.status !== "all" && r.state !== filters.status) return false;
      if (filters.type && r.type !== filters.type) return false;
      if (filters.district && m.district !== filters.district) return false;
      if (filters.division && !m.divisions.includes(filters.division)) return false;
      if (filters.tier && String(rankTier(m.rank)) !== filters.tier) return false;
      if (filters.reviewer === "me" && r.reviewerId !== me.member.id) return false;
      if (filters.reviewer === "unassigned" && r.reviewerId !== null) return false;
      if (filters.since !== "all" && now - r.createdAt > Number(filters.since) * 86400_000) return false;
      if (filters.overdue && !(r.dueAt !== null && r.dueAt < now)) return false;
      if (filters.decidable && !canDecide(me.actor, r.type, r.memberId === me.member.id)) return false;
      if (q && !`${r.id} ${r.type} ${r.summary} ${m.name} ${m.callsign}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [state.requests, filters, me, now]);

  const openSheet = (r: RequestRecord) => router.replace(`${pathname}?id=${r.id}`, { scroll: false });
  const closeSheet = () => router.replace(pathname, { scroll: false });

  const columns: Column<RequestRecord>[] = [
    {
      key: "type",
      header: "Request",
      sort: (r) => r.type,
      text: (r) => `${r.type} ${r.id}`,
      cell: (r) => (
        <span className="leading-tight">
          <span className="block font-semibold text-ink">{r.type}</span>
          <span className="block text-3xs text-muted tabular">
            {r.id}
            <span className="sm:hidden"> · {memberById(r.memberId)!.name}</span>
          </span>
        </span>
      ),
    },
    {
      key: "member",
      hideBelow: "sm",
      header: "Member",
      sort: (r) => memberById(r.memberId)!.name,
      cell: (r) => {
        const m = memberById(r.memberId)!;
        return (
          <span className="flex items-center gap-2">
            <Avatar name={m.name} size={24} />
            <span className="leading-tight">
              <span className="block font-medium">{m.name}</span>
              <span className="block text-3xs text-muted">
                {m.rank} · {m.callsign}
              </span>
            </span>
          </span>
        );
      },
    },
    { key: "district", hideBelow: "lg", header: "District", hideable: true, sort: (r) => memberById(r.memberId)!.district, cell: (r) => memberById(r.memberId)!.district },
    { key: "summary", hideBelow: "xl", header: "Summary", hideable: true, sort: (r) => r.summary, cell: (r) => <span className="block max-w-[200px] truncate text-ink-2 2xl:max-w-[320px]" title={r.summary}>{r.summary}</span> },
    {
      key: "reviewer",
      hideBelow: "wide",
      header: "Reviewer",
      hideable: true,
      sort: (r) => (r.reviewerId ? memberById(r.reviewerId)!.name : "~"),
      cell: (r) => (r.reviewerId ? r.reviewerId === me.member.id ? <Pill tone="gold">You</Pill> : memberById(r.reviewerId)!.name : <span className="text-muted">Unassigned</span>),
    },
    { key: "age", hideBelow: "wide", header: "Age", align: "right", hideable: true, sort: (r) => -r.createdAt, text: (r) => new Date(r.createdAt).toISOString(), cell: (r) => age(r.createdAt, now) },
    {
      key: "due",
      hideBelow: "xl",
      header: "Due",
      align: "right",
      hideable: true,
      sort: (r) => r.dueAt ?? Infinity,
      text: (r) => (r.dueAt ? new Date(r.dueAt).toISOString() : ""),
      cell: (r) =>
        r.dueAt ? (
          <span className={cn(r.dueAt < now && (r.state === "Submitted" || r.state === "Under review") ? "font-semibold text-red" : "text-ink-2")}>
            {new Date(r.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    { key: "status", header: "Status", sort: (r) => r.state, cell: (r) => <Pill tone={stateTone(r.state)}>{r.state}</Pill> },
    {
      key: "actions",
      hideBelow: "sm",
      header: "Actions",
      align: "right",
      cell: (r) => {
        const open = r.state === "Submitted" || r.state === "Under review";
        const can = open && canDecide(me.actor, r.type, r.memberId === me.member.id);
        return (
          <span onClick={(e) => e.stopPropagation()}>
            <Button size="xs" variant={can ? "secondary" : "ghost"} onClick={() => openSheet(r)} aria-label={`${can ? "Review" : "View"} ${r.id}`}>
              {can ? "Review" : "View"}
            </Button>
          </span>
        );
      },
    },
  ];

  const activeFilterCount = [filters.type, filters.district, filters.division, filters.tier, filters.reviewer !== "any", filters.since !== "all", filters.overdue].filter(Boolean).length;

  return (
    <Page wide>
      <PageHeader
        eyebrow="Command"
        title="Command Center"
        description="Staffing, weekly compliance and every decision waiting on command, in one place."
        meta={
          <>
            <Pill tone="neutral">Department-wide</Pill>
            <Pill tone="neutral">Updated {formatTime(now)}</Pill>
            <Pill tone="amber">Access: {ACCESS_NOTE["command.view"]}</Pill>
          </>
        }
        actions={
          <ButtonLink href="/hq/command/integrations" variant="secondary">
            Integrations
          </ButtonLink>
        }
      />

      <Kpis state={state} now={now} />

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Staffing state={state} now={now} />
        <Compliance state={state} now={now} />
        <DivisionCapacity />
      </div>

      <Card id="queue" className="mt-5 scroll-mt-20">
        <CardHeader title="Decision queue" description="Open a request to see its context and record a decision with a reason." />
        {/* Saved views */}
        <div className="scrollbar-thin flex items-center gap-1.5 overflow-x-auto border-t border-line px-4 py-2.5">
          {BUILTIN_VIEWS.map((v) => (
            <ViewChip
              key={v.id}
              label={v.label}
              active={view === v.id}
              count={v.id === "decide" ? openRequests(state).filter((r) => canDecide(me.actor, r.type, r.memberId === me.member.id)).length : undefined}
              onClick={() => {
                setFilters({ ...DEFAULT, ...v.filters });
                setView(v.id);
              }}
            />
          ))}
          {saved.map((v) => (
            <ViewChip
              key={v.id}
              label={v.label}
              active={view === v.id}
              icon={<Bookmark className="size-3" aria-hidden />}
              onClick={() => {
                setFilters(v.filters);
                setView(v.id);
              }}
              onRemove={() => {
                persistViews(saved.filter((x) => x.id !== v.id));
                if (view === v.id) setView(null);
              }}
            />
          ))}
          {naming === null ? (
            <button
              type="button"
              onClick={() => setNaming("")}
              disabled={!!view}
              className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full px-2.5 text-2xs font-medium text-muted hover:text-ink disabled:opacity-40"
              title={view ? "Change a filter first" : "Save the current filters as a view"}
            >
              <Plus className="size-3" aria-hidden /> Save view
            </button>
          ) : (
            <form
              className="flex shrink-0 items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                const label = naming.trim();
                if (!label) return;
                const id = `v-${Date.now().toString(36)}`;
                persistViews([...saved, { id, label, filters }]);
                setView(id);
                setNaming(null);
                toast("success", `Saved view “${label}”`, "Stored in this browser.");
              }}
            >
              <Input autoFocus value={naming} onChange={(e) => setNaming(e.target.value)} placeholder="View name" aria-label="View name" className="h-7 w-36 text-xs" maxLength={24} />
              <Button size="xs" type="submit">
                Save
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setNaming(null)}>
                Cancel
              </Button>
            </form>
          )}
        </div>

        <DataTable
          label="Decision queue"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.id}
          selected={selected}
          onSelectedChange={setSelected}
          onRowClick={openSheet}
          activeKey={activeId}
          initialSort={{ key: "due", dir: "asc" }}
          storageKey="tpd-command-cols"
          pageSize={8}
          empty={
            <EmptyState
              title="No requests match"
              body="Try another view or clear the filters."
              action={
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setFilters(DEFAULT);
                    setView(null);
                  }}
                >
                  Clear filters
                </Button>
              }
            />
          }
          rowMenu={(r, close) => (
            <>
              <MenuItem icon={<ExternalLink />} onSelect={() => (close(), openSheet(r))}>
                Open review panel
              </MenuItem>
              <MenuItem icon={<UserRound />} onSelect={() => (close(), router.push(`/hq/roster?member=${r.memberId}`))}>
                View member profile
              </MenuItem>
              <MenuSeparator />
              <MenuItem
                icon={<Copy />}
                onSelect={() => {
                  close();
                  navigator.clipboard?.writeText(r.id).then(
                    () => toast("success", `Copied ${r.id}`),
                    () => toast("error", "Couldn’t copy", "Your browser blocked clipboard access."),
                  );
                }}
              >
                Copy request ID
              </MenuItem>
            </>
          )}
          toolbar={
            <>
              <SearchField label="Search requests" placeholder="Search name, ID, summary" value={filters.q} onChange={(e) => patch({ q: e.target.value })} className="w-full sm:w-60" />
              <Segmented
                size="sm"
                label="Status"
                value={filters.status === "open" || filters.status === "all" ? filters.status : "all"}
                onChange={(v) => patch({ status: v })}
                options={[
                  { value: "open", label: "Open" },
                  { value: "all", label: "All" },
                ]}
              />
              <Button size="sm" variant={showFilters || activeFilterCount ? "secondary" : "ghost"} onClick={() => setShowFilters((s) => !s)} aria-expanded={showFilters}>
                <Filter className="size-3.5" aria-hidden /> Filters{activeFilterCount ? ` · ${activeFilterCount}` : ""}
              </Button>
              {selected.size ? (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      const pick = state.requests.filter((r) => selected.has(r.id));
                      exportCsv(`tpd-requests-${new Date().toISOString().slice(0, 10)}.csv`, pick, columns);
                      toast("success", `Exported ${pick.length} request${pick.length === 1 ? "" : "s"}`, "CSV of sample data.");
                    }}
                  >
                    <Download className="size-3.5" aria-hidden /> Export {selected.size}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                    Clear
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!rows.length}
                  onClick={() => {
                    exportCsv(`tpd-requests-${new Date().toISOString().slice(0, 10)}.csv`, rows, columns);
                    toast("success", `Exported ${rows.length} requests`, "CSV of the filtered sample data.");
                  }}
                >
                  <Download className="size-3.5" aria-hidden /> Export
                </Button>
              )}
              {showFilters ? (
                <div className="grid w-full grid-cols-2 gap-2 pt-1 sm:grid-cols-3 xl:grid-cols-6">
                  <FilterSelect label="Type" value={filters.type} onChange={(v) => patch({ type: v as Filters["type"] })} options={TYPES.map((t) => [t, t])} />
                  <FilterSelect
                    label="Status"
                    value={filters.status === "open" || filters.status === "all" ? "" : filters.status}
                    onChange={(v) => patch({ status: (v || "all") as Filters["status"] })}
                    options={(["Submitted", "Under review", "Approved", "Denied", "Withdrawn"] as const).map((s) => [s, s])}
                  />
                  <FilterSelect
                    label="District"
                    value={filters.district}
                    onChange={(v) => patch({ district: v as Filters["district"] })}
                    options={[
                      ["North", "North"],
                      ["South", "South"],
                      ["Department", "Department"],
                    ]}
                  />
                  <FilterSelect label="Division" value={filters.division} onChange={(v) => patch({ division: v })} options={DIVISIONS.map((d) => [d.name, d.name])} />
                  <FilterSelect
                    label="Rank group"
                    value={filters.tier}
                    onChange={(v) => patch({ tier: v as Filters["tier"] })}
                    options={[
                      ["4", "Office of the Chiefs"],
                      ["3", "Command"],
                      ["2", "Field supervisory"],
                      ["1", "Patrol bureau"],
                    ]}
                  />
                  <FilterSelect
                    label="Reviewer"
                    value={filters.reviewer === "any" ? "" : filters.reviewer}
                    onChange={(v) => patch({ reviewer: (v || "any") as Filters["reviewer"] })}
                    options={[
                      ["me", "Assigned to me"],
                      ["unassigned", "Unassigned"],
                    ]}
                  />
                  <FilterSelect
                    label="Submitted"
                    value={filters.since === "all" ? "" : filters.since}
                    onChange={(v) => patch({ since: (v || "all") as Filters["since"] })}
                    options={[
                      ["1", "Last 24 hours"],
                      ["7", "Last 7 days"],
                      ["30", "Last 30 days"],
                    ]}
                  />
                  <label className="col-span-2 flex items-center gap-2 text-2xs font-medium text-ink-2 sm:col-span-1">
                    <input type="checkbox" checked={filters.decidable} onChange={(e) => patch({ decidable: e.target.checked })} className="size-3.5 accent-[var(--gold-ink)]" />
                    Only ones I can decide
                  </label>
                  <label className="col-span-2 flex items-center gap-2 text-2xs font-medium text-ink-2 sm:col-span-1">
                    <input type="checkbox" checked={filters.overdue} onChange={(e) => patch({ overdue: e.target.checked })} className="size-3.5 accent-[var(--gold-ink)]" />
                    Past due only
                  </label>
                  {activeFilterCount ? (
                    <Button
                      size="xs"
                      variant="ghost"
                      className="justify-self-start"
                      onClick={() => patch({ type: "", district: "", division: "", tier: "", reviewer: "any", since: "all", overdue: false })}
                    >
                      <X className="size-3" aria-hidden /> Reset filters
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </>
          }
        />
        <p className="border-t border-line px-4 py-2.5 text-3xs text-muted">Bulk approval is intentionally unavailable: every decision needs its own recorded reason.</p>
      </Card>

      <DecisionSheet request={active} state={state} onClose={closeSheet} />
    </Page>
  );
}

function FilterSelect({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <Select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} className="w-full [&_select]:h-8 [&_select]:text-xs">
      <option value="">{label}: any</option>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </Select>
  );
}

function ViewChip({ label, active, count, icon, onClick, onRemove }: { label: string; active: boolean; count?: number; icon?: React.ReactNode; onClick: () => void; onRemove?: () => void }) {
  return (
    <span
      className={cn(
        "inline-flex h-7 shrink-0 items-center rounded-full text-2xs font-medium ring-1 ring-inset transition-colors",
        active ? "bg-ink text-on-primary ring-ink" : "bg-surface text-ink-2 ring-line-strong hover:ring-ink/30",
      )}
    >
      <button type="button" onClick={onClick} aria-pressed={active} className={cn("inline-flex h-full items-center gap-1.5", onRemove ? "pr-1 pl-2.5" : "px-2.5")}>
        {icon}
        {label}
        {count !== undefined ? <span className={cn("rounded-full px-1.5 text-3xs font-bold tabular", active ? "bg-gold text-on-gold" : "bg-sunken text-muted")}>{count}</span> : null}
      </button>
      {onRemove ? (
        <button type="button" onClick={onRemove} aria-label={`Delete view ${label}`} className="mr-1 rounded-full p-0.5 opacity-70 hover:opacity-100">
          <Trash2 className="size-3" aria-hidden />
        </button>
      ) : null}
    </span>
  );
}

// ---------------------------------------------------------------- panels

function Kpis({ state, now }: { state: PreviewState; now: number }) {
  const m = departmentMetrics(state, now);
  const items = [
    { l: "Active personnel", v: `${m.active}`, s: `of ${SWORN_SLOTS} sworn slots`, href: "/hq/roster?status=current" },
    { l: "On duty now", v: `${m.onDuty}`, s: "open patrol sessions", live: m.onDuty > 0, href: "/hq/roster?duty=1" },
    { l: "Weekly compliance", v: `${m.met}/${m.eligible}`, s: `met 3 hours · ${m.exempt} exempt`, href: "/hq/roster?band=met" },
    { l: "Pending decisions", v: `${m.open}`, s: "open requests", href: "/hq/command?view=open#queue" },
    { l: "Overdue", v: `${m.overdue}`, s: m.overdue ? "past their due date" : "nothing overdue", warn: m.overdue > 0, href: "/hq/command?view=overdue#queue" },
  ];
  return (
    <nav aria-label="Department metrics" className="grid grid-cols-2 overflow-hidden rounded-xl bg-obsidian text-on-dark shadow-md ring-1 ring-dark-line sm:grid-cols-3 lg:grid-cols-5">
      {items.map((k, i) => (
        <Link
          key={k.l}
          href={k.href}
          scroll={false}
          className={cn("group px-5 py-4 transition-colors hover:bg-white/5 focus-visible:bg-white/5", i > 0 && "border-dark-line lg:border-l", i === 4 && "col-span-2 sm:col-span-1")}
        >
          <span className="flex items-center gap-1.5 text-3xs font-medium text-on-dark-muted">
            {k.live ? <Dot tone="gold" live /> : null}
            {k.l}
            <ArrowUpRight className="ml-auto size-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" aria-hidden />
          </span>
          <span className={cn("display mt-1.5 block text-[28px] leading-none font-bold tabular", k.warn ? "text-[#f0a868]" : i === 1 ? "text-gold" : "text-on-dark")}>{k.v}</span>
          <span className="mt-1.5 block text-3xs text-on-dark-muted">{k.s}</span>
        </Link>
      ))}
    </nav>
  );
}

function Staffing({ state, now }: { state: PreviewState; now: number }) {
  const rows = roster(state, now);
  const groups = (["North", "South", "Department"] as const).map((d) => {
    const g = rows.filter((r) => r.member.district === d);
    return { d, total: g.length, onDuty: g.filter((r) => r.onDuty).length, leave: g.filter((r) => r.member.status === "On leave").length };
  });
  const max = Math.max(...groups.map((g) => g.total), 1);
  return (
    <Card>
      <CardHeader title="Staffing by district" description="Members assigned · on duty now" />
      <ul className="flex flex-col gap-3.5 border-t border-line px-4 py-4">
        {groups.map((g) => (
          <li key={g.d}>
            <Link href={`/hq/roster?district=${g.d}`} className="-mx-2 block rounded-md px-2 py-1 transition-colors hover:bg-surface-2">
              <div className="mb-1.5 flex items-baseline justify-between text-xs">
                <span className="font-medium">{g.d === "Department" ? "Department staff" : `${g.d} District`}</span>
                <span className="text-3xs text-muted tabular">
                  <span className="font-semibold text-gold-ink">{g.onDuty} on duty</span> · {g.total} assigned{g.leave ? ` · ${g.leave} on leave` : ""}
                </span>
              </div>
              <div className="relative h-2 overflow-hidden rounded-full bg-sunken ring-1 ring-line ring-inset" role="img" aria-label={`${g.d}: ${g.onDuty} on duty of ${g.total}`}>
                <div className="absolute inset-y-0 left-0 rounded-full bg-ink/25" style={{ width: `${(g.total / max) * 100}%` }} />
                <div className="absolute inset-y-0 left-0 rounded-full bg-gold" style={{ width: `${(g.onDuty / max) * 100}%` }} />
              </div>
            </Link>
          </li>
        ))}
      </ul>
      <p className="flex gap-4 border-t border-line px-4 py-2.5 text-3xs text-muted">
        <Legend c="bg-gold" l="On duty" />
        <Legend c="bg-ink/25" l="Assigned" />
      </p>
    </Card>
  );
}

function Compliance({ state, now }: { state: PreviewState; now: number }) {
  const m = departmentMetrics(state, now);
  const lines: { l: string; v: number; href: string; tone?: string }[] = [
    { l: "Eligible members", v: m.eligible, href: "/hq/roster?status=Active" },
    { l: "Completed 3 hours", v: m.met, href: "/hq/roster?band=met", tone: "text-green" },
    { l: "Incomplete", v: m.onTrack + m.atRisk, href: "/hq/roster?band=incomplete", tone: m.atRisk ? "text-amber" : undefined },
    { l: "Exempt (leave, field training)", v: m.exempt, href: "/hq/roster?band=exempt" },
    { l: "Requiring review", v: m.review, href: "/hq/roster?review=1", tone: m.review ? "text-amber" : undefined },
  ];
  return (
    <Card>
      <CardHeader title="Weekly compliance" description="3 documented hours per week (Handbook §3.2)" />
      <div className="border-t border-line px-4 pt-4">
        <StackBar
          label="Weekly compliance"
          segments={[
            { label: "Met", value: m.met, className: "bg-gold" },
            { label: "On track", value: m.onTrack, className: "bg-ink/70" },
            { label: "Below half", value: m.atRisk, className: "bg-amber" },
            { label: "Exempt", value: m.exempt, className: "bg-line-strong" },
          ]}
        />
        <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-3xs text-muted">
          <Legend c="bg-gold" l={`Met ${m.met}`} />
          <Legend c="bg-ink/70" l={`On track ${m.onTrack}`} />
          <Legend c="bg-amber" l={`Below half ${m.atRisk}`} />
          <Legend c="bg-line-strong" l={`Exempt ${m.exempt}`} />
        </p>
      </div>
      <ul className="mt-3 divide-y divide-line border-t border-line">
        {lines.map((x) => (
          <li key={x.l}>
            <Link href={x.href} className="flex items-center justify-between gap-2 px-4 py-2 text-xs transition-colors hover:bg-surface-2">
              <span className="text-ink-2">{x.l}</span>
              <span className={cn("font-semibold tabular", x.tone)}>{x.v}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-3xs text-muted">Flags only. Consequences are a command decision (Handbook §3.2).</p>
    </Card>
  );
}

function DivisionCapacity() {
  return (
    <Card>
      <CardHeader title="Division capacity" description="Official roster, TPD | Divisions tab" />
      <ul className="flex flex-col gap-3 border-t border-line px-4 py-4">
        {DIVISIONS.map((d) => {
          const { filled } = divisionStaffing(d);
          return (
            <li key={d.slug}>
              <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                <Link href={`/hq/divisions/${d.slug}`} className="truncate font-medium hover:underline">
                  {d.name}
                </Link>
                <span className="shrink-0 text-3xs text-muted tabular">
                  {filled}/{d.capacity}
                </span>
              </div>
              <CapacityBar filled={filled} total={d.capacity} label={`${d.name}: ${filled} of ${d.capacity}`} tone="gold" />
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function AccessDenied({ rank }: { rank: string }) {
  return (
    <Page>
      <div className="mx-auto mt-10 max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-obsidian text-gold">
          <Lock className="size-5" aria-hidden />
        </span>
        <h1 className="display mt-4 text-xl font-bold">Command Center is restricted</h1>
        <p className="mt-2 text-xs text-muted">
          Access: {ACCESS_NOTE["command.view"]}. Your rank is {rank}. Access is checked on every operation; hiding the link is not the check.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <ButtonLink href="/hq" variant="secondary">
            Back to overview
          </ButtonLink>
          <ButtonLink href="/hq/requests">My requests</ButtonLink>
        </div>
      </div>
    </Page>
  );
}

function CommandSkeleton() {
  return (
    <Page wide>
      <Skeleton className="mb-2 h-3 w-20" />
      <Skeleton className="mb-6 h-7 w-64" />
      <Skeleton className="h-24 rounded-xl" />
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
        <Skeleton className="h-56 rounded-lg" />
      </div>
      <Skeleton className="mt-5 h-96 rounded-lg" />
    </Page>
  );
}
