import { invoke } from "@tauri-apps/api/core";
import { check, type Update } from "@tauri-apps/plugin-updater";
import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Download,
  Loader2,
  LogOut,
  Monitor,
  Pencil,
  Plus,
  Power,
  RefreshCw,
  RotateCcw,
  Server,
  Settings as SettingsIcon,
  Trash2,
  XCircle,
} from "lucide-react";

interface RdpSettings {
  clipboard: boolean;
  drives: boolean;
  printers: boolean;
  camera: boolean;
  microphone: boolean;
  audio: boolean;
  multimon: boolean;
}
import { useEffect, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import type { BrandingDto } from "../types/branding";
import type {
  CredentialProfileMeta,
  KeyringTestResult,
} from "../types/credentials";

interface Props {
  branding: BrandingDto;
  profiles: CredentialProfileMeta[];
  onAddProfile: () => void;
  onEditProfile: (profile: CredentialProfileMeta) => void;
  onDeleteProfile: (id: string) => void;
  onBack: () => void;
  onResetEnrollment: () => void;
}

export function SettingsScreen({
  branding,
  profiles,
  onAddProfile,
  onEditProfile,
  onDeleteProfile,
  onBack,
  onResetEnrollment,
}: Props) {
  const [autostart, setAutostart] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [keyringTest, setKeyringTest] = useState<KeyringTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [rdp, setRdp] = useState<RdpSettings | null>(null);
  const [rdpOpen, setRdpOpen] = useState(false);
  const [creatingShortcut, setCreatingShortcut] = useState(false);
  const toast = useToast();

  useEffect(() => {
    invoke<boolean>("is_autostart_enabled")
      .then(setAutostart)
      .catch(() => setAutostart(false));
    invoke<RdpSettings>("rdp_settings_get")
      .then(setRdp)
      .catch(() => {});
    refreshLogs();
    // NOTE: keyring test is explicit - triggered by the user via a button so
    // the macOS Keychain access prompt does not pop every time Settings is
    // opened on unsigned dev builds.
  }, []);

  async function toggleAutostart(enable: boolean) {
    try {
      await invoke("set_autostart", { enable });
      setAutostart(enable);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  function setRdpField(key: keyof RdpSettings, value: boolean) {
    if (!rdp) return;
    const next = { ...rdp, [key]: value };
    setRdp(next);
    invoke("rdp_settings_save", { settings: next }).catch((e) =>
      toast.error(e instanceof Error ? e.message : String(e))
    );
  }

  async function createShortcut() {
    setCreatingShortcut(true);
    try {
      await invoke<string>("create_desktop_rdp_shortcut");
      toast.success("Verknüpfung auf dem Desktop erstellt.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setCreatingShortcut(false);
    }
  }

  async function refreshLogs() {
    setLoadingLogs(true);
    try {
      const lines = await invoke<string[]>("nb_logs", { lines: 200 });
      setLogs(lines);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingLogs(false);
    }
  }

  async function runKeyringTest() {
    setTesting(true);
    try {
      const r = await invoke<KeyringTestResult>("creds_test");
      setKeyringTest(r);
    } catch (e: unknown) {
      setKeyringTest({ ok: false, backend: "?", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  }

  async function resetEnrollment() {
    if (!window.confirm("Wirklich zurücksetzen?")) return;
    try {
      await invoke("nb_reset_enrollment");
      toast.info("Einrichtung zurückgesetzt.");
      onResetEnrollment();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  function deleteProfile(p: CredentialProfileMeta) {
    if (
      !window.confirm(
        `Profil "${p.label}" wirklich löschen? Wird beim nächsten Mal neu abgefragt.`
      )
    )
      return;
    onDeleteProfile(p.id);
  }

  async function quitApp() {
    try {
      await invoke("quit_app");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className="h-full flex flex-col">
      <header className="px-4 pt-4 pb-2 flex items-center gap-2 shrink-0">
        <button
          onClick={onBack}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label={de.settings.back}
        >
          <ArrowLeft size={18} strokeWidth={2.4} />
        </button>
        <SettingsIcon size={15} className="text-[color:var(--brand-primary)]" />
        <h1 className="text-sm font-bold flex-1">{de.settings.title}</h1>
      </header>

      <div className="flex-1 overflow-y-auto px-4 pb-4 animate-fade-up">
        {/* Credential profiles */}
        <Section
          title="Anmeldedaten"
          action={
            <button
              onClick={onAddProfile}
              className="text-[12px] flex items-center gap-1 px-2.5 py-1 rounded-md text-white bg-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary-hover)] font-bold transition"
            >
              <Plus size={12} strokeWidth={3} />
              Neu
            </button>
          }
        >
          <p className="text-[12px] text-[color:var(--brand-fg)]/85 mb-2 leading-snug">
            Mehrere Profile speicherbar - verschlüsselt im OS Tresor.
          </p>
          {profiles.length === 0 ? (
            <button
              onClick={onAddProfile}
              className="w-full surface hover:border-[color:var(--brand-primary)] rounded-lg px-3 py-3 text-[13px] font-semibold flex items-center justify-center gap-1.5 text-[color:var(--brand-fg)] transition"
            >
              <Plus size={14} strokeWidth={2.6} />
              Erstes Profil anlegen
            </button>
          ) : (
            <div className="flex flex-col gap-1.5">
              {profiles.map((p) => (
                <div
                  key={p.id}
                  className="surface rounded-lg p-2.5 flex items-center gap-2.5"
                >
                  <Avatar profile={p} size={36} />
                  <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold truncate text-[color:var(--brand-fg)]">
                      {p.label}
                    </div>
                    <div className="text-[11px] truncate font-mono text-[color:var(--brand-fg)]/75">
                      {p.domain ? `${p.domain}\\` : ""}
                      {p.username}
                    </div>
                  </div>
                  <button
                    onClick={() => onEditProfile(p)}
                    className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
                    aria-label="Bearbeiten"
                    title="Bearbeiten"
                  >
                    <Pencil size={14} strokeWidth={2.4} />
                  </button>
                  <button
                    onClick={() => deleteProfile(p)}
                    className="p-1.5 rounded-md text-red-700 hover:bg-red-500/15 transition"
                    aria-label="Löschen"
                    title="Löschen"
                  >
                    <Trash2 size={14} strokeWidth={2.4} />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Keyring test - opt-in button, so macOS keychain prompt only pops
              when the admin actively tests it */}
          {!keyringTest ? (
            <button
              onClick={runKeyringTest}
              disabled={testing}
              className="mt-2 w-full surface hover:border-[color:var(--brand-primary)] rounded-md px-3 py-2 text-[12px] font-semibold flex items-center justify-center gap-1.5 text-[color:var(--brand-fg)] transition"
            >
              {testing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <RefreshCw size={12} />
              )}
              {testing ? "Prüfe Schlüsselbund …" : "Schlüsselbund testen"}
            </button>
          ) : (
            <div
              className={`mt-2 rounded-md px-3 py-2 text-[12px] flex items-start gap-2 ${
                keyringTest.ok
                  ? "bg-emerald-600/15 text-emerald-900 border border-emerald-600/40"
                  : "bg-red-600/15 text-red-900 border border-red-600/40"
              }`}
            >
              {keyringTest.ok ? (
                <CheckCircle2 size={14} className="mt-0.5 shrink-0" />
              ) : (
                <XCircle size={14} className="mt-0.5 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="font-bold">{keyringTest.backend}</div>
                <div className="font-medium">{keyringTest.message}</div>
              </div>
              <button
                onClick={runKeyringTest}
                disabled={testing}
                className="p-1 rounded shrink-0 hover:bg-black/10 text-black"
                title="Erneut testen"
              >
                <RefreshCw
                  size={12}
                  className={testing ? "animate-spin" : ""}
                />
              </button>
            </div>
          )}
        </Section>

        <Section title={de.settings.autostart}>
          <p className="text-[12px] text-[color:var(--brand-fg)]/85 mb-2 leading-snug">
            {de.settings.autostartHint}
          </p>
          <Toggle checked={autostart} onChange={toggleAutostart} />
        </Section>

        <Section title="Remote Desktop">
          <button
            onClick={() => setRdpOpen((v) => !v)}
            className="w-full surface rounded-md px-2.5 py-2 flex items-center justify-between text-[12px] font-semibold text-[color:var(--brand-fg)] hover:border-[color:var(--brand-primary)] transition"
          >
            <span className="flex items-center gap-1.5">
              <Monitor size={13} className="text-[color:var(--brand-primary)]" />
              Was im Remote Desktop mitgeht
            </span>
            <ChevronDown
              size={14}
              className={`transition-transform ${rdpOpen ? "rotate-180" : ""}`}
            />
          </button>
          {rdpOpen && rdp && (
            <div className="mt-1.5 surface rounded-md px-2.5 py-0.5 flex flex-col">
              <RdpRow
                label="Zwischenablage"
                hint="Text und Dateien kopieren"
                checked={rdp.clipboard}
                onChange={(v) => setRdpField("clipboard", v)}
              />
              <RdpRow
                label="Laufwerke"
                hint="Lokale Ordner im Server sehen"
                checked={rdp.drives}
                onChange={(v) => setRdpField("drives", v)}
              />
              <RdpRow
                label="Mehrere Bildschirme"
                checked={rdp.multimon}
                onChange={(v) => setRdpField("multimon", v)}
              />
              <RdpRow
                label="Kamera"
                hint="Webcam mitnehmen"
                checked={rdp.camera}
                onChange={(v) => setRdpField("camera", v)}
              />
              <RdpRow
                label="Mikrofon"
                checked={rdp.microphone}
                onChange={(v) => setRdpField("microphone", v)}
              />
              <RdpRow
                label="Ton"
                hint="Audio vom Server hören"
                checked={rdp.audio}
                onChange={(v) => setRdpField("audio", v)}
              />
              <RdpRow
                label="Drucker"
                checked={rdp.printers}
                onChange={(v) => setRdpField("printers", v)}
              />
            </div>
          )}
          <button
            onClick={createShortcut}
            disabled={creatingShortcut}
            className="mt-1.5 w-full surface hover:border-[color:var(--brand-primary)] rounded-md px-3 py-2 text-[12px] font-semibold flex items-center justify-center gap-1.5 text-[color:var(--brand-fg)] transition"
          >
            {creatingShortcut ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <Monitor size={12} />
            )}
            Desktop-Verknüpfung zum Terminalserver
          </button>
        </Section>

        <Section title={de.settings.management}>
          <div className="surface rounded-md px-2.5 py-2 flex items-center gap-2">
            <Server size={14} className="text-[color:var(--brand-primary)] shrink-0" />
            <span className="text-[12px] font-mono truncate text-[color:var(--brand-fg)]">
              {branding.netbird.managementUrl}
            </span>
          </div>
        </Section>

        <Section
          title={de.settings.logsTitle}
          action={
            <button
              onClick={refreshLogs}
              disabled={loadingLogs}
              className="text-[11px] font-semibold flex items-center gap-1 px-2 py-1 rounded-md text-black hover:bg-black/10 transition"
            >
              <RefreshCw
                size={12}
                className={loadingLogs ? "animate-spin" : ""}
              />
              {de.settings.logsRefresh}
            </button>
          }
        >
          <pre className="surface allow-select rounded-md p-2 text-[11px] font-mono overflow-auto h-32 whitespace-pre-wrap leading-tight text-[color:var(--brand-fg)]">
            {logs.length === 0 ? "-" : logs.slice(-50).join("\n")}
          </pre>
        </Section>

        <Section title={de.settings.resetTitle}>
          <p className="text-[12px] text-[color:var(--brand-fg)]/85 mb-2 leading-snug">
            {de.settings.resetHint}
          </p>
          <button
            onClick={resetEnrollment}
            className="w-full surface hover:border-red-500/50 hover:bg-red-500/5 rounded-md py-2.5 text-[13px] font-bold flex items-center justify-center gap-1.5 text-red-700 transition"
          >
            <RotateCcw size={14} strokeWidth={2.4} />
            {de.settings.resetButton}
          </button>
        </Section>

        <Section title={de.settings.version}>
          <div className="flex items-center justify-between text-[12px]">
            <span className="text-[color:var(--brand-fg)]/85">
              {branding.product.name}
            </span>
            <span className="font-mono font-bold text-[color:var(--brand-fg)]">
              {branding.product.version}
            </span>
          </div>
          <UpdateChecker currentVersion={branding.product.version} />
        </Section>

        <button
          onClick={quitApp}
          className="mt-3 w-full surface hover:border-[color:var(--brand-primary)] rounded-md py-2.5 text-[13px] font-bold flex items-center justify-center gap-1.5 transition text-[color:var(--brand-fg)]"
        >
          <LogOut size={14} strokeWidth={2.4} />
          {de.settings.quitApp}
        </button>
      </div>

      {/* Permanent vendor footer */}
      <div className="text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95">
        {branding.vendor.footer}
      </div>
    </div>
  );
}

function Section({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-4 first:mt-0">
      <div className="flex items-center justify-between mb-1.5">
        <h2 className="text-[11px] font-bold uppercase tracking-wider text-[color:var(--brand-fg)]">
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-6 rounded-full transition-colors ${
        checked ? "bg-[var(--brand-primary)]" : "bg-[color:var(--brand-fg)]/20"
      }`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
      <Power
        size={10}
        className={`absolute top-1.5 ${
          checked ? "left-1.5 text-white" : "right-1.5 text-[color:var(--brand-fg)]/40"
        }`}
      />
    </button>
  );
}

function RdpRow({
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
      <div className="min-w-0">
        <div className="text-[12.5px] font-semibold text-[color:var(--brand-fg)]">
          {label}
        </div>
        {hint && (
          <div className="text-[10px] text-[color:var(--brand-fg)]/55">{hint}</div>
        )}
      </div>
      <Toggle checked={checked} onChange={onChange} />
    </div>
  );
}

type UpdPhase =
  | "idle"
  | "checking"
  | "uptodate"
  | "available"
  | "downloading"
  | "ready"
  | "error";

// Map low-level updater/transport errors to a calm German message; the raw
// string is kept as secondary detail so support can still see it.
function friendlyUpdateError(raw: string): string {
  const s = raw.toLowerCase();
  if (/network|sending request|connection|connect|timed out|timeout|dns|resolve|unreachable|tls|certificate|fetch|socket/.test(s))
    return "Keine Verbindung zum Update-Server. Bist du online (ggf. mit dem VPN verbunden)?";
  if (/signature|verify|pubkey|public key|minisign/.test(s))
    return "Update-Signatur konnte nicht geprüft werden. Bitte den Support informieren.";
  if (/json|manifest|parse|deserialize|decode/.test(s))
    return "Update-Informationen sind gerade nicht lesbar. Bitte später erneut versuchen.";
  return "Update fehlgeschlagen. Bitte später erneut versuchen.";
}

/**
 * Manual "check for updates" in Settings. Uses the same updater plugin as the
 * automatic startup check, but on demand. Bulletproof by design: re-entrancy
 * guards, unmount-safe state, indeterminate progress when the size is unknown,
 * a calm localized error message, a "Später" back-out, and a restart that can
 * be retried (a failed relaunch does NOT lose the installed update).
 */
function UpdateChecker({ currentVersion }: { currentVersion: string }) {
  const [phase, setPhase] = useState<UpdPhase>("idle");
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [hasTotal, setHasTotal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [errDetail, setErrDetail] = useState<string | null>(null);
  const [restartErr, setRestartErr] = useState<string | null>(null);
  const updateRef = useRef<Update | null>(null);
  const busyRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  async function doCheck() {
    if (busyRef.current || phase === "checking") return;
    busyRef.current = true;
    setPhase("checking");
    setErr(null);
    setErrDetail(null);
    try {
      const upd = await check();
      if (!mountedRef.current) return;
      if (!upd) {
        setPhase("uptodate");
        return;
      }
      updateRef.current = upd;
      setNewVersion(upd.version);
      setPhase("available");
    } catch (e: unknown) {
      if (!mountedRef.current) return;
      const raw = e instanceof Error ? e.message : String(e);
      setErr(friendlyUpdateError(raw));
      setErrDetail(raw);
      setPhase("error");
    } finally {
      busyRef.current = false;
    }
  }

  async function doInstall() {
    if (busyRef.current) return;
    const upd = updateRef.current;
    if (!upd) return;
    busyRef.current = true;
    setPhase("downloading");
    setProgress(0);
    setHasTotal(false);
    setErr(null);
    setErrDetail(null);
    try {
      let total = 0;
      let done = 0;
      await upd.downloadAndInstall((ev) => {
        if (ev.event === "Started" && ev.data.contentLength) {
          total = ev.data.contentLength;
          if (mountedRef.current) setHasTotal(true);
        }
        if (ev.event === "Progress") {
          done += ev.data.chunkLength;
          if (total > 0 && mountedRef.current)
            setProgress(Math.min(100, Math.round((done / total) * 100)));
        }
        if (ev.event === "Finished" && mountedRef.current) {
          setProgress(100);
          setHasTotal(true);
        }
      });
      if (mountedRef.current) setPhase("ready");
    } catch (e: unknown) {
      if (mountedRef.current) {
        const raw = e instanceof Error ? e.message : String(e);
        setErr(friendlyUpdateError(raw));
        setErrDetail(raw);
        setPhase("error");
      }
    } finally {
      busyRef.current = false;
    }
  }

  async function doRestart() {
    if (busyRef.current) return;
    busyRef.current = true;
    setRestartErr(null);
    try {
      await invoke("relaunch_app");
      // Process is being torn down on success; nothing else to do.
    } catch {
      // Stay in "ready" so the restart button remains for a retry — the update
      // is already on disk and applies on the next manual launch.
      if (mountedRef.current)
        setRestartErr(
          "Neustart hat nicht geklappt. Schließe die App manuell und öffne sie neu — das Update ist bereits installiert."
        );
    } finally {
      busyRef.current = false;
    }
  }

  function dismiss() {
    updateRef.current = null;
    setNewVersion(null);
    setPhase("idle");
  }

  return (
    <div className="mt-2" role="status" aria-live="polite">
      {(phase === "idle" ||
        phase === "checking" ||
        phase === "uptodate" ||
        phase === "error") && (
        <button
          onClick={doCheck}
          disabled={phase === "checking"}
          aria-busy={phase === "checking"}
          className="w-full surface hover:border-[color:var(--brand-primary)] rounded-md px-3 py-2 text-[12px] font-semibold flex items-center justify-center gap-1.5 text-[color:var(--brand-fg)] transition disabled:opacity-60"
        >
          {phase === "checking" ? (
            <Loader2 size={12} className="animate-spin" />
          ) : (
            <RefreshCw size={12} />
          )}
          {phase === "checking" ? "Suche nach Updates …" : "Nach Updates suchen"}
        </button>
      )}

      {phase === "uptodate" && (
        <div className="mt-1.5 rounded-md px-3 py-2 text-[12px] flex items-center gap-2 bg-emerald-600/15 text-emerald-900 border border-emerald-600/40">
          <CheckCircle2 size={14} className="shrink-0" />
          <span className="font-medium">
            Du hast die neueste Version ({currentVersion}).
          </span>
        </div>
      )}

      {phase === "available" && (
        <div className="mt-1.5 rounded-md px-3 py-2 bg-[color:var(--brand-primary)]/10 border border-[color:var(--brand-primary)]/40">
          <div className="text-[12px] font-bold text-[color:var(--brand-fg)] flex items-center gap-1.5 mb-1.5">
            <Download size={13} className="text-[color:var(--brand-primary)]" />
            Update auf {newVersion} verfügbar
          </div>
          <button
            onClick={doInstall}
            className="w-full rounded-md py-2 text-[12px] font-bold text-white bg-[color:var(--brand-primary)] hover:bg-[color:var(--brand-primary-hover)] transition"
          >
            Jetzt installieren
          </button>
          <button
            onClick={dismiss}
            className="mt-1.5 w-full rounded-md py-1.5 text-[11px] font-semibold text-[color:var(--brand-fg)]/70 hover:text-[color:var(--brand-fg)] hover:bg-black/5 transition"
          >
            Später
          </button>
        </div>
      )}

      {phase === "downloading" && (
        <div className="mt-1.5 rounded-md px-3 py-2 surface">
          <div className="text-[12px] font-semibold text-[color:var(--brand-fg)] flex items-center gap-1.5 mb-1.5">
            <Loader2 size={12} className="animate-spin" />
            {hasTotal ? `Lädt Update … ${progress}%` : "Lädt Update …"}
          </div>
          <div className="h-1.5 rounded-full bg-[color:var(--brand-fg)]/15 overflow-hidden">
            {hasTotal ? (
              <div
                className="h-full bg-[color:var(--brand-primary)] transition-all"
                style={{ width: `${progress}%` }}
              />
            ) : (
              <div className="h-full w-1/3 rounded-full bg-[color:var(--brand-primary)] animate-pulse" />
            )}
          </div>
        </div>
      )}

      {phase === "ready" && (
        <div className="mt-1.5 rounded-md px-3 py-2 bg-emerald-600/15 border border-emerald-600/40">
          <div className="text-[12px] font-bold text-emerald-900 flex items-center gap-1.5 mb-1.5">
            <CheckCircle2 size={13} />
            Update installiert
          </div>
          <button
            onClick={doRestart}
            className="w-full rounded-md py-2 text-[12px] font-bold text-white bg-emerald-700 hover:bg-emerald-800 transition flex items-center justify-center gap-1.5"
          >
            <RotateCcw size={13} strokeWidth={2.4} />
            Jetzt neu starten
          </button>
          {restartErr && (
            <div className="mt-1.5 text-[11px] font-medium text-emerald-900/80 break-words">
              {restartErr}
            </div>
          )}
        </div>
      )}

      {phase === "error" && err && (
        <div className="mt-1.5 rounded-md px-3 py-2 text-[12px] flex items-start gap-2 bg-red-600/15 text-red-900 border border-red-600/40">
          <XCircle size={14} className="mt-0.5 shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="font-bold">Update fehlgeschlagen</div>
            <div className="font-medium break-words">{err}</div>
            {errDetail && errDetail !== err && (
              <div className="mt-0.5 text-[10px] opacity-70 break-words">{errDetail}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
