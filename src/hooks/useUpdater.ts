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

    async function runCheck() {
      try {
        const update = await check();
        if (cancelled || !update) return;
        updateRef.current = update;
        setState((s) =>
          // Einen laufenden Download / fertigen Stand NICHT durch einen
          // Re-Check ueberschreiben.
          s.downloading || s.ready
            ? s
            : { ...s, available: true, version: update.version, notes: update.body ?? null },
        );
      } catch (e) {
        // Not user-relevant, but log so a persistently failing updater is
        // visible during a 24/7 run instead of silently swallowed.
        console.warn("Update-Check fehlgeschlagen:", e);
      }
    }

    // Erst 5s nach Start (Nutzer ankommen lassen), dann periodisch alle 6h,
    // so bemerkt auch eine dauerhaft laufende App ein Update von allein,
    // ohne Neustart und ohne dass jemand etwas anstossen muss.
    const timer = setTimeout(runCheck, 5000);
    const SIX_HOURS = 6 * 60 * 60 * 1000;
    const interval = setInterval(runCheck, SIX_HOURS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
      clearInterval(interval);
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
      const raw = e instanceof Error ? e.message : String(e);
      // Bricht der Nutzer die Windows-UAC-Abfrage ab (Code 1223), ist das kein echter
      // Fehler - nur ein Hinweis, die Abfrage beim naechsten Mal mit Ja zu bestaetigen.
      // Sonst eine ruhige Meldung, niemals den rohen technischen Fehler.
      const uacCancelled = /1223|elevation|cancell|abgebrochen|consent/i.test(raw);
      // macOS ersetzt beim Update das .app-Bundle direkt. Liegt die App per MDM/Admin
      // in /Applications, kann ein Nicht-Admin dort nicht schreiben und downloadAndInstall
      // wirft einen Schreib-/Rechtefehler. Das ist kein generischer Fehlschlag, sondern
      // braucht Administratorrechte - dafuer eine klare Handlungsanweisung statt der
      // irrefuehrenden "spaeter erneut versuchen"-Meldung.
      const needsAdmin =
        /permission denied|read-only file system|read-only file-system|EACCES|EROFS|\/Applications|Operation not permitted|not permitted/i.test(
          raw,
        );
      setState((s) => ({
        ...s,
        downloading: false,
        error: uacCancelled
          ? "Für das Update bitte die Windows-Abfrage einmal mit 'Ja' bestätigen."
          : needsAdmin
            ? "Das Update braucht Administratorrechte. Bitte an die IT wenden oder die App mit Adminrechten aktualisieren."
            : "Update fehlgeschlagen. Bitte später erneut versuchen oder beim Support melden.",
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
