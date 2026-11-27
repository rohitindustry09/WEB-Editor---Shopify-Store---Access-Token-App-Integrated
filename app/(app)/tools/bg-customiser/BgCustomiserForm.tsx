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
  DeleteIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CheckCircleIcon,
  AlertCircleIcon,
  ImageIcon,
  EyeDropperIcon,
  QuestionCircleIcon,
  InfoIcon,
  SearchIcon,
  ViewIcon,
  FolderIcon,
  FileIcon,
} from "@shopify/polaris-icons";
import {
  loadSkuMediaZip,
  readZipImage,
  isImageFilename,
  type SkuMediaFolder,
  type StreamingZipHandle,
  type ZipSource,
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
} from "@/lib/backgroundComposite";
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
import { loadPersistedSettings, savePersistedSettings, toPersistableBackgroundState, type PersistedBgCustomiserSettings } from "./persistedSettings";
import { DriveLinkImport } from "./DriveLinkImport";
import { clearSavedLogo, loadSavedLogo, saveLogo } from "./logoStore";
import { ServerRunsPanel } from "./ServerRunsPanel";
import { bgJobs, bgWorkspace, refOfRemoteSource, remoteSourceForRef, uploadZipToServer, type UploadProgress } from "@/lib/bgJobsApi";
import { toStoredBackground, toStoredLogo, type BgJobSpec, type BgZipRef, type StoredBackground, type StoredLogo } from "@/lib/bgJobTypes";
import { MediaConversionSettings, DEFAULT_CONVERSION_STATE, FORMAT_OPTIONS, type ConversionUiState } from "@/components/products/MediaConversionSettings";
import { toConversionSettings, type ConvertTo, type WorkerConversion } from "@/lib/conversionSettings";

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

