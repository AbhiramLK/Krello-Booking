import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BusinessView } from "@/components/marketplace/business-view";
import { businessMetadata, businessPath, loadPublicBusiness } from "@/lib/public-business";

type Props = { params: Promise<{ businessSlug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const business = await loadPublicBusiness((await params).businessSlug);
  const location = business?.locations[0];
  if (!business || !location) return { title: "Not found" };
  return businessMetadata(business, location, businessPath(business));
}

export default async function BusinessPage({ params }: Props) {
  const business = await loadPublicBusiness((await params).businessSlug);
  const location = business?.locations[0];
  if (!business || !location) notFound();
  return <BusinessView business={business} location={location} path={businessPath(business)} />;
}
