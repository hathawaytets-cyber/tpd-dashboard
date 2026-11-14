"use client";

import Link from "next/link";
import { FileClock, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Sheet } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/status";
import { can } from "@/lib/authz";
import { formatMinutes, formatTime } from "@/lib/domain/activity";
import { useMe } from "@/lib/preview/hooks";
import { memberById, type PreviewState, type SessionRecord } from "@/lib/preview/store";
import { stateTone } from "@/lib/request-tone";

const full = (t: number) => new Date(t).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export function sessionStatus(s: SessionRecord): { label: string; tone: "gold" | "info" | "amber" | "quiet" } {
  if (s.end === null) return { label: "In progress", tone: "gold" };
  if (s.flag === "Correction pending") return { label: "Correction pending", tone: "info" };
  if (s.flag === "Needs review") return { label: "Capped · needs review", tone: "amber" };
  return { label: "Recorded", tone: "quiet" };
}

/**
 * Detail drawer for one patrol session. Visible to the session's owner and to
 * supervisors (`supervisor.view`); anyone else gets a refusal, not the record.
 */
export function SessionDrawer({ session, state, onClose, onRequestCorrection }: { session: SessionRecord | null; state: PreviewState; onClose: () => void; onRequestCorrection: (s: SessionRecord) => void }) {
  const me = useMe();
  if (!me) return null;
  const allowed = !!session && (session.memberId === me.member.id || can(me.actor, "supervisor.view"));
  const owner = session ? memberById(session.memberId) : undefined;
  const corrections = session ? state.requests.filter((r) => r.sessionId === session.id).sort((a, b) => b.createdAt - a.createdAt) : [];
  const status = session ? sessionStatus(session) : null;
  const mins = session?.end ? Math.floor((session.end - session.start) / 60000) : null;
  const mine = session?.memberId === me.member.id;

  return (
    <Sheet
      open={!!session}
      onClose={onClose}
      title="Patrol session"
      subtitle={session ? session.id : undefined}
      footer={
        allowed && session && mine && session.end !== null ? (
          <div className="flex items-center justify-between gap-3">
            <p className="text-3xs text-muted">The original record never changes. Corrections are reviewed (Handbook §6).</p>
            <Button size="sm" variant="secondary" disabled={session.flag === "Correction pending"} onClick={() => onRequestCorrection(session)}>
              {session.flag === "Correction pending" ? "Correction pending" : "Request correction"}
            </Button>
          </div>
        ) : undefined
      }
    >
      {!session ? null : !allowed ? (
        <div className="p-5">
          <Callout tone="warn" title="You can’t view this session">
            <span className="inline-flex items-center gap-1.5">
              <Lock className="size-3.5" aria-hidden /> Sessions are visible to their owner and to supervisors.
            </span>
          </Callout>
        </div>
      ) : (
        <div className="flex flex-col gap-5 p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="display text-3xl font-bold tabular">{mins === null ? "Running" : formatMinutes(mins)}</p>
              <p className="mt-1 text-2xs text-muted">{session.district} District</p>
            </div>
            <Pill tone={status!.tone}>{status!.label}</Pill>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-lg border border-line p-4">
            <Item label="Session" value={session.id} />
            <Item label="Member" value={owner ? `${owner.name} · ${owner.callsign}` : session.memberId} />
            <Item label="Started" value={full(session.start)} />
            <Item label="Ended" value={session.end ? full(session.end) : "Still on duty"} />
            <Item label="District" value={`${session.district} District`} />
            <Item label="Time range" value={`${formatTime(session.start)}–${session.end ? formatTime(session.end) : "now"}`} />
          </dl>
          {session.flag === "Needs review" ? (
            <Callout tone="warn" title="Capped at 12 hours">
              This session was still open after 12 hours, so it was capped and sent to a supervisor for review.
            </Callout>
          ) : null}
          <section aria-label="Correction history">
            <h3 className="mb-2 flex items-center gap-1.5 text-3xs font-semibold text-muted">
              <FileClock className="size-3.5" aria-hidden /> Correction history
            </h3>
            {corrections.length === 0 ? (
              <p className="text-2xs text-muted">No corrections requested for this session.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {corrections.map((r) => {
                  const last = r.history[r.history.length - 1];
                  return (
                    <li key={r.id} className="rounded-lg border border-line p-3">
                      <div className="flex items-center justify-between gap-2">
                        <Link href={`/hq/requests?id=${r.id}`} className="text-xs font-semibold hover:underline">
                          {r.id}
                        </Link>
                        <Pill tone={stateTone(r.state)}>{r.state}</Pill>
                      </div>
                      <p className="mt-1 text-2xs text-ink-2">{r.detail}</p>
                      {last && last.note && last.actor !== r.memberId ? <p className="mt-1.5 rounded-md bg-surface-2 px-2.5 py-1.5 text-2xs text-ink-2">“{last.note}” · {memberById(last.actor)?.name}</p> : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}
    </Sheet>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-3xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-xs font-semibold tabular">{value}</dd>
    </div>
  );
}
