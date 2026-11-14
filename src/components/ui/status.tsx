import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/**
 * "quiet" is for resting states (Recorded, Active, Submitted, On track): plain
 * muted text, so the coloured pills that remain are the exceptions.
 */
export type Tone = "neutral" | "gold" | "green" | "amber" | "red" | "info" | "dark" | "quiet";

const pill: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2 ring-line",
  gold: "bg-gold-soft text-gold-ink ring-gold/30",
  green: "bg-green-soft text-green ring-green/20",
  amber: "bg-amber-soft text-amber ring-amber/20",
  red: "bg-red-soft text-red ring-red/20",
  info: "bg-info-soft text-info ring-info/20",
  dark: "bg-white/8 text-on-dark ring-white/10",
  quiet: "font-medium text-muted",
};

const dot: Record<Tone, string> = {
  neutral: "bg-muted",
  gold: "bg-gold",
  green: "bg-green",
  amber: "bg-amber",
  red: "bg-red",
  info: "bg-info",
  dark: "bg-on-dark-muted",
  quiet: "bg-muted",
};

/** `dotted` takes a tone to colour the dot differently from the pill (a quiet "Submitted" with a green dot). */
export function Pill({ tone = "neutral", dotted, className, children, ...props }: ComponentProps<"span"> & { tone?: Tone; dotted?: boolean | Tone }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full text-3xs",
        tone === "quiet" ? null : "px-2 font-semibold ring-1 ring-inset",
        pill[tone],
        className,
      )}
      {...props}
    >
      {dotted ? <span aria-hidden className={cn("size-1.5 rounded-full", dot[dotted === true ? tone : dotted])} /> : null}
      {children}
    </span>
  );
}

export function Dot({ tone, live, className }: { tone: Tone; live?: boolean; className?: string }) {
  return (
    <span aria-hidden className={cn("relative inline-flex size-2 shrink-0", className)}>
      {live ? <span className={cn("absolute inset-0 animate-ping rounded-full opacity-60 motion-reduce:hidden", dot[tone])} /> : null}
      <span className={cn("relative size-2 rounded-full", dot[tone])} />
    </span>
  );
}
