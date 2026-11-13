"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown, Columns3, MoreHorizontal } from "lucide-react";
import { cn } from "@/lib/cn";
import { IconButton } from "./button";
import { MenuLabel, Popover } from "./menu";

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Sort value. Columns without one are not sortable. */
  sort?: (row: T) => string | number;
  /** Plain-text value for CSV export. Defaults to the sort value. */
  text?: (row: T) => string;
  align?: "right";
  className?: string;
  /** Can the viewer hide this column? The first column never hides. */
  hideable?: boolean;
  defaultHidden?: boolean;
  /**
   * Secondary detail that drops out below a viewport width so the table fits
   * its card instead of scrolling sideways. The first column always shows.
   * "wide" is 1400 px: a 1440 px laptop with the sidebar open.
   */
  hideBelow?: "sm" | "lg" | "xl" | "wide";
}

const HIDE_BELOW = {
  sm: "hidden sm:table-cell",
  lg: "hidden lg:table-cell",
  xl: "hidden xl:table-cell",
  wide: "hidden min-[1400px]:table-cell",
} as const;

export type SortState = { key: string; dir: "asc" | "desc" } | null;

/**
 * Dense table: sortable headers, column visibility, row selection, row
 * menus, sticky header and client pagination. Filtering stays with the caller
 * so filter controls can live in a toolbar and in saved views.
 */
