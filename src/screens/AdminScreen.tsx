import { invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { check } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import {
  ArrowLeft,
  ChevronDown,
  Download,
  FileDown,
  FolderOpen,
  Loader2,
  Monitor,
  Lock,
  Maximize2,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Server,
  ShieldAlert,
  Stethoscope,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import { OutputOverlay } from "../components/OutputOverlay";
import type { BrandingDto } from "../types/branding";
import type {
  AppSettings,
  ConnectivityResult,
  Inventory,
  LevelMeta,
  LevelRunResult,
  NetbirdVersionCheck,
  OnSiteResult,
  RdpSettings,
  SmartDebugResult,
} from "../types/debug";

interface Props {
  branding: BrandingDto;
  onClose: () => void;
}

/**
 * Hidden service menu for KronSolutions. Opened via Ctrl/Cmd+Shift+0, gated by
 * a password whose salted SHA-256 lives in branding.json (checked in Rust).
 * The gate keeps employees out by accident; it is not hardened authentication.
 * Every action is a fixed, named command, never a free command string.
 */
export function AdminScreen({ branding, onClose }: Props) {
  const [unlocked, setUnlocked] = useState(false);
  const [pw, setPw] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [output, setOutput] = useState<string>("");
  const [running, setRunning] = useState<string | null>(null);
  const [levels, setLevels] = useState<LevelMeta[]>([]);
  const [showOutput, setShowOutput] = useState(false);
  const toast = useToast();

  // Escape closes
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [onClose]);

  // Skip the gate if already unlocked this session
  useEffect(() => {
    invoke<boolean>("admin_is_unlocked")
      .then((u) => setUnlocked(u))
      .catch(() => {});
  }, []);

  // Load installable levels once unlocked.
  useEffect(() => {
    if (!unlocked) return;
    invoke<LevelMeta[]>("admin_list_levels")
      .then(setLevels)
      .catch(() => setLevels([]));
  }, [unlocked]);

  // Live settings the admin can change.
  const [appSettings, setAppSettings] = useState<AppSettings | null>(null);
  const [rdp, setRdp] = useState<RdpSettings | null>(null);
  const [autostart, setAutostart] = useState(false);
  const [rdpOpen, setRdpOpen] = useState(false);

  useEffect(() => {
    if (!unlocked) return;
    invoke<AppSettings>("app_settings_get").then(setAppSettings).catch(() => {});
    invoke<RdpSettings>("rdp_settings_get").then(setRdp).catch(() => {});
    invoke<boolean>("is_autostart_enabled").then(setAutostart).catch(() => {});
  }, [unlocked]);

  function setAppField(key: keyof AppSettings, value: boolean) {
    if (!appSettings) return;
    const next = { ...appSettings, [key]: value };
    setAppSettings(next);
    invoke("app_settings_save", { settings: next }).catch((e) =>
      toast.error(e instanceof Error ? e.message : String(e))
    );
  }
  function setAppRole(manager: boolean) {
    if (!appSettings) return;
    const next: AppSettings = {
      ...appSettings,
      role: manager ? "manager" : "user",
    };
    setAppSettings(next);
    invoke("app_settings_save", { settings: next }).catch((e) =>
      toast.error(e instanceof Error ? e.message : String(e))
    );
  }
  function setRdpField(key: keyof RdpSettings, value: boolean) {
    if (!rdp) return;
    const next = { ...rdp, [key]: value };
    setRdp(next);
    invoke("rdp_settings_save", { settings: next }).catch((e) =>
      toast.error(e instanceof Error ? e.message : String(e))
    );
  }
  async function toggleAutostart(value: boolean) {
    try {
      await invoke("set_autostart", { enable: value });
      setAutostart(value);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const tryUnlock = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const ok = await invoke<boolean>("admin_unlock", { password: pw });
      if (ok) {
        setUnlocked(true);
        setPw("");
      } else {
        setError("Kein Zugang.");
        setPw("");
      }
    } catch {
      setError("Kein Zugang.");
    } finally {
      setBusy(false);
    }
  }, [pw]);

  const run = useCallback(
    async (id: string, fn: () => Promise<string>) => {
      setRunning(id);
      try {
        const msg = await fn();
        if (msg) toast.success(msg);
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setRunning(null);
      }
    },
    [toast]
  );

  if (!unlocked) {
    return (
      <div className="h-full flex flex-col">
        <header className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
          <button
            onClick={onClose}
            className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
            aria-label="Zurück"
          >
            <ArrowLeft size={18} strokeWidth={2.4} />
          </button>
          <Lock size={15} className="text-[color:var(--brand-primary)]" />
          <h1 className="text-sm font-bold flex-1">Service</h1>
        </header>
        <div className="flex-1 flex flex-col items-center justify-center px-8 gap-3">
          <ShieldAlert size={28} className="text-[color:var(--brand-primary)]" />
          <p className="text-[12px] text-muted text-center">
            Geschützter Bereich. Bitte Service-Passwort eingeben.
          </p>
          <form
            className="w-full flex flex-col gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              tryUnlock();
            }}
          >
            <input
              type="password"
              value={pw}
              autoFocus
              onChange={(e) => setPw(e.target.value)}
              placeholder="Service-Passwort"
              className="w-full surface rounded-md px-3 py-2 text-sm outline-none focus:border-[color:var(--brand-primary)]"
              disabled={busy}
            />
            {error && (
              <div className="text-[11px] text-red-600 text-center">{error}</div>
            )}
            <button
              type="submit"
              disabled={busy || !pw}
              className="w-full btn-primary rounded-lg py-2 text-xs font-bold flex items-center justify-center gap-1.5"
            >
              {busy ? <Loader2 size={13} className="animate-spin" /> : <Lock size={13} />}
              Freischalten
            </button>
          </form>
        </div>
        <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
          {branding.vendor.footer}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Zurück"
        >
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
        <Wrench size={15} className="text-[color:var(--brand-primary)]" />
        <h1 className="text-sm font-bold flex-1">Service-Menü</h1>
        <span className="text-[9px] font-bold uppercase tracking-wider text-[color:var(--brand-primary)]">
          KronSolutions
        </span>
      </header>

      <div className="admin-actions flex-1 overflow-y-auto px-4 py-2 flex flex-col gap-1.5">
        <AdminAction
          icon={<RotateCcw size={14} />}
          label="NetBird Dienst neu starten"
          running={running === "restart"}
          onClick={() => run("restart", () => invoke<string>("admin_restart_service"))}
        />
        <AdminAction
          icon={<RefreshCw size={14} />}
          label="Verbindung neu aufbauen"
          running={running === "freconnect"}
          onClick={() => run("freconnect", () => invoke<string>("admin_force_reconnect"))}
        />
        <AdminAction
          icon={<Wrench size={14} />}
          label="NetBird reparieren / installieren"
          running={running === "repair"}
          onClick={() => run("repair", () => invoke<string>("install_netbird"))}
        />
        <AdminAction
          icon={<RefreshCw size={14} />}
          label="NetBird-Version prüfen (Update nötig?)"
          running={running === "nbver"}
          onClick={() =>
            run("nbver", async () => {
              const v = await invoke<NetbirdVersionCheck>("admin_check_netbird_version");
              setOutput(
                [
                  `NetBird lokal:   ${v.local ?? "unbekannt"}`,
                  `Neueste Version: ${v.latest ?? "nicht abrufbar"}`,
                  `Update nötig:    ${v.updateAvailable ? "JA" : "nein"}`,
                  `Management:       ${v.managementUrl ?? "-"}`,
                  "",
                  v.note,
                ].join("\n")
              );
              return v.updateAvailable ? "Update verfügbar." : "NetBird ist aktuell.";
            })
          }
        />
        <AdminAction
          icon={<Wrench size={14} />}
          label="NetBird aktualisieren"
          running={running === "nbupd"}
          onClick={() =>
            run("nbupd", async () => {
              const msg = await invoke<string>("admin_update_netbird");
              setOutput(msg);
              return msg;
            })
          }
        />
        <AdminAction
          icon={<Download size={14} />}
          label="Nach App-Update suchen"
          running={running === "appupd"}
          onClick={() =>
            run("appupd", async () => {
              try {
                const update = await check();
                if (!update) return "Die App ist aktuell.";
                setOutput(`App-Update ${update.version} wird geladen …`);
                await update.downloadAndInstall();
                await relaunch();
                return "App-Update installiert, die App startet neu.";
              } catch (e: unknown) {
                console.error("App-Update:", e);
                return "Kein App-Update gefunden oder Server nicht erreichbar.";
              }
            })
          }
        />
        <AdminAction
          icon={<Stethoscope size={14} />}
          label="Smart Debug ausführen"
          running={running === "debug"}
          onClick={() =>
            run("debug", async () => {
              const r = await invoke<SmartDebugResult>("smart_debug");
              setOutput(
                r.summary +
                  "\n\n" +
                  r.steps.map((s) => `${s.ok ? "OK " : "!! "}${s.name}: ${s.detail}`).join("\n")
              );
              return r.summary;
            })
          }
        />
        <AdminAction
          icon={<Server size={14} />}
          label="Inventar anzeigen"
          running={running === "inv"}
          onClick={() =>
            run("inv", async () => {
              const i = await invoke<Inventory>("get_inventory");
              setOutput(
                [
                  `Hostname:   ${i.hostname}`,
                  `Benutzer:   ${i.os_username}`,
                  `OS:         ${i.os_version} (${i.os_name})`,
                  `App:        ${i.app_version}`,
                  `NetBird:    ${i.netbird_version ?? "unbekannt"}`,
                  `WG IP:      ${i.local_ip ?? "-"}`,
                  `Management: ${i.management_url ?? "-"}`,
                  `Autostart:  ${i.autostart_enabled ? "Ein" : "Aus"}`,
                  `Eingerichtet: ${i.enrolled ? "Ja" : "Nein"}`,
                ].join("\n")
              );
              return "Inventar geladen.";
            })
          }
        />
        <AdminAction
          icon={<RefreshCw size={14} />}
          label="Verbindung & Vor-Ort prüfen"
          running={running === "conn"}
          onClick={() =>
            run("conn", async () => {
              const [c, o] = await Promise.all([
                invoke<ConnectivityResult>("check_connectivity"),
                invoke<OnSiteResult>("detect_onsite"),
              ]);
              const net = c.online ? "online" : c.captivePortal ? "Captive Portal" : "offline";
              setOutput(
                `Internet: ${net} (HTTP ${c.httpCode})\nVor Ort: ${
                  o.onSite ? `ja (${o.viaTarget ?? "?"})` : "nein"
                }\nVPN aktiv: ${o.vpnActive ? "ja" : "nein"}`
              );
              return "Prüfung abgeschlossen.";
            })
          }
        />
        <AdminAction
          icon={<FileDown size={14} />}
          label="Support-Paket exportieren"
          running={running === "bundle"}
          onClick={() =>
            run("bundle", async () => {
              const dir = await openDialog({
                directory: true,
                multiple: false,
                title: "Zielordner für Support-Paket wählen",
              });
              if (typeof dir !== "string" || !dir) return "";
              await invoke<string>("export_support_bundle", { destDir: dir });
              return "Support-Paket gespeichert.";
            })
          }
        />
        <AdminAction
          icon={<FolderOpen size={14} />}
          label="Log-Ordner öffnen"
          running={running === "logs"}
          onClick={() =>
            run("logs", async () => {
              await invoke("admin_open_log_folder");
              return "Log-Ordner geöffnet.";
            })
          }
        />
        <AdminAction
          icon={<FolderOpen size={14} />}
          label="App-Daten-Ordner öffnen"
          running={running === "appdata"}
          onClick={() =>
            run("appdata", async () => {
              await invoke("admin_open_app_data");
              return "App-Daten-Ordner geöffnet.";
            })
          }
        />
        <AdminAction
          icon={<RefreshCw size={14} />}
          label="App neu starten"
          running={running === "restartapp"}
          onClick={() =>
            run("restartapp", async () => {
              await invoke("admin_restart_app");
              return "App startet neu …";
            })
          }
        />
        <AdminAction
          icon={<RotateCcw size={14} />}
          label="Einrichtung zurücksetzen"
          danger
          running={running === "reset"}
          onClick={() => {
            if (!window.confirm("Einrichtung wirklich zurücksetzen? Setup Key wird gelöscht.")) return;
            run("reset", async () => {
              await invoke("nb_reset_enrollment");
              return "Einrichtung zurückgesetzt.";
            });
          }}
        />

        {/* Live-Einstellungen, die der Admin direkt ändern kann */}
        <div className="mt-2 pt-2 border-t border-[color:var(--brand-border)]">
          <h3 className="text-[9px] font-bold uppercase tracking-wider text-muted mb-1.5 px-1">
            Einstellungen
          </h3>
          {appSettings && (
            <div className="surface rounded-lg px-2.5 py-0.5 mb-1.5">
              <SettingToggle
                label="Geschäftsführer-Profil"
                hint="Mehr Server-Buttons und Übersicht für die Leitung"
                checked={appSettings.role === "manager"}
                onChange={setAppRole}
              />
              <SettingToggle
                label="Auto-Reconnect"
                hint="Verbindung automatisch wiederherstellen"
                checked={appSettings.autoReconnect}
                onChange={(v) => setAppField("autoReconnect", v)}
              />
              <SettingToggle
                label="Beim Start verbinden"
                hint="VPN gleich beim Öffnen aufbauen"
                checked={appSettings.connectOnStart}
                onChange={(v) => setAppField("connectOnStart", v)}
              />
              <SettingToggle
                label="Status-Benachrichtigungen"
                checked={appSettings.notifications}
                onChange={(v) => setAppField("notifications", v)}
              />
              <SettingToggle
                label="Autostart"
                hint="Beim Hochfahren automatisch starten"
                checked={autostart}
                onChange={toggleAutostart}
              />
            </div>
          )}
          <button
            onClick={() => setRdpOpen((v) => !v)}
            className="w-full surface rounded-lg px-2.5 py-2 flex items-center justify-between text-[12px] font-semibold text-[color:var(--brand-fg)] hover:border-[color:var(--brand-primary)]/50 transition"
          >
            <span className="flex items-center gap-1.5">
              <Monitor size={13} className="text-[color:var(--brand-primary)]" />
              Remote-Desktop-Einstellungen
            </span>
            <ChevronDown
              size={14}
              className={`transition-transform ${rdpOpen ? "rotate-180" : ""}`}
            />
          </button>
          {rdpOpen && rdp && (
            <div className="surface rounded-lg px-2.5 py-0.5 mt-1">
              <SettingToggle
                label="Zwischenablage"
                checked={rdp.clipboard}
                onChange={(v) => setRdpField("clipboard", v)}
              />
              <SettingToggle
                label="Laufwerke"
                hint="aus Sicherheitsgründen meist aus"
                checked={rdp.drives}
                onChange={(v) => setRdpField("drives", v)}
              />
              <SettingToggle
                label="Drucker"
                checked={rdp.printers}
                onChange={(v) => setRdpField("printers", v)}
              />
              <SettingToggle
                label="Kamera"
                checked={rdp.camera}
                onChange={(v) => setRdpField("camera", v)}
              />
              <SettingToggle
                label="Mikrofon"
                checked={rdp.microphone}
                onChange={(v) => setRdpField("microphone", v)}
              />
              <SettingToggle
                label="Ton"
                checked={rdp.audio}
                onChange={(v) => setRdpField("audio", v)}
              />
              <SettingToggle
                label="Mehrere Bildschirme"
                checked={rdp.multimon}
                onChange={(v) => setRdpField("multimon", v)}
              />
            </div>
          )}
        </div>

        {levels.length > 0 && (
          <div className="mt-1">
            <h3 className="text-[9px] font-bold uppercase tracking-wider text-muted mb-1">
              Level installieren
            </h3>
            {levels.map((lv) => (
              <AdminAction
                key={lv.id}
                icon={<PackagePlus size={14} />}
                label={`${lv.label} · ${lv.steps} Schritte`}
                running={running === `lvl:${lv.id}`}
                onClick={() =>
                  run(`lvl:${lv.id}`, async () => {
                    const r = await invoke<LevelRunResult>("admin_run_level", {
                      levelId: lv.id,
                    });
                    setOutput(
                      `Level ${r.level}: ${r.ok ? "OK" : "FEHLER"}\n\n` +
                        r.steps
                          .map(
                            (s) =>
                              `${s.ok ? "OK " : "!! "}${s.label} (exit ${s.exitCode})\n${s.output}`
                          )
                          .join("\n\n")
                    );
                    return r.ok ? "Level installiert." : "Level mit Fehler.";
                  })
                }
              />
            ))}
          </div>
        )}

        {output && (
          <div className="mt-1 space-y-1">
            <pre className="allow-select text-[10px] font-mono whitespace-pre-wrap break-words leading-snug surface rounded-lg p-2 max-h-28 overflow-auto text-[color:var(--brand-fg)]">
              {output}
            </pre>
            <button
              onClick={() => setShowOutput(true)}
              className="w-full flex items-center justify-center gap-1.5 btn-ghost rounded-md py-1.5 text-[11px] font-semibold text-[color:var(--brand-primary)]"
            >
              <Maximize2 size={13} /> Ganze Ausgabe anzeigen
            </button>
          </div>
        )}
      </div>

      <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
        {branding.vendor.footer}
      </div>

      {showOutput && (
        <OutputOverlay
          title="Service-Ausgabe"
          text={output}
          onClose={() => setShowOutput(false)}
        />
      )}
    </div>
  );
}

