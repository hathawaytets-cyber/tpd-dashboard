import { ANNOUNCEMENTS } from "@/lib/announcements";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, Car, FileText, Megaphone, Radio, Scale, Star, UserPlus } from "lucide-react";
import { Badge } from "@/components/ui/identity";
import { ButtonLink, buttonClass } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { CORE_VALUES, DISTRICTS, DIVISIONS, POSITIONS, SOURCES, TIERS, TRAINING_PATHWAY, VERIFIED_ON, byTier, divisionStaffing, positionByCallsign, staffing } from "@/lib/department";
import { APPLICATION_URL } from "@/lib/public-nav";
import { RideAlongSpotlight } from "@/components/public/ride-along-spotlight";

/** HB §3.1: applying, then the seven steps to independent patrol. */
const PATHWAY = [{ title: "Apply", detail: "Complete the recruitment application. Successful applicants are appointed Probationary Patrol Officers." }, ...TRAINING_PATHWAY];

const STAFF = staffing();

/** Leadership as listed on the official roster, most senior first. Vacant positions say so. */
const LEADERSHIP = TIERS.filter((t) => t.tier !== "Patrol Bureau").map((t) => ({
  ...t,
  rows: byTier(t.tier).filter((x) => !/^X-[45]\d\d$/.test(x.callsign ?? "")),
}));

const NEWS = ANNOUNCEMENTS;

