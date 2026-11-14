"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, FileDown, Lock } from "lucide-react";
import { Page } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Callout, Skeleton } from "@/components/ui/feedback";
import { DataList } from "@/components/ui/surface";
import { cn } from "@/lib/cn";
import { ia, memberDirectory } from "@/lib/ia/client";
import {
  AUDIT_LABEL,
  categoryLabel,
  DISCIPLINES,
  dueText,
  EVIDENCE_KINDS,
  FINDING_LABEL,
  FINDINGS,
  HANDLER_LABEL,
  IA_CATEGORIES,
  nextSteps,
  STATUS_LABEL,
  type Allegation,
  type CaseDetail,
  type StaffMember,
} from "@/lib/ia/model";
import { PREVIEW_STAFF, previewDetail } from "@/lib/ia/preview";
import { ActionDialog, localToIso, nowLocal, type ActionField } from "./action-dialog";
import { useIaAccess } from "./use-ia";

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—");

type DialogSpec = { title: string; description?: ReactNode; confirm: string; tone?: "primary" | "gold" | "danger"; fields: ActionField[]; run: (v: Record<string, string>) => Promise<unknown>; extra?: ReactNode };

export function IaCase() {
  const id = useSearchParams().get("id") ?? "";
  const { access, preview } = useIaAccess();
  const [d, setD] = useState<CaseDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [dialog, setDialog] = useState<DialogSpec | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (preview) {
      setD(previewDetail(id));
      setStaff(PREVIEW_STAFF);
      return;
    }
    try {
      setError(null);
      const [detail, s] = await Promise.all([ia.detail(id), ia.staff()]);
      setD(detail);
      setStaff(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : "This case could not be opened.");
    }
  }, [id, preview]);
  useEffect(() => {
    if (preview || access?.has_access) void load();
  }, [load, preview, access?.has_access]);

  const act = (spec: DialogSpec) => () => (preview ? setNotice("Actions are switched off in the design preview.") : setDialog(spec));
  const done = async (message: string) => {
    setDialog(null);
    setNotice(message);
    await load();
  };

  if (!preview && access && !access.has_access) {
    return (
      <Page>
        <Callout tone="info" title="Case unavailable">
          This record is restricted to Internal Affairs and the designated oversight posts.
        </Callout>
      </Page>
    );
  }
  if (error)
    return (
      <Page>
        <BackLink />
        <Callout tone="error" title="This case could not be opened">
          {error === "Case unavailable" ? "It does not exist, or you are not permitted to see it (for example, you are named in it or declared a conflict)." : error}
        </Callout>
      </Page>
    );
  if (!d)
    return (
      <Page>
        <div role="status" aria-label="Loading case" className="space-y-3">
          <Skeleton className="h-7 w-64" />
          <Skeleton className="h-40 rounded-lg" />
        </div>
      </Page>
    );

  const c = d.case;
  const open = (s: string) => ["intake", "unassigned", "investigating"].includes(s);
  const steps = nextSteps(d);
  const staffOptions = staff.map((s) => ({ value: s.personnel_id, label: `${s.ia_callsign} · ${s.name} (${s.callsign ?? "—"})` }));
  const sustained = d.allegations.filter((a) => a.finding === "sustained");
  const accusedInterviewed = d.interviews.some((i) => i.kind === "accused");

  // ---------- action specs (the database re-checks every one)
  const actions: { label: string; spec: DialogSpec; primary?: boolean; show: boolean }[] = [
    {
      label: "Review intake",
      primary: true,
      show: c.status === "intake" && d.me.is_lead,
      spec: {
        title: "Review intake",
        description: "Link the verified member if the complaint identifies one. Linking can escalate the case to the authority named in IA §5; it never widens who can see it.",
        confirm: "Accept for assignment",
        fields: [
          { name: "accused", label: "Member named in the complaint", type: "select", options: [], hint: c.reported_officer ? `Complainant wrote: “${c.reported_officer}”` : "Leave empty if the member is not identified yet." },
          { name: "note", label: "Intake note", type: "textarea", required: true, minLength: 10 },
        ],
        run: (v) => ia.acceptIntake(c.id, v.accused || null, v.note),
      },
    },
    {
      label: c.investigator ? "Reassign" : "Assign investigator",
      primary: c.status === "unassigned",
      show: (c.status === "unassigned" || c.status === "investigating") && d.me.is_lead,
      spec: {
        title: c.investigator ? "Reassign the case" : "Assign an investigator",
        description: "IA §5: an investigator may not handle a case involving themselves, their direct supervisor, someone they supervise, or anyone they have a personal conflict with. Record how you checked.",
        confirm: "Assign",
        tone: "gold",
        fields: [
          { name: "investigator", label: "Investigator", type: "select", required: true, options: c.handler === "ia" ? staffOptions : access?.personnel_id ? [{ value: access.personnel_id, label: "Myself (designated authority, IA §5)" }] : [] },
          { name: "check", label: "Conflict-of-interest check", type: "textarea", required: true, minLength: 10, hint: "For example: no supervisory, training or personal relationship with the member or complainant." },
        ],
        run: (v) => ia.assign(c.id, v.investigator, v.check),
      },
    },
    {
      label: "Record notice to member",
      show: c.status === "investigating" && d.me.is_worker && !!c.accused && c.accused_notice !== "notified",
      spec: {
        title: "Notice to the member",
        description: "IA §6: tell the member in writing that they are under investigation and what the allegation is, unless doing so would compromise evidence.",
        confirm: "Record",
        fields: [
          { name: "delayed", label: "Delay notice: telling the member now would compromise evidence", type: "checkbox" },
          { name: "note", label: "How notice was given, or why it is delayed", type: "textarea", required: true, minLength: 10 },
        ],
        run: (v) => ia.recordNotice(c.id, v.delayed === "true", v.note),
      },
    },
    {
      label: "Record interview",
      show: c.status === "investigating" && d.me.is_worker,
      spec: {
        title: "Record an interview",
        description: "Interview the complainant and witnesses before the accused member when possible (IA §6). An accused member's interview needs the Garrity warning first (IA §7) and may have an uninvolved supervisor of their choice as observer.",
        confirm: "Save interview",
        fields: [
          { name: "kind", label: "Interviewee", type: "select", required: true, options: [{ value: "complainant", label: "Complainant" }, { value: "witness", label: "Witness" }, { value: "accused", label: "Accused member (Garrity required)" }] },
          { name: "who", label: "Name", type: "text", required: true, minLength: 2, maxLength: 120 },
          { name: "at", label: "Interview time", type: "datetime", required: true, initial: nowLocal() },
          { name: "garrity", label: "Garrity warning read at (accused only)", type: "datetime", hint: "Required for the accused member. Must be before the interview time." },
          { name: "observer", label: "Observer (optional)", type: "text", maxLength: 120 },
          { name: "summary", label: "Summary of the statement", type: "textarea", required: true, minLength: 20 },
        ],
        run: (v) => ia.recordInterview(c.id, { kind: v.kind, interviewee: v.who, conductedAt: localToIso(v.at)!, garrityReadAt: v.kind === "accused" ? localToIso(v.garrity) : null, observer: v.observer || null, summary: v.summary }),
        extra: c.criminal_referral_at && !c.criminal_decision ? <Callout tone="warn" title="Accused interviews are on hold">A possible crime was referred to the Deputy Chief (IA §7).</Callout> : null,
      },
    },
    {
      label: "Log evidence",
      show: open(c.status) && d.me.is_worker,
      spec: {
        title: "Log evidence",
        description: "Record what was preserved and where it is. AnchorCAD records are logged by reference: this site does not import CAD data.",
        confirm: "Log evidence",
        fields: [
          { name: "kind", label: "Type", type: "select", required: true, options: EVIDENCE_KINDS.map((k) => ({ value: k.key, label: k.label })) },
          { name: "description", label: "Description", type: "text", required: true, minLength: 3, maxLength: 1000 },
          { name: "ref", label: "Reference or https link", type: "text", maxLength: 500, hint: "For example an AnchorCAD incident number or a clip link." },
        ],
        run: (v) => ia.addEvidence(c.id, v.kind, v.description, v.ref || null),
      },
    },
    {
      label: "Add allegation",
      show: open(c.status) && d.me.is_worker,
      spec: {
        title: "Add an allegation",
        description: "Each allegation receives its own finding (IA §8).",
        confirm: "Add",
        fields: [
          { name: "category", label: "Category", type: "select", required: true, options: IA_CATEGORIES.map((k) => ({ value: k.key, label: k.label })) },
          { name: "description", label: "Allegation", type: "textarea", required: true, minLength: 5, maxLength: 2000 },
        ],
        run: (v) => ia.addAllegation(c.id, v.category, v.description),
      },
    },
    {
      label: "Submit report",
      primary: c.status === "investigating",
      show: c.status === "investigating" && d.me.is_worker,
      spec: {
        title: "Submit the written case report",
        description: "IA §6: the allegation, the evidence, what each witness said, and a finding for each allegation. It goes to the Director or Deputy Director for review.",
        confirm: "Submit for review",
        tone: "gold",
        fields: [
          { name: "body", label: "Case report", type: "textarea", required: true, minLength: 100, maxLength: 30000 },
          ...(accusedInterviewed ? [] : [{ name: "reason", label: "Why the accused member was not interviewed", type: "textarea" as const, required: true, minLength: 10 }]),
        ],
        run: (v) => ia.submitReport(c.id, v.body, v.reason || null),
      },
    },
    {
      label: "Extend deadline",
      show: c.status === "investigating" && d.me.is_lead,
      spec: {
        title: "Extend the 7-day target",
        description: "IA §6: the Director may extend the deadline for complex cases and notes the reason in the file.",
        confirm: "Extend",
        fields: [
          { name: "due", label: "New due date", type: "datetime", required: true },
          { name: "reason", label: "Reason", type: "textarea", required: true, minLength: 10 },
        ],
        run: (v) => ia.extend(c.id, localToIso(v.due)!, v.reason),
      },
    },
    {
      label: "Refer possible crime",
      show: c.status === "investigating" && d.me.is_worker && !c.criminal_referral_at,
      spec: {
        title: "Refer a possible crime",
        description: "IA §7: IA stops the administrative interview and notifies the Deputy Chief, who decides whether a criminal investigation is opened. Describe what was observed; this is not a legal determination.",
        confirm: "Refer to the Deputy Chief",
        tone: "danger",
        fields: [{ name: "note", label: "What was observed", type: "textarea", required: true, minLength: 10 }],
        run: (v) => ia.criminalReferral(c.id, v.note),
      },
    },
    {
      label: "Decide criminal referral",
      primary: true,
      show: !!c.criminal_referral_at && !c.criminal_decision && d.me.can_decide,
      spec: {
        title: "Criminal referral decision",
        description: "IA §7: you decide whether a criminal investigation is opened. Administrative interviews stay stopped until you record a decision.",
        confirm: "Record decision",
        fields: [
          { name: "opened", label: "Decision", type: "select", required: true, options: [{ value: "true", label: "Open a criminal investigation" }, { value: "false", label: "No criminal investigation; administrative case continues" }] },
          { name: "note", label: "Notes", type: "textarea", required: true, minLength: 10 },
        ],
        run: (v) => ia.criminalDecision(c.id, v.opened === "true", v.note),
      },
    },
    {
      label: "Approve report",
      primary: true,
      show: c.status === "director_review" && d.me.can_review,
      spec: { title: "Approve and forward to the Deputy Chief", description: "IA §6. You cannot review a report you wrote.", confirm: "Approve", tone: "gold", fields: [{ name: "notes", label: "Review notes", type: "textarea", required: true, minLength: 10 }], run: (v) => ia.directorReview(c.id, true, v.notes) },
    },
    {
      label: "Return report",
      show: c.status === "director_review" && d.me.can_review,
      spec: { title: "Return to the investigator", description: "The case reopens for more work and the findings unlock.", confirm: "Return", fields: [{ name: "notes", label: "What needs to change", type: "textarea", required: true, minLength: 10 }], run: (v) => ia.directorReview(c.id, false, v.notes) },
    },
    {
      label: "Record decision",
      primary: true,
      show: c.status === "deputy_chief_review" && d.me.can_decide,
      spec: {
        title: "Disciplinary decision",
        description: "IA §9: IA recommends; you decide. Only sustained allegations can carry discipline. A termination also needs the Chief's approval. Nothing is written to the roster automatically.",
        confirm: "Record decision",
        tone: "gold",
        fields: [
          ...sustained.map((a) => ({ name: `a:${a.id}`, label: `Allegation ${a.ord}: ${categoryLabel(a.category)}${a.recommended_discipline ? ` (IA recommends ${a.recommended_discipline})` : ""}`, type: "select" as const, required: true, options: DISCIPLINES.map((x) => ({ value: x.key, label: x.label })) })),
          { name: "rationale", label: "Rationale", type: "textarea", required: true, minLength: 10 },
        ],
        run: (v) => ia.decide(c.id, Object.fromEntries(Object.entries(v).filter(([k]) => k.startsWith("a:")).map(([k, x]) => [k.slice(2), x])), v.rationale),
        extra: sustained.length === 0 ? <p className="text-xs text-ink-2">No allegation is sustained, so no discipline can be recorded. Recording the decision closes the case.</p> : null,
      },
    },
    {
      label: "Approve termination",
      primary: true,
      show: c.status === "chief_review" && d.me.can_approve_termination,
      spec: { title: "Approve the termination", description: "IA §9: a termination needs the Chief of Police's approval.", confirm: "Approve termination", tone: "danger", fields: [{ name: "notes", label: "Notes", type: "textarea", required: true, minLength: 10 }], run: (v) => ia.chiefTermination(c.id, true, v.notes) },
    },
    {
      label: "Decline termination",
      show: c.status === "chief_review" && d.me.can_approve_termination,
      spec: { title: "Decline the termination", description: "The decision returns to the Deputy Chief. The declined decision stays on file.", confirm: "Decline", fields: [{ name: "notes", label: "Notes", type: "textarea", required: true, minLength: 10 }], run: (v) => ia.chiefTermination(c.id, false, v.notes) },
    },
    {
      label: "Record member told finding",
      show: c.status === "closed" && !c.findings_notice_at && (d.me.is_lead || d.me.can_decide),
      spec: { title: "Member told the finding", description: "IA §7: members are told the finding when the case closes. Record how.", confirm: "Record", fields: [{ name: "method", label: "How the member was told", type: "textarea", required: true, minLength: 10 }], run: (v) => ia.findingsNotice(c.id, v.method) },
    },
    {
      label: "Approve message to complainant",
      show: d.me.can_decide,
      spec: { title: "Message for the complainant", description: "IA §11: case details are released only with the Deputy Chief's approval. The complainant sees this text on their private status page.", confirm: "Approve message", fields: [{ name: "body", label: "Message", type: "textarea", required: true, minLength: 10, maxLength: 1000 }], run: (v) => ia.approveDisclosure(c.id, v.body) },
    },
    {
      label: "Add note",
      show: d.me.is_worker || d.me.is_lead,
      spec: { title: "Add an investigative note", description: "Notes are internal and permanent.", confirm: "Add note", fields: [{ name: "body", label: "Note", type: "textarea", required: true, minLength: 2 }], run: (v) => ia.addNote(c.id, v.body) },
    },
    {
      label: "Declare a conflict",
      show: !["closed", "referred_external"].includes(c.status),
      spec: { title: "Declare a conflict of interest", description: "IA §5: tell the Director. You lose access to this case, and if you are assigned it returns to the queue.", confirm: "Declare conflict", tone: "danger", fields: [{ name: "note", label: "Nature of the conflict", type: "textarea", required: true, minLength: 5 }], run: (v) => ia.declareConflict(c.id, v.note) },
    },
  ];
  const visible = actions.filter((a) => a.show);

  return (
    <Page wide>
      <BackLink />
      <header className="mb-6 flex flex-col gap-3 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-2xs font-semibold text-gold-ink">
            <Lock className="size-3.5" aria-hidden /> Confidential · {HANDLER_LABEL[c.handler]}
          </p>
          <h1 className="display mt-1 text-2xl font-bold tracking-tight tabular">{c.case_number}</h1>
          <p className="mt-1 text-sm text-ink-2">{c.summary}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {visible
            .filter((a) => a.primary)
            .map((a) => (
              <Button key={a.label} variant="gold" onClick={act(a.spec)}>
                {a.label}
              </Button>
            ))}
        </div>
      </header>

      {preview ? (
        <div className="mb-5">
          <Callout tone="info" title="Design preview with a fictional case">
            Actions are switched off. Live cases load from the database, which enforces every step shown here.
          </Callout>
        </div>
      ) : null}
      {notice ? (
        <p role="status" className="mb-4 flex items-center gap-2 text-xs font-semibold text-green">
          <Check className="size-4" aria-hidden /> {notice}
        </p>
      ) : null}

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-8">
          <Block title="Complaint">
            <DataList
              columns={3}
              items={[
                { label: "Received", value: fmt(c.received_at) },
                { label: "Category", value: categoryLabel(c.category) },
                { label: "Source", value: { public: "Public complaint", member: "Member complaint", supervisor_referral: "Supervisor referral", ia_opened: "Opened by IA", use_of_force_review: "Use-of-force review" }[c.source] ?? c.source },
                { label: "Incident", value: [c.incident_date, c.incident_time_approx].filter(Boolean).join(", ") || "—" },
                { label: "Location", value: c.location ?? "—" },
                { label: "Receipt reference", value: d.receipt_reference ?? "—" },
              ]}
            />
            <p className="mt-4 text-sm leading-relaxed whitespace-pre-wrap text-ink">{c.description}</p>
            {c.witnesses ? <p className="mt-3 text-xs text-ink-2"><span className="font-semibold">Witnesses named: </span>{c.witnesses}</p> : null}
            <div className="mt-4 rounded-md border border-line bg-surface-2 px-3 py-2 text-xs">
              <span className="font-semibold">Complainant: </span>
              {!d.complainant || d.complainant.anonymous ? "Anonymous" : [d.complainant.member_name ? `${d.complainant.member_name} (TPD member)` : d.complainant.name, d.complainant.contact].filter(Boolean).join(" · ") || "Not provided"}
            </div>
          </Block>

          <Block title="Allegations and findings" note="One finding per allegation (IA §8). Locked once the report is submitted.">
            <ol className="divide-y divide-line rounded-lg border border-line bg-surface">
              {d.allegations.map((a) => (
                <AllegationRow key={a.id} a={a} canEdit={c.status === "investigating" && d.me.is_worker} onRecord={act(findingSpec(a))} />
              ))}
            </ol>
          </Block>

          <Block title="Evidence" note="Files are kept in private storage; opening one creates a 60-second link and an audit entry.">
            {d.evidence.length ? (
              <ul className="divide-y divide-line rounded-lg border border-line bg-surface text-xs">
                {d.evidence.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-medium text-ink">{e.description}</p>
                      <p className="mt-0.5 text-muted">
                        {EVIDENCE_KINDS.find((k) => k.key === e.kind)?.label ?? e.kind} · {fmt(e.added_at)}
                        {e.submitted_by_public ? " · from complainant" : ""}
                        {e.external_ref && !e.external_ref.startsWith("https://") ? ` · ${e.external_ref}` : ""}
                      </p>
                    </div>
                    {e.has_file ? (
                      <Button size="sm" variant="secondary" icon={<FileDown className="size-4" />} onClick={() => (preview ? setNotice("Files are not available in the design preview.") : void ia.evidenceUrl(e.id).then((u) => window.open(u, "_blank", "noopener,noreferrer")).catch((x) => setNotice(x.message)))}>
                        Open file
                      </Button>
                    ) : e.external_ref?.startsWith("https://") ? (
                      <a href={e.external_ref} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1 font-semibold text-gold-ink hover:underline">
                        Open link <ExternalLink className="size-3.5" aria-hidden />
                      </a>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No evidence logged yet.</p>
            )}
            {open(c.status) && d.me.is_worker && !preview ? <EvidenceUpload caseId={c.id} onDone={() => void done("File uploaded to the case.")} /> : null}
          </Block>

          <Block title="Interviews" note="Witnesses and the complainant before the accused member when possible (IA §6).">
            {d.interviews.length ? (
              <ul className="space-y-3">
                {d.interviews.map((i) => (
                  <li key={i.id} className="rounded-lg border border-line bg-surface p-4 text-xs">
                    <p className="font-semibold text-ink">
                      {i.interviewee} <span className="font-normal text-muted">· {i.kind === "accused" ? "Accused member" : i.kind === "witness" ? "Witness" : "Complainant"} · {fmt(i.conducted_at)} · by {i.conducted_by_name}</span>
                    </p>
                    {i.kind === "accused" ? <p className="mt-1 text-2xs text-ink-2">Garrity warning read {fmt(i.garrity_read_at)}{i.observer ? ` · Observer: ${i.observer}` : ""}</p> : null}
                    <p className="mt-2 leading-relaxed whitespace-pre-wrap text-ink-2">{i.summary}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No interviews recorded.</p>
            )}
          </Block>

          {d.reports.length || d.reviews.length || d.decisions.length ? (
            <Block title="Report, reviews and decisions">
              <ol className="space-y-3 text-xs">
                {d.reports.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line bg-surface p-4">
                    <p className="font-semibold">Report v{r.version} · {r.author_name} · {fmt(r.submitted_at)}</p>
                    <p className="mt-2 leading-relaxed whitespace-pre-wrap text-ink-2">{r.body}</p>
                    {r.no_accused_interview_reason ? <p className="mt-2 text-muted">No accused interview: {r.no_accused_interview_reason}</p> : null}
                  </li>
                ))}
                {d.reviews.map((r) => (
                  <li key={r.id} className="rounded-lg border border-line bg-surface-2 p-4">
                    <p className="font-semibold">
                      {r.stage === "director" ? "IA review" : "Chief, termination"}: {r.outcome === "approved" ? "approved" : r.stage === "director" ? "returned" : "declined"} · {r.reviewer_name} · {fmt(r.reviewed_at)}
                    </p>
                    <p className="mt-1 text-ink-2">{r.notes}</p>
                  </li>
                ))}
                {d.decisions.map((x) => (
                  <li key={x.id} className={cn("rounded-lg border border-line bg-surface p-4", x.superseded_at && "opacity-70")}>
                    <p className="font-semibold">
                      Decision · {x.decided_by_name} · {fmt(x.decided_at)}
                      {x.superseded_at ? " · superseded after the Chief declined the termination" : ""}
                    </p>
                    <ul className="mt-2 space-y-0.5 text-ink-2">
                      {x.outcomes.map((o) => (
                        <li key={o.allegation_id}>
                          Allegation {o.ord}: {FINDING_LABEL[o.finding]}
                          {o.discipline ? ` · ${DISCIPLINES.find((z) => z.key === o.discipline)?.label ?? o.discipline}` : ""}
                        </li>
                      ))}
                    </ul>
                    <p className="mt-2 text-ink-2">{x.rationale}</p>
                  </li>
                ))}
              </ol>
            </Block>
          ) : null}

          <Block title="Internal notes">
            {d.notes.length ? (
              <ul className="space-y-2 text-xs">
                {d.notes.map((n) => (
                  <li key={n.id} className="border-l-2 border-line pl-3">
                    <p className="text-2xs text-muted">{n.author_name} · {fmt(n.created_at)}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-ink-2">{n.body}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">No notes.</p>
            )}
          </Block>

          <Block title="Audit trail" note="Append-only. Includes every time this file was opened.">
            <ol className="space-y-1.5 text-xs">
              {d.audit.map((e, i) => (
                <li key={i} className="grid grid-cols-[120px_1fr] gap-3">
                  <span className="text-muted tabular">{fmt(e.at)}</span>
                  <span className="text-ink-2">
                    {AUDIT_LABEL[e.action] ?? e.action} <span className="text-muted">· {e.actor === "system:ia-intake" ? "Intake" : e.actor}</span>
                  </span>
                </li>
              ))}
            </ol>
          </Block>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start" aria-label="Case status and actions">
          <section className="rounded-lg border border-line bg-surface p-4">
            <p className="text-2xs text-muted">Status</p>
            <p className="mt-0.5 text-sm font-semibold text-ink">{STATUS_LABEL[c.status]}</p>
            {c.status === "investigating" && c.due_at ? <p className={cn("mt-1 text-xs tabular", c.overdue ? "font-semibold text-red" : "text-ink-2")}>{dueText(c.due_at)} · {fmt(c.due_at)}</p> : null}
            <dl className="mt-4 space-y-2.5 text-xs">
              <Row label="Member">{c.accused ? `${c.accused.callsign ?? ""} ${c.accused.name} · ${c.accused.rank}` : c.reported_officer ? `“${c.reported_officer}” (unverified)` : "Not identified"}</Row>
              <Row label="Investigator">{c.investigator ? `${c.investigator.callsign ?? ""} ${c.investigator.name}` : "Unassigned"}</Row>
              <Row label="Notice to member">{c.accused_notice === "notified" ? `Given ${fmt(c.accused_notice_at)}` : c.accused_notice === "delayed" ? `Delayed: ${c.accused_notice_note}` : "Not recorded"}</Row>
              {c.criminal_referral_at ? <Row label="Criminal referral">{c.criminal_decision ? (c.criminal_decision === "opened" ? "Criminal investigation opened" : "Not opened") : "Waiting for the Deputy Chief"}</Row> : null}
              {c.status === "closed" ? <Row label="Member told finding">{c.findings_notice_at ? fmt(c.findings_notice_at) : "Not recorded"}</Row> : null}
            </dl>
          </section>

          {steps.length ? (
            <section>
              <h2 className="text-xs font-semibold text-ink-2">Next steps for you</h2>
              <ol className="mt-2 list-decimal space-y-1 pl-4 text-xs text-ink-2">
                {steps.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ol>
            </section>
          ) : null}

          <section>
            <h2 className="text-xs font-semibold text-ink-2">Tasks</h2>
            <ul className="mt-2 space-y-2">
              {d.tasks.map((t) => {
                const late = !t.completed_at && t.due_at && new Date(t.due_at).getTime() < Date.now();
                const canDo = !t.completed_at && (t.kind === "roster_record_update" ? d.me.can_confirm_roster : d.me.is_worker);
                return (
                  <li key={t.id} className="rounded-md border border-line bg-surface p-3 text-xs">
                    <p className="flex items-start gap-1.5 font-medium text-ink">
                      {t.completed_at ? <Check className="mt-0.5 size-3.5 shrink-0 text-green" aria-hidden /> : late ? <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-red" aria-hidden /> : null}
                      {{ bodycam_preservation: "Preserve bodycam (same day)", evidence_preservation: "Preserve CAD logs and records", roster_record_update: "Enter discipline on the roster Records tab" }[t.kind]}
                    </p>
                    <p className="mt-1 text-muted">{t.completed_at ? `Done ${fmt(t.completed_at)}: ${t.completion_note}` : `${t.detail}${t.due_at ? ` Due ${fmt(t.due_at)}.` : ""}`}</p>
                    {canDo ? (
                      <Button
                        size="xs"
                        variant="secondary"
                        className="mt-2"
                        onClick={act({
                          title: t.kind === "roster_record_update" ? "Confirm the roster entry" : "Complete task",
                          description: t.kind === "roster_record_update" ? "This website cannot write to the TPD Roster. Confirm only after the entry and points were made on the Records tab by hand." : undefined,
                          confirm: t.kind === "roster_record_update" ? "Confirm entry was made" : "Mark complete",
                          fields: [{ name: "note", label: "What was done", type: "textarea", required: true, minLength: 5 }],
                          run: (v) => ia.completeTask(t.id, v.note),
                        })}
                      >
                        {t.kind === "roster_record_update" ? "Confirm entry" : "Complete"}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {visible.some((a) => !a.primary) ? (
            <section>
              <h2 className="text-xs font-semibold text-ink-2">Actions</h2>
              <div className="mt-2 flex flex-col gap-1.5">
                {visible
                  .filter((a) => !a.primary)
                  .map((a) => (
                    <Button key={a.label} variant={a.label === "Declare a conflict" ? "ghost" : "secondary"} size="sm" className="justify-start" onClick={act(a.spec)}>
                      {a.label}
                    </Button>
                  ))}
              </div>
            </section>
          ) : null}
        </aside>
      </div>

      {dialog ? (
        <IntakeAwareDialog
          spec={dialog}
          onClose={() => setDialog(null)}
          onDone={() => void done("Saved to the case file.")}
        />
      ) : null}
    </Page>
  );

  function findingSpec(a: Allegation): DialogSpec {
    return {
      title: `Finding for allegation ${a.ord}`,
      description: "IA §8. A discipline recommendation is optional and only possible for a sustained finding; the Deputy Chief decides (IA §9).",
      confirm: "Record finding",
      fields: [
        { name: "finding", label: "Finding", type: "select", required: true, initial: a.finding ?? "", options: FINDINGS.map((f) => ({ value: f.key, label: `${f.label}: ${f.meaning}` })) },
        { name: "rationale", label: "Basis in the evidence", type: "textarea", required: true, minLength: 20, initial: a.finding_rationale ?? "" },
        { name: "recommended", label: "Recommended discipline (sustained only)", type: "select", initial: a.recommended_discipline ?? "", options: DISCIPLINES.map((x) => ({ value: x.key, label: x.label })) },
      ],
      run: (v) => ia.recordFinding(a.id, v.finding, v.rationale, v.finding === "sustained" ? v.recommended || null : null),
    };
  }
}

/** Fills the member picker for intake review lazily, then renders the generic dialog. */
function IntakeAwareDialog({ spec, onClose, onDone }: { spec: DialogSpec; onClose: () => void; onDone: () => void }) {
  const needsPeople = spec.fields.some((f) => f.name === "accused" && f.type === "select");
  const [people, setPeople] = useState<{ value: string; label: string }[] | null>(needsPeople ? null : []);
  useEffect(() => {
    if (needsPeople) memberDirectory().then((m) => setPeople((m ?? []).map((x) => ({ value: x.id, label: `${x.callsign ?? "—"} · ${x.name} · ${x.rank}` }))));
  }, [needsPeople]);
  const fields = useMemo(() => spec.fields.map((f) => (f.name === "accused" && f.type === "select" ? { ...f, options: people ?? [] } : f)), [spec.fields, people]);
  if (people === null) return null;
  return (
    <ActionDialog title={spec.title} description={spec.description} confirm={spec.confirm} tone={spec.tone} fields={fields} onClose={onClose} onSubmit={async (v) => (await spec.run(v), onDone())}>
      {spec.extra}
    </ActionDialog>
  );
}

function AllegationRow({ a, canEdit, onRecord }: { a: Allegation; canEdit: boolean; onRecord: () => void }) {
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 text-xs">
        <p className="font-semibold text-ink">
          {a.ord}. {categoryLabel(a.category)}
        </p>
        <p className="mt-0.5 text-ink-2">{a.description}</p>
        {a.finding ? (
          <p className="mt-1.5 text-ink-2">
            <span className="font-semibold text-ink">{FINDING_LABEL[a.finding]}</span> · {a.finding_rationale}
            {a.recommended_discipline ? <span className="text-muted"> · IA recommends {a.recommended_discipline}</span> : null}
          </p>
        ) : (
          <p className="mt-1.5 text-muted">No finding yet</p>
        )}
      </div>
      {canEdit ? (
        <Button size="sm" variant="secondary" onClick={onRecord} className="shrink-0">
          {a.finding ? "Change finding" : "Record finding"}
        </Button>
      ) : null}
    </li>
  );
}

function EvidenceUpload({ caseId, onDone }: { caseId: string; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [kind, setKind] = useState("bodycam");
  const [desc, setDesc] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <form
      className="mt-3 grid gap-2 rounded-lg border border-dashed border-line-strong p-3 text-xs sm:grid-cols-[1fr_140px_1fr_auto] sm:items-end"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!file || busy) return;
        setBusy(true);
        setErr(null);
        try {
          await ia.uploadEvidence(caseId, kind, desc.trim(), file);
          setFile(null);
          setDesc("");
          onDone();
        } catch (x) {
          setErr(x instanceof Error ? x.message : "Upload failed.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label className="flex flex-col gap-1 font-semibold">
        File (25 MB)
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf,video/mp4,video/webm" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-2xs font-normal" />
      </label>
      <label className="flex flex-col gap-1 font-semibold">
        Type
        <select value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 rounded-md border border-line-strong bg-surface px-2 font-normal">
          {EVIDENCE_KINDS.filter((k) => k.key !== "link").map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1 font-semibold">
        Description
        <input value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={1000} className="h-9 rounded-md border border-line-strong bg-surface px-2 font-normal" />
      </label>
      <Button type="submit" size="md" variant="secondary" loading={busy} disabled={!file || desc.trim().length < 3 || busy}>
        Upload
      </Button>
      {err ? (
        <p role="alert" className="text-red sm:col-span-4">
          {err}
        </p>
      ) : null}
    </form>
  );
}

function Block({ title, note, children }: { title: string; note?: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {note ? <p className="text-2xs text-muted">{note}</p> : null}
      </div>
      {children}
    </section>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-2xs text-muted">{label}</dt>
      <dd className="mt-0.5 text-ink">{children}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/hq/internal-affairs" className="mb-4 inline-flex items-center gap-1.5 text-xs font-semibold text-muted hover:text-ink">
      <ArrowLeft className="size-3.5" aria-hidden /> All cases
    </Link>
  );
}
