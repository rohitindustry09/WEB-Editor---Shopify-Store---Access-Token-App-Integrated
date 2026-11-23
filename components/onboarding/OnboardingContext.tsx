"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { requiredCapabilityIds } from "@/lib/scopes";

interface OnboardingState {
  storeName: string;
  capabilityIds: string[];
}

interface OnboardingContextValue extends OnboardingState {
  /** True when this server has the Shopify app's credentials, so "Connect with Shopify" can work. */
  oauthReady: boolean;
  setStoreName: (value: string) => void;
  toggleCapability: (id: string) => void;
}

const DEFAULT_STATE: OnboardingState = {
  storeName: "",
  capabilityIds: requiredCapabilityIds,
};

const STORAGE_KEY = "brasstown-onboarding";

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function OnboardingProvider({ children, oauthReady = false }: { children: ReactNode; oauthReady?: boolean }) {
  const [state, setState] = useState<OnboardingState>(DEFAULT_STATE);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    // Guards the `getItem` call itself, not just `JSON.parse` — on an
    // insecure, non-localhost origin (e.g. loading the app over plain HTTP
    // via a LAN IP from another device) some browsers throw a SecurityError
    // on any localStorage access at all. Left unguarded, that throw happens
    // inside this effect with no error boundary above it, which silently
    // breaks further state updates for the whole provider — the store-name
    // field keeps showing whatever was typed (native input behavior), but
    // nothing downstream (like the Continue button) ever re-evaluates.
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) {
        // One-time hydration from localStorage on mount, not a derived-state
        // update — SSR has no access to localStorage, so this can't be a lazy
        // useState initializer without causing a hydration mismatch.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setState(JSON.parse(raw) as OnboardingState);
      }
    } catch {
      // storage blocked or malformed — just start from the default state
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // storage full or disabled — state just won't persist across reloads
    }
  }, [state, hydrated]);

  const setStoreName = (value: string) =>
    setState((prev) => ({ ...prev, storeName: value }));

  const toggleCapability = (id: string) =>
    setState((prev) => {
      if (requiredCapabilityIds.includes(id)) return prev;
      const has = prev.capabilityIds.includes(id);
      return {
        ...prev,
        capabilityIds: has
          ? prev.capabilityIds.filter((c) => c !== id)
          : [...prev.capabilityIds, id],
      };
    });

  return (
    <OnboardingContext.Provider value={{ ...state, oauthReady, setStoreName, toggleCapability }}>
      {children}
    </OnboardingContext.Provider>
  );
}

export function useOnboarding(): OnboardingContextValue {
  const ctx = useContext(OnboardingContext);
  if (!ctx) throw new Error("useOnboarding must be used within OnboardingProvider");
  return ctx;
}
