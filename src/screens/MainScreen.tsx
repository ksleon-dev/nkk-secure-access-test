import { invoke } from "@tauri-apps/api/core";
import clsx from "clsx";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  FolderOpen,
  Globe,
  Headphones,
  HelpCircle,
  Info,
  Link2,
  Loader2,
  Newspaper,
  Power,
  RotateCcw,
  Search,
  Server,
  ServerCog,
  Settings as SettingsIcon,
  ShieldCheck,
  SquareTerminal,
  Stethoscope,
  X,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../components/Avatar";
import { useContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { Decor } from "../components/Decor";
import { Logo } from "../components/Logo";
import { TaglineMark } from "../components/TaglineMark";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import { copyText } from "../lib/clipboard";
import { italicAccent, timeOfDayGreeting } from "../lib/greeting";
import type { BrandingDto, QuickLaunchEntry } from "../types/branding";
import { roleCanSee, normalizeRole, ROLE_LABELS, descriptionForRole } from "../lib/roles";
import { displayName, type CredentialProfileMeta } from "../types/credentials";
import type {
  AppSettings,
  ConnectivityResult,
  NetworkContext,
  SmartDebugResult,
  UserRole,
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
  onOpenAdmin: () => void;
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
  onOpenAdmin,
}: Props) {
  const [busy, setBusy] = useState(false);
  const pendingToggle = useRef(false); // prevent double-click race condition
  const toast = useToast();
  // Tastatur-unabhaengiger, GARANTIERTER Weg ins Service-Menue: 5x aufs Logo in
  // unter 2s. Funktioniert auf Windows + macOS identisch (reiner Klick, keine
  // Keycode-/WebView2-Falle). Das ist der verlaessliche Weg, falls die Tastenkombi
  // vom WebView2 geschluckt wird.
  const adminTapRef = useRef({ n: 0, t: 0 });
  function handleLogoTap() {
    const now = Date.now();
    const s = adminTapRef.current;
    s.n = now - s.t < 2000 ? s.n + 1 : 1;
    s.t = now;
    if (s.n >= 5) {
      s.n = 0;
      onOpenAdmin();
    }
  }
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
  // UI profile set in the admin menu. Re-read on mount (screens re-mount on
  // navigation, so returning from the admin picks up a change immediately).
  const [role, setRole] = useState<UserRole>("user");
  useEffect(() => {
    invoke<AppSettings>("app_settings_get")
      // normalizeRole reicht alle bekannten Rollen durch (inkl. it_admin, infact)
      // und faellt bei Unbekanntem sicher auf "user" zurueck.
      .then((s) => setRole(normalizeRole(s.role)))
      .catch(() => {});
  }, []);
  const isItAdmin = role === "it_admin";
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
    | {
        tone: "good" | "warn" | "info" | "error";
        text: string;
        action: "fixdh" | "relogin" | null;
      }
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
        text: "Deine Anmeldung ist abgelaufen. Melde dich neu an, dann geht es weiter. Klappt das nicht, hilft die Diagnose oder der Support.",
        action: "relogin",
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

  // Das Situations-Banner RUHIG halten: waehrend die Netz-Erkennung noch pendelt
  // (Probes, Re-Probe nach 1,6s) wechselt der Zustand sonst hektisch hin und her.
  // Einen neuen Zustand erst zeigen, wenn er ~400ms stabil steht - kein Flackern,
  // kein Springen. Vergleich ueber den Inhalt (nicht die Objekt-Identitaet).
  const situationKey = situation
    ? `${situation.tone}|${situation.action ?? ""}|${situation.text}`
    : "";
  const [shownSituation, setShownSituation] = useState(situation);
  const shownKeyRef = useRef(situationKey);
  useEffect(() => {
    if (situationKey === shownKeyRef.current) return;
    const id = setTimeout(() => {
      shownKeyRef.current = situationKey;
      setShownSituation(situation);
    }, 400);
    return () => clearTimeout(id);
  }, [situationKey, situation]);

  const [fixingDh, setFixingDh] = useState(false);
  // Merkt sich, dass die Kabel-Bevorzugung aktiv gesetzt wurde, damit wir ein
  // echtes, dauerhaft erreichbares "Rueckgaengig" anbieten koennen (die
  // Aktion verspricht "Reversibel"). Ueberlebt Neustarts.
  const [dhApplied, setDhApplied] = useState(() => {
    try {
      return localStorage.getItem("nkk-dh-applied") === "1";
    } catch {
      return false;
    }
  });
  function markDhApplied(v: boolean) {
    setDhApplied(v);
    try {
      if (v) localStorage.setItem("nkk-dh-applied", "1");
      else localStorage.removeItem("nkk-dh-applied");
    } catch {
      /* localStorage kann im WebView blockiert sein - unkritisch */
    }
  }
  async function fixDualHoming() {
    setFixingDh(true);
    try {
      const r = await invoke<{ applied: boolean; message: string }>(
        "dualhoming_prefer_wired"
      );
      if (r.applied) {
        toast.success(r.message);
        markDhApplied(true);
      } else toast.info(r.message);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setFixingDh(false);
    }
  }
  async function restoreDualHoming() {
    setFixingDh(true);
    try {
      const r = await invoke<{ applied: boolean; message: string }>(
        "dualhoming_restore"
      );
      if (r.applied) toast.success(r.message);
      else toast.info(r.message);
      // In beiden Faellen die Pille schliessen: entweder wurde restauriert oder
      // es gab nichts wiederherzustellen (Flag war veraltet, z.B. manuell
      // zurueckgesetzt) - so heilt sich der Zustand selbst.
      markDhApplied(false);
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
      // Gehaltene Taste (Auto-Repeat) darf NICHT wiederholt starten, sonst
      // oeffnet ein gedruecktes Shift+Ziffer einen Fenster-Schwall.
      if (e.repeat) return;
      if (!e.shiftKey || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA")) return;
      const m = e.code.match(/^Digit([1-9])$/);
      if (!m) return;
      // Rollen-Gate auch beim Hotkey: ein role-gegatetes Ziel (z.B. Domaincontroller,
      // role it_admin) darf per Shift+Ziffer NUR die passende Rolle starten. TS1 hat
      // keine role -> Shift+1 bleibt fuer alle.
      const item = branding.quickLaunch.find((q) => {
        if (q.hotkey !== m[1]) return false;
        return roleCanSee(q.role, role);
      });
      if (item) {
        e.preventDefault();
        onRequestLaunch(item);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [branding.quickLaunch, onRequestLaunch, role]);

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
  // Hidden entries (e.g. an outdated TS1) stay hidden for everyone - they are
  // only reachable by hotkey. The Geschäftsführer profile additionally sees
  // purpose-built manager-only targets (role: "manager"), like a NetBird-free
  // fallback path. A normal user never sees those.
  const launches = [...branding.quickLaunch]
    .filter((q) => {
      if (q.hidden) return false;
      // Rollen-Gate zentral in lib/roles.ts (kommagetrennte Tokenliste; IT Admin
      // sieht alles). Ungegatete Ziele sieht jeder.
      return roleCanSee(q.role, role);
    })
    .sort((a, b) => Number(!!b.default) - Number(!!a.default))
    // Beschreibung rollen-gerecht: InFact sieht z.B. "Serv-App" statt "Serv-App, InFact".
    .map((q) => ({ ...q, description: descriptionForRole(q.description, role) }));

  // ----- Admin-Modus: Live-Suche + Gruppierung + Live-Status -----------------
  // Die Live-Suche filtert clientseitig ueber Name, Adresse und Beschreibung.
  // NICHT autofokussiert (sonst schluckt WebView2 die Shift+Ziffer-Hotkeys); "/"
  // fokussiert, Esc leert + blurt. Nur relevant im Admin-Grid.
  const [adminQuery, setAdminQuery] = useState("");
  const adminSearchRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (!isItAdmin) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA");
      if (e.key === "/" && !inField) {
        e.preventDefault();
        adminSearchRef.current?.focus();
      } else if (e.key === "Escape" && t === adminSearchRef.current) {
        setAdminQuery("");
        adminSearchRef.current?.blur();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isItAdmin]);

  // Live-Status je Kachel: gruen = Port offen, grau = nicht geprueft/pending.
  // Gespeist aus dem leichten check_targets-Command (TCP statt ICMP, parallel).
  // Laeuft NUR im Admin-Grid und nur wenn verbunden (sonst alle grau). Kein
  // Polling im Employee-Modus. onlineCount = Anzahl offener Ports.
  const [targetStatus, setTargetStatus] = useState<Record<string, boolean>>({});
  // Stabiler Schluessel: host|port je sichtbarer Kachel (Reihenfolge egal fuers
  // Interval, daher sortiert). So laeuft der Effect nicht bei jedem Render neu.
  const statusProbeKey = useMemo(() => {
    if (!isItAdmin) return "";
    return launches
      .map((it) => `${menuHostForType(it)}:${menuPortForType(it)}`)
      .sort()
      .join(",");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isItAdmin, launches.map((it) => it.target).join(",")]);
  useEffect(() => {
    if (!isItAdmin) return;
    if (!canLaunch) {
      // Nicht verbunden: kein Polling, alle Punkte grau (Tooltip "zuerst verbinden").
      setTargetStatus({});
      return;
    }
    let alive = true;
    const targets = launches.map(
      (it) => [menuHostForType(it), menuPortForType(it)] as [string, number]
    );
    const probe = () => {
      invoke<Record<string, boolean>>("check_targets", { targets })
        .then((r) => alive && setTargetStatus(r))
        .catch(() => {});
    };
    probe();
    const id = setInterval(probe, 15_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isItAdmin, canLaunch, statusProbeKey]);

  // Client-Filter der Live-Suche ueber Name + Adresse + Beschreibung.
  const q = adminQuery.trim().toLowerCase();
  const adminVisible = q
    ? launches.filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.target.toLowerCase().includes(q) ||
          (it.description ?? "").toLowerCase().includes(q)
      )
    : launches;

  // Gruppe aus dem group-Feld, sonst Heuristik: url/smb/ssh -> net,
  // "Terminalserver" im Label -> ts, sonst core.
  function groupOf(item: QuickLaunchEntry): "ts" | "core" | "net" {
    if (item.group === "ts" || item.group === "core" || item.group === "net")
      return item.group;
    if (item.type === "url" || item.type === "smb" || item.type === "ssh")
      return "net";
    if (item.label.toLowerCase().includes("terminalserver")) return "ts";
    return "core";
  }
  const adminGroups: { key: "ts" | "core" | "net"; title: string; items: QuickLaunchEntry[] }[] = [
    { key: "ts", title: "Terminalserver", items: [] },
    { key: "core", title: "Kern-Server", items: [] },
    { key: "net", title: "Netz + Verwaltung", items: [] },
  ];
  for (const it of adminVisible) {
    adminGroups.find((g) => g.key === groupOf(it))!.items.push(it);
  }
  // onlineCount fuer den roten Balken: offene Ports ueber ALLE Admin-Ziele
  // (nicht nur die gefilterten), damit die Zahl beim Tippen nicht springt.
  const onlineCount = launches.reduce(
    (n, it) =>
      n + (targetStatus[`${menuHostForType(it)}:${menuPortForType(it)}`] ? 1 : 0),
    0
  );

  // Direkter Panel-Knopf im roten Balken: nimmt das erste url-Ziel aus dem
  // rollen-gefilterten quickLaunch (bei NKK das Admin-Panel auf Serv-Secure).
  // White-Label: keine hartcodierte Adresse; Fallback ist die NetBird-
  // Verwaltungs-URL aus dem Branding. Ein Branding-Ziel liegt hinter dem VPN
  // (gleiches "Zuerst verbinden"-Gate wie die Kacheln), die externe Fallback-
  // URL ist ohne VPN erreichbar und bleibt deshalb immer klickbar.
  const panelFromLaunch = launches.find((it) => it.type === "url");
  const adminPanelEntry: QuickLaunchEntry | null =
    panelFromLaunch ??
    (branding.netbird.adminUrl
      ? { label: "Verwaltung", type: "url", target: branding.netbird.adminUrl }
      : null);
  const panelNeedsVpn = !!panelFromLaunch;

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
          className="p-1.5 rounded-md text-[color:var(--brand-fg)] hover:bg-[color:var(--brand-fg)]/8 transition"
          aria-label="Aktuelles"
          title="Aktuelles & Changelog"
        >
          <Newspaper size={16} strokeWidth={2.4} />
        </button>
        <button
          onClick={onOpenAbout}
          className="p-1.5 rounded-md text-[color:var(--brand-fg)] hover:bg-[color:var(--brand-fg)]/8 transition"
          aria-label="Diagnose & Support"
          title="Diagnose & Support"
        >
          <Headphones size={16} strokeWidth={2.4} />
        </button>
        <button
          onClick={onOpenSettings}
          className="p-1.5 rounded-md text-[color:var(--brand-fg)] hover:bg-[color:var(--brand-fg)]/8 transition"
          aria-label={de.main.settings}
          title={de.main.settings}
        >
          <SettingsIcon size={16} strokeWidth={2.4} />
        </button>
      </header>

      {/* Hero - OBEN verankert (nicht vertikal zentriert): wenn beim Verbinden Inhalt
          dazukommt (Status-Karte, Situations-Banner), soll der Block nach unten wachsen
          statt sich neu zu zentrieren. Sonst wandert das Logo auf der Y-Achse und es
          "springt" bei jedem Verbinden/Trennen. */}
      <main className="main-scroll relative z-10 flex-1 overflow-y-auto">
        <div className="min-h-full flex flex-col items-center justify-start px-2 gap-2.5 pt-5 pb-3 text-center">
        <div className="fade-in-1 flex flex-col items-center">
          <div
            className="relative flex items-center justify-center cursor-pointer"
            style={{ width: 120, height: 120 }}
            onClick={handleLogoTap}
          >
            {/* Partikel-Effekt beim Verbinden/Trennen (vom Kunden gewuenscht). Nur beim
                Zustandswechsel, nicht als Dauer-Deko. */}
            {isBusy && (
              <>
                {[
                  { angle: "0deg",   dist: "90px", speed: 1.3, delay: 0,   sz: 5, color: "var(--brand-primary)" },
                  { angle: "50deg",  dist: "85px", speed: 1.5, delay: 0.2, sz: 4, color: "#4a8c3f" },
                  { angle: "95deg",  dist: "88px", speed: 1.4, delay: 0.5, sz: 5, color: "var(--brand-primary)" },
                  { angle: "140deg", dist: "82px", speed: 1.6, delay: 0.3, sz: 4, color: "#e8a317" },
                  { angle: "185deg", dist: "90px", speed: 1.3, delay: 0.7, sz: 5, color: "#4a8c3f" },
                  { angle: "230deg", dist: "80px", speed: 1.5, delay: 0.1, sz: 4, color: "var(--brand-primary)" },
                  { angle: "275deg", dist: "86px", speed: 1.4, delay: 0.6, sz: 5, color: "#e8a317" },
                  { angle: "320deg", dist: "84px", speed: 1.6, delay: 0.4, sz: 4, color: "#4a8c3f" },
                  { angle: "25deg",  dist: "92px", speed: 1.7, delay: 0.8, sz: 5, color: "var(--brand-primary)" },
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

        {role !== "user" && (
          <div className="banner-in mt-1 px-3 py-1 rounded-full border border-[color:var(--brand-primary)]/35 text-[color:var(--brand-primary)] text-[10.5px] font-semibold tracking-wide">
            {ROLE_LABELS[role]}
          </div>
        )}

        {isItAdmin ? (
          // Admin-Modus: eigener Betriebsmodus mit Kirschrot-Kontextbalken, drei
          // Server-Gruppen und Live-Suche. Hebt sich klar vom ruhigen
          // Employee-Layout ab, bleibt aber on-brand.
          <div className="fade-in-3 w-full mt-1 flex flex-col gap-2">
            {/* Kirschroter Kontextbalken: unmissverstaendlicher Modus-Anker. */}
            <div
              className="w-full rounded-lg px-3 py-1.5 flex items-center justify-between"
              style={{
                background: "var(--brand-primary)",
                color: "var(--brand-surface)",
              }}
            >
              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide">
                <ServerCog size={13} />
                Admin-Modus
              </span>
              <span className="flex items-center gap-2">
                <span className="text-[10px] font-semibold tabular-nums opacity-90">
                  {canLaunch ? `${launches.length} Server · ${onlineCount} online` : `${launches.length} Server · Status nach Verbinden`}
                </span>
                {adminPanelEntry && (
                  // Direkter Absprung ins Admin-Panel: immer sichtbar, laeuft
                  // durch dieselbe Launch-Pipeline wie die Kacheln (Toasts,
                  // In-Flight-Guard). VPN-Ziele sind bis zum Verbinden gesperrt.
                  <button
                    onClick={() => onRequestLaunch(adminPanelEntry)}
                    disabled={panelNeedsVpn && !canLaunch}
                    title={
                      panelNeedsVpn && !canLaunch
                        ? "Zuerst verbinden"
                        : `${adminPanelEntry.label} im Browser öffnen${
                            adminPanelEntry.hotkey
                              ? ` (Shift+${adminPanelEntry.hotkey})`
                              : ""
                          }`
                    }
                    aria-label={`${adminPanelEntry.label} im Browser öffnen`}
                    className="flex items-center gap-1 rounded-md px-2 py-[3px] text-[10px] font-bold uppercase tracking-wide bg-white/15 hover:bg-white/25 active:bg-white/30 transition disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:bg-white/15"
                  >
                    <ExternalLink size={11} />
                    Panel
                  </button>
                )}
              </span>
            </div>

            {/* Live-Suche: erst ab >6 Zielen, nie autofokussiert (Hotkey-Falle). */}
            {launches.length > 6 && (
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none"
                />
                <input
                  ref={adminSearchRef}
                  value={adminQuery}
                  onChange={(e) => setAdminQuery(e.target.value)}
                  placeholder="Server suchen … (Taste /)"
                  aria-label="Server suchen"
                  className="h-8 w-full surface rounded-lg pl-8 pr-8 text-[12px] font-semibold text-[color:var(--brand-fg)] placeholder:text-muted focus:outline-none focus:border-[color:var(--brand-primary)]/50 focus:ring-2 focus:ring-[color:var(--brand-primary)]/20"
                />
                {adminQuery && (
                  <button
                    onClick={() => {
                      setAdminQuery("");
                      adminSearchRef.current?.focus();
                    }}
                    aria-label="Suche leeren"
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded text-muted hover:text-[color:var(--brand-primary)] transition"
                  >
                    <X size={13} />
                  </button>
                )}
              </div>
            )}

            {/* Drei Gruppen mit Kopfzeile + Zaehl-Badge. Leere Gruppen (nach
                Filter) werden ausgeblendet. */}
            {adminGroups.map(
              (group) =>
                group.items.length > 0 && (
                  <div key={group.key} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5 px-0.5">
                      <span className="text-[9px] font-bold uppercase tracking-[0.18em] text-[color:var(--brand-primary)]">
                        {group.title}
                      </span>
                      <span className="text-[9px] font-bold tabular-nums text-[color:var(--brand-primary)] bg-[color:var(--brand-primary)]/10 rounded-full px-1.5 leading-[15px]">
                        {group.items.length}
                      </span>
                      <div className="flex-1 h-px bg-[color:var(--brand-primary)]/15" />
                    </div>
                    <div className="grid grid-cols-2 gap-1.5">
                      {group.items.map((item) => (
                        <LaunchCard
                          key={item.target}
                          item={item}
                          primary={false}
                          compact
                          admin
                          online={
                            canLaunch
                              ? targetStatus[
                                  `${menuHostForType(item)}:${menuPortForType(item)}`
                                ]
                              : undefined
                          }
                          disabled={!canLaunch}
                          onClick={() => onRequestLaunch(item)}
                          colSpan={group.items.length === 1 ? 2 : 1}
                        />
                      ))}
                    </div>
                  </div>
                )
            )}

            {/* Leerer Filtertreffer: ruhige Zeile statt leerer Flaeche. */}
            {adminVisible.length === 0 && (
              <div className="text-[11px] text-muted text-center py-3 flex flex-col items-center gap-1">
                Kein Server passt zu „{adminQuery.trim()}“.
                <button
                  onClick={() => {
                    setAdminQuery("");
                    adminSearchRef.current?.focus();
                  }}
                  className="text-[11px] font-semibold text-[color:var(--brand-primary)] hover:underline"
                >
                  Suche leeren
                </button>
              </div>
            )}

            {/* Dezenter Weg zur bestehenden Diagnose/Log-Ansicht (nur Admin). */}
            <button
              onClick={onOpenAbout}
              className="self-center mt-0.5 flex items-center gap-1.5 text-[10px] font-semibold text-muted hover:text-[color:var(--brand-primary)] transition"
            >
              <Stethoscope size={12} />
              Diagnose &amp; Fehler-Log öffnen
            </button>
          </div>
        ) : (
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
        )}

        {/* Privilegierte Rollen (Geschäftsführer + IT Admin) sehen im verbundenen
            Zustand eine ruhige Übersichtskarte: welches Netz, statt die IP aus der
            unteren Statusleiste zu doppeln. */}
        {role !== "user" && isConnected && (
          <div className="fade-soft w-full surface rounded-xl px-3 py-2 mt-1 flex items-center justify-between text-[11px]">
            <span className="flex items-center gap-1.5 font-semibold text-emerald-700">
              <ShieldCheck size={13} />
              Sicher verbunden
            </span>
            <span className="font-semibold text-[color:var(--brand-fg)]/65">
              {branding.product.networkName ?? "verschlüsselt"}
            </span>
          </div>
        )}

        {/* Situation read sits BELOW the action: a late or changing read never
            shifts the primary button, and it fades in place (opacity only) so
            it can never visibly jump. */}
        {shownSituation &&
          ((situation) => {
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
                {situation.action === "relogin" && (
                  <button
                    onClick={toggle}
                    disabled={isBusy}
                    className="w-full text-[11px] font-bold rounded-lg py-2 btn-primary active:scale-[0.98] disabled:opacity-60"
                  >
                    {isBusy ? "Melde neu an …" : "Jetzt neu anmelden"}
                  </button>
                )}
              </div>
            );
          })(shownSituation)}

        {/* Rueckgaengig-Pille: erscheint, sobald die Kabel-Bevorzugung aktiv
            gesetzt wurde, und bleibt dauerhaft erreichbar (auch nach Neustart).
            Nicht zeigen, wenn gerade wieder ein Doppellauf gemeldet wird (dann
            wurde extern zurueckgesetzt und der Fix-Banner uebernimmt). */}
        {dhApplied &&
          !(shownSituation && shownSituation.action === "fixdh") && (
            <div className="fade-soft w-full mt-2 flex items-center justify-between gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 leading-snug">
                <CheckCircle2 size={13} className="shrink-0" />
                Kabel wird bevorzugt
              </span>
              <button
                onClick={restoreDualHoming}
                disabled={fixingDh}
                title="Kabel-Bevorzugung rueckgaengig machen"
                className="flex items-center gap-1 rounded-md px-2 py-1 text-[10.5px] font-bold text-emerald-800 hover:bg-emerald-500/15 transition disabled:opacity-50"
              >
                <RotateCcw size={12} />
                {fixingDh ? "wird gesetzt …" : "Rückgängig"}
              </button>
            </div>
          )}

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
                    ? "Du bist verbunden. Klicke oben auf den Terminalserver, dann öffnet sich die Sitzung."
                    : "Klicke unten auf Verbinden. Sobald es grün ist, öffnet der Terminalserver-Button die Sitzung."}
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
      {showCoach && !isConnected && !isBusy && !onSiteActive && (status ? status.cli_available : true) && (
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
              klicken, um auf den Server zu kommen.
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
              ? "Sicher verbunden"
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
            <span className="relative">
              {isBusy ? "…" : isConnected ? "Trennen" : "Verbinden"}
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

// Host aus einer http(s)-URL ziehen ("http://192.168.0.50:8899" -> "192.168.0.50").
// Faellt bei Unparsbarem auf null zurueck, der Aufrufer nutzt dann das Rohziel.
function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}
// Port aus einer http(s)-URL ziehen ("...:8899" -> 8899), sonst null.
function portFromUrl(url: string): number | null {
  try {
    const p = new URL(url).port;
    return p ? Number(p) : null;
  } catch {
    return null;
  }
}
// Host aus einem UNC-Pfad ziehen ("\\serv-file\Daten" -> "serv-file"), sonst null.
function hostFromUnc(unc: string): string | null {
  const m = unc.replace(/\//g, "\\").match(/^\\\\([^\\]+)/);
  return m ? m[1] : null;
}

// Typ-Standardport fuer die Erreichbarkeits-Pruefung im Kontextmenue.
function menuPortForType(item: QuickLaunchEntry): number {
  switch (item.type) {
    case "ssh":
      return item.port ?? 22;
    case "url":
      return portFromUrl(item.target) ?? 8899;
    case "smb":
      return 445;
    default:
      return 3389;
  }
}
// Host, den die Erreichbarkeits-Pruefung ansprechen soll.
function menuHostForType(item: QuickLaunchEntry): string {
  if (item.type === "url") return hostFromUrl(item.target) ?? item.target;
  if (item.type === "smb") return hostFromUnc(item.target) ?? item.target;
  return item.target;
}

interface MenuCtx {
  isItAdmin: boolean;
  handle: () => void | Promise<void>;
  copy: (value: string, okMsg: string) => Promise<void>;
  ping: (host: string, port: number, label: string) => Promise<void>;
  makeShortcut: (target: string | null, label: string | null) => Promise<void>;
  openUrl: (url: string) => Promise<void>;
}

// EINE typ-bewusste Menue-Fabrik. Employee (nicht isItAdmin) behaelt exakt das
// heutige schlanke Menue (Regressionsschutz). Admin bekommt das volle,
// typ-bewusste Menue mit Kopfzeile (IP als sublabel) und Trennern.
function buildMenu(item: QuickLaunchEntry, ctx: MenuCtx): ContextMenuItem[] {
  const { isItAdmin, handle, copy, ping, makeShortcut, openUrl } = ctx;

  // ----- Employee: heutiges schlankes Menue, unveraendert. ------------------
  if (!isItAdmin) {
    const actionLabel =
      item.type === "rdp"
        ? `Mit ${item.label} verbinden`
        : `${item.label} öffnen`;
    const items: ContextMenuItem[] = [
      { label: actionLabel, icon: <ArrowRight size={13} />, onClick: handle },
      {
        label: "Adresse kopieren",
        icon: <Copy size={13} />,
        onClick: () => copy(item.target, "Adresse kopiert."),
      },
    ];
    if (item.type === "rdp") {
      items.push({
        label: "Desktop-Verknüpfung erstellen",
        icon: <Link2 size={13} />,
        // Employee ruft OHNE target -> behaelt das Default-TS2-Verhalten.
        onClick: () => makeShortcut(null, null),
      });
    }
    return items;
  }

  // ----- Admin: volles, typ-bewusstes Menue. --------------------------------
  const header: ContextMenuItem = {
    kind: "header",
    label: item.label,
    sublabel: item.target,
    onClick: () => {},
  };
  const sep: ContextMenuItem = { kind: "separator", label: "", onClick: () => {} };
  const items: ContextMenuItem[] = [header, sep];

  if (item.type === "rdp") {
    items.push(
      {
        label: `Mit ${item.label} verbinden`,
        icon: <ArrowRight size={13} />,
        onClick: handle,
      },
      sep,
      {
        label: "Erreichbarkeit prüfen",
        icon: <Activity size={13} />,
        onClick: () => ping(item.target, 3389, item.label),
      },
      sep,
      {
        label: "IP kopieren",
        icon: <Copy size={13} />,
        onClick: () => copy(item.target, "IP kopiert."),
      },
      {
        label: "Desktop-Verknüpfung erstellen",
        icon: <Link2 size={13} />,
        onClick: () => makeShortcut(item.target, item.label),
      }
    );
  } else if (item.type === "ssh") {
    items.push(
      {
        label: "SSH öffnen",
        icon: <SquareTerminal size={13} />,
        onClick: handle,
      },
      sep,
      {
        label: "Erreichbarkeit prüfen",
        icon: <Activity size={13} />,
        onClick: () => ping(item.target, item.port ?? 22, item.label),
      }
    );
    // Serv-Secure (.50) hostet das Panel -> Direktweg anbieten.
    if (item.target === "192.168.0.50") {
      items.push({
        label: "Panel öffnen",
        icon: <Globe size={13} />,
        onClick: () => openUrl("http://192.168.0.50:8899"),
      });
    }
    items.push(
      sep,
      {
        label: "IP kopieren",
        icon: <Copy size={13} />,
        onClick: () => copy(item.target, "IP kopiert."),
      },
      {
        label: "SSH-Befehl kopieren",
        icon: <Copy size={13} />,
        onClick: () =>
          copy(
            `ssh ${item.user ? item.user + "@" : ""}${item.target}`,
            "SSH-Befehl kopiert."
          ),
      }
    );
  } else if (item.type === "url") {
    items.push(
      {
        label: "Im Browser öffnen",
        icon: <Globe size={13} />,
        onClick: handle,
      },
      sep,
      {
        label: "Erreichbarkeit prüfen",
        icon: <Activity size={13} />,
        onClick: () =>
          ping(menuHostForType(item), menuPortForType(item), item.label),
      },
      {
        label: "URL kopieren",
        icon: <Copy size={13} />,
        onClick: () => copy(item.target, "URL kopiert."),
      }
    );
  } else {
    // smb
    items.push(
      {
        label: /Mac/.test(navigator.platform) ? "Im Finder öffnen" : "Im Explorer öffnen",
        icon: <FolderOpen size={13} />,
        onClick: handle,
      },
      sep,
      {
        label: "Erreichbarkeit prüfen",
        icon: <Activity size={13} />,
        onClick: () => ping(menuHostForType(item), 445, item.label),
      },
      {
        label: "Pfad kopieren",
        icon: <Copy size={13} />,
        onClick: () => copy(item.target, "Pfad kopiert."),
      }
    );
  }

  return items;
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
  compact,
  admin,
  online,
  colSpan,
}: {
  item: QuickLaunchEntry;
  primary: boolean;
  disabled: boolean;
  onClick: () => void | Promise<void>;
  compact?: boolean;
  /** Admin-Grid: schaltet das volle Kontextmenue, den Typ-Chip und den Status-Punkt frei. */
  admin?: boolean;
  /** Live-Status: true = Port offen (gruen), false = zu (rot), undefined = nicht geprueft (grau). */
  online?: boolean;
  /** Bei genau 1 Treffer in der Gruppe die Kachel ueber beide Spalten ziehen. */
  colSpan?: 1 | 2;
}) {
  const [busy, setBusy] = useState(false);
  const showMenu = useContextMenu();
  const toast = useToast();
  const actionLabel =
    item.type === "rdp"
      ? `Mit ${item.label} verbinden`
      : `${item.label} öffnen`;

  async function handle() {
    // Deaktiviert (kein VPN, nicht im Buero): nicht stumm nichts tun, sondern in
    // Klartext sagen, was zu tun ist. Karte bleibt klickbar (native disabled nur bei busy).
    if (disabled) {
      toast.info("Bitte zuerst unten auf Verbinden klicken.");
      return;
    }
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  }

  // Kopier-Helfer fuer die Menue-Fabrik: kopiert und meldet Erfolg/Fehler ruhig.
  async function copy(value: string, okMsg: string) {
    const ok = await copyText(value);
    if (ok) toast.success(okMsg);
    else toast.error("Kopieren nicht möglich.");
  }
  // Erreichbarkeit ehrlich per TCP (nicht ICMP) auf dem typ-passenden Port.
  async function ping(host: string, port: number, label: string) {
    try {
      const open = await invoke<boolean>("check_target", { host, port });
      if (open) toast.success(`${label}: Port ${port} offen.`);
      else toast.info(`${label}: keine Antwort auf Port ${port}.`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }
  // Desktop-Verknuepfung: Admin uebergibt target+label (jede Kachel legt IHRE
  // eigene Verknuepfung an), Employee ruft ohne -> Default-Verhalten bleibt.
  async function makeShortcut(target: string | null, label: string | null) {
    try {
      await invoke("create_desktop_rdp_shortcut", { target, label });
      toast.success("Verknüpfung auf dem Desktop erstellt.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }
  async function openUrl(url: string) {
    try {
      await invoke("open_url", { url });
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }

  const onCtx = (e: React.MouseEvent) =>
    showMenu(
      e,
      buildMenu(item, {
        isItAdmin: !!admin,
        handle,
        copy,
        ping,
        makeShortcut,
        openUrl,
      })
    );

  // Icon je Server-Typ, damit das Admin-Grid auf einen Blick lesbar ist. Terminalserver
  // (Windows) behalten das Windows-Logo; Kern-Server = Server, DB = Datenbank,
  // Panel/URL = Globus, Freigabe = Ordner, SSH = Terminal.
  const iconSize = compact ? 15 : 17;
  const glyphCls = "transition group-hover:scale-110";
  const typeIcon = busy ? (
    <Loader2 size={compact ? 15 : 18} className="animate-spin" />
  ) : item.icon === "database" ? (
    <Database size={iconSize} className={glyphCls} />
  ) : item.icon === "folder" || item.type === "smb" ? (
    <FolderOpen size={iconSize} className={glyphCls} />
  ) : item.icon === "panel" || item.type === "url" ? (
    <Globe size={iconSize} className={glyphCls} />
  ) : item.icon === "terminal" || item.type === "ssh" ? (
    <SquareTerminal size={iconSize} className={glyphCls} />
  ) : item.icon === "server" ? (
    <Server size={iconSize} className={glyphCls} />
  ) : item.type === "rdp" ? (
    <WindowsLogo size={iconSize} className={glyphCls} />
  ) : (
    <ArrowRight
      size={compact ? 15 : 18}
      className="transition group-hover:translate-x-0.5"
    />
  );

  // Kompakte Kachel fuer den Admin-Modus: dichtes Grid mit vielen Servern, jede
  // Kachel zeigt Servername + Kurzinfo (IP/Rolle), Ein-Klick-Verbinden. Im
  // Admin-Modus zusaetzlich Live-Status-Punkt (oben links an der Icon-Box) und
  // ein Typ-Chip unten rechts.
  if (compact) {
    // Typ-Chip: kleiner Farbton je Ziel-Typ, alles Toene die schon in der App
    // vorkommen (kein bunter KI-Look). Nur im Admin-Grid.
    const chip =
      item.type === "rdp"
        ? { label: "RDP", cls: "bg-[color:var(--brand-primary)] text-[color:var(--brand-surface)]" }
        : item.type === "ssh"
        ? { label: "SSH", cls: "bg-emerald-700 text-white" }
        : item.type === "url"
        ? { label: item.icon === "panel" ? "PANEL" : "WEB", cls: "bg-amber-600 text-white" }
        : { label: "SMB", cls: "bg-[color:var(--brand-accent)] text-[color:var(--brand-fg)]" };
    // Status-Punkt: gruen offen, rot zu, grau nicht geprueft (oder nicht verbunden).
    const dotCls =
      online === true
        ? "bg-emerald-500"
        : online === false
        ? "bg-red-500"
        : "bg-[color:var(--brand-fg)]/25";
    const dotTitle =
      online === true
        ? "erreichbar"
        : online === false
        ? "nicht erreichbar"
        : disabled
        ? "zuerst verbinden"
        : "wird geprüft …";
    return (
      <button
        onClick={handle}
        onContextMenu={onCtx}
        disabled={busy}
        title={admin ? `${item.label} (${item.target}) · ${dotTitle}${item.hotkey ? ` · Shift+${item.hotkey}` : ""} · Rechtsklick zeigt Aktionen` : `${item.label} (${item.target})`}
        className={clsx(
          "relative rounded-lg px-2.5 py-1.5 flex items-center gap-2 text-left transition group surface hover:border-[color:var(--brand-primary)]/50 hover:-translate-y-0.5 min-w-0",
          colSpan === 2 && "col-span-2",
          busy && "opacity-50 cursor-wait hover:translate-y-0",
          disabled && !busy && "opacity-60 hover:translate-y-0"
        )}
      >
        <div className="relative shrink-0">
          <div className="w-7 h-7 rounded-md bg-[color:var(--brand-primary)]/10 text-[color:var(--brand-primary)] flex items-center justify-center">
            {typeIcon}
          </div>
          {admin && (
            <span
              role="img"
              aria-label={`Status: ${dotTitle}`}
              title={dotTitle}
              className={clsx(
                "absolute -top-0.5 -left-0.5 w-2 h-2 rounded-full ring-2 ring-[color:var(--brand-surface)]",
                dotCls
              )}
            />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-bold leading-tight truncate">
            {item.label}
          </div>
          <div className="text-[10px] text-muted leading-tight truncate font-mono tabular-nums">
            {disabled ? "Zuerst verbinden" : item.description || item.target}
          </div>
        </div>
        {admin && (
          <span
            className={clsx(
              "shrink-0 rounded px-1 py-0.5 text-[9px] font-bold uppercase tracking-wide leading-none",
              chip.cls
            )}
          >
            {chip.label}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      onClick={handle}
      onContextMenu={onCtx}
      disabled={busy}
      className={clsx(
        "w-full rounded-xl px-4 py-3.5 flex items-center gap-3 text-left transition group",
        primary
          ? "btn-primary hover:-translate-y-0.5"
          : "surface hover:border-[color:var(--brand-primary)]/50 hover:-translate-y-0.5",
        busy && "opacity-50 cursor-wait hover:translate-y-0",
        disabled && !busy && "opacity-60 hover:translate-y-0"
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
        {typeIcon}
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
        {(disabled || item.description) && (
          <div
            className={clsx(
              "text-[10px] truncate mt-0.5",
              primary ? "text-white/80" : "text-muted"
            )}
          >
            {disabled ? "Zuerst verbinden" : item.description}
          </div>
        )}
      </div>
    </button>
  );
}
