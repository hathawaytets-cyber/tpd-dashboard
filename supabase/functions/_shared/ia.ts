/**
 * Internal Affairs intake rules shared by the ia-intake Edge Function and the website form.
 * The database validates everything again (supabase/migrations/20261113000000_internal_affairs.sql);
 * this module exists so the browser can show the same rules and the function can reject early.
 * No third-party imports (runs under Deno and Vitest).
 */

/** IA SOP §3 scope. Keys match tpd.ia_categories(). */
export const IA_CATEGORIES = [
  { key: "use_of_force", label: "Use of force", hint: "Force used during a stop, arrest or other contact." },
  { key: "deadly_force", label: "Use of deadly force", hint: "Any use of deadly force or a shooting." },
  { key: "dishonesty", label: "Dishonesty", hint: "False statements, reports or evidence." },
  { key: "abuse_of_authority", label: "Abuse of authority", hint: "Threats, unlawful orders, misuse of police powers." },
  { key: "uof_policy", label: "Use of Force Policy violation", hint: "Conduct that may break the Use of Force Policy." },
  { key: "handbook_policy", label: "Personnel Handbook violation", hint: "Conduct that may break the Personnel Handbook." },
  { key: "public_conduct", label: "Conduct toward the public", hint: "Rudeness, discrimination or unprofessional behavior." },
  { key: "other", label: "Something else", hint: "Anything that does not fit the categories above." },
] as const;
export type IaCategory = (typeof IA_CATEGORIES)[number]["key"];
const CATEGORY_KEYS = new Set<string>(IA_CATEGORIES.map((c) => c.key));

export const LIMITS = {
  summary: [5, 200],
  description: [20, 8000],
  location: 200,
  incidentTime: 40,
  officer: 120,
  witnesses: 4000,
  name: 120,
  contact: 200,
  links: 10,
  linkLength: 500,
  /** Public uploads: images and PDFs only. Video goes in as a link (keeps abuse and storage cost down). */
  publicFiles: 3,
  publicFileBytes: 5 * 1024 * 1024,
  staffFileBytes: 25 * 1024 * 1024,
} as const;

export const PUBLIC_FILE_TYPES = ["image/png", "image/jpeg", "image/webp", "application/pdf"] as const;
export const STAFF_FILE_TYPES = [...PUBLIC_FILE_TYPES, "video/mp4", "video/webm"] as const;

export interface ComplaintInput {
  category: string;
  summary: string;
  description: string;
  incidentDate?: string | null;
  incidentTime?: string | null;
  location?: string | null;
  officer?: string | null;
  officerId?: string | null;
  witnesses?: string | null;
  evidenceLinks?: string[];
  anonymous: boolean;
  name?: string | null;
  contact?: string | null;
  referral?: boolean;
}

export type FieldErrors = Partial<Record<keyof ComplaintInput | "form", string>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// Control characters other than tab/newline are never legitimate in a complaint.
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

export function isHttpsLink(s: string): boolean {
  if (s.length > LIMITS.linkLength || /\s/.test(s)) return false;
  try {
    const u = new URL(s);
    return u.protocol === "https:" && !!u.hostname && !u.username && !u.password;
  } catch {
    return false;
  }
}

