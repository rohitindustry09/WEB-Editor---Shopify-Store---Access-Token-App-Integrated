import { redirect } from "next/navigation";
import { LoginRequiredNotice } from "@/components/nav/LoginGate";
import { getAuthenticatedStore } from "@/lib/auth/session";

/** What the proxy shows (at the address that was asked for) when a page needs a Shopify store and nobody is logged in. */
export default async function LoginRequiredPage() {
  if (await getAuthenticatedStore()) redirect("/home");
  return <LoginRequiredNotice />;
}
