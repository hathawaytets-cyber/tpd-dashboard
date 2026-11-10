"use client";

import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, BookOpen, Car, ExternalLink, History, Lock, MapPin, Play, RotateCw, ShieldCheck, Square } from "lucide-react";
import { usePatrol } from "./patrol-provider";
import { SessionDrawer, SessionStatusLabel, sessionStatus } from "./session-drawer";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Page, PageHeader } from "@/components/shell/page";
import { ANCHORCAD_URL } from "@/components/shell/nav-config";
import { Button, ButtonLink } from "@/components/ui/button";
import { BarChart, HourMeter } from "@/components/ui/data-viz";
import { Callout, EmptyState, Skeleton, toast } from "@/components/ui/feedback";
import { Field, Textarea } from "@/components/ui/field";
import { Avatar, RankMark } from "@/components/ui/identity";
import { Dialog } from "@/components/ui/overlay";
import { Dot, Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { atLeast } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatClock, formatMinutes, REQUIRED_MINUTES, formatTime } from "@/lib/domain/activity";
import { exemptReason, memberDaily, memberTrend, memberWeek } from "@/lib/preview/derived";
import { useMe, useNow } from "@/lib/preview/hooks";
import { memberById, OperationError, requests, usePreviewState, type PatrolDistrict, type PreviewState, type SessionRecord } from "@/lib/preview/store";
import { HANDBOOK_URL } from "@/lib/public-nav";
import { VEHICLES, vehicleAuthorized } from "@/lib/sample-data";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const time = (t: number) => formatTime(t);

