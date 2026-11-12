"use client";

import { useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";

interface OtpInputProps {
  length?: number;
  /** Called once every box is filled. */
  onComplete: (code: string) => void;
  /** Called on every edit with the digits entered so far. */
  onChange?: (code: string) => void;
  disabled?: boolean;
  /** Marks the boxes as wrong; pair it with an error message and `describedBy`. */
  invalid?: boolean;
  /** Id of the element that explains the error or the field. */
  describedBy?: string;
  autoFocus?: boolean;
  /** Spoken name of the group, e.g. "6-digit code". */
  label?: string;
  className?: string;
}

/**
 * One box per digit. Accepts typing, paste, and the whole code at once (which is
 * what SMS autofill does). To clear it after a wrong code, remount it with a new `key`.
 */
export function OtpInput({
  length = 6,
  onComplete,
  onChange,
  disabled,
  invalid,
  describedBy,
  autoFocus,
  label,
  className,
}: OtpInputProps) {
  const [digits, setDigits] = useState<string[]>(() => Array.from({ length }, () => ""));
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  function commit(next: string[], focusIndex: number) {
    setDigits(next);
    const code = next.join("");
    onChange?.(code);
    refs.current[Math.min(focusIndex, length - 1)]?.focus();
    if (code.length === length) onComplete(code);
  }

  /** Writes `value` (any number of digits) starting at box `index`. */
  function fill(index: number, value: string) {
    const incoming = value.replace(/\D/g, "").slice(0, length - index);
    if (!incoming) return;
    const next = [...digits];
    for (let i = 0; i < incoming.length; i++) next[index + i] = incoming[i]!;
    commit(next, index + incoming.length);
  }

  function onKeyDown(index: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace") {
      e.preventDefault();
      const next = [...digits];
      if (next[index]) {
        next[index] = "";
        setDigits(next);
        onChange?.(next.join(""));
      } else if (index > 0) {
        next[index - 1] = "";
        setDigits(next);
        onChange?.(next.join(""));
        refs.current[index - 1]?.focus();
      }
    } else if (e.key === "ArrowLeft" && index > 0) {
      e.preventDefault();
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      e.preventDefault();
      refs.current[index + 1]?.focus();
    }
  }

  function onPaste(index: number, e: ClipboardEvent<HTMLInputElement>) {
    e.preventDefault();
    fill(index, e.clipboardData.getData("text"));
  }

  return (
    <div role="group" aria-label={label ?? `${length}-digit code`} className={cn("flex gap-2", className)}>
      {digits.map((digit, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          value={digit}
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          // Only the first box asks for autofill; it spreads the code over the rest.
          autoComplete={i === 0 ? "one-time-code" : "off"}
          autoFocus={autoFocus && i === 0}
          disabled={disabled}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          onChange={(e) => {
            // Typing into a filled box gives "old+new"; keep only the new digit.
            const v = e.target.value;
            fill(i, digit && v.length === 2 ? v.replace(digit, "") : v);
          }}
          onKeyDown={(e) => onKeyDown(i, e)}
          onPaste={(e) => onPaste(i, e)}
          onFocus={(e) => e.target.select()}
          className={cn(
            "h-12 min-w-0 flex-1 rounded-lg border border-input bg-card text-center text-xl font-semibold tabular-nums outline-none transition-[color,box-shadow]",
            "focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
            "aria-invalid:border-destructive aria-invalid:ring-destructive/20 disabled:cursor-not-allowed disabled:opacity-50",
          )}
        />
      ))}
    </div>
  );
}
