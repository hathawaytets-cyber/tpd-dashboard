"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Users } from "lucide-react";
import { EvaluationDueCard } from "@/components/evaluations/reminders";
import { VerifiedIdentity } from "@/components/auth/verified-identity";
import { Page, PageHeader } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { SearchField, Select } from "@/components/ui/field";
import { Avatar, RankMark } from "@/components/ui/identity";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader, Stat } from "@/components/ui/surface";
import { useVerifiedMember } from "@/lib/backend/auth";
import { can, RANKS } from "@/lib/authz";
import { actorFor } from "@/lib/backend/membership";
import { ANNOUNCEMENTS } from "@/lib/announcements";
import { POSITIONS } from "@/lib/department";
import { useMe } from "@/lib/preview/hooks";
import { allMembers } from "@/lib/preview/store";
import type { Member } from "@/lib/sample-data";

const greeting = () => {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
};

/** Overview for a verified member: roster identity only. No patrol hero, no sample figures. */
export function LiveOverview() {
  const me = useVerifiedMember();
  if (!me) return null;
  return (
    <Page>
      <PageHeader eyebrow={new Date().toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" })} title={`${greeting()}, ${me.name}`} description={`${me.rank}${me.callsign ? ` · ${me.callsign}` : ""}${me.district ? ` · ${me.district} District` : ""}`} />
      <div className="space-y-5">
        <VerifiedIdentity />
        <EvaluationDueCard />
        <Callout tone="info" title="Training sign-offs are now recorded">
          Patrol, Activity, Requests and Training sign-offs use server-side records. Independent-patrol clearance remains a separate Office of the Chiefs decision.
        </Callout>
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Card>
            <CardHeader title="Department" />
            <ul className="divide-y divide-line border-t border-line text-xs">
              {[
                ["/hq/roster", "Personnel directory"],
                ["/hq/structure", "Department structure"],
                ["/hq/divisions", "Divisions"],
                ["/hq/resources", "Resources, fleet and policy"],
                ["/hq/command/personnel", "Personnel change proposals (Command)"],
              ].map(([href, label]) => (
                <li key={href}>
                  <Link href={href} className="flex items-center justify-between px-4 py-2.5 font-medium hover:bg-surface-2">
                    {label}
                    <span aria-hidden className="text-muted">→</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Announcements" />
            <ul className="divide-y divide-line border-t border-line">
              {ANNOUNCEMENTS.map((a) => (
                <li key={a.title} className="px-4 py-3">
                  <p className="text-3xs text-muted">{a.date}</p>
                  <p className="text-xs font-semibold">{a.title}</p>
                  <p className="mt-0.5 text-2xs text-muted">{a.body}</p>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}

/** Verified directory: names, call signs, ranks, appointments, districts and divisions. No Discord IDs, timezones or points. */
export function LivePersonnel() {
  const [q, setQ] = useState("");
  const [district, setDistrict] = useState("");
  const [rank, setRank] = useState("");
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return allMembers().filter(
      (m) =>
        (!district || m.district === district) &&
        (!rank || m.rank === rank) &&
        (!needle || `${m.name} ${m.callsign} ${m.appointment} ${m.divisions.join(" ")}`.toLowerCase().includes(needle)),
    );
  }, [q, district, rank]);
  const total = allMembers().length;

  const columns: Column<Member>[] = [
    {
      key: "member",
      header: "Member",
      sort: (m) => m.name,
      text: (m) => m.name,
      cell: (m) => (
        <span className="flex items-center gap-2.5">
          <Avatar name={m.name} size={28} />
          <span className="font-medium">{m.name}</span>
        </span>
      ),
    },
    { key: "callsign", hideBelow: "sm", header: "Call sign", hideable: true, sort: (m) => m.callsign, cell: (m) => m.callsign },
    { key: "rank", header: "Rank", hideable: true, sort: (m) => RANKS.indexOf(m.rank), text: (m) => m.rank, cell: (m) => <RankMark rank={m.rank} /> },
    { key: "appointment", hideBelow: "xl", header: "Appointment", hideable: true, sort: (m) => m.appointment, cell: (m) => m.appointment || "—" },
    { key: "district", hideBelow: "lg", header: "District", hideable: true, sort: (m) => m.district, cell: (m) => m.district },
    { key: "divisions", hideBelow: "xl", header: "Divisions", hideable: true, text: (m) => m.divisions.join("; "), cell: (m) => (m.divisions.length ? m.divisions.join(", ") : "—") },
  ];

  return (
    <Page wide>
      <PageHeader
        eyebrow="Department"
        title="Personnel"
        description="Active members from the official roster, as last synced. Every position, including vacancies, is on Department structure."
        meta={<Pill tone="green">Verified roster · {total} active</Pill>}
      />
      <Card>
        <DataTable
          label="Personnel"
          rows={rows}
          columns={columns}
          rowKey={(m) => m.id}
          initialSort={{ key: "rank", dir: "asc" }}
          storageKey="tpd-live-personnel-cols"
          pageSize={15}
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
              <Select aria-label="Rank" value={rank} onChange={(e) => setRank(e.target.value)} className="[&_select]:h-8 [&_select]:text-xs">
                <option value="">Rank: any</option>
                {RANKS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </Select>
            </>
          }
        />
      </Card>
    </Page>
  );
}

/** Command Center for a verified Captain or above: roster-derived staffing only. The decision queue and compliance need patrol and request records. */
export function LiveCommand() {
  const me = useMe();
  const verified = useVerifiedMember();
  // UX only: the data below is read through RLS (is_command), so a lower rank gets no rows even if this check were bypassed.
  const allowed = !!verified && can(actorFor(verified), "command.view");
  const members = allMembers();
  if (!me || !verified) return null;
  if (!allowed)
    return (
      <Page>
        <div className="mx-auto mt-10 max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
          <h1 className="display text-xl font-bold">Command Center is restricted</h1>
          <p className="mt-2 text-xs text-muted">Access: Captain and above (interim rule pending leadership, PC-08). Your rank is {verified.rank}. The same rule is enforced by the database, not only by this page.</p>
          <ButtonLink href="/hq" variant="secondary" className="mt-5">
            Back to overview
          </ButtonLink>
        </div>
      </Page>
    );
  return (
    <Page wide>
      <PageHeader
        eyebrow="Command"
        title="Command Center"
        description="Roster-derived staffing, authorized personnel change proposals, and server-backed operational workflows."
        actions={
          <ButtonLink href="/hq/command/integrations" variant="secondary">
            Integrations
          </ButtonLink>
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Active personnel" value={members.length} sub="on the synced roster" />
        <Stat label="Sworn positions" value={POSITIONS.length} sub="authorized" />
        <Stat label="North District" value={members.filter((m) => m.district === "North").length} sub="members" />
        <Stat label="South District" value={members.filter((m) => m.district === "South").length} sub="members" />
      </div>
      <Callout tone="info" title="Operational records are connected">
        Patrol, review, request and training workflows are stored in Supabase. Personnel changes must be reconciled through the official Google Sheets roster; compliance outcomes are not automatically assigned.
      </Callout>
      <div className="mt-3"><ButtonLink href="/hq/command/personnel" variant="secondary">Personnel change proposals</ButtonLink></div>
    </Page>
  );
}
