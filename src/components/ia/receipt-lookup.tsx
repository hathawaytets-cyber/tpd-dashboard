"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { checkReceipt, intakeAvailable } from "@/lib/ia/client";
import { RECEIPT_STATUS, REFERENCE_PATTERN, TOKEN_PATTERN } from "../../../supabase/functions/_shared/ia.ts";

type Result = Awaited<ReturnType<typeof checkReceipt>>;

export function ReceiptLookup() {
  const [reference, setReference] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [invalid, setInvalid] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const ref = reference.trim().toUpperCase();
    const tok = token.trim();
    if (!REFERENCE_PATTERN.test(ref) || !TOKEN_PATTERN.test(tok)) {
      setInvalid(true);
      setResult(null);
      return;
    }
    setInvalid(false);
    setBusy(true);
    setResult(await checkReceipt(ref, tok));
    setBusy(false);
  }

  const status = result && "found" in result && result.found ? RECEIPT_STATUS[result.status] : null;
  return (
    <div className="space-y-6">
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="grid gap-5 rounded-xl border border-line bg-surface p-6 shadow-sm">
        <Field label="Case reference" htmlFor="reference" hint="Looks like TPD-7KQ3-M9PX.">
          <Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono uppercase" aria-invalid={invalid} />
        </Field>
        <Field label="Tracking code" htmlFor="token" hint="The 43-character code shown once after you filed.">
          <Input id="token" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" spellCheck={false} className="font-mono" aria-invalid={invalid} />
        </Field>
        {invalid ? (
          <p role="alert" className="text-xs font-medium text-red">
            Check both values. They must match exactly what you received.
          </p>
        ) : null}
        <div>
          <Button type="submit" variant="primary" loading={busy} disabled={busy || !intakeAvailable}>
            Check status
          </Button>
          {!intakeAvailable ? <p className="mt-2 text-xs text-muted">Status lookup is not connected on this site yet.</p> : null}
        </div>
      </form>
      <div aria-live="polite">
        {result && "error" in result ? <p className="rounded-lg border border-red/40 bg-red-soft p-4 text-sm">{result.error}</p> : null}
        {result && "found" in result && !result.found ? (
          <p className="rounded-lg border border-line bg-surface-2 p-4 text-sm text-ink-2">No complaint matches that reference and tracking code. Check both values and try again.</p>
        ) : null}
        {status && result && "found" in result && result.found ? (
          <div className="rounded-xl border border-line bg-surface p-6">
            <p className="text-2xs font-medium text-muted">
              {result.reference} · received {result.received_on}
            </p>
            <p className="display mt-1 text-xl font-bold">{status.label}</p>
            <p className="mt-2 text-sm text-ink-2">{status.body}</p>
            {result.statement ? (
              <div className="mt-4 border-t border-line pt-4">
                <p className="text-2xs font-medium text-muted">Message from the department</p>
                <p className="mt-1 text-sm whitespace-pre-wrap text-ink">{result.statement}</p>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
      <p className="text-xs text-muted">
        Need to report something new?{" "}
        <Link href="/report" className="font-semibold text-gold-ink hover:underline">
          File a complaint
        </Link>
      </p>
    </div>
  );
}
