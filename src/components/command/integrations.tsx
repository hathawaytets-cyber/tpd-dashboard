"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Lock, RefreshCw } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { ANCHORCAD_PANEL } from "@/components/shell/nav-config";
import { Button, ButtonLink } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Dialog } from "@/components/ui/overlay";
import { Pill, type Tone } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { ACCESS_NOTE, can } from "@/lib/authz";
import { useAuth, useVerifiedMember } from "@/lib/backend/auth";
import { supabase } from "@/lib/backend/client";
import { backendConfigured } from "@/lib/backend/config";
import { actorFor } from "@/lib/backend/membership";
import { SOURCES } from "@/lib/department";
import { CAPABILITIES } from "../../../supabase/functions/_shared/anchorcad.ts";

type Status = "connected" | "not_configured" | "verification_required" | "degraded" | "failed" | "unsupported";
const LABEL: Record<Status, [string, Tone]> = {
  connected: ["Connected", "green"],
  not_configured: ["Not configured", "neutral"],
  verification_required: ["Verification required", "amber"],
  degraded: ["Degraded", "amber"],
  failed: ["Failed", "red"],
  unsupported: ["Unsupported", "neutral"],
};

interface StatusRow {
  integration: "discord_oauth" | "discord_guild" | "google_sheets" | "anchorcad";
  status: Status;
  detail: Record<string, unknown>;
  checked_at: string;
  last_success_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

interface SyncRun {
  id: string;
  started_at: string;
  finished_at: string | null;
  trigger: string;
  status: string;
  counts: Record<string, number>;
  warnings: { message: string }[];
  errors: { message: string }[];
}

interface SyncResponse {
  runId: string;
  status: string;
  counts: Record<string, number>;
  issues: { severity: string; code: string; message: string }[];
  changes: { kind: string; name: string; callsign?: string | null; rank?: string; fields?: Record<string, { from: unknown; to: unknown }> }[];
  error: string | null;
  hash?: string | null;
  outcome?: { markedFormer: number; pendingRemoval: number } | null;
}

const when = (s: string | null | undefined) => (s ? new Date(s).toLocaleString() : "Never");

export function IntegrationsWorkspace() {
  const auth = useAuth();
  const member = useVerifiedMember();
  const allowed = member ? can(actorFor(member), "command.view") : false;

  return (
    <Page wide>
      <PageHeader
        eyebrow={
          <Link href="/hq/command" className="inline-flex items-center gap-1 hover:underline">
            <ArrowLeft aria-hidden className="size-3" /> Command Center
          </Link>
        }
        title="Integrations"
        description="Discord sign-in, the Google Sheets roster and AnchorCAD. A status shows Connected only after an authenticated check succeeded. Secret values are never shown."
      />
      {!backendConfigured ? (
        <Unconfigured />
      ) : auth.status === "loading" ? (
        <p className="text-xs text-muted" role="status">
          Checking your access…
        </p>
      ) : !allowed ? (
        <div className="mx-auto mt-6 max-w-md rounded-xl border border-edge bg-surface p-8 text-center shadow-card">
          <Lock aria-hidden className="mx-auto size-5 text-gold-ink" />
          <h2 className="display mt-3 text-lg font-bold">Command access required</h2>
          <p className="mt-2 text-xs text-muted">Access: {ACCESS_NOTE["command.view"]}, verified from the roster after Discord sign-in. The server enforces this on every request.</p>
          <ButtonLink href="/hq/sign-in" variant="secondary" className="mt-4">
            {auth.session ? "Account status" : "Sign in with Discord"}
          </ButtonLink>
        </div>
      ) : (
        <Live />
      )}
    </Page>
  );
}

/** No backend: every integration is honestly "Not configured". Only public configuration is evaluated. */
function Unconfigured() {
  return (
    <>
      <Callout tone="warn" title="No backend is connected to this site">
        Supabase is not configured (NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY), so Discord sign-in, roster sync and health checks cannot run. The server code, database schema and tests
        are in the repository; see docs/INTEGRATIONS.md for activation.
      </Callout>
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel
          title="Discord"
          status="not_configured"
          rows={[
            ["Sign-in (OAuth)", "Needs a Discord application and Supabase Auth"],
            ["Server check", "Needs the TPD server ID (no bot)"],
            ["Role sync", "Read-only verification; role writes disabled"],
          ]}
        />
        <Panel
          title="Google Sheets"
          status="not_configured"
          rows={[
            [
              "Roster source",
              <a key="s" href={SOURCES.roster.href} target="_blank" rel="noopener noreferrer" className="text-gold-ink hover:underline">
                TPD roster sheet
              </a>,
            ],
            ["Access", "Needs a read-only service account"],
            ["Last sync", "Never"],
          ]}
        />
        <Panel
          title="AnchorCAD"
          status={ANCHORCAD_PANEL.status as Status}
          rows={[
            ["Panel link", ANCHORCAD_PANEL.note],
            ["API", "Needs a panel API key (server-side)"],
          ]}
          capabilities
        />
      </div>
    </>
  );
}

function Panel({
  title,
  status,
  rows,
  capabilities,
  action,
  footer,
}: {
  title: string;
  status: Status;
  rows: [string, React.ReactNode][];
  capabilities?: boolean;
  action?: React.ReactNode;
  footer?: React.ReactNode;
}) {
  const [label, tone] = LABEL[status];
  return (
    <Card className="flex flex-col">
      <CardHeader
        title={title}
        action={
          <Pill tone={tone} dotted>
            {label}
          </Pill>
        }
      />
      <dl className="divide-y divide-line border-t border-line text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3 px-4 py-2">
            <dt className="shrink-0 text-ink-2">{k}</dt>
            <dd className="min-w-0 text-right break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {capabilities ? (
        <ul className="border-t border-line px-4 py-3 text-3xs">
          {CAPABILITIES.map((c) => (
            <li key={c.name} className="flex gap-2 py-0.5">
              <span className={c.supported ? "font-semibold text-green" : "text-muted"}>{c.supported ? "Supported" : "Unsupported"}</span>
              <span className="text-ink-2">
                {c.name}. <span className="text-muted">{c.note}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {footer}
      {action ? <div className="mt-auto flex flex-wrap gap-2 border-t border-line px-4 py-3">{action}</div> : null}
    </Card>
  );
}

function Live() {
  const auth = useAuth();
  const [rows, setRows] = useState<StatusRow[]>([]);
  const [runs, setRuns] = useState<SyncRun[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [preview, setPreview] = useState<SyncResponse | null>(null);
  const [confirmRemovals, setConfirmRemovals] = useState(false);

  const load = useCallback(async () => {
    const sb = supabase();
    if (!sb) return;
    const [s, r] = await Promise.all([
      sb.from("integration_status").select("*"),
      sb.from("roster_sync_runs").select("id,started_at,finished_at,trigger,status,counts,warnings,errors").order("started_at", { ascending: false }).limit(8),
    ]);
    if (s.error || r.error) setErr("Integration status could not be loaded.");
    setRows((s.data ?? []) as StatusRow[]);
    setRuns((r.data ?? []) as SyncRun[]);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(key);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
      load();
    }
  };
  const row = (k: StatusRow["integration"]) => rows.find((r) => r.integration === k);
  const st = (k: StatusRow["integration"]) => (row(k)?.status ?? "not_configured") as Status;
  const lastOk = runs.find((r) => r.status === "applied" || r.status === "no_changes");
  const d = (k: StatusRow["integration"], f: string) => {
    const v = row(k)?.detail?.[f];
    return v === undefined || v === null ? "—" : String(v);
  };

  return (
    <>
      {err ? (
        <div className="mb-4">
          <Callout tone="error" title="Request failed">
            {err}
          </Callout>
        </div>
      ) : null}
      <div className="mb-4 flex justify-end">
        <Button variant="secondary" icon={<RefreshCw />} loading={busy === "health"} onClick={() => run("health", async () => void (await auth.invoke("integration-health")))}>
          Run health checks
        </Button>
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        <Panel
          title="Discord"
          status={st("discord_oauth") === "connected" ? st("discord_guild") : st("discord_oauth")}
          rows={[
            ["Sign-in (OAuth)", LABEL[st("discord_oauth")][0]],
            ["Server check", `${LABEL[st("discord_guild")][0]} · member's own token, no bot`],
            ["Members checked", `${d("discord_guild", "checkedMembers")} (${d("discord_guild", "inServer")} in the server)`],
            ["Role mapping", `${d("discord_guild", "confirmedRoles")} confirmed of ${d("discord_guild", "mappedRoles")}`],
            ["Role writes", "Disabled"],
            ["Last check", when(row("discord_guild")?.checked_at)],
            ["Last error", row("discord_guild")?.last_error ?? row("discord_oauth")?.last_error ?? "None"],
          ]}
          footer={<p className="border-t border-line px-4 py-2 text-3xs text-muted">Each member is checked when they sign in. Without a bot the site cannot look up members who have not signed in.</p>}
        />
        <Panel
          title="Google Sheets"
          status={st("google_sheets")}
          rows={[
            ["Roster source", d("google_sheets", "title")],
            ["Last successful sync", when(lastOk?.finished_at)],
            ["Verified members", lastOk ? String(lastOk.counts.members ?? "—") : "—"],
            ["Warnings (last run)", String(runs[0]?.warnings?.length ?? 0)],
            ["Last error", row("google_sheets")?.last_error ?? "None"],
          ]}
          footer={
            runs.length ? (
              <ul className="border-t border-line px-4 py-2 text-3xs text-muted">
                {runs.map((r) => (
                  <li key={r.id} className="flex justify-between gap-2 py-0.5">
                    <span>
                      {when(r.started_at)} · {r.trigger}
                    </span>
                    <span className="font-semibold text-ink-2">{r.status}</span>
                  </li>
                ))}
              </ul>
            ) : null
          }
          action={
            <Button size="sm" loading={busy === "preview"} onClick={() => run("preview", async () => setPreview(await auth.invoke<SyncResponse>("roster-sync", { mode: "preview" })))}>
              Preview sync
            </Button>
          }
        />
        <Panel
          title="AnchorCAD"
          status={st("anchorcad") === "not_configured" ? (ANCHORCAD_PANEL.status as Status) : st("anchorcad")}
          rows={[
            ["Panel link", ANCHORCAD_PANEL.url ?? ANCHORCAD_PANEL.note],
            ["API", d("anchorcad", "api")],
            ["Key scopes", Array.isArray(row("anchorcad")?.detail?.scopes) ? (row("anchorcad")!.detail.scopes as string[]).join(", ") : "Not reported"],
            ["Last check", when(row("anchorcad")?.checked_at)],
          ]}
          capabilities
        />
      </div>

      <Dialog
        open={!!preview}
        onClose={() => setPreview(null)}
        title="Roster sync preview"
        description="Nothing has changed yet. Review what the roster sheet would change, then apply."
        size="lg"
        footer={
          <>
            <Button variant="secondary" onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button
              disabled={!preview || preview.issues.some((i) => i.severity === "error" && !(i.code === "mass_removal" && confirmRemovals))}
              loading={busy === "apply"}
              onClick={() =>
                run("apply", async () => {
                  const r = await auth.invoke<SyncResponse>("roster-sync", { mode: "apply", confirmRemovals, expectedHash: preview?.hash ?? null });
                  setPreview(null);
                  setConfirmRemovals(false);
                  if (r.status !== "applied" && r.status !== "no_changes")
                    throw new Error(`Sync ${r.status}: ${r.error ?? r.issues.find((i) => i.severity === "error")?.message ?? "see the run log"}`);
                })
              }
            >
              Apply roster changes
            </Button>
          </>
        }
      >
        {preview ? (
          <div className="flex flex-col gap-3 text-xs">
            <p>
              {preview.counts.members} members in {preview.counts.positions} positions ({preview.counts.vacant} vacant) · {preview.counts.added} added, {preview.counts.updated} updated,{" "}
              {preview.counts.removed} no longer listed.
            </p>
            {preview.issues.map((i, n) => (
              <Callout key={n} tone={i.severity === "error" ? "error" : "warn"} title={i.message} />
            ))}
            {preview.changes.some((c) => c.kind === "removed") ? (
              <div className="flex flex-col gap-1">
                <p className="text-muted">
                  Members no longer on the sheet stay active unless you approve their removal here. Otherwise they are removed only after the sheet omits them in three separate checks, at least six hours apart.
                </p>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={confirmRemovals} onChange={(e) => setConfirmRemovals(e.target.checked)} /> I checked the sheet; remove the members listed as “removed” now.
                </label>
              </div>
            ) : null}
            <ul className="max-h-64 divide-y divide-line overflow-auto rounded-lg border border-line">
              {preview.changes.length ? (
                preview.changes.map((c, n) => (
                  <li key={n} className="px-3 py-2">
                    <span className="font-semibold">{c.name}</span> <span className="text-muted">{c.kind}</span>
                    {c.fields ? (
                      <span className="block text-3xs text-muted">
                        {Object.entries(c.fields)
                          .map(([k, v]) => `${k}: ${v.from ?? "—"} → ${v.to ?? "—"}`)
                          .join(" · ")}
                      </span>
                    ) : null}
                  </li>
                ))
              ) : (
                <li className="px-3 py-2 text-muted">No member changes.</li>
              )}
            </ul>
          </div>
        ) : null}
      </Dialog>
    </>
  );
}
