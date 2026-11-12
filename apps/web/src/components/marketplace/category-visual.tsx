import { CircleDot, Feather, Gamepad2, Goal, Trophy, Waves, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface Look {
  Icon: LucideIcon;
  /** Panel background and the ink used on it, from the status colours at low strength. */
  panel: string;
  ink: string;
}

const GREEN = { panel: "bg-[#e3f5e8]", ink: "text-[#1b7a35]" };
const BLUE = { panel: "bg-[#e5f0fc]", ink: "text-[#0058b0]" };
const ORANGE = { panel: "bg-[#fff0d6]", ink: "text-[#8a5300]" };
const GREY = { panel: "bg-[#ececf0]", ink: "text-[#4a4a50]" };

const KNOWN: Record<string, Look> = {
  "snooker-pool": { Icon: CircleDot, ...GREEN },
  "gaming-lounge": { Icon: Gamepad2, ...BLUE },
  swimming: { Icon: Waves, ...BLUE },
  "football-turf": { Icon: Goal, ...GREEN },
  badminton: { Icon: Feather, ...ORANGE },
};

const FALLBACKS = [GREY, BLUE, GREEN, ORANGE];

/** Same slug, same look, so a venue and its category tile match. Unknown categories get a stable colour. */
export function categoryLook(slug: string | undefined): Look {
  if (slug && KNOWN[slug]) return KNOWN[slug];
  let hash = 0;
  for (const ch of slug ?? "") hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return { Icon: Trophy, ...FALLBACKS[hash % FALLBACKS.length]! };
}

/**
 * Stand-in for a cover photo: a tinted panel with the category icon and the venue's first letter.
 * Decorative, so hidden from assistive technology; the venue name is always printed beside it.
 */
export function VenuePanel({ name, categorySlug, className, size = "card" }: { name: string; categorySlug?: string; className?: string; size?: "card" | "hero" }) {
  const { Icon, panel, ink } = categoryLook(categorySlug);
  const initial = name.trim().charAt(0).toUpperCase() || "K";
  return (
    <div aria-hidden="true" className={cn("relative isolate overflow-hidden", panel, ink, className)}>
      <span
        className={cn(
          "absolute -bottom-[0.16em] -right-[0.04em] select-none font-semibold leading-none tracking-tighter opacity-[0.14]",
          size === "hero" ? "text-[17rem] sm:text-[24rem]" : "text-[9rem]",
        )}
      >
        {initial}
      </span>
      <span
        className={cn(
          "absolute left-4 top-4 inline-flex items-center justify-center rounded-2xl bg-white/70 shadow-[0_1px_0_rgba(255,255,255,0.8)_inset]",
          size === "hero" ? "size-14 sm:left-8 sm:top-8 sm:size-16" : "size-11",
        )}
      >
        <Icon className={size === "hero" ? "size-7 sm:size-8" : "size-5"} strokeWidth={1.75} />
      </span>
    </div>
  );
}
