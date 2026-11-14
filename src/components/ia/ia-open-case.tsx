"use client";

import { useEffect, useState } from "react";
import { ia, memberDirectory } from "@/lib/ia/client";
import { IA_CATEGORIES } from "@/lib/ia/model";
import { ActionDialog } from "./action-dialog";

/** IA-opened case: the mandatory review of deadly force (IA §10) or a matter command assigns (IA §3). */
export function OpenCaseDialog({ onClose, onOpened }: { onClose: () => void; onOpened: (id: string) => void }) {
  const [people, setPeople] = useState<{ value: string; label: string }[]>([]);
  useEffect(() => {
    memberDirectory().then((d) => setPeople((d ?? []).map((m) => ({ value: m.id, label: `${m.callsign ?? "—"} · ${m.name} · ${m.rank}` }))));
  }, []);
  return (
    <ActionDialog
      title="Open a case"
      description="For a use-of-force or shooting review (required even without a complaint, IA §10) or a matter assigned by the Deputy Chief or Chief (IA §3). Public and member complaints arrive through the complaint form."
      confirm="Open case"
      tone="gold"
      onClose={onClose}
      fields={[
        { name: "source", label: "Reason", type: "select", required: true, options: [{ value: "use_of_force_review", label: "Use of force or shooting review (IA §10)" }, { value: "ia_opened", label: "Assigned or opened by IA leadership (IA §3)" }] },
        { name: "category", label: "Category", type: "select", required: true, options: IA_CATEGORIES.map((c) => ({ value: c.key, label: c.label })) },
        { name: "accused", label: "Member involved", type: "select", options: people },
        { name: "date", label: "Incident date", type: "date" },
        { name: "summary", label: "Summary", type: "text", required: true, minLength: 5, maxLength: 200 },
        { name: "description", label: "Details", type: "textarea", required: true, minLength: 20 },
      ]}
      onSubmit={async (v) => {
        const id = await ia.openCase({ source: v.source as "ia_opened" | "use_of_force_review", category: v.category, accused: v.accused || null, summary: v.summary, description: v.description, incidentDate: v.date || null });
        onOpened(id);
      }}
    />
  );
}
