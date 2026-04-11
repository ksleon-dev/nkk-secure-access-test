import { Download, RefreshCw, Sparkles } from "lucide-react";
import type { UpdateState } from "../hooks/useUpdater";
import clsx from "clsx";

interface Props {
  state: UpdateState;
  onInstall: () => void;
  onRestart: () => void;
}

/**
 * Non-intrusive update banner — slides in from top when an update is found.
 * Shows download progress inline, then a restart button.
 * Disappears if no update available.
 */
export function UpdateBanner({ state, onInstall, onRestart }: Props) {
  if (!state.available) return null;

  return (
    <div className="relative z-30 mx-4 mt-1 mb-0 animate-fade-up">
      <div
        className={clsx(
          "rounded-xl px-3 py-2 flex items-center gap-2 text-[11px] font-semibold transition-colors",
          state.ready
            ? "bg-emerald-600 text-white"
            : state.error
            ? "bg-red-600 text-white"
            : "bg-[color:var(--brand-primary)] text-white"
        )}
      >
        {state.ready ? (
          <>
            <Sparkles size={14} />
            <span className="flex-1">
              v{state.version} installiert — Neustart nötig
            </span>
            <button
              onClick={onRestart}
              className="bg-white/20 hover:bg-white/30 rounded-full px-2.5 py-0.5 text-[10px] font-bold transition"
            >
              Jetzt neu starten
            </button>
          </>
        ) : state.downloading ? (
          <>
            <Download size={14} className="animate-pulse" />
            <span className="flex-1">
              Update v{state.version} wird geladen … {state.progress}%
            </span>
            <div className="w-16 h-1 rounded-full bg-white/30 overflow-hidden">
              <div
                className="h-full rounded-full bg-white transition-all duration-300"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          </>
        ) : state.error ? (
          <>
            <RefreshCw size={14} />
            <span className="flex-1 truncate">{state.error}</span>
          </>
        ) : (
          <>
            <Sparkles size={14} />
            <span className="flex-1">
              Update v{state.version} verfügbar
            </span>
            <button
              onClick={onInstall}
              className="bg-white/20 hover:bg-white/30 rounded-full px-2.5 py-0.5 text-[10px] font-bold transition"
            >
              Installieren
            </button>
          </>
        )}
      </div>
    </div>
  );
}
