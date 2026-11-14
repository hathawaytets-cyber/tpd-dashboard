"use client";

import { Lock } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Page } from "@/components/shell/page";
import { ButtonLink } from "@/components/ui/button";
import { Pill, type Tone } from "@/components/ui/status";
import { cn } from "@/lib/cn";
import { STATUS_LABEL, type EligibleOfficer, type ObligationStatus } from "@/lib/evaluations";

export const STATUS_TONE: Record<ObligationStatus, Tone> = {
  upcoming: "quiet",
  not_started: "gold",
  draft: "info",
  submitted: "quiet",
  overdue: "red",
  excused: "quiet",
};

export function StatusPill({ status, late, className }: { status: ObligationStatus; late?: boolean; className?: string }) {
  return (
    <Pill tone={late && status === "submitted" ? "amber" : STATUS_TONE[status]} dotted={status === "submitted" && !late ? "green" : true} className={className}>
      {late && status === "submitted" ? "Submitted late" : STATUS_LABEL[status]}
    </Pill>
  );
}

export function Restricted({ title, body }: { title: string; body: string }) {
  return (
    <Page>
      <div className="mx-auto mt-10 max-w-md rounded-xl border border-line bg-surface p-8 text-center shadow-sm">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-obsidian text-gold">
          <Lock className="size-5" aria-hidden />
        </span>
        <h1 className="display mt-4 text-xl font-bold">{title}</h1>
        <p className="mt-2 text-xs text-muted">{body}</p>
        <ButtonLink href="/hq" variant="secondary" className="mt-5">
          Back to overview
        </ButtonLink>
      </div>
    </Page>
  );
}

/** Searchable officer combobox (WAI-ARIA combobox with a listbox popup). Officers on patrol that day are listed first. */
export function OfficerPicker({
  officers,
  onPick,
  disabled,
  excluded = [],
}: {
  officers: EligibleOfficer[];
  onPick: (o: EligibleOfficer) => void;
  disabled?: boolean;
  excluded?: string[];
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const results = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return officers
      .filter((o) => !excluded.includes(o.id))
      .filter((o) => !needle || o.name.toLowerCase().includes(needle) || (o.callsign ?? "").toLowerCase().includes(needle) || o.rank.toLowerCase().includes(needle))
      .slice(0, 8);
  }, [officers, q, excluded]);
  useEffect(() => setActive(0), [q]);

  const pick = (o: EligibleOfficer) => {
    onPick(o);
    setQ("");
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="relative">
      <label htmlFor={`${listId}-input`} className="sr-only">
        Add an officer by name or call sign
      </label>
      <input
        ref={inputRef}
        id={`${listId}-input`}
        role="combobox"
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && results[active] ? `${listId}-${results[active].id}` : undefined}
        autoComplete="off"
        disabled={disabled}
        value={q}
        placeholder="Add an officer: type a name or call sign"
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setOpen(true);
            setActive((a) => Math.min(a + 1, results.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && results[active]) {
            e.preventDefault();
            pick(results[active]);
          } else if (e.key === "Escape") setOpen(false);
        }}
        className="h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-muted hover:border-ink/25 focus:border-gold-ink focus:outline-none focus:ring-3 focus:ring-gold/25 disabled:opacity-50"
      />
      {open && results.length > 0 ? (
        <ul id={listId} role="listbox" aria-label="Eligible officers" className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-md border border-line bg-surface p-1 shadow-lg">
          {results.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${o.id}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => pick(o)}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer items-center gap-3 rounded px-3 py-2 text-xs", i === active ? "bg-sunken" : "")}
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate font-semibold text-ink">{o.name}</span>
                <span className="block truncate text-2xs text-muted">
                  {o.rank}
                  {o.callsign ? ` · ${o.callsign}` : ""}
                  {o.district ? ` · ${o.district}` : ""}
                </span>
              </span>
              {o.patrolled ? <Pill tone="gold">On patrol this day</Pill> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {open && q && results.length === 0 ? (
        <p role="status" className="absolute inset-x-0 top-full z-30 mt-1 rounded-md border border-line bg-surface px-3 py-2 text-2xs text-muted shadow-lg">
          No eligible officer matches “{q}”. Only active Corporals, Senior Officers, Officers, Reserve and Probationary Officers can be evaluated.
        </p>
      ) : null}
    </div>
  );
}

export function downloadCsv(filename: string, header: string[], rows: (string | number | boolean | null)[][]) {
  const esc = (v: string | number | boolean | null) => {
    const s = v === null ? "" : String(v);
    // Neutralize spreadsheet formulas in exported text.
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const csv = [header, ...rows].map((r) => r.map(esc).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
