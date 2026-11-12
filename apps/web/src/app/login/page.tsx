import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { listMemberships } from "@krello/core";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { safeNextPath } from "@/lib/safe-next";
import { getCurrentUser } from "@/lib/session";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNextPath((await searchParams).next);

  // Signed in already, or just signed in: this page is also where the form sends people on.
  const user = await getCurrentUser();
  if (user) {
    if (next) redirect(next);
    const memberships = await listMemberships(getDb(), user.id);
    redirect(memberships.length > 0 ? "/dashboard" : "/account");
  }

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-12 sm:px-6">
        <Card>
          <CardHeader>
            <h1 className="text-2xl font-semibold tracking-tight">Sign in</h1>
            <CardDescription>Use your mobile number to book, or to manage your venue.</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm next={next} />
          </CardContent>
        </Card>
      </main>
      <SiteFooter />
    </>
  );
}
