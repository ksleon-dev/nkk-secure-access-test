import clsx from "clsx";
import { Download, RefreshCw, Sparkles } from "lucide-react";
import type { UpdateState } from "../hooks/useUpdater";

interface Props {
  state: UpdateState;
  onInstall: () => void;
  onRestart: () => void;
  onDismiss: () => void;
}

export function UpdateBanner({ state, onInstall, onRestart, onDismiss }: Props) {
  if (!state.available) return null;

  return (
    <div className="absolute inset-0 z-50 flex items-center justify-center p-5 bg-black/40 backdrop-blur-sm animate-fade-up">
      <div
        className={clsx(
          "w-full max-w-sm rounded-2xl overflow-hidden shadow-[0_20px_60px_-20px_rgba(0,0,0,0.5)] transition-all",
          state.ready
            ? "bg-emerald-600"
            : state.error
            ? "bg-red-600"
            : "bg-[color:var(--brand-primary)]"
        )}
      >
        {/* Top accent shimmer */}
        <div className="h-1 w-full bg-white/10 overflow-hidden">
          {state.downloading && (
            <div
              className="h-full bg-white/60 transition-all duration-500 ease-out"
              style={{ width: `${state.progress}%` }}
            />
          )}
          {!state.downloading && (
            <div className="h-full w-full vpn-connecting-bar" />
          )}
        </div>

        <div className="px-5 pt-5 pb-4 text-white text-center">
          {/* Icon */}
          <div className="flex justify-center mb-3">
            <div
              className={clsx(
                "w-14 h-14 rounded-2xl flex items-center justify-center",
                state.ready
                  ? "bg-white/20"
                  : state.downloading
                  ? "bg-white/15"
                  : "bg-white/20 brand-breathe"
              )}
            >
              {state.ready ? (
                <Sparkles size={28} strokeWidth={2} />
              ) : state.downloading ? (
                <Download size={28} strokeWidth={2} className="animate-pulse" />
              ) : state.error ? (
                <RefreshCw size={28} strokeWidth={2} />
              ) : (
                <Sparkles size={28} strokeWidth={2} />
              )}
            </div>
          </div>

          {/* Title */}
          <div className="font-serif-display text-[22px] leading-tight">
            {state.ready
              ? "Fertig!"
              : state.downloading
              ? "Wird geladen …"
              : state.error
              ? "Oops."
              : "Neues Update"}
          </div>

          {/* Subtitle */}
          <div className="text-[13px] text-white/80 mt-1">
            {state.ready
              ? `v${state.version} ist installiert und wartet.`
              : state.downloading
              ? `v${state.version} — ${state.progress}% heruntergeladen`
              : state.error
              ? state.error
              : `v${state.version} steht bereit — schneller, stabiler, besser.`}
          </div>

          {/* Progress bar for download */}
          {state.downloading && (
            <div className="mt-4 mx-auto w-48 h-2 rounded-full bg-white/20 overflow-hidden">
              <div
                className="h-full rounded-full bg-white transition-all duration-300 ease-out"
                style={{ width: `${state.progress}%` }}
              />
            </div>
          )}

          {/* Actions */}
          <div className="mt-4 flex gap-2">
            {state.ready ? (
              <button
                onClick={onRestart}
                className="flex-1 bg-white text-emerald-700 font-bold text-[13px] rounded-xl py-2.5 hover:bg-white/90 active:scale-[0.98] transition-all shadow-lg"
              >
                Jetzt neu starten
              </button>
            ) : state.downloading ? (
              <div className="flex-1 text-[11px] text-white/60 py-2">
                Bitte einen Moment Geduld …
              </div>
            ) : state.error ? (
              <button
                onClick={onInstall}
                className="flex-1 bg-white/20 hover:bg-white/30 font-bold text-[13px] rounded-xl py-2.5 transition"
              >
                Erneut versuchen
              </button>
            ) : (
              <>
                <button
                  onClick={onDismiss}
                  className="flex-1 bg-white/20 hover:bg-white/30 font-bold text-[13px] rounded-xl py-2.5 transition"
                >
                  Nicht jetzt
                </button>
                <button
                  onClick={onInstall}
                  className="flex-[2] bg-white text-[color:var(--brand-primary)] font-bold text-[13px] rounded-xl py-2.5 hover:bg-white/90 active:scale-[0.98] transition-all shadow-lg"
                >
                  Jetzt installieren
                </button>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="text-center text-[9px] text-white/40 pb-3 font-semibold uppercase tracking-widest">
          Powered by KronSolutions
        </div>
      </div>
    </div>
  );
}
