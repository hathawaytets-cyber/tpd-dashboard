import Image from "next/image";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { Badge } from "@/components/ui/identity";
import { ButtonLink } from "@/components/ui/button";
import { PublicMobileMenu } from "@/components/public/mobile-menu";
import { ThemeButton } from "@/components/public/theme-button";
import { APPLICATION_URL, HANDBOOK_URL, PUBLIC_NAV, USE_OF_FORCE_URL } from "@/lib/public-nav";

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col bg-bg">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[60] focus:rounded-md focus:bg-surface focus:px-3 focus:py-2 focus:shadow-md">
        Skip to content
      </a>
      <p className="bg-gold px-4 py-1.5 text-center text-2xs font-medium text-on-gold">
        A roleplay department in the Florida State Roleplay community on Roblox. Not a real police agency. In a real emergency, call 911.
      </p>
      <header className="sticky top-0 z-30 border-b border-dark-line bg-obsidian/92 text-on-dark backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
          <Link href="/" aria-label="Tampa Police Department home" className="flex items-center gap-3">
            <Badge size={38} priority />
            <span className="leading-tight">
              <span className="display block text-sm font-bold tracking-wide whitespace-nowrap">TAMPA POLICE</span>
              <span className="hidden text-3xs text-on-dark-muted sm:block">Florida State Roleplay</span>
            </span>
          </Link>
          <nav aria-label="Main" className="ml-auto hidden md:block">
            <ul className="flex items-center gap-1">
              {PUBLIC_NAV.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="rounded-md px-3 py-2 text-xs font-medium text-on-dark-muted transition-colors hover:text-on-dark">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ml-auto flex items-center gap-1.5 md:ml-0">
            <ThemeButton />
            <Link href="/report" className="hidden rounded-md px-3 py-2 text-xs font-semibold text-on-dark hover:bg-white/8 lg:block">
              Report an officer
            </Link>
            <span className="hidden sm:block">
              <ButtonLink href="/hq" size="sm" variant="gold">
                Member portal
              </ButtonLink>
            </span>
            <PublicMobileMenu />
          </div>
        </div>
      </header>
      <main id="main" className="flex-1">
        {children}
      </main>
      <footer className="relative isolate overflow-hidden bg-obsidian text-on-dark">
        <Image src="/brand/tampa-banner-1200.webp" alt="" fill sizes="100vw" className="-z-10 object-cover object-bottom opacity-[0.12]" />
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.6fr_1fr_1fr_1fr] lg:px-8">
          <div>
            <div className="flex items-center gap-3">
              <Badge size={52} />
              <span className="leading-tight">
                <span className="display block text-base font-bold tracking-wide">TAMPA POLICE</span>
                <span className="block text-2xs text-on-dark-muted">Florida State Roleplay</span>
              </span>
            </div>
            <p className="mt-5 max-w-sm text-2xs leading-relaxed text-on-dark-muted">
              The Tampa Police Department is a fictional department in the Florida State Roleplay community on Roblox Emergency Response: Liberty County. It is not affiliated with the City of Tampa or any real agency. Please do not enter real-world personal information on this site.
            </p>
          </div>
          <FooterCol
            title="Department"
            links={[
              ["/#about", "About"],
              ["/#districts", "Patrol districts"],
              ["/#divisions", "Divisions"],
              ["/#leadership", "Leadership"],
              ["/ride-alongs", "Civilian ride-alongs"],
              ["/report", "Report an officer"],
              ["/report/status", "Complaint status"],
            ]}
          />
          <FooterCol
            title="Policies"
            links={[
              [HANDBOOK_URL, "Personnel Handbook"],
              [USE_OF_FORCE_URL, "Use of Force Policy"],
            ]}
          />
          <FooterCol
            title="Members"
            links={[
              [APPLICATION_URL, "Apply to join"],
              ["/hq", "Member portal"],
            ]}
          />
        </div>
        <div className="border-t border-dark-line">
          <p className="mx-auto max-w-7xl px-4 py-4 text-3xs text-on-dark-muted sm:px-6 lg:px-8">Unofficial Florida State Roleplay website. Not affiliated with the real Tampa Police Department.</p>
        </div>
      </footer>
    </div>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="text-2xs font-semibold text-gold">{title}</p>
      <ul className="mt-3 flex flex-col gap-2 text-xs text-on-dark-muted">
        {links.map(([href, label]) => {
          const external = href.startsWith("http");
          return (
            <li key={label}>
              {external ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:text-on-dark">
                  {label} <ArrowUpRight className="size-3" aria-hidden />
                </a>
              ) : (
                <Link href={href} className="hover:text-on-dark">
                  {label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
