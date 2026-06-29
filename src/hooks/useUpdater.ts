import { check, type Update } from "@tauri-apps/plugin-updater";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

export interface UpdateState {
  available: boolean;
  version: string | null;
  notes: string | null; // release notes / changelog for the pending version
  downloading: boolean;
  progress: number; // 0-100
  ready: boolean;
  error: string | null;
}

const INITIAL: UpdateState = {
  available: false,
  version: null,
  notes: null,
  downloading: false,
  progress: 0,
  ready: false,
  error: null,
};

/**
 * Checks for updates on mount (once) and provides install/relaunch helpers.
 * Non-blocking - runs in background, never interrupts the user's work.
 * Only shows UI when a genuine update is found. The resolved Update object is
 * cached so install() does not trigger a second network check.
 */
export function useUpdater() {
  const [state, setState] = useState<UpdateState>(INITIAL);
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    let cancelled = false;
    // Wait 5 seconds after app start before checking - let the user settle in
    const timer = setTimeout(async () => {
      try {
        const update = await check();
        if (cancelled || !update) return;
        updateRef.current = update;
        setState((s) => ({
          ...s,
          available: true,
          version: update.version,
          notes: update.body ?? null,
        }));
      } catch (e) {
        // Not user-relevant, but log so a persistently failing updater is
        // visible during a 24/7 run instead of silently swallowed.
        console.warn("Update-Check fehlgeschlagen:", e);
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
      const update = updateRef.current ?? (await check());
      if (!update) {
        setState((s) => ({ ...s, downloading: false }));
        return;
      }
      updateRef.current = update;

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
      console.error("Update-Installation fehlgeschlagen:", e);
      setState((s) => ({
        ...s,
        downloading: false,
        error: e instanceof Error ? e.message : String(e),
      }));
    }
  }, []);

  const restart = useCallback(async () => {
    try {
      await invoke("relaunch_app");
    } catch (e) {
      console.error("Neustart nach Update fehlgeschlagen:", e);
      // Fallback: just tell user to restart manually
      setState((s) => ({
        ...s,
        error: "Bitte die App manuell schließen und neu starten.",
      }));
    }
  }, []);

  const dismiss = useCallback(() => {
    setState((s) => ({ ...s, available: false }));
  }, []);

  return { ...state, install, restart, dismiss };
}
