import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, Download, Loader2, Shield } from "lucide-react";
import { useRef, useState } from "react";
import { useToast } from "../components/Toast";
import type { BrandingDto } from "../types/branding";

type Phase = "ready" | "installing" | "done" | "error";

interface Props {
  branding: BrandingDto;
  onComplete: () => void;
}

interface SetupCheckResult {
  netbird_installed: boolean;
  netbird_running: boolean;
  needs_install: boolean;
  message: string;
}

// Nach dem Install den ECHTEN Zustand pruefen (nicht dem Exit-Code des Installers
// trauen). Bis zu ~15s (alle 1s) auf netbird_installed pollen: manche Installer legen
// die Binary erst nach kurzer Verzoegerung ab. Reine Warte-/Pruefschleife.
async function verifyInstalled(): Promise<boolean> {
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const check = await invoke<SetupCheckResult>("check_netbird_setup");
      if (check.netbird_installed) return true;
    } catch {
      /* naechster Versuch */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

export function SetupScreen({ branding, onComplete }: Props) {
  const [phase, setPhase] = useState<Phase>("ready");
  const [statusText, setStatusText] = useState(
    "Der VPN-Dienst muss einmalig eingerichtet werden."
  );
  const toast = useToast();
  const busyRef = useRef(false);

  async function install() {
    if (busyRef.current) return;
    busyRef.current = true;
    setPhase("installing");
    setStatusText("NetBird wird installiert, bitte Admin-Passwort eingeben …");

    try {
      const msg = await invoke<string>("install_netbird");
      // KEIN leerer Erfolg: der Installer-Aufruf kann Ok melden, ohne dass NetBird
      // wirklich da ist (GUI-PATH kennt /usr/local/bin nicht, Dienst nicht gestartet).
      // Erst gegen den echten Zustand verifizieren, sonst laeuft der Nutzer im
      // Enrollment sofort in eine Sackgasse (#7).
      setStatusText("Einrichtung wird geprüft …");
      const ok = await verifyInstalled();
      if (!ok) {
        setPhase("error");
        setStatusText(
          "Die Einrichtung wurde gestartet, der VPN-Dienst ist aber noch nicht bereit. Bitte einen Moment warten und nochmal versuchen. Klemmt es weiter, bei der IT melden."
        );
        toast.error("VPN-Dienst noch nicht bereit. Bitte nochmal versuchen.");
        return;
      }
      setPhase("done");
      setStatusText(msg);
      toast.success("Einrichtung abgeschlossen!");
      setTimeout(() => onComplete(), 1500);
    } catch (e: unknown) {
      console.error("install_netbird:", e);
      const raw = e instanceof Error ? e.message : String(e);
      // Kuratierte Backend-Meldungen (z.B. "Installation abgebrochen ...") behalten,
      // nur den rohen stderr-Leak ("Installation fehlgeschlagen: <stderr>") durch
      // ruhigen Klartext ersetzen - kein technischer Fehler auf dem ersten Screen.
      const friendly = raw.startsWith("Installation fehlgeschlagen")
        ? "Die Einrichtung hat nicht geklappt. Bitte erneut versuchen oder beim Support melden."
        : raw;
      setPhase("error");
      setStatusText(friendly);
      toast.error(friendly);
    } finally {
      busyRef.current = false;
    }
  }

  return (
    <div className="h-full flex flex-col items-center justify-center px-8 gap-5 animate-fade-up">
      <img
        src={new URL("../assets/nkk-logo.svg", import.meta.url).href}
        alt={branding.product.name}
        width={90}
        height={90}
        className={phase === "installing" ? "brand-breathe" : ""}
        draggable={false}
      />

      <h1 className="text-lg font-bold text-[color:var(--brand-fg)]">
        Ersteinrichtung
      </h1>

      <p className="text-[12px] text-center text-[color:var(--brand-fg)]/70 max-w-[280px] leading-relaxed">
        {statusText}
      </p>

      {phase === "installing" && (
        <div className="flex flex-col items-center gap-2">
          <Loader2
            size={24}
            className="text-[color:var(--brand-primary)] animate-spin"
          />
          <div className="w-32 h-1 rounded-full bg-[color:var(--brand-border)] overflow-hidden">
            <div className="h-full rounded-full bg-[color:var(--brand-primary)] brand-loading-bar" />
          </div>
        </div>
      )}

      {phase === "done" && (
        <CheckCircle2
          size={28}
          className="text-emerald-600"
        />
      )}

      {phase === "ready" && (
        <button
          onClick={install}
          className="btn-primary rounded-xl px-6 py-2.5 text-[13px] font-bold flex items-center gap-2"
        >
          <Download size={14} />
          Jetzt einrichten
        </button>
      )}

      {phase === "error" && (
        <button
          onClick={install}
          className="btn-primary rounded-xl px-6 py-2.5 text-[13px] font-bold flex items-center gap-2"
        >
          <Shield size={14} />
          Nochmal versuchen
        </button>
      )}

      <span className="absolute bottom-3 text-[9px] font-bold uppercase tracking-[0.15em] text-[color:var(--brand-fg)]/25">
        {branding.vendor.footer}
      </span>
    </div>
  );
}
