import { invoke } from "@tauri-apps/api/core";
import { ExternalLink, Mail, X } from "lucide-react";
import { copyText } from "../lib/clipboard";
import { Logo } from "../components/Logo";
import { useToast } from "../components/Toast";
import { de } from "../i18n/de";
import type { BrandingDto } from "../types/branding";

interface Props {
  branding: BrandingDto;
  onClose: () => void;
}

export function AboutDialog({ branding, onClose }: Props) {
  const toast = useToast();
  function openSupport() {
    invoke("open_url", { url: branding.vendor.supportUrl }).catch(() => {});
  }
  async function copyMail() {
    if (await copyText(branding.vendor.supportEmail))
      toast.success("Support Email kopiert.");
    else toast.error("Konnte nicht kopieren.");
  }

  return (
    <div className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm flex items-center justify-center p-6">
      <div className="surface rounded-xl p-5 w-full max-w-sm shadow-2xl relative">
        <button
          onClick={onClose}
          className="absolute top-2 right-2 btn-ghost p-1.5 rounded-md"
          aria-label={de.about.close}
        >
          <X size={16} />
        </button>

        <div className="flex flex-col items-center gap-2">
          <Logo branding={branding} size={56} />
          <div className="text-center">
            <h2 className="text-base font-bold">{branding.product.name}</h2>
            <p className="text-xs text-muted font-mono">
              v{branding.product.version}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2 text-xs">
          <div className="text-center text-muted">
            {de.about.poweredBy}{" "}
            <span className="font-semibold text-[color:var(--brand-fg)]">
              {branding.vendor.name}
            </span>
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-1.5">
          <button
            onClick={copyMail}
            className="surface hover:border-[color:var(--brand-primary)] rounded-md py-2 text-xs flex items-center justify-center gap-1.5 transition"
            title="Klicken zum Kopieren"
          >
            <Mail size={12} />
            {branding.vendor.supportEmail}
          </button>
          <button
            onClick={openSupport}
            className="surface hover:border-[color:var(--brand-primary)] rounded-md py-2 text-xs flex items-center justify-center gap-1.5 transition"
          >
            <ExternalLink size={12} />
            {branding.vendor.supportUrl}
          </button>
        </div>
      </div>
    </div>
  );
}