export default function HomePage() {
  return (
    <>
      {/* Hero */}
      <section aria-labelledby="hero-h" className="relative isolate overflow-hidden bg-obsidian text-on-dark">
        <Image src="/brand/charger-hero.webp" alt="" fill priority sizes="100vw" className="-z-20 object-cover object-[70%_55%]" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[linear-gradient(90deg,var(--obsidian)_22%,color-mix(in_srgb,var(--obsidian)_70%,transparent)_52%,color-mix(in_srgb,var(--obsidian)_15%,transparent)),linear-gradient(0deg,var(--obsidian),transparent_35%)]" />
        <div className="mx-auto max-w-7xl px-4 pt-16 pb-20 sm:px-6 md:pt-24 md:pb-28 lg:px-8">
          <Badge size={92} priority className="drop-shadow-[0_8px_24px_rgb(0_0_0/0.6)]" />
          <p className="mt-7 text-xs font-semibold text-gold">Florida State Roleplay</p>
          <h1 id="hero-h" className="display-x mt-3 max-w-3xl text-[clamp(2.6rem,7vw,5.25rem)] leading-[0.95] font-bold tracking-tight">
            Tampa Police Department
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-on-dark/80 sm:text-lg">
            Patrolling the North and South districts with integrity, accountability and service, one documented shift at a time.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <a href={APPLICATION_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("gold", "xl")}>
              Apply to join <ArrowUpRight aria-hidden className="size-4" />
            </a>
            <ButtonLink href="/hq" variant="dark" size="xl">
              Member portal
            </ButtonLink>
          </div>
        </div>
      </section>

      <RideAlongSpotlight />

      {/* Values strip */}
      <section id="about" aria-labelledby="values-h" className="scroll-mt-20 border-b border-line bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="values-h" className="display text-xl font-bold tracking-tight">
              Our core values
            </h2>
            <p className="text-2xs text-muted">Personnel Handbook §2</p>
          </div>
          <ul className="mt-6 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-2 lg:grid-cols-5">
            {CORE_VALUES.map(({ title, body }, i) => (
              <li key={title} className="bg-surface p-5">
                <span className="text-3xs font-semibold text-gold-ink tabular">0{i + 1}</span>
                <p className="mt-2 text-sm font-semibold">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Join timeline */}
      <section id="join" aria-labelledby="join-h" className="scroll-mt-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[0.9fr_1.1fr] lg:px-8">
          <div>
            <p className="text-2xs font-semibold text-gold-ink">Recruitment</p>
            <h2 id="join-h" className="display mt-2 text-3xl leading-tight font-bold tracking-tight">
              From application to your first solo shift
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-ink-2">
              Every officer follows the pathway in the Personnel Handbook (§3.1). New officers join as Probationary Patrol Officers and train with a Police Training Officer selected by the Office of the Chiefs, who then approve them for independent patrol.
            </p>
            <a href={APPLICATION_URL} target="_blank" rel="noopener noreferrer" className={cn(buttonClass("primary", "lg"), "mt-7")}>
              Start your application <ArrowUpRight aria-hidden className="size-4" />
            </a>
          </div>
          <ol className="relative grid grid-cols-1 gap-3 sm:grid-cols-2">
            {PATHWAY.map((step, i) => (
              <li key={step.title} className={cn("relative rounded-lg border p-5", i === PATHWAY.length - 1 ? "border-obsidian bg-obsidian text-on-dark" : "border-line bg-surface")}>
                <span className={cn("display text-2xl font-bold tabular", i === PATHWAY.length - 1 ? "text-gold" : "text-gold-ink")}>{String(i + 1).padStart(2, "0")}</span>
                <p className="mt-2 text-sm font-semibold">{step.title}</p>
                <p className={cn("mt-1 text-xs leading-relaxed", i === PATHWAY.length - 1 ? "text-on-dark-muted" : "text-muted")}>{step.detail}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Mission band */}
      <section aria-label="Department structure" className="relative isolate overflow-hidden bg-obsidian text-on-dark">
        <Image src="/brand/tampa-banner.webp" alt="" fill sizes="100vw" className="-z-10 object-cover opacity-30" />
        <div aria-hidden className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_center,transparent,var(--obsidian)_85%)]" />
        <div className="mx-auto grid max-w-7xl gap-8 px-4 py-16 text-center sm:grid-cols-3 sm:px-6 lg:px-8">
          {[
            [String(DISTRICTS.length), "patrol districts"],
            [String(DIVISIONS.length), "specialized divisions"],
            [`${STAFF.filled} / ${STAFF.authorized}`, "sworn members of authorized positions"],
          ].map(([n, l]) => (
            <div key={l}>
              <p className="display-x text-5xl font-bold text-gold tabular">{n}</p>
              <p className="mt-2 text-xs text-on-dark-muted">{l}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Districts */}
      <section id="districts" aria-labelledby="dist-h" className="scroll-mt-20 border-b border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <p className="text-2xs font-semibold text-gold-ink">Patrol</p>
          <h2 id="dist-h" className="display mt-2 text-3xl font-bold tracking-tight">
            Two patrol districts
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-ink-2">Patrol is organized into a North and a South district, each with its own Lieutenants, Sergeants and patrol officers.</p>
          <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            {DISTRICTS.map((d) => {
              const cpt = positionByCallsign(d.captain);
              return (
                <div key={d.name} className="group relative overflow-hidden rounded-xl border border-line bg-surface p-7 shadow-sm">
                  <span aria-hidden className="display-x pointer-events-none absolute -right-2 -bottom-6 text-[120px] leading-none font-bold text-sunken select-none">
                    {d.name[0]}
                  </span>
                  <Radio className="size-5 text-gold-ink" aria-hidden />
                  <p className="display mt-4 text-xl font-bold">{d.name} District</p>
                  <p className="mt-1 text-xs text-muted">
                    Call signs <span className="font-semibold text-ink tabular">{d.callsignRange}</span>
                  </p>
                  <dl className="relative mt-6 grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <dt className="text-3xs text-muted">District captain</dt>
                      <dd className="font-semibold">{cpt?.holder ?? "Vacant"}</dd>
                    </div>
                    <div>
                      <dt className="text-3xs text-muted">Members</dt>
                      <dd className="font-semibold tabular">
                        {d.filled} of {d.authorized} positions
                      </dd>
                    </div>
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Divisions */}
      <section id="divisions" aria-labelledby="div-h" className="scroll-mt-20 bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-2xs font-semibold text-gold-ink">Specialized assignments</p>
              <h2 id="div-h" className="display mt-2 text-3xl font-bold tracking-tight">
                Divisions
              </h2>
              <p className="mt-3 max-w-2xl text-sm text-ink-2">Members may serve in up to three subdivisions at any rank alongside patrol (Handbook §9.3).</p>
            </div>
          </div>
          <ul className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
            {DIVISIONS.map((d) => (
              <li key={d.slug} className="flex flex-col bg-surface p-6">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-base font-semibold">{d.name}</h3>
                  <span className="shrink-0 rounded-full bg-obsidian px-2.5 py-0.5 text-3xs font-bold text-gold">{d.callsign ? `${d.callsign} · ${d.prefix}` : d.prefix}</span>
                </div>
                <dl className="mt-auto grid grid-cols-2 gap-3 pt-6 text-xs">
                  <div>
                    <dt className="text-3xs text-muted">Commander</dt>
                    <dd className="font-semibold">{positionByCallsign(d.command.commander)?.holder ?? "Vacant"}</dd>
                  </div>
                  <div>
                    <dt className="text-3xs text-muted">Positions</dt>
                    <dd className="font-semibold tabular">
                      {divisionStaffing(d).filled} of {d.capacity} filled
                    </dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Leadership */}
      <section id="leadership" aria-labelledby="lead-h" className="scroll-mt-20 border-y border-line">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <p className="text-2xs font-semibold text-gold-ink">Chain of command</p>
          <h2 id="lead-h" className="display mt-2 text-3xl font-bold tracking-tight">
            Leadership
          </h2>
          <p className="mt-3 max-w-2xl text-sm text-ink-2">
            The department is led by the Office of the Chiefs. Positions are shown as listed on the official roster (checked {VERIFIED_ON}); unfilled positions are marked vacant.
          </p>
          <ol className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
            {LEADERSHIP.map((g) => (
              <li key={g.tier} className={cn("rounded-xl p-5", g.stars === 4 ? "bg-obsidian text-on-dark md:col-span-2" : "border border-line bg-surface")}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold">{g.tier}</p>
                  <span aria-label={`${g.stars} star tier`} className="flex gap-0.5">
                    {Array.from({ length: g.stars }, (_, i) => (
                      <Star key={i} aria-hidden strokeWidth={0} className={cn("size-3 fill-current", g.stars === 4 ? "text-gold" : "text-gold-ink")} />
                    ))}
                  </span>
                </div>
                <ul className={cn("mt-3 grid grid-cols-1 gap-x-6 gap-y-2.5", g.stars === 4 && "sm:grid-cols-2 lg:grid-cols-4")}>
                  {g.rows.map((x, i) => (
                    <li key={`${x.callsign}-${i}`} className="flex items-baseline justify-between gap-3 text-xs">
                      <span className="min-w-0">
                        <span className={cn("block truncate font-semibold", !x.holder && (g.stars === 4 ? "text-on-dark-muted" : "text-muted"))}>{x.holder ?? "Vacant"}</span>
                        <span className={cn("block truncate text-3xs", g.stars === 4 ? "text-on-dark-muted" : "text-muted")}>
                          {x.rank} · {x.appointment}
                        </span>
                      </span>
                      <span className={cn("shrink-0 text-3xs font-semibold tabular", g.stars === 4 ? "text-gold" : "text-gold-ink")}>{x.callsign ?? "—"}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
          <p className="mt-4 text-2xs text-muted">
            {POSITIONS.length - STAFF.vacant - LEADERSHIP.reduce((n, g) => n + g.rows.filter((x) => x.holder).length, 0)} further members serve in the North and South district patrol blocks.{" "}
            <a href={SOURCES.roster.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-gold-ink hover:underline">
              Official roster
            </a>
          </p>
        </div>
      </section>

      {/* Services */}
      <section aria-labelledby="svc-h" className="bg-surface">
        <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 lg:px-8">
          <h2 id="svc-h" className="display text-3xl font-bold tracking-tight">
            Services
          </h2>
          <ul className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-3">
            <Service icon={UserPlus} title="Join the department" body="Apply through the recruitment application. Every submission is reviewed by the recruitment team." cta={{ href: APPLICATION_URL, label: "Apply", external: true }} />
            <Service icon={Car} title="Ride-along program" body="Make a copy of the civilian application, open a ticket in TPD Discord, and await a supervisory decision (Handbook §12.1)." cta={{ href: "/ride-alongs", label: "How to apply" }} />
            <Service icon={Megaphone} title="Public communications" body="Official announcements and press releases come only from the Office of Public Affairs (Handbook §14.1)." />
          </ul>
        </div>
      </section>

      {/* News + policies */}
      <section id="policies" aria-labelledby="news-h" className="scroll-mt-20">
        <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-2 lg:px-8">
          <div>
            <h2 id="news-h" className="display text-2xl font-bold tracking-tight">
              Announcements
            </h2>
            <ul className="mt-6 divide-y divide-line border-y border-line">
              {NEWS.map((n) => (
                <li key={n.title} className="py-5">
                  <p className="text-3xs font-semibold text-gold-ink">{n.date}</p>
                  <p className="mt-1 text-sm font-semibold">{n.title}</p>
                  <p className="mt-1 text-xs text-muted">{n.body}</p>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h2 className="display text-2xl font-bold tracking-tight">Policies</h2>
            <p className="mt-2 text-xs text-muted">The official documents are the final word. Incident reports are filed in AnchorCAD (Handbook §10).</p>
            <ul className="mt-6 flex flex-col gap-3">
              {[
                { href: SOURCES.handbook.href, icon: FileText, title: "Personnel Policy & Procedures Handbook", meta: "Effective October 30, 2026" },
                { href: SOURCES.useOfForce.href, icon: Scale, title: "Use of Force Policy", meta: "Dated October 30, 2026" },
              ].map((doc) => (
                <li key={doc.title}>
                  <a href={doc.href} target="_blank" rel="noopener noreferrer" className="group flex items-center gap-4 rounded-xl border border-line bg-surface p-5 shadow-sm transition-colors hover:border-line-strong">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-obsidian text-gold">
                      <doc.icon aria-hidden className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold">{doc.title}</span>
                      <span className="mt-0.5 block text-2xs text-muted">{doc.meta} · approved by the Chief of Police</span>
                    </span>
                    <ArrowUpRight aria-hidden className="size-4 text-muted transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-ink" />
                  </a>
                </li>
              ))}
            </ul>
            <Link href="/hq" className="mt-6 inline-flex items-center gap-1.5 text-xs font-semibold text-gold-ink hover:underline">
              Members: open the portal <ArrowRight className="size-3.5" aria-hidden />
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}

function Service({ icon: Icon, title, body, cta }: { icon: typeof Car; title: string; body: string; cta?: { href: string; label: string; external?: boolean } }) {
  return (
    <li className="flex flex-col rounded-xl border border-line bg-bg p-6">
      <Icon className="size-5 text-gold-ink" aria-hidden />
      <p className="mt-4 text-sm font-semibold">{title}</p>
      <p className="mt-1.5 text-xs leading-relaxed text-muted">{body}</p>
      {cta ? (
        <a href={cta.href} target={cta.external ? "_blank" : undefined} rel={cta.external ? "noopener noreferrer" : undefined} className="mt-5 inline-flex items-center gap-1 text-xs font-semibold text-gold-ink hover:underline">
          {cta.label} {cta.external ? <ArrowUpRight className="size-3.5" aria-hidden /> : null}
        </a>
      ) : null}
    </li>
  );
}
