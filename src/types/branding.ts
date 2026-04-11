export interface ProductInfo {
  name: string;
  shortName: string;
  version: string;
  tagline?: string;
  logoText?: string[];
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
}

export type QuickLaunchType = "rdp" | "smb" | "url";

export interface QuickLaunchEntry {
  label: string;
  type: QuickLaunchType;
  target: string;
  description?: string | null;
  default?: boolean;
  icon?: string | null;
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
