import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Headphones,
  HelpCircle,
  Info,
  Link2,
  Loader2,
  Newspaper,
  Power,
  Settings as SettingsIcon,
  Stethoscope,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useContextMenu } from "../components/ContextMenu";
import { Decor } from "../components/Decor";
import { Logo } from "../components/Logo";
import { TaglineMark } from "../components/TaglineMark";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import { copyText } from "../lib/clipboard";
import { italicAccent, timeOfDayGreeting } from "../lib/greeting";
import type { BrandingDto, QuickLaunchEntry } from "../types/branding";
import { displayName, type CredentialProfileMeta } from "../types/credentials";
import type {
  ConnectivityResult,
  NetworkContext,
  SmartDebugResult,
} from "../types/debug";
import type { ConnectionState, StatusDto } from "../types/netbird";

interface Props {
  branding: BrandingDto;
  status: StatusDto | null;
  profile: CredentialProfileMeta | null;
  onRequestLaunch: (item: QuickLaunchEntry) => Promise<void> | void;
  onOpenCredentials: () => void;
  onOpenSettings: () => void;
  onOpenAbout: () => void;
  onOpenNews: () => void;
}

export function MainScreen({
  branding,
  status,
  profile,
  onRequestLaunch,
  onOpenCredentials,
  onOpenSettings,
  onOpenAbout,
  onOpenNews,
}: Props) {
  const [busy, setBusy] = useState(false);
  const pendingToggle = useRef(false); // prevent double-click race condition
  const toast = useToast();
  const showMenu = useContextMenu();
  const state: ConnectionState = status?.state ?? "Disconnected";
  const isConnected = state === "Connected";
  const isBusy = busy || state === "Connecting";

  // On-site detection: when the terminal server is reachable directly on the
  // office LAN, RDP works without the VPN, so we enable the launch cards and
  // tell the employee no VPN is needed. Re-checked whenever the VPN state moves.
  const [netCtx, setNetCtx] = useState<NetworkContext | null>(null);
  useEffect(() => {
    let alive = true;
    const probe = () =>
      invoke<NetworkContext>("detect_network_context")
        .then((r) => alive && setNetCtx(r))
        .catch(() => {});
    probe();
    // Re-probe once the routes have settled. A reading taken the instant the
    // tunnel flips (before routes are ready) can never stick, so the on-site
    // read is bulletproof and never a false positive from probing too early.
    const settle = setTimeout(probe, 1600);
    return () => {
      alive = false;
      clearTimeout(settle);
    };
  }, [state]);
  // Right after a disconnect the tunnel is still tearing down, so the on-site
  // probe can briefly read the server as directly reachable and flash a wrong
  // "no VPN needed" banner. Ignore the on-site read during that settle window
  // (a touch longer than the re-probe above), so it never shows a wrong state.
  const [justDisconnected, setJustDisconnected] = useState(false);
  const prevStateForGrace = useRef(state);
  const graceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const was = prevStateForGrace.current;
    prevStateForGrace.current = state;
    if (was === "Connected" && state === "Disconnected") {
      // Restart the grace on every disconnect via a ref-held timer, not the
      // effect cleanup. Reconnect flapping (Disconnected -> Connecting -> ...)
      // would otherwise clear the timer and strand the flag on forever.
      setJustDisconnected(true);
      if (graceTimer.current) clearTimeout(graceTimer.current);
      graceTimer.current = setTimeout(() => {
        setJustDisconnected(false);
        graceTimer.current = null;
      }, 1800);
    }
  }, [state]);
  useEffect(
    () => () => {
      if (graceTimer.current) clearTimeout(graceTimer.current);
    },
    []
  );
  const onSiteActive =
    !justDisconnected && (netCtx?.serverReachableDirect ?? false);
  const canLaunch = isConnected || onSiteActive;

  const [connectivity, setConnectivity] = useState<ConnectivityResult | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [fixing, setFixing] = useState(false);
  const [fixResult, setFixResult] = useState<SmartDebugResult | null>(null);
  // One-tap auto-fix. Same smart_debug command the Diagnose uses, so there is
  // no second implementation to drift. Surfaces a clear OK / not-OK and never
  // throws at the user.
  const runSmartFix = async () => {
    setFixing(true);
    setFixResult(null);
    try {
      setFixResult(await invoke<SmartDebugResult>("smart_debug"));
    } catch {
      setFixResult({
        steps: [],
        summary: "Konnte nicht automatisch geprüft werden. Bitte Diagnose öffnen.",
      });
    } finally {
      setFixing(false);
    }
  };
  useEffect(() => {
    let alive = true;
    const probe = () =>
      invoke<ConnectivityResult>("check_connectivity")
        .then((r) => alive && setConnectivity(r))
        .catch(() => {});
    probe();
    const settle = setTimeout(probe, 1600);
    return () => {
      alive = false;
      clearTimeout(settle);
    };
  }, [state]);

  // Smart, plain-language read of the situation. Only states we can detect
  // reliably are shown, so the employee never gets a false alarm.
  const situation = useMemo<
    | { tone: "good" | "warn" | "info" | "error"; text: string; action: "fixdh" | null }
    | null
  >(() => {
    if (isConnected) return null;
    if (status && !status.cli_available)
      return {
        tone: "error",
        text: "Das VPN-Programm fehlt auf diesem Rechner. Bitte beim Support melden.",
        action: null,
      };
    // Expired session: a fleeting toast leaves the employee stuck, so we keep a
    // calm, persistent hint with the one action that actually re-logs in.
    if (status?.needs_login)
      return {
        tone: "warn",
        text: "Deine Anmeldung ist abgelaufen. Tippe unten auf Verbinden, um dich neu anzumelden. Klappt das nicht, hilft die Diagnose oder der Support.",
        action: null,
      };
    if (onSiteActive)
      return {
        tone: "good",
        text: "Du bist im NKK-Netz. Die Server gehen direkt, du brauchst hier kein VPN.",
        action: null,
      };
    if (netCtx?.dualHoming)
      return {
        tone: "warn",
        text: "Kabel und WLAN laufen gleichzeitig, das bremst. Ich kann automatisch das Kabel bevorzugen.",
        action: "fixdh",
      };
    if (connectivity && !connectivity.online && !connectivity.captivePortal)
      return {
        tone: "error",
        text: "Keine Internetverbindung. Prüfe dein WLAN oder steck das LAN-Kabel ein.",
        action: null,
      };
    if (connectivity?.captivePortal)
      return {
        tone: "warn",
        text: "Dieses WLAN will erst eine Anmeldung im Browser. Melde dich dort an, dann geht das VPN.",
        action: null,
      };
    if (state === "Error")
      return {
        tone: "error",
        text: "Die Verbindung ist gestört. Tippe unten auf Verbinden oder öffne bei Bedarf die Diagnose.",
        action: null,
      };
    if (netCtx)
      return {
        tone: "info",
        text: "Du bist unterwegs. Tippe unten auf Verbinden, um auf die Server zu kommen.",
        action: null,
      };
    return null;
  }, [isConnected, status, onSiteActive, netCtx, connectivity, state]);

  const [fixingDh, setFixingDh] = useState(false);
  async function fixDualHoming() {
    setFixingDh(true);
    try {
      const r = await invoke<{ applied: boolean; message: string }>(
        "dualhoming_prefer_wired"
      );
      if (r.applied) toast.success(r.message);
      else toast.info(r.message);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFixingDh(false);
    }
  }

  // First-run coach mark: gently point a new employee at the Verbinden button,
  // exactly once. Dismissed by tapping it away or by connecting.
  const [showCoach, setShowCoach] = useState(() => {
    try {
      return !localStorage.getItem("nkk-onboarded");
    } catch {
      return false;
    }
  });
  function dismissCoach() {
    try {
      localStorage.setItem("nkk-onboarded", "1");
    } catch {
      /* private mode: hide for this session only */
    }
    setShowCoach(false);
  }
  useEffect(() => {
    if (showCoach && (isConnected || state === "Connecting")) dismissCoach();
  }, [isConnected, state, showCoach]);

  // Shift+<digit> hotkeys for quick-launch entries, including hidden ones
  // (e.g. Shift+1 launches the hidden Terminalserver 1). Plain Shift only, so it
  // never collides with the admin shortcut (Cmd/Ctrl+Shift+0), and never fires
  // while typing in a field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const m = e.code.match(/^Digit([1-9])$/);
      if (!m) return;
      const item = branding.quickLaunch.find((q) => q.hotkey === m[1]);
      if (item) {
        e.preventDefault();
        onRequestLaunch(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [branding.quickLaunch, onRequestLaunch]);

  const greetingName = displayName(profile);
  const greeting = timeOfDayGreeting();
  const accent = italicAccent(state);

  // Track state transitions for animations
  const prevState = useRef(state);
  const transition = useMemo(() => {
    const was = prevState.current;
    prevState.current = state;
    if (state === "Connected" && was !== "Connected") return "connected";
    if (state === "Disconnected" && was === "Connected") return "disconnected";
    if (state === "Connecting") return "connecting";
    return "none";
  }, [state]);

  // Fire the success toast on the REAL Connected transition (user-initiated or
  // auto-reconnect), so it only ever shows when the tunnel is genuinely up.
  useEffect(() => {
    if (transition === "connected") toast.success(de.toast.connected);
  }, [transition, toast]);

  // Live clock + date - updates every 30s
  function formatDateTime() {
    const now = new Date();
    const time = now.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
    const date = now.toLocaleDateString("de-DE", { weekday: "short", day: "numeric", month: "short" });
    return { time, date };
  }
  const [dateTime, setDateTime] = useState(formatDateTime);
  useEffect(() => {
    const id = setInterval(() => setDateTime(formatDateTime()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Hidden entries (e.g. the outdated Terminalserver 1) are not shown as cards;
  // they are only reachable via their Shift+<digit> hotkey.
  const launches = [...branding.quickLaunch]
    .filter((q) => !q.hidden)
    .sort((a, b) => Number(!!b.default) - Number(!!a.default));

  async function toggle() {
    if (pendingToggle.current) return;
    pendingToggle.current = true;
    setBusy(true);
    const wantDisconnect = isConnected;
    const minBusy = new Promise((r) => setTimeout(r, 2500)); // particles visible min 2.5s
    try {
      if (wantDisconnect) {
        await Promise.all([invoke("nb_disconnect"), minBusy]);
        toast.info(de.toast.disconnected);
      } else {
        // Only kick off the connect here. The success toast is fired by the
        // real Connected transition below, never from this call returning - so
        // the employee never sees "connected" while the tunnel is still coming
        // up (the false positive that led to launching too early).
        await Promise.all([invoke("nb_connect", {}), minBusy]);
      }
    } catch (e: unknown) {
      await minBusy; // show particles even on error
      // Technical detail goes to the log; the employee sees a calm message.
      console.error("VPN toggle failed:", e);
      toast.error(
        wantDisconnect
          ? "Trennen hat nicht geklappt. Bitte erneut versuchen."
          : "Verbindung fehlgeschlagen. Bitte erneut versuchen, sonst beim Support melden."
      );
    } finally {
      setBusy(false);
      pendingToggle.current = false;
    }
  }

  return (
    <div className="h-full flex flex-col relative">
      <Decor />
      {/* Top utility bar pinned to top */}
      <header className="relative z-20 px-4 pt-4 pb-2 flex items-center gap-1 bg-[color:var(--brand-bg-soft)] border-b border-[color:var(--brand-border)]">
        <div className="flex-1">
          <span className="text-[13px] font-bold text-[color:var(--brand-fg)]/85 tabular-nums">
            {dateTime.time}
          </span>
          <span className="text-[10px] ml-1.5 text-[color:var(--brand-fg)]/55">
            {dateTime.date}
          </span>
        </div>
        <Avatar
          profile={profile}
          size={28}
          onClick={onOpenCredentials}
          title={
            profile?.username
              ? `${profile.label} (${profile.username})`
              : "Anmeldedaten einrichten"
          }
        />
        <button
          onClick={onOpenNews}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Aktuelles"
          title="Aktuelles & Changelog"
        >
          <Newspaper size={16} strokeWidth={2.4} />
        </button>
        <button
          onClick={onOpenAbout}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label="Diagnose & Support"
          title="Diagnose & Support"
        >
          <Headphones size={16} strokeWidth={2.4} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md text-black hover:bg-black/10 transition"
          aria-label={de.main.settings}
          title={de.main.settings}
        >
          <SettingsIcon size={16} strokeWidth={2.4} />
        </button>
      </header>

      {/* Hero - vertically centred so there is equal space above and below the
          content block. */}
      <main className="main-scroll relative z-10 flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-center px-2 gap-2.5 py-3 text-center">
        <div className="fade-in-1 flex flex-col items-center">
          <div
            className="relative flex items-center justify-center cursor-pointer"
            style={{ width: 120, height: 120 }}
            onClick={() => { /* logo tap - no action */ }}
          >
            {/* Professional particles - cherry red dots + subtle BIO labels */}
            {isBusy && (
              <>
                {[
                  { angle: "0deg",   dist: "90px", speed: 1.3, delay: 0,   sz: 5, color: "#B51F29" },
                  { angle: "50deg",  dist: "85px", speed: 1.5, delay: 0.2, sz: 4, color: "#4a8c3f" },
                  { angle: "95deg",  dist: "88px", speed: 1.4, delay: 0.5, sz: 5, color: "#B51F29" },
                  { angle: "140deg", dist: "82px", speed: 1.6, delay: 0.3, sz: 4, color: "#e8a317" },
                  { angle: "185deg", dist: "90px", speed: 1.3, delay: 0.7, sz: 5, color: "#4a8c3f" },
                  { angle: "230deg", dist: "80px", speed: 1.5, delay: 0.1, sz: 4, color: "#B51F29" },
                  { angle: "275deg", dist: "86px", speed: 1.4, delay: 0.6, sz: 5, color: "#e8a317" },
                  { angle: "320deg", dist: "84px", speed: 1.6, delay: 0.4, sz: 4, color: "#4a8c3f" },
                  { angle: "25deg",  dist: "92px", speed: 1.7, delay: 0.8, sz: 5, color: "#B51F29" },
                  { angle: "210deg", dist: "82px", speed: 1.3, delay: 0.9, sz: 4, color: "#e8a317" },
                ].map((p, i) => (
                  <div
                    key={i}
                    className="logo-particle"
                    style={{
                      "--angle": p.angle,
                      "--dist": p.dist,
                      animationDuration: `${p.speed}s`,
                      animationDelay: `${p.delay}s`,
                      width: p.sz,
                      height: p.sz,
                      borderRadius: "50%",
                      background: p.color,
                    } as React.CSSProperties}
                  />
                ))}
              </>
            )}
            {/* Green dots burst on connect */}
            {transition === "connected" && !isBusy && (
              <>
                {Array.from({ length: 8 }, (_, i) => (
                  <div
                    key={i}
                    className="logo-particle logo-particle-green"
                    style={{
                      "--angle": `${i * 45}deg`,
                      "--dist": "92px",
                      animationDelay: `${i * 0.04}s`,
                      width: 5,
                      height: 5,
                      borderRadius: "50%",
                      background: "#10b981",
                    } as React.CSSProperties}
                  />
                ))}
              </>
            )}
            <Logo
              branding={branding}
              size={104}
              className={clsx(
                "relative z-10 transition-transform duration-300",
                isBusy && "logo-float",
                transition === "connected" && !isBusy && "logo-connected-pop"
              )}
            />
          </div>
          <TaglineMark width={180} className="mt-1.5" />
        </div>

        <div className="fade-in-2 mt-1">
          <div className="font-serif-display text-[22px] leading-[1.0]">
            {greeting}
            {greetingName ? `, ${greetingName}` : ""}.
          </div>
          <div
            className="font-serif-display italic text-[18px] leading-[1.0] mt-0.5"
            style={{ color: "var(--brand-primary)" }}
          >
            {accent}
          </div>
        </div>

        <div className="fade-in-3 w-full flex flex-col gap-2 mt-1">
          {launches.map((item, i) => (
            <LaunchCard
              key={item.target}
              item={item}
              primary={i === 0}
              disabled={!canLaunch}
              onClick={() => onRequestLaunch(item)}
            />
          ))}
        </div>

        {/* Situation read sits BELOW the action: a late or changing read never
            shifts the primary button, and it fades in place (opacity only) so
            it can never visibly jump. */}
        {situation &&
          (() => {
            const TONE = {
              good: {
                box: "bg-emerald-500/12 border border-emerald-500/35",
                text: "text-emerald-800",
                icon: "text-emerald-600",
                Icon: CheckCircle2,
              },
              warn: {
                box: "bg-amber-500/15 border border-amber-500/40",
                text: "text-amber-800",
                icon: "text-amber-600",
                Icon: AlertTriangle,
              },
              info: {
                box: "surface",
                text: "text-[color:var(--brand-fg)]/90",
                icon: "text-[color:var(--brand-primary)]",
                Icon: Info,
              },
              error: {
                box: "bg-red-500/12 border border-red-500/40",
                text: "text-red-700",
                icon: "text-red-600",
                Icon: XCircle,
              },
            } as const;
            const t = TONE[situation.tone];
            const SitIcon = t.Icon;
            return (
              <div
                className={clsx(
                  "banner-in w-full rounded-xl px-3 py-2.5 flex flex-col gap-2 mt-2",
                  t.box
                )}
              >
                <div className="flex items-start gap-2">
                  <SitIcon size={15} className={clsx("shrink-0 mt-0.5", t.icon)} />
                  <span
                    className={clsx(
                      "text-[11.5px] font-semibold leading-snug",
                      t.text
                    )}
                  >
                    {situation.text}
                  </span>
                </div>
                {situation.action === "fixdh" && (
                  <button
                    onClick={fixDualHoming}
                    disabled={fixingDh}
                    className="w-full text-[11px] font-bold rounded-lg py-2 bg-amber-600 text-white hover:bg-amber-700 transition disabled:opacity-50 active:scale-[0.98]"
                  >
                    {fixingDh ? "wird gesetzt …" : "Kabel automatisch bevorzugen"}
                  </button>
                )}
              </div>
            );
          })()}

        {/* Contextual help, collapsed by default so it never gets in the way;
            expands smoothly with a plain-language tip and a Diagnose shortcut. */}
        <div className="w-full flex flex-col items-center mt-1.5">
          <button
            onClick={() => setHelpOpen((v) => !v)}
            aria-expanded={helpOpen}
            className="flex items-center gap-1.5 text-[11px] font-semibold text-muted hover:text-[color:var(--brand-primary)] transition px-2 py-1 rounded-lg"
          >
            <HelpCircle size={13} />
            {helpOpen ? "Hilfe schließen" : "Hilfe"}
          </button>
          {helpOpen && (
            <div className="help-pop w-full surface rounded-xl px-3 py-2.5 mt-1.5 flex flex-col gap-2">
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-[color:var(--brand-primary)]/12 text-[color:var(--brand-primary)] text-[10px] font-bold flex items-center justify-center">
                  1
                </span>
                <span className="text-[11px] font-semibold text-[color:var(--brand-fg)]/85 leading-snug">
                  {isConnected
                    ? "Du bist verbunden. Tippe oben auf den Terminalserver, dann öffnet sich die Sitzung."
                    : "Tippe unten auf Verbinden. Sobald es grün ist, öffnet der Terminalserver-Button die Sitzung."}
                </span>
              </div>
              <div className="flex items-start gap-2">
                <span className="shrink-0 mt-0.5 w-4 h-4 rounded-full bg-[color:var(--brand-primary)]/12 text-[color:var(--brand-primary)] text-[10px] font-bold flex items-center justify-center">
                  2
                </span>
                <span className="text-[11px] font-semibold text-[color:var(--brand-fg)]/85 leading-snug">
                  Klemmt etwas? Die Diagnose prüft alles automatisch und sagt in
                  Klartext, was zu tun ist.
                </span>
              </div>
              <button
                onClick={runSmartFix}
                disabled={fixing}
                className="w-full mt-0.5 text-[11px] font-bold rounded-lg py-2 btn-primary active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-1.5"
              >
                {fixing ? (
                  <>
                    <Loader2 size={13} className="animate-spin" /> Prüfe und
                    repariere …
                  </>
                ) : (
                  "Problem automatisch beheben"
                )}
              </button>
              {fixResult && (
                <div
                  className={clsx(
                    "fade-soft rounded-lg px-2.5 py-2 text-[11px] font-semibold leading-snug text-center",
                    fixResult.steps.length > 0 &&
                      fixResult.steps.every((s) => s.ok)
                      ? "bg-emerald-500/12 text-emerald-800"
                      : "bg-amber-500/15 text-amber-800"
                  )}
                >
                  {fixResult.summary}
                </div>
              )}
              <button
                onClick={() => {
                  setHelpOpen(false);
                  onOpenAbout();
                }}
                className="text-[10.5px] font-semibold text-muted hover:text-[color:var(--brand-primary)] transition"
              >
                Mehr in der Diagnose
              </button>
            </div>
          )}
        </div>
        </div>
      </main>

      {/* First-run hint pointing at the Verbinden button (shown once) */}
      {showCoach && !isConnected && !isBusy && (status ? status.cli_available : true) && (
        <div className="absolute bottom-[66px] right-3 z-30 max-w-[230px] coach-pop">
          <div className="relative coach-bob surface rounded-xl px-3 py-2.5 shadow-lg border-2 border-[color:var(--brand-primary)]">
            <button
              onClick={dismissCoach}
              aria-label="Hinweis schließen"
              className="absolute top-1 right-1 text-[color:var(--brand-fg)]/45 hover:text-[color:var(--brand-fg)]"
            >
              <X size={13} />
            </button>
            <div className="text-[11.5px] font-semibold text-[color:var(--brand-fg)] leading-snug pr-3">
              Tipp: Hier unten auf{" "}
              <span className="text-[color:var(--brand-primary)]">Verbinden</span>{" "}
              tippen, um auf den Server zu kommen.
            </div>
            <div className="absolute -bottom-[7px] right-7 w-3.5 h-3.5 rotate-45 bg-[color:var(--brand-surface)] border-r-2 border-b-2 border-[color:var(--brand-primary)]" />
          </div>
        </div>
      )}

      {/* VPN Status Bar - clearly distinct between connected / disconnected */}
      <div
        onContextMenu={(e) =>
          showMenu(e, [
            {
              label: isConnected ? "VPN trennen" : "VPN verbinden",
              icon: <Power size={13} />,
              onClick: toggle,
              disabled: isBusy,
            },
            {
              label: "Diagnose öffnen",
              icon: <Stethoscope size={13} />,
              onClick: onOpenAbout,
            },
            {
              label: "Einstellungen",
              icon: <SettingsIcon size={13} />,
              onClick: onOpenSettings,
            },
          ])
        }
        className={clsx(
          "fade-in-5 relative z-10 px-4 shrink-0 transition-colors duration-300",
          "py-2.5",
          isConnected
            ? "bg-emerald-600"
            : state === "Connecting"
            ? "bg-amber-500"
            : state === "Error"
            ? "bg-red-600"
            : "bg-[color:var(--brand-primary)]",
          transition === "connected" && "vpn-connected-enter",
          transition === "disconnected" && "vpn-disconnect-enter"
        )}
      >
        {/* Connecting shimmer overlay */}
        {state === "Connecting" && (
          <div className="absolute inset-0 vpn-connecting-bar rounded-inherit" />
        )}

        <div className="relative flex items-center gap-2">
          {/* Status dot - always same size to prevent layout jump */}
          <div
            className={clsx(
              "w-2.5 h-2.5 rounded-full shrink-0 transition-colors",
              isBusy ? "bg-white vpn-connecting-dot" :
              isConnected ? "bg-white dot-connected" : "bg-white/50",
              transition === "connected" && "vpn-dot-pulse"
            )}
          />

          {/* Status text - fixed min-width so layout doesn't jump on state change */}
          <span className="flex-1 text-[12px] font-bold text-white truncate min-h-[18px]">
            {isConnected
              ? `Verbunden${status?.local_ip ? `: ${status.local_ip}` : ""}`
              : state === "Connecting"
              ? "Verbinde …"
              : state === "Error"
              ? "Verbindung gestört"
              : onSiteActive
              ? "Im Firmennetz (kein VPN nötig)"
              : "Nicht verbunden"}
          </span>

          {/* Toggle button - single element, changes style not structure */}
          <button
            onClick={toggle}
            disabled={isBusy || (!isConnected && status ? !status.cli_available : false)}
            className={clsx(
              "relative rounded-full py-1.5 text-[11px] font-bold uppercase tracking-wider transition-all min-w-[100px]",
              isConnected
                ? "px-3 bg-white/20 hover:bg-white/30 text-white border border-white/30"
                : "px-4 bg-white text-[color:var(--brand-primary)] shadow-lg hover:shadow-xl active:scale-95",
              isBusy && "opacity-50 cursor-not-allowed"
            )}
          >
            {!isConnected && !isBusy && (
              <span className="absolute inset-0 rounded-full bg-white/60 vpn-glow-ring" />
            )}
            <span className="relative">
              {isBusy ? "…" : isConnected ? "Trennen" : "▶ Verbinden"}
            </span>
          </button>
        </div>
      </div>

      {/* Permanent KronSolutions footer */}
      <div
        className="relative z-10 text-center text-[9px] py-1 shrink-0 font-bold uppercase tracking-[0.15em] text-[color:var(--brand-surface)]/85 bg-[color:var(--brand-primary)]/95"
      >
        {branding.vendor.footer}
      </div>
    </div>
  );
}

// Modern 4-pane Windows logo, so an employee sees at a glance that the card
// opens a Windows terminal server.
function WindowsLogo({
  size = 18,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className={className}
    >
      <rect x="2" y="2" width="9" height="9" rx="1" />
      <rect x="13" y="2" width="9" height="9" rx="1" />
      <rect x="2" y="13" width="9" height="9" rx="1" />
      <rect x="13" y="13" width="9" height="9" rx="1" />
    </svg>
  );
}

function LaunchCard({
  item,
  primary,
  disabled,
  onClick,
}: {
  item: QuickLaunchEntry;
  primary: boolean;
  disabled: boolean;
  onClick: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const showMenu = useContextMenu();
  const toast = useToast();
  const actionLabel =
    item.type === "rdp"
      ? `Mit ${item.label} verbinden`
      : `${item.label} öffnen`;

  async function handle() {
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={handle}
      onContextMenu={(e) =>
        showMenu(e, [
          { label: actionLabel, icon: <ArrowRight size={13} />, onClick: handle },
          {
            label: "Adresse kopieren",
            icon: <Copy size={13} />,
            onClick: async () => {
              const ok = await copyText(item.target);
              if (ok) toast.success("Adresse kopiert.");
              else toast.error("Kopieren nicht möglich.");
            },
          },
          ...(item.type === "rdp"
            ? [
                {
                  label: "Desktop-Verknüpfung erstellen",
                  icon: <Link2 size={13} />,
                  onClick: async () => {
                    try {
                      await invoke("create_desktop_rdp_shortcut");
                      toast.success("Verknüpfung auf dem Desktop erstellt.");
                    } catch (e: unknown) {
                      toast.error(e instanceof Error ? e.message : String(e));
                    }
                  },
                },
              ]
            : []),
        ])
      }
      disabled={disabled || busy}
      className={clsx(
        "w-full rounded-xl px-4 py-3.5 flex items-center gap-3 text-left transition group",
        primary
          ? "btn-primary hover:-translate-y-0.5"
          : "surface hover:border-[color:var(--brand-primary)]/50 hover:-translate-y-0.5",
        (disabled || busy) && "opacity-50 cursor-not-allowed hover:translate-y-0"
      )}
    >
      <div
        className={clsx(
          "w-10 h-10 rounded-lg flex items-center justify-center shrink-0",
          primary
            ? "bg-white/15"
            : "bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)]"
        )}
      >
        {busy ? (
          <Loader2 size={18} className="animate-spin" />
        ) : item.type === "rdp" ? (
          <WindowsLogo size={17} className="transition group-hover:scale-110" />
        ) : (
          <ArrowRight
            size={18}
            className="transition group-hover:translate-x-0.5"
          />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div
          className={clsx(
            "text-[14.5px] font-bold leading-tight",
            primary ? "text-white" : ""
          )}
        >
          {actionLabel}
        </div>
        {item.description && (
          <div
            className={clsx(
              "text-[10px] truncate mt-0.5",
              primary ? "text-white/80" : "text-muted"
            )}
          >
            {item.description}
          </div>
        )}
      </div>
    </button>
  );
}
