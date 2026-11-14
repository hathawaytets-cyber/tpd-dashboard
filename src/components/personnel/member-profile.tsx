"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, ChevronDown, ExternalLink, ShieldCheck } from "lucide-react";
import { AdminDialog, ADMIN_ACTIONS, type AdminAction } from "./admin-dialog";
import { Button } from "@/components/ui/button";
import { BarChart, HourMeter } from "@/components/ui/data-viz";
import { Avatar, RankMark } from "@/components/ui/identity";
import { MenuItem, MenuLabel, Popover } from "@/components/ui/menu";
import { Dot, Pill, type Tone } from "@/components/ui/status";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatMinutes, formatTime, REQUIRED_MINUTES } from "@/lib/domain/activity";
import { exemptReason, memberTrend, memberWeek } from "@/lib/preview/derived";
import { useMe } from "@/lib/preview/hooks";
import { memberById, type PreviewState } from "@/lib/preview/store";
import { stateTone } from "@/lib/request-tone";
import { VEHICLES, vehicleAuthorized, type Member } from "@/lib/sample-data";

export const STATUS_TONE: Record<Member["status"], Tone> = { Active: "quiet", "On leave": "gold", Probationary: "info", Suspended: "red" };

export function ProfileHeader({ member, state, now, as: H = "h2" }: { member: Member; state: PreviewState; now: number; as?: "h1" | "h2" }) {
  const live = state.sessions.find((s) => s.memberId === member.id && s.end === null);
  return (
    <div className="flex items-center gap-4">
      <Avatar name={member.name} size={56} />
      <div className="min-w-0 flex-1">
        <H className="display truncate text-lg font-bold">{member.name}</H>
        <p className="mt-0.5 truncate text-2xs text-muted">
          <RankMark rank={member.rank} /> · {member.callsign} · {member.district === "Department" ? "Department" : `${member.district} District`}
        </p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Pill tone={STATUS_TONE[member.status]}>{member.status}</Pill>
          {live ? (
            <Pill tone="gold">
              <Dot tone="gold" live /> On duty · {formatMinutes(Math.floor((now - live.start) / 60000))}
            </Pill>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/** Admin actions menu. Hidden without `personnel.manage`; the store checks again on submit. */
export function AdminActions({ member }: { member: Member }) {
  const me = useMe();
  const [action, setAction] = useState<AdminAction | null>(null);
  if (!me || !can(me.actor, "personnel.manage")) return null;
  const self = me.member.id === member.id;
  return (
    <>
      <Popover
        label="Administrative actions"
        className="w-56"
        side="top"
        trigger={({ open, toggle, id }) => (
          <Button size="sm" variant="secondary" data-popover-trigger aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle}>
            <ShieldCheck className="size-3.5" aria-hidden /> Manage <ChevronDown className="size-3.5" aria-hidden />
          </Button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>{self ? "You can’t change your own record" : "Personnel actions"}</MenuLabel>
            {ADMIN_ACTIONS.map((a) => (
              <MenuItem key={a.value} disabled={self} onSelect={() => (close(), setAction(a.value))}>
                {a.label}…
              </MenuItem>
            ))}
          </>
        )}
      </Popover>
      <AdminDialog member={action ? member : null} action={action} onClose={() => setAction(null)} />
    </>
  );
}

export function ProfileBody({ member, state, now, full }: { member: Member; state: PreviewState; now: number; full?: boolean }) {
  const week = memberWeek(state, member.id, now);
  const trend = memberTrend(state, member.id, now, full ? 8 : 6);
  const exempt = exemptReason(member);
  const reqs = state.requests.filter((r) => r.memberId === member.id).sort((a, b) => b.createdAt - a.createdAt);
  const audit = state.audit.filter((a) => a.memberId === member.id);
  const sessions = state.sessions.filter((s) => s.memberId === member.id && s.end).sort((a, b) => b.start - a.start);

  return (
    <div className={cn("grid gap-5", full && "lg:grid-cols-2")}>
      <Section title="Assignment">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
          <Item label="Appointment" value={member.appointment} />
          <Item label="Timezone" value={member.timezone} />
          <Item label="Divisions" value={member.divisions.length ? member.divisions.join(", ") : "None"} />
          <Item label="Subdivision limit" value={`${member.divisions.length} of 3 (Handbook §9.3)`} />
        </dl>
      </Section>

      <Section title="Activity this week">
        <div className="mb-2 flex items-baseline justify-between">
          <p className={cn("display text-xl font-bold tabular", week >= REQUIRED_MINUTES && "text-green")}>{formatMinutes(week)}</p>
          <p className="text-3xs text-muted">{exempt ?? "of 3 hours"}</p>
        </div>
        <HourMeter minutes={week} exempt={!!exempt} size="sm" />
        <div className="mt-4">
          <BarChart values={trend.map((t) => t.minutes)} labels={trend.map((t) => t.label)} target={REQUIRED_MINUTES} highlight={trend.length - 1} height={72} label={`Weekly minutes for ${member.name}`} />
        </div>
      </Section>

      <Section title="Authorized vehicles">
        <ul className="flex flex-col gap-1.5">
          {VEHICLES.map((v) => {
            const ok = vehicleAuthorized(member.rank, v);
            return (
              <li key={v.name} className={cn("flex items-center justify-between text-xs", !ok && "text-muted")}>
                <span>{v.name}</span>
                {ok ? (
                  <span className="inline-flex items-center gap-1 text-3xs font-medium text-muted">
                    <Check className="size-3 text-green" aria-hidden /> Yes
                  </span>
                ) : <span className="text-3xs">{v.minRank}+</span>}
              </li>
            );
          })}
        </ul>
      </Section>

      <Section title="Requests">
        {reqs.length === 0 ? (
          <p className="text-2xs text-muted">No requests.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {reqs.slice(0, 5).map((r) => (
              <li key={r.id}>
                <Link href={`/hq/requests?id=${r.id}`} className="flex items-center gap-2 text-xs hover:underline">
                  <span className="min-w-0 flex-1 truncate">
                    {r.type} <span className="text-muted">· {r.id}</span>
                  </span>
                  <Pill tone={stateTone(r.state)}>{r.state}</Pill>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {full ? (
        <Section title="Recent sessions">
          <ul className="divide-y divide-line">
            {sessions.slice(0, 8).map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-1.5 text-xs">
                <span>
                  {new Date(s.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })} <span className="text-3xs text-muted">{s.id}</span>
                </span>
                <span className="text-ink-2 tabular">
                  {formatTime(s.start)}–{formatTime(s.end!)} · <span className="font-semibold">{formatMinutes(Math.floor((s.end! - s.start) / 60000))}</span>
                </span>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Personnel history">
        {audit.length === 0 ? (
          <p className="text-2xs text-muted">No changes recorded in this preview.</p>
        ) : (
          <ol className="flex flex-col gap-2.5">
            {audit.map((a, i) => (
              <li key={i} className="text-xs">
                <p>
                  <span className="font-semibold">{a.action}</span>: {a.from} → {a.to}
                </p>
                <p className="text-3xs text-muted">
                  {memberById(a.actor)?.name} · {new Date(a.at).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })} · “{a.reason}”
                </p>
              </li>
            ))}
          </ol>
        )}
      </Section>

      {!full ? (
        <Link href={`/hq/roster/${member.id}`} className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-ink hover:underline">
          Open full profile <ExternalLink className="size-3.5" aria-hidden />
        </Link>
      ) : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-surface p-4">
      <h3 className="mb-3 text-3xs font-semibold text-muted">{title}</h3>
      {children}
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-3xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-xs font-medium">{value}</dd>
    </div>
  );
}
