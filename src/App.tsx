import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";
import { ToastProvider, useToast } from "./components/Toast";
import { CredentialsModal } from "./screens/CredentialsModal";
import { DiagnosePanel } from "./screens/DiagnosePanel";
import { EnrollmentScreen } from "./screens/EnrollmentScreen";
import { MainScreen } from "./screens/MainScreen";
import { NewsScreen } from "./screens/NewsScreen";
import { SettingsScreen } from "./screens/SettingsScreen";
import type { BrandingDto, QuickLaunchEntry } from "./types/branding";
import type { CredentialProfileMeta } from "./types/credentials";
import type { StatusDto } from "./types/netbird";

type Screen = "enrollment" | "main" | "settings" | "news";

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
  const [diagnoseOpen, setDiagnoseOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(true);
  const [bootError, setBootError] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<CredentialProfileMeta[]>([]);
  const [credModalOpen, setCredModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] =
    useState<CredentialProfileMeta | null>(null);
  const toast = useToast();

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

        // Check enrollment FIRST — this hits the keychain once for the
        // setup key. We defer creds_list to AFTER screen is shown so there's
        // only ONE keychain prompt on macOS startup, not two.
        const enrolled = await invoke<boolean>("nb_is_enrolled").catch(
          () => false
        );
        if (!mounted) return;
        setScreen(enrolled ? "main" : "enrollment");

        try {
          const initial = await invoke<StatusDto>("nb_status");
          if (mounted) setStatus(initial);
        } catch {
          /* ignore */
        }

        // Load credential profiles AFTER the screen is visible — separate
        // keychain entry, separate prompt on unsigned macOS builds.
        await refreshProfiles();

        const u1 = await listen<StatusDto>("netbird-status-changed", (ev) => {
          setStatus(ev.payload);
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
          setDiagnoseOpen(true);
        });
        const u7 = await listen("tray-open-settings", () => {
          setScreen("settings");
        });
        unlisteners = [u1, u2, u3, u4, u5, u6, u7];
      } catch (e: unknown) {
        if (mounted) setBootError(String(e));
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
      <div className="h-full flex flex-col items-center justify-center gap-3 text-sm text-muted">
        <div className="w-10 h-10 rounded-full border-2 border-current border-t-transparent animate-spin opacity-40" />
        <span>Lade …</span>
        {bootError && (
          <pre className="text-[10px] text-red-500 max-w-[80%] whitespace-pre-wrap text-center">
            {bootError}
          </pre>
        )}
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col relative">
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
          onOpenAbout={() => setDiagnoseOpen(true)}
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
      {diagnoseOpen && (
        <DiagnosePanel
          branding={branding}
          profile={profiles[0] ?? null}
          onClose={() => setDiagnoseOpen(false)}
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
