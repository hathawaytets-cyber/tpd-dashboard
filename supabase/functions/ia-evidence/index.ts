/** Internal Affairs evidence upload and short-lived download links (staff only). See ../_shared/fn-ia-evidence.ts. */
import { iaEvidenceHandler } from "../_shared/fn-ia-evidence.ts";

Deno.serve(iaEvidenceHandler({ get: (k) => Deno.env.get(k) }));
