import { redirect } from "next/navigation";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { BgCustomiserGridPage } from "./BgCustomiserGridPage";

/**
 * Deliberately OUTSIDE the `(app)` route group, same reasoning as
 * `store-scraper-preview/[id]`: a bare, single-purpose page with no
 * dashboard chrome. Unlike that one, there's no job id and no server data to
 * load here — the zip this page needs to read only ever exists as a `File`
 * in whichever tab opened this one, reached live via `window.opener` (see
 * `gridBridge.ts`). This route's only server-side job is the same auth gate
 * every other page in the app has.
 */
export default async function BgCustomiserGridRoute() {
  const store = await getAuthenticatedStore();
  if (!store) redirect("/connect");

  return <BgCustomiserGridPage />;
}
