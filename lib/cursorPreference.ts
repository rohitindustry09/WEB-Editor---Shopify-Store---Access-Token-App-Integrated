import { useCallback, useSyncExternalStore } from "react";

const STORAGE_KEY = "cursor-fx";
const CHANGE_EVENT = "cursor-fx-change";

/** The circle cursor is on unless the visitor switched it off (remembered in this browser). */
function read(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function subscribe(listener: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(CHANGE_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}

export function useCursorEnabled(): [boolean, (enabled: boolean) => void] {
  const enabled = useSyncExternalStore(subscribe, read, () => true);
  const set = useCallback((next: boolean) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
    } catch {
      // storage blocked — the choice holds until the page reloads
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);
  return [enabled, set];
}
