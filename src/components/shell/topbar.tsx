"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo, useSyncExternalStore } from "react";
import { Bell, ChevronRight, ClipboardPlus, ExternalLink, FlaskConical, Gauge, GraduationCap, History, Menu, Play, Plus, Radio, Search, Square, Users } from "lucide-react";
import { can } from "@/lib/authz";
import { usePatrol } from "@/components/patrol/patrol-provider";
import { Badge } from "@/components/ui/identity";
import { IconButton } from "@/components/ui/button";
import { Kbd } from "@/components/ui/field";
import { MenuItem, MenuLabel, MenuSeparator, Popover } from "@/components/ui/menu";
import { Dot } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/domain/activity";
import { useIsLive } from "@/lib/backend/auth";
import { useMe, useNow } from "@/lib/preview/hooks";
import { useDutyNotifications } from "@/components/evaluations/reminders";
import { markNotificationsRead, memberById, notificationsFor, usePreviewState } from "@/lib/preview/store";
import { ANCHORCAD_URL, PAGES } from "./nav-config";
import { useShell } from "./shell-context";

const noop = () => () => {};
/** "⌘K" on Apple platforms, "Ctrl K" elsewhere (server render assumes Ctrl). */
function usePaletteKey() {
  return useSyncExternalStore(noop, () => (/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? "⌘K" : "Ctrl K"), () => "Ctrl K");
}

function relative(at: number, now: number) {
  const m = Math.round((now - at) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function Topbar() {
  const pathname = usePathname();
  const { openPalette, openDrawer } = useShell();
  const paletteKey = usePaletteKey();
  const live = useIsLive();

  const crumbs = useMemo(() => {
    const page = [...PAGES].sort((a, b) => b.href.length - a.href.length).find((p) => pathname === p.href || pathname.startsWith(`${p.href}/`));
    const out: { href: string; label: string }[] = [{ href: "/hq", label: "Headquarters" }];
    if (page && page.href !== "/hq") {
      const parent = page.parent ? PAGES.find((p) => p.href === page.parent) : null;
      if (parent) out.push({ href: parent.href, label: parent.label });
      out.push({ href: page.href, label: page.label });
      const profile = pathname.match(/^\/hq\/roster\/([^/]+)$/);
      const m = profile ? memberById(profile[1]) : undefined;
      if (m) out.push({ href: pathname, label: m.name });
    }
    return out;
  }, [pathname]);

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-2 border-b border-line bg-bg/85 px-3 backdrop-blur-md sm:px-5 lg:px-6">
      <IconButton label="Open navigation" className="lg:hidden" onClick={openDrawer}>
        <Menu />
      </IconButton>
      <Link href="/hq" className="mr-1 lg:hidden" aria-label="Headquarters home">
        <Badge size={26} />
      </Link>

      <nav aria-label="Breadcrumb" className="hidden min-w-0 md:block">
        <ol className="flex items-center gap-1 text-xs">
          {crumbs.map((c, i) => {
            const last = i === crumbs.length - 1;
            return (
              <li key={c.href} className="flex min-w-0 items-center gap-1">
                {i > 0 ? <ChevronRight aria-hidden className="size-3.5 shrink-0 text-muted/70" /> : null}
                {last ? (
                  <span aria-current="page" className="truncate font-semibold text-ink">
                    {c.label}
                  </span>
                ) : (
                  <Link href={c.href} className="truncate text-muted hover:text-ink">
                    {c.label}
                  </Link>
                )}
              </li>
            );
          })}
        </ol>
      </nav>

      {live ? null : <span className="ml-1 hidden items-center gap-1.5 rounded-full bg-amber-soft px-2.5 py-0.5 text-3xs font-semibold text-amber ring-1 ring-inset ring-amber/20 xl:inline-flex" title="Structure, divisions, fleet and policy are official. People, patrol sessions and requests are fictional demo data; nothing is saved to the department.">
        <FlaskConical aria-hidden className="size-3" />
        Design preview · demo personas
      </span>}

      <div className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          onClick={openPalette}
          className="hidden h-9 w-64 items-center gap-2 rounded-md border border-line-strong bg-surface px-3 text-xs text-muted shadow-sm transition-colors hover:border-ink/25 sm:flex lg:w-72"
        >
          <Search aria-hidden className="size-4" />
          <span className="flex-1 text-left">Search or jump to…</span>
          <Kbd>{paletteKey}</Kbd>
        </button>
        <IconButton label="Search" className="sm:hidden" onClick={openPalette}>
          <Search />
        </IconButton>
        <DutyChip />
        <QuickCreate />
        <Notifications />
      </div>
    </header>
  );
}

/** Compact live duty indicator for screens where the sidebar is hidden. */
function DutyChip() {
  const me = useMe();
  const { phase } = usePatrol();
  const onDuty = phase === "on-duty" || phase === "ending";
  const now = useNow(1000, onDuty);
  if (!me?.session || !onDuty) return null;
  return (
    <Link
      href="/hq/patrol"
      className="flex h-8 items-center gap-2 rounded-full bg-obsidian px-3 text-2xs font-semibold text-gold lg:hidden"
      aria-label={`On duty for ${formatClock(now ? (now - me.session.start) / 1000 : 0)}. Open patrol`}
    >
      <Dot tone="gold" live />
      <span className="tabular">{formatClock(now ? (now - me.session.start) / 1000 : 0)}</span>
    </Link>
  );
}

/** Contextual quick actions. Each entry runs the real operation; entries the user can't use are left out. */
function QuickCreate() {
  const router = useRouter();
  const me = useMe();
  const { openNewRequest } = useShell();
  const patrolApi = usePatrol();
  const live = useIsLive();
  const home = me?.member.district === "South" ? "South" : "North";
  const onDuty = patrolApi.phase === "on-duty";
  const go = (close: () => void, href: string) => (close(), router.push(href));
  return (
    <Popover
      label="Quick actions"
      className="w-64"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          data-popover-trigger
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label="Quick actions"
          title="Quick actions"
          className="flex size-9 items-center justify-center rounded-md bg-primary text-on-primary shadow-sm transition-colors hover:bg-primary-hover"
        >
          <Plus className="size-[18px]" aria-hidden />
        </button>
      )}
    >
      {(close) => (
        <>
          {live ? null : <MenuLabel>Patrol</MenuLabel>}
          {live ? null : onDuty ? (
            <MenuItem icon={<Square />} onSelect={() => (close(), patrolApi.requestEnd())}>
              End patrol…
            </MenuItem>
          ) : patrolApi.canStart ? (
            <MenuItem icon={<Play />} disabled={patrolApi.phase !== "idle"} onSelect={() => (close(), patrolApi.start(home))}>
              Start patrol · {home}
            </MenuItem>
          ) : null}
          {live ? null : (
            <MenuItem icon={<Radio />} onSelect={() => go(close, "/hq/patrol")}>
              Open patrol
            </MenuItem>
          )}
          {ANCHORCAD_URL ? (
            <MenuItem icon={<ExternalLink />} onSelect={() => (close(), window.open(ANCHORCAD_URL, "_blank", "noopener"))}>
              Open AnchorCAD
            </MenuItem>
          ) : null}
          {live ? null : (
            <>
              <MenuSeparator />
              <MenuLabel>Create</MenuLabel>
              {me && can(me.actor, "request.create") ? (
                <MenuItem icon={<ClipboardPlus />} hint="N" onSelect={() => (close(), openNewRequest())}>
                  New request…
                </MenuItem>
              ) : null}
              <MenuItem icon={<History />} onSelect={() => go(close, "/hq/patrol#history")}>
                Activity correction…
              </MenuItem>
            </>
          )}
          <MenuLabel>Go to</MenuLabel>
          {live ? null : (
            <MenuItem icon={<GraduationCap />} onSelect={() => go(close, "/hq/training")}>
              Training
            </MenuItem>
          )}
          {me && can(me.actor, "roster.view") ? (
            <MenuItem icon={<Users />} onSelect={() => go(close, "/hq/roster")}>
              Personnel
            </MenuItem>
          ) : null}
          {me && can(me.actor, "command.view") ? (
            <MenuItem icon={<Gauge />} onSelect={() => go(close, "/hq/command")}>
              Command Center
            </MenuItem>
          ) : null}
        </>
      )}
    </Popover>
  );
}

