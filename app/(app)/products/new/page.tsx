import { NewProductForm } from "./NewProductForm";
import { getCollections } from "@/lib/shopify/collections";

export default async function NewProductPage() {
  let collections: { id: string; title: string }[] = [];
  try {
    const data = await getCollections({ first: 100 });
    collections = data.nodes.map((c) => ({ id: c.id, title: c.title }));
  } catch {
    // Store not connected yet — the form still renders, just without collection options.
  }

  return <NewProductForm collections={collections} />;
}
