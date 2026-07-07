export interface Isp {
  isp: string | null
  org: string | null
  asn: string | null
  city: string | null
  country: string | null
  country_code: string | null
  type: string | null // mobile / proxy / hosting flags joined
}

export interface LevelInfo {
  open_url: string
  gid?: string | null
  online: boolean
  last_seen: string | null
  last_user: string | null
  model: string | null
  platform: string | null
  security_score: number | null
  city: string | null
  country: string | null
  nickname: string | null
}

export interface Device {
  hostname: string
  os_user: string | null
  os_name: string | null
  os_version: string | null
  app_version: string | null
  local_ip: string | null
  public_ip: string | null
  last_seen: string | null
  last_reported?: string | null
  ping_internet: number | null
  ping_lan: number | null
  speed_mbps: number | null
  isp?: Isp | null
  level?: LevelInfo | null
  updates?: DeviceUpdates | null
  netbird?: NetbirdInfo | null
}

export interface NetbirdInfo {
  version: string | null
  connected: boolean | null
}

export interface DeviceUpdates {
  count: number
  items: { name: string | null; category: string | null; version: string | null }[]
}

export interface Peer {
  id: string
  name: string
  ip: string | null
  connected: boolean
  version: string | null
  last_seen: string | null
  os: string | null
  ssh_enabled?: boolean
}

export interface SetupKey {
  id: string
  name: string
  valid: boolean
  used: number | null
  limit: number | null
  type: string | null
  expires: string | null
  revoked: boolean
  groups: string[]
}

export interface Group {
  id: string
  name: string
  peers_count: number
}

export type NewsType = "announcement" | "update" | "feedback"

export interface NewsItem {
  id: string
  date: string
  type: NewsType
  title: string
  body: string
  version?: string
  created_at?: string
}

export interface DiskInfo {
  mount: string
  size_gb: number
  used_gb: number
  free_gb: number
  used_pct: number
}

export interface SystemStatus {
  exe?: { size_mb: number; mtime: string } | null
  zip?: { size_mb: number; mtime: string } | null
  update_channel?: { ok: boolean; version?: string; platforms?: string[]; error?: string }
  backup?: { newest: string | null; age_hours?: number; count?: number }
  disks?: DiskInfo[]
  cert?: { days_left?: number; not_after?: string } | null
}

export interface DashboardData {
  generated: string
  current_version: string
  netbird_current?: string | null
  total_reports: number
  devices: Device[]
  peers: Peer[]
  keys: SetupKey[]
  groups: Group[]
  news: NewsItem[]
  status: SystemStatus
  level_automations?: string[]
  status_targets?: StatusTarget[]
  downloads?: { windows_exe: string; windows_zip: string; macos_dmg: string | null }
}

export interface StatusTarget {
  name: string
  host: string
  type: string
  online: boolean | null
  ms: number | null
}

export interface AutomationResult {
  ok: boolean
  run_id?: string | null
  automation?: string
  note?: string
  error?: string
}

export interface RunStatus {
  ok: boolean
  status?: string
  started_at?: string | null
  ended_at?: string | null
  error?: string
}

// Zugriffsprotokoll: ein Ereignis = ein von der App gemeldeter Start (RDP/SMB/SSH).
// 'device' + 'verified' setzt das Panel-Backend aus dem NetBird-Peer-Abgleich.
export interface ActivityItem {
  ts: string
  kind: string
  target?: string
  label?: string
  hostname?: string
  os_user?: string
  os_name?: string
  role?: string
  local_ip?: string
  version?: string
  client_ts?: string
  src?: string
  device?: string
  verified?: boolean
}

export interface ActivityResponse {
  items: ActivityItem[]
  total: number
}
