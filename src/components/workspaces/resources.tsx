import { ArrowUpRight, ExternalLink, FileText, Scale } from "lucide-react";
import { PolicyRefs } from "@/components/patrol/patrol-console";
import { Page, PageHeader } from "@/components/shell/page";
import { ANCHORCAD_URL } from "@/components/shell/nav-config";
import { Card, CardHeader } from "@/components/ui/surface";
import { ACTIVITY_REQUIREMENT, DISCIPLINE, POLICY_LIBRARY, RANKS, SOURCES, VEHICLES, VERIFIED_ON, vehicleAuthorized, type PolicyCategory } from "@/lib/department";

const CATEGORIES: PolicyCategory[] = ["Standards & conduct", "Personnel", "Operations", "Training", "Use of force", "Discipline"];

export function ResourcesWorkspace() {
  return (
    <Page wide>
      <PageHeader eyebrow="Department" title="Resources" description="The official policy documents, policy library, fleet and AnchorCAD. The Google Docs stay authoritative; summaries here are only a guide." />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {[
          { href: SOURCES.handbook.href, icon: FileText, title: "Personnel Policy & Procedures Handbook", meta: "Effective October 30, 2026 · approved by the Chief of Police" },
          { href: SOURCES.useOfForce.href, icon: Scale, title: "Use of Force Policy", meta: "Dated October 30, 2026 · Chief of Police" },
        ].map((d) => (
          <a key={d.title} href={d.href} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 rounded-xl border border-edge bg-surface p-5 shadow-card hover:border-line-strong">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-obsidian text-gold">
              <d.icon className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold">{d.title}</span>
              <span className="mt-0.5 block text-2xs text-muted">{d.meta}</span>
            </span>
            <ArrowUpRight className="size-4 text-muted group-hover:text-ink" aria-hidden />
          </a>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card id="fleet" className="scroll-mt-20">
          <CardHeader title="Fleet" description={`Roster, TPD | Vehicles tab (the Vehicle Database, Handbook §11) · checked ${VERIFIED_ON}`} />
          <ul className="grid grid-cols-1 gap-px border-t border-line bg-line sm:grid-cols-3">
            {VEHICLES.map((v) => (
              <li key={v.name} className="bg-surface px-4 py-3">
                <p className="text-xs font-semibold">{v.name}</p>
                <p className="text-3xs text-muted">In game: {v.model}</p>
                <p className="mt-1.5 text-3xs text-ink-2">
                  {v.use} · {v.authorized}
                </p>
                <p className="text-3xs text-muted">
                  {v.livery} · {v.status}
                </p>
              </li>
            ))}
          </ul>
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[560px] text-left text-xs whitespace-nowrap">
              <thead className="bg-surface-2 text-3xs text-muted">
                <tr>
                  <th scope="col" className="px-4 py-2 font-semibold">Rank</th>
                  {VEHICLES.map((v) => (
                    <th key={v.name} scope="col" className="px-3 py-2 text-center font-semibold">{v.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {RANKS.map((r) => (
                  <tr key={r}>
                    <th scope="row" className="px-4 py-2 font-medium">{r}</th>
                    {VEHICLES.map((v) => (
                      <td key={v.name} className="px-3 py-2 text-center">
                        {vehicleAuthorized(r, v) ? <span className="font-semibold text-green">Yes</span> : <span className="text-muted">—</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="AnchorCAD" description="All arrests, citations and incidents are filed in AnchorCAD (Handbook §10)" />
            <div className="border-t border-line px-4 py-3.5">
              {ANCHORCAD_URL ? (
                <a href={ANCHORCAD_URL} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-semibold text-gold-ink hover:underline">
                  Open AnchorCAD <ExternalLink className="size-3.5" aria-hidden />
                </a>
              ) : (
                <p className="text-2xs text-muted">The AnchorCAD link hasn’t been configured yet. Ask command for the address.</p>
              )}
            </div>
          </Card>
          <PolicyRefs />
        </div>
      </div>
      <div className="mt-5 grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card id="policies" className="scroll-mt-20">
          <CardHeader title="Policy library" description="Section index of the Handbook (HB) and Use of Force Policy (UoF). Read the full text in the documents." />
          <div className="grid grid-cols-1 gap-px border-t border-line bg-line md:grid-cols-2">
            {CATEGORIES.map((c) => (
              <section key={c} aria-label={c} className="bg-surface px-4 py-3.5">
                <h3 className="text-2xs font-semibold text-gold-ink">{c}</h3>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {POLICY_LIBRARY.filter((e) => e.category === c).map((e) => (
                    <li key={`${e.doc}-${e.section}`} className="flex gap-2 text-xs">
                      <span className="w-16 shrink-0 text-3xs font-semibold text-muted tabular">
                        {e.doc} §{e.section}
                      </span>
                      <span className="min-w-0">{e.title}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </Card>
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Weekly activity" description={ACTIVITY_REQUIREMENT.cite} />
            <div className="border-t border-line px-4 py-3.5 text-2xs leading-relaxed text-ink-2">
              <p>{ACTIVITY_REQUIREMENT.summary}</p>
              <p className="mt-2 font-semibold text-ink">Exceptions</p>
              <ul className="mt-1 list-disc pl-4 text-muted">
                {ACTIVITY_REQUIREMENT.exceptions.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
              <p className="mt-2 text-muted">{ACTIVITY_REQUIREMENT.probationNote}</p>
            </div>
          </Card>
          <Card>
            <CardHeader title="Progressive discipline" description={`${DISCIPLINE.cite} · policy only, no records are kept here`} />
            <ul className="divide-y divide-line border-t border-line">
              {DISCIPLINE.levels.map((l) => (
                <li key={l.name} className="flex items-baseline justify-between gap-3 px-4 py-2 text-xs">
                  <span>
                    <span className="font-semibold">{l.name}</span>
                    <span className="block text-3xs text-muted">{l.scope}</span>
                  </span>
                  <span className="shrink-0 text-3xs font-semibold text-ink-2 tabular">{l.points ? `${l.points} pt${l.points > 1 ? "s" : ""}` : "—"}</span>
                </li>
              ))}
            </ul>
            <p className="border-t border-line px-4 py-3 text-3xs leading-relaxed text-muted">{DISCIPLINE.authority}</p>
          </Card>
        </div>
      </div>
    </Page>
  );
}
