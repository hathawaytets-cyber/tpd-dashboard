"use client";

import { EvaluationDueCard } from "@/components/evaluations/reminders";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { ArrowRight, ArrowUpRight, BookOpen, Car, CheckCircle2, ClipboardList, ExternalLink, Gauge, GraduationCap, Lock, Radio, Scale, ShieldCheck, Square } from "lucide-react";
import { sessionStatus } from "@/components/patrol/session-drawer";
import { ANNOUNCEMENTS } from "@/lib/announcements";
import { HANDBOOK_URL, USE_OF_FORCE_URL } from "@/lib/public-nav";
import { usePatrol } from "@/components/patrol/patrol-provider";
import { useShell } from "@/components/shell/shell-context";
import { Page } from "@/components/shell/page";
import { VerifiedIdentity } from "@/components/auth/verified-identity";
import { ANCHORCAD_URL } from "@/components/shell/nav-config";
import { Button, ButtonLink } from "@/components/ui/button";
import { HourMeter } from "@/components/ui/data-viz";
import { EmptyState, Skeleton } from "@/components/ui/feedback";
import { Avatar, RankMark } from "@/components/ui/identity";
import { Card, CardHeader } from "@/components/ui/surface";
import { Dot, Pill, type Tone } from "@/components/ui/status";
import { Segmented } from "@/components/ui/tabs";
import { can, canDecide } from "@/lib/authz";
import { cn } from "@/lib/cn";
import { formatClock, formatMinutes, REQUIRED_MINUTES, weekEnd, formatTime } from "@/lib/domain/activity";
import { exemptReason, memberWeek, openRequests, roster } from "@/lib/preview/derived";
import { useMe, useNow } from "@/lib/preview/hooks";
import { memberById, notificationsFor, usePreviewState, type PatrolDistrict, type PreviewState } from "@/lib/preview/store";
import { stateTone } from "@/lib/request-tone";
import { TRAINING_MODULES } from "@/lib/sample-data";


function greeting(now: number) {
  const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/New_York" }).format(now));
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function Dashboard() {
  const me = useMe();
  const state = usePreviewState();
  const now = useNow(30_000);

  if (!me || !state || !now) return <DashboardSkeleton />;

  const isSupervisor = can(me.actor, "supervisor.view");
  const isCommand = can(me.actor, "command.view");
  const probationary = !can(me.actor, "patrol.start");

  return (
    <Page wide>
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-2xs font-semibold text-gold-ink">{new Date(now).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}</p>
          <h1 className="display mt-1 text-2xl font-bold tracking-tight">
            {greeting(now)}, {me.member.name}
          </h1>
          <p className="mt-1 text-xs text-muted">
            <RankMark rank={me.member.rank} /> · {me.member.callsign} · {me.member.district === "Department" ? "Department" : `${me.member.district} District`}
          </p>
        </div>
        {me.member.divisions.length ? (
          <ul aria-label="Divisions" className="flex flex-wrap gap-1.5">
            {me.member.divisions.map((d) => (
              <li key={d}>
                <Pill tone="gold">{d}</Pill>
              </li>
            ))}
          </ul>
        ) : null}
      </header>
      <div className="mb-5 empty:hidden">
        <VerifiedIdentity />
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)] xl:gap-6">
        <div className="flex min-w-0 flex-col gap-5 xl:gap-6">
          <EvaluationDueCard />
          {probationary ? <TrainingHero /> : <DutyHero state={state} now={now} />}
          {isCommand ? <CommandShortcut state={state} now={now} /> : null}
          <RecentPatrols state={state} />
          <MyAttention state={state} probationary={probationary} />
        </div>

        <aside aria-label="Your work" className="flex min-w-0 flex-col gap-5 xl:gap-6">
          {isSupervisor ? <ReviewQueue state={state} /> : null}
          <TrainingProgress probationary={probationary} />
          <QuickAccess />
          <Announcements />
        </aside>
      </div>
    </Page>
  );
}

// ---------------------------------------------------------------- hero: duty

