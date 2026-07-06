import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextMenuProvider } from "./components/ContextMenu";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ToastProvider, useToast } from "./components/Toast";
import { UpdateBanner } from "./components/UpdateBanner";
import { useUpdater } from "./hooks/useUpdater";
import { AdminScreen } from "./screens/AdminScreen";
import { CredentialsModal } from "./screens/CredentialsModal";
import { DiagnosePanel } from "./screens/DiagnosePanel";
import { EnrollmentScreen } from "./screens/EnrollmentScreen";
import { MainScreen } from "./screens/MainScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { NewsScreen } from "./screens/NewsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import { de } from "./i18n/de";
import type { BrandingDto, QuickLaunchEntry } from "./types/branding";
import type { CredentialProfileMeta } from "./types/credentials";
import type { StatusDto } from "./types/netbird";

type Screen = "setup" | "enrollment" | "main" | "settings" | "news" | "diagnose" | "admin";

interface SetupCheckResult {
  netbird_installed: boolean;
  netbird_running: boolean;
  needs_install: boolean;
  message: string;
}

function applyTheme(b: BrandingDto) {
  const root = document.documentElement;
  root.style.setProperty("--brand-primary", b.theme.primary);
  root.style.setProperty("--brand-primary-hover", b.theme.primaryHover);
  root.style.setProperty("--brand-accent", b.theme.accent);
  // Background / foreground are also brandable; without this a second tenant
  // keeps the NKK cream palette from index.css. Required theme fields (the
  // branding load fails earlier if they are absent), so set them directly.
  root.style.setProperty("--brand-bg", b.theme.background);
  root.style.setProperty("--brand-fg", b.theme.foreground);
  document.title = b.product.name;
}

// invoke mit hartem Timeout: ein nicht antwortendes Backend (z.B. direkt nach dem
// Start oder bei einem IPC-Haenger) darf den Ladescreen NIE endlos stehen lassen.
// Nach `ms` wird abgebrochen (rejected), statt ewig zu warten.
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

