import { loadSkuMediaZip, readZipImage, type StreamingZipHandle, type SkuMediaFolder } from "@/lib/skuMediaZip";
import { mapWithConcurrency } from "@/lib/concurrency";
import { backgroundConfigFor, type BackgroundEditorState } from "@/app/(app)/tools/bg-customiser/backgroundEditorState";
import { runCompositeWorkerPool } from "@/app/(app)/tools/bg-customiser/workerPool";
import type { CompositeWorkerJob } from "@/app/(app)/tools/bg-customiser/compositeWorker";
import { uploadImageToServer } from "@/app/(app)/tools/bg-customiser/serverSaveQueue";
import { ZOOM_DEFAULT } from "@/app/(app)/tools/bg-customiser/ZoomControl";
import { type ConversionUiState } from "@/components/products/MediaConversionSettings";
import { runConvertWorkerPool } from "@/app/(app)/tools/media-converter/workerPool";
import type { ConvertWorkerJob } from "@/app/(app)/tools/media-converter/convertWorker";
import type { ConversionSettings } from "@/lib/imageProcessing";
import type { LogoOverlay, LogoPosition, CanvasShape, TextOverlay } from "@/lib/backgroundComposite";
import type { ScraperPlatform, ScrapeScope, ScrapeJobSummary } from "@/lib/storeScraper/types";

export type PipelineStage =
  | "idle"
  | "scraping"
  | "downloading-zip"
  | "reading-zip"
  | "compositing"
  | "converting"
  | "uploading"
  | "done"
  | "error"
  | "cancelled";

