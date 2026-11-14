import Link from "next/link";
import { Star } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { CapacityBar } from "@/components/ui/data-viz";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import { DISTRICTS, DIVISIONS, POSITIONS, SOURCES, TIERS, VERIFIED_ON, byDistrict, byTier, divisionStaffing, isFilled, staffing, type Position } from "@/lib/department";

/**
 * Department structure from the official roster: every authorized position,
 * who holds it, and what is vacant. Verified data only; no demo personas.
 */
export function StructureWorkspace() {
  const s = staffing();
  const inBlock = (x: Position) => !!x.callsign && /^X-[45]\d\d$/.test(x.callsign);
  const command = POSITIONS.filter((x) => !inBlock(x));
  return (
    <Page wide>
      <PageHeader
        eyebrow="Department"
        title="Department structure"
        description="Every authorized position on the official roster, who holds it, and what is vacant. Names are as written on the roster; contact details and records are not shown."
        meta={
          <>
            <Pill tone="green">Official roster</Pill>
            <Pill tone="neutral">Checked {VERIFIED_ON}</Pill>
          </>
        }
        actions={
          <a href={SOURCES.roster.href} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-gold-ink hover:underline">
            Open the roster sheet
          </a>
        }
      />

      <ul className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-line bg-line lg:grid-cols-4">
        {[
          { v: s.filled, l: "Sworn members", sub: `of ${s.authorized} authorized positions` },
          { v: s.vacant, l: "Vacant positions", sub: "open on the roster" },
          { v: `${s.activeDuty.filled}/${s.activeDuty.authorized}`, l: "Active duty", sub: "excludes probationary slots" },
          { v: `${s.probationary.filled}/${s.probationary.authorized}`, l: "Probationary officers", sub: "Field Training Program" },
        ].map((k) => (
          <li key={k.l} className="bg-surface px-4 py-4">
            <p className="display text-2xl font-bold tabular">{k.v}</p>
            <p className="mt-1 text-xs font-semibold">{k.l}</p>
            <p className="text-3xs text-muted">{k.sub}</p>
          </li>
        ))}
      </ul>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-5">
          {TIERS.map(({ tier, stars }) => {
            const rows = byTier(tier, command);
            if (!rows.length) return null;
            return <PositionTable key={tier} title={tier} stars={stars} rows={rows} />;
          })}
          {DISTRICTS.map((d) => (
            <PositionTable key={d.name} title={`${d.name} District`} subtitle={`Call signs ${d.callsignRange}`} stars={1} rows={byDistrict(d.name).filter(inBlock)} collapseVacant />
          ))}
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Patrol districts" description="Captain, Lieutenants and the 52-slot district block" />
            <ul className="divide-y divide-line border-t border-line">
              {DISTRICTS.map((d) => {
                const cpt = POSITIONS.find((x) => x.callsign === d.captain);
                const lts = byDistrict(d.name).filter((x) => x.appointment.includes("District Command"));
                return (
                  <li key={d.name} className="px-4 py-3.5">
                    <div className="mb-1 flex items-baseline justify-between text-xs">
                      <span className="font-semibold">{d.name} District</span>
                      <span className="text-3xs text-muted tabular">
                        {d.filled}/{d.authorized}
                      </span>
                    </div>
                    <CapacityBar filled={d.filled} total={d.authorized} label={`${d.name} District: ${d.filled} of ${d.authorized}`} tone="gold" />
                    <p className="mt-2 text-3xs text-muted">
                      Captain {d.captain}: {cpt?.holder ?? "Vacant"} · Lieutenants: {lts.filter(isFilled).length} of {lts.length} filled
                    </p>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="Divisions" description="Roster, TPD | Divisions tab" />
            <ul className="flex flex-col gap-3 border-t border-line px-4 py-4">
              {DIVISIONS.map((d) => {
                const st = divisionStaffing(d);
                return (
                  <li key={d.slug}>
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
                      <Link href={`/hq/divisions/${d.slug}`} className="truncate font-medium hover:underline">
                        {d.name}
                      </Link>
                      <span className="shrink-0 text-3xs text-muted tabular">
                        {st.filled}/{st.capacity}
                      </span>
                    </div>
                    <CapacityBar filled={st.filled} total={st.capacity} label={`${d.name}: ${st.filled} of ${st.capacity}`} tone="gold" />
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card>
            <CardHeader title="About this data" />
            <p className="border-t border-line px-4 py-3.5 text-2xs leading-relaxed text-muted">
              Transcribed from the official roster on {VERIFIED_ON}. The Google Sheet stays authoritative; open questions about the structure are tracked as policy conflicts. Discord IDs, timezones,
              hire logs and disciplinary records are never copied into this site.
            </p>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function PositionTable({ title, subtitle, stars, rows, collapseVacant }: { title: string; subtitle?: string; stars: number; rows: Position[]; collapseVacant?: boolean }) {
  const filled = rows.filter(isFilled).length;
  const shown = collapseVacant ? collapseVacantRows(rows) : rows.map((r) => ({ pos: r, count: 1, range: undefined as string | undefined }));
  return (
    <Card>
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <span aria-hidden className="flex gap-px">
              {Array.from({ length: stars }, (_, i) => (
                <Star key={i} className="size-2.5 fill-current text-gold-ink" strokeWidth={0} />
              ))}
            </span>
            {title}
          </span>
        }
        description={`${subtitle ? `${subtitle} · ` : ""}${filled} of ${rows.length} filled`}
      />
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-left text-xs">
          <thead className="bg-surface-2 text-3xs text-muted">
            <tr>
              <th scope="col" className="w-24 px-4 py-2 font-semibold">
                Call sign
              </th>
              <th scope="col" className="hidden px-3 py-2 font-semibold sm:table-cell">
                Rank
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Appointment
              </th>
              <th scope="col" className="px-3 py-2 font-semibold">
                Member
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map(({ pos, count, range }, i) => (
              <tr key={`${pos.callsign ?? "none"}-${i}`} className={cn(!pos.holder && "text-muted")}>
                <td className="px-4 py-2 font-semibold whitespace-nowrap tabular">{range ?? pos.callsign ?? "—"}</td>
                <td className="hidden px-3 py-2 whitespace-nowrap sm:table-cell">{pos.rank}</td>
                <td className="px-3 py-2">
                  <span className="block text-3xs text-muted sm:hidden">{pos.rank}</span>
                  {pos.appointment}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">{pos.holder ? <span className="font-semibold text-ink">{pos.holder}</span> : count > 1 ? `${count} vacant` : "Vacant"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

/** Groups consecutive vacant slots of the same rank so a 52-slot district block stays readable. */
function collapseVacantRows(rows: Position[]) {
  const out: { pos: Position; count: number; range?: string }[] = [];
  for (const r of rows) {
    const last = out[out.length - 1];
    if (!r.holder && last && !last.pos.holder && last.pos.rank === r.rank && last.pos.appointment === r.appointment) {
      last.count += 1;
      last.range = `${last.pos.callsign}–${r.callsign?.slice(2)}`;
    } else out.push({ pos: r, count: 1 });
  }
  return out;
}
