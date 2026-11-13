/**
 * POST /functions/v1/ia-intake
 *
 * Public Internal Affairs complaint intake and private receipt lookup. Works without
 * Discord sign-in; a signed-in member may also use it (their identity and the officer
 * they pick are verified server-side).
 *
 *   JSON {"action":"status","reference","token"}         → coarse receipt status only
 *   JSON {"action":"submit", ...complaint}                → new complaint
 *   multipart/form-data: complaint=<JSON>, evidence=<file> (up to 3 images/PDFs, 5 MB each)
 *
 * Security:
 *   * Writes only through tpd.ia_intake_submit / ia_intake_attach / ia_receipt_status
 *     (service role, never granted to anon or authenticated).
 *   * Rate limits in the database, keyed by an HMAC of the caller's address
 *     (IA_INTAKE_PEPPER); no raw address is stored.
 *   * Honeypot field, optional Cloudflare Turnstile (TURNSTILE_SECRET), strict validation.
 *   * The tracking token is random (256 bits), returned once and stored only as SHA-256.
 *   * Files are checked by content, stored in the private tpd-ia-evidence bucket and never
 *     given a public URL.
 *   * Errors never echo database messages, case numbers or whether a reference exists.
 */

import { fetchWithRetry } from "./http.ts";
import {
  clientKey,
  EXT,
  LIMITS,
  newTrackingToken,
  PUBLIC_FILE_TYPES,
  REFERENCE_PATTERN,
  sha256Bytes,
  sniffMime,
  TOKEN_PATTERN,
  toHex,
  validateComplaint,
} from "./ia.ts";
import { bearer, client, cors, DB_SCHEMA, type Env, HttpError, json } from "./supabase.ts";

export const BUCKET = "tpd-ia-evidence";
const MAX_MULTIPART_BYTES = LIMITS.publicFiles * LIMITS.publicFileBytes + 64 * 1024;
const MAX_JSON_BYTES = 48 * 1024;

const GENERIC = "We could not accept this complaint. Check the highlighted fields and try again.";

/** Calls a service-only RPC and returns status + parsed body (the shared client hides error codes). */
export async function serviceRpc(env: Env, fn: string, args: Record<string, unknown>) {
  const url = env.get("SUPABASE_URL")!;
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const res = await fetchWithRetry(
    `${url}/rest/v1/rpc/${fn}`,
    {
      method: "POST",
      headers: { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json", "content-profile": DB_SCHEMA, "accept-profile": DB_SCHEMA },
      body: JSON.stringify(args),
    },
    { attempts: 1 },
  );
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, body: body as Record<string, unknown> | null };
}

export function callerAddress(req: Request): string {
  return req.headers.get("cf-connecting-ip") ?? req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

const bytea = (b: Uint8Array) => `\\x${toHex(b)}`;

async function verifyTurnstile(env: Env, token: unknown, address: string): Promise<boolean> {
  const secret = env.get("TURNSTILE_SECRET");
  if (!secret) return true; // optional; documented in docs/INTERNAL_AFFAIRS.md
  if (typeof token !== "string" || token.length > 2048) return false;
  try {
    const res = await fetchWithRetry(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ secret, response: token, remoteip: address }) },
      { attempts: 2 },
    );
    const b = await res.json();
    return b?.success === true;
  } catch {
    return false;
  }
}

async function readRequest(req: Request): Promise<{ payload: Record<string, unknown>; files: File[] }> {
  const type = req.headers.get("content-type") ?? "";
  const declared = Number(req.headers.get("content-length"));
  if (type.startsWith("multipart/form-data")) {
    if (Number.isFinite(declared) && declared > MAX_MULTIPART_BYTES) throw new HttpError(413, "The attachments are too large. Each file can be up to 5 MB.");
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new HttpError(400, GENERIC);
    }
    const raw = form.get("complaint");
    if (typeof raw !== "string" || raw.length > MAX_JSON_BYTES) throw new HttpError(400, GENERIC);
    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new HttpError(400, GENERIC);
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new HttpError(400, GENERIC);
    const files = form.getAll("evidence").filter((f): f is File => typeof f === "object" && f !== null && "arrayBuffer" in f);
    if (files.length > LIMITS.publicFiles) throw new HttpError(400, `Attach at most ${LIMITS.publicFiles} files.`);
    return { payload: payload as Record<string, unknown>, files };
  }
  if (Number.isFinite(declared) && declared > MAX_JSON_BYTES) throw new HttpError(413, GENERIC);
  const text = await req.text();
  if (new TextEncoder().encode(text).length > MAX_JSON_BYTES) throw new HttpError(413, GENERIC);
  try {
    const v = JSON.parse(text);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    return { payload: v, files: [] };
  } catch {
    throw new HttpError(400, GENERIC);
  }
}