export function PatrolConsole() {
  const me = useMe();
  const state = usePreviewState();
  const patrol = usePatrol();
  const now = useNow(1000, !!me?.session);

  if (!me || !state || !now || patrol.phase === "loading") return <ConsoleSkeleton />;

  const onDuty = patrol.phase === "on-duty" || patrol.phase === "ending";
  const week = memberWeek(state, me.member.id, now);

  return (
    <Page wide>
      <PageHeader
        eyebrow="Patrol"
        title={onDuty ? "Active patrol" : patrol.phase === "recovering" ? "Reconnecting…" : "Patrol console"}
        description={onDuty ? "Your session is running. End it here when you go off duty." : "Clock on for your district. Your time counts toward the 3-hour weekly requirement (Handbook §3.2)."}
        meta={
          <>
            <Pill tone={onDuty ? "gold" : "neutral"} dotted>
              {onDuty ? "On duty" : "Off duty"}
            </Pill>
            <Pill tone={week >= REQUIRED_MINUTES ? "green" : "neutral"}>{formatMinutes(week)} of 3h this week</Pill>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,68fr)_minmax(300px,32fr)] xl:gap-6">
        <div className="flex min-w-0 flex-col gap-5 xl:gap-6">
          {!patrol.canStart && !me.session ? (
            <LockedConsole />
          ) : patrol.phase === "recovering" ? (
            <RecoveringConsole />
          ) : onDuty && me.session ? (
            <ActiveConsole session={me.session} now={now} week={week} />
          ) : (
            <StartConsole state={state} />
          )}

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 xl:gap-6">
            <WeekProgress state={state} now={now} week={week} />
            <Trend state={state} now={now} />
          </div>

          <SessionHistory state={state} />
        </div>

        <aside aria-label="Patrol references" className="flex min-w-0 flex-col gap-5 xl:gap-6">
          <SupervisorsOnDuty state={state} now={now} />
          <Fleet />
          <PolicyRefs />
        </aside>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- console states

function ConsoleFrame({ children, live }: { children: React.ReactNode; live?: boolean }) {
  return (
    <section aria-label="Patrol console" className="relative isolate overflow-hidden rounded-xl bg-obsidian text-on-dark shadow-md ring-1 ring-dark-line">
      <Image src="/brand/charger-hero.webp" alt="" fill sizes="(min-width:1280px) 1000px, 100vw" className="-z-10 object-cover object-[70%_55%] opacity-35" priority />
      <div
        aria-hidden
        className="absolute inset-0 -z-10 bg-[linear-gradient(95deg,var(--obsidian)_38%,color-mix(in_srgb,var(--obsidian)_60%,transparent)_70%,color-mix(in_srgb,var(--obsidian)_40%,transparent)),linear-gradient(0deg,color-mix(in_srgb,var(--obsidian)_55%,transparent),transparent_60%)]"
      />
      {live ? <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gold" /> : null}
      {children}
    </section>
  );
}

function StartConsole({ state }: { state: PreviewState }) {
  const me = useMe()!;
  const patrol = usePatrol();
  const [district, setDistrict] = useState<PatrolDistrict>(me.member.district === "South" ? "South" : "North");
  const busy = patrol.phase !== "idle";
  const live = state.sessions.filter((s) => s.end === null);

  return (
    <ConsoleFrame>
      <div className="p-5 sm:p-7">
        <p className="flex items-center gap-2 text-2xs font-semibold text-on-dark-muted">
          <Dot tone="dark" /> Off duty
        </p>
        <h2 className="display mt-2 text-[32px] leading-tight font-bold tracking-tight sm:text-[40px]">Ready to go on patrol?</h2>
        <p className="mt-1.5 max-w-md text-xs text-on-dark-muted">Pick your district. The clock uses the time you press Start, and you can end it from any page.</p>

        <fieldset className="mt-5 grid max-w-xl gap-2.5 sm:grid-cols-2" disabled={busy}>
          <legend className="sr-only">District</legend>
          {(["North", "South"] as const).map((d) => {
            const people = live.filter((s) => s.district === d);
            const sup = people.some((s) => {
              const m = memberById(s.memberId);
              return m && atLeast(m.rank, "Sergeant");
            });
            const checked = district === d;
            return (
              <label
                key={d}
                className={cn(
                  "relative flex cursor-pointer flex-col gap-1 rounded-lg p-3.5 ring-1 transition-colors ring-inset has-focus-visible:outline-2 has-focus-visible:outline-gold",
                  checked ? "bg-gold/12 ring-gold/60" : "bg-white/4 ring-white/10 hover:bg-white/7",
                )}
              >
                <input type="radio" name="district" value={d} checked={checked} onChange={() => setDistrict(d)} className="sr-only" />
                <span className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold">
                    <MapPin className={cn("size-4", checked ? "text-gold" : "text-on-dark-muted")} aria-hidden />
                    {d} District
                  </span>
                  <span aria-hidden className={cn("size-4 rounded-full ring-2 ring-inset", checked ? "bg-gold ring-gold" : "ring-white/25")} />
                </span>
                <span className="text-3xs text-on-dark-muted">
                  {people.length} on patrol · {sup ? "supervisor on duty" : "no supervisor on duty"}
                </span>
              </label>
            );
          })}
        </fieldset>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button variant="gold" size="xl" loading={patrol.phase === "starting"} disabled={busy} onClick={() => patrol.start(district)} icon={<Play className="size-4 fill-current" />}>
            {patrol.phase === "starting" ? "Starting…" : `Start patrol in ${district}`}
          </Button>
        </div>
      </div>
    </ConsoleFrame>
  );
}

function ActiveConsole({ session, now, week }: { session: SessionRecord; now: number; week: number }) {
  const me = useMe()!;
  const patrol = usePatrol();
  const elapsed = now - session.start;
  const longRunning = elapsed > 4 * 3600_000;

  return (
    <ConsoleFrame live>
      <div className="grid gap-6 p-5 sm:p-7 lg:grid-cols-[minmax(0,1fr)_auto]">
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-2xs font-semibold text-gold">
            <Dot tone="gold" live /> On duty · {session.district} District
          </p>
          <p className="display-x mt-2 text-[56px] leading-none font-bold tracking-tight text-on-dark tabular sm:text-[76px]" role="timer" aria-label={`Session time ${formatClock(elapsed / 1000)}`}>
            {formatClock(elapsed / 1000)}
          </p>
          <dl className="mt-5 grid max-w-xl grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
            {[
              ["Started", time(session.start)],
              ["District", session.district],
              ["Assignment", me.member.appointment],
              ["Session", session.id],
            ].map(([l, v]) => (
              <div key={l} className="min-w-0">
                <dt className="text-3xs text-on-dark-muted">{l}</dt>
                <dd className="mt-0.5 text-xs font-semibold break-words">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-5 max-w-xl">
            <div className="mb-1.5 flex justify-between text-3xs text-on-dark-muted">
              <span>Week including this session</span>
              <span className="font-semibold text-on-dark tabular">{formatMinutes(week)} / 3h</span>
            </div>
            <HourMeter minutes={week} dark live />
          </div>
        </div>
        <div className="flex flex-col gap-2.5 lg:w-52 lg:justify-end">
          {ANCHORCAD_URL ? (
            <a
              href={ANCHORCAD_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-gold px-5 text-sm font-semibold text-on-gold hover:bg-gold-hover"
            >
              <ExternalLink className="size-4" aria-hidden /> Open AnchorCAD
            </a>
          ) : (
            <p role="status" className="flex h-11 items-center justify-center gap-2 rounded-md bg-obsidian-2/90 px-4 text-xs font-medium text-on-dark-muted ring-1 ring-dark-line">
              <ExternalLink className="size-4" aria-hidden /> AnchorCAD link not configured
            </p>
          )}
          <Button variant="danger" size="lg" onClick={patrol.requestEnd} loading={patrol.phase === "ending"} disabled={patrol.phase !== "on-duty"} icon={<Square className="size-3.5 fill-current" />}>
            {patrol.phase === "ending" ? "Ending…" : "End patrol"}
          </Button>
          <p className="text-center text-3xs text-on-dark-muted lg:text-right">Asks you to confirm first</p>
        </div>
      </div>
      {longRunning ? (
        <div className="flex items-start gap-2.5 border-t border-amber/30 bg-amber/10 px-5 py-3 text-2xs text-amber sm:px-7">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          This session has run more than 4 hours. If you forgot to end it, end it now and request a correction. Sessions over 12 hours are capped and sent for review.
        </div>
      ) : null}
    </ConsoleFrame>
  );
}

function RecoveringConsole() {
  return (
    <ConsoleFrame>
      <div className="flex items-center gap-4 p-7" role="status">
        <RotateCw className="size-6 animate-spin text-gold motion-reduce:animate-none" aria-hidden />
        <div>
          <p className="text-sm font-semibold">Reconnecting to your open patrol…</p>
          <p className="text-2xs text-on-dark-muted">We found a session that was still running when you left.</p>
        </div>
      </div>
    </ConsoleFrame>
  );
}

function LockedConsole() {
  return (
    <ConsoleFrame>
      <div className="p-5 sm:p-7">
        <p className="flex items-center gap-2 text-2xs font-semibold text-on-dark-muted">
          <Lock className="size-3.5 text-gold" aria-hidden /> Independent patrol locked
        </p>
        <h2 className="display mt-2 text-[28px] leading-tight font-bold tracking-tight sm:text-[34px]">You’re still in field training</h2>
        <p className="mt-1.5 max-w-lg text-xs text-on-dark-muted">
          Probationary officers patrol with their PTO until the Office of the Chiefs approves independent patrol (Handbook §3.1). You are exempt from the weekly requirement until then (Handbook §3.2).
        </p>
        <ButtonLink href="/hq/training" variant="gold" className="mt-5">
          View training progress
        </ButtonLink>
      </div>
    </ConsoleFrame>
  );
}

// ---------------------------------------------------------------- analytics

export function WeekProgress({ state, now, week }: { state: PreviewState; now: number; week: number }) {
  const me = useMe()!;
  const daily = memberDaily(state, me.member.id, now);
  const today =
    (new Date(
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(now),
    ).getDay() +
      6) %
    7;
  const exempt = exemptReason(me.member);
  const left = Math.max(0, REQUIRED_MINUTES - week);
  return (
    <Card>
      <CardHeader title="Weekly progress" description={exempt ?? (left ? `${formatMinutes(left)} remaining · Monday to Sunday, Tampa time (interim)` : "Requirement met for this week")} />
      <div className="flex flex-col gap-4 px-4 pb-4">
        <HourMeter minutes={week} exempt={!!exempt} />
        <BarChart values={daily} labels={DAYS} highlight={today} height={88} label="Minutes per day this week" />
      </div>
    </Card>
  );
}

export function Trend({ state, now }: { state: PreviewState; now: number }) {
  const me = useMe()!;
  const trend = memberTrend(state, me.member.id, now, 6);
  const met = trend.filter((t) => t.minutes >= REQUIRED_MINUTES).length;
  const history = trend.slice(0, -1).some((t) => t.minutes > 0);
  return (
    <Card>
      <CardHeader title="Six-week trend" description={history ? `Met the requirement ${met} of the last 6 weeks` : "Weekly totals, target 3 hours"} />
      {!history ? (
        <EmptyState icon={<History />} title="Not enough history yet" body="Your trend appears once you have patrols in earlier weeks." />
      ) : (
        <div className="px-4 pt-3 pb-4">
          <BarChart
            values={trend.map((t) => t.minutes)}
            labels={trend.map((t) => t.label)}
            target={REQUIRED_MINUTES}
            highlight={trend.length - 1}
            height={120}
            label="Weekly patrol minutes, last six weeks"
          />
        </div>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- history + corrections

export function SessionHistory({ state }: { state: PreviewState }) {
  const me = useMe()!;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [target, setTarget] = useState<SessionRecord | null>(null);
  const mine = useMemo(() => state.sessions.filter((s) => s.memberId === me.member.id && s.end !== null), [state.sessions, me.member.id]);
  const openId = params.get("session");
  const open = openId ? (state.sessions.find((s) => s.id === openId) ?? null) : null;
  const show = (s: SessionRecord) => router.replace(`${pathname}?session=${s.id}#history`, { scroll: false });
  const hide = () => router.replace(`${pathname}#history`, { scroll: false });

  useEffect(() => {
    if (window.location.hash === "#history" && !openId) document.getElementById("history")?.scrollIntoView({ block: "start" });
  }, [openId]);

  const columns: Column<SessionRecord>[] = [
    {
      key: "date",
      header: "Date",
      sort: (s) => s.start,
      text: (s) => new Date(s.start).toISOString(),
      cell: (s) => (
        <span className="leading-tight">
          <span className="block font-medium">
            {new Date(s.start).toLocaleDateString("en-US", {
              weekday: "short",
              month: "short",
              day: "numeric",
            })}
          </span>
          <span className="block text-3xs text-muted">{s.id}</span>
        </span>
      ),
    },
    {
      key: "district",
      header: "District",
      sort: (s) => s.district,
      cell: (s) => s.district,
    },
    {
      key: "range",
      header: "Time range",
      text: (s) => `${time(s.start)}-${time(s.end!)}`,
      cell: (s) => (
        <span className="tabular text-ink-2">
          {time(s.start)}–{time(s.end!)}
        </span>
      ),
    },
    {
      key: "duration",
      header: "Duration",
      align: "right",
      sort: (s) => s.end! - s.start,
      text: (s) => String(Math.floor((s.end! - s.start) / 60000)),
      cell: (s) => <span className="font-semibold">{formatMinutes(Math.floor((s.end! - s.start) / 60000))}</span>,
    },
    {
      key: "status",
      header: "Status",
      sort: (s) => sessionStatus(s).label,
      text: (s) => sessionStatus(s).label,
      cell: (s) => <SessionStatusLabel session={s} />,
    },
    {
      key: "actions",
      header: "Actions",
      align: "right",
      cell: (s) => (
        <span className="inline-flex gap-1" onClick={(e) => e.stopPropagation()}>
          <Button size="xs" variant="ghost" onClick={() => show(s)} aria-label={`View ${s.id}`}>
            View
          </Button>
          <Button size="xs" variant="ghost" disabled={s.flag === "Correction pending"} onClick={() => setTarget(s)} aria-label={`Request correction for ${s.id}`}>
            Correct
          </Button>
        </span>
      ),
    },
  ];

  return (
    <Card id="history" className="scroll-mt-20">
      <CardHeader title="Session history" description="Times are recorded when you press Start and End. Select a session for details; corrections need a reason (Handbook §6)." />
      <DataTable
        label="Session history"
        rows={mine}
        columns={columns}
        rowKey={(s) => s.id}
        onRowClick={show}
        activeKey={openId}
        initialSort={{ key: "date", dir: "desc" }}
        pageSize={8}
        empty={<EmptyState icon={<History />} title="No sessions yet" body="Your completed patrols will be listed here." />}
      />
      <SessionDrawer session={open} state={state} onClose={hide} onRequestCorrection={setTarget} />
      <CorrectionDialog session={target} onClose={() => setTarget(null)} />
    </Card>
  );
}

function CorrectionDialog({ session, onClose }: { session: SessionRecord | null; onClose: () => void }) {
  const id = useId();
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setText("");
    setError(null);
  }, [session?.id]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!session || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await requests.createCorrection(session.id, text);
      toast("success", `Correction ${r.id} submitted`, "Your supervisor will review it. The original times stay on record.");
      onClose();
    } catch (err) {
      if (!(err instanceof OperationError && err.message === "Already in progress")) setError(err instanceof Error ? err.message : "Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={!!session}
      onClose={() => !busy && onClose()}
      title="Request a correction"
      description="The original record never changes. A supervisor reviews your explanation and decides."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={`${id}-f`} loading={busy}>
            {busy ? "Submitting…" : "Submit for review"}
          </Button>
        </>
      }
    >
      {session ? (
        <form id={`${id}-f`} onSubmit={submit} className="flex flex-col gap-4">
          <div className="grid grid-cols-3 gap-3 rounded-lg bg-surface-2 p-3 ring-1 ring-line ring-inset">
            <div>
              <p className="text-3xs text-muted">Session</p>
              <p className="text-xs font-semibold">{session.id}</p>
            </div>
            <div>
              <p className="text-3xs text-muted">Recorded</p>
              <p className="text-xs font-semibold tabular">
                {time(session.start)}–{time(session.end!)}
              </p>
            </div>
            <div>
              <p className="text-3xs text-muted">Duration</p>
              <p className="text-xs font-semibold tabular">{formatMinutes(Math.floor((session.end! - session.start) / 60000))}</p>
            </div>
          </div>
          <Field label="What should change, and why?" htmlFor={`${id}-t`} error={error} hint="For example: “Game crashed at 21:30; end time should be 21:30.”">
            <Textarea id={`${id}-t`} value={text} onChange={(e) => setText(e.target.value)} rows={4} aria-invalid={!!error || undefined} autoFocus />
          </Field>
        </form>
      ) : null}
    </Dialog>
  );
}

// ---------------------------------------------------------------- references

function SupervisorsOnDuty({ state, now }: { state: PreviewState; now: number }) {
  const sups = state.sessions
    .filter((s) => s.end === null)
    .map((s) => ({ s, m: memberById(s.memberId)! }))
    .filter(({ m }) => m && atLeast(m.rank, "Sergeant"));
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-gold-ink" aria-hidden /> Supervisors on duty
          </span>
        }
        description="Sergeant and above with an open patrol session. Pursuits need Sergeant+ authorization (Handbook §7)"
      />
      {sups.length === 0 ? (
        <div className="border-t border-line px-4 py-3">
          <Callout tone="warn" title="No supervisor on duty">
            Pursuits are not authorized without an on-duty supervisor.
          </Callout>
        </div>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {sups.map(({ s, m }) => (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <Avatar name={m.name} size={28} />
              <div className="min-w-0 flex-1 leading-tight">
                <p className="truncate text-xs font-semibold">{m.name}</p>
                <p className="truncate text-3xs text-muted">
                  <RankMark rank={m.rank} /> · {m.callsign}
                </p>
              </div>
              <div className="text-right leading-tight">
                <p className="text-3xs font-semibold text-gold-ink">{s.district} District</p>
                <p className="text-3xs text-muted tabular">{formatMinutes(Math.floor((now - s.start) / 60000))}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function Fleet() {
  const me = useMe()!;
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <Car className="size-4 text-gold-ink" aria-hidden /> Authorized vehicles
          </span>
        }
        description={`For your rank: ${me.member.rank} (fleet matrix, Handbook §11)`}
      />
      <ul className="divide-y divide-line border-t border-line">
        {VEHICLES.map((v) => {
          const ok = vehicleAuthorized(me.member.rank, v);
          return (
            <li key={v.name} className={cn("flex items-center gap-3 px-4 py-2", !ok && "opacity-55")}>
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium">{v.name}</p>
                <p className="truncate text-3xs text-muted">In game: {v.model}</p>
                <p className="truncate text-3xs text-muted">{v.use}</p>
              </div>
              {ok ? <Pill tone="green">Authorized</Pill> : <span className="text-3xs whitespace-nowrap text-muted">{v.minRank}+</span>}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function PolicyRefs() {
  const refs = [
    { s: "§3.2", t: "Weekly activity: 3 documented hours" },
    { s: "§6", t: "Log shift start and end accurately" },
    { s: "§7", t: "Pursuits need Sergeant+ authorization" },
    { s: "§10", t: "All field reports go in AnchorCAD" },
    { s: "§10.1", t: "Attach bodycam footage when available" },
  ];
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <BookOpen className="size-4 text-gold-ink" aria-hidden /> On-patrol references
          </span>
        }
        action={
          <a href={HANDBOOK_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-2xs font-semibold text-gold-ink hover:underline">
            Handbook <ExternalLink className="size-3" aria-hidden />
          </a>
        }
      />
      <ul className="border-t border-line px-4 py-2">
        {refs.map((r) => (
          <li key={r.s} className="flex gap-3 py-1.5 text-2xs">
            <span className="w-10 shrink-0 font-semibold text-gold-ink tabular">{r.s}</span>
            <span className="text-ink-2">{r.t}</span>
          </li>
        ))}
      </ul>
      <p className="border-t border-line px-4 py-2.5 text-3xs text-muted">Summaries only. The Personnel Handbook is the authority.</p>
    </Card>
  );
}

function ConsoleSkeleton() {
  return (
    <Page wide>
      <Skeleton className="mb-2 h-3 w-16" />
      <Skeleton className="mb-6 h-7 w-56" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-64 rounded-xl" />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Skeleton className="h-52 rounded-lg" />
            <Skeleton className="h-52 rounded-lg" />
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-40 rounded-lg" />
          <Skeleton className="h-44 rounded-lg" />
        </div>
      </div>
    </Page>
  );
}
