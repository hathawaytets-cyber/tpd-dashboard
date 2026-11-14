/** Public Internal Affairs complaint intake and receipt lookup. See ../_shared/fn-ia-intake.ts. */
import { iaIntakeHandler } from "../_shared/fn-ia-intake.ts";

Deno.serve(iaIntakeHandler({ get: (k) => Deno.env.get(k) }));