async function storeFile(env: Env, path: string, bytes: Uint8Array, mime: string) {
  const res = await fetchWithRetry(
    `${env.get("SUPABASE_URL")}/storage/v1/object/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: { apikey: env.get("SUPABASE_SERVICE_ROLE_KEY")!, authorization: `Bearer ${env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "content-type": mime, "x-upsert": "false" },
      body: bytes as BodyInit,
    },
    { attempts: 2, timeoutMs: 30_000 },
  );
  return res.ok;
}

export function iaIntakeHandler(env: Env) {
  return async (req: Request): Promise<Response> => {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, h);
    try {
      const pepper = env.get("IA_INTAKE_PEPPER");
      if (!env.get("SUPABASE_URL") || !env.get("SUPABASE_SERVICE_ROLE_KEY") || !env.get("SUPABASE_ANON_KEY") || !pepper || pepper.length < 32)
        throw new HttpError(503, "Complaint intake is not available right now.");
      const address = callerAddress(req);
      const key = await clientKey(pepper, address);
      const { payload, files } = await readRequest(req);

      // ---- private receipt lookup
      if (payload.action === "status") {
        const reference = typeof payload.reference === "string" ? payload.reference.trim().toUpperCase() : "";
        const token = typeof payload.token === "string" ? payload.token.trim() : "";
        if (!REFERENCE_PATTERN.test(reference) || !TOKEN_PATTERN.test(token)) return json({ found: false }, 200, h);
        const r = await serviceRpc(env, "ia_receipt_status", { p_reference: reference, p_token_hash: bytea(await sha256Bytes(token)), p_client_key: key });
        if (r.body?.code === "P0429" || String(r.body?.message ?? "").includes("rate_limited")) throw new HttpError(429, "Too many lookups. Try again in an hour.");
        if (r.status !== 200 || !r.body) throw new HttpError(502, "The status could not be checked right now.");
        return json(r.body, 200, h);
      }

      if (payload.action !== "submit") throw new HttpError(400, GENERIC);
      // Honeypot: real people never fill the hidden "website" field. Answer like a success would, store nothing.
      if (typeof payload.website === "string" && payload.website.trim() !== "") return json({ accepted: false }, 400, h);
      if (!(await verifyTurnstile(env, payload.challenge, address))) throw new HttpError(400, "Please complete the verification and try again.");

      const checked = validateComplaint(payload);
      if (!checked.ok) return json({ error: GENERIC, fields: checked.errors }, 400, h);

      // Optional signed-in member. The anon key or no header = a public complaint.
      let userId: string | null = null;
      const jwt = bearer(req);
      if (jwt && jwt !== env.get("SUPABASE_ANON_KEY")) {
        userId = (await client(env).user(jwt)).id; // 401 for an invalid or expired session
      }
      const body = { ...checked.value };
      if (!userId) {
        body.officerId = null; // a public form can only name an officer in words
        body.referral = false;
      }

      // Read and check files before anything is stored.
      const accepted: { bytes: Uint8Array; mime: string }[] = [];
      for (const f of files) {
        if (f.size === 0 || f.size > LIMITS.publicFileBytes) throw new HttpError(400, "Each file must be an image or PDF of up to 5 MB.");
        const bytes = new Uint8Array(await f.arrayBuffer());
        const mime = sniffMime(bytes);
        if (!mime || !(PUBLIC_FILE_TYPES as readonly string[]).includes(mime)) throw new HttpError(400, "Each file must be an image (PNG, JPEG, WebP) or a PDF. Share videos as links.");
        accepted.push({ bytes, mime });
      }

      const token = newTrackingToken();
      const r = await serviceRpc(env, "ia_intake_submit", { p: body, p_client_key: key, p_user: userId, p_token_hash: bytea(await sha256Bytes(token)) });
      if (r.body?.code === "P0429" || String(r.body?.message ?? "").includes("rate_limited")) throw new HttpError(429, "Too many complaints from this connection. Try again later.");
      if (r.status === 400 && r.body?.code === "22023") return json({ error: GENERIC }, 400, h);
      if (r.status !== 200 || !r.body?.reference || !r.body?.case_id) throw new HttpError(502, "Your complaint could not be saved. Nothing was submitted; please try again.");
      const caseId = String(r.body.case_id);

      let stored = 0;
      for (const f of accepted) {
        const path = `intake/${caseId}/${crypto.randomUUID()}.${EXT[f.mime]}`;
        if (!(await storeFile(env, path, f.bytes, f.mime))) continue;
        const a = await serviceRpc(env, "ia_intake_attach", {
          p_case: caseId, p_path: path, p_mime: f.mime, p_size: f.bytes.byteLength, p_sha256: toHex(await sha256Bytes(f.bytes)), p_description: "Submitted with the complaint",
        });
        if (a.status === 200) stored++;
      }

      return json({ reference: r.body.reference, token, files: { received: files.length, stored } }, 201, h);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof HttpError ? e.message : "Your complaint could not be saved. Nothing was submitted; please try again.";
      if (!(e instanceof HttpError)) console.error("ia-intake", (e as Error).name); // never log bodies
      return json({ error: message }, status, h);
    }
  };
}
