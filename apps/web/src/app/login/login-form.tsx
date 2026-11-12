"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { OtpInput } from "@/components/otp-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestOtpAction, verifyOtpAction } from "./actions";

const CODE_LENGTH = 6;

/** "+919876543210" → "+91 98765 43210" */
function displayPhone(phone: string): string {
  const local = phone.replace(/^\+91/, "");
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

interface Sent {
  phone: string;
  demoCode?: string;
}

export function LoginForm({ next }: { next: string | null }) {
  const router = useRouter();
  const phoneId = useId();
  const phoneErrorId = useId();
  const codeErrorId = useId();
  const phoneInput = useRef<HTMLInputElement>(null);

  const [phoneText, setPhoneText] = useState("");
  const [sent, setSent] = useState<Sent | null>(null);
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  // Changing this remounts the code boxes, which clears them.
  const [codeKey, setCodeKey] = useState(0);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Resend countdown. A display timer only: the server enforces the real limit.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  async function sendCode(phone: string): Promise<boolean> {
    setSending(true);
    try {
      const result = await requestOtpAction({ phone });
      if (!result.ok) {
        // Shown under whichever field is on screen.
        if (sent) setCodeError(result.message);
        else setPhoneError(result.message);
        return false;
      }
      setSent({ phone: result.data.phone, demoCode: result.data.demoCode });
      setSecondsLeft(result.data.retryAfterSeconds);
      setCodeError(null);
      setCode("");
      setCodeKey((k) => k + 1);
      return true;
    } catch {
      const message = "We could not reach the server. Check your connection and try again.";
      if (sent) setCodeError(message);
      else setPhoneError(message);
      return false;
    } finally {
      setSending(false);
    }
  }

  async function onPhoneSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPhoneError(null);
    if (!phoneText.trim()) {
      setPhoneError("Enter your 10-digit mobile number.");
      phoneInput.current?.focus();
      return;
    }
    await sendCode(phoneText);
  }

  async function verify(value: string) {
    if (!sent || verifying) return;
    setCodeError(null);
    setVerifying(true);
    try {
      const result = await verifyOtpAction({ phone: sent.phone, code: value });
      if (!result.ok) {
        setCodeError(result.message);
        setCode("");
        setCodeKey((k) => k + 1);
        setVerifying(false);
        return;
      }
      // Without a safe `next`, /login sends a signed-in person to their dashboard or account.
      router.replace(next ?? "/login");
      router.refresh();
    } catch {
      setCodeError("We could not reach the server. Check your connection and try again.");
      setCode("");
      setCodeKey((k) => k + 1);
      setVerifying(false);
    }
  }

  function changeNumber() {
    setSent(null);
    setCode("");
    setCodeError(null);
    setPhoneError(null);
    setSecondsLeft(0);
    // The phone step mounts on the next render.
    setTimeout(() => phoneInput.current?.focus(), 0);
  }

  if (!sent) {
    return (
      <form onSubmit={onPhoneSubmit} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Label htmlFor={phoneId}>Mobile number</Label>
          <div className="flex gap-2">
            <span
              aria-hidden="true"
              className="flex h-11 items-center rounded-md border border-input bg-muted px-3 text-base text-muted-foreground tabular-nums"
            >
              +91
            </span>
            <Input
              id={phoneId}
              ref={phoneInput}
              name="phone"
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              autoFocus
              value={phoneText}
              onChange={(e) => setPhoneText(e.target.value)}
              disabled={sending}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? phoneErrorId : undefined}
              className="h-11 text-base tabular-nums"
            />
          </div>
          <p id={phoneErrorId} role="alert" className="min-h-5 text-sm text-destructive">
            {phoneError}
          </p>
        </div>
        <Button type="submit" size="lg" disabled={sending} className="h-11 rounded-full">
          {sending ? "Sending code…" : "Send code"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">We will text you a 6-digit code. No password needed.</p>
      </form>
    );
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (code.length === CODE_LENGTH) void verify(code);
      }}
      noValidate
      className="flex flex-col gap-4"
    >
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">
          Enter the code sent to <span className="tabular-nums">{displayPhone(sent.phone)}</span>
        </p>
        <OtpInput
          key={codeKey}
          length={CODE_LENGTH}
          label="6-digit code"
          autoFocus
          disabled={verifying}
          invalid={!!codeError}
          describedBy={codeError ? codeErrorId : undefined}
          onChange={setCode}
          onComplete={(value) => void verify(value)}
        />
        <p id={codeErrorId} role="alert" className="min-h-5 text-sm text-destructive">
          {codeError}
        </p>
      </div>

      {sent.demoCode && (
        <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
          Demo mode: your code is <span className="font-semibold tabular-nums">{sent.demoCode}</span>
        </p>
      )}

      <Button type="submit" size="lg" disabled={verifying || code.length !== CODE_LENGTH} className="h-11 rounded-full">
        {verifying ? "Signing you in…" : "Verify and sign in"}
      </Button>

      <div className="flex items-center justify-between gap-3 text-sm">
        <Button type="button" variant="link" className="h-auto p-0" onClick={changeNumber} disabled={verifying}>
          Change number
        </Button>
        <Button
          type="button"
          variant="link"
          className="h-auto p-0 tabular-nums"
          disabled={secondsLeft > 0 || sending || verifying}
          onClick={() => void sendCode(sent.phone)}
        >
          {sending ? "Sending…" : secondsLeft > 0 ? `Resend code in ${secondsLeft}s` : "Resend code"}
        </Button>
      </div>
    </form>
  );
}
