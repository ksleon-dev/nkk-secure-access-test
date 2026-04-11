import { invoke } from "@tauri-apps/api/core";
import {
  ArrowRight,
  Check,
  KeyRound,
  Loader2,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { Logo } from "../components/Logo";
import { TaglineMark } from "../components/TaglineMark";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import type { BrandingDto } from "../types/branding";

interface Props {
  branding: BrandingDto;
  onEnrolled: () => void;
}

export function EnrollmentScreen({ branding, onEnrolled }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "connecting" | "success" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!key.trim()) {
      setError(de.enrollment.keyRequired);
      return;
    }
    setBusy(true);
    setPhase("connecting");
    try {
      await invoke("nb_connect", { setupKey: key.trim() });
      setPhase("success");
      toast.success(de.toast.connected);
      await new Promise((r) => setTimeout(r, 1800));
      onEnrolled();
    } catch (e: unknown) {
      setPhase("error");
      setError(e instanceof Error ? e.message : String(e));
      // Show error on logo for 2s then reset
      await new Promise((r) => setTimeout(r, 2000));
      setPhase("idle");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full flex flex-col">
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-4 text-center">
        {phase === "success" ? (
          <div className="flex flex-col items-center gap-4 animate-fade-up">
            <div className="w-20 h-20 rounded-full bg-emerald-500 flex items-center justify-center shadow-[0_0_40px_rgba(16,185,129,0.5)] logo-connected-pop">
              <Check size={40} strokeWidth={3} className="text-white" />
            </div>
            <div className="font-serif-display text-[24px]">Aktiviert!</div>
            <div className="text-[13px] text-[color:var(--brand-fg)]/60">
              Verbindung wird aufgebaut …
            </div>
            <div className="w-24 h-1 rounded-full bg-[color:var(--brand-border)] overflow-hidden">
              <div className="h-full rounded-full bg-emerald-500 brand-loading-bar" />
            </div>
          </div>
        ) : (
          <>
            <div className="fade-in-1 flex flex-col items-center">
              <div className="relative">
                <Logo
                  branding={branding}
                  size={120}
                  className={
                    phase === "connecting" ? "logo-float" :
                    phase === "error" ? "logo-shake logo-error-glow" : ""
                  }
                />
                {phase === "error" && (
                  <div className="absolute -bottom-1 -right-1 w-8 h-8 rounded-full bg-red-500 flex items-center justify-center shadow-lg animate-fade-up">
                    <XCircle size={18} className="text-white" />
                  </div>
                )}
              </div>
              <TaglineMark width={240} className="mt-1" />
            </div>

            <div className="fade-in-2">
              <div className="font-serif-display text-[28px] leading-[1.0]">
                {phase === "error" ? "Hmm." : "Willkommen."}
              </div>
              <div
                className="font-serif-display italic text-[22px] leading-[1.0] mt-0.5"
                style={{ color: phase === "error" ? "#dc2626" : "var(--brand-primary)" }}
              >
                {phase === "error" ? "hat nicht geklappt." : "schön dass du da bist."}
              </div>
            </div>

            <form
              onSubmit={submit}
              className="fade-in-3 w-full flex flex-col gap-2 mt-2"
            >
              <label className="flex flex-col gap-1.5 text-left">
                <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted">
                  <KeyRound size={11} /> {de.enrollment.placeholder}
                </span>
                <input
                  type="text"
                  autoFocus
                  spellCheck={false}
                  autoComplete="off"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  className="surface rounded-lg px-3 py-2.5 text-sm font-mono outline-none focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 transition"
                  disabled={busy}
                />
              </label>

              {error && (
                <div className="text-xs text-red-600 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 leading-snug text-left animate-fade-up">
                  {error}
                </div>
              )}

              <button
                type="submit"
                disabled={busy || !key.trim()}
                className="btn-primary rounded-lg py-3 text-sm font-bold flex items-center justify-center gap-2 mt-1"
              >
                {busy ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {de.enrollment.submitting}
                  </>
                ) : (
                  <>
                    {de.enrollment.submit}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </form>
          </>
        )}
      </main>

      <div className="fade-in-4 px-6 pb-3 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted">
          <ShieldCheck size={10} />
          <span>{de.enrollment.helpText}</span>
        </div>
        <div className="text-center text-[9px] font-semibold uppercase tracking-wider text-[color:var(--brand-surface)]/80">
          {branding.vendor.footer}
        </div>
      </div>
    </div>
  );
}
