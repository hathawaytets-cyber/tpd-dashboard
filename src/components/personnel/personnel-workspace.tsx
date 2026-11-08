"use client";

import Link from "next/link";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { Download, Users } from "lucide-react";
import { AdminActions, ProfileBody, ProfileHeader, STATUS_TONE } from "./member-profile";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { DataTable, exportCsv, type Column } from "@/components/ui/data-table";
import { EmptyState, Skeleton, toast } from "@/components/ui/feedback";
import { SearchField, Select } from "@/components/ui/field";
import { Avatar, RankMark, rankTier } from "@/components/ui/identity";
import { Sheet } from "@/components/ui/overlay";
import { Dot, Pill } from "@/components/ui/status";
import { Card } from "@/components/ui/surface";
import { can, RANKS } from "@/lib/authz";
import { formatMinutes } from "@/lib/domain/activity";
import { needsReview, roster, type Band, type RosterRow } from "@/lib/preview/derived";
import { useMe, useNow } from "@/lib/preview/hooks";
import { memberById, usePreviewState } from "@/lib/preview/store";
import { DIVISIONS } from "@/lib/sample-data";

const BAND: Record<Band, { label: string; tone: "green" | "neutral" | "amber" | "gold" }> = {
  met: { label: "Met", tone: "green" },
  "on-track": { label: "On track", tone: "neutral" },
  "at-risk": { label: "Below half", tone: "amber" },
  exempt: { label: "Exempt", tone: "gold" },
};