export const STAGE_LABEL: Record<PipelineStage, string> = {
  idle: "",
  scraping: "Step 1 — Scraping the store",
  "downloading-zip": "Step 1 — Downloading the scraped images",
  "reading-zip": "Reading the zip",
  compositing: "Step 2 — Background/zoom/logo",
  converting: "Step 3 — Converting image format/size",
  uploading: "Saving results to your final zip",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

export interface PipelineRunConfig {
  platform: ScraperPlatform;
  scope: ScrapeScope;
  storeUrl: string;
  requestedFields: string;
  containerClasses: string;
  useCache: boolean;
  allowInsecureTls: boolean;
  quickMediaMode: boolean;
  enableBackground: boolean;
  bgStateA: BackgroundEditorState;
  bgPositionsTextA: string;
  bgStateB: BackgroundEditorState;
  bgPositionsTextB: string;
  /** Zoom, canvas shape, and the logo overlay apply to every image in the zip regardless of the background step — same as BgCustomiserForm.tsx's own `hasGlobalEdit`. */
  zoomPercent: number;
  canvasShape: CanvasShape;
  logoFile: File | null;
  logoPosition: LogoPosition;
  logoCustomX: number;
  logoCustomY: number;
  logoSizePercent: number;
  logoMarginPercent: number;
  /** Built by the form the same way `BgCustomiserForm.tsx` builds its own — already a complete `TextOverlay` or `undefined`. */
  textOverlay?: TextOverlay;
  enableConversion: boolean;
  conversionUi: ConversionUiState;
  /** Posted a plain JSON message to on finish (done, error, or cancelled) — Slack incoming webhooks and Discord webhooks both accept this shape; empty means no notification. */
  notifyWebhookUrl: string;
  /** Fires a browser `Notification` on finish, if permission was already granted (the form is responsible for requesting it, since that needs a user gesture). */
  notifyDesktop: boolean;
}

export interface PipelineRunState {
  stage: PipelineStage;
  error: string | null;
  scrapeJob: ScrapeJobSummary | null;
  stageProgress: { done: number; total: number } | null;
  skippedCount: number;
  finalSite: string | null;
  finalCount: number;
  /** Whether the detailed view (a Modal, rendered globally by PipelineGlobalWidget) is open right now — closing it just collapses to the floating bottom-right pill, it never touches the run itself. */
  popupOpen: boolean;
  /**
   * Epoch ms when scraping actually started — used for a live ETA
   * ("~N min remaining") derived from the real rate observed so far
   * (`scrapedCount` / elapsed), rather than a guess made before any actual
   * data exists. Deliberately not a "dry run" prediction: this tool has no
   * way to know a store's real product/image count before scraping it, so
   * a pre-run estimate would just be speculation dressed up as a number.
   */
  scrapeStartedAt: number | null;
}

const IDLE_STATE: PipelineRunState = {
  stage: "idle",
  error: null,
  scrapeJob: null,
  stageProgress: null,
  skippedCount: 0,
  finalSite: null,
  scrapeStartedAt: null,
  finalCount: 0,
  popupOpen: false,
};

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

/** Composited output is always PNG (see backgroundComposite.ts) — matches the same convention BgCustomiserForm.tsx uses for its own downloads. */
function compositedFilenameFor(filename: string): string {
  return filename.replace(/\.[a-zA-Z0-9]+$/, ".png");
}

/** Same `{name}`/`{folder}`/`{index}`/`{ext}` template as Media Format Converter's own rename pattern (see `MediaConverterForm.tsx`'s `outputPathFor`) — `folder` here is naturally the product's SKU, and `index` its 1-based shot position, since this pipeline's "batch" is really a set of per-product image folders rather than one flat list. */
function applyRenamePattern(pattern: string, filename: string, folder: string, index: number): string {
  if (!pattern.trim()) return filename;
  const ext = filename.split(".").pop() ?? "";
  const name = filename.replace(/\.[^.]+$/, "");
  return pattern.replaceAll("{name}", name).replaceAll("{folder}", folder).replaceAll("{index}", String(index)).replaceAll("{ext}", ext);
}

function hostnameOf(inputUrl: string): string {
  try {
    return new URL(inputUrl).hostname.replace(/^www\./, "");
  } catch {
    return "store";
  }
}

/** "1, 3, 5" -> {1,3,5}; blank/unparseable -> null, meaning "every image". 1-based, same numbering as the background customiser's own shot-number picker (each image's position within its own product folder). */
function parsePositions(text: string): Set<number> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const nums = trimmed
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return nums.length > 0 ? new Set(nums) : null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Triggers a real browser download from a server URL. */
function triggerUrlDownload(url: string) {
  const link = document.createElement("a");
  link.href = url;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

/**
 * A plain module-scoped store (subscribe/getSnapshot, read via
 * `useSyncExternalStore` — see `PipelineGlobalWidget.tsx`) rather than
 * component state, specifically so the run keeps going and stays visible
 * across route navigation: React unmounts a page's own component tree the
 * moment you navigate away from it, but a run started from
 * `AllInOnePipelineForm` needs to survive that — the whole point of the
 * floating status widget is seeing (and cancelling) a run from ANY page,
 * not just the one that started it. This module is imported by both the
 * tool's own page and by `AppFrame` (mounted once for the whole app
 * session), so there's exactly one instance of this state no matter how
 * many places read from it.
 */
class PipelineRunStore {
  private state: PipelineRunState = IDLE_STATE;
  private listeners = new Set<() => void>();
  private cancelled = false;
  /** The worker pool handle currently in flight (composite or convert stage), if any — `cancel()` needs this to actually stop the workers rather than just waiting for them to finish on their own. */
  private activeHandle: { cancel: () => void } | null = null;
  /** Set at the start of `start()`, read back by `setState` when it notices a transition into a terminal stage — keeping notification config here (rather than threading it through every one of the run's dozen terminal-stage exit points) means firing it is a single, unmissable choke point instead of something a future new exit point could forget to wire up. */
  private currentConfig: PipelineRunConfig | null = null;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): PipelineRunState => this.state;

  private setState(patch: Partial<PipelineRunState>): void {
    const prevStage = this.state.stage;
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
    if (patch.stage && patch.stage !== prevStage && (patch.stage === "done" || patch.stage === "error" || patch.stage === "cancelled")) {
      this.fireNotifications(patch.stage);
    }
  }

  /** Best-effort — notification delivery (or a user simply not having granted permission) never affects the run's own outcome. */
  private fireNotifications(stage: "done" | "error" | "cancelled"): void {
    const config = this.currentConfig;
    if (!config) return;
    const label = stage === "done" ? "Pipeline finished" : stage === "error" ? "Pipeline failed" : "Pipeline cancelled";
    const detail =
      stage === "error"
        ? this.state.error
        : stage === "done"
          ? `${this.state.finalCount.toLocaleString()} image${this.state.finalCount === 1 ? "" : "s"} in the final zip.`
          : null;
    const message = detail ? `${label} — ${detail}` : label;

    if (config.notifyDesktop && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try {
        new Notification("All-in-one pipeline", { body: message });
      } catch {
        // best-effort, see doc comment
      }
    }
    if (config.notifyWebhookUrl.trim()) {
      void fetch(config.notifyWebhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Both keys included since this is meant for either a Slack
        // incoming webhook (`text`) or a Discord webhook (`content`)
        // without needing the user to tell us which one they pasted.
        body: JSON.stringify({ text: message, content: message }),
      }).catch(() => {
        // best-effort, see doc comment
      });
    }
  }

  setPopupOpen(open: boolean): void {
    this.setState({ popupOpen: open });
  }

  isRunning(): boolean {
    const stage = this.state.stage;
    return stage !== "idle" && stage !== "done" && stage !== "error" && stage !== "cancelled";
  }

  cancel(): void {
    this.cancelled = true;
    // Just flipping `cancelled` isn't enough on its own — a worker-pool
    // stage (compositing/converting) is `await handle.promise`, which only
    // resolves once every dispatched job finishes; nothing was ever telling
    // the workers themselves to stop, so Cancel appeared to do nothing
    // until the whole batch ran to completion. `handle.cancel()` is what
    // actually tells them to stop picking up new jobs.
    this.activeHandle?.cancel();
    const job = this.state.scrapeJob;
    if (job && (job.status === "queued" || job.status === "discovering" || job.status === "scraping")) {
      void fetch(`/api/store-scraper/jobs/${job.id}/cancel`, { method: "POST" });
    }
  }

  reset(): void {
    this.setState(IDLE_STATE);
  }

  async start(config: PipelineRunConfig): Promise<void> {
    if (this.isRunning()) return;
    this.cancelled = false;
    this.activeHandle = null;
    this.currentConfig = config;
    this.setState({
      stage: "scraping",
      error: null,
      finalSite: null,
      finalCount: 0,
      skippedCount: 0,
      stageProgress: null,
      scrapeJob: null,
      scrapeStartedAt: Date.now(),
      popupOpen: true,
    });

    let job: ScrapeJobSummary;
    try {
      const startRes = await fetch("/api/store-scraper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          platform: config.platform,
          scope: config.scope,
          inputUrl: config.storeUrl,
          requestedFields: config.requestedFields,
          containerClasses: config.containerClasses,
          useCache: config.useCache,
          allowInsecureTls: config.allowInsecureTls,
          quickMediaMode: config.quickMediaMode,
        }),
      });
      const startData = (await startRes.json()) as { job?: ScrapeJobSummary; error?: string };
      if (!startRes.ok || !startData.job) throw new Error(startData.error ?? "Couldn't start the scrape.");
      job = startData.job;
      this.setState({ scrapeJob: job });

      while (job.status === "queued" || job.status === "discovering" || job.status === "scraping") {
        await sleep(2000);
        if (this.cancelled) {
          this.setState({ stage: "cancelled" });
          return;
        }
        const pollRes = await fetch(`/api/store-scraper/jobs/${job.id}`);
        const pollData = (await pollRes.json()) as { job?: ScrapeJobSummary; error?: string };
        if (!pollRes.ok || !pollData.job) throw new Error(pollData.error ?? "Lost track of the scrape job.");
        job = pollData.job;
        this.setState({ scrapeJob: job });
      }
      if (job.status === "cancelled") {
        this.setState({ stage: "cancelled" });
        return;
      }
      if (job.status === "error") throw new Error("The scrape itself failed — check Store scraper for details.");
      if (job.productCount === 0) throw new Error("Nothing was scraped — check the URL and scope.");
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : "Couldn't scrape this store.", stage: "error" });
      return;
    }

    let zip: StreamingZipHandle;
    let folders: SkuMediaFolder[];
    try {
      this.setState({ stage: "downloading-zip" });
      const zipRes = await fetch(`/api/store-scraper/jobs/${job.id}/export-zip?exclude=`);
      if (!zipRes.ok) throw new Error("Couldn't download the scraped images.");
      const zipBlob = await zipRes.blob();
      const zipFile = new File([zipBlob], `${job.id}.zip`, { type: "application/zip" });

      this.setState({ stage: "reading-zip" });
      const loaded = await loadSkuMediaZip(zipFile);
      zip = loaded.zip;
      folders = loaded.folders;
      if (folders.length === 0) throw new Error("The scraped zip has no product folders to work with.");
    } catch (err) {
      this.setState({ error: err instanceof Error ? err.message : "Couldn't read the scraped zip.", stage: "error" });
      return;
    }
    if (this.cancelled) {
      this.setState({ stage: "cancelled" });
      return;
    }

    const skuByPath = new Map<string, string>();
    const positionByPath = new Map<string, number>();
    for (const folder of folders) {
      folder.filePaths.forEach((path, position) => {
        skuByPath.set(path, folder.sku);
        positionByPath.set(path, position + 1);
      });
    }
    const allPaths = folders.flatMap((f) => f.filePaths);

    const compositedResults = new Map<string, Blob>();
    let compositeFailures = 0;
    const logoOverlay: LogoOverlay | undefined = config.logoFile
      ? {
          image: config.logoFile,
          position: config.logoPosition,
          customXPercent: config.logoCustomX,
          customYPercent: config.logoCustomY,
          sizePercent: config.logoSizePercent,
          marginPercent: config.logoMarginPercent,
        }
      : undefined;
    // Zoom and the logo apply to every image regardless of the background
    // step — same distinction BgCustomiserForm.tsx's own `hasGlobalEdit`
    // makes: if either is set, EVERY image needs a pass (background-target
    // images get "primary"/"secondary", everything else gets "zoom-only" so
    // it still gets the zoom/logo treatment); if neither is set, only images
    // one of the two columns actually targets need touching at all.
    const hasGlobalEdit =
      config.zoomPercent !== ZOOM_DEFAULT ||
      Boolean(config.logoFile) ||
      Boolean(config.textOverlay) ||
      config.canvasShape !== "original";
    const targetPositionsA = config.enableBackground ? parsePositions(config.bgPositionsTextA) : new Set<number>();
    const targetPositionsB = config.enableBackground ? parsePositions(config.bgPositionsTextB) : new Set<number>();
    const isColumnA = (path: string) =>
      config.enableBackground && (targetPositionsA === null || targetPositionsA.has(positionByPath.get(path) ?? -1));
    // A position claimed by both columns' text fields goes to Column A —
    // same as checking a shot number in Column A clearing it from Column B
    // in the real tool's own mutually-exclusive checkboxes.
    const isColumnB = (path: string) =>
      config.enableBackground &&
      !isColumnA(path) &&
      (targetPositionsB === null || targetPositionsB.has(positionByPath.get(path) ?? -1));
    const modeFor = (path: string): "primary" | "secondary" | "zoom-only" =>
      isColumnA(path) ? "primary" : isColumnB(path) ? "secondary" : "zoom-only";

    const jobs: CompositeWorkerJob[] = hasGlobalEdit
      ? allPaths.map((path) => ({ path, mode: modeFor(path) }))
      : allPaths.filter((path) => isColumnA(path) || isColumnB(path)).map((path) => ({ path, mode: modeFor(path) }));

    if (jobs.length > 0) {
      this.setState({ stage: "compositing", stageProgress: { done: 0, total: jobs.length } });
      const primaryConfig = backgroundConfigFor(config.bgStateA, config.bgStateA.bgKind);
      const secondaryConfig = backgroundConfigFor(config.bgStateB, config.bgStateB.bgKind);
      let done = 0;
      try {
        const handle = runCompositeWorkerPool({
          zip,
          jobs,
          primaryConfig,
          secondaryConfig,
          foregroundZoom: { zoomPercent: config.zoomPercent },
          logo: logoOverlay,
          canvasShape: config.canvasShape,
          textOverlay: config.textOverlay,
          onResult: (path, blob) => {
            compositedResults.set(path, blob);
            done += 1;
            this.setState({ stageProgress: { done, total: jobs.length } });
          },
          onError: () => {
            compositeFailures += 1;
            done += 1;
            this.setState({ stageProgress: { done, total: jobs.length } });
          },
        });
        this.activeHandle = handle;
        if (this.cancelled) handle.cancel();
        await handle.promise;
      } catch (err) {
        this.setState({ error: err instanceof Error ? err.message : "Background compositing failed.", stage: "error" });
        return;
      } finally {
        this.activeHandle = null;
      }
    }
    if (this.cancelled) {
      this.setState({ stage: "cancelled" });
      return;
    }

    const filesForConversion = new Map<string, File>();
    await mapWithConcurrency(allPaths, 10, async (path) => {
      const filename = path.split("/").pop() ?? path;
      const compositedBlob = compositedResults.get(path);
      if (compositedBlob) {
        filesForConversion.set(path, new File([compositedBlob], compositedFilenameFor(filename), { type: "image/png" }));
        return;
      }
      const original = await readZipImage(zip, path);
      if (original) filesForConversion.set(path, new File([original.blob], filename, { type: original.mimeType }));
    });

    const finalFiles = new Map<string, { blob: Blob; filename: string }>();
    let convertFailures = 0;
    if (config.enableConversion) {
      this.setState({ stage: "converting" });
      const jobs: ConvertWorkerJob[] = Array.from(filesForConversion.keys()).map((path) => ({ path }));
      this.setState({ stageProgress: { done: 0, total: jobs.length } });
      let done = 0;
      try {
        const handle = runConvertWorkerPool({
          zip: null,
          directFiles: filesForConversion,
          jobs,
          settings: toConversionSettings(config.conversionUi),
          onResult: (path, result) => {
            const renamed = applyRenamePattern(config.conversionUi.renamePattern, result.filename, skuByPath.get(path) ?? "", positionByPath.get(path) ?? 0);
            finalFiles.set(path, { blob: result.blob, filename: renamed });
            done += 1;
            this.setState({ stageProgress: { done, total: jobs.length } });
          },
          onError: (path) => {
            convertFailures += 1;
            done += 1;
            this.setState({ stageProgress: { done, total: jobs.length } });
            // Still worth keeping the pre-conversion version rather than dropping the image from the export entirely.
            const fallback = filesForConversion.get(path);
            if (fallback) {
              const renamed = applyRenamePattern(config.conversionUi.renamePattern, fallback.name, skuByPath.get(path) ?? "", positionByPath.get(path) ?? 0);
              finalFiles.set(path, { blob: fallback, filename: renamed });
            }
          },
        });
        this.activeHandle = handle;
        if (this.cancelled) handle.cancel();
        await handle.promise;
      } catch (err) {
        this.setState({ error: err instanceof Error ? err.message : "Format conversion failed.", stage: "error" });
        return;
      } finally {
        this.activeHandle = null;
      }
    } else {
      for (const [path, file] of filesForConversion) {
        const renamed = applyRenamePattern(config.conversionUi.renamePattern, file.name, skuByPath.get(path) ?? "", positionByPath.get(path) ?? 0);
        finalFiles.set(path, { blob: file, filename: renamed });
      }
    }
    if (this.cancelled) {
      this.setState({ stage: "cancelled" });
      return;
    }

    this.setState({ stage: "uploading" });
    const siteFolderName = `all-in-one.${hostnameOf(config.storeUrl)}.${job.id.slice(0, 8)}`;
    let uploaded = 0;
    let uploadSkipped = 0;
    const entries = Array.from(finalFiles.entries());
    this.setState({ stageProgress: { done: 0, total: entries.length } });
    await mapWithConcurrency(entries, 6, async ([path, { blob, filename }]) => {
      if (this.cancelled) return;
      const sku = skuByPath.get(path);
      if (!sku) return;
      const result = await uploadImageToServer({ website: siteFolderName, sku, filename, blob });
      if (result.skipped) uploadSkipped += 1;
      uploaded += 1;
      this.setState({ stageProgress: { done: uploaded, total: entries.length } });
    });
    if (this.cancelled) {
      this.setState({ stage: "cancelled", finalSite: siteFolderName });
      return;
    }

    this.setState({
      skippedCount: compositeFailures + convertFailures,
      finalSite: siteFolderName,
      finalCount: uploaded - uploadSkipped,
      stage: "done",
    });
    triggerUrlDownload(`/api/bg-customiser/export-zip?site=${encodeURIComponent(siteFolderName)}`);
  }
}

export const pipelineRunStore = new PipelineRunStore();
export { triggerUrlDownload };
