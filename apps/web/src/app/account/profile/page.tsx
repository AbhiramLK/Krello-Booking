import { requireUser } from "@/lib/session";
import { ProfileForm } from "./profile-form";

export const dynamic = "force-dynamic";

export const metadata = { title: "Profile" };

/** "+919876543210" → "+91 98765 43210" */
function displayPhone(phone: string): string {
  const local = phone.replace(/^\+91/, "");
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

export default async function ProfilePage() {
  const user = await requireUser("/account/profile");
  return (
    <>
      <h1 className="text-3xl font-semibold tracking-tight">Profile</h1>
      <p className="mt-1 text-muted-foreground">Venues see your name when you send a request.</p>
      <div className="mt-6 rounded-card border bg-card p-5 sm:p-6">
        <ProfileForm initial={{ name: user.name ?? "", email: user.email ?? "" }} phone={displayPhone(user.phone)} />
      </div>
    </>
  );
}
