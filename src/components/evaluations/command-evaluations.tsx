"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Award as AwardIcon, CalendarPlus, Download, FileSearch, RefreshCw } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Callout, EmptyState, Skeleton, toast } from "@/components/ui/feedback";
import { Input, SearchField, Select, Textarea } from "@/components/ui/field";
import { MenuItem } from "@/components/ui/menu";
import { Dialog, Sheet } from "@/components/ui/overlay";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader, Stat } from "@/components/ui/surface";
import { Tabs } from "@/components/ui/tabs";
import { can } from "@/lib/authz";
import {
  CATEGORIES,
  CATEGORY_LABEL,
  CATEGORY_SHORT,
  DEFAULT_SETTINGS,
  REASON_MIN,
  STATUS_LABEL,
  addDays,
  errorMessage,
  evaluationsApi,
  formatInstant,
  formatPatrolDate,
  patrolDate,
  type Award,
  type Category,
  type Excusal,
  type ObligationRow,
  type PersonRef,
  type Report,
  type ReportDetail,
  type ReviewDecision,
  type ReviewStage,
} from "@/lib/evaluations";
import { useMe } from "@/lib/preview/hooks";
import { Restricted, StatusPill, downloadCsv } from "./shared";

type Tab = "compliance" | "review" | "awards";
const TZ = DEFAULT_SETTINGS.timezone;
const fmt = (ms: number | null) => (ms ? formatInstant(ms, TZ) : "—");

export function CommandEvaluations() {
  const me = useMe();
  const [tab, setTab] = useState<Tab>("compliance");
  const today = patrolDate(Date.now());
  const [from, setFrom] = useState(addDays(today, -13));
  const [to, setTo] = useState(today);
  if (!me) return null;
  if (!can(me.actor, "evaluation.review"))
    return <Restricted title="Evaluation review is restricted" body={`Command staff (Captain and above, interim) review daily evaluations. Your rank is ${me.member.rank}.`} />;
  const awardAuthority = can(me.actor, "evaluation.award_final");

  return (
    <Page wide>
      <PageHeader
        eyebrow="Command Center"
        title="Daily evaluations"
        description="Reporting compliance, submitted evaluations and award recommendations. Observations are routine records, not disciplinary findings."
        actions={
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-3xs font-medium text-muted">
              From
              <Input type="date" value={from} max={to} onChange={(e) => e.target.value && setFrom(e.target.value)} className="h-8 w-[150px] text-xs" />
            </label>
            <label className="flex flex-col gap-1 text-3xs font-medium text-muted">
              To
              <Input type="date" value={to} min={from} onChange={(e) => e.target.value && setTo(e.target.value)} className="h-8 w-[150px] text-xs" />
            </label>
          </div>
        }
      />
      <Tabs<Tab>
        label="Evaluation workspace"
        value={tab}
        onChange={setTab}
        items={[
          { value: "compliance", label: "Compliance" },
          { value: "review", label: "Review" },
          { value: "awards", label: "Awards and rules" },
        ]}
        className="mb-5"
      />
      {tab === "compliance" ? <Compliance from={from} to={to} selfId={me.member.id} /> : null}
      {tab === "review" ? <ReviewWorkspace from={from} to={to} selfId={me.member.id} awardAuthority={awardAuthority} selfName={me.member.name} /> : null}
      {tab === "awards" ? <AwardsAndRules /> : null}
    </Page>
  );
}

// -------------------------------------------------------------- compliance