export function DataTable<T>({
  label,
  rows,
  columns,
  rowKey,
  selected,
  onSelectedChange,
  onRowClick,
  activeKey,
  rowMenu,
  pageSize = 10,
  initialSort = null,
  empty,
  toolbar,
  storageKey,
}: {
  label: string;
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  selected?: Set<string>;
  onSelectedChange?: (next: Set<string>) => void;
  onRowClick?: (row: T) => void;
  activeKey?: string | null;
  rowMenu?: (row: T, close: () => void) => ReactNode;
  pageSize?: number;
  initialSort?: SortState;
  empty?: ReactNode;
  toolbar?: ReactNode;
  /** Persists hidden columns per viewer. */
  storageKey?: string;
}) {
  const [sort, setSort] = useState<SortState>(initialSort);
  const [page, setPage] = useState(0);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set(columns.filter((c) => c.defaultHidden).map((c) => c.key)));

  useEffect(() => {
    if (!storageKey) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) setHidden(new Set(JSON.parse(raw) as string[]));
    } catch {}
  }, [storageKey]);

  function toggleColumn(key: string) {
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      if (storageKey) {
        try {
          localStorage.setItem(storageKey, JSON.stringify([...next]));
        } catch {}
      }
      return next;
    });
  }

  const visible = columns.filter((c, i) => i === 0 || !hidden.has(c.key));

  const sorted = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    if (!col?.sort) return rows;
    const get = col.sort;
    return [...rows].sort((a, b) => {
      const x = get(a);
      const y = get(b);
      const r = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.dir === "asc" ? r : -r;
    });
  }, [rows, sort, columns]);

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * pageSize, current * pageSize + pageSize);

  useEffect(() => setPage(0), [rows.length]);

  const selectable = !!selected && !!onSelectedChange;
  const pageKeys = shown.map(rowKey);
  const allOnPage = selectable && pageKeys.length > 0 && pageKeys.every((k) => selected!.has(k));
  const someOnPage = selectable && pageKeys.some((k) => selected!.has(k));

  return (
    <div className="flex min-w-0 flex-col">
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5">
        {toolbar}
        <div className="ml-auto">
          <Popover
            label="Columns"
            className="w-52"
            trigger={({ open, toggle, id }) => (
              <button
                type="button"
                data-popover-trigger
                onClick={toggle}
                aria-expanded={open}
                aria-controls={open ? id : undefined}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-line-strong bg-surface px-2.5 text-2xs font-medium text-ink-2 shadow-sm hover:bg-surface-2"
              >
                <Columns3 className="size-3.5" aria-hidden /> Columns
              </button>
            )}
          >
            {() => (
              <>
                <MenuLabel>Show columns</MenuLabel>
                {columns.slice(1).map((c) => (
                  <label key={c.key} className="flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-1.5 text-xs hover:bg-sunken">
                    <input type="checkbox" checked={!hidden.has(c.key)} onChange={() => toggleColumn(c.key)} className="size-3.5 accent-[var(--gold-ink)]" />
                    {c.header}
                  </label>
                ))}
              </>
            )}
          </Popover>
        </div>
      </div>

      <div className="scrollbar-thin max-h-[560px] overflow-auto border-t border-line">
        <table aria-label={label} className="w-full border-separate border-spacing-0 text-left text-xs whitespace-nowrap">
          <thead className="sticky top-0 z-10 bg-surface-2/95 backdrop-blur">
            <tr>
              {selectable ? (
                <th scope="col" className="w-10 border-b border-line py-2 pr-1 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all rows on this page"
                    checked={allOnPage}
                    ref={(el) => {
                      if (el) el.indeterminate = !allOnPage && someOnPage;
                    }}
                    onChange={() => {
                      const next = new Set(selected);
                      if (allOnPage) pageKeys.forEach((k) => next.delete(k));
                      else pageKeys.forEach((k) => next.add(k));
                      onSelectedChange!(next);
                    }}
                    className="size-3.5 accent-[var(--gold-ink)]"
                  />
                </th>
              ) : null}
              {visible.map((c, i) => {
                const active = sort?.key === c.key;
                return (
                  <th
                    key={c.key}
                    scope="col"
                    aria-sort={active ? (sort!.dir === "asc" ? "ascending" : "descending") : undefined}
                    className={cn("border-b border-line py-2 text-3xs font-semibold whitespace-nowrap text-muted", i === 0 && !selectable ? "pl-4" : "pl-3", c.align === "right" ? "pr-3 text-right" : "pr-2", c.hideBelow && HIDE_BELOW[c.hideBelow])}
                  >
                    {c.sort ? (
                      <button
                        type="button"
                        onClick={() => setSort(active ? (sort!.dir === "asc" ? { key: c.key, dir: "desc" } : null) : { key: c.key, dir: "asc" })}
                        className={cn("inline-flex items-center gap-1 rounded hover:text-ink", active && "text-ink")}
                      >
                        {c.header}
                        {active ? sort!.dir === "asc" ? <ArrowUp className="size-3" aria-hidden /> : <ArrowDown className="size-3" aria-hidden /> : <ChevronsUpDown className="size-3 opacity-40" aria-hidden />}
                      </button>
                    ) : (
                      c.header
                    )}
                  </th>
                );
              })}
              {rowMenu ? (
                <th scope="col" className="w-10 border-b border-line pr-3">
                  <span className="sr-only">Row actions</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 ? (
              <tr>
                <td colSpan={visible.length + (selectable ? 1 : 0) + (rowMenu ? 1 : 0)} className="whitespace-normal">
                  {empty}
                </td>
              </tr>
            ) : (
              shown.map((row) => {
                const k = rowKey(row);
                const isActive = activeKey === k;
                const isSelected = selected?.has(k);
                return (
                  <tr
                    key={k}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={cn(
                      "group transition-colors",
                      onRowClick && "cursor-pointer",
                      isActive ? "bg-gold-soft/70" : isSelected ? "bg-surface-2" : "hover:bg-surface-2",
                    )}
                  >
                    {selectable ? (
                      <td className={cn("border-b border-line py-2.5 pr-1 pl-4", isActive && "shadow-[inset_3px_0_0_var(--gold)]")} onClick={(e) => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Select ${k}`}
                          checked={!!isSelected}
                          onChange={() => {
                            const next = new Set(selected);
                            if (next.has(k)) next.delete(k);
                            else next.add(k);
                            onSelectedChange!(next);
                          }}
                          className="size-3.5 accent-[var(--gold-ink)]"
                        />
                      </td>
                    ) : null}
                    {visible.map((c, i) => (
                      <td key={c.key} className={cn("border-b border-line py-2.5 align-middle", i === 0 && !selectable ? "pl-4" : "pl-3", c.align === "right" ? "pr-3 text-right tabular" : "pr-2", c.hideBelow && HIDE_BELOW[c.hideBelow], c.className)}>
                        {i === 0 && onRowClick ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onRowClick(row);
                            }}
                            className="text-left outline-none focus-visible:underline"
                          >
                            {c.cell(row)}
                          </button>
                        ) : (
                          c.cell(row)
                        )}
                      </td>
                    ))}
                    {rowMenu ? (
                      <td className="border-b border-line pr-3 text-right" onClick={(e) => e.stopPropagation()}>
                        <Popover
                          label={`Actions for ${k}`}
                          className="w-52"
                          trigger={({ open, toggle, id }) => (
                            <IconButton label={`Actions for ${k}`} size="sm" data-popover-trigger aria-expanded={open} aria-controls={open ? id : undefined} onClick={toggle} className="opacity-60 group-hover:opacity-100 focus:opacity-100">
                              <MoreHorizontal />
                            </IconButton>
                          )}
                        >
                          {(close) => rowMenu(row, close)}
                        </Popover>
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-3xs text-muted">
        <span className="tabular">
          {sorted.length === 0 ? "0 results" : `${current * pageSize + 1}–${Math.min(sorted.length, (current + 1) * pageSize)} of ${sorted.length}`}
          {selected?.size ? ` · ${selected.size} selected` : ""}
        </span>
        <span className="flex items-center gap-1">
          <IconButton label="Previous page" size="sm" disabled={current === 0} onClick={() => setPage(current - 1)}>
            <ChevronLeft />
          </IconButton>
          <span className="tabular">
            {current + 1} / {pages}
          </span>
          <IconButton label="Next page" size="sm" disabled={current >= pages - 1} onClick={() => setPage(current + 1)}>
            <ChevronRight />
          </IconButton>
        </span>
      </div>
    </div>
  );
}

/** Downloads rows as CSV using each visible column's text value. */
export function exportCsv<T>(filename: string, rows: T[], columns: Column<T>[]) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const header = columns.map((c) => esc(c.header)).join(",");
  const body = rows.map((r) => columns.map((c) => esc(c.text ? c.text(r) : c.sort ? String(c.sort(r)) : "")).join(",")).join("\n");
  const blob = new Blob([`${header}\n${body}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
