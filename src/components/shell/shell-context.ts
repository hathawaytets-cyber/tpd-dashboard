"use client";

import { createContext, useContext } from "react";
import type { NewRequestType } from "./new-request-dialog";

export interface ShellApi {
  collapsed: boolean;
  toggleCollapsed: () => void;
  openPalette: () => void;
  openShortcuts: () => void;
  openNewRequest: (type?: NewRequestType) => void;
  openDrawer: () => void;
}

export const ShellContext = createContext<ShellApi | null>(null);

export function useShell() {
  const v = useContext(ShellContext);
  if (!v) throw new Error("useShell must be used inside HqShell");
  return v;
}

export const SHORTCUTS: { keys: string[]; label: string }[] = [
  { keys: ["Ctrl", "K"], label: "Open the command palette" },
  { keys: ["/"], label: "Search" },
  { keys: ["G", "O"], label: "Go to Overview" },
  { keys: ["G", "P"], label: "Go to Patrol" },
  { keys: ["G", "A"], label: "Go to Activity" },
  { keys: ["G", "T"], label: "Go to Training" },
  { keys: ["G", "M"], label: "Go to Personnel" },
  { keys: ["G", "R"], label: "Go to Requests" },
  { keys: ["G", "C"], label: "Go to Command Center" },
  { keys: ["G", "E"], label: "Go to Daily evaluation" },
  { keys: ["N"], label: "New request" },
  { keys: ["["], label: "Collapse or expand the sidebar" },
  { keys: ["?"], label: "Show keyboard shortcuts" },
];
