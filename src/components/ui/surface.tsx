import type { ComponentProps, ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Base container. Use sparingly: group by whitespace and rules before reaching for a card. */
export function Card({ className, ...props }: ComponentProps<"section">) {
  return <section className={cn("rounded-xl border border-edge bg-surface shadow-card", className)} {...props} />;
}

export function CardHeader({
  title,
  description,
  action,
  id,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  action?: ReactNode;
  id?: string;
  className?: string;
}) {
  return (
    <header className={cn("flex items-center justify-between gap-3 px-4 pt-3.5 pb-3", className)}>
      <div className="min-w-0">
        <h2 id={id} className="text-sm leading-5 font-semibold tracking-[-0.005em] text-ink">
          {title}
        </h2>
        {description ? <p className="mt-0.5 line-clamp-2 text-2xs text-muted">{description}</p> : null}
      </div>
      {action ? <div className="flex shrink-0 items-center gap-1">{action}</div> : null}
    </header>
  );
}

/** Section heading used directly on the page background, without a card. */
export function SectionTitle({ children, action, id }: { children: ReactNode; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-2.5 flex items-center justify-between gap-3">
      <h2 id={id} className="text-sm font-semibold text-ink">
        {children}
      </h2>
      {action}
    </div>
  );
}

/** Label/value pairs in a compact grid. */
export function DataList({ items, columns = 2, className }: { items: { label: string; value: ReactNode }[]; columns?: 2 | 3 | 4; className?: string }) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[columns];
  return (
    <dl className={cn("grid gap-x-4 gap-y-3", cols, className)}>
      {items.map((i) => (
        <div key={i.label} className="min-w-0">
          <dt className="text-2xs text-muted">{i.label}</dt>
          <dd className="mt-0.5 truncate text-sm font-medium text-ink">{i.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Stat({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "default" | "warn" | "good" }) {
  return (
    <div className="min-w-0">
      <p className="text-2xs text-muted">{label}</p>
      <p
        className={cn(
          "display mt-1 text-xl font-semibold leading-none tabular",
          tone === "warn" ? "text-amber" : tone === "good" ? "text-green" : "text-ink",
        )}
      >
        {value}
      </p>
      {sub ? <p className="mt-1.5 text-2xs text-muted">{sub}</p> : null}
    </div>
  );
}
