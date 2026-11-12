"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ClipboardCheck, History, Pencil, ShieldAlert, Trash2 } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, Skeleton, toast } from "@/components/ui/feedback";
import { Input, Select, Textarea } from "@/components/ui/field";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { cn } from "@/lib/cn";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  JUSTIFICATION_MAX,
  REASON_MIN,
  errorMessage,
  evaluationsApi,
  formatInstant,
  formatPatrolDate,
  openDuties,
  relativeDue,
  useMyEvaluations,
  validateReport,
  type Award,
  type Category,
  type EligibleOfficer,
  type EntryDraft,
  type FieldError,
  type MyOverview,
  type ObligationRow,
  type ReportDetail,
} from "@/lib/evaluations";
import { useMe, useNow } from "@/lib/preview/hooks";
import { OfficerPicker, Restricted, StatusPill } from "./shared";

let keySeq = 0;
const newKey = () => `e${++keySeq}`;

/** The day the page opens on: the oldest open report, else today's, else the most recent. */
export function defaultDate(o: MyOverview): string | null {
  const open = openDuties(o).sort((a, b) => (a.patrolDate < b.patrolDate ? -1 : 1));
  if (open.length) return open[0].patrolDate;
  return o.rows.find((r) => r.patrolDate === o.today)?.patrolDate ?? o.rows.find((r) => r.status !== "upcoming")?.patrolDate ?? null;
}

export function DailyEvaluation() {
  const me = useMe();
  const allowed = !!me && can(me.actor, "evaluation.submit");
  const { data, error, reload } = useMyEvaluations(allowed);
  const [date, setDate] = useState<string | null>(null);

  useEffect(() => {
    if (data && (date === null || !data.rows.some((r) => r.patrolDate === date))) setDate(defaultDate(data));
  }, [data, date]);

  if (!me) return null;
  if (!allowed)
    return (
      <Restricted
        title="Daily evaluations are filed by Sergeants and Lieutenants"
        body={`Your rank is ${me.member.rank}. Command staff review evaluations and compliance from the Command Center.`}
      />
    );

  const row = data?.rows.find((r) => r.patrolDate === date) ?? null;

  return (
    <Page wide>
      <PageHeader
        eyebrow="Management"
        title="Daily patrol evaluation"
        description="One report for each patrol day you are assigned or patrol. Record officers who exceeded expectations, need improvement or deserve an award, or confirm there was nothing notable."
      />
      {error ? (
        <Callout tone="error" title="Your reporting status could not be loaded" action={<Button size="sm" variant="secondary" onClick={() => void reload()}>Retry</Button>}>
          {error}
        </Callout>
      ) : null}
      {!data && !error ? (
        <div role="status" aria-label="Loading your reports" className="space-y-3">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-64 rounded-lg" />
        </div>
      ) : null}
      {data ? (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
          <div className="min-w-0">
            {row ? (
              <ReportWorkspace key={`${row.patrolDate}:${row.version}`} overview={data} row={row} onSaved={reload} />
            ) : (
              <NoReportDue overview={data} />
            )}
          </div>
          <aside className="flex flex-col gap-5" aria-label="Reporting history and rules">
            <DutyList overview={data} selected={date} onSelect={setDate} />
            <RulesNote overview={data} />
          </aside>
        </div>
      ) : null}
    </Page>
  );
}

function NoReportDue({ overview }: { overview: MyOverview }) {
  const minutes = overview.todayMinutes;
  return (
    <Card>
      <EmptyState
        icon={<ClipboardCheck />}
        title="No report is due right now"
        body={
          minutes > 0
            ? `You have logged ${minutes} minutes of completed patrol today. A report opens automatically at ${overview.settings.minPatrolMinutes} minutes, or as soon as command assigns you a patrol day.`
            : `A report opens automatically on days command assigns you to patrol, or when you complete at least ${overview.settings.minPatrolMinutes} minutes of patrol. Nothing else needs to be set up.`
        }
      />
    </Card>
  );
}

