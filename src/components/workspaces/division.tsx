"use client";

import Link from "next/link";
import { Page, PageHeader } from "@/components/shell/page";
import { useShell } from "@/components/shell/shell-context";
import { Button } from "@/components/ui/button";
import { CapacityBar } from "@/components/ui/data-viz";
import { Skeleton } from "@/components/ui/feedback";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import { useIsLive } from "@/lib/backend/auth";
import { useMe } from "@/lib/preview/hooks";
import { usePreviewState } from "@/lib/preview/store";
import { DIVISIONS, divisionStaffing, positionByCallsign, VERIFIED_ON } from "@/lib/department";

export function DivisionWorkspace({ slug }: { slug: string }) {
  const me = useMe();
  const state = usePreviewState();
  const live = useIsLive();
  const { openNewRequest } = useShell();
  const division = DIVISIONS.find((d) => d.slug === slug)!;
  if (!me || !state) {
    return (
      <Page>
        <Skeleton className="mb-6 h-8 w-64" />
        <Skeleton className="h-80 rounded-lg" />
      </Page>
    );
  }
  const staff = divisionStaffing(division);
  const commander = positionByCallsign(division.command.commander);
  const assistant = division.command.assistant ? positionByCallsign(division.command.assistant) : undefined;
  const member = me.member.divisions.includes(division.name);
  const atLimit = me.member.divisions.length >= 3;
  const full = staff.vacancies === 0;
  const pending = state.requests.some((r) => r.memberId === me.member.id && r.type === "Division application" && (r.state === "Submitted" || r.state === "Under review") && r.summary.includes(division.name));
  const blocked = live ? "Applications are not connected yet" : member ? "You’re a member" : pending ? "Application pending" : atLimit ? "You hold 3 subdivisions (Handbook §9.3)" : full ? "No vacancies" : null;

  return (
    <Page wide>
      <PageHeader
        eyebrow="Division"
        title={division.name}
        description={division.callsign ? `Radio call sign “${division.callsign}” · prefix ${division.prefix}` : `Call sign prefix ${division.prefix}`}
        meta={
          <>
            <Pill tone="neutral">
              {staff.filled} of {staff.capacity} positions filled
            </Pill>
            {member ? <Pill tone="gold">Your division</Pill> : null}
          </>
        }
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button disabled={!!blocked} onClick={() => openNewRequest("Division application")}>
              Apply to join
            </Button>
            {blocked ? <span className="text-3xs text-muted">{blocked}</span> : null}
          </div>
        }
      />

      <nav aria-label="Divisions" className="scrollbar-thin mb-5 overflow-x-auto">
        <ul className="flex gap-1.5">
          {DIVISIONS.map((d) => (
            <li key={d.slug}>
              <Link
                href={`/hq/divisions/${d.slug}`}
                aria-current={d.slug === slug ? "page" : undefined}
                className={cn("block rounded-full px-3 py-1.5 text-2xs font-medium whitespace-nowrap ring-1 ring-inset", d.slug === slug ? "bg-obsidian text-gold ring-obsidian" : "bg-surface text-ink-2 ring-line-strong hover:ring-ink/30")}
              >
                {d.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <CardHeader title="Division positions" description={`${staff.vacancies} vacancies · roster, TPD | Divisions tab, checked ${VERIFIED_ON}`} />
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full text-left text-xs">
              <thead className="bg-surface-2 text-3xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Call sign</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Position</th>
                  <th scope="col" className="px-3 py-2 font-semibold">Member</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {division.slots.map((slot) => (
                  <tr key={slot.callsign}>
                    <td className="px-4 py-2 font-semibold whitespace-nowrap tabular">{slot.callsign}</td>
                    <td className="px-3 py-2">
                      <span className="block">{slot.role}</span>
                      {slot.title !== division.name && slot.title !== slot.role ? <span className="block text-3xs text-muted">{slot.title}</span> : null}
                    </td>
                    <td className="px-3 py-2">{slot.holder ? <span className="font-medium">{slot.holder}</span> : <span className="text-muted">Vacant</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Command" description="Department positions on the TPD Roster tab" />
            <dl className="divide-y divide-line border-t border-line text-xs">
              {[
                ["Commander", commander],
                ["Assistant commander", assistant],
              ].map(([label, pos]) =>
                pos && typeof pos === "object" ? (
                  <div key={label as string} className="flex items-baseline justify-between gap-3 px-4 py-2.5">
                    <dt className="text-ink-2">{label as string}</dt>
                    <dd className="text-right">
                      {pos.holder ? <span className="font-semibold">{pos.holder}</span> : <span className="text-muted">Vacant</span>}
                      <span className="block text-3xs text-muted tabular">
                        {pos.rank} · {pos.callsign}
                      </span>
                    </dd>
                  </div>
                ) : null,
              )}
            </dl>
          </Card>
          <Card>
            <CardHeader title="Staffing" />
            <div className="border-t border-line px-4 py-4">
              <div className="mb-2 flex justify-between text-xs">
                <span className="text-ink-2">Filled</span>
                <span className="font-semibold tabular">
                  {staff.filled} / {staff.capacity}
                </span>
              </div>
              <CapacityBar filled={staff.filled} total={staff.capacity} label="Division staffing" tone="gold" />
            </div>
          </Card>
          <Card>
            <CardHeader title="Assignment rules" description="Handbook §9.3 and §3.2" />
            <ul className="flex flex-col gap-2 border-t border-line px-4 py-3.5 text-2xs text-ink-2">
              <li>Members may hold up to three subdivisions at once, at any rank.</li>
              <li>Divisions don’t set their own activity quotas; the department-wide 3 hours applies.</li>
              <li className="text-muted">Branch: {division.branch ?? "not assigned in the sources yet (PC-07)"}</li>
            </ul>
          </Card>
        </div>
      </div>
    </Page>
  );
}

export function DivisionsOverview() {
  const me = useMe();
  return (
    <Page wide>
      <PageHeader eyebrow="Department" title="Divisions" description="Specialized assignments alongside patrol. Members may hold up to three at any rank (Handbook §9.3)." />
      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {DIVISIONS.map((d) => {
          const { filled, capacity } = divisionStaffing(d);
          const mine = !!me?.member.divisions.includes(d.name);
          return (
            <li key={d.slug}>
              <Link href={`/hq/divisions/${d.slug}`} className="flex h-full flex-col rounded-xl border border-edge bg-surface p-5 shadow-card transition-colors hover:border-line-strong">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{d.name}</p>
                  <span className="shrink-0 rounded-full bg-obsidian px-2.5 py-0.5 text-3xs font-bold text-gold">{d.callsign ? `${d.callsign} · ${d.prefix}` : d.prefix}</span>
                </div>
                {mine ? <Pill tone="gold" className="mt-2 self-start">Your division</Pill> : null}
                <div className="mt-auto pt-6">
                  <div className="mb-1.5 flex justify-between text-3xs text-muted">
                    <span>Staffing</span>
                    <span className="tabular">{`${filled} / ${capacity}`}</span>
                  </div>
                  <CapacityBar filled={filled} total={capacity} label={`${d.name} staffing`} tone="gold" />
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </Page>
  );
}
