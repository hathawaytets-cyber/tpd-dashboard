"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/overlay";
import { Field, Input, Select, Textarea } from "@/components/ui/field";

export type ActionField =
  | { name: string; label: string; type: "text" | "textarea" | "date" | "datetime"; hint?: string; minLength?: number; maxLength?: number; required?: boolean; initial?: string }
  | { name: string; label: string; type: "select"; hint?: string; options: { value: string; label: string }[]; required?: boolean; initial?: string }
  | { name: string; label: string; type: "checkbox"; hint?: string; initial?: string };

/**
 * One dialog for every IA workflow step: collects the fields the database requires (reasons, notes),
 * shows the server's own refusal message if it says no, and never closes on failure.
 */
export function ActionDialog({
  title,
  description,
  fields,
  confirm,
  tone = "primary",
  onSubmit,
  onClose,
  children,
}: {
  title: string;
  description?: ReactNode;
  fields: ActionField[];
  confirm: string;
  tone?: "primary" | "gold" | "danger";
  onSubmit: (values: Record<string, string>) => Promise<void>;
  onClose: () => void;
  children?: ReactNode;
}) {
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? ""])));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formId = useId();
  useEffect(() => setError(null), [values]);

  const missing = fields.some((f) => {
    if (f.type === "checkbox") return false;
    const v = (values[f.name] ?? "").trim();
    if (f.required && !v) return true;
    return "minLength" in f && f.minLength ? v.length > 0 && v.length < f.minLength : false;
  });

  async function submit() {
    if (busy || missing) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(values);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed.");
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      title={title}
      description={description}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="submit" form={formId} variant={tone} loading={busy} disabled={busy || missing}>
            {confirm}
          </Button>
        </>
      }
    >
      <form
        id={formId}
        className="grid gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {children}
        {fields.map((f) => {
          const id = `${formId}-${f.name}`;
          const set = (v: string) => setValues((x) => ({ ...x, [f.name]: v }));
          if (f.type === "checkbox")
            return (
              <label key={f.name} className="flex items-start gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={values[f.name] === "true"} onChange={(e) => set(String(e.target.checked))} className="mt-0.5 size-4 accent-[var(--gold-ink)]" />
                <span>
                  <span className="font-semibold text-ink">{f.label}</span>
                  {f.hint ? <span className="block text-muted">{f.hint}</span> : null}
                </span>
              </label>
            );
          const v = values[f.name] ?? "";
          const count = "minLength" in f && f.minLength ? `${v.trim().length < f.minLength ? `At least ${f.minLength} characters. ` : ""}${f.hint ?? ""}` : f.hint;
          return (
            <Field key={f.name} label={f.label} htmlFor={id} hint={count || undefined}>
              {f.type === "textarea" ? (
                <Textarea id={id} rows={4} value={v} maxLength={f.maxLength ?? 8000} onChange={(e) => set(e.target.value)} required={f.required} />
              ) : f.type === "select" ? (
                <Select id={id} value={v} onChange={(e) => set(e.target.value)} required={f.required} className="w-full">
                  <option value="">Choose…</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input id={id} type={f.type === "datetime" ? "datetime-local" : f.type} value={v} maxLength={f.type === "text" ? (f.maxLength ?? 500) : undefined} onChange={(e) => set(e.target.value)} required={f.required} />
              )}
            </Field>
          );
        })}
        {error ? (
          <p role="alert" className="rounded-md border border-red/40 bg-red-soft px-3 py-2 text-xs text-ink">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}

/** Local datetime-input value → ISO string (the database compares in UTC). */
export const localToIso = (v: string) => (v ? new Date(v).toISOString() : null);
export const nowLocal = (offsetMin = 0) => {
  const d = new Date(Date.now() + offsetMin * 60_000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
