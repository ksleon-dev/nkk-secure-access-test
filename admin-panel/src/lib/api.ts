import type { DashboardData, AutomationResult, RunStatus } from "./types"

export class AuthError extends Error {
  constructor() {
    super("nicht angemeldet")
    this.name = "AuthError"
  }
}

async function req<T = unknown>(path: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    ...opts,
  })
  if (res.status === 401) throw new AuthError()
  let data: unknown = null
  try {
    data = await res.json()
  } catch {
    data = null
  }
  if (!res.ok) {
    const msg = (data as { error?: string })?.error || `HTTP ${res.status}`
    throw new Error(msg)
  }
  // Aktionen liefern {ok:false,error} mit HTTP 200 -> hier als Fehler werfen
  if (data && typeof data === "object" && "ok" in data && (data as { ok: boolean }).ok === false) {
    throw new Error((data as { error?: string }).error || "Aktion fehlgeschlagen")
  }
  return data as T
}

export interface CreateKeyInput {
  name: string
  type: "one-off" | "reusable"
  usage_limit: number
  expires_days: number
  auto_groups: string[]
}

export const api = {
  session: () => req<{ authed: boolean }>("/api/session"),
  login: (password: string) =>
    req<{ ok: boolean }>("/api/login", { method: "POST", body: JSON.stringify({ password }) }),
  logout: () => req("/api/logout", { method: "POST" }),

  data: () => req<DashboardData>("/api/data"),

  pushNews: (type: string, title: string, message: string) =>
    req("/api/news", { method: "POST", body: JSON.stringify({ type, title, message }) }),
  deleteNews: (id: string) =>
    req("/api/news/delete", { method: "POST", body: JSON.stringify({ id }) }),
  renamePeer: (id: string, name: string) =>
    req("/api/peer/rename", { method: "POST", body: JSON.stringify({ id, name }) }),
  deletePeer: (id: string) =>
    req("/api/peer/delete", { method: "POST", body: JSON.stringify({ id }) }),
  createKey: (input: CreateKeyInput) =>
    req<{ ok: boolean; key: string; name: string; type: string }>("/api/key/create", {
      method: "POST",
      body: JSON.stringify(input),
    }),
  revokeKey: (id: string) =>
    req("/api/key/revoke", { method: "POST", body: JSON.stringify({ id }) }),
  revealKey: (id: string) =>
    req<{ ok: boolean; key?: string; name?: string }>("/api/key/reveal", {
      method: "POST",
      body: JSON.stringify({ id }),
    }),
  pingDevice: (ip: string) =>
    req<{ ok: boolean; reachable?: boolean; ms?: number | null; error?: string }>(
      "/api/device/ping",
      { method: "POST", body: JSON.stringify({ ip }) },
    ),
  runAutomation: (gid: string, automation?: string) =>
    req<AutomationResult>("/api/device/automation", {
      method: "POST",
      body: JSON.stringify({ gid, automation }),
    }),
  runStatus: (run_id: string) =>
    req<RunStatus>("/api/device/run-status", { method: "POST", body: JSON.stringify({ run_id }) }),
}