function AdminAction({
  icon,
  label,
  running,
  danger,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  running: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={running}
      className={`admin-action w-full flex items-center gap-2.5 surface rounded-lg px-3 py-2.5 text-left text-[12px] font-semibold transition hover:border-[color:var(--brand-primary)]/50 ${
        danger ? "text-red-600" : ""
      }`}
    >
      <span
        aria-hidden
        className="admin-num shrink-0 w-5 text-[11px] font-bold tabular-nums text-muted text-right"
      />
      <span className={danger ? "text-red-600" : "text-[color:var(--brand-primary)]"}>
        {running ? <Loader2 size={14} className="animate-spin" /> : icon}
      </span>
      {label}
    </button>
  );
}

function SettingToggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-[color:var(--brand-border)] last:border-b-0">
      <div className="min-w-0 pr-2">
        <div className="text-[12px] font-semibold text-[color:var(--brand-fg)]">
          {label}
        </div>
        {hint && <div className="text-[10px] text-muted">{hint}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative w-9 h-5 rounded-full transition shrink-0 ${
          checked
            ? "bg-[color:var(--brand-primary)]"
            : "bg-[color:var(--brand-fg)]/20"
        }`}
      >
        <span
          className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
            checked ? "left-[18px]" : "left-0.5"
          }`}
        />
      </button>
    </div>
  );
}
