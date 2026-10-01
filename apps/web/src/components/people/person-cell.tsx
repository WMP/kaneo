import { useTranslation } from "react-i18next";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/cn";
import { getInitials } from "@/lib/get-initials";

// Stable per-user pastel for the avatar fallback. Picks one of a curated set
// of Tailwind tone pairs from a cheap string hash so the same user keeps the
// same color across re-renders without server-side state.
const AVATAR_TONES = [
  "bg-rose-500/15 text-rose-600 dark:text-rose-300",
  "bg-amber-500/15 text-amber-600 dark:text-amber-300",
  "bg-sky-500/15 text-sky-600 dark:text-sky-300",
  "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300",
  "bg-violet-500/15 text-violet-600 dark:text-violet-300",
  "bg-indigo-500/15 text-indigo-600 dark:text-indigo-300",
] as const;

function toneFor(value: string): string {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return AVATAR_TONES[Math.abs(hash) % AVATAR_TONES.length];
}

type Props = {
  name: string;
  email: string;
  image: string | null;
  isSelf?: boolean;
  /** Smaller avatar and no email line wrapping, for suggestion lists. */
  compact?: boolean;
};

/** Avatar, name and email of a person, the same everywhere people are listed. */
function PersonCell({ name, email, image, isSelf, compact }: Props) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-3">
      <Avatar className={cn(compact ? "size-7" : "size-8", toneFor(email))}>
        <AvatarImage src={image ?? ""} alt={name ?? ""} />
        <AvatarFallback className="bg-transparent text-[11px] font-medium">
          {getInitials(name)}
        </AvatarFallback>
      </Avatar>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{name || email}</span>
          {isSelf ? (
            <span className="text-xs text-muted-foreground">
              ({t("people:table.you")})
            </span>
          ) : null}
        </div>
        <div className="truncate text-xs text-muted-foreground">{email}</div>
      </div>
    </div>
  );
}

export default PersonCell;
