import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, FileText, ShieldCheck } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { CIVILIAN_RIDE_ALONG_DOCUMENT, CIVILIAN_RIDE_ALONG_STEPS } from "@/lib/public-ride-alongs";

export const metadata:Metadata={title:"Civilian Ride-Alongs | TPD Roleplay",description:"Copy the civilian ride-along application, submit it in a TPD Discord ticket, and receive supervisory review."};

export default function RideAlongPage(){
 return <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 lg:py-20">
  <p className="text-2xs font-semibold text-gold-ink">Civilian observer program</p>
  <h1 className="display-x mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Civilian ride-alongs</h1>
  <p className="mt-5 max-w-2xl text-base leading-relaxed text-ink-2">Apply to accompany an available Tampa Police Department roleplay officer on a patrol. Applications are submitted and reviewed in the department Discord ticket system, not on this website.</p>
  <div className="mt-7 flex flex-wrap gap-3">
   <a href={CIVILIAN_RIDE_ALONG_DOCUMENT} target="_blank" rel="noopener noreferrer" className={buttonClass("primary","lg")}><FileText className="size-4" aria-hidden/> Open application document <ArrowUpRight className="size-4" aria-hidden/></a>
   <Link href="/" className={buttonClass("secondary","lg")}>Back to homepage</Link>
  </div>
  <section aria-labelledby="steps-title" className="mt-14">
   <h2 id="steps-title" className="display text-2xl font-bold">How to apply</h2>
   <ol className="mt-6 grid gap-4 md:grid-cols-3">{CIVILIAN_RIDE_ALONG_STEPS.map((s,i)=><li className="rounded-xl border border-line bg-surface p-6" key={s.title}>
    <span className="display text-3xl font-bold text-gold-ink">{String(i+1).padStart(2,"0")}</span>
    <h3 className="mt-3 text-base font-semibold">{s.title}</h3><p className="mt-2 text-sm leading-relaxed text-muted">{s.detail}</p>
   </li>)}</ol>
  </section>
  <section aria-labelledby="review-title" className="mt-10 rounded-xl border border-line bg-surface p-6">
   <h2 id="review-title" className="flex items-center gap-2 text-base font-semibold"><ShieldCheck className="size-5 text-gold-ink"/> Ticket review and approval</h2>
   <p className="mt-3 text-sm leading-relaxed text-ink-2">Open the designated civilian ride-along ticket inside the TPD roleplay Discord, share your completed copy with the reviewing staff, and follow all instructions in that ticket. The ticket is where the decision is communicated. The assigned officer’s Sergeant or higher must approve before participation; the Chief or designee may deny or revoke permission under Personnel Handbook §12.1.</p>
   <p className="mt-3 text-sm text-muted">Do not treat document completion, a ticket submission, or a website link as approval.</p>
  </section>
  <p className="mt-6 rounded-lg border border-line p-4 text-xs leading-relaxed text-muted">This is a fictional Roblox roleplay program, not the real Tampa Police Department’s Citizen Observer Program. The linked source is an adapted reference draft containing real-world form fields and legal wording. Never provide actual identity documents, birth dates, addresses, phone numbers, or emergency-contact information in roleplay applications or tickets. Use only roleplay-appropriate information and follow the roleplay department’s staff guidance.</p>
 </div>;
}
