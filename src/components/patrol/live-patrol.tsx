"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Clock3, Radio, ShieldCheck } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Card, CardHeader } from "@/components/ui/surface";
import { useVerifiedMember } from "@/lib/backend/auth";
import { patrolEnd, patrolHistory, patrolStart, type RecordedPatrol } from "@/lib/backend/patrol";
import { formatClock, formatMinutes, weekMinutes } from "@/lib/domain/activity";
import { requestCorrection, listMyCorrections, type Correction } from "@/lib/backend/patrol-corrections";
import { myPatrolClearance } from "@/lib/backend/phase6";

const fmt = (value: string) => new Date(value).toLocaleString();
function elapsedSeconds(s: RecordedPatrol, now: number): number {
  return Math.max(0, (new Date(s.ended_at ?? new Date(now).toISOString()).getTime() - new Date(s.started_at).getTime()) / 1000);
}

function RecordedHistory({ sessions }: { sessions: RecordedPatrol[] }) {
  return (
    <Card>
      <CardHeader title="My recorded patrols" description="Original timestamps stay unchanged; approved corrections affect the provisional weekly total." />
      {sessions.length === 0 ? (
        <EmptyState title="No recorded patrols yet" body="Your completed sessions will appear here after the server confirms them." icon={<Clock3 />} />
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-xs">
              <div>
                <p className="font-semibold">{s.district} District</p>
                <p className="mt-0.5 text-muted">{fmt(s.started_at)} — {s.ended_at ? fmt(s.ended_at) : "On duty"}</p>
                {s.review_required && <p className="mt-1 text-amber">Over 12 hours — review required; not approved time</p>}
              </div>
              <span className="font-semibold tabular">{s.ended_at ? formatClock(Math.min(elapsedSeconds(s, 0), 12 * 3600)) : "Active"}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function LivePatrol({ section = "patrol" }: { section?: "patrol" | "activity" }) {
  const me = useVerifiedMember();
  const [sessions, setSessions] = useState<RecordedPatrol[]>([]);
  const [corrections, setCorrections] = useState<Correction[]>([]);
  const [loading, setLoading] = useState(true);
  const [clearance, setClearance] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [district, setDistrict] = useState<"North" | "South">("North");
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  const memberId = me?.id;
  const reload = useCallback(async () => {
    if (!memberId) return;
    setLoading(true);
    setError("");
    try {
      const [patrols, correctionRows, verifiedClearance] = await Promise.all([patrolHistory(), listMyCorrections(memberId), myPatrolClearance()]);
      setSessions(patrols);
      setCorrections(correctionRows);
      setClearance(verifiedClearance);
    } catch (e) {
      setClearance(false);
      setError(e instanceof Error ? e.message : "Could not load patrol history.");
    } finally {
      setLoading(false);
    }
  }, [memberId]);

  useEffect(() => { void reload(); }, [reload]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const active = sessions.find((s) => s.ended_at === null);
  const latestCorrections = new Map<string, Correction>();
  for (const c of [...corrections].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    if (c.status === "approved") latestCorrections.set(c.session_id, c);
  }
  const completedApproved = sessions.filter((s) => s.ended_at !== null)
    .flatMap((s) => {
      const c = latestCorrections.get(s.id);
      if (corrections.some(change => change.session_id === s.id && change.status === "pending")) return [];
      if (s.review_required && !c) return [];
      return [{ start: new Date(c?.proposed_started_at ?? s.started_at).getTime(),
                end: new Date(c?.proposed_ended_at ?? s.ended_at!).getTime() }];
    });
  const completedMinutes = weekMinutes(completedApproved, new Date(now));

  async function run(op: "start" | "end") {
    if (inFlight.current || loading || !me) return;
    if (op === "end" && !active) return;
    if (op === "end" && !window.confirm("End your current patrol? The server will record the end time.")) return;
    inFlight.current = true;
    setBusy(true);
    setError("");
    try {
      if (op === "start") await patrolStart(district);
      else await patrolEnd(active!.id);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Patrol operation failed.");
      // A request might have succeeded despite a network timeout: always reconcile with server.
      try { setSessions(await patrolHistory()); } catch {}
    } finally {
      setBusy(false);
      inFlight.current = false;
    }
  }

  if (!me) return null;
  const isProbationary = me.rank === "Probationary Officer" && !clearance;
  return (
    <Page wide>
      <PageHeader eyebrow="Operations" title={section === "patrol" ? "Patrol console" : "My activity"}
        description="Start and end times are recorded by the server. The reporting week runs Monday to Sunday, Eastern Time (interim)." />
      <div className="space-y-5">
        {error && <Callout tone="error" title="Patrol backend error">{error} Your session was not modified locally. Use Refresh to verify server state.</Callout>}
        <Callout tone="info" title="Recorded hours are not automatically approved">
          The 3-hour weekly requirement is Handbook §3.2. The provisional total includes completed, unflagged sessions and the latest approved correction for each session. Pending corrections are excluded until reviewed; denied corrections leave original timestamps intact. This is not yet a formal compliance approval.
        </Callout>
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <section className="rounded-xl border border-dark-line bg-obsidian p-5 text-on-dark sm:p-7">
            <div className="flex items-center gap-2 text-xs font-semibold text-gold"><Radio className="size-4" /> {active ? "On duty" : "Off duty"}</div>
            <p className="display-x mt-3 text-4xl font-bold tabular sm:text-6xl">{active ? formatClock(elapsedSeconds(active, now)) : "00:00:00"}</p>
            {active ? (
              <>
                <p className="mt-3 text-sm">Patrolling {active.district} District since {fmt(active.started_at)}</p>
                <Button variant="danger" size="lg" className="mt-6" disabled={busy || loading} loading={busy} onClick={() => void run("end")}>End patrol</Button>
              </>
            ) : (
              <>
                <p className="mt-3 text-sm text-on-dark-muted">Select a district and start your official patrol timer.</p>
                <fieldset className="mt-5 flex gap-4 text-sm" disabled={busy || loading || isProbationary}>
                  <legend className="mb-2 text-xs">District</legend>
                  {(["North", "South"] as const).map((d) => (
                    <label className="flex items-center gap-2" key={d}>
                      <input type="radio" name="live-patrol-district" value={d} checked={district === d} onChange={() => setDistrict(d)} /> {d}
                    </label>
                  ))}
                </fieldset>
                {isProbationary ? <p className="mt-4 text-xs text-amber">Independent patrol requires all training sign-offs and separate Office of the Chiefs clearance.</p> :
                  <Button variant="gold" size="lg" className="mt-5" disabled={busy || loading} loading={busy} onClick={() => void run("start")}>Start patrol</Button>}
              </>
            )}
            <Button variant="dark-ghost" size="sm" className="mt-5" disabled={busy || loading} onClick={() => void reload()}>Refresh server status</Button>
          </section>
          <Card className="p-5">
            <ShieldCheck className="size-5 text-gold-ink" aria-hidden />
            <p className="mt-4 text-2xs text-muted">Completed time this week (with approved corrections)</p>
            <p className="display mt-2 text-3xl font-bold tabular">{formatMinutes(completedMinutes)}</p>
            <p className="mt-2 text-xs text-muted">Provisional total / 3h requirement. Active sessions and unreviewed long sessions are excluded. Approved corrections replace the original times only for reporting; originals remain preserved.</p>
            <Link href="/hq/resources" className="mt-5 inline-block text-xs font-semibold text-gold-ink underline">View patrol policies</Link>
          </Card>
        </div>
        {loading ? <p role="status" className="text-sm text-muted">Loading official patrol sessions…</p> : <RecordedHistory sessions={sessions} />}
        {!loading && <PatrolCorrectionForm sessions={sessions} onSubmitted={reload} />}
      </div>
    </Page>
  );
}

function PatrolCorrectionForm({ sessions, onSubmitted }: { sessions: RecordedPatrol[]; onSubmitted: () => Promise<void> }) {
 const completed=sessions.filter(s=>s.ended_at!==null);
 const [id,setId]=useState("");
 const [start,setStart]=useState("");
 const [end,setEnd]=useState("");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [error,setError]=useState("");
 const toLocal=(value:string)=> {
  const d=new Date(value);const offset=d.getTimezoneOffset()*60000;
  return new Date(d.getTime()-offset).toISOString().slice(0,16);
 };
 function choose(nextId:string){
  setId(nextId);setMessage("");setError("");
  const s=completed.find(x=>x.id===nextId);
  setStart(s?toLocal(s.started_at):"");
  setEnd(s?.ended_at?toLocal(s.ended_at):"");
 }
 async function submit(){
  if(busy || !id)return;
  setBusy(true);setError("");setMessage("");
  try{
   await requestCorrection(id,start,end,reason);
   setMessage("Correction request submitted for supervisor review. Your original patrol record is unchanged.");
   setReason("");
   await onSubmitted();
  }catch(e){setError(e instanceof Error?e.message:"Could not submit correction.");}
  finally{setBusy(false);}
 }
 return <Card>
  <CardHeader title="Request a patrol correction" description="Mistimed sessions are never edited directly. A supervisor reviews your proposed times and explanation."/>
  <div className="space-y-3 border-t border-line p-4 text-xs">
   {completed.length===0?<p className="text-muted">Complete a patrol before requesting a correction.</p>:<>
    {error&&<Callout tone="error" title="Correction failed">{error}</Callout>}
    {message&&<p role="status" className="font-semibold text-green">{message}</p>}
    <label className="block font-semibold" htmlFor="correction-session">Completed session</label>
    <select id="correction-session" value={id} onChange={e=>choose(e.target.value)} className="w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
     <option value="">Select a session</option>
     {completed.map(s=><option key={s.id} value={s.id}>{s.district} · {new Date(s.started_at).toLocaleString()}</option>)}
    </select>
    {id&&<>
     <div className="grid gap-3 sm:grid-cols-2">
      <label className="block">Proposed start
       <input type="datetime-local" className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" value={start} onChange={e=>setStart(e.target.value)}/>
      </label>
      <label className="block">Proposed end
       <input type="datetime-local" className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" value={end} onChange={e=>setEnd(e.target.value)}/>
      </label>
     </div>
     <label className="block">Reason (at least 15 characters)
      <textarea value={reason} maxLength={2000} rows={3} onChange={e=>setReason(e.target.value)} className="mt-1 w-full rounded-md border border-line bg-surface px-3 py-2 text-ink" placeholder="Explain exactly why this session needs correction."/>
     </label>
     <Button variant="gold" size="sm" loading={busy} disabled={busy||reason.trim().length<15||!start||!end} onClick={()=>void submit()}>Submit for review</Button>
    </>}
   </>}
  </div>
 </Card>;
}