function DutyList({ overview, selected, onSelect }: { overview: MyOverview; selected: string | null; onSelect: (d: string) => void }) {
  const rows = overview.rows.slice(0, 21);
  const open = openDuties(overview).length;
  return (
    <Card>
      <CardHeader title="Your patrol days" description={open ? `${open} open ${open === 1 ? "report" : "reports"}` : "Nothing open"} />
      {rows.length === 0 ? (
        <p className="border-t border-line px-4 py-4 text-2xs text-muted">No reporting days in the last 60 days.</p>
      ) : (
        <ul className="divide-y divide-line border-t border-line">
          {rows.map((r) => (
            <li key={r.obligationId}>
              <button
                type="button"
                onClick={() => onSelect(r.patrolDate)}
                aria-current={r.patrolDate === selected ? "true" : undefined}
                className={cn("flex w-full items-center gap-3 px-4 py-2.5 text-left text-xs hover:bg-surface-2", r.patrolDate === selected && "bg-sunken")}
              >
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">
                    {r.patrolDate === overview.today ? "Today · " : ""}
                    {formatPatrolDate(r.patrolDate)}
                  </span>
                  <span className="block text-3xs text-muted">{r.source === "assignment" ? "Assigned by command" : "From your patrol log"}</span>
                </span>
                <StatusPill status={r.status} late={r.late} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function RulesNote({ overview }: { overview: MyOverview }) {
  const s = overview.settings;
  const t = (hhmm: string) => formatInstant(Date.UTC(2026, 0, 5, Number(hhmm.slice(0, 2)), Number(hhmm.slice(3, 5))), "UTC", false).replace(" UTC", "");
  return (
    <section aria-labelledby="dpe-rules" className="rounded-lg border border-line p-4 text-2xs leading-relaxed text-muted">
      <h2 id="dpe-rules" className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-ink">
        How reporting works {s.interim ? <Pill tone="amber">Interim rules</Pill> : null}
      </h2>
      <ul className="list-disc space-y-1 pl-4">
        <li>A patrol day runs from {t(s.dayStart)} to {t(s.dayStart)} Tampa time ({s.timezone}).</li>
        <li>
          Reports are due by {t(s.deadlineTime)} {s.deadlineDayOffset === 1 ? "the following day" : `${s.deadlineDayOffset} days later`}. Late reports are still accepted and marked late.
        </li>
        <li>Days you are assigned always need a report. Without an assignment, {s.minPatrolMinutes}+ minutes of completed patrol creates one.</li>
        <li>Approved leave and command-excused days never count as missing.</li>
        <li>Evaluations are confidential: only you and command staff can read them. Nothing is posted to Discord.</li>
        <li>A “needs improvement” observation is not discipline. Formal discipline follows Handbook §13 and is never issued from this page.</li>
      </ul>
    </section>
  );
}

// ------------------------------------------------------------- the report

function ReportWorkspace({ overview, row, onSaved }: { overview: MyOverview; row: ObligationRow; onSaved: () => Promise<void> }) {
  const api = evaluationsApi();
  const [detail, setDetail] = useState<ReportDetail | null | undefined>(undefined);
  const [officers, setOfficers] = useState<EligibleOfficer[]>([]);
  const [awards, setAwards] = useState<Award[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [amending, setAmending] = useState(false);

  useEffect(() => {
    let alive = true;
    Promise.all([api.myReport(row.patrolDate), api.eligibleOfficers(row.patrolDate), api.awards()])
      .then(([d, o, a]) => {
        if (!alive) return;
        setDetail(d);
        setOfficers(o);
        setAwards(a.filter((x) => x.active));
      })
      .catch((e) => alive && setLoadError(errorMessage(e, "The report could not be loaded.")));
    return () => {
      alive = false;
    };
  }, [api, row.patrolDate]);

  const submitted = row.reportStatus === "submitted";
  return (
    <div className="flex flex-col gap-5">
      <ReportHeader overview={overview} row={row} />
      {loadError ? <Callout tone="error" title="The report could not be loaded">{loadError}</Callout> : null}
      {detail === undefined && !loadError ? <Skeleton className="h-64 rounded-lg" /> : null}
      {detail !== undefined && row.status === "upcoming" ? (
        <Callout tone="info" title="This patrol day has not started">
          You can file this report from {formatInstant(row.dayStart, overview.settings.timezone)}.
        </Callout>
      ) : null}
      {detail !== undefined && row.status !== "upcoming" && (!submitted || amending) ? (
        <ReportForm
          overview={overview}
          row={row}
          detail={detail}
          officers={officers}
          awards={awards}
          amending={amending}
          onCancelAmend={() => setAmending(false)}
          onSaved={async (d) => {
            setAmending(false);
            setDetail(d);
            await onSaved();
          }}
        />
      ) : null}
      {detail && submitted && !amending ? <SubmittedReport detail={detail} overview={overview} onAmend={() => setAmending(true)} /> : null}
    </div>
  );
}

function ReportHeader({ overview, row }: { overview: MyOverview; row: ObligationRow }) {
  const now = useNow(30_000) || overview.now;
  const tz = overview.settings.timezone;
  const s = overview.supervisor;
  const items: [string, string][] = [
    ["Date", formatPatrolDate(row.patrolDate, { weekday: "long", month: "long", day: "numeric", year: "numeric" })],
    ["Filing supervisor", `${s.rank} ${s.name}`],
    ["Call sign", s.callsign ?? "Not on the roster"],
  ];
  const showDue = row.status === "not_started" || row.status === "draft" || row.status === "overdue";
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={row.status} late={row.late} />
          <span className="text-2xs text-muted">{row.source === "assignment" ? "Assigned by command" : "Created from your patrol log"}</span>
          {row.excuseReason ? <span className="text-2xs text-muted">· {row.excuseReason}</span> : null}
        </div>
        {showDue ? (
          <p className={cn("text-2xs font-semibold", row.status === "overdue" ? "text-red" : "text-ink-2")}>
            {relativeDue(row.deadline, now)} · {formatInstant(row.deadline, tz)}
          </p>
        ) : row.submittedAt ? (
          <p className="text-2xs text-muted">Submitted {formatInstant(row.submittedAt, tz)}</p>
        ) : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-3 px-4 py-3.5 sm:grid-cols-3">
        {items.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-3xs font-medium text-muted">{k}</dt>
            <dd className="mt-0.5 truncate text-sm font-semibold text-ink">{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function toDrafts(d: ReportDetail | null): EntryDraft[] {
  return (d?.entries ?? []).map((e) => ({ key: newKey(), officerId: e.officer.id, category: e.category, justification: e.justification, awardId: e.awardId, awardText: e.awardText ?? "" }));
}

function ReportForm({
  overview,
  row,
  detail,
  officers,
  awards,
  amending,
  onCancelAmend,
  onSaved,
}: {
  overview: MyOverview;
  row: ObligationRow;
  detail: ReportDetail | null;
  officers: EligibleOfficer[];
  awards: Award[];
  amending: boolean;
  onCancelAmend: () => void;
  onSaved: (d: ReportDetail | null) => Promise<void>;
}) {
  const api = evaluationsApi();
  const [noObs, setNoObs] = useState(detail?.noObservations ?? false);
  const [entries, setEntries] = useState<EntryDraft[]>(() => toDrafts(detail));
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"draft" | "submit" | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [dirty, setDirty] = useState(0);
  const autosave = useRef<ReturnType<typeof setTimeout> | null>(null);
  const officerById = useMemo(() => new Map(officers.map((o) => [o.id, o])), [officers]);
  const nameOf = (id: string) => officerById.get(id) ?? detail?.entries.find((e) => e.officer.id === id)?.officer;

  // Edits made while a draft is saving must still be saved, so only the changes the save covered are cleared.
  const dirtyRef = useRef(0);
  dirtyRef.current = dirty;
  const touch = () => {
    setDirty((n) => n + 1);
    setErrors([]);
    setServerError(null);
  };
  const update = (key: string, patch: Partial<EntryDraft>) => {
    setEntries((es) => es.map((e) => (e.key === key ? { ...e, ...patch } : e)));
    touch();
  };
  const payload = useCallback(
    () =>
      entries.map((e) => ({
        officer_id: e.officerId,
        category: e.category,
        justification: e.justification.trim(),
        award_id: e.category === "award" ? e.awardId : null,
        award_text: e.category === "award" && !e.awardId ? e.awardText.trim() || null : null,
      })),
    [entries],
  );

  const save = useCallback(
    async (mode: "draft" | "submit") => {
      if (busy) return;
      if (autosave.current) clearTimeout(autosave.current);
      const final = mode === "submit";
      const v = validateReport({ noObservations: noObs, entries, supervisorId: overview.supervisor.id }, { final, eligible: (id) => officerById.has(id) || !!detail?.entries.some((e) => e.officer.id === id) });
      if (amending && reason.trim().length < REASON_MIN) v.push({ key: "report", field: "report", message: `Explain the amendment in at least ${REASON_MIN} characters.` });
      setErrors(v);
      if (v.length) {
        if (final) requestAnimationFrame(() => document.getElementById("dpe-errors")?.focus());
        return;
      }
      setBusy(mode);
      setServerError(null);
      const covered = dirtyRef.current;
      try {
        const res = await api.save(row.patrolDate, amending ? "amend" : mode, noObs, payload(), amending ? reason.trim() : undefined);
        if (final) {
          toast("success", amending ? "Amendment recorded" : "Report submitted", res.late ? "Recorded as a late submission." : `Version ${res.version} is on file.`);
          await onSaved(await api.myReport(row.patrolDate));
        } else {
          setSavedAt(Date.now());
          setDirty((n) => (n === covered ? 0 : n));
        }
      } catch (e) {
        setServerError(errorMessage(e));
        if (final) requestAnimationFrame(() => document.getElementById("dpe-errors")?.focus());
      } finally {
        setBusy(null);
      }
    },
    [busy, noObs, entries, overview.supervisor.id, officerById, detail, amending, reason, api, row.patrolDate, payload, onSaved],
  );

  // Autosave drafts a few seconds after the last change (never for amendments, which are recorded only on submit).
  useEffect(() => {
    if (!dirty || amending) return;
    autosave.current = setTimeout(() => void save("draft"), 4000);
    return () => {
      if (autosave.current) clearTimeout(autosave.current);
    };
  }, [dirty, amending, save]);

  const errFor = (key: string, field: FieldError["field"]) => errors.find((e) => e.key === key && e.field === field)?.message;
  const reportErrors = errors.filter((e) => e.key === "report").map((e) => e.message);
  const entryErrorCount = errors.filter((e) => e.key !== "report").length;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save("submit");
      }}
      className="flex flex-col gap-5"
      aria-label={amending ? "Amend daily patrol evaluation" : "Daily patrol evaluation"}
    >
      {amending ? (
        <Callout tone="warn" title="You are amending a submitted report">
          The original stays on file. Your amendment becomes a new version with the reason you give below.
        </Callout>
      ) : null}

      <label
        className={cn(
          "flex cursor-pointer items-start gap-3 rounded-lg border p-4 transition-colors",
          noObs ? "border-gold bg-gold-soft/60" : "border-line bg-surface hover:border-ink/25",
          entries.length > 0 && "cursor-not-allowed opacity-60",
        )}
      >
        <input
          type="checkbox"
          className="mt-0.5 size-5 shrink-0 accent-[var(--color-gold-ink)]"
          checked={noObs}
          disabled={entries.length > 0 || busy === "submit"}
          onChange={(e) => {
            setNoObs(e.target.checked);
            touch();
          }}
        />
        <span>
          <span className="block text-sm font-semibold text-ink">No notable observations</span>
          <span className="mt-0.5 block text-2xs text-muted">
            {entries.length > 0
              ? "Remove the officers below to use this option."
              : "I confirm that no officer needs to be recorded for this patrol day. Tick this, then submit."}
          </span>
        </span>
      </label>

      {!noObs ? (
        <Card>
          <CardHeader title="Officers" description="Add each officer with a notable observation. An officer can appear once per category." />
          <div className="flex flex-col gap-4 border-t border-line p-4">
            <OfficerPicker
              officers={officers}
              disabled={busy === "submit"}
              onPick={(o) => {
                setEntries((es) => [...es, { key: newKey(), officerId: o.id, category: "exceeding", justification: "", awardId: null, awardText: "" }]);
                touch();
                requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>(`[data-entry-last] textarea`)?.focus());
              }}
            />
            {entries.length === 0 ? (
              <p className="text-2xs text-muted">No officers added. If there is nothing notable, tick “No notable observations” above instead.</p>
            ) : (
              <ol className="flex flex-col gap-3">
                {entries.map((e, i) => {
                  const o = nameOf(e.officerId);
                  return (
                    <li key={e.key} data-entry-last={i === entries.length - 1 ? "" : undefined} className="rounded-lg border border-line bg-surface-2/40 p-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-ink">{o?.name ?? "Officer"}</p>
                          <p className="text-2xs text-muted">
                            {o?.rank}
                            {o?.callsign ? ` · ${o.callsign}` : ""}
                          </p>
                          {errFor(e.key, "officer") ? <p role="alert" className="mt-1 text-2xs font-medium text-red">{errFor(e.key, "officer")}</p> : null}
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          icon={<Trash2 className="size-4" />}
                          aria-label={`Remove ${o?.name ?? "officer"}`}
                          onClick={() => {
                            setEntries((es) => es.filter((x) => x.key !== e.key));
                            touch();
                          }}
                        >
                          <span className="hidden sm:inline">Remove</span>
                        </Button>
                      </div>
                      <fieldset className="mt-3">
                        <legend className="text-3xs font-medium text-muted">Category</legend>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {CATEGORIES.map((c) => (
                            <CategoryChoice key={c} name={`cat-${e.key}`} value={c} checked={e.category === c} onChange={() => update(e.key, { category: c })} />
                          ))}
                        </div>
                        {errFor(e.key, "category") ? <p role="alert" className="mt-1 text-2xs font-medium text-red">{errFor(e.key, "category")}</p> : null}
                      </fieldset>
                      {e.category === "award" ? (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {awards.length ? (
                            <label className="flex flex-col gap-1.5 text-xs font-semibold">
                              Recommended award
                              <Select
                                value={e.awardId ?? ""}
                                onChange={(ev) => update(e.key, { awardId: ev.target.value || null })}
                                aria-invalid={!!errFor(e.key, "award")}
                              >
                                <option value="">Other (name it)</option>
                                {awards.map((a) => (
                                  <option key={a.id} value={a.id}>
                                    {a.name}
                                  </option>
                                ))}
                              </Select>
                            </label>
                          ) : null}
                          {!e.awardId ? (
                            <label className="flex flex-col gap-1.5 text-xs font-semibold">
                              {awards.length ? "Award name" : "Recommended award"}
                              <Input
                                value={e.awardText}
                                maxLength={120}
                                placeholder="Name of the award or medal"
                                aria-invalid={!!errFor(e.key, "award")}
                                onChange={(ev) => update(e.key, { awardText: ev.target.value })}
                              />
                            </label>
                          ) : null}
                          {errFor(e.key, "award") ? <p role="alert" className="text-2xs font-medium text-red sm:col-span-2">{errFor(e.key, "award")}</p> : null}
                        </div>
                      ) : null}
                      <label className="mt-3 flex flex-col gap-1.5 text-xs font-semibold">
                        <span className="flex items-center justify-between">
                          Justification
                          <span className="text-3xs font-normal text-muted tabular">
                            {e.justification.trim().length}/{JUSTIFICATION_MAX}
                          </span>
                        </span>
                        <Textarea
                          rows={3}
                          maxLength={JUSTIFICATION_MAX}
                          value={e.justification}
                          aria-invalid={!!errFor(e.key, "justification")}
                          placeholder={e.category === "needs_improvement" ? "What happened and what support would help" : "What the officer did, where and why it stood out"}
                          onChange={(ev) => update(e.key, { justification: ev.target.value })}
                          className="min-h-20 font-normal"
                        />
                        {errFor(e.key, "justification") ? <span role="alert" className="text-2xs font-medium text-red">{errFor(e.key, "justification")}</span> : null}
                      </label>
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
        </Card>
      ) : null}

      {amending ? (
        <label className="flex flex-col gap-1.5 text-xs font-semibold">
          Reason for the amendment
          <Textarea rows={2} maxLength={1000} value={reason} onChange={(e) => (setReason(e.target.value), touch())} placeholder="What you corrected and why" className="font-normal" />
        </label>
      ) : null}

      <div
        id="dpe-errors"
        tabIndex={-1}
        role={reportErrors.length || serverError || entryErrorCount ? "alert" : undefined}
        className="outline-none empty:hidden"
      >
        {serverError ? <Callout tone="error" title="Not saved">{serverError}</Callout> : null}
        {!serverError && (reportErrors.length || entryErrorCount) ? (
          <Callout tone="error" title="Check the report before submitting">
            <ul className="list-disc pl-4">
              {reportErrors.map((m) => (
                <li key={m}>{m}</li>
              ))}
              {entryErrorCount ? <li>{entryErrorCount === 1 ? "One field needs attention." : `${entryErrorCount} fields need attention.`} They are marked above.</li> : null}
            </ul>
          </Callout>
        ) : null}
      </div>

      <div className="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 -mx-4 flex flex-wrap items-center justify-between gap-3 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:rounded-lg sm:border sm:bg-surface lg:bottom-0">
        <p className="text-2xs text-muted" aria-live="polite">
          {busy === "draft" ? "Saving draft…" : savedAt ? `Draft saved ${new Date(savedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}` : amending ? "Amendments are saved when you submit them." : "Drafts save automatically."}
        </p>
        <div className="flex gap-2">
          {amending ? (
            <Button type="button" variant="secondary" onClick={onCancelAmend} disabled={!!busy}>
              Cancel
            </Button>
          ) : (
            <Button type="button" variant="secondary" onClick={() => void save("draft")} disabled={!!busy} loading={busy === "draft"}>
              Save draft
            </Button>
          )}
          <Button type="submit" variant="gold" loading={busy === "submit"} disabled={!!busy}>
            {amending ? "Submit amendment" : "Submit report"}
          </Button>
        </div>
      </div>
    </form>
  );
}

function CategoryChoice({ name, value, checked, onChange }: { name: string; value: Category; checked: boolean; onChange: () => void }) {
  return (
    <label
      className={cn(
        "inline-flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-2xs font-medium transition-colors focus-within:ring-3 focus-within:ring-gold/25",
        checked
          ? value === "needs_improvement"
            ? "border-amber/50 bg-amber-soft text-amber"
            : value === "award"
              ? "border-gold/50 bg-gold-soft text-gold-ink"
              : "border-green/40 bg-green-soft text-green"
          : "border-line bg-surface text-ink-2 hover:border-ink/25",
      )}
    >
      <input type="radio" name={name} className="sr-only" checked={checked} onChange={onChange} />
      {CATEGORY_LABEL[value]}
    </label>
  );
}

function SubmittedReport({ detail, overview, onAmend }: { detail: ReportDetail; overview: MyOverview; onAmend: () => void }) {
  const tz = overview.settings.timezone;
  const windowEnds = (detail.firstSubmittedAt ?? 0) + overview.settings.amendWindowDays * 86_400_000;
  const canAmend = !!detail.reopenedAt || (!detail.reviewedAt && Date.now() < windowEnds);
  const grouped = CATEGORIES.map((c) => ({ c, items: detail.entries.filter((e) => e.category === c) })).filter((g) => g.items.length);
  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <CheckCircle2 className="size-5 text-green" aria-hidden />
            {detail.noObservations ? "Submitted: no notable observations" : `Submitted with ${detail.entries.length} ${detail.entries.length === 1 ? "observation" : "observations"}`}
          </p>
          {canAmend ? (
            <Button size="sm" variant="secondary" icon={<Pencil className="size-4" />} onClick={onAmend}>
              Amend report
            </Button>
          ) : (
            <p className="flex items-center gap-1.5 text-2xs text-muted">
              <ShieldAlert className="size-4" aria-hidden />
              {detail.reviewedAt ? "Reviewed by command. Ask command to reopen it to amend." : "The amendment window has closed. Ask command to reopen it."}
            </p>
          )}
        </div>
        {grouped.length ? (
          <div className="divide-y divide-line border-t border-line">
            {grouped.map((g) => (
              <section key={g.c} className="px-4 py-3">
                <h3 className="text-2xs font-semibold text-muted">{CATEGORY_LABEL[g.c]}</h3>
                <ul className="mt-2 flex flex-col gap-2.5">
                  {g.items.map((e) => (
                    <li key={e.id} className="text-xs">
                      <p className="font-semibold text-ink">
                        {e.officer.name}
                        {e.officer.callsign ? ` · ${e.officer.callsign}` : ""}
                        {e.award ? <span className="font-normal text-gold-ink"> · {e.award}</span> : null}
                      </p>
                      <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{e.justification}</p>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ) : null}
      </Card>
      {detail.versions.length ? (
        <Card>
          <CardHeader title={<span className="flex items-center gap-2"><History className="size-4" aria-hidden /> Version history</span>} description="Every submission and amendment is kept." />
          <ol className="divide-y divide-line border-t border-line">
            {[...detail.versions].reverse().map((v) => (
              <li key={v.version} className="px-4 py-2.5 text-2xs">
                <p className="font-semibold text-ink">
                  Version {v.version} · {v.kind === "amended" ? "Amended" : "Submitted"} {formatInstant(v.at, tz)}
                </p>
                <p className="text-muted">
                  {v.content.no_observations ? "No notable observations" : v.content.entries.map((e) => `${e.officer_name} (${CATEGORY_SHORT[e.category]})`).join(", ")}
                  {v.reason ? ` · Reason: ${v.reason}` : ""}
                </p>
              </li>
            ))}
          </ol>
        </Card>
      ) : null}
    </div>
  );
}
