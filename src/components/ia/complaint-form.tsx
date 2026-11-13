"use client";

import Link from "next/link";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, Copy, FileImage, Link2, Plus, ShieldAlert, Trash2, X } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { cn } from "@/lib/cn";
import { intakeAvailable, memberDirectory, submitComplaint, type SubmitResult } from "@/lib/ia/client";
import { IA_CATEGORIES, LIMITS, PUBLIC_FILE_TYPES, validateComplaint, type ComplaintInput, type FieldErrors } from "../../../supabase/functions/_shared/ia.ts";

type Officer = { id: string; name: string; callsign: string | null; rank: string };

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Report an Officer. Works without sign-in. A verified member who is signed in gets a
 * roster picker; everyone else names the officer in words. The server verifies both.
 */
export function ComplaintForm({ inHq = false }: { inHq?: boolean }) {
  const [directory, setDirectory] = useState<Officer[] | null>(null);
  const [officerId, setOfficerId] = useState<string | null>(null);
  const [officerQuery, setOfficerQuery] = useState("");
  const [officerText, setOfficerText] = useState("");
  const [category, setCategory] = useState("");
  const [incidentDate, setIncidentDate] = useState("");
  const [incidentTime, setIncidentTime] = useState("");
  const [location, setLocation] = useState("");
  const [summary, setSummary] = useState("");
  const [description, setDescription] = useState("");
  const [witnesses, setWitnesses] = useState("");
  const [links, setLinks] = useState<string[]>([""]);
  const [files, setFiles] = useState<File[]>([]);
  const [fileError, setFileError] = useState<string | null>(null);
  const [anonymous, setAnonymous] = useState(false);
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [referral, setReferral] = useState(false);
  const [website, setWebsite] = useState(""); // honeypot
  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<Extract<SubmitResult, { ok: true }> | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    memberDirectory().then((d) => alive && setDirectory(d));
    return () => {
      alive = false;
    };
  }, []);

  const matches = useMemo(() => {
    if (!directory || !officerQuery.trim()) return [];
    const q = officerQuery.trim().toLowerCase();
    return directory.filter((o) => o.name.toLowerCase().includes(q) || (o.callsign ?? "").toLowerCase().includes(q)).slice(0, 8);
  }, [directory, officerQuery]);
  const picked = directory?.find((o) => o.id === officerId) ?? null;

  function addFiles(list: FileList | null) {
    setFileError(null);
    if (!list) return;
    const next = [...files];
    for (const f of Array.from(list)) {
      if (!(PUBLIC_FILE_TYPES as readonly string[]).includes(f.type)) {
        setFileError("Attach images (PNG, JPEG, WebP) or PDFs. Share videos as links.");
        continue;
      }
      if (f.size > LIMITS.publicFileBytes) {
        setFileError(`${f.name} is larger than 5 MB.`);
        continue;
      }
      if (next.length >= LIMITS.publicFiles) {
        setFileError(`Attach at most ${LIMITS.publicFiles} files.`);
        break;
      }
      next.push(f);
    }
    setFiles(next);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setFailure(null);
    const input: ComplaintInput = {
      category,
      summary,
      description,
      incidentDate: incidentDate || null,
      incidentTime: incidentTime || null,
      location: location || null,
      officer: picked ? null : officerText || null,
      officerId: picked?.id ?? null,
      witnesses: witnesses || null,
      evidenceLinks: links.map((l) => l.trim()).filter(Boolean),
      anonymous,
      name: anonymous ? null : name || null,
      contact: anonymous ? null : contact || null,
      referral: !!picked && referral,
    };
    const checked = validateComplaint(input);
    if (!checked.ok) {
      setErrors(checked.errors);
      requestAnimationFrame(() => errorRef.current?.focus());
      return;
    }
    setErrors({});
    setBusy(true);
    const r = await submitComplaint({ ...checked.value, website }, files);
    setBusy(false);
    if (r.ok) {
      setResult(r);
      window.scrollTo({ top: 0 });
    } else {
      setErrors(r.fields ?? {});
      setFailure(r.message);
      requestAnimationFrame(() => errorRef.current?.focus());
    }
  }

  if (result) return <Receipt result={result} inHq={inHq} />;

  const errorCount = Object.keys(errors).length;
  return (
    <form onSubmit={(e) => void onSubmit(e)} noValidate className="space-y-10" aria-describedby="complaint-notice">
      <div id="complaint-notice" className="rounded-lg border border-line bg-surface-2 p-4 text-sm leading-relaxed text-ink-2">
        <p className="flex items-start gap-2 font-semibold text-ink">
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-gold-ink" aria-hidden />A complaint is an allegation, not a finding.
        </p>
        <p className="mt-1.5">
          Submitting a complaint does not mean the officer did anything wrong, and it never results in discipline by itself. Internal Affairs reviews every complaint and investigates under its standard operating procedures. No one may discourage or retaliate against you for filing.
        </p>
        <p className="mt-1.5 text-muted">This is a Roblox roleplay department. Report roleplay conduct only, and do not share real-world personal information.</p>
      </div>

      {!intakeAvailable ? (
        <p role="status" className="rounded-lg border border-amber/40 bg-amber-soft p-4 text-sm text-ink">
          Online complaint intake is not connected on this site yet, so this form cannot be submitted. Contact Internal Affairs through the department Discord in the meantime.
        </p>
      ) : null}

      {errorCount || failure ? (
        <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-red/40 bg-red-soft p-4 text-sm text-ink outline-none">
          <p className="font-semibold">{failure ?? "Check the highlighted fields."}</p>
          {errorCount ? <p className="mt-1 text-ink-2">{errorCount === 1 ? "One field needs attention." : `${errorCount} fields need attention.`}</p> : null}
        </div>
      ) : null}

      <Section n={1} title="Officer involved" hint="If you don't know who it was, describe them in the incident details.">
        {directory ? (
          <div className="space-y-2">
            {picked ? (
              <div className="flex items-center justify-between gap-3 rounded-md border border-line-strong bg-surface px-3 py-2 text-sm">
                <span>
                  <span className="font-semibold">{picked.name}</span>
                  <span className="text-muted"> · {picked.callsign ?? "no call sign"} · {picked.rank}</span>
                </span>
                <Button type="button" size="xs" variant="ghost" onClick={() => setOfficerId(null)} icon={<X className="size-3.5" />}>
                  Change
                </Button>
              </div>
            ) : (
              <OfficerSearch query={officerQuery} setQuery={setOfficerQuery} matches={matches} onPick={(id) => (setOfficerId(id), setOfficerQuery(""))} />
            )}
            <p className="text-2xs text-muted">You are signed in, so you can pick from the roster. Internal Affairs verifies the selection.</p>
            {picked ? (
              <label className="flex items-start gap-2 text-xs text-ink-2">
                <input type="checkbox" checked={referral} onChange={(e) => setReferral(e.target.checked)} className="mt-0.5 size-4 accent-[var(--gold-ink)]" />
                <span>This is a supervisor referral (IA SOP §3). Only counted for Sergeants and above; the server checks your rank.</span>
              </label>
            ) : null}
          </div>
        ) : (
          <Field label="Name or call sign (optional)" htmlFor="officer" hint="For example “X-422” or “Officer Smith”." error={errors.officer}>
            <Input id="officer" value={officerText} onChange={(e) => setOfficerText(e.target.value)} maxLength={LIMITS.officer} aria-invalid={!!errors.officer} autoComplete="off" />
          </Field>
        )}
      </Section>

      <Section n={2} title="What happened">
        <div className="grid gap-5">
          <Field label="Category" htmlFor="category" error={errors.category} hint={IA_CATEGORIES.find((c) => c.key === category)?.hint}>
            <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)} aria-invalid={!!errors.category} required className="w-full">
              <option value="">Choose a category</option>
              {IA_CATEGORIES.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid gap-5 sm:grid-cols-3">
            <Field label="Date (optional)" htmlFor="incident-date" error={errors.incidentDate}>
              <Input id="incident-date" type="date" max={today()} value={incidentDate} onChange={(e) => setIncidentDate(e.target.value)} aria-invalid={!!errors.incidentDate} />
            </Field>
            <Field label="Approximate time (optional)" htmlFor="incident-time" error={errors.incidentTime}>
              <Input id="incident-time" placeholder="Around 9 PM" value={incidentTime} onChange={(e) => setIncidentTime(e.target.value)} maxLength={LIMITS.incidentTime} aria-invalid={!!errors.incidentTime} />
            </Field>
            <Field label="Location or patrol area (optional)" htmlFor="location" error={errors.location}>
              <Input id="location" placeholder="Pier, South District" value={location} onChange={(e) => setLocation(e.target.value)} maxLength={LIMITS.location} aria-invalid={!!errors.location} />
            </Field>
          </div>
          <Field label="Short summary" htmlFor="summary" error={errors.summary} hint="One line, for example “Threatened to arrest me without a reason”.">
            <Input id="summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={LIMITS.summary[1]} aria-invalid={!!errors.summary} required />
          </Field>
          <Field label="Describe the allegation" htmlFor="description" error={errors.description} hint={`What happened, in order. ${description.trim().length.toLocaleString("en-US")} / ${LIMITS.description[1].toLocaleString("en-US")} characters.`}>
            <Textarea id="description" rows={7} value={description} onChange={(e) => setDescription(e.target.value)} maxLength={LIMITS.description[1]} aria-invalid={!!errors.description} required />
          </Field>
        </div>
      </Section>

      <Section n={3} title="Evidence and witnesses" hint="Optional. Bodycam footage is kept for 7 days, so report as soon as you can.">
        <div className="grid gap-5">
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold text-ink">Links to clips or screenshots</legend>
            {links.map((l, i) => (
              <div key={i} className="flex gap-2">
                <span className="relative flex-1">
                  <Link2 aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
                  <Input aria-label={`Evidence link ${i + 1}`} type="url" inputMode="url" placeholder="https://" value={l} onChange={(e) => setLinks(links.map((x, j) => (j === i ? e.target.value : x)))} className="pl-9" aria-invalid={!!errors.evidenceLinks} />
                </span>
                {links.length > 1 ? (
                  <Button type="button" variant="ghost" size="md" aria-label={`Remove link ${i + 1}`} onClick={() => setLinks(links.filter((_, j) => j !== i))} icon={<Trash2 className="size-4" />} />
                ) : null}
              </div>
            ))}
            {errors.evidenceLinks ? (
              <p role="alert" className="text-2xs font-medium text-red">
                {errors.evidenceLinks}
              </p>
            ) : null}
            {links.length < LIMITS.links ? (
              <Button type="button" variant="secondary" size="sm" onClick={() => setLinks([...links, ""])} icon={<Plus className="size-4" />}>
                Add link
              </Button>
            ) : null}
          </fieldset>
          <FileDrop files={files} error={fileError} onAdd={addFiles} onRemove={(i) => setFiles(files.filter((_, j) => j !== i))} />
          <Field label="Witnesses (optional)" htmlFor="witnesses" hint="Names, call signs or Roblox display names of anyone who saw it." error={errors.witnesses}>
            <Textarea id="witnesses" rows={3} value={witnesses} onChange={(e) => setWitnesses(e.target.value)} maxLength={LIMITS.witnesses} aria-invalid={!!errors.witnesses} />
          </Field>
        </div>
      </Section>

      <Section n={4} title="About you">
        <div className="grid gap-5">
          <label className="flex items-start gap-3 rounded-md border border-line-strong bg-surface p-3 text-sm">
            <input type="checkbox" checked={anonymous} onChange={(e) => setAnonymous(e.target.checked)} className="mt-0.5 size-4 accent-[var(--gold-ink)]" />
            <span>
              <span className="font-semibold text-ink">Submit anonymously</span>
              <span className="mt-0.5 block text-xs text-muted">Nothing that identifies you is stored{directory ? ", including your signed-in account" : ""}. Internal Affairs will not be able to contact you.</span>
            </span>
          </label>
          {!anonymous ? (
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Name (optional)" htmlFor="name" hint="Roleplay or Roblox display name." error={errors.name}>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} maxLength={LIMITS.name} autoComplete="off" aria-invalid={!!errors.name} />
              </Field>
              <Field label="How to reach you (optional)" htmlFor="contact" hint="Discord username. No real-world contact details." error={errors.contact}>
                <Input id="contact" value={contact} onChange={(e) => setContact(e.target.value)} maxLength={LIMITS.contact} autoComplete="off" aria-invalid={!!errors.contact} />
              </Field>
            </div>
          ) : null}
        </div>
      </Section>

      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} name="website" />
        </label>
      </div>

      <div className="flex flex-col gap-3 border-t border-line pt-6 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted">You will get a case reference and a private tracking code. Investigation records stay confidential.</p>
        <Button type="submit" variant="gold" size="lg" loading={busy} disabled={busy || !intakeAvailable}>
          Submit complaint
        </Button>
      </div>
    </form>
  );
}

