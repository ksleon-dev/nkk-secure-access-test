import { invoke } from "@tauri-apps/api/core";
import {
  Eye,
  EyeOff,
  KeyRound,
  Loader2,
  Save,
  ShieldCheck,
  Tag,
  User,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useToast } from "../components/Toast";
import {
  DEFAULT_DOMAIN,
  type CredentialProfileMeta,
} from "../types/credentials";

interface Props {
  initial: CredentialProfileMeta | null;
  onSaved: (saved: CredentialProfileMeta) => void;
  onClose: () => void;
}

export function CredentialsModal({ initial, onSaved, onClose }: Props) {
  const editing = !!initial;
  const [label, setLabel] = useState(initial?.label ?? "");
  const [username, setUsername] = useState(initial?.username ?? "");
  const [password, setPassword] = useState("");
  const [domain, setDomain] = useState(initial?.domain ?? DEFAULT_DOMAIN);
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  // Prefill username from OS user — only ONCE on mount when creating a new
  // profile. After that the user can clear the field freely without it
  // popping back.
  useEffect(() => {
    if (editing) return;
    invoke<string>("creds_default_username")
      .then((u) => {
        // Only set if the field is still empty (avoid clobbering a value
        // the user typed in the meantime).
        if (u) setUsername((current) => (current === "" ? u : current));
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!username.trim()) {
      setError("Benutzername darf nicht leer sein.");
      return;
    }
    if (!password) {
      setError("Passwort darf nicht leer sein.");
      return;
    }
    setBusy(true);
    try {
      const saved = await invoke<CredentialProfileMeta>("creds_save", {
        id: initial?.id ?? null,
        label: label.trim() || username.trim(),
        username: username.trim(),
        password,
        domain: domain.trim() || null,
      });
      toast.success(
        editing
          ? "Profil aktualisiert."
          : "Profil gespeichert — verschlüsselt im OS Tresor."
      );
      onSaved(saved);
    } catch (e: unknown) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="absolute inset-0 z-50 bg-black/55 backdrop-blur-sm flex items-center justify-center p-4">
      <form
        onSubmit={handleSave}
        className="surface rounded-xl w-full max-w-sm shadow-2xl relative overflow-hidden"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-2 right-2 btn-ghost p-1.5 rounded-md z-10"
          aria-label="Schließen"
        >
          <X size={16} />
        </button>

        <div className="px-5 pt-5 pb-3 border-b border-[color:var(--brand-border)]">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[var(--brand-primary)] text-white flex items-center justify-center">
              <KeyRound size={18} />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-sm font-bold leading-tight">
                {editing ? "Profil bearbeiten" : "Neues Profil"}
              </h2>
              <p className="text-[10px] text-muted leading-tight">
                Verschlüsselt im{" "}
                {macOrWin()} gespeichert
              </p>
            </div>
          </div>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          <Field
            label="Anzeigename"
            icon={<Tag size={11} />}
            input={
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={username || "z. B. Büro Max"}
                spellCheck={false}
                autoComplete="off"
                className={inputCls}
                disabled={busy}
              />
            }
          />
          <Field
            label="Domäne"
            icon={<ShieldCheck size={11} />}
            input={
              <input
                type="text"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                placeholder={DEFAULT_DOMAIN}
                spellCheck={false}
                autoComplete="off"
                className={inputCls}
                disabled={busy}
              />
            }
          />
          <Field
            label="Benutzername"
            icon={<User size={11} />}
            input={
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="max.mustermann"
                spellCheck={false}
                autoComplete="username"
                className={inputCls}
                disabled={busy}
                autoFocus={!editing}
              />
            }
          />
          <Field
            label={editing ? "Neues Passwort" : "Passwort"}
            icon={<KeyRound size={11} />}
            input={
              <div className="relative">
                <input
                  type={showPw ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editing ? "neu setzen …" : "••••••••"}
                  autoComplete="new-password"
                  className={inputCls + " pr-9"}
                  disabled={busy}
                />
                <button
                  type="button"
                  onClick={() => setShowPw((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 btn-ghost p-1 rounded"
                  tabIndex={-1}
                >
                  {showPw ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
            }
          />

          {error && (
            <div className="text-[11px] text-red-600 bg-red-500/10 border border-red-500/20 rounded-md px-2 py-1.5">
              {error}
            </div>
          )}

          <div className="flex gap-2 mt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 surface hover:border-[color:var(--brand-border)] rounded-lg py-2 text-xs font-semibold transition"
              disabled={busy}
            >
              Abbrechen
            </button>
            <button
              type="submit"
              className="flex-[2] btn-primary rounded-lg py-2 text-xs font-semibold flex items-center justify-center gap-1.5"
              disabled={busy}
            >
              {busy ? (
                <Loader2 size={13} className="animate-spin" />
              ) : (
                <Save size={13} />
              )}
              Speichern
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}

const inputCls =
  "w-full surface rounded-md px-2.5 py-2 text-sm outline-none focus:border-[color:var(--brand-primary)] focus:ring-2 focus:ring-[color:var(--brand-primary)]/20 transition";

function Field({
  label,
  icon,
  input,
}: {
  label: string;
  icon: React.ReactNode;
  input: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted">
        {icon}
        {label}
      </span>
      {input}
    </label>
  );
}

function macOrWin(): string {
  if (typeof navigator !== "undefined") {
    if (/Mac/.test(navigator.platform)) return "macOS Schlüsselbund";
    if (/Win/.test(navigator.platform)) return "Windows Credential Manager";
  }
  return "System Tresor";
}