/** Validates and normalizes a complaint. `today` is injectable for tests. */
export function validateComplaint(raw: unknown, today = new Date()): { ok: true; value: ComplaintInput } | { ok: false; errors: FieldErrors } {
  const errors: FieldErrors = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: { form: "The complaint could not be read." } };
  const r = raw as Record<string, unknown>;
  const anonymous = r.anonymous === true;
  const v: ComplaintInput = {
    category: str(r.category),
    summary: str(r.summary),
    description: str(r.description),
    incidentDate: str(r.incidentDate) || null,
    incidentTime: str(r.incidentTime) || null,
    location: str(r.location) || null,
    officer: str(r.officer) || null,
    officerId: str(r.officerId) || null,
    witnesses: str(r.witnesses) || null,
    evidenceLinks: Array.isArray(r.evidenceLinks) ? r.evidenceLinks.map(str).filter(Boolean) : [],
    anonymous,
    name: anonymous ? null : str(r.name) || null,
    contact: anonymous ? null : str(r.contact) || null,
    referral: r.referral === true,
  };
  if (!CATEGORY_KEYS.has(v.category)) errors.category = "Choose a category.";
  if (v.summary.length < LIMITS.summary[0] || v.summary.length > LIMITS.summary[1]) errors.summary = `Use ${LIMITS.summary[0]}–${LIMITS.summary[1]} characters.`;
  if (v.description.length < LIMITS.description[0] || v.description.length > LIMITS.description[1])
    errors.description = `Describe what happened in ${LIMITS.description[0]}–${LIMITS.description[1].toLocaleString("en-US")} characters.`;
  if (v.incidentDate) {
    const d = DATE.test(v.incidentDate) ? new Date(`${v.incidentDate}T00:00:00Z`) : null;
    const max = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() + 1);
    const min = max - 366 * 86_400_000;
    if (!d || Number.isNaN(d.getTime()) || d.getTime() > max || d.getTime() < min) errors.incidentDate = "Enter a date within the last year.";
  }
  if ((v.incidentTime?.length ?? 0) > LIMITS.incidentTime) errors.incidentTime = "Keep the time short, for example “around 9 PM”.";
  if ((v.location?.length ?? 0) > LIMITS.location) errors.location = `Use at most ${LIMITS.location} characters.`;
  if ((v.officer?.length ?? 0) > LIMITS.officer) errors.officer = `Use at most ${LIMITS.officer} characters.`;
  if (v.officerId && !UUID.test(v.officerId)) errors.officerId = "Choose the officer from the list.";
  if ((v.witnesses?.length ?? 0) > LIMITS.witnesses) errors.witnesses = `Use at most ${LIMITS.witnesses.toLocaleString("en-US")} characters.`;
  if ((v.name?.length ?? 0) > LIMITS.name) errors.name = `Use at most ${LIMITS.name} characters.`;
  if ((v.contact?.length ?? 0) > LIMITS.contact) errors.contact = `Use at most ${LIMITS.contact} characters.`;
  if ((v.evidenceLinks?.length ?? 0) > LIMITS.links) errors.evidenceLinks = `Add at most ${LIMITS.links} links.`;
  else if (v.evidenceLinks?.some((l) => !isHttpsLink(l))) errors.evidenceLinks = "Each link must start with https://.";
  for (const k of ["summary", "description", "location", "officer", "witnesses", "name", "contact", "incidentTime"] as const) {
    if (typeof v[k] === "string" && CONTROL.test(v[k] as string)) errors[k] = "Remove unsupported characters.";
  }
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, value: v };
}

/** File type by content, never by the name or the browser-supplied type. */
export function sniffMime(bytes: Uint8Array): string | null {
  const at = (i: number, ...sig: number[]) => sig.every((b, j) => bytes[i + j] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return "image/png";
  if (at(0, 0xff, 0xd8, 0xff)) return "image/jpeg";
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return "image/webp";
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return "application/pdf";
  if (at(4, 0x66, 0x74, 0x79, 0x70)) return "video/mp4";
  if (at(0, 0x1a, 0x45, 0xdf, 0xa3)) return "video/webm";
  return null;
}

export const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

export const toHex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");

export async function sha256Bytes(data: Uint8Array | string): Promise<Uint8Array> {
  const buf = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest("SHA-256", buf as BufferSource));
}

/** 256-bit random tracking token, base64url. Shown to the complainant once; only its SHA-256 is stored. */
export function newTrackingToken(): string {
  const b = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const REFERENCE_PATTERN = /^TPD-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;

/** Rate-limit key: HMAC of the caller's address with a server secret, so no raw address is stored. */
export async function clientKey(pepper: string, address: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pepper), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return toHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(address || "unknown"))));
}

/** The complainant-facing status words. Nothing finer is ever shown publicly. */
export const RECEIPT_STATUS: Record<string, { label: string; body: string }> = {
  received: { label: "Received", body: "Your complaint was logged and is waiting for review by Internal Affairs." },
  under_review: { label: "Under review", body: "Internal Affairs is reviewing your complaint. Investigations are confidential." },
  closed: { label: "Closed", body: "Internal Affairs has closed this complaint." },
};
