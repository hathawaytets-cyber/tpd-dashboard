"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeftRight,
  Check,
  ChevronDown,
  ChevronsUpDown,
  Globe,
  Keyboard,
  LogIn,
  LogOut,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  RotateCcw,
  Sun,
  UserRound,
} from "lucide-react";
import { Badge, Avatar, RankMark } from "@/components/ui/identity";
import { MenuItem, MenuLabel, MenuSeparator, Popover, Tooltip } from "@/components/ui/menu";
import { Dot } from "@/components/ui/status";
import { Skeleton, toast } from "@/components/ui/feedback";
import { EvaluationNavBadge } from "@/components/evaluations/reminders";
import { usePatrol } from "@/components/patrol/patrol-provider";
import { can } from "@/lib/authz";
import { useAuth, useIsLive } from "@/lib/backend/auth";
import { cn } from "@/lib/cn";
import { formatClock } from "@/lib/domain/activity";
import { useMe, useNow } from "@/lib/preview/hooks";
import { resetPreview, ROLE_PERSONA, setRole, type PreviewRole } from "@/lib/preview/store";
import { FOOTER_NAV, NAV, type NavLeaf } from "./nav-config";
import { useShell } from "./shell-context";
import { setTheme, useTheme } from "./theme";

export function isActive(pathname: string, href: string) {
  return href === "/hq" ? pathname === "/hq" : pathname === href || pathname.startsWith(`${href}/`);
}

/** Obsidian navigation rail. `collapsed` shrinks it to icons with tooltips. */
export function Sidebar({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const { toggleCollapsed } = useShell();
  const me = useMe();
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col bg-obsidian text-on-dark">
      <WorkspaceSwitcher collapsed={collapsed} />

      <DutyStatus collapsed={collapsed} onNavigate={onNavigate} />

      <nav aria-label="Headquarters" className="scrollbar-thin flex-1 overflow-y-auto px-2.5 pb-3">
        {NAV.map((group) => {
          const items = group.items.filter((i) => !i.capability || (me && can(me.actor, i.capability)));
          if (!items.length) return null;
          return (
            <div key={group.label} className="mt-4 first:mt-1">
              {collapsed ? (
                <div aria-hidden className="mx-2 mb-2 h-px bg-dark-line" />
              ) : (
                <p className="px-2.5 pb-1.5 text-3xs font-semibold text-on-dark-muted/80">{group.label}</p>
              )}
              <ul className="flex flex-col gap-0.5">
                {items.map((item) => (
                  <NavItem key={item.href} item={item} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
                ))}
              </ul>
            </div>
          );
        })}
      </nav>

      <div className="border-t border-dark-line px-2.5 py-2.5">
        <ul className="mb-1.5 flex flex-col gap-0.5">
          {FOOTER_NAV.map((item) => (
            <NavItem key={item.href} item={item} pathname={pathname} collapsed={collapsed} onNavigate={onNavigate} />
          ))}
          {onNavigate ? null : (
            <li>
              <SideButton collapsed={collapsed} label={collapsed ? "Expand sidebar" : "Collapse sidebar"} hint="[" onClick={toggleCollapsed}>
                {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
              </SideButton>
            </li>
          )}
        </ul>
        <AccountMenu collapsed={collapsed} />
      </div>
    </div>
  );
}

function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const me = useMe();
  const workspaces = [
    { href: "/hq", label: "Headquarters", sub: "Personal workspace", show: true },
    { href: "/hq/supervisor", label: "Supervisor desk", sub: "Field supervision", show: !!me && can(me.actor, "supervisor.view") },
    { href: "/hq/command", label: "Command Center", sub: "Department operations", show: !!me && can(me.actor, "command.view") },
  ].filter((w) => w.show);
  const pathname = usePathname();
  const current = [...workspaces].reverse().find((w) => isActive(pathname, w.href)) ?? workspaces[0];

  return (
    <div className={cn("flex h-14 shrink-0 items-center border-b border-dark-line", collapsed ? "justify-center px-2" : "px-3")}>
      <Popover
        label="Switch workspace"
        align="start"
        rootClassName={collapsed ? undefined : "w-full"}
        className="w-64"
        trigger={({ open, toggle, id }) => (
          <button
            type="button"
            data-popover-trigger
            aria-expanded={open}
            aria-controls={open ? id : undefined}
            onClick={toggle}
            className={cn("flex items-center gap-2.5 rounded-md text-left transition-colors hover:bg-white/6", collapsed ? "p-1.5" : "-ml-1 w-full p-1.5 pr-2")}
            aria-label={`Workspace: ${current.label}. Switch workspace`}
          >
            <Badge size={30} priority />
            {collapsed ? null : (
              <>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="display block truncate text-xs font-bold tracking-wide">TAMPA POLICE</span>
                  <span className="block truncate text-3xs text-on-dark-muted">{current.label}</span>
                </span>
                <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-on-dark-muted" />
              </>
            )}
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>Workspaces</MenuLabel>
            {workspaces.map((w) => (
              <Link
                key={w.href}
                href={w.href}
                role="menuitem"
                onClick={close}
                className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs outline-none hover:bg-sunken focus:bg-sunken"
              >
                <span className="flex-1">
                  <span className="block font-semibold text-ink">{w.label}</span>
                  <span className="block text-3xs text-muted">{w.sub}</span>
                </span>
                {w.href === current.href ? <Check aria-label="Current" className="size-4 text-gold-ink" /> : null}
              </Link>
            ))}
            <MenuSeparator />
            <Link href="/" role="menuitem" onClick={close} className="flex items-center gap-2.5 rounded-md px-2.5 py-2 text-xs text-ink outline-none hover:bg-sunken focus:bg-sunken">
              <Globe aria-hidden className="size-4 text-muted" />
              Public website
            </Link>
          </>
        )}
      </Popover>
    </div>
  );
}

