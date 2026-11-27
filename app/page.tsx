import { redirect } from "next/navigation";
import { getAuthenticatedStore } from "@/lib/auth/session";
import { getSession } from "@/lib/shopify/session";

export default async function RootPage() {
  // A connected store lands on its dashboard; everyone else lands on a free tool (no login needed).
  redirect((await getAuthenticatedStore()) && (await getSession()) ? "/home" : "/tools/bg-customiser");
}
