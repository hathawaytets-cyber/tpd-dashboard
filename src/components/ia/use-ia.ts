"use client";

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/backend/auth";
import { ia } from "@/lib/ia/client";
import type { IaAccess } from "@/lib/ia/model";
import { PREVIEW_ACCESS } from "@/lib/ia/preview";

let cached: { key: string; value: IaAccess } | null = null;

/**
 * The signed-in member's IA access as the database reports it (ia_my_access). Used only to shape navigation and
 * screens: every IA read and action is authorized again in the database. Preview build: a labelled fictional Director.
 */
export function useIaAccess(): { access: IaAccess | null; preview: boolean; reload: () => void } {
  const auth = useAuth();
  const preview = auth.status === "disabled";
  const key = auth.membership?.state === "verified" ? (auth.membership.member?.id ?? "") : "";
  const [access, setAccess] = useState<IaAccess | null>(preview ? PREVIEW_ACCESS : cached?.key === key ? cached.value : null);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (preview) return setAccess(PREVIEW_ACCESS);
    if (!key) return setAccess(null);
    let alive = true;
    ia.access()
      .then((a) => {
        cached = { key, value: a };
        if (alive) setAccess(a);
      })
      .catch(() => alive && setAccess(null));
    return () => {
      alive = false;
    };
  }, [preview, key, n]);
  const reload = useCallback(() => setN((x) => x + 1), []);
  return { access, preview, reload };
}

/** Small async-action helper: one action at a time, error text kept for display. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The action failed.");
      return undefined;
    } finally {
      setBusy(false);
    }
  }, []);
  return { busy, error, setError, run };
}
