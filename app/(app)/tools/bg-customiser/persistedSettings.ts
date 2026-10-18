import type { BackgroundEditorState } from "./backgroundEditorState";
import type { LogoPosition, CanvasShape } from "@/lib/backgroundComposite";

const STORAGE_KEY = "bgCustomiser.settings.v1";

/**
 * Everything from `BackgroundEditorState` except the two fields that can't
 * survive a refresh anyway: `bgImageFile` (an in-memory `File`, not
 * JSON-serializable) and `bgImagePreviewUrl` (a `blob:` object URL, which
 * stops resolving the moment the page that created it unloads). Every
 * other knob — mode, colors, gradient, image fit/zoom/offset,
 * replace-color tolerance — is plain, persistable data.
 */
export type PersistableBackgroundEditorState = Omit<BackgroundEditorState, "bgImageFile" | "bgImagePreviewUrl">;

export interface PersistedBgCustomiserSettings {
  foregroundZoomPercent: number;
  bgStateA: PersistableBackgroundEditorState;
  bgStateB: PersistableBackgroundEditorState;
  logoPosition: LogoPosition;
  logoCustomX: number;
  logoCustomY: number;
  logoSizePercent: number;
  logoMarginPercent: number;
  /** Optional — older persisted settings predate this field; missing means "original" (see backgroundComposite.ts's own default). */
  canvasShape?: CanvasShape;
}

export function toPersistableBackgroundState(state: BackgroundEditorState): PersistableBackgroundEditorState {
  return {
    bgKind: state.bgKind,
    solidColor: state.solidColor,
    gradientType: state.gradientType,
    colorStart: state.colorStart,
    colorEnd: state.colorEnd,
    angleDeg: state.angleDeg,
    radialPosition: state.radialPosition,
    customX: state.customX,
    customY: state.customY,
    imageFit: state.imageFit,
    imageZoomPercent: state.imageZoomPercent,
    imageOffsetX: state.imageOffsetX,
    imageOffsetY: state.imageOffsetY,
    replaceSourceColor: state.replaceSourceColor,
    replaceTargetColor: state.replaceTargetColor,
    replaceTolerance: state.replaceTolerance,
  };
}

/**
 * `localStorage`, not a server-side store — this tool never uploads
 * anything (see the page's own subtitle), so there's no account/session to
 * key settings off of, and nothing server-side to survive a restart in the
 * first place. `localStorage` already survives both a page refresh AND the
 * dev/prod server being stopped and restarted, since it lives entirely in
 * the browser, tied to this origin — which is exactly what was asked for.
 */
export function loadPersistedSettings(): PersistedBgCustomiserSettings | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as PersistedBgCustomiserSettings;
  } catch {
    return null;
  }
}

export function savePersistedSettings(settings: PersistedBgCustomiserSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing / storage disabled / quota exceeded — settings just won't persist this session.
  }
}