function Notifications() {
  const state = usePreviewState();
  const router = useRouter();
  const now = useNow(60_000);
  const duties = useDutyNotifications();
  const items = useMemo(() => [...duties, ...(state ? notificationsFor(state) : [])].sort((a, b) => b.at - a.at), [state, duties]);
  const unread = state ? items.filter((n) => !state.readNotifications.includes(n.id)) : [];

  return (
    <Popover
      label="Notifications"
      className="w-[min(380px,calc(100vw-1.5rem))] p-0"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          data-popover-trigger
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label={unread.length ? `Notifications, ${unread.length} unread` : "Notifications"}
          className="relative flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors hover:bg-sunken hover:text-ink"
        >
          <Bell className="size-[18px]" aria-hidden />
          {unread.length ? (
            <span className="absolute top-1 right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold px-1 text-[10px] font-bold text-on-gold ring-2 ring-bg tabular">{unread.length}</span>
          ) : null}
        </button>
      )}
    >
      {(close) => (
        <div>
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <p className="text-xs font-semibold">Notifications</p>
            <button
              type="button"
              disabled={!unread.length}
              onClick={() => markNotificationsRead(items.map((i) => i.id))}
              className="text-2xs font-medium text-gold-ink hover:underline disabled:text-muted disabled:no-underline"
            >
              Mark all read
            </button>
          </div>
          {items.length === 0 ? (
            <p className="px-4 py-10 text-center text-xs text-muted">You’re all caught up.</p>
          ) : (
            <ul className="scrollbar-thin max-h-[420px] overflow-y-auto p-1">
              {items.map((n) => {
                const isUnread = !state?.readNotifications.includes(n.id);
                return (
                  <li key={n.id}>
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        markNotificationsRead([n.id]);
                        close();
                        router.push(n.href);
                      }}
                      className="flex w-full gap-3 rounded-md px-3 py-2.5 text-left outline-none hover:bg-sunken focus:bg-sunken"
                    >
                      <Dot tone={isUnread ? n.tone : "neutral"} className={cn("mt-1.5", !isUnread && "opacity-30")} />
                      <span className="min-w-0 flex-1">
                        <span className={cn("block text-xs", isUnread ? "font-semibold text-ink" : "text-ink-2")}>{n.title}</span>
                        <span className="mt-0.5 line-clamp-2 block text-2xs text-muted">{n.body}</span>
                      </span>
                      <span className="shrink-0 text-3xs text-muted">{now ? relative(n.at, now) : ""}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </Popover>
  );
}