/** Column A / Column B are the two shot-number groups that get a background; anything else is a zoom/logo-only or convert-only job with no column. */
function formatUploadSize(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / 1024))} KB`;
}

function formatUploadEta(seconds: number): string {
  const total = Math.max(1, Math.round(seconds));
  if (total < 60) return `${total}s`;
  if (total < 3600) return `${Math.floor(total / 60)}m ${String(total % 60).padStart(2, "0")}s`;
  return `${Math.floor(total / 3600)}h ${String(Math.floor((total % 3600) / 60)).padStart(2, "0")}m`;
}

const STATUS_ICON: Partial<Record<FileStatus, { source: typeof CheckCircleIcon; tone: "success" | "critical" }>> = {
  done: { source: CheckCircleIcon, tone: "success" },
  error: { source: AlertCircleIcon, tone: "critical" },
};


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
  // The zip's own filename (minus ".zip") — used as the site folder under
  // uploads/background-customiser/<site>/<SKU>/... so every processed
  // image lands on local disk as it's produced, the same way the store
  // scraper's own uploads/<site>/ folder works.
  const [siteFolderName, setSiteFolderName] = useState<string>("site");
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
  // True while the logo shown is also kept in this browser for next time (see logoStore.ts).
  const [logoSaved, setLogoSaved] = useState(false);
  // Set once the user adds or removes a logo themselves, so a slow restore from storage can't overwrite their choice.
  const logoTouchedRef = useRef(false);
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
  /** Puts saved settings back — used for what this browser kept and for what the server kept. */
  const applyPersistedSettings = (persisted: PersistedBgCustomiserSettings) => {
    setForegroundZoomPercent(persisted.foregroundZoomPercent);
    if (persisted.canvasShape) setCanvasShape(persisted.canvasShape);
    setBgStateA((prev) => ({ ...prev, ...persisted.bgStateA }));
    setBgStateB((prev) => ({ ...prev, ...persisted.bgStateB }));
    setLogoPosition(persisted.logoPosition);
    setLogoCustomX(persisted.logoCustomX);
    setLogoCustomY(persisted.logoCustomY);
    setLogoSizePercent(persisted.logoSizePercent);
    setLogoMarginPercent(persisted.logoMarginPercent);
  };

  useEffect(() => {
    const persisted = loadPersistedSettings();
    if (!persisted) return;
    const timer = setTimeout(() => applyPersistedSettings(persisted), 0);
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
  const convertToLabel = CONVERT_TO_OPTIONS.find((o) => o.value === convertTo)?.label ?? "";
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

  // The logo from the last visit comes back selected, so it is stamped on every image without re-adding it.
  useEffect(() => {
    let cancelled = false;
    loadSavedLogo().then((file) => {
      if (cancelled || !file || logoTouchedRef.current) return;
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.add(url);
      setLogoFile(file);
      setLogoPreviewUrl(url);
      setLogoSaved(true);
    });
    return () => {
      cancelled = true;
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

  /** Opens a zip from either place it can come from: a file on this computer, or a copy saved on the server (a Drive download). */
  const openZipSource = async (zipFile: ZipSource) => {
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
      // The zip's own filename becomes the "site" folder under
      // uploads/background-customiser/ — matches how the zips this tool
      // is meant to work on are already named (e.g. a store-scraper
      // export is "bhunes.com.zip"), so results land in the same
      // site-named folder that export itself would use.
      setSiteFolderName(zipFile.name.replace(/\.zip$/i, "").trim() || "site");

    } catch (err) {
      setZipError(err instanceof Error ? err.message : "Couldn't read this zip file.");
    } finally {
      setLoadingZip(false);
    }
  };

  const handleZipDrop = async (accepted: File[]) => {
    const zipFile = accepted.find((f) => f.name.toLowerCase().endsWith(".zip"));
    if (!zipFile) {
      setZipError("That doesn't look like a zip file.");
      return;
    }
    await openZipSource(zipFile);
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
    logoTouchedRef.current = true;
    setLogoFile(file);
    setLogoPreviewUrl(trackUrl(URL.createObjectURL(file)));
    setLogoSaved(false);
    void saveLogo(file).then(setLogoSaved);
  };

  const handleLogoRemove = () => {
    logoTouchedRef.current = true;
    setLogoFile(null);
    setLogoPreviewUrl(null);
    setLogoSaved(false);
    void clearSavedLogo();
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

  // ---- Runs on the server ----
  // The zip must be on the server for a run to work from it: a Drive download or an earlier upload already is; a zip picked from
  // this computer is uploaded in the background as soon as it is added.
  const [serverRunsKey, setServerRunsKey] = useState(0);
  const [serverRunBusy, setServerRunBusy] = useState(false);
  const [serverRunError, setServerRunError] = useState<string | null>(null);
  const [localUpload, setLocalUpload] = useState<{ file: File; progress: UploadProgress; ref: BgZipRef | null; error: string | null } | null>(null);
  const uploadAbortRef = useRef<AbortController | null>(null);

  /** Sends the zip to the server (only when a run needs it). Resolves with its reference, or null when it failed or was cancelled. */
  const startLocalUpload = async (zipFile: File): Promise<BgZipRef | null> => {
    uploadAbortRef.current?.abort();
    const controller = new AbortController();
    uploadAbortRef.current = controller;
    const empty: UploadProgress = { sent: 0, total: zipFile.size, bytesPerSecond: 0, etaSeconds: null, alreadyThere: 0 };
    setLocalUpload({ file: zipFile, progress: empty, ref: null, error: null });
    const patch = (change: Partial<{ progress: UploadProgress; ref: BgZipRef | null; error: string | null }>) =>
      setLocalUpload((current) => (current && current.file === zipFile ? { ...current, ...change } : current));
    try {
      const ref = await uploadZipToServer(zipFile, (progress) => patch({ progress }), controller.signal);
      patch({ ref });
      return ref;
    } catch (err) {
      if (!controller.signal.aborted) patch({ error: err instanceof Error ? err.message : "The upload failed." });
      return null;
    }
  };

  const serverRef = useMemo<BgZipRef | null>(() => {
    if (!zipData) return null;
    const file = zipData.zip.file;
    if (file instanceof Blob) return localUpload && localUpload.file === file ? localUpload.ref : null;
    return refOfRemoteSource(file);
  }, [zipData, localUpload]);

  /** Hands the whole job to the server: the zip it already has, plus the settings and the list of images to change. */
  const runOnServer = async () => {
    setServerRunBusy(true);
    setServerRunError(null);
    try {
      let source = serverRef;
      if (!source) {
        const local = zipData?.zip.file;
        if (local instanceof Blob) source = await startLocalUpload(local as File);
      }
      if (!source) return;
      const primaryPaths = new Set(selectedFiles.map((f) => f.path));
      const secondaryPaths = new Set(secondaryFiles.map((f) => f.path));
      const assets = new Map<string, Blob>();
      let primary: StoredBackground;
      if (backgroundConfig.kind === "image") {
        assets.set("bg-a", backgroundConfig.image);
        primary = toStoredBackground(backgroundConfig, "bg-a");
      } else primary = backgroundConfig;
      let secondary: StoredBackground;
      if (secondaryBackgroundConfig.kind === "image") {
        assets.set("bg-b", secondaryBackgroundConfig.image);
        secondary = toStoredBackground(secondaryBackgroundConfig, "bg-b");
      } else secondary = secondaryBackgroundConfig;
      let logo: StoredLogo | undefined;
      if (logoOverlay) {
        assets.set("logo", logoOverlay.image);
        logo = toStoredLogo(logoOverlay, "logo");
      }
      const spec: BgJobSpec = {
        version: 1,
        name: siteFolderName,
        source,
        items: processTargets.map((f) => ({
          path: f.path,
          mode: primaryPaths.has(f.path) ? "primary" : secondaryPaths.has(f.path) ? "secondary" : hasGlobalEdit ? "zoom-only" : "convert-only",
          folder: f.folder,
          position: f.index ?? 0,
        })),
        primary,
        secondary,
        foregroundZoom,
        logo,
        canvasShape,
        textOverlay,
        conversion,
      };
      await bgJobs.create(spec, assets);
      setServerRunsKey((key) => key + 1);
    } catch (err) {
      setServerRunError(err instanceof Error ? err.message : "Couldn't start the run on the server.");
    } finally {
      setServerRunBusy(false);
    }
  };

  // ---- The page remembers its zip, selection and settings ON THE SERVER, so it comes back the same after any refresh or from any browser ----
  const workspaceReady = useRef(false);
  const restoreRef = useRef({ openZipSource, applyPersistedSettings });
  useEffect(() => {
    restoreRef.current = { openZipSource, applyPersistedSettings };
  });

  useEffect(() => {
    let cancelled = false;
    bgWorkspace
      .load()
      .then(async (saved) => {
        if (cancelled || !saved) return;
        const { openZipSource: open, applyPersistedSettings: apply } = restoreRef.current;
        if (saved.settings) apply(saved.settings as PersistedBgCustomiserSettings);
        if (!saved.zip) return;
        await open(remoteSourceForRef(saved.zip.ref, saved.zip.name, saved.zip.size));
        if (cancelled) return;
        setSelectedIndices(new Set(saved.selectedIndices));
        setSecondaryIndices(new Set(saved.secondaryIndices));
        setManualOverridesA(new Map(saved.manualOverridesA));
        if (saved.convertTo) setConvertTo(saved.convertTo as ConvertTo);
      })
      .catch(() => undefined)
      .finally(() => {
        workspaceReady.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!workspaceReady.current) return;
    const timer = setTimeout(() => {
      const file = zipData?.zip.file;
      void bgWorkspace
        .save({
          zip: zipData && serverRef && file ? { ref: serverRef, name: file.name, size: file.size } : null,
          selectedIndices: [...selectedIndices],
          secondaryIndices: [...secondaryIndices],
          manualOverridesA: [...manualOverridesA.entries()],
          convertTo,
          settings: {
            foregroundZoomPercent,
            canvasShape,
            bgStateA: toPersistableBackgroundState(bgStateA),
            bgStateB: toPersistableBackgroundState(bgStateB),
            logoPosition,
            logoCustomX,
            logoCustomY,
            logoSizePercent,
            logoMarginPercent,
          },
        })
        .catch(() => undefined);
    }, 800);
    return () => clearTimeout(timer);
  }, [serverRef, zipData, selectedIndices, secondaryIndices, manualOverridesA, convertTo, foregroundZoomPercent, canvasShape, bgStateA, bgStateB, logoPosition, logoCustomX, logoCustomY, logoSizePercent, logoMarginPercent]);

  const clearZip = () => {
    uploadAbortRef.current?.abort();
    setLocalUpload(null);
    setZipData(null);
    setFiles(new Map());
    setSelectedIndices(new Set());
    setZipError(null);
    setFoldersRevealed(false);
    setSiteFolderName("site");
  };


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
          <ServerRunsPanel refreshKey={serverRunsKey} />
        </Layout.Section>
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
                <BlockStack gap="300">
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
                <DriveLinkImport disabled={loadingZip} onSource={(source) => void openZipSource(source)} />
                </BlockStack>
              ) : (
                <InlineStack align="space-between" blockAlign="center" gap="300" wrap>
                  <InlineStack gap="300" blockAlign="center" wrap>
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <InlineStack gap="150" blockAlign="center">
                        <Icon source={FileIcon} tone="subdued" />
                        <Text as="span" fontWeight="semibold" breakWord>
                          {siteFolderName}.zip
                        </Text>
                      </InlineStack>
                    </Box>
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
                  <Button icon={DeleteIcon} onClick={clearZip}>
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
                        <InlineStack gap="200" blockAlign="center">
                          <Text as="span" variant="bodySm" fontWeight="medium">Logo</Text>
                          {logoFile && logoSaved && <Badge tone="success">Remembered</Badge>}
                        </InlineStack>
                        {logoFile && (
                          <Button
                            size="micro"
                            icon={DeleteIcon}
                            onClick={handleLogoRemove}
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
                  <Text as="h2" variant="headingSm">Run on the server</Text>
                  <Text as="p" tone="subdued" variant="bodySm">
                    {`${processTargets.length.toLocaleString()} image${processTargets.length === 1 ? "" : "s"} will be edited; every other image in the zip is copied across unchanged, so the download is a complete copy.`}
                  </Text>

                  {conversion && (
                    <MediaConversionSettings
                      value={conversionUi}
                      onChange={setConversionUi}
                      showReplaceMode={false}
                      hideFormat
                      title={`Convert to ${convertToLabel}`}
                      description="Every image in the exported zip — edited and untouched alike — is converted with these settings, on the server."
                    />
                  )}

                  <InlineStack align="end" gap="200" blockAlign="center">
                    <div style={{ minWidth: 240 }}>
                      <Select
                        label="Convert to"
                        labelInline
                        disabled={serverRunBusy}
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
                    <Button
                      variant="primary"
                      icon={PaintBrushFlatIcon}
                      loading={serverRunBusy}
                      disabled={
                        serverRunBusy ||
                        !(serverRef || zipData?.zip.file instanceof Blob) ||
                        processTargets.length === 0 ||
                        (effectiveBgKind === "image" && !bgStateA.bgImageFile) ||
                        (effectiveSecondaryBgKind === "image" && !bgStateB.bgImageFile)
                      }
                      onClick={() => void runOnServer()}
                    >
                      {serverRef ? `Run on server (${processTargets.length})` : `Upload zip & run on server (${processTargets.length})`}
                    </Button>
                  </InlineStack>

                  {localUpload && !localUpload.ref && !localUpload.error && (
                    <BlockStack gap="100">
                      <ProgressBar progress={localUpload.progress.total ? (localUpload.progress.sent / localUpload.progress.total) * 100 : 0} size="small" tone="primary" />
                      <InlineStack align="space-between" blockAlign="center" gap="300">
                        <Text as="p" variant="bodySm" tone="subdued">
                          {`Uploading the zip to the server — ${localUpload.progress.total ? Math.floor((localUpload.progress.sent / localUpload.progress.total) * 100) : 0}% · ${formatUploadSize(localUpload.progress.sent)} of ${formatUploadSize(localUpload.progress.total)}`}
                          {localUpload.progress.bytesPerSecond > 0 ? ` · ${formatUploadSize(localUpload.progress.bytesPerSecond)}/s` : ""}
                          {localUpload.progress.etaSeconds !== null && localUpload.progress.etaSeconds > 0 ? ` · ${formatUploadEta(localUpload.progress.etaSeconds)} left` : ""}
                          {localUpload.progress.alreadyThere > 0 ? ` · ${formatUploadSize(localUpload.progress.alreadyThere)} was already on the server` : ""}
                        </Text>
                        <Button variant="plain" tone="critical" onClick={() => uploadAbortRef.current?.abort()}>Cancel upload</Button>
                      </InlineStack>
                    </BlockStack>
                  )}
                  {localUpload?.error && <Banner tone="warning" title="The zip couldn't be saved on the server"><p>{localUpload.error}</p></Banner>}
                  {serverRunError && <Banner tone="critical" onDismiss={() => setServerRunError(null)}><p>{serverRunError}</p></Banner>}
                  <Text as="p" variant="bodySm" tone="subdued">
                    Everything happens on the server, over the server&apos;s own internet connection: it reads the zip, edits the images and keeps the results. This page
                    only sets things up and, at the end, downloads the finished zip.
                  </Text>
                  {serverRef && (
                    <Text as="p" variant="bodySm" tone="subdued">
                      {serverRef.kind === "drive" ? "This zip is on the server (from Google Drive)." : "This zip is saved on the server."} A run uses it from there, so you can close this page while it works.
                    </Text>
                  )}

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