function DutyStatus({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
  const me = useMe();
  const { phase } = usePatrol();
  const onDuty = phase === "on-duty" || phase === "ending" || phase === "recovering";
  const now = useNow(1000, onDuty);
  const live = useIsLive();
  if (live) return null; // no patrol record exists server-side yet, so no duty state is shown
  if (!me) {
    return <div className="px-3 py-3">{collapsed ? <Skeleton className="mx-auto size-8 rounded-md opacity-20" /> : <Skeleton className="h-12 w-full opacity-20" />}</div>;
  }
  const elapsed = me.session && now ? now - me.session.start : 0;
  const label = onDuty ? `On duty, ${me.session?.district} District, ${formatClock(elapsed / 1000)}` : "Off duty. Open patrol";

  const body = collapsed ? (
    <span className={cn("flex size-9 items-center justify-center rounded-md", onDuty ? "bg-gold/15" : "bg-white/6")}>
      <Dot tone={onDuty ? "gold" : "dark"} live={onDuty} />
    </span>
  ) : (
    <span className={cn("flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 ring-1 ring-inset", onDuty ? "bg-gold/10 ring-gold/25" : "bg-white/4 ring-white/8")}>
      <Dot tone={onDuty ? "gold" : "dark"} live={onDuty} />
      <span className="min-w-0 flex-1 leading-tight">
        <span className={cn("block text-2xs font-semibold", onDuty ? "text-gold" : "text-on-dark")}>{onDuty ? "On duty" : "Off duty"}</span>
        <span className="block truncate text-3xs text-on-dark-muted">{onDuty ? `${me.session?.district} District` : me.member.callsign}</span>
      </span>
      {onDuty ? <span className="text-xs font-semibold text-on-dark tabular">{formatClock(elapsed / 1000)}</span> : <span className="text-3xs font-medium text-on-dark-muted">Patrol →</span>}
    </span>
  );

  return (
    <div className={cn("pt-3", collapsed ? "flex justify-center px-2" : "px-2.5")}>
      {collapsed ? (
        <Tooltip content={label} side="right">
          <Link href="/hq/patrol" aria-label={label} onClick={onNavigate} className="rounded-md">
            {body}
          </Link>
        </Tooltip>
      ) : (
        <Link href="/hq/patrol" aria-label={label} onClick={onNavigate} className="block rounded-md transition-opacity hover:opacity-90">
          {body}
        </Link>
      )}
    </div>
  );
}

function NavItem({ item, pathname, collapsed, onNavigate }: { item: NavLeaf; pathname: string; collapsed: boolean; onNavigate?: () => void }) {
  const active = isActive(pathname, item.href);
  const childActive = item.children?.some((c) => isActive(pathname, c.href)) ?? false;
  const [open, setOpen] = useState(childActive);
  const Icon = item.icon;
  const showChildren = !!item.children && !collapsed && (open || childActive);

  const link = (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active && !childActive ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      className={cn(
        "group relative flex h-9 items-center gap-2.5 rounded-md text-xs font-medium transition-colors",
        collapsed ? "w-9 justify-center" : "flex-1 px-2.5",
        active ? "bg-white/8 text-on-dark" : "text-on-dark-muted hover:bg-white/5 hover:text-on-dark",
      )}
    >
      {active ? <span aria-hidden className="absolute -left-2.5 top-2 bottom-2 w-[3px] rounded-r-full bg-gold" /> : null}
      {Icon ? <Icon aria-hidden className={cn("size-[17px] shrink-0", active ? "text-gold" : "")} /> : null}
      {collapsed ? null : <span className="truncate">{item.label}</span>}
      {item.href === "/hq/evaluations" ? <EvaluationNavBadge collapsed={collapsed} /> : null}
      {!collapsed && item.shortcut && item.href !== "/hq/evaluations" ? (
        <span className="ml-auto hidden text-3xs tracking-wider text-on-dark-muted/60 opacity-0 transition-opacity group-hover:opacity-100 xl:inline">{item.shortcut}</span>
      ) : null}
    </Link>
  );

  return (
    <li>
      <div className="flex items-center">
        {collapsed ? (
          <Tooltip content={item.label} side="right">
            {link}
          </Tooltip>
        ) : (
          link
        )}
        {item.children && !collapsed ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={showChildren}
            aria-label={`${showChildren ? "Collapse" : "Expand"} ${item.label}`}
            className="ml-0.5 flex size-7 items-center justify-center rounded-md text-on-dark-muted hover:bg-white/5 hover:text-on-dark"
          >
            <ChevronDown aria-hidden className={cn("size-3.5 transition-transform", showChildren ? "" : "-rotate-90")} />
          </button>
        ) : null}
      </div>
      {showChildren ? (
        <ul className="mt-0.5 mb-1 ml-[19px] flex flex-col gap-px border-l border-dark-line pl-2.5">
          {item.children!.map((c) => {
            const a = isActive(pathname, c.href);
            return (
              <li key={c.href}>
                <Link
                  href={c.href}
                  onClick={onNavigate}
                  aria-current={a ? "page" : undefined}
                  className={cn("block truncate rounded-md px-2 py-1.5 text-2xs transition-colors", a ? "bg-white/8 font-semibold text-gold" : "text-on-dark-muted hover:text-on-dark")}
                >
                  {c.label}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : null}
    </li>
  );
}

function SideButton({ collapsed, label, hint, onClick, children }: { collapsed: boolean; label: string; hint?: string; onClick: () => void; children: React.ReactNode }) {
  const btn = (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={cn(
        "flex h-9 items-center gap-2.5 rounded-md text-xs font-medium text-on-dark-muted transition-colors hover:bg-white/5 hover:text-on-dark [&_svg]:size-[17px]",
        collapsed ? "w-9 justify-center" : "w-full px-2.5",
      )}
    >
      {children}
      {collapsed ? null : (
        <>
          <span>{label}</span>
          {hint ? <span className="ml-auto text-3xs text-on-dark-muted/60">{hint}</span> : null}
        </>
      )}
    </button>
  );
  return collapsed ? (
    <Tooltip content={`${label} (${hint})`} side="right">
      {btn}
    </Tooltip>
  ) : (
    btn
  );
}

function AccountMenu({ collapsed }: { collapsed: boolean }) {
  const me = useMe();
  const theme = useTheme();
  const { openShortcuts } = useShell();
  const auth = useAuth();
  const live = useIsLive();
  if (!me) return <Skeleton className="h-11 w-full opacity-20" />;
  const roles = Object.keys(ROLE_PERSONA) as PreviewRole[];

  return (
    <Popover
      label="Account"
      side="top"
      rootClassName={collapsed ? undefined : "w-full"}
      align="start"
      className="w-72"
      trigger={({ open, toggle, id }) => (
        <button
          type="button"
          data-popover-trigger
          onClick={toggle}
          aria-expanded={open}
          aria-controls={open ? id : undefined}
          aria-label={`Account: ${me.member.name}`}
          className={cn("flex items-center gap-2.5 rounded-md text-left transition-colors hover:bg-white/6", collapsed ? "mx-auto p-1" : "w-full p-1.5")}
        >
          <Avatar name={me.member.name} size={30} dark />
          {collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate text-xs font-semibold">{me.member.name}</span>
                <span className="block truncate text-3xs text-on-dark-muted">
                  <RankMark rank={me.member.rank} dark /> · {me.member.callsign}
                </span>
              </span>
              <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-on-dark-muted" />
            </>
          )}
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="flex items-center gap-2.5 px-2.5 pt-2 pb-2.5">
            <Avatar name={me.member.name} size={34} />
            <div className="min-w-0 leading-tight">
              <p className="truncate text-xs font-semibold">{me.member.name}</p>
              <p className="truncate text-3xs text-muted">
                {me.member.rank} · {me.member.callsign} · {me.member.district === "Department" ? "Department" : `${me.member.district} District`}
              </p>
            </div>
          </div>
          <MenuSeparator />
          {live ? null : <MenuLabel>Preview as (sample personas)</MenuLabel>}
          {(live ? [] : roles).map((r) => (
            <MenuItem
              key={r}
              icon={<UserRound />}
              hint={me.role === r ? <Check className="size-3.5 text-gold-ink" aria-label="Current" /> : null}
              onSelect={() => {
                setRole(r);
                close();
                toast("info", `Previewing as ${ROLE_PERSONA[r].label}`, ROLE_PERSONA[r].description);
              }}
            >
              {ROLE_PERSONA[r].label}
            </MenuItem>
          ))}
          <MenuSeparator />
          <MenuLabel>Theme</MenuLabel>
          <div role="radiogroup" aria-label="Theme" className="mx-2.5 mb-1.5 grid grid-cols-3 gap-1 rounded-md bg-sunken p-0.5">
            {(
              [
                ["light", "Light", Sun],
                ["dark", "Dark", Moon],
                ["system", "Auto", Monitor],
              ] as const
            ).map(([v, l, I]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={theme === v}
                onClick={() => setTheme(v)}
                className={cn("flex h-7 items-center justify-center gap-1.5 rounded-[5px] text-2xs font-medium", theme === v ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink")}
              >
                <I aria-hidden className="size-3.5" />
                {l}
              </button>
            ))}
          </div>
          <MenuSeparator />
          <MenuItem
            icon={<Keyboard />}
            hint="?"
            onSelect={() => {
              close();
              openShortcuts();
            }}
          >
            Keyboard shortcuts
          </MenuItem>
          {live ? null : (
            <MenuItem
              icon={<RotateCcw />}
              onSelect={() => {
                resetPreview();
                close();
                toast("info", "Preview data reset", "Sample sessions and requests are back to their starting state.");
              }}
            >
              Reset preview data
            </MenuItem>
          )}
          {auth.status === "disabled" ? (
            <MenuItem icon={<LogOut />} disabled hint="Not configured" onSelect={() => {}}>
              Discord sign-in
            </MenuItem>
          ) : auth.session ? (
            <>
              <MenuItem icon={<ArrowLeftRight />} onSelect={() => (close(), auth.signOut().then(auth.signIn))}>
                Switch Discord account
              </MenuItem>
              <MenuItem icon={<LogOut />} onSelect={() => (close(), auth.signOut())}>
                Sign out
              </MenuItem>
            </>
          ) : (
            <MenuItem icon={<LogIn />} onSelect={() => (close(), auth.signIn())}>
              Sign in with Discord
            </MenuItem>
          )}
        </>
      )}
    </Popover>
  );
}
