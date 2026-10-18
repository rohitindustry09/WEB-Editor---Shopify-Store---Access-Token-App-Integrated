"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { grantedScopesAction } from "@/app/actions/scopes";

export interface ReportedError {
  id: string;
  /** The raw message from Shopify (or the app). */
  error: string;
  /** Which page reported it, for the list heading. */
  source: string;
  at: number;
}

interface ErrorCenterValue {
  /** Errors currently on screen that have not been dismissed. */
  errors: ReportedError[];
  report: (error: { id: string; error: string; source: string }) => void;
  /** The page that reported it no longer shows it (it navigated away, or the error went). */
  clear: (id: string) => void;
  dismiss: (id: string) => void;
  dismissAll: () => void;
  /** The access scopes the token really has, read once when the first error appears (null until then, or when Shopify can't be asked). */
  grantedScopes: string[] | null;
}

const ErrorCenterContext = createContext<ErrorCenterValue | null>(null);

/**
 * Collects every error the pages report so they live in one place — the "i" button in the top-right
 * corner — instead of banners spread through each page. `report` and `clear` keep a stable identity
 * so a page can call them from an effect without looping.
 */
export function ErrorCenterProvider({ children }: { children: ReactNode }) {
  const [reported, setReported] = useState<ReportedError[]>([]);
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const [grantedScopes, setGrantedScopes] = useState<string[] | null>(null);
  const [scopesRequested, setScopesRequested] = useState(false);

  const report = useCallback((entry: { id: string; error: string; source: string }) => {
    setReported((current) => (current.some((e) => e.id === entry.id) ? current : [...current, { ...entry, at: Date.now() }]));
  }, []);

  const clear = useCallback((id: string) => {
    setReported((current) => current.filter((e) => e.id !== id));
    setDismissed((current) => {
      if (!current.has(id)) return current;
      const next = new Set(current);
      next.delete(id);
      return next;
    });
  }, []);

  const dismiss = useCallback((id: string) => setDismissed((current) => new Set(current).add(id)), []);
  const dismissAll = useCallback(() => setDismissed(new Set(reported.map((e) => e.id))), [reported]);

  // Asked ahead of time, so by the time the panel is opened everything it shows is already known.
  const hasErrors = reported.length > 0;
  useEffect(() => {
    if (!hasErrors || scopesRequested) return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) setScopesRequested(true);
    });
    void grantedScopesAction().then((result) => {
      if (!cancelled) setGrantedScopes(result);
    });
    return () => {
      cancelled = true;
    };
  }, [hasErrors, scopesRequested]);

  const value = useMemo<ErrorCenterValue>(
    () => ({ errors: reported.filter((e) => !dismissed.has(e.id)), report, clear, dismiss, dismissAll, grantedScopes }),
    [reported, dismissed, report, clear, dismiss, dismissAll, grantedScopes],
  );
  return <ErrorCenterContext.Provider value={value}>{children}</ErrorCenterContext.Provider>;
}

/** The error centre, or null outside the app shell (the caller then shows its error inline instead). */
export function useErrorCenter(): ErrorCenterValue | null {
  return useContext(ErrorCenterContext);
}
