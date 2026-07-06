export interface ProductInfo {
  name: string;
  shortName: string;
  version: string;
  tagline?: string;
  logoText?: string[];
  /** Friendly name of the network, e.g. "NKK Netz". Used in notifications. */
  networkName?: string;
  /** Optional brand footnotes shown on the main screen. Empty = none. */
  footnotes?: string[];
}

export interface VendorInfo {
  name: string;
  footer: string;
  supportEmail: string;
  supportUrl: string;
}

export interface ThemeInfo {
  primary: string;
  primaryHover: string;
  accent: string;
  background: string;
  foreground: string;
  logoPath: string;
}

export interface NetbirdInfo {
  managementUrl: string;
  adminUrl: string;
  /** Windows/AD domain pre-filled in the credential dialog, e.g. "NKKHB". */
  defaultDomain?: string;
  /** Internal DNS suffix stripped from peer FQDNs in the UI, e.g. "nkk.internal". */
  internalDomainSuffix?: string;
}

export type QuickLaunchType = "rdp" | "smb" | "url" | "ssh";

export interface QuickLaunchEntry {
  label: string;
  type: QuickLaunchType;
  target: string;
  description?: string | null;
  default?: boolean;
  icon?: string | null;
  /** Hidden from the launch list; only reachable via its hotkey. */
  hidden?: boolean;
  /** Optional Shift+<digit> hotkey (e.g. "1") that launches this entry. */
  hotkey?: string;
  /**
   * Rollen-Gate: "manager" => nur Geschäftsführer, "it_admin" => nur IT Admin,
   * "admin" => beide privilegierten Rollen (GF + IT Admin); fehlt => alle sehen es.
   */
  role?: "user" | "manager" | "it_admin" | "admin";
  /** RD Gateway host (RDP over HTTPS) => reaches the target without any VPN. */
  gateway?: string;
  /** SSH-Login-Benutzer (nur type "ssh"); fehlt => Standardbenutzer (root). */
  user?: string;
  /** SSH-Port (nur type "ssh"); fehlt => 22. */
  port?: number;
  /** Layout-Gruppe im Admin-Grid: "ts" Terminalserver, "core" Kern-Server, "net" Netz + Verwaltung. */
  group?: "ts" | "core" | "net";
}

export interface BrandingDto {
  product: ProductInfo;
  vendor: VendorInfo;
  theme: ThemeInfo;
  netbird: NetbirdInfo;
  quickLaunch: QuickLaunchEntry[];
  newsUrl?: string;
  webhookUrl?: string;
}
