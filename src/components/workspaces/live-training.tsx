"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Lock, GraduationCap } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState } from "@/components/ui/feedback";
import { Card, CardHeader } from "@/components/ui/surface";
import { useVerifiedMember } from "@/lib/backend/auth";
import { TRAINING_PATHWAY, type TrainingStepKey } from "@/lib/department";
import { allMembers } from "@/lib/preview/store";
import { listTrainingSignoffs, signOffTrainingModule, type TrainingSignoff } from "@/lib/backend/training";
import { LiveClearancePanel } from "@/components/workspaces/live-clearance-panel";

type ModuleKey=Exclude<TrainingStepKey,"approval">;
const MODULES=TRAINING_PATHWAY.filter((m):m is Extract<typeof TRAINING_PATHWAY[number],{key:ModuleKey}>=>m.key!=="approval");

export function LiveTraining(){
 const me=useVerifiedMember();
 const [items,setItems]=useState<TrainingSignoff[]>([]);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [notice,setNotice]=useState("");
 const [traineeId,setTraineeId]=useState("");
 const [key,setKey]=useState<ModuleKey>("onboarding");
 const [evidence,setEvidence]=useState("");
 const isOotc=!!me&&["Chief of Police","Deputy Chief","Assistant Chief"].includes(me.rank);
 const trainees=allMembers().filter(m=>m.rank==="Probationary Officer"&&m.status==="Probationary");
 const mine=me?items.filter(x=>x.trainee_id===me.id):[];
 const selected=items.filter(x=>x.trainee_id===traineeId);
 const load=useCallback(async()=>{
  setLoading(true);setError("");
  try{setItems(await listTrainingSignoffs());}
  catch(e){setError(e instanceof Error?e.message:"Could not load training records.");}
  finally{setLoading(false);}
 },[]);
 useEffect(()=>{void load();},[load]);

 async function signOff(){
  if(!isOotc||busy||!traineeId||evidence.trim().length<10)return;
  const m=MODULES.find(x=>x.key===key);
  if(!window.confirm(`Sign off ${m?.title??key}? Evidence and the approving officer will be recorded. This does not grant independent patrol.`))return;
  setBusy(true);setError("");setNotice("");
  try{
   await signOffTrainingModule(traineeId,key,evidence.trim());
   setEvidence("");await load();setNotice("Module sign-off recorded. Independent patrol remains locked until separately authorized.");
  }catch(e){setError(e instanceof Error?e.message:"Training sign-off failed.");}
  finally{setBusy(false);}
 }
 if(!me)return null;

 return <Page wide>
  <PageHeader eyebrow="Personnel" title={me.rank==="Probationary Officer"?"Your field training":"Field training"}
   description="Handbook §3.1: six required training components followed by a separate Office of the Chiefs independent-patrol decision." />
  <div className="space-y-5">
   <Callout tone="info" title="Training records are official; independent patrol is separate">
    Evidence-backed module sign-offs are recorded in Supabase. They do not automatically promote an officer, change the roster, qualify a PTO or unlock independent patrol. Final approval must come from the Office of the Chiefs.
   </Callout>
   {error&&<Callout tone="error" title="Training service error">{error}</Callout>}
   {notice&&<p role="status" className="text-xs font-semibold text-green">{notice}</p>}
   <Card>
    <CardHeader title="Training pathway" description={me.rank==="Probationary Officer"?
      `${mine.length} of 6 module sign-offs recorded`:"Department training requirements · Handbook §3.1"} />
    {loading?<p role="status" className="p-4 text-xs text-muted">Loading verified training records…</p>:
     <ol className="divide-y divide-line border-t border-line">
      {TRAINING_PATHWAY.map((step,n)=>{
       const signed=step.key!=="approval"?mine.find(x=>x.module_key===step.key):null;
       return <li key={step.key} className="flex items-start gap-3 px-4 py-3">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-sunken text-xs font-semibold">
         {signed?<CheckCircle2 className="size-5 text-green"/>:step.key==="approval"?<Lock className="size-4 text-muted"/>:n+1}
        </span>
        <div className="min-w-0 flex-1">
         <p className="text-sm font-semibold">{step.title}</p>
         <p className="mt-1 text-xs text-muted">{step.detail}</p>
         {me.rank==="Probationary Officer"&&step.key!=="approval"&&
          <p className="mt-1 text-2xs font-semibold">{signed?`Signed off ${new Date(signed.signed_at).toLocaleDateString()}`:"No sign-off recorded"}</p>}
         {step.key==="approval"&&<p className="mt-1 text-2xs text-amber">Separate authorization required; not automatically granted</p>}
        </div>
       </li>;
      })}
     </ol>}
   </Card>
   <LiveClearancePanel signoffs={items}/>
   {isOotc&&<Card>
    <CardHeader title="Office of the Chiefs · Module sign-offs"
     description="Confirm training evidence for an active probationary officer. Only OOTC can sign off modules until leadership confirms PTO authority." />
    <div className="space-y-4 border-t border-line p-4 text-xs">
     {trainees.length===0?<EmptyState icon={<GraduationCap/>} title="No probationary officers currently on the roster"
      body="The roster will populate this list when a probationary member is added."/>:<>
      <label className="block font-semibold">Probationary officer
       <select value={traineeId} onChange={e=>setTraineeId(e.target.value)} className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
        <option value="">Select officer</option>
        {trainees.map(t=><option key={t.id} value={t.id}>{t.name} · {t.callsign}</option>)}
       </select>
      </label>
      {traineeId&&<>
       <p className="text-muted">{selected.length} of 6 modules signed off for this trainee.</p>
       <label className="block font-semibold">Training module
        <select value={key} onChange={e=>setKey(e.target.value as ModuleKey)} className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink">
         {MODULES.map(m=><option key={m.key} value={m.key} disabled={selected.some(x=>x.module_key===m.key)}>
          {m.title}{selected.some(x=>x.module_key===m.key)?" (signed off)":""}
         </option>)}
        </select>
       </label>
       <label className="block font-semibold">Training evidence or record reference
        <textarea required minLength={10} maxLength={2000} value={evidence}
         onChange={e=>setEvidence(e.target.value)} rows={3}
         className="mt-1 block w-full rounded-md border border-line bg-surface px-3 py-2 text-ink"
         placeholder="Describe what was verified and where the supporting training record can be found."/>
       </label>
       <Button variant="gold" size="sm" loading={busy} disabled={busy||evidence.trim().length<10||selected.some(x=>x.module_key===key)} onClick={()=>void signOff()}>
        Record module sign-off
       </Button>
      </>}
     </>}
    </div>
   </Card>}
  </div>
 </Page>;
}
