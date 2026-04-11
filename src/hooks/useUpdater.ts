import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { useCallback, useEffect, useState } from "react";

export interface UpdateState {
  available: boolean;
  version: string | null;
  downloading: boolean;
  progress: number; // 0-100
  ready: boolean;
  error: string | null;
}

const INITIAL: UpdateState = {
  available: false,
  version: null,
  downloading: false,
  progress: 0,
  ready: false,
  error: null,
};

/**
 * Checks for updates on mount (once) and provides install/relaunch helpers.
 * Non-blocking — runs in background, never interrupts the user's work.
 * Only shows UI when a genuine update is found.
 */
export function useUpdater() {
  const [state, setState] = useState<UpdateState>(INITIAL);

  useEffect(() => {
    let cancelled = false;
    // Wait 5 seconds after app start before checking — let the user settle in
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;
        setState((s) => ({
          ...s,
          available: true,
          version: update.version,
        }));
      } catch {
        // Silent — update check failure is not user-relevant
      }
    }, 5000);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const install = useCallback(async () => {
    setState((s) => ({ ...s, downloading: true, progress: 0, error: null }));
    try {
      const update = await check();
      if (!update) return;

      let downloaded = 0;
      let total = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === "Started" && event.data.contentLength) {
          total = event.data.contentLength;
        }
        if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          setState((s) => ({ ...s, progress: pct }));
        }
        if (event.event === "Finished") {
          setState((s) => ({ ...s, ready: true, downloading: false, progress: 100 }));
        }
      });
    } catch (e: unknown) {
      setState((s) => ({
        ...s,
        downloading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const restart = useCallback(async () => {
    try {
      await relaunch();
    } catch {
      // Fallback: just tell user to restart manually
      setState((s) => ({
        ...s,
        error: "Bitte die App manuell schließen und neu starten.",
      }));
    }
  }, []);

  return { ...state, install, restart };
}
