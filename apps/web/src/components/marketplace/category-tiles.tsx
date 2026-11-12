import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { categoryLook } from "./category-visual";

interface Tile {
  slug: string;
  name: string;
  description?: string | null;
}

/**
 * Category links as tinted tiles. With an odd number the first tile spans both columns,
 * so the grid never ends on a gap.
 */
export function CategoryTiles({ categories, className }: { categories: Tile[]; className?: string }) {
  if (categories.length === 0) return null;
  const featureFirst = categories.length % 2 === 1;
  return (
    <ul className={cn("grid grid-cols-2 gap-3", className)}>
      {categories.map((category, i) => {
        const { Icon, panel, ink } = categoryLook(category.slug);
        const wide = featureFirst && i === 0;
        return (
          <li key={category.slug} className={cn(wide && "col-span-2")}>
            <Link
              href={`/c/${category.slug}`}
              className={cn(
                "group relative flex h-full flex-col justify-between gap-6 overflow-hidden rounded-card p-5 outline-none transition duration-200 hover:-translate-y-0.5 focus-visible:ring-[3px] focus-visible:ring-ring/50 active:scale-[0.99] motion-reduce:transition-none",
                panel,
                ink,
                wide ? "min-h-36 sm:min-h-40" : "min-h-32",
              )}
            >
              <span className="inline-flex size-10 items-center justify-center rounded-xl bg-white/70">
                <Icon className="size-5" strokeWidth={1.75} aria-hidden="true" />
              </span>
              <span className="flex items-end justify-between gap-2">
                <span className="text-base font-semibold leading-tight tracking-tight text-foreground">{category.name}</span>
                <ArrowUpRight className="size-4 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" aria-hidden="true" />
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
