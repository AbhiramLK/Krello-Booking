import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BusinessView } from "@/components/marketplace/business-view";
import { businessMetadata, businessPath, loadPublicBusiness } from "@/lib/public-business";

type Props = { params: Promise<{ businessSlug: string; locationSlug: string }> };

async function load({ params }: Props) {
  const { businessSlug, locationSlug } = await params;
  const business = await loadPublicBusiness(businessSlug);
  const location = business?.locations.find((l) => l.slug === locationSlug);
  return { business, location };
}

export async function generateMetadata(props: Props): Promise<Metadata> {
  const { business, location } = await load(props);
  if (!business || !location) return { title: "Not found" };
  // Canonical points at this location's own address, not the venue's main page.
  return businessMetadata(business, location, businessPath(business, location));
}

export default async function BusinessLocationPage(props: Props) {
  const { business, location } = await load(props);
  if (!business || !location) notFound();
  return <BusinessView business={business} location={location} path={businessPath(business, location)} />;
}
