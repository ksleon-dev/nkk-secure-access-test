import nkkLogoUrl from "../assets/nkk-logo.svg";
import type { BrandingDto } from "../types/branding";

interface LogoProps {
  branding: BrandingDto;
  size?: number;
  className?: string;
}

/**
 * Renders the NKK Secure Access logo — traced SVG of the VPN icon
 * (cherry mark + "VPN" wordmark on cherry red rounded square).
 * Scales perfectly at any size.
 */
export function Logo({ branding, size = 120, className }: LogoProps) {
  return (
    <img
      src={nkkLogoUrl}
      alt={branding.product.name}
      width={size}
      height={size}
      className={className}
      draggable={false}
    />
  );
}
