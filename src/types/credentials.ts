/**
 * Credential profile metadata as exposed to the frontend.
 * The password is NEVER serialized over the IPC bridge.
 */
export interface CredentialProfileMeta {
  id: string;
  label: string;
  username: string;
  domain: string | null;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CredentialProfileInput {
  id?: string | null;
  label: string;
  username: string;
  password: string;
  domain: string;
}

export interface KeyringTestResult {
  ok: boolean;
  backend: string;
  message: string;
}

export const DEFAULT_DOMAIN = "NKKHB";

export function displayName(p: CredentialProfileMeta | null): string | null {
  if (!p?.username) return null;
  const u = p.username.includes("\\")
    ? p.username.split("\\").pop()!
    : p.username;
  const first = u.split(/[._-]/)[0];
  return first.charAt(0).toUpperCase() + first.slice(1).toLowerCase();
}

export function initials(p: CredentialProfileMeta | null): string {
  if (!p?.username && !p?.label) return "?";
  const source = p.label || p.username;
  const u = source.includes("\\") ? source.split("\\").pop()! : source;
  const parts = u.split(/[._\-\s]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return u.slice(0, 2).toUpperCase();
}

export function avatarColor(p: CredentialProfileMeta | null): string {
  if (!p?.username) return "#9ca3af";
  let h = 0;
  for (let i = 0; i < p.username.length; i++) {
    h = (h * 31 + p.username.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(h) % 360;
  return `hsl(${hue}, 55%, 45%)`;
}
