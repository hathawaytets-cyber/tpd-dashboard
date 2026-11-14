"use client";

import { useCallback, useEffect, useState } from "react";
import { backendConfigured } from "@/lib/backend/config";
import { demoEvaluations } from "./demo";
import { liveEvaluations } from "./live";
import type { EvaluationsApi, MyOverview } from "./types";

export * from "./types";
export * from "./rules";

/** The Supabase backend in live builds; the labelled browser-only preview otherwise. Never both. */
export function evaluationsApi(): EvaluationsApi {
  return backendConfigured ? liveEvaluations : demoEvaluations;
}

export function errorMessage(e: unknown, fallback = "Something went wrong. Nothing was saved.") {
  return e instanceof Error && e.message ? e.message : fallback;
}

/**
 * The signed-in supervisor's reporting duties. Status is computed server-side when read, so reminders derived from it
 * never duplicate: there is one item per open patrol day, not one per reminder sent.
 */
export function useMyEvaluations(enabled = true, refreshMs = 5 * 60_000) {
  const [data, setData] = useState<MyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      setData(await evaluationsApi().overview());
      setError(null);
    } catch (e) {
      setError(errorMessage(e, "Your reporting status could not be loaded."));
    }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    void reload();
    const t = setInterval(() => void reload(), refreshMs);
    const onChange = () => void reload();
    window.addEventListener("tpd-dpe-change", onChange);
    return () => {
      clearInterval(t);
      window.removeEventListener("tpd-dpe-change", onChange);
    };
  }, [enabled, refreshMs, reload]);
  return { data, error, reload };
}

/** Open duties that need the supervisor now: today's report and anything not submitted or excused. */
export function openDuties(o: MyOverview | null) {
  if (!o) return [];
  return o.rows.filter((r) => r.status === "not_started" || r.status === "draft" || r.status === "overdue");
}