function AppInner() {
  const [branding, setBranding] = useState<BrandingDto | null>(null);
  const [screen, setScreen] = useState<Screen>("main");
  const [status, setStatus] = useState<StatusDto | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<CredentialProfileMeta[]>([]);
  // Aktives Profil bei mehreren Profilen. In localStorage gehalten, damit die Wahl
  // Neustarts ueberlebt. Ableitung weiter unten faellt sauber auf profiles[0] zurueck,
  // falls das gemerkte Profil geloescht wurde.
  const [activeProfileId, setActiveProfileId] = useState<string | null>(() => {
    try {
      return localStorage.getItem("nkk-active-profile-id");
    } catch {
      return null;
    }
  });
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<CredentialProfileMeta | null>(null);
  const demoConnectedRef = useRef(false);
  // In-Flight-Guard pro Ziel: ein zweiter Klick (oder gehaltener Hotkey) auf dasselbe
  // Ziel darf keinen zweiten Start ausloesen, sonst oeffnet sich ein Schwall Fenster.
  const launchingRef = useRef<Set<string>>(new Set());
  const toast = useToast();
  const updater = useUpdater();

  // Langlebige Listener (im Mount-once-Bootstrap registriert) sowie der Startup-Timer
  // wuerden Status/Screen sonst als veralteten Closure-Snapshot sehen. Ueber Refs, die
  // bei jedem Render frisch gesetzt werden (gleiches Muster wie requestLaunchRef),
  // lesen sie immer den aktuellen Wert, ohne den Effekt neu laufen zu lassen.
  const statusRef = useRef<StatusDto | null>(status);
  statusRef.current = status;
  const screenRef = useRef<Screen>(screen);
  screenRef.current = screen;

  // Light startup report so the admin panel shows the current version right
  // after an update (the app relaunches into the new version) without waiting
  // for a connect. Fire-and-forget, a few seconds after the app settles.
  // Aber erst NACH dem Enrollment: auf dem Setup-/Enrollment-Screen ist das Geraet
  // noch nicht enrolled, ein Report waere verfrueht und ohne Aussage. Nur melden,
  // wenn die App die Erst-Einrichtung hinter sich hat (jeder Screen ausser setup/
  // enrollment bedeutet enrolled).
  useEffect(() => {
    const t = setTimeout(() => {
      const scr = screenRef.current;
      if (scr === "setup" || scr === "enrollment") return;
      invoke("report_version").catch(() => {});
    }, 10000);
    return () => clearTimeout(t);
  }, []);

  const refreshProfiles = useCallback(async () => {
    try {
      const list = await invoke<CredentialProfileMeta[]>("creds_list");
      setProfiles(list);
      return list;
    } catch {
      setProfiles([]);
      return [];
    }
  }, []);

  // Aktives Profil ableiten: gemerkte ID, sonst das erste Profil, sonst nichts.
  // So kann ein geloeschtes Profil nie eine tote ID hinterlassen.
  const activeProfile =
    profiles.find((p) => p.id === activeProfileId) ?? profiles[0] ?? null;

  // Aktives Profil setzen und persistieren. Wird an den Einstellungen-Screen
  // durchgereicht, damit der Nutzer bei mehreren Profilen waehlen kann.
  const setActiveProfile = useCallback((id: string) => {
    setActiveProfileId(id);
    try {
      localStorage.setItem("nkk-active-profile-id", id);
    } catch {
      /* ignore */
    }
  }, []);

  const performLaunch = useCallback(
    async (item: QuickLaunchEntry) => {
      // RDP braucht einmalig Anmeldedaten. Fehlen sie, nicht in einen stummen Fehler
      // laufen, sondern direkt den Anmeldedaten-Dialog oeffnen und Klartext zeigen.
      if (item.type === "rdp" && profiles.length === 0) {
        toast.info(de.credentials.requiredForRdp);
        setEditingProfile(null);
        setCredModalOpen(true);
        return;
      }
      // In-Flight-Guard: laeuft fuer dieses Ziel schon ein Start, frueh raus. Verhindert
      // den Fenster-Schwall bei Doppelklick oder gehaltenem Hotkey.
      if (launchingRef.current.has(item.target)) return;
      launchingRef.current.add(item.target);
      try {
        const cmd =
          item.type === "rdp"
            ? "open_rdp"
            : item.type === "smb"
            ? "open_smb"
            : item.type === "ssh"
            ? "open_ssh"
            : "open_url";
        // RDP entries may carry an RD Gateway (NetBird-free path); the backend
        // routes over HTTPS/443 and skips the VPN reconnect when it is set.
        // Das aktive Profil (wie in der Anzeige ermittelt) reichen wir als profileId
        // durch, damit das Backend genau dieses Profil waehlt (Vertrag 2).
        // SSH entries reichen optional Benutzer und Port durch (fehlt der User im
        // branding-Eintrag, defaultet das Backend auf keinen User + Port 22).
        // open_url erwartet den Parameter 'url' (nicht 'target'), sonst startet der
        // Admin-Panel-Link (Shift+7) nie.
        const launchArgs =
          item.type === "rdp"
            ? {
                target: item.target,
                gateway: item.gateway ?? null,
                profileId: activeProfile?.id ?? null,
              }
            : item.type === "ssh"
            ? { target: item.target, user: item.user ?? null, port: item.port ?? null }
            : item.type === "url"
            ? { url: item.target }
            : { target: item.target };
        await invoke(cmd, launchArgs);
        // Start-Toast aus der Sprachdatei speisen (eine Textquelle je Typ), statt den
        // Text hart zu interpolieren.
        toast.success(de.quickLaunch[item.type].starting);
      } catch (e: unknown) {
        // Rohen Backend-Fehler nur loggen, dem Nutzer eine ruhige Klartext-Meldung zeigen.
        console.error("launch failed:", e);
        const fail =
          item.type === "rdp"
            ? de.quickLaunch.rdp.failed
            : item.type === "smb"
            ? de.quickLaunch.smb.failed
            : item.type === "ssh"
            ? de.quickLaunch.ssh.failed
            : de.quickLaunch.url.failed;
        toast.error(fail);
      } finally {
        launchingRef.current.delete(item.target);
      }
    },
    [toast, profiles, activeProfile]
  );

  const requestLaunch = useCallback(
    async (item: QuickLaunchEntry) => {
      await performLaunch(item);
    },
    [performLaunch]
  );

  // Der Bootstrap-Effekt registriert einen langlebigen Tray-Launch-Listener, der
  // requestLaunch aufruft. requestLaunch aendert sich, sobald sich profiles aendern.
  // Wuerde der Effekt requestLaunch als Dependency ziehen, liefe der ganze Bootstrap
  // bei jeder profiles-Aenderung neu und setzte setScreen("main") erneut (Nutzer wird
  // beim Navigieren auf Start zurueckgeworfen). Deshalb ueber eine Ref: immer aktuell,
  // aber keine Dependency.
  const requestLaunchRef = useRef(requestLaunch);
  requestLaunchRef.current = requestLaunch;

  const openNewProfileModal = useCallback(() => {
    setEditingProfile(null);
    setCredModalOpen(true);
  }, []);

  const openEditProfileModal = useCallback(
    (profile: CredentialProfileMeta) => {
      setEditingProfile(profile);
      setCredModalOpen(true);
    },
    []
  );

  const handleProfileSaved = useCallback(async () => {
    setCredModalOpen(false);
    setEditingProfile(null);
    await refreshProfiles();
  }, [refreshProfiles]);

  const handleProfileModalClose = useCallback(() => {
    setCredModalOpen(false);
    setEditingProfile(null);
  }, []);

  const handleProfileDeleted = useCallback(
    async (id: string) => {
      try {
        await invoke("creds_delete", { id });
        await refreshProfiles();
        toast.info("Profil gelöscht.");
      } catch (e: unknown) {
        console.error("profile delete:", e);
        toast.error("Profil konnte nicht gelöscht werden. Bitte erneut versuchen.");
      }
    },
    [refreshProfiles, toast]
  );

  useEffect(() => {
    let mounted = true;
    let unlisteners: UnlistenFn[] = [];

    (async () => {
      try {
        // Branding ist das Einzige, das zum Rendern zwingend noetig ist. Mit Timeout
        // und bis zu 3 Versuchen laden, damit ein kurz nicht antwortendes Backend den
        // Ladescreen nie endlos stehen laesst. Schlaegt es dauerhaft fehl -> Fehler +
        // "Erneut versuchen" statt Endlos-Spinner.
        let b: BrandingDto | null = null;
        for (let attempt = 1; attempt <= 3 && mounted; attempt++) {
          try {
            b = await invokeWithTimeout<BrandingDto>("get_branding", 5000);
            break;
          } catch (e) {
            if (attempt === 3) throw e;
            await new Promise((r) => setTimeout(r, 600));
          }
        }
        if (!mounted || !b) return;
        setBranding(b);
        applyTheme(b);

        // Check if NetBird is installed - if not, show setup screen. Mit Timeout +
        // Fallback, damit die Weiche nie haengt.
        const setupCheck = await invokeWithTimeout<SetupCheckResult>(
          "check_netbird_setup",
          4000
        ).catch(() => null);
        if (!mounted) return;

        if (setupCheck?.needs_install) {
          setScreen("setup");
        } else {
          const enrolled = await invokeWithTimeout<boolean>(
            "nb_is_enrolled",
            4000
          ).catch(() => false);
          if (!mounted) return;
          setScreen(enrolled ? "main" : "enrollment");
        }

        // Ab hier ist genug bekannt, um die App zu rendern -> Ladescreen JETZT beenden.
        // Status, Profile und Event-Listener laden danach im Hintergrund und
        // aktualisieren die UI reaktiv. So kann kein spaeter haengender Aufruf den
        // Start blockieren.
        if (mounted) setBootstrapping(false);

        try {
          const initial = await invokeWithTimeout<StatusDto>("nb_status", 4000);
          if (mounted) setStatus(initial);
        } catch {
          /* ignore */
        }

        // Load credential profiles early so the main screen can show the user's name
        await refreshProfiles();

        const u1 = await listen<StatusDto>("netbird-status-changed", (ev) => {
          // If demo connected, only accept Connected status (ignore poll overrides)
          if (demoConnectedRef.current && ev.payload.state !== "Connected" && !ev.payload.cli_available) return;
          setStatus(ev.payload);
          if (ev.payload.state === "Connected" && ev.payload.local_ip === "100.64.0.99") {
            demoConnectedRef.current = true;
          }
        });
        const u2 = await listen<string>("netbird-error", (ev) => {
          const msg = String(ev.payload);
          if (msg) toast.error(msg);
        });
        const u3 = await listen("tray-connect", async () => {
          // needs_login = Sitzung abgelaufen / Schluessel widerrufen. Dann darf der
          // automatische connect_on_start-Pfad (lib.rs feuert dieses Event ~3s nach
          // Start) KEIN stilles nb_connect gegen einen unbrauchbaren Schluessel
          // ausloesen. Der poll_loop unterdrueckt Auto-Reconnect bei needs_login
          // bereits; dieser Pfad wurde bisher nicht gegated. Der Nutzer meldet sich
          // dann manuell an (Banner auf dem Hauptscreen). Der normale Verbinden-
          // Happy-Path (Status ohne needs_login) laeuft unveraendert.
          if (statusRef.current?.needs_login) {
            toast.info("Sitzung abgelaufen. Bitte neu verbinden.");
            return;
          }
          try {
            await invoke("nb_connect", {});
          } catch (e: unknown) {
            console.error("tray-connect:", e);
            toast.error(
              "Verbindung fehlgeschlagen. Bitte erneut versuchen, sonst beim Support melden."
            );
          }
        });
        const u4 = await listen("tray-disconnect", async () => {
          try {
            await invoke("nb_disconnect");
          } catch (e: unknown) {
            console.error("tray-disconnect:", e);
            toast.error("Trennen hat nicht geklappt. Bitte erneut versuchen.");
          }
        });
        const u5 = await listen<number>("tray-launch-index", async (ev) => {
          try {
            const b = await invoke<BrandingDto>("get_branding");
            const idx = ev.payload;
            const item = b.quickLaunch[idx];
            if (item) await requestLaunchRef.current(item);
          } catch (e: unknown) {
            console.error("tray-launch-index:", e);
            toast.error("Konnte nicht gestartet werden. Bitte erneut versuchen.");
          }
        });
        const u6 = await listen("tray-open-diagnose", () => {
          setScreen("diagnose");
        });
        const u7 = await listen("tray-open-settings", () => {
          setScreen("settings");
        });
        const u8 = await listen("netbird-needs-login", () => {
          // Neutraler Hinweis ohne falschen Pfad - die genaue Anleitung steht im
          // Situations-Banner auf dem Hauptscreen. Hier nur ein kurzer Stupser,
          // damit auch Nutzer auf anderen Screens es mitbekommen.
          toast.info("Sitzung abgelaufen. Bitte neu verbinden.");
        });
        unlisteners = [u1, u2, u3, u4, u5, u6, u7, u8];
      } catch (e: unknown) {
        if (mounted) setBootError(e instanceof Error ? e.message : String(e));
      } finally {
        if (mounted) setBootstrapping(false);
      }
    })();

    return () => {
      mounted = false;
      unlisteners.forEach((fn) => {
        try {
          fn();
        } catch {
          /* ignore */
        }
      });
    };
    // Mount-once: der Bootstrap darf NUR einmal laufen (Listener registrieren, Start-
    // Screen setzen). Ein Re-Run wuerde den Nutzer beim Navigieren auf "main" zurueck-
    // werfen und Listener doppeln. refreshProfiles + toast sind stabil; requestLaunch
    // laeuft ueber requestLaunchRef.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hidden KronSolutions service menu - Ctrl/Cmd+Shift+0. In-app keydown in the
  // capture phase so it is not swallowed by other handlers. Not discoverable to
  // employees; the password gate lives in AdminScreen (verified in Rust).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !e.shiftKey) return;
      // Windows-robust: e.code (Digit0/Numpad0) reicht auf WebView2 + DE-Layout mit
      // Shift nicht zuverlaessig, daher zusaetzlich e.key und das layout-unabhaengige
      // e.keyCode (48 Top-Row, 96 Numpad).
      const isZero =
        e.code === "Digit0" ||
        e.code === "Numpad0" ||
        e.key === "0" ||
        e.key === ")" ||
        e.key === "=" ||
        e.keyCode === 48 ||
        e.keyCode === 96;
      if (isZero) {
        e.preventDefault();
        e.stopPropagation();
        setScreen("admin");
      }
    };
    // Auf window UND document hoeren (capture), damit Fokus-/WebView2-Eigenheiten
    // die Kombi nicht verschlucken. Garantierter Weg bleibt der 5x-Logo-Tap.
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, []);

  if (bootstrapping || !branding) {
    // Bootstrap fertig (nicht mehr laufend), aber Branding fehlt = Start fehlgeschlagen.
    // Dann NICHT den Endlos-Spinner zeigen, sondern Klartext + "Erneut versuchen".
    const failed = !bootstrapping && !branding;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8">
        <img
          src={new URL("./assets/nkk-logo.svg", import.meta.url).href}
          alt="NKK Secure Access"
          width={100}
          height={100}
          className={failed ? "" : "brand-breathe"}
          draggable={false}
        />
        {!failed ? (
          <>
            <div className="w-32 h-1 rounded-full bg-[color:var(--brand-border)] overflow-hidden">
              <div className="h-full rounded-full bg-[color:var(--brand-primary)] brand-loading-bar" />
            </div>
            <span className="text-[11px] font-semibold text-[color:var(--brand-fg)]/50">
              Bitte einen Moment Geduld …
            </span>
          </>
        ) : (
          <>
            <span className="text-[14px] font-bold text-[color:var(--brand-fg)]">
              Start hat nicht geklappt
            </span>
            <span className="text-[11px] text-center leading-snug text-[color:var(--brand-fg)]/60 max-w-[85%]">
              Die App konnte nicht starten. Bitte erneut versuchen. Klemmt es
              weiter, bei der IT melden.
            </span>
            <button
              onClick={() => window.location.reload()}
              className="btn-primary rounded-lg px-5 py-2 text-[12px] font-bold"
            >
              Erneut versuchen
            </button>
            {bootError && (
              <pre className="text-[10px] text-[color:var(--brand-fg)]/40 max-w-[85%] whitespace-pre-wrap text-center">
                {bootError}
              </pre>
            )}
          </>
        )}
        <span className="absolute bottom-3 text-[9px] font-bold uppercase tracking-[0.15em] text-[color:var(--brand-fg)]/25">
          Powered by KronSolutions
        </span>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
      <UpdateBanner
        state={updater}
        footer={branding.vendor.footer}
        onInstall={updater.install}
        onRestart={updater.restart}
        onDismiss={updater.dismiss}
      />
      <div key={screen} className="screen-anim flex-1 flex flex-col min-h-0">
      {screen === "setup" && (
        <SetupScreen
          branding={branding}
          onComplete={() => setScreen("enrollment")}
        />
      )}
      {screen === "enrollment" && (
        <EnrollmentScreen
          branding={branding}
          onEnrolled={() => setScreen("main")}
        />
      )}
      {screen === "main" && (
        <MainScreen
          branding={branding}
          status={status}
          profile={activeProfile}
          onRequestLaunch={requestLaunch}
          onOpenCredentials={
            activeProfile
              ? () => openEditProfileModal(activeProfile)
              : openNewProfileModal
          }
          onOpenSettings={() => setScreen("settings")}
          onOpenAbout={() => setScreen("diagnose")}
          onOpenNews={() => setScreen("news")}
          onOpenAdmin={() => setScreen("admin")}
        />
      )}
      {screen === "news" && (
        <NewsScreen
          branding={branding}
          onBack={() => setScreen("main")}
        />
      )}
      {screen === "settings" && (
        <SettingsScreen
          branding={branding}
          profiles={profiles}
          activeProfileId={activeProfile?.id ?? null}
          onSelectActive={setActiveProfile}
          onAddProfile={openNewProfileModal}
          onEditProfile={openEditProfileModal}
          onDeleteProfile={handleProfileDeleted}
          onBack={() => setScreen("main")}
          onResetEnrollment={() => setScreen("enrollment")}
        />
      )}
      {screen === "diagnose" && (
        <DiagnosePanel
          branding={branding}
          profile={activeProfile}
          onClose={() => setScreen("main")}
        />
      )}
      {screen === "admin" && (
        <AdminScreen branding={branding} onClose={() => setScreen("main")} />
      )}
      </div>
      {credModalOpen && (
        <CredentialsModal
          initial={editingProfile}
          defaultDomain={branding.netbird.defaultDomain}
          onSaved={handleProfileSaved}
          onClose={handleProfileModalClose}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ToastProvider>
        <ContextMenuProvider>
          <AppInner />
        </ContextMenuProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}
