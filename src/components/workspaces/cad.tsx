"use client";

import Link from "next/link";
import { Check, ExternalLink, FileSearch, Link2, Minus, ShieldCheck } from "lucide-react";
import { Page, PageHeader } from "@/components/shell/page";
import { ANCHORCAD_JOIN_URL, ANCHORCAD_PANEL, ANCHORCAD_URL } from "@/components/shell/nav-config";
import { buttonClass } from "@/components/ui/button";
import { Callout } from "@/components/ui/feedback";
import { Pill } from "@/components/ui/status";
import { Card, CardHeader } from "@/components/ui/surface";
import { can } from "@/lib/authz";
import { useMe } from "@/lib/preview/hooks";
import { CAPABILITIES } from "../../../supabase/functions/_shared/anchorcad.ts";

const STEPS = [
  { title: "Join the TPD community", body: "Open the join link and sign in to AnchorCAD. The request goes to the community; AnchorCAD's administrators approve it there. This site cannot grant or check CAD access." },
  { title: "Use AnchorCAD for reports", body: "File every arrest, citation and incident in AnchorCAD (Handbook §10). Dispatch, units and records live there." },
  { title: "Reference CAD records here", body: "Where Headquarters asks for evidence, such as an Internal Affairs case, give the AnchorCAD record number or link. Headquarters stores the reference, never a copy of the record." },
];

/**
 * AnchorCAD workspace: launch-and-reference only. AnchorCAD has a documented API, but this site does not hold a key
 * and does not read CAD data; a server-side, read-only sync is a separate decision for command (docs/INTEGRATIONS.md).
 */
export function CadWorkspace() {
  const me = useMe();
  const command = !!me && can(me.actor, "command.view");
  return (
    <Page>
      <PageHeader
        eyebrow="Department"
        title="AnchorCAD"
        description="The department's computer-aided dispatch and records system. Headquarters links to it and keeps references to CAD records; it does not copy or display CAD data."
        meta={<Pill tone={ANCHORCAD_URL ? "green" : "neutral"} dotted>{ANCHORCAD_URL ? "Panel link configured" : "Panel link not configured"}</Pill>}
        actions={
          <>
            <a href={ANCHORCAD_JOIN_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("secondary", "md")}>
              Join the community <ExternalLink className="size-3.5" aria-hidden />
            </a>
            {ANCHORCAD_URL ? (
              <a href={ANCHORCAD_URL} target="_blank" rel="noopener noreferrer" className={buttonClass("gold", "md")}>
                Open AnchorCAD <ExternalLink className="size-3.5" aria-hidden />
              </a>
            ) : null}
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-5">
          <Card>
            <CardHeader title="Getting set up" description="Three steps, the same for every member" />
            <ol className="border-t border-line">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-3.5 border-b border-line px-4 py-3.5 last:border-b-0">
                  <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-full bg-gold-soft text-2xs font-semibold text-gold-ink tabular">
                    {i + 1}
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-xs font-semibold text-ink">{s.title}</h3>
                    <p className="mt-0.5 text-xs text-ink-2">{s.body}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardHeader title="What Headquarters does with AnchorCAD" description="Supported today, and what stays inside AnchorCAD" />
            <ul className="border-t border-line">
              {CAPABILITIES.map((c) => (
                <li key={c.name} className="flex items-start gap-3 border-b border-line px-4 py-3 last:border-b-0">
                  {c.supported ? <Check className="mt-0.5 size-4 shrink-0 text-green" aria-label="Supported" /> : <Minus className="mt-0.5 size-4 shrink-0 text-muted" aria-label="Not supported" />}
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-ink">{c.name}</p>
                    <p className="text-2xs text-muted">{c.note}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader title="Panel link" />
            <div className="border-t border-line px-4 py-3.5 text-xs text-ink-2">
              {ANCHORCAD_URL ? (
                <p className="break-all">{ANCHORCAD_URL}</p>
              ) : (
                <p>{ANCHORCAD_PANEL.note} Members can still join through the community link; command sets the panel address for the site.</p>
              )}
            </div>
          </Card>
          <Card>
            <CardHeader title="Evidence and records" />
            <div className="flex flex-col gap-3 border-t border-line px-4 py-3.5 text-xs text-ink-2">
              <p className="flex gap-2.5">
                <Link2 className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                Cite CAD records by number or link. The original stays in AnchorCAD, under AnchorCAD&apos;s access rules.
              </p>
              <p className="flex gap-2.5">
                <FileSearch className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                Bodycam footage is not in AnchorCAD. Internal Affairs collects it separately and the same day (IA §4).
              </p>
              <p className="flex gap-2.5">
                <ShieldCheck className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
                No CAD key or password is ever stored in this site&apos;s code or in your browser.
              </p>
            </div>
          </Card>
          {command ? (
            <Callout tone="info" title="Live CAD data is not connected" action={<Link href="/hq/command/integrations" className={buttonClass("secondary", "sm")}>Integrations</Link>}>
              A read-only sync would need a panel API key held only on the server and command&apos;s approval. It is designed but not switched on.
            </Callout>
          ) : null}
        </div>
      </div>
    </Page>
  );
}
