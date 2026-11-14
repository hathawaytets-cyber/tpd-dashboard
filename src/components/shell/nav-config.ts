import {
  Activity,
  FileWarning,
  FolderLock,
  MonitorSmartphone,
  BookOpen,
  Building2,
  ClipboardCheck,
  ClipboardList,
  Gauge,
  GraduationCap,
  LayoutDashboard,
  Network,
  Radio,
  Settings,
  ShieldCheck,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { Capability } from "@/lib/authz";
import { DIVISIONS } from "@/lib/department";
import { checkPanelUrl } from "../../../supabase/functions/_shared/anchorcad.ts";

export interface NavLeaf {
  href: string;
  label: string;
  icon?: LucideIcon;
  capability?: Capability;
  shortcut?: string;
  children?: NavLeaf[];
  /**
   * "ia": shown only when the database reports IA access (ia_my_access). IA access comes from appointments, not
   * rank, so it cannot be a `can()` capability; the database authorizes every IA read again.
   */
  gate?: "ia";
}

export interface NavGroup {
  label: string;
  items: NavLeaf[];
}

export const NAV: NavGroup[] = [
  {
    label: "Personal",
    items: [
      { href: "/hq", label: "Overview", icon: LayoutDashboard, shortcut: "G O" },
      { href: "/hq/patrol", label: "Patrol", icon: Radio, shortcut: "G P" },
      { href: "/hq/activity", label: "Activity", icon: Activity, shortcut: "G A" },
      { href: "/hq/training", label: "Training", icon: GraduationCap, shortcut: "G T" },
    ],
  },
  {
    label: "Department",
    items: [
      { href: "/hq/structure", label: "Structure", icon: Network, shortcut: "G S" },
      { href: "/hq/roster", label: "Personnel", icon: Users, capability: "roster.view", shortcut: "G M" },
      {
        href: "/hq/divisions",
        label: "Divisions",
        icon: Building2,
        children: DIVISIONS.map((d) => ({ href: `/hq/divisions/${d.slug}`, label: d.name })),
      },
      { href: "/hq/requests", label: "Requests", icon: ClipboardList, shortcut: "G R" },
      { href: "/hq/resources", label: "Resources", icon: BookOpen },
      { href: "/hq/cad", label: "AnchorCAD", icon: MonitorSmartphone },
      { href: "/hq/report", label: "Report misconduct", icon: FileWarning },
    ],
  },
  {
    label: "Management",
    items: [
      { href: "/hq/evaluations", label: "Daily evaluation", icon: ClipboardCheck, capability: "evaluation.submit", shortcut: "G E" },
      { href: "/hq/supervisor", label: "Supervisor", icon: ShieldCheck, capability: "supervisor.view" },
      { href: "/hq/internal-affairs", label: "Internal Affairs", icon: FolderLock, gate: "ia", children: [{ href: "/hq/internal-affairs/appointments", label: "Appointments" }] },
      {
        href: "/hq/command",
        label: "Command Center",
        icon: Gauge,
        capability: "command.view",
        shortcut: "G C",
        children: [
          { href: "/hq/command/evaluations", label: "Evaluations" },
          { href: "/hq/command/integrations", label: "Integrations" },
        ],
      },
    ],
  },
];

export const FOOTER_NAV: NavLeaf[] = [{ href: "/hq/settings", label: "Settings", icon: Settings }];

/** Flattened page index for breadcrumbs and the command palette. */
export const PAGES: { href: string; label: string; parent?: string; capability?: Capability; gate?: "ia" }[] = [
  ...NAV.flatMap((g) =>
    g.items.flatMap((i) => [
      { href: i.href, label: i.label, capability: i.capability, gate: i.gate },
      ...(i.children ?? []).map((c) => ({ href: c.href, label: c.label, parent: i.href, gate: i.gate })),
    ]),
  ),
  ...FOOTER_NAV.map((i) => ({ href: i.href, label: i.label })),
];

export const GO_TO: Record<string, string> = { o: "/hq", p: "/hq/patrol", a: "/hq/activity", t: "/hq/training", m: "/hq/roster", s: "/hq/structure", r: "/hq/requests", c: "/hq/command", e: "/hq/evaluations" };

/** AnchorCAD is the department's official reporting system (HB §10). No API integration exists. */
export const ANCHORCAD_PANEL = checkPanelUrl(process.env.NEXT_PUBLIC_ANCHORCAD_URL);
/** Launch link, only when it is https on an official AnchorCAD domain; otherwise "" and the UI says it is not configured. */
export const ANCHORCAD_URL = ANCHORCAD_PANEL.status === "connected" ? (ANCHORCAD_PANEL.url ?? "") : "";

/**
 * Official TPD community on AnchorCAD (community id "vcfsrp"), supplied by command. A join link is not API access:
 * it only lets a member request to join the community inside AnchorCAD, where AnchorCAD's administrators approve.
 */
export const ANCHORCAD_JOIN_URL = "https://anchr.gg/join?communityid=vcfsrp";
