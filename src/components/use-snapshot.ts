"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { demoSnapshot } from "@/lib/demo-snapshot";
import type { StudyRegion } from "@/lib/regions";
import { parseSnapshot, type DataMode, type Snapshot } from "@/lib/snapshot";

type State = {
  key: string;
  snapshot: Snapshot | null;
  loading: boolean;
  failed: boolean;
};

export function useSnapshot(
  region: StudyRegion,
  mode: DataMode,
  refresh: number,
) {
  const key = `pyro-snapshot-v1:${region.id}:${region.boundaryVersion}`;
  const [state, setState] = useState<State>({
    key: "",
    snapshot: null,
    loading: true,
    failed: false,
  });
  const memory = useRef(new Map<string, Snapshot>());
  useEffect(() => {
    if (mode === "demo") return;
    const controller = new AbortController();
    let cancelled = false;
    let cached: Snapshot | null = memory.current.get(key) || null;
    try {
      const stored = localStorage.getItem(key);
      if (stored && !cached)
        cached = parseSnapshot(JSON.parse(stored), region, "operational");
    } catch {
      /* Ignore invalid/obsolete cache; never substitute demo data. */
    }
    setState({ key, snapshot: cached, loading: true, failed: false });
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch(`/api/snapshots?region=${encodeURIComponent(region.id)}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then(async (response) => {
        if (!response.ok) throw new Error("Snapshot unavailable");
        const snapshot = parseSnapshot(
          await response.json(),
          region,
          "operational",
        );
        if (snapshot.status === "unavailable")
          throw new Error("Unavailable analysis run");
        if (cancelled) return;
        memory.current.set(key, snapshot);
        setState({ key, snapshot, loading: false, failed: false });
        try {
          localStorage.setItem(key, JSON.stringify(snapshot));
        } catch {
          /* Analytics still work without storage. */
        }
      })
      .catch(() => {
        // An old region request must not overwrite the next region's state.
        if (!cancelled)
          setState({ key, snapshot: cached, loading: false, failed: true });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [region, mode, key, refresh]);

  const demo = useMemo(() => demoSnapshot(region.id), [region.id]);
  if (mode === "demo") return { snapshot: demo, loading: false, failed: false };
  return state.key === key
    ? state
    : { snapshot: null, loading: true, failed: false };
}
