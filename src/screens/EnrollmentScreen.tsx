import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  ArrowRight,
  Check,
  KeyRound,
  Loader2,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Logo } from "../components/Logo";
import { TaglineMark } from "../components/TaglineMark";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import type { BrandingDto } from "../types/branding";
import type { StatusDto } from "../types/netbird";

interface Props {
  branding: BrandingDto;
  onEnrolled: () => void;
  // Vom App-Bootstrap gesetzt: enrolled==false, aber ein Datei-Key liegt auf der
  // Platte (has_cached_setup_key). Dann versucht der Screen beim Mount sofort einen
  // zero-touch Auto-Connect, damit der Nutzer den Key gar nicht kennen muss (#6/#22).
  autoConnect?: boolean;
}

// nb_connect kann laenger laufen (Backend pollt bis ~15s auf management_connected,
// dazu Service-Neustart-Retry). Frontend-Timeout grosszuegig ueber dem Backend-Budget
// (#27), damit der Spinner NIE unbegrenzt steht, der Connect aber nicht vorzeitig
// abgeschnitten wird. Bei Ablauf lehnt das Promise mit Klartext ab -> phase=error.
const CONNECT_TIMEOUT_MS = 75000;

function invokeWithTimeout<T>(
  cmd: string,
  ms: number,
  args?: Record<string, unknown>
): Promise<T> {
  return Promise.race([
    invoke<T>(cmd, args),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${cmd}: Zeitueberschreitung nach ${ms} ms`)),
        ms
      )
    ),
  ]);
}

type ErrorCategory = "netbirdMissing" | "keyRejected" | "network" | "timeout" | "unknown";

interface CategorizedError {
  category: ErrorCategory;
  // Kurze Kopfzeile (was ist passiert).
  message: string;
  // Konkreter naechster Schritt je Kategorie (was der Nutzer jetzt tun kann).
  nextStep: string;
}

// REINE Funktion: klassifiziert die rohe Backend-Fehlermeldung (nb_connect lehnt mit
// dem Display-Text des AppError ab) in eine Kategorie mit konkretem naechsten Schritt.
// Robust ueber Teilstring-Matching, damit kleine Wortaenderungen im Backend-Text den
// Match nicht brechen. Deutsche Texte, KEINE Gedankenstriche.
export function categorizeConnectError(raw: string): CategorizedError {
  const t = (raw || "").toLowerCase();

  // Frontend-Timeout (invokeWithTimeout) ODER Backend-Timeout ("kam nicht zustande").
  if (t.includes("zeitueberschreitung") || t.includes("zeitüberschreitung")) {
    return {
      category: "timeout",
      message: "Die Verbindung hat zu lange gedauert.",
      nextStep:
        "Bitte Internetverbindung pruefen und dann nochmal versuchen. Hilft das nicht, bei der IT melden.",
    };
  }

  // NetBird-Dienst/CLI fehlt (AppError::NetbirdMissing).
  if (
    t.includes("cli nicht gefunden") ||
    t.includes("nicht installiert") ||
    (t.includes("netbird") && t.includes("nicht gefunden"))
  ) {
    return {
      category: "netbirdMissing",
      message: "Der VPN-Dienst wurde nicht gefunden.",
      nextStep:
        "Bitte die App einmal neu starten. Hilft das nicht: Terminal oeffnen und ausfuehren: curl -fsSL https://pkgs.netbird.io/install.sh | sh",
    };
  }

  // Setup-Key abgelehnt oder abgelaufen (needs_login nach up()).
  if (
    t.includes("setup-key") ||
    t.includes("setup key") ||
    t.includes("abgelehnt") ||
    t.includes("abgelaufen") ||
    t.includes("anmelden") ||
    t.includes("login")
  ) {
    return {
      category: "keyRejected",
      message: "Der Setup-Key wurde abgelehnt oder ist abgelaufen.",
      nextStep:
        "Bitte einen neuen Setup-Key bei der IT anfordern und erneut eingeben.",
    };
  }

  // Verbindung/Management nicht erreichbar (Netzproblem).
  if (
    t.includes("kam nicht zustande") ||
    t.includes("nicht verbunden") ||
    t.includes("nicht erreichbar") ||
    t.includes("management") ||
    t.includes("verbindung")
  ) {
    return {
      category: "network",
      message: "Die Verbindung kam nicht zustande.",
      nextStep:
        "Bitte Internetverbindung pruefen und dann erneut versuchen.",
    };
  }

  // Fallback: unbekannter Fehler, aber NIE stumm. Konkrete Meldung + Ausweg.
  return {
    category: "unknown",
    message: "Die Aktivierung hat nicht geklappt.",
    nextStep:
      "Bitte erneut versuchen. Klemmt es weiter, den Setup-Key pruefen oder bei der IT melden.",
  };
}

export function EnrollmentScreen({ branding, onEnrolled, autoConnect }: Props) {
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"idle" | "connecting" | "success" | "error">("idle");
  // Strukturierter Fehler (Kopfzeile + naechster Schritt) statt einer pauschalen Zeile.
  const [failure, setFailure] = useState<CategorizedError | null>(null);
  const [slowHint, setSlowHint] = useState(false);
  // Datei-Key liegt vor -> zero-touch Auto-Connect anbieten (#6/#22).
  const [hasCachedKey, setHasCachedKey] = useState(false);
  const toast = useToast();
  const enrolledRef = useRef(false);
  // Verhindert doppelte Connect-Laeufe (Auto-Connect + Klick gleichzeitig).
  const connectingRef = useRef(false);

  // Gemeinsamer Connect-Pfad fuer Formular-Submit UND Auto-Connect. setupKey==null ->
  // nb_connect({}) nutzt den gecachten Datei-Key im Backend (cached_setup_key).
  async function runConnect(setupKey: string | null) {
    if (connectingRef.current || enrolledRef.current) return;
    connectingRef.current = true;
    setFailure(null);
    setBusy(true);
    setPhase("connecting");
    setSlowHint(false);
    // Waechter: wirkt der Connect nach 18s noch wie haengend, klaren Hinweis zeigen
    // (statt stillem Spinner). Der Connect laeuft im Hintergrund weiter.
    const slowTimer = setTimeout(() => setSlowHint(true), 18000);
    try {
      // nb_connect liefert (durch P-CMD #3) nur Ok, wenn wirklich verbunden
      // (management_connected verifiziert), sonst einen unterscheidbaren Fehler.
      const args = setupKey ? { setupKey } : {};
      await invokeWithTimeout("nb_connect", CONNECT_TIMEOUT_MS, args);
      if (enrolledRef.current) return; // Listener hat es bereits behandelt
      enrolledRef.current = true;
      setPhase("success");
      toast.success(de.toast.connected);
      await new Promise((r) => setTimeout(r, 600));
      onEnrolled();
    } catch (e: unknown) {
      // Technisches Detail fuer den Support ins Log, dem Nutzer kategorisierten
      // Klartext + konkreten naechsten Schritt zeigen. NIE stumm auf idle zurueck.
      console.error("Enrollment fehlgeschlagen:", e);
      const raw = e instanceof Error ? e.message : String(e);
      setFailure(categorizeConnectError(raw));
      setPhase("error");
    } finally {
      clearTimeout(slowTimer);
      setSlowHint(false);
      setBusy(false);
      connectingRef.current = false;
    }
  }

  // Beim Mount pruefen, ob ein Datei-Key vorliegt. Wenn ja: Auto-Connect anbieten und
  // (falls App-Bootstrap autoConnect setzt) sofort zero-touch verbinden.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let cached = false;
      try {
        cached = await invoke<boolean>("has_cached_setup_key");
      } catch {
        cached = false;
      }
      if (cancelled) return;
      setHasCachedKey(cached);
      // Nur automatisch loslaufen, wenn der Bootstrap das ausdruecklich will UND ein
      // Key vorliegt. So bleibt der manuelle Weg unveraendert, wenn kein Key da ist.
      if (cached && autoConnect && !enrolledRef.current) {
        void runConnect(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount-once: haengt nur am initialen autoConnect-Wunsch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for status changes - if NetBird connects (e.g. manually via CLI),
  // auto-transition to main screen even if the UI enrollment failed.
  useEffect(() => {
    let cancelled = false;
    let unlisten: UnlistenFn | undefined;

    function handleConnected() {
      if (enrolledRef.current || cancelled) return;
      enrolledRef.current = true;
      toast.success(de.toast.connected);
      setTimeout(() => onEnrolled(), 1200);
    }

    // Listen to backend status events
    (async () => {
      const fn = await listen<StatusDto>("netbird-status-changed", (ev) => {
        if (ev.payload.state === "Connected" && ev.payload.management_connected) {
          handleConnected();
        }
      });
      if (cancelled) { fn(); return; }
      unlisten = fn;
    })();

    // Also poll every 3s as fallback (covers manual CLI connect)
    const pollTimer = setInterval(async () => {
      if (enrolledRef.current || cancelled) return;
      try {
        const s = await invoke<StatusDto>("nb_status");
        if (s.state === "Connected" && s.management_connected) {
          handleConnected();
        }
      } catch { /* ignore */ }
    }, 3000);

    return () => {
      cancelled = true;
      unlisten?.();
      clearInterval(pollTimer);
    };
  }, [onEnrolled, toast]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    if (!key.trim()) {
      setFailure({
        category: "unknown",
        message: de.enrollment.keyRequired,
        nextStep: "Den Setup-Key aus der Mail der IT eingeben und dann aktivieren.",
      });
      return;
    }
    await runConnect(key.trim());
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
              <div className="relative" style={{ overflow: "visible" }}>
                <Logo
                  branding={branding}
                  size={120}
                  className={
                    phase === "connecting" ? "logo-float" :
                    phase === "error" ? "logo-shake logo-error-glow" : ""
                  }
                />
                {phase === "error" && (
                  <div className="absolute bottom-1 right-1 w-7 h-7 rounded-full bg-red-600 flex items-center justify-center shadow-md animate-fade-up z-20">
                    <XCircle size={16} className="text-white" />
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
                {phase === "error" ? "hat nicht geklappt." : "schön, dass du da bist."}
              </div>
            </div>

            <p className="fade-in-2 text-[11.5px] text-[color:var(--brand-fg)]/60 max-w-[280px] leading-snug">{de.enrollment.subtitle}</p>

            {/* Datei-Key vorhanden: zero-touch Auto-Connect anbieten, damit der Nutzer
                den Key gar nicht kennen muss. Der manuelle Key-Weg bleibt darunter. */}
            {hasCachedKey && phase !== "connecting" && (
              <button
                type="button"
                onClick={() => void runConnect(null)}
                disabled={busy}
                className="btn-primary rounded-lg py-3 px-5 text-sm font-bold flex items-center justify-center gap-2 w-full max-w-[280px] animate-fade-up"
              >
                <Sparkles size={16} />
                Automatisch verbinden
              </button>
            )}

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

              {failure && (
                <div className="text-xs text-red-600 bg-red-500/10 border border-red-500/20 rounded-md px-3 py-2 leading-snug text-left animate-fade-up flex flex-col gap-1">
                  <span className="font-semibold">{failure.message}</span>
                  <span className="text-[color:var(--brand-fg)]/70">{failure.nextStep}</span>
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
                    {phase === "error" ? "Nochmal versuchen" : de.enrollment.submit}
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
              {busy && slowHint && (
                <div className="text-[11px] text-[color:var(--brand-fg)]/55 text-center mt-1 animate-fade-up">
                  Das dauert etwas länger, wir versuchen es weiter …
                </div>
              )}
            </form>
          </>
        )}
      </main>

      <div className="fade-in-4 px-6 pb-3 flex flex-col gap-2 shrink-0">
        <div className="flex items-center justify-center gap-1.5 text-[10px] text-muted">
          <ShieldCheck size={10} />
          <span>{de.enrollment.helpText}</span>
        </div>
      </div>
      <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
        {branding.vendor.footer}
      </div>
    </div>
  );
}
