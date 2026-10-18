"use client";

import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import {
  Page,
  Layout,
  Card,
  Box,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Badge,
  Button,
  Banner,
  DropZone,
  Icon,
  ProgressBar,
  Divider,
  Checkbox,
  RangeSlider,
  TextField,
  Spinner,
  Collapsible,
  Modal,
  Tooltip,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import {
  PaintBrushFlatIcon,
  ExportIcon,
  DeleteIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ImageIcon,
  EyeDropperIcon,
  QuestionCircleIcon,
  InfoIcon,
  ClockIcon,
  RefreshIcon,
  SearchIcon,
  ViewIcon,
  FolderIcon,
} from "@shopify/polaris-icons";
import {
  loadSkuMediaZip,
  readZipImage,
  isImageFilename,
  type SkuMediaFolder,
  type StreamingZipHandle,
} from "@/lib/skuMediaZip";
import {
  compositeBackground,
  hasTransparency,
  samplePixelColor,
  createPreviewProxy,
  type LogoOverlay,
  type LogoPosition,
  type CanvasShape,
  type TextOverlay,
  type AverageColor,
  averageColorDistance,
} from "@/lib/backgroundComposite";
import { mapWithConcurrency } from "@/lib/concurrency";
import { BackgroundModeEditor } from "./BackgroundModeEditor";
import { BeforeAfterSlider } from "./BeforeAfterSlider";
import { publishGridBridge } from "./gridBridge";
import { ZoomControl, ZOOM_DEFAULT } from "./ZoomControl";
import { LOGO_POSITIONS } from "./logoPositions";
import { ColorSwatchPicker } from "./ColorSwatchPicker";
import {
  createDefaultBackgroundEditorState,
  effectiveBgKindFor,
  backgroundConfigFor,
  type BackgroundEditorState,
} from "./backgroundEditorState";
import { loadPersistedSettings, savePersistedSettings, toPersistableBackgroundState } from "./persistedSettings";
import { computeZipSignature } from "./zipSignature";
import { getJobMeta, saveJobMeta, saveResult, loadSavedResults, clearJob, type JobMeta } from "./progressStore";
import { runCompositeWorkerPool, getDefaultWorkerCount, MAX_WORKERS } from "./workerPool";
import { ServerSaveQueue, uploadImageToServer } from "./serverSaveQueue";
import type { CompositeWorkerJob } from "./compositeWorker";
import { MediaConversionSettings, DEFAULT_CONVERSION_STATE, FORMAT_OPTIONS, type ConversionUiState } from "@/components/products/MediaConversionSettings";
import { toConversionSettings, conversionTag, type ConvertTo, type WorkerConversion } from "@/lib/conversionSettings";

// A safety cap on how large a single folder's position range can be —
// each file's "shot number" is just its 1-based position within its own
// (natural-sorted) folder now, not anything parsed from its filename, so
// this only ever matters for a genuinely anomalous folder holding an
// enormous number of files. Also guards `availableIndices` (see its own
// comment) against a dense-array blowup in whatever consumes it.
const MAX_RENDERABLE_INDEX = 999;

/** The folder list only renders this many rows up front — a store's worth of SKU folders (thousands) all mounted at once is what actually made the page heavy, not the data itself. The rest render only once "View more" is clicked. */
const FOLDER_PREVIEW_COUNT = 10;

type FileStatus = "skipped" | "queued" | "processing" | "done" | "error";

interface FileEntry {
  path: string;
  folder: string;
  filename: string;
  index: number | null;
  status: FileStatus;
  resultBlob?: Blob;
  /** Final filename of `resultBlob` when it went through format conversion (new extension / rename pattern); unset for the legacy "PNG named after the source" case. */
  outputFilename?: string;
  /** Fingerprint of the conversion settings `resultBlob` was produced under — a result is only reused when it matches the settings chosen now. Unset = no conversion. */
  convertTag?: string;
  error?: string;
  /** Which column / job type this image was in when it failed ("Column A", "Column B", ...), shown beside its error. */
  columnLabel?: string;
}

interface ZipData {
  zip: StreamingZipHandle;
  folders: SkuMediaFolder[];
}

/** Triggers a real browser download from a server URL (`Content-Disposition: attachment`) — used instead of building a `Blob` client-side, see `export-zip/route.ts`'s own note on why. */
function triggerUrlDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/** Composited output is always PNG (see backgroundComposite.ts) — the filename follows along so a downloaded ".jpg" never actually contains JPEG bytes. */
function outputPathFor(path: string): string {
  return path.replace(/\.[a-zA-Z0-9]+$/, ".png");
}

/** One flagged image — which shot-number column's background it got, and where it lives, so it can actually be found and re-checked. */
interface OutlierResult {
  path: string;
  filename: string;
  column: "A" | "B";
  folder: string;
  shot: number | null;
}

/** One image that couldn't be processed, with the column its job belonged to. */
interface FailedResult {
  path: string;
  filename: string;
  columnLabel: string;
  folder: string;
  shot: number | null;
  message: string;
}

/** Column A / Column B are the two shot-number groups that get a background; anything else is a zoom/logo-only or convert-only job with no column. */
function columnLabelFor(mode: CompositeWorkerJob["mode"] | undefined): string {
  if (mode === "primary") return "Column A";
  if (mode === "secondary") return "Column B";
  if (mode === "convert-only") return "No column (convert only)";
  return "No column (zoom / logo)";
}

const STATUS_ICON: Partial<Record<FileStatus, { source: typeof CheckCircleIcon; tone: "success" | "critical" }>> = {
  done: { source: CheckCircleIcon, tone: "success" },
  error: { source: AlertCircleIcon, tone: "critical" },
};

// 1 through MAX_WORKERS (8) — the worker-count picker's own option list.
const WORKER_COUNT_OPTIONS = Array.from({ length: MAX_WORKERS }, (_, i) => {
  const count = i + 1;
  return { value: String(count), label: `${count} worker${count === 1 ? "" : "s"}` };
});

// "Leave as it is" first, then the same formats the Media Format Converter offers.
const CONVERT_TO_OPTIONS = [{ label: "Leave as it is (no conversion)", value: "leave" }, ...FORMAT_OPTIONS];

export function BgCustomiserForm() {
  // ---- Zip / folder state ----
  const [zipData, setZipData] = useState<ZipData | null>(null);
  const [files, setFiles] = useState<Map<string, FileEntry>>(new Map());
  const [loadingZip, setLoadingZip] = useState(false);
  const [zipError, setZipError] = useState<string | null>(null);
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());
  const [folderSearch, setFolderSearch] = useState("");
  const [howItWorksOpen, setHowItWorksOpen] = useState(false);
  // Identifies "this same zip" across a refresh/restart — see
  // zipSignature.ts. `savedProgress` is only set when a previous run's
  // progress was found in IndexedDB for the zip just added; resuming or
  // discarding it clears this back to null.
  const [zipSignature, setZipSignature] = useState<string | null>(null);
  const [savedProgress, setSavedProgress] = useState<{ doneCount: number; totalCount: number } | null>(null);
  const [resumingProgress, setResumingProgress] = useState(false);
  // The zip's own filename (minus ".zip") — used as the site folder under
  // uploads/background-customiser/<site>/<SKU>/... so every processed
  // image lands on local disk as it's produced, the same way the store
  // scraper's own uploads/<site>/ folder works.
  const [siteFolderName, setSiteFolderName] = useState<string>("site");
  const [serverSaveProgress, setServerSaveProgress] = useState<{ done: number; total: number } | null>(null);
  // Folder rows past FOLDER_PREVIEW_COUNT stay unmounted until this flips —
  // deliberately not eager, since a big store's folder list is the one
  // part of this page whose size scales with the zip instead of staying
  // constant.
  const [foldersRevealed, setFoldersRevealed] = useState(false);

  // ---- Index selection ----
  const [selectedIndices, setSelectedIndices] = useState<Set<number>>(new Set());
  // Per-folder manual correction for Column A: SKU -> the one file path to
  // actually use for that folder, overriding whatever the automatic
  // shot-number match would have picked (or not picked) for it. Neither
  // automatic approach this tool has tried — parsing a number out of the
  // filename, or falling back to each image's position within its folder —
  // can be made reliable against inconsistent upload-pipeline naming, so
  // this is the escape hatch: eyeball each folder in the grid view and pick
  // the exact right image. A folder with no entry here just uses the normal
  // shot-number selection, unaffected.
  const [manualOverridesA, setManualOverridesA] = useState<Map<string, string>>(new Map());
  const [gridPopupBlocked, setGridPopupBlocked] = useState(false);
  const gridBridgeListenersRef = useRef<Set<(paths: Set<string>) => void>>(new Set());

  // ---- Background config — one fully independent state object per
  // column, see backgroundEditorState.ts. ----
  const [bgStateA, setBgStateA] = useState<BackgroundEditorState>(createDefaultBackgroundEditorState);
  const [bgStateB, setBgStateB] = useState<BackgroundEditorState>(createDefaultBackgroundEditorState);
  const patchBgStateA = (patch: Partial<BackgroundEditorState>) => setBgStateA((prev) => ({ ...prev, ...patch }));
  const patchBgStateB = (patch: Partial<BackgroundEditorState>) => setBgStateB((prev) => ({ ...prev, ...patch }));

  // ---- Foreground zoom (resizes the product photo itself, revealing a margin evenly around it in every mode — see compositeBackground) ----
  const [foregroundZoomPercent, setForegroundZoomPercent] = useState(ZOOM_DEFAULT);

  // ---- Canvas shape — "square" pads a non-square photo to a square canvas instead of cropping; applies to every image, same scope as zoom/logo. ----
  const [canvasShape, setCanvasShape] = useState<CanvasShape>("original");

  // ---- Logo overlay (stamped on top of every processed image, regardless of background mode) ----
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(null);
  const [logoPosition, setLogoPosition] = useState<LogoPosition>("bottom-right");
  const [logoCustomX, setLogoCustomX] = useState(50);
  const [logoCustomY, setLogoCustomY] = useState(50);
  const [logoSizePercent, setLogoSizePercent] = useState(20);
  const [logoMarginPercent, setLogoMarginPercent] = useState(4);

  // ---- Text overlay (a second, independent stamp — "New", a price tag — layered on top of the logo, same global scope) ----
  const [textOverlayEnabled, setTextOverlayEnabled] = useState(false);
  const [textOverlayText, setTextOverlayText] = useState("");
  const [textOverlayPosition, setTextOverlayPosition] = useState<LogoPosition>("top-left");
  const [textOverlayCustomX, setTextOverlayCustomX] = useState(50);
  const [textOverlayCustomY, setTextOverlayCustomY] = useState(50);
  const [textOverlaySizePercent, setTextOverlaySizePercent] = useState(6);
  const [textOverlayMarginPercent, setTextOverlayMarginPercent] = useState(4);
  const [textOverlayColor, setTextOverlayColor] = useState("#ffffff");
  const [textOverlayHasBackground, setTextOverlayHasBackground] = useState(true);
  const [textOverlayBackgroundColor, setTextOverlayBackgroundColor] = useState("#000000");

  // Restores every setting/style knob from localStorage once, on mount —
  // this tool touches nothing server-side (see the page's own subtitle),
  // so `localStorage` is what actually survives both a plain refresh AND
  // the dev/prod server being stopped and restarted; either one leaves the
  // browser's own storage untouched. The two uploaded files (background
  // image, logo) can't be restored this way — a `File` isn't
  // JSON-serializable — so those come back empty and need re-adding, but
  // every other setting (colors, gradient, mode, tolerance, zoom, logo
  // position/size/margin) comes back exactly as it was left.
  useEffect(() => {
    const persisted = loadPersistedSettings();
    if (!persisted) return;
    const timer = setTimeout(() => {
      setForegroundZoomPercent(persisted.foregroundZoomPercent);
      if (persisted.canvasShape) setCanvasShape(persisted.canvasShape);
      setBgStateA((prev) => ({ ...prev, ...persisted.bgStateA }));
      setBgStateB((prev) => ({ ...prev, ...persisted.bgStateB }));
      setLogoPosition(persisted.logoPosition);
      setLogoCustomX(persisted.logoCustomX);
      setLogoCustomY(persisted.logoCustomY);
      setLogoSizePercent(persisted.logoSizePercent);
      setLogoMarginPercent(persisted.logoMarginPercent);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  // Persists the same settings back to localStorage whenever any of them
  // change — debounced, since dragging a slider can fire many updates a
  // second and there's no reason to hit storage on every single tick.
  useEffect(() => {
    const timer = setTimeout(() => {
      savePersistedSettings({
        foregroundZoomPercent,
        canvasShape,
        bgStateA: toPersistableBackgroundState(bgStateA),
        bgStateB: toPersistableBackgroundState(bgStateB),
        logoPosition,
        logoCustomX,
        logoCustomY,
        logoSizePercent,
        logoMarginPercent,
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [foregroundZoomPercent, canvasShape, bgStateA, bgStateB, logoPosition, logoCustomX, logoCustomY, logoSizePercent, logoMarginPercent]);

  // ---- Column B's own shot-number selection — mutually exclusive with
  // Column A's (see toggleIndex/toggleSecondaryIndex). Column B has its
  // own full BackgroundEditorState (bgStateB above), completely
  // independent of Column A's — a shot number checked here gets whichever
  // mode bgStateB is set to, regardless of what Column A is set to.
  // Anything in neither column gets zoom/logo only, same as before. ----
  const [secondaryIndices, setSecondaryIndices] = useState<Set<number>>(new Set());
  const [secondaryPreviewUrl, setSecondaryPreviewUrl] = useState<string | null>(null);
  const [secondaryPreviewLoading, setSecondaryPreviewLoading] = useState(false);

  // Whether the current preview sample has any transparency at all — null
  // while unknown/checking. Gates which background modes make sense: the
  // color/gradient/image modes composite a layer BEHIND the foreground, so
  // they're invisible on an opaque photo; replace-color edits pixels in
  // place, so it only makes sense on an opaque photo (nothing to "replace"
  // on a transparent one).
  const [sampleTransparent, setSampleTransparent] = useState<boolean | null>(null);
  const [rawSampleBlob, setRawSampleBlob] = useState<Blob | null>(null);
  const [rawSampleUrl, setRawSampleUrl] = useState<string | null>(null);
  // Side-by-side (default, keeps the eyedropper clickable) vs. a drag-to-
  // reveal comparison — one flag per column since they preview independently.
  const [compareModeA, setCompareModeA] = useState(false);
  const [compareModeB, setCompareModeB] = useState(false);
  // A downscaled (~480px) copy of the sample, built once per sample change
  // and reused for every live-preview recomposite — see createPreviewProxy
  // for why this matters (it's the actual fix for the lag/freeze reported
  // when dragging sliders: recompositing a full-resolution photo on every
  // tick was the whole problem).
  const [previewSampleBlob, setPreviewSampleBlob] = useState<Blob | null>(null);

  // ---- Processing ----
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState<string | null>(null);
  // How many Web Workers to spawn for the next run — see workerPool.ts.
  // Starts at a fixed, SSR-safe 4 and is corrected to this device's own
  // core count right after mount (`navigator` doesn't exist during server
  // rendering, and reading it during the initial client render too would
  // make the very first client render disagree with the server-rendered
  // HTML — a hydration mismatch).
  const [workerCount, setWorkerCount] = useState(4);
  useEffect(() => {
    const timer = setTimeout(() => setWorkerCount(getDefaultWorkerCount()), 0);
    return () => clearTimeout(timer);
  }, []);
  // "Convert to" — a required choice whose default, "Leave as it is", keeps
  // today's behavior exactly. Anything else converts every image in the
  // exported zip (edited ones right after compositing, untouched ones
  // directly) inside the SAME worker pool, so it uses however many workers
  // are selected above rather than adding a slow second pass.
  const [convertTo, setConvertTo] = useState<ConvertTo>("leave");
  const [conversionUi, setConversionUi] = useState<ConversionUiState>(DEFAULT_CONVERSION_STATE);
  const conversion = useMemo<WorkerConversion | undefined>(
    () => (convertTo === "leave" ? undefined : { settings: toConversionSettings(conversionUi, convertTo), renamePattern: conversionUi.renamePattern }),
    [convertTo, conversionUi],
  );
  const conversionKey = conversion ? conversionTag(conversion.settings, conversion.renamePattern) : "none";
  // Converted output lives in its own folder per conversion setup (so a zip never mixes formats from different runs); "leave" keeps the original folder.
  const outputSite = conversion ? `${siteFolderName}__${conversionKey}` : siteFolderName;
  const convertToLabel = CONVERT_TO_OPTIONS.find((o) => o.value === convertTo)?.label ?? "";
  const [zipping, setZipping] = useState(false);
  const [lastDownload, setLastDownload] = useState<{ url: string; filename: string; count: number } | null>(null);
  // A background-swap batch should end up with every result's background
  // color landing roughly the same — these are the ones that didn't, worth
  // a second look (a wrong column applied, a logo/zoom overlap, a source
  // photo whose backdrop wasn't actually plain). Informational only, never
  // blocks or excludes anything from the export.
  const [outlierResults, setOutlierResults] = useState<OutlierResult[]>([]);
  const [failedResults, setFailedResults] = useState<FailedResult[]>([]);
  const cancelledRef = useRef(false);
  // Set for the duration of a `processAll` run — lets `cancelProcessing`
  // reach into the currently-running worker pool without processAll
  // needing to return anything to the click handler that started it.
  const activePoolCancelRef = useRef<(() => void) | null>(null);
  // Separate from `cancelledRef` — that one stops the compositing pass;
  // this one stops `saveAllFilesToServer`'s upload traversal, which can
  // keep running well after compositing itself has finished and has its
  // own Cancel button for exactly that stretch.
  const zipCancelledRef = useRef(false);
  // Buffers `updateFile` patches instead of calling `setFiles` once per
  // image — with several thousand images and up to 8 workers reporting
  // results in a burst, one `setFiles` (and the full-Map clone + re-render
  // it triggers) per single result was enough rapid-fire React state
  // updates to trip React's own runaway-update guard ("Maximum update
  // depth exceeded"). Flushed on a short timer instead — see
  // `queueFileUpdate`/`flushFileUpdates` below.
  const pendingFileUpdatesRef = useRef<Map<string, Partial<FileEntry>>>(new Map());
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  // ---- Live preview ----
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  const objectUrlsRef = useRef<Set<string>>(new Set());
  const trackUrl = (url: string) => {
    objectUrlsRef.current.add(url);
    return url;
  };
  useEffect(() => {
    const urls = objectUrlsRef.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
    };
  }, []);

  // The mode actually used for rendering and compositing: `bgKind` itself
  // is just the user's last explicit click, which can go stale the moment
  // the sample image (and therefore its transparency) changes underneath
  // it — color/gradient/image modes are meaningless on an opaque photo
  // (see backgroundComposite.ts), and replace-color is meaningless on a
  // transparent one. This is derived during render rather than "corrected"
  // via a setState-in-effect, so there's no extra render pass and no risk
  // of fighting the user's own next click.
  const effectiveBgKind = useMemo(() => effectiveBgKindFor(bgStateA.bgKind, sampleTransparent), [bgStateA.bgKind, sampleTransparent]);
  const effectiveSecondaryBgKind = useMemo(() => effectiveBgKindFor(bgStateB.bgKind, sampleTransparent), [bgStateB.bgKind, sampleTransparent]);

  const backgroundConfig = useMemo(() => backgroundConfigFor(bgStateA, effectiveBgKind), [bgStateA, effectiveBgKind]);
  const secondaryBackgroundConfig = useMemo(() => backgroundConfigFor(bgStateB, effectiveSecondaryBgKind), [bgStateB, effectiveSecondaryBgKind]);

  const foregroundZoom = useMemo(
    () => ({ zoomPercent: foregroundZoomPercent }),
    [foregroundZoomPercent],
  );

  const logoOverlay: LogoOverlay | undefined = useMemo(() => {
    if (!logoFile) return undefined;
    return {
      image: logoFile,
      position: logoPosition,
      customXPercent: logoCustomX,
      customYPercent: logoCustomY,
      sizePercent: logoSizePercent,
      marginPercent: logoMarginPercent,
    };
  }, [logoFile, logoPosition, logoCustomX, logoCustomY, logoSizePercent, logoMarginPercent]);

  const textOverlay: TextOverlay | undefined = useMemo(() => {
    if (!textOverlayEnabled || !textOverlayText.trim()) return undefined;
    return {
      text: textOverlayText,
      position: textOverlayPosition,
      customXPercent: textOverlayCustomX,
      customYPercent: textOverlayCustomY,
      sizePercent: textOverlaySizePercent,
      marginPercent: textOverlayMarginPercent,
      color: textOverlayColor,
      backgroundColor: textOverlayHasBackground ? textOverlayBackgroundColor : undefined,
    };
  }, [
    textOverlayEnabled,
    textOverlayText,
    textOverlayPosition,
    textOverlayCustomX,
    textOverlayCustomY,
    textOverlaySizePercent,
    textOverlayMarginPercent,
    textOverlayColor,
    textOverlayHasBackground,
    textOverlayBackgroundColor,
  ]);

  // The actual distinct shot numbers found across the zip, sorted — NOT a
  // dense 1..max range. A dense range meant a single mis-parsed filename
  // anywhere in a large store (one stray "154" from a heuristic that isn't
  // perfect) silently inflated the WHOLE checkbox grid to that size, even
  // though only one real number was ever that high. Showing only numbers
  // that actually occur keeps the list the size it should be, and turns
  // any future bad parse into an obvious isolated outlier in the list
  // instead of an invisible explosion of the whole range.
  const availableIndices = useMemo(() => {
    const indices = new Set<number>();
    for (const entry of files.values()) {
      if (entry.index !== null && entry.index <= MAX_RENDERABLE_INDEX) indices.add(entry.index);
    }
    return Array.from(indices).sort((a, b) => a - b);
  }, [files]);

  // A representative foreground image for the live preview: prefer the
  // first file that's actually selected right now, so the preview always
  // shows something the user is about to change — falling back to just the
  // first image in the zip when nothing's selected yet.
  const previewSourcePath = useMemo(() => {
    let fallback: string | null = null;
    for (const entry of files.values()) {
      if (fallback === null) fallback = entry.path;
      if (entry.index !== null && selectedIndices.has(entry.index)) return entry.path;
    }
    return fallback;
  }, [files, selectedIndices]);

  // Checks the current sample image for transparency once, whenever the
  // sample itself changes — deliberately NOT re-run when the background
  // config changes (unlike the preview effect below), since the photo's
  // own transparency has nothing to do with what background is selected.
  // Also captures the raw (unmodified) blob/URL for the eyedropper below.
  useEffect(() => {
    let ignore = false;
    (async () => {
      if (!zipData || !previewSourcePath) {
        if (!ignore) {
          setSampleTransparent(null);
          setRawSampleBlob(null);
          setRawSampleUrl(null);
          setPreviewSampleBlob(null);
        }
        return;
      }
      try {
        const source = await readZipImage(zipData.zip, previewSourcePath);
        if (!source || ignore) return;
        const [transparent, proxy] = await Promise.all([
          hasTransparency(source.blob),
          createPreviewProxy(source.blob),
        ]);
        if (ignore) return;
        setSampleTransparent(transparent);
        setRawSampleBlob(source.blob);
        setRawSampleUrl(trackUrl(URL.createObjectURL(source.blob)));
        setPreviewSampleBlob(proxy);
      } catch {
        if (!ignore) setSampleTransparent(null);
      }
    })();
    return () => {
      ignore = true;
    };
  }, [zipData, previewSourcePath]);

  // Recomputes the live preview whenever the background config or the
  // chosen sample image changes — against `previewSampleBlob` (a small,
  // already-decoded proxy built once per sample, see its own comment
  // above), never the full-resolution original. Also debounced: a
  // RangeSlider fires `onChange` on every pointermove during a drag, so
  // without this, a single drag gesture could trigger dozens of
  // recomposites a second even against the small proxy. `ignore` still
  // guards the (now rare) case of a stale pass finishing after a newer one
  // started.
  useEffect(() => {
    let ignore = false;
    const debounce = setTimeout(() => {
      (async () => {
        if (!previewSampleBlob || (effectiveBgKind === "image" && !bgStateA.bgImageFile)) {
          if (!ignore) setPreviewUrl(null);
          return;
        }
        if (!ignore) setPreviewLoading(true);
        try {
          const result = await compositeBackground(previewSampleBlob, backgroundConfig, foregroundZoom, logoOverlay, canvasShape, textOverlay);
          if (ignore) return;
          setPreviewUrl(trackUrl(URL.createObjectURL(result)));
        } catch {
          if (!ignore) setPreviewUrl(null);
        } finally {
          if (!ignore) setPreviewLoading(false);
        }
      })();
    }, 120);

    return () => {
      ignore = true;
      clearTimeout(debounce);
    };
  }, [previewSampleBlob, backgroundConfig, effectiveBgKind, bgStateA.bgImageFile, foregroundZoom, logoOverlay, canvasShape, textOverlay]);

  // Same debounced-recomposite pattern as the primary preview above, but
  // for column B's own independent background config.
  useEffect(() => {
    let ignore = false;
    const debounce = setTimeout(() => {
      (async () => {
        if (!previewSampleBlob || (effectiveSecondaryBgKind === "image" && !bgStateB.bgImageFile)) {
          if (!ignore) setSecondaryPreviewUrl(null);
          return;
        }
        if (!ignore) setSecondaryPreviewLoading(true);
        try {
          const result = await compositeBackground(previewSampleBlob, secondaryBackgroundConfig, foregroundZoom, logoOverlay, canvasShape, textOverlay);
          if (ignore) return;
          setSecondaryPreviewUrl(trackUrl(URL.createObjectURL(result)));
        } catch {
          if (!ignore) setSecondaryPreviewUrl(null);
        } finally {
          if (!ignore) setSecondaryPreviewLoading(false);
        }
      })();
    }, 120);

    return () => {
      ignore = true;
      clearTimeout(debounce);
    };
  }, [previewSampleBlob, secondaryBackgroundConfig, effectiveSecondaryBgKind, bgStateB.bgImageFile, foregroundZoom, logoOverlay, canvasShape, textOverlay]);

  const handleZipDrop = async (accepted: File[]) => {
    const zipFile = accepted.find((f) => f.name.toLowerCase().endsWith(".zip"));
    if (!zipFile) {
      setZipError("That doesn't look like a zip file.");
      return;
    }
    setZipError(null);
    setLoadingZip(true);
    try {
      const { zip, folders } = await loadSkuMediaZip(zipFile);
      if (folders.length === 0) {
        setZipError("No image folders found in this zip — expected one subfolder per product, each containing images.");
        setLoadingZip(false);
        return;
      }
      // The "shot number" a folder's images are numbered by is just their
      // POSITION within that folder (1st image, 2nd image, ...) —
      // `folder.filePaths` already arrives natural-sorted from
      // `loadSkuMediaZip`. This replaced parsing a number out of each
      // filename: that approach was fundamentally fragile (an appended
      // UUID's hex segments can coincidentally look like a small decimal
      // number, a numeric SKU code can collide with a real shot number,
      // ...) — no regex against the filename text can be made reliable
      // against arbitrary upload-pipeline naming. Counting is not
      // guessable wrong the way parsing is: a folder's Nth file is
      // unambiguously its Nth file, whatever it happens to be named.
      const fileMap = new Map<string, FileEntry>();
      for (const folder of folders) {
        folder.filePaths.forEach((path, position) => {
          const filename = path.split("/").pop() ?? path;
          fileMap.set(path, {
            path,
            folder: folder.sku,
            filename,
            index: position + 1,
            status: "skipped",
          });
        });
      }
      setZipData({ zip, folders });
      setFiles(fileMap);
      setSelectedIndices(new Set());
      setManualOverridesA(new Map());
      setExpandedFolders(new Set([folders[0].sku]));
      setFoldersRevealed(false);
      setProcessError(null);
      // The zip's own filename becomes the "site" folder under
      // uploads/background-customiser/ — matches how the zips this tool
      // is meant to work on are already named (e.g. a store-scraper
      // export is "bhunes.com.zip"), so results land in the same
      // site-named folder that export itself would use.
      setSiteFolderName(zipFile.name.replace(/\.zip$/i, "").trim() || "site");

      // Same zip re-added after a refresh or a server restart? Check for
      // progress saved under this exact signature (see zipSignature.ts) —
      // shown as a banner rather than auto-applied, so it's the user's
      // call whether to pick up where they left off.
      const signature = await computeZipSignature(zipFile, folders);
      setZipSignature(signature);
      const meta = await getJobMeta(signature);
      setSavedProgress(meta && meta.doneCount > 0 ? { doneCount: meta.doneCount, totalCount: meta.totalCount } : null);
    } catch (err) {
      setZipError(err instanceof Error ? err.message : "Couldn't read this zip file.");
    } finally {
      setLoadingZip(false);
    }
  };

  const handleResumeProgress = async () => {
    if (!zipSignature) return;
    setResumingProgress(true);
    try {
      const saved = await loadSavedResults(zipSignature);
      setFiles((prev) => {
        const next = new Map(prev);
        for (const [path, blob] of saved) {
          const existing = next.get(path);
          if (existing) next.set(path, { ...existing, status: "done", resultBlob: blob, error: undefined });
        }
        return next;
      });
      setSavedProgress(null);
    } finally {
      setResumingProgress(false);
    }
  };

  const handleDiscardProgress = () => {
    if (zipSignature) void clearJob(zipSignature);
    setSavedProgress(null);
  };

  const handleBgImageDropA = (file: File) => {
    patchBgStateA({ bgImageFile: file, bgImagePreviewUrl: trackUrl(URL.createObjectURL(file)) });
  };

  const handleBgImageDropB = (file: File) => {
    patchBgStateB({ bgImageFile: file, bgImagePreviewUrl: trackUrl(URL.createObjectURL(file)) });
  };

  const handleLogoDrop = (accepted: File[]) => {
    const file = accepted.find((f) => isImageFilename(f.name));
    if (!file) return;
    setLogoFile(file);
    setLogoPreviewUrl(trackUrl(URL.createObjectURL(file)));
  };

  /** The eyedropper: maps a click on the displayed (possibly scaled-down) sample image back to that image's own natural pixel coordinates, then samples the color there and hands it to `onPick`. Shared by the primary Replace-color eyedropper and the secondary column's own. */
  const pickColorFromSample = async (event: MouseEvent<HTMLImageElement>, onPick: (color: string) => void) => {
    if (!rawSampleBlob) return;
    const img = event.currentTarget;
    const rect = img.getBoundingClientRect();
    const scaleX = img.naturalWidth / rect.width;
    const scaleY = img.naturalHeight / rect.height;
    const x = (event.clientX - rect.left) * scaleX;
    const y = (event.clientY - rect.top) * scaleY;
    const color = await samplePixelColor(rawSampleBlob, x, y);
    onPick(color);
  };

  const handleEyedropperClick = (event: MouseEvent<HTMLImageElement>) =>
    pickColorFromSample(event, (color) => patchBgStateA({ replaceSourceColor: color }));
  const handleSecondaryEyedropperClick = (event: MouseEvent<HTMLImageElement>) =>
    pickColorFromSample(event, (color) => patchBgStateB({ replaceSourceColor: color }));

  // Checking a number in one column always clears it from the other — the
  // two picker columns are mutually exclusive by design (see the state
  // block's own comment on `secondaryIndices`), so there's never an
  // ambiguous "which one wins" case for a single shot number.
  const toggleIndex = (index: number) => {
    setSelectedIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setSecondaryIndices((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  };

  const toggleSecondaryIndex = (index: number) => {
    setSecondaryIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
    setSelectedIndices((prev) => {
      if (!prev.has(index)) return prev;
      const next = new Set(prev);
      next.delete(index);
      return next;
    });
  };

  const allSelected = availableIndices.length > 0 && availableIndices.every((n) => selectedIndices.has(n));
  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIndices(new Set());
    } else {
      setSelectedIndices(new Set(availableIndices));
      setSecondaryIndices(new Set());
    }
  };

  // "All" for the secondary column means every number NOT already claimed
  // by the primary column — it never fights the primary selection.
  const allSecondarySelected =
    availableIndices.length > 0 && availableIndices.every((n) => selectedIndices.has(n) || secondaryIndices.has(n));
  const toggleSecondarySelectAll = () => {
    if (allSecondarySelected) {
      setSecondaryIndices(new Set());
    } else {
      const next = new Set<number>();
      for (const n of availableIndices) {
        if (!selectedIndices.has(n)) next.add(n);
      }
      setSecondaryIndices(next);
    }
  };

  const toggleFolder = (sku: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(sku)) next.delete(sku);
      else next.add(sku);
      return next;
    });
  };

  const visibleFolders = useMemo(() => {
    if (!zipData) return [];
    const query = folderSearch.trim().toLowerCase();
    if (!query) return zipData.folders;
    return zipData.folders.filter((folder) => folder.sku.toLowerCase().includes(query));
  }, [zipData, folderSearch]);

  // Only the first FOLDER_PREVIEW_COUNT folders actually mount as <Card>
  // rows until "View more" is clicked — see `foldersRevealed`'s own
  // comment for why.
  const renderedFolders = useMemo(
    () => (foldersRevealed ? visibleFolders : visibleFolders.slice(0, FOLDER_PREVIEW_COUNT)),
    [visibleFolders, foldersRevealed],
  );
  const hiddenFolderCount = visibleFolders.length - renderedFolders.length;

  const allFoldersExpanded = visibleFolders.length > 0 && visibleFolders.every((folder) => expandedFolders.has(folder.sku));
  const toggleExpandAll = () => {
    if (allFoldersExpanded) {
      setExpandedFolders(new Set());
    } else {
      setExpandedFolders(new Set(visibleFolders.map((folder) => folder.sku)));
    }
  };

  /** Flushes every buffered patch from `queueFileUpdate` into `files` state as one `setFiles` call, regardless of how many images it covers. */
  const flushFileUpdates = () => {
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
    if (pendingFileUpdatesRef.current.size === 0) return;
    const updates = pendingFileUpdatesRef.current;
    pendingFileUpdatesRef.current = new Map();
    setFiles((prev) => {
      const next = new Map(prev);
      for (const [path, patch] of updates) {
        const existing = next.get(path);
        if (existing) next.set(path, { ...existing, ...patch });
      }
      return next;
    });
  };

  /**
   * Patches one file's entry in `files` state — coalesced: a burst of
   * results arriving close together (several workers finishing
   * near-simultaneously) gets buffered and applied as ONE `setFiles` call
   * roughly every 80ms, instead of one `setFiles` — and one full Map
   * clone, and one re-render of this whole page — per single image.
   */
  const queueFileUpdate = (path: string, patch: Partial<FileEntry>) => {
    pendingFileUpdatesRef.current.set(path, patch);
    if (flushTimerRef.current) return;
    flushTimerRef.current = setTimeout(() => {
      flushTimerRef.current = null;
      flushFileUpdates();
    }, 80);
  };

  // Column A — gets the full background config above (color/gradient/
  // image/replace-color, whichever's selected). A folder with a manual
  // override (see `manualOverridesA`) uses ONLY that one file, ignoring the
  // shot-number selection entirely for that folder; every other folder
  // still goes through the normal shot-number match.
  const selectedFiles = useMemo(() => {
    if (!zipData) return [];
    const result: FileEntry[] = [];
    for (const folder of zipData.folders) {
      const overridePath = manualOverridesA.get(folder.sku);
      if (overridePath) {
        const entry = files.get(overridePath);
        if (entry) result.push(entry);
        continue;
      }
      for (const path of folder.filePaths) {
        const entry = files.get(path);
        if (entry && entry.index !== null && selectedIndices.has(entry.index)) result.push(entry);
      }
    }
    return result;
  }, [zipData, files, selectedIndices, manualOverridesA]);

  const effectiveSelectedPathsA = useMemo(() => new Set(selectedFiles.map((f) => f.path)), [selectedFiles]);

  /** Clicking a thumbnail in the grid view always makes it that folder's sole Column A target; clicking the one already selected clears the override, falling back to the automatic shot-number pick for that folder. */
  const handleGridPick = (sku: string, path: string) => {
    setManualOverridesA((prev) => {
      const next = new Map(prev);
      if (next.get(sku) === path) next.delete(sku);
      else next.set(sku, path);
      return next;
    });
  };

  // Publishes the grid-view bridge (see gridBridge.ts) on `window` whenever
  // there's a zip loaded, so a tab opened via `openGridInNewTab` below can
  // reach back into THIS tab's live zip/selection state via `window.opener`.
  // Re-published on every `effectiveSelectedPathsA` change and fanned out to
  // any grid tab currently subscribed, so checking a shot-number box here
  // while the grid tab is still open updates its highlights live instead of
  // only reflecting whatever was selected at the moment it was opened.
  useEffect(() => {
    if (!zipData) return;
    const unpublish = publishGridBridge({
      zip: zipData.zip,
      folders: zipData.folders,
      getSelectedPaths: () => effectiveSelectedPathsA,
      subscribe: (listener) => {
        gridBridgeListenersRef.current.add(listener);
        return () => gridBridgeListenersRef.current.delete(listener);
      },
      onPick: handleGridPick,
    });
    return unpublish;
  }, [zipData, effectiveSelectedPathsA]);

  useEffect(() => {
    for (const listener of gridBridgeListenersRef.current) listener(effectiveSelectedPathsA);
  }, [effectiveSelectedPathsA]);

  /** A real new tab (not an in-page overlay) — see gridBridge.ts for why this works without a server-side job id. Falls back to a banner if the browser's popup blocker ate it. */
  const openGridInNewTab = () => {
    const opened = window.open("/bg-customiser-grid", "_blank");
    setGridPopupBlocked(!opened);
  };

  // Column B — gets ONLY the secondary color swap, regardless of what
  // column A's mode is set to. Mutually exclusive with column A by
  // construction (see `toggleIndex`/`toggleSecondaryIndex`).
  const secondaryFiles = useMemo(
    () => Array.from(files.values()).filter((f) => f.index !== null && secondaryIndices.has(f.index)),
    [files, secondaryIndices],
  );

  // Zoom, logo, and canvas shape are meant to apply uniformly across the
  // WHOLE zip regardless of either column — only the background change
  // itself (from whichever column a shot number falls into, or neither) is
  // scoped.
  const hasGlobalEdit = foregroundZoomPercent !== ZOOM_DEFAULT || Boolean(logoOverlay) || Boolean(textOverlay) || canvasShape !== "original";

  const processTargets = useMemo(() => {
    // Converting means EVERY image in the zip must be rewritten in the chosen format, not just the ones being edited.
    if (hasGlobalEdit || conversion) return Array.from(files.values());
    const combined = new Map<string, FileEntry>();
    for (const f of selectedFiles) combined.set(f.path, f);
    for (const f of secondaryFiles) combined.set(f.path, f);
    return Array.from(combined.values());
  }, [hasGlobalEdit, conversion, files, selectedFiles, secondaryFiles]);

  const cancelProcessing = () => {
    cancelledRef.current = true;
    activePoolCancelRef.current?.();
  };

  const cancelZipping = () => {
    zipCancelledRef.current = true;
  };

  /**
   * Makes sure every file in the zip — not just the ones a worker job
   * actually composited — ends up saved at
   * uploads/background-customiser/<site>/<SKU>/<filename>. An untouched
   * file still needs to be there for the eventual download (built by
   * `export-zip/route.ts`, streamed straight from this folder) to be a
   * complete mirror of the original zip plus whatever was changed.
   * `alreadyUploaded` skips paths `onResult` already queued during
   * compositing, so a freshly-processed image isn't uploaded twice.
   *
   * Reads and uploads one file at a time, bounded concurrency, never
   * accumulating the batch into memory — this is what replaced building
   * one giant in-memory zip `Blob` client-side, which is what reliably
   * crashed the tab outright ("Out of Memory") on a real batch of
   * 16000+ images. The actual downloadable zip no longer exists in the
   * browser's memory at any point; it's assembled server-side, streamed
   * from disk, once every file here is saved.
   */
  const saveAllFilesToServer = async (
    localResults: Map<string, Blob>,
    alreadyUploaded: Set<string>,
    outputNames: Map<string, string>,
    uploadSite: string,
  ) => {
    if (!zipData) return;
    const allPaths = zipData.folders.flatMap((f) => f.filePaths);
    const remaining = allPaths.filter((p) => !alreadyUploaded.has(p));

    let done = alreadyUploaded.size;
    const total = allPaths.length;
    let lastUpdateAt = 0;
    setServerSaveProgress({ done, total });

    await mapWithConcurrency(remaining, 6, async (path) => {
      if (zipCancelledRef.current) return;
      const entry = files.get(path);
      if (!entry) return;

      const resultBlob = localResults.get(path) ?? entry.resultBlob;
      const blob = resultBlob ?? (await readZipImage(zipData.zip, path))?.blob;
      if (!blob) return;
      const filename = resultBlob ? (outputNames.get(path) ?? outputPathFor(entry.filename)) : entry.filename;

      await uploadImageToServer({ website: uploadSite, sku: entry.folder, filename, blob });

      done += 1;
      const now = Date.now();
      if (done === total || now - lastUpdateAt > 100) {
        lastUpdateAt = now;
        setServerSaveProgress({ done, total });
      }
    });
  };

  const processAll = async () => {
    if (!zipData || processTargets.length === 0) return;
    if (effectiveBgKind === "image" && !bgStateA.bgImageFile) {
      setProcessError("Add a background image for Column A first.");
      return;
    }
    if (effectiveSecondaryBgKind === "image" && !bgStateB.bgImageFile) {
      setProcessError("Add a background image for Column B first.");
      return;
    }

    cancelledRef.current = false;
    setProcessError(null);
    setFailedResults([]);
    setLastDownload(null);
    setProcessing(true);

    const targets = processTargets.map((f) => f.path);
    // Three groups: column A gets its own background config, column B
    // gets its own (fully independent) background config, and anything in
    // neither gets zoom/logo only (`applyZoomAndLogo`) — see the state
    // block's own comment on `secondaryIndices` for why these two columns
    // exist and are mutually exclusive.
    const primaryPaths = new Set(selectedFiles.map((f) => f.path));
    const secondaryPaths = new Set(secondaryFiles.map((f) => f.path));

    // Collected locally, not read back from `files` state — `files`
    // won't have caught up with this run's `queueFileUpdate` calls yet by
    // the time `saveAllFilesToServer` needs it (those are buffered, see
    // `queueFileUpdate`'s own comment). Seeded with anything already done
    // (a resumed result, or left over from an earlier run this session)
    // so the final export includes it without redoing the work.
    const localResults = new Map<string, Blob>();
    // Final filenames for results that went through format conversion (new extension / rename pattern).
    const outputNames = new Map<string, string>();
    const avgColors = new Map<string, AverageColor>();
    // Converted output gets its own folder per conversion setup, so changing
    // format/quality/etc. never leaves the previous run's files mixed into
    // the zip that's built from this folder.
    const uploadSite = outputSite;
    const jobs: CompositeWorkerJob[] = [];
    for (const path of targets) {
      const existing = files.get(path);
      // A finished result is only reused when it was made under the conversion setup chosen right now.
      if (existing?.status === "done" && existing.resultBlob && (existing.convertTag ?? "none") === conversionKey) {
        localResults.set(path, existing.resultBlob);
        if (existing.outputFilename) outputNames.set(path, existing.outputFilename);
        continue;
      }
      jobs.push({
        path,
        mode: primaryPaths.has(path) ? "primary" : secondaryPaths.has(path) ? "secondary" : hasGlobalEdit ? "zoom-only" : "convert-only",
        folder: existing?.folder ?? "",
        position: existing?.index ?? 0,
      });
    }

    setFiles((prev) => {
      const next = new Map(prev);
      for (const job of jobs) {
        const existing = next.get(job.path);
        if (existing) next.set(job.path, { ...existing, status: "queued", error: undefined });
      }
      return next;
    });

    let failures = 0;
    // Collected here and shown once the run ends — setting React state per failed image would re-render once per error in a burst.
    const failedList: FailedResult[] = [];
    const modeByPath = new Map(jobs.map((job) => [job.path, job.mode]));
    let doneCount = localResults.size;
    const totalCount = targets.length;

    // Saves each processed image to uploads/background-customiser/<site>/
    // <SKU>/ as it's produced — the same on-disk layout (and the same
    // "skip if already there" fast-path) the store scraper's own
    // uploads/<site>/ folder uses, so a future run (or feature) can read
    // straight from disk instead of reprocessing. Runs alongside
    // compositing, not after it — no reason to wait for the whole batch
    // to finish before the first images are already saved.
    let serverSaveDone = 0;
    let serverSaveTotal = 0;
    const serverSaveQueue = new ServerSaveQueue(() => {
      serverSaveDone += 1;
      setServerSaveProgress({ done: serverSaveDone, total: serverSaveTotal });
    });
    // Paths already queued for upload here, during compositing — the
    // later full-traversal pass (`saveAllFilesToServer`) skips these so a
    // freshly-processed image isn't uploaded twice.
    const uploadedPaths = new Set<string>();

    // Splits `jobs` across one Web Worker per CPU core (see workerPool.ts)
    // instead of running every composite on the main thread — real
    // parallelism, not just interleaved async work on one thread.
    const handle = runCompositeWorkerPool({
      zip: zipData.zip,
      jobs,
      primaryConfig: backgroundConfig,
      secondaryConfig: secondaryBackgroundConfig,
      foregroundZoom,
      logo: logoOverlay,
      canvasShape,
      textOverlay,
      workerCount,
      conversion,
      onResult: (path, blob, avgColor, outputFilename) => {
        localResults.set(path, blob);
        if (outputFilename) outputNames.set(path, outputFilename);
        if (avgColor) avgColors.set(path, avgColor);
        queueFileUpdate(path, { status: "done", resultBlob: blob, outputFilename, convertTag: conversionKey, error: undefined });
        doneCount += 1;
        const entry = files.get(path);
        if (entry) {
          serverSaveTotal += 1;
          uploadedPaths.add(path);
          serverSaveQueue.push({ website: uploadSite, sku: entry.folder, filename: outputFilename ?? outputPathFor(entry.filename), blob });
        }
        // The resume store only keeps the blob (no filename / conversion info),
        // so a converted result must not go in it — it would later be restored
        // as if it were a plain composited PNG. Converted output is already
        // saved to disk as it's produced, which is what survives a refresh.
        if (zipSignature && !conversion) {
          void saveResult(zipSignature, path, blob);
          const meta: JobMeta = { signature: zipSignature, updatedAt: Date.now(), totalCount, doneCount };
          void saveJobMeta(meta);
        }
      },
      onError: (path, message) => {
        failures += 1;
        const columnLabel = columnLabelFor(modeByPath.get(path));
        const entry = files.get(path);
        failedList.push({ path, filename: entry?.filename ?? path, columnLabel, folder: entry?.folder ?? "", shot: entry?.index ?? null, message });
        queueFileUpdate(path, { status: "error", error: message, columnLabel });
      },
    });
    activePoolCancelRef.current = handle.cancel;

    try {
      await handle.promise;
    } finally {
      flushFileUpdates();
      activePoolCancelRef.current = null;
      if (cancelledRef.current) {
        setFiles((prev) => {
          const next = new Map(prev);
          for (const job of jobs) {
            const existing = next.get(job.path);
            if (existing && (existing.status === "queued" || existing.status === "processing")) {
              next.set(job.path, { ...existing, status: "skipped" });
            }
          }
          return next;
        });
      }
      setProcessing(false);
    }
    setFailedResults(failedList);

    // A background-swap batch's outputs should all land roughly the same
    // corner color — median-per-channel is the robust center (mean would
    // get dragged around by the very outliers this is trying to find), and
    // anything far enough from it gets flagged. Skipped for a tiny batch
    // (fewer than 4 background-swapped results): "the median of 2 numbers"
    // isn't a meaningful center to measure outliers against.
    if (!cancelledRef.current && avgColors.size >= 4) {
      const colors = Array.from(avgColors.values());
      const median = (values: number[]) => {
        const sorted = [...values].sort((a, b) => a - b);
        return sorted[Math.floor(sorted.length / 2)];
      };
      const medianColor: AverageColor = {
        r: median(colors.map((c) => c.r)),
        g: median(colors.map((c) => c.g)),
        b: median(colors.map((c) => c.b)),
      };
      const OUTLIER_DISTANCE_THRESHOLD = 45;
      const outliers: OutlierResult[] = [];
      for (const [path, color] of avgColors) {
        if (averageColorDistance(color, medianColor) > OUTLIER_DISTANCE_THRESHOLD) {
          const entry = files.get(path);
          outliers.push({
            path,
            filename: entry?.filename ?? path,
            // Only primary / secondary jobs are ever sampled for color, so anything not in column A was column B.
            column: primaryPaths.has(path) ? "A" : "B",
            folder: entry?.folder ?? "",
            shot: entry?.index ?? null,
          });
        }
      }
      setOutlierResults(outliers);
    } else {
      setOutlierResults([]);
    }

    if (cancelledRef.current) {
      setProcessError("Cancelled — anything already finished is kept, and saved so you can resume later.");
      await serverSaveQueue.drain();
      setServerSaveProgress(null);
      return;
    }
    if (failures > 0) {
      setProcessError(`${failures} image${failures === 1 ? "" : "s"} couldn't be updated and ${failures === 1 ? "was" : "were"} left unchanged.`);
    }
    if (localResults.size === 0) {
      await serverSaveQueue.drain();
      setServerSaveProgress(null);
      return;
    }

    // Most per-result saves already fired during compositing (they run
    // alongside it, not after) — drain waits out whatever's still
    // trickling through the upload queue's concurrency limit, then
    // `saveAllFilesToServer` covers the rest: anything seeded from an
    // earlier run plus every genuinely untouched file, so the on-disk
    // folder ends up a complete mirror before the zip is built from it.
    zipCancelledRef.current = false;
    setZipping(true);
    try {
      await serverSaveQueue.drain(() => zipCancelledRef.current);
      await saveAllFilesToServer(localResults, uploadedPaths, outputNames, uploadSite);
      if (zipCancelledRef.current) {
        setProcessError("Cancelled — everything saved so far is on disk at uploads/background-customiser/, ready to export anytime.");
        return;
      }
      const downloadUrl = `/api/bg-customiser/export-zip?site=${encodeURIComponent(uploadSite)}&name=${encodeURIComponent(siteFolderName)}`;
      const filename = `${siteFolderName}.zip`;
      triggerUrlDownload(downloadUrl);
      setLastDownload({ url: downloadUrl, filename, count: localResults.size });
      // The batch finished and downloaded successfully — the saved
      // per-image progress has done its job, so there's no reason to keep
      // gigabytes of result blobs sitting in IndexedDB indefinitely. The
      // files on disk under uploads/ stay, though — that's what makes the
      // download re-triggerable later without reprocessing anything.
      if (zipSignature) void clearJob(zipSignature);
    } catch (err) {
      setProcessError(err instanceof Error ? err.message : "Couldn't save files to the server.");
    } finally {
      setZipping(false);
      setServerSaveProgress(null);
    }
  };

  const clearZip = () => {
    setZipData(null);
    setFiles(new Map());
    setSelectedIndices(new Set());
    setZipError(null);
    setProcessError(null);
    setFoldersRevealed(false);
    setZipSignature(null);
    setSavedProgress(null);
    setSiteFolderName("site");
  };

  const doneCount = useMemo(() => Array.from(files.values()).filter((f) => f.status === "done").length, [files]);
  const errorCount = useMemo(() => Array.from(files.values()).filter((f) => f.status === "error").length, [files]);
  const overallPercent = processTargets.length === 0 ? 0 : Math.round((doneCount / processTargets.length) * 100);
  const processingPath = useMemo(() => Array.from(files.values()).find((f) => f.status === "processing")?.path ?? null, [files]);

  return (
    <Page
      fullWidth
      title="Background customiser"
      subtitle="Personal tool — swaps in a new background (color, gradient, or image) behind product photos, right in your browser. Nothing is uploaded anywhere; doesn't touch your store."
      backAction={{ content: "Store connection", url: "/settings/connection" }}
      titleMetadata={<Badge tone="magic">On-device</Badge>}
      secondaryActions={[
        {
          content: "How it works?",
          icon: QuestionCircleIcon,
          onAction: () => setHowItWorksOpen(true),
        },
      ]}
    >
      <Modal open={howItWorksOpen} onClose={() => setHowItWorksOpen(false)} title="How the background customiser works">
        <Modal.Section>
          <BlockStack gap="400">
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">1. Add a zip</Text>
              <Text as="p" tone="subdued">
                One subfolder per product (SKU), each holding that product&apos;s photos. Everything is read and
                processed in your browser — nothing is ever uploaded anywhere.
              </Text>
            </BlockStack>
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">2. Pick which shot numbers to update</Text>
              <Text as="p" tone="subdued">
                Column A and Column B each get their own full background picker (color, gradient, image, or a color
                swap) — completely independent of one another. A shot number can only be in one column at a time.
              </Text>
            </BlockStack>
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">3. Zoom and logo apply to everything</Text>
              <Text as="p" tone="subdued">
                Unlike the background change, Zoom and the Logo overlay apply to every image in the zip — including
                ones left out of both columns.
              </Text>
            </BlockStack>
            <BlockStack gap="150">
              <Text as="h3" variant="headingSm">4. Apply &amp; download</Text>
              <Text as="p" tone="subdued">
                Processing runs entirely on-device and the finished zip downloads automatically the moment it&apos;s
                done.
              </Text>
            </BlockStack>
          </BlockStack>
        </Modal.Section>
      </Modal>
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <InlineStack gap="300" blockAlign="center">
                <Box background="bg-fill-magic" padding="200" borderRadius="200">
                  <span style={{ color: "#fff", display: "flex" }}>
                    <Icon source={PaintBrushFlatIcon} tone="inherit" />
                  </span>
                </Box>
                <BlockStack gap="050">
                  <Text as="h2" variant="headingSm">Add a zip of product photo folders</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    One subfolder per product (SKU), each containing that product&apos;s images — everything is read
                    and processed in your browser, nothing is uploaded anywhere.
                  </Text>
                </BlockStack>
              </InlineStack>

              {zipError && (
                <Banner tone="warning" title="Couldn't add that" onDismiss={() => setZipError(null)}>
                  <p>{zipError}</p>
                </Banner>
              )}

              {!zipData ? (
                <DropZone
                  accept=".zip,application/zip"
                  type="file"
                  allowMultiple={false}
                  onDrop={(_files, accepted) => accepted.length > 0 && handleZipDrop(accepted)}
                >
                  {loadingZip ? (
                    <Box padding="800">
                      <BlockStack gap="200" inlineAlign="center">
                        <Spinner size="small" />
                        <Text as="p" tone="subdued">Reading zip…</Text>
                      </BlockStack>
                    </Box>
                  ) : (
                    <DropZone.FileUpload actionTitle="Add zip file" actionHint="or drop a .zip of product photo folders" />
                  )}
                </DropZone>
              ) : (
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <InlineStack gap="300" blockAlign="center" wrap>
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <InlineStack gap="150" blockAlign="center">
                        <Icon source={FolderIcon} tone="subdued" />
                        <Text as="span" fontWeight="semibold">
                          {zipData.folders.length} folder{zipData.folders.length === 1 ? "" : "s"}
                        </Text>
                      </InlineStack>
                    </Box>
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <InlineStack gap="150" blockAlign="center">
                        <Icon source={ImageIcon} tone="subdued" />
                        <Text as="span" fontWeight="semibold">
                          {files.size} image{files.size === 1 ? "" : "s"}
                        </Text>
                      </InlineStack>
                    </Box>
                  </InlineStack>
                  <Button icon={DeleteIcon} onClick={clearZip} disabled={processing}>
                    Start over
                  </Button>
                </InlineStack>
              )}
            </BlockStack>
          </Card>
        </Layout.Section>

        {zipData && (
          <>
            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <InlineStack gap="300" blockAlign="center">
                    <Box background="bg-fill-info" padding="150" borderRadius="150">
                      <span style={{ color: "#fff", display: "flex" }}>
                        <Icon source={ImageIcon} tone="inherit" />
                      </span>
                    </Box>
                    <BlockStack gap="050">
                      <Text as="h2" variant="headingSm">Zoom, shape &amp; logo</Text>
                      <Text as="p" tone="subdued" variant="bodySm">
                        Applied to every image in the zip — including ones in neither column below.
                      </Text>
                    </BlockStack>
                  </InlineStack>

                  <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                    <BlockStack gap="300">
                      <BlockStack gap="150">
                        <Text as="span" variant="bodySm" fontWeight="medium">Zoom</Text>
                        <ZoomControl value={foregroundZoomPercent} onChange={setForegroundZoomPercent} />
                      </BlockStack>

                      <BlockStack gap="150">
                        <Text as="span" variant="bodySm" fontWeight="medium">Canvas shape</Text>
                        <InlineStack gap="150">
                          <Button pressed={canvasShape === "original"} onClick={() => setCanvasShape("original")}>
                            Keep original
                          </Button>
                          <Button pressed={canvasShape === "square"} onClick={() => setCanvasShape("square")}>
                            Square
                          </Button>
                        </InlineStack>
                        {canvasShape === "square" && (
                          <Text as="span" tone="subdued" variant="bodySm">
                            A non-square photo gets padded to a square canvas (the longer side becomes both
                            dimensions) — nothing is cropped.
                          </Text>
                        )}
                      </BlockStack>

                      <BlockStack gap="150">
                        <Text as="span" variant="bodySm" fontWeight="medium">Logo position</Text>
                        <InlineStack gap="150" wrap>
                          {LOGO_POSITIONS.map((p) => (
                            <Button key={p.value} disabled={!logoFile} pressed={logoPosition === p.value} onClick={() => setLogoPosition(p.value)}>
                              {p.label}
                            </Button>
                          ))}
                        </InlineStack>

                        {logoPosition === "custom" && (
                          <InlineGrid columns={2} gap="300">
                            <RangeSlider
                              label={`Horizontal — ${logoCustomX}%`}
                              disabled={!logoFile}
                              min={0}
                              max={100}
                              value={logoCustomX}
                              onChange={(v) => setLogoCustomX(Array.isArray(v) ? v[0] : v)}
                              output
                            />
                            <RangeSlider
                              label={`Vertical — ${logoCustomY}%`}
                              disabled={!logoFile}
                              min={0}
                              max={100}
                              value={logoCustomY}
                              onChange={(v) => setLogoCustomY(Array.isArray(v) ? v[0] : v)}
                              output
                            />
                          </InlineGrid>
                        )}

                        <RangeSlider
                          label={`Size — ${logoSizePercent}%`}
                          disabled={!logoFile}
                          min={5}
                          max={50}
                          value={logoSizePercent}
                          onChange={(v) => setLogoSizePercent(Array.isArray(v) ? v[0] : v)}
                          output
                        />

                        {logoPosition !== "custom" && logoPosition !== "center" && (
                          <RangeSlider
                            label={`Margin from edge — ${logoMarginPercent}%`}
                            disabled={!logoFile}
                            min={0}
                            max={20}
                            value={logoMarginPercent}
                            onChange={(v) => setLogoMarginPercent(Array.isArray(v) ? v[0] : v)}
                            output
                          />
                        )}
                      </BlockStack>
                    </BlockStack>

                    <div style={{ height: "100%", display: "flex", flexDirection: "column", gap: 8 }}>
                      <InlineStack align="space-between" blockAlign="center">
                        <Text as="span" variant="bodySm" fontWeight="medium">Logo</Text>
                        {logoFile && (
                          <Button
                            size="micro"
                            icon={DeleteIcon}
                            onClick={() => {
                              setLogoFile(null);
                              setLogoPreviewUrl(null);
                            }}
                          >
                            Remove
                          </Button>
                        )}
                      </InlineStack>

                      {!logoFile ? (
                        <DropZone
                          accept="image/*"
                          type="file"
                          allowMultiple={false}
                          onDrop={(_files, accepted) => accepted.length > 0 && handleLogoDrop(accepted)}
                        >
                          <DropZone.FileUpload actionTitle="Add logo" actionHint="or drop an image" />
                        </DropZone>
                      ) : (
                        <div
                          style={{
                            flex: 1,
                            minHeight: 220,
                            width: "100%",
                            borderRadius: 8,
                            overflow: "hidden",
                            border: "1px solid var(--p-color-border)",
                            background: "repeating-conic-gradient(#e3e3e3 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px",
                          }}
                        >
                          {logoPreviewUrl && (
                            // eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL
                            <img src={logoPreviewUrl} alt={logoFile.name} style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          )}
                        </div>
                      )}
                    </div>
                  </InlineGrid>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="150" blockAlign="center">
                      <Box background="bg-fill-info" padding="150" borderRadius="150">
                        <span style={{ color: "#fff", display: "flex" }}>
                          <Icon source={ImageIcon} tone="inherit" />
                        </span>
                      </Box>
                      <BlockStack gap="0">
                        <Text as="h2" variant="headingSm">Text overlay</Text>
                        <Text as="p" tone="subdued" variant="bodySm">
                          A second stamp — &quot;New&quot;, a price tag — layered on top of the logo. Same scope as
                          Zoom &amp; logo: applies to every image regardless of column.
                        </Text>
                      </BlockStack>
                    </InlineStack>
                    <Checkbox label="Enable" checked={textOverlayEnabled} onChange={setTextOverlayEnabled} />
                  </InlineStack>

                  {textOverlayEnabled && (
                    <BlockStack gap="300">
                      <TextField
                        label="Text"
                        autoComplete="off"
                        value={textOverlayText}
                        onChange={setTextOverlayText}
                        placeholder="New"
                      />
                      <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                        <BlockStack gap="150">
                          <Text as="span" variant="bodySm" fontWeight="medium">Position</Text>
                          <InlineStack gap="150" wrap>
                            {LOGO_POSITIONS.map((p) => (
                              <Button key={p.value} pressed={textOverlayPosition === p.value} onClick={() => setTextOverlayPosition(p.value)}>
                                {p.label}
                              </Button>
                            ))}
                          </InlineStack>
                          {textOverlayPosition === "custom" && (
                            <InlineGrid columns={2} gap="300">
                              <RangeSlider
                                label={`Horizontal — ${textOverlayCustomX}%`}
                                min={0}
                                max={100}
                                value={textOverlayCustomX}
                                onChange={(v) => setTextOverlayCustomX(Array.isArray(v) ? v[0] : v)}
                                output
                              />
                              <RangeSlider
                                label={`Vertical — ${textOverlayCustomY}%`}
                                min={0}
                                max={100}
                                value={textOverlayCustomY}
                                onChange={(v) => setTextOverlayCustomY(Array.isArray(v) ? v[0] : v)}
                                output
                              />
                            </InlineGrid>
                          )}
                          <RangeSlider
                            label={`Size — ${textOverlaySizePercent}%`}
                            min={2}
                            max={20}
                            value={textOverlaySizePercent}
                            onChange={(v) => setTextOverlaySizePercent(Array.isArray(v) ? v[0] : v)}
                            output
                          />
                          {textOverlayPosition !== "custom" && textOverlayPosition !== "center" && (
                            <RangeSlider
                              label={`Margin from edge — ${textOverlayMarginPercent}%`}
                              min={0}
                              max={20}
                              value={textOverlayMarginPercent}
                              onChange={(v) => setTextOverlayMarginPercent(Array.isArray(v) ? v[0] : v)}
                              output
                            />
                          )}
                        </BlockStack>
                        <BlockStack gap="150">
                          <InlineStack gap="400" blockAlign="center">
                            <InlineStack gap="150" blockAlign="center">
                              <ColorSwatchPicker label="Text color" value={textOverlayColor} onChange={setTextOverlayColor} />
                              <Text as="span" tone="subdued" variant="bodySm">Text</Text>
                            </InlineStack>
                          </InlineStack>
                          <Checkbox
                            label="Backing box behind the text (helps legibility on busy backgrounds)"
                            checked={textOverlayHasBackground}
                            onChange={setTextOverlayHasBackground}
                          />
                          {textOverlayHasBackground && (
                            <InlineStack gap="150" blockAlign="center">
                              <ColorSwatchPicker label="Backing box color" value={textOverlayBackgroundColor} onChange={setTextOverlayBackgroundColor} />
                              <Text as="span" tone="subdued" variant="bodySm">Background</Text>
                            </InlineStack>
                          )}
                        </BlockStack>
                      </InlineGrid>
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="150" blockAlign="center">
                    <Box background="bg-fill-magic" padding="150" borderRadius="150">
                      <span style={{ color: "#fff", display: "flex" }}>
                        <Icon source={PaintBrushFlatIcon} tone="inherit" />
                      </span>
                    </Box>
                    <Text as="h2" variant="headingSm">1. Which shot number to update (Column A)</Text>
                    <Tooltip content="Numbered by each image's position within its own product folder (1st photo, 2nd photo, ...), not by anything in the filename.">
                      <Icon source={InfoIcon} tone="subdued" />
                    </Tooltip>
                  </InlineStack>

                  <InlineStack align="space-between" blockAlign="center" gap="200" wrap={false}>
                    <Text as="p" tone="subdued" variant="bodySm">
                      Shot numbers aren&apos;t always consistent across folders — if a number picks the wrong photo in
                      some products, correct just those visually instead of guessing at a better number.
                    </Text>
                    <InlineStack gap="200" blockAlign="center" wrap={false}>
                      {manualOverridesA.size > 0 && (
                        <>
                          <Badge tone="info">{`${manualOverridesA.size} manually picked`}</Badge>
                          <Button variant="plain" tone="critical" onClick={() => setManualOverridesA(new Map())}>
                            Reset
                          </Button>
                        </>
                      )}
                      <Button icon={ViewIcon} onClick={openGridInNewTab} disabled={!zipData}>
                        View in grid
                      </Button>
                    </InlineStack>
                  </InlineStack>

                  {gridPopupBlocked && (
                    <Banner tone="warning" onDismiss={() => setGridPopupBlocked(false)}>
                      <p>Your browser blocked the new tab — allow popups for this site, then click &quot;View in grid&quot; again.</p>
                    </Banner>
                  )}

                  {availableIndices.length === 0 ? (
                    <Banner tone="info">
                      <p>None of these filenames end in a recognizable shot number, so there&apos;s nothing to select by number.</p>
                    </Banner>
                  ) : (
                    <BlockStack gap="200">
                      <InlineStack gap="300" wrap>
                        <Checkbox label={<Text as="span" fontWeight="semibold">Select all</Text>} checked={allSelected} onChange={toggleSelectAll} />
                        {availableIndices.map((n) => (
                          <Checkbox key={n} label={String(n)} checked={selectedIndices.has(n)} onChange={() => toggleIndex(n)} />
                        ))}
                      </InlineStack>
                      {selectedFiles.length > 0 && (
                        <Text as="p" tone="subdued" variant="bodySm">
                          {selectedFiles.length} image{selectedFiles.length === 1 ? "" : "s"} will get the Column A
                          background, across {new Set(selectedFiles.map((f) => f.folder)).size} folder
                          {new Set(selectedFiles.map((f) => f.folder)).size === 1 ? "" : "s"}.
                        </Text>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="150" blockAlign="center">
                    <Box background="bg-fill-magic" padding="150" borderRadius="150">
                      <span style={{ color: "#fff", display: "flex" }}>
                        <Icon source={PaintBrushFlatIcon} tone="inherit" />
                      </span>
                    </Box>
                    <BlockStack gap="0">
                      <Text as="h2" variant="headingSm">Column A — new background</Text>
                      <Text as="p" tone="subdued" variant="bodySm">This image will be used as the new background for Column A.</Text>
                    </BlockStack>
                  </InlineStack>

                  <BackgroundModeEditor
                    state={bgStateA}
                    onChange={patchBgStateA}
                    sampleTransparent={sampleTransparent}
                    hasSample={Boolean(zipData && previewSourcePath)}
                    onImageDrop={handleBgImageDropA}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="150" blockAlign="center">
                      <Box background="bg-fill-info" padding="150" borderRadius="150">
                        <span style={{ color: "#fff", display: "flex" }}>
                          <Icon source={ImageIcon} tone="inherit" />
                        </span>
                      </Box>
                      <BlockStack gap="0">
                        <Text as="h2" variant="headingSm">Column A — Preview</Text>
                        <Text as="p" tone="subdued" variant="bodySm">See the original image result with the new background.</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button size="micro" onClick={() => setCompareModeA((v) => !v)}>
                      {compareModeA ? "Side by side" : "Compare"}
                    </Button>
                  </InlineStack>

                  {compareModeA ? (
                    rawSampleUrl && <BeforeAfterSlider beforeUrl={rawSampleUrl} afterUrl={previewUrl} loading={previewLoading} />
                  ) : (
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                      {rawSampleUrl && (
                        <BlockStack gap="150" inlineAlign="center">
                          <Badge>Original</Badge>
                          <div
                            style={{
                              width: "100%",
                              maxWidth: 420,
                              aspectRatio: "1",
                              borderRadius: 8,
                              overflow: "hidden",
                              background: "repeating-conic-gradient(#e3e3e3 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px",
                              border: "1px solid var(--p-color-border)",
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL, needs pixel-level click sampling a Next <Image> can't offer */}
                            <img
                              src={rawSampleUrl}
                              alt="Original — click to pick a color to replace"
                              onClick={handleEyedropperClick}
                              style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "crosshair" }}
                            />
                          </div>
                        </BlockStack>
                      )}
                      <BlockStack gap="150" inlineAlign="center">
                        <Badge tone="magic">Edited (New Background)</Badge>
                        <div
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            aspectRatio: "1",
                            borderRadius: 8,
                            overflow: "hidden",
                            position: "relative",
                            background: "repeating-conic-gradient(#e3e3e3 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px",
                            border: "1px solid var(--p-color-border)",
                          }}
                        >
                          {previewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL
                            <img src={previewUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          ) : (
                            <BlockStack gap="100" inlineAlign="center">
                              <Box padding="800">
                                <Icon source={ImageIcon} tone="subdued" />
                              </Box>
                            </BlockStack>
                          )}
                          {previewLoading && (
                            <div style={{ position: "absolute", top: 8, right: 8 }}>
                              <Spinner size="small" />
                            </div>
                          )}
                        </div>
                      </BlockStack>
                    </InlineGrid>
                  )}
                  <Text as="p" tone="subdued" variant="bodySm">
                    Shown on {previewSourcePath ? (files.get(previewSourcePath)?.filename ?? "one image") : "one image"} from your zip.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="150" blockAlign="center">
                    <Box background="bg-fill-brand" padding="150" borderRadius="150">
                      <span style={{ color: "#fff", display: "flex" }}>
                        <Icon source={EyeDropperIcon} tone="inherit" />
                      </span>
                    </Box>
                    <Text as="h2" variant="headingSm">2. Which shot number to update (Column B)</Text>
                    <Tooltip content="Numbered by each image's position within its own product folder (1st photo, 2nd photo, ...), not by anything in the filename.">
                      <Icon source={InfoIcon} tone="subdued" />
                    </Tooltip>
                  </InlineStack>

                  {availableIndices.length === 0 ? (
                    <Banner tone="info">
                      <p>None of these filenames end in a recognizable shot number, so there&apos;s nothing to select by number.</p>
                    </Banner>
                  ) : (
                    <BlockStack gap="200">
                      <InlineStack gap="300" wrap>
                        <Checkbox label={<Text as="span" fontWeight="semibold">Select all</Text>} checked={allSecondarySelected} onChange={toggleSecondarySelectAll} />
                        {availableIndices.map((n) => (
                          <Checkbox key={n} label={String(n)} checked={secondaryIndices.has(n)} onChange={() => toggleSecondaryIndex(n)} />
                        ))}
                      </InlineStack>
                      {secondaryFiles.length > 0 && (
                        <Text as="p" tone="subdued" variant="bodySm">
                          {secondaryFiles.length} image{secondaryFiles.length === 1 ? "" : "s"} will get the Column B
                          background, across {new Set(secondaryFiles.map((f) => f.folder)).size} folder
                          {new Set(secondaryFiles.map((f) => f.folder)).size === 1 ? "" : "s"}.
                        </Text>
                      )}
                    </BlockStack>
                  )}
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack gap="150" blockAlign="center">
                    <Box background="bg-fill-brand" padding="150" borderRadius="150">
                      <span style={{ color: "#fff", display: "flex" }}>
                        <Icon source={EyeDropperIcon} tone="inherit" />
                      </span>
                    </Box>
                    <BlockStack gap="0">
                      <Text as="h2" variant="headingSm">Column B — new background</Text>
                      <Text as="p" tone="subdued" variant="bodySm">This image will be used as the new background for Column B.</Text>
                    </BlockStack>
                  </InlineStack>

                  <BackgroundModeEditor
                    state={bgStateB}
                    onChange={patchBgStateB}
                    sampleTransparent={sampleTransparent}
                    hasSample={Boolean(zipData && previewSourcePath)}
                    onImageDrop={handleBgImageDropB}
                  />
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="300">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="150" blockAlign="center">
                      <Box background="bg-fill-info" padding="150" borderRadius="150">
                        <span style={{ color: "#fff", display: "flex" }}>
                          <Icon source={ImageIcon} tone="inherit" />
                        </span>
                      </Box>
                      <BlockStack gap="0">
                        <Text as="h2" variant="headingSm">Column B — Preview</Text>
                        <Text as="p" tone="subdued" variant="bodySm">See the original image result with the new background.</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button size="micro" onClick={() => setCompareModeB((v) => !v)}>
                      {compareModeB ? "Side by side" : "Compare"}
                    </Button>
                  </InlineStack>

                  {compareModeB ? (
                    rawSampleUrl && <BeforeAfterSlider beforeUrl={rawSampleUrl} afterUrl={secondaryPreviewUrl} loading={secondaryPreviewLoading} />
                  ) : (
                    <InlineGrid columns={{ xs: 1, sm: 2 }} gap="400">
                      {rawSampleUrl && (
                        <BlockStack gap="150" inlineAlign="center">
                          <Badge>Original</Badge>
                          <div
                            style={{
                              width: "100%",
                              maxWidth: 420,
                              aspectRatio: "1",
                              borderRadius: 8,
                              overflow: "hidden",
                              background: "repeating-conic-gradient(#e3e3e3 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px",
                              border: "1px solid var(--p-color-border)",
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL, needs pixel-level click sampling a Next <Image> can't offer */}
                            <img
                              src={rawSampleUrl}
                              alt="Original — click to pick a color to replace"
                              onClick={handleSecondaryEyedropperClick}
                              style={{ width: "100%", height: "100%", objectFit: "contain", cursor: "crosshair" }}
                            />
                          </div>
                        </BlockStack>
                      )}
                      <BlockStack gap="150" inlineAlign="center">
                        <Badge tone="magic">Edited (New Background)</Badge>
                        <div
                          style={{
                            width: "100%",
                            maxWidth: 420,
                            aspectRatio: "1",
                            borderRadius: 8,
                            overflow: "hidden",
                            position: "relative",
                            background: "repeating-conic-gradient(#e3e3e3 0% 25%, #f4f4f4 0% 50%) 50% / 16px 16px",
                            border: "1px solid var(--p-color-border)",
                          }}
                        >
                          {secondaryPreviewUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element -- transient client-only object URL
                            <img src={secondaryPreviewUrl} alt="Preview" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
                          ) : (
                            <BlockStack gap="100" inlineAlign="center">
                              <Box padding="800">
                                <Icon source={ImageIcon} tone="subdued" />
                              </Box>
                            </BlockStack>
                          )}
                          {secondaryPreviewLoading && (
                            <div style={{ position: "absolute", top: 8, right: 8 }}>
                              <Spinner size="small" />
                            </div>
                          )}
                        </div>
                      </BlockStack>
                    </InlineGrid>
                  )}
                  <Text as="p" tone="subdued" variant="bodySm">
                    Shown on {previewSourcePath ? (files.get(previewSourcePath)?.filename ?? "one image") : "one image"} from your zip.
                  </Text>
                </BlockStack>
              </Card>
            </Layout.Section>

            <Layout.Section>
              <Card>
                <BlockStack gap="400">
                  <Text as="h2" variant="headingSm">Processing progress</Text>

                  {savedProgress && (
                    <Banner tone="info" title="Found saved progress for this zip">
                      <BlockStack gap="200">
                        <p>
                          {`${savedProgress.doneCount.toLocaleString()} of ${savedProgress.totalCount.toLocaleString()} images `}
                          {`(${Math.round((savedProgress.doneCount / savedProgress.totalCount) * 100)}%) were already updated before this was last `}
                          interrupted — resume to pick up from there, or start fresh to redo everything. Resuming keeps
                          already-processed images as-is even if settings changed since then.
                        </p>
                        <InlineStack gap="200">
                          <Button onClick={() => void handleResumeProgress()} loading={resumingProgress} variant="primary">
                            Resume
                          </Button>
                          <Button onClick={handleDiscardProgress} disabled={resumingProgress}>
                            Start fresh
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Banner>
                  )}

                  <InlineGrid columns={{ xs: 2, sm: errorCount > 0 ? 4 : 3 }} gap="300">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="150">
                        <Icon source={ClockIcon} tone="subdued" />
                        <Text as="p" variant="headingLg">{processTargets.length}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">To process</Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-surface-magic" padding="300" borderRadius="200">
                      <BlockStack gap="150">
                        <Icon source={RefreshIcon} tone="magic" />
                        <Text as="p" variant="headingLg">{overallPercent}%</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Overall progress</Text>
                      </BlockStack>
                    </Box>
                    <Box background="bg-fill-success-secondary" padding="300" borderRadius="200">
                      <BlockStack gap="150">
                        <Icon source={CheckCircleIcon} tone="success" />
                        <Text as="p" variant="headingLg">
                          {doneCount}/{processTargets.length}
                        </Text>
                        <Text as="p" variant="bodySm" tone="subdued">Updated</Text>
                      </BlockStack>
                    </Box>
                    {errorCount > 0 && (
                      <Box background="bg-fill-critical-secondary" padding="300" borderRadius="200">
                        <BlockStack gap="150">
                          <Icon source={AlertCircleIcon} tone="critical" />
                          <Text as="p" variant="headingLg">{errorCount}</Text>
                          <Text as="p" variant="bodySm" tone="subdued">Couldn&apos;t update</Text>
                        </BlockStack>
                      </Box>
                    )}
                  </InlineGrid>

                  <BlockStack gap="150">
                    <ProgressBar progress={overallPercent} tone="primary" size="small" />
                    <Text as="p" variant="bodySm" tone="subdued">
                      {processing
                        ? `${overallPercent}% overall — ${doneCount} of ${processTargets.length} finished${
                            processingPath ? `, updating ${files.get(processingPath)?.filename}` : ""
                          }`
                        : `${doneCount} of ${processTargets.length} finished`}
                    </Text>
                  </BlockStack>

                  {serverSaveProgress && (
                    <BlockStack gap="150">
                      <ProgressBar
                        progress={serverSaveProgress.total === 0 ? 0 : Math.round((serverSaveProgress.done / serverSaveProgress.total) * 100)}
                        tone="primary"
                        size="small"
                      />
                      <Text as="p" variant="bodySm" tone="subdued">
                        {`Saving to server — ${serverSaveProgress.done} of ${serverSaveProgress.total} images written to uploads/background-customiser/${outputSite}/. Already-saved files are skipped. Your download starts automatically once this reaches 100%.`}
                      </Text>
                    </BlockStack>
                  )}

                  {processError && (
                    <Banner tone={doneCount > 0 ? "warning" : "critical"} onDismiss={() => setProcessError(null)}>
                      <p>{processError}</p>
                    </Banner>
                  )}

                  {failedResults.length > 0 && (
                    <Banner tone="critical" title="These images couldn't be processed" onDismiss={() => setFailedResults([])}>
                      <BlockStack gap="150">
                        {failedResults.slice(0, 10).map((f) => (
                          <BlockStack key={f.path} gap="050">
                            <InlineStack gap="200" blockAlign="start" align="start" wrap={false}>
                              <Badge tone={f.columnLabel === "Column A" ? "info" : f.columnLabel === "Column B" ? "success" : undefined}>{f.columnLabel}</Badge>
                              <Text as="span" variant="bodySm" breakWord>
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  {`${f.folder}${f.shot !== null ? ` · shot ${f.shot}` : ""}`}
                                </Text>
                                {` / ${f.filename}`}
                              </Text>
                            </InlineStack>
                            <Text as="span" variant="bodySm" tone="critical">{f.message}</Text>
                          </BlockStack>
                        ))}
                        {failedResults.length > 10 && (
                          <Text as="span" variant="bodySm" tone="subdued">{`+ ${failedResults.length - 10} more`}</Text>
                        )}
                      </BlockStack>
                    </Banner>
                  )}

                  {lastDownload && (
                    <Banner tone="success" title="Zip downloaded">
                      <BlockStack gap="200">
                        <p>
                          {lastDownload.filename} — {lastDownload.count} image{lastDownload.count === 1 ? "" : "s"}, streamed straight from
                          uploads/background-customiser/{siteFolderName}/.
                        </p>
                        <InlineStack>
                          <Button icon={ExportIcon} onClick={() => triggerUrlDownload(lastDownload.url)}>
                            Download again
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Banner>
                  )}

                  {outlierResults.length > 0 && (
                    <Banner tone="warning" title="Some results look different from the rest of this batch" onDismiss={() => setOutlierResults([])}>
                      <BlockStack gap="150">
                        <p>
                          {`${outlierResults.length.toLocaleString()} image${outlierResults.length === 1 ? "" : "s"} came out with a noticeably different background color than the rest — worth a quick check (a wrong column applied, a source photo that wasn't actually plain to begin with, or a logo/zoom overlap).`}
                        </p>
                        <BlockStack gap="100">
                          {outlierResults.slice(0, 10).map((o) => (
                            <InlineStack key={o.path} gap="200" blockAlign="start" align="start" wrap={false}>
                              <Badge tone={o.column === "A" ? "info" : "success"}>{`Column ${o.column}`}</Badge>
                              <Text as="span" variant="bodySm" breakWord>
                                <Text as="span" variant="bodySm" fontWeight="semibold">
                                  {`${o.folder}${o.shot !== null ? ` · shot ${o.shot}` : ""}`}
                                </Text>
                                {` / ${o.filename}`}
                              </Text>
                            </InlineStack>
                          ))}
                          {outlierResults.length > 10 && (
                            <Text as="span" variant="bodySm" tone="subdued">{`+ ${outlierResults.length - 10} more`}</Text>
                          )}
                        </BlockStack>
                      </BlockStack>
                    </Banner>
                  )}

                  {conversion && (
                    <MediaConversionSettings
                      value={conversionUi}
                      onChange={setConversionUi}
                      showReplaceMode={false}
                      hideFormat
                      title={`Convert to ${convertToLabel}`}
                      description="Every image in the exported zip — edited and untouched alike — is converted with these settings, using the workers selected below."
                    />
                  )}

                  <InlineStack align="end" gap="200" blockAlign="center">
                    <div style={{ minWidth: 240 }}>
                      <Select
                        label="Convert to"
                        labelInline
                        disabled={processing || zipping}
                        options={CONVERT_TO_OPTIONS}
                        value={convertTo}
                        onChange={(value) => {
                          const next = value as ConvertTo;
                          setConvertTo(next);
                          // Keeps the shared settings panel's own format-dependent bits (e.g. PNG locking the quality slider) in step.
                          if (next !== "leave") setConversionUi((prev) => ({ ...prev, format: next }));
                        }}
                      />
                    </div>
                    <div style={{ minWidth: 140 }}>
                      <Select
                        label="Workers"
                        labelHidden
                        disabled={processing || zipping}
                        options={WORKER_COUNT_OPTIONS}
                        value={String(workerCount)}
                        onChange={(value) => setWorkerCount(Number(value))}
                      />
                    </div>
                    {processing && (
                      <Button tone="critical" onClick={cancelProcessing}>
                        Cancel
                      </Button>
                    )}
                    {zipping && (
                      <Button tone="critical" onClick={cancelZipping}>
                        Cancel
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      icon={PaintBrushFlatIcon}
                      loading={processing || zipping}
                      disabled={
                        processing ||
                        zipping ||
                        processTargets.length === 0 ||
                        (effectiveBgKind === "image" && !bgStateA.bgImageFile) ||
                        (effectiveSecondaryBgKind === "image" && !bgStateB.bgImageFile)
                      }
                      onClick={processAll}
                    >
                      {zipping
                        ? "Zipping…"
                        : processing
                          ? `Updating… ${overallPercent}%`
                          : `Apply & download (${processTargets.length})`}
                    </Button>
                  </InlineStack>

                  <Divider />

                  <BlockStack gap="300">
                    <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                      <Text as="h3" variant="headingSm">Folders ({zipData.folders.length})</Text>
                      <InlineStack gap="200" blockAlign="center">
                        <div style={{ minWidth: 220 }}>
                          <TextField
                            label="Search folders"
                            labelHidden
                            placeholder="Search folders"
                            prefix={<Icon source={SearchIcon} tone="subdued" />}
                            value={folderSearch}
                            onChange={setFolderSearch}
                            autoComplete="off"
                            clearButton
                            onClearButtonClick={() => setFolderSearch("")}
                          />
                        </div>
                        <Button onClick={toggleExpandAll} disabled={visibleFolders.length === 0}>
                          {allFoldersExpanded ? "Collapse all" : "Expand all"}
                        </Button>
                      </InlineStack>
                    </InlineStack>
                    {visibleFolders.length === 0 && (
                      <Text as="p" tone="subdued" variant="bodySm">No folders match &quot;{folderSearch}&quot;.</Text>
                    )}
                    {renderedFolders.map((folder) => {
                      const folderFiles = folder.filePaths.map((p) => files.get(p)).filter((f): f is FileEntry => Boolean(f));
                      const willUpdate = folderFiles.filter(
                        (f) => f.index !== null && (selectedIndices.has(f.index) || secondaryIndices.has(f.index)),
                      ).length;
                      const expanded = expandedFolders.has(folder.sku);
                      return (
                        <Card key={folder.sku} padding="0">
                          <Box padding="300">
                            <InlineStack align="space-between" blockAlign="center">
                              <button
                                type="button"
                                onClick={() => toggleFolder(folder.sku)}
                                style={{ display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", cursor: "pointer", padding: 0 }}
                              >
                                <Icon source={expanded ? ChevronDownIcon : ChevronRightIcon} tone="subdued" />
                                <Text as="span" fontWeight="medium">{folder.sku}</Text>
                              </button>
                              <InlineStack gap="200" blockAlign="center">
                                <Text as="span" tone="subdued" variant="bodySm">
                                  {folder.imageCount} image{folder.imageCount === 1 ? "" : "s"}
                                </Text>
                                {willUpdate > 0 && <Badge tone="magic">{`${willUpdate} to update`}</Badge>}
                                <Button size="micro" icon={ViewIcon} onClick={() => toggleFolder(folder.sku)}>
                                  View
                                </Button>
                              </InlineStack>
                            </InlineStack>
                          </Box>
                          <Collapsible id={`folder-${folder.sku}`} open={expanded}>
                            <Box padding="0">
                              <BlockStack gap="0">
                                {folderFiles.map((file) => {
                                  const isSelected = file.index !== null && (selectedIndices.has(file.index) || secondaryIndices.has(file.index));
                                  const isActive = file.status === "processing";
                                  const icon = STATUS_ICON[file.status];
                                  return (
                                    <Box
                                      key={file.path}
                                      padding="200"
                                      paddingInlineStart="500"
                                      borderBlockStartWidth="025"
                                      borderColor="border-secondary"
                                      background={isActive ? "bg-surface-magic" : undefined}
                                    >
                                      <InlineStack align="space-between" blockAlign="center" gap="200">
                                        <InlineStack gap="200" blockAlign="center">
                                          <Text as="span" variant="bodySm" fontWeight={isActive ? "semibold" : "regular"} tone={isSelected ? undefined : "subdued"}>
                                            {file.filename}
                                          </Text>
                                          {file.index !== null && <Badge tone={isSelected ? "info" : undefined}>{`#${file.index}`}</Badge>}
                                        </InlineStack>
                                        <InlineStack gap="150" blockAlign="center">
                                          {file.status === "processing" && <Spinner size="small" />}
                                          {icon && <Icon source={icon.source} tone={icon.tone} />}
                                          {file.status === "error" && file.columnLabel && (
                                            <Badge tone={file.columnLabel === "Column A" ? "info" : file.columnLabel === "Column B" ? "success" : undefined}>{file.columnLabel}</Badge>
                                          )}
                                          {file.status === "error" && file.error && (
                                            <Text as="span" tone="critical" variant="bodySm">{file.error}</Text>
                                          )}
                                          {!isSelected && !hasGlobalEdit && file.status === "skipped" && (
                                            <Text as="span" tone="subdued" variant="bodySm">Unchanged</Text>
                                          )}
                                        </InlineStack>
                                      </InlineStack>
                                    </Box>
                                  );
                                })}
                              </BlockStack>
                            </Box>
                          </Collapsible>
                        </Card>
                      );
                    })}
                    {hiddenFolderCount > 0 && (
                      <InlineStack align="center">
                        <Button onClick={() => setFoldersRevealed(true)}>
                          {`View more (${hiddenFolderCount} more)`}
                        </Button>
                      </InlineStack>
                    )}
                  </BlockStack>
                </BlockStack>
              </Card>
            </Layout.Section>
          </>
        )}
      </Layout>
    </Page>
  );
}
