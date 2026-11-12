import { listCategories } from "@krello/core";
import { getDb } from "@/lib/db";
import { jsonOk, publicHandler } from "@/lib/public-api";

export async function GET() {
  return publicHandler(async () => {
    const categories = await listCategories(getDb());
    return jsonOk({ categories: categories.map((c) => ({ slug: c.slug, name: c.name, description: c.description })) });
  });
}
