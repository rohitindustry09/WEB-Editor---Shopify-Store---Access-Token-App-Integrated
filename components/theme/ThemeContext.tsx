"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useSyncExternalStore, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme-mode";
const DARK_QUERY = "(prefers-color-scheme: dark)";

/** Runs before first paint (see layout.tsx) so a dark user never sees a light flash. */
export const THEME_INIT_SCRIPT = `(function(){try{var m=localStorage.getItem("${THEME_STORAGE_KEY}");var d=m==="dark"||((m!=="light")&&window.matchMedia("${DARK_QUERY}").matches);var r=document.documentElement;r.dataset.theme=d?"dark":"light";r.style.colorScheme=d?"dark":"light";r.dataset.sidebar=localStorage.getItem("shell-collapsed")==="1"?"collapsed":"open";if(d)r.classList.add("p-theme-dark-experimental");}catch(e){}})();`;

interface ThemeContextValue {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Storage can be blocked (private window, site data off) — fall back to the system setting.
  }
  return "system";
}

// The stored mode lives outside React; `storage` covers other tabs, the custom event covers this one.
const MODE_EVENT = "theme-mode-change";
let sessionMode: ThemeMode | null = null;

function subscribeMode(callback: () => void): () => void {
  // Another tab changed the stored choice — it wins over this tab's in-memory copy.
  const onStorage = () => {
    sessionMode = null;
    callback();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(MODE_EVENT, callback);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(MODE_EVENT, callback);
  };
}

const getModeSnapshot = (): ThemeMode => sessionMode ?? readStoredMode();
const getModeServerSnapshot = (): ThemeMode => "system";

function subscribeSystem(callback: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

const getSystemSnapshot = (): boolean => window.matchMedia(DARK_QUERY).matches;
const getSystemServerSnapshot = (): boolean => false;

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const mode = useSyncExternalStore(subscribeMode, getModeSnapshot, getModeServerSnapshot);
  const systemDark = useSyncExternalStore(subscribeSystem, getSystemSnapshot, getSystemServerSnapshot);

  const resolved: ResolvedTheme = mode === "system" ? (systemDark ? "dark" : "light") : mode;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = resolved;
    root.style.colorScheme = resolved;
  }, [resolved]);

  const setMode = useCallback((next: ThemeMode) => {
    sessionMode = next;
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Not persisted — the choice still applies for this session.
    }
    window.dispatchEvent(new Event(MODE_EVENT));
  }, []);

  const value = useMemo(() => ({ mode, resolved, setMode }), [mode, resolved, setMode]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useThemeMode(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) throw new Error("useThemeMode must be used inside ThemeModeProvider");
  return context;
}
