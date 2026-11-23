"use client";
/* eslint-disable react-hooks/set-state-in-effect -- restoring persisted settings from localStorage after mount, so SSR and the first client render match before swapping in the saved value (same pattern as MediaUploadForm.tsx) */

import { useEffect, useRef, useState } from "react";
import {
  Page,
  Layout,
  Card,
  BlockStack,
  InlineStack,
  InlineGrid,
  Text,
  Button,
  Banner,
  DropZone,
  Icon,
  Box,
  Spinner,
  ProgressBar,
} from "@shopify/polaris";
import { Select } from "@/components/ui/Select";
import { FileIcon, XCircleIcon } from "@shopify/polaris-icons";
import { formatFileSize } from "@/lib/csvSkuColors";
import { loadImageZip, readZipImage, isImageFilename, guessImageMimeType, type StreamingZipHandle, type ZipImageFile } from "@/lib/skuMediaZip";
import { MEGAPIXEL_LIMIT, processImage, type ConversionSettings, type ProcessedImage } from "@/lib/imageProcessing";
import type { ImageProcessStep } from "@/components/products/MediaImageGrid";
import {
  MediaConversionSettings,
  DEFAULT_CONVERSION_STATE,
  type ConversionUiState,
} from "@/components/products/MediaConversionSettings";
import { conversionTag } from "@/lib/conversionSettings";
import { computeBatchSignature } from "./zipSignature";
import { getJobMeta, saveJobMeta, saveResult, loadSavedResults, clearJob, type JobMeta } from "./progressStore";
import { ServerSaveQueue } from "./serverSaveQueue";
import { runConvertWorkerPool, getDefaultWorkerCount, MAX_WORKERS } from "./workerPool";
import type { ConvertWorkerJob } from "./convertWorker";

const SETTINGS_STORAGE_KEY = "media-converter:conversion-settings";

function toConversionSettings(ui: ConversionUiState): ConversionSettings {
  const maxSizeBytes =
    ui.maxSizeOption === "none" ? null : ui.maxSizeOption === "custom" ? ui.customMaxSizeKb * 1024 : Number(ui.maxSizeOption) * 1024;
  return {
    format: ui.format,
    quality: ui.quality / 100,
    maxSizeBytes,
    resizeOverMegapixels: ui.resizeOverMegapixels,
    customResize: ui.customResizeEnabled ? { width: ui.customWidth, height: ui.customHeight } : null,
  };
}

/**
 * Bumped whenever the converter itself changes in a way that changes its output (v2: the megapixel resize now always
 * lands within the limit), so results saved by an older version are never mistaken for current ones.
 */
const CONVERTER_VERSION = "v2";

/**
 * A short, folder-safe key for everything that changes how a converted file looks: format, quality, size cap, the
 * megapixel resize, custom size and renaming. The server folder and the saved progress are both keyed by it, so changing
 * a setting converts afresh instead of picking up files an earlier run made with different settings.
 */
function settingsKey(ui: ConversionUiState): string {
  return `${conversionTag(toConversionSettings(ui), ui.renamePattern)}-${CONVERTER_VERSION}`;
}

function loadStoredConversionSettings(): ConversionUiState {
  if (typeof window === "undefined") return DEFAULT_CONVERSION_STATE;
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_CONVERSION_STATE;
    return { ...DEFAULT_CONVERSION_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONVERSION_STATE;
  }
}

/**
 * Derives the output path for a converted file — same folder always;
 * either the converted file's own default name (same base name, possibly a
 * new extension from format conversion), or — when a rename pattern is
 * set — that pattern filled in with this file's own name/folder/batch
 * position/output extension.
 */
function outputPathFor(originalPath: string, convertedFilename: string, renamePattern: string, index: number): string {
  const slash = originalPath.lastIndexOf("/");
  const dir = slash === -1 ? "" : originalPath.slice(0, slash + 1);
  if (!renamePattern.trim()) return dir + convertedFilename;

  const folder = slash === -1 ? "" : (originalPath.slice(0, slash).split("/").pop() ?? "");
  const ext = convertedFilename.split(".").pop() ?? "";
  const name = convertedFilename.replace(/\.[^.]+$/, "");
  const filename = renamePattern
    .replaceAll("{name}", name)
    .replaceAll("{folder}", folder)
    .replaceAll("{index}", String(index))
    .replaceAll("{ext}", ext);
  return dir + filename;
}

function triggerBrowserDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Triggers a real browser download from a server URL (`Content-Disposition: attachment`) — used for the zip case instead of building a `Blob` client-side, see `export-zip/route.ts`'s own note on why. */
function triggerUrlDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function slugifyBatchName(value: string): string {
  return value.trim() || "images";
}

const ZIP_ACCEPT = /\.zip$/i;

