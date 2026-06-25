export type ConnectionState =
  | "Disconnected"
  | "Connecting"
  | "Connected"
  | "Error";

export interface PeerDto {
  name: string;
  ip: string;
  connected: boolean;
  latency_ms?: number | null;
  relay?: string | null;
}

export interface StatusDto {
  state: ConnectionState;
  management_connected: boolean;
  peers: PeerDto[];
  local_ip?: string | null;
  updated_at: string;
  cli_available: boolean;
  needs_login: boolean;
}
