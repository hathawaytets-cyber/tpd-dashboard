"use client";

import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { useSyncExternalStore, type ReactNode } from "react";
import { cn } from "@/lib/cn";

// ---------------------------------------------------------------- toasts

type ToastTone = "success" | "error" | "info";
interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  body?: string;
}

let toasts: ToastItem[] = [];
let counter = 0;
const subs = new Set<() => void>();
const emit = () => subs.forEach((s) => s());

export function toast(tone: ToastTone, title: string, body?: string) {
  const id = ++counter;
  toasts = [...toasts, { id, tone, title, body }].slice(-4);
  emit();
  setTimeout(() => dismiss(id), tone === "error" ? 7000 : 4500);
}

function dismiss(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const EMPTY: ToastItem[] = [];

export function Toaster() {
  const items = useSyncExternalStore(
    (l) => {
      subs.add(l);
      return () => subs.delete(l);
    },
    () => toasts,
    () => EMPTY,
  );
  const icon = { success: CheckCircle2, error: XCircle, info: Info };
  return (
    <div aria-live="polite" className="pointer-events-none fixed inset-x-3 bottom-20 z-[70] flex flex-col items-center gap-2 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:items-end lg:bottom-5">
      {items.map((t) => {
        const Icon = icon[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="pointer-events-auto flex w-full max-w-sm animate-pop-in items-start gap-3 rounded-lg border border-dark-line bg-obsidian px-3.5 py-3 text-on-dark shadow-lg"
          >
            <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", t.tone === "success" ? "text-[#4cc28a]" : t.tone === "error" ? "text-[#f08679]" : "text-gold")} />
            <div className="min-w-0 flex-1">
              <p className="text-xs font-semibold">{t.title}</p>
              {t.body ? <p className="mt-0.5 text-2xs text-on-dark-muted">{t.body}</p> : null}
            </div>
            <button type="button" onClick={() => dismiss(t.id)} className="-mr-1 rounded p-0.5 text-on-dark-muted hover:text-on-dark" aria-label="Dismiss notification">
              <X className="size-3.5" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------- states

export function Skeleton({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block animate-shimmer rounded-md bg-[linear-gradient(90deg,var(--sunken)_0%,var(--line)_50%,var(--sunken)_100%)] bg-[length:200%_100%]",
        className,
      )}
    />
  );
}

/**
 * Empty states are a prompt to act, not a shrug. `compact` is the in-card
 * variant: icon beside the copy, left aligned with the card's content edge.
 */
export function EmptyState({
  icon,
  title,
  body,
  action,
  className,
  compact,
}: {
  icon?: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  className?: string;
  compact?: boolean;
}) {
  if (compact) {
    return (
      <div className={cn("flex items-start gap-3 px-4 py-4", className)}>
        {icon ? <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-sunken text-muted [&_svg]:size-4">{icon}</div> : null}
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="text-xs font-semibold text-ink">{title}</p>
          {body ? <p className="mt-0.5 text-2xs text-muted">{body}</p> : null}
          {action ? <div className="mt-2.5">{action}</div> : null}
        </div>
      </div>
    );
  }
  return (
    <div className={cn("flex flex-col items-center px-6 py-10 text-center", className)}>
      {icon ? <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-sunken text-muted [&_svg]:size-5">{icon}</div> : null}
      <p className="text-sm font-semibold text-ink">{title}</p>
      {body ? <p className="mt-1 max-w-sm text-xs text-muted">{body}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function Callout({ tone = "info", title, children, action }: { tone?: "info" | "warn" | "error"; title: string; children?: ReactNode; action?: ReactNode }) {
  const map = {
    info: { cls: "border-info/25 bg-info-soft text-info", Icon: Info },
    warn: { cls: "border-amber/25 bg-amber-soft text-amber", Icon: AlertTriangle },
    error: { cls: "border-red/25 bg-red-soft text-red", Icon: XCircle },
  }[tone];
  return (
    <div role={tone === "error" ? "alert" : undefined} className={cn("flex items-start gap-3 rounded-lg border px-3.5 py-3", map.cls)}>
      <map.Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold">{title}</p>
        {children ? <div className="mt-0.5 text-2xs text-ink-2">{children}</div> : null}
      </div>
      {action}
    </div>
  );
}
