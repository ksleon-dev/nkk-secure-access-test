import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import { ToastProvider, useToast } from "./components/Toast";
import { UpdateBanner } from "./components/UpdateBanner";
import { useUpdater } from "./hooks/useUpdater";
import { CredentialsModal } from "./screens/CredentialsModal";
import { DiagnosePanel } from "./screens/DiagnosePanel";
import { EnrollmentScreen } from "./screens/EnrollmentScreen";
import { MainScreen } from "./screens/MainScreen";
import { SetupScreen } from "./screens/SetupScreen";
import { NewsScreen } from "./screens/NewsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { BrandingDto, QuickLaunchEntry } from "./types/branding";
import type { CredentialProfileMeta } from "./types/credentials";
import type { StatusDto } from "./types/netbird";

type Screen = "setup" | "enrollment" | "main" | "settings" | "news" | "diagnose";

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
  document.title = b.product.name;
}

function AppInner() {
  const [branding, setBranding] = useState<BrandingDto | null>(null);
  const [screen, setScreen] = useState<Screen>("main");
  const [status, setStatus] = useState<StatusDto | null>(null);
  // diagnoseOpen state removed — diagnose is now a full screen
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<CredentialProfileMeta[]>([]);
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<CredentialProfileMeta | null>(null);
  const demoConnectedRef = useRef(false);
  const toast = useToast();
  const updater = useUpdater();

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

  const performLaunch = useCallback(
    async (item: QuickLaunchEntry) => {
      try {
        const cmd =
          item.type === "rdp"
            ? "open_rdp"
            : item.type === "smb"
            ? "open_smb"
            : "open_url";
        await invoke(cmd, { target: item.target });
        toast.success(`${item.label} wird gestartet …`);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
      }
    },
    [toast]
  );

  const requestLaunch = useCallback(
    async (item: QuickLaunchEntry) => {
      await performLaunch(item);
    },
    [performLaunch]
  );

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
        const msg = e instanceof Error ? e.message : String(e);
        toast.error(msg);
      }
    },
    [refreshProfiles, toast]
  );

  useEffect(() => {
    let mounted = true;
    let unlisteners: UnlistenFn[] = [];

    (async () => {
      try {
        const b = await invoke<BrandingDto>("get_branding");
        if (!mounted) return;
        setBranding(b);
        applyTheme(b);

        // Check if NetBird is installed — if not, show setup screen
        const setupCheck = await invoke<SetupCheckResult>("check_netbird_setup").catch(() => null);
        if (!mounted) return;

        if (setupCheck?.needs_install) {
          setScreen("setup");
        } else {
          const enrolled = await invoke<boolean>("nb_is_enrolled").catch(
            () => false
          );
          if (!mounted) return;
          setScreen(enrolled ? "main" : "enrollment");
        }

        try {
          const initial = await invoke<StatusDto>("nb_status");
          if (mounted) setStatus(initial);
        } catch {
          /* ignore */
        }

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
          try {
            await invoke("nb_connect", {});
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(msg);
          }
        });
        const u4 = await listen("tray-disconnect", async () => {
          try {
            await invoke("nb_disconnect");
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(msg);
          }
        });
        const u5 = await listen<number>("tray-launch-index", async (ev) => {
          try {
            const b = await invoke<BrandingDto>("get_branding");
            const idx = ev.payload;
            const item = b.quickLaunch[idx];
            if (item) await requestLaunch(item);
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            toast.error(msg);
          }
        });
        const u6 = await listen("tray-open-diagnose", () => {
          setScreen("diagnose");
        });
        const u7 = await listen("tray-open-settings", () => {
          setScreen("settings");
        });
        unlisteners = [u1, u2, u3, u4, u5, u6, u7];
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
  }, [refreshProfiles, requestLaunch, toast]);

  if (bootstrapping || !branding) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 px-8">
        <img
          src={new URL("./assets/nkk-logo.svg", import.meta.url).href}
          alt="NKK Secure Access"
          width={100}
          height={100}
          className="brand-breathe"
          draggable={false}
        />
        <div className="w-32 h-1 rounded-full bg-[color:var(--brand-border)] overflow-hidden">
          <div className="h-full rounded-full bg-[color:var(--brand-primary)] brand-loading-bar" />
        </div>
        <span className="text-[11px] font-semibold text-[color:var(--brand-fg)]/50">
          Bitte einen Moment Geduld …
        </span>
        {bootError && (
          <pre className="text-[10px] text-red-600 max-w-[80%] whitespace-pre-wrap text-center surface rounded-lg p-2">
            {bootError}
          </pre>
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
        onInstall={updater.install}
        onRestart={updater.restart}
      />
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
          profile={profiles[0] ?? null}
          onRequestLaunch={requestLaunch}
          onOpenCredentials={
            profiles.length > 0
              ? () => openEditProfileModal(profiles[0])
              : openNewProfileModal
          }
          onOpenSettings={() => setScreen("settings")}
          onOpenAbout={() => setScreen("diagnose")}
          onOpenNews={() => setScreen("news")}
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
          profile={profiles[0] ?? null}
          onClose={() => setScreen("main")}
        />
      )}
      {credModalOpen && (
        <CredentialsModal
          initial={editingProfile}
          onSaved={handleProfileSaved}
          onClose={handleProfileModalClose}
        />
      )}
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppInner />
    </ToastProvider>
  );
}