function DutyHero({ state, now }: { state: PreviewState; now: number }) {
  const me = useMe()!;
  const patrol = usePatrol();
  const tick = useNow(1000, !!me.session);
  const [district, setDistrict] = useState<PatrolDistrict>(me.member.district === "South" ? "South" : "North");
  const week = memberWeek(state, me.member.id, tick || now);
  const remaining = Math.max(0, REQUIRED_MINUTES - week);
  const onDuty = patrol.phase === "on-duty" || patrol.phase === "ending" || patrol.phase === "recovering";
  const resets = weekEnd(new Date(now)).toLocaleDateString("en-US", { weekday: "long", timeZone: "America/New_York" });

  return (
    <section aria-labelledby="duty-h" className="relative isolate overflow-hidden rounded-xl bg-obsidian text-on-dark shadow-md ring-1 ring-dark-line">
      <Image src="/brand/tampa-banner-1200.webp" alt="" fill sizes="(min-width:1280px) 900px, 100vw" className="-z-10 object-cover object-[60%_40%] opacity-25" priority />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,var(--obsidian)_30%,color-mix(in_srgb,var(--obsidian)_70%,transparent)_65%,color-mix(in_srgb,var(--obsidian)_35%,transparent))]" />
      {onDuty ? <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-gold" /> : null}

      <div className="grid gap-6 p-5 sm:p-6 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
        <div className="min-w-0">
          <h2 id="duty-h" className="flex items-center gap-2 text-2xs font-semibold text-on-dark-muted">
            <Dot tone={onDuty ? "gold" : "dark"} live={onDuty} />
            {patrol.phase === "recovering" ? "Reconnecting to your patrol…" : onDuty ? `On duty · ${me.session?.district} District` : "Off duty"}
          </h2>
          {onDuty && me.session ? (
            <p className="display-x mt-2 text-[44px] leading-none font-bold tracking-tight text-gold tabular sm:text-[56px]" aria-live="off">
              {formatClock(((tick || now) - me.session.start) / 1000)}
            </p>
          ) : (
            <p className="display mt-2 text-[40px] leading-none font-bold tracking-tight tabular sm:text-[48px]">
              {formatMinutes(week)}
              <span className="ml-2 text-base font-medium text-on-dark-muted">of 3h this week</span>
            </p>
          )}
          <p className="mt-2 text-xs text-on-dark-muted">
            {onDuty && me.session
              ? `Started ${formatTime(me.session.start)} · ${formatMinutes(week)} this week including this session`
              : remaining > 0
                ? `${formatMinutes(remaining)} to go before the week resets ${resets}.`
                : "Weekly requirement met. Thank you."}
          </p>
          {!onDuty ? (
            <p className="mt-1 text-3xs text-on-dark-muted">{exemptReason(me.member) ?? "Eligible for independent patrol (Handbook §3.1) · 3 documented hours a week (Handbook §3.2)"}</p>
          ) : null}
          <div className="mt-4 max-w-md">
            <HourMeter minutes={week} dark live={onDuty} size="lg" />
          </div>
        </div>

        <div className="flex flex-col items-stretch gap-2.5 md:items-end">
          {onDuty ? (
            <>
              <ButtonLink href="/hq/patrol" variant="gold" size="lg">
                <Radio className="size-4" aria-hidden /> Open patrol console
              </ButtonLink>
              <Button variant="dark" onClick={patrol.requestEnd} disabled={patrol.phase !== "on-duty"} icon={<Square className="size-3.5" />}>
                End patrol
              </Button>
            </>
          ) : (
            <>
              <Segmented
                dark
                size="sm"
                label="District"
                value={district}
                onChange={setDistrict}
                disabled={patrol.phase !== "idle"}
                options={[
                  { value: "North", label: "North" },
                  { value: "South", label: "South" },
                ]}
              />
              <Button variant="gold" size="lg" loading={patrol.phase === "starting"} disabled={patrol.phase !== "idle"} onClick={() => patrol.start(district)}>
                {patrol.phase === "starting" ? "Starting…" : `Start patrol · ${district}`}
              </Button>
            </>
          )}
          <p className="text-3xs text-on-dark-muted">Report incidents in AnchorCAD (Handbook §10)</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- hero: probationary

function TrainingHero() {
  const done = TRAINING_MODULES.filter((m) => m.state === "Complete").length;
  const next = TRAINING_MODULES.find((m) => m.state !== "Complete");
  return (
    <section aria-labelledby="train-h" className="relative isolate overflow-hidden rounded-xl bg-obsidian text-on-dark shadow-md ring-1 ring-dark-line">
      <Image src="/brand/tampa-banner-1200.webp" alt="" fill sizes="(min-width:1280px) 900px, 100vw" className="-z-10 object-cover opacity-20" priority />
      <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,var(--obsidian)_35%,transparent)]" />
      <div className="p-5 sm:p-6">
        <h2 id="train-h" className="flex items-center gap-2 text-2xs font-semibold text-on-dark-muted">
          <GraduationCap className="size-3.5 text-gold" aria-hidden /> Field training program
        </h2>
        <p className="display mt-2 text-[40px] leading-none font-bold tracking-tight tabular">
          {done}
          <span className="text-on-dark-muted">/{TRAINING_MODULES.length}</span>
          <span className="ml-2 text-base font-medium text-on-dark-muted">steps complete</span>
        </p>
        <ol className="mt-4 grid grid-cols-7 gap-1.5" aria-label="Training steps">
          {TRAINING_MODULES.map((m) => (
            <li key={m.key} title={`${m.title}: ${m.state}`} className={cn("h-2 rounded-full", m.state === "Complete" ? "bg-gold" : m.state === "In progress" ? "bg-gold/40" : "bg-white/10")}>
              <span className="sr-only">
                {m.title}: {m.state}
              </span>
            </li>
          ))}
        </ol>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {next ? (
            <ButtonLink href="/hq/training" variant="gold">
              Continue: {next.title} <ArrowRight className="size-4" aria-hidden />
            </ButtonLink>
          ) : null}
          <span className="inline-flex items-center gap-1.5 text-2xs text-on-dark-muted">
            <Lock className="size-3.5" aria-hidden /> Independent patrol unlocks after Office of the Chiefs approval (Handbook §3.1)
          </span>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- right rail

export function ReviewQueue({ state }: { state: PreviewState }) {
  const me = useMe()!;
  const isCommand = can(me.actor, "command.view");
  const queue = openRequests(state)
    .filter((r) => canDecide(me.actor, r.type, r.memberId === me.member.id))
    .sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  const assigned = queue.filter((r) => r.reviewerId === me.member.id).length;
  return (
    <Card className="border-gold/40">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-gold-ink" aria-hidden /> Waiting on your decision
          </span>
        }
        description={`${queue.length} you can decide · ${assigned} assigned to you`}
        action={
          <Link href={isCommand ? "/hq/command" : "/hq/requests?view=review"} className="text-2xs font-semibold text-gold-ink hover:underline">
            Open queue
          </Link>
        }
      />
      {queue.length === 0 ? (
        <p className="border-t border-line px-4 py-6 text-center text-2xs text-muted">Nothing needs your decision.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {queue.slice(0, 4).map((r) => {
            const who = memberById(r.memberId)!;
            return (
              <li key={r.id}>
                <Link href={isCommand ? `/hq/command?id=${r.id}` : `/hq/requests?id=${r.id}`} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                  <Avatar name={who.name} size={26} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-medium">
                      {r.type} <span className="font-normal text-muted">· {who.name}</span>
                    </p>
                    <p className="truncate text-3xs text-muted">{r.summary}</p>
                  </div>
                  <ArrowUpRight className="size-3.5 text-muted" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- supervisor / command

export function DistrictBoard({ state, now, district }: { state: PreviewState; now: number; district: string }) {
  const rows = roster(state, now).filter((r) => district === "Department" || r.member.district === district);
  const onDuty = rows.filter((r) => r.onDuty);
  const me = useMe()!;
  const atRisk = rows.filter((r) => r.band === "at-risk" && r.member.id !== me.member.id);
  return (
    <Card>
      <CardHeader
        title={`${district} District right now`}
        description={`${onDuty.length} on duty · ${atRisk.length} below half of the weekly requirement`}
        action={
          <Link href="/hq/supervisor" className="text-2xs font-semibold text-gold-ink hover:underline">
            Supervisor desk
          </Link>
        }
      />
      <div className="grid border-t border-line md:grid-cols-2 md:divide-x md:divide-line">
        <PeopleList title="On duty" rows={onDuty} now={now} empty="Nobody is on patrol in this district." live />
        <PeopleList title="Needs a check-in" rows={atRisk} now={now} empty="Everyone is on track this week." />
      </div>
    </Card>
  );
}

function PeopleList({ title, rows, now, empty, live }: { title: string; rows: ReturnType<typeof roster>; now: number; empty: string; live?: boolean }) {
  return (
    <div className="min-w-0 p-4">
      <p className="mb-2 text-3xs font-semibold text-muted">{title}</p>
      {rows.length === 0 ? (
        <p className="text-2xs text-muted">{empty}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.slice(0, 5).map((r) => (
            <li key={r.member.id}>
              <Link href={`/hq/roster?member=${r.member.id}`} className="flex items-center gap-2.5 rounded-md hover:bg-surface-2">
                <Avatar name={r.member.name} size={26} />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-xs font-medium">{r.member.name}</span>
                  <span className="block truncate text-3xs text-muted">
                    <RankMark rank={r.member.rank} /> · {r.member.callsign}
                  </span>
                </span>
                {live && r.onDuty ? (
                  <span className="flex items-center gap-1.5 text-3xs font-semibold text-gold-ink tabular">
                    <Dot tone="gold" live /> {formatMinutes(Math.floor((now - r.onDuty.start) / 60000))}
                  </span>
                ) : (
                  <span className="text-3xs font-semibold text-amber tabular">{formatMinutes(r.week)}</span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- main column

function RecentPatrols({ state }: { state: PreviewState }) {
  const me = useMe()!;
  const mine = state.sessions.filter((s) => s.memberId === me.member.id && s.end).sort((a, b) => b.start - a.start).slice(0, 5);
  return (
    <Card>
      <CardHeader
        title="Recent patrols"
        action={
          <Link href="/hq/patrol#history" className="text-2xs font-semibold text-gold-ink hover:underline">
            All sessions
          </Link>
        }
      />
      {mine.length === 0 ? (
        <EmptyState icon={<Radio />} title="No patrols yet" body="Sessions you log appear here with their duration." />
      ) : (
        <div className="border-t border-line">
          <table aria-label="Recent patrols" className="w-full text-left text-xs">
            <thead className="bg-surface-2 text-3xs text-muted">
              <tr>
                <th scope="col" className="px-4 py-2 font-semibold">Date</th>
                <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">District</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Duration</th>
                <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">Status</th>
                <th scope="col" className="px-4 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {mine.map((s) => {
                const st = sessionStatus(s);
                return (
                  <tr key={s.id} className="hover:bg-surface-2">
                    <td className="px-4 py-2.5">
                      <span className="font-medium whitespace-nowrap">{new Date(s.start).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}</span>
                      <span className="block text-3xs text-muted tabular sm:ml-2 sm:inline">
                        {formatTime(s.start)}–{formatTime(s.end!)}
                        <span className="sm:hidden"> · {s.district}</span>
                      </span>
                      {st.label !== "Recorded" ? (
                        <span className="mt-1 block sm:hidden">
                          <Pill tone={st.tone}>{st.label}</Pill>
                        </span>
                      ) : null}
                    </td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">{s.district}</td>
                    <td className="px-3 py-2.5 text-right font-semibold tabular">{formatMinutes(Math.floor((s.end! - s.start) / 60000))}</td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <Pill tone={st.tone}>{st.label}</Pill>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Link href={`/hq/patrol?session=${s.id}#history`} className="text-2xs font-semibold text-gold-ink hover:underline" aria-label={`View session ${s.id}`}>
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

interface AttentionItem {
  key: string;
  href: string;
  title: string;
  detail: string;
  pill?: { label: string; tone: Tone };
}

/** Only records that need something from the member: open requests, flagged sessions, outstanding training, unread decisions. */
function MyAttention({ state, probationary }: { state: PreviewState; probationary: boolean }) {
  const me = useMe()!;
  const { openNewRequest } = useShell();
  const items: AttentionItem[] = [];
  for (const r of state.requests.filter((x) => x.memberId === me.member.id && (x.state === "Submitted" || x.state === "Under review")).sort((a, b) => b.createdAt - a.createdAt)) {
    const last = r.history[r.history.length - 1];
    const asked = last?.action === "Clarification requested";
    items.push({ key: r.id, href: `/hq/requests?id=${r.id}`, title: asked ? `${r.type}: reviewer asked for more information` : `${r.type} pending`, detail: `${r.id} · ${r.summary}`, pill: { label: asked ? "Your reply needed" : r.state, tone: asked ? "amber" : stateTone(r.state) } });
  }
  for (const s of state.sessions.filter((x) => x.memberId === me.member.id && x.flag === "Needs review")) {
    items.push({ key: s.id, href: `/hq/patrol?session=${s.id}#history`, title: "Session capped at 12 hours", detail: `${s.id} was sent for supervisor review`, pill: { label: "Needs review", tone: "amber" } });
  }
  if (probationary) {
    const left = TRAINING_MODULES.filter((m) => m.state !== "Complete");
    if (left.length) items.push({ key: "training", href: "/hq/training", title: `${left.length} training steps outstanding`, detail: `Next: ${left[0].title}`, pill: { label: "Training", tone: "info" } });
  }
  const decisions = notificationsFor(state).filter((n) => !state.readNotifications.includes(n.id) && !n.id.includes(":queue:") && n.href.startsWith("/hq/requests"));
  for (const n of decisions.slice(0, 3)) items.push({ key: n.id, href: n.href, title: n.title, detail: n.body, pill: { label: "Unread", tone: "gold" } });

  return (
    <Card>
      <CardHeader
        title="My attention"
        description={items.length ? `${items.length} item${items.length === 1 ? "" : "s"}` : undefined}
        action={
          <Button size="xs" variant="secondary" onClick={() => openNewRequest()}>
            New request
          </Button>
        }
      />
      {items.length === 0 ? (
        <p className="border-t border-line px-4 py-6 text-center text-2xs text-muted">Nothing needs your attention. Requests, flagged sessions and training appear here.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {items.map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex items-center gap-3 px-4 py-2.5 transition-colors hover:bg-surface-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium">{i.title}</p>
                  <p className="truncate text-3xs text-muted">{i.detail}</p>
                </div>
                {i.pill ? <Pill tone={i.pill.tone}>{i.pill.label}</Pill> : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function CommandShortcut({ state, now }: { state: PreviewState; now: number }) {
  const me = useMe()!;
  const waiting = openRequests(state).filter((r) => canDecide(me.actor, r.type, r.memberId === me.member.id)).length;
  const overdue = openRequests(state).filter((r) => r.dueAt && r.dueAt < now).length;
  const onDuty = state.sessions.filter((s) => s.end === null).length;
  return (
    <Link href="/hq/command" className="group flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg border border-line bg-surface px-4 py-3 text-xs shadow-sm transition-colors hover:border-line-strong">
      <span className="flex items-center gap-2 font-semibold">
        <Gauge className="size-4 text-gold-ink" aria-hidden /> Command Center
      </span>
      <span className="text-muted">
        <span className="font-semibold text-ink tabular">{waiting}</span> awaiting your decision · <span className="font-semibold text-ink tabular">{onDuty}</span> on duty
        {overdue ? (
          <>
            {" "}· <span className="font-semibold text-amber tabular">{overdue}</span> past due
          </>
        ) : null}
      </span>
      <ArrowRight className="ml-auto size-4 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
    </Link>
  );
}

// ---------------------------------------------------------------- supporting column

function TrainingProgress({ probationary }: { probationary: boolean }) {
  const done = TRAINING_MODULES.filter((m) => m.state === "Complete").length;
  const left = TRAINING_MODULES.filter((m) => m.state !== "Complete");
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <GraduationCap className="size-4 text-gold-ink" aria-hidden /> Training
          </span>
        }
        action={
          <Link href="/hq/training" className="text-2xs font-semibold text-gold-ink hover:underline">
            Open training
          </Link>
        }
      />
      <div className="border-t border-line px-4 py-3.5">
        {probationary ? (
          <>
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-medium">Probationary pathway</p>
              <p className="text-3xs text-muted tabular">
                {done} of {TRAINING_MODULES.length} signed off
              </p>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sunken" role="progressbar" aria-label="Training progress" aria-valuemin={0} aria-valuemax={TRAINING_MODULES.length} aria-valuenow={done}>
              <div className="h-full rounded-full bg-gold" style={{ width: `${(done / TRAINING_MODULES.length) * 100}%` }} />
            </div>
            <p className="mt-3 text-3xs font-semibold text-muted">Outstanding</p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {left.map((m) => (
                <li key={m.key} className="flex items-center justify-between gap-2 text-2xs">
                  <span className="truncate">{m.title}</span>
                  <Pill tone={m.state === "In progress" ? "info" : "neutral"}>{m.state}</Pill>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="flex items-start gap-2 text-2xs text-ink-2">
            <CheckCircle2 className="mt-0.5 size-3.5 shrink-0 text-green" aria-hidden />
            Probationary pathway complete and independent patrol approved (Handbook §3.1). No program in progress.
          </p>
        )}
      </div>
    </Card>
  );
}

function QuickAccess() {
  const tile = "flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-xs font-medium shadow-sm transition-colors hover:border-line-strong";
  return (
    <nav aria-label="Quick access">
      <h2 className="mb-2 text-3xs font-semibold text-muted">Quick access</h2>
      <div className="grid grid-cols-2 gap-2">
        {ANCHORCAD_URL ? (
          <a href={ANCHORCAD_URL} target="_blank" rel="noopener noreferrer" className={tile}>
            <ExternalLink className="size-4 text-gold-ink" aria-hidden /> AnchorCAD
          </a>
        ) : (
          <a href={USE_OF_FORCE_URL} target="_blank" rel="noopener noreferrer" className={tile}>
            <Scale className="size-4 text-gold-ink" aria-hidden /> Use of Force
          </a>
        )}
        <a href={HANDBOOK_URL} target="_blank" rel="noopener noreferrer" className={tile}>
          <BookOpen className="size-4 text-gold-ink" aria-hidden /> Handbook
        </a>
        <Link href="/hq/resources#fleet" className={tile}>
          <Car className="size-4 text-gold-ink" aria-hidden /> Fleet
        </Link>
        <Link href="/hq/requests" className={tile}>
          <ClipboardList className="size-4 text-gold-ink" aria-hidden /> Requests
        </Link>
      </div>
    </nav>
  );
}

function Announcements() {
  return (
    <Card>
      <CardHeader title="Announcements" />
      <ul className="divide-y divide-line border-t border-line">
        {ANNOUNCEMENTS.map((a) => {
          const external = a.href.startsWith("http");
          return (
            <li key={a.title}>
              {external ? (
                <a href={a.href} target="_blank" rel="noopener noreferrer" className="block px-4 py-3 transition-colors hover:bg-surface-2">
                <p className="text-3xs font-semibold text-gold-ink">{a.date}</p>
                <p className="mt-0.5 text-xs font-medium">{a.title}</p>
                <p className="mt-0.5 line-clamp-2 text-3xs text-muted">{a.body}</p>
                </a>
              ) : (
                <Link href={a.href} className="block px-4 py-3 transition-colors hover:bg-surface-2">
                <p className="text-3xs font-semibold text-gold-ink">{a.date}</p>
                <p className="mt-0.5 text-xs font-medium">{a.title}</p>
                <p className="mt-0.5 line-clamp-2 text-3xs text-muted">{a.body}</p>
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function DashboardSkeleton() {
  return (
    <Page wide>
      <Skeleton className="mb-2 h-3 w-40" />
      <Skeleton className="mb-6 h-7 w-72" />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-5">
          <Skeleton className="h-52 rounded-xl" />
          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <Skeleton className="h-48 rounded-lg" />
            <Skeleton className="h-48 rounded-lg" />
          </div>
        </div>
        <div className="flex flex-col gap-5">
          <Skeleton className="h-44 rounded-lg" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </div>
    </Page>
  );
}

