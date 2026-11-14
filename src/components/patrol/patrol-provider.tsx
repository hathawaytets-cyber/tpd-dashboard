"use client";

import { useRouter } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@/components/ui/overlay";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/feedback";
import { can } from "@/lib/authz";
import { formatMinutes, weekMinutes, formatTime } from "@/lib/domain/activity";
import { useMe, useNow } from "@/lib/preview/hooks";
import { getPreviewState, isLiveRoster, OperationError, patrol, usePreviewState, type PatrolDistrict, type SessionRecord } from "@/lib/preview/store";

/**
 * Patrol lifecycle shared by the dashboard, patrol console, sidebar and
 * command palette. Phases map to the five console states:
 *   idle (off duty) → starting → on duty → ending → idle, plus recovering
 *   when the app loads and finds an open session.
 */
export type PatrolPhase = "loading" | "idle" | "starting" | "recovering" | "on-duty" | "ending";

interface PatrolApi {
  phase: PatrolPhase;
  canStart: boolean;
  start: (district: PatrolDistrict) => Promise<void>;
  requestEnd: () => void;
}

const Ctx = createContext<PatrolApi | null>(null);

export function usePatrol() {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePatrol must be used inside PatrolProvider");
  return v;
}

export function PatrolProvider({ children }: { children: ReactNode }) {
  const me = useMe();
  const state = usePreviewState();
  const [busy, setBusy] = useState<"starting" | "ending" | null>(null);
  const [recovering, setRecovering] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [summary, setSummary] = useState<{ session: SessionRecord; weekAfter: number } | null>(null);
  const router = useRouter();
  const checked = useRef(false);
  const now = useNow(1000, confirmOpen);

  // Session recovery: an open session found on first load (refresh, closed tab, reconnect).
  const recoveredFrom = useRef<SessionRecord | null>(null);
  useEffect(() => {
    if (!me || checked.current) return;
    checked.current = true;
    if (me.session) {
      recoveredFrom.current = me.session;
      setRecovering(true);
    }
  }, [me]);

  useEffect(() => {
    if (!recovering) return;
    const t = setTimeout(() => {
      setRecovering(false);
      const s = recoveredFrom.current;
      // Tell the member once per browser tab, not on every full page load.
      if (s && !alreadyNoticed(s.id)) toast("info", "Patrol recovered", `Your ${s.district} District session from ${formatTime(s.start)} is still running.`);
    }, 900);
    return () => clearTimeout(t);
  }, [recovering]);

  const phase: PatrolPhase = !me ? "loading" : busy ? busy : recovering ? "recovering" : me.session ? "on-duty" : "idle";

  const start = useCallback(async (district: PatrolDistrict) => {
    if (busy) return;
    setBusy("starting");
    try {
      const s = await patrol.start(district);
      toast("success", "Patrol started", `${s.district} District · ${formatTime(s.start)}`);
    } catch (e) {
      if (!(e instanceof OperationError && e.message === "Already in progress")) {
        toast("error", "Patrol not started", e instanceof Error ? e.message : "Try again.");
      }
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const confirmEnd = useCallback(async () => {
    if (busy) return;
    setBusy("ending");
    try {
      const s = await patrol.end();
      setConfirmOpen(false);
      const st = getPreviewState();
      const weekAfter = weekMinutes(st.sessions.filter((x) => x.memberId === s.memberId && x.end).map((x) => ({ start: x.start, end: x.end! })), new Date());
      setSummary({ session: s, weekAfter });
    } catch (e) {
      toast("error", "Patrol not ended", e instanceof Error ? e.message : "Try again.");
    } finally {
      setBusy(null);
    }
  }, [busy]);

  const elapsedMin = me?.session && now ? Math.floor((now - me.session.start) / 60000) : 0;
  const week = state && me ? weekMinutes(state.sessions.filter((x) => x.memberId === me.member.id && x.end).map((x) => ({ start: x.start, end: x.end! })), new Date()) : 0;

  return (
    <Ctx.Provider value={{ phase, canStart: me && !isLiveRoster() ? can(me.actor, "patrol.start") : false, start, requestEnd: () => setConfirmOpen(true) }}>
      {children}
      <Dialog
        open={confirmOpen}
        onClose={() => !busy && setConfirmOpen(false)}
        title="End patrol?"
        description="Your end time is recorded now. Corrections later need a reason and a reviewer (Handbook §6)."
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirmOpen(false)} disabled={busy === "ending"}>
              Keep patrolling
            </Button>
            <Button variant="danger" onClick={confirmEnd} loading={busy === "ending"}>
              {busy === "ending" ? "Ending…" : "Confirm end patrol"}
            </Button>
          </>
        }
      >
        {me?.session ? (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 ring-1 ring-inset ring-line">
            <SummaryItem label="District" value={`${me.session.district} District`} />
            <SummaryItem label="Started" value={formatTime(me.session.start)} />
            <SummaryItem label="Session so far" value={formatMinutes(elapsedMin)} />
            <SummaryItem label="Week after recording" value={`${formatMinutes(week + elapsedMin)} of 3h`} />
          </dl>
        ) : null}
      </Dialog>
      <Dialog
        open={!!summary}
        onClose={() => setSummary(null)}
        title={summary?.session.flag === "Needs review" ? "Patrol recorded and flagged" : "Patrol recorded"}
        description={summary?.session.flag === "Needs review" ? "The session ran past 12 hours, so it was capped and sent to your supervisor for review." : "Your session is on record and counted toward this week."}
        size="sm"
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                const id = summary?.session.id;
                setSummary(null);
                if (id) router.push(`/hq/patrol?session=${id}#history`);
              }}
            >
              View session
            </Button>
            <Button onClick={() => setSummary(null)}>Done</Button>
          </>
        }
      >
        {summary ? (
          <dl className="grid grid-cols-2 gap-3 rounded-lg bg-surface-2 p-3 ring-1 ring-inset ring-line">
            <SummaryItem label="Session" value={summary.session.id} />
            <SummaryItem label="District" value={`${summary.session.district} District`} />
            <SummaryItem label="Time" value={`${formatTime(summary.session.start)}–${formatTime(summary.session.end!)}`} />
            <SummaryItem label="Recorded" value={formatMinutes(Math.floor((summary.session.end! - summary.session.start) / 60000))} />
            <SummaryItem label="This week" value={`${formatMinutes(summary.weekAfter)} of 3h`} />
          </dl>
        ) : null}
      </Dialog>
    </Ctx.Provider>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-3xs text-muted">{label}</dt>
      <dd className="truncate text-xs font-semibold tabular">{value}</dd>
    </div>
  );
}

const NOTICE_KEY = "tpd-recovered-notice";

/** True if this tab already announced the recovered session; records it otherwise. */
function alreadyNoticed(sessionId: string): boolean {
  try {
    if (sessionStorage.getItem(NOTICE_KEY) === sessionId) return true;
    sessionStorage.setItem(NOTICE_KEY, sessionId);
  } catch {}
  return false;
}
