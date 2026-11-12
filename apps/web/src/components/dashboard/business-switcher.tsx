"use client";

import { useId, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import type { ActionResult } from "@/lib/action";
import { switchBusinessAction } from "@/app/dashboard/actions";

export interface BusinessOption {
  id: string;
  name: string;
}

/** Lets a member of several businesses choose which one the dashboard shows. */
export function BusinessSwitcher({ current, options }: { current: string; options: BusinessOption[] }) {
  const router = useRouter();
  const [switching, startTransition] = useTransition();
  const id = useId();

  function choose(businessId: string) {
    startTransition(async () => {
      let result: ActionResult<null>;
      try {
        result = await switchBusinessAction(businessId);
      } catch {
        toast.error("We could not reach the server. Check your connection and try again.");
        return;
      }
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      router.push("/dashboard");
      router.refresh();
    });
  }

  return (
    <div className="relative min-w-0">
      <label htmlFor={id} className="sr-only">
        Business
      </label>
      <select
        id={id}
        value={current}
        disabled={switching}
        onChange={(e) => choose(e.target.value)}
        className="h-9 w-full max-w-56 cursor-pointer appearance-none truncate rounded-full bg-card py-1 pl-3.5 pr-8 text-sm font-semibold shadow-xs ring-1 ring-border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60"
      >
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}
