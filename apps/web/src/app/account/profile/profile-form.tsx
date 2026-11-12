"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "../actions";

interface Props {
  initial: { name: string; email: string };
  /** Display form of the verified sign-in number. */
  phone: string;
}

export function ProfileForm({ initial, phone }: Props) {
  const router = useRouter();
  const nameId = useId();
  const nameErrorId = useId();
  const emailId = useId();
  const emailErrorId = useId();
  const phoneId = useId();
  const phoneHelpId = useId();
  const nameInput = useRef<HTMLInputElement>(null);
  const emailInput = useRef<HTMLInputElement>(null);

  const [name, setName] = useState(initial.name);
  const [email, setEmail] = useState(initial.email);
  const [saved, setSaved] = useState(initial);
  const [nameError, setNameError] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  const dirty = name !== saved.name || email !== saved.email;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setNameError(null);
    setEmailError(null);
    setFormError(null);
    setJustSaved(false);
    if (!name.trim()) {
      setNameError("Enter your name.");
      nameInput.current?.focus();
      return;
    }
    setSaving(true);
    try {
      const result = await updateProfileAction({ name, email });
      if (!result.ok) {
        // The server's message says which field it is about.
        if (/email/i.test(result.message)) {
          setEmailError(result.message);
          emailInput.current?.focus();
        } else if (/name/i.test(result.message)) {
          setNameError(result.message);
          nameInput.current?.focus();
        } else {
          setFormError(result.message);
        }
        return;
      }
      const next = { name: result.data.name, email: result.data.email ?? "" };
      setName(next.name);
      setEmail(next.email);
      setSaved(next);
      setJustSaved(true);
      toast.success("Profile saved");
      // The header shows the name too.
      router.refresh();
    } catch {
      setFormError("We could not reach the server. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor={nameId}>Name</Label>
        <Input
          id={nameId}
          ref={nameInput}
          name="name"
          autoComplete="name"
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={saving}
          aria-required="true"
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? nameErrorId : undefined}
          className="h-11 text-base"
        />
        <p id={nameErrorId} role="alert" className="min-h-5 text-sm text-destructive">
          {nameError}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={emailId}>
          Email <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Input
          id={emailId}
          ref={emailInput}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={saving}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? emailErrorId : undefined}
          className="h-11 text-base"
        />
        <p id={emailErrorId} role="alert" className="min-h-5 text-sm text-destructive">
          {emailError}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={phoneId}>Mobile number</Label>
        <Input id={phoneId} value={phone} readOnly aria-describedby={phoneHelpId} className="tabular h-11 bg-muted text-base" />
        <p id={phoneHelpId} className="text-sm text-muted-foreground">
          This is the number you sign in with. It is verified, so it cannot be changed here.
        </p>
      </div>

      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" size="lg" disabled={saving || !dirty} className="h-11 rounded-full">
          {saving ? "Saving…" : "Save changes"}
        </Button>
        {justSaved && !dirty && !saving && (
          <p role="status" className="text-sm text-muted-foreground">
            Your changes are saved.
          </p>
        )}
      </div>
    </form>
  );
}
