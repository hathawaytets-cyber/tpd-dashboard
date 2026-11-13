"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, UserPlus } from "lucide-react";
import Link from "next/link";
import { Page, PageHeader } from "@/components/shell/page";
import { Button } from "@/components/ui/button";
import { Callout, EmptyState, Skeleton } from "@/components/ui/feedback";
import { Pill } from "@/components/ui/status";
import { ia, memberDirectory } from "@/lib/ia/client";
import { IA_CALLSIGNS, ROLE_LABEL, type AppointmentRow } from "@/lib/ia/model";
import { PREVIEW_APPOINTMENTS } from "@/lib/ia/preview";
import { ActionDialog } from "./action-dialog";
import { useIaAccess } from "./use-ia";

const fmt = (s: string) => new Date(s).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

/**
 * IA appointments (IA §1, §12). Only the Deputy Chief appoints and removes; the database enforces it, refuses
 * self-appointment and refuses members with a sustained dishonesty finding. Rank never grants IA access.
 */
export function IaAppointments() {
  const { access, preview, reload } = useIaAccess();
  const [rows, setRows] = useState<AppointmentRow[] | null>(preview ? PREVIEW_APPOINTMENTS : null);
  const [error, setError] = useState<string | null>(null);
  const [n, setN] = useState(0);
  const [dialog, setDialog] = useState<{ kind: "appoint"; callsign?: string } | { kind: "end"; row: AppointmentRow } | null>(null);

  useEffect(() => {
    if (preview) return setRows(PREVIEW_APPOINTMENTS);
    if (!access?.has_access) return;
    let alive = true;
    ia.appointments()
      .then((r) => alive && setRows(r))
      .catch((e) => alive && setError(e instanceof Error ? e.message : "Appointments could not be loaded."));
    return () => {
      alive = false;
    };
  }, [preview, access?.has_access, n]);

  const active = useMemo(() => (rows ?? []).filter((r) => !r.ended_at), [rows]);
  const past = useMemo(() => (rows ?? []).filter((r) => r.ended_at), [rows]);
  const seats = IA_CALLSIGNS.map((s) => ({ ...s, holder: active.find((a) => a.callsign === s.callsign) ?? null }));
  const canAppoint = !preview && !!access?.can_appoint;
  const refresh = () => (setDialog(null), setN((x) => x + 1), reload());

  if (!preview && access && !access.has_access)
    return (
      <Page>
        <PageHeader eyebrow="Internal Affairs" title="Restricted area" />
        <Callout tone="info" title="Internal Affairs records are restricted">
          Only IA appointees and the designated oversight posts can view IA appointments (IA SOP §11).
        </Callout>
      </Page>
    );

  return (
    <Page>
      <Link href="/hq/internal-affairs" className="mb-3 inline-flex items-center gap-1.5 text-2xs font-medium text-muted hover:text-ink">
        <ArrowLeft className="size-3.5" aria-hidden /> Case management
      </Link>
      <PageHeader
        eyebrow="Internal Affairs"
        title="Appointments"
        description="Six seats under IA §1. The Deputy Chief appoints and removes IA members (IA §12); each change is recorded with its reason in the IA audit log."
        actions={canAppoint ? <Button variant="gold" icon={<UserPlus className="size-4" />} onClick={() => setDialog({ kind: "appoint" })}>Appoint</Button> : null}
      />
      {preview ? (
        <div className="mb-5">
          <Callout tone="info" title="Design preview with fictional members">Appointments are made by the Deputy Chief on the live site.</Callout>
        </div>
      ) : !canAppoint && access ? (
        <p className="mb-5 text-2xs text-muted">Only the Deputy Chief can appoint or remove IA members. You can view the roster of seats.</p>
      ) : null}
      {error ? (
        <div className="mb-5">
          <Callout tone="error" title="Appointments could not be loaded">{error}</Callout>
        </div>
      ) : null}

      {!rows ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
            {seats.map((s) => {
              const mismatch = s.holder && s.holder.roster_slot_holder !== s.holder.name;
              return (
                <li key={s.callsign} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                  <span className="w-14 shrink-0 text-xs font-semibold tabular text-ink">{s.callsign}</span>
                  <div className="min-w-0 flex-1">
                    {s.holder ? (
                      <>
                        <p className="text-xs font-medium text-ink">
                          {s.holder.name}
                          {s.holder.member_callsign ? <span className="ml-1.5 font-normal text-muted tabular">{s.holder.member_callsign}</span> : null}
                        </p>
                        <p className="text-2xs text-muted">
                          {ROLE_LABEL[s.role]} · since {fmt(s.holder.appointed_at)}
                          {mismatch ? <span className="text-amber"> · Roster slot {s.callsign} shows {s.holder.roster_slot_holder ?? "nobody"}; update the roster</span> : null}
                        </p>
                      </>
                    ) : (
                      <p className="text-xs text-muted">
                        Vacant <span className="text-2xs">· {ROLE_LABEL[s.role]}</span>
                      </p>
                    )}
                  </div>
                  {canAppoint ? (
                    s.holder ? (
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "end", row: s.holder! })}>
                        End appointment
                      </Button>
                    ) : (
                      <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "appoint", callsign: s.callsign })}>
                        Appoint
                      </Button>
                    )
                  ) : s.holder ? (
                    <Pill tone="neutral">Active</Pill>
                  ) : null}
                </li>
              );
            })}
          </ul>

          <h2 className="mt-8 mb-2.5 text-xs font-semibold text-ink-2">Past appointments</h2>
          {past.length === 0 ? (
            <EmptyState title="No past appointments" body="Ended appointments stay listed here with the reason." />
          ) : (
            <ul className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
              {past.map((r) => (
                <li key={r.id} className="px-4 py-3">
                  <p className="text-xs text-ink">
                    <span className="font-semibold tabular">{r.callsign}</span> · {r.name}
                  </p>
                  <p className="mt-0.5 text-2xs text-muted">
                    {fmt(r.appointed_at)} to {fmt(r.ended_at!)} · {r.end_reason}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {dialog?.kind === "appoint" ? <AppointDialog callsign={dialog.callsign} vacant={seats.filter((s) => !s.holder).map((s) => s.callsign)} onClose={() => setDialog(null)} onDone={refresh} /> : null}
      {dialog?.kind === "end" ? (
        <ActionDialog
          title={`End ${dialog.row.callsign} appointment`}
          description={`${dialog.row.name} loses access to IA records immediately. Case history they wrote is kept.`}
          confirm="End appointment"
          tone="danger"
          onClose={() => setDialog(null)}
          fields={[{ name: "reason", label: "Reason", type: "textarea", required: true, minLength: 10, maxLength: 1000 }]}
          onSubmit={async (v) => {
            await ia.endAppointment(dialog.row.id, v.reason);
            refresh();
          }}
        />
      ) : null}
    </Page>
  );
}

function AppointDialog({ callsign, vacant, onClose, onDone }: { callsign?: string; vacant: string[]; onClose: () => void; onDone: () => void }) {
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    memberDirectory().then((d) => setPeople((d ?? []).map((m) => ({ value: m.id, label: `${m.callsign ?? "—"} · ${m.name} · ${m.rank}` }))));
  }, []);
  return (
    <ActionDialog
      title="Appoint to Internal Affairs"
      description="Rank alone does not qualify a member. A member with a sustained dishonesty finding cannot serve (IA §12), and you cannot appoint yourself."
      confirm="Appoint"
      tone="gold"
      onClose={onClose}
      fields={[
        { name: "callsign", label: "IA seat", type: "select", required: true, initial: callsign, options: IA_CALLSIGNS.filter((s) => vacant.includes(s.callsign)).map((s) => ({ value: s.callsign, label: `${s.callsign} · ${ROLE_LABEL[s.role]}` })) },
        { name: "member", label: "Member", type: "select", required: true, options: people },
        { name: "reason", label: "Reason", type: "textarea", required: true, minLength: 10, maxLength: 1000 },
      ]}
      onSubmit={async (v) => {
        await ia.appoint(v.member, v.callsign, v.reason);
        onDone();
      }}
    />
  );
}
