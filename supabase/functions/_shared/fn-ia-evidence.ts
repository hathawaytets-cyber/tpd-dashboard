/**
 * POST /functions/v1/ia-evidence   (Internal Affairs staff only)
 *
 *   multipart/form-data: caseId, kind, description, file   → stores a file on a case
 *   JSON {"action":"download","evidenceId"}                 → 60-second signed URL
 *
 * The caller's own session decides access: the function first asks the database, as
 * the caller, whether they may work on (upload) or read (download) the case
 * (tpd.ia_evidence_upload_check / ia_evidence_download_check, which also write the IA
 * audit event). Only then does it use the service role to touch the private
 * tpd-ia-evidence bucket. The bucket has no public access and no storage policies for
 * signed-in users, so a leaked object path is useless without this function.
 */

import { fetchWithRetry } from "./http.ts";
import { EXT, LIMITS, sha256Bytes, sniffMime, STAFF_FILE_TYPES, toHex } from "./ia.ts";
import { BUCKET } from "./fn-ia-intake.ts";
import { bearer, client, cors, DB_SCHEMA, type Env, HttpError, json } from "./supabase.ts";

const KINDS = new Set(["bodycam", "anchorcad_record", "report", "screenshot", "video", "recording", "document", "other"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SIGNED_URL_SECONDS = 60;

async function asUserRpc(env: Env, jwt: string, fn: string, args: Record<string, unknown>) {
  const res = await fetchWithRetry(
    `${env.get("SUPABASE_URL")}/rest/v1/rpc/${fn}`,
    {
      method: "POST",
      headers: { apikey: env.get("SUPABASE_ANON_KEY")!, authorization: `Bearer ${jwt}`, "content-type": "application/json", "content-profile": DB_SCHEMA, "accept-profile": DB_SCHEMA },
      body: JSON.stringify(args),
    },
    { attempts: 1 },
  );
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

function storage(env: Env) {
  const base = `${env.get("SUPABASE_URL")}/storage/v1`;
  const key = env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const headers = { apikey: key, authorization: `Bearer ${key}` };
  return {
    put: (path: string, bytes: Uint8Array, mime: string) =>
      fetchWithRetry(`${base}/object/${BUCKET}/${path}`, { method: "POST", headers: { ...headers, "content-type": mime, "x-upsert": "false" }, body: bytes as BodyInit }, { attempts: 2, timeoutMs: 60_000 }),
    remove: (path: string) => fetchWithRetry(`${base}/object/${BUCKET}`, { method: "DELETE", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ prefixes: [path] }) }, { attempts: 2 }),
    sign: async (path: string) => {
      const res = await fetchWithRetry(`${base}/object/sign/${BUCKET}/${path}`, { method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ expiresIn: SIGNED_URL_SECONDS }) }, { attempts: 2 });
      if (!res.ok) throw new HttpError(502, "The file could not be opened right now.");
      const b = await res.json();
      if (typeof b?.signedURL !== "string") throw new HttpError(502, "The file could not be opened right now.");
      return `${env.get("SUPABASE_URL")}/storage/v1${b.signedURL}`;
    },
  };
}

export function iaEvidenceHandler(env: Env) {
  return async (req: Request): Promise<Response> => {
    const h = cors(env, req);
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
    if (req.method !== "POST") return json({ error: "Method not allowed" }, 405, h);
    try {
      if (!env.get("SUPABASE_URL") || !env.get("SUPABASE_SERVICE_ROLE_KEY") || !env.get("SUPABASE_ANON_KEY")) throw new HttpError(503, "Evidence storage is not configured.");
      // Authenticate before reading the body.
      const jwt = bearer(req);
      if (!jwt || jwt === env.get("SUPABASE_ANON_KEY")) throw new HttpError(401, "Sign in required");
      await client(env).user(jwt);
      const type = req.headers.get("content-type") ?? "";
      const declared = Number(req.headers.get("content-length"));

      if (type.startsWith("application/json")) {
        if (Number.isFinite(declared) && declared > 4096) throw new HttpError(413, "Request body too large");
        let body: Record<string, unknown>;
        try {
          body = JSON.parse((await req.text()).slice(0, 4096));
        } catch {
          throw new HttpError(400, "Request body must be valid JSON");
        }
        if (body?.action !== "download" || typeof body.evidenceId !== "string" || !UUID.test(body.evidenceId)) throw new HttpError(400, "Unknown request");
        const r = await asUserRpc(env, jwt, "ia_evidence_download_check", { p_evidence: body.evidenceId });
        if (r.status !== 200 || typeof r.body !== "string") throw new HttpError(403, "Evidence unavailable");
        return json({ url: await storage(env).sign(r.body), expiresIn: SIGNED_URL_SECONDS }, 200, h);
      }

      if (!type.startsWith("multipart/form-data")) throw new HttpError(415, "Unsupported request");
      if (Number.isFinite(declared) && declared > LIMITS.staffFileBytes + 64 * 1024) throw new HttpError(413, "Files can be up to 25 MB.");
      const form = await req.formData().catch(() => {
        throw new HttpError(400, "The upload could not be read.");
      });
      const caseId = String(form.get("caseId") ?? "");
      const kind = String(form.get("kind") ?? "");
      const description = String(form.get("description") ?? "").trim();
      const file = form.get("file");
      if (!UUID.test(caseId) || !KINDS.has(kind) || description.length < 3 || description.length > 1000) throw new HttpError(400, "Describe the file and choose its type.");
      if (!file || typeof file !== "object" || !("arrayBuffer" in file)) throw new HttpError(400, "Choose a file.");
      const f = file as File;
      if (f.size === 0 || f.size > LIMITS.staffFileBytes) throw new HttpError(400, "Files can be up to 25 MB.");

      const check = await asUserRpc(env, jwt, "ia_evidence_upload_check", { p_case: caseId });
      if (check.status !== 200 || check.body !== true) throw new HttpError(403, "Case unavailable");

      const bytes = new Uint8Array(await f.arrayBuffer());
      const mime = sniffMime(bytes);
      if (!mime || !(STAFF_FILE_TYPES as readonly string[]).includes(mime)) throw new HttpError(400, "Upload an image, PDF, MP4 or WebM file.");
      const path = `cases/${caseId}/${crypto.randomUUID()}.${EXT[mime]}`;
      const s = storage(env);
      const put = await s.put(path, bytes, mime);
      if (!put.ok) throw new HttpError(502, "The file could not be stored. Nothing was added to the case.");
      const attach = await asUserRpc(env, jwt, "ia_evidence_staff_attach", {
        p_case: caseId, p_path: path, p_mime: mime, p_size: bytes.byteLength, p_sha256: toHex(await sha256Bytes(bytes)), p_description: description, p_kind: kind,
      });
      if (attach.status !== 200) {
        await s.remove(path).catch(() => undefined);
        throw new HttpError(403, "Case unavailable");
      }
      return json({ evidenceId: attach.body }, 201, h);
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      const message = e instanceof HttpError ? e.message : "Internal error";
      if (!(e instanceof HttpError)) console.error("ia-evidence", (e as Error).name);
      return json({ error: message }, status, h);
    }
  };
}
