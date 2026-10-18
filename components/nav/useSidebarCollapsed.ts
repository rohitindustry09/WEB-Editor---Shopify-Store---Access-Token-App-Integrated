import { useCallback, useSyncExternalStore } from "react";

export const SIDEBAR_STORAGE_KEY = "shell-collapsed";
const CHANGE_EVENT = "shell-sidebar-change";

/** The collapsed / open state lives on <html data-sidebar>, set before first paint by the init script in the root layout (so a collapsed sidebar never flashes open). */
function read(): "collapsed" | "open" {
  return document.documentElement.dataset.sidebar === "collapsed" ? "collapsed" : "open";
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  return () => window.removeEventListener(CHANGE_EVENT, listener);
}

/** Whether the sidebar is collapsed to its icon rail, and a function to flip it (remembered in this browser). */
export function useSidebarCollapsed(): [boolean, () => void] {
  const state = useSyncExternalStore(subscribe, read, () => "open" as const);
  const toggle = useCallback(() => {
    const next = read() === "collapsed" ? "open" : "collapsed";
    document.documentElement.dataset.sidebar = next;
    try {
      window.localStorage.setItem(SIDEBAR_STORAGE_KEY, next === "collapsed" ? "1" : "0");
    } catch {
      // storage blocked — the choice still holds until the page is reloaded
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [state === "collapsed", toggle];
}
