import { NextResponse } from "next/server";
import { listMemberships, maskPhone } from "@krello/core";
import { getDb } from "@/lib/db";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" };

/** Who is signed in, for client code that needs to know. Never returns the full phone number. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ user: null }, { headers: HEADERS });
  const memberships = await listMemberships(getDb(), user.id);
  return NextResponse.json(
    {
      user: {
        id: user.id,
        name: user.name,
        phone: maskPhone(user.phone),
        isBusinessMember: memberships.length > 0,
      },
    },
    { headers: HEADERS },
  );
}