export function PersonnelWorkspace() {
  const state = usePreviewState();
  const me = useMe();
  const now = useNow(60_000);
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const memberId = params.get("member");
  const [q, setQ] = useState(params.get("q") ?? "");
  // Filters start from the URL so metric links (Command Center, dashboard) land on the matching view.
  const [district, setDistrict] = useState(params.get("district") ?? "");
  const [tier, setTier] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [division, setDivision] = useState("");
  const [week, setWeek] = useState(params.get("band") ?? "");
  const [review, setReview] = useState(params.get("review") === "1");
  const [onlyOnDuty, setOnlyOnDuty] = useState(params.get("duty") === "1");

  const all = useMemo(() => (state && now ? roster(state, now) : []), [state, now]);
  const rows = useMemo(() => {
    const query = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        (!district || r.member.district === district) &&
        (!tier || String(rankTier(r.member.rank)) === tier) &&
        (!status || (status === "current" ? r.member.status !== "Suspended" : r.member.status === status)) &&
        (!week || (week === "incomplete" ? r.band === "on-track" || r.band === "at-risk" : r.band === week)) &&
        (!review || needsReview(state!, r.member.id)) &&
        (!division || r.member.divisions.includes(division)) &&
        (!onlyOnDuty || r.onDuty) &&
        (!query || `${r.member.name} ${r.member.callsign} ${r.member.appointment} ${r.member.rank}`.toLowerCase().includes(query)),
    );
  }, [all, q, district, tier, status, division, week, review, onlyOnDuty, state]);

  if (!state || !now) {
    return (
      <Page wide>
        <Skeleton className="mb-6 h-8 w-48" />
        <Skeleton className="h-[480px] rounded-lg" />
      </Page>
    );
  }

  const selected = memberId ? memberById(memberId) : undefined;
  const columns: Column<RosterRow>[] = [
    {
      key: "name",
      header: "Member",
      sort: (r) => r.member.name,
      cell: (r) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={r.member.name} size={28} />
          <span className="leading-tight">
            <span className="block font-semibold">{r.member.name}</span>
            <span className="block text-3xs text-muted">{r.member.appointment}</span>
          </span>
        </span>
      ),
    },
    { key: "rank", header: "Rank", sort: (r) => RANKS.indexOf(r.member.rank), text: (r) => r.member.rank, cell: (r) => <RankMark rank={r.member.rank} /> },
    { key: "callsign", header: "Call sign", sort: (r) => r.member.callsign, cell: (r) => <span className="font-medium tabular">{r.member.callsign}</span> },
    { key: "district", header: "District", hideable: true, sort: (r) => r.member.district, cell: (r) => r.member.district },
    { key: "divisions", header: "Divisions", hideable: true, sort: (r) => r.member.divisions.length, text: (r) => r.member.divisions.join("; "), cell: (r) => (r.member.divisions.length ? <span className="text-ink-2">{r.member.divisions.join(", ")}</span> : <span className="text-muted">—</span>) },
    {
      key: "week",
      header: "This week",
      align: "right",
      hideable: true,
      sort: (r) => r.week,
      text: (r) => String(r.week),
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <span className="tabular">{formatMinutes(r.week)}</span>
          <Pill tone={BAND[r.band].tone}>{BAND[r.band].label}</Pill>
        </span>
      ),
    },
    {
      key: "status",
      header: "Status",
      sort: (r) => r.member.status,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          {/* "Active" is the normal state for almost every row, so it stays quiet; exceptions get a pill. */}
          {r.member.status === "Active" ? <span className="text-2xs text-muted">Active</span> : <Pill tone={STATUS_TONE[r.member.status]}>{r.member.status}</Pill>}
          {r.onDuty ? (
            <span className="inline-flex items-center gap-1 text-3xs font-semibold text-gold-ink">
              <Dot tone="gold" live /> On duty
            </span>
          ) : null}
        </span>
      ),
    },
    { key: "timezone", header: "Timezone", hideable: true, defaultHidden: true, sort: (r) => r.member.timezone, cell: (r) => r.member.timezone },
  ];

  const filters = [district, tier, status, division, week].filter(Boolean).length + (onlyOnDuty ? 1 : 0) + (review ? 1 : 0);

  return (
    <Page wide>
      <PageHeader
        eyebrow="Department"
        title="Personnel"
        description={
          <>
            Demonstrates duty status, weekly activity and admin tools using fictional demo personas. The real roster, with every position and vacancy, is on{" "}
            <Link href="/hq/structure" className="font-semibold text-gold-ink hover:underline">
              Department structure
            </Link>
            .
          </>
        }
        meta={<Pill tone="amber">Demo personas · fictional, not TPD members</Pill>}
      />
      <Card>
        <DataTable
          label="Personnel"
          rows={rows}
          columns={columns}
          rowKey={(r) => r.member.id}
          onRowClick={(r) => router.replace(`${pathname}?member=${r.member.id}`, { scroll: false })}
          activeKey={memberId}
          initialSort={{ key: "rank", dir: "asc" }}
          storageKey="tpd-personnel-cols"
          pageSize={12}
          empty={<EmptyState icon={<Users />} title="No members match" body="Clear a filter to see more of the roster." />}
          toolbar={
            <>
              <SearchField label="Search personnel" placeholder="Name, call sign, appointment" value={q} onChange={(e) => setQ(e.target.value)} className="w-full sm:w-64" />
              <Select aria-label="District" value={district} onChange={(e) => setDistrict(e.target.value)} className="[&_select]:h-8 [&_select]:text-xs">
                <option value="">District: any</option>
                <option>North</option>
                <option>South</option>
                <option>Department</option>
              </Select>
              <Select aria-label="Rank group" value={tier} onChange={(e) => setTier(e.target.value)} className="[&_select]:h-8 [&_select]:text-xs">
                <option value="">Rank group: any</option>
                <option value="4">Office of the Chiefs</option>
                <option value="3">Command</option>
                <option value="2">Field supervisory</option>
                <option value="1">Patrol bureau</option>
              </Select>
              <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="[&_select]:h-8 [&_select]:text-xs">
                <option value="">Status: any</option>
                <option value="current">Not suspended</option>
                {(["Active", "On leave", "Probationary", "Suspended"] as const).map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
              <Select aria-label="Division" value={division} onChange={(e) => setDivision(e.target.value)} className="[&_select]:h-8 [&_select]:text-xs">
                <option value="">Division: any</option>
                {DIVISIONS.map((d) => (
                  <option key={d.slug}>{d.name}</option>
                ))}
              </Select>
              <Select aria-label="This week" value={week} onChange={(e) => setWeek(e.target.value)} className="[&_select]:h-8 [&_select]:text-xs">
                <option value="">This week: any</option>
                <option value="met">Met 3 hours</option>
                <option value="incomplete">Incomplete</option>
                <option value="at-risk">Below half</option>
                <option value="exempt">Exempt</option>
              </Select>
              <label className="flex items-center gap-2 text-2xs font-medium text-ink-2">
                <input type="checkbox" checked={review} onChange={(e) => setReview(e.target.checked)} className="size-3.5 accent-[var(--gold-ink)]" />
                Needs review
              </label>
              <label className="flex items-center gap-2 text-2xs font-medium text-ink-2">
                <input type="checkbox" checked={onlyOnDuty} onChange={(e) => setOnlyOnDuty(e.target.checked)} className="size-3.5 accent-[var(--gold-ink)]" />
                On duty
              </label>
              {filters ? (
                <Button size="xs" variant="ghost" onClick={() => (setDistrict(""), setTier(""), setStatus(""), setDivision(""), setWeek(""), setReview(false), setOnlyOnDuty(false), router.replace(pathname, { scroll: false }))}>
                  Clear {filters}
                </Button>
              ) : null}
              <Button
                size="sm"
                variant="ghost"
                disabled={!rows.length}
                onClick={() => {
                  exportCsv(`tpd-personnel-${new Date().toISOString().slice(0, 10)}.csv`, rows, columns);
                  toast("success", `Exported ${rows.length} members`, "CSV of the filtered sample roster.");
                }}
              >
                <Download className="size-3.5" aria-hidden /> Export
              </Button>
            </>
          }
        />
      </Card>

      <Sheet
        open={!!selected}
        onClose={() => router.replace(pathname, { scroll: false })}
        title="Personnel record"
        subtitle={selected ? `${selected.callsign} · ${selected.appointment}` : undefined}
        footer={selected && me && can(me.actor, "personnel.manage") ? <div className="flex justify-end"><AdminActions member={selected} /></div> : undefined}
      >
        {selected ? (
          <div className="flex flex-col gap-5 p-5">
            <ProfileHeader member={selected} state={state} now={now} />
            <ProfileBody member={selected} state={state} now={now} />
          </div>
        ) : null}
      </Sheet>
    </Page>
  );
}