function Section({ n, title, hint, children }: { n: number; title: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className="grid gap-4 md:grid-cols-[200px_1fr] md:gap-8">
      <div>
        <p className="display text-xs font-bold text-gold-ink tabular">{String(n).padStart(2, "0")}</p>
        <h2 id={id} className="mt-1 text-base font-semibold text-ink">
          {title}
        </h2>
        {hint ? <p className="mt-1 text-xs leading-relaxed text-muted">{hint}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function OfficerSearch({ query, setQuery, matches, onPick }: { query: string; setQuery: (q: string) => void; matches: Officer[]; onPick: (id: string) => void }) {
  const [active, setActive] = useState(0);
  const listId = useId();
  return (
    <div className="relative">
      <label htmlFor="officer-search" className="mb-1.5 block text-xs font-semibold text-ink">
        Find the officer (optional)
      </label>
      <Input
        id="officer-search"
        role="combobox"
        aria-expanded={matches.length > 0}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
        placeholder="Name or call sign"
        value={query}
        autoComplete="off"
        onChange={(e) => (setQuery(e.target.value), setActive(0))}
        onKeyDown={(e) => {
          if (!matches.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, matches.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter") {
            e.preventDefault();
            onPick(matches[active].id);
          } else if (e.key === "Escape") setQuery("");
        }}
      />
      {matches.length ? (
        <ul id={listId} role="listbox" aria-label="Matching officers" className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-line-strong bg-surface shadow-md">
          {matches.map((o, i) => (
            <li
              key={o.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseDown={(e) => (e.preventDefault(), onPick(o.id))}
              onMouseEnter={() => setActive(i)}
              className={cn("flex cursor-pointer justify-between gap-3 px-3 py-2 text-sm", i === active && "bg-sunken")}
            >
              <span className="font-medium">{o.name}</span>
              <span className="text-muted tabular">
                {o.callsign ?? "—"} · {o.rank}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function FileDrop({ files, error, onAdd, onRemove }: { files: File[]; error: string | null; onAdd: (f: FileList | null) => void; onRemove: (i: number) => void }) {
  const [over, setOver] = useState(false);
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-ink">Screenshots or documents</p>
      <label
        onDragOver={(e) => (e.preventDefault(), setOver(true))}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => (e.preventDefault(), setOver(false), onAdd(e.dataTransfer.files))}
        className={cn("flex cursor-pointer flex-col items-center gap-1 rounded-md border border-dashed border-line-strong bg-surface-2 px-4 py-5 text-center text-xs text-muted transition-colors focus-within:border-gold-ink hover:border-ink/30", over && "border-gold-ink bg-gold/5")}
      >
        <FileImage className="size-5 text-ink-2" aria-hidden />
        <span>
          <span className="font-semibold text-ink">Choose files</span> or drop them here
        </span>
        <span>PNG, JPEG, WebP or PDF · up to 3 files · 5 MB each</span>
        <input type="file" multiple accept={PUBLIC_FILE_TYPES.join(",")} className="sr-only" onChange={(e) => (onAdd(e.target.files), (e.target.value = ""))} />
      </label>
      {error ? (
        <p role="alert" className="text-2xs font-medium text-red">
          {error}
        </p>
      ) : null}
      {files.length ? (
        <ul className="divide-y divide-line rounded-md border border-line text-xs">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="min-w-0 truncate">{f.name}</span>
              <span className="flex shrink-0 items-center gap-2 text-muted tabular">
                {(f.size / 1024 / 1024).toFixed(1)} MB
                <Button type="button" size="xs" variant="ghost" aria-label={`Remove ${f.name}`} onClick={() => onRemove(i)} icon={<X className="size-3.5" />} />
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <p className="text-2xs font-medium text-muted">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-md border border-line-strong bg-surface px-3 py-2 font-mono text-sm text-ink">{value}</code>
        <Button
          type="button"
          size="md"
          variant="secondary"
          aria-label={`Copy ${label.toLowerCase()}`}
          onClick={() => void navigator.clipboard?.writeText(value).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}
          icon={copied ? <Check className="size-4" /> : <Copy className="size-4" />}
        />
      </div>
    </div>
  );
}

function Receipt({ result, inHq }: { result: Extract<SubmitResult, { ok: true }>; inHq: boolean }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-line bg-surface p-6 shadow-sm">
        <p className="text-xs font-semibold text-green">Complaint received</p>
        <h2 ref={heading} tabIndex={-1} className="display mt-1 text-2xl font-bold outline-none">
          Save your tracking details now
        </h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-ink-2">Your complaint was logged and Internal Affairs has been alerted. The tracking code is shown only once. Anyone with both values can see the status of this complaint, so keep them private.</p>
        <div className="mt-5 grid gap-4">
          <CopyValue label="Case reference" value={result.reference} />
          <CopyValue label="Tracking code" value={result.token} />
        </div>
        {result.files.received > result.files.stored ? (
          <p role="status" className="mt-4 rounded-md border border-amber/40 bg-amber-soft p-3 text-xs text-ink">
            {result.files.received - result.files.stored} of {result.files.received} files could not be stored. Your complaint was still received; share those files with Internal Affairs if they contact you, or add links instead.
          </p>
        ) : null}
      </div>
      <div className="text-sm leading-relaxed text-ink-2">
        <h3 className="font-semibold text-ink">What happens next</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5">
          <li>Internal Affairs reviews the complaint and preserves evidence, including bodycam footage the same day.</li>
          <li>The Director assigns an investigator who has no conflict of interest.</li>
          <li>Findings are reviewed and decided by department leadership. Investigation details stay confidential.</li>
        </ol>
      </div>
      <div className="flex flex-wrap gap-3">
        <Link href="/report/status" className={buttonClass("secondary", "md")}>
          Check status later
        </Link>
        <Link href={inHq ? "/hq" : "/"} className={buttonClass("ghost", "md")}>
          {inHq ? "Back to Headquarters" : "Back to homepage"}
        </Link>
      </div>
    </div>
  );
}