// 1 through MAX_WORKERS (8) — the worker-count picker's own option list.
const WORKER_COUNT_OPTIONS = Array.from({ length: MAX_WORKERS }, (_, i) => {
  const count = i + 1;
  return { value: String(count), label: `${count} worker${count === 1 ? "" : "s"}` };
});

export function MediaConverterForm() {
  const [file, setFile] = useState<File | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [zip, setZip] = useState<StreamingZipHandle | null>(null);
  const [imagePaths, setImagePaths] = useState<string[]>([]);
  // Set instead of `zip` when the user drops one or more bare image files
  // rather than a zip — same conversion pipeline, just reading bytes
  // straight from these Files instead of unzipping anything.
  const directFilesRef = useRef<Map<string, File>>(new Map());
  const [directFilesTotalSize, setDirectFilesTotalSize] = useState(0);

  const [conversion, setConversion] = useState<ConversionUiState>(DEFAULT_CONVERSION_STATE);
  // The default state renders first so server and client markup match, then
  // this swaps in whatever was saved last time — same pattern as the media
  // uploader's identical restore-from-localStorage effect.
  useEffect(() => {
    setConversion(loadStoredConversionSettings());
  }, []);

  const [previewing, setPreviewing] = useState(false);
  const [previewSummary, setPreviewSummary] = useState<{ originalTotal: number; estimatedTotal: number; count: number } | null>(null);

  const [imageStatus, setImageStatus] = useState<Record<string, ImageProcessStep>>({});
  const setImageStep = (path: string, step: ImageProcessStep) => {
    setImageStatus((prev) => ({ ...prev, [path]: step }));
  };
  // Buffers status patches instead of calling `setImageStatus` once per
  // image — with several thousand images and up to 8 workers reporting
  // results in a burst, one `setImageStatus` per single result was
  // enough rapid-fire React state updates to risk tripping React's own
  // runaway-update guard ("Maximum update depth exceeded") — same issue
  // already fixed the same way for the background customiser's worker
  // pool. Flushed on a short timer instead.
  const pendingStatusRef = useRef<Record<string, ImageProcessStep>>({});
  const statusFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Running total of converted-output bytes, so "estimated output size" can
  // update live as images finish instead of only being known once the whole
  // batch (or a preview pass) has completed. Batched into the same 80ms
  // flush as the status patches above, for the same "up to 8 workers
  // reporting in a burst" reason.
  const pendingSizeDeltaRef = useRef(0);
  const [estimatedOutputSize, setEstimatedOutputSize] = useState(0);
  const flushImageStatus = () => {
    if (statusFlushTimerRef.current) {
      clearTimeout(statusFlushTimerRef.current);
      statusFlushTimerRef.current = null;
    }
    const sizeDelta = pendingSizeDeltaRef.current;
    pendingSizeDeltaRef.current = 0;
    if (sizeDelta !== 0) setEstimatedOutputSize((prev) => prev + sizeDelta);
    if (Object.keys(pendingStatusRef.current).length === 0) return;
    const updates = pendingStatusRef.current;
    pendingStatusRef.current = {};
    setImageStatus((prev) => ({ ...prev, ...updates }));
  };
  const queueImageStep = (path: string, step: ImageProcessStep, outputSize = 0) => {
    pendingStatusRef.current[path] = step;
    pendingSizeDeltaRef.current += outputSize;
    if (statusFlushTimerRef.current) return;
    statusFlushTimerRef.current = setTimeout(() => {
      statusFlushTimerRef.current = null;
      flushImageStatus();
    }, 80);
  };
  useEffect(() => {
    return () => {
      if (statusFlushTimerRef.current) clearTimeout(statusFlushTimerRef.current);
    };
  }, []);

  const processedCacheRef = useRef<Map<string, ProcessedImage>>(new Map());

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

  const [converting, setConverting] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [convertProgress, setConvertProgress] = useState<{ done: number; total: number } | null>(null);
  const [convertError, setConvertError] = useState<string | null>(null);
  const [lastResult, setLastResult] = useState<
    { kind: "blob"; blob: Blob; filename: string; count: number } | { kind: "url"; url: string; filename: string; count: number } | null
  >(null);
  // The biggest converted image of the current run (by pixel count) — shown afterwards so the size rule can be checked.
  const [largestOutput, setLargestOutput] = useState<{ width: number; height: number } | null>(null);
  const cancelledRef = useRef(false);
  // Set for the duration of a `convertAndDownload` run — lets
  // `cancelConvert` reach into the currently-running worker pool without
  // convertAndDownload needing to return anything to the click handler
  // that started it.
  const activePoolCancelRef = useRef<(() => void) | null>(null);
  // Separate from `cancelledRef` — that one stops the conversion loop;
  // this one stops the save-to-server + zip-download phase, which can
  // keep running well after conversion itself has finished and has its
  // own Cancel button for exactly that stretch.
  const saveCancelledRef = useRef(false);

  // The zip's own filename (minus ".zip"), or a fallback for a bare-images
  // drop — used as uploads/Media-format-converter/<batchName>/, the same
  // on-disk-cache pattern the background customiser and store scraper
  // tools already use, so converted images land on disk as they're
  // produced instead of only ever existing as an in-memory Blob.
  const [batchName, setBatchName] = useState("images");
  // The folder on the server for this batch's converted files. It includes the settings key, because the server keeps a
  // file that is already there instead of overwriting it — without this, a second run with other settings would hand back the first run's files.
  // The same cleaning the server applies to a folder name, so the name used to save and the name used to build the zip are identical.
  const outputFolder = `${batchName.replace(/[\\:*?"<>|]/g, "-").trim()}-${settingsKey(conversion)}`;
  // Identifies "this same batch" across a refresh/restart — see
  // zipSignature.ts. `savedProgress` is only set when a previous run's
  // progress was found in IndexedDB for the batch just added; resuming or
  // discarding it clears this back to null.
  const [baseSignature, setBaseSignature] = useState<string | null>(null);
  // Saved progress belongs to this zip AND these settings: results made with other settings are not offered for resuming.
  const signature = baseSignature ? `${baseSignature}-${settingsKey(conversion)}` : null;
  const [savedProgress, setSavedProgress] = useState<{ doneCount: number; totalCount: number } | null>(null);
  const [resumingProgress, setResumingProgress] = useState(false);
  const [serverSaveProgress, setServerSaveProgress] = useState<{ done: number; total: number } | null>(null);
  // Which of the two reasons `serverSaveProgress` is currently draining for
  // — "download" (heading toward the zip export) or "cleanup" (conversion
  // was cancelled or produced nothing; this is just letting already-queued
  // uploads finish rather than abandoning them, never toward a download).
  // The progress line's own wording, and whether the primary button shows
  // as still busy, both read this instead of assuming every drain is the
  // zip-download one.
  const [savePurpose, setSavePurpose] = useState<"download" | "cleanup" | null>(null);

  const handleConversionChange = (next: ConversionUiState) => {
    setConversion(next);
    processedCacheRef.current.clear();
    setImageStatus({});
    setPreviewSummary(null);
    setLastResult(null);
    setSavedProgress(null);
    if (baseSignature) {
      void getJobMeta(`${baseSignature}-${settingsKey(next)}`).then((meta) => setSavedProgress(meta && meta.doneCount > 0 ? { doneCount: meta.doneCount, totalCount: meta.totalCount } : null));
    }
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // storage full or disabled — settings just won't persist
      }
    }
  };

  const resetResults = () => {
    setImagePaths([]);
    setImageStatus({});
    setPreviewSummary(null);
    setConvertProgress(null);
    setZipping(false);
    setConvertError(null);
    setLastResult(null);
    setLargestOutput(null);
    processedCacheRef.current.clear();
    setBatchName("images");
    setBaseSignature(null);
    setSavedProgress(null);
    setServerSaveProgress(null);
    setSavePurpose(null);
    setEstimatedOutputSize(0);
  };

  /** Reads one source image's bytes on demand — from the zip's central directory if this was a zip upload, or straight from the in-memory File if the user dropped bare image files instead. */
  const readSourceImage = async (path: string): Promise<ZipImageFile | null> => {
    if (zip) return readZipImage(zip, path);
    const direct = directFilesRef.current.get(path);
    if (!direct) return null;
    return { path, filename: path, blob: direct, mimeType: direct.type || guessImageMimeType(path) };
  };

  const handleZipFile = async (picked: File) => {
    setFile(picked);
    setParseError(null);
    resetResults();
    setParsing(true);
    try {
      const loaded = await loadImageZip(picked);
      setZip(loaded.zip);
      setImagePaths(loaded.imagePaths);
      if (loaded.imagePaths.length === 0) {
        setParseError("No image files were found in this zip.");
        return;
      }
      const name = slugifyBatchName(picked.name.replace(/\.zip$/i, ""));
      setBatchName(name);

      // Same zip re-added after a refresh or a server restart? Check for
      // progress saved under this exact signature (see zipSignature.ts) —
      // shown as a banner rather than auto-applied, so it's the user's
      // call whether to pick up where they left off.
      const sig = await computeBatchSignature(picked.name, picked.size, loaded.imagePaths);
      setBaseSignature(sig);
      const meta = await getJobMeta(`${sig}-${settingsKey(conversion)}`);
      setSavedProgress(meta && meta.doneCount > 0 ? { doneCount: meta.doneCount, totalCount: meta.totalCount } : null);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't read this zip file.");
      setZip(null);
      setImagePaths([]);
    } finally {
      setParsing(false);
    }
  };

  /** A bare image (or several) dropped directly, with no zip involved — same conversion pipeline, reading straight from these Files. */
  const handleDirectImageFiles = async (picked: File[]) => {
    setParseError(null);
    resetResults();
    setFile(null);
    setZip(null);

    const images = picked.filter((f) => isImageFilename(f.name));
    if (images.length === 0) {
      setParseError("That doesn't look like an image file — try a .jpg, .png, .webp, .gif, .avif, .bmp, or .tiff.");
      directFilesRef.current = new Map();
      setImagePaths([]);
      setDirectFilesTotalSize(0);
      return;
    }

    const map = new Map<string, File>();
    let totalSize = 0;
    for (const img of images) {
      let name = img.name;
      let n = 2;
      while (map.has(name)) {
        const dot = img.name.lastIndexOf(".");
        name = dot === -1 ? `${img.name} (${n})` : `${img.name.slice(0, dot)} (${n})${img.name.slice(dot)}`;
        n++;
      }
      map.set(name, img);
      totalSize += img.size;
    }
    directFilesRef.current = map;
    setDirectFilesTotalSize(totalSize);
    const paths = Array.from(map.keys());
    setImagePaths(paths);

    // Bare images have no zip filename to derive a batch/site name from —
    // a fixed "dropped-images" folder is the sane default; multiple
    // separate drops of loose images naturally accumulate (and dedupe via
    // the server's own skip-if-exists) under the same folder.
    setBatchName("dropped-images");
    const sig = await computeBatchSignature("dropped-images", totalSize, paths);
    setBaseSignature(sig);
    const meta = await getJobMeta(`${sig}-${settingsKey(conversion)}`);
    setSavedProgress(meta && meta.doneCount > 0 ? { doneCount: meta.doneCount, totalCount: meta.totalCount } : null);
  };

  const handleDrop = (accepted: File[]) => {
    if (accepted.length === 1 && ZIP_ACCEPT.test(accepted[0].name)) {
      void handleZipFile(accepted[0]);
    } else {
      void handleDirectImageFiles(accepted);
    }
  };

  const clearFile = () => {
    setFile(null);
    setZip(null);
    directFilesRef.current = new Map();
    setDirectFilesTotalSize(0);
    setParseError(null);
    resetResults();
  };

  const handleResumeProgress = async () => {
    if (!signature) return;
    setResumingProgress(true);
    try {
      const saved = await loadSavedResults(signature);
      const statusUpdates: Record<string, ImageProcessStep> = {};
      let resumedSize = 0;
      for (const [path, result] of saved) {
        processedCacheRef.current.set(path, {
          blob: result.blob,
          filename: result.filename,
          mimeType: result.blob.type || "application/octet-stream",
          width: 0,
          height: 0,
          originalSize: result.blob.size,
        });
        statusUpdates[path] = "done";
        resumedSize += result.blob.size;
      }
      setImageStatus((prev) => ({ ...prev, ...statusUpdates }));
      setEstimatedOutputSize((prev) => prev + resumedSize);
      setSavedProgress(null);
    } finally {
      setResumingProgress(false);
    }
  };

  const handleDiscardProgress = () => {
    if (signature) void clearJob(signature);
    setSavedProgress(null);
  };

  /** Processes (or reuses the cached conversion of) a single image, reading its bytes on demand. */
  const processSingleImage = async (path: string, settings: ConversionSettings): Promise<ProcessedImage> => {
    const cached = processedCacheRef.current.get(path);
    if (cached) return cached;
    const raw = await readSourceImage(path);
    if (!raw) throw new Error(`Couldn't find "${path}" anymore.`);
    const processed = await processImage(raw, settings);
    processedCacheRef.current.set(path, processed);
    return processed;
  };

  const runPreviewConversion = async () => {
    if (imagePaths.length === 0) return;
    setPreviewing(true);
    setPreviewSummary(null);
    const settings = toConversionSettings(conversion);
    let originalTotal = 0;
    let estimatedTotal = 0;
    let count = 0;
    try {
      for (const path of imagePaths) {
        setImageStep(path, "checking");
        try {
          setImageStep(path, "converting");
          const processed = await processSingleImage(path, settings);
          originalTotal += processed.originalSize;
          estimatedTotal += processed.blob.size;
          count++;
          setImageStep(path, "done");
        } catch {
          setImageStep(path, "error");
        }
      }
      setPreviewSummary({ originalTotal, estimatedTotal, count });
    } finally {
      setPreviewing(false);
    }
  };

  const cancelConvert = () => {
    cancelledRef.current = true;
    activePoolCancelRef.current?.();
  };

  const cancelSaving = () => {
    saveCancelledRef.current = true;
  };

  const convertAndDownload = async () => {
    if (imagePaths.length === 0) {
      setConvertError("Nothing loaded to convert — add a zip or images above.");
      return;
    }
    cancelledRef.current = false;
    setConvertError(null);
    setLastResult(null);
    setLargestOutput(null);
    setConverting(true);
    setConvertProgress({ done: 0, total: imagePaths.length });
    setEstimatedOutputSize(0);

    const settings = toConversionSettings(conversion);
    const totalCount = imagePaths.length;
    let errorCount = 0;
    let doneCount = 0;
    const convertedPaths: { path: string; outputPath: string }[] = [];
    // 1-based position within the whole batch — precomputed once rather
    // than an `indexOf` per result, since results can arrive from workers
    // in any order and a per-image `indexOf` over a large batch would be
    // O(n) every time (O(n²) overall).
    const indexByPath = new Map(imagePaths.map((path, i) => [path, i + 1]));

    // Saves each converted image to uploads/Media-format-converter/
    // <batchName>/ as it's produced — the same on-disk layout (and
    // skip-if-already-there fast path) the background customiser and
    // store scraper tools already use, so a future run can restore from
    // disk instead of reconverting, and the final zip below can be built
    // by the server reading straight from these files instead of holding
    // the whole batch in the browser's memory at once. Runs alongside
    // conversion, not after it.
    //
    // `serverSaveTotal` starts at the FULL batch size rather than growing
    // one-by-one as images get queued — growing it that way made the
    // progress line read "19 of 19", then "107 of 107", forever appearing
    // "done" because it was only ever comparing against how much had been
    // queued *so far*, not the real target. It's corrected down to the
    // actual number of successful conversions once the loop below finishes
    // (errored/cancelled images never reach the save queue at all).
    let serverSaveDone = 0;
    let serverSaveTotal = totalCount;
    const serverSaveQueue = new ServerSaveQueue(() => {
      serverSaveDone += 1;
      setServerSaveProgress({ done: serverSaveDone, total: serverSaveTotal });
    });

    // Paths already converted — carried over from this session's own cache
    // or a resumed run — skip straight to "done" instead of handing them to
    // a worker; only the rest get spread across the worker pool below.
    const jobs: ConvertWorkerJob[] = [];
    let progressDone = 0;
    for (const path of imagePaths) {
      const cached = processedCacheRef.current.get(path);
      if (cached) {
        const outputPath = outputPathFor(path, cached.filename, conversion.renamePattern, indexByPath.get(path) ?? 0);
        convertedPaths.push({ path, outputPath });
        queueImageStep(path, "done", cached.blob.size);
        doneCount += 1;
        progressDone += 1;
        serverSaveQueue.push({ batchName: outputFolder, relativePath: outputPath, blob: cached.blob });
      } else {
        queueImageStep(path, "checking");
        jobs.push({ path });
      }
    }
    flushImageStatus();
    setConvertProgress({ done: progressDone, total: totalCount });

    try {
      if (jobs.length > 0) {
        await new Promise<void>((resolve, reject) => {
          const handle = runConvertWorkerPool({
            zip,
            directFiles: directFilesRef.current,
            jobs,
            settings,
            workerCount,
            onResult: (path, result) => {
              const processed: ProcessedImage = {
                blob: result.blob,
                filename: result.filename,
                mimeType: result.mimeType,
                width: result.width,
                height: result.height,
                originalSize: result.originalSize,
              };
              processedCacheRef.current.set(path, processed);
              if (result.width * result.height > 0) {
                setLargestOutput((previous) => (!previous || result.width * result.height > previous.width * previous.height ? { width: result.width, height: result.height } : previous));
              }
              const outputPath = outputPathFor(path, processed.filename, conversion.renamePattern, indexByPath.get(path) ?? 0);
              convertedPaths.push({ path, outputPath });
              queueImageStep(path, "done", processed.blob.size);
              doneCount += 1;
              progressDone += 1;
              setConvertProgress({ done: progressDone, total: totalCount });

              serverSaveQueue.push({ batchName: outputFolder, relativePath: outputPath, blob: processed.blob });

              if (signature) {
                void saveResult(signature, path, processed.filename, processed.blob);
                const meta: JobMeta = { signature, updatedAt: Date.now(), totalCount, doneCount };
                void saveJobMeta(meta);
              }
            },
            onError: (path) => {
              errorCount++;
              queueImageStep(path, "error");
              progressDone += 1;
              setConvertProgress({ done: progressDone, total: totalCount });
            },
          });
          activePoolCancelRef.current = handle.cancel;
          handle.promise.then(resolve, reject);
        });
      }
      flushImageStatus();
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "A background worker crashed while converting.");
    } finally {
      activePoolCancelRef.current = null;
      setConverting(false);
    }

    // Now that conversion has stopped (finished, errored, or cancelled),
    // the real target for the save queue is known exactly: every image
    // that's ever going to be pushed already has been (errored and
    // never-reached images never get pushed at all).
    serverSaveTotal = doneCount;
    setServerSaveProgress({ done: serverSaveDone, total: serverSaveTotal });

    if (cancelledRef.current) {
      setConvertError("Conversion cancelled — anything already finished is kept, and saved so you can resume later.");
      // Draining still runs (already-queued uploads finish rather than
      // being abandoned), but it's no longer heading toward a download —
      // `zipping`/`savePurpose` say so, so the button and progress text
      // don't look like they're stuck mid-download when they're actually
      // just finishing cleanup, and the Cancel button stays available to
      // stop waiting on it (the uploads themselves still complete in the
      // background either way — see `ServerSaveQueue.drain`'s own note).
      saveCancelledRef.current = false;
      setSavePurpose("cleanup");
      setZipping(true);
      await serverSaveQueue.drain(() => saveCancelledRef.current);
      setZipping(false);
      setSavePurpose(null);
      setServerSaveProgress(null);
      return;
    }
    if (convertedPaths.length === 0) {
      setConvertError("Nothing converted successfully — nothing to download.");
      saveCancelledRef.current = false;
      setSavePurpose("cleanup");
      setZipping(true);
      await serverSaveQueue.drain(() => saveCancelledRef.current);
      setZipping(false);
      setSavePurpose(null);
      setServerSaveProgress(null);
      return;
    }

    // A single bare image (no zip involved) converts to a single file —
    // hand it back directly as a `Blob` instead of routing it through the
    // server; small enough there's no memory concern building it that way.
    if (!zip && convertedPaths.length === 1) {
      const only = convertedPaths[0];
      const processed = processedCacheRef.current.get(only.path);
      saveCancelledRef.current = false;
      setSavePurpose("cleanup");
      setZipping(true);
      await serverSaveQueue.drain(() => saveCancelledRef.current);
      setZipping(false);
      setSavePurpose(null);
      setServerSaveProgress(null);
      if (processed) {
        setLastResult({ kind: "blob", blob: processed.blob, filename: only.outputPath, count: 1 });
        triggerBrowserDownload(processed.blob, only.outputPath);
      }
      if (errorCount > 0) {
        setConvertError(`${errorCount} image${errorCount === 1 ? "" : "s"} couldn't be converted and ${errorCount === 1 ? "was" : "were"} left out.`);
      }
      return;
    }

    // Most saves already finished during conversion (they run alongside
    // it, not after) — this just waits out whatever's still trickling
    // through the upload queue's concurrency limit, then triggers a
    // server-side streamed zip download built straight from
    // uploads/Media-format-converter/<batchName>/ — never a client-side
    // in-memory `Blob`, which is what reliably crashed the tab outright
    // ("Out of Memory") on a real batch this large.
    saveCancelledRef.current = false;
    setSavePurpose("download");
    setZipping(true);
    try {
      await serverSaveQueue.drain(() => saveCancelledRef.current);
      if (saveCancelledRef.current) {
        setConvertError("Cancelled — everything saved so far is on disk at uploads/Media-format-converter/, ready to export anytime.");
        return;
      }
      const downloadUrl = `/api/media-converter/export-zip?batch=${encodeURIComponent(outputFolder)}&name=${encodeURIComponent(batchName)}`;
      const filename = `${batchName}-converted.zip`;
      triggerUrlDownload(downloadUrl);
      setLastResult({ kind: "url", url: downloadUrl, filename, count: convertedPaths.length });
      // The batch finished and downloaded successfully — the saved
      // per-image progress has done its job, so there's no reason to keep
      // gigabytes of result blobs sitting in IndexedDB indefinitely. The
      // files on disk under uploads/ stay, though — that's what makes the
      // download re-triggerable later without reprocessing anything.
      if (signature) void clearJob(signature);
      if (errorCount > 0) {
        setConvertError(`${errorCount} image${errorCount === 1 ? "" : "s"} couldn't be converted and ${errorCount === 1 ? "was" : "were"} left out.`);
      }
    } catch (err) {
      setConvertError(err instanceof Error ? err.message : "Couldn't save files to the server.");
    } finally {
      setZipping(false);
      setSavePurpose(null);
      setServerSaveProgress(null);
    }
  };

  const errorCount = Object.values(imageStatus).filter((s) => s === "error").length;
  const convertedCount = Object.values(imageStatus).filter((s) => s === "done").length;
  // Live progress while running, otherwise whatever's actually done/counted so
  // far — stays visible after a run finishes instead of disappearing.
  const convertedLabel = convertProgress
    ? `${convertProgress.done}/${convertProgress.total}`
    : `${convertedCount}/${imagePaths.length}`;

  return (
    <Page
      fullWidth
      title="Media format converter"
      subtitle="Personal tool — converts images inside a zip and hands you back a downloadable zip. Doesn't touch your store."
      backAction={{ content: "Store connection", url: "/settings/connection" }}
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="400">
              <Text as="h2" variant="headingSm">Upload a zip — or just drop an image</Text>
              <Text as="p" tone="subdued">
                Drop a zip of images (any folder structure), or drop one or more image files straight in — same
                conversion either way. Conversion itself runs in your browser; for a zip, each converted image is
                also saved to this app&apos;s own uploads/Media-format-converter/ folder as it finishes, so a large
                batch downloads as a server-streamed zip instead of building one giant file in your browser&apos;s
                memory.
              </Text>

              {parseError && (
                <Banner tone="warning" title="Couldn't read this">
                  <p>{parseError}</p>
                </Banner>
              )}

              {file ? (
                <Card background="bg-surface-secondary">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Icon source={FileIcon} tone="subdued" />
                      <BlockStack gap="0">
                        <Text as="span" fontWeight="medium">{file.name}</Text>
                        <Text as="span" tone="subdued" variant="bodySm">{formatFileSize(file.size)}</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button icon={XCircleIcon} variant="plain" accessibilityLabel="Remove file" onClick={clearFile} />
                  </InlineStack>
                </Card>
              ) : imagePaths.length > 0 ? (
                <Card background="bg-surface-secondary">
                  <InlineStack align="space-between" blockAlign="center">
                    <InlineStack gap="300" blockAlign="center">
                      <Icon source={FileIcon} tone="subdued" />
                      <BlockStack gap="0">
                        <Text as="span" fontWeight="medium">
                          {imagePaths.length} image{imagePaths.length === 1 ? "" : "s"} added
                        </Text>
                        <Text as="span" tone="subdued" variant="bodySm">{formatFileSize(directFilesTotalSize)}</Text>
                      </BlockStack>
                    </InlineStack>
                    <Button icon={XCircleIcon} variant="plain" accessibilityLabel="Remove images" onClick={clearFile} />
                  </InlineStack>
                </Card>
              ) : (
                <DropZone
                  accept=".zip,application/zip,image/*"
                  type="file"
                  allowMultiple
                  onDrop={(_files, accepted) => accepted.length > 0 && handleDrop(accepted)}
                >
                  <DropZone.FileUpload actionTitle="Add file(s)" actionHint="or drop a .zip, or one or more images" />
                </DropZone>
              )}

              {parsing && <Text as="span" tone="subdued">Reading zip contents…</Text>}
            </BlockStack>
          </Card>
        </Layout.Section>

        {imagePaths.length > 0 && (
          <Layout.Section>
            <BlockStack gap="400">
              <Card>
                <BlockStack gap="400">
                  <InlineGrid columns={{ xs: 2, sm: 4 }} gap="300">
                    <Box background="bg-surface-secondary" padding="300" borderRadius="200">
                      <Text as="p" variant="heading2xl" fontWeight="bold">{imagePaths.length}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Images found</Text>
                    </Box>
                    <Box background="bg-fill-info-secondary" padding="300" borderRadius="200">
                      <Text as="p" variant="heading2xl" fontWeight="bold">
                        {formatFileSize(file?.size ?? directFilesTotalSize)}
                      </Text>
                      <Text as="p" variant="bodySm" tone="subdued">{zip ? "Zip size" : "Total size"}</Text>
                    </Box>
                    <Box background="bg-fill-success-secondary" padding="300" borderRadius="200">
                      <Text as="p" variant="heading2xl" fontWeight="bold">{convertedLabel}</Text>
                      <Text as="p" variant="bodySm" tone="subdued">Converted</Text>
                    </Box>
                    {estimatedOutputSize > 0 && (
                      <Box background="bg-fill-magic-secondary" padding="300" borderRadius="200">
                        <Text as="p" variant="heading2xl" fontWeight="bold">{formatFileSize(estimatedOutputSize)}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">
                          {convertedCount < imagePaths.length ? "Output so far (est.)" : "Estimated output size"}
                        </Text>
                      </Box>
                    )}
                    {errorCount > 0 && (
                      <Box background="bg-fill-critical-secondary" padding="300" borderRadius="200">
                        <Text as="p" variant="heading2xl" fontWeight="bold">{errorCount}</Text>
                        <Text as="p" variant="bodySm" tone="subdued">Couldn&apos;t convert</Text>
                      </Box>
                    )}
                  </InlineGrid>

                  {savedProgress && (
                    <Banner tone="info" title="Found saved progress for this batch">
                      <BlockStack gap="200">
                        <p>
                          {`${savedProgress.doneCount.toLocaleString()} of ${savedProgress.totalCount.toLocaleString()} images `}
                          {`(${Math.round((savedProgress.doneCount / savedProgress.totalCount) * 100)}%) were already converted before this was last `}
                          interrupted — resume to pick up from there, or start fresh to redo everything.
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

                  {serverSaveProgress && (
                    <BlockStack gap="150">
                      <ProgressBar
                        progress={serverSaveProgress.total === 0 ? 0 : Math.round((serverSaveProgress.done / serverSaveProgress.total) * 100)}
                        tone="primary"
                        size="small"
                      />
                      <Text as="p" variant="bodySm" tone="subdued">
                        {savePurpose === "download"
                          ? `Saving to server — ${serverSaveProgress.done} of ${serverSaveProgress.total} images written to uploads/Media-format-converter/${outputFolder}/. Already-saved files are skipped. Your download starts automatically once this reaches 100%.`
                          : `Finishing already-queued saves — ${serverSaveProgress.done} of ${serverSaveProgress.total} images written to uploads/Media-format-converter/${outputFolder}/ so far. No download will start; everything saved is kept for next time.`}
                      </Text>
                    </BlockStack>
                  )}

                  {convertError && (
                    <Banner tone={lastResult ? "warning" : "critical"} title={lastResult ? undefined : "Couldn't convert"}>
                      <p>{convertError}</p>
                    </Banner>
                  )}

                  {lastResult && (
                    <Banner tone="success" title={lastResult.count === 1 && !zip ? "Converted image downloaded" : "Converted zip downloaded"}>
                      <BlockStack gap="200">
                        <p>
                          {lastResult.filename}
                          {lastResult.count > 1 ? ` — ${lastResult.count} images.` : "."}
                        </p>
                        {largestOutput && (
                          <p>
                            {`Largest converted image: ${largestOutput.width} × ${largestOutput.height} px (${((largestOutput.width * largestOutput.height) / 1_000_000).toFixed(1)} MP)`}
                            {largestOutput.width * largestOutput.height > MEGAPIXEL_LIMIT ? ` — over the ${MEGAPIXEL_LIMIT / 1_000_000} MP limit, so the megapixel resize was off for this run.` : ` — within the ${MEGAPIXEL_LIMIT / 1_000_000} MP limit.`}
                          </p>
                        )}
                        <InlineStack>
                          <Button
                            onClick={() =>
                              lastResult.kind === "blob"
                                ? triggerBrowserDownload(lastResult.blob, lastResult.filename)
                                : triggerUrlDownload(lastResult.url)
                            }
                          >
                            Download again
                          </Button>
                        </InlineStack>
                      </BlockStack>
                    </Banner>
                  )}

                  <InlineStack align="end" gap="200" blockAlign="center">
                    <Box minWidth="140px">
                      <Select
                        label="Workers"
                        labelHidden
                        options={WORKER_COUNT_OPTIONS}
                        value={String(workerCount)}
                        onChange={(value) => setWorkerCount(Number(value))}
                        disabled={converting || zipping}
                      />
                    </Box>
                    {converting && (
                      <Button onClick={cancelConvert} tone="critical">
                        Cancel
                      </Button>
                    )}
                    {zipping && (
                      <Button onClick={cancelSaving} tone="critical">
                        Cancel
                      </Button>
                    )}
                    <Button variant="primary" loading={converting || zipping} onClick={convertAndDownload}>
                      {zipping
                        ? savePurpose === "download"
                          ? "Saving & zipping…"
                          : "Finishing saves…"
                        : converting && convertProgress
                          ? `Converting… (${convertProgress.done}/${convertProgress.total})`
                          : !zip && imagePaths.length === 1
                            ? "Convert and download"
                            : "Convert and download zip"}
                    </Button>
                  </InlineStack>
                  {converting && (
                    <InlineStack gap="150" blockAlign="center">
                      <Spinner size="small" accessibilityLabel="Converting" />
                      <Text as="span" tone="subdued" variant="bodySm">
                        {zipping
                          ? "Packing every converted image into the output zip…"
                          : "Converting and re-zipping every image in your browser — large zips can take a while."}
                      </Text>
                    </InlineStack>
                  )}
                </BlockStack>
              </Card>

              <MediaConversionSettings
                value={conversion}
                onChange={handleConversionChange}
                onPreview={runPreviewConversion}
                previewing={previewing}
                previewSummary={previewSummary}
                showReplaceMode={false}
              />
            </BlockStack>
          </Layout.Section>
        )}
      </Layout>
    </Page>
  );
}
