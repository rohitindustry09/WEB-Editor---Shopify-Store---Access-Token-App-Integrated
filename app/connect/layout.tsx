import { OnboardingProvider } from "@/components/onboarding/OnboardingContext";
import { WizardShell } from "@/components/onboarding/WizardShell";
import { getAuthenticatedStore } from "@/lib/auth/session";

export default async function ConnectLayout({ children }: { children: React.ReactNode }) {
  // Open to everyone: this wizard is where you sign in. If a store is already connected its name is shown
  // (with Sign out) so reconnecting with a new key is just another pass through the steps.
  const storeName = await getAuthenticatedStore();

  return (
    <OnboardingProvider>
      <WizardShell storeName={storeName ?? undefined}>{children}</WizardShell>
    </OnboardingProvider>
  );
}