function Compliance({ from, to, selfId }: { from: string; to: string; selfId: string }) {
  const api = evaluationsApi();
  const [rows, setRows] = useState<ObligationRow[] | null>(null);
  const [excusals, setExcusals] = useState<Excusal[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("all");
  const [dialog, setDialog] = useState<null | { kind: "excuse"; row: ObligationRow } | { kind: "revoke"; row: ObligationRow; excusal: Excusal } | { kind: "assign" }>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [c, x] = await Promise.all([api.compliance(from, to), api.excusals(from, to)]);
      setRows(c.rows);
      setExcusals(x);
    } catch (e) {
      setError(errorMessage(e, "Compliance could not be loaded."));
    }
  }, [api, from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const counted = (rows ?? []).filter((r) => r.status !== "upcoming");
  const n = (f: (r: ObligationRow) => boolean) => counted.filter(f).length;
  const required = n((r) => r.status !== "excused");
  const submitted = n((r) => r.status === "submitted");
  const onTime = n((r) => r.status === "submitted" && !r.late);
  const overdue = n((r) => r.status === "overdue");
  const pending = n((r) => r.status === "not_started" || r.status === "draft");
  const excused = n((r) => r.status === "excused");
  const shown = (rows ?? []).filter((r) => status === "all" || (status === "late" ? r.late : r.status === status));

  const bySupervisor = useMemo(() => {
    const m = new Map<string, { who: PersonRef; required: number; onTime: number; late: number; missing: number; excused: number }>();
    for (const r of counted) {
      const s = m.get(r.supervisor.id) ?? { who: r.supervisor, required: 0, onTime: 0, late: 0, missing: 0, excused: 0 };
      if (r.status === "excused") s.excused++;
      else {
        s.required++;
        if (r.status === "submitted") {
          if (r.late) s.late++;
          else s.onTime++;
        }
        if (r.status === "overdue") s.missing++;
      }
      m.set(r.supervisor.id, s);
    }
    return [...m.values()].sort((a, b) => b.missing - a.missing || a.who.name.localeCompare(b.who.name));
  }, [counted]);

  const columns: Column<ObligationRow>[] = [
    { key: "date", header: "Patrol day", cell: (r) => <span className="font-semibold">{formatPatrolDate(r.patrolDate)}</span>, sort: (r) => r.patrolDate, text: (r) => r.patrolDate },
    {
      key: "who",
      header: "Supervisor",
      cell: (r) => (
        <span>
          {r.supervisor.rank} {r.supervisor.name}
          <span className="text-muted"> · {r.supervisor.callsign ?? "—"}</span>
        </span>
      ),
      sort: (r) => r.supervisor.name,
      text: (r) => `${r.supervisor.rank} ${r.supervisor.name}`,
    },
    { key: "status", header: "Status", cell: (r) => <StatusPill status={r.status} late={r.late} />, sort: (r) => r.status, text: (r) => (r.late ? "Submitted late" : STATUS_LABEL[r.status]) },
    { key: "basis", header: "Basis", cell: (r) => <span className="text-muted">{r.source === "assignment" ? "Assignment" : "Patrol log"}</span>, sort: (r) => r.source, hideable: true },
    { key: "due", header: "Deadline", cell: (r) => <span className="text-muted">{fmt(r.deadline)}</span>, sort: (r) => r.deadline, text: (r) => new Date(r.deadline).toISOString(), hideable: true },
    { key: "submitted", header: "Submitted", cell: (r) => (r.submittedAt ? fmt(r.submittedAt) : <span className="text-muted">{r.excuseReason ?? "—"}</span>), sort: (r) => r.submittedAt ?? 0, text: (r) => (r.submittedAt ? new Date(r.submittedAt).toISOString() : r.excuseReason ?? "") },
  ];

  return (
    <div className="flex flex-col gap-5">
      {error ? <Callout tone="error" title="Compliance could not be loaded">{error}</Callout> : null}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Reports required" value={rows ? required : "…"} sub="Excused days excluded" />
          <Stat label="Submitted" value={rows ? submitted : "…"} sub={rows && required ? `${Math.round((submitted / required) * 100)}% of required` : undefined} tone="good" />
          <Stat label="On time" value={rows ? onTime : "…"} />
          <Stat label="Overdue" value={rows ? overdue : "…"} tone={overdue ? "warn" : "default"} sub="Past the deadline, not submitted" />
          <Stat label="Still open" value={rows ? pending : "…"} sub="Before the deadline" />
          <Stat label="Excused" value={rows ? excused : "…"} sub="Leave or command excusal" />
        </div>
      </Card>

      {rows === null && !error ? <Skeleton className="h-72 rounded-lg" /> : null}
      {rows ? (
        <DataTable
          label="Reporting obligations"
          rows={shown}
          columns={columns}
          rowKey={(r) => r.obligationId}
          pageSize={15}
          initialSort={{ key: "date", dir: "desc" }}
          storageKey="tpd-dpe-compliance"
          toolbar={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
                <option value="all">All statuses</option>
                <option value="overdue">Overdue</option>
                <option value="not_started">Not started</option>
                <option value="draft">Draft</option>
                <option value="submitted">Submitted</option>
                <option value="late">Submitted late</option>
                <option value="excused">Excused</option>
                <option value="upcoming">Upcoming</option>
              </Select>
              <Button size="sm" variant="secondary" icon={<CalendarPlus className="size-4" />} onClick={() => setDialog({ kind: "assign" })}>
                Assign patrol days
              </Button>
              <Button size="sm" variant="ghost" icon={<RefreshCw className="size-4" />} onClick={() => void load()} aria-label="Refresh compliance">
                <span className="sr-only sm:not-sr-only">Refresh</span>
              </Button>
            </div>
          }
          rowMenu={(r, close) => {
            const x = excusals.find((e) => e.supervisorId === r.supervisor.id && e.patrolDate === r.patrolDate);
            if (r.status === "submitted") return <p className="px-3 py-2 text-2xs text-muted">Submitted reports are reviewed in the Review tab.</p>;
            if (x)
              return (
                <MenuItem onSelect={() => (close(), setDialog({ kind: "revoke", row: r, excusal: x }))}>
                  Revoke excusal
                </MenuItem>
              );
            if (r.excuseReason) return <p className="px-3 py-2 text-2xs text-muted">Excused by approved leave of absence.</p>;
            if (r.supervisor.id === selfId) return <p className="px-3 py-2 text-2xs text-muted">You cannot excuse your own report.</p>;
            return (
              <MenuItem onSelect={() => (close(), setDialog({ kind: "excuse", row: r }))}>
                Excuse this day…
              </MenuItem>
            );
          }}
          empty={<EmptyState icon={<FileSearch />} title="No reporting days in this range" body="Obligations appear when command assigns a patrol day or a supervisor completes a qualifying patrol." />}
        />
      ) : null}

      {rows && bySupervisor.length ? (
        <Card>
          <CardHeader title="By supervisor" description="Historical compliance for the selected range. Missing reports are shown for follow-up, never as automatic discipline." />
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[560px] text-xs">
              <thead>
                <tr className="text-left text-3xs text-muted">
                  <th scope="col" className="px-4 py-2 font-medium">Supervisor</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Required</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">On time</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Late</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Overdue</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Excused</th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">Compliance</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {bySupervisor.map((s) => (
                  <tr key={s.who.id}>
                    <th scope="row" className="px-4 py-2.5 text-left font-semibold">
                      {s.who.rank} {s.who.name} <span className="font-normal text-muted">· {s.who.callsign ?? "—"}</span>
                    </th>
                    <td className="px-4 py-2.5 text-right tabular">{s.required}</td>
                    <td className="px-4 py-2.5 text-right tabular">{s.onTime}</td>
                    <td className="px-4 py-2.5 text-right tabular">{s.late}</td>
                    <td className={`px-4 py-2.5 text-right tabular ${s.missing ? "font-semibold text-red" : ""}`}>{s.missing}</td>
                    <td className="px-4 py-2.5 text-right tabular">{s.excused}</td>
                    <td className="px-4 py-2.5 text-right tabular">{s.required ? `${Math.round(((s.onTime + s.late) / s.required) * 100)}%` : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      {dialog?.kind === "excuse" || dialog?.kind === "revoke" ? (
        <ReasonDialog
          title={dialog.kind === "excuse" ? "Excuse this reporting day" : "Revoke the excusal"}
          description={`${dialog.row.supervisor.rank} ${dialog.row.supervisor.name} · ${formatPatrolDate(dialog.row.patrolDate)}`}
          confirm={dialog.kind === "excuse" ? "Excuse day" : "Revoke excusal"}
          hint={dialog.kind === "excuse" ? "The reason is recorded with your name. The day will not count as missing." : "The day counts again from now on."}
          onClose={() => setDialog(null)}
          onConfirm={async (reason) => {
            if (dialog.kind === "excuse") await api.excuse(dialog.row.supervisor.id, dialog.row.patrolDate, reason);
            else await api.revokeExcusal(dialog.excusal.id, reason);
            toast("success", dialog.kind === "excuse" ? "Day excused" : "Excusal revoked");
            await load();
          }}
        />
      ) : null}
      {dialog?.kind === "assign" ? <AssignDialog onClose={() => setDialog(null)} onDone={load} /> : null}
    </div>
  );
}

function ReasonDialog({
  title,
  description,
  confirm,
  hint,
  onClose,
  onConfirm,
  tone = "gold",
}: {
  title: string;
  description: string;
  confirm: string;
  hint: string;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
  tone?: "gold" | "danger";
}) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const short = reason.trim().length < REASON_MIN;
  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant={tone === "danger" ? "danger" : "gold"}
            loading={busy}
            disabled={busy || short}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                await onConfirm(reason.trim());
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirm}
          </Button>
        </>
      }
    >
      <label className="flex flex-col gap-1.5 text-xs font-semibold">
        Reason
        <Textarea rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} className="font-normal" aria-describedby="reason-hint" />
      </label>
      <p id="reason-hint" className="mt-1.5 text-2xs text-muted">
        {hint} At least {REASON_MIN} characters.
      </p>
      {error ? <p role="alert" className="mt-2 text-2xs font-medium text-red">{error}</p> : null}
    </Dialog>
  );
}

function AssignDialog({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const api = evaluationsApi();
  const today = patrolDate(Date.now());
  const [people, setPeople] = useState<PersonRef[]>([]);
  const [who, setWho] = useState("");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.supervisors().then(setPeople, (e) => setError(errorMessage(e)));
  }, [api]);
  const dates = useMemo(() => {
    const out: string[] = [];
    for (let d = start; d <= end && out.length <= 62; d = addDays(d, 1)) out.push(d);
    return out;
  }, [start, end]);
  return (
    <Dialog
      open
      onClose={onClose}
      title="Assign patrol days"
      description="Assigned days always require a daily evaluation, even if the supervisor logs no patrol."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button
            variant="gold"
            loading={busy}
            disabled={busy || !who || !dates.length || dates.length > 62}
            onClick={async () => {
              setBusy(true);
              setError(null);
              try {
                const n = await api.assign(who, dates, note.trim());
                toast("success", `${n} patrol ${n === 1 ? "day" : "days"} assigned`);
                await onDone();
                onClose();
              } catch (e) {
                setError(errorMessage(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Assign {dates.length} {dates.length === 1 ? "day" : "days"}
          </Button>
        </>
      }
    >
      <div className="grid gap-3">
        <label className="flex flex-col gap-1.5 text-xs font-semibold">
          Supervisor
          <Select value={who} onChange={(e) => setWho(e.target.value)}>
            <option value="">Choose a Sergeant or Lieutenant</option>
            {people.map((p) => (
              <option key={p.id} value={p.id}>
                {p.rank} {p.name} · {p.callsign ?? "—"}
              </option>
            ))}
          </Select>
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            First day
            <Input type="date" value={start} onChange={(e) => e.target.value && setStart(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-semibold">
            Last day
            <Input type="date" value={end} min={start} onChange={(e) => e.target.value && setEnd(e.target.value)} />
          </label>
        </div>
        <label className="flex flex-col gap-1.5 text-xs font-semibold">
          Note (optional)
          <Input value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="For example: North District evening coverage" />
        </label>
        {dates.length > 62 ? <p className="text-2xs text-red">Choose 62 days or fewer.</p> : null}
        {error ? <p role="alert" className="text-2xs font-medium text-red">{error}</p> : null}
      </div>
    </Dialog>
  );
}

// ----------------------------------------------------------------- review

const DECISION_LABEL: Record<ReviewDecision, string> = {
  reviewed: "Marked reviewed",
  noted: "Noted",
  referred: "Referred to chain of command",
  endorsed: "Endorsed",
  declined: "Declined",
  approved: "Approved",
  reopened: "Reopened for amendment",
};

function ReviewWorkspace({ from, to, selfId, selfName, awardAuthority }: { from: string; to: string; selfId: string; selfName: string; awardAuthority: boolean }) {
  const api = evaluationsApi();
  const [reports, setReports] = useState<Report[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [who, setWho] = useState("all");
  const [officer, setOfficer] = useState("");
  const [category, setCategory] = useState<"all" | Category | "none">("all");
  const [review, setReview] = useState<"all" | "unreviewed" | "reviewed">("all");
  const [open, setOpen] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      setReports(await api.reports({ from, to }));
    } catch (e) {
      setError(errorMessage(e, "Reports could not be loaded."));
    }
  }, [api, from, to]);
  useEffect(() => {
    void load();
  }, [load]);

  const supervisors = useMemo(() => [...new Map((reports ?? []).map((r) => [r.supervisorId, r.author])).values()].sort((a, b) => a.name.localeCompare(b.name)), [reports]);
  const needle = officer.trim().toLowerCase();
  const shown = (reports ?? []).filter(
    (r) =>
      (who === "all" || r.supervisorId === who) &&
      (review === "all" || (review === "reviewed" ? !!r.reviewedAt : !r.reviewedAt)) &&
      (category === "all" || (category === "none" ? r.noObservations : r.entries.some((e) => e.category === category))) &&
      (!needle || r.entries.some((e) => e.officer.name.toLowerCase().includes(needle) || (e.officer.callsign ?? "").toLowerCase().includes(needle))),
  );
  const awards = (reports ?? []).flatMap((r) => r.entries.filter((e) => e.category === "award").map((e) => ({ r, e })));
  const concerns = (reports ?? []).reduce((n, r) => n + r.entries.filter((e) => e.category === "needs_improvement").length, 0);

  async function exportCsv() {
    setExporting(true);
    try {
      const rows = await api.exportRows(from, to);
      downloadCsv(
        `tpd-daily-evaluations-${from}-to-${to}.csv`,
        ["Date", "Filing supervisor", "Call sign", "Submitted", "Late", "Version", "No notable observations", "Category", "Officer", "Officer call sign", "Officer rank", "Recommended award", "Justification"],
        rows.map((x) => [x.patrol_date, x.supervisor, x.callsign, x.submitted_at, x.late, x.version, x.no_observations, x.category ? CATEGORY_LABEL[x.category] : "", x.officer, x.officer_callsign, x.officer_rank, x.award, x.justification]),
      );
      toast("success", "Export downloaded", "The export was recorded in the audit log.");
    } catch (e) {
      toast("error", "Export failed", errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      {error ? <Callout tone="error" title="Reports could not be loaded">{error}</Callout> : null}
      <Card className="p-4">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          <Stat label="Submitted reports" value={reports ? reports.length : "…"} />
          <Stat label="Awaiting review" value={reports ? reports.filter((r) => !r.reviewedAt).length : "…"} />
          <Stat label="Performance concerns" value={reports ? concerns : "…"} sub="Routine observations, not findings" />
          <Stat label="Award recommendations" value={reports ? awards.length : "…"} />
        </div>
      </Card>
      <div className="flex flex-wrap items-center gap-2" role="search" aria-label="Filter reports">
        <Select value={who} onChange={(e) => setWho(e.target.value)} aria-label="Filter by supervisor">
          <option value="all">All supervisors</option>
          {supervisors.map((s) => (
            <option key={s.id} value={s.id}>
              {s.rank} {s.name}
            </option>
          ))}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value as typeof category)} aria-label="Filter by category">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
          <option value="none">No notable observations</option>
        </Select>
        <Select value={review} onChange={(e) => setReview(e.target.value as typeof review)} aria-label="Filter by review status">
          <option value="all">Any review status</option>
          <option value="unreviewed">Awaiting review</option>
          <option value="reviewed">Reviewed</option>
        </Select>
        <SearchField label="Filter by officer" placeholder="Officer name or call sign" value={officer} onChange={(e) => setOfficer(e.target.value)} className="w-full sm:w-64" />
        <Button size="sm" variant="secondary" icon={<Download className="size-4" />} loading={exporting} onClick={() => void exportCsv()} className="sm:ml-auto">
          Export CSV
        </Button>
      </div>
      {reports === null && !error ? <Skeleton className="h-72 rounded-lg" /> : null}
      {reports && shown.length === 0 ? (
        <Card>
          <EmptyState icon={<FileSearch />} title="No reports match" body="Change the date range or filters." />
        </Card>
      ) : null}
      {shown.length ? (
        <Card>
          <ul className="divide-y divide-line">
            {shown.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => setOpen(r.id)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-3 text-left hover:bg-surface-2">
                  <span className="w-28 shrink-0 text-xs font-semibold">{formatPatrolDate(r.patrolDate)}</span>
                  <span className="min-w-0 flex-1 text-xs">
                    {r.author.rank} {r.author.name} <span className="text-muted">· {r.author.callsign ?? "—"}</span>
                    <span className="mt-0.5 block text-2xs text-muted">
                      {r.noObservations ? "No notable observations" : r.entries.map((e) => `${e.officer.name} (${CATEGORY_SHORT[e.category]})`).join(", ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {r.late ? <Pill tone="amber">Late</Pill> : null}
                    {r.version > 1 ? <Pill tone="info">Amended</Pill> : null}
                    {r.entries.some((e) => e.category === "award") ? <Pill tone="gold">Award</Pill> : null}
                    {r.reviewedAt ? <Pill tone="green">Reviewed</Pill> : <Pill>Awaiting review</Pill>}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
      {open ? (
        <ReportSheet
          reportId={open}
          selfId={selfId}
          selfName={selfName}
          awardAuthority={awardAuthority}
          onClose={() => setOpen(null)}
          onChanged={load}
        />
      ) : null}
    </div>
  );
}

function ReportSheet({
  reportId,
  selfId,
  selfName,
  awardAuthority,
  onClose,
  onChanged,
}: {
  reportId: string;
  selfId: string;
  selfName: string;
  awardAuthority: boolean;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) {
  const api = evaluationsApi();
  const [d, setD] = useState<ReportDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<null | { stage: ReviewStage; decision: ReviewDecision; officerId: string | null; label: string; tone?: "danger" }>(null);
  const load = useCallback(async () => {
    try {
      setD(await api.report(reportId));
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [api, reportId]);
  useEffect(() => {
    void load();
  }, [load]);

  const own = d?.supervisorId === selfId;
  const reviewsFor = (officerId: string, category: "award" | "needs_improvement") => (d?.reviews ?? []).filter((v) => v.officerId === officerId && v.category === category);

  return (
    <Sheet
      open
      onClose={onClose}
      title={d ? `${formatPatrolDate(d.patrolDate, { weekday: "long", month: "long", day: "numeric" })}` : "Daily evaluation"}
      subtitle={d ? `${d.author.rank} ${d.author.name} · ${d.author.callsign ?? "—"}` : undefined}
      footer={
        d && !own ? (
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAction({ stage: "reopen", decision: "reopened", officerId: null, label: "Reopen for amendment" })}>
              Reopen for amendment
            </Button>
            {!d.reviewedAt ? (
              <Button variant="gold" size="sm" onClick={() => setAction({ stage: "report", decision: "reviewed", officerId: null, label: "Mark reviewed" })}>
                Mark reviewed
              </Button>
            ) : null}
          </div>
        ) : undefined
      }
    >
      <div className="p-5">
        {error ? <Callout tone="error" title="The report could not be loaded">{error}</Callout> : null}
        {!d && !error ? <Skeleton className="h-48 rounded-lg" /> : null}
        {d ? (
        <div className="flex flex-col gap-5 text-xs">
          <div className="flex flex-wrap gap-1.5">
            <Pill tone={d.late ? "amber" : "green"} dotted>
              {d.late ? "Submitted late" : "Submitted on time"}
            </Pill>
            <Pill>Version {d.version}</Pill>
            {d.reviewedAt ? <Pill tone="green">Reviewed</Pill> : null}
            {d.reopenedAt ? <Pill tone="info">Reopened</Pill> : null}
          </div>
          <p className="text-2xs text-muted">
            Submitted {fmt(d.submittedAt)}
            {d.firstSubmittedAt !== d.submittedAt ? ` · first submitted ${fmt(d.firstSubmittedAt)}` : ""}
          </p>
          {own ? <Callout tone="info" title="This is your own report">You cannot review your own report.</Callout> : null}
          {d.noObservations ? <p className="rounded-md bg-sunken px-3 py-2.5 font-semibold">No notable observations</p> : null}
          {CATEGORIES.map((c) => {
            const items = d.entries.filter((e) => e.category === c);
            if (!items.length) return null;
            return (
              <section key={c} aria-label={CATEGORY_LABEL[c]}>
                <h3 className="mb-2 text-2xs font-semibold text-muted">{CATEGORY_LABEL[c]}</h3>
                <ul className="flex flex-col gap-3">
                  {items.map((e) => {
                    const decisions = c === "exceeding" ? [] : reviewsFor(e.officer.id, c);
                    const endorsed = decisions.find((v) => v.stage === "award_endorsement");
                    const final = decisions.find((v) => v.stage === "award_final");
                    const concern = decisions.find((v) => v.stage === "concern");
                    const aboutMe = e.officer.id === selfId;
                    return (
                      <li key={e.id} className="rounded-md border border-line p-3">
                        <p className="font-semibold">
                          {e.officer.name} <span className="font-normal text-muted">· {e.officer.rank} · {e.officer.callsign ?? "—"}</span>
                        </p>
                        {e.award ? <p className="mt-0.5 font-semibold text-gold-ink">Recommended award: {e.award}</p> : null}
                        <p className="mt-1 whitespace-pre-wrap text-ink-2">{e.justification}</p>
                        {decisions.length ? (
                          <ul className="mt-2 space-y-1 border-t border-line pt-2 text-2xs text-muted">
                            {decisions.map((v) => (
                              <li key={v.id}>
                                <span className="font-semibold text-ink">{DECISION_LABEL[v.decision]}</span> by {v.actorRank} {v.actorName}, {fmt(v.at)}: {v.reason}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {!own && !aboutMe && c === "needs_improvement" && !concern ? (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <Button size="xs" variant="secondary" onClick={() => setAction({ stage: "concern", decision: "noted", officerId: e.officer.id, label: `Note concern about ${e.officer.name}` })}>
                              Note
                            </Button>
                            <Button size="xs" variant="secondary" onClick={() => setAction({ stage: "concern", decision: "referred", officerId: e.officer.id, label: `Refer ${e.officer.name} to the chain of command` })}>
                              Refer to chain of command
                            </Button>
                          </div>
                        ) : null}
                        {!own && !aboutMe && c === "award" && !endorsed ? (
                          <div className="mt-2.5 flex flex-wrap gap-2">
                            <Button size="xs" variant="gold" icon={<AwardIcon className="size-3.5" />} onClick={() => setAction({ stage: "award_endorsement", decision: "endorsed", officerId: e.officer.id, label: `Endorse award for ${e.officer.name}` })}>
                              Endorse
                            </Button>
                            <Button size="xs" variant="secondary" onClick={() => setAction({ stage: "award_endorsement", decision: "declined", officerId: e.officer.id, label: `Decline award for ${e.officer.name}`, tone: "danger" })}>
                              Decline
                            </Button>
                          </div>
                        ) : null}
                        {!own && !aboutMe && c === "award" && endorsed?.decision === "endorsed" && !final ? (
                          awardAuthority && endorsed.actorName !== selfName ? (
                            <div className="mt-2.5 flex flex-wrap gap-2">
                              <Button size="xs" variant="gold" onClick={() => setAction({ stage: "award_final", decision: "approved", officerId: e.officer.id, label: `Approve award for ${e.officer.name}` })}>
                                Approve award
                              </Button>
                              <Button size="xs" variant="secondary" onClick={() => setAction({ stage: "award_final", decision: "declined", officerId: e.officer.id, label: `Decline award for ${e.officer.name}`, tone: "danger" })}>
                                Decline
                              </Button>
                            </div>
                          ) : (
                            <p className="mt-2 text-2xs text-muted">Awaiting final approval by the Office of the Chiefs{awardAuthority ? " (someone other than the endorser)" : ""}.</p>
                          )
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </section>
            );
          })}
          {d.versions.length > 1 ? (
            <section>
              <h3 className="mb-2 text-2xs font-semibold text-muted">Version history</h3>
              <ol className="space-y-1.5 text-2xs">
                {[...d.versions].reverse().map((v) => (
                  <li key={v.version}>
                    <span className="font-semibold">Version {v.version}</span> · {v.kind} {fmt(v.at)}
                    {v.reason ? <span className="text-muted"> · {v.reason}</span> : null}
                    <span className="block text-muted">
                      {v.content.no_observations ? "No notable observations" : v.content.entries.map((e) => `${e.officer_name} (${CATEGORY_SHORT[e.category]})`).join(", ")}
                    </span>
                  </li>
                ))}
              </ol>
            </section>
          ) : null}
          {d.reviews.filter((v) => !v.officerId).length ? (
            <section>
              <h3 className="mb-2 text-2xs font-semibold text-muted">Command actions</h3>
              <ul className="space-y-1 text-2xs text-muted">
                {d.reviews
                  .filter((v) => !v.officerId)
                  .map((v) => (
                    <li key={v.id}>
                      <span className="font-semibold text-ink">{DECISION_LABEL[v.decision]}</span> by {v.actorRank} {v.actorName}, {fmt(v.at)}: {v.reason}
                    </li>
                  ))}
              </ul>
            </section>
          ) : null}
        </div>
        ) : null}
      </div>
      {action ? (
        <ReasonDialog
          title={action.label}
          description="Your decision and reason are recorded permanently with your name."
          confirm={action.label.split(" for ")[0].split(" about ")[0]}
          hint={action.decision === "referred" ? "A referral flags the observation for the chain of command. It is not a disciplinary finding." : "Explain the decision."}
          tone={action.tone}
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            await api.review(reportId, action.stage, action.decision, reason, action.officerId);
            toast("success", DECISION_LABEL[action.decision]);
            await load();
            await onChanged();
          }}
        />
      ) : null}
    </Sheet>
  );
}

// ------------------------------------------------------------ awards/rules

function AwardsAndRules() {
  const api = evaluationsApi();
  const [awards, setAwards] = useState<Award[] | null>(null);
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => setAwards(await api.awards()), [api]);
  useEffect(() => {
    load().catch((e) => setError(errorMessage(e)));
  }, [load]);
  const s = DEFAULT_SETTINGS;
  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
      <Card>
        <CardHeader title="Award and medal list" description="Supervisors choose from this list or name the award. The Handbook defines no awards, so the official list comes from leadership." />
        <div className="border-t border-line">
          {awards === null ? (
            <Skeleton className="m-4 h-16" />
          ) : awards.length === 0 ? (
            <p className="px-4 py-4 text-2xs text-muted">No awards are listed yet. Supervisors name the recommended award in their own words until leadership supplies the official list.</p>
          ) : (
            <ul className="divide-y divide-line">
              {awards.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-xs">
                  <span>
                    <span className="font-semibold">{a.name}</span>
                    {a.description ? <span className="block text-2xs text-muted">{a.description}</span> : null}
                  </span>
                  <Button
                    size="xs"
                    variant="ghost"
                    onClick={async () => {
                      try {
                        await api.saveAward(a.name, a.description, !a.active);
                        await load();
                      } catch (e) {
                        toast("error", "Not saved", errorMessage(e));
                      }
                    }}
                  >
                    {a.active ? "Retire" : "Restore"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
          <form
            className="grid gap-2 border-t border-line p-4"
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError(null);
              try {
                await api.saveAward(name, desc, true);
                setName("");
                setDesc("");
                await load();
                toast("success", "Award added");
              } catch (err) {
                setError(errorMessage(err));
              } finally {
                setBusy(false);
              }
            }}
          >
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              Award name
              <Input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} placeholder="As named by leadership" />
            </label>
            <label className="flex flex-col gap-1.5 text-xs font-semibold">
              Description (optional)
              <Input value={desc} maxLength={500} onChange={(e) => setDesc(e.target.value)} />
            </label>
            {error ? <p role="alert" className="text-2xs font-medium text-red">{error}</p> : null}
            <div>
              <Button type="submit" size="sm" variant="secondary" loading={busy} disabled={busy || name.trim().length < 2}>
                Add award
              </Button>
            </div>
          </form>
        </div>
      </Card>
      <Card>
        <CardHeader title={<span className="flex items-center gap-2">Reporting rules <Pill tone="amber">Interim, pending leadership</Pill></span>} description="Configurable by command. Changes are audited and never rewrite submitted reports." />
        <dl className="divide-y divide-line border-t border-line text-xs">
          {[
            ["Who files", "Sergeants and Lieutenants (PC-31)"],
            ["Patrol day", `${s.dayStart} to ${s.dayStart}, ${s.timezone} (PC-32)`],
            ["Deadline", `${s.deadlineTime} the following day; late reports accepted and marked (PC-33)`],
            ["Assigned days", "Command assignments always require a report"],
            ["Unassigned days", `Required after ${s.minPatrolMinutes}+ minutes of completed patrol (PC-30)`],
            ["Who can be evaluated", "Active Corporals, Senior Officers, Officers, Reserve and Probationary Officers, department-wide (PC-36)"],
            ["Review and excusals", "Captain and above (PC-34)"],
            ["Award approval", "Captain+ endorses, Office of the Chiefs approves; two different people (PC-35)"],
            ["Amendments", `Author within ${s.amendWindowDays} days unless reviewed; afterwards command reopens (PC-37)`],
          ].map(([k, v]) => (
            <div key={k} className="grid grid-cols-[150px_1fr] gap-3 px-4 py-2.5">
              <dt className="text-muted">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>
      </Card>
    </div>
  );
}
