import clsx from "clsx";
import { User } from "lucide-react";
import {
  avatarColor,
  initials,
  type CredentialProfileMeta,
} from "../types/credentials";

interface AvatarProps {
  profile: CredentialProfileMeta | null;
  size?: number;
  onClick?: () => void;
  title?: string;
}

export function Avatar({ profile, size = 32, onClick, title }: AvatarProps) {
  const has = !!profile?.username;
  const Tag = onClick ? "button" : "div";
  const fontSize = Math.max(10, Math.floor(size / 2.6));
  return (
    <Tag
      onClick={onClick}
      title={title ?? profile?.username ?? "Anmeldedaten"}
      className={clsx(
        "rounded-full flex items-center justify-center shrink-0 text-white font-bold select-none",
        onClick &&
          "transition hover:ring-2 hover:ring-[color:var(--brand-primary)]/40 active:scale-95"
      )}
      style={{
        width: size,
        height: size,
        background: has ? avatarColor(profile) : "rgba(127,127,127,0.25)",
        fontSize,
      }}
      aria-label={profile?.username ?? "Anmeldedaten setzen"}
    >
      {has ? (
        initials(profile)
      ) : (
        <User size={Math.floor(size * 0.55)} className="text-muted" />
      )}
    </Tag>
  );
}
