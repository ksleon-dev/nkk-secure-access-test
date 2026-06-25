export interface SpeedResult {
  target: string;
  bytes: number;
  duration_ms: number;
  mbps: number;
}

export interface DebugInfo {
  os_username: string;
  hostname: string;
  os_name: string;
  os_version: string;
  app_version: string;
  internet_ok: boolean;
  vpn_connected: boolean;
  netbird_cli_present: boolean;
  lan_target: string;
  lan_ok: boolean;
  local_ip: string | null;
  public_ip: string | null;
  peers_total: number;
  peers_connected: number;
  detected_issue: string;
  speed: SpeedResult | null;
  timestamp: string;
}

// Pings loaded separately (lazy) via run_ping_test - not part of DebugInfo

export interface PingResult {
  target: string;
  label: string;
  avg_ms: number;
  min_ms: number;
  max_ms: number;
  pings: number;
  ok: boolean;
}

export interface SmartDebugStep {
  name: string;
  ok: boolean;
  detail: string;
  action_taken: string | null;
}

export interface SmartDebugResult {
  steps: SmartDebugStep[];
  summary: string;
}

export interface HealthEvent {
  timestamp: string;
  state: string;
  localIp: string | null;
}

export interface Inventory {
  hostname: string;
  os_name: string;
  os_version: string;
  os_username: string;
  app_version: string;
  netbird_version: string | null;
  local_ip: string | null;
  management_url: string | null;
  autostart_enabled: boolean;
  enrolled: boolean;
}

export interface ConnectivityResult {
  online: boolean;
  captivePortal: boolean;
  httpCode: number;
}

export interface OnSiteResult {
  onSite: boolean;
  viaTarget: string | null;
  vpnActive: boolean;
}

export interface NetworkContext {
  context: string; // "office" | "remote" | "unknown"
  chosenPath: string; // "lan" | "vpn" | "none"
  serverReachableDirect: boolean;
  vpnConnected: boolean;
  dualHoming: boolean;
  defaultRoutes: string[];
  reason: string;
  warning: string | null;
}

export interface NetbirdVersionCheck {
  local: string | null;
  latest: string | null;
  updateAvailable: boolean;
  managementUrl: string | null;
  note: string;
}

export interface LevelMeta {
  id: string;
  label: string;
  description: string | null;
  steps: number;
}

export interface LevelStepResult {
  label: string;
  ok: boolean;
  exitCode: number;
  output: string;
}

export interface LevelRunResult {
  level: string;
  steps: LevelStepResult[];
  ok: boolean;
}

export interface MtuProbe {
  anchor: string;
  pathMtu: number;
  recommendedMtu: number;
  status: string; // "optimal" | "niedrig" | "unbekannt"
  note: string;
}

export interface LinkQuality {
  target: string;
  label: string;
  avgMs: number;
  jitterMs: number;
  lossPct: number;
  status: string; // "gut" | "okay" | "degradiert" | "weg"
  ok: boolean;
}
