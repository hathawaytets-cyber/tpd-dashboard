import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

/** Standard page frame inside the shell. `wide` removes the reading-width cap for dense workspaces. */
export function Page({ children, wide, className }: { children: ReactNode; wide?: boolean; className?: string }) {
  return <div className={cn("mx-auto w-full px-4 py-5 sm:px-6 lg:px-8 lg:py-7", wide ? "max-w-[1480px]" : "max-w-[1240px]", className)}>{children}</div>;
}

export function PageHeader({ eyebrow, title, description, actions, meta }: { eyebrow?: ReactNode; title: ReactNode; description?: ReactNode; actions?: ReactNode; meta?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1.5 text-2xs font-medium text-muted">{eyebrow}</p> : null}
        <h1 className="display text-xl leading-tight font-bold tracking-tight text-balance text-ink sm:text-2xl">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
        {meta ? <div className="mt-2.5 flex flex-wrap items-center gap-2">{meta}</div> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
