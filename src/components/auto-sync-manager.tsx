"use client";

import { useEffect, useRef } from "react";
import { toast } from "sonner";

const SYNC_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
const INITIAL_DELAY_MS = 30 * 1000;      // 30 seconds after mount
const POLL_INTERVAL_MS = 3_000;          // poll status every 3 seconds while running

export function AutoSyncManager() {
  const syncingRef = useRef(false);

  useEffect(() => {
    if (process.env.NEXT_PUBLIC_DEMO_MODE === "true") return;

    async function runSync() {
      if (syncingRef.current) return;
      syncingRef.current = true;

      try {
        // Kick off the sync — server responds immediately (fire-and-forget on the server)
        const startRes = await fetch("/api/auto-sync", { method: "POST" });
        if (!startRes.ok) {
          console.error("Auto-sync start failed:", startRes.status);
          syncingRef.current = false;
          return;
        }

        const startData = await startRes.json();

        // If a sync was already running on the server, just wait for it to finish
        if (startData.running && !startData.started) {
          // Another process already running — skip this cycle
          syncingRef.current = false;
          return;
        }

        // Poll until the server reports the sync is done
        while (syncingRef.current) {
          await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));

          const statusRes = await fetch("/api/auto-sync");
          if (!statusRes.ok) break;

          const status = await statusRes.json();

          if (!status.running) {
            if (status.error) {
              console.error("Auto-sync error:", status.error);
            } else {
              const results: { success: boolean }[] = status.results || [];
              const successCount = results.filter((r) => r.success).length;
              if (results.length > 0) {
                toast.info(
                  `Auto-sync: ${successCount}/${results.length} proveedores actualizados`,
                  { duration: 4000 }
                );
              }
            }
            break;
          }
        }
      } catch (err) {
        console.error("Auto-sync error:", err);
      } finally {
        syncingRef.current = false;
      }
    }

    const initialTimeout = setTimeout(runSync, INITIAL_DELAY_MS);
    const interval = setInterval(runSync, SYNC_INTERVAL_MS);

    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, []);

  return null;
}
