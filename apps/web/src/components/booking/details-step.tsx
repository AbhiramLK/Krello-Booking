"use client";

import { useEffect, useId, useRef, useState } from "react";
import { requestOtpAction, verifyOtpAction } from "@/app/login/actions";
import { OtpInput } from "@/components/otp-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const CODE_LENGTH = 6;
const OFFLINE = "We could not reach the server. Check your connection and try again.";

export interface Contact {
  name: string;
  email: string;
  notes: string;
}

/** The signed-in customer, as `/api/auth/me` describes them. The phone is masked. */
export interface SignedInUser {
  name: string | null;
  phone: string;
}

interface DetailsStepProps {
  user: SignedInUser | null;
  contact: Contact;
  onContactChange: (contact: Contact) => void;
  submitting: boolean;
  /** Why the last submission failed, if it did. */
  error: string | null;
  /** Sends the request as the signed-in user. */
  onSubmit: () => void;
  /** The phone was just verified and a session started; the request should go now. */
  onVerified: (user: SignedInUser) => void;
}

/** "+919876543210" → "+91 98765 43210" */
const displayPhone = (phone: string) => {
  const local = phone.replace(/^\+91/, "");
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
};

/** Name, phone and optional details. Signed-out customers verify their phone here by code. */
export function DetailsStep({ user, contact, onContactChange, submitting, error, onSubmit, onVerified }: DetailsStepProps) {
  const ids = { name: useId(), phone: useId(), email: useId(), notes: useId(), nameError: useId(), phoneError: useId(), codeError: useId() };
  const nameInput = useRef<HTMLInputElement>(null);
  const phoneInput = useRef<HTMLInputElement>(null);

  const [nameError, setNameError] = useState<string | null>(null);
  const [phoneText, setPhoneText] = useState("");
  const [phoneError, setPhoneError] = useState<string | null>(null);
  const [sent, setSent] = useState<{ phone: string; demoCode?: string } | null>(null);
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [code, setCode] = useState("");
  const [codeKey, setCodeKey] = useState(0);
  const [codeError, setCodeError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  // Resend countdown. A display timer only: the server enforces the real limit.
  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const set = (patch: Partial<Contact>) => onContactChange({ ...contact, ...patch });
  const busy = submitting || sending || verifying;

  function checkName(): boolean {
    if (contact.name.trim()) return true;
    setNameError("Enter your name.");
    nameInput.current?.focus();
    return false;
  }

  async function sendCode(phone: string) {
    setSending(true);
    try {
      const result = await requestOtpAction({ phone });
      if (!result.ok) {
        if (sent) setCodeError(result.message);
        else {
          setPhoneError(result.message);
          phoneInput.current?.focus();
        }
        return;
      }
      setSent({ phone: result.data.phone, demoCode: result.data.demoCode });
      setSecondsLeft(result.data.retryAfterSeconds);
      setCode("");
      setCodeError(null);
      setCodeKey((k) => k + 1);
    } catch {
      if (sent) setCodeError(OFFLINE);
      else setPhoneError(OFFLINE);
    } finally {
      setSending(false);
    }
  }

  async function verify(value: string) {
    if (!sent || verifying) return;
    setCodeError(null);
    setVerifying(true);
    try {
      const result = await verifyOtpAction({ phone: sent.phone, code: value, name: contact.name.trim() || undefined });
      if (!result.ok) {
        setCodeError(result.message);
        setCode("");
        setCodeKey((k) => k + 1);
        return;
      }
      const local = sent.phone.replace(/^\+91/, "");
      onVerified({ name: result.data.name, phone: `${local.slice(0, 2)}••••${local.slice(-4)}` });
    } catch {
      setCodeError(OFFLINE);
      setCode("");
      setCodeKey((k) => k + 1);
    } finally {
      setVerifying(false);
    }
  }

  function onFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    if (!checkName()) return;
    if (user) {
      onSubmit();
      return;
    }
    if (sent) {
      if (code.length === CODE_LENGTH) void verify(code);
      return;
    }
    setPhoneError(null);
    if (!phoneText.trim()) {
      setPhoneError("Enter your 10-digit mobile number.");
      phoneInput.current?.focus();
      return;
    }
    void sendCode(phoneText);
  }

  return (
    <form onSubmit={onFormSubmit} noValidate className="flex flex-col gap-4" aria-label="Your details">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.name}>Name</Label>
        <Input
          id={ids.name}
          ref={nameInput}
          autoComplete="name"
          value={contact.name}
          maxLength={80}
          onChange={(e) => {
            set({ name: e.target.value });
            if (nameError) setNameError(null);
          }}
          disabled={busy}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? ids.nameError : undefined}
          className="h-11 text-base"
        />
        {nameError && (
          <p id={ids.nameError} role="alert" className="text-sm text-[#c4271d]">
            {nameError}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.phone}>Mobile number</Label>
        {user ? (
          <Input id={ids.phone} value={user.phone} readOnly aria-readonly="true" className="tabular h-11 bg-muted text-base text-muted-foreground" />
        ) : (
          <div className="flex gap-2">
            <span aria-hidden="true" className="tabular flex h-11 items-center rounded-md border border-input bg-muted px-3 text-base text-muted-foreground">
              +91
            </span>
            <Input
              id={ids.phone}
              ref={phoneInput}
              type="tel"
              inputMode="numeric"
              autoComplete="tel-national"
              placeholder="98765 43210"
              value={sent ? displayPhone(sent.phone).replace(/^\+91 /, "") : phoneText}
              readOnly={!!sent}
              onChange={(e) => {
                setPhoneText(e.target.value);
                if (phoneError) setPhoneError(null);
              }}
              disabled={busy && !sent}
              aria-invalid={phoneError ? true : undefined}
              aria-describedby={phoneError ? ids.phoneError : undefined}
              className="tabular h-11 text-base"
            />
          </div>
        )}
        {phoneError && (
          <p id={ids.phoneError} role="alert" className="text-sm text-[#c4271d]">
            {phoneError}
          </p>
        )}
        {user && <p className="text-xs text-muted-foreground">The venue sees this number. It is the one you signed in with.</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.email}>
          Email <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={ids.email}
          type="email"
          autoComplete="email"
          value={contact.email}
          maxLength={200}
          onChange={(e) => set({ email: e.target.value })}
          disabled={busy}
          className="h-11 text-base"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor={ids.notes}>
          Notes for the venue <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id={ids.notes}
          value={contact.notes}
          maxLength={500}
          rows={2}
          onChange={(e) => set({ notes: e.target.value })}
          disabled={busy}
          className="text-base"
        />
      </div>

      {!user && sent && (
        <div className="flex flex-col gap-2 rounded-2xl border bg-card p-3">
          <p className="text-sm font-medium">
            Enter the code sent to <span className="tabular">{displayPhone(sent.phone)}</span>
          </p>
          <OtpInput
            key={codeKey}
            length={CODE_LENGTH}
            label="6-digit code"
            autoFocus
            disabled={verifying || submitting}
            invalid={!!codeError}
            describedBy={codeError ? ids.codeError : undefined}
            onChange={setCode}
            onComplete={(value) => {
              if (checkName()) void verify(value);
            }}
          />
          {codeError && (
            <p id={ids.codeError} role="alert" className="text-sm text-[#c4271d]">
              {codeError}
            </p>
          )}
          {sent.demoCode && (
            <p role="status" className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-sm">
              Demo mode: your code is <span className="tabular font-semibold">{sent.demoCode}</span>
            </p>
          )}
          <div className="flex items-center justify-between gap-3 text-sm">
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              disabled={busy}
              onClick={() => {
                setSent(null);
                setCode("");
                setCodeError(null);
                setSecondsLeft(0);
                setTimeout(() => phoneInput.current?.focus(), 0);
              }}
            >
              Change number
            </Button>
            <Button
              type="button"
              variant="link"
              className="tabular h-auto p-0"
              disabled={secondsLeft > 0 || busy}
              onClick={() => void sendCode(sent.phone)}
            >
              {sending ? "Sending…" : secondsLeft > 0 ? `Resend in ${secondsLeft}s` : "Resend code"}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <p role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-[#c4271d]">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={busy || (!!sent && !user && code.length !== CODE_LENGTH)} className="h-11 rounded-full text-[15px]">
        {submitting
          ? "Sending request…"
          : user
            ? "Send request"
            : verifying
              ? "Checking code…"
              : sent
                ? "Verify and send request"
                : sending
                  ? "Sending code…"
                  : "Verify phone to continue"}
      </Button>
      {!user && !sent && <p className="-mt-2 text-center text-xs text-muted-foreground">We will text you a 6-digit code. Your request is sent once it is verified.</p>}
    </form>
  );
}
