import Link from "next/link";
import { ArrowUpRight, FileText } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { CIVILIAN_RIDE_ALONG_DOCUMENT, CIVILIAN_RIDE_ALONG_STEPS } from "@/lib/public-ride-alongs";

export function RideAlongSpotlight() {
 return <section id="ride-alongs" aria-labelledby="ridealong-title" className="scroll-mt-24 border-b border-line bg-surface">
  <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
   <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr]">
    <div>
     <p className="text-2xs font-semibold text-gold-ink">Civilian ride-alongs</p>
     <h2 id="ridealong-title" className="display mt-3 text-3xl font-bold tracking-tight">Experience a patrol shift</h2>
     <p className="mt-4 max-w-lg text-sm leading-relaxed text-ink-2">In Florida State Roleplay, civilians can request to observe a TPD patrol. Complete a copy of the application, open a Discord ticket, and await a supervisor’s decision.</p>
     <div className="mt-6 flex flex-wrap gap-3">
      <a href={CIVILIAN_RIDE_ALONG_DOCUMENT} target="_blank" rel="noopener noreferrer" className={buttonClass("primary", "lg")}>
       <FileText className="size-4" aria-hidden/> Open application <ArrowUpRight className="size-4" aria-hidden/>
      </a>
      <Link href="/ride-alongs" className={buttonClass("secondary", "lg")}>Full instructions</Link>
     </div>
    </div>
    <ol className="grid gap-3">
     {CIVILIAN_RIDE_ALONG_STEPS.map((step,i)=><li key={step.title} className="flex gap-4 rounded-xl border border-line bg-bg p-5">
      <span className="display flex size-9 shrink-0 items-center justify-center rounded-lg bg-obsidian text-sm font-bold text-gold">{i+1}</span>
      <div><h3 className="text-sm font-semibold">{step.title}</h3><p className="mt-1 text-xs leading-relaxed text-muted">{step.detail}</p></div>
     </li>)}
    </ol>
   </div>
   <p className="mt-6 rounded-lg border border-line bg-bg p-4 text-xs text-muted">Roleplay only. Never provide real personal identifiers or contact details in a Discord ticket. This adapted document is a reference draft, not an official City of Tampa application or legal waiver. Review happens in the Discord ticket; the assigned officer’s Sergeant or above must approve before a ride-along begins.</p>
  </div>
 </section>;
}
