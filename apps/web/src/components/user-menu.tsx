"use client";

import Link from "next/link";
import { useTransition } from "react";
import { DropdownMenu } from "radix-ui";
import { logoutAction } from "@/app/login/actions";

interface UserMenuProps {
  /** The person's name, or null when they have not given one. */
  name: string | null;
  /** Masked phone number, shown when there is no name. */
  phone: string;
  isBusinessMember: boolean;
}

const itemClass =
  "flex cursor-default select-none items-center rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-accent";

export function UserMenu({ name, phone, isBusinessMember }: UserMenuProps) {
  const [signingOut, startTransition] = useTransition();
  const label = name ?? phone;
  const initial = (name?.trim()[0] ?? "•").toUpperCase();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 whitespace-nowrap rounded-full bg-card py-1 pl-1 pr-1 text-sm font-medium shadow-xs ring-1 ring-border focus-visible:outline-2 focus-visible:outline-offset-2 sm:pr-3"
          aria-label={`Account menu for ${label}`}
        >
          <span
            aria-hidden="true"
            className="flex size-8 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
          >
            {initial}
          </span>
          <span className="hidden max-w-32 truncate sm:inline">{label}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-48 rounded-xl border bg-popover p-1 text-popover-foreground shadow-lg"
        >
          <DropdownMenu.Label className="truncate px-3 py-2 text-xs text-muted-foreground">Signed in as {label}</DropdownMenu.Label>
          <DropdownMenu.Item asChild>
            <Link href="/account" className={itemClass}>
              My bookings
            </Link>
          </DropdownMenu.Item>
          <DropdownMenu.Item asChild>
            <Link href="/account/profile" className={itemClass}>
              Profile
            </Link>
          </DropdownMenu.Item>
          {isBusinessMember && (
            <DropdownMenu.Item asChild>
              <Link href="/dashboard" className={itemClass}>
                Business dashboard
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="my-1 h-px bg-border" />
          <DropdownMenu.Item
            className={itemClass}
            disabled={signingOut}
            onSelect={() => startTransition(() => logoutAction())}
          >
            {signingOut ? "Signing out…" : "Sign out"}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
