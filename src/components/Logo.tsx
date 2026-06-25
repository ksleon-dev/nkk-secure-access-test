import nkkLogoUrl from "../assets/nkk-logo.svg";
import type { BrandingDto } from "../types/branding";

interface LogoProps {
  branding: BrandingDto;
  size?: number;
  className?: string;
}

// Authentic Naturkost Kontor brand mark (the original logo, sprig and all).
// Its artboard is 209 x 218.7, slightly taller than wide, so derive the
// height from the width instead of forcing a square and squashing it.
const LOGO_RATIO = 218.7 / 209;

export function Logo({ branding, size = 120, className }: LogoProps) {
  return (
    <img
      src={nkkLogoUrl}
      alt={branding.product.name}
      width={size}
      height={Math.round(size * LOGO_RATIO)}
      className={className}
      draggable={false}
    />
  );
}
